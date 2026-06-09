/**
 * RouteEditOrchestrator — Coordinates a single edit operation.
 *
 * Sits between useRouteEditStore (UI state) and DualSourceRouter (routing brain) +
 * LocalRouteExtras (persistence).
 *
 * Sprint 66 Wave 5.
 */

import type { LngLat } from './corridor/PolylineSampler';
import type { TrailGraph } from './graph/TrailGraph';
import type { PointCloudIndex } from './corridor/PointCloudIndex';
import { isPointInCorridor, isPolylineInCorridor } from './corridor/CorridorQuery';
import { routeBetween, RouteResponse } from './DualSourceRouter';
import type { EditSegment, SegmentSource } from '../LocalRouteExtras';
import { polylineLengthM, haversineMeters } from './corridor/PolylineSampler';

const CORRIDOR_VERIFY_SLACK_MULTIPLIER = 1.5; // verify reroute geometry within 1.5x user-facing corridor radius

export interface MidpointDragRequest {
  workingPoints: LngLat[];
  segments: EditSegment[];
  fromPointIdx: number;
  toCoord: LngLat;
  trailGraph: TrailGraph | null;
  walkedIndex: PointCloudIndex | null;
  corridorRadiusM: number;
  /** Sprint 66 Fix-11 (C2): user confirmed they want straight-line stitching even when no trail data. */
  allowStraight?: boolean;
}

export type MidpointDragResult =
  | {
      ok: true;
      newPoints: LngLat[];
      newSegments: EditSegment[];
      response: RouteResponse;
    }
  | {
      ok: false;
      reason:
        | 'out-of-corridor'
        | 'no-walked-data'
        | 'edge-not-draggable'
        | 'reroute-failed'
        | 'reroute-out-of-corridor'
        | 'straight-fallback-needs-confirm';
      detail?: string;
      /** Present when reason='straight-fallback-needs-confirm'. Caller can re-call with allowStraight=true. */
      pendingStraight?: { newPoints: LngLat[]; newSegments: EditSegment[]; response: RouteResponse };
    };

/**
 * Apply a midpoint drag: replace points around fromPointIdx with the rerouted
 * geometry connecting `prevAnchor → toCoord → nextAnchor`.
 *
 * Anchor selection: previous and next "snap-anchor" — for now use immediate
 * neighbors (idx-1 and idx+1).
 */
export async function applyMidpointDrag(req: MidpointDragRequest): Promise<MidpointDragResult> {
  // Step 1: corridor membership check
  // v3-audit (ARCH-014): allowStraight=true means the user has already
  // confirmed via modal that they want a straight stitch — corridor
  // enforcement no longer applies. Bypass the walkedIndex checks for
  // both the membership check (here) and the polyline verify (step 4).
  const skipCorridor = req.allowStraight === true;
  if (!skipCorridor && req.walkedIndex !== null && req.walkedIndex !== undefined) {
    if (req.walkedIndex.size() === 0) {
      return {
        ok: false,
        reason: 'no-walked-data',
        detail: 'No walked-path data available — cannot validate corridor.',
      };
    }
    const inCorridor = isPointInCorridor(
      req.toCoord.lng,
      req.toCoord.lat,
      req.walkedIndex,
      req.corridorRadiusM,
    );
    if (!inCorridor.inCorridor) {
      return { ok: false, reason: 'out-of-corridor', detail: `${Math.round(inCorridor.distanceToWalkedM)}m away` };
    }
  }

  const idx = req.fromPointIdx;
  if (idx < 1 || idx >= req.workingPoints.length - 1) {
    // v4-audit (ARCH-004): distinct reason so UI can guide the user to
    // the trim handles instead of showing 'Could not compute a route'.
    return { ok: false, reason: 'edge-not-draggable', detail: 'midpoint-at-edge' };
  }

  const prevAnchor = req.workingPoints[idx - 1];
  const nextAnchor = req.workingPoints[idx + 1];

  // Step 2: route prev → toCoord and toCoord → next concurrently
  const [r1, r2] = await Promise.all([
    routeBetween({
      from: prevAnchor,
      to: req.toCoord,
      trailGraph: req.trailGraph,
      walkedIndex: req.walkedIndex,
    }),
    routeBetween({
      from: req.toCoord,
      to: nextAnchor,
      trailGraph: req.trailGraph,
      walkedIndex: req.walkedIndex,
    }),
  ]);

  // Step 3: stitch together
  // v3-audit (ARCH-003): deep-copy each LngLat so subsequent alt mutation
  // doesn't write back into r1.geometry.
  // v5-audit (ARCH-006): also REPLACE the snap-derived endpoints
  // (r1.geometry[0], r2.geometry[last]) with the user's actual anchor
  // coordinates.
  type LngLatAlt = LngLat & { alt?: number | null };
  const stitched: LngLatAlt[] = [
    ...r1.geometry.map(p => ({ ...p } as LngLatAlt)),
    ...r2.geometry.slice(1).map(p => ({ ...p } as LngLatAlt)),
  ];
  // v6-audit (BUG-MID-1 + BUG-MID-2): reject degenerate stitched output
  // before any anchor / alt logic. r1+r2 must each return geometry of
  // length >= 2 by contract; stitched length = r1.length + r2.length-1
  // is therefore >=3 in the normal path. Sub-3 means a router returned
  // length-1 (which the contract forbids) or we somehow got an empty
  // geometry. Refuse early with a clear error.
  if (stitched.length < 3) {
    return {
      ok: false,
      reason: 'reroute-failed',
      detail: 'degenerate-stitch',
    };
  }
  if (stitched.length >= 1) {
    stitched[0] = { ...prevAnchor } as LngLatAlt;
  }
  if (stitched.length >= 2) {
    stitched[stitched.length - 1] = { ...nextAnchor } as LngLatAlt;
  }
  // v6-audit (ARCH-002) + v7-audit (ARCH-001): always replace the
  // stitched seam with the user's actual drag target, regardless of
  // source. Even when both halves came from the same router, that
  // router snapped req.toCoord to its graph node which can be up to
  // 100m away (per snapDriftM gates). Without this replacement, the
  // rendered line bypasses the user's finger position. Must happen
  // BEFORE alt interpolation so cumulative arc length uses the
  // corrected geometry.
  if (stitched.length >= 3) {
    const seamIdx = r1.geometry.length - 1;
    if (seamIdx > 0 && seamIdx < stitched.length - 1) {
      stitched[seamIdx] = { ...req.toCoord } as LngLatAlt;
    }
  }

  // v3-audit (ARCH-002/FUNC-007): interpolate alt by cumulative arc
  // length so the dragged-target point's altitude reflects geographic
  // position, NOT array index.
  // v4-audit (BUG-4/BUG-5): handle endpoint-wise. Always anchor
  // stitched[0]=prevAlt and stitched[last]=nextAlt when EITHER is
  // numeric (don't blanket-null when only one is missing). For the
  // interior, interpolate between whichever endpoints we have.
  const prevAlt = (prevAnchor as LngLatAlt).alt;
  const nextAlt = (nextAnchor as LngLatAlt).alt;
  const prevHas = typeof prevAlt === 'number';
  const nextHas = typeof nextAlt === 'number';
  if (stitched.length >= 2 && (prevHas || nextHas)) {
    // Build cumulative arc length [0, d1, d1+d2, ..., totalLen].
    const cum: number[] = [0];
    for (let i = 1; i < stitched.length; i++) {
      cum.push(cum[i - 1] + haversineMeters(stitched[i - 1], stitched[i]));
    }
    const totalLen = cum[cum.length - 1];
    const lastIdx = stitched.length - 1;
    if (prevHas && nextHas) {
      if (totalLen <= 0) {
        // All stitched points coincide — endpoints carry their anchor
        // values; interior gets the midpoint average.
        const midAlt = ((prevAlt as number) + (nextAlt as number)) / 2;
        stitched[0].alt = prevAlt as number;
        stitched[lastIdx].alt = nextAlt as number;
        for (let i = 1; i < lastIdx; i++) stitched[i].alt = midAlt;
      } else {
        for (let i = 0; i < stitched.length; i++) {
          const t = cum[i] / totalLen;
          stitched[i].alt = (prevAlt as number) + ((nextAlt as number) - (prevAlt as number)) * t;
        }
      }
    } else if (prevHas) {
      // Only prev known: anchor stitched[0]=prevAlt; rest = prevAlt
      // (no useful interpolation target). Better than nulling.
      for (const p of stitched) p.alt = prevAlt as number;
    } else {
      // Only next known: anchor stitched[last]=nextAlt; rest = nextAlt.
      for (const p of stitched) p.alt = nextAlt as number;
    }
  } else {
    for (const p of stitched) p.alt = null;
  }

  // Step 4: verify stitched path stays within corridor (skipped if
  // allowStraight — user already accepted off-corridor terrain).
  if (!skipCorridor && req.walkedIndex && req.walkedIndex.size() > 0) {
    const verifyRadius = req.corridorRadiusM * CORRIDOR_VERIFY_SLACK_MULTIPLIER;
    const polylineCheck = isPolylineInCorridor(stitched, req.walkedIndex, verifyRadius);
    if (!polylineCheck.ok) {
      return {
        ok: false,
        reason: 'reroute-out-of-corridor',
        detail: `Reroute drifts at point ${polylineCheck.firstOutsideIdx}`,
      };
    }
  }

  // Step 5: build new working points and segments
  const before = req.workingPoints.slice(0, idx - 1);
  const after = req.workingPoints.slice(idx + 2);
  const newPoints = [...before, ...stitched, ...after];

  // Sprint 66 post-merge audit (FUNC-001/ARCH-001 Blocker fix):
  // Old code had two filters in OLD-index space (`s.endIdx < editedStartIdx`
  // and `s.startIdx > idx + 1`) that silently DROPPED any segment straddling
  // the edit zone — e.g. one segment {0,9} with drag at idx=5 produced an
  // output with only the new edit segment, losing all metadata for the
  // un-edited head/tail. DualLineLayer renders only what's covered by a
  // segment, so the route visually disappeared on each drag.
  //
  // New strategy: split each old segment around the edit window
  // [editStartOld, editEndOld] = [idx-1, idx+1] (the indices of the OLD
  // points being replaced), then shift the right-of-edit portion by the
  // net length delta (newLen - oldLen) where oldLen = 3 (idx-1, idx, idx+1)
  // and newLen = stitched.length. Each old segment yields up to 2 surviving
  // pieces (a left clip and a right clip, one or both possibly empty).
  const editStartOld = idx - 1;
  const editEndOld = idx + 1;
  const stitchedLen = stitched.length;
  const oldReplacedLen = 3; // idx-1, idx, idx+1
  const shift = stitchedLen - oldReplacedLen;

  const editedStartIdx = before.length;
  const editedEndIdx = editedStartIdx + stitchedLen - 1;

  // Sprint 66 Fix-22 (C6): when r1 and r2 used different sources, mark
  // segment as 'mixed' (per LocalRouteExtras.SegmentSource union) instead
  // of the prior hardcoded 'mapbox'. Honest about what this segment is.
  const source = r1.source === r2.source ? r1.source : 'mixed';

  const surviving: EditSegment[] = [];
  for (const s of req.segments) {
    // Left clip: portion strictly before the edit window
    if (s.startIdx < editStartOld) {
      const clipEnd = Math.min(s.endIdx, editStartOld - 1);
      if (clipEnd >= s.startIdx) {
        surviving.push({ ...s, startIdx: s.startIdx, endIdx: clipEnd });
      }
    }
    // Right clip: portion strictly after the edit window, shifted into
    // the new index space
    if (s.endIdx > editEndOld) {
      const clipStart = Math.max(s.startIdx, editEndOld + 1);
      if (clipStart <= s.endIdx) {
        surviving.push({
          ...s,
          startIdx: clipStart + shift,
          endIdx: s.endIdx + shift,
        });
      }
    }
    // Segments fully inside (startIdx >= editStartOld && endIdx <= editEndOld)
    // are entirely replaced by the new edit segment — drop them.
  }

  const newEditSegment: EditSegment = {
    startIdx: editedStartIdx,
    endIdx: editedEndIdx,
    source,
    isEdited: true,
    confidence: r1.confidence === 'confident' && r2.confidence === 'confident' ? 'confident' : 'approximate',
  };

  // Insert the new edit segment at its position (between left and right clips)
  const newSegments: EditSegment[] = [
    ...surviving.filter(s => s.endIdx < editedStartIdx),
    newEditSegment,
    ...surviving.filter(s => s.startIdx > editedEndIdx),
  ].sort((a, b) => a.startIdx - b.startIdx);

  // Sprint 66 Fix-11 (C2): if either half fell back to straight-line, the
  // stitched path crosses unmapped terrain. Per Plan v3.1 §20 and §2.2 the
  // user must explicitly confirm via modal before commit. Don't silently
  // accept the straight stitch — return pending-confirm and let the caller
  // (UI) prompt the user to retry with allowStraight=true.
  // v4-audit (ARCH-001): compose a synthetic RouteResponse so consumers
  // (store.lastSource, telemetry) see the segment's actual mixed source
  // when r1 and r2 disagree. Old code returned r1 verbatim, lying about
  // half the geometry.
  const composedConfidence: 'confident' | 'approximate' =
    r1.confidence === 'confident' && r2.confidence === 'confident' ? 'confident' : 'approximate';
  const composedResponse: RouteResponse = {
    geometry: stitched as LngLat[],
    source,
    confidence: composedConfidence,
    distanceM: (r1.distanceM ?? 0) + (r2.distanceM ?? 0),
    warning: r1.warning ?? r2.warning,
  };

  // Sprint 66 Fix-11 (C2): if either half fell back to straight-line, the
  // user must explicitly confirm via modal before commit. Don't silently
  // accept the straight stitch — return pending-confirm and let the caller
  // (UI) prompt the user to retry with allowStraight=true.
  const usedStraight = r1.source === 'straight' || r2.source === 'straight';
  if (usedStraight && !req.allowStraight) {
    // v15-audit (FC-58): preserve any debug-mode warning from the
    // router so the user-facing copy reflects the actual cause when
    // dualSourceMode is doc-only/mapbox-only and the requested
    // provider failed (rather than the generic "no trail data" line).
    const debugWarning = r1.warning ?? r2.warning;
    const detail =
      debugWarning && debugWarning.includes('Debug mode')
        ? `${debugWarning} Save anyway?`
        : 'No trail data here. Save anyway?';
    return {
      ok: false,
      reason: 'straight-fallback-needs-confirm',
      detail,
      pendingStraight: {
        newPoints,
        newSegments,
        response: composedResponse,
      },
    };
  }

  return {
    ok: true,
    newPoints,
    newSegments,
    response: composedResponse,
  };
}

// ── Trim ────────────────────────────────────────────────────────────────

export interface TrimRequest {
  workingPoints: LngLat[];
  segments: EditSegment[];
  side: 'start' | 'end';
  /** New endpoint index. Trims [0, idx-1] for start; [idx+1, end] for end. */
  newEndpointIdx: number;
}

export interface TrimResult {
  ok: boolean;
  newPoints: LngLat[];
  newSegments: EditSegment[];
  trimmedDistanceM: number;
}

/**
 * Trim start or end of route. Middle is sacred (caller enforces).
 *
 * v6-audit (FUNC-004): assert coverage invariant before returning ok:true.
 * Previously this check lived only in the store, leaving non-store callers
 * exposed.
 */
function coverageOk(segments: EditSegment[], pointCount: number): boolean {
  if (pointCount === 0) return segments.length === 0;
  const sorted = [...segments].sort((a, b) => a.startIdx - b.startIdx);
  let cursor = 0;
  for (const s of sorted) {
    if (s.startIdx !== cursor) return false;
    if (s.endIdx < s.startIdx) return false;
    cursor = s.endIdx + 1;
  }
  return cursor === pointCount;
}

export function applyTrim(req: TrimRequest): TrimResult {
  const { workingPoints: points, segments, side, newEndpointIdx } = req;

  if (side === 'start') {
    if (newEndpointIdx <= 0 || newEndpointIdx >= points.length) {
      return { ok: false, newPoints: points, newSegments: segments, trimmedDistanceM: 0 };
    }
    const removed = points.slice(0, newEndpointIdx);
    const trimmedDistanceM = polylineLengthM(removed);
    const newPoints = points.slice(newEndpointIdx);
    if (newPoints.length < 2) {
      return { ok: false, newPoints: points, newSegments: segments, trimmedDistanceM: 0 };
    }
    const offset = newEndpointIdx;
    const newSegments = segments
      .filter(s => s.endIdx >= offset)
      .map(s => {
        // v6-audit (BUG-T1): wasCut is true only when the cut is
        // STRICTLY INTERIOR — i.e. the segment starts before the trim
        // boundary AND extends past it. Boundary-only trims (s.startIdx
        // === offset) leave the segment intact in the new index space.
        const wasCut = s.startIdx < offset && s.endIdx >= offset;
        // v6-audit (ARCH-005) + v7-audit (ARCH-003/013): when a 'mixed'
        // segment is cut, demote CONFIDENCE to 'approximate' (the
        // multi-source reasoning may not apply to the surviving range).
        // SOURCE remains 'mixed' — the original geometry was composed
        // from two providers and the surviving range still inherits
        // that ambiguous provenance. We don't know per-point which
        // provider contributed without rerunning, so 'mixed' stays
        // honest.
        const nextSource: SegmentSource = s.source;
        const nextConfidence: 'confident' | 'approximate' | undefined =
          wasCut && s.source === 'mixed' ? 'approximate' : s.confidence;
        return {
          ...s,
          startIdx: Math.max(0, s.startIdx - offset),
          endIdx: s.endIdx - offset,
          source: nextSource,
          confidence: nextConfidence,
        };
      });
    if (!coverageOk(newSegments, newPoints.length)) {
      return { ok: false, newPoints: points, newSegments: segments, trimmedDistanceM: 0 };
    }
    return { ok: true, newPoints, newSegments, trimmedDistanceM };
  } else {
    if (newEndpointIdx < 0 || newEndpointIdx >= points.length - 1) {
      return { ok: false, newPoints: points, newSegments: segments, trimmedDistanceM: 0 };
    }
    const removed = points.slice(newEndpointIdx + 1);
    const trimmedDistanceM = polylineLengthM(removed);
    const newPoints = points.slice(0, newEndpointIdx + 1);
    if (newPoints.length < 2) {
      return { ok: false, newPoints: points, newSegments: segments, trimmedDistanceM: 0 };
    }
    const newSegments = segments
      .filter(s => s.startIdx <= newEndpointIdx)
      .map(s => {
        // v6-audit (BUG-T1): symmetric strict-interior criterion.
        const wasCut = s.endIdx > newEndpointIdx && s.startIdx <= newEndpointIdx;
        // v7-audit (ARCH-003/013): only confidence demotes for mixed
        // cuts; source is preserved (see comment in trim 'start').
        const nextSource: SegmentSource = s.source;
        const nextConfidence: 'confident' | 'approximate' | undefined =
          wasCut && s.source === 'mixed' ? 'approximate' : s.confidence;
        return {
          ...s,
          endIdx: Math.min(s.endIdx, newEndpointIdx),
          source: nextSource,
          confidence: nextConfidence,
        };
      });
    if (!coverageOk(newSegments, newPoints.length)) {
      return { ok: false, newPoints: points, newSegments: segments, trimmedDistanceM: 0 };
    }
    return { ok: true, newPoints, newSegments, trimmedDistanceM };
  }
}
