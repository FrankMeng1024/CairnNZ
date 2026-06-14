/**
 * strokeSimplify.ts — brush-edit stroke vertex reduction
 *
 * Mapbox /matching/v5 hard-caps at 100 coordinates per call.
 * Empirically (spike-corridor-100v-results.md), realistic city strokes
 * over ~100m at default mobile sample density produce 100-500+ vertices.
 *
 * Strategy (v6.3, plan §1.1):
 *   1. If ≤ 100 vertices: use as-is.
 *   2. Try Douglas-Peucker with ε ∈ {5, 10, 20, 40} meters in escalation.
 *      Empirically ε=5m recovers 21/26 (81%) of corpus 422 cases.
 *   3. If even ε=40 still leaves > 100 vertices, fall back to uniform
 *      sampling that preserves overall stroke geometry (NOT slice(0, N)
 *      which truncates the tail — R2 BLOCK from V6_3_FINAL_R2_REVIEW.md).
 *
 * Pure functions; no side effects; no I/O. Unit-tested.
 */

import type { LngLat } from '../services/routing/corridor/PolylineSampler';

/** Mapbox /matching/v5 hard limit per call (per docs). */
export const MAPBOX_MATCHING_MAX_COORDS = 100;

/** DP epsilon escalation ladder (meters). v6.3 plan §1.1 — empirical. */
export const DP_EPSILON_LADDER_M = [5, 10, 20, 40] as const;

/** Hard upper bound on raw input — defense against memory blow-up (plan §1.5). */
export const MAX_STROKE_VERTICES_INPUT = 2000;

const EARTH_RADIUS_M = 6_371_000;

/**
 * Approximate perpendicular distance (meters) from point P to segment AB.
 * Uses equirectangular projection — fine at the 5-40m scales we operate in
 * for any real-world brush stroke.
 */
function perpDistanceM(p: LngLat, a: LngLat, b: LngLat): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  // Equirectangular: project to local meters around A
  const cosLat = Math.cos(toRad(a.lat));
  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * cosLat * EARTH_RADIUS_M * (Math.PI / 180);
  const by = (b.lat - a.lat) * EARTH_RADIUS_M * (Math.PI / 180);
  const px = (p.lng - a.lng) * cosLat * EARTH_RADIUS_M * (Math.PI / 180);
  const py = (p.lat - a.lat) * EARTH_RADIUS_M * (Math.PI / 180);

  const dx = bx - ax;
  const dy = by - ay;
  const segLenSq = dx * dx + dy * dy;
  if (segLenSq < 1e-9) {
    // A ≈ B; return distance P→A
    return Math.sqrt(px * px + py * py);
  }
  // Perpendicular from P to infinite line AB (we don't clamp t; for DP
  // the perpendicular distance to the chord is what's wanted regardless
  // of segment endpoints).
  const t = (px * dx + py * dy) / segLenSq;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ddx = px - cx;
  const ddy = py - cy;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

/**
 * Douglas-Peucker simplification.
 * @param points  Input polyline.
 * @param epsM    Tolerance in meters; vertices within epsM of the chord drop.
 * @returns Simplified polyline. Endpoints always retained.
 *
 * Iterative implementation (no recursion — avoids stack blow-up on
 * pathological 2000-vertex inputs). O(N²) worst case, but typical 200-500
 * city strokes resolve in well under a millisecond.
 */
export function douglasPeucker(points: LngLat[], epsM: number): LngLat[] {
  if (points.length <= 2) return points.slice();
  if (epsM <= 0) return points.slice();

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Stack of [startIdx, endIdx] segments to process.
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    if (e - s < 2) continue; // No interior point to consider.
    let maxDist = -1;
    let maxIdx = -1;
    const a = points[s];
    const b = points[e];
    for (let i = s + 1; i < e; i++) {
      const d = perpDistanceM(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsM && maxIdx > 0) {
      keep[maxIdx] = true;
      stack.push([s, maxIdx]);
      stack.push([maxIdx, e]);
    }
  }

  const out: LngLat[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

/**
 * Uniform spacing fallback — pick `targetCount` points evenly across the
 * input array (preserving first and last). Used when DP at ε=40m still
 * leaves >100 vertices (very rare; e.g., a 5km stroke at 5m density).
 *
 * Critical contract: NEVER return only the head of the array (slice(0,N)
 * loses the tail and corrupts the stroke geometry — see R2 review).
 */
export function uniformSample(points: LngLat[], targetCount: number): LngLat[] {
  if (targetCount < 2) {
    // Pathological caller — return endpoints only.
    return points.length === 0 ? [] : [points[0], points[points.length - 1]];
  }
  if (points.length <= targetCount) return points.slice();

  const step = (points.length - 1) / (targetCount - 1);
  const out: LngLat[] = [];
  let lastIdx = -1;
  for (let i = 0; i < targetCount; i++) {
    const idx = Math.round(i * step);
    if (idx !== lastIdx) {
      out.push(points[idx]);
      lastIdx = idx;
    }
  }
  // Guarantee last point retained even if rounding collapsed it.
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

/**
 * Reason for simplify outcome — useful for telemetry (plan §13.1).
 */
export type SimplifyReason =
  | 'unchanged'           // ≤ 100 vertices, no simplify applied
  | `dp_eps_${number}`    // DP at this epsilon succeeded
  | 'uniform_fallback'    // DP ladder exhausted, used uniform sampling
  | 'rejected_too_long';  // Input > MAX_STROKE_VERTICES_INPUT

export interface SimplifyResult {
  points: LngLat[];
  reason: SimplifyReason;
  inputCount: number;
  outputCount: number;
}

/**
 * Pre-call stroke simplification per v6.3 plan §1.1.
 *
 * Returns either the original points (if already short enough) or a
 * simplified copy with ≤ MAPBOX_MATCHING_MAX_COORDS vertices.
 *
 * Caller MUST check `reason !== 'rejected_too_long'` and the post-condition
 * `points.length >= 2` (plan §1.5 G0_post_simplify) before sending to
 * Mapbox.
 */
export function simplifyStroke(points: LngLat[]): SimplifyResult {
  const inputCount = points.length;

  if (inputCount > MAX_STROKE_VERTICES_INPUT) {
    return {
      points: [],
      reason: 'rejected_too_long',
      inputCount,
      outputCount: 0,
    };
  }

  if (inputCount <= MAPBOX_MATCHING_MAX_COORDS) {
    return {
      points: points.slice(),
      reason: 'unchanged',
      inputCount,
      outputCount: inputCount,
    };
  }

  const MIN_DENSE_OUTPUT = 60;
  for (const eps of DP_EPSILON_LADDER_M) {
    const simplified = douglasPeucker(points, eps);
    if (simplified.length <= MAPBOX_MATCHING_MAX_COORDS) {
      // Accept ONLY if dense enough; otherwise fall through to uniform
      // sampling. Sparse DP outputs (e.g., route 4 case: 159 → 19 pts
      // with 239m mid-gap) leave Mapbox HMM unable to constrain the
      // path and produce degenerate straight lines through buildings.
      if (simplified.length >= MIN_DENSE_OUTPUT) {
        return {
          points: simplified,
          reason: `dp_eps_${eps}` as SimplifyReason,
          inputCount,
          outputCount: simplified.length,
        };
      }
      // Too sparse — break out of ladder and use uniform sampling instead.
      // (Larger ε values would only produce even sparser results.)
      break;
    }
  }

  // No ε produced a dense-enough result. Use uniform sampling at exactly
  // MAPBOX_MATCHING_MAX_COORDS — guarantees max density per Mapbox cap.
  // This branch fires when the user drew a very long stroke (>>500m at
  // 5m sampling = 100+ raw points whose detail compresses heavily); the
  // DP-sparse fallback (bestSimplified) would have left mid gaps too
  // large, but uniform 100 caps gap at stroke_length / 100.
  const sampled = uniformSample(points, MAPBOX_MATCHING_MAX_COORDS);
  return {
    points: sampled,
    reason: 'uniform_fallback',
    inputCount,
    outputCount: sampled.length,
  };
}
