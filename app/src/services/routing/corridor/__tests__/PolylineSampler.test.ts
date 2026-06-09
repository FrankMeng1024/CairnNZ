/**
 * PolylineSampler unit tests (densify + haversine + flattenGeometry).
 */
import {
  haversineMeters,
  densify,
  flattenGeometry,
  polylineLengthM,
  LngLat,
} from '../PolylineSampler';

describe('haversineMeters', () => {
  it('zero distance for identical points', () => {
    const p: LngLat = { lng: 174.7762, lat: -41.2865 };
    expect(haversineMeters(p, p)).toBeCloseTo(0, 5);
  });

  it('Wellington railway → Te Papa ≈ 1km', () => {
    const a: LngLat = { lng: 174.7762, lat: -41.2865 };
    const b: LngLat = { lng: 174.7820, lat: -41.2930 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(800);
    expect(d).toBeLessThan(1300);
  });

  it('antipodal points yield ~half-Earth circumference', () => {
    const a: LngLat = { lng: 0, lat: 0 };
    const b: LngLat = { lng: 180, lat: 0 };
    const d = haversineMeters(a, b);
    expect(d).toBeCloseTo(20_015_000, -5); // ±100km tolerance
  });
});

describe('densify', () => {
  it('returns coords unchanged when already dense', () => {
    const coords: LngLat[] = [
      { lng: 174.7762, lat: -41.2865 },
      { lng: 174.7763, lat: -41.2866 },
    ];
    const result = densify(coords, 1000);
    expect(result.length).toBe(2);
  });

  it('inserts intermediate points when gap > interval', () => {
    const a: LngLat = { lng: 174.0, lat: -41.0 };
    const b: LngLat = { lng: 174.0, lat: -41.001 }; // ~111m apart
    const result = densify([a, b], 10);
    expect(result.length).toBeGreaterThan(5);
    expect(result[0]).toEqual(a);
    expect(result[result.length - 1]).toEqual(b);
  });

  it('handles empty / single-point input', () => {
    expect(densify([], 10)).toEqual([]);
    const single: LngLat = { lng: 1, lat: 1 };
    expect(densify([single], 10)).toEqual([single]);
  });

  it('preserves endpoints exactly', () => {
    const a: LngLat = { lng: 175.55, lat: -39.20 };
    const b: LngLat = { lng: 175.75, lat: -39.10 };
    const result = densify([a, b], 100);
    expect(result[0].lng).toBe(a.lng);
    expect(result[0].lat).toBe(a.lat);
    expect(result[result.length - 1].lng).toBe(b.lng);
    expect(result[result.length - 1].lat).toBe(b.lat);
  });
});

describe('flattenGeometry', () => {
  it('flattens LineString', () => {
    const geom = {
      type: 'LineString',
      coordinates: [[1, 2], [3, 4], [5, 6]],
    };
    const result = flattenGeometry(geom);
    expect(result).toEqual([
      { lng: 1, lat: 2 },
      { lng: 3, lat: 4 },
      { lng: 5, lat: 6 },
    ]);
  });

  it('flattens MultiLineString concatenating parts', () => {
    const geom = {
      type: 'MultiLineString',
      coordinates: [
        [[1, 2], [3, 4]],
        [[5, 6], [7, 8]],
      ],
    };
    const result = flattenGeometry(geom);
    expect(result.length).toBe(4);
    expect(result[0]).toEqual({ lng: 1, lat: 2 });
    expect(result[3]).toEqual({ lng: 7, lat: 8 });
  });

  it('returns empty array for unknown geometry type', () => {
    expect(flattenGeometry({ type: 'Point', coordinates: [1, 2] })).toEqual([]);
  });
});

describe('polylineLengthM', () => {
  it('zero length for empty / single point', () => {
    expect(polylineLengthM([])).toBe(0);
    expect(polylineLengthM([{ lng: 1, lat: 1 }])).toBe(0);
  });

  it('sums haversine over consecutive pairs', () => {
    const coords: LngLat[] = [
      { lng: 0, lat: 0 },
      { lng: 0.001, lat: 0 },
      { lng: 0.002, lat: 0 },
    ];
    const total = polylineLengthM(coords);
    // 2 segments × ~111m = ~222m
    expect(total).toBeGreaterThan(200);
    expect(total).toBeLessThan(250);
  });
});
