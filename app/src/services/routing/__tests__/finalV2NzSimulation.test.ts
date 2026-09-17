import { haversineM } from '../../../utils/geo';
import {
  buildBaseFinalGeometry,
  reconstructPedestrianFinalRoute,
} from '../pedestrianFinalRoute';
import type { RawPoint } from '../snapTrack';

// Public Mapbox walking candidate captured for the Kepler Track prototype.
// It is trail reference geometry, not user or Activity data.
const keplerCandidate = require('../../../../.mapbox-test/case_D_Kepler.json')
  .routes[0].geometry.coordinates as Array<[number, number]>;

function routePoints(coordinates: Array<[number, number]>, sampleEvery = 1): RawPoint[] {
  return coordinates
    .filter((_coordinate, index) => index % sampleEvery === 0 || index === coordinates.length - 1)
    .map(([lng, lat], index) => ({ lat, lng, t: index * 30_000, accuracy: 8 }));
}

function offset(point: RawPoint, eastM: number, northM: number, accuracy: number): RawPoint {
  return {
    ...point,
    lat: point.lat + northM / 111_320,
    lng: point.lng + eastM / (111_320 * Math.cos(point.lat * Math.PI / 180)),
    accuracy,
  };
}

function length(points: ReadonlyArray<{ lat: number; lng: number }>): number {
  return points.slice(1).reduce((sum, point, index) => sum + haversineM(points[index], point), 0);
}

describe('Final V2 NZ simulation — offline evidence', () => {
  test('preserves the Kepler mountain route structure under deterministic forest drift', () => {
    const reference = routePoints(keplerCandidate);
    const degraded = reference.map((point, index) => offset(
      point,
      Math.sin(index * 1.7) * (index % 9 === 0 ? 11 : 3.2),
      Math.cos(index * 1.2) * (index % 11 === 0 ? 9 : 2.4),
      index % 9 === 0 ? 22 : 9,
    ));
    const base = buildBaseFinalGeometry(degraded);
    const referenceLength = length(reference);
    const baseLength = length(base.points);
    const endpointDistance = haversineM(base.points[0], base.points.at(-1)!);

    expect(base.diagnostics.corridorClass).toBe('complex');
    expect(base.diagnostics.protectedTurnCount).toBeGreaterThanOrEqual(3);
    expect(baseLength / referenceLength).toBeGreaterThan(0.88);
    expect(baseLength / referenceLength).toBeLessThan(1.15);
    // The winding mountain trail must not collapse to a start/end chord.
    expect(baseLength / endpointDistance).toBeGreaterThan(1.35);
    expect(base.points[0]).toMatchObject({ lat: degraded[0].lat, lng: degraded[0].lng });
    expect(base.points.at(-1)).toMatchObject({ lat: degraded.at(-1)!.lat, lng: degraded.at(-1)!.lng });
  });

  test('cleans a straight valley corridor without requiring network evidence', async () => {
    const start = { lat: -44, lng: 168, t: 0, accuracy: 14 };
    const degraded = Array.from({ length: 121 }, (_, index) => offset(
      { ...start, t: index * 5_000 },
      index * 5,
      Math.sin(index * 1.1) * 2.8 + (index % 29 === 0 ? 4 : 0),
      index % 29 === 0 ? 20 : 12,
    ));
    const base = buildBaseFinalGeometry(degraded);
    const result = await reconstructPedestrianFinalRoute(degraded, {
      mapboxToken: '',
      totalTimeoutMs: 20,
    });

    expect(base.diagnostics.corridorClass).toBe('simple');
    expect(length(base.points)).toBeLessThan(length(degraded));
    expect(length(base.points)).toBeLessThan(645);
    expect(result.stats.mapMatchingRequestCount).toBe(0);
    expect(result.stats.directionsRequestCount).toBe(0);
    expect(result.stats.algorithmVersion).toBe('pedestrian-final-v2-base');
  });

  test('retains sparse/batched Kepler observations as a recognizable trail', () => {
    const sparse = routePoints(keplerCandidate, 3).map((point, index) => offset(
      point,
      Math.sin(index) * 3,
      Math.cos(index * 0.8) * 3,
      18,
    ));
    const base = buildBaseFinalGeometry(sparse);
    const sparseLength = length(sparse);
    expect(length(base.points) / sparseLength).toBeGreaterThan(0.92);
    expect(base.diagnostics.protectedTurnCount).toBeGreaterThan(0);
  });
});
