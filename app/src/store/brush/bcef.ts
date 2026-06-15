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
 *   spliceBCEF, BcefItem             — assemble final route
 *   baselineSlice, baselineTotalArc  — baseline helpers
 *   haversineMetersLocal, lerpLocal  — re-exported geom helpers
 */

import type { LngLat } from '../../services/routing/corridor/PolylineSampler';

// ── constants ────────────────────────────────────────────────────────────
export const CORRIDOR_M = 250; // brush must stay within 250m of baseline
export const LOOP_MIN_M = 5;   // |B - C| < 5m → reject as loop

// ── primitive helpers ────────────────────────────────────────────────────

export function haversineMetersLocal(a: LngLat, b: LngLat): number {
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

export function lerpLocal(a: LngLat, b: LngLat, t: number): LngLat {
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

export interface BcefItem {
  arcB: number;
  arcC: number;
  curve: LngLat[];
}

/**
 * v260 BCEF splice — replaces v259 spliceMatched anchor-replace logic.
 *
 * Each item in `items` represents one accepted stroke:
 *   - arcB: baseline arc where brush START projects
 *   - arcC: baseline arc where brush END projects
 *   - curve: Mapbox /matching response with [B, ...brush, C] as input.
 *     curve[0] ≈ B (within OSM-snap tolerance ~ 1-10m typical, 50m worst);
 *     curve[last] ≈ C similarly.
 *
 * Output = baseline-prefix + (curves in arc order, reversed if reverse-drawn)
 *          + baseline-suffix, then dedupe + despik.
 *
 * Multi-stroke: items are sorted by min(arcB, arcC). Overlapping arc ranges
 * with the previous item are skipped (caller should have merged overlapping
 * strokes pre-Mapbox).
 */
export function spliceBCEF(
  baseline: LngLat[],
  items: BcefItem[],
): LngLat[] {
  if (items.length === 0) return [...baseline];
  const sortable = items.map(it => ({
    arcMin: Math.min(it.arcB, it.arcC),
    arcMax: Math.max(it.arcB, it.arcC),
    reversed: it.arcB > it.arcC,
    curve: it.curve,
  }));
  sortable.sort((a, b) => a.arcMin - b.arcMin);

  const out: LngLat[] = [];
  let cursorArc = 0;
  for (const it of sortable) {
    if (it.arcMin < cursorArc) continue;
    const prefix = baselineSlice(baseline, cursorArc, it.arcMin);
    for (const p of prefix) out.push(p);
    const curve = it.reversed ? [...it.curve].reverse() : it.curve;
    for (const p of curve) out.push(p);
    cursorArc = it.arcMax;
  }
  const totalArc = baselineTotalArc(baseline);
  const suffix = baselineSlice(baseline, cursorArc, totalArc);
  for (const p of suffix) out.push(p);

  // Dedupe within 0.5m + alt repair.
  if (out.length < 2) return out;
  const deduped: LngLat[] = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (haversineMetersLocal(prev, out[i]) > 0.5) {
      deduped.push(out[i]);
    } else if (prev.alt == null && out[i].alt != null) {
      deduped[deduped.length - 1] = { ...prev, alt: out[i].alt };
    }
  }
  // Despike: a → b → c with hav(a,c) < 1m AND hav(a,b) > 4m AND hav(b,c) > 4m.
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
      despik[despik.length - 1] = c;
    } else {
      despik.push(c);
    }
  }
  return despik;
}

export function baselineTotalArc(baseline: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < baseline.length; i++) {
    total += haversineMetersLocal(baseline[i - 1], baseline[i]);
  }
  return total;
}

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
