import {
  replayObservationsFromDiagnosticExport,
  type ActivityDiagnosticReplayExport,
} from '../activity/activityDiagnosticReplay';
import type { SnapLabPublicFixture } from './snapLabLogicalRunner';
import type { SnapLabCassetteEntry } from './snapLabTransport';

/**
 * Converts a copied owner diagnostic into the public provider boundary used by
 * Snap Lab. Only raw observation records and captured provider responses are
 * inputs. Canonical, Local and selected Final geometry remain comparison
 * outputs and never cross into the tracking run.
 */
export function diagnosticReplayFixture(
  diagnostic: ActivityDiagnosticReplayExport,
): SnapLabPublicFixture {
  const observations = replayObservationsFromDiagnosticExport(diagnostic);
  if (observations.length === 0) throw new Error('diagnostic_replay_has_no_raw_observations');
  const start = diagnostic.records.find(record => record.kind === 'diagnostic-start');
  const recordedMode = start?.data.mode;
  const mode = recordedMode === 'running' ? 'run' : 'hike';
  const observationTimes = observations.map(item => item.timestampMs);
  const observationStartMs = Math.min(...observationTimes);
  const observationEndMs = Math.max(...observationTimes);
  const startWallTimeMs = Number(start?.wallTimeMs);
  const firstReceiptWallTimeMs = Number(observations[0]?.coordinate.receiptWallTimeMs);
  const receiptEpochMs = Number.isFinite(startWallTimeMs)
    ? startWallTimeMs
    : firstReceiptWallTimeMs;
  const rawEvents = observations.map((item, ordinal) => {
    const coordinate = item.coordinate;
    const receiptWallTimeMs = Number(coordinate.receiptWallTimeMs);
    return {
      ordinal,
      observationTimeMs: item.timestampMs,
      // Snap Lab reserves its own 12-hour processing clock. Preserve only the
      // recorded inter-callback delivery offsets, otherwise feeding the
      // already-offset diagnostic wall clock back into the runner adds that
      // reserve twice and changes time-sensitive acceptance decisions.
      deliveryTimeMs: Number.isFinite(receiptWallTimeMs) && Number.isFinite(receiptEpochMs)
        ? observationStartMs + Math.max(0, receiptWallTimeMs - receiptEpochMs)
        : item.timestampMs,
      appState: typeof coordinate.appStateAtReceipt === 'string'
        ? coordinate.appStateAtReceipt
        : 'unknown',
      coordinate: { lat: Number(coordinate.lat), lng: Number(coordinate.lng) },
      altitudeM: coordinate.alt == null ? null : Number(coordinate.alt),
      accuracyM: coordinate.accuracy == null ? null : Number(coordinate.accuracy),
      verticalAccuracyM: coordinate.verticalAccuracy == null
        ? null
        : Number(coordinate.verticalAccuracy),
      speedMps: coordinate.speed == null ? null : Number(coordinate.speed),
      speedAccuracyMps: coordinate.speedAccuracy == null ? null : Number(coordinate.speedAccuracy),
      courseDeg: coordinate.course == null ? null : Number(coordinate.course),
      courseAccuracyDeg: coordinate.courseAccuracy == null
        ? null
        : Number(coordinate.courseAccuracy),
      source: 'simulator' as const,
      callbackIdentity: typeof coordinate.callbackIdentity === 'string'
        ? coordinate.callbackIdentity
        : null,
      nativeBatchSequence: coordinate.nativeBatchSequence == null
        ? null
        : Number(coordinate.nativeBatchSequence),
      nativeBatchIndex: coordinate.nativeBatchIndex == null
        ? null
        : Number(coordinate.nativeBatchIndex),
      receiptMonotonicTimeMs: coordinate.receiptMonotonicTimeMs == null
        ? null
        : Number(coordinate.receiptMonotonicTimeMs),
    };
  });
  return {
    schema: 'cairn.activity-diagnostic-raw-replay.v1',
    fixtureSha256: diagnostic.recordsChecksum,
    caseId: `diagnostic-${diagnostic.clientActivityId.slice(-12)}`,
    mode,
    profile: 'captured-owner-diagnostic',
    seed: 1,
    contractIntent: {
      scenario: 'Replay the copied Activity raw observations through the production tracking acceptance boundary.',
      transportFixture: 'Captured provider responses only; exact signature mismatch fails closed.',
      oracleRequirements: 'Exported canonical and Final geometry are comparison outputs, never replay inputs.',
    },
    durationSeconds: Math.max(0, (observationEndMs - observationStartMs) / 1_000),
    clock: {
      observationStartMs,
      observationEndMs,
      observationIntervalSeconds: 0,
      deliveryMode: 'diagnostic-recorded-receipt-order',
    },
    rawEvents,
    lifecycle: {
      trueBlackout: false,
      offlineAtFinish: false,
      restoreOnlineAfterColdOpen: false,
      slowDiagnosticWriteMs: 0,
      walReadFaultOnce: false,
      yieldedFinish: false,
    },
    transportScenario: 'captured-owner-diagnostic',
    transportConfig: {
      mode: 'captured-real',
      cassetteEntries: diagnostic.providerResponses as SnapLabCassetteEntry[],
    },
  };
}
