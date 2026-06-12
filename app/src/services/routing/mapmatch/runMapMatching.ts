/**
 * runMapMatching — orchestrator for "走过的路才是路 + 局部微调" routing.
 *
 * v244 design: instead of feeding the entire originalPoints + viaPoints
 * to Map Matching (which made Mapbox snap the whole route to roads
 * including parts the user didn't touch — leaving "two parallel routes"
 * artifacts), we now do LOCAL SEGMENT REPLACEMENT:
 *
 *   1. Project each via onto originalPoints (along-arc position).
 *   2. For each via, define a "replace window" of ±REPLACE_HALF_M around
 *      the projection (default 200m).
 *   3. Adjacent windows are merged.
 *   4. For each window, call Mapbox Map Matching with [windowStart, via,
 *      windowEnd] — just 3 coords. Mapbox returns a polyline going
 *      windowStart → via → windowEnd, snapped to roads.
 *   5. Stitch: outside windows → keep originalPoints AS-IS; inside
 *      windows → use the matched polyline.
 *   6. Cache: same (originalPoints fingerprint + viaPoints fingerprint)
 *      → return last matchedPoints, no API call.
 *
 * Cost: 1 Mapbox call per via (capped at MAX_VIAS=5). With cache, an
 * edit session of N adds + M moves = (N+M) calls TOTAL across the
 * session — drastically lower than v243 which called once per via on
 * every change.
 */

import type { LngLat } from '../corridor/PolylineSampler';
import { haversineMeters } from '../corridor/PolylineSampler';
import { matchSegment } from './MapMatchingClient';
import type { MatchResult, MatchSegment, ViaPoint } from './types';

export interface RunMatchArgs {
  originalPoints: LngLat[];
  viaPoints: ViaPoint[];
}

export interface RunMatchSuccess {
  ok: true;
  matchedPoints: LngLat[];
  worstConfidence: number;
  durationMs: number;
  segmentCount: number;
  /** True when result came from cache (no API calls made). */
  cached: boolean;
}

export interface RunMatchFailure {
  ok: false;
  reason: 'no-match' | 'network' | 'timeout' | 'auth' | 'rate-limit' | 'invalid-input' | 'too-long';
  detail?: string;
  durationMs: number;
}

export type RunMatchResult = RunMatchSuccess | RunMatchFailure;

const REPLACE_HALF_M = 200;     // each via's local replacement window radius
const VIA_RADIUS_M_FOR_LOCAL = 25;
const MAX_VIAS = 5;
/** Per-edit-session cache. Key = (origLen + viaCount + viaFingerprint). */
const sessionCache = new Map<string, LngLat[]>();

function cacheKey(origPoints: LngLat[], vias: ViaPoint[]): string {
  // Cheap fingerprint: length + first/last point of original + each via.
  const o0 = origPoints[0];
  const oN = origPoints[origPoints.length - 1];
  const op = origPoints.length;
  const viaPart = vias
    .map(v => `${v.lng.toFixed(5)},${v.lat.toFixed(5)}`)
    .join('|');
  return `${op}_${o0?.lng.toFixed(5)}_${o0?.lat.toFixed(5)}_${oN?.lng.toFixed(5)}_${oN?.lat.toFixed(5)}_${viaPart}`;
}

export function clearMatchCache(): void {
  sessionCache.clear();
}

function cumulativeArc(coords: LngLat[]): number[] {
  const arc = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length; i++) {
    arc[i] = arc[i - 1] + haversineMeters(coords[i - 1], coords[i]);
  }
  return arc;
}

function projectArc(p: LngLat, poly: LngLat[], arc: number[]): number {
  // Find arc-length position on poly closest to p.
  let bestArc = 0;
  let bestDist = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const segLen = arc[i] - arc[i - 1];
    if (segLen < 1e-6) continue;
    // Equirectangular projection at mid-lat.
    const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
    const cosLat = Math.cos(midLat);
    const M = 111000;
    const ax = a.lng * cosLat * M;
    const ay = a.lat * M;
    const bx = b.lng * cosLat * M;
    const by = b.lat * M;
    const px = p.lng * cosLat * M;
    const py = p.lat * M;
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
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < bestDist) {
      bestDist = d;
      bestArc = arc[i - 1] + t * segLen;
    }
  }
  return bestArc;
}

/** Find original index whose arc length is at least `targetArc`. */
function indexAtArc(arc: number[], targetArc: number): number {
  for (let i = 0; i < arc.length; i++) {
    if (arc[i] >= targetArc) return i;
  }
  return arc.length - 1;
}

/** Linear-interp the lng/lat at an exact arc value between known sample points. */
function pointAtArc(orig: LngLat[], arc: number[], targetArc: number): LngLat {
  if (targetArc <= 0) return orig[0];
  const total = arc[arc.length - 1];
  if (targetArc >= total) return orig[orig.length - 1];
  for (let i = 1; i < arc.length; i++) {
    if (arc[i] >= targetArc) {
      const segLen = arc[i] - arc[i - 1];
      if (segLen < 1e-6) return orig[i];
      const t = (targetArc - arc[i - 1]) / segLen;
      const a = orig[i - 1];
      const b = orig[i];
      return { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
    }
  }
  return orig[orig.length - 1];
}

interface ReplaceWindow {
  startArc: number;
  endArc: number;
  vias: ViaPoint[];
}

function buildWindows(
  arc: number[],
  vias: { via: ViaPoint; arcM: number }[],
): ReplaceWindow[] {
  if (vias.length === 0) return [];
  const sorted = [...vias].sort((a, b) => a.arcM - b.arcM);
  const total = arc[arc.length - 1];
  const wins: ReplaceWindow[] = [];
  for (const v of sorted) {
    const s = Math.max(0, v.arcM - REPLACE_HALF_M);
    const e = Math.min(total, v.arcM + REPLACE_HALF_M);
    if (wins.length > 0 && wins[wins.length - 1].endArc >= s) {
      // Merge with previous overlapping window.
      const prev = wins[wins.length - 1];
      prev.endArc = Math.max(prev.endArc, e);
      prev.vias.push(v.via);
    } else {
      wins.push({ startArc: s, endArc: e, vias: [v.via] });
    }
  }
  return wins;
}

export async function runMapMatching(args: RunMatchArgs): Promise<RunMatchResult> {
  const t0 = Date.now();
  const orig = args.originalPoints;
  const vias = args.viaPoints;

  if (orig.length < 2) {
    return {
      ok: false,
      reason: 'invalid-input',
      detail: 'too few originalPoints',
      durationMs: Date.now() - t0,
    };
  }

  // No vias: matched = original (no API call).
  if (vias.length === 0) {
    return {
      ok: true,
      matchedPoints: orig.slice(),
      worstConfidence: 1,
      durationMs: Date.now() - t0,
      segmentCount: 0,
      cached: false,
    };
  }

  if (vias.length > MAX_VIAS) {
    return {
      ok: false,
      reason: 'invalid-input',
      detail: `too many vias (${vias.length} > ${MAX_VIAS})`,
      durationMs: Date.now() - t0,
    };
  }

  // Cache check.
  const key = cacheKey(orig, vias);
  const cached = sessionCache.get(key);
  if (cached) {
    return {
      ok: true,
      matchedPoints: cached,
      worstConfidence: 1,
      durationMs: Date.now() - t0,
      segmentCount: 0,
      cached: true,
    };
  }

  // Build replace windows.
  const arc = cumulativeArc(orig);
  const projected = vias.map(v => ({
    via: v,
    arcM: projectArc({ lng: v.lng, lat: v.lat }, orig, arc),
  }));
  const windows = buildWindows(arc, projected);

  // For each window, run a tiny Map Matching call with [start, ...vias, end].
  let worstConfidence = 1;
  const replacedSegments: Array<{ startArc: number; endArc: number; matched: LngLat[] }> = [];
  for (const w of windows) {
    const startCoord = pointAtArc(orig, arc, w.startArc);
    const endCoord = pointAtArc(orig, arc, w.endArc);
    const sortedWindowVias = [...w.vias].sort(
      (a, b) =>
        haversineMeters(startCoord, { lng: a.lng, lat: a.lat }) -
        haversineMeters(startCoord, { lng: b.lng, lat: b.lat }),
    );
    const coords: LngLat[] = [
      startCoord,
      ...sortedWindowVias.map(v => ({ lng: v.lng, lat: v.lat })),
      endCoord,
    ];
    const radiuses: (number | null)[] = coords.map((_, i) => {
      if (i === 0 || i === coords.length - 1) return null; // endpoint default
      return VIA_RADIUS_M_FOR_LOCAL;
    });
    const seg: MatchSegment = { coords, radiuses, viaIndicesInCoords: [] };
    const r: MatchResult = await matchSegment(seg);
    if (!r.ok) {
      return {
        ok: false,
        reason: r.reason,
        detail: r.detail,
        durationMs: Date.now() - t0,
      };
    }
    if (r.confidence < worstConfidence) worstConfidence = r.confidence;
    replacedSegments.push({
      startArc: w.startArc,
      endArc: w.endArc,
      matched: r.matchedPoints,
    });
  }

  // Stitch: walk originalPoints; outside any window → keep; inside → swap
  // for the matched polyline.
  const out: LngLat[] = [];
  let cursor = 0;
  let i = 0;
  while (i < orig.length) {
    // Find next window whose startArc is at or after cursor's arc.
    const win = replacedSegments.find(
      w => w.startArc >= cursor - 0.001 && w.startArc <= arc[arc.length - 1],
    );
    if (!win || win.startArc > arc[i]) {
      out.push(orig[i]);
      cursor = arc[i];
      i++;
      continue;
    }
    // Push everything in originalPoints up to (but not including) the
    // window start.
    while (i < orig.length && arc[i] < win.startArc) {
      out.push(orig[i]);
      i++;
    }
    // Append the matched window polyline.
    for (const p of win.matched) out.push(p);
    // Skip originalPoints inside the window.
    while (i < orig.length && arc[i] <= win.endArc) {
      i++;
    }
    cursor = win.endArc;
    // Mark this window consumed by removing it.
    const idx = replacedSegments.indexOf(win);
    replacedSegments.splice(idx, 1);
  }

  // Cache + return.
  sessionCache.set(key, out);
  // Cap cache size.
  if (sessionCache.size > 50) {
    const firstKey = sessionCache.keys().next().value;
    if (firstKey) sessionCache.delete(firstKey);
  }

  return {
    ok: true,
    matchedPoints: out,
    worstConfidence,
    durationMs: Date.now() - t0,
    segmentCount: windows.length,
    cached: false,
  };
}
