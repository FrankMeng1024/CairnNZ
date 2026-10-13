import type { ActivityMode } from '../../../store/useSessionStore';
import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsObservation,
} from '../realGpsContinuity';
import {
  calculateActivityStats,
  segmentTrace,
  shouldStartNewSegment,
  type SegmentedTrackPoint,
} from '../activityContracts';
import { activityGeometryFingerprint, buildLocalFinalTrackPoints } from '../activityFinalArtifact';

const START = 1_800_100_000_000;
const ORIGIN = { lat: -41.28, lng: 174.77 };
const STEP_MS = 5_000;
const TOTAL_MS = 45 * 60_000;
const PROVIDER_GAP_START_MS = 20 * 60_000;
const PROVIDER_GAP_END_MS = 27 * 60_000;

function coordinate(xM: number, yM: number) {
  return {
    lat: ORIGIN.lat + yM / 111_320,
    lng: ORIGIN.lng + xM / (111_320 * Math.cos(ORIGIN.lat * Math.PI / 180)),
  };
}

/** A deterministic 45-minute field-shaped stream: walking, repeated right
 * angles, five minutes of bounded stationary drift, seven minutes with no
 * provider delivery, a real out-and-back and foreground/background handoffs. */
function longJourneyEvidence(): RealGpsObservation[] {
  const points: RealGpsObservation[] = [];
  let xM = 0;
  let yM = 0;
  let ordinal = 0;
  for (let elapsedMs = 0; elapsedMs <= TOTAL_MS; elapsedMs += STEP_MS) {
    if (elapsedMs > PROVIDER_GAP_START_MS && elapsedMs < PROVIDER_GAP_END_MS) continue;
    if (elapsedMs > 0) {
      if (elapsedMs <= 15 * 60_000) {
        // Three-minute legs create repeated 90-degree corners.
        const leg = Math.floor((elapsedMs - STEP_MS) / (3 * 60_000)) % 4;
        if (leg === 0) xM += 5;
        if (leg === 1) yM += 5;
        if (leg === 2) xM -= 5;
        if (leg === 3) yM -= 5;
      } else if (elapsedMs <= PROVIDER_GAP_START_MS) {
        // Deliberately stay stationary; sub-metre deterministic jitter below
        // must not become meaningful traversal.
      } else if (elapsedMs <= 33 * 60_000) {
        xM += 5;
      } else if (elapsedMs <= 39 * 60_000) {
        xM -= 5; // genuine out-and-back, including the 180-degree turn.
      } else {
        yM += 5;
      }
    }
    ordinal += 1;
    const stationary = elapsedMs > 15 * 60_000 && elapsedMs <= PROVIDER_GAP_START_MS;
    const jitter = stationary ? ((ordinal % 5) - 2) * 0.18 : 0;
    const c = coordinate(xM + jitter, yM - jitter);
    points.push({
      ...c,
      t: START + elapsedMs,
      accuracy: 6,
      speed: stationary ? 0 : 1,
      speedAccuracy: 0.4,
      source: elapsedMs >= 10 * 60_000 && elapsedMs < 40 * 60_000 ? 'background' : 'foreground',
      observationId: `long-${ordinal}`,
      rawOrdinal: ordinal,
    });
  }
  return points;
}

function replay(mode: ActivityMode, connectivity: Array<'online' | 'offline'>) {
  const evidence = longJourneyEvidence();
  expect(connectivity).toHaveLength(evidence.length);
  let continuity = createRealGpsContinuityState();
  let segmentOrdinal = 1;
  let segmentId = 'segment-1';
  const canonical: SegmentedTrackPoint[] = [];
  const decisions: string[] = [];
  evidence.forEach((raw, index) => {
    // This external-services state is deliberately not an input to any local
    // qualification, durability, segmentation, metric or Final decision.
    void connectivity[index];
    const decision = evaluateRealGpsObservation(continuity, raw, mode, raw.t + 200);
    continuity = decision.state;
    decisions.push(`${raw.observationId}:${decision.kind}:${decision.reason}`);
    if (decision.kind !== 'ACCEPT') return;
    const acceptedPoints = [
      ...(decision.confirmedCandidates ?? (decision.confirmedCandidate ? [decision.confirmedCandidate] : [])),
      raw,
    ];
    for (const accepted of acceptedPoints) {
      const previous = canonical[canonical.length - 1] ?? null;
      const knownRecordingLoss = previous !== null && accepted.t - previous.t >= 7 * 60_000;
      const newSegment = shouldStartNewSegment({ previous, next: accepted, mode, knownRecordingLoss });
      if (newSegment) {
        segmentOrdinal += 1;
        segmentId = `segment-${segmentOrdinal}`;
      }
      continuity = acceptRealGpsObservation(continuity, accepted, segmentId).state;
      canonical.push({
        ...accepted,
        segmentId,
        ...(canonical.length === 0
          ? { segmentStartReason: 'start' as const }
          : newSegment ? { segmentStartReason: 'gps-reacquired' as const } : {}),
      });
    }
  });
  const trace = segmentTrace(canonical);
  const stats = calculateActivityStats(canonical);
  return {
    rawIds: evidence.map(point => point.observationId),
    rawOrder: evidence.map(point => point.rawOrdinal),
    decisions,
    canonicalIds: canonical.map(point => point.observationId),
    canonicalTimes: canonical.map(point => point.t),
    distanceM: Number(stats.distanceM.toFixed(6)),
    activeDurationS: stats.activeDurationS,
    segmentStarts: trace.segments.map(segment => ({ t: segment[0].t, reason: segment[0].segmentStartReason })),
    gapDurationsMs: trace.gaps.map(gap => gap.to.t - gap.from.t),
    localFinalFingerprint: activityGeometryFingerprint(buildLocalFinalTrackPoints(canonical)),
  };
}

describe.each(['hiking', 'running'] as ActivityMode[])('%s 45-minute connectivity parity', mode => {
  test('mixed online/offline delivery preserves the same field-shaped local truth', () => {
    const evidenceCount = longJourneyEvidence().length;
    const online = Array(evidenceCount).fill('online') as Array<'online' | 'offline'>;
    const alternating = Array.from({ length: evidenceCount }, (_, index) => (
      Math.floor(index / 37) % 2 === 0 ? 'online' : 'offline'
    )) as Array<'online' | 'offline'>;
    const expected = replay(mode, online);
    const actual = replay(mode, alternating);
    expect(actual).toEqual(expected);
    expect(actual.rawIds.length).toBeGreaterThan(400);
    expect(actual.canonicalIds.length).toBeGreaterThan(250);
    expect(actual.segmentStarts.length).toBeGreaterThanOrEqual(2);
    expect(actual.gapDurationsMs.some(duration => duration >= 7 * 60_000)).toBe(true);
    expect(actual.distanceM).toBeGreaterThan(1_500);
    expect(actual.localFinalFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });
});
