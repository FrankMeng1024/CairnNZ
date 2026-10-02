import {
  anchorEndpointTransition,
  reconstructPedestrianFinalRoute,
} from '../pedestrianFinalRoute';
import type { RawPoint, SnappedPoint } from '../snapTrack';

const METRES_PER_DEGREE = 111_320;
const BASE_LAT = 30;

function point(eastM: number, northM: number): SnappedPoint {
  return {
    lng: 120 + eastM / (METRES_PER_DEGREE * Math.cos(BASE_LAT * Math.PI / 180)),
    lat: BASE_LAT + northM / METRES_PER_DEGREE,
  };
}

function providerLine(lengthM: number, spacingM: number): SnappedPoint[] {
  const points: SnappedPoint[] = [];
  for (let eastM = 0; eastM < lengthM; eastM += spacingM) points.push(point(eastM, 0));
  points.push(point(lengthM, 0));
  return points;
}

function canonicalAnchors(lengthM: number, headNorthM: number, tailNorthM = headNorthM): RawPoint[] {
  return [
    { ...point(0, headNorthM), t: 1_700_000_000_000, accuracy: 12 },
    { ...point(lengthM, tailNorthM), t: 1_700_000_004_000, accuracy: 12 },
  ];
}

function canonicalLine(lengthM: number, spacingM: number, northMValue: number): RawPoint[] {
  return providerLine(lengthM, spacingM).map((sample, index) => ({
    ...point(index * spacingM, northMValue),
    t: 1_700_000_000_000 + index * 4_000,
    accuracy: 12,
  }));
}

function mapMatchingFetch(canonical: RawPoint[], lengthM: number, providerSpacingM: number): typeof fetch {
  return jest.fn(async () => {
    const geometry = providerLine(lengthM, providerSpacingM);
    const tracepoints = canonical.map((sample, index) => {
      const eastM = index * (lengthM / Math.max(1, canonical.length - 1));
      const network = point(eastM, 0);
      return {
        matchings_index: 0,
        waypoint_index: index,
        alternatives_count: 0,
        name: 'Mapped pedestrian trail',
        location: [network.lng, network.lat],
      };
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        code: 'Ok',
        matchings: [{
          confidence: 0.98,
          geometry: { coordinates: geometry.map(sample => [sample.lng, sample.lat]) },
        }],
        tracepoints,
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function hav(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function northM(value: { lat: number }): number {
  return (value.lat - BASE_LAT) * METRES_PER_DEGREE;
}

function latitudeAtLongitude(points: SnappedPoint[], longitude: number): number {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (longitude < previous.lng || longitude > next.lng) continue;
    const fraction = (longitude - previous.lng) / Math.max(Number.EPSILON, next.lng - previous.lng);
    return previous.lat + (next.lat - previous.lat) * fraction;
  }
  return points[points.length - 1].lat;
}

describe('O71 immutable endpoint transitions', () => {
  test('is invariant across 1m, 2m, 5m and 10m subdivisions of the same 100m line', () => {
    const canonical = canonicalAnchors(100, 10);
    const inputs = [1, 2, 5, 10].map(spacingM => ({
      spacingM,
      points: providerLine(100, spacingM),
    }));
    const snapshots = inputs.map(input => JSON.stringify(input.points));
    const transitions = inputs.map(input => anchorEndpointTransition(input.points, canonical));
    const reference = transitions[0].points;
    const comparisons = transitions.map((transition, index) => ({
      spacingM: inputs[index].spacingM,
      accepted: transition.quality.accepted,
      northAt10M: northM(transition.points[Math.round(10 / inputs[index].spacingM)]),
      maximumSameChainageDifferenceM: Math.max(...reference.map(sample => hav(sample, {
        lng: sample.lng,
        lat: latitudeAtLongitude(transition.points, sample.lng),
      }))),
      quality: transition.quality,
    }));

    console.log('O71_REPAIRED_DENSITY', JSON.stringify(comparisons));
    for (const comparison of comparisons) {
      expect(comparison.accepted).toBe(true);
      expect(comparison.northAt10M).toBeCloseTo(7.5, 2);
      expect(comparison.maximumSameChainageDifferenceM).toBeLessThan(0.02);
    }
    expect(inputs.map(input => JSON.stringify(input.points))).toEqual(snapshots);
  });

  test('makes overlapping short-span policy exact, symmetric and locally ineligible', () => {
    const canonical = canonicalAnchors(30, 10);
    const input = providerLine(30, 10);
    const forward = anchorEndpointTransition(input, canonical);
    const reverseProcessed = anchorEndpointTransition(
      input.slice().reverse(),
      canonical.slice().reverse(),
    );
    const reversedPoints = reverseProcessed.points.slice().reverse();
    const headErrorM = hav(forward.points[0], canonical[0]);
    const reverseDifferenceM = Math.max(...forward.points.map((sample, index) => (
      hav(sample, reversedPoints[index])
    )));

    console.log('O71_REPAIRED_OVERLAP', JSON.stringify({
      quality: forward.quality,
      headErrorM,
      tailErrorM: hav(forward.points[forward.points.length - 1], canonical[canonical.length - 1]),
      reverseDifferenceM,
      forward: forward.points,
      reverseProcessed: reversedPoints,
    }));
    expect(forward.quality).toMatchObject({
      accepted: false,
      reason: 'LOCAL_ANCHOR_OVERLAP_UNRESOLVED',
      preservedInteriorM: 0,
    });
    expect(headErrorM).toBeCloseTo(0, 5);
    expect(hav(forward.points[forward.points.length - 1], canonical[canonical.length - 1])).toBeCloseTo(0, 5);
    expect(reverseDifferenceM).toBeLessThan(0.001);
  });

  test('makes candidate disposition density-invariant and rejects overlap before assembly', async () => {
    const run = async (lengthM: number, providerSpacingM: number) => {
      const canonical = canonicalLine(lengthM, 10, 10);
      const result = await reconstructPedestrianFinalRoute(canonical, {
        mapboxToken: 'pk.test',
        directionsFallback: false,
        fetchImpl: mapMatchingFetch(canonical, lengthM, providerSpacingM),
        qualityTrace: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      return {
        refinedSections: result.stats.sections.filter(section => section.decision === 'refined').length,
        decisions: result.stats.sectionDecisions.map(decision => ({
          result: decision.result,
          reasonCode: decision.reasonCode,
          notes: decision.notes,
        })),
        preFallbackWholeRouteValidation: result.stats.preFallbackWholeRouteValidation,
        wholeRouteValidation: result.stats.wholeRouteValidation,
        traces: result.stats.candidateTransformationTraces,
      };
    };

    const dense100 = await run(100, 1);
    const sparse100 = await run(100, 10);
    const sparse30 = await run(30, 10);
    console.log('O71_REPAIRED_CANDIDATE_BOUNDARY', JSON.stringify({ dense100, sparse100, sparse30 }));

    expect(dense100.refinedSections).toBeGreaterThan(0);
    expect(sparse100.refinedSections).toBeGreaterThan(0);
    expect(dense100.decisions.map(decision => decision.result)).toEqual(
      sparse100.decisions.map(decision => decision.result),
    );
    expect(dense100.preFallbackWholeRouteValidation.accepted).toBe(true);
    expect(sparse100.preFallbackWholeRouteValidation.accepted).toBe(true);
    expect(sparse30.preFallbackWholeRouteValidation.accepted).toBe(true);
    expect(sparse30.refinedSections).toBe(0);
    expect(sparse30.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reasonCode: 'LOCAL_ANCHOR_OVERLAP_UNRESOLVED',
        notes: expect.arrayContaining([
          expect.stringContaining('candidate:anchor-transition:LOCAL_ANCHOR_OVERLAP_UNRESOLVED'),
        ]),
      }),
    ]));
  });
});

describe('O71 endpoint-transition geometry contract', () => {
  test('handles 20/30/50/100m same-side and opposite-side spans with exact symmetric policy', () => {
    for (const lengthM of [20, 30, 50, 100]) {
      for (const tailNorthM of [10, -10]) {
        const input = providerLine(lengthM, 10);
        const canonical = canonicalAnchors(lengthM, 10, tailNorthM);
        const forward = anchorEndpointTransition(input, canonical);
        const reversed = anchorEndpointTransition(
          input.slice().reverse(),
          canonical.slice().reverse(),
        ).points.reverse();
        expect(hav(forward.points[0], canonical[0])).toBeLessThan(0.001);
        expect(hav(forward.points[forward.points.length - 1], canonical[1])).toBeLessThan(0.001);
        expect(Math.max(...forward.points.map((sample, index) => hav(sample, reversed[index]))))
          .toBeLessThan(0.001);
        if (lengthM === 100) {
          expect(forward.quality.accepted).toBe(true);
          expect(forward.quality.preservedInteriorM).toBeGreaterThan(15);
        } else {
          expect(forward.quality).toMatchObject({
            accepted: false,
            reason: 'LOCAL_ANCHOR_OVERLAP_UNRESOLVED',
          });
        }
      }
    }
  });

  test('supports head-only, tail-only, both-end and zero-displacement transitions without mutating inputs', () => {
    const input = providerLine(100, 10);
    const snapshot = JSON.stringify(input);
    const headOnly = anchorEndpointTransition(input, canonicalAnchors(100, 10, 0), true, false);
    const tailOnly = anchorEndpointTransition(input, canonicalAnchors(100, 0, 10), false, true);
    const both = anchorEndpointTransition(input, canonicalAnchors(100, 10), true, true);
    const zero = anchorEndpointTransition(input, canonicalAnchors(100, 0), true, true);

    expect([headOnly, tailOnly, both, zero].every(result => result.quality.accepted)).toBe(true);
    expect(hav(headOnly.points[0], canonicalAnchors(100, 10, 0)[0])).toBeLessThan(0.001);
    expect(hav(headOnly.points[headOnly.points.length - 1], input[input.length - 1])).toBeLessThan(0.001);
    expect(hav(tailOnly.points[0], input[0])).toBeLessThan(0.001);
    expect(hav(tailOnly.points[tailOnly.points.length - 1], canonicalAnchors(100, 0, 10)[1]))
      .toBeLessThan(0.001);
    expect(both.quality.preservedInteriorM).toBeGreaterThan(15);
    expect(zero.quality).toMatchObject({
      maximumDeformationM: 0,
      influenceCoverage: 0,
    });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test('keeps a one-ended transition local when that transition consumes the provider span', () => {
    const input = providerLine(20, 5);
    const canonical = canonicalAnchors(20, 10, 0);
    const transition = anchorEndpointTransition(input, canonical, true, false);

    expect(transition.quality).toMatchObject({
      accepted: false,
      reason: 'LOCAL_ANCHOR_DEFORMATION_EXCEEDED',
      preservedInteriorM: 0,
    });
    expect(hav(transition.points[0], canonical[0])).toBeLessThan(0.001);
    expect(hav(transition.points[transition.points.length - 1], input[input.length - 1]))
      .toBeLessThan(0.001);
  });

  test.each([
    ['curved provider', [[0, 0], [25, 0], [45, 10], [65, 22], [90, 22], [115, 10], [140, 0]], [65, 22]],
    ['sharp real corner', [[0, 0], [30, 0], [60, 0], [60, 40], [90, 40], [120, 40]], [60, 40]],
    ['U-turn', [[0, 0], [40, 0], [80, 0], [80, 30], [40, 30], [0, 30]], [80, 30]],
    ['switchback', [[0, 0], [40, 0], [60, 20], [40, 40], [60, 60], [40, 80], [80, 100]], [40, 40]],
  ])('preserves the supported interior and direction symmetry for %s', (_name, rawCoordinates, protectedCoordinate) => {
    const coordinates = rawCoordinates as number[][];
    const source = coordinates.map(([eastM, northMValue]) => point(eastM, northMValue));
    const canonical: RawPoint[] = [
      { ...point(coordinates[0][0], coordinates[0][1] + 4), t: 1_700_000_000_000, accuracy: 8 },
      {
        ...point(coordinates[coordinates.length - 1][0], coordinates[coordinates.length - 1][1] + 4),
        t: 1_700_000_004_000,
        accuracy: 8,
      },
    ];
    const forward = anchorEndpointTransition(source, canonical);
    const reversed = anchorEndpointTransition(source.slice().reverse(), canonical.slice().reverse())
      .points.reverse();
    const protectedPoint = point(protectedCoordinate[0], protectedCoordinate[1]);

    expect(forward.quality.accepted).toBe(true);
    expect(Math.min(...forward.points.map(sample => hav(sample, protectedPoint)))).toBeLessThan(0.001);
    expect(forward.points).toHaveLength(reversed.length);
    expect(Math.max(...forward.points.map((sample, index) => hav(sample, reversed[index]))))
      .toBeLessThan(0.001);
  });

  test('retains one provider island between real Local neighbors with exact shared endpoints', async () => {
    const canonical = canonicalLine(140, 10, 10);
    const fetchImpl = jest.fn(async () => {
      const geometry = providerLine(140, 10);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          code: 'Ok',
          matchings: [{
            confidence: 0.98,
            geometry: { coordinates: geometry.map(sample => [sample.lng, sample.lat]) },
          }],
          tracepoints: canonical.map((_sample, index) => {
            if (index < 2 || index > 12) return null;
            const network = point(index * 10, 0);
            return {
              matchings_index: 0,
              waypoint_index: index - 2,
              alternatives_count: 0,
              name: 'Mapped pedestrian trail',
              location: [network.lng, network.lat],
            };
          }),
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.sections.map(section => section.decision)).toEqual([
      'canonical-derived',
      'refined',
      'canonical-derived',
    ]);
    const refined = result.stats.sections[1];
    expect(refined).toMatchObject({ sourceStart: 2, sourceEnd: 12 });
    expect(result.stats.wholeRouteValidation.accepted).toBe(true);
    expect(result.points.some(sample => hav(sample, canonical[2]) < 0.001)).toBe(true);
    expect(result.points.some(sample => hav(sample, canonical[12]) < 0.001)).toBe(true);
  });

  test('assembles two adjacent provider islands once at their shared canonical boundary', async () => {
    const canonical = canonicalLine(500, 5, 4);
    const fetchImpl = jest.fn(async (url: string) => {
      const encoded = url.split('/walking/')[1].split('?')[0];
      const submitted = encoded.split(';').map(value => {
        const [lng, lat] = value.split(',').map(Number);
        return { lng, lat };
      });
      const firstWindow = submitted.length === 80;
      const supported = firstWindow ? submitted.slice(0, 73) : submitted;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          code: 'Ok',
          matchings: [{
            confidence: 0.98,
            geometry: { coordinates: supported.map(sample => [sample.lng, BASE_LAT]) },
          }],
          tracepoints: submitted.map((sample, index) => (
            !firstWindow || index <= 72
              ? {
                  matchings_index: 0,
                  waypoint_index: index,
                  alternatives_count: 0,
                  name: 'Mapped pedestrian trail',
                  location: [sample.lng, BASE_LAT],
                }
              : null
          )),
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await reconstructPedestrianFinalRoute(canonical, {
      mapboxToken: 'pk.test',
      directionsFallback: false,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refined = result.stats.sections.filter(section => section.decision === 'refined');
    expect(refined).toHaveLength(2);
    expect(refined[0].sourceEnd).toBe(refined[1].sourceStart);
    const boundary = canonical[refined[0].sourceEnd];
    expect(result.points.filter(sample => hav(sample, boundary) < 0.001)).toHaveLength(1);
    expect(result.stats.wholeRouteValidation.accepted).toBe(true);
  });
});
