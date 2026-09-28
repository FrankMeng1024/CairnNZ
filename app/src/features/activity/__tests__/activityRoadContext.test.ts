import {
  buildActivityRoadContext,
  deriveRoadAwareLiveTrack,
} from '../activityRoadContext';

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
});
