import {
  destinationPoint,
  distanceMeters,
  normalizeLongitude,
  validateCoordinate,
} from '../geodesy';

describe('Activity Simulator worldwide geodesy', () => {
  test.each([
    [-45.0312, 168.6626], // Queenstown
    [31.2304, 121.4737],  // Shanghai
    [35.6762, 139.6503],  // Tokyo
    [51.5072, -0.1276],   // London
    [64.1466, -21.9426],  // Iceland
    [78.2232, 15.6469],   // high latitude
  ])('accepts worldwide coordinate %s,%s', (lat, lng) => {
    const result = validateCoordinate(lat, lng);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.coordinate.lat).toBe(lat);
      expect(result.coordinate.lng).toBeCloseTo(lng, 10);
    }
  });

  test('validates latitude and normalizes arbitrary longitude', () => {
    expect(validateCoordinate(91, 0)).toEqual(expect.objectContaining({ ok: false }));
    expect(validateCoordinate(-91, 0)).toEqual(expect.objectContaining({ ok: false }));
    expect(validateCoordinate(10, 540)).toEqual({ ok: true, coordinate: { lat: 10, lng: -180 } });
    expect(normalizeLongitude(-541)).toBe(179);
  });

  test('moves by metres at high latitude without invalid coordinates', () => {
    const start = { lat: 78.2232, lng: 15.6469 };
    const moved = destinationPoint(start, 90, 1_000);
    expect(moved.lat).toBeGreaterThanOrEqual(-90);
    expect(moved.lat).toBeLessThanOrEqual(90);
    expect(moved.lng).toBeGreaterThanOrEqual(-180);
    expect(moved.lng).toBeLessThanOrEqual(180);
    expect(distanceMeters(start, moved)).toBeCloseTo(1_000, 3);
  });

  test('crosses the International Date Line with canonical longitude', () => {
    const start = { lat: 0, lng: 179.999 };
    const moved = destinationPoint(start, 90, 500);
    expect(moved.lng).toBeLessThan(0);
    expect(moved.lng).toBeGreaterThanOrEqual(-180);
    expect(distanceMeters(start, moved)).toBeCloseTo(500, 3);
  });

  test('north/south reversal returns to the origin while retaining travelled distance', () => {
    const start = { lat: -45, lng: 168 };
    const outbound = destinationPoint(start, 0, 250);
    const returned = destinationPoint(outbound, 180, 250);
    expect(distanceMeters(start, returned)).toBeLessThan(0.01);
    expect(distanceMeters(start, outbound) + distanceMeters(outbound, returned)).toBeCloseTo(500, 2);
  });
});
