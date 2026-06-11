/**
 * coordSampling — build a Map Matching coord sequence that:
 *   1. Forces the matched output to pass through every via.
 *   2. Preserves original GPS shape outside via neighborhoods.
 *   3. Stays under Mapbox's 100-coord cap per call.
 *
 * Strategy:
 *   - Project each via onto originalPoints (along-arc position).
 *   - For each via, take an "anchor window" of densified original samples
 *     within ±150m arc-length so MM has local context.
 *   - Fill the remaining budget with arc-length-uniform samples of the
 *     original, EXCLUDING the windows (those are already populated).
 *   - Concat in along-route order: start → fill → window1 → via1 → fill →
 *     window2 → via2 → ... → end.
 *   - radiuses[]: 25m on vias (tight, must respect), 50m on anchor window
 *     points (snap close to walked path), null on fill (default ~25m).
 *
 * Sprint 67 v236.
 */

import type { LngLat } from '../corridor/PolylineSampler';
import { haversineMeters } from '../corridor/PolylineSampler';
import type { MatchRequestBuild, MatchSegment, ViaPoint } from './types';

const MAPBOX_MAX_COORDS = 100;
const VIA_RADIUS_M = 15;
const ANCHOR_RADIUS_M = 50;
// v243: shrink anchor window so the via has more freedom to pull
// the matched line onto a parallel street. With 150m windows, original
// GPS anchors near the via dominated and Mapbox snapped back to the
// original road; 50m gives Mapbox enough headroom to honor the via.
const ANCHOR_HALF_WINDOW_M = 50;

/** Default per-call budget (leave 4 slots of headroom). */
const DEFAULT_MAX_COORDS_PER_CALL = MAPBOX_MAX_COORDS - 4;

interface ProjectedVia {
  via: ViaPoint;
  /** Arc length from start of originalPoints to the projection foot, in meters. */
  arcM: number;
  /** Distance from via to its foot on the polyline, in meters. */
  perpM: number;
}

/** Cumulative arc length array: arc[i] = distance from coords[0] to coords[i]. */
function cumulativeArc(coords: LngLat[]): number[] {
  const arc = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length; i++) {
    arc[i] = arc[i - 1] + haversineMeters(coords[i - 1], coords[i]);
  }
  return arc;
}

/** Project a point onto a polyline. Returns arc length to foot + perp distance. */
function projectOntoPolyline(
  p: LngLat,
  poly: LngLat[],
  arc: number[],
): { arcM: number; perpM: number } {
  let bestArc = 0;
  let bestPerp = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const segLen = arc[i] - arc[i - 1];
    if (segLen < 1e-6) continue;
    // Equirectangular projection at mid-lat.
    const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
    const cosLat = Math.cos(midLat);
    const M_PER_DEG = 111000;
    const ax = a.lng * cosLat * M_PER_DEG;
    const ay = a.lat * M_PER_DEG;
    const bx = b.lng * cosLat * M_PER_DEG;
    const by = b.lat * M_PER_DEG;
    const px = p.lng * cosLat * M_PER_DEG;
    const py = p.lat * M_PER_DEG;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const fx = ax + t * dx;
    const fy = ay + t * dy;
    const ex = px - fx;
    const ey = py - fy;
    const perp = Math.sqrt(ex * ex + ey * ey);
    if (perp < bestPerp) {
      bestPerp = perp;
      bestArc = arc[i - 1] + t * segLen;
    }
  }
  return { arcM: bestArc, perpM: bestPerp };
}

/**
 * Pick `n` indices uniformly along the cumulative-arc range [arcStart, arcEnd],
 * EXCLUDING any index whose arc falls inside any forbidden range.
 *
 * Returns indices into `coords` (not arc values). Endpoints not included.
 */
function uniformArcSamples(
  coords: LngLat[],
  arc: number[],
  arcStart: number,
  arcEnd: number,
  forbidden: Array<{ from: number; to: number }>,
  n: number,
): number[] {
  if (n <= 0 || arcEnd <= arcStart) return [];
  const out: number[] = [];
  const step = (arcEnd - arcStart) / (n + 1);
  for (let k = 1; k <= n; k++) {
    const target = arcStart + k * step;
    if (forbidden.some(f => target >= f.from && target <= f.to)) continue;
    // Find nearest index by binary-ish linear scan (n is small).
    let bestIdx = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < arc.length; i++) {
      const d = Math.abs(arc[i] - target);
      if (d < bestDelta) {
        bestDelta = d;
        bestIdx = i;
      }
    }
    out.push(bestIdx);
  }
  return out;
}

/** Indices in `coords` whose arc falls within [arcCenter - half, arcCenter + half]. */
function indicesInArcWindow(
  arc: number[],
  arcCenter: number,
  halfWindowM: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < arc.length; i++) {
    if (Math.abs(arc[i] - arcCenter) <= halfWindowM) out.push(i);
  }
  return out;
}

/** Cap a sorted index array to ≤ maxCount by uniform downsampling. */
function downsampleIndices(idxs: number[], maxCount: number): number[] {
  if (idxs.length <= maxCount) return idxs;
  if (maxCount <= 2) return [idxs[0], idxs[idxs.length - 1]];
  const out: number[] = [];
  const step = (idxs.length - 1) / (maxCount - 1);
  for (let k = 0; k < maxCount; k++) {
    out.push(idxs[Math.round(k * step)]);
  }
  return out;
}

/**
 * Build a Map Matching coord sequence. Single-segment for most edits.
 * Returns a MatchRequestBuild with segments[] and totalCoords.
 *
 * If the budget cannot fit start + end + all vias + minimal anchor windows,
 * the function emits multiple segments (split at via boundaries) so the
 * caller can call MM independently per segment and stitch.
 */
export function buildMatchSequence(args: {
  originalPoints: LngLat[];
  viaPoints: ViaPoint[];
  maxCoordsPerCall?: number;
}): MatchRequestBuild {
  const maxCoords = args.maxCoordsPerCall ?? DEFAULT_MAX_COORDS_PER_CALL;
  const orig = args.originalPoints;
  const vias = args.viaPoints;

  if (orig.length < 2) {
    return { segments: [], totalCoords: 0 };
  }

  const arc = cumulativeArc(orig);

  // Project each via, sort by arc.
  const projected: ProjectedVia[] = vias
    .map(v => {
      const proj = projectOntoPolyline({ lng: v.lng, lat: v.lat }, orig, arc);
      return { via: v, arcM: proj.arcM, perpM: proj.perpM };
    })
    .sort((a, b) => a.arcM - b.arcM);

  // No vias → single segment, uniform sample of originalPoints.
  if (projected.length === 0) {
    return buildSingleSegmentNoVia(orig, arc, maxCoords);
  }

  // Try single segment first.
  const single = tryBuildSingle(orig, arc, projected, maxCoords);
  if (single) {
    return { segments: [single], totalCoords: single.coords.length };
  }

  // Fall back to per-via segments (split at each via).
  return buildMultiSegment(orig, arc, projected, maxCoords);
}

function buildSingleSegmentNoVia(
  orig: LngLat[],
  arc: number[],
  maxCoords: number,
): MatchRequestBuild {
  const totalArc = arc[arc.length - 1];
  const fillN = Math.max(0, maxCoords - 2);
  const fillIdxs = uniformArcSamples(orig, arc, 0, totalArc, [], fillN);
  const allIdxs = [0, ...fillIdxs, orig.length - 1].sort((a, b) => a - b);
  // Dedup
  const uniq: number[] = [];
  for (const i of allIdxs) {
    if (uniq.length === 0 || uniq[uniq.length - 1] !== i) uniq.push(i);
  }
  const coords = uniq.map(i => orig[i]);
  const radiuses: (number | null)[] = uniq.map(() => null);
  return {
    segments: [{ coords, radiuses, viaIndicesInCoords: [] }],
    totalCoords: coords.length,
  };
}

function tryBuildSingle(
  orig: LngLat[],
  arc: number[],
  projected: ProjectedVia[],
  maxCoords: number,
): MatchSegment | null {
  // Plan budgets: 2 endpoints + vias + per-via window + fill.
  const endpointCount = 2;
  const viaCount = projected.length;
  let budget = maxCoords - endpointCount - viaCount;
  if (budget < 0) return null;

  // Window per via: target ≤ 4 anchor points each (small to leave fill room).
  const windowCap = Math.max(2, Math.min(4, Math.floor(budget / Math.max(1, viaCount * 2))));

  const windowIdxsByVia: number[][] = [];
  let totalWindow = 0;
  for (const pv of projected) {
    const w = downsampleIndices(indicesInArcWindow(arc, pv.arcM, ANCHOR_HALF_WINDOW_M), windowCap);
    windowIdxsByVia.push(w);
    totalWindow += w.length;
  }
  budget -= totalWindow;
  if (budget < 0) return null;

  // Forbidden ranges = each via's window arc range. Skip empty windows
  // (otherwise Math.min/max with no args yields ±Infinity → inverted range
  // that silently disables forbidden-range filtering).
  const forbidden: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < projected.length; i++) {
    const w = windowIdxsByVia[i];
    if (!w || w.length === 0) continue;
    const lo = Math.min(...w);
    const hi = Math.max(...w);
    forbidden.push({ from: arc[lo], to: arc[hi] });
  }

  const totalArc = arc[arc.length - 1];
  const fillIdxs = uniformArcSamples(orig, arc, 0, totalArc, forbidden, budget);

  return assembleSegment(orig, arc, projected, windowIdxsByVia, fillIdxs);
}

function assembleSegment(
  orig: LngLat[],
  arc: number[],
  projected: ProjectedVia[],
  windowIdxsByVia: number[][],
  fillIdxs: number[],
): MatchSegment {
  // Build a sortable list: (arcPosition, kind, payload)
  type Entry =
    | { arcPos: number; kind: 'point'; idx: number; radius: number | null }
    | { arcPos: number; kind: 'via'; via: ProjectedVia };

  const entries: Entry[] = [];

  // Endpoints
  entries.push({ arcPos: 0, kind: 'point', idx: 0, radius: null });
  entries.push({
    arcPos: arc[arc.length - 1],
    kind: 'point',
    idx: orig.length - 1,
    radius: null,
  });

  // Anchor windows
  for (let i = 0; i < projected.length; i++) {
    for (const idx of windowIdxsByVia[i]) {
      if (idx === 0 || idx === orig.length - 1) continue; // already endpoint
      entries.push({ arcPos: arc[idx], kind: 'point', idx, radius: ANCHOR_RADIUS_M });
    }
  }

  // Fill
  for (const idx of fillIdxs) {
    if (idx === 0 || idx === orig.length - 1) continue;
    entries.push({ arcPos: arc[idx], kind: 'point', idx, radius: null });
  }

  // Vias
  for (const pv of projected) {
    entries.push({ arcPos: pv.arcM, kind: 'via', via: pv });
  }

  entries.sort((a, b) => a.arcPos - b.arcPos);

  // Dedup point-of-same-idx (keep tightest radius).
  const coords: LngLat[] = [];
  const radiuses: (number | null)[] = [];
  const viaIndicesInCoords: number[] = [];
  let lastIdx = -1;

  for (const e of entries) {
    if (e.kind === 'point') {
      if (e.idx === lastIdx) {
        // Tighten existing radius if needed.
        const last = coords.length - 1;
        if (e.radius !== null && (radiuses[last] === null || e.radius < (radiuses[last] as number))) {
          radiuses[last] = e.radius;
        }
        continue;
      }
      coords.push(orig[e.idx]);
      radiuses.push(e.radius);
      lastIdx = e.idx;
    } else {
      coords.push({ lng: e.via.via.lng, lat: e.via.via.lat });
      radiuses.push(VIA_RADIUS_M);
      viaIndicesInCoords.push(coords.length - 1);
      lastIdx = -1; // via not from orig
    }
  }

  return { coords, radiuses, viaIndicesInCoords };
}

function buildMultiSegment(
  orig: LngLat[],
  arc: number[],
  projected: ProjectedVia[],
  maxCoords: number,
): MatchRequestBuild {
  // Split at vias. seg0 = [start..via1], seg1 = [via1..via2], ...,
  // segV = [viaV..end]. Each segment shares the boundary via with neighbors.
  const segments: MatchSegment[] = [];
  let totalCoords = 0;

  const splits: Array<{ fromArc: number; toArc: number; vias: ProjectedVia[] }> = [];
  splits.push({ fromArc: 0, toArc: projected[0].arcM, vias: [] });
  for (let i = 0; i < projected.length - 1; i++) {
    splits.push({ fromArc: projected[i].arcM, toArc: projected[i + 1].arcM, vias: [] });
  }
  splits.push({
    fromArc: projected[projected.length - 1].arcM,
    toArc: arc[arc.length - 1],
    vias: [],
  });

  // Each split gets its bounding vias as "anchor pull" points (start via for
  // mid-segments, end via, etc.)
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    const startVia = i > 0 ? projected[i - 1] : null;
    const endVia = i < projected.length ? projected[i] : null;
    const local: ProjectedVia[] = [];
    if (startVia) local.push(startVia);
    if (endVia) local.push(endVia);
    s.vias = local;
  }

  for (const s of splits) {
    // Pick orig indices inside [s.fromArc, s.toArc]
    const inRange: number[] = [];
    for (let i = 0; i < arc.length; i++) {
      if (arc[i] >= s.fromArc && arc[i] <= s.toArc) inRange.push(i);
    }
    if (inRange.length < 2) continue;
    // Build a per-segment MatchSegment with its own budget.
    const subOrig = inRange.map(i => orig[i]);
    const subArc = cumulativeArc(subOrig);
    // The vias for this sub-segment: those whose arcM is exactly at fromArc/toArc.
    const subProjected: ProjectedVia[] = s.vias.map(pv => {
      const localArc = pv.arcM - s.fromArc;
      return { via: pv.via, arcM: Math.max(0, Math.min(subArc[subArc.length - 1], localArc)), perpM: pv.perpM };
    });
    const seg = tryBuildSingle(subOrig, subArc, subProjected, maxCoords);
    if (seg) {
      segments.push(seg);
      totalCoords += seg.coords.length;
    } else {
      // Last resort: 2-coord straight line
      const fallback: MatchSegment = {
        coords: [subOrig[0], subOrig[subOrig.length - 1]],
        radiuses: [null, null],
        viaIndicesInCoords: [],
      };
      segments.push(fallback);
      totalCoords += 2;
    }
  }

  return { segments, totalCoords };
}

/**
 * Stitch matched segments into a single polyline.
 * Adjacent segments share their boundary via point — drop the duplicate.
 */
export function stitchMatchedSegments(matchedSegments: LngLat[][]): LngLat[] {
  if (matchedSegments.length === 0) return [];
  const out: LngLat[] = [...matchedSegments[0]];
  for (let i = 1; i < matchedSegments.length; i++) {
    const seg = matchedSegments[i];
    if (seg.length === 0) continue;
    // Drop first point of seg if it coincides with last of out (within 5m).
    const last = out[out.length - 1];
    const first = seg[0];
    if (last && haversineMeters(last, first) < 5) {
      for (let k = 1; k < seg.length; k++) out.push(seg[k]);
    } else {
      for (const p of seg) out.push(p);
    }
  }
  return out;
}

/** Constants exported for tests + UI copy. */
export const COORD_LIMITS = {
  MAPBOX_MAX_COORDS,
  VIA_RADIUS_M,
  ANCHOR_RADIUS_M,
  ANCHOR_HALF_WINDOW_M,
  DEFAULT_MAX_COORDS_PER_CALL,
};
