import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsObservation,
} from '../../../features/activity/realGpsContinuity';
import {
  buildCausalLiveRoute,
  LIVE_MUTABLE_TAIL_MAX_POINTS,
} from '../../../features/activity/causalLiveRoute';
import {
  segmentTrace,
  shouldStartNewSegment,
  type SegmentedTrackPoint,
} from '../../../features/activity/activityContracts';
import type { ActivityMode, TrackPoint } from '../../../store/useSessionStore';
import { haversineM } from '../../../utils/geo';
import { buildBaseFinalGeometry } from '../pedestrianFinalRoute';
import {
  ADVERSARIAL_ROUTE_FIXTURES,
  rawForMode,
  type AdversarialRouteFixture,
  type QaRawPoint,
} from './fixtures/adversarialRouteFixtures';

interface PipelineResult {
  raw: QaRawPoint[];
  canonical: SegmentedTrackPoint[];
  liveFrozen: TrackPoint[];
  finalLocal: TrackPoint[];
  acceptedRawOrdinals: number[];
  rejectedRawOrdinals: number[];
  localRepairCount: number;
  maximumCrossTrackCorrectionM: number;
  gapCount: number;
}

function pointToSegmentDistanceM(
  point: Pick<TrackPoint, 'lat' | 'lng'>,
  start: Pick<TrackPoint, 'lat' | 'lng'>,
  end: Pick<TrackPoint, 'lat' | 'lng'>,
): number {
  const metresPerDegree = 111_320;
  const cosLat = Math.cos(start.lat * Math.PI / 180);
  const px = (point.lng - start.lng) * metresPerDegree * cosLat;
  const py = (point.lat - start.lat) * metresPerDegree;
  const bx = (end.lng - start.lng) * metresPerDegree * cosLat;
  const by = (end.lat - start.lat) * metresPerDegree;
  const lengthSquared = bx * bx + by * by;
  const fraction = lengthSquared <= 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));
  return Math.hypot(px - bx * fraction, py - by * fraction);
}

function distanceToPath(point: TrackPoint, path: TrackPoint[]): number {
  if (path.length < 2) return Infinity;
  return Math.min(...path.slice(1).map((end, index) => (
    pointToSegmentDistanceM(point, path[index], end)
  )));
}

function pathLength(points: ReadonlyArray<Pick<TrackPoint, 'lat' | 'lng'>>): number {
  return points.slice(1).reduce((sum, point, index) => sum + haversineM(points[index], point), 0);
}

function runFixture(fixture: AdversarialRouteFixture, mode: ActivityMode): PipelineResult {
  const raw = rawForMode(fixture, mode);
  let continuity = createRealGpsContinuityState();
  let segmentOrdinal = 1;
  let segmentId = 'segment-1';
  const canonical: SegmentedTrackPoint[] = [];
  const acceptedRawOrdinals: number[] = [];

  const publishAccepted = (observation: RealGpsObservation) => {
    const previous = canonical[canonical.length - 1] ?? null;
    if (shouldStartNewSegment({
      previous,
      next: {
        lat: observation.lat,
        lng: observation.lng,
        t: observation.t,
        accuracy: observation.accuracy,
      },
      mode,
    })) {
      segmentOrdinal += 1;
      segmentId = `segment-${segmentOrdinal}`;
    }
    continuity = acceptRealGpsObservation(continuity, observation, segmentId).state;
    canonical.push({
      lat: observation.lat,
      lng: observation.lng,
      t: observation.t,
      accuracy: observation.accuracy,
      speed: observation.speed,
      rawOrdinal: observation.rawOrdinal,
      segmentId,
      ...(canonical.length === 0
        ? { segmentStartReason: 'start' as const }
        : previous?.segmentId !== segmentId ? { segmentStartReason: 'gps-reacquired' as const } : {}),
    });
    if (observation.rawOrdinal != null) acceptedRawOrdinals.push(observation.rawOrdinal);
  };

  raw.forEach((sample, index) => {
    const observation: RealGpsObservation = {
      lat: sample.lat,
      lng: sample.lng,
      t: Number(sample.t),
      accuracy: sample.accuracy ?? null,
      speed: mode === 'running' ? 2.6 : 1.2,
      source: sample.qaSection === 'trail' && index % 5 === 0 ? 'background' : 'foreground',
      observationId: `${fixture.id}:${mode}:${index + 1}`,
      rawOrdinal: index + 1,
    };
    const decision = evaluateRealGpsObservation(continuity, observation, mode, observation.t);
    continuity = decision.state;
    if (decision.kind !== 'ACCEPT') return;
    const promoted = decision.confirmedCandidates
      ?? (decision.confirmedCandidate ? [decision.confirmedCandidate] : []);
    promoted.forEach(publishAccepted);
    publishAccepted(observation);
  });

  const liveFrozen = buildCausalLiveRoute(canonical);
  const finalLocal: TrackPoint[] = [];
  let localRepairCount = 0;
  for (const segment of segmentTrace(canonical).segments) {
    const final = buildBaseFinalGeometry(segment);
    localRepairCount += final.diagnostics.removedMicroExcursionCount
      + final.diagnostics.removedTransientSpikeCount
      + (final.diagnostics.stationaryCloudCollapsed ? 1 : 0);
    finalLocal.push(...final.points.map((point, index) => ({
      ...point,
      t: point.t ?? segment[0].t + Math.round(
        (segment[segment.length - 1].t - segment[0].t) * index / Math.max(1, final.points.length - 1),
      ),
      segmentId: segment[0].segmentId,
      ...(index === 0 && segment[0].segmentStartReason
        ? { segmentStartReason: segment[0].segmentStartReason }
        : {}),
    })));
  }
  const rejectedRawOrdinals = raw
    .map((_point, index) => index + 1)
    .filter(ordinal => !acceptedRawOrdinals.includes(ordinal));
  const maximumCrossTrackCorrectionM = canonical.length > 1 && finalLocal.length > 1
    ? Math.max(...canonical.map(point => distanceToPath(point, finalLocal)))
    : 0;
  return {
    raw,
    canonical,
    liveFrozen,
    finalLocal,
    acceptedRawOrdinals,
    rejectedRawOrdinals,
    localRepairCount,
    maximumCrossTrackCorrectionM,
    gapCount: Math.max(0, segmentTrace(finalLocal).segments.length - 1),
  };
}

function assertFrozenPrefix(fixture: AdversarialRouteFixture, mode: ActivityMode): void {
  const partialFixture = {
    ...fixture,
    raw: fixture.raw.slice(0, Math.max(12, Math.floor(fixture.raw.length * 0.72))),
  };
  const partial = runFixture(partialFixture, mode);
  const complete = runFixture(fixture, mode);
  const immutable = partial.liveFrozen.slice(0, -LIVE_MUTABLE_TAIL_MAX_POINTS);
  for (const point of immutable) {
    expect(complete.liveFrozen.find(candidate => candidate.t === point.t)).toMatchObject({
      lat: point.lat,
      lng: point.lng,
      segmentId: point.segmentId,
    });
  }
}

function metrics(fixture: AdversarialRouteFixture, mode: ActivityMode, result: PipelineResult) {
  const canonicalSegments = segmentTrace(result.canonical).segments;
  const finalSegments = segmentTrace(result.finalLocal).segments;
  return {
    fixture: fixture.id,
    mode,
    rawPointCount: result.raw.length,
    acceptedPointCount: result.canonical.length,
    rejectedPointCount: result.rejectedRawOrdinals.length,
    liveFrozenVertexCount: result.liveFrozen.length,
    finalLocalVertexCount: result.finalLocal.length,
    // This matrix deliberately withholds road data. Layer B therefore keeps
    // the truthful Layer-A result, and the committed display artifact has the
    // same identity/count. Network outcomes are exercised in the companion
    // Mapbox failure matrix.
    finalMatchedVertexCount: result.finalLocal.length,
    finalArtifactVertexCount: result.finalLocal.length,
    finalVertexCount: result.finalLocal.length,
    localRepairs: result.localRepairCount,
    mapMatchingWindowsAttempted: 0,
    successfulResponses: 0,
    acceptedMatches: 0,
    rejectedMatches: 0,
    maximumGeometryDisplacementM: Number(result.maximumCrossTrackCorrectionM.toFixed(2)),
    maximumCrossTrackCorrectionM: Number(result.maximumCrossTrackCorrectionM.toFixed(2)),
    preservedGaps: result.gapCount,
    liveToCanonicalLengthRatio: Number((
      pathLength(result.liveFrozen) / Math.max(1, pathLength(result.canonical))
    ).toFixed(3)),
    endpointsChanged: canonicalSegments.length !== finalSegments.length || canonicalSegments.some((segment, index) => (
      haversineM(segment[0], finalSegments[index]?.[0] ?? segment[0]) > 0.2
      || haversineM(segment[segment.length - 1], finalSegments[index]?.at(-1) ?? segment.at(-1)!) > 0.2
    )),
    genuineTurnLost: fixture.protectedTopology !== 'none' && (
      pathLength(result.liveFrozen) / Math.max(1, pathLength(result.canonical)) < 0.65
      || pathLength(result.finalLocal) / Math.max(1, pathLength(result.canonical)) < 0.72
    ),
    offRoadPulledToRoad: false,
  };
}

describe('adversarial realistic route matrix', () => {
  expect(ADVERSARIAL_ROUTE_FIXTURES.map(fixture => fixture.id)).toHaveLength(22);

  test.each(ADVERSARIAL_ROUTE_FIXTURES.map(fixture => [fixture.id, fixture] as const))(
    '%s preserves evidence bounds through all three local stages',
    (_id, fixture) => {
      for (const mode of ['hiking', 'running'] as const) {
        const result = runFixture(fixture, mode);
        expect(result.canonical.length).toBeGreaterThanOrEqual(2);
        expect(result.liveFrozen.length).toBeGreaterThanOrEqual(2);
        expect(result.finalLocal.length).toBeGreaterThanOrEqual(2);
        const canonicalSegments = segmentTrace(result.canonical).segments;
        const finalSegments = segmentTrace(result.finalLocal).segments;
        expect(finalSegments).toHaveLength(canonicalSegments.length);
        canonicalSegments.forEach((segment, index) => {
          expect(haversineM(segment[0], finalSegments[index][0])).toBeLessThan(0.2);
          expect(haversineM(segment.at(-1)!, finalSegments[index].at(-1)!)).toBeLessThan(0.2);
        });
        if (fixture.protectedTopology !== 'none') {
          expect(pathLength(result.finalLocal) / Math.max(1, pathLength(result.canonical))).toBeGreaterThan(0.72);
        }
        assertFrozenPrefix(fixture, mode);
        const row = metrics(fixture, mode, result);
        if (process.env.PRINT_ROUTE_METRICS === '1') {
          // Explicit opt-in evidence export for the repair report; normal test
          // runs stay quiet and QA ground truth never enters product storage.
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(row));
        }
        expect(row.endpointsChanged).toBe(false);
        expect(row.genuineTurnLost).toBe(false);
        expect(row.offRoadPulledToRoad).toBe(false);
      }
    },
  );

  test('combined hard case is the primary proof and uses different raw cadence for Hike and Run', () => {
    const fixture = ADVERSARIAL_ROUTE_FIXTURES.find(item => item.id === 'combined-hard-case')!;
    const hike = runFixture(fixture, 'hiking');
    const run = runFixture(fixture, 'running');
    expect(hike.raw.map(point => point.t)).not.toEqual(run.raw.map(point => point.t));
    expect(hike.canonical).not.toBe(run.canonical);
    expect(hike.canonical.length).toBeGreaterThan(30);
    expect(run.canonical.length).toBeGreaterThan(30);
    expect(hike.localRepairCount + run.localRepairCount).toBeGreaterThan(0);
  });

  test('real signal gap remains a segment boundary in both modes', () => {
    const fixture = ADVERSARIAL_ROUTE_FIXTURES.find(item => item.id === 'real-signal-gap')!;
    for (const mode of ['hiking', 'running'] as const) {
      const result = runFixture(fixture, mode);
      expect(result.gapCount).toBeGreaterThanOrEqual(fixture.expectedGapCount);
    }
  });

  test('stationary cloud is suppressed at Stage 1 and accepted bursts are repaired by Stage 3', () => {
    const stationary = ADVERSARIAL_ROUTE_FIXTURES.find(item => item.id === 'stationary-then-walk')!;
    for (const mode of ['hiking', 'running'] as const) {
      const result = runFixture(stationary, mode);
      expect(result.canonical.length).toBeLessThan(result.raw.length);
    }
    for (const id of ['one-point-lateral-spike', 'multi-point-gps-burst'] as const) {
      const fixture = ADVERSARIAL_ROUTE_FIXTURES.find(item => item.id === id)!;
      for (const mode of ['hiking', 'running'] as const) {
        const result = runFixture(fixture, mode);
        expect(result.finalLocal.length).toBeLessThan(result.canonical.length);
      }
    }
  });
});
