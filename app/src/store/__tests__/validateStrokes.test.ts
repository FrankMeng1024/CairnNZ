/**
 * validateStrokes unit tests — verify the v245 brush save-time validator.
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

import { validateStrokes, type ValidatedStroke } from '../useRouteEditStore';
import type { BrushStroke } from '../useRouteEditStore';
import { PointCloudIndex } from '../../services/routing/corridor/PointCloudIndex';
import type { LngLat } from '../../services/routing/corridor/PolylineSampler';

function makeOriginal(): { pts: LngLat[]; index: PointCloudIndex } {
  // 1 km straight line east at NZ latitude
  const pts: LngLat[] = [];
  for (let i = 0; i <= 100; i++) {
    pts.push({ lng: 174.7000 + i * 0.0001, lat: -41.2900 });
  }
  const index = new PointCloudIndex(
    pts.map((p, i) => ({ lng: p.lng, lat: p.lat, source: 'original' as const, refId: `o:${i}` })),
  );
  return { pts, index };
}

function stroke(id: string, points: LngLat[]): BrushStroke {
  return { id, points };
}

describe('validateStrokes', () => {
  it('returns ok=true for empty stroke list', () => {
    const { pts, index } = makeOriginal();
    const r = validateStrokes([], pts, index);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.validated).toHaveLength(0);
  });

  it('rejects stroke whose start is far off-route', () => {
    const { pts, index } = makeOriginal();
    const s = stroke('s1', [
      { lng: 174.8500, lat: -41.2900 }, // ~10 km east
      pts[60],
    ]);
    const r = validateStrokes([s], pts, index);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/start is not on the route/);
  });

  it('rejects stroke whose end is far off-route', () => {
    const { pts, index } = makeOriginal();
    const s = stroke('s1', [pts[10], { lng: 174.8500, lat: -41.2900 }]);
    const r = validateStrokes([s], pts, index);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/end is not on the route/);
  });

  it('rejects stroke containing a point ≥ 500 m away (red zone)', () => {
    const { pts, index } = makeOriginal();
    // start + end on route, middle point ~1 km north of route
    const middle: LngLat = { lng: 174.7050, lat: -41.2810 }; // ~1 km north
    const s = stroke('s1', [pts[10], middle, pts[60]]);
    const r = validateStrokes([s], pts, index);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/beyond 500m/);
  });

  it('accepts stroke that stays within 500 m and endpoints on route', () => {
    const { pts, index } = makeOriginal();
    // gentle bump: ~100 m north
    const middle: LngLat = { lng: 174.7050, lat: -41.2891 }; // ~100 m
    const s = stroke('s1', [pts[10], middle, pts[60]]);
    const r = validateStrokes([s], pts, index);
    expect(r.ok).toBe(true);
    expect(r.validated).toHaveLength(1);
    expect(r.validated[0].arcStart).toBeLessThan(r.validated[0].arcEnd);
  });

  it('rejects two strokes overlapping on the route arc-range', () => {
    const { pts, index } = makeOriginal();
    const middle: LngLat = { lng: 174.7050, lat: -41.2891 };
    // stroke A covers indices 10..60
    const a = stroke('a', [pts[10], middle, pts[60]]);
    // stroke B starts inside A's arc range
    const b = stroke('b', [pts[40], { lng: 174.7060, lat: -41.2891 }, pts[80]]);
    const r = validateStrokes([a, b], pts, index);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /overlap/i.test(e))).toBe(true);
  });

  it('accepts two non-overlapping strokes', () => {
    const { pts, index } = makeOriginal();
    const m1: LngLat = { lng: 174.7020, lat: -41.2891 };
    const m2: LngLat = { lng: 174.7080, lat: -41.2891 };
    const a = stroke('a', [pts[10], m1, pts[30]]);
    const b = stroke('b', [pts[60], m2, pts[80]]);
    const r = validateStrokes([a, b], pts, index);
    expect(r.ok).toBe(true);
    expect(r.validated).toHaveLength(2);
  });

  it('skips zero-or-one-point strokes silently', () => {
    const { pts, index } = makeOriginal();
    const empty = stroke('e', []);
    const single = stroke('o', [pts[5]]);
    const r = validateStrokes([empty, single], pts, index);
    expect(r.ok).toBe(true);
    expect(r.validated).toHaveLength(0);
  });
});
