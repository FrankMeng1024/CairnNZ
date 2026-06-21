/**
 * Unit tests — fogBuilder
 *
 * Verifies the GeoJSON polygon-with-holes structure produced from
 * visited GPS points and a viewport bounds rectangle.
 */

import { buildFogPolygon, countHoles, FogBounds } from '../src/features/memory/services/fogBuilder';
import { VisitedPoint } from '../src/features/memory/store/useMemoryStore';

function p(lat: number, lng: number): VisitedPoint {
  return { lat, lng, ts: 0, cid: `test-${lat}-${lng}` };
}

// A test viewport roughly centered on the test points (Shanghai-ish).
const TEST_BOUNDS: FogBounds = {
  west: 121.42,
  east: 121.46,
  north: 31.26,
  south: 31.22,
};

describe('fogBuilder · buildFogPolygon', () => {
  it('produces a Polygon with one outer ring when there are no points', () => {
    const f = buildFogPolygon([], TEST_BOUNDS);
    expect(f.type).toBe('Feature');
    expect(f.geometry.type).toBe('Polygon');
    expect(f.geometry.coordinates.length).toBe(1);
    expect(countHoles(f)).toBe(0);
  });

  it('adds one circular hole per visited point', () => {
    const f = buildFogPolygon([
      p(31.230, 121.430),
      p(31.240, 121.440),  // far enough to keep, > 12.5m cull
      p(31.250, 121.450),
    ], TEST_BOUNDS);
    expect(f.geometry.coordinates.length).toBe(4); // 1 outer + 3 holes
    expect(countHoles(f)).toBe(3);
  });

  it('culls near-duplicate points (within 12.5m)', () => {
    const f = buildFogPolygon([
      p(31.230, 121.430),
      p(31.230 + 0.00005, 121.430), // ~5.5m north — culled
      p(31.230 + 0.00010, 121.430), // ~11m north — still culled (<12.5)
    ], TEST_BOUNDS);
    expect(countHoles(f)).toBe(1);
  });

  it('outer ring is bounds-relative (NOT world-spanning)', () => {
    const f = buildFogPolygon([], TEST_BOUNDS);
    const outer = f.geometry.coordinates[0];
    // First == last (closed ring)
    expect(outer[0]).toEqual(outer[outer.length - 1]);
    // Outer is the bounds box plus a 2x pad on each side (per
    // FogConfig.outerRingPadFactor=2 default). Width is 0.04°
    // → pad 0.08° → outer west = 121.42 - 0.08 = 121.34.
    const lngs = outer.map((c) => c[0]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    expect(minLng).toBeLessThan(TEST_BOUNDS.west);
    expect(maxLng).toBeGreaterThan(TEST_BOUNDS.east);
    // But NOT world-spanning — must stay finite and reasonable
    expect(minLng).toBeGreaterThan(-180);
    expect(maxLng).toBeLessThan(180);
  });

  it('skips malformed points without throwing', () => {
    const malformed = [
      p(NaN, 121.430),
      { lat: 'not-a-number' as any, lng: 121.430, ts: 0, cid: 'malformed' },
    ];
    expect(() => buildFogPolygon(malformed as VisitedPoint[], TEST_BOUNDS)).not.toThrow();
    const f = buildFogPolygon(malformed as VisitedPoint[], TEST_BOUNDS);
    expect(countHoles(f)).toBe(0);
  });

  it('each circle hole has FogConfig.circleVertices + 1 closing vertices', () => {
    const f = buildFogPolygon([p(31.230, 121.430)], TEST_BOUNDS);
    const hole = f.geometry.coordinates[1];
    // 32 from default FogConfig.circleVertices + 1 closing
    expect(hole.length).toBe(33);
    expect(hole[0]).toEqual(hole[hole.length - 1]);
  });
});
