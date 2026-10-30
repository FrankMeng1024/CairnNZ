import {
  buildConfirmedRouteSegments,
  createIncrementalRoutePresentation,
  continuousRouteAnimationDurationMs,
  isAppendOnlyRouteUpdate,
  MAX_CONTINUOUS_ROUTE_MUTABLE_POINTS,
  MAX_LIVE_ROUTE_HEAD_POINTS,
  MAX_LIVE_ROUTE_MUTABLE_SOURCE_POINTS,
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

  it('updates only the provisional road-aware tail without rebuilding confirmed chunks', () => {
    const original = [point(0, 1_000), point(10, 2_000), point(20, 3_000), point(30, 4_000)];
    const first = updateIncrementalRoutePresentation(createIncrementalRoutePresentation(), original);
    const revised = [original[0], original[1], { ...original[2], lat: -40.99999 }, { ...original[3], lat: -40.99999 }];
    const second = updateIncrementalRoutePresentation(first, revised);
    expect(second.rebuilt).toBe(false);
    expect(second.staticChunks).toBe(first.staticChunks);
    expect(second.activeHead?.coordinates.at(-2)).toEqual([revised[2].lng, revised[2].lat]);
    expect(second.activeHead?.coordinates.at(-1)).toEqual([revised[3].lng, revised[3].lat]);
  });

  it('publishes a penultimate road-context revision when the newest fix is unchanged', () => {
    const original = [point(0, 1_000), point(10, 2_000), point(20, 3_000), point(30, 4_000)];
    const first = updateIncrementalRoutePresentation(createIncrementalRoutePresentation(), original);
    const revised = original.map((sample, index) => (
      index === original.length - 2 ? { ...sample, lat: sample.lat + 0.00002 } : sample
    ));
    const second = updateIncrementalRoutePresentation(first, revised);

    expect(second.rebuilt).toBe(false);
    expect(second.activeHead?.coordinates.at(-2)).toEqual([
      revised.at(-2)!.lng,
      revised.at(-2)!.lat,
    ]);
    expect(second.activeHead?.coordinates.at(-1)).toEqual([
      revised.at(-1)!.lng,
      revised.at(-1)!.lat,
    ]);
  });

  it('disconnects an unsupported legacy edge when either time or distance proves a gap', () => {
    const timeOnly = [
      { ...point(0, 1_000), segmentId: undefined },
      { ...point(1, 122_000), segmentId: undefined },
    ];
    const distanceOnly = [
      { ...point(0, 1_000), segmentId: undefined },
      { ...point(201, 2_000), segmentId: undefined },
    ];
    expect(buildConfirmedRouteSegments(timeOnly).map(segment => segment.coordinates.length)).toEqual([1, 1]);
    expect(buildConfirmedRouteSegments(distanceOnly).map(segment => segment.coordinates.length)).toEqual([1, 1]);
  });

  it('uses the App 120 s / 200 m legacy fallback while explicit evidence gaps always split', () => {
    const legacy60s30m = [
      { ...point(0, 0), segmentId: undefined },
      { ...point(30, 60_000), segmentId: undefined },
    ];
    const legacy90s30m = [
      { ...point(0, 0), segmentId: undefined },
      { ...point(30, 90_000), segmentId: undefined },
    ];
    const explicitGap = [point(0, 0, 'before-gap'), point(30, 60_000, 'after-gap')];
    expect(buildConfirmedRouteSegments(legacy60s30m).map(segment => segment.coordinates.length))
      .toEqual([2]);
    expect(buildConfirmedRouteSegments(legacy90s30m).map(segment => segment.coordinates.length))
      .toEqual([2]);
    expect(buildConfirmedRouteSegments(explicitGap).map(segment => segment.coordinates.length))
      .toEqual([1, 1]);
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
    expect(state.activeHead!.coordinates.length)
      .toBe(MAX_LIVE_ROUTE_MUTABLE_SOURCE_POINTS + 10);
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

  it('rebuilds when the legal mutable suffix crosses a newly frozen segment boundary', () => {
    const original = [
      ...Array.from({ length: 12 }, (_, index) => point(index * 2, index * 1_000, 'a')),
      ...Array.from({ length: 3 }, (_, index) => point((index + 12) * 2, (index + 12) * 1_000, 'b')),
    ];
    const first = updateIncrementalRoutePresentation(
      createIncrementalRoutePresentation(),
      original,
    );
    const revised = original.map((sample, index) => (
      index === 8 ? { ...sample, lat: sample.lat + 3 / 111_320 } : sample
    ));
    const second = updateIncrementalRoutePresentation(first, revised);
    const rendered = [...second.staticChunks, ...(second.activeHead ? [second.activeHead] : [])];

    expect(first.activeHeadStartIndex).toBe(12);
    expect(second.rebuilt).toBe(true);
    expect(rendered.map(segment => segment.coordinates)).toEqual(
      buildConfirmedRouteSegments(revised).map(segment => segment.coordinates),
    );
  });

  it.each([1_800, 7_200, 18_000])('bounds per-update route payload for %i accepted points', (count) => {
    const points = Array.from({ length: count }, (_, index) => point(index, index * 1_000));
    let state = createIncrementalRoutePresentation();
    const growing: ReturnType<typeof point>[] = [];
    for (const nextPoint of points) {
      growing.push(nextPoint);
      // Production publishes a new readonly route value. Keep the benchmark
      // faithful to that contract instead of mutating the prior state's input.
      state = updateIncrementalRoutePresentation(state, growing.slice());
      expect(state.latestUpdatePayloadBytes).toBeLessThanOrEqual((MAX_LIVE_ROUTE_HEAD_POINTS + 2) * 16);
    }
    expect(state.staticChunks.length).toBeLessThanOrEqual(Math.ceil(
      count / (MAX_LIVE_ROUTE_HEAD_POINTS - MAX_LIVE_ROUTE_MUTABLE_SOURCE_POINTS),
    ));
  });

  it('keeps a changing causal suffix bounded while preserving every rendered edge', () => {
    let points = [point(0, 0), point(2, 1_000), point(4, 2_000)];
    let state = updateIncrementalRoutePresentation(
      createIncrementalRoutePresentation(),
      points,
    );
    for (let index = 3; index < 1_025; index += 1) {
      points = [
        ...points.slice(0, -1),
        { ...points.at(-1)!, lat: points.at(-1)!.lat + 0.2 / 111_320 },
        point(index * 2, index * 1_000),
      ];
      state = updateIncrementalRoutePresentation(state, points);
      expect(state.activeHead?.coordinates.length ?? 0)
        .toBeLessThanOrEqual(MAX_LIVE_ROUTE_HEAD_POINTS);
    }
    const renderedEdges = [...state.staticChunks, ...(state.activeHead ? [state.activeHead] : [])]
      .reduce((count, chunk) => count + Math.max(0, chunk.coordinates.length - 1), 0);
    expect(renderedEdges).toBe(points.length - 1);
    expect(state.activeHead?.coordinates.at(-2)).toEqual([
      points.at(-2)!.lng,
      points.at(-2)!.lat,
    ]);
  });
});
