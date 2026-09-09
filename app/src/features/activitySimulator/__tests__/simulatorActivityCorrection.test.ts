import type { TrackPoint } from '../../../store/useSessionStore';
import { destinationPoint } from '../geodesy';
import { planSimulatorRollback } from '../simulatorActivityCorrection';

function routeWithTenMetreEdges(edgeCount: number, segmentId = 'segment-a'): TrackPoint[] {
  const points: TrackPoint[] = [{
    lat: -45.0312,
    lng: 168.6626,
    t: 1_000,
    alt: 100,
    segmentId,
  }];
  for (let index = 1; index <= edgeCount; index += 1) {
    const next = destinationPoint(points[index - 1], 90, 10);
    points.push({
      ...next,
      t: 1_000 + index * 10_000,
      alt: 100 + index,
      segmentId,
    });
  }
  return points;
}

describe('Simulator accepted-route rollback planning', () => {
  test.each([10, 25, 50, 100])('removes whole committed tail points for %dm', requested => {
    const plan = planSimulatorRollback(routeWithTenMetreEdges(14), requested);
    expect(plan).not.toBeNull();
    expect(plan!.actualDistanceM).toBeGreaterThanOrEqual(requested);
    expect(plan!.actualDistanceM).toBeLessThan(requested + 10.1);
    expect(plan!.keptPoints.length + plan!.removedPoints.length).toBe(15);
    expect(plan!.keptPoints.length).toBeGreaterThanOrEqual(1);
  });

  test('segment connectors contribute zero distance while rollback crosses any number of gaps', () => {
    const first = routeWithTenMetreEdges(2, 'segment-1');
    const secondOrigin: TrackPoint = {
      lat: 35.6762,
      lng: 139.6503,
      t: 40_000,
      alt: 20,
      segmentId: 'segment-2',
      segmentStartReason: 'gps-reacquired',
    };
    const secondTail = destinationPoint(secondOrigin, 0, 10);
    const thirdOrigin: TrackPoint = {
      lat: 69.6492,
      lng: 18.9553,
      t: 60_000,
      alt: 5,
      segmentId: 'segment-3',
      segmentStartReason: 'gps-reacquired',
    };
    const points = [
      ...first,
      secondOrigin,
      { ...secondTail, t: 50_000, alt: 21, segmentId: 'segment-2' },
      thirdOrigin,
    ];
    const plan = planSimulatorRollback(points, 25);
    expect(plan).not.toBeNull();
    // 10m in segment 2 + 20m in segment 1. Tokyo/Arctic connectors add zero.
    expect(plan!.actualDistanceM).toBeCloseTo(30, 1);
    expect(plan!.keptPoints).toHaveLength(1);
  });

  test('never removes the initial Activity origin', () => {
    const plan = planSimulatorRollback(routeWithTenMetreEdges(2), 1_000);
    expect(plan).not.toBeNull();
    expect(plan!.keptPoints).toHaveLength(1);
    expect(plan!.keptPoints[0].t).toBe(1_000);
  });

  test('rejects correction when no committed route edge exists', () => {
    expect(planSimulatorRollback(routeWithTenMetreEdges(0), 50)).toBeNull();
    expect(planSimulatorRollback(routeWithTenMetreEdges(2), 0)).toBeNull();
  });
});
