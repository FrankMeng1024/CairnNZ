import {
  replayObservationsFromDiagnosticExport,
  type ActivityDiagnosticReplayExport,
} from '../activity/activityDiagnosticReplay';
import type { SnapLabPublicFixture } from './snapLabLogicalRunner';
import {
  sanitizeSnapLabRequestUrl,
  snapLabRequestFingerprint,
  type SnapLabCassetteEntry,
} from './snapLabTransport';

export interface DiagnosticEventTimelineReplay {
  events: Array<{
    ordinal: number;
    kind: string;
    wallTimeMs: number;
    inputAuthority: boolean;
    data: Record<string, unknown>;
  }>;
  finalState: {
    paused: boolean;
    appState: string;
    plantOpen: boolean;
    recordingFinished: boolean;
    deletedOrCancelled: boolean;
    online: boolean | null;
    syncPhase: string | null;
    phoneCleanupComplete: boolean;
  };
  observations: {
    total: number;
    whilePaused: number;
    background: number;
    staleDecisionComparisons: number;
    decisionsAfterDeletedOrCancelled: number;
  };
  provider: { completionsAfterFinish: number };
  offlineAtFinish: boolean;
  syncAckAfterFinish: boolean;
}

const inputKinds = new Set(['diagnostic-start', 'raw-observation', 'provider-exchange', 'application-event', 'diagnostic-finish']);

/** Converts both historical Snap Lab cassette entries and real Activity
 * diagnostic provider-response records into the one exact-identity offline
 * transport contract. The two captured endpoints are GET-only by product
 * definition; any other shape fails closed instead of falling through to the
 * network. */
export function diagnosticProviderCassetteEntries(responses: unknown[]): SnapLabCassetteEntry[] {
  return responses.map((raw, index) => {
    const entry = raw as Record<string, unknown>;
    if (entry.method === 'GET'
      && typeof entry.requestFingerprint === 'string'
      && typeof entry.sanitizedUrl === 'string'
      && typeof entry.status === 'number'
      && typeof entry.provenance === 'string') {
      return JSON.parse(JSON.stringify(entry)) as SnapLabCassetteEntry;
    }
    if (entry.phase !== 'response'
      || !['map-matching', 'walking-directions'].includes(String(entry.requestKind ?? ''))
      || typeof entry.sanitizedUrl !== 'string'
      || typeof entry.status !== 'number') {
      throw new Error(`diagnostic_provider_response_invalid:${index}`);
    }
    const sanitizedUrl = sanitizeSnapLabRequestUrl(entry.sanitizedUrl);
    const parsed = new URL(sanitizedUrl);
    const expectedPrefix = entry.requestKind === 'map-matching'
      ? '/matching/v5/mapbox/walking/'
      : '/directions/v5/mapbox/walking/';
    if (parsed.origin !== 'https://api.mapbox.com' || !parsed.pathname.startsWith(expectedPrefix)) {
      throw new Error(`diagnostic_provider_response_endpoint_invalid:${index}`);
    }
    return {
      requestFingerprint: snapLabRequestFingerprint('GET', sanitizedUrl),
      method: 'GET',
      sanitizedUrl,
      status: entry.status,
      headers: (entry.headers ?? {}) as Record<string, string>,
      body: entry.body ?? null,
      provenance: 'CAPTURED_REAL_RESPONSE',
      capturedAt: typeof entry.capturedAt === 'string' ? entry.capturedAt : null,
    };
  });
}

/** Replays only the recorded event/log state machine. Stored tracking
 * decisions and geometry are retained as comparison outputs, never input
 * authority. This deliberately does not invent events missing from an older
 * diagnostic export. */
export function replayDiagnosticEventTimeline(
  diagnostic: ActivityDiagnosticReplayExport,
): DiagnosticEventTimelineReplay {
  const events = [...diagnostic.records]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(record => ({
      ordinal: record.ordinal,
      kind: record.kind,
      wallTimeMs: record.wallTimeMs,
      inputAuthority: inputKinds.has(record.kind),
      data: record.data,
    }));
  const state = {
    paused: false,
    appState: 'unknown',
    plantOpen: false,
    recordingFinished: false,
    deletedOrCancelled: false,
    online: null as boolean | null,
    syncPhase: null as string | null,
    phoneCleanupComplete: false,
  };
  let total = 0;
  let whilePaused = 0;
  let background = 0;
  let staleDecisionComparisons = 0;
  let decisionsAfterDeletedOrCancelled = 0;
  let completionsAfterFinish = 0;
  let offlineAtFinish = false;
  let syncAckAfterFinish = false;

  for (const event of events) {
    if (event.kind === 'raw-observation') {
      total += 1;
      if (state.paused) whilePaused += 1;
      if (event.data.appStateAtReceipt === 'background'
        || event.data.source === 'background') background += 1;
      continue;
    }
    if (event.kind === 'observation-decision') {
      if (String(event.data.reason ?? '').includes('stale')) staleDecisionComparisons += 1;
      if (state.deletedOrCancelled) decisionsAfterDeletedOrCancelled += 1;
      continue;
    }
    if (event.kind === 'diagnostic-finish') {
      state.recordingFinished = true;
      offlineAtFinish = state.online === false;
      continue;
    }
    if (event.kind === 'provider-exchange') {
      if (state.recordingFinished && event.data.phase === 'response') completionsAfterFinish += 1;
      continue;
    }
    if (event.kind !== 'application-event') continue;
    const details = (event.data.details ?? {}) as Record<string, unknown>;
    const name = String(details.event ?? event.data.event ?? details.action ?? '');
    if (event.data.stage === 'lifecycle') {
      if (name === 'recording-paused') state.paused = true;
      if (name === 'recording-resumed') state.paused = false;
      const nextAppState = details.appState ?? details.state ?? event.data.state;
      if (typeof nextAppState === 'string') state.appState = nextAppState;
    }
    if (name === 'plant-opened' || name === 'plant-entered') state.plantOpen = true;
    if (name === 'plant-closed' || name === 'plant-returned') state.plantOpen = false;
    if (name === 'network-offline' || details.online === false) state.online = false;
    if (name === 'network-online' || details.online === true) state.online = true;
    if (['activity-deleted', 'activity-cancelled', 'recording-discarded'].includes(name)) {
      state.deletedOrCancelled = true;
    }
    if (event.data.event === 'completed-activity-sync') {
      const phase = String(event.data.phase ?? '');
      state.syncPhase = phase || null;
      if (phase === 'ack' && state.recordingFinished) syncAckAfterFinish = true;
      if (phase === 'phone-cleanup-complete') state.phoneCleanupComplete = true;
    }
  }
  return {
    events,
    finalState: state,
    observations: {
      total,
      whilePaused,
      background,
      staleDecisionComparisons,
      decisionsAfterDeletedOrCancelled,
    },
    provider: { completionsAfterFinish },
    offlineAtFinish,
    syncAckAfterFinish,
  };
}

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
  const earliestObservationMs = Math.min(...observationTimes);
  const observationEndMs = Math.max(...observationTimes);
  const startWallTimeMs = Number(start?.wallTimeMs);
  // A native callback can contain a cached coordinate observed before Start
  // but delivered after Start. Preserve the recorded diagnostic-start wall
  // boundary so the production before-owner-generation rejection replays.
  const observationStartMs = Number.isFinite(startWallTimeMs)
    ? startWallTimeMs
    : earliestObservationMs;
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
  const eventReplay = replayDiagnosticEventTimeline(diagnostic);
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
    recordedTimeline: eventReplay.events,
    lifecycle: {
      trueBlackout: false,
      offlineAtFinish: eventReplay.offlineAtFinish,
      restoreOnlineAfterColdOpen: eventReplay.offlineAtFinish && eventReplay.syncAckAfterFinish,
      slowDiagnosticWriteMs: 0,
      walReadFaultOnce: false,
      yieldedFinish: false,
    },
    transportScenario: 'captured-owner-diagnostic',
    transportConfig: {
      mode: 'captured-real',
      cassetteEntries: diagnosticProviderCassetteEntries(diagnostic.providerResponses),
    },
  };
}
