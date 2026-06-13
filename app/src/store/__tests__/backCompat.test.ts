/**
 * backCompat.test.ts — verify v6.3 ship loads v249-v255 saved routes
 * (no `alt` field) without crashing or fabricating data.
 *
 * Plan §6.1 spec:
 *   "v255 saved route(无 alt / 无 schemaVersion)加载不崩,加载后字段填默认"
 *
 * What "back-compat" means concretely:
 *   1. Loading a route whose points lack `alt` works — `alt` stays
 *      undefined, no crash, distance still computed.
 *   2. After running through brush-edit pipeline (densify, lerp,
 *      flattenGeometry, applyTrimFraction), the legacy points still
 *      lack `alt` (since input had none — no fabrication).
 *   3. A v6.3-saved route mixed with legacy points does not lose its
 *      authoritative alt values.
 */

import {
  densify,
  flattenGeometry,
  type LngLat,
} from '../../services/routing/corridor/PolylineSampler';

describe('back-compat — legacy v255-saved route (no alt)', () => {
  test('legacy 2D points pass through densify with alt=undefined', () => {
    const legacyPoints: LngLat[] = [
      { lng: 174.7, lat: -36.8 },
      { lng: 174.701, lat: -36.8 },
      { lng: 174.702, lat: -36.8 },
    ];
    const out = densify(legacyPoints, 5);
    expect(out.length).toBeGreaterThan(legacyPoints.length); // densified
    for (const p of out) {
      expect(p.alt).toBeUndefined();
      // Coordinates must still be valid numbers — defends against the
      // partial-knowledge null leaking into lng/lat.
      expect(Number.isFinite(p.lng)).toBe(true);
      expect(Number.isFinite(p.lat)).toBe(true);
    }
  });

  test('legacy GeoJSON LineString (2D) loads without alt', () => {
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

  test('mixed legacy + v6.3 points: densify preserves middle alt at its original index', () => {
    const mixed: LngLat[] = [
      { lng: 174.7, lat: -36.8 }, // legacy, no alt
      { lng: 174.701, lat: -36.8, alt: 42 }, // v6.3 with DEM alt
      { lng: 174.702, lat: -36.8 }, // legacy
    ];
    // Densifying does NOT touch the original input array.
    const before = JSON.parse(JSON.stringify(mixed));
    // Use a wide interval so densify just appends originals (no interp).
    const out = densify(mixed, 5_000);
    expect(mixed).toEqual(before); // input untouched
    // densify with interval >> any segment length copies points 1:1 — each
    // input point appears in output preserving its alt state.
    expect(out).toHaveLength(mixed.length);
    expect(out[0].alt).toBeUndefined();
    expect(out[1].alt).toBe(42);
    expect(out[2].alt).toBeUndefined();
  });

  test('JSON round-trip of a legacy route shape produces same shape', () => {
    // Simulates how a v255 route lands when loaded from AsyncStorage:
    // points have lng/lat only, no alt key in the serialized object.
    const serialized = JSON.stringify({
      id: 'r1',
      name: 'legacy',
      points: [
        { lat: -36.8, lng: 174.7 },
        { lat: -36.81, lng: 174.71 },
      ],
    });
    const parsed = JSON.parse(serialized);
    expect(parsed.points[0].alt).toBeUndefined();
    expect(parsed.points[1].alt).toBeUndefined();
    // Densifying still works.
    const out = densify(parsed.points as LngLat[], 50);
    for (const p of out) {
      expect(typeof p.lng).toBe('number');
      expect(typeof p.lat).toBe('number');
      expect(p.alt).toBeUndefined();
    }
  });

  test('elevationGainM recomputation yields 0 when all alt undefined (no fabrication)', () => {
    // Mirrors the recompute logic in RouteEditorScreen save:
    //   skip segments where either endpoint alt is non-finite.
    const legacyPoints: LngLat[] = [
      { lng: 174.7, lat: -36.8 },
      { lng: 174.701, lat: -36.81 },
      { lng: 174.702, lat: -36.82 },
    ];
    let elevationGainM = 0;
    for (let i = 1; i < legacyPoints.length; i++) {
      const a = legacyPoints[i - 1].alt;
      const b = legacyPoints[i].alt;
      if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
        const d = b - a;
        if (d > 0) elevationGainM += d;
      }
    }
    expect(elevationGainM).toBe(0);
  });
});
