/**
 * Unit tests — fogBuilder
 *
 * Verifies the GeoJSON polygon-with-holes structure produced from
 * explored tiles.
 */

import { buildFogPolygon, countHoles } from '../src/features/memory/services/fogBuilder';
import { ExploredTile } from '../src/features/memory/store/useMemoryStore';

function fakeTile(z: number, x: number, y: number): ExploredTile {
  return {
    key: `${z}/${x}/${y}`,
    bitmap: new Uint8Array(2048),
    firstSeenAt: 0,
    lastSeenAt: 0,
  };
}

describe('fogBuilder · buildFogPolygon', () => {
  it('produces a Polygon with one outer ring when there are no holes', () => {
    const f = buildFogPolygon([]);
    expect(f.type).toBe('Feature');
    expect(f.geometry.type).toBe('Polygon');
    expect(f.geometry.coordinates.length).toBe(1);
    expect(countHoles(f)).toBe(0);
  });

  it('adds one hole per explored tile', () => {
    const f = buildFogPolygon([
      fakeTile(17, 100, 200),
      fakeTile(17, 101, 200),
      fakeTile(17, 102, 200),
    ]);
    expect(f.geometry.coordinates.length).toBe(4); // 1 outer + 3 holes
    expect(countHoles(f)).toBe(3);
  });

  it('outer ring spans the whole world', () => {
    const f = buildFogPolygon([]);
    const outer = f.geometry.coordinates[0];
    // First and last coordinate identical (closed ring)
    expect(outer[0]).toEqual(outer[outer.length - 1]);
    // Bounds should be ~global
    const lngs = outer.map((p) => p[0]);
    expect(Math.min(...lngs)).toBe(-180);
    expect(Math.max(...lngs)).toBe(180);
  });

  it('skips malformed tile keys without throwing', () => {
    const malformed: ExploredTile = {
      key: 'not-a-tile-key',
      bitmap: new Uint8Array(2048),
      firstSeenAt: 0, lastSeenAt: 0,
    };
    expect(() => buildFogPolygon([malformed])).not.toThrow();
    const f = buildFogPolygon([malformed]);
    expect(countHoles(f)).toBe(0);
  });
});
