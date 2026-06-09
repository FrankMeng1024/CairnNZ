/**
 * CorridorQuery unit tests.
 */
import { isPointInCorridor, isPolylineInCorridor } from '../CorridorQuery';
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

describe('isPolylineInCorridor', () => {
  it('returns ok:true when all points within radius', () => {
    const idx = makeIndex([
      { lng: 174.78, lat: -41.29 },
      { lng: 174.79, lat: -41.29 },
      { lng: 174.80, lat: -41.29 },
    ]);
    const polyline = [
      { lng: 174.78, lat: -41.29 },
      { lng: 174.79, lat: -41.29 },
    ];
    const result = isPolylineInCorridor(polyline, idx, 1500);
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with firstOutsideIdx', () => {
    const idx = makeIndex([{ lng: 174.78, lat: -41.29 }]);
    const polyline = [
      { lng: 174.78, lat: -41.29 },
      { lng: 175.78, lat: -41.29 }, // far outside
    ];
    const result = isPolylineInCorridor(polyline, idx, 1000);
    expect(result.ok).toBe(false);
    expect(result.firstOutsideIdx).toBe(1);
  });

  it('handles empty polyline as ok:true', () => {
    const idx = makeIndex([{ lng: 174.78, lat: -41.29 }]);
    const result = isPolylineInCorridor([], idx, 1000);
    expect(result.ok).toBe(true);
  });
});
