import {
  buildActivityRoadContext,
  createStableRoadAwareLivePresentation,
  deriveRoadAwareLiveTrack,
  updateStableRoadAwareLivePresentation,
} from '../activityRoadContext';
import { appendCausalLivePoint } from '../causalLiveRoute';
import {
  createIncrementalRoutePresentation,
  updateIncrementalRoutePresentation,
} from '../confirmedRoutePresentation';

const base = {
  center: { lat: -41.00004, lng: 174.0001 },
  observedThroughTimestamp: 2_000,
  mapMountId: 'mounted-visible-map',
  styleGeneration: 3,
  viewportGeneration: 4,
  queryGeneration: 5,
  queriedAtMs: 2_010,
  queryDurationMs: 4,
  screenRect: [10, 20, 30, 40] as [number, number, number, number],
  visibleBounds: [[175, -40], [173, -42]] as [[number, number], [number, number]],
};

describe('Activity RoadContext presentation boundary', () => {
  test('captures rendered-feature provenance, layers, structures and uncertainty', () => {
    const context = buildActivityRoadContext({
      ...base,
      features: { features: [{
        id: 8,
        layer: { id: 'road-path', sourceLayer: 'transportation' },
        properties: { class: 'path', structure: 'bridge' },
        geometry: { type: 'LineString', coordinates: [[174, -41], [174.001, -41]] },
      }, {
        layer: { id: 'building-fill', sourceLayer: 'building' },
        properties: { class: 'building' },
        geometry: { type: 'Polygon', coordinates: [[
          [174.002, -41.002], [174.003, -41.002], [174.003, -41.003],
          [174.002, -41.003], [174.002, -41.002],
        ]] },
      }] },
    });
    expect(context).toMatchObject({
      availability: 'available',
      provenance: 'mapbox-rendered-features',
      mapMountId: 'mounted-visible-map',
      structure: { roadFeatureCount: 1, buildingFeatureCount: 1 },
    });
    expect(context.corridors[0]).toMatchObject({ structure: 'bridge', sourceLayerId: 'transportation' });
    expect(context.obstacles[0]).toMatchObject({ provenance: 'rendered-building-polygon' });
  });

  test('adjusts only a coherent live tail and never mutates canonical input', () => {
    const canonical = [
      { lat: -41.00004, lng: 174, t: 1_000, segmentId: 'a', accuracy: 15 },
      { lat: -41.00004, lng: 174.00005, t: 1_500, segmentId: 'a', accuracy: 15 },
      { lat: -41.00004, lng: 174.0001, t: 2_000, segmentId: 'a', accuracy: 15 },
    ];
    const context = buildActivityRoadContext({
      ...base,
      features: { features: [{
        layer: { id: 'road-path', sourceLayer: 'transportation' },
        properties: { class: 'footway' },
        geometry: { type: 'LineString', coordinates: [[173.999, -41], [174.001, -41]] },
      }] },
    });
    const presented = deriveRoadAwareLiveTrack(canonical, context);
    expect(presented).not.toBe(canonical);
    expect(presented[1].lat).toBeCloseTo(-41, 6);
    expect(canonical[1].lat).toBe(-41.00004);
    expect(presented.map(point => [point.t, point.segmentId])).toEqual([[1_000, 'a'], [1_500, 'a'], [2_000, 'a']]);
  });

  test('no features, stale coverage, segment boundaries and app-owned lines never imply a road', () => {
    const context = buildActivityRoadContext({
      ...base,
      features: { features: [{
        layer: { id: 'track-active-style-3' },
        properties: {},
        geometry: { type: 'LineString', coordinates: [[174, -41], [174.001, -41]] },
      }] },
    });
    expect(context.availability).toBe('no-road-features');
    expect(context.uncertainty.reason).toContain('absence-is-not-off-road-evidence');
    const canonical = [
      { lat: -41, lng: 174, t: 1_000, segmentId: 'a' },
      { lat: -41, lng: 174.0001, t: 2_001, segmentId: 'b' },
    ];
    expect(deriveRoadAwareLiveTrack(canonical, { ...context, availability: 'available' })).toBe(canonical);
  });

  test('does not introduce a false building-crossing edge while adjusting a live tail', () => {
    const canonical = [
      { lat: -41, lng: 174, t: 1_000, segmentId: 'a', accuracy: 15 },
      { lat: -41, lng: 174.00005, t: 1_500, segmentId: 'a', accuracy: 15 },
      { lat: -41, lng: 174.0001, t: 2_000, segmentId: 'a', accuracy: 15 },
    ];
    const context = buildActivityRoadContext({
      ...base,
      center: canonical[1],
      features: { features: [{
        id: 'straight-road',
        layer: { id: 'road-path', sourceLayer: 'transportation' },
        properties: { class: 'footway' },
        geometry: { type: 'LineString', coordinates: [[173.9999, -41.00004], [174.0002, -41.00004]] },
      }, {
        id: 'solid-building',
        layer: { id: 'building-fill', sourceLayer: 'building' },
        properties: { class: 'building' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [174.00004, -41.00005],
            [174.00006, -41.00005],
            [174.00006, -41.00003],
            [174.00004, -41.00003],
            [174.00004, -41.00005],
          ]],
        },
      }] },
    });
    const presented = deriveRoadAwareLiveTrack(canonical, context);
    expect(presented).toBe(canonical);
    expect(context.obstacles).toHaveLength(1);
  });

  test('retains explicit bridge passage evidence through a rendered footprint', () => {
    const canonical = [
      { lat: -41, lng: 174, t: 1_000, segmentId: 'a', accuracy: 15 },
      { lat: -41, lng: 174.00005, t: 1_500, segmentId: 'a', accuracy: 15 },
      { lat: -41, lng: 174.0001, t: 2_000, segmentId: 'a', accuracy: 15 },
    ];
    const context = buildActivityRoadContext({
      ...base,
      center: canonical[1],
      features: { features: [{
        layer: { id: 'road-path', sourceLayer: 'transportation' },
        properties: { class: 'footway', structure: 'bridge' },
        geometry: { type: 'LineString', coordinates: [[173.9999, -41.00004], [174.0002, -41.00004]] },
      }, {
        layer: { id: 'building-fill', sourceLayer: 'building' },
        properties: { class: 'building' },
        geometry: { type: 'Polygon', coordinates: [[
          [174.00004, -41.00005], [174.00006, -41.00005],
          [174.00006, -41.00003], [174.00004, -41.00003], [174.00004, -41.00005],
        ]] },
      }] },
    });
    expect(deriveRoadAwareLiveTrack(canonical, context)).not.toBe(canonical);
  });

  test('precise parallel off-road evidence is not pulled onto a nearby rendered road', () => {
    const canonical = [0, 10, 20].map((eastM, index) => ({
      lat: -41.00004,
      lng: 174 + eastM / (111_320 * Math.cos(41 * Math.PI / 180)),
      t: 1_000 + index * 500,
      segmentId: 'a',
      accuracy: 2,
    }));
    const context = buildActivityRoadContext({
      ...base,
      center: canonical[2],
      features: { features: [{
        layer: { id: 'road-path', sourceLayer: 'transportation' },
        properties: { class: 'footway' },
        geometry: { type: 'LineString', coordinates: [[173.999, -41], [174.002, -41]] },
      }] },
    });
    expect(deriveRoadAwareLiveTrack(canonical, context)).toBe(canonical);
  });

  test('parallel corridor ambiguity retains canonical truth, while one noisy coherent corridor is supported', () => {
    const canonical = [0, 8, 16].map((eastM, index) => ({
      lat: -41.000025,
      lng: 174 + eastM / (111_320 * Math.cos(41 * Math.PI / 180)),
      t: 1_000 + index * 500,
      segmentId: 'a',
      accuracy: 14,
    }));
    const feature = (id: string, lat: number) => ({
      id,
      layer: { id: 'road-path', sourceLayer: 'transportation' },
      properties: { class: 'footway' },
      geometry: { type: 'LineString', coordinates: [[173.999, lat], [174.002, lat]] },
    });
    const ambiguous = buildActivityRoadContext({
      ...base,
      center: canonical[2],
      features: { features: [feature('north', -41.000015), feature('south', -41.000035)] },
    });
    expect(deriveRoadAwareLiveTrack(canonical, ambiguous)).toBe(canonical);
    const supported = buildActivityRoadContext({
      ...base,
      center: canonical[2],
      features: { features: [feature('only', -41)] },
    });
    expect(deriveRoadAwareLiveTrack(canonical, supported)).not.toBe(canonical);
  });

  test('freezes confirmed road-aware history while a bounded provisional tail changes', () => {
    const canonical = [0, 8, 16].map((eastM, index) => ({
      lat: -41.00004,
      lng: 174 + eastM / (111_320 * Math.cos(41 * Math.PI / 180)),
      t: 1_000 + index * 1_000,
      segmentId: 'a',
      accuracy: 15,
    }));
    const context = buildActivityRoadContext({
      ...base,
      observedThroughTimestamp: canonical.at(-1)!.t,
      center: canonical.at(-1)!,
      features: { features: [{
        id: 'stable-road',
        layer: { id: 'road-path', sourceLayer: 'transportation' },
        properties: { class: 'footway' },
        geometry: { type: 'LineString', coordinates: [[173.999, -41], [174.002, -41]] },
      }] },
    });
    let presentation = updateStableRoadAwareLivePresentation(
      createStableRoadAwareLivePresentation<typeof canonical[number]>(),
      canonical,
      context,
    );
    expect(presentation.points[1].lat).toBeCloseTo(-41, 6);
    const confirmedCoordinate = presentation.points[1];
    const extended = [...canonical, {
      ...canonical.at(-1)!,
      lng: canonical.at(-1)!.lng + 8 / (111_320 * Math.cos(41 * Math.PI / 180)),
      t: 4_000,
    }];
    presentation = updateStableRoadAwareLivePresentation(presentation, extended, null);
    expect(presentation.points[1]).toBe(confirmedCoordinate);
    expect(presentation.points[1].lat).toBeCloseTo(-41, 6);
    expect(presentation.points.at(-1)).toBe(extended.at(-1));
  });

  test('production causal tail revisions keep the road-aware frozen prefix and avoid a full render rebuild', () => {
    const metresPerLng = 111_320 * Math.cos(41 * Math.PI / 180);
    const canonical = Array.from({ length: 32 }, (_, index) => ({
      lat: -41 + index * 1.4 / 111_320,
      lng: 174 + (index >= 12 && index <= 15 ? 5 : 0) / metresPerLng,
      t: 1_000 + index * 1_000,
      segmentId: 'causal-road',
      accuracy: 15,
    }));
    const context = buildActivityRoadContext({
      ...base,
      observedThroughTimestamp: canonical.at(-1)!.t,
      center: canonical.at(-1)!,
      features: { features: [{
        id: 'north-corridor',
        layer: { id: 'road-path', sourceLayer: 'transportation' },
        properties: { class: 'footway' },
        geometry: {
          type: 'LineString',
          coordinates: [[174, -41.001], [174, -40.999]],
        },
      }] },
    });
    let causal: typeof canonical = [];
    const history: typeof canonical = [];
    let road = createStableRoadAwareLivePresentation<typeof canonical[number]>();
    let rendered = createIncrementalRoutePresentation();
    let observedBoundedRevision = false;

    for (const sample of canonical) {
      history.push(sample);
      const nextCausal = appendCausalLivePoint(causal, sample, history) as typeof canonical;
      const boundedRevision = road.sourceCount >= 3
        && nextCausal.length >= road.sourceCount
        && nextCausal[0] === road.sourcePoints[0]
        && nextCausal[road.sourceCount - 3] === road.sourcePoints[road.sourceCount - 3]
        && nextCausal[road.sourceCount - 1] !== road.sourcePoints[road.sourceCount - 1];
      const frozenPrefix = road.points.slice(0, Math.max(0, road.sourceCount - 2));
      road = updateStableRoadAwareLivePresentation(road, nextCausal, context);
      const nextRendered = updateIncrementalRoutePresentation(rendered, road.points);
      if (boundedRevision) {
        observedBoundedRevision = true;
        frozenPrefix.forEach((point, index) => expect(road.points[index]).toBe(point));
        expect(nextRendered.rebuilt).toBe(false);
      }
      causal = nextCausal;
      rendered = nextRendered;
    }

    expect(observedBoundedRevision).toBe(true);
    expect(rendered.sourceCount).toBe(road.points.length);
  });
});
