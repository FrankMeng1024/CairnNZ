import { haversineM } from '../../../utils/geo';
import type { TrackPoint } from '../../../store/useSessionStore';
import {
  activityDistanceEstimate,
  appendActivityDistancePoint,
  buildActivityDistanceAccumulator,
  calculateActivityStats,
} from '../activityContracts';

const METRES_PER_DEGREE = 111_320;
const ORIGIN = { lat: -42, lng: 172 };

function point(eastM: number, northM: number, t: number, options: Partial<TrackPoint> = {}): TrackPoint {
  return {
    lat: ORIGIN.lat + northM / METRES_PER_DEGREE,
    lng: ORIGIN.lng + eastM / (
      METRES_PER_DEGREE * Math.cos(ORIGIN.lat * Math.PI / 180)
    ),
    t,
    segmentId: 'segment-a',
    accuracy: 8,
    speed: 1.25,
    ...options,
  };
}

function straightCorrelated(seed: number, speed: number | null = 1.25): TrackPoint[] {
  return Array.from({ length: 70 }, (_, index) => point(
    index * 1.25 + 0.3 * Math.sin(index * 0.41 + seed),
    Math.sin(index * 1.3 + seed) + 0.6 * Math.sin(index * 0.29 + seed),
    1_800_100_000_000 + index * 1_000,
    { speed },
  ));
}

describe('Activity distance evidence estimate', () => {
  test.each([
    ['declared calibration seed', 11],
    ['held-out seed 29', 29],
    ['held-out seed 47', 47],
  ])('%s keeps coherent straight-corridor metric error below the declared 3% gate', (_name, seed) => {
    const points = straightCorrelated(seed);
    const truthM = 69 * 1.25;
    const rawGeometryM = points.slice(1).reduce(
      (sum, next, index) => sum + haversineM(points[index], next),
      0,
    );
    const estimate = activityDistanceEstimate(buildActivityDistanceAccumulator(points));

    expect((rawGeometryM / truthM - 1) * 100).toBeGreaterThan(15);
    expect(Math.abs((estimate.distanceM / truthM - 1) * 100)).toBeLessThan(3);
    expect(estimate.method).toBe('reported-speed-corroborated');
    expect(estimate.reportedSpeedCoverage).toBe(1);
  });

  test('missing scalar speed retains coordinate progression instead of becoming zero distance', () => {
    const points = straightCorrelated(29, null);
    const rawGeometryM = points.slice(1).reduce(
      (sum, next, index) => sum + haversineM(points[index], next),
      0,
    );
    const estimate = activityDistanceEstimate(buildActivityDistanceAccumulator(points));

    expect(estimate.method).toBe('geometry');
    expect(estimate.distanceM).toBeCloseTo(rawGeometryM, 5);
    expect(estimate.distanceM).toBeGreaterThan(80);
  });

  test('zero-speed contradiction cannot erase sustained coordinate movement', () => {
    const points = Array.from({ length: 12 }, (_, index) => point(
      index * 3,
      0,
      1_800_100_000_000 + index * 2_000,
      { speed: 0, speedAccuracy: 0.2 },
    ));
    const estimate = activityDistanceEstimate(buildActivityDistanceAccumulator(points));

    expect(estimate.method).toBe('geometry');
    expect(estimate.distanceM).toBeGreaterThan(32);
  });

  test('segment changes retain gaps as zero-distance evidence boundaries', () => {
    const points = [
      point(0, 0, 1_000),
      point(10, 0, 9_000),
      point(1_000, 0, 20_000, { segmentId: 'segment-b' }),
      point(1_010, 0, 28_000, { segmentId: 'segment-b' }),
    ];
    const stats = calculateActivityStats(points);

    expect(stats.distanceM).toBeGreaterThan(19);
    expect(stats.distanceM).toBeLessThan(21);
  });

  test('incremental accumulator and replay reconstruction are identical', () => {
    const points = straightCorrelated(47);
    const prefix = buildActivityDistanceAccumulator(points.slice(0, 31));
    const resumed = points.slice(31).reduce(
      appendActivityDistancePoint,
      prefix,
    );
    const replayed = buildActivityDistanceAccumulator(points);

    expect(activityDistanceEstimate(resumed)).toEqual(activityDistanceEstimate(replayed));
  });
});
