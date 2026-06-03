/**
 * Route Deviation + Waypoint Detection — Unit Tests
 * STORY-00155 + STORY-00156
 */
import {
  distanceToPolylineM,
  checkRouteDeviation,
  isWithinRadius,
  type Coordinate,
} from '../../utils/geo';

describe('distanceToPolylineM', () => {
  const route: Coordinate[] = [
    { lat: -39.200, lng: 175.600 },
    { lat: -39.200, lng: 175.610 },
    { lat: -39.200, lng: 175.620 },
  ];

  it('returns 0 when point is on the polyline', () => {
    const onRoute: Coordinate = { lat: -39.200, lng: 175.605 };
    const dist = distanceToPolylineM(onRoute, route);
    expect(dist).toBeLessThan(1); // < 1 meter
  });

  it('returns correct distance for point perpendicular to segment', () => {
    // Point 100m north of the route (approximately)
    const offRoute: Coordinate = { lat: -39.199, lng: 175.610 };
    const dist = distanceToPolylineM(offRoute, route);
    // ~111m per 0.001 degree latitude
    expect(dist).toBeGreaterThan(80);
    expect(dist).toBeLessThan(130);
  });

  it('returns distance to nearest endpoint for point beyond polyline', () => {
    const beyondEnd: Coordinate = { lat: -39.200, lng: 175.625 };
    const dist = distanceToPolylineM(beyondEnd, route);
    // ~500m east of last point (0.005 degree lng at -39 lat)
    expect(dist).toBeGreaterThan(300);
    expect(dist).toBeLessThan(600);
  });

  it('returns Infinity for empty polyline', () => {
    expect(distanceToPolylineM({ lat: 0, lng: 0 }, [])).toBe(Infinity);
  });

  it('returns distance to single point for single-point polyline', () => {
    const point: Coordinate = { lat: -39.201, lng: 175.600 };
    const dist = distanceToPolylineM(point, [{ lat: -39.200, lng: 175.600 }]);
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeLessThan(120);
  });
});

describe('checkRouteDeviation', () => {
  const route: Coordinate[] = [
    { lat: -39.200, lng: 175.600 },
    { lat: -39.200, lng: 175.610 },
    { lat: -39.200, lng: 175.620 },
  ];

  it('returns deviated=false when user is on route', () => {
    const result = checkRouteDeviation({ lat: -39.200, lng: 175.605 }, route);
    expect(result.deviated).toBe(false);
    expect(result.distanceM).toBeLessThan(50);
  });

  it('returns deviated=true when user is far from route', () => {
    const result = checkRouteDeviation({ lat: -39.205, lng: 175.610 }, route);
    expect(result.deviated).toBe(true);
    expect(result.distanceM).toBeGreaterThan(50);
  });

  it('respects custom threshold', () => {
    const pos: Coordinate = { lat: -39.2003, lng: 175.610 }; // ~33m off
    const result30 = checkRouteDeviation(pos, route, 30);
    const result50 = checkRouteDeviation(pos, route, 50);
    expect(result30.deviated).toBe(true);
    expect(result50.deviated).toBe(false);
  });
});

describe('isWithinRadius', () => {
  it('returns true when within radius', () => {
    // Same point
    expect(isWithinRadius({ lat: -39.200, lng: 175.600 }, -39.200, 175.600, 30)).toBe(true);
  });

  it('returns true at boundary', () => {
    // ~11m away (0.0001 degrees lat)
    expect(isWithinRadius({ lat: -39.2001, lng: 175.600 }, -39.200, 175.600, 30)).toBe(true);
  });

  it('returns false when outside radius', () => {
    // ~111m away (0.001 degrees lat)
    expect(isWithinRadius({ lat: -39.201, lng: 175.600 }, -39.200, 175.600, 30)).toBe(false);
  });
});
