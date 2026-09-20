/**
 * CorridorQuery unit tests.
 */
import { isPointInCorridor } from '../CorridorQuery';
import { PointCloudIndex, IndexedPoint } from '../PointCloudIndex';

function makeIndex(points: Array<{ lng: number; lat: number }>): PointCloudIndex {
  const indexed: IndexedPoint[] = points.map((p, i) => ({
    lng: p.lng,
    lat: p.lat,
    source: 'original',
    refId: `p${i}`,
  }));
  return new PointCloudIndex(indexed);
}

describe('isPointInCorridor', () => {
  it('returns false on empty index', () => {
    const idx = makeIndex([]);
    const result = isPointInCorridor(174.78, -41.29, idx, 1000);
    expect(result.inCorridor).toBe(false);
    expect(result.distanceToWalkedM).toBe(Infinity);
  });

  it('returns true within radius', () => {
    const idx = makeIndex([{ lng: 174.78, lat: -41.29 }]);
    const result = isPointInCorridor(174.78, -41.29, idx, 1000);
    expect(result.inCorridor).toBe(true);
    expect(result.distanceToWalkedM).toBeLessThan(1);
  });

  it('returns false outside radius', () => {
    // 174.78 to 175.78 = ~85km in NZ latitudes — far outside 1km
    const idx = makeIndex([{ lng: 174.78, lat: -41.29 }]);
    const result = isPointInCorridor(175.78, -41.29, idx, 1000);
    expect(result.inCorridor).toBe(false);
    expect(result.distanceToWalkedM).toBeGreaterThan(50000);
  });

  it('reports distance to nearest even when outside', () => {
    const idx = makeIndex([{ lng: 174.78, lat: -41.29 }]);
    // ~5km away
    const result = isPointInCorridor(174.84, -41.29, idx, 1000);
    expect(result.inCorridor).toBe(false);
    expect(result.distanceToWalkedM).toBeGreaterThan(4000);
    expect(result.distanceToWalkedM).toBeLessThan(6000);
  });
});
