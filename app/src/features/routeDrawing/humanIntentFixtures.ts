import type { LngLat } from '../../services/routing/corridor/PolylineSampler';
import type { RouteDrawingReplayFixture } from './routeDrawingTrace';

const ORIGIN: LngLat = { lng: 174.764, lat: -36.848 };

function point(eastM: number, northM: number): LngLat {
  return {
    lng: ORIGIN.lng + eastM / (111_000 * Math.cos(ORIGIN.lat * Math.PI / 180)),
    lat: ORIGIN.lat + northM / 111_000,
  };
}

const viewport = {
  width: 390,
  height: 844,
  center: ORIGIN,
  zoom: 16,
  bearing: 0,
  pitch: 0,
};

/** Synthetic, location-safe fixtures. Captured failures must be redacted before
 * joining this permanent corpus. */
export const HUMAN_ROUTE_DRAWING_FIXTURES: Record<string, RouteDrawingReplayFixture> = {
  flattenV: {
    fixtureVersion: 1,
    id: 'scenario-a-flatten-v',
    source: 'synthetic',
    originalRoute: [point(0, 0), point(50, 75), point(100, 0)],
    rawStroke: [point(0, 0), point(25, 1), point(50, -1), point(75, 1), point(100, 0)],
    providerGeometry: [point(0, 0), point(48, 72), point(100, 0)],
    viewport: { ...viewport, zoom: 17 },
  },
  straightRoad: {
    fixtureVersion: 1,
    id: 'scenario-b-straight-road',
    source: 'synthetic',
    originalRoute: [point(0, 0), point(120, 0)],
    rawStroke: [point(0, 0), point(30, 2), point(60, -1), point(90, 1), point(120, 0)],
    providerGeometry: [point(0, 0), point(40, 1), point(80, 1), point(120, 0)],
    viewport: { ...viewport, zoom: 17 },
  },
  mixedTool: {
    fixtureVersion: 1,
    id: 'scenario-c-mixed-tool',
    source: 'synthetic',
    originalRoute: [point(0, 0), point(140, 0)],
    rawStroke: [point(0, 0), point(35, 1), point(70, 0), point(105, 1), point(140, 0)],
    providerGeometry: [point(0, 0), point(70, 0.5), point(140, 0)],
    viewport,
  },
  intentionalTurn: {
    fixtureVersion: 1,
    id: 'scenario-d-intentional-turn',
    source: 'synthetic',
    originalRoute: [point(0, 0), point(120, 0)],
    rawStroke: [point(0, 0), point(55, 0), point(55, 55), point(120, 0)],
    providerGeometry: [point(0, 0), point(120, 0)],
    viewport: { ...viewport, zoom: 17 },
  },
  ambiguousCrossing: {
    fixtureVersion: 1,
    id: 'scenario-e-ambiguous-crossing',
    source: 'synthetic',
    originalRoute: [point(0, 0), point(30, 30), point(60, -30), point(90, 30), point(120, 0)],
    rawStroke: [point(0, 0), point(120, 0)],
    providerGeometry: [point(0, 0), point(120, 0)],
    viewport: { ...viewport, zoom: 15 },
  },
  trueAmbiguousOccurrences: {
    fixtureVersion: 1,
    id: 'scenario-e2-true-overlapping-occurrence-ambiguity',
    source: 'synthetic',
    originalRoute: [point(0, 0), point(60, 0), point(0, 0), point(60, 0), point(120, 0)],
    rawStroke: [point(0, 0), point(30, 30), point(60, 0)],
    providerGeometry: [point(0, 0), point(30, 30), point(60, 0)],
    viewport,
  },
  flattenVWideZoom: {
    fixtureVersion: 1,
    id: 'scenario-f-flatten-v-wide-zoom',
    source: 'synthetic',
    originalRoute: [point(0, 0), point(50, 65), point(100, 0)],
    rawStroke: [point(0, 0), point(50, 2), point(100, 0)],
    providerGeometry: [point(0, 0), point(48, 60), point(100, 0)],
    viewport: { ...viewport, zoom: 13 },
  },
};

export const DEFAULT_ROUTE_DRAWING_REPLAY_FIXTURE = HUMAN_ROUTE_DRAWING_FIXTURES.flattenV;
