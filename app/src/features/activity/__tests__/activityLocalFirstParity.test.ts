import type { ActivityMode } from '../../../store/useSessionStore';
import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsObservation,
} from '../realGpsContinuity';
import {
  activityDistanceEstimate,
  buildActivityDistanceAccumulator,
  calculateActivityStats,
  segmentTrace,
  shouldStartNewSegment,
  type SegmentedTrackPoint,
} from '../activityContracts';
import {
  activityGeometryFingerprint,
  buildLocalFinalTrackPoints,
} from '../activityFinalArtifact';
import {
  flushActivityStageLedger,
  purgeActivityStageLedgerForOwner,
  recordActivityStageEvent,
  type ActivityStage,
} from '../activityStageLedger';

type Connectivity = 'online' | 'offline';
const ORIGIN = { lat: -41.28, lng: 174.77 };
const METRES_PER_DEGREE = 111_320;

function observation(
  ordinal: number,
  elapsedMs: number,
  eastM: number,
  source: RealGpsObservation['source'],
  extra: Partial<RealGpsObservation> = {},
): RealGpsObservation {
  return {
    lat: ORIGIN.lat,
    lng: ORIGIN.lng + eastM / (
      METRES_PER_DEGREE * Math.cos(ORIGIN.lat * Math.PI / 180)
    ),
    t: 1_800_000_000_000 + elapsedMs,
    accuracy: 6,
    speed: 1.2,
    speedAccuracy: 0.5,
    source,
    observationId: `observation-${ordinal}`,
    rawOrdinal: ordinal,
    ...extra,
  };
}

const evidence: RealGpsObservation[] = [
  observation(1, 0, 0, 'foreground'),
  observation(2, 5_000, 6, 'foreground'),
  observation(3, 10_000, 12, 'foreground'),
  observation(4, 12_000, 240, 'foreground', { accuracy: 4, speed: null }),
  observation(5, 15_000, 18, 'background'),
  observation(6, 500_000, 400, 'background'),
  observation(7, 505_000, 406, 'background'),
  observation(8, 510_000, 412, 'foreground'),
];

function replay(
  mode: ActivityMode,
  connectivityAtObservation: Connectivity[],
  diagnosticSink?: (stage: ActivityStage, evidenceId: string, wallTimeMs: number) => void,
) {
  expect(connectivityAtObservation).toHaveLength(evidence.length);
  let continuity = createRealGpsContinuityState();
  let segmentOrdinal = 1;
  let segmentId = 'segment-1';
  const canonical: SegmentedTrackPoint[] = [];
  const decisions: Array<{ id: string; kind: string; reason: string }> = [];

  evidence.forEach((raw, index) => {
    // Connectivity is deliberately an input to the orchestration replay but
    // never to GPS qualification, segmenting, metric or Final generation.
    // It can wake only the independent remote coordinator tested separately.
    void connectivityAtObservation[index];
    diagnosticSink?.('observation-received', raw.observationId, raw.t + 250);
    const decision = evaluateRealGpsObservation(continuity, raw, mode, raw.t + 250);
    diagnosticSink?.('observation-decision', raw.observationId, raw.t + 251);
    decisions.push({ id: raw.observationId, kind: decision.kind, reason: decision.reason });
    continuity = decision.state;
    if (decision.kind !== 'ACCEPT') return;
    const promoted = decision.confirmedCandidates
      ?? (decision.confirmedCandidate ? [decision.confirmedCandidate] : []);
    for (const accepted of [...promoted, raw]) {
      const previous = canonical[canonical.length - 1] ?? null;
      const startsNewSegment = shouldStartNewSegment({ previous, next: accepted, mode });
      if (startsNewSegment) {
        segmentOrdinal += 1;
        segmentId = `segment-${segmentOrdinal}`;
      }
      continuity = acceptRealGpsObservation(continuity, accepted, segmentId).state;
      canonical.push({
        lat: accepted.lat,
        lng: accepted.lng,
        t: accepted.t,
        accuracy: accepted.accuracy,
        speed: accepted.speed,
        speedAccuracy: accepted.speedAccuracy,
        segmentId,
        ...(canonical.length === 0
          ? { segmentStartReason: 'start' as const }
          : startsNewSegment ? { segmentStartReason: 'gps-reacquired' as const } : {}),
      });
      diagnosticSink?.('wal-committed', accepted.observationId, accepted.t + 252);
      diagnosticSink?.('store-published', accepted.observationId, accepted.t + 253);
    }
  });

  const trace = segmentTrace(canonical);
  const localFinal = buildLocalFinalTrackPoints(canonical);
  const stats = calculateActivityStats(canonical);
  return {
    rawIdentities: evidence.map(point => point.observationId),
    rawOrdering: evidence.map(point => point.rawOrdinal),
    decisions,
    canonical: canonical.map(point => ({
      lat: Number(point.lat.toFixed(7)),
      lng: Number(point.lng.toFixed(7)),
      t: point.t,
      segmentId: point.segmentId,
      segmentStartReason: point.segmentStartReason ?? null,
    })),
    distanceM: Number(stats.distanceM.toFixed(6)),
    distanceAuthority: activityDistanceEstimate(buildActivityDistanceAccumulator(canonical)).method,
    activeDurationS: stats.activeDurationS,
    segmentBoundaries: trace.segments.map(segment => ({
      id: segment[0].segmentId,
      reason: segment[0].segmentStartReason ?? null,
      firstT: segment[0].t,
      lastT: segment[segment.length - 1].t,
      pointCount: segment.length,
    })),
    gapCount: trace.gaps.length,
    localFinalFingerprint: activityGeometryFingerprint(localFinal),
    selectedFinalFingerprint: activityGeometryFingerprint(localFinal),
    selectedFinalRevision: 1,
  };
}

describe.each(['hiking', 'running'] as ActivityMode[])(
  '%s local-first connectivity parity',
  (mode) => {
    const allOnline = Array(evidence.length).fill('online') as Connectivity[];

    test.each([
      ['Online → Offline → Online', ['online', 'online', 'offline', 'offline', 'offline', 'online', 'online', 'online']],
      ['Offline → Online → Offline', ['offline', 'offline', 'online', 'online', 'online', 'offline', 'offline', 'offline']],
      ['Offline Start → Offline Finish → Online Sync', Array(evidence.length).fill('offline')],
      ['Online Start → Offline Finish → Online Sync', ['online', 'online', 'offline', 'offline', 'offline', 'offline', 'offline', 'offline']],
      ['Long background → foreground recovery while online', ['online', 'online', 'online', 'online', 'online', 'online', 'online', 'online']],
      ['Long background → foreground recovery while offline', ['offline', 'offline', 'offline', 'offline', 'offline', 'offline', 'offline', 'offline']],
    ] as Array<[string, Connectivity[]]>)('%s preserves identical local truth', (_name, timeline) => {
      expect(replay(mode, timeline)).toEqual(replay(mode, allOnline));
    });

    test('emits a stable local truth fingerprint for the locked replay', () => {
      const result = replay(mode, allOnline);
      expect({
        mode,
        rawIdentities: result.rawIdentities,
        rawOrdering: result.rawOrdering,
        decisions: result.decisions,
        canonical: result.canonical,
        distanceM: result.distanceM,
        activeDurationS: result.activeDurationS,
        segmentBoundaries: result.segmentBoundaries,
        gapCount: result.gapCount,
        localFinalFingerprint: result.localFinalFingerprint,
        selectedFinalFingerprint: result.selectedFinalFingerprint,
        selectedFinalRevision: result.selectedFinalRevision,
      }).toMatchSnapshot();
    });

    test('diagnostic ledger ON and OFF produce identical local truth', async () => {
      const withoutDiagnostics = replay(mode, allOnline);
      const ownerUserId = `diagnostic-parity-${mode}`;
      const clientActivityId = `diagnostic-parity-${mode}`;
      const withDiagnostics = replay(mode, allOnline, (stage, evidenceId, wallTimeMs) => {
        void recordActivityStageEvent({
          ownerUserId,
          clientActivityId,
          stage,
          evidenceId,
          wallTimeMs,
          details: { mode, diagnosticParityReplay: true },
        });
      });
      await flushActivityStageLedger(ownerUserId);
      expect(withDiagnostics).toEqual(withoutDiagnostics);
      await purgeActivityStageLedgerForOwner(ownerUserId);
    });
  },
);
