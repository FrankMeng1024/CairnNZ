/**
 * PointCloudIndex unit tests — focused on the .nearest() distance ordering
 * regression caught by Phase 6a v2 review (Sprint 66 Fix-10 / C3).
 */
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

describe('PointCloudIndex.nearest', () => {
  it('returns empty array when index is empty', () => {
    const idx = makeIndex([]);
    expect(idx.nearest(174.78, -41.29, 1)).toEqual([]);
  });

  it('returns the actual nearest point first (regression: was using kdbush.within order)', () => {
    // 3 points at increasing distances from (174.78, -41.29).
    // p0 is FAR; p1 is MEDIUM; p2 is CLOSEST. kdbush.within may return them
    // in arbitrary order; nearest() must sort by haversine.
    const points = [
      { lng: 174.79, lat: -41.29 }, // ~880m east — FAR
      { lng: 174.785, lat: -41.29 }, // ~440m east — MEDIUM
      { lng: 174.7805, lat: -41.29 }, // ~44m east — CLOSEST
    ];
    const idx = makeIndex(points);
    const result = idx.nearest(174.78, -41.29, 1, 2000);
    expect(result.length).toBe(1);
    // Nearest is index 2 (the closest point).
    expect(result[0]).toBe(2);
  });

  it('returns k-nearest in ascending distance order', () => {
    const points = [
      { lng: 174.79, lat: -41.29 }, // ~880m
      { lng: 174.785, lat: -41.29 }, // ~440m
      { lng: 174.7805, lat: -41.29 }, // ~44m
    ];
    const idx = makeIndex(points);
    const result = idx.nearest(174.78, -41.29, 3, 2000);
    expect(result).toEqual([2, 1, 0]);
  });

  it('respects maxRadiusMeters', () => {
    const points = [
      { lng: 174.7805, lat: -41.29 }, // ~44m
      { lng: 174.79, lat: -41.29 }, // ~880m
    ];
    const idx = makeIndex(points);
    // 100m radius should only catch the first point
    const result = idx.nearest(174.78, -41.29, 5, 100);
    expect(result).toEqual([0]);
  });

  it('falls back to 10km default radius when maxRadiusMeters undefined', () => {
    const points = [
      { lng: 174.7805, lat: -41.29 }, // ~44m
    ];
    const idx = makeIndex(points);
    const result = idx.nearest(174.78, -41.29, 1);
    expect(result).toEqual([0]);
  });

  it('returns empty array when no points within radius', () => {
    const points = [
      { lng: 175.78, lat: -41.29 }, // ~85km away
    ];
    const idx = makeIndex(points);
    const result = idx.nearest(174.78, -41.29, 1, 1000);
    expect(result).toEqual([]);
  });
});

describe('PointCloudIndex.within', () => {
  it('returns all points within radius (post-filtered by haversine)', () => {
    const points = [
      { lng: 174.78, lat: -41.29 },     // 0m
      { lng: 174.7805, lat: -41.29 },   // ~44m
      { lng: 174.79, lat: -41.29 },     // ~880m
    ];
    const idx = makeIndex(points);
    const within500 = idx.within(174.78, -41.29, 500);
    expect(within500.length).toBe(2);
    expect(within500.sort()).toEqual([0, 1]);
  });

  it('returns empty when no points in radius', () => {
    const points = [{ lng: 175.78, lat: -41.29 }];
    const idx = makeIndex(points);
    expect(idx.within(174.78, -41.29, 100)).toEqual([]);
  });
});
