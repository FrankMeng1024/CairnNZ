import {
  buildBaseFinalGeometry,
  cleanCanonicalGeometry,
  cropGeometryToTracepoints,
  deriveSnapSectionRuns,
  evaluateCorridorEvidence,
  evaluateLateralOffsetEvidence,
  finalGeometryCriticalIndices,
  matchingWindows,
  offsetNetworkGeometry,
  reconstructPedestrianFinalRoute,
} from '../pedestrianFinalRoute';
import {
  evaluateMatchedGeometryQuality,
  resampleMatcherEvidence,
  type RawPoint,
  type SnappedPoint,
} from '../snapTrack';

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

  test('strong corridor with uncertain sidewalk side becomes weak-same-corridor reconstruction', async () => {
    const canonical = Array.from({ length: 18 }, (_unused, index) => (
      point(index * 8, index % 2 === 0 ? -3 : 3, index, 14)
    ));
    global.fetch = jest.fn(async () => mapMatchingResponse(canonical, 0, 'Ordinary Road')) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.weakSameCorridorSectionCount).toBeGreaterThan(0);
    expect(result.stats.sections.some(section => (
      section.state === 'NETWORK_WEAK_SAME_CORRIDOR'
      && section.geometryMode === 'D_WEAK_SAME_CORRIDOR'
      && section.decision === 'refined'
    ))).toBe(true);
    // The two exact canonical endpoints remain truth anchors; the reconstructed
    // corridor between them should no longer oscillate between sidewalk sides.
    const corridorInterior = result.points.slice(1, -1);
    const lateralRangeM = Math.max(...corridorInterior.map(sample => sample.lat))
      - Math.min(...corridorInterior.map(sample => sample.lat));
    expect(lateralRangeM * METRES_PER_DEGREE).toBeLessThan(2);
  });

  test('does not turn a tiny weak-corridor endpoint sliver into a network hook', async () => {
    const canonical = Array.from({ length: 7 }, (_unused, index) => (
      point(index * 8, index % 2 === 0 ? -3 : 3, index, 14)
    ));
    global.fetch = jest.fn(async () => mapMatchingResponse(canonical, 0, 'Perimeter Road')) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.weakSameCorridorSectionCount).toBe(0);
    expect(result.stats.sectionDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        result: 'rejected',
        reasonCode: 'LOCAL_NO_MEANINGFUL_IMPROVEMENT',
      }),
    ]));
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
    global.fetch = jest.fn(async (url: string) => {
      const coords = url.split('/walking/')[1].split('?')[0].split(';').map(value => {
        const [lng, lat] = value.split(',').map(Number);
        return { lng, lat };
      });
      const firstEnd = 15;
      const lastStart = 32;
      const firstGeometry = coords.slice(0, firstEnd + 1)
        .map(sample => [sample.lng, BASE_LAT] as [number, number]);
      const lastGeometry = coords.slice(lastStart)
        .map(sample => [sample.lng, BASE_LAT] as [number, number]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 'Ok',
          matchings: [
            { confidence: 0.98, geometry: { coordinates: firstGeometry } },
            { confidence: 0.98, geometry: { coordinates: lastGeometry } },
          ],
          tracepoints: coords.map((sample, index) => index <= firstEnd ? ({
            matchings_index: 0,
            waypoint_index: index,
            alternatives_count: 0,
            name: 'Mixed Road',
            location: [sample.lng, BASE_LAT],
          }) : index >= lastStart ? ({
            matchings_index: 1,
            waypoint_index: index - lastStart,
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

  test('the completion budget returns even when a transport ignores AbortSignal', async () => {
    jest.useFakeTimers();
    try {
      const canonical = line(0, 100, 0, 12);
      global.fetch = jest.fn(() => new Promise<Response>(() => undefined)) as any;
      const completing = reconstructPedestrianFinalRoute(canonical, {
        mapboxToken: 'pk.test',
        directionsFallback: false,
        totalTimeoutMs: 40,
        perCallTimeoutMs: 20,
      });
      await jest.advanceTimersByTimeAsync(45);
      const result = await completing;
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stats.acceptedMatchedDistanceM).toBe(0);
      expect(result.stats.wholeRouteValidation.accepted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('O50 free/off-network cleanup product contracts', () => {
  test('straight 1–5 m urban wobble becomes a nearly straight consumer route', () => {
    const canonical = Array.from({ length: 61 }, (_unused, index) => (
      point(index * 4, Math.sin(index * 1.4) * 4.6, index, 14)
    ));
    const base = buildBaseFinalGeometry(canonical);
    expect(base.diagnostics.corridorClass).toBe('simple');
    expect(base.points.length).toBeLessThan(canonical.length / 2);
    expect(geometryLength(base.points) / geometryLength([canonical[0], canonical.at(-1)!])).toBeLessThan(1.05);
  });

  test('gentle bend is smooth while a real 90 degree corner remains anchored', () => {
    const bend = Array.from({ length: 41 }, (_unused, index) => {
      const angle = (Math.PI / 3) * index / 40;
      return point(Math.sin(angle) * 100, (1 - Math.cos(angle)) * 100, index, 12);
    });
    const bendBase = buildBaseFinalGeometry(bend);
    expect(bendBase.points.length).toBeLessThan(bend.length);
    expect(geometryLength(bendBase.points) / geometryLength(bend)).toBeGreaterThan(0.96);

    const corner = [
      ...line(0, 60, 0, 13),
      ...Array.from({ length: 13 }, (_unused, index) => point(60, index * 5, index + 13)).slice(1),
    ];
    const cornerBase = buildBaseFinalGeometry(corner);
    expect(cornerBase.points.some(sample => geometryLength([sample, point(60, 0)]) < 1)).toBe(true);
  });

  test('stationary cloud and stop jitter do not become spaghetti or a fake spur', () => {
    const cloud = Array.from({ length: 30 }, (_unused, index) => (
      point(Math.sin(index * 2.1) * 5, Math.cos(index * 1.7) * 5, index, 14)
    ));
    const cloudBase = buildBaseFinalGeometry(cloud);
    expect(cloudBase.diagnostics.stationaryCloudCollapsed).toBe(true);
    expect(cloudBase.points).toHaveLength(2);

    const before = line(0, 40, 0, 9);
    const stop = Array.from({ length: 8 }, (_unused, index) => point(40 + Math.sin(index) * 2, Math.cos(index) * 2, index + 9, 14));
    const after = line(40, 90, 0, 11).map((sample, index) => ({ ...sample, t: point(0, 0, index + 17).t }));
    const stopped = buildBaseFinalGeometry([...before, ...stop, ...after]);
    expect(Math.max(...stopped.points.map(sample => Math.abs((sample.lat - BASE_LAT) * METRES_PER_DEGREE)))).toBeLessThan(5);
  });

  test('Base Final removes an uncertainty-sized same-corridor micro-spur', () => {
    const canonical = [
      point(-20, 0, 0, 12), point(-10, 0, 1, 12), point(0, 0, 2, 12),
      point(2, 3, 3, 12), point(4, 7, 4, 12), point(2, 3, 5, 12),
      point(0.5, 0.3, 6, 12), point(10, 0, 7, 12), point(20, 0, 8, 12),
    ];
    const base = buildBaseFinalGeometry(canonical);
    expect(base.diagnostics.removedMicroExcursionCount).toBe(1);
    expect(base.diagnostics.maximumRemovedExcursionDepthM).toBeGreaterThan(6);
    expect(Math.max(...base.points.map(sample => (
      (sample.lat - BASE_LAT) * METRES_PER_DEGREE
    )))).toBeLessThan(1);
  });

  test('Base Final preserves a larger same-corridor excursion beyond the ambiguity fuse', () => {
    const canonical = [
      point(-20, 0, 0, 12), point(-10, 0, 1, 12), point(0, 0, 2, 12),
      point(4, 7, 3, 12), point(7, 15, 4, 12), point(4, 7, 5, 12),
      point(0.5, 0.3, 6, 12), point(10, 0, 7, 12), point(20, 0, 8, 12),
    ];
    const base = buildBaseFinalGeometry(canonical);
    expect(base.diagnostics.removedMicroExcursionCount).toBe(0);
    expect(Math.max(...base.points.map(sample => (
      (sample.lat - BASE_LAT) * METRES_PER_DEGREE
    )))).toBeGreaterThan(10);
  });

  test('Base Final removes an isolated uncertainty-bounded lateral spike', () => {
    const canonical = [
      point(0, 0, 0, 14), point(10, 0, 1, 14), point(15, 9, 2, 14),
      point(20, 0, 3, 14), point(30, 0, 4, 14),
    ];
    const base = buildBaseFinalGeometry(canonical);
    expect(base.diagnostics.removedTransientSpikeCount).toBe(1);
    expect(base.diagnostics.maximumRemovedTransientSpikeDepthM).toBeGreaterThan(8);
    expect(Math.max(...base.points.map(sample => (
      Math.abs((sample.lat - BASE_LAT) * METRES_PER_DEGREE)
    )))).toBeLessThan(1);
  });

  test('a poor isolated burst uses local uncertainty instead of a good segment-wide p65', () => {
    const canonical = Array.from({ length: 81 }, (_unused, index) => (
      point(index * 3, index === 40 ? 12 : 0, index, index === 40 ? 25 : 5)
    ));
    const base = buildBaseFinalGeometry(canonical);
    expect(base.diagnostics.effectiveUncertaintyM).toBe(5);
    expect(base.diagnostics.removedTransientSpikeCount).toBeGreaterThan(0);
    expect(Math.max(...base.points.map(sample => (
      Math.abs((sample.lat - BASE_LAT) * METRES_PER_DEGREE)
    )))).toBeLessThan(8);
  });

  test.each([8_000, 15_000, 21_000])('%d ms delivery cadence is not inferred as user Pause', cadenceMs => {
    const canonical = Array.from({ length: 30 }, (_unused, index) => ({
      ...point(index * 3, index === 15 ? 12 : 0, index, 5),
      t: 1_700_000_000_000 + index * cadenceMs,
    }));
    const base = buildBaseFinalGeometry(canonical);
    const dense = buildBaseFinalGeometry(canonical.map((sample, index) => ({
      ...sample,
      t: 1_700_000_000_000 + index * 4_000,
    })));
    expect(base.diagnostics.pauseBoundaryCount).toBe(0);
    expect(base.points).toEqual(dense.points);
  });

  test('a coherent closed loop inside the accuracy radius is not collapsed as a stationary cloud', () => {
    const coordinates = [
      [0, 0], [3, 0], [6, 0], [6, 3], [6, 6], [3, 6], [0, 6], [0, 3], [0, 0],
    ];
    const loop = coordinates.map(([east, north], index) => point(east, north, index, 14));
    const base = buildBaseFinalGeometry(loop);
    expect(base.diagnostics.stationaryCloudCollapsed).toBe(false);
    expect(geometryLength(base.points)).toBeGreaterThan(18);
  });

  test('Base Final removes a short multi-fix spike but preserves supported path intent', () => {
    const burst = [
      point(0, 0, 0, 14), point(8, 0, 1, 14), point(12, 7, 2, 14),
      point(15, 9, 3, 14), point(18, 6, 4, 14), point(22, 0, 5, 14),
      point(30, 0, 6, 14),
    ];
    expect(buildBaseFinalGeometry(burst).diagnostics.removedTransientSpikeCount).toBe(1);

    const parallelRoad = [
      point(0, 0, 0, 14), point(10, 0, 1, 14), point(20, 8, 2, 14),
      point(30, 8, 3, 14), point(40, 8, 4, 14), point(50, 0, 5, 14),
      point(60, 0, 6, 14),
    ];
    const parallel = buildBaseFinalGeometry(parallelRoad);
    expect(parallel.diagnostics.removedTransientSpikeCount).toBe(0);
    expect(Math.max(...parallel.points.map(sample => (
      (sample.lat - BASE_LAT) * METRES_PER_DEGREE
    )))).toBeGreaterThan(6);
  });

  test('timestamp spacing inside one declared segment does not invent a Pause boundary', () => {
    const canonical = [
      point(0, 0, 0, 14), point(10, 0, 1, 14), point(15, 8, 2, 14),
      point(20, 0, 3, 14), point(30, 0, 4, 14),
    ];
    canonical[2].t = canonical[1].t! + 30_000;
    canonical[3].t = canonical[2].t! + 4_000;
    canonical[4].t = canonical[3].t! + 4_000;
    const base = buildBaseFinalGeometry(canonical);
    expect(base.diagnostics.removedTransientSpikeCount).toBe(1);
    expect(base.points.every(sample => (
      (sample.lat - BASE_LAT) * METRES_PER_DEGREE < 6
    ))).toBe(true);
  });

  test('offline Base Final reports uncertainty and complexity without network calls', async () => {
    const canonical = [
      point(0, 0, 0, 18), point(20, 0, 1, 18), point(2, 8, 2, 18),
      point(22, 16, 3, 18), point(4, 24, 4, 18), point(24, 32, 5, 18),
    ];
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: '',
      directionsFallback: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.algorithmVersion).toBe('pedestrian-final-v2-base');
    expect(result.stats.mapMatchingRequestCount).toBe(0);
    expect(result.stats.baseFinalDiagnostics.effectiveUncertaintyM).toBe(18);
    expect(result.stats.baseFinalDiagnostics.corridorClass).toBe('complex');
  });

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

  test('a long callback interval alone is not promoted to a stop boundary', () => {
    const canonical = line(0, 50, 0, 8);
    canonical[4].t = canonical[3].t! + 25_000;
    for (let index = 5; index < canonical.length; index += 1) canonical[index].t = canonical[index - 1].t! + 4_000;
    expect(finalGeometryCriticalIndices(canonical)).not.toEqual(expect.arrayContaining([3, 4]));
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

describe('temporal Map Matching crop correspondence', () => {
  test('closed loop follows tracepoint order instead of cropping tail back to the spatially-nearest head', () => {
    const geometry = [
      point(0, 0), point(10, 0), point(10, 10), point(0, 10), point(0, 0),
    ].map(({ lat, lng }) => ({ lat, lng }));
    const observations = geometry.map(sample => [sample.lng, sample.lat] as [number, number]);
    const cropped = cropGeometryToTracepoints(geometry, observations);
    expect(cropped).not.toBeNull();
    expect(cropped!.length).toBeGreaterThanOrEqual(5);
    expect(geometryLength(cropped!)).toBeGreaterThan(35);
  });
});

describe('bounded Directions fallback contract', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  test('NoSegment cannot be laundered into tracepoint confidence by endpoint-only Directions', async () => {
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
    expect(requestCount).toBe(1);
    expect(result.stats.directionsRequestCount).toBe(0);
    expect(result.stats.sections.every(section => section.networkSource === 'none')).toBe(true);
  });

  test('low-confidence Matching cannot be laundered by an identical Directions road', async () => {
    const canonical = line(0, 100, 9, 18).map(sample => ({ ...sample, accuracy: 7 }));
    let matchingRequests = 0;
    let directionsRequests = 0;
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/matching/')) {
        matchingRequests += 1;
        const response = mapMatchingResponse(canonical, 0, 'Major Road');
        const body = await response.json() as any;
        body.matchings[0].confidence = 0.31;
        return { ...response, json: async () => body } as Response;
      }
      directionsRequests += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 'Ok',
          routes: [{
            geometry: { coordinates: canonical.map(sample => [sample.lng, BASE_LAT]) },
            legs: [{ steps: [{ name: 'Major Road' }] }],
          }],
        }),
      } as Response;
    }) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      maxDirectionsRequests: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(matchingRequests).toBe(1);
    expect(directionsRequests).toBe(0);
    expect(result.stats.directionsRequestCount).toBe(0);
    expect(result.stats.acceptedMatchedDistanceM).toBe(0);
  });

  test('accurate internal-path evidence stays local beside a named arterial candidate', async () => {
    const canonical = line(0, 120, 18, 22).map(sample => ({ ...sample, accuracy: 4 }));
    global.fetch = jest.fn(async () => mapMatchingResponse(canonical, 0, 'Nearby Arterial')) as any;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      maxDirectionsRequests: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.acceptedMatchedDistanceM).toBe(0);
    expect(result.stats.directionsRequestCount).toBe(0);
    expect(result.stats.sections.every(section => section.networkSource === 'none')).toBe(true);
  });
});

describe('evidence-scoped section and request planning', () => {
  test('a persistent local truth-envelope excursion does not poison supported spans on both sides', async () => {
    const canonical = line(0, 100, 0, 11).map(sample => ({ ...sample, accuracy: 14 }));
    const network = canonical.map((sample, index) => {
      const northM = index >= 4 && index <= 6 ? 16 : 0;
      const shifted = point(index * 10, northM, index, 14);
      return [shifted.lng, shifted.lat] as [number, number];
    });
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        matchings: [{ confidence: 0.98, geometry: { coordinates: network } }],
        tracepoints: network.map((location, index) => ({
          matchings_index: 0,
          waypoint_index: index,
          alternatives_count: 0,
          name: null,
          location,
        })),
      }),
    })) as any;
    const wholeCandidateQuality = evaluateMatchedGeometryQuality(
      canonical,
      network.map(([lng, lat]) => ({ lng, lat })),
    );
    const correspondencesM = canonical.map((sample, index) => (
      Math.abs(network[index][1] - sample.lat) * METRES_PER_DEGREE
    ));
    expect(wholeCandidateQuality.reason).toBe('raw_deviation');
    expect(wholeCandidateQuality.deviationEnvelopeM).toBe(15);
    expect(wholeCandidateQuality.p95DeviationM).toBeGreaterThan(15);
    expect(Math.max(...correspondencesM)).toBeLessThan(14 * 1.25);

    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.sectionDecisions.map(section => ({
      sourceStart: section.sourceStart,
      sourceEnd: section.sourceEnd,
      classification: section.classification,
      result: section.result,
      reasonCode: section.reasonCode,
    }))).toEqual([
      {
        sourceStart: 0,
        sourceEnd: 3,
        classification: 'SNAP_ELIGIBLE',
        result: 'accepted',
        reasonCode: 'TRACEPOINT_SUPPORTED',
      },
      {
        sourceStart: 4,
        sourceEnd: 6,
        classification: 'LOCAL_ONLY',
        result: 'rejected',
        reasonCode: 'LOCAL_TRUTH_ENVELOPE_EXCEEDED',
      },
      {
        sourceStart: 7,
        sourceEnd: 10,
        classification: 'SNAP_ELIGIBLE',
        result: 'accepted',
        reasonCode: 'TRACEPOINT_SUPPORTED',
      },
    ]);
    expect(result.stats.sections.map(section => section.decision)).toEqual([
      'refined', 'canonical-derived', 'refined',
    ]);
  });

  test('one or two truth-envelope-pressure samples cannot manufacture a matched crop', () => {
    const canonical = line(0, 100, 0, 11).map(sample => ({ ...sample, accuracy: 14 }));
    const submitted = resampleMatcherEvidence(canonical, 4_000);
    const tracepoints = submitted.map((sample, index) => {
      const shifted = point(index * 10, index >= 4 && index <= 5 ? 16 : 0, index, 14);
      return {
        matchings_index: 0,
        waypoint_index: index,
        alternatives_count: 0,
        location: [shifted.lng, shifted.lat] as [number, number],
      };
    });

    expect(deriveSnapSectionRuns(submitted, tracepoints, 0)).toEqual([
      expect.objectContaining({
        sourceStart: 0,
        sourceEnd: 10,
        classification: 'SNAP_ELIGIBLE',
        reasonCode: 'TRACEPOINT_SUPPORTED',
      }),
    ]);
  });

  test('a persistent ambiguous subsection stays local while supported spans on both sides remain independent', () => {
    const canonical = line(0, 150, 0, 31);
    const submitted = resampleMatcherEvidence(canonical, 4_000);
    const tracepoints = submitted.map((sample, index) => ({
      matchings_index: 0,
      waypoint_index: index,
      alternatives_count: index >= 13 && index <= 17 ? 2 : 0,
      name: 'Candidate corridor',
      location: [sample.lng, sample.lat] as [number, number],
    }));
    const sections = deriveSnapSectionRuns(submitted, tracepoints, 0);
    expect(sections.map(section => section.classification)).toEqual([
      'SNAP_ELIGIBLE', 'AMBIGUOUS', 'SNAP_ELIGIBLE',
    ]);
    expect(sections[1]).toMatchObject({
      reasonCode: 'LOCAL_PARALLEL_ROAD_AMBIGUITY',
    });
    expect(sections[0].sourceEnd).toBeLessThan(sections[1].sourceStart);
    expect(sections[1].sourceEnd).toBeLessThan(sections[2].sourceStart);
  });

  test('Matching uses provider-scale windows and gives bounded plans Activity-wide coverage', () => {
    const canonical = line(0, 1_500, 0, 301);
    const plans = matchingWindows(resampleMatcherEvidence(canonical, 4_000));
    expect(plans.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...plans.map(plan => plan.points.length))).toBeLessThanOrEqual(80);
    const firstFour = plans.slice(0, 4).map(plan => [
      plan.points[0].sourceIndex,
      plan.points.at(-1)!.sourceIndex,
    ]);
    expect(firstFour.some(([, end]) => end >= 290)).toBe(true);
    expect(firstFour.some(([start, end]) => start < 170 && end > 130)).toBe(true);
  });
});

describe('durable cancellation dispatch boundary', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('abort stops every active request and bounded workers dispatch no later window', async () => {
    const canonical = line(0, 2_000, 0, 260);
    let invocations = 0;
    global.fetch = jest.fn((_url: string, init?: RequestInit) => {
      invocations += 1;
      return new Promise((_resolve, reject) => {
        const fail = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener('abort', fail, { once: true });
      });
    }) as any;
    const controller = new AbortController();
    const running = reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      concurrency: 2,
      directionsFallback: false,
      signal: controller.signal,
    });
    for (let turn = 0; turn < 20 && invocations < 2; turn += 1) await Promise.resolve();
    expect(invocations).toBe(2);
    controller.abort();
    await running;
    await Promise.resolve();
    expect(invocations).toBe(2);
  });
});
