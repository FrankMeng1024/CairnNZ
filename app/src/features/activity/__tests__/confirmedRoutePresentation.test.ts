import {
  buildConfirmedRouteSegments,
  createIncrementalRoutePresentation,
  continuousRouteAnimationDurationMs,
  isAppendOnlyRouteUpdate,
  MAX_CONTINUOUS_ROUTE_MUTABLE_POINTS,
  MAX_LIVE_ROUTE_HEAD_POINTS,
  planContinuousRouteTarget,
  updateIncrementalRoutePresentation,
} from '../confirmedRoutePresentation';

const point = (eastM: number, t: number, segmentId = 'a') => ({
  lat: -41,
  lng: 174 + eastM / (111_320 * Math.cos(-41 * Math.PI / 180)),
  t,
  segmentId,
});

describe('confirmed route presentation', () => {
  it('keeps explicit gaps as separate presentation segments', () => {
    const segments = buildConfirmedRouteSegments([
      point(0, 1_000), point(2, 2_000), point(200, 50_000, 'b'), point(202, 51_000, 'b'),
    ]);
    expect(segments).toHaveLength(2);
    expect(segments.map(segment => segment.coordinates.length)).toEqual([2, 2]);
  });

  it('keeps a recovered legacy gap disconnected', () => {
    const points = [
      { ...point(0, 1_000), segmentId: undefined },
      { ...point(2, 2_000), segmentId: undefined },
      { ...point(400, 200_000), segmentId: undefined },
    ];
    expect(buildConfirmedRouteSegments(points).map(segment => segment.coordinates.length)).toEqual([2, 1]);
  });

  it('targets one full LineString while preserving an immutable prefix', () => {
    const coordinates: [number, number][] = [[0, 0], [1, 1], [2, 2], [3, 3]];
    expect(planContinuousRouteTarget(coordinates, 3)).toEqual({
      stableCount: 3,
      fullTargetCoordinates: coordinates,
      mutableCount: 1,
      boundedResetRequired: false,
    });
  });

  it('bounds an interrupted mutable tail independently of activity length', () => {
    const coordinates = Array.from({ length: 100 }, (_, index) => [index, index] as [number, number]);
    const plan = planContinuousRouteTarget(coordinates, 1);
    expect(plan.boundedResetRequired).toBe(true);
    expect(plan.mutableCount).toBe(0);
    expect(plan.stableCount).toBe(coordinates.length);
    expect(MAX_CONTINUOUS_ROUTE_MUTABLE_POINTS).toBe(8);
  });

  it('retargets append-only geometry but resets historical corrections', () => {
    expect(isAppendOnlyRouteUpdate([[0, 0], [1, 1]], [[0, 0], [1, 1], [2, 2]])).toBe(true);
    expect(isAppendOnlyRouteUpdate([[0, 0], [1, 1]], [[0, 0], [1.1, 1]])).toBe(false);
  });

  it('uses a short bounded clock for bursts and an 850ms ceiling for normal cadence', () => {
    expect(continuousRouteAnimationDurationMs(100)).toBe(180);
    expect(continuousRouteAnimationDurationMs(1_000)).toBe(720);
    expect(continuousRouteAnimationDurationMs(2_000)).toBe(850);
  });

  it('keeps a static body and bounded changing head without a seam', () => {
    const points = Array.from({ length: MAX_LIVE_ROUTE_HEAD_POINTS + 10 }, (_, index) => point(index, index * 1_000));
    let state = createIncrementalRoutePresentation();
    for (let count = 1; count <= points.length; count += 1) {
      state = updateIncrementalRoutePresentation(state, points.slice(0, count));
    }
    expect(state.staticChunks).toHaveLength(1);
    expect(state.activeHead!.coordinates.length).toBe(11);
    expect(state.staticChunks[0].coordinates.at(-1)).toEqual(state.activeHead!.coordinates[0]);
    expect(state.latestUpdatePayloadBytes).toBeLessThanOrEqual(MAX_LIVE_ROUTE_HEAD_POINTS * 16);
  });

  it('preserves explicit gaps, U-turns and repeated traversal incrementally', () => {
    const points = [
      point(0, 1_000, 'a'), point(10, 2_000, 'a'), point(0, 3_000, 'a'),
      point(0, 4_000, 'b'), point(10, 5_000, 'b'), point(0, 6_000, 'b'),
    ];
    const state = updateIncrementalRoutePresentation(createIncrementalRoutePresentation(), points);
    expect(state.staticChunks.map(chunk => chunk.coordinates.length)).toEqual([3]);
    expect(state.activeHead?.coordinates.length).toBe(3);
    expect(state.staticChunks[0].coordinates[0]).toEqual(state.staticChunks[0].coordinates[2]);
    expect(state.activeHead!.coordinates[0]).toEqual(state.activeHead!.coordinates[2]);
  });

  it.each([1_800, 7_200, 18_000])('bounds per-update route payload for %i accepted points', (count) => {
    const points = Array.from({ length: count }, (_, index) => point(index, index * 1_000));
    let state = createIncrementalRoutePresentation();
    const growing: ReturnType<typeof point>[] = [];
    for (const nextPoint of points) {
      growing.push(nextPoint);
      state = updateIncrementalRoutePresentation(state, growing);
      expect(state.latestUpdatePayloadBytes).toBeLessThanOrEqual((MAX_LIVE_ROUTE_HEAD_POINTS + 2) * 16);
    }
    expect(state.staticChunks.length).toBeLessThanOrEqual(Math.ceil(count / (MAX_LIVE_ROUTE_HEAD_POINTS - 1)));
  });
});
