import {
  cleanCanonicalGeometry,
  evaluateCorridorEvidence,
  evaluateLateralOffsetEvidence,
  finalGeometryCriticalIndices,
  offsetNetworkGeometry,
  reconstructPedestrianFinalRoute,
} from '../pedestrianFinalRoute';
import type { RawPoint, SnappedPoint } from '../snapTrack';

const METRES_PER_DEGREE = 111_320;
const BASE_LAT = 30;

function point(eastM: number, northM: number, index = 0, accuracy = 8): RawPoint {
  return {
    lng: 120 + eastM / (METRES_PER_DEGREE * Math.cos(BASE_LAT * Math.PI / 180)),
    lat: BASE_LAT + northM / METRES_PER_DEGREE,
    t: 1_700_000_000_000 + index * 4_000,
    accuracy,
  };
}

function line(startM: number, endM: number, northM: number, count: number): RawPoint[] {
  return Array.from({ length: count }, (_unused, index) => (
    point(startM + (endM - startM) * index / Math.max(1, count - 1), northM, index)
  ));
}

function networkLine(startM: number, endM: number, northM: number): SnappedPoint[] {
  return [point(startM, northM), point(endM, northM)].map(({ lat, lng }) => ({ lat, lng }));
}

function geometryLength(points: Array<{ lat: number; lng: number }>): number {
  const rad = (value: number) => value * Math.PI / 180;
  return points.slice(1).reduce((total, next, index) => {
    const previous = points[index];
    const dLat = rad(next.lat - previous.lat);
    const dLng = rad(next.lng - previous.lng);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(rad(previous.lat)) * Math.cos(rad(next.lat)) * Math.sin(dLng / 2) ** 2;
    return total + 2 * 6_371_000 * Math.asin(Math.sqrt(h));
  }, 0);
}

function mapMatchingResponse(canonical: RawPoint[], northM: number, name: string | null, alternatives = 0) {
  const network = canonical.map((source, index) => {
    const target = point(
      (source.lng - 120) * METRES_PER_DEGREE * Math.cos(BASE_LAT * Math.PI / 180),
      northM,
      index,
    );
    return [target.lng, target.lat] as [number, number];
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 'Ok',
      matchings: [{ confidence: 0.98, geometry: { coordinates: network } }],
      tracepoints: network.map((location, index) => ({
        matchings_index: 0,
        waypoint_index: index,
        alternatives_count: alternatives,
        name,
        location,
      })),
    }),
  } as Response;
}

describe('O50 composite mapped-corridor evidence', () => {
  test('accepts a coherent high-confidence corridor with a tiny isolated p95 threshold overrun', () => {
    const canonical = line(0, 120, 15.058, 22).map((sample, index) => ({
      ...sample,
      // Keep the maximum and endpoint under the deliberately narrow overrun guard.
      lat: BASE_LAT + (index === 0 || index === 21 ? 15.8 : 15.058) / METRES_PER_DEGREE,
      accuracy: 12,
    }));
    const evidence = evaluateCorridorEvidence({
      canonical,
      network: networkLine(0, 120, 0),
      mapboxConfidence: 0.946,
      supportCount: 22,
      expectedSupportCount: 22,
      alternatives: Array(22).fill(0),
    });
    expect(evidence.accepted).toBe(true);
    expect(evidence.acceptedByCoherentOverrun).toBe(true);
    expect(evidence.reason).toBe('coherent-isolated-envelope-overrun');
  });

  test('does not let the same overrun steal an ambiguous parallel road', () => {
    const canonical = line(0, 120, 15.2, 22).map(sample => ({ ...sample, accuracy: 12 }));
    const evidence = evaluateCorridorEvidence({
      canonical,
      network: networkLine(0, 120, 0),
      mapboxConfidence: 0.95,
      supportCount: 22,
      expectedSupportCount: 22,
      alternatives: Array(22).fill(2),
      routeAlternativeCount: 2,
    });
    expect(evidence.acceptedByCoherentOverrun).toBe(false);
  });

  test('requires a stable signed side before an evidence-derived road offset', () => {
    const stable = evaluateLateralOffsetEvidence(line(0, 100, 7, 12), networkLine(0, 100, 0));
    const unstable = evaluateLateralOffsetEvidence(
      Array.from({ length: 12 }, (_unused, index) => point(index * 9, index % 2 ? 7 : -7, index)),
      networkLine(0, 100, 0),
    );
    expect(stable.stable).toBe(true);
    expect(stable.stableSignFraction).toBe(1);
    expect(unstable.stable).toBe(false);
  });
});

describe('O50 pedestrian geometry modes', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('mapped road centerline plus stable side becomes Mode B, not centreline display', async () => {
    const canonical = line(0, 100, 8, 12);
    global.fetch = jest.fn(async () => mapMatchingResponse(canonical, 0, 'Example Road')) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.sections.some(section => section.geometryMode === 'B_ROAD_OFFSET')).toBe(true);
    expect(result.stats.sections.find(section => section.geometryMode === 'B_ROAD_OFFSET')?.lateralOffsetM)
      .toBeGreaterThan(6);
  });

  test('independent unnamed pedestrian-aligned geometry becomes Mode A', async () => {
    const canonical = line(0, 100, 0, 12);
    global.fetch = jest.fn(async () => mapMatchingResponse(canonical, 0, null)) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.sections.some(section => section.geometryMode === 'A_PEDESTRIAN_NETWORK')).toBe(true);
  });

  test('ambiguous parallel-road support falls back to canonical-derived Mode C', async () => {
    const canonical = line(0, 100, 8, 12);
    global.fetch = jest.fn(async () => mapMatchingResponse(canonical, 0, 'Parallel Road', 2)) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.sections.every(section => section.geometryMode === 'C_CANONICAL_DERIVED')).toBe(true);
  });

  test('mapped → off-network → mapped assembles one chronological mixed Final', async () => {
    const first = line(0, 75, 8, 16);
    const middle = Array.from({ length: 16 }, (_unused, index) => point(80 + index * 4, 8 + index * 2, index + 16));
    const last = line(148, 223, -8, 16).map((sample, index) => ({ ...sample, t: point(0, 0, index + 32).t }));
    const canonical = [...first, ...middle, ...last];
    let call = 0;
    global.fetch = jest.fn(async (url: string) => {
      const coords = url.split('/walking/')[1].split('?')[0].split(';').map(value => {
        const [lng, lat] = value.split(',').map(Number);
        return { lng, lat };
      });
      const start = call === 0 ? 0 : call === 1 ? 12 : 0;
      const end = call === 0 ? 15 : coords.length - 1;
      call += 1;
      const geometry = coords.slice(start, end + 1).map(sample => [sample.lng, BASE_LAT] as [number, number]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 'Ok',
          matchings: [{ confidence: 0.98, geometry: { coordinates: geometry } }],
          tracepoints: coords.map((sample, index) => index >= start && index <= end ? ({
            matchings_index: 0,
            waypoint_index: index - start,
            alternatives_count: 0,
            name: 'Mixed Road',
            location: [sample.lng, BASE_LAT],
          }) : null),
        }),
      } as Response;
    }) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points[0]).toMatchObject({ lat: canonical[0].lat, lng: canonical[0].lng });
    expect(result.points[result.points.length - 1]).toMatchObject({
      lat: canonical[canonical.length - 1].lat,
      lng: canonical[canonical.length - 1].lng,
    });
    expect(result.stats.sections.filter(section => section.geometryMode === 'B_ROAD_OFFSET').length).toBeGreaterThanOrEqual(2);
    expect(result.stats.sections.some(section => section.networkSource === 'none')).toBe(true);
  });

  test('matching timeout degrades to bounded canonical-derived geometry', async () => {
    const canonical = line(0, 100, 0, 12).map((sample, index) => ({
      ...sample,
      lat: sample.lat + (index % 2 ? 0.7 : -0.7) / METRES_PER_DEGREE,
    }));
    global.fetch = jest.fn((_url, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
    })) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      perCallTimeoutMs: 5,
      totalTimeoutMs: 20,
      directionsFallback: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.requestResults[0].result).toBe('timeout-or-abort');
    expect(result.stats.sections[0].state).toBe('OFF_NETWORK_PATH');
  });
});

describe('O50 free/off-network cleanup product contracts', () => {
  test('diagonal road crossing removes harmless wobble without changing anchors', () => {
    const crossing = Array.from({ length: 15 }, (_unused, index) => (
      point(index * 3, index * 2 + (index % 2 ? 0.55 : -0.55), index)
    ));
    const cleaned = cleanCanonicalGeometry(crossing);
    expect(cleaned.length).toBeLessThan(crossing.length);
    expect(cleaned[0]).toMatchObject({ lat: crossing[0].lat, lng: crossing[0].lng });
    expect(cleaned[cleaned.length - 1]).toMatchObject({
      lat: crossing[crossing.length - 1].lat,
      lng: crossing[crossing.length - 1].lng,
    });
  });

  test.each([
    ['true unmapped trail', [point(0, 0, 0), point(20, 2, 1), point(40, 8, 2), point(60, 20, 3)], 1.01],
    ['plaza/open area dog-leg', [point(0, 0, 0), point(20, 0, 1), point(20, 18, 2), point(38, 18, 3)], 1.05],
    ['Z', [point(0, 0, 0), point(20, 0, 1), point(5, 12, 2), point(25, 24, 3)], 1.05],
    ['switchback', [point(0, 0, 0), point(25, 4, 1), point(2, 9, 2), point(27, 14, 3)], 1.05],
  ])('preserves meaningful intent for %s', (_name, canonical, minimumRatio) => {
    const cleaned = cleanCanonicalGeometry(canonical);
    expect(cleaned[0]).toMatchObject({ lat: canonical[0].lat, lng: canonical[0].lng });
    expect(cleaned[cleaned.length - 1]).toMatchObject({
      lat: canonical[canonical.length - 1].lat,
      lng: canonical[canonical.length - 1].lng,
    });
    expect(geometryLength(cleaned)).toBeGreaterThan(
      geometryLength([canonical[0], canonical[canonical.length - 1]]) * minimumRatio,
    );
  });

  test('preserves a U-turn and repeated corridor chronology', () => {
    const outbound = line(0, 60, 0, 8);
    const returning = line(60, 0, 0.4, 8).slice(1).map((sample, index) => ({
      ...sample,
      t: outbound[outbound.length - 1].t! + (index + 1) * 4_000,
    }));
    const canonical = [...outbound, ...returning];
    const critical = finalGeometryCriticalIndices(canonical);
    const cleaned = cleanCanonicalGeometry(canonical);
    expect(critical.some(index => index >= 6 && index <= 9)).toBe(true);
    expect(geometryLength(cleaned)).toBeGreaterThan(105);
    expect(cleaned[cleaned.length - 1].lng).toBeCloseTo(canonical[canonical.length - 1].lng, 7);
  });

  test('stop boundary survives cleanup', () => {
    const canonical = line(0, 50, 0, 8);
    canonical[4].t = canonical[3].t! + 25_000;
    for (let index = 5; index < canonical.length; index += 1) canonical[index].t = canonical[index - 1].t! + 4_000;
    expect(finalGeometryCriticalIndices(canonical)).toEqual(expect.arrayContaining([3, 4]));
  });

  test('Gap remains two independently reconstructed segments and is never bridged', async () => {
    const before = line(0, 40, 0, 6);
    const after = line(100, 140, 0, 6);
    const first = await reconstructPedestrianFinalRoute(before, { mapboxToken: '', directionsFallback: false });
    const second = await reconstructPedestrianFinalRoute(after, { mapboxToken: '', directionsFallback: false });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.points[first.points.length - 1].lng).toBeCloseTo(before[before.length - 1].lng, 7);
    expect(second.points[0].lng).toBeCloseTo(after[0].lng, 7);
  });

  test('road side A to crossing to side B retains the side change evidence', () => {
    const canonical = [
      ...line(0, 30, 7, 5),
      point(36, 2, 5), point(42, -4, 6),
      ...line(48, 78, -7, 5).map((sample, index) => ({ ...sample, t: point(0, 0, index + 7).t })),
    ];
    const cleaned = cleanCanonicalGeometry(canonical);
    expect(Math.max(...cleaned.map(sample => sample.lat))).toBeGreaterThan(BASE_LAT);
    expect(Math.min(...cleaned.map(sample => sample.lat))).toBeLessThan(BASE_LAT);
  });

  test('offset geometry follows real evidence instead of a standard sidewalk constant', () => {
    const network = networkLine(0, 100, 0);
    const shifted = offsetNetworkGeometry(network, 11.3);
    const evidence = evaluateLateralOffsetEvidence(line(0, 100, 11.3, 12), shifted);
    expect(evidence.absoluteMedianM).toBeLessThan(0.2);
  });
});

describe('bounded Directions fallback contract', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  test('Directions-routable but Map-Matching-failing common path is evaluated from observed anchors', async () => {
    const canonical = line(0, 80, 0, 12);
    let requestCount = 0;
    global.fetch = jest.fn(async (url: string) => {
      requestCount += 1;
      if (url.includes('/matching/')) {
        return { ok: true, status: 200, json: async () => ({ code: 'NoSegment' }) } as Response;
      }
      const coordinates = canonical.map(sample => [sample.lng, sample.lat]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 'Ok',
          routes: [{ geometry: { coordinates }, legs: [{ steps: [{ name: null }] }] }],
        }),
      } as Response;
    }) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      maxDirectionsRequests: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(requestCount).toBe(2);
    expect(result.stats.directionsRequestCount).toBe(1);
    expect(result.stats.sections.some(section => section.networkSource === 'walking-directions')).toBe(true);
  });
});
