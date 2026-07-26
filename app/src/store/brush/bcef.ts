/**
 * brush/bcef.ts — v260+ Brush-CEF (Curve-with-Endpoint-anchors-from-baseline)
 *
 * The BCEF flow replaces v249-v259's spliceMatched anchor-replace logic.
 * Pure functions — no state, no I/O.
 *
 * Why a separate module:
 *   - Enables a self-test harness (scripts/brush_self_test.ts) to import
 *     and exercise the exact same code that production runs, without
 *     pulling in zustand store dependencies.
 *   - Lets jest unit-test the geometric primitives (corridor, splice,
 *     baselineSlice) in isolation.
 *   - useRouteEditStore.ts re-exports these via import — runtime behavior
 *     unchanged, refactor only.
 *
 * Public surface:
 *   CORRIDOR_M, LOOP_MIN_M           — gate constants
 *   projectPointOntoBaseline         — sub-vertex projection
 *   strokeWithinCorridor             — corridor gate
 *   spliceBCEF, BcefItem             — removed O1 batch 40 (0 external callers)
 *   baselineSlice                   — baseline helper (baselineTotalArc removed O1 batch 40)
 *   haversineMetersLocal, lerpLocal  — re-exported geom helpers
 */

import type { LngLat } from '../../services/routing/corridor/PolylineSampler';

// ── constants ────────────────────────────────────────────────────────────
export const CORRIDOR_M = 250; // brush must stay within 250m of baseline
export const LOOP_MIN_M = 5;   // |B - C| < 5m → reject as loop

// ── primitive helpers ────────────────────────────────────────────────────

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
  if (a.alt != null && b.alt != null) {
    out.alt = a.alt + (b.alt - a.alt) * tt;
  } else if (a.alt != null || b.alt != null) {
    out.alt = null;
  }
  return out;
}

// ── BCEF core ────────────────────────────────────────────────────────────

/**
 * Project a single point onto baseline polyline, returning the foot
 * (in baseline-segment local coords), arc-distance from baseline start,
 * and segment index. Sub-vertex precision (lerp on the matched segment).
 */
export function projectPointOntoBaseline(
  p: LngLat,
  baseline: LngLat[],
): { pt: LngLat; arc: number; dist: number; segIdx: number } | null {
  if (baseline.length < 2) return null;
  let bestArc = 0;
  let bestPt: LngLat = baseline[0];
  let bestDist = Infinity;
  let bestSegIdx = 0;
  let acc = 0;
  for (let i = 1; i < baseline.length; i++) {
    const a = baseline[i - 1];
    const b = baseline[i];
    const segLen = haversineMetersLocal(a, b);
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
    let t = lenSq < 1e-9 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const fx = ax + t * dx;
    const fy = ay + t * dy;
    const d = Math.hypot(px - fx, py - fy);
    if (d < bestDist) {
      bestDist = d;
      bestPt = { lng: fx / (cosLat * M_PER_DEG), lat: fy / M_PER_DEG };
      bestArc = acc + t * segLen;
      bestSegIdx = i - 1;
    }
    acc += segLen;
  }
  return { pt: bestPt, arc: bestArc, dist: bestDist, segIdx: bestSegIdx };
}

/**
 * v260 corridor check — every point of a brush stroke must be within
 * CORRIDOR_M of the baseline. PO rule: brush area = solid 250m corridor
 * only, dashed preview-area is "doesn't exist".
 */
export function strokeWithinCorridor(
  stroke: LngLat[],
  baseline: LngLat[],
): { ok: boolean; maxDistM: number } {
  let maxDist = 0;
  for (const p of stroke) {
    const proj = projectPointOntoBaseline(p, baseline);
    if (!proj) return { ok: false, maxDistM: Infinity };
    if (proj.dist > maxDist) maxDist = proj.dist;
  }
  return { ok: maxDist <= CORRIDOR_M, maxDistM: maxDist };
}

// O1 batch 40: BcefItem interface, spliceBCEF, baselineTotalArc removed — 0 external callers.

/**
 * Slice baseline by arc range, synthesizing lerp vertices at exact start/end
 * arcs. Returns [] if start >= end. Inclusive of synthesized boundary points.
 */
export function baselineSlice(
  baseline: LngLat[],
  arcStart: number,
  arcEnd: number,
): LngLat[] {
  if (arcEnd <= arcStart || baseline.length < 2) return [];
  const out: LngLat[] = [];
  let acc = 0;
  let started = false;
  for (let i = 1; i < baseline.length; i++) {
    const a = baseline[i - 1];
    const b = baseline[i];
    const segLen = haversineMetersLocal(a, b);
    const segEnd = acc + segLen;
    if (!started) {
      if (segEnd >= arcStart) {
        const t = segLen > 0 ? (arcStart - acc) / segLen : 0;
        if (t > 0 && t < 1) {
          out.push(lerpLocal(a, b, t));
        } else if (t <= 0) {
          out.push(a);
        }
        if (segEnd >= arcEnd) {
          const t2 = segLen > 0 ? (arcEnd - acc) / segLen : 1;
          out.push(lerpLocal(a, b, t2));
          return out;
        }
        out.push(b);
        started = true;
      }
    } else {
      if (segEnd >= arcEnd) {
        const t = segLen > 0 ? (arcEnd - acc) / segLen : 1;
        out.push(lerpLocal(a, b, t));
        return out;
      }
      out.push(b);
    }
    acc = segEnd;
  }
  return out;
}
