/**
 * altPreserve.test.ts — verify v6.3 alt-preservation contract through the
 * brush-edit pipeline (plan §2.2).
 *
 * Touchpoints:
 *   - PolylineSampler.densify (uses internal lerp)
 *   - PolylineSampler.flattenGeometry (reads GeoJSON 3rd dim)
 *   - useRouteEditStore.lerpLocal (private — tested through applyTrimFraction)
 *   - useRouteEditStore.spliceMatched dedupe (covered indirectly via
 *     applyTrimFraction; full splice is integration-tested in stage 5)
 *
 * Goal: confirm that valid `alt` values survive each stage and that
 * partial-knowledge edges (one side has alt, the other doesn't) do NOT
 * fabricate altitude.
 */

// Stub AsyncStorage before any import that pulls it in transitively.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
    multiGet: jest.fn(async () => []),
    multiRemove: jest.fn(async () => undefined),
  },
}));

import {
  densify,
  flattenGeometry,
  flattenGeometryToParts,
  type LngLat,
} from '../../services/routing/corridor/PolylineSampler';
import { applyTrimFraction } from '../useRouteEditStore';

describe('LngLat alt preservation — densify', () => {
  test('preserves alt when both endpoints have it (linear interpolation)', () => {
    const input: LngLat[] = [
      { lng: 174.7, lat: -36.8, alt: 100 },
      { lng: 174.7002, lat: -36.8, alt: 110 }, // ~18m east, +10m alt
    ];
    const out = densify(input, 5); // ~3 intervals
    expect(out[0].alt).toBe(100);
    expect(out[out.length - 1].alt).toBe(110);
    // Middle points should have alt strictly between endpoints.
    for (let i = 1; i < out.length - 1; i++) {
      expect(out[i].alt).toBeGreaterThan(100);
      expect(out[i].alt).toBeLessThan(110);
    }
  });

  test('passes through when no alt on input (back-compat)', () => {
    const input: LngLat[] = [
      { lng: 174.7, lat: -36.8 },
      { lng: 174.7002, lat: -36.8 },
    ];
    const out = densify(input, 5);
    for (const p of out) {
      expect(p.alt).toBeUndefined();
    }
  });

  test('partial alt knowledge → null on interpolated points (no fabrication)', () => {
    const input: LngLat[] = [
      { lng: 174.7, lat: -36.8, alt: 100 },
      { lng: 174.7002, lat: -36.8 }, // no alt
    ];
    const out = densify(input, 5);
    expect(out[0].alt).toBe(100);
    // EVERY interpolated point (including the last one, which densify
    // produces via lerp at t=1) is `null` — the partial-knowledge marker.
    // This is intentional: we never fabricate altitude when one endpoint
    // is missing it.
    for (let i = 1; i < out.length; i++) {
      expect(out[i].alt).toBeNull();
    }
  });
});

describe('flattenGeometry — alt from GeoJSON 3rd dim', () => {
  test('reads alt when GeoJSON LineString includes 3rd coord', () => {
    const geom = {
      type: 'LineString',
      coordinates: [
        [174.7, -36.8, 100],
        [174.701, -36.801, 105],
      ],
    };
    const out = flattenGeometry(geom);
    expect(out[0]).toEqual({ lng: 174.7, lat: -36.8, alt: 100 });
    expect(out[1]).toEqual({ lng: 174.701, lat: -36.801, alt: 105 });
  });

  test('omits alt when GeoJSON has only 2 dims', () => {
    const geom = {
      type: 'LineString',
      coordinates: [
        [174.7, -36.8],
        [174.701, -36.801],
      ],
    };
    const out = flattenGeometry(geom);
    for (const p of out) {
      expect(p.alt).toBeUndefined();
    }
  });

  test('rejects non-finite alt (e.g. NaN, Infinity)', () => {
    const geom = {
      type: 'LineString',
      coordinates: [
        [174.7, -36.8, NaN],
        [174.701, -36.801, Infinity],
      ],
    };
    const out = flattenGeometry(geom);
    for (const p of out) {
      expect(p.alt).toBeUndefined();
    }
  });

  test('handles MultiLineString with mixed alt presence', () => {
    const geom = {
      type: 'MultiLineString',
      coordinates: [
        [[174.7, -36.8, 100], [174.701, -36.801, 105]],
        [[174.71, -36.81], [174.711, -36.811]],
      ],
    };
    const out = flattenGeometry(geom);
    expect(out).toHaveLength(4);
    expect(out[0].alt).toBe(100);
    expect(out[1].alt).toBe(105);
    expect(out[2].alt).toBeUndefined();
    expect(out[3].alt).toBeUndefined();
  });

  test('flattenGeometryToParts preserves alt across parts', () => {
    const geom = {
      type: 'MultiLineString',
      coordinates: [
        [[174.7, -36.8, 100], [174.701, -36.8, 105]],
        [[174.71, -36.81, 200], [174.711, -36.81, 205]],
      ],
    };
    const parts = flattenGeometryToParts(geom);
    expect(parts).toHaveLength(2);
    expect(parts[0][0].alt).toBe(100);
    expect(parts[1][1].alt).toBe(205);
  });
});

describe('applyTrimFraction — alt preservation through trim', () => {
  test('keeps alt on retained vertices', () => {
    const poly: LngLat[] = [
      { lng: 174.7, lat: -36.8, alt: 100 },
      { lng: 174.701, lat: -36.8, alt: 110 },
      { lng: 174.702, lat: -36.8, alt: 120 },
      { lng: 174.703, lat: -36.8, alt: 130 },
      { lng: 174.704, lat: -36.8, alt: 140 },
    ];
    // Trim 0..1 (no clip) — must return identical input.
    const out = applyTrimFraction(poly, 0, 1);
    expect(out).toHaveLength(5);
    for (let i = 0; i < poly.length; i++) {
      expect(out[i].alt).toBe(poly[i].alt);
    }
  });

  test('interpolated trim boundary preserves alt (lerpLocal)', () => {
    const poly: LngLat[] = [
      { lng: 174.7, lat: -36.8, alt: 100 },
      { lng: 174.701, lat: -36.8, alt: 200 },
    ];
    // Trim 0.25..0.75 — boundary points are interpolated.
    const out = applyTrimFraction(poly, 0.25, 0.75);
    expect(out.length).toBeGreaterThanOrEqual(2);
    // First point should be ~125m alt (25% between 100 and 200).
    expect(out[0].alt).toBeGreaterThanOrEqual(120);
    expect(out[0].alt).toBeLessThanOrEqual(130);
    // Last point ~175m alt.
    const last = out[out.length - 1];
    expect(last.alt).toBeGreaterThanOrEqual(170);
    expect(last.alt).toBeLessThanOrEqual(180);
  });

  test('partial alt knowledge → null at interpolated boundary', () => {
    const poly: LngLat[] = [
      { lng: 174.7, lat: -36.8, alt: 100 },
      { lng: 174.701, lat: -36.8 }, // no alt
    ];
    const out = applyTrimFraction(poly, 0.25, 0.75);
    // The trim boundary points are interpolated and at least one has the
    // partial-knowledge null marker.
    const hasNullAlt = out.some(p => p.alt === null);
    expect(hasNullAlt).toBe(true);
  });
});
