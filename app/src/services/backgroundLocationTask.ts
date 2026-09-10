/**
 * BackgroundLocationTask — registers a TaskManager handler for expo-location
 * background updates. Critical: this MUST be registered at module load time
 * (before any startLocationUpdatesAsync call), so this file is imported by
 * App.tsx at top level.
 *
 * Behavior:
 *   - Pushes coords into pendingBackgroundLocations queue (read by useTrackingStore)
 *   - Logs `gps_fix` events via debugLogger (in-memory path)
 *   - **Fallback path**: if debugLogger has no active session (e.g. iOS killed
 *     the app and just woke this task to deliver a new GPS fix), the handler
 *     directly appends a JSONL line to the session file — using a session_id
 *     and enabled-flag persisted to AsyncStorage. This means we never lose
 *     background fixes even if app process died.
 *
 * iOS requires `UIBackgroundModes: ["location"]` (already set in app.json).
 *
 * Web fallback: import is no-op — TaskManager not available.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { debugLogger } from './debugLogger';
import { crashLogger } from './crashLogger';
import { appendSimulatorLog, flushSimulatorLogs } from '../features/activitySimulator/simulatorLog';
import { newSegmentId, shouldStartNewSegment, type SegmentedTrackPoint } from '../features/activity/activityContracts';
import { haversineM } from '../utils/geo';
import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsContinuityState,
  type RealGpsObservation,
} from '../features/activity/realGpsContinuity';

export const BACKGROUND_LOCATION_TASK = 'cairn-background-location';

// R114/O22 STORY-73003 (K10): capture module-load timestamp so we can
// quantify the registration-lag hypothesis. If a `k10:task_fire` breadcrumb
// arrives with a timing shorter than this, iOS actually did wake us before
// registration completed — that would be a smoking gun.
const moduleLoadTs = Date.now();

// AsyncStorage keys for crash-survival of session metadata
const STORAGE_KEY_SESSION = 'cairn_bg_active_session_id';
// v409 fix #5: semantic rename — 老 key 'cairn_bg_logging_enabled' 语义
// 是"debug 是否开",现在语义应为"hike 是否 active"。v409 迁移在
// useAppStore.hydrate 里做:老 key 值若='1' 但无 active session
// (STORAGE_KEY_SESSION 空) → 清除,防止 stale flag 触发误 Path B 写盘。
const STORAGE_KEY_HIKE_ACTIVE = 'cairn_bg_hike_active';
// v409: 保留老 key 仅用于 hydrate 迁移检测,新写入统一用 HIKE_ACTIVE
const STORAGE_KEY_LEGACY_ENABLED = 'cairn_bg_logging_enabled';
const STORAGE_KEY_ACTIVITY_CONTEXT = 'cairn_bg_activity_context_v2';

export { STORAGE_KEY_SESSION, STORAGE_KEY_HIKE_ACTIVE, STORAGE_KEY_LEGACY_ENABLED, STORAGE_KEY_ACTIVITY_CONTEXT };

export interface DurableActivityContext {
  clientActivityId: string;
  userId: string;
  ownerGeneration: string;
  segmentId: string;
  activityMode: 'hiking' | 'running';
  /** Reject native batches sampled before this ownership generation began. */
  acceptAfterMs: number;
  /** Explicit QA identity survives an iOS headless wake where Zustand is empty. */
  qaSessionId?: string | null;
  /** Same deterministic continuity state used by foreground ingestion. */
  continuityState?: RealGpsContinuityState | null;
  rawOrdinal?: number;
  backgroundPermissionState?: 'unknown' | 'granted' | 'foreground-only' | 'not-applicable';
}

// The native callback and UI lifecycle can run on interleaved promise turns.
// Serialize the complete "validate live lease -> journal append" operation with
// lease mutation. Therefore Finish/Logout either waits for a commit that began
// before its fence, or disables the lease before the callback can validate.
let ownershipTail: Promise<void> = Promise.resolve();
async function withOwnershipBoundary<T>(operation: () => Promise<T>): Promise<T> {
  const prior = ownershipTail.catch(() => undefined);
  let release: () => void = () => undefined;
  ownershipTail = new Promise<void>((resolve) => { release = resolve; });
  await prior;
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Persist current session_id + hike-active flag for the background task
 * to read even after the app process is killed.
 *
 * v409 fix #5: hikeActive 语义 = "hike 正在进行(startTracking 后,stopTracking 前)",
 * 不再是 debug logger 的 enabled 状态。这样 iOS jetsam 后 native TaskManager
 * fire 时 Path B 能无条件写盘(gate 移除)。
 */
export async function persistBackgroundContext(
  sessionId: string | null,
  hikeActive: boolean,
  context?: DurableActivityContext | null,
): Promise<boolean> {
  return withOwnershipBoundary(async () => {
    try {
    if (hikeActive) {
      if (!sessionId || !context) return false;
      await AsyncStorage.setItem(STORAGE_KEY_SESSION, sessionId);
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context));
      // Enable last: a headless callback must never observe `active` before
      // the complete owner context is durable.
      await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '1');
    } else {
      // Disable first: queued native callbacks are fenced before owner keys
      // are removed one by one.
      await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '0');
      await AsyncStorage.removeItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      await AsyncStorage.removeItem(STORAGE_KEY_SESSION);
    }
    // v409 fix #5 migration: 清老 key 避免 hydrate 时 stale 干扰
    if (!hikeActive) {
      try { await AsyncStorage.removeItem(STORAGE_KEY_LEGACY_ENABLED); } catch { /* ignore */ }
    }
      return true;
    } catch {
      if (!hikeActive) {
        // Removing descriptive owner keys is cleanup; the durable live bit is
        // the safety boundary. Retry that boundary once and report success only
        // when a callback can no longer consider the lease active.
        try {
          await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '0');
          return (await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE)) === '0';
        } catch { /* caller must fail closed */ }
      } else {
        // A partially written acquire must never inherit a prior `1` live bit.
        try { await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '0'); } catch { /* caller fails closed */ }
      }
      return false;
    }
  });
}

// Singleton queue of pending background updates — store drains this on each foreground tick
export type LocationCoords = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
  clientActivityId?: string;
  ownerGeneration?: string;
  segmentId?: string;
  segmentStartReason?: 'start' | 'resume' | 'process-recovery' | 'gps-reacquired' | 'legacy';
  rawOrdinal?: number;
  /** Prevent the foreground drain from filtering a durably classified point twice. */
  continuityPreclassified?: boolean;
  canonicalDecision?: 'ACCEPT' | 'REJECT' | 'QUARANTINE';
  decisionReason?: string;
  continuityStateAfter?: RealGpsContinuityState;
};

const pendingBackgroundLocations: LocationCoords[] = [];

export function drainBackgroundLocations(): LocationCoords[] {
  if (pendingBackgroundLocations.length === 0) return [];
  return pendingBackgroundLocations.splice(0, pendingBackgroundLocations.length);
}

/**
 * Wait until every native callback that crossed the ownership boundary has
 * either journaled and queued its points or failed closed. Foreground handoff
 * and Finish use this before draining so a late valid background batch cannot
 * be stranded behind a newer foreground fix.
 */
export async function settleBackgroundLocationWrites(): Promise<void> {
  await withOwnershipBoundary(async () => undefined);
}

function roundedDiagnostic(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function emitHeadlessMotionDecision(
  context: DurableActivityContext,
  observation: RealGpsObservation,
  decision: ReturnType<typeof evaluateRealGpsObservation>,
  rawOrdinal: number,
  segmentId: string,
): void {
  appendSimulatorLog(
    decision.kind === 'ACCEPT' ? 'GPS_ACCEPT' : 'GPS_REJECT',
    'activity_filter_decision_v2',
    {
      filterVersion: 1,
      rawOrdinal,
      sampleSource: 'background',
      sampleTimestamp: observation.t,
      horizontalAccuracyM: roundedDiagnostic(observation.accuracy),
      verticalAccuracyM: roundedDiagnostic(observation.verticalAccuracy),
      reportedSpeedValid: observation.speed != null && observation.speed >= 0,
      reportedSpeedMps: observation.speed != null && observation.speed >= 0
        ? roundedDiagnostic(observation.speed)
        : null,
      reportedCourseValid: observation.course != null && observation.course >= 0,
      dtFromTrustedMs: decision.diagnostics.dtFromTrustedMs,
      displacementFromTrustedM: roundedDiagnostic(decision.diagnostics.displacementFromTrustedM),
      impliedSpeedMps: roundedDiagnostic(decision.diagnostics.impliedSpeedMps),
      accuracyAdjustedSpeedMps: roundedDiagnostic(decision.diagnostics.lowerBoundSpeedMps),
      trajectoryInnovationM: roundedDiagnostic(decision.diagnostics.predictionInnovationM),
      headingDeltaDeg: roundedDiagnostic(decision.diagnostics.headingDeltaDeg),
      decision: decision.kind,
      decisionReason: decision.reason,
      candidateId: decision.candidateEvent?.candidateId ?? decision.state.pending?.id ?? null,
      candidateRawOrdinal: decision.candidateEvent?.candidateRawOrdinal
        ?? decision.state.pending?.observation.rawOrdinal
        ?? null,
      corroboratingRawOrdinal: decision.candidateEvent ? rawOrdinal : null,
      candidateEvidenceCount: decision.state.pending?.evidenceCount ?? null,
      segmentId,
    },
    {
      userId: context.userId,
      clientActivityId: context.clientActivityId,
      qaSessionId: context.qaSessionId,
      coordinateSource: 'real',
      force: true,
    },
  );
  if (!decision.candidateEvent) return;
  appendSimulatorLog('GPS_REJECT', 'activity_candidate_transition_v1', {
    transition: decision.candidateEvent.type,
    rawOrdinal,
    reason: decision.reason,
    candidateId: decision.candidateEvent.candidateId,
    candidateRawOrdinal: decision.candidateEvent.candidateRawOrdinal ?? null,
    corroboratingRawOrdinal: rawOrdinal,
    ageMs: decision.candidateEvent.delayMs,
    fixCount: decision.state.pending?.evidenceCount ?? 2,
    detourExcessM: roundedDiagnostic(decision.candidateEvent.detourExcessM),
    reversalDeg: roundedDiagnostic(decision.candidateEvent.reversalDeg),
  }, {
    userId: context.userId,
    clientActivityId: context.clientActivityId,
    qaSessionId: context.qaSessionId,
    coordinateSource: 'real',
    force: true,
  });
  appendSimulatorLog(
    decision.candidateEvent.type === 'candidate_confirmed' ? 'GPS_ACCEPT' : 'GPS_REJECT',
    decision.candidateEvent.type,
    {
      rawOrdinal,
      reason: decision.reason,
      candidateId: decision.candidateEvent.candidateId,
      candidateRawOrdinal: decision.candidateEvent.candidateRawOrdinal ?? null,
      corroboratingRawOrdinal: rawOrdinal,
      delayIntroducedMs: decision.candidateEvent.delayMs,
      relativeDisplacementM: roundedDiagnostic(decision.diagnostics.displacementFromTrustedM),
      horizontalAccuracyM: roundedDiagnostic(observation.accuracy),
      corroboratingDisplacementM: roundedDiagnostic(decision.candidateEvent.corroboratingDisplacementM),
      detourExcessM: roundedDiagnostic(decision.candidateEvent.detourExcessM),
      reversalDeg: roundedDiagnostic(decision.candidateEvent.reversalDeg),
    },
    {
      userId: context.userId,
      clientActivityId: context.clientActivityId,
      qaSessionId: context.qaSessionId,
      coordinateSource: 'real',
      force: true,
    },
  );
}

/**
 * Direct file-system append for the case when app process was killed and
 * TaskManager woke us up just to deliver a GPS fix. We bypass debugLogger
 * because its in-memory state is empty.
 *
 * v409 fix #6: 写到 cairn-hike-tracks/active/{sid}.jsonl (与 hikeTrackWriter
 * 同目录同文件),不再写到 cairn-logs/sessions/。这样 stopTracking 之后
 * 完整 tail 都在同一个文件,hydrate 补 replay 一次读齐。
 * gate 从 debugLogger.enabled 换成 STORAGE_KEY_HIKE_ACTIVE (语义换了)。
 */
async function appendDirectlyToHikeTrack(
  events: any[],
  context: DurableActivityContext,
  nativeBatchSequence: number,
): Promise<any[]> {
  try {
    // Runtime require avoids a module-load cycle while still sharing the same
    // canonical writer, transaction, schema, and mutex as foreground points.
    // It also works in TaskManager's constrained headless CommonJS runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { appendBackgroundHikePoints, readActiveHikeTail } = require('./hikeTrackWriter');
    const tail = await readActiveHikeTail(context.clientActivityId);
    let previous = (tail[tail.length - 1] ?? null) as SegmentedTrackPoint | null;
    let activeSegmentId = previous?.segmentId ?? context.segmentId;
    let rawOrdinal = Math.max(0, Number(context.rawOrdinal) || 0);
    let latestObservedTimestamp = previous?.t ?? context.acceptAfterMs - 1;
    let continuity = context.continuityState?.version === 1
      ? context.continuityState
      : createRealGpsContinuityState(
          tail.slice(-2).map((point: any, index: number) => ({
            lat: point.lat,
            lng: point.lng,
            t: point.t,
            accuracy: point.acc ?? point.accuracy ?? null,
            verticalAccuracy: point.vAcc ?? point.verticalAccuracy ?? null,
            altitude: point.alt ?? null,
            speed: point.speed ?? null,
            course: point.course ?? null,
            source: 'background' as const,
            observationId: 'headless-restored-' + index + '-' + point.t,
            rawOrdinal: point.rawOrdinal,
            segmentId: point.segmentId ?? activeSegmentId,
          })),
        );
    const accepted: any[] = [];
    const classified: any[] = [];
    const observedOrdinals: number[] = [];
    for (const event of [...events].sort((a, b) => a.t - b.t)) {
      if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng) || !Number.isFinite(event.t)) continue;
      // Native providers may deliver an old queued batch after Resume.  A
      // generation timestamp is necessary but not sufficient: within one
      // generation samples must also be strictly chronological.
      if (event.t < context.acceptAfterMs || event.t <= latestObservedTimestamp) continue;
      latestObservedTimestamp = event.t;
      rawOrdinal += 1;
      observedOrdinals.push(rawOrdinal);
      const observation: RealGpsObservation = {
        lat: event.lat,
        lng: event.lng,
        t: event.t,
        accuracy: event.acc ?? null,
        verticalAccuracy: event.vAcc ?? null,
        altitude: event.alt ?? null,
        speed: event.speed ?? null,
        course: event.course ?? null,
        source: 'background',
        observationId: context.clientActivityId.slice(-8) + ':' + rawOrdinal,
        rawOrdinal,
      };
      appendSimulatorLog('LOCATION', 'activity_observation_received_v2', {
        rawOrdinal,
        sampleSource: 'background',
        sampleTimestamp: observation.t,
        callbackDelayMs: Math.max(0, Date.now() - observation.t),
        horizontalAccuracyM: roundedDiagnostic(observation.accuracy),
        verticalAccuracyValid: observation.verticalAccuracy != null && observation.verticalAccuracy >= 0,
        verticalAccuracyM: roundedDiagnostic(observation.verticalAccuracy),
        reportedSpeedValid: observation.speed != null && observation.speed >= 0,
        reportedSpeedMps: observation.speed != null && observation.speed >= 0
          ? roundedDiagnostic(observation.speed)
          : null,
        reportedCourseValid: observation.course != null && observation.course >= 0,
        // Headless TaskManager tests and constrained native wakes may not have
        // a hydrated React Native AppState module. Provider evidence must still
        // reach the journal; lifecycle visibility is diagnostic, not authority.
        appState: (AppState as any)?.currentState ?? 'unknown',
        backgroundPermissionState: context.backgroundPermissionState ?? 'unknown',
        ownerGenerationSuffix: context.ownerGeneration.slice(-8),
      }, {
        userId: context.userId,
        clientActivityId: context.clientActivityId,
        qaSessionId: context.qaSessionId,
        coordinateSource: 'real',
        force: true,
      });
      const decision = evaluateRealGpsObservation(continuity, observation, context.activityMode, Date.now());
      continuity = decision.state;
      emitHeadlessMotionDecision(context, observation, decision, rawOrdinal, activeSegmentId);
      if (decision.kind !== 'ACCEPT') {
        classified.push({
          ...event,
          observationId: observation.observationId,
          rawOrdinal,
          canonicalDecision: decision.kind,
          decisionReason: decision.reason,
          continuityPreclassified: true,
          continuityStateAfter: continuity,
        });
        continue;
      }
      const canonicalObservations = decision.confirmedCandidate
        ? [decision.confirmedCandidate, observation]
        : [observation];
      if (decision.confirmedCandidate) {
        const existingPending = classified.findIndex(
          item => item.observationId === decision.confirmedCandidate?.observationId,
        );
        if (existingPending >= 0) classified.splice(existingPending, 1);
      }
      for (const canonicalObservation of canonicalObservations) {
        const sourceEvent = canonicalObservation === observation
          ? event
          : {
              t: canonicalObservation.t,
              lat: canonicalObservation.lat,
              lng: canonicalObservation.lng,
              acc: canonicalObservation.accuracy,
              alt: canonicalObservation.altitude ?? null,
              vAcc: canonicalObservation.verticalAccuracy ?? null,
              speed: canonicalObservation.speed ?? null,
              course: canonicalObservation.course ?? null,
              src: 'bg',
              conf: 1,
            };
        const startsGap = shouldStartNewSegment({
          previous,
          next: {
            lat: canonicalObservation.lat,
            lng: canonicalObservation.lng,
            t: canonicalObservation.t,
            accuracy: canonicalObservation.accuracy,
          },
          mode: context.activityMode,
        });
        if (startsGap) {
          const previousSegmentId = previous?.segmentId ?? activeSegmentId;
          const previousTimestamp = previous?.t ?? null;
          const previousDistanceM = previous
            ? roundedDiagnostic(haversineM(previous, canonicalObservation))
            : null;
          activeSegmentId = newSegmentId(context.clientActivityId, canonicalObservation.t);
          appendSimulatorLog('GPS_SEGMENT', 'activity_segment_decision_v2', {
            decision: 'new-segment',
            trigger: 'headless-continuity-classifier',
            previousSegmentId,
            nextSegmentId: activeSegmentId,
            intervalMs: previousTimestamp == null ? null : canonicalObservation.t - previousTimestamp,
            displacementM: previousDistanceM,
            continuityAllowed: false,
            distanceContributionM: 0,
            elevationContributionM: 0,
            memoryBridgeAllowed: false,
          }, {
            userId: context.userId,
            clientActivityId: context.clientActivityId,
            qaSessionId: context.qaSessionId,
            coordinateSource: 'none',
            force: true,
          });
        }
        const point: any = {
          ...sourceEvent,
          observationId: canonicalObservation.observationId,
          vAcc: canonicalObservation.verticalAccuracy ?? null,
          course: canonicalObservation.course ?? null,
          rawOrdinal: canonicalObservation.rawOrdinal,
          clientActivityId: context.clientActivityId,
          ownerGeneration: context.ownerGeneration,
          segmentId: activeSegmentId,
          ...(startsGap ? { segmentStartReason: 'gps-reacquired' as const } : {}),
        };
        const acceptedContinuity = acceptRealGpsObservation(
          continuity,
          canonicalObservation,
          activeSegmentId,
        );
        continuity = acceptedContinuity.state;
        point.continuityStateAfter = continuity;
        point.continuityPreclassified = true;
        point.canonicalDecision = 'ACCEPT';
        point.decisionReason = decision.reason;
        accepted.push(point);
        classified.push(point);
        previous = { ...point, accuracy: point.acc ?? null } as SegmentedTrackPoint;
      }
    }
    if (accepted.length > 0) {
      appendSimulatorLog('ACTIVITY_POINT', 'activity_journal_commit_v2', {
        phase: 'attempt',
        ledgerKind: 'canonical-background',
        firstRawOrdinal: accepted[0]?.rawOrdinal ?? null,
        lastRawOrdinal: accepted[accepted.length - 1]?.rawOrdinal ?? null,
        canonicalAttemptCount: accepted.length,
        nativeBatchSequence,
      }, {
        userId: context.userId,
        clientActivityId: context.clientActivityId,
        qaSessionId: context.qaSessionId,
        coordinateSource: 'none',
        force: true,
      });
      await appendBackgroundHikePoints(accepted, context.userId);
      appendSimulatorLog('ACTIVITY_POINT', 'activity_journal_commit_v2', {
        phase: 'result',
        ledgerKind: 'canonical-background',
        firstRawOrdinal: accepted[0]?.rawOrdinal ?? null,
        lastRawOrdinal: accepted[accepted.length - 1]?.rawOrdinal ?? null,
        canonicalCommittedCount: accepted.length,
        nativeBatchSequence,
        committed: true,
      }, {
        userId: context.userId,
        clientActivityId: context.clientActivityId,
        qaSessionId: context.qaSessionId,
        coordinateSource: 'none',
        force: true,
      });
    }
    await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify({
      ...context,
      segmentId: activeSegmentId,
      continuityState: continuity,
      rawOrdinal,
    }));
    appendSimulatorLog('PROVIDER', 'real_activity_background_journal_result', {
      batchCount: events.length,
      acceptedCount: accepted.length,
      rejectedCount: classified.length - accepted.length,
      journalCommitted: accepted.length > 0,
    }, {
      userId: context.userId,
      clientActivityId: context.clientActivityId,
      qaSessionId: context.qaSessionId,
      coordinateSource: 'real',
      force: true,
    });
    appendSimulatorLog('PROVIDER', 'activity_background_batch_v2', {
      phase: 'post-journal',
      nativeBatchSequence,
      batchCount: events.length,
      acceptedCount: accepted.length,
      rejectedOrPendingCount: classified.length - accepted.length,
      firstRawOrdinal: observedOrdinals[0] ?? null,
      lastRawOrdinal: observedOrdinals[observedOrdinals.length - 1] ?? null,
      journalCommitted: accepted.length > 0,
      ownerGenerationSuffix: context.ownerGeneration.slice(-8),
    }, {
      userId: context.userId,
      clientActivityId: context.clientActivityId,
      qaSessionId: context.qaSessionId,
      coordinateSource: 'none',
      force: true,
    });
    return classified.sort((a, b) => a.t - b.t);
  } catch (error) {
    crashLogger.breadcrumb(`activity:bg_journal_rejected ${String(error).slice(0, 80)}`);
    appendSimulatorLog('ERROR', 'activity_journal_commit_v2', {
      phase: 'result',
      ledgerKind: 'canonical-background',
      nativeBatchSequence,
      committed: false,
      errorCategory: String(error).slice(0, 120),
    }, {
      userId: context.userId,
      clientActivityId: context.clientActivityId,
      qaSessionId: context.qaSessionId,
      coordinateSource: 'none',
      force: true,
    });
    appendSimulatorLog('ERROR', 'activity_background_batch_v2', {
      phase: 'post-journal',
      nativeBatchSequence,
      batchCount: events.length,
      journalCommitted: false,
      errorCategory: String(error).slice(0, 120),
      ownerGenerationSuffix: context.ownerGeneration.slice(-8),
    }, {
      userId: context.userId,
      clientActivityId: context.clientActivityId,
      qaSessionId: context.qaSessionId,
      coordinateSource: 'none',
      force: true,
    });
    return [];
  }
}

let registered = false;
let backgroundNativeBatchSequence = 0;

// R114/O22 STORY-73003 (K10) root cause hypothesis #1: register the
// TaskManager handler SYNCHRONOUSLY at module load time. iOS's docs
// require `defineTask` to be called before JS runtime is asked to
// dispatch — the previous `await import('expo-task-manager')` inside
// an async function created a microtask-gap window where headless wakes
// could arrive before registration completed. We now use a synchronous
// `require()` guarded by Platform check.
const handleBackgroundLocationTask = async ({ data, error }: { data: any; error: any }) => withOwnershipBoundary(async () => {
  crashLogger.breadcrumb(
    `k10:task_fire loc_count=${data?.locations?.length ?? 0} err=${error ? String(error).slice(0, 40) : 'none'} elapsed_ms=${Date.now() - moduleLoadTs}`
  );
  const payload = data as { locations?: Array<{ coords: LocationCoords; timestamp: number }> };
  const locations = payload?.locations ?? [];
  let context: DurableActivityContext | null = null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
    context = raw ? JSON.parse(raw) : null;
  } catch { context = null; }
  if (error) {
    try { debugLogger.logError(error, 'BackgroundLocationTask'); } catch { /* ignore */ }
    if (context) {
      appendSimulatorLog('ERROR', 'activity_background_batch_v2', {
        phase: 'native-task-error',
        batchCount: locations.length,
        errorCategory: String(error).slice(0, 120),
        ownerGenerationSuffix: context.ownerGeneration?.slice(-8) ?? null,
      }, {
        userId: context.userId,
        clientActivityId: context.clientActivityId,
        qaSessionId: context.qaSessionId,
        coordinateSource: 'none',
        force: true,
      });
      await flushSimulatorLogs(context.userId).catch(() => undefined);
    }
    return;
  }
  if (
    !context
    || typeof context.clientActivityId !== 'string'
    || typeof context.userId !== 'string'
    || typeof context.ownerGeneration !== 'string'
    || typeof context.segmentId !== 'string'
  ) return;
  context.activityMode = context.activityMode === 'running' ? 'running' : 'hiking';
  context.acceptAfterMs = Number.isFinite(context.acceptAfterMs) ? context.acceptAfterMs : 0;
  const hikeActive = (await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE)) === '1';
  const activeSid = await AsyncStorage.getItem(STORAGE_KEY_SESSION);
  const hasActiveSid = !!activeSid;
  const legacyEnabled = (await AsyncStorage.getItem(STORAGE_KEY_LEGACY_ENABLED)) === '1';
  // A v2 owner context is accepted only with the v2 live bit. The historical
  // debug flag is inspected for diagnostics/migration, never as recording
  // authority after Finish or Logout has disabled the live lease.
  if (!hikeActive) return;
  if (activeSid !== context.clientActivityId) return;
  const nativeBatchSequence = ++backgroundNativeBatchSequence;
  const events: any[] = [];
  for (const [nativeBatchIndex, loc] of locations.entries()) {
    const sampleTimestamp = loc.timestamp || Date.now();
    if (sampleTimestamp < (context.acceptAfterMs || 0)) {
      crashLogger.breadcrumb(`activity:bg_stale_sample_rejected t=${sampleTimestamp}`);
      continue;
    }
    const coords: LocationCoords = {
      ...loc.coords,
      timestamp: sampleTimestamp,
      clientActivityId: context.clientActivityId,
      ownerGeneration: context.ownerGeneration,
      segmentId: context.segmentId,
    };
    appendSimulatorLog('LOCATION', 'real_activity_location_callback', {
      sampleSource: 'background',
      sequenceTimestamp: Math.floor(sampleTimestamp),
      callbackWallTimestamp: Date.now(),
      accuracyM: coords.accuracy,
      verticalAccuracyM: coords.altitudeAccuracy,
      speedMps: coords.speed,
      courseValid: coords.heading != null && coords.heading >= 0,
      nativeBatchSize: locations.length,
      nativeBatchSequence,
      nativeBatchIndex,
    }, {
      userId: context.userId,
      clientActivityId: context.clientActivityId,
      qaSessionId: context.qaSessionId,
      coordinateSource: 'real',
      force: true,
    });
    events.push({
      t: sampleTimestamp,
      lat: coords.latitude,
      lng: coords.longitude,
      acc: coords.accuracy,
      alt: coords.altitude,
      vAcc: coords.altitudeAccuracy,
      speed: coords.speed,
      course: coords.heading,
      src: 'bg',
      conf: 1,
    });
  }
  if (events.length === 0) return;
  appendSimulatorLog('PROVIDER', 'real_activity_background_callback_checkpoint', {
    nativeBatchSize: locations.length,
    nativeBatchSequence,
    eligibleSampleCount: events.length,
    taskElapsedSinceModuleLoadMs: Date.now() - moduleLoadTs,
      activeLease: hikeActive,
      backgroundPermissionState: context.backgroundPermissionState ?? 'unknown',
      ownerGenerationSuffix: context.ownerGeneration.slice(-8),
  }, {
    userId: context.userId,
    clientActivityId: context.clientActivityId,
    qaSessionId: context.qaSessionId,
    coordinateSource: 'real',
    force: true,
  });
  if (debugLogger.isEnabled() && debugLogger.getCurrentSessionId()) {
    crashLogger.breadcrumb(`k10:path_a sid=${debugLogger.getCurrentSessionId()}`);
    for (const e of events) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      debugLogger.log(e as any);
    }
  }
  try {
    crashLogger.breadcrumb(
      `k10:path_b hikeActive=${hikeActive} hasSid=${hasActiveSid} legacy=${legacyEnabled}`
    );
    const accepted = await appendDirectlyToHikeTrack(events, context, nativeBatchSequence);
    for (const point of accepted) {
      pendingBackgroundLocations.push({
        latitude: point.lat,
        longitude: point.lng,
        altitude: point.alt ?? null,
        accuracy: point.acc ?? null,
        altitudeAccuracy: point.vAcc ?? null,
        speed: point.speed ?? null,
        heading: point.course ?? null,
        timestamp: point.t,
        clientActivityId: point.clientActivityId,
        ownerGeneration: point.ownerGeneration,
        segmentId: point.segmentId,
        segmentStartReason: point.segmentStartReason,
        rawOrdinal: point.rawOrdinal,
        continuityPreclassified: true,
        canonicalDecision: point.canonicalDecision,
        decisionReason: point.decisionReason,
        continuityStateAfter: point.continuityStateAfter,
      });
    }
    crashLogger.breadcrumb(`k10:path_b_write n=${accepted.length}`);
    await flushSimulatorLogs(context.userId);
  } catch (e: any) {
    crashLogger.breadcrumb(`k10:path_b_err ${String(e?.message || e).slice(0, 60)}`);
  }
});

// Synchronous top-level registration. Guarded by Platform + try/catch so
// web / Expo Go without dev client don't crash on import.
if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
      TaskManager.defineTask(BACKGROUND_LOCATION_TASK, handleBackgroundLocationTask);
      registered = true;
      crashLogger.breadcrumb(`k10:register_sync_done elapsed_ms=${Date.now() - moduleLoadTs}`);
    }
  } catch (err: any) {
    crashLogger.breadcrumb(`k10:register_sync_err ${String(err?.message || err).slice(0, 60)}`);
  }
}

export async function registerBackgroundTask(): Promise<boolean> {
  // Kept for backward compat with callers that await this. The actual
  // registration already happened synchronously above at module load.
  if (registered) return true;
  try {
    const TaskManager = await import('expo-task-manager');
    if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
      TaskManager.defineTask(BACKGROUND_LOCATION_TASK, handleBackgroundLocationTask);
    }
    registered = true;
    return true;
  } catch {
    return false;
  }
}
