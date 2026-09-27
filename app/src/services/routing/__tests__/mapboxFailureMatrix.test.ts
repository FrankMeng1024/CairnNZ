import { reconstructPedestrianFinalRoute } from '../pedestrianFinalRoute';
import type { RawPoint } from '../snapTrack';

const METRES_PER_DEGREE = 111_320;
const BASE_LAT = -41.2865;
const BASE_LNG = 174.7762;

function point(index: number, northM = 0, accuracy = 8): RawPoint {
  return {
    lng: BASE_LNG + index * 5 / (METRES_PER_DEGREE * Math.cos(BASE_LAT * Math.PI / 180)),
    lat: BASE_LAT + northM / METRES_PER_DEGREE,
    t: 1_800_000_000_000 + index * 4_000,
    accuracy,
  };
}

function requestCoordinates(url: string): Array<[number, number]> {
  return url.split('/walking/')[1].split('?')[0].split(';').map(value => {
    const [lng, lat] = value.split(',').map(Number);
    return [lng, lat];
  });
}

function responseFor(url: string, options: {
  confidence?: number;
  nullIndices?: Set<number>;
  alternatives?: number;
  name?: string | null;
  code?: string;
} = {}): Response {
  const coordinates = requestCoordinates(url);
  const code = options.code ?? 'Ok';
  return {
    ok: true,
    status: 200,
    json: async () => code === 'Ok' ? ({
      code,
      matchings: [{ confidence: options.confidence ?? 0.97, geometry: { coordinates } }],
      tracepoints: coordinates.map((location, index) => options.nullIndices?.has(index) ? null : ({
        matchings_index: 0,
        waypoint_index: index,
        alternatives_count: options.alternatives ?? 0,
        name: options.name ?? null,
        location,
      })),
    }) : ({ code }),
  } as Response;
}

describe('Mapbox Final refinement failure matrix', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('successful confident match is accepted only after geometry evidence gates', async () => {
    const canonical = Array.from({ length: 18 }, (_unused, index) => point(index));
    global.fetch = jest.fn(async (url: string) => responseFor(url)) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, { mapboxToken: 'pk.test', directionsFallback: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.requestResults[0]).toMatchObject({
      result: 'accepted-candidate', responseCode: 'Ok', acceptedCandidateCount: 1,
    });
    expect(result.stats.acceptedMatchedDistanceM).toBeGreaterThan(0);
  });

  test('partial match refines supported islands and leaves the unsupported section local', async () => {
    const canonical = Array.from({ length: 24 }, (_unused, index) => point(index));
    const nulls = new Set([9, 10, 11, 12, 13]);
    global.fetch = jest.fn(async (url: string) => responseFor(url, { nullIndices: nulls })) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, { mapboxToken: 'pk.test', directionsFallback: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.requestResults[0].nullTracepointCount).toBe(5);
    expect(result.stats.requestResults[0].acceptedCandidateCount).toBeGreaterThan(0);
    expect(result.stats.canonicalDerivedSectionCount).toBeGreaterThan(0);
  });

  test('low-confidence HTTP 200 is rejected rather than treated as trustworthy', async () => {
    const canonical = Array.from({ length: 18 }, (_unused, index) => point(index));
    global.fetch = jest.fn(async (url: string) => responseFor(url, { confidence: 0.38 })) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, { mapboxToken: 'pk.test', directionsFallback: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.requestResults[0]).toMatchObject({
      httpStatus: 200, responseCode: 'Ok', result: 'no-safe-candidate', acceptedCandidateCount: 0,
    });
    expect(result.stats.acceptedMatchedDistanceM).toBe(0);
  });

  test.each(['NoMatch', 'NoSegment'])(
    '%s degrades to local Final instead of preserving a repairable artifact',
    async code => {
      const canonical = Array.from({ length: 18 }, (_unused, index) => (
        point(index, index === 8 ? 8 : 0, 16)
      ));
      global.fetch = jest.fn(async (url: string) => responseFor(url, { code })) as any;
      const result = await reconstructPedestrianFinalRoute(canonical, { mapboxToken: 'pk.test', directionsFallback: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stats.requestResults[0].result).toBe(code);
      expect(result.stats.acceptedMatchedDistanceM).toBe(0);
      expect(result.stats.displayRefined).toBe(true);
    },
  );

  test('timeout and network failure are separately classified', async () => {
    const canonical = Array.from({ length: 18 }, (_unused, index) => point(index));
    global.fetch = jest.fn((_url, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
    })) as any;
    const timeout = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test', perCallTimeoutMs: 5, totalTimeoutMs: 15, directionsFallback: false,
    });
    expect(timeout.ok && timeout.stats.requestResults[0].result).toBe('timeout-or-abort');

    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as any;
    const offline = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test', directionsFallback: false,
    });
    expect(offline.ok && offline.stats.requestResults[0].result).toBe('network-error');
  });

  test('only successful windows contribute when other windows fail', async () => {
    const canonical = Array.from({ length: 70 }, (_unused, index) => point(index));
    let call = 0;
    global.fetch = jest.fn(async (url: string) => {
      call += 1;
      if (call === 2) throw new Error('network');
      if (call === 3) return responseFor(url, { code: 'NoMatch' });
      return responseFor(url);
    }) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, { mapboxToken: 'pk.test', directionsFallback: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.mapMatchingRequestCount).toBeGreaterThanOrEqual(3);
    expect(result.stats.requestResults.map(request => request.result)).toEqual(expect.arrayContaining([
      'accepted-candidate', 'network-error', 'NoMatch',
    ]));
    expect(result.stats.acceptedMatchedDistanceM).toBeGreaterThan(0);
    expect(result.stats.canonicalFallbackDistanceM).toBeGreaterThan(0);
  });

  test('parallel-road ambiguity and mixed road/off-road support are bounded', async () => {
    const canonical = Array.from({ length: 24 }, (_unused, index) => point(index, 12, 18));
    global.fetch = jest.fn(async (url: string) => responseFor(url, {
      alternatives: 2,
      name: 'Parallel Road',
    })) as any;
    const ambiguous = await reconstructPedestrianFinalRoute(canonical, { mapboxToken: 'pk.test', directionsFallback: false });
    expect(ambiguous.ok).toBe(true);
    if (!ambiguous.ok) return;
    expect(ambiguous.stats.acceptedMatchedDistanceM).toBe(0);
    expect(ambiguous.stats.sections.every(section => (
      section.geometryMode === 'C_CANONICAL_DERIVED'
      && section.reason.includes('network-side-ambiguous')
    ))).toBe(true);

    const mixed = canonical.map((sample, index) => ({
      ...sample,
      lat: sample.lat + (index >= 8 && index <= 15 ? 22 : 0) / METRES_PER_DEGREE,
    }));
    const unsupported = new Set(Array.from({ length: 8 }, (_unused, index) => index + 8));
    global.fetch = jest.fn(async (url: string) => responseFor(url, { nullIndices: unsupported })) as any;
    const mixedResult = await reconstructPedestrianFinalRoute(mixed, { mapboxToken: 'pk.test', directionsFallback: false });
    expect(mixedResult.ok).toBe(true);
    if (!mixedResult.ok) return;
    expect(mixedResult.stats.canonicalDerivedSectionCount).toBeGreaterThan(0);
    expect(mixedResult.stats.requestResults[0].nullTracepointCount).toBe(8);
  });
});
