/**
 * Unit tests — fogBuilder
 *
 * Verifies the GeoJSON polygon-with-holes structure produced from
 * visited GPS points.
 */

import { buildFogPolygon, countHoles } from '../src/features/memory/services/fogBuilder';
import { VisitedPoint } from '../src/features/memory/store/useMemoryStore';

function p(lat: number, lng: number): VisitedPoint {
  return { lat, lng, ts: 0 };
}

describe('fogBuilder · buildFogPolygon', () => {
  it('produces a Polygon with one outer ring when there are no points', () => {
    const f = buildFogPolygon([]);
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
    ]);
    expect(f.geometry.coordinates.length).toBe(4); // 1 outer + 3 holes
    expect(countHoles(f)).toBe(3);
  });

  it('culls near-duplicate points (within 12.5m)', () => {
    const f = buildFogPolygon([
      p(31.230, 121.430),
      p(31.230 + 0.00005, 121.430), // ~5.5m north — culled
      p(31.230 + 0.00010, 121.430), // ~11m north — still culled (<12.5)
    ]);
    expect(countHoles(f)).toBe(1);
  });

  it('outer ring spans the whole world', () => {
    const f = buildFogPolygon([]);
    const outer = f.geometry.coordinates[0];
    expect(outer[0]).toEqual(outer[outer.length - 1]);
    const lngs = outer.map((c) => c[0]);
    expect(Math.min(...lngs)).toBe(-180);
    expect(Math.max(...lngs)).toBe(180);
  });

  it('skips malformed points without throwing', () => {
    const malformed = [
      p(NaN, 121.430),
      { lat: 'not-a-number' as any, lng: 121.430, ts: 0 },
    ];
    expect(() => buildFogPolygon(malformed as VisitedPoint[])).not.toThrow();
    const f = buildFogPolygon(malformed as VisitedPoint[]);
    expect(countHoles(f)).toBe(0);
  });

  it('each circle hole has 33 vertices (32 + 1 closing)', () => {
    const f = buildFogPolygon([p(31.230, 121.430)]);
    const hole = f.geometry.coordinates[1];
    expect(hole.length).toBe(33);
    expect(hole[0]).toEqual(hole[hole.length - 1]);
  });
});
