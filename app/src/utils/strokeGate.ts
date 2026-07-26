/**
 * strokeGate.ts — brush-edit accept/reject gates (pure functions).
 *
 * v6.3 plan §1.3 + §1.5. Each gate returns a structured GateResult with
 * `metric_value` + `threshold` for telemetry (plan §13.1).
 *
 *   G0   — preflight (length 2..MAX_STROKE_VERTICES_INPUT)
 *   G0_post_simplify — after DP, must still have ≥2 points
 *   G0.5 — Mapbox response shape (matchings exists, geometry ≥2 points)
 *   G1   — anchor: stroke endpoint within ANCHOR_M of original route.
 *          IMPLEMENTED IN useRouteEditStore.validateStrokes /
 *          strokeAnchorsToBaseline. Not a free-standing helper here —
 *          the store version uses the kdbush walkedIndex for O(log N)
 *          nearest-neighbour queries (vs O(N) here) and is the
 *          authoritative gate. (R4 dead-code review.)
 *   G2   — Mapbox code === 'Ok' (handled in mapMatchClient layer; gate code asserts)
 *   G3   — corridor 250m: every snap polyline point within CORRIDOR_M of stroke
 *
 * NOTE: the post-hoc bearing gate (端点 bearing) is INTENTIONALLY ABSENT.
 * Empirically (spike-final-v63-product.md) it cuts URBAN MINOR recall from
 * 96.8% to 87.1% by killing legit corner/turn strokes. v6.4 will explore
 * per-segment bearing if telemetry shows demand.
 *
 * Pure; no I/O; no side effects.
 */

import type { LngLat } from '../services/routing/corridor/PolylineSampler';
import { MAPBOX_MATCHING_MAX_COORDS, MAX_STROKE_VERTICES_INPUT } from './strokeSimplify';

// === Thresholds (plan §1.3 — empirical, locked) =============================

/**
 * G1: anchor distance — stroke endpoint must be within this many meters of
 * the original route. Authoritative implementation lives in
 * useRouteEditStore.strokeAnchorsToBaseline (uses kdbush). This constant
 * is exported for documentation + telemetry payloads.
 */
export const ANCHOR_M = 50;

/** G3: every snap polyline point must be within this many meters of the stroke. */
export const CORRIDOR_M = 250;

// === Types ===================================================================

export type GateName =
  | 'G0'
  | 'G0_post_simplify'
  | 'G0_5'
  | 'G1'
  | 'G2'
  | 'G3';

export type GateReason =
  // G0
  | 'too_short'
  | 'too_long'
  // G0_post_simplify
  | 'too_short_after_simplify'
  // G0.5 (Mapbox response shape)
  | 'no_matchings'
  | 'snap_too_short'
  // G1
  | 'no_endpoint_near_route'
  // G2 (set in mapmatch client; surfaced here for completeness)
  | 'mapbox_nomatch'
  | 'mapbox_nosegment'
  | 'mapbox_4xx'
  | 'mapbox_5xx'
  | 'mapbox_timeout'
  | 'mapbox_aborted'
  | 'mapbox_other'
  // G3
  | 'snap_exits_corridor';

export interface GatePass {
  ok: true;
  gate: GateName;
}

export interface GateFail {
  ok: false;
  gate: GateName;
  reason: GateReason;
  /** Numeric measurement that triggered the failure (meters / count). null if not applicable. */
  metric_value: number | null;
  /** Threshold that the metric was compared against. null if not applicable. */
  threshold: number | null;
}

export type GateResult = GatePass | GateFail;

// === Geometry helpers (local, pure) =========================================

const EARTH_RADIUS_M = 6_371_000;

function haversineM(a: LngLat, b: LngLat): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Perpendicular distance (meters) from p to segment a-b, clamped at the
 * segment endpoints (i.e. proper segment distance, not infinite-line).
 * Equirectangular projection — accurate at the 0..1km scales we care about.
 */
function perpToSegmentM(p: LngLat, a: LngLat, b: LngLat): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
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
  if (segLenSq < 1e-9) return Math.hypot(px, py);
  let t = (px * dx + py * dy) / segLenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Min distance from point p to a polyline. Returns Infinity for empty polyline. */
function pointToPolylineM(p: LngLat, polyline: LngLat[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return haversineM(p, polyline[0]);
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = perpToSegmentM(p, polyline[i], polyline[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

// === G0 — preflight =========================================================

export function checkG0(stroke: LngLat[]): GateResult {
  if (stroke.length < 2) {
    return {
      ok: false,
      gate: 'G0',
      reason: 'too_short',
      metric_value: stroke.length,
      threshold: 2,
    };
  }
  if (stroke.length > MAX_STROKE_VERTICES_INPUT) {
    return {
      ok: false,
      gate: 'G0',
      reason: 'too_long',
      metric_value: stroke.length,
      threshold: MAX_STROKE_VERTICES_INPUT,
    };
  }
  return { ok: true, gate: 'G0' };
}

// === G0_post_simplify =======================================================

export function checkG0PostSimplify(simplified: LngLat[]): GateResult {
  if (simplified.length < 2) {
    return {
      ok: false,
      gate: 'G0_post_simplify',
      reason: 'too_short_after_simplify',
      metric_value: simplified.length,
      threshold: 2,
    };
  }
  return { ok: true, gate: 'G0_post_simplify' };
}

// === G0.5 — Mapbox response shape ===========================================

export function checkG0_5(snap: LngLat[]): GateResult {
  if (snap.length < 2) {
    return {
      ok: false,
      gate: 'G0_5',
      reason: 'snap_too_short',
      metric_value: snap.length,
      threshold: 2,
    };
  }
  return { ok: true, gate: 'G0_5' };
}

// === G1 — anchor ============================================================
// Authoritative implementation lives in useRouteEditStore.strokeAnchorsToBaseline
// (uses kdbush-backed PointCloudIndex for O(log N) nearest-neighbour queries
// vs the O(N) scan a free-standing helper here would need). We export
// ANCHOR_M as a documentation/telemetry constant only.
//
// (Pre-v6.3 R4 review found a free-standing checkG1 here that the
// store never imported — two parallel implementations of the same gate.
// Removed to enforce plan §1.3 "one unified gate path".)

// === G3 — corridor ==========================================================

export interface G3Input {
  /**
   * The user's drawn stroke (post-simplify). G3 rejects if Mapbox snapped
   * any output vertex more than CORRIDOR_M from this polyline. Empirically
   * (spike-corridor-100v-results.md) only ~0.5% of urban cases trigger.
   */
  stroke: LngLat[];
  snap: LngLat[];
}

export function checkG3({ stroke, snap }: G3Input): GateResult {
  if (stroke.length < 2 || snap.length < 2) {
    return {
      ok: false,
      gate: 'G3',
      reason: 'snap_exits_corridor',
      metric_value: null,
      threshold: CORRIDOR_M,
    };
  }
  for (const p of snap) {
    const d = pointToPolylineM(p, stroke);
    if (d > CORRIDOR_M) {
      return {
        ok: false,
        gate: 'G3',
        reason: 'snap_exits_corridor',
        metric_value: d,
        threshold: CORRIDOR_M,
      };
    }
  }
  return { ok: true, gate: 'G3' };
}

// === Re-exports (so callers import everything from one place) ===============

export { MAPBOX_MATCHING_MAX_COORDS, MAX_STROKE_VERTICES_INPUT };
