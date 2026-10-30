import { haversineM } from '../../../utils/geo';
import {
  buildActivityRoadContext,
  createStableRoadAwareLivePresentation,
  updateStableRoadAwareLivePresentation,
} from '../activityRoadContext';
import {
  createIncrementalRoutePresentation,
  updateIncrementalRoutePresentation,
} from '../confirmedRoutePresentation';

type SyntheticPoint = {
  lat: number;
  lng: number;
  t: number;
  accuracy: number;
  segmentId: string;
  observationId: string;
  clientActivityId: string;
  ownerGeneration: string;
  rawOrdinal: number;
  livePresentationSettled?: true;
};

const METRES_PER_LATITUDE_DEGREE = 111_320;

function routeFixture(args: {
  latitude: number;
  bearing: number;
  lateralM: number;
  count: number;
  cadenceMs: number;
  activityId?: string;
  generation?: string;
  segmentId?: string;
}) {
  const longitude = 10;
  const longitudeScale = METRES_PER_LATITUDE_DEGREE
    * Math.cos(args.latitude * Math.PI / 180);
  const radians = args.bearing * Math.PI / 180;
  const direction = [Math.sin(radians), Math.cos(radians)];
  const normal = [direction[1], -direction[0]];
  const xy = (alongM: number, lateralM: number) => [
    direction[0] * alongM + normal[0] * lateralM,
    direction[1] * alongM + normal[1] * lateralM,
  ];
  const activityId = args.activityId ?? 'synthetic-activity';
  const generation = args.generation ?? 'generation-a';
  const segmentId = args.segmentId ?? `${activityId}:${generation}:segment-a`;
  const points: SyntheticPoint[] = Array.from({ length: args.count }, (_, index) => {
    const [x, y] = xy(index * 10, args.lateralM);
    return {
      lat: args.latitude + y / METRES_PER_LATITUDE_DEGREE,
      lng: longitude + x / longitudeScale,
      t: 1_000 + index * args.cadenceMs,
      accuracy: 12,
      segmentId,
      observationId: `${activityId}:${generation}:observation-${index}`,
      clientActivityId: activityId,
      ownerGeneration: generation,
      rawOrdinal: index,
    };
  });
  const line = [xy(-20, 0), xy(args.count * 10 + 20, 0)]
    .map(([x, y]) => [
      longitude + x / longitudeScale,
      args.latitude + y / METRES_PER_LATITUDE_DEGREE,
    ] as [number, number]);
  const context = buildActivityRoadContext({
    features: { features: [{
      type: 'Feature',
      id: 'synthetic-path',
      properties: { class: 'path', type: 'path', structure: 'none' },
      geometry: { type: 'LineString', coordinates: line },
    }] },
    center: points[points.length - 2],
    observedThroughTimestamp: points[points.length - 2].t,
    mapMountId: 'synthetic-map',
    styleGeneration: 1,
    viewportGeneration: 1,
    queryGeneration: 1,
    queriedAtMs: 0,
    queryDurationMs: 1,
    screenRect: [0, 0, 100, 100],
    visibleBounds: [[longitude - 0.01, args.latitude - 0.01], [longitude + 0.01, args.latitude + 0.01]],
    radiusM: 100,
  });
  return { points, context };
}

function deterministicCases() {
  let seed = 0x0c98f04;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4_294_967_296;
  };
  return Array.from({ length: 72 }, (_, index) => ({
    latitude: -55 + random() * 110,
    bearing: random() * 360,
    lateralM: 1.5 + random() * 3.5,
    count: index % 9 === 0 ? 104 : 5 + Math.floor(random() * 28),
    cadenceMs: [100, 500, 1_000, 2_000, 5_000][index % 5],
  }));
}

describe('general Live presentation stability', () => {
  it('keeps every already-published stable identity fixed through tail contraction', () => {
    for (const fixture of deterministicCases()) {
      const { points, context } = routeFixture(fixture);
      let state = createStableRoadAwareLivePresentation<SyntheticPoint>();
      state = updateStableRoadAwareLivePresentation(state, points.slice(0, -1), null);
      state = updateStableRoadAwareLivePresentation(state, points, context);

      const watched = points[points.length - 3];
      const before = state.points.find(point => point.observationId === watched.observationId);
      expect(before).toBeDefined();
      const contracted = points.filter(point => (
        point.observationId !== points[points.length - 2].observationId
      ));
      state = updateStableRoadAwareLivePresentation(state, contracted, context);
      const after = state.points.find(point => point.observationId === watched.observationId);
      expect(after).toBeDefined();
      expect(haversineM(before!, after!)).toBeLessThanOrEqual(0.05);
    }
  });

  it('uses immutable evidence identity rather than JS object identity after rehydration', () => {
    for (const count of [5, 18, 103]) {
      const { points, context } = routeFixture({
        latitude: 40,
        bearing: 37,
        lateralM: 4,
        count,
        cadenceMs: 1_000,
      });
      let state = createStableRoadAwareLivePresentation<SyntheticPoint>();
      state = updateStableRoadAwareLivePresentation(state, points, context);
      const extended = [...points, {
        ...points[points.length - 1],
        t: points[points.length - 1].t + 1_000,
        rawOrdinal: points.length,
        observationId: `synthetic-activity:generation-a:observation-${points.length}`,
      }];
      state = updateStableRoadAwareLivePresentation(state, extended, context);
      const watchedId = points[points.length - 2].observationId;
      const before = state.points.find(point => point.observationId === watchedId)!;
      state = updateStableRoadAwareLivePresentation(
        state,
        extended.map(point => ({ ...point })),
        context,
      );
      const after = state.points.find(point => point.observationId === watchedId)!;
      expect(haversineM(before, after)).toBeLessThanOrEqual(0.05);
    }
  });

  it('does not globally disable legitimate provisional road adjustment', () => {
    const { points, context } = routeFixture({
      latitude: 40,
      bearing: 0,
      lateralM: 4,
      count: 8,
      cadenceMs: 1_000,
    });
    const state = updateStableRoadAwareLivePresentation(
      createStableRoadAwareLivePresentation<SyntheticPoint>(),
      points,
      context,
    );
    expect(haversineM(points.at(-1)!, state.points.at(-1)!)).toBeGreaterThan(1);
  });

  it('does not reuse frozen geometry across owner-generation replacement', () => {
    const first = routeFixture({
      latitude: 40,
      bearing: 0,
      lateralM: 4,
      count: 8,
      cadenceMs: 1_000,
      activityId: 'activity-a',
      generation: 'generation-a',
    });
    let state = updateStableRoadAwareLivePresentation(
      createStableRoadAwareLivePresentation<SyntheticPoint>(),
      first.points,
      first.context,
    );
    const replacement = routeFixture({
      latitude: 40,
      bearing: 0,
      lateralM: 4,
      count: 8,
      cadenceMs: 1_000,
      activityId: 'activity-b',
      generation: 'generation-b',
    });
    state = updateStableRoadAwareLivePresentation(state, replacement.points, replacement.context);
    expect(haversineM(replacement.points.at(-1)!, state.points.at(-1)!)).toBeGreaterThan(1);
  });

  it('updates a contracted/cloned active head without rebuilding frozen renderer chunks', () => {
    const { points, context } = routeFixture({
      latitude: -32,
      bearing: 75,
      lateralM: 4,
      count: 300,
      cadenceMs: 1_000,
    });
    let road = updateStableRoadAwareLivePresentation(
      createStableRoadAwareLivePresentation<SyntheticPoint>(),
      points,
      context,
    );
    let rendered = updateIncrementalRoutePresentation(
      createIncrementalRoutePresentation(),
      road.points,
    );
    const staticChunks = rendered.staticChunks;
    const contracted = points
      .filter(point => point.observationId !== points[points.length - 2].observationId)
      .map(point => ({ ...point }));
    road = updateStableRoadAwareLivePresentation(road, contracted, context);
    rendered = updateIncrementalRoutePresentation(rendered, road.points);
    expect(rendered.rebuilt).toBe(false);
    expect(rendered.staticChunks).toBe(staticChunks);
    expect(rendered.sourceCount).toBe(road.points.length);
    expect(rendered.activeHead?.coordinates.at(-1)).toEqual([
      road.points.at(-1)!.lng,
      road.points.at(-1)!.lat,
    ]);
  });

  it('L06 rejects an older road-context result after a newer query already owns the provisional tail', () => {
    const { points, context: olderContext } = routeFixture({
      latitude: 40,
      bearing: 0,
      lateralM: 4,
      count: 8,
      cadenceMs: 1_000,
    });
    const longitudeScale = METRES_PER_LATITUDE_DEGREE * Math.cos(40 * Math.PI / 180);
    const newerContext = {
      ...olderContext,
      queryGeneration: olderContext.queryGeneration + 1,
      corridors: olderContext.corridors.map(corridor => ({
        ...corridor,
        coordinates: corridor.coordinates.map(([lng, lat]) => ([
          lng + 4 / longitudeScale,
          lat,
        ] as [number, number])),
      })),
    };
    let state = updateStableRoadAwareLivePresentation(
      createStableRoadAwareLivePresentation<SyntheticPoint>(),
      points,
      newerContext,
    );
    const newestPublished = state.points.at(-1)!;
    expect(haversineM(points.at(-1)!, newestPublished)).toBeLessThanOrEqual(0.05);

    state = updateStableRoadAwareLivePresentation(state, points, olderContext);
    expect(haversineM(newestPublished, state.points.at(-1)!)).toBeLessThanOrEqual(0.05);
  });
});
