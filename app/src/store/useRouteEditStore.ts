/**
 * useRouteEditStore — Sprint 67 v245 brush+eraser model.
 *
 * Edit semantics:
 *   - Trim head/tail: pure client-side fraction-based slicing (kept).
 *   - Brush mode: user draws polylines on the map. Each stroke must
 *     start AND end within 50m of the original GPS trace. Strokes are
 *     stored as raw lat/lng polylines, painted client-side, color by
 *     point's distance to original (< 400 sage, 400-500 amber, >= 500
 *     red). Eraser tool can clip points off any stroke.
 *   - Save validates: every stroke endpoints on original, no red points,
 *     no stroke-arc overlaps. On pass: send each stroke to Mapbox Map
 *     Matching, splice snapped output into the original at the stroke's
 *     [arcStart, arcEnd] range.
 *   - Undo: every stroke create / erase / trim drag pushes a snapshot.
 *
 * Replaces the v229–v244 envelope/junction-dot + detour-point models.
 */

import { create } from 'zustand';
import type { LngLat } from '../services/routing/corridor/PolylineSampler';
import { polylineLengthM } from '../services/routing/corridor/PolylineSampler';
import { PointCloudIndex } from '../services/routing/corridor/PointCloudIndex';
import { isPointInCorridor } from '../services/routing/corridor/CorridorQuery';
import { runMapMatching, clearMatchCache } from '../services/routing/mapmatch/runMapMatching';
import type { MatchSegment } from '../services/routing/mapmatch/types';
import { matchSegment } from '../services/routing/mapmatch/MapMatchingClient';
import { simplifyStroke, MAPBOX_MATCHING_MAX_COORDS } from '../utils/strokeSimplify';
import { checkG0, checkG0PostSimplify, checkG0_5, checkG3 } from '../utils/strokeGate';
import { sendEditDiag } from '../services/editDiagSender';
// v6.4 Stage D — algorithm-parity note:
// Brush-edit and Activity-snap share the same primitive operations:
//   - simplifyStroke (DP ladder + uniform fallback) — used directly here;
//     also runs inside snapTrack (single-chunk path).
//   - matchSegment   (Mapbox /matching with radius/timeout/abort) — used
//     directly here (per-stroke single call, since brush strokes are
//     always ≤100 vertices); snapTrack chunks long activity tracks.
//   - checkG3 corridor — used directly here; activity snap relies on
//     chunk-level radius+confidence guards (different invariant).
// Because brush strokes never need chunking, calling snapTrack would add
// pointless overhead. The algorithm parity contract (plan §1.4 / Stage D)
// is satisfied at the primitive level: both pipelines call the same
// simplify/match/gate functions in the same order with the same constants.
// Verified by docs/spikes/STAGE_D_PARITY_NOTE.md.
import { saveExtras, loadExtras, EditSegment } from '../services/LocalRouteExtras';
import { migrateRouteIfNeeded, MigrationResult } from '../services/LegacyRouteMigrator';
import { saveSession, clearSession, onSaveSessionFailure } from '../services/EditSessionPersistence';
import { getFlagsSync } from '../config/featureFlags';
import {
  logEditEntered,
  logEditExited,
  logEditSave,
  logTrimApplied,
  logRouteSaveFailure,
  logEditStartDuration,
  logMigratorFailure,
} from '../services/routing/editAnalytics';

const MAX_STROKES = 8;
// v6.3 plan §4.1: lastError UI auto-clears after this many ms.
const LAST_ERROR_AUTO_CLEAR_MS = 2500;
// v255: PO direction "范围改 250m". corridor expanded slightly from 200
// to give legitimate parallel-road detours more room. WARN scales with it.
const CORRIDOR_RADIUS_M = 250;
const ENDPOINT_SNAP_M = 50;
const TRIM_MIN_FRACTION = 0.05;

export type EditTool = 'pan' | 'brush' | 'eraser';

export interface BrushStroke {
  id: string;
  points: LngLat[];
}

interface UndoEntry {
  brushStrokes: BrushStroke[];
  trimStartFrac: number;
  trimEndFrac: number;
  matchedPoints: LngLat[];
}

interface EditState {
  // Identity
  sessionId: string | null;
  routeId: string | null;
  isOpen: boolean;
  editOpSeq: number;

  // Geometry
  originalPoints: LngLat[];
  /** Latest computed matched polyline (= originalPoints when no edits committed). */
  matchedPoints: LngLat[];
  /** Working = matchedPoints sliced by trim. */
  workingPoints: LngLat[];

  // Edit intent
  brushStrokes: BrushStroke[];
  trimStartFrac: number;
  trimEndFrac: number;
  activeTool: EditTool;

  /**
   * v251: id of the stroke currently being drawn (between beginStroke
   * and endStroke). null while not drawing. BrushStrokeLayer reads this
   * via the existing brushStrokes selector path; the field is also a
   * useful signal for selectors that want to short-circuit while a
   * gesture is in flight.
   */
  activeStrokeId: string | null;

  /**
   * v251: true once the user has had at least one successful Preview
   * commit in this edit session. Used by view-mode UI to keep the
   * dashed original-GPS backdrop visible after Preview empties the
   * brushStrokes array — without this flag, brushStrokes.length=0 +
   * trim untouched would hide the backdrop precisely when the matched
   * line has deviated from the original GPS.
   */
  hasCommittedEdit: boolean;

  // v246: Preview state. Lets user see Mapbox snap result before saving.
  // - previewMatchedPoints: if non-null, the snapped polyline. Set by
  //   runPreview() and used as the new matched line in the working slice.
  // - previewIsCurrent: true when previewMatchedPoints reflects the
  //   current brushStrokes/trim. Reset to false on any stroke/trim
  //   mutation. Save is disabled while !previewIsCurrent.
  previewMatchedPoints: LngLat[] | null;
  previewIsCurrent: boolean;

  /**
   * v249: Committed draft — what edit-mode "Save" produces. Holds the
   * edited geometry between leaving edit mode and the user pressing the
   * outer view-mode "Save" (which actually persists to backend). When
   * this is non-null, view-mode renders this geometry, and re-entering
   * Edit resumes from it.
   */
  committedDraft: {
    matchedPoints: LngLat[];
    workingPoints: LngLat[];
    brushStrokes: BrushStroke[];
    trimStartFrac: number;
    trimEndFrac: number;
    routeId: string;
  } | null;

  undoStack: UndoEntry[];

  walkedIndex: PointCloudIndex | null;

  // UI
  isComputing: boolean;
  lastError: string | null;
  lastWarning: string | null;
  validationErrors: string[];

  enteredAtTs: number | null;
  editCount: number;
  lastSaveAttemptFailed: boolean;
  isSaving: boolean;
  migratorRetry: { error: string; retry: boolean } | null;
  pendingBeginArgs: BeginEditArgs | null;

  // Actions
  beginEdit(args: BeginEditArgs): Promise<void>;
  retryMigration(): Promise<void>;
  skipMigration(): void;

  setActiveTool(tool: EditTool): void;

  /** Begin a new stroke (call on gesture begin). Returns id, or null if disallowed. */
  beginStroke(firstPoint: LngLat): string | null;
  /** Append a point to the in-progress stroke. */
  appendStrokePoint(strokeId: string, point: LngLat): void;
  /** Finish stroke (call on gesture end). */
  endStroke(strokeId: string): void;

  /** Erase any stroke point within radius of `coord`. */
  eraseAt(coord: LngLat, radiusM?: number): void;

  /** Discard a whole stroke. */
  removeStroke(strokeId: string): void;

  /** Trim slider actions. */
  setTrimStart(frac: number): void;
  setTrimEnd(frac: number): void;
  beginTrimDrag(): void;

  resetEdits(): void;

  /** v246: validate + run Mapbox snap for all strokes. Sets
   * previewMatchedPoints + previewIsCurrent=true on success. Does NOT
   * persist to the route record — that's saveAndExit's job. */
  runPreview(): Promise<{ ok: boolean; error?: string }>;

  undo(): void;
  canUndo(): boolean;

  setLastError(error: string | null): void;
  detachUI(): void;

  saveAndExit(): Promise<{ ok: boolean; error?: string; sessionReplaced?: boolean }>;
  /**
   * v6.3 plan §2.3: replace null `alt` entries in `matchedPoints` with
   * altitudes resolved by the screen-level Terrain DEM lookup. Caller
   * passes a parallel array of resolved alt values (null = still unknown,
   * tile not loaded). No-op if matchedPoints length doesn't match.
   */
  applyMatchedAltitudes(altitudes: Array<number | null>): void;
  /**
   * v249: Edit mode "Save" handler. Captures current preview geometry as
   * committedDraft and closes edit UI WITHOUT touching backend. The
   * outer view-mode "Save" button is what writes to the backend. This
   * lets PO see the edited line + name it before final commit.
   */
  commitEditDraft(): { ok: boolean; error?: string };
  /** v249: clear committedDraft (e.g. after view-mode Save persists). */
  clearCommittedDraft(): void;
  /**
   * v249: When called from the edit-mode Cancel button, the user only
   * wants to discard their IN-PROGRESS edit (current strokes/trim) and
   * fall back to the last committedDraft (or original if none). Pass
   * `keepDraft: true` for that case. Default behavior (no opts) discards
   * everything including any committedDraft — used when the user fully
   * abandons the route (e.g. view-mode back/discard).
   */
  cancelEdit(opts?: { keepDraft?: boolean }): void;
}

interface BeginEditArgs {
  routeId: string;
  routePoints: LngLat[];
  routeUpdatedAt?: number;
  resumeFrom?: {
    workingPoints: LngLat[];
    brushStrokes?: BrushStroke[];
    trimStartFrac: number;
    trimEndFrac: number;
    enteredAt: number;
  };
}

function genSessionId(): string {
  return `es_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function genStrokeId(): string {
  return `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function haversineMetersLocal(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function lerpLocal(a: LngLat, b: LngLat, t: number): LngLat {
  const tt = Math.max(0, Math.min(1, t));
  const out: LngLat = {
    lng: a.lng + (b.lng - a.lng) * tt,
    lat: a.lat + (b.lat - a.lat) * tt,
  };
  // v6.3 plan §2.2: preserve alt through interpolation when both endpoints
  // have it. Partial knowledge → null (record as unknown rather than fake 0).
  if (a.alt != null && b.alt != null) {
    out.alt = a.alt + (b.alt - a.alt) * tt;
  } else if (a.alt != null || b.alt != null) {
    out.alt = null;
  }
  return out;
}

/** Slice polyline by arc-length fractions in [0..1]. */
export function applyTrimFraction(
  poly: LngLat[],
  startFrac: number,
  endFrac: number,
): LngLat[] {
  if (poly.length < 2) return [...poly];
  const sf = Math.max(0, Math.min(1, startFrac));
  const ef = Math.max(0, Math.min(1, endFrac));
  if (sf >= ef) return [poly[0], poly[0]];
  const totalLen = polylineLengthM(poly);
  if (totalLen < 1e-6) return [...poly];
  const targetStart = sf * totalLen;
  const targetEnd = ef * totalLen;

  let acc = 0;
  const out: LngLat[] = [];
  let started = false;
  let stopped = false;
  for (let i = 1; i < poly.length; i++) {
    if (stopped) break;
    const a = poly[i - 1];
    const b = poly[i];
    const segLen = haversineMetersLocal(a, b);
    const segStartArc = acc;
    const segEndArc = acc + segLen;
    if (!started) {
      if (segEndArc >= targetStart) {
        const t = segLen > 0 ? (targetStart - segStartArc) / segLen : 0;
        out.push(lerpLocal(a, b, t));
        started = true;
        if (segEndArc >= targetEnd) {
          const tEnd = segLen > 0 ? (targetEnd - segStartArc) / segLen : 0;
          out.push(lerpLocal(a, b, tEnd));
          stopped = true;
          break;
        }
      } else {
        acc = segEndArc;
        continue;
      }
    }
    if (segEndArc >= targetEnd) {
      const t = segLen > 0 ? (targetEnd - segStartArc) / segLen : 0;
      out.push(lerpLocal(a, b, t));
      stopped = true;
      break;
    } else {
      out.push(b);
    }
    acc = segEndArc;
  }
  if (out.length < 2) return [poly[0], poly[poly.length - 1]];
  return out;
}

let sessionWriteChain: Promise<void> = Promise.resolve();
export function chainSessionWrite(fn: () => Promise<void>): Promise<void> {
  const next = sessionWriteChain.then(() => fn().catch(() => {}));
  sessionWriteChain = next.then(() => undefined, () => undefined);
  return next;
}

export const recentlyCancelledSessions = new Set<string>();
export function isSessionRecentlyCancelled(sessionId: string): boolean {
  return recentlyCancelledSessions.has(sessionId);
}

function deriveWorking(matched: LngLat[], startFrac: number, endFrac: number): LngLat[] {
  if (matched.length < 2) return matched;
  return applyTrimFraction(matched, startFrac, endFrac);
}

function buildWalkedIndex(originalPoints: LngLat[]): PointCloudIndex {
  return new PointCloudIndex(
    originalPoints.map((p, i) => ({
      lng: p.lng,
      lat: p.lat,
      source: 'original' as const,
      refId: `original:${i}`,
    })),
  );
}

function persistSession(state: EditState, expectedSessionId?: string): void {
  if (!state.routeId || !state.sessionId) return;
  if (expectedSessionId && state.sessionId !== expectedSessionId) return;
  const sid = state.sessionId;
  const rid = state.routeId;
  const enteredAt = state.enteredAtTs ?? Date.now();
  const working = state.workingPoints;
  const ts = state.trimStartFrac;
  const te = state.trimEndFrac;
  chainSessionWrite(() =>
    saveSession({
      sessionId: sid,
      routeId: rid,
      enteredAt,
      workingPoints: working,
      segments: [
        {
          startIdx: 0,
          endIdx: Math.max(0, working.length - 1),
          source: state.brushStrokes.length > 0 ? 'mapbox' : 'original',
          isEdited: state.brushStrokes.length > 0 || ts > 0 || te < 1,
          confidence: 'confident',
        },
      ],
      flagsSnapshot: {
        editCorridorRadiusMeters: CORRIDOR_RADIUS_M,
        midpointDragEnabled: false,
      },
      trimStartFrac: ts,
      trimEndFrac: te,
    }),
  ).catch(() => {});
}

/** For a coord, return distance to nearest originalPoints sample. */
function distanceToOriginalM(
  coord: LngLat,
  walkedIndex: PointCloudIndex | null,
): number {
  if (!walkedIndex) return Infinity;
  const nearest = walkedIndex.nearest(coord.lng, coord.lat, 1);
  if (nearest.length === 0) return Infinity;
  const np = walkedIndex.get(nearest[0]);
  if (!np) return Infinity;
  return haversineMetersLocal(coord, { lng: np.lng, lat: np.lat });
}

/**
 * v251: Acceptable endpoint check.
 *   - Within ENDPOINT_SNAP_M of the current matched line (walkedIndex).
 *   - OR within ENDPOINT_SNAP_M of any point in any existing stroke.
 *
 * Used by beginStroke (start point) and endStroke (end point). Lets the
 * user start a new stroke from where their previous stroke ended,
 * before Preview commits — PO request: "我可以从我画的上面下笔".
 */
function isPointAcceptableEndpoint(
  coord: LngLat,
  walkedIndex: PointCloudIndex | null,
  brushStrokes: BrushStroke[],
): boolean {
  if (distanceToOriginalM(coord, walkedIndex) <= ENDPOINT_SNAP_M) return true;
  for (const s of brushStrokes) {
    for (const p of s.points) {
      if (haversineMetersLocal(coord, p) <= ENDPOINT_SNAP_M) return true;
    }
  }
  return false;
}

/**
 * v255: Strict baseline anchor check.
 * Returns true iff `coord` is within ENDPOINT_SNAP_M of the original
 * matched/walked line (NOT counting other strokes).
 *
 * Used to break the "stroke chain drift" loophole found in v254:
 * isPointAcceptableEndpoint accepted a point near ANY existing stroke,
 * so two strokes drawn 100m off the route could mutually validate each
 * other and form a 267m straight diagonal across buildings (PO route
 * "1" / snap121). Rule: every stroke must have at LEAST ONE endpoint
 * anchored to the baseline. The other endpoint may attach to another
 * stroke (so eraser-split + chained continuation still works), but
 * the chain cannot fully detach from the original line.
 */
function isPointOnBaseline(
  coord: LngLat,
  walkedIndex: PointCloudIndex | null,
): boolean {
  return distanceToOriginalM(coord, walkedIndex) <= ENDPOINT_SNAP_M;
}

/**
 * v255: Stroke must anchor to baseline at one end. Returns true iff
 * EITHER endpoint of `stroke` lies within ENDPOINT_SNAP_M of the
 * baseline (walkedIndex). The other endpoint can be anywhere
 * acceptable (baseline OR another stroke).
 */
function strokeAnchorsToBaseline(
  stroke: BrushStroke,
  walkedIndex: PointCloudIndex | null,
): boolean {
  if (stroke.points.length < 2) return false;
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  return isPointOnBaseline(first, walkedIndex) || isPointOnBaseline(last, walkedIndex);
}

/** For a coord, find the originalPoints index whose point is closest. */
function nearestOriginalIdx(
  coord: LngLat,
  originalPoints: LngLat[],
): { idx: number; distM: number } {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < originalPoints.length; i++) {
    const d = haversineMetersLocal(coord, originalPoints[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { idx: best, distM: bestD };
}

/**
 * v247: project a point onto the nearest SEGMENT (not vertex) of
 * originalPoints. Returns the projected lng/lat AND the perpendicular
 * distance in meters. Used by endStroke endpoint magnetism so a stroke
 * that ends 4m perpendicular to a 5m-spaced original sample lands on
 * the road centerline, not on a 4m-shifted vertex.
 */
function projectOntoOriginalSegment(
  coord: LngLat,
  originalPoints: LngLat[],
): { point: LngLat; distM: number } {
  if (originalPoints.length < 2) return { point: coord, distM: Infinity };
  let bestPt: LngLat = originalPoints[0];
  let bestD = Infinity;
  for (let i = 1; i < originalPoints.length; i++) {
    const a = originalPoints[i - 1];
    const b = originalPoints[i];
    const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
    const cosLat = Math.cos(midLat);
    const M_PER_DEG = 111000;
    const ax = a.lng * cosLat * M_PER_DEG;
    const ay = a.lat * M_PER_DEG;
    const bx = b.lng * cosLat * M_PER_DEG;
    const by = b.lat * M_PER_DEG;
    const px = coord.lng * cosLat * M_PER_DEG;
    const py = coord.lat * M_PER_DEG;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq < 1e-9 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const fx = ax + t * dx;
    const fy = ay + t * dy;
    const ex = px - fx;
    const ey = py - fy;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < bestD) {
      bestD = d;
      // Convert back to lng/lat at the midLat used for projection.
      bestPt = { lng: fx / (cosLat * M_PER_DEG), lat: fy / M_PER_DEG };
    }
  }
  return { point: bestPt, distM: bestD };
}

/** Cheap content hash for a stroke (id excluded — points only). */
function strokeFingerprint(stroke: BrushStroke): string {
  const pts = stroke.points;
  if (pts.length === 0) return 'empty';
  const first = pts[0];
  const last = pts[pts.length - 1];
  // Sample 5 evenly spaced indices for fingerprint stability across
  // erase-split or appendStrokePoint events.
  let mid = '';
  if (pts.length >= 5) {
    for (let k = 1; k < 4; k++) {
      const idx = Math.floor((k * pts.length) / 4);
      const p = pts[idx];
      mid += `_${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
    }
  }
  return `${pts.length}_${first.lng.toFixed(5)},${first.lat.toFixed(5)}_${last.lng.toFixed(5)},${last.lat.toFixed(5)}${mid}`;
}

/** v247: per-stroke session cache keyed by fingerprint. */
const strokeSnapCache = new Map<string, LngLat[]>();
function clearStrokeSnapCache(): void { strokeSnapCache.clear(); }

/** Cumulative arc-length on originalPoints. */
function cumulativeArc(coords: LngLat[]): number[] {
  const arc = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length; i++) {
    arc[i] = arc[i - 1] + haversineMetersLocal(coords[i - 1], coords[i]);
  }
  return arc;
}

/**
 * Validate brush strokes:
 *   - each stroke endpoints within ENDPOINT_SNAP_M of originalPoints
 *   - no stroke point >= CORRIDOR_RADIUS_M (i.e. red segments)
 *   - stroke arc-ranges on originalPoints don't overlap
 * Returns array of error strings (empty when valid).
 */
export interface ValidatedStroke {
  stroke: BrushStroke;
  arcStart: number;
  arcEnd: number;
}
export function validateStrokes(
  strokes: BrushStroke[],
  originalPoints: LngLat[],
  walkedIndex: PointCloudIndex | null,
): { ok: boolean; errors: string[]; validated: ValidatedStroke[] } {
  const errors: string[] = [];
  const validated: ValidatedStroke[] = [];
  if (originalPoints.length < 2 || !walkedIndex) {
    return { ok: false, errors: ['Original route data missing.'], validated: [] };
  }
  const arc = cumulativeArc(originalPoints);
  let strokeNum = 0;
  for (const s of strokes) {
    strokeNum++;
    if (s.points.length < 2) continue; // skip empty stroke silently

    // v253 fix: Endpoint check matches the runtime check used by
    // beginStroke/endStroke — accepts a point that is within
    // ENDPOINT_SNAP_M of the matched line OR of any OTHER stroke's
    // points. Previously this used walkedIndex only, which rejected
    // a stroke whose end attached to a previous stroke (eraser-split
    // case PO reported). otherStrokes excludes the stroke being
    // validated so its own points can't trivially satisfy the check.
    const otherStrokes = strokes.filter(o => o.id !== s.id);
    const startOk = isPointAcceptableEndpoint(s.points[0], walkedIndex, otherStrokes);
    const endOk = isPointAcceptableEndpoint(s.points[s.points.length - 1], walkedIndex, otherStrokes);
    if (!startOk) {
      errors.push(`Brush ${strokeNum}: start is not on the route or an existing stroke — connect or erase.`);
      continue;
    }
    if (!endOk) {
      errors.push(`Brush ${strokeNum}: end is not on the route or an existing stroke — connect or erase.`);
      continue;
    }
    // v255: anti chain-drift. At least ONE endpoint must be on the
    // baseline directly (not via another stroke). Prevents the multi-
    // stroke drift loophole that produced PO route "1"'s 267m diagonal.
    if (!strokeAnchorsToBaseline(s, walkedIndex)) {
      errors.push(`Brush ${strokeNum}: one end must be on the route — too far from baseline.`);
      continue;
    }

    // Red point check.
    let hasRed = false;
    for (const p of s.points) {
      const d = distanceToOriginalM(p, walkedIndex);
      if (d >= CORRIDOR_RADIUS_M) { hasRed = true; break; }
    }
    if (hasRed) {
      errors.push(`Brush ${strokeNum}: parts are beyond ${CORRIDOR_RADIUS_M}m — erase the red sections.`);
      continue;
    }

    // arc-range on original (sub-vertex precision).
    // v260 R-B fix: must use the SAME arc-projection math BCEF uses
    // downstream in spliceBCEF. The old `nearestOriginalIdx + arc[idx]`
    // returned vertex-arc (snapped to nearest baseline vertex), which can
    // disagree with `projectPointOntoBaseline`'s lerp-arc by up to one
    // segment (5-50m). Two strokes that pass overlap-check on vertex-arc
    // could overlap on lerp-arc and get silently dropped by spliceBCEF
    // (or vice versa: vertex-arc says overlap but lerp-arc says fine,
    // user erroneously sees "Two brush strokes overlap"). Unify here.
    const projA = projectPointOntoBaseline(s.points[0], originalPoints);
    const projB = projectPointOntoBaseline(s.points[s.points.length - 1], originalPoints);
    if (!projA || !projB) continue; // shouldn't happen if originalPoints.length>=2
    const arcA = Math.min(projA.arc, projB.arc);
    const arcB = Math.max(projA.arc, projB.arc);
    validated.push({ stroke: s, arcStart: arcA, arcEnd: arcB });
  }
  // Overlap check.
  validated.sort((a, b) => a.arcStart - b.arcStart);
  for (let i = 1; i < validated.length; i++) {
    if (validated[i].arcStart < validated[i - 1].arcEnd) {
      errors.push('Two brush strokes overlap on the route — erase one.');
      break;
    }
  }
  return { ok: errors.length === 0, errors, validated };
}

// ============================================================================
// v260 BCEF — replace spliceMatched anchor-replace with direct Mapbox curve.
//
// PO direction (2026-06-15): retest of v259 4-route showed 22m "small tail"
// (case 22), 79-260m suspicious_flatten on multi-stroke (cases 33/44/55), and
// confirmed root cause via diag log: spliceMatched's [startPt, ...slice(1,-1),
// endPt] anchor-replacement destroys Mapbox geometry at boundaries. Even after
// v259 follow-up (re-projecting using snap[0]/snap[last]), 22m gap persisted
// because Mapbox snap[0] is on a road centerline that may sit 5-22m off the
// baseline polyline (different OSM edge than baseline GPS samples).
//
// Spike validated (C:/temp/spike_bcef_v2.py + 5-case PNG):
//   C1 single small offset: ✅ snaps clean to baseline
//   C2 single large offset: ✅ Mapbox bounces back to legal road
//   C3 two separate strokes: ✅ each handled independently
//   C5 stroke beyond 250m corridor: ✅ rejected (corridor gate works)
//
// New flow:
//   1. Each stroke's brush start/end projects onto baseline → (B, C, arcB, arcC)
//   2. Corridor gate: every brush point must be ≤ CORRIDOR_M of baseline.
//      Brush stroke entirely beyond corridor = reject (no editing in dashed
//      preview area, only solid baseline area).
//   3. Loop gate: hav(B,C) < LOOP_MIN_M = 5m → reject (Mapbox can't match
//      a closed curve, and "U-turn brush" is rare; PO accepted "split into
//      two strokes" UX).
//   4. Send Mapbox [B, ...brushSimplified, C]. B/C are baseline real points;
//      Mapbox HMM sees real road anchors at both ends → returns a continuous
//      curve [B', curve, C'] where B'≈B (within OSM-snap tolerance).
//   5. Splice = baseline-up-to-min(arcB,arcC) + curve(reversed if reverse-drawn)
//      + baseline-after-max(arcB,arcC). NO more anchor replacement.
// ============================================================================

// v261: BCEF primitives moved to ./brush/bcef.ts so the self-test harness
// (scripts/brush_self_test.ts) can import the same code production runs
// without dragging in zustand + AsyncStorage. Behavior unchanged.
import {
  CORRIDOR_M,
  LOOP_MIN_M,
  projectPointOntoBaseline,
  strokeWithinCorridor,
  spliceBCEF,
  baselineSlice,
  type BcefItem,
} from './brush/bcef';

/**
 * Splice snapped polyline back into originalPoints over [arcStart, arcEnd].
 *
 * v249: smooth-join rewrite. Previously this used vertex-snapped arcStart
 * and concatenated raw segments, leaving a 5-20m kink at each splice
 * boundary because Mapbox snap output and original GPS samples don't
 * align. Now we:
 *   1. Project each stroke endpoint onto the nearest segment of the
 *      original polyline (sub-vertex precision).
 *   2. Replace snapped[0] / snapped[last] with the projected anchor —
 *      pulls the Mapbox polyline's head/tail onto the original line.
 *   3. Synthesize a vertex at the exact arcStart / arcEnd on the original
 *      so the cut is at the projected point, not at the next/prev vertex.
 *   4. Concatenate originalUpToStart + snapped + originalAfterEnd.
 */
function projectStrokeEndsOntoOriginal(
  stroke: BrushStroke,
  originalPoints: LngLat[],
): { startPt: LngLat; endPt: LngLat; arcStart: number; arcEnd: number } | null {
  if (stroke.points.length < 1 || originalPoints.length < 2) return null;
  // Find which original segment the projection falls on; record cumulative
  // arc to that segment + the t fraction along the segment.
  function projectAndArc(coord: LngLat): { pt: LngLat; arc: number } {
    let bestArc = 0;
    let bestPt: LngLat = originalPoints[0];
    let bestD = Infinity;
    let acc = 0;
    for (let i = 1; i < originalPoints.length; i++) {
      const a = originalPoints[i - 1];
      const b = originalPoints[i];
      const segLen = haversineMetersLocal(a, b);
      const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
      const cosLat = Math.cos(midLat);
      const M_PER_DEG = 111000;
      const ax = a.lng * cosLat * M_PER_DEG;
      const ay = a.lat * M_PER_DEG;
      const bx = b.lng * cosLat * M_PER_DEG;
      const by = b.lat * M_PER_DEG;
      const px = coord.lng * cosLat * M_PER_DEG;
      const py = coord.lat * M_PER_DEG;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq < 1e-9 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      const fx = ax + t * dx;
      const fy = ay + t * dy;
      const d = Math.hypot(px - fx, py - fy);
      if (d < bestD) {
        bestD = d;
        bestPt = { lng: fx / (cosLat * M_PER_DEG), lat: fy / M_PER_DEG };
        bestArc = acc + t * segLen;
      }
      acc += segLen;
    }
    return { pt: bestPt, arc: bestArc };
  }
  const a = projectAndArc(stroke.points[0]);
  const b = projectAndArc(stroke.points[stroke.points.length - 1]);
  const arcStart = Math.min(a.arc, b.arc);
  const arcEnd = Math.max(a.arc, b.arc);
  // startPt corresponds to whichever projection is at the smaller arc.
  const startPt = a.arc <= b.arc ? a.pt : b.pt;
  const endPt = a.arc <= b.arc ? b.pt : a.pt;
  return { startPt, endPt, arcStart, arcEnd };
}

/** v249: clip originalPoints up to (but not past) targetArc, ending with
 *  a synthesized vertex exactly at targetArc. */
function originalUpTo(originalPoints: LngLat[], targetArc: number): LngLat[] {
  if (originalPoints.length < 2) return [];
  if (targetArc <= 0) return [];
  const out: LngLat[] = [];
  let acc = 0;
  for (let i = 1; i < originalPoints.length; i++) {
    const a = originalPoints[i - 1];
    const b = originalPoints[i];
    const segLen = haversineMetersLocal(a, b);
    const segEnd = acc + segLen;
    if (i === 1) out.push(a);
    if (segEnd >= targetArc) {
      const t = segLen > 0 ? (targetArc - acc) / segLen : 0;
      out.push(lerpLocal(a, b, t));
      return out;
    }
    out.push(b);
    acc = segEnd;
  }
  return out;
}

/** v249: clip originalPoints starting from targetArc onward, beginning
 *  with a synthesized vertex exactly at targetArc. */
function originalFrom(originalPoints: LngLat[], targetArc: number): LngLat[] {
  if (originalPoints.length < 2) return [];
  const out: LngLat[] = [];
  let acc = 0;
  let started = false;
  for (let i = 1; i < originalPoints.length; i++) {
    const a = originalPoints[i - 1];
    const b = originalPoints[i];
    const segLen = haversineMetersLocal(a, b);
    const segEnd = acc + segLen;
    if (!started) {
      if (segEnd >= targetArc) {
        const t = segLen > 0 ? (targetArc - acc) / segLen : 0;
        out.push(lerpLocal(a, b, t));
        if (segEnd > targetArc + 1e-6) out.push(b);
        started = true;
      }
    } else {
      out.push(b);
    }
    acc = segEnd;
  }
  return out;
}

function spliceMatched(
  originalPoints: LngLat[],
  validated: ValidatedStroke[],
  snappedPerStroke: LngLat[][],
): LngLat[] {
  if (validated.length === 0) return [...originalPoints];

  // v249: project each stroke's endpoints onto the original polyline at
  // sub-vertex precision, then sort by projected arcStart.
  //
  // v259 R-A/R-B follow-up: arcStart/arcEnd are computed from Mapbox's
  // snap[0]/snap[last] (real road nodes), NOT from the brush raw endpoints,
  // because the splice section now keeps Mapbox's geometry as-is. If we
  // clipped originalPoints at the raw projection but then started the snap
  // at Mapbox's road node, there'd be a 5-15m gap between the original
  // polyline lerp point and snap[0] (R-A "sub-10m kink", R-B "head jump").
  // Projecting snap endpoints onto originalPoints gives a clip point that
  // co-locates with Mapbox's anchor — the boundary is sub-2m smooth.
  type Item = { arcStart: number; arcEnd: number; startPt: LngLat; endPt: LngLat; snapped: LngLat[] };
  const items: Item[] = [];
  for (let i = 0; i < validated.length; i++) {
    const v = validated[i];
    const snap = snappedPerStroke[i];
    // Prefer Mapbox snap endpoints for projection. Fall back to brush raw
    // endpoints if snap is degenerate (length < 2 — guarded but defensive).
    const useSnapEndpoints = snap.length >= 2;
    const probeStart = useSnapEndpoints ? snap[0] : v.stroke.points[0];
    const probeEnd = useSnapEndpoints
      ? snap[snap.length - 1]
      : v.stroke.points[v.stroke.points.length - 1];
    const proj = projectStrokeEndsOntoOriginal(
      { ...v.stroke, points: [probeStart, probeEnd] },
      originalPoints,
    );
    if (!proj) {
      // Degenerate fallback: use vertex-arc range (old behavior).
      items.push({
        arcStart: v.arcStart,
        arcEnd: v.arcEnd,
        startPt: v.stroke.points[0],
        endPt: v.stroke.points[v.stroke.points.length - 1],
        snapped: snap,
      });
      continue;
    }
    items.push({
      arcStart: proj.arcStart,
      arcEnd: proj.arcEnd,
      startPt: proj.startPt,
      endPt: proj.endPt,
      snapped: snap,
    });
  }
  items.sort((a, b) => a.arcStart - b.arcStart);

  const out: LngLat[] = [];
  let lastTailArc = 0;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    // Append originalPoints from lastTailArc up to it.arcStart, with
    // synthesized vertex exactly at arcStart.
    if (k === 0) {
      const head = originalUpTo(originalPoints, it.arcStart);
      for (const p of head) out.push(p);
    } else {
      // Mid-section between previous splice's arcEnd and this arcStart.
      // Walk originalPoints in [lastTailArc, it.arcStart].
      // v259: lastTailArc = previous it.arcEnd = previous snap[last]'s
      // projection. Skipping mid[0] still removes a near-duplicate of the
      // previous snap[last]. it.arcStart = current snap[0]'s projection,
      // so the mid clipping ends co-located with current snap[0] for sub-2m
      // boundary smoothness. Same logic as v249 but anchored at Mapbox
      // endpoints instead of brush raw endpoints.
      const mid = originalFrom(originalPoints, lastTailArc);
      // mid starts with a synthesized vertex at lastTailArc (we already
      // pushed something at lastTailArc as the tail of the previous
      // snapped, so skip the first vertex of mid to avoid duplicate).
      let midClipped: LngLat[] = [];
      let acc = 0;
      for (let i = 0; i < mid.length; i++) {
        if (i === 0) continue; // skip duplicate of previous tail
        const a = mid[i - 1];
        const b = mid[i];
        const segLen = haversineMetersLocal(a, b);
        const segEndArcFromMid = acc + segLen;
        const segEndArcAbsolute = lastTailArc + segEndArcFromMid;
        if (segEndArcAbsolute >= it.arcStart) {
          const t = segLen > 0 ? (it.arcStart - lastTailArc - acc) / segLen : 0;
          midClipped.push(lerpLocal(a, b, t));
          break;
        }
        midClipped.push(b);
        acc = segEndArcFromMid;
      }
      for (const p of midClipped) out.push(p);
    }
    // v259 PO direction "穿楼直线" fix:
    // BEFORE: [it.startPt, ...it.snapped.slice(1, -1), it.endPt]
    //   - it.startPt / it.endPt = projection of brush RAW endpoints onto
    //     originalPoints. May sit several meters from where Mapbox's first/
    //     last snap point actually is.
    //   - slice(1, -1) drops Mapbox's actual endpoints.
    //   - When the projection point and snapped[1] are far apart, the
    //     implicit straight line connecting them crosses whatever is
    //     between (often a building) → user-reported "笔笔直斜线穿楼".
    //   - When Mapbox returns length=2, slice(1,-1) is empty → output is
    //     literally [startPt, endPt] = a 2-point straight line.
    //   - Real log evidence (route 3): Mapbox returned 16 pts conf=0.94,
    //     splice output had a 260m gap. Mapbox geometry was healthy; the
    //     splice step destroyed it.
    //
    // AFTER: keep Mapbox's polyline IN FULL. Snap ANCHOR is Mapbox's own
    // first/last point — they're real road nodes by construction. The
    // originalPoints prefix/suffix gets clipped at the arc closest to
    // those Mapbox endpoints (already projected as arcStart/arcEnd above
    // via projectStrokeEndsOntoOriginal). Result: no anchor-replacement
    // straight line, no slice(1,-1) flatten.
    //
    // Edge case it.snapped.length < 2: shouldn't happen post-G0.5 (which
    // requires Mapbox return ≥ 2 points), but if it does, we're better
    // off skipping the segment than emitting a synthetic 2-pt line. The
    // empty-array path makes that segment a no-op (out gets nothing
    // pushed for this stroke), and the next stroke's pre-section will
    // be picked up from the same lastTailArc → graceful degrade.
    if (it.snapped.length >= 2) {
      for (const p of it.snapped) out.push(p);
    }
    lastTailArc = it.arcEnd;
  }
  // Tail: append originalPoints from lastTailArc onward.
  // v259: lastTailArc was set to it.arcEnd which is now snap[last]'s
  // projection on originalPoints. tail[0] is the synthesized vertex at
  // that arc — co-locates with snap[last]. Skipping it avoids a sub-2m
  // duplicate, same intent as before but for a different anchor.
  const tail = originalFrom(originalPoints, lastTailArc);
  for (let i = 0; i < tail.length; i++) {
    if (i === 0) continue; // skip near-duplicate of last splice's snap[last]
    out.push(tail[i]);
  }
  // v250: Dedupe consecutive points within 0.5m of each other. The
  // boundary stitching above produces ~3 sub-meter duplicates per
  // stroke (head synth + startPt projection use different math; tail
  // synth + endPt projection same). PO test2 had 5 such duplicates.
  // They show up as zero-length segments + occasional render artifacts
  // and contribute to the "preview 不对" perception.
  // v6.3 plan §2.2: when dedupe drops a point, copy its `alt` onto the
  // surviving neighbor if the survivor lacks alt. Prevents systematic
  // alt loss at stitch boundaries (Mapbox snap segments have null alt
  // until queryTerrainElevation backfills, while original GPS points
  // keep their alt — naive dedupe would prefer the alt-less Mapbox point).
  if (out.length < 2) return out;
  const deduped: LngLat[] = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (haversineMetersLocal(prev, out[i]) > 0.5) {
      deduped.push(out[i]);
    } else if (prev.alt == null && out[i].alt != null) {
      // Same location, but `out[i]` carries alt the survivor is missing —
      // upgrade the survivor in place (mutating `deduped` is safe; we own
      // the array).
      deduped[deduped.length - 1] = { ...prev, alt: out[i].alt };
    }
  }
  // v252: spike de-spike pass. PO real-device showed a 17m "凸出来的点
  // / 尾巴" at a stroke-to-stroke splice boundary in t5: index 106 and
  // 108 were exact-equal points 8.6m apart from index 107. Pattern:
  // a → b → c with hav(a, c) < 1m AND hav(a, b) > 4m AND hav(b, c) > 4m
  // = b is a spurious there-and-back tip (mapbox snap or splice
  // artifact). Drop b.
  if (deduped.length < 3) return deduped;
  const despik: LngLat[] = [deduped[0], deduped[1]];
  for (let i = 2; i < deduped.length; i++) {
    const a = despik[despik.length - 2];
    const b = despik[despik.length - 1];
    const c = deduped[i];
    const ac = haversineMetersLocal(a, c);
    const ab = haversineMetersLocal(a, b);
    const bc = haversineMetersLocal(b, c);
    if (ac < 1 && ab > 4 && bc > 4) {
      // Replace b with c — drop the spike tip.
      despik[despik.length - 1] = c;
    } else {
      despik.push(c);
    }
  }
  return despik;
}

export const useRouteEditStore = create<EditState>((set, get) => ({
  sessionId: null,
  routeId: null,
  isOpen: false,
  editOpSeq: 0,
  originalPoints: [],
  matchedPoints: [],
  workingPoints: [],
  brushStrokes: [],
  trimStartFrac: 0,
  trimEndFrac: 1,
  activeTool: 'pan',
  activeStrokeId: null,
  hasCommittedEdit: false,
  previewMatchedPoints: null,
  previewIsCurrent: false,
  committedDraft: null,
  undoStack: [],
  walkedIndex: null,
  isComputing: false,
  lastError: null,
  lastWarning: null,
  validationErrors: [],
  enteredAtTs: null,
  editCount: 0,
  lastSaveAttemptFailed: false,
  isSaving: false,
  migratorRetry: null,
  pendingBeginArgs: null,

  async beginEdit(args) {
    const t0 = Date.now();
    const flags = getFlagsSync();
    if (!flags.editModeEnabled) {
      set({ lastError: 'Edit mode is disabled' });
      return;
    }
    const { routeId, routePoints, routeUpdatedAt, resumeFrom } = args;
    const initialOpSeq = get().editOpSeq;
    const fenceCheck = () => get().editOpSeq !== initialOpSeq;

    let extras = await loadExtras(routeId);
    if (fenceCheck()) return;
    let isLegacy = false;
    if (!extras) {
      isLegacy = true;
      const result: MigrationResult = await migrateRouteIfNeeded({ id: routeId, points: routePoints });
      if (fenceCheck()) return;
      if (!result.ok) {
        const failResult = result as Extract<MigrationResult, { ok: false }>;
        logMigratorFailure({ routeId, error: failResult.error, retry: failResult.retry });
        set({
          lastError: `Migration failed: ${failResult.error}`,
          migratorRetry: { error: failResult.error, retry: failResult.retry },
          pendingBeginArgs: failResult.retry ? args : null,
        });
        return;
      }
      extras = await loadExtras(routeId);
      if (fenceCheck()) return;
    }
    if (!extras) {
      logMigratorFailure({ routeId, error: 'extras null after migration', retry: true });
      set({
        lastError: 'Failed to load route extras',
        migratorRetry: { error: 'extras null after migration', retry: true },
        pendingBeginArgs: args,
      });
      return;
    }

    const fresherFromExtras =
      typeof routeUpdatedAt === 'number' &&
      typeof extras.updatedAt === 'number' &&
      extras.updatedAt > routeUpdatedAt;
    const baseFromExtras = (extras.workingPoints && extras.workingPoints.length >= 2)
      ? extras.workingPoints
      : extras.originalPoints;
    const baseGeometry: LngLat[] = resumeFrom
      ? resumeFrom.workingPoints
      : (fresherFromExtras ? baseFromExtras : routePoints);

    const sessionId = genSessionId();
    const enteredAtTs = resumeFrom?.enteredAt ?? t0;
    clearMatchCache();
    clearStrokeSnapCache();

    const originalPoints: LngLat[] = extras.originalPoints;
    const initialStrokes: BrushStroke[] = resumeFrom?.brushStrokes ?? [];
    const initialTrimStart = resumeFrom?.trimStartFrac ?? extras.trimStartFrac ?? 0;
    const initialTrimEnd = resumeFrom?.trimEndFrac ?? extras.trimEndFrac ?? 1;
    // v251: walkedIndex is the "current editable base" — used by endpoint
    // checks and brush color classification. When resuming from a draft
    // (or pre-Preview-committed extras with edited workingPoints),
    // baseGeometry differs from originalPoints, and the walkedIndex must
    // mirror baseGeometry so subsequent strokes can start on the
    // already-edited line, not only the original GPS.
    const walkedIndex = buildWalkedIndex(baseGeometry);

    set(s => ({
      sessionId,
      routeId,
      isOpen: true,
      editOpSeq: s.editOpSeq + 1,
      originalPoints,
      matchedPoints: [...baseGeometry],
      workingPoints: deriveWorking([...baseGeometry], initialTrimStart, initialTrimEnd),
      brushStrokes: initialStrokes,
      trimStartFrac: initialTrimStart,
      trimEndFrac: initialTrimEnd,
      activeTool: 'pan',
      activeStrokeId: null,
      // v251: hasCommittedEdit reflects whether user has run a successful
      // Preview in THIS session. resumeFrom (= committedDraft re-entry) means
      // a prior session already committed — preserve true.
      hasCommittedEdit: !!resumeFrom,
      previewMatchedPoints: null,
      // If no strokes on entry, preview is trivially "current" (original
      // route IS the preview), so Save is enabled immediately.
      previewIsCurrent: initialStrokes.length === 0,
      undoStack: [],
      walkedIndex,
      isComputing: false,
      lastError: null,
      lastWarning: null,
      validationErrors: [],
      enteredAtTs,
      editCount: 0,
      lastSaveAttemptFailed: false,
      isSaving: false,
      migratorRetry: null,
      pendingBeginArgs: null,
    }));

    persistSession(get(), sessionId);

    logEditEntered({
      routeId,
      trackPointCount: routePoints.length,
      hasOriginalPoints: !isLegacy,
      isLegacy,
    });
    logEditStartDuration({ ms: Date.now() - t0 });
  },

  async retryMigration() {
    const state = get();
    if (!state.migratorRetry || !state.pendingBeginArgs) return;
    const args = state.pendingBeginArgs;
    set({ migratorRetry: null });
    await get().beginEdit(args);
  },

  skipMigration() {
    set({
      migratorRetry: null,
      pendingBeginArgs: null,
      lastError: 'Migration skipped — edit disabled for this route',
    });
    chainSessionWrite(() => clearSession()).catch(() => {});
  },

  setActiveTool(tool) {
    set(s => ({ activeTool: tool, editOpSeq: s.editOpSeq + 1 }));
  },

  beginStroke(firstPoint) {
    const state = get();
    if (state.isSaving) return null;
    if (state.brushStrokes.length >= MAX_STROKES) {
      const msg = `Max ${MAX_STROKES} brush strokes reached`;
      set({ lastError: msg });
      setTimeout(() => {
        const live = get();
        if (live.lastError === msg) set({ lastError: null });
      }, LAST_ERROR_AUTO_CLEAR_MS);
      return null;
    }
    // v251: endpoint check — must be within 50m of current matched line
    // OR any existing brush stroke. Lets the user continue from a
    // previous stroke's end without going back to the original line.
    if (!isPointAcceptableEndpoint(firstPoint, state.walkedIndex, state.brushStrokes)) {
      set({ lastError: 'Brush must start on the route or an existing stroke' });
      setTimeout(() => {
        const live = get();
        if (live.lastError === 'Brush must start on the route or an existing stroke') {
          set({ lastError: null });
        }
      }, LAST_ERROR_AUTO_CLEAR_MS);
      return null;
    }
    const id = genStrokeId();
    set(s => ({
      undoStack: [...s.undoStack, {
        brushStrokes: s.brushStrokes,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
      brushStrokes: [...s.brushStrokes, { id, points: [firstPoint] }],
      activeStrokeId: id,
      previewIsCurrent: false,
      editOpSeq: s.editOpSeq + 1,
      lastError: null,
      // v255: clear sticky warning from a prior Preview so a fresh
      // stroke doesn't appear to have triggered an old toast.
      lastWarning: null,
    }));
    return id;
  },

  appendStrokePoint(strokeId, point) {
    set(s => {
      const idx = s.brushStrokes.findIndex(st => st.id === strokeId);
      if (idx < 0) return s;
      const stroke = s.brushStrokes[idx];
      const last = stroke.points[stroke.points.length - 1];
      // Skip points too close to the last (downsample to ~5m).
      if (last && haversineMetersLocal(last, point) < 5) return s;
      const updated = { ...stroke, points: [...stroke.points, point] };
      const newStrokes = [...s.brushStrokes];
      newStrokes[idx] = updated;
      // v249: do NOT bump editOpSeq here. Per-frame bump caused the entire
      // RouteEditorScreen subtree to re-render on every 5m gesture move,
      // which compounded as a second stroke grew alongside a finalized
      // first stroke (BrushStrokeLayer rebuilt every stroke's features
      // every frame). beginStroke / endStroke still bump it.
      return { ...s, brushStrokes: newStrokes, previewIsCurrent: false };
    });
  },

  endStroke(strokeId) {
    // v247: endpoint magnetism — when stroke ends, snap first and last
    // point onto the nearest segment of the base line (within 50m).
    // This eliminates the "Mapbox routes via a side street near the
    // imprecise endpoint" hook artifact PO reported.
    // v261: validation + magnetism target = state.originalPoints (NOT
    // matchedPoints). matchedPoints accumulates Mapbox snap drift after
    // each Preview; if magnetism uses it, a stroke endpoint can be
    // pulled to a "ghost" location near a previously-snapped vertex
    // that is no longer on a real road. PO snap "尖角不是我画的是
    // 磁吸过去的" was traced (subagent + reset/undo audit) to two
    // sources both reading matchedPoints: endStroke magnetism + undo's
    // walkedIndex rebuild. v261 anchors all three (corridor, projection,
    // magnetism) to originalPoints so the brush-edit reference frame
    // never drifts no matter how many Preview rounds happened.
    const state = get();
    const idx = state.brushStrokes.findIndex(s => s.id === strokeId);
    if (idx < 0) {
      set(s => ({ ...s, editCount: s.editCount + 1, editOpSeq: s.editOpSeq + 1, activeStrokeId: null }));
      persistSession(get(), get().sessionId ?? undefined);
      return;
    }
    const stroke = state.brushStrokes[idx];
    const baseLine = state.originalPoints;
    // Build the brushStrokes list MINUS the stroke being ended (so the
    // endpoint check doesn't trivially pass via the stroke's own points).
    const otherStrokes = state.brushStrokes.filter((_, i) => i !== idx);
    const lastPt = stroke.points[stroke.points.length - 1];

    // Endpoint check on END only (start was already validated by beginStroke).
    if (stroke.points.length < 2 ||
        !isPointAcceptableEndpoint(lastPt, state.walkedIndex, otherStrokes)) {
      // Discard this stroke entirely. Toast + auto-dismiss.
      set(s => ({
        ...s,
        brushStrokes: otherStrokes,
        activeStrokeId: null,
        editOpSeq: s.editOpSeq + 1,
        lastError: 'End on the route or an existing brush stroke',
      }));
      setTimeout(() => {
        const live = get();
        if (live.lastError === 'End on the route or an existing brush stroke') {
          set({ lastError: null });
        }
      }, LAST_ERROR_AUTO_CLEAR_MS);
      persistSession(get(), get().sessionId ?? undefined);
      return;
    }

    // v255: anti chain-drift. Stroke must anchor to baseline at LEAST
    // one end. Without this, two strokes drawn 100m off-route mutually
    // validate each other and form a long diagonal across buildings
    // (PO route "1" 267m straight line). The check uses the strict
    // baseline distance — `isPointAcceptableEndpoint` is too permissive
    // for this purpose because it accepts other-stroke proximity.
    const firstPt = stroke.points[0];
    const anchorsToBaseline = isPointOnBaseline(firstPt, state.walkedIndex)
      || isPointOnBaseline(lastPt, state.walkedIndex);
    if (!anchorsToBaseline) {
      set(s => ({
        ...s,
        brushStrokes: otherStrokes,
        activeStrokeId: null,
        editOpSeq: s.editOpSeq + 1,
        lastError: 'One end must be on the route — chain drifted too far',
      }));
      setTimeout(() => {
        const live = get();
        if (live.lastError === 'One end must be on the route — chain drifted too far') {
          set({ lastError: null });
        }
      }, LAST_ERROR_AUTO_CLEAR_MS);
      persistSession(get(), get().sessionId ?? undefined);
      return;
    }

    // v261: restore endpoint magnetism, but anchor to state.originalPoints
    // (NOT matchedPoints — see comment above). PO clarified the original
    // intent: magnetism is essential for "last connection back to baseline"
    // — without it BCEF's projB/projC sit far off baseline when the user's
    // raw fingertip stops 5-30m before reaching the line, breaking Mapbox
    // input shape. Diagnostic finding: previous magnetism used a drifted
    // matchedPoints baseline that could pull endpoints to wrong roads.
    // Anchored to originalPoints, magnetism is stable across Preview
    // rounds.
    if (stroke.points.length >= 3 && baseLine.length >= 2) {
      const first = projectOntoOriginalSegment(stroke.points[0], baseLine);
      const last = projectOntoOriginalSegment(
        stroke.points[stroke.points.length - 1],
        baseLine,
      );
      const newPoints = [...stroke.points];
      if (first.distM <= ENDPOINT_SNAP_M) newPoints[0] = first.point;
      if (last.distM <= ENDPOINT_SNAP_M) newPoints[newPoints.length - 1] = last.point;
      const newStrokes = [...state.brushStrokes];
      newStrokes[idx] = { ...stroke, points: newPoints };
      set(s => ({
        ...s,
        brushStrokes: newStrokes,
        activeStrokeId: null,
        previewIsCurrent: false,
        editCount: s.editCount + 1,
        editOpSeq: s.editOpSeq + 1,
      }));
    } else {
      set(s => ({ ...s, activeStrokeId: null, editCount: s.editCount + 1, editOpSeq: s.editOpSeq + 1 }));
    }
    persistSession(get(), get().sessionId ?? undefined);
  },

  eraseAt(coord, radiusM = 25) {
    const state = get();
    if (state.isSaving) return;
    let mutated = false;
    // v245-blocker-fix: when erase removes a middle point, split the
    // stroke into multiple sub-strokes (each contiguous run of kept
    // points becomes its own stroke). Without this, a U-shaped stroke
    // whose bottom is erased becomes one polyline with a teleport gap.
    const newStrokes: BrushStroke[] = [];
    for (const s of state.brushStrokes) {
      // Walk points; build runs where each point passes the radius gate.
      const runs: LngLat[][] = [];
      let current: LngLat[] = [];
      for (const p of s.points) {
        const d = haversineMetersLocal(coord, p);
        if (d > radiusM) {
          current.push(p);
        } else {
          mutated = true;
          if (current.length > 0) {
            runs.push(current);
            current = [];
          }
        }
      }
      if (current.length > 0) runs.push(current);

      if (runs.length === 1 && runs[0].length === s.points.length) {
        // No erase touched this stroke — keep id stable.
        newStrokes.push(s);
        continue;
      }
      // Emit each run >= 2 points as its own stroke; drop runs < 2.
      for (const run of runs) {
        if (run.length >= 2) {
          newStrokes.push({ id: genStrokeId(), points: run });
        } else if (run.length === 1) {
          mutated = true;
        }
      }
    }
    if (!mutated) return;
    set(prev => ({
      undoStack: [...prev.undoStack, {
        brushStrokes: prev.brushStrokes,
        trimStartFrac: prev.trimStartFrac,
        trimEndFrac: prev.trimEndFrac,
        matchedPoints: prev.matchedPoints,
      }].slice(-20),
      brushStrokes: newStrokes,
      previewIsCurrent: false,
      editOpSeq: prev.editOpSeq + 1,
      editCount: prev.editCount + 1,
    }));
    persistSession(get(), get().sessionId ?? undefined);
  },

  removeStroke(strokeId) {
    const state = get();
    if (state.isSaving) return;
    const exists = state.brushStrokes.some(s => s.id === strokeId);
    if (!exists) return;
    set(prev => ({
      undoStack: [...prev.undoStack, {
        brushStrokes: prev.brushStrokes,
        trimStartFrac: prev.trimStartFrac,
        trimEndFrac: prev.trimEndFrac,
        matchedPoints: prev.matchedPoints,
      }].slice(-20),
      brushStrokes: prev.brushStrokes.filter(s => s.id !== strokeId),
      previewIsCurrent: false,
      editOpSeq: prev.editOpSeq + 1,
      editCount: prev.editCount + 1,
    }));
    persistSession(get(), get().sessionId ?? undefined);
  },

  beginTrimDrag() {
    const state = get();
    if (state.isSaving || state.isComputing) return;
    set(s => ({
      undoStack: [...s.undoStack, {
        brushStrokes: s.brushStrokes,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
    }));
  },

  setTrimStart(frac) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    const startSid = state.sessionId ?? undefined;
    let nf = Math.max(0, Math.min(1, frac));
    if (state.trimEndFrac - nf < TRIM_MIN_FRACTION) {
      nf = Math.max(0, state.trimEndFrac - TRIM_MIN_FRACTION);
    }
    set(s => ({
      trimStartFrac: nf,
      workingPoints: deriveWorking(s.matchedPoints, nf, s.trimEndFrac),
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    logTrimApplied({ trimmedDistanceM: 0, side: 'start' });
    persistSession(get(), startSid);
  },

  setTrimEnd(frac) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    const startSid = state.sessionId ?? undefined;
    let nf = Math.max(0, Math.min(1, frac));
    if (nf - state.trimStartFrac < TRIM_MIN_FRACTION) {
      nf = Math.min(1, state.trimStartFrac + TRIM_MIN_FRACTION);
    }
    set(s => ({
      trimEndFrac: nf,
      workingPoints: deriveWorking(s.matchedPoints, s.trimStartFrac, nf),
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    logTrimApplied({ trimmedDistanceM: 0, side: 'end' });
    persistSession(get(), startSid);
  },

  resetEdits() {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    if (state.isComputing) return;
    // v255 fix: previously resetEdits only reset matchedPoints/working/
    // strokes/trim but LEFT walkedIndex pointing at the previously-
    // committed (post-edit) line, AND left hasCommittedEdit/strokeSnapCache/
    // lastWarning untouched. Result: after Reset, isPointAcceptableEndpoint
    // still accepted points near the old committed (e.g. building-cutting)
    // line because walkedIndex hadn't been rebuilt from originalPoints.
    // PO snap122: "我 reset 了 随便画了一条 开头没在线上 他也认可了
    // 我估计 reset 的只是界面 底层没 reset". Confirmed.
    const newWalkedIndex = state.originalPoints.length >= 2
      ? new PointCloudIndex(
          state.originalPoints.map((p, i) => ({
            lng: p.lng,
            lat: p.lat,
            source: 'original' as const,
            refId: `original:${i}`,
          })),
        )
      : state.walkedIndex;
    clearStrokeSnapCache();
    set(s => ({
      undoStack: [...s.undoStack, {
        brushStrokes: s.brushStrokes,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
      brushStrokes: [],
      trimStartFrac: 0,
      trimEndFrac: 1,
      matchedPoints: [...s.originalPoints],
      workingPoints: [...s.originalPoints],
      previewMatchedPoints: null,
      previewIsCurrent: true,
      validationErrors: [],
      walkedIndex: newWalkedIndex,
      hasCommittedEdit: false,
      activeStrokeId: null,
      lastWarning: null,
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    persistSession(get(), get().sessionId ?? undefined);
  },

  canUndo() {
    return get().undoStack.length > 0;
  },

  undo() {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    if (state.isComputing) {
      set({ lastError: 'Computing — please wait' });
      return;
    }
    const stack = state.undoStack;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    const newStack = stack.slice(0, -1);
    const noBrushAfter = last.brushStrokes.length === 0;
    // v6.3 plan §3 bug #1: rebuild walkedIndex around the restored matched
    // line. Pre-v6.3 undo left walkedIndex pointing at the post-edit line,
    // so endpoint-snap and corridor checks ran against stale geometry. The
    // PO snap122 incident ("reset 了…开头没在线上他也认可了") was the same
    // class of bug; we fix it for undo here.
    // v261 fix: rebuild walkedIndex from state.originalPoints, NOT
    // last.matchedPoints. Pre-v261 this used last.matchedPoints which is
    // the post-Preview drifted baseline — undo would restore the matched
    // geometry (correct for rendering) but the *index* used for endpoint
    // snap / corridor checks pointed at a Mapbox-snapped frame that
    // could be 5-22m off real roads. Result: subsequent strokes got
    // magnetized to "ghost" baseline positions → "尖角不是我画的". With
    // walkedIndex anchored to originalPoints, all spatial gates remain
    // stable across any number of undo/redo rounds.
    const restoredMatched = last.matchedPoints;
    const restoredWalkedIndex = state.originalPoints.length >= 2
      ? new PointCloudIndex(
          state.originalPoints.map((p, i) => ({
            lng: p.lng,
            lat: p.lat,
            source: 'original' as const,
            refId: `original:${i}`,
          })),
        )
      : state.walkedIndex;
    set(s => ({
      undoStack: newStack,
      brushStrokes: last.brushStrokes,
      trimStartFrac: last.trimStartFrac,
      trimEndFrac: last.trimEndFrac,
      matchedPoints: last.matchedPoints,
      workingPoints: deriveWorking(last.matchedPoints, last.trimStartFrac, last.trimEndFrac),
      walkedIndex: restoredWalkedIndex,
      // Plan §3 bug #5: clear sticky lastWarning + activeStrokeId on undo so
      // the Edit overlay doesn't carry residue from the undone op.
      lastWarning: null,
      activeStrokeId: null,
      previewMatchedPoints: null,
      // No brushes => nothing to preview => save can proceed.
      previewIsCurrent: noBrushAfter,
      validationErrors: [],
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    sendEditDiag('brush_undo', {
      undo_stack_depth: newStack.length,
    });
    persistSession(get(), get().sessionId ?? undefined);
  },

  setLastError(error) {
    set({ lastError: error });
  },

  detachUI() {
    const state = get();
    if (!state.isOpen) return;
    if (state.isSaving) return;
    const cancelledId = state.sessionId;
    set(s => ({
      isOpen: false,
      isComputing: false,
      sessionId: null,
      editOpSeq: s.editOpSeq + 1,
    }));
    if (cancelledId) {
      recentlyCancelledSessions.add(cancelledId);
      setTimeout(() => recentlyCancelledSessions.delete(cancelledId), 30_000);
      chainSessionWrite(() => clearSession())
        .catch(() => {})
        .finally(() => recentlyCancelledSessions.delete(cancelledId));
    } else {
      chainSessionWrite(() => clearSession()).catch(() => {});
    }
  },

  applyMatchedAltitudes(altitudes) {
    const state = get();
    const mp = state.matchedPoints;
    if (mp.length === 0 || mp.length !== altitudes.length) return;
    let nullCount = 0;
    let totalCount = 0;
    const next: LngLat[] = mp.map((p, i) => {
      totalCount += 1;
      const resolved = altitudes[i];
      // Only OVERWRITE when the existing alt is null/undefined and we got a
      // real number. Real GPS-sourced altitudes (positive numbers from the
      // original track) are preserved untouched.
      if (resolved == null) {
        if (p.alt == null) nullCount += 1;
        return p;
      }
      if (p.alt != null) return p; // keep authoritative value
      return { ...p, alt: resolved };
    });
    set(s => ({
      matchedPoints: next,
      workingPoints: deriveWorking(next, s.trimStartFrac, s.trimEndFrac),
    }));
    if (nullCount > 0) {
      sendEditDiag('brush_alt_dem_null', {
        points_with_null_alt: nullCount,
        total_points: totalCount,
      });
    }
  },

  async runPreview() {
    const state = get();
    if (state.isSaving) return { ok: false, error: 'Save in progress' };
    if (state.isComputing) return { ok: false, error: 'Already computing' };

    // No brushes → preview = current matched (or original if pristine).
    // Trim is applied client-side. v251: previewIsCurrent only matters
    // for the "Preview first" gating; with brushStrokes=[] we are
    // already in committed state.
    if (state.brushStrokes.length === 0) {
      const base = state.matchedPoints.length >= 2 ? state.matchedPoints : state.originalPoints;
      set(s => ({
        previewMatchedPoints: null,
        previewIsCurrent: true,
        matchedPoints: [...base],
        workingPoints: deriveWorking([...base], s.trimStartFrac, s.trimEndFrac),
        validationErrors: [],
        editOpSeq: s.editOpSeq + 1,
      }));
      return { ok: true };
    }

    // v6.3: pre-flight strokes via the new G-gate pipeline. validateStrokes
    // remains as the authoritative pre-Mapbox anchor / corridor / chain check
    // (it covers G1 and several geometric sanity checks); the new gates
    // (G0 / G0_post_simplify / G0.5 / G3 corridor) are applied per-stroke.
    //
    // v261: BCEF baseline is ALWAYS state.originalPoints, never matchedPoints.
    // Previously baseLine = matchedPoints || originalPoints, but corridor
    // gate (added in v260) used originalPoints — inconsistency caused B/C
    // projections to drift after each Preview as matchedPoints accumulated
    // OSM-snap noise. PO lock-in: brush forever orbits the original baseline,
    // not the post-edit composite. R-A and splice-diag subagents both
    // identified this as the splice-gap-240m root cause on case 三/四 retest.
    const baseLine = state.originalPoints;
    const v = validateStrokes(state.brushStrokes, baseLine, state.walkedIndex);
    if (!v.ok) {
      set({ validationErrors: v.errors, lastError: v.errors[0] ?? 'Invalid brush strokes.' });
      return { ok: false, error: v.errors[0] ?? 'invalid-brushes' };
    }
    set({ validationErrors: [], isComputing: true, lastError: null });

    const startSid = state.sessionId;
    const startSeq = get().editOpSeq;
    const previewT0 = Date.now();
    sendEditDiag('brush_preview_started', {
      stroke_count: state.brushStrokes.length,
    });

    // v6.3 plan §1.2 / R3 C3: external AbortController fed to matchSegment
    // so hardware-back / app-background can immediately cancel an in-flight
    // Mapbox HTTP request. Aborting wakes the awaiter with reason 'aborted',
    // saves Mapbox quota, and lets the fence check return cleanly.
    const previewAbort = new AbortController();

    // v6.3 plan §1.2 / §1.6 / R1v3: capture fence + finally contract for
    // multi-stroke serial calls. Any abort path must clear isComputing.
    const fenceTriggered = (): boolean => {
      const live = get();
      const tripped = live.sessionId !== startSid || live.editOpSeq !== startSeq;
      if (tripped && !previewAbort.signal.aborted) {
        // R3 C3: fence trip → also abort the in-flight HTTP so we don't
        // burn quota on an answer the user already navigated away from.
        previewAbort.abort();
      }
      return tripped;
    };

    try {
      const snappedPerStroke: LngLat[][] = [];
      // v260 BCEF: parallel array of {arcB, arcC, curve}. Same length as
      // snappedPerStroke / acceptedValidated. spliceBCEF takes this directly.
      const bcefItems: BcefItem[] = [];
      const acceptedValidated: ValidatedStroke[] = [];
      const rejectedStrokeIds: string[] = [];
      let firstRejectReason: string | null = null;

      for (let strokeIdx = 0; strokeIdx < v.validated.length; strokeIdx++) {
        const vs = v.validated[strokeIdx];
        // Fence check before each stroke (multi-stroke can take seconds total).
        if (fenceTriggered()) return { ok: false, error: 'state-changed' };

        const pts = vs.stroke.points;
        // v260: cache disabled. The cache stored Mapbox snap geometry but
        // not arcB/arcC; reusing it requires re-projecting B/C anyway, at
        // which point we may as well re-call Mapbox (B/C input changes
        // baseline-anchor behavior). Future: store {arcB, arcC, curve} in
        // the cache key together if we observe noticeable redraw cost.
        // const fp = strokeFingerprint(vs.stroke);
        // const cached = strokeSnapCache.get(fp);
        // if (cached) { ... }
        const fp = strokeFingerprint(vs.stroke);

        // G0 — preflight (rejects 1-vertex tap, > MAX_STROKE_VERTICES_INPUT).
        const g0 = checkG0(pts);
        if (!g0.ok) {
          rejectedStrokeIds.push(vs.stroke.id);
          // Plan §4.5: short, product-friendly Chinese reject copy.
          firstRejectReason ??= '画笔太短或太长';
          sendEditDiag('brush_gate_failure', {
            gate: g0.gate,
            reason: g0.reason,
            stroke_idx: strokeIdx,
            stroke_vertex_count: pts.length,
            metric_value: g0.metric_value,
            threshold: g0.threshold,
          });
          continue;
        }

        // Pre-call simplify (Douglas-Peucker ladder + uniform fallback).
        // Replaces v252's hand-rolled rdpSimplify + fixed 96-cap pipeline.
        const simRes = simplifyStroke(pts);
        if (simRes.reason === 'rejected_too_long') {
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??= '画笔太长';
          sendEditDiag('brush_gate_failure', {
            gate: 'G0',
            reason: 'too_long',
            stroke_idx: strokeIdx,
            stroke_vertex_count: pts.length,
            metric_value: pts.length,
            threshold: null,
          });
          continue;
        }

        // G0_post_simplify — DP at high ε can collapse to 1 point on tight strokes.
        const g0p = checkG0PostSimplify(simRes.points);
        if (!g0p.ok) {
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??= '画笔形状无效';
          sendEditDiag('brush_gate_failure', {
            gate: g0p.gate,
            reason: g0p.reason,
            stroke_idx: strokeIdx,
            stroke_vertex_count: pts.length,
            metric_value: g0p.metric_value,
            threshold: g0p.threshold,
          });
          continue;
        }

        // v260 BCEF: project brush start/end onto baseline → B/C. Send
        // [B, ...brush, C] to Mapbox so HMM has real road anchors at both
        // endpoints. This eliminates the "Mapbox snap[0] sits 22m off
        // baseline → splice draws straight line through building" bug
        // (diag 248 case 22, diag 250/252 case 33/44).
        // PO rule: brush only allowed in solid 250m corridor of the
        // ORIGINAL baseline (state.originalPoints) — NEVER the post-Preview
        // matched baseline. Otherwise corridor center drifts after each
        // Preview as Mapbox snap shifts vertices ±10m, slowly inflating
        // the drawable area beyond what the user committed to. PO lock-in:
        // dashed preview-area is "doesn't exist", only solid original is.
        // R-A v260 review caught this — must use originalPoints.
        const corridor = strokeWithinCorridor(pts, state.originalPoints);
        if (!corridor.ok) {
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??= `画笔超出 ${CORRIDOR_M}m 范围,请贴近原路线`;
          sendEditDiag('brush_gate_failure', {
            gate: 'corridor_v260',
            reason: 'beyond_corridor',
            stroke_idx: strokeIdx,
            stroke_vertex_count: pts.length,
            metric_value: Math.round(corridor.maxDistM),
            threshold: CORRIDOR_M,
          });
          continue;
        }
        // Project brush time-start/end (NOT arc-min/max — preserve user
        // drawing direction so reverse-drawn strokes are handled correctly
        // by spliceBCEF's reverse flag).
        const projB = projectPointOntoBaseline(pts[0], baseLine);
        const projC = projectPointOntoBaseline(pts[pts.length - 1], baseLine);
        if (!projB || !projC) {
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??= '基准线无效';
          continue;
        }
        const B = projB.pt, C = projC.pt;
        // Loop gate: B==C means brush forms a closed loop. Mapbox /matching
        // can't reliably handle closed inputs; UX is "draw two strokes".
        if (haversineMetersLocal(B, C) < LOOP_MIN_M) {
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??= '一笔不能画回到起点 — 请分两笔';
          sendEditDiag('brush_gate_failure', {
            gate: 'loop_v260',
            reason: 'B_eq_C',
            stroke_idx: strokeIdx,
            stroke_vertex_count: pts.length,
            metric_value: Math.round(haversineMetersLocal(B, C)),
            threshold: LOOP_MIN_M,
          });
          continue;
        }

        // v260: send [B, simplified_brush_with_2_extra_slots, C] to Mapbox.
        // Mapbox cap = 100 coords. We need 2 slots for B/C, so brush gets
        // up to 98. Re-simplify if the original simRes hit exactly 100.
        const brushSlots = MAPBOX_MATCHING_MAX_COORDS - 2; // 98
        let bcefBrush: LngLat[];
        if (simRes.points.length <= brushSlots) {
          bcefBrush = simRes.points;
        } else {
          // Uniform-sample down to 98 to leave room for B and C.
          const step = (simRes.points.length - 1) / (brushSlots - 1);
          bcefBrush = [];
          for (let i = 0; i < brushSlots; i++) {
            bcefBrush.push(simRes.points[Math.min(simRes.points.length - 1, Math.round(i * step))]);
          }
        }
        const bcefInput: LngLat[] = [B, ...bcefBrush, C];
        const radiuses: (number | null)[] = bcefInput.map(() => null);
        const seg: MatchSegment = {
          coords: bcefInput,
          radiuses,
          viaIndicesInCoords: [],
        };

        let r;
        const mapboxT0 = Date.now();
        // v258 PO direction: capture FULL input picture so we can correlate
        // a "straight line through building" report with what we actually
        // sent Mapbox. Diagnoses input-side root cause (R-A) — DP-simplify
        // collapse vs. raw kept vs. wide radius giving HMM too much slack.
        sendEditDiag('brush_mapbox_attempt', {
          stroke_idx: strokeIdx,
          vertex_count: simRes.points.length,
          raw_vertex_count: pts.length,
          simplify_reason: simRes.reason,
          // First/last 3 coords identify the spatial region without bloating payload.
          input_first3: simRes.points.slice(0, 3).map(p => [p.lng, p.lat]),
          input_last3: simRes.points.slice(-3).map(p => [p.lng, p.lat]),
          // Max gap between consecutive simplified inputs — large gap means
          // DP threw away middle so we sent Mapbox a sparse skeleton.
          input_max_gap_m: (() => {
            let mx = 0;
            for (let i = 1; i < simRes.points.length; i++) {
              const a = simRes.points[i - 1], b = simRes.points[i];
              const d = haversineMetersLocal(a, b);
              if (d > mx) mx = d;
            }
            return Math.round(mx);
          })(),
        });
        try {
          r = await matchSegment(seg, { signal: previewAbort.signal });
        } catch (e: any) {
          // Defensive: matchSegment swallows almost every error itself.
          // Reaching here means an unhandled throw — treat as G2 fail.
          if (fenceTriggered()) return { ok: false, error: 'state-changed' };
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??= '未识别到这条路';
          sendEditDiag('brush_mapbox_error', {
            reason: 'throw',
            ms_to_error: Date.now() - mapboxT0,
          });
          continue;
        }

        // Fence after every Mapbox await — silent abort if user backed out.
        if (fenceTriggered()) return { ok: false, error: 'state-changed' };

        // G2 — Mapbox code === 'Ok'. NoMatch / network / 5xx / timeout all reject.
        if (!r.ok) {
          rejectedStrokeIds.push(vs.stroke.id);
          sendEditDiag('brush_mapbox_error', {
            reason: r.reason,
            ms_to_error: Date.now() - mapboxT0,
          });
          if (firstRejectReason === null) {
            switch (r.reason) {
              case 'no-match':
                firstRejectReason = '未识别到这条路';
                break;
              case 'timeout':
                firstRejectReason = '网络慢,请重试';
                break;
              case 'network':
              case 'rate-limit':
              case 'auth':
                firstRejectReason = '网络问题,请重试';
                break;
              case 'invalid-input':
                firstRejectReason = '画笔不符合要求';
                break;
              default:
                firstRejectReason = '未识别到这条路';
            }
          }
          continue;
        }

        // G0.5 — Mapbox returned Ok but geometry has < 2 points. Rare.
        const g05 = checkG0_5(r.matchedPoints);
        if (!g05.ok) {
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??= '未识别到这条路';
          sendEditDiag('brush_gate_failure', {
            gate: g05.gate,
            reason: g05.reason,
            stroke_idx: strokeIdx,
            stroke_vertex_count: pts.length,
            metric_value: g05.metric_value,
            threshold: g05.threshold,
          });
          continue;
        }

        // G3 — corridor: every snap point must be within 250m of the stroke.
        // Defends against the rare Mapbox-snaps-to-far-arterial case
        // (~0.5% urban per spike-corridor-100v).
        const g3 = checkG3({ stroke: pts, snap: r.matchedPoints });
        if (!g3.ok) {
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??= '画的太远了,试着贴近原路线';
          sendEditDiag('brush_gate_failure', {
            gate: g3.gate,
            reason: g3.reason,
            stroke_idx: strokeIdx,
            stroke_vertex_count: pts.length,
            metric_value: g3.metric_value,
            threshold: g3.threshold,
          });
          continue;
        }

        // v263: multi-matching stitch.
        // Mapbox /matching can split input into multiple matchings when the
        // mid-input deviates from roads (HMM cuts the trace). v260-v262 only
        // read matchings[0] (= r.matchedPoints) and dropped the segment
        // containing the end-anchor C, producing 300m+ splice gaps at the
        // curve→baseline-suffix seam. v263 reads ALL segments via
        // r.segments, filters confidence ≥ 0.3, sorts by min-arc, and
        // fills inter-segment baseline arc gaps with originalPoints
        // geometry. The result is a single contiguous curve passed to
        // spliceBCEF.
        // v264 fix: previously (v263) we filtered segments by confidence
        // ≥ 0.3 — but real-device retest (diag 270, route 2) showed
        // Mapbox returned m[0] conf=0.93 + m[2] conf < 0.3, so the
        // segment containing C-anchor got dropped → curve end stayed
        // 245m off C → 245m splice gap (= through-building line again).
        // The 0.3 threshold was too strict: even a low-conf segment
        // that touches C is better than no end-anchor at all. Output
        // corridor gate (300m) below catches truly bogus segments.
        // Effectively: trust all matchings Mapbox returned, the corridor
        // gate is the safety net.
        const allSegs = r.segments;
        if (allSegs.length === 0) {
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??= '未识别到这条路';
          sendEditDiag('brush_mapbox_error', {
            reason: 'all-segments-low-conf',
            ms_to_error: Date.now() - mapboxT0,
          });
          continue;
        }
        // Project each segment's first/last point onto originalPoints (=baseLine).
        const accepted = allSegs.map(s => {
          const first = projectPointOntoBaseline(s.points[0], baseLine);
          const last = projectPointOntoBaseline(s.points[s.points.length - 1], baseLine);
          return {
            points: s.points,
            confidence: s.confidence,
            arcFirst: first?.arc ?? 0,
            arcLast: last?.arc ?? 0,
          };
        });
        // Sort by minimum arc — handles reverse-drawn segments correctly.
        accepted.sort((a, b) =>
          Math.min(a.arcFirst, a.arcLast) - Math.min(b.arcFirst, b.arcLast),
        );
        // Stitch: each segment's points + baseline-fill across inter-
        // segment arc gaps. R-A/R-B fix: fillStart/fillEnd use Math.max/min
        // to handle reverse segments; if fillEnd ≤ fillStart, segments
        // overlap or are inverted — skip fill (small visual kink, accepted).
        const stitched: LngLat[] = [];
        for (let i = 0; i < accepted.length; i++) {
          for (const p of accepted[i].points) stitched.push(p);
          if (i < accepted.length - 1) {
            const fillStart = Math.max(accepted[i].arcFirst, accepted[i].arcLast);
            const fillEnd = Math.min(accepted[i + 1].arcFirst, accepted[i + 1].arcLast);
            if (fillEnd > fillStart) {
              const fill = baselineSlice(baseLine, fillStart, fillEnd);
              for (const p of fill) stitched.push(p);
            }
          }
        }
        const snapped = stitched;
        // v263 output corridor gate: the stitched curve must stay within
        // CORRIDOR_M + 50m (= 300m) of originalPoints. Mapbox sometimes
        // bounces a high-conf segment to a parallel road > 250m away;
        // PO direction: reject in that case (user must redraw closer to
        // the original line). The +50m buffer accounts for OSM-snap
        // tolerance so legitimate 247m-off-baseline brushes don't get
        // erroneously rejected by the output gate when input passed the
        // 250m input gate.
        const OUTPUT_CORRIDOR_M = CORRIDOR_M + 50;
        const corridorOut = strokeWithinCorridor(snapped, baseLine);
        if (corridorOut.maxDistM > OUTPUT_CORRIDOR_M) {
          rejectedStrokeIds.push(vs.stroke.id);
          firstRejectReason ??=
            `Mapbox 弹回的路超出 ${OUTPUT_CORRIDOR_M}m 范围,请重画一笔贴近原路`;
          sendEditDiag('brush_gate_failure', {
            gate: 'output_corridor_v263',
            reason: 'curve_beyond_corridor',
            stroke_idx: strokeIdx,
            stroke_vertex_count: pts.length,
            metric_value: Math.round(corridorOut.maxDistM),
            threshold: OUTPUT_CORRIDOR_M,
          });
          continue;
        }
        // v258 PO direction: capture Mapbox's actual response shape so we
        // can prove whether "straight line through building" is API-side
        // (Mapbox itself returned ≤2 points / a degenerate match because
        // it couldn't find a real walking path through the user's middle
        // segment) or splice-side (Mapbox returned a real polyline but
        // spliceMatched mangled it). R-B's diagnosis: when Mapbox returns
        // length=2 the slice(1,-1) branch in spliceMatched produces a
        // 2-point straight line through whatever was between; we want to
        // SEE the count + max-gap to know.
        const _snapMaxGap = (() => {
          let mx = 0;
          for (let i = 1; i < snapped.length; i++) {
            const a = snapped[i - 1], b = snapped[i];
            const d = haversineMetersLocal(a, b);
            if (d > mx) mx = d;
          }
          return Math.round(mx);
        })();
        sendEditDiag('brush_mapbox_response', {
          stroke_idx: strokeIdx,
          response_pts_count: snapped.length,
          response_first3: snapped.slice(0, 3).map(p => [p.lng, p.lat]),
          response_last3: snapped.slice(-3).map(p => [p.lng, p.lat]),
          max_segment_gap_m: _snapMaxGap,
          confidence: r.confidence,
          ms_taken: Date.now() - mapboxT0,
          // Red flag: Mapbox returned only 2 points OR has a >50m gap
          // between consecutive points = degenerate match likely going
          // through buildings.
          degenerate: snapped.length <= 2 || _snapMaxGap > 50,
        });
        // v266 PO direction: dump FULL raw data for every preview round
        // so we can offline-analyze without guessing. Includes:
        //   - every brush raw point we sent Mapbox (post-magnetism, post-simplify)
        //   - every Mapbox matching segment (each with its own conf + full
        //     coordinates) — captures the multi-matching split
        //   - the post-stitch "snapped" curve we use downstream
        // Yes, this is verbose. Yes, it's worth it. Each preview round
        // is one diag row; storage is cheap; the alternative is more
        // OTAs to add fields one at a time.
        sendEditDiag('brush_full_dump', {
          stroke_idx: strokeIdx,
          baseline_pts_count: baseLine.length,
          baseline_first3: baseLine.slice(0, 3).map(p => [p.lng, p.lat]),
          baseline_last3: baseLine.slice(-3).map(p => [p.lng, p.lat]),
          original_pts_count: state.originalPoints.length,
          mapbox_input_full: bcefInput.map(p => [p.lng, p.lat]),
          mapbox_segments: r.segments.map(s => ({
            confidence: s.confidence,
            n: s.points.length,
            coords: s.points.map(p => [p.lng, p.lat]),
          })),
          stitched_curve_full: snapped.map(p => [p.lng, p.lat]),
          projected_B: [B.lng, B.lat],
          projected_C: [C.lng, C.lat],
          projB_arc: projB.arc,
          projC_arc: projC.arc,
          projB_dist_to_baseline: projB.dist,
          projC_dist_to_baseline: projC.dist,
        });
        strokeSnapCache.set(fp, snapped);
        if (strokeSnapCache.size > 100) {
          const firstKey = strokeSnapCache.keys().next().value;
          if (firstKey) strokeSnapCache.delete(firstKey);
        }
        snappedPerStroke.push(snapped);
        // v260 BCEF: track arcB/arcC alongside the snap so spliceBCEF can
        // splice without re-projecting (we already projected pts[0], pts[-1]
        // onto baseline above as projB/projC).
        bcefItems.push({
          arcB: projB.arc,
          arcC: projC.arc,
          curve: snapped,
        });
        acceptedValidated.push(vs);
      }

      // Fence: bail if state was mutated during await.
      if (fenceTriggered()) return { ok: false, error: 'state-changed' };

      // v6.3 plan §3.1: multi-stroke partial-failure semantics.
      // Per-stroke commit, NO atomic rollback. If 0 strokes accepted, surface
      // the first failure reason; the user keeps draw + undo control.
      if (acceptedValidated.length === 0) {
        sendEditDiag('brush_preview_completed', {
          stroke_count: state.brushStrokes.length,
          accepted: 0,
          rejected: rejectedStrokeIds.length,
          ms_taken: Date.now() - previewT0,
        });
        const errMsg = firstRejectReason ?? '未识别到这条路';
        set({
          lastError: errMsg,
          // Drop the rejected strokes from the canvas (plan §4.3).
          brushStrokes: get().brushStrokes.filter(
            s => !rejectedStrokeIds.includes(s.id),
          ),
        });
        // Plan §4.1: lastError auto-clears after 2.5s.
        setTimeout(() => {
          const live = get();
          if (live.lastError === errMsg) set({ lastError: null });
        }, LAST_ERROR_AUTO_CLEAR_MS);
        return { ok: false, error: firstRejectReason ?? 'rejected' };
      }

      // v265: drop spliceBCEF entirely. PO direction (after empirical
      // diag analysis showed Mapbox geometry is always valid OSM road
      // points but our splice was wrongly anchoring): the new flow is
      //   baseline_prefix (up to Mapbox curve START's projected arc)
      // + Mapbox curve in full
      // + baseline_suffix (from Mapbox curve END's projected arc)
      // No arc-min/max games, no anchor replacement, no segment
      // stitching gymnastics — Mapbox owns the curve, baseline owns
      // the prefix/suffix, the cut point is wherever Mapbox's actual
      // first/last point lands on baseline.
      //
      // Multi-stroke is handled stroke-by-stroke in arc order; for
      // each stroke the Mapbox curve is taken as-is (already stitched
      // via v263 multi-matching code in bcefItems[i].curve).
      const newMatched: LngLat[] = (() => {
        if (bcefItems.length === 0) return [...baseLine];
        // Sort by min arc (handles user drawing in reverse direction).
        const items = bcefItems
          .map(it => {
            const curve = it.curve;
            // Project Mapbox curve's actual first/last onto baseline so
            // the cut points are where Mapbox really lands, not where
            // brush projected.
            const first = projectPointOntoBaseline(curve[0], baseLine);
            const last = projectPointOntoBaseline(curve[curve.length - 1], baseLine);
            const arcFirst = first?.arc ?? 0;
            const arcLast = last?.arc ?? 0;
            const arcMin = Math.min(arcFirst, arcLast);
            const arcMax = Math.max(arcFirst, arcLast);
            const reversed = arcFirst > arcLast;
            return { curve, arcMin, arcMax, reversed };
          })
          .sort((a, b) => a.arcMin - b.arcMin);

        const out: LngLat[] = [];
        let cursor = 0;
        for (const it of items) {
          if (it.arcMin < cursor) continue; // overlap → skip
          // Prefix: baseline from cursor to arcMin.
          for (const p of baselineSlice(baseLine, cursor, it.arcMin)) out.push(p);
          // Mapbox curve, reversed if user drew in reverse-arc direction.
          const curveOriented = it.reversed ? [...it.curve].reverse() : it.curve;
          for (const p of curveOriented) out.push(p);
          cursor = it.arcMax;
        }
        // Tail.
        const total = baseLine.reduce((s, _, i) =>
          i === 0 ? 0 : s + haversineMetersLocal(baseLine[i-1], baseLine[i]), 0);
        for (const p of baselineSlice(baseLine, cursor, total)) out.push(p);

        // 0.5m dedupe — same as v260 spliceBCEF tail.
        if (out.length < 2) return out;
        const deduped: LngLat[] = [out[0]];
        for (let i = 1; i < out.length; i++) {
          const prev = deduped[deduped.length - 1];
          if (haversineMetersLocal(prev, out[i]) > 0.5) deduped.push(out[i]);
          else if (prev.alt == null && out[i].alt != null) {
            deduped[deduped.length - 1] = { ...prev, alt: out[i].alt };
          }
        }
        return deduped;
      })();

      // v258 PO direction: post-splice diag to confirm whether the splice
      // step preserved Mapbox's polyline or flattened a multi-vertex match
      // into a 2-point straight line. The smoking gun is when one of the
      // snappedPerStroke entries had length > 2 but the splice output
      // around that arc range becomes a single big jump > 50m — meaning
      // spliceMatched's [startPt, ...slice(1,-1), endPt] anchor-replace
      // step lost the middle. Combined with brush_mapbox_response above
      // we now have full input-output traceability.
      let _spliceMaxGap = 0;
      let _spliceMaxGapIdx = -1;
      for (let i = 1; i < newMatched.length; i++) {
        const d = haversineMetersLocal(newMatched[i - 1], newMatched[i]);
        if (d > _spliceMaxGap) {
          _spliceMaxGap = d;
          _spliceMaxGapIdx = i;
        }
      }
      sendEditDiag('brush_splice_done', {
        accepted_count: acceptedValidated.length,
        snapped_in_pts_total: snappedPerStroke.reduce((s, x) => s + x.length, 0),
        snapped_in_pts_per_stroke: snappedPerStroke.map(s => s.length),
        spliced_out_pts: newMatched.length,
        baseline_pts: baseLine.length,
        spliced_max_gap_m: Math.round(_spliceMaxGap),
        spliced_max_gap_at_idx: _spliceMaxGapIdx,
        // Red flag: any Mapbox return had ≥3 pts but splice output has a
        // big gap = splice mangled it.
        suspicious_flatten: snappedPerStroke.some(s => s.length >= 3) && _spliceMaxGap > 50,
      });
      // v266 PO direction: full final geometry dump for offline analysis.
      sendEditDiag('brush_final_dump', {
        accepted_count: acceptedValidated.length,
        final_pts_count: newMatched.length,
        final_full: newMatched.map(p => [p.lng, p.lat]),
        max_gap_m: _spliceMaxGap,
        max_gap_at_idx: _spliceMaxGapIdx,
      });

      // v261: walkedIndex stays anchored to state.originalPoints across
      // Preview. Pre-v261 this rebuilt from newMatched so endpoint-snap
      // would track the post-edit baseline — but that introduced drift:
      // each Preview shifted vertices ±10m via Mapbox OSM-snap, and
      // subsequent strokes got magnetized to those drifted points,
      // producing "尖角不是我画的" artifacts. PO rule: brush-edit
      // reference frame is permanently the original baseline; matchedPoints
      // is render-only output, never a query target.
      const newWalkedIndex = state.originalPoints.length >= 2
        ? new PointCloudIndex(
            state.originalPoints.map((p, i) => ({
              lng: p.lng,
              lat: p.lat,
              source: 'original' as const,
              refId: `original:${i}`,
            })),
          )
        : state.walkedIndex;

      const partialRejectMsg = rejectedStrokeIds.length > 0 ? firstRejectReason ?? null : null;
      set(s => ({
        // Plan §6.4: rejected strokes vanish from the canvas. Accepted ones
        // are committed into matchedPoints, so the in-progress array clears.
        brushStrokes: [],
        // v6.3: clean Mapbox-only path. No Catmull-Rom fallback. No
        // low-confidence warning (we either accepted clean or rejected).
        undoStack: [],
        activeStrokeId: null,
        hasCommittedEdit: true,
        previewMatchedPoints: null,
        previewIsCurrent: true,
        matchedPoints: newMatched,
        workingPoints: deriveWorking(newMatched, s.trimStartFrac, s.trimEndFrac),
        walkedIndex: newWalkedIndex,
        // Surface partial-failure to the user as lastError; the accepted
        // strokes still committed.
        lastError: partialRejectMsg,
        lastWarning: null,
        editOpSeq: s.editOpSeq + 1,
      }));
      if (partialRejectMsg) {
        // Plan §4.1: auto-clear after 2.5s.
        // R6 C4: capture editOpSeq AFTER set so a subsequent successful
        // Preview (which bumps editOpSeq) won't have its same-text lastError
        // wiped by THIS timer firing late.
        const seqAtSet = get().editOpSeq;
        setTimeout(() => {
          const live = get();
          if (live.lastError === partialRejectMsg && live.editOpSeq === seqAtSet) {
            set({ lastError: null });
          }
        }, LAST_ERROR_AUTO_CLEAR_MS);
      }
      sendEditDiag('brush_preview_completed', {
        stroke_count: state.brushStrokes.length,
        accepted: acceptedValidated.length,
        rejected: rejectedStrokeIds.length,
        ms_taken: Date.now() - previewT0,
      });
      return { ok: true };
    } catch (e: any) {
      // v6.3 plan §1.2 + R3 C1: top-level catch defends against
      // unhandled throws from POST-await code (spliceMatched, PointCloudIndex
      // build, set listeners). Without this, the promise rejects and surfaces
      // as a yellow box / release crash. Fence is checked first so a
      // mid-call hardware-back doesn't get mis-classified as a network error.
      const fenceTrip = (() => {
        const live = get();
        return live.sessionId !== startSid || live.editOpSeq !== startSeq;
      })();
      if (fenceTrip) return { ok: false, error: 'state-changed' };
      const errMsg = e?.name === 'AbortError' ? '网络慢,请重试' : '未识别到这条路';
      set({ lastError: errMsg });
      setTimeout(() => {
        const live = get();
        if (live.lastError === errMsg) set({ lastError: null });
      }, LAST_ERROR_AUTO_CLEAR_MS);
      sendEditDiag('brush_mapbox_error', {
        reason: 'unhandled_throw',
        ms_to_error: Date.now() - previewT0,
      });
      return { ok: false, error: errMsg };
    } finally {
      // v6.3 plan §1.2 + R1v3: finally MUST clear isComputing on every path
      // — success, abort, fence, throw. Without this, a thrown error
      // mid-await leaves the Preview button permanently disabled.
      set({ isComputing: false });
    }
  },

  async saveAndExit() {
    const state = get();
    if (!state.routeId) return { ok: false, error: 'no-route-id' };
    if (state.isSaving) return { ok: false, error: 'busy — save already in progress' };

    // v246: require Preview before Save when there are brush strokes.
    // For pure trim or no-edit case (no strokes), the original is the
    // preview and we can save directly.
    if (state.brushStrokes.length > 0 && !state.previewIsCurrent) {
      set({ lastError: 'Preview your edits first.' });
      return { ok: false, error: 'preview-required' };
    }

    const writeRouteId = state.routeId;
    const writeSessionId = state.sessionId;
    const writeOriginal = state.originalPoints;
    const writeTs = state.trimStartFrac;
    const writeTe = state.trimEndFrac;
    // Use the preview-cached matched polyline; if no brushes, use original.
    const finalMatched = state.previewMatchedPoints ?? state.matchedPoints;
    const newWorking = deriveWorking(finalMatched, writeTs, writeTe);

    if (newWorking.length < 2 || polylineLengthM(newWorking) < 1) {
      set({ lastError: 'Route is too short to save.' });
      return { ok: false, error: 'too-short' };
    }

    set({ isSaving: true, lastSaveAttemptFailed: false });

    let result;
    try {
      result = await saveExtras({
        routeId: writeRouteId,
        originalPoints: writeOriginal,
        workingPoints: newWorking,
        trimStartFrac: writeTs,
        trimEndFrac: writeTe,
        segments: [
          {
            startIdx: 0,
            endIdx: Math.max(0, newWorking.length - 1),
            source: state.brushStrokes.length > 0 ? 'mapbox' : 'original',
            isEdited: state.brushStrokes.length > 0 || writeTs > 0 || writeTe < 1,
            confidence: 'confident',
          },
        ],
      });
    } catch (err: any) {
      logRouteSaveFailure({ routeId: writeRouteId, error: String(err?.message ?? err).slice(0, 100) });
      set({
        lastError: `Save failed: ${String(err?.message ?? err).slice(0, 100)}`,
        lastSaveAttemptFailed: true,
        isSaving: false,
      });
      return { ok: false, error: String(err?.message ?? err) };
    }
    if (!result.ok) {
      logRouteSaveFailure({ routeId: writeRouteId, error: result.error ?? 'unknown' });
      set({
        lastError: `Save failed: ${result.error ?? 'unknown'}`,
        lastSaveAttemptFailed: true,
        isSaving: false,
      });
      return { ok: false, error: result.error };
    }

    {
      const liveAfter = get();
      if (liveAfter.sessionId !== writeSessionId) {
        logEditSave({
          totalEdits: state.editCount,
          finalLengthM: polylineLengthM(newWorking),
          originalLengthM: polylineLengthM(writeOriginal),
          segmentCount: 1,
        });
        set({ isSaving: false });
        return { ok: true, sessionReplaced: true };
      }
    }

    set({ sessionId: null });
    await chainSessionWrite(async () => {
      const live = get();
      if (live.sessionId !== null) return;
      await clearSession();
    });

    logEditSave({
      totalEdits: state.editCount,
      finalLengthM: polylineLengthM(newWorking),
      originalLengthM: polylineLengthM(writeOriginal),
      segmentCount: 1,
    });
    sendEditDiag('brush_save_committed', {
      stroke_count: 0, // strokes were drained at Preview commit
      distance_m: polylineLengthM(newWorking),
      has_alt: newWorking.some(p => p.alt != null),
    });
    if (state.enteredAtTs) {
      logEditExited({
        duration: Date.now() - state.enteredAtTs,
        edited: state.editCount > 0,
        saved: true,
        cancelled: false,
      });
    }

    set(s => {
      if (s.sessionId !== null) {
        return { isSaving: false, editOpSeq: s.editOpSeq + 1 };
      }
      return {
        isOpen: false,
        routeId: null,
        enteredAtTs: null,
        lastSaveAttemptFailed: false,
        isSaving: false,
        editOpSeq: s.editOpSeq + 1,
      };
    });
    return { ok: true };
  },

  commitEditDraft() {
    // v249: Edit-mode "Save" handler. Captures current preview geometry
    // as committedDraft, closes the edit UI without writing to the
    // backend, and keeps the session alive so the user can re-enter Edit
    // and resume from the draft. Final persistence happens when the
    // user presses the outer view-mode "Save" button.
    const state = get();
    if (state.isSaving) return { ok: false, error: 'busy' };
    if (state.brushStrokes.length > 0 && !state.previewIsCurrent) {
      set({ lastError: 'Preview your edits first.' });
      return { ok: false, error: 'preview-required' };
    }
    if (!state.routeId) return { ok: false, error: 'no-route-id' };

    const finalMatched = state.previewMatchedPoints ?? state.matchedPoints;
    const newWorking = deriveWorking(finalMatched, state.trimStartFrac, state.trimEndFrac);
    if (newWorking.length < 2 || polylineLengthM(newWorking) < 1) {
      set({ lastError: 'Route is too short to commit.' });
      return { ok: false, error: 'too-short' };
    }

    set(s => ({
      committedDraft: {
        matchedPoints: finalMatched,
        workingPoints: newWorking,
        brushStrokes: state.brushStrokes,
        trimStartFrac: state.trimStartFrac,
        trimEndFrac: state.trimEndFrac,
        routeId: state.routeId!,
      },
      isOpen: false,
      activeTool: 'pan',
      activeStrokeId: null,
      lastError: null,
      editOpSeq: s.editOpSeq + 1,
    }));
    return { ok: true };
  },

  clearCommittedDraft() {
    set({ committedDraft: null });
  },

  cancelEdit(opts?: { keepDraft?: boolean }) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait before cancelling.' });
      return;
    }
    set(s => ({ sessionId: null, editOpSeq: s.editOpSeq + 1 }));
    if (state.sessionId) {
      const cancelledId = state.sessionId;
      recentlyCancelledSessions.add(cancelledId);
      chainSessionWrite(() => clearSession())
        .catch(() => {})
        .finally(() => recentlyCancelledSessions.delete(cancelledId));
    } else {
      chainSessionWrite(() => clearSession()).catch(() => {});
    }

    if (state.enteredAtTs) {
      logEditExited({
        duration: Date.now() - state.enteredAtTs,
        edited: state.editCount > 0,
        saved: false,
        cancelled: true,
      });
    }

    // v249: Two cancel modes.
    // - keepDraft=true (called from edit-mode Cancel button): only the
    //   IN-PROGRESS edit (current strokes/trim/working) is cleared. The
    //   previously committed draft survives so the user can press Edit
    //   again and resume from it.
    // - default (no opts, called from view-mode discard / unmount):
    //   nuke everything including any committedDraft.
    if (opts?.keepDraft) {
      set({
        isOpen: false,
        // Keep routeId so Edit can resume; keep committedDraft.
        // Clear in-progress edit state only:
        brushStrokes: [],
        trimStartFrac: state.committedDraft?.trimStartFrac ?? 0,
        trimEndFrac: state.committedDraft?.trimEndFrac ?? 1,
        activeTool: 'pan',
        previewMatchedPoints: null,
        previewIsCurrent: false,
        undoStack: [],
        walkedIndex: null,
        isComputing: false,
        lastError: null,
        lastWarning: null,
        validationErrors: [],
        enteredAtTs: null,
        editCount: 0,
        lastSaveAttemptFailed: false,
        isSaving: false,
        pendingBeginArgs: null,
        migratorRetry: null,
        // matchedPoints / workingPoints / originalPoints retained so a
        // subsequent re-enter can fast-path; beginEdit will reset them
        // anyway based on resumeFrom.
      });
      return;
    }

    set({
      isOpen: false,
      routeId: null,
      originalPoints: [],
      matchedPoints: [],
      workingPoints: [],
      brushStrokes: [],
      trimStartFrac: 0,
      trimEndFrac: 1,
      activeTool: 'pan',
      activeStrokeId: null,
      hasCommittedEdit: false,
      previewMatchedPoints: null,
      previewIsCurrent: false,
      committedDraft: null,
      undoStack: [],
      walkedIndex: null,
      isComputing: false,
      lastError: null,
      lastWarning: null,
      validationErrors: [],
      enteredAtTs: null,
      editCount: 0,
      lastSaveAttemptFailed: false,
      isSaving: false,
      pendingBeginArgs: null,
      migratorRetry: null,
    });
  },
}));

// Persistence-failure subscription.
declare const globalThis: { __cairnSaveFailureSubscribed?: boolean } & typeof global;
if (!globalThis.__cairnSaveFailureSubscribed) {
  globalThis.__cairnSaveFailureSubscribed = true;
  onSaveSessionFailure((count) => {
    const state = useRouteEditStore.getState();
    if (!state.isOpen) return;
    if (count >= 3) {
      useRouteEditStore.setState({
        lastWarning:
          'Unable to save edit progress in the background. Please save your edits soon to avoid losing them.',
      });
    } else if (count === 0) {
      const live = useRouteEditStore.getState();
      if (live.lastWarning?.startsWith('Unable to save')) {
        useRouteEditStore.setState({ lastWarning: null });
      }
    }
  });
}

/** Helper exported for color-by-distance rendering. */
export function distanceFromOriginalM(coord: LngLat, walkedIndex: PointCloudIndex | null): number {
  return distanceToOriginalM(coord, walkedIndex);
}
export const BRUSH_RADII = {
  CORRIDOR_RADIUS_M,
  ENDPOINT_SNAP_M,
  WARN_RADIUS_M: 200,
};
