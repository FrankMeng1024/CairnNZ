/**
 * strokeSimplify.test.ts — unit tests for v6.3 brush stroke simplifier.
 *
 * Plan §6.1 spec:
 *   "顶点 200 → DP ε=5/10/20/40 阶梯 → ≤100;
 *    200 顶点 ε 全 fail → uniformSample 100 点覆盖整笔"
 */

import {
  simplifyStroke,
  douglasPeucker,
  uniformSample,
  MAPBOX_MATCHING_MAX_COORDS,
  MAX_STROKE_VERTICES_INPUT,
} from '../strokeSimplify';
import type { LngLat } from '../../services/routing/corridor/PolylineSampler';

/** Build a synthetic stroke along a straight line in lng/lat space. */
function straightLine(n: number, fromLng = 174.7, fromLat = -36.8, toLng = 174.71, toLat = -36.81): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    out.push({
      lng: fromLng + (toLng - fromLng) * t,
      lat: fromLat + (toLat - fromLat) * t,
    });
  }
  return out;
}

/** Build a stroke that bends — with a real ~50m kink in the middle. */
function bentLine(n: number): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const lat = -36.8 + 0.001 * t;
    // Halfway through, a bend ~50m east.
    const bend = t > 0.4 && t < 0.6 ? 0.0005 : 0;
    out.push({ lng: 174.7 + bend, lat });
  }
  return out;
}

describe('simplifyStroke', () => {
  test('passes short stroke unchanged (≤100 vertices)', () => {
    const stroke = straightLine(50);
    const result = simplifyStroke(stroke);
    expect(result.reason).toBe('unchanged');
    expect(result.outputCount).toBe(50);
    expect(result.points).toEqual(stroke);
  });

  test('passes stroke at exact cap unchanged', () => {
    const stroke = straightLine(MAPBOX_MATCHING_MAX_COORDS);
    const result = simplifyStroke(stroke);
    expect(result.reason).toBe('unchanged');
    expect(result.outputCount).toBe(MAPBOX_MATCHING_MAX_COORDS);
  });

  test('200-vertex straight stroke reduces via DP ε=5m', () => {
    // A perfectly straight 200-vertex line at any ε > 0 collapses to 2.
    const stroke = straightLine(200);
    const result = simplifyStroke(stroke);
    expect(result.reason).toBe('dp_eps_5');
    expect(result.outputCount).toBeLessThanOrEqual(MAPBOX_MATCHING_MAX_COORDS);
    expect(result.outputCount).toBeGreaterThanOrEqual(2);
    // First and last preserved.
    expect(result.points[0]).toEqual(stroke[0]);
    expect(result.points[result.points.length - 1]).toEqual(stroke[stroke.length - 1]);
  });

  test('200-vertex bent stroke preserves the bend', () => {
    const stroke = bentLine(200);
    const result = simplifyStroke(stroke);
    expect(result.outputCount).toBeLessThanOrEqual(MAPBOX_MATCHING_MAX_COORDS);
    expect(result.outputCount).toBeGreaterThanOrEqual(3); // start, bend area, end
    // First and last preserved.
    expect(result.points[0]).toEqual(stroke[0]);
    expect(result.points[result.points.length - 1]).toEqual(stroke[stroke.length - 1]);
  });

  test('uniform fallback engages when DP ladder exhausted (very wiggly stroke)', () => {
    // Build a stroke with high-frequency 50m-amplitude noise that DP at
    // ε=40 cannot simplify below 100. Each pair of adjacent points alternates
    // ~50m offset. Note: using 250 points means even ε=40 keeps too many.
    const n = 250;
    const stroke: LngLat[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const wiggle = i % 2 === 0 ? 0.0005 : -0.0005; // ~55m amplitude
      stroke.push({
        lng: 174.7 + 0.001 * t + wiggle,
        lat: -36.8 + 0.001 * t,
      });
    }
    const result = simplifyStroke(stroke);
    expect(result.outputCount).toBeLessThanOrEqual(MAPBOX_MATCHING_MAX_COORDS);
    expect(result.outputCount).toBeGreaterThanOrEqual(2);
    // Either DP succeeded at one of the higher epsilons, OR uniform fallback.
    // Either way, must NOT be the broken slice(0, 100) — verify by checking
    // that the LAST point is preserved (slice(0, 100) on a 250-array would
    // drop indices 100-249 entirely).
    const last = result.points[result.points.length - 1];
    expect(last.lng).toBeCloseTo(stroke[n - 1].lng, 6);
    expect(last.lat).toBeCloseTo(stroke[n - 1].lat, 6);
  });

  test('rejects > MAX_STROKE_VERTICES_INPUT (memory protection)', () => {
    const stroke = straightLine(MAX_STROKE_VERTICES_INPUT + 1);
    const result = simplifyStroke(stroke);
    expect(result.reason).toBe('rejected_too_long');
    expect(result.points).toEqual([]);
    expect(result.outputCount).toBe(0);
  });

  test('input array unchanged (no mutation)', () => {
    const stroke = straightLine(200);
    const before = JSON.parse(JSON.stringify(stroke));
    simplifyStroke(stroke);
    expect(stroke).toEqual(before);
  });
});

describe('douglasPeucker', () => {
  test('handles 0/1/2-point input without simplifying', () => {
    expect(douglasPeucker([], 5)).toEqual([]);
    expect(douglasPeucker([{ lng: 1, lat: 1 }], 5)).toEqual([{ lng: 1, lat: 1 }]);
    const two: LngLat[] = [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }];
    expect(douglasPeucker(two, 5)).toEqual(two);
  });

  test('straight line collapses to 2 points at any positive ε', () => {
    const stroke = straightLine(50);
    const result = douglasPeucker(stroke, 1);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual(stroke[0]);
    expect(result[1]).toEqual(stroke[stroke.length - 1]);
  });

  test('ε=0 returns input unchanged', () => {
    const stroke = bentLine(20);
    const result = douglasPeucker(stroke, 0);
    expect(result).toEqual(stroke);
  });

  test('preserves geometry within ε tolerance', () => {
    const stroke = bentLine(50);
    const result = douglasPeucker(stroke, 5);
    // Must include first & last.
    expect(result[0]).toEqual(stroke[0]);
    expect(result[result.length - 1]).toEqual(stroke[stroke.length - 1]);
    // Bend not lost.
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  test('does not blow stack on 2000-vertex input (iterative)', () => {
    const stroke = straightLine(2000);
    expect(() => douglasPeucker(stroke, 1)).not.toThrow();
  });
});

describe('uniformSample', () => {
  test('returns input when shorter than target', () => {
    const stroke = straightLine(10);
    expect(uniformSample(stroke, 50)).toEqual(stroke);
  });

  test('preserves first and last points', () => {
    const stroke = straightLine(500);
    const result = uniformSample(stroke, 100);
    expect(result[0]).toEqual(stroke[0]);
    expect(result[result.length - 1]).toEqual(stroke[stroke.length - 1]);
  });

  test('output count ≤ targetCount', () => {
    const stroke = straightLine(500);
    const result = uniformSample(stroke, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  test('output covers full stroke (NOT a head slice)', () => {
    // R2 BLOCK regression: slice(0, 100) on 500 points loses 80% of the stroke.
    const stroke = straightLine(500);
    const result = uniformSample(stroke, 100);
    // Last point of result must be near last point of input — i.e. covers full span.
    const last = result[result.length - 1];
    expect(last.lng).toBeCloseTo(stroke[499].lng, 6);
    expect(last.lat).toBeCloseTo(stroke[499].lat, 6);
  });

  test('handles pathological targetCount<2', () => {
    const stroke = straightLine(10);
    expect(uniformSample([], 0)).toEqual([]);
    const r = uniformSample(stroke, 1);
    expect(r.length).toBe(2);
    expect(r[0]).toEqual(stroke[0]);
    expect(r[1]).toEqual(stroke[stroke.length - 1]);
  });
});
