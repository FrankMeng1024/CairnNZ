import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsObservation,
} from '../../../features/activity/realGpsContinuity';
import {
  buildBaseFinalGeometry,
  reconstructPedestrianFinalRoute,
} from '../pedestrianFinalRoute';
import type { RawPoint } from '../snapTrack';

const METRES_PER_DEGREE = 111_320;
const BASE_LAT = -41.2865;
const BASE_LNG = 174.7762;

function point(eastM: number, northM: number, index: number, accuracy = 8): RawPoint {
  return {
    lng: BASE_LNG + eastM / (METRES_PER_DEGREE * Math.cos(BASE_LAT * Math.PI / 180)),
    lat: BASE_LAT + northM / METRES_PER_DEGREE,
    t: 1_800_000_000_000 + index * 4_000,
    accuracy,
  };
}

function northM(value: { lat: number }): number {
  return (value.lat - BASE_LAT) * METRES_PER_DEGREE;
}

function canonicalThroughRealPipeline(
  raw: RawPoint[],
  mode: 'hiking' | 'running',
): RealGpsObservation[] {
  let state = createRealGpsContinuityState();
  const accepted: RealGpsObservation[] = [];
  raw.forEach((sample, index) => {
    const observation: RealGpsObservation = {
      ...sample,
      t: sample.t!,
      accuracy: sample.accuracy ?? null,
      speed: mode === 'running' ? 2.6 : 1.2,
      source: 'foreground',
      observationId: `${mode}-${index}`,
      rawOrdinal: index + 1,
    };
    const decision = evaluateRealGpsObservation(state, observation, mode, observation.t);
    state = decision.state;
    if (decision.kind !== 'ACCEPT') return;
    const promoted = decision.confirmedCandidates
      ?? (decision.confirmedCandidate ? [decision.confirmedCandidate] : []);
    for (const candidate of promoted) {
      state = acceptRealGpsObservation(state, candidate, 'segment-a').state;
      accepted.push(candidate);
    }
    state = acceptRealGpsObservation(state, observation, 'segment-a').state;
    accepted.push(observation);
  });
  return accepted;
}

function matchingResponse(canonical: RawPoint[], northingM: number): Response {
  const geometry = canonical.map((source, index) => {
    const network = point(
      (source.lng - BASE_LNG) * METRES_PER_DEGREE * Math.cos(BASE_LAT * Math.PI / 180),
      northingM,
      index,
    );
    return [network.lng, network.lat] as [number, number];
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 'Ok',
      matchings: [{ confidence: 0.98, geometry: { coordinates: geometry } }],
      tracepoints: geometry.map((location, index) => ({
        matchings_index: 0,
        waypoint_index: index,
        alternatives_count: 0,
        name: 'Parallel Road',
        location,
      })),
    }),
  } as Response;
}

describe('three-stage Activity route quality regressions', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test.each(['hiking', 'running'] as const)(
    'Stage 1 %s suppresses an uncertainty-sized rapid left-right cluster',
    mode => {
      const raw = [0, 0, 3.8, -3.8, 3.6, -3.4, 0, 0].map((north, index) => (
        point(index * 5, north, index, 8)
      ));
      const canonical = canonicalThroughRealPipeline(raw, mode);
      expect(Math.max(...canonical.map(sample => Math.abs(northM(sample))))).toBeLessThanOrEqual(4);
      expect(canonical.length).toBeLessThanOrEqual(raw.length / 2);
    },
  );

  test('Stage 3 repairs a one-point lateral spike within measured uncertainty', () => {
    const canonical = [
      point(0, 0, 0, 20),
      point(8, 0, 1, 20),
      point(12, 13, 2, 20),
      point(16, 0, 3, 20),
      point(24, 0, 4, 20),
    ];
    const final = buildBaseFinalGeometry(canonical);
    expect(final.diagnostics.removedTransientSpikeCount).toBe(1);
    expect(Math.max(...final.points.map(sample => Math.abs(northM(sample))))).toBeLessThan(2);
  });

  test('Stage 3 repairs a short correlated multi-fix GPS burst', () => {
    const canonical = [
      point(0, 0, 0, 25),
      point(8, 0, 1, 25),
      point(12, 10, 2, 25),
      point(16, 14, 3, 25),
      point(20, 10, 4, 25),
      point(24, 0, 5, 25),
      point(32, 0, 6, 25),
    ];
    const final = buildBaseFinalGeometry(canonical);
    expect(final.diagnostics.removedTransientSpikeCount).toBe(1);
    expect(Math.max(...final.points.map(sample => Math.abs(northM(sample))))).toBeLessThan(2);
  });

  test('Stage 3 removes a small opposing zigzag inside the uncertainty envelope', () => {
    const canonical = [
      point(0, 0, 0, 18),
      point(6, 0, 1, 18),
      point(10, 8, 2, 18),
      point(14, -7, 3, 18),
      point(18, 7, 4, 18),
      point(22, 0, 5, 18),
      point(30, 0, 6, 18),
    ];
    const final = buildBaseFinalGeometry(canonical);
    expect(final.diagnostics.removedTransientSpikeCount).toBeGreaterThan(0);
    expect(Math.max(...final.points.map(sample => Math.abs(northM(sample))))).toBeLessThan(3);
  });

  test('Stage 3 rejects a confident named parallel road for an off-road traversal', async () => {
    const canonical = Array.from({ length: 18 }, (_unused, index) => (
      point(index * 7, index >= 6 && index <= 9 ? 8 : 18, index, 25)
    ));
    global.fetch = jest.fn(async () => matchingResponse(canonical, 0)) as any;
    const final = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
    });
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(final.stats.acceptedMatchedDistanceM).toBe(0);
    expect(Math.min(...final.points.map(northM))).toBeGreaterThan(7);
  });
});
