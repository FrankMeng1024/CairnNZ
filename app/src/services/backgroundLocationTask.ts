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
  evaluateRealGpsObservation,
  REAL_GPS_CONTINUITY_VERSION,
  restoreRealGpsContinuityState,
  type RealGpsContinuityState,
  type RealGpsObservation,
} from '../features/activity/realGpsContinuity';
import {
  activityStageMonotonicNow,
  recordActivityStageEvent,
  recordActivityStageEventDurably,
} from '../features/activity/activityStageLedger';
import {
  flushActivityDiagnosticReplay,
  recordActivityDiagnosticCanonicalPromotion,
  recordActivityDiagnosticDecision,
  recordActivityDiagnosticObservation,
} from '../features/activity/activityDiagnosticReplay';
import type { HikeTrackProjectionCursor } from './hikeTrackWriter';
import { activityObservationEvidenceId } from '../features/activity/activityEvidenceIdentity';

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
  /** Exact native callback receipt paired with its original observation time.
   * Foreground recovery may restore source health only from this evidence; an
   * accepted-point timestamp alone does not prove that a callback was received. */
  latestSourceReceipt?: DurableSourceReceipt | null;
  /** Receipt of the JavaScript TaskManager callback itself. This advances for
   * empty/error/stale batches and therefore must not be inferred from a GPS
   * observation or WAL commit. It intentionally contains no coordinate. */
  latestJsCallbackReceipt?: DurableJsCallbackReceipt | null;
  /** Wall clock at which this owner first expected the persistent source to
   * deliver. This is the fallback anchor before the first real callback. */
  sourceExpectedSinceMs?: number;
  /** Dedupe frontier for resume-time SILENCE_GAP facts. It identifies the
   * latest real receipt (or start anchor) already classified, never a fix. */
  silenceGapReportedForReceiptWallTimeMs?: number | null;
  /** Two-phase crash-safe SILENCE_GAP fact. It is cleared only after the
   * coordinate-free stage event has been strictly persisted and read back. */
  pendingSilenceGap?: DurableSilenceGap | null;
  /** Queue form supersedes the legacy single pending slot. Each interval stays
   * durable until its exact coordinate-free ledger event is acknowledged. */
  pendingSilenceGaps?: DurableSilenceGap[];
  /** Monotonic, coordinate-free summary when the exact pending queue exceeds
   * its explicit retention cap. `reportedDroppedCount` proves which cumulative
   * snapshot reached the strict ledger without hiding later overflow. */
  silenceGapOverflow?: DurableSilenceGapOverflow | null;
  /** Last complete WAL record published into the mounted Activity projection.
   * The cursor contains checksums/offsets only—never a coordinate. */
  journalProjectionFrontier?: DurableJournalProjectionFrontier | null;
}

export interface DurableJournalProjectionFrontier {
  clientActivityId: string;
  cursor: HikeTrackProjectionCursor;
  lastPointKey: string;
  projectedAtMs: number;
}

export interface DurableSourceReceipt {
  observationTimeMs: number;
  receiptWallTimeMs: number;
  source: 'foreground' | 'background' | 'significant-change';
}

export interface DurableJsCallbackReceipt {
  receiptWallTimeMs: number;
  source: 'background';
  batchSize: number;
  validObservationCount: number;
  errorDelivered: boolean;
}

// The native callback and UI lifecycle can run on interleaved promise turns.
// Serialize the complete "validate live lease -> journal append" operation with
// lease mutation. Therefore Finish/Logout either waits for a commit that began
// before its fence, or disables the lease before the callback can validate.
let ownershipTail: Promise<void> = Promise.resolve();
let durableOwnershipCommandEpoch = 0;
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

export interface DurableSilenceGap {
  evidenceId: string;
  clientActivityId: string;
  ownerGeneration: string;
  detectedAtMs: number;
  anchorReceiptWallTimeMs: number;
  lastObservationTimeMs: number | null;
  durationMs: number;
  source: DurableSourceReceipt['source'] | 'awaiting-first-callback';
  classification: 'SILENCE_GAP';
  upstreamCause: 'UPSTREAM_UNKNOWN';
  nativeVisibility: 'NATIVE_UNOBSERVABLE';
}

export interface DurableSilenceGapOverflow {
  clientActivityId: string;
  ownerGeneration: string;
  droppedCount: number;
  reportedDroppedCount: number;
  firstDroppedAnchorReceiptWallTimeMs: number;
  lastDroppedAnchorReceiptWallTimeMs: number;
  lastUpdatedAtMs: number;
  classification: 'SILENCE_GAP_RETENTION_OVERFLOW';
  upstreamCause: 'UPSTREAM_UNKNOWN';
  nativeVisibility: 'NATIVE_UNOBSERVABLE';
}

export const MAX_PENDING_DURABLE_SILENCE_GAPS = 64;

function durableSilenceGapQueue(context: DurableActivityContext): DurableSilenceGap[] {
  const candidates = [
    ...(Array.isArray(context.pendingSilenceGaps) ? context.pendingSilenceGaps : []),
    ...(context.pendingSilenceGap ? [context.pendingSilenceGap] : []),
  ];
  const byEvidenceId = new Map<string, DurableSilenceGap>();
  for (const gap of candidates) {
    if (!gap || gap.clientActivityId !== context.clientActivityId
      || gap.ownerGeneration !== context.ownerGeneration
      || typeof gap.evidenceId !== 'string') continue;
    byEvidenceId.set(gap.evidenceId, gap);
  }
  return [...byEvidenceId.values()].sort((left, right) => (
    left.anchorReceiptWallTimeMs - right.anchorReceiptWallTimeMs
    || left.detectedAtMs - right.detectedAtMs
  ));
}

function boundDurableSilenceGapQueue(context: DurableActivityContext): DurableSilenceGap[] {
  if (context.silenceGapOverflow
    && (context.silenceGapOverflow.clientActivityId !== context.clientActivityId
      || context.silenceGapOverflow.ownerGeneration !== context.ownerGeneration)) {
    context.silenceGapOverflow = null;
  }
  const pending = durableSilenceGapQueue(context);
  const excess = Math.max(0, pending.length - MAX_PENDING_DURABLE_SILENCE_GAPS);
  if (excess > 0) {
    const dropped = pending.splice(0, excess);
    const prior = context.silenceGapOverflow?.clientActivityId === context.clientActivityId
      && context.silenceGapOverflow.ownerGeneration === context.ownerGeneration
      ? context.silenceGapOverflow
      : null;
    context.silenceGapOverflow = {
      clientActivityId: context.clientActivityId,
      ownerGeneration: context.ownerGeneration,
      droppedCount: (prior?.droppedCount ?? 0) + dropped.length,
      reportedDroppedCount: prior?.reportedDroppedCount ?? 0,
      firstDroppedAnchorReceiptWallTimeMs: Math.min(
        prior?.firstDroppedAnchorReceiptWallTimeMs ?? Number.POSITIVE_INFINITY,
        dropped[0].anchorReceiptWallTimeMs,
      ),
      lastDroppedAnchorReceiptWallTimeMs: Math.max(
        prior?.lastDroppedAnchorReceiptWallTimeMs ?? Number.NEGATIVE_INFINITY,
        dropped[dropped.length - 1].anchorReceiptWallTimeMs,
      ),
      lastUpdatedAtMs: Math.max(
        prior?.lastUpdatedAtMs ?? 0,
        ...dropped.map(gap => gap.detectedAtMs),
      ),
      classification: 'SILENCE_GAP_RETENTION_OVERFLOW',
      upstreamCause: 'UPSTREAM_UNKNOWN',
      nativeVisibility: 'NATIVE_UNOBSERVABLE',
    };
  }
  context.pendingSilenceGaps = pending;
  context.pendingSilenceGap = null;
  return pending;
}

function stageSilenceGapsForContext(
  context: DurableActivityContext,
  nowMs: number,
  thresholdMs: number,
): DurableSilenceGap[] {
  const pending = boundDurableSilenceGapQueue(context);
  const callbackReceipt = context.latestJsCallbackReceipt;
  const observationReceipt = context.latestSourceReceipt;
  const anchorReceiptWallTimeMs = Math.floor(
    callbackReceipt?.receiptWallTimeMs
      ?? observationReceipt?.receiptWallTimeMs
      ?? context.sourceExpectedSinceMs
      ?? context.acceptAfterMs,
  );
  const durationMs = Math.max(0, nowMs - anchorReceiptWallTimeMs);
  if (!Number.isFinite(anchorReceiptWallTimeMs)
    || durationMs < thresholdMs
    || context.silenceGapReportedForReceiptWallTimeMs === anchorReceiptWallTimeMs) {
    context.pendingSilenceGaps = pending;
    return pending;
  }
  const candidate: DurableSilenceGap = {
    evidenceId: `${context.clientActivityId}:silence:${anchorReceiptWallTimeMs}`,
    clientActivityId: context.clientActivityId,
    ownerGeneration: context.ownerGeneration,
    detectedAtMs: nowMs,
    anchorReceiptWallTimeMs,
    lastObservationTimeMs: Number.isFinite(observationReceipt?.observationTimeMs)
      ? Math.floor(observationReceipt!.observationTimeMs)
      : null,
    durationMs,
    source: callbackReceipt?.source ?? observationReceipt?.source ?? 'awaiting-first-callback',
    classification: 'SILENCE_GAP',
    upstreamCause: 'UPSTREAM_UNKNOWN',
    nativeVisibility: 'NATIVE_UNOBSERVABLE',
  };
  if (!pending.some(gap => gap.evidenceId === candidate.evidenceId)) pending.push(candidate);
  pending.sort((left, right) => left.anchorReceiptWallTimeMs - right.anchorReceiptWallTimeMs);
  context.pendingSilenceGaps = pending;
  return boundDurableSilenceGapQueue(context);
}

function pendingSilenceGapForContext(
  context: DurableActivityContext,
  nowMs: number,
  thresholdMs: number,
): DurableSilenceGap | null {
  return stageSilenceGapsForContext(context, nowMs, thresholdMs)[0] ?? null;
}

/**
 * Classify a callback-free interval only after JavaScript resumes. The
 * checkpoint is serialized with native receipt/WAL ownership, so a concurrent
 * TaskManager delivery either advances the anchor first or follows this fact.
 * No timer or synthetic location is created while JavaScript is suspended.
 */
export async function detectDurableSilenceGapAfterResume(input: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  nowMs?: number;
  thresholdMs?: number;
}): Promise<DurableSilenceGap | null> {
  return withOwnershipBoundary(async () => {
    try {
      if ((await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE)) !== '1') return null;
      const encoded = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      if (!encoded) return null;
      const context = JSON.parse(encoded) as DurableActivityContext;
      if (context.userId !== input.ownerUserId
        || context.clientActivityId !== input.clientActivityId
        || context.ownerGeneration !== input.ownerGeneration) return null;
      const nowMs = Math.floor(input.nowMs ?? Date.now());
      const thresholdMs = Math.max(60_000, Math.floor(input.thresholdMs ?? 90_000));
      const gap = pendingSilenceGapForContext(context, nowMs, thresholdMs);
      if (!gap) return null;
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context));
      return gap;
    } catch {
      return null;
    }
  });
}

export async function detectDurableSilenceGapsAfterResume(input: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  nowMs?: number;
  thresholdMs?: number;
}): Promise<DurableSilenceGap[]> {
  return withOwnershipBoundary(async () => {
    try {
      if ((await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE)) !== '1') return [];
      const encoded = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      if (!encoded) return [];
      const context = JSON.parse(encoded) as DurableActivityContext;
      if (context.userId !== input.ownerUserId
        || context.clientActivityId !== input.clientActivityId
        || context.ownerGeneration !== input.ownerGeneration) return [];
      const nowMs = Math.floor(input.nowMs ?? Date.now());
      const thresholdMs = Math.max(60_000, Math.floor(input.thresholdMs ?? 90_000));
      const gaps = stageSilenceGapsForContext(context, nowMs, thresholdMs);
      if (gaps.length === 0) return [];
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context));
      return gaps;
    } catch {
      return [];
    }
  });
}

export async function acknowledgeDurableSilenceGap(input: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  evidenceId: string;
}): Promise<boolean> {
  return withOwnershipBoundary(async () => {
    try {
      const encoded = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      if (!encoded) return false;
      const context = JSON.parse(encoded) as DurableActivityContext;
      const pending = durableSilenceGapQueue(context).find(gap => gap.evidenceId === input.evidenceId);
      if (context.userId !== input.ownerUserId
        || context.clientActivityId !== input.clientActivityId
        || context.ownerGeneration !== input.ownerGeneration
        || pending?.evidenceId !== input.evidenceId) return false;
      context.silenceGapReportedForReceiptWallTimeMs = Math.max(
        context.silenceGapReportedForReceiptWallTimeMs ?? 0,
        pending.anchorReceiptWallTimeMs,
      );
      context.pendingSilenceGaps = durableSilenceGapQueue(context)
        .filter(gap => gap.evidenceId !== input.evidenceId);
      context.pendingSilenceGap = null;
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context));
      return true;
    } catch {
      return false;
    }
  });
}

export async function persistDurableSilenceGapEvent(input: {
  ownerUserId: string;
  gap: DurableSilenceGap;
  trigger: 'foreground-resume' | 'task-receipt' | 'process-recovery';
}): Promise<boolean> {
  const durable = await recordActivityStageEventDurably({
    ownerUserId: input.ownerUserId,
    clientActivityId: input.gap.clientActivityId,
    stage: 'provider-state',
    evidenceId: input.gap.evidenceId,
    wallTimeMs: input.gap.detectedAtMs,
    details: {
      eventCode: 'ACTIVITY_SILENCE_GAP',
      event: 'silent-interval-detected-after-recovery',
      trigger: input.trigger,
      durationMs: input.gap.durationMs,
      lastObservationTimeMs: input.gap.lastObservationTimeMs,
      receiptAnchorWallTimeMs: input.gap.anchorReceiptWallTimeMs,
      source: input.gap.source,
      classification: input.gap.classification,
      upstreamCause: input.gap.upstreamCause,
      nativeVisibility: input.gap.nativeVisibility,
      jsCallbackObservedAtDetection: input.trigger === 'task-receipt',
      callbackDeliveryWithinSilentInterval: false,
      movementDuringInterval: 'UNKNOWN',
      syntheticLocationCreated: false,
      ownerGenerationSuffix: input.gap.ownerGeneration.slice(-8),
    },
  });
  if (!durable) return false;
  return acknowledgeDurableSilenceGap({
    ownerUserId: input.ownerUserId,
    clientActivityId: input.gap.clientActivityId,
    ownerGeneration: input.gap.ownerGeneration,
    evidenceId: input.gap.evidenceId,
  });
}

async function persistDurableSilenceGapOverflowEvent(input: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  trigger: 'foreground-resume' | 'task-receipt' | 'process-recovery';
}): Promise<boolean> {
  const snapshot = await withOwnershipBoundary(async () => {
    try {
      if ((await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE)) !== '1') return null;
      const encoded = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      if (!encoded) return null;
      const context = JSON.parse(encoded) as DurableActivityContext;
      const overflow = context.silenceGapOverflow;
      if (context.userId !== input.ownerUserId
        || context.clientActivityId !== input.clientActivityId
        || context.ownerGeneration !== input.ownerGeneration
        || !overflow
        || overflow.clientActivityId !== input.clientActivityId
        || overflow.ownerGeneration !== input.ownerGeneration
        || overflow.droppedCount <= overflow.reportedDroppedCount) return null;
      return { ...overflow };
    } catch {
      return null;
    }
  });
  if (!snapshot) return false;
  const durable = await recordActivityStageEventDurably({
    ownerUserId: input.ownerUserId,
    clientActivityId: input.clientActivityId,
    stage: 'provider-state',
    evidenceId: `${input.clientActivityId}:silence-overflow:${snapshot.droppedCount}`,
    wallTimeMs: snapshot.lastUpdatedAtMs,
    details: {
      eventCode: 'ACTIVITY_SILENCE_GAP_RETENTION_OVERFLOW',
      event: 'silence-gap-retention-overflow',
      trigger: input.trigger,
      retainedExactIntervalLimit: MAX_PENDING_DURABLE_SILENCE_GAPS,
      cumulativeDroppedIntervalCount: snapshot.droppedCount,
      previouslyReportedDroppedIntervalCount: snapshot.reportedDroppedCount,
      firstDroppedReceiptAnchorWallTimeMs: snapshot.firstDroppedAnchorReceiptWallTimeMs,
      lastDroppedReceiptAnchorWallTimeMs: snapshot.lastDroppedAnchorReceiptWallTimeMs,
      classification: snapshot.classification,
      upstreamCause: snapshot.upstreamCause,
      nativeVisibility: snapshot.nativeVisibility,
      movementDuringIntervals: 'UNKNOWN',
      syntheticLocationCreated: false,
      ownerGenerationSuffix: snapshot.ownerGeneration.slice(-8),
    },
  });
  if (!durable) return false;
  return withOwnershipBoundary(async () => {
    try {
      const encoded = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      if (!encoded) return false;
      const context = JSON.parse(encoded) as DurableActivityContext;
      const current = context.silenceGapOverflow;
      if (context.userId !== input.ownerUserId
        || context.clientActivityId !== input.clientActivityId
        || context.ownerGeneration !== input.ownerGeneration
        || !current) return false;
      current.reportedDroppedCount = Math.max(
        current.reportedDroppedCount,
        snapshot.droppedCount,
      );
      context.silenceGapOverflow = current;
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context));
      return true;
    } catch {
      return false;
    }
  });
}

export async function persistPendingDurableSilenceGapEvents(input: {
  ownerUserId: string;
  gaps: DurableSilenceGap[];
  trigger: 'foreground-resume' | 'task-receipt' | 'process-recovery';
  clientActivityId?: string;
  ownerGeneration?: string;
}): Promise<number> {
  let acknowledged = 0;
  const unique = new Map(input.gaps.map(gap => [gap.evidenceId, gap]));
  for (const gap of [...unique.values()].sort((left, right) => (
    left.anchorReceiptWallTimeMs - right.anchorReceiptWallTimeMs
  ))) {
    if (await persistDurableSilenceGapEvent({
      ownerUserId: input.ownerUserId,
      gap,
      trigger: input.trigger,
    })) acknowledged += 1;
  }
  const identity = input.gaps[0];
  const clientActivityId = input.clientActivityId ?? identity?.clientActivityId;
  const ownerGeneration = input.ownerGeneration ?? identity?.ownerGeneration;
  if (clientActivityId && ownerGeneration) {
    await persistDurableSilenceGapOverflowEvent({
      ownerUserId: input.ownerUserId,
      clientActivityId,
      ownerGeneration,
      trigger: input.trigger,
    });
  }
  return acknowledged;
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
  options: { shouldContinue?: () => boolean } = {},
): Promise<boolean> {
  // Publish command intent before waiting for an older storage transaction.
  // Startup orphan cleanup snapshots this epoch, then performs native I/O
  // outside the ownership mutex; a fresh Start therefore fences that cleanup.
  durableOwnershipCommandEpoch += 1;
  return withOwnershipBoundary(async () => {
    try {
    if (options.shouldContinue && !options.shouldContinue()) return false;
    if (hikeActive) {
      if (!sessionId || !context) return false;
      // A foreground refresh must not erase a newer headless callback receipt
      // or a silence-report frontier already committed by this generation.
      try {
        const priorEncoded = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
        const prior = priorEncoded ? JSON.parse(priorEncoded) as DurableActivityContext : null;
        const sameActivity = prior?.clientActivityId === context.clientActivityId
          && prior.userId === context.userId;
        if (sameActivity) {
          const priorFrontier = prior?.journalProjectionFrontier;
          const nextFrontier = context.journalProjectionFrontier;
          if (priorFrontier?.clientActivityId === context.clientActivityId
            && (!nextFrontier
              || priorFrontier.cursor.recordIndex > nextFrontier.cursor.recordIndex)) {
            context.journalProjectionFrontier = priorFrontier;
          }
        }
        if (sameActivity && prior?.ownerGeneration === context.ownerGeneration) {
          const priorReceipt = prior.latestSourceReceipt;
          const nextReceipt = context.latestSourceReceipt;
          const preservePriorReceipt = !!priorReceipt && (!nextReceipt
            || priorReceipt.observationTimeMs > nextReceipt.observationTimeMs
            || (priorReceipt.observationTimeMs === nextReceipt.observationTimeMs
              && priorReceipt.receiptWallTimeMs > nextReceipt.receiptWallTimeMs));
          const priorCallback = prior.latestJsCallbackReceipt;
          const nextCallback = context.latestJsCallbackReceipt;
          const latestCallback = priorCallback && (!nextCallback
            || priorCallback.receiptWallTimeMs > nextCallback.receiptWallTimeMs)
            ? priorCallback
            : nextCallback;
          const pendingSilenceGaps = durableSilenceGapQueue({
            ...context,
            pendingSilenceGap: prior.pendingSilenceGap ?? context.pendingSilenceGap ?? null,
            pendingSilenceGaps: [
              ...(prior.pendingSilenceGaps ?? []),
              ...(context.pendingSilenceGaps ?? []),
            ],
          });
          const silenceGapOverflow = (prior.silenceGapOverflow?.droppedCount ?? 0)
            >= (context.silenceGapOverflow?.droppedCount ?? 0)
            ? prior.silenceGapOverflow
            : context.silenceGapOverflow;
          context = {
            ...context,
            sourceExpectedSinceMs: prior.sourceExpectedSinceMs
              ?? context.sourceExpectedSinceMs
              ?? context.acceptAfterMs,
            silenceGapReportedForReceiptWallTimeMs:
              prior.silenceGapReportedForReceiptWallTimeMs
              ?? context.silenceGapReportedForReceiptWallTimeMs
              ?? null,
            latestJsCallbackReceipt: latestCallback ?? null,
            pendingSilenceGap: null,
            pendingSilenceGaps,
            silenceGapOverflow: silenceGapOverflow ?? null,
            latestSourceReceipt: preservePriorReceipt ? priorReceipt : nextReceipt,
          };
        }
      } catch { /* a valid replacement below remains authoritative */ }
      context.sourceExpectedSinceMs ??= context.acceptAfterMs;
      boundDurableSilenceGapQueue(context);
      await AsyncStorage.setItem(STORAGE_KEY_SESSION, sessionId);
      if (options.shouldContinue && !options.shouldContinue()) return false;
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context));
      if (options.shouldContinue && !options.shouldContinue()) return false;
      // Enable last: a headless callback must never observe `active` before
      // the complete owner context is durable.
      await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '1');
    } else {
      // Disable first: queued native callbacks are fenced before owner keys
      // are removed one by one.
      await AsyncStorage.setItem(STORAGE_KEY_HIKE_ACTIVE, '0');
      if (options.shouldContinue && !options.shouldContinue()) return false;
      await AsyncStorage.removeItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      if (options.shouldContinue && !options.shouldContinue()) return false;
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
  speedAccuracy?: number | null;
  courseAccuracy?: number | null;
  timestamp: number;
  clientActivityId?: string;
  ownerGeneration?: string;
  segmentId?: string;
  segmentStartReason?: 'start' | 'resume' | 'process-recovery' | 'gps-reacquired' | 'legacy';
  rawOrdinal?: number;
  observationId?: string;
  /** Prevent the foreground drain from filtering a durably classified point twice. */
  continuityPreclassified?: boolean;
  canonicalDecision?: 'ACCEPT' | 'REJECT' | 'QUARANTINE' | 'REFINE';
  decisionReason?: string;
  continuityStateAfter?: RealGpsContinuityState;
  receiptWallTimeMs?: number;
  receiptMonotonicTimeMs?: number | null;
  callbackIdentity?: string;
  nativeBatchSequence?: number;
  nativeBatchIndex?: number;
  appStateAtReceipt?: string;
  /** The TaskManager receipt/decision already entered the opted-in replay.
   * Foreground handoff must not record the same native evidence twice. */
  diagnosticObservationRecorded?: boolean;
  diagnosticDecisionRecorded?: boolean;
};

const pendingBackgroundLocations: LocationCoords[] = [];
type ForegroundProjectionWake = (owner: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  receiptWallTimeMs: number;
}) => void;
let foregroundProjectionWake: ForegroundProjectionWake | null = null;
let startupOrphanMutationWake: (() => void) | null = null;

/** UI latency hint only. The accepted WAL remains the projection authority. */
export function setActivityTaskForegroundProjectionWake(
  wake: ForegroundProjectionWake | null,
): void {
  foregroundProjectionWake = wake;
}

/** A startup orphan stop can finish after a fresh Activity acquired ownership.
 * The mounted lifecycle registers this wake to re-assert its immutable owner. */
export function setActivityStartupOrphanMutationWake(wake: (() => void) | null): void {
  startupOrphanMutationWake = wake;
}

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

/** Atomic read-side handoff for the foreground classifier. The live bit is
 * checked with both identity records inside the ownership boundary so a
 * partial acquire/release can never masquerade as a current owner. */
export async function readDurableActivityContext(): Promise<DurableActivityContext | null> {
  return withOwnershipBoundary(async () => {
    try {
      const active = await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE);
      if (active !== '1') return null;
      const sessionId = await AsyncStorage.getItem(STORAGE_KEY_SESSION);
      const encoded = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      if (!sessionId || !encoded) return null;
      const parsed = JSON.parse(encoded) as DurableActivityContext;
      if (
        parsed?.clientActivityId !== sessionId
        || !parsed.userId
        || !parsed.ownerGeneration
        || !parsed.segmentId
        || (parsed.activityMode !== 'hiking' && parsed.activityMode !== 'running')
      ) return null;
      return parsed;
    } catch {
      return null;
    }
  });
}

export async function persistDurableJournalProjectionFrontier(input: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  cursor: HikeTrackProjectionCursor;
  lastPointKey: string;
  projectedAtMs?: number;
}): Promise<boolean> {
  return withOwnershipBoundary(async () => {
    try {
      if ((await AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE)) !== '1') return false;
      const sessionId = await AsyncStorage.getItem(STORAGE_KEY_SESSION);
      const encoded = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT);
      if (!sessionId || !encoded || sessionId !== input.clientActivityId) return false;
      const context = JSON.parse(encoded) as DurableActivityContext;
      if (context.userId !== input.ownerUserId
        || context.clientActivityId !== input.clientActivityId
        || context.ownerGeneration !== input.ownerGeneration
        || input.cursor.version !== 1
        || !Number.isInteger(input.cursor.recordIndex)
        || input.cursor.recordIndex <= 0
        || typeof input.lastPointKey !== 'string'
        || input.lastPointKey.length === 0) return false;
      const prior = context.journalProjectionFrontier;
      if (prior?.clientActivityId === input.clientActivityId
        && prior.cursor.recordIndex > input.cursor.recordIndex) return true;
      context.journalProjectionFrontier = {
        clientActivityId: input.clientActivityId,
        cursor: { ...input.cursor },
        lastPointKey: input.lastPointKey.slice(0, 240),
        projectedAtMs: Math.floor(input.projectedAtMs ?? Date.now()),
      };
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context));
      return true;
    } catch {
      return false;
    }
  });
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
      filterVersion: REAL_GPS_CONTINUITY_VERSION,
      rawOrdinal,
      sampleSource: 'background',
      sampleTimestamp: observation.t,
      horizontalAccuracyM: roundedDiagnostic(observation.accuracy),
      verticalAccuracyM: roundedDiagnostic(observation.verticalAccuracy),
      reportedSpeedValid: observation.speed != null && observation.speed >= 0,
      reportedSpeedMps: observation.speed != null && observation.speed >= 0
        ? roundedDiagnostic(observation.speed)
        : null,
      speedAccuracyMps: roundedDiagnostic(observation.speedAccuracy),
      reportedCourseValid: observation.course != null && observation.course >= 0,
      courseAccuracyDeg: roundedDiagnostic(observation.courseAccuracy),
      dtFromTrustedMs: decision.diagnostics.dtFromTrustedMs,
      displacementFromTrustedM: roundedDiagnostic(decision.diagnostics.displacementFromTrustedM),
      impliedSpeedMps: roundedDiagnostic(decision.diagnostics.impliedSpeedMps),
      accuracyAdjustedSpeedMps: roundedDiagnostic(decision.diagnostics.lowerBoundSpeedMps),
      trajectoryInnovationM: roundedDiagnostic(decision.diagnostics.predictionInnovationM),
      headingDeltaDeg: roundedDiagnostic(decision.diagnostics.headingDeltaDeg),
      motionState: decision.diagnostics.motionStateAfter,
      motionStateBefore: decision.diagnostics.motionStateBefore,
      windowCount: decision.diagnostics.windowCount,
      windowDurationMs: decision.diagnostics.windowDurationMs,
      cumulativeProgressM: roundedDiagnostic(decision.diagnostics.cumulativeProgressM),
      netProgressM: roundedDiagnostic(decision.diagnostics.netProgressM),
      progressRatio: roundedDiagnostic(decision.diagnostics.progressRatio),
      clusterRadiusM: roundedDiagnostic(decision.diagnostics.clusterRadiusM),
      directionVariabilityDeg: roundedDiagnostic(decision.diagnostics.directionVariabilityDeg),
      reportedSpeedContradiction: decision.diagnostics.reportedSpeedContradiction,
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
    fixCount: decision.candidateEvent.evidenceCount ?? decision.state.pending?.evidenceCount ?? 2,
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
  diagnosticWrites: Promise<void>[],
): Promise<any[]> {
  try {
    // Runtime require avoids a module-load cycle while still sharing the same
    // canonical writer, transaction, schema, and mutex as foreground points.
    // It also works in TaskManager's constrained headless CommonJS runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { appendBackgroundHikePoints, readActiveHikeTail } = require('./hikeTrackWriter');
    // Segment classification needs only the latest canonical evidence. Native
    // recovery reads a bounded journal suffix, never the full Activity per
    // background delivery batch.
    const tail = await readActiveHikeTail(context.clientActivityId, 2);
    // readActiveHikeTail is the journal adapter boundary: every downstream
    // consumer sees canonical `accuracy`, never the stored `acc` spelling.
    let previous = (tail[tail.length - 1] ?? null) as SegmentedTrackPoint | null;
    let activeSegmentId = previous?.segmentId ?? context.segmentId;
    let rawOrdinal = Math.max(
      0,
      Number(context.rawOrdinal) || 0,
      Number(tail[tail.length - 1]?.rawOrdinal) || 0,
    );
    let latestObservedTimestamp = previous?.t ?? context.acceptAfterMs - 1;
    const restoredTail = tail.slice(-2).map((point: any, index: number) => ({
            lat: point.lat,
            lng: point.lng,
            t: point.t,
            accuracy: point.accuracy,
            verticalAccuracy: point.verticalAccuracy,
            altitude: point.alt ?? null,
            speed: point.speed ?? null,
            speedAccuracy: point.speedAccuracy ?? null,
            course: point.course ?? null,
            courseAccuracy: point.courseAccuracy ?? null,
            source: point.source,
            observationId: point.observationId ?? (
              Number.isFinite(point.rawOrdinal)
                ? activityObservationEvidenceId({
                    clientActivityId: point.clientActivityId,
                    ownerGeneration: point.ownerGeneration,
                    rawOrdinal: Number(point.rawOrdinal),
                  })
                : `headless-restored-${index}-${point.t}`
            ),
            rawOrdinal: point.rawOrdinal,
            segmentId: point.segmentId ?? activeSegmentId,
          }));
    let continuity = restoreRealGpsContinuityState(context.continuityState, restoredTail);
    let previousRawDiagnostic: Pick<RealGpsObservation, 'lat' | 'lng' | 't'> | null =
      continuity.recentEligibleRaw[continuity.recentEligibleRaw.length - 1]
      ?? continuity.lastTrusted
      ?? null;
    const accepted: any[] = [];
    const classified: any[] = [];
    const observedOrdinals: number[] = [];
    for (const event of [...events].sort((a, b) => a.t - b.t)) {
      const receiptEvidenceId = event.receiptEvidenceId
        ?? `background:${Number.isFinite(event.t) ? Math.floor(event.t) : 'invalid'}:${nativeBatchSequence}:${event.nativeBatchIndex ?? 'unknown'}`;
      const recordPrefilterRejection = (reason: string, ordinalSemantics: string) => {
        if (Number.isFinite(event.t)) {
          diagnosticWrites.push(recordActivityDiagnosticDecision({
            ownerUserId: context.userId,
            clientActivityId: context.clientActivityId,
            observationTimeMs: Math.floor(event.t),
            accepted: false,
            reason,
            segmentId: activeSegmentId,
            receiptEvidenceId,
          }));
        }
        void recordActivityStageEvent({
          ownerUserId: context.userId,
          clientActivityId: context.clientActivityId,
          stage: 'observation-decision',
          evidenceId: receiptEvidenceId,
          details: {
            observationTimeMs: Number.isFinite(event.t) ? Math.floor(event.t) : null,
            receiptEvidenceId,
            prefilterDecision: 'REJECT',
            prefilterReason: reason,
            decision: 'REJECT',
            reason,
            decisionWallTimeMs: Date.now(),
            rawOrdinal: null,
            ordinalSemantics,
            nativeBatchSequence,
            nativeBatchIndex: event.nativeBatchIndex ?? null,
          },
        });
      };
      if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng) || !Number.isFinite(event.t)) {
        recordPrefilterRejection('invalid-coordinate-or-timestamp', 'not-allocated-invalid-prefilter');
        continue;
      }
      // Native providers may deliver an old queued batch after Resume.  A
      // generation timestamp is necessary but not sufficient: within one
      // generation samples must also be strictly chronological.
      if (event.t < context.acceptAfterMs) {
        recordPrefilterRejection('before-owner-generation', 'not-allocated-before-owner-prefilter');
        continue;
      }
      if (event.t <= latestObservedTimestamp) {
        recordPrefilterRejection('stale-or-equal-observation', 'not-allocated-stale-prefilter');
        continue;
      }
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
        speedAccuracy: event.speedAccuracy ?? null,
        courseAccuracy: event.courseAccuracy ?? null,
        source: 'background',
        observationId: activityObservationEvidenceId({
          clientActivityId: context.clientActivityId,
          ownerGeneration: context.ownerGeneration,
          rawOrdinal,
        }),
        rawOrdinal,
      };
      const dtFromPreviousRawMs = previousRawDiagnostic
        ? observation.t - previousRawDiagnostic.t
        : null;
      const displacementFromPreviousRawM = previousRawDiagnostic
        ? haversineM(previousRawDiagnostic, observation)
        : null;
      previousRawDiagnostic = observation;
      appendSimulatorLog('LOCATION', 'activity_observation_received_v2', {
        rawOrdinal,
        sampleSource: 'background',
        sampleTimestamp: observation.t,
        sequenceTimestamp: observation.t,
        dtFromPreviousRawMs,
        displacementFromPreviousRawM: roundedDiagnostic(displacementFromPreviousRawM),
        callbackDelayMs: Math.max(0, Date.now() - observation.t),
        horizontalAccuracyM: roundedDiagnostic(observation.accuracy),
        verticalAccuracyValid: observation.verticalAccuracy != null && observation.verticalAccuracy >= 0,
        verticalAccuracyM: roundedDiagnostic(observation.verticalAccuracy),
        reportedSpeedValid: observation.speed != null && observation.speed >= 0,
        reportedSpeedMps: observation.speed != null && observation.speed >= 0
          ? roundedDiagnostic(observation.speed)
          : null,
        reportedCourseValid: observation.course != null && observation.course >= 0,
        speedAccuracyMps: roundedDiagnostic(observation.speedAccuracy),
        courseAccuracyDeg: roundedDiagnostic(observation.courseAccuracy),
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
      diagnosticWrites.push(recordActivityDiagnosticDecision({
        ownerUserId: context.userId,
        clientActivityId: context.clientActivityId,
        observationTimeMs: observation.t,
        accepted: decision.kind === 'ACCEPT',
        reason: decision.reason,
        segmentId: activeSegmentId,
        receiptEvidenceId,
        observationId: observation.observationId,
        ownerGeneration: context.ownerGeneration,
        rawOrdinal,
      }));
      void recordActivityStageEvent({
        ownerUserId: context.userId,
        clientActivityId: context.clientActivityId,
        stage: 'observation-decision',
        evidenceId: observation.observationId,
        details: {
          observationTimeMs: observation.t,
          receiptEvidenceId: event.receiptEvidenceId ?? null,
          prefilterDecision: 'PASS',
          decision: decision.kind,
          reason: decision.reason,
          prefilterReason: null,
          decisionWallTimeMs: Date.now(),
          rawOrdinal,
          ordinalSemantics: 'allocated-in-headless-qualified-loop',
          nativeBatchSequence,
        },
      });
      if (decision.kind !== 'ACCEPT') {
        classified.push({
          ...event,
          observationId: observation.observationId,
          rawOrdinal,
          clientActivityId: context.clientActivityId,
          ownerGeneration: context.ownerGeneration,
          segmentId: activeSegmentId,
          canonicalDecision: decision.kind,
          decisionReason: decision.reason,
          continuityPreclassified: true,
          continuityStateAfter: continuity,
          diagnosticObservationRecorded: true,
          diagnosticDecisionRecorded: true,
        });
        continue;
      }
      const promotedCandidates = decision.confirmedCandidates
        ?? (decision.confirmedCandidate ? [decision.confirmedCandidate] : []);
      const canonicalObservations = [...promotedCandidates, observation];
      const promotedSourceEvents = new Map<string, any>();
      for (const promotedCandidate of promotedCandidates) {
        const existingPending = classified.findIndex(
          item => item.observationId === promotedCandidate.observationId,
        );
        if (existingPending >= 0) {
          promotedSourceEvents.set(
            promotedCandidate.observationId,
            classified[existingPending],
          );
          classified.splice(existingPending, 1);
        }
      }
      for (const canonicalObservation of canonicalObservations) {
        const promoted = canonicalObservation !== observation;
        void recordActivityStageEvent({
          ownerUserId: context.userId,
          clientActivityId: context.clientActivityId,
          stage: 'canonical-accepted',
          evidenceId: canonicalObservation.observationId,
          details: {
            observationTimeMs: canonicalObservation.t,
            decision: 'ACCEPT',
            reason: decision.reason,
            decisionWallTimeMs: Date.now(),
            rawOrdinal: canonicalObservation.rawOrdinal,
            ordinalSemantics: 'allocated-in-headless-qualified-loop',
            promotedCandidate: promoted,
            promotedByEvidenceId: promoted ? observation.observationId : null,
            nativeBatchSequence,
          },
        });
        const sourceEvent = canonicalObservation === observation
          ? event
          : promotedSourceEvents.get(canonicalObservation.observationId) ?? {
              t: canonicalObservation.t,
              lat: canonicalObservation.lat,
              lng: canonicalObservation.lng,
              acc: canonicalObservation.accuracy,
              alt: canonicalObservation.altitude ?? null,
              vAcc: canonicalObservation.verticalAccuracy ?? null,
              speed: canonicalObservation.speed ?? null,
              course: canonicalObservation.course ?? null,
              speedAccuracy: canonicalObservation.speedAccuracy ?? null,
              courseAccuracy: canonicalObservation.courseAccuracy ?? null,
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
          void recordActivityStageEvent({
            ownerUserId: context.userId,
            clientActivityId: context.clientActivityId,
            stage: 'segment-transition',
            wallTimeMs: Date.now(),
            details: {
              eventCode: 'ACTIVITY_SEGMENT_STARTED',
              decision: 'new-segment',
              reason: 'headless-continuity-classifier',
              source: 'background',
              activityMode: context.activityMode,
              intervalMs: previousTimestamp == null ? null : canonicalObservation.t - previousTimestamp,
              displacementM: previousDistanceM,
              previousSegmentId,
              nextSegmentId: activeSegmentId,
              ownerGenerationSuffix: context.ownerGeneration.slice(-8),
              continuityAllowed: false,
              distanceContributionM: 0,
            },
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
          diagnosticObservationRecorded: true,
          diagnosticDecisionRecorded: true,
        };
        if (promoted) {
          diagnosticWrites.push(recordActivityDiagnosticCanonicalPromotion({
            ownerUserId: context.userId,
            clientActivityId: context.clientActivityId,
            observationTimeMs: canonicalObservation.t,
            promotedByObservationTimeMs: observation.t,
            reason: 'candidate-confirmed',
            segmentId: activeSegmentId,
            receiptEvidenceId: sourceEvent.receiptEvidenceId ?? null,
            observationId: canonicalObservation.observationId,
            ownerGeneration: context.ownerGeneration,
            rawOrdinal: canonicalObservation.rawOrdinal,
          }));
        }
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
      void recordActivityStageEvent({
        ownerUserId: context.userId,
        clientActivityId: context.clientActivityId,
        stage: 'wal-committed',
        evidenceId: accepted[accepted.length - 1]?.observationId ?? null,
        details: {
          firstRawOrdinal: accepted[0]?.rawOrdinal ?? null,
          lastRawOrdinal: accepted[accepted.length - 1]?.rawOrdinal ?? null,
          acceptedCount: accepted.length,
          evidenceIds: accepted.map(point => point.observationId).filter(Boolean),
          nativeBatchSequence,
          commitWallTimeMs: Date.now(),
        },
      });
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
      // The Activity WAL is the shared source receipt. Encounter and Memory
      // receive separate durable intents from that receipt; either consumer
      // may fail without suppressing the other.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const encounter = require('../features/public/services/walkingEncounterEvidence');
        await encounter.recordWalkingEncounterObservations({
          ownerUserId: context.userId,
          source: 'activity_real',
          sourceActivityClientId: context.clientActivityId,
          observations: accepted.map(point => ({
            lat: point.lat,
            lng: point.lng,
            t: point.t,
            accuracy: point.acc ?? 25,
            sourceSegmentId: point.segmentId ?? 'legacy-0',
          })),
        });
      } catch (encounterError) {
        crashLogger.breadcrumb(`activity:bg_encounter_deferred ${String(encounterError).slice(0, 80)}`);
      }
      // Persist downstream responsibility immediately after the Activity WAL.
      // The projector owns Memory work independently, so this TaskManager
      // ingestion mutex is never held across Memory I/O.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const projector = require('../features/activity/activityMemoryProjector');
        await projector.scheduleActivityMemoryProjection({
          ownerUserId: context.userId,
          clientActivityId: context.clientActivityId,
          ownerGeneration: context.ownerGeneration,
          points: accepted.map(point => ({
            ...point,
            accuracy: point.acc ?? null,
            verticalAccuracy: point.vAcc ?? null,
          })),
        });
        void recordActivityStageEvent({
          ownerUserId: context.userId,
          clientActivityId: context.clientActivityId,
          stage: 'memory-responsibility',
          evidenceId: accepted[accepted.length - 1]?.observationId ?? null,
          details: {
            status: 'durable-intent',
            acceptedCount: accepted.length,
            nativeBatchSequence,
            responsibilityDurableAtMs: Date.now(),
          },
        });
        appendSimulatorLog('MEMORY_EVIDENCE', 'activity_background_memory_commit', {
          acceptedCount: accepted.length,
          nativeBatchSequence,
          committed: true,
          responsibility: 'durable-projection-intent',
        }, {
          userId: context.userId,
          clientActivityId: context.clientActivityId,
          qaSessionId: context.qaSessionId,
          coordinateSource: 'real',
          force: true,
        });
      } catch (memoryError) {
        crashLogger.breadcrumb(`activity:bg_memory_deferred ${String(memoryError).slice(0, 80)}`);
        appendSimulatorLog('ERROR', 'activity_background_memory_commit', {
          acceptedCount: accepted.length,
          nativeBatchSequence,
          committed: false,
          repairSource: 'activity-journal',
          errorCategory: String(memoryError).slice(0, 120),
        }, {
          userId: context.userId,
          clientActivityId: context.clientActivityId,
          qaSessionId: context.qaSessionId,
          coordinateSource: 'none',
          force: true,
        });
      }
    }
    const latestBatchReceipt = events.reduce<DurableSourceReceipt | null>((latest, event) => {
      if (!Number.isFinite(event.t) || !Number.isFinite(event.receiptWallTimeMs)) return latest;
      const candidate: DurableSourceReceipt = {
        observationTimeMs: Math.floor(event.t),
        receiptWallTimeMs: Math.floor(event.receiptWallTimeMs),
        source: 'background',
      };
      if (!latest
        || candidate.observationTimeMs > latest.observationTimeMs
        || (candidate.observationTimeMs === latest.observationTimeMs
          && candidate.receiptWallTimeMs > latest.receiptWallTimeMs)) return candidate;
      return latest;
    }, null);
    const previousReceipt = context.latestSourceReceipt;
    const latestSourceReceipt = !latestBatchReceipt
      ? previousReceipt ?? null
      : !previousReceipt
        || latestBatchReceipt.observationTimeMs > previousReceipt.observationTimeMs
        || (latestBatchReceipt.observationTimeMs === previousReceipt.observationTimeMs
          && latestBatchReceipt.receiptWallTimeMs > previousReceipt.receiptWallTimeMs)
        ? latestBatchReceipt
        : previousReceipt;
    await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify({
      ...context,
      segmentId: activeSegmentId,
      continuityState: continuity,
      rawOrdinal,
      latestSourceReceipt,
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
const handleBackgroundLocationTask = async ({ data, error }: { data: any; error: any }) => {
  const batchReceiptWallTimeMs = Date.now();
  const batchReceiptMonotonicTimeMs = activityStageMonotonicNow();
  const nativeBatchSequence = ++backgroundNativeBatchSequence;
  const diagnosticTarget: {
    current: { ownerUserId: string; clientActivityId: string; ownerGeneration: string } | null;
  } = { current: null };
  // Diagnostics stay outside the ownership/WAL mutex, but an opted-in cold
  // headless batch must join its own recovery/appends before the handler can
  // return (including an all-rejected batch with no canonical events).
  const diagnosticWrites: Promise<void>[] = [];
  let projectionWakeOwner: Parameters<ForegroundProjectionWake>[0] | null = null;
  let pendingSilenceGaps: DurableSilenceGap[] = [];
  const result = await withOwnershipBoundary(async () => {
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
  diagnosticTarget.current = {
    ownerUserId: context.userId,
    clientActivityId: context.clientActivityId,
    ownerGeneration: context.ownerGeneration,
  };
  // Close any prior no-callback interval before replacing the callback anchor.
  // Persist callback liveness independently of GPS validity and WAL success so
  // empty, stale and native-error deliveries remain distinguishable.
  pendingSilenceGaps = stageSilenceGapsForContext(context, batchReceiptWallTimeMs, 90_000);
  const validLocations = locations.filter(loc => (
    Number.isFinite(loc.timestamp)
    && Number.isFinite(loc.coords?.latitude)
    && Number.isFinite(loc.coords?.longitude)
  ));
  context.latestJsCallbackReceipt = {
    receiptWallTimeMs: batchReceiptWallTimeMs,
    source: 'background',
    batchSize: locations.length,
    validObservationCount: validLocations.length,
    errorDelivered: Boolean(error),
  };
  const latestValid = validLocations.reduce<{ timestamp: number } | null>((latest, loc) => (
    !latest || loc.timestamp > latest.timestamp ? { timestamp: Math.floor(loc.timestamp) } : latest
  ), null);
  if (latestValid) {
    const candidate: DurableSourceReceipt = {
      observationTimeMs: latestValid.timestamp,
      receiptWallTimeMs: batchReceiptWallTimeMs,
      source: 'background',
    };
    const prior = context.latestSourceReceipt;
    if (!prior || candidate.observationTimeMs > prior.observationTimeMs
      || (candidate.observationTimeMs === prior.observationTimeMs
        && candidate.receiptWallTimeMs > prior.receiptWallTimeMs)) {
      context.latestSourceReceipt = candidate;
    }
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context));
  } catch {
    // No durable callback evidence can be claimed if storage rejected it, but
    // the live callback may still safely continue into the canonical WAL.
  }
  void recordActivityStageEvent({
    ownerUserId: context.userId,
    clientActivityId: context.clientActivityId,
    stage: 'native-js-delivery',
    evidenceId: `background-callback:${nativeBatchSequence}`,
    wallTimeMs: batchReceiptWallTimeMs,
    monotonicTimeMs: batchReceiptMonotonicTimeMs,
    details: {
      source: 'task-manager',
      batchSize: locations.length,
      validObservationCount: validLocations.length,
      errorDelivered: Boolean(error),
      coordinatesIncluded: false,
    },
  });
  if (error) {
    try { debugLogger.logError(error, 'BackgroundLocationTask'); } catch { /* ignore */ }
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
    return;
  }
  const events: any[] = [];
  for (const [nativeBatchIndex, loc] of locations.entries()) {
    const sampleTimestamp = loc.timestamp || Date.now();
    const receiptEvidenceId = `background:${Math.floor(sampleTimestamp)}:${nativeBatchSequence}:${nativeBatchIndex}`;
    void recordActivityStageEvent({
      ownerUserId: context.userId,
      clientActivityId: context.clientActivityId,
      stage: 'observation-received',
      evidenceId: receiptEvidenceId,
      wallTimeMs: batchReceiptWallTimeMs,
      monotonicTimeMs: batchReceiptMonotonicTimeMs,
      details: {
        observationTimeMs: Math.floor(sampleTimestamp),
        source: 'background',
        callbackIdentity: 'task-manager-batch',
        nativeBatchSize: locations.length,
        nativeBatchSequence,
        nativeBatchIndex,
        appState: (AppState as any)?.currentState ?? 'unknown',
        ownerGenerationSuffix: context.ownerGeneration.slice(-8),
        horizontalAccuracyM: loc.coords.accuracy ?? null,
        speedMps: loc.coords.speed ?? null,
        speedAccuracyMps: loc.coords.speedAccuracy ?? null,
        qualifiedPuckPublication: 'HEADLESS_DEFERRED',
        visibleRenderTime: 'NOT_MEASURED',
      },
    });
    if (Number.isFinite(sampleTimestamp)
      && Number.isFinite(loc.coords.latitude)
      && Number.isFinite(loc.coords.longitude)) {
      diagnosticWrites.push(recordActivityDiagnosticObservation({
        ownerUserId: context.userId,
        clientActivityId: context.clientActivityId,
        observationTimeMs: Math.floor(sampleTimestamp),
        coordinate: {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          alt: loc.coords.altitude ?? null,
          accuracy: loc.coords.accuracy ?? null,
          verticalAccuracy: loc.coords.altitudeAccuracy ?? null,
          speed: loc.coords.speed ?? null,
          speedAccuracy: loc.coords.speedAccuracy ?? null,
          course: loc.coords.heading ?? null,
          courseAccuracy: loc.coords.courseAccuracy ?? null,
          source: 'background',
          callbackIdentity: 'task-manager-batch',
          nativeBatchSequence,
          nativeBatchIndex,
          appStateAtReceipt: (AppState as any)?.currentState ?? 'unknown',
          receiptWallTimeMs: batchReceiptWallTimeMs,
          receiptMonotonicTimeMs: batchReceiptMonotonicTimeMs,
          receiptEvidenceId,
          ownerGeneration: context.ownerGeneration,
        },
      }));
    }
    if (sampleTimestamp < (context.acceptAfterMs || 0)) {
      diagnosticWrites.push(recordActivityDiagnosticDecision({
        ownerUserId: context.userId,
        clientActivityId: context.clientActivityId,
        observationTimeMs: Math.floor(sampleTimestamp),
        accepted: false,
        reason: 'before-owner-generation',
        segmentId: context.segmentId,
        receiptEvidenceId,
      }));
      void recordActivityStageEvent({
        ownerUserId: context.userId,
        clientActivityId: context.clientActivityId,
        stage: 'observation-decision',
        evidenceId: receiptEvidenceId,
        details: {
          observationTimeMs: Math.floor(sampleTimestamp),
          decision: 'REJECT',
          reason: 'before-owner-generation',
          prefilterDecision: 'REJECT',
          prefilterReason: 'before-owner-generation',
          decisionWallTimeMs: Date.now(),
          rawOrdinal: null,
          ordinalSemantics: 'not-allocated-before-owner-prefilter',
        },
      });
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
      speedAccuracyMps: coords.speedAccuracy ?? null,
      courseValid: coords.heading != null && coords.heading >= 0,
      courseAccuracyDeg: coords.courseAccuracy ?? null,
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
      speedAccuracy: coords.speedAccuracy ?? null,
      courseAccuracy: coords.courseAccuracy ?? null,
      src: 'bg',
      conf: 1,
      receiptEvidenceId,
      receiptWallTimeMs: batchReceiptWallTimeMs,
      receiptMonotonicTimeMs: batchReceiptMonotonicTimeMs,
      nativeBatchSequence,
      nativeBatchIndex,
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
    const accepted = await appendDirectlyToHikeTrack(
      events,
      context,
      nativeBatchSequence,
      diagnosticWrites,
    );
    for (const point of accepted) {
      pendingBackgroundLocations.push({
        latitude: point.lat,
        longitude: point.lng,
        altitude: point.alt ?? null,
        accuracy: point.acc ?? null,
        altitudeAccuracy: point.vAcc ?? null,
        speed: point.speed ?? null,
        heading: point.course ?? null,
        speedAccuracy: point.speedAccuracy ?? null,
        courseAccuracy: point.courseAccuracy ?? null,
        timestamp: point.t,
        clientActivityId: point.clientActivityId,
        ownerGeneration: point.ownerGeneration,
        segmentId: point.segmentId,
        segmentStartReason: point.segmentStartReason,
        rawOrdinal: point.rawOrdinal,
        observationId: point.observationId,
        continuityPreclassified: true,
        canonicalDecision: point.canonicalDecision,
        decisionReason: point.decisionReason,
        continuityStateAfter: point.continuityStateAfter,
        receiptWallTimeMs: point.receiptWallTimeMs ?? batchReceiptWallTimeMs,
        receiptMonotonicTimeMs: point.receiptMonotonicTimeMs ?? batchReceiptMonotonicTimeMs,
        callbackIdentity: 'task-manager-batch',
        nativeBatchSequence,
        nativeBatchIndex: point.nativeBatchIndex,
        appStateAtReceipt: 'background',
        diagnosticObservationRecorded: point.diagnosticObservationRecorded === true,
        diagnosticDecisionRecorded: point.diagnosticDecisionRecorded === true,
      });
    }
    projectionWakeOwner = {
      ownerUserId: context.userId,
      clientActivityId: context.clientActivityId,
      ownerGeneration: context.ownerGeneration,
      receiptWallTimeMs: batchReceiptWallTimeMs,
    };
    crashLogger.breadcrumb(`k10:path_b_write n=${accepted.length}`);
    // QA diagnostics must never extend the Activity ownership boundary. The
    // logger owns its bounded/write-serialized best effort independently;
    // canonical WAL and the foreground handoff are already durable here.
    void flushSimulatorLogs(context.userId).catch(() => undefined);
  } catch (e: any) {
    crashLogger.breadcrumb(`k10:path_b_err ${String(e?.message || e).slice(0, 60)}`);
  }
  });
  if (diagnosticTarget.current) {
    await persistPendingDurableSilenceGapEvents({
      ownerUserId: diagnosticTarget.current.ownerUserId,
      gaps: pendingSilenceGaps,
      trigger: 'task-receipt',
      clientActivityId: diagnosticTarget.current.clientActivityId,
      ownerGeneration: diagnosticTarget.current.ownerGeneration,
    }).catch(() => 0);
  }
  // The native ownership/WAL transaction has already completed. Persist one
  // partial diagnostic chunk per delivered native batch outside that mutex so
  // a headless runtime can terminate without losing the opted-in raw suffix,
  // while Finish and the next callback never wait behind diagnostic I/O.
  if (diagnosticTarget.current) {
    await Promise.allSettled(diagnosticWrites);
    await flushActivityDiagnosticReplay(
      diagnosticTarget.current.ownerUserId,
      diagnosticTarget.current.clientActivityId,
    ).catch(() => undefined);
  }
  if (projectionWakeOwner && (AppState as any)?.currentState === 'active') {
    try { foregroundProjectionWake?.(projectionWakeOwner); } catch { /* latency hint only */ }
  }
  return result;
};

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

export type ActivityBackgroundStartupReconciliation =
  | 'web-not-applicable'
  | 'preserved-active-owner'
  | 'orphan-stopped'
  | 'already-stopped'
  | 'superseded'
  | 'native-unavailable';

/**
 * Storage inspection is serialized with Start/Finish, but native calls are
 * deliberately outside that mutex. A hung CoreLocation Promise can therefore
 * never imprison a fresh durable Start. Immutable command epochs and a final
 * lease recheck either cancel the orphan cleanup or compensate a late stop.
 */
export async function reconcileActivityBackgroundTaskOnStartup(nativeAdapter?: {
  isTaskDefined: (taskName: string) => boolean;
  hasStarted: (taskName: string) => Promise<boolean>;
  stop: (taskName: string) => Promise<void>;
}): Promise<ActivityBackgroundStartupReconciliation> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'web-not-applicable';
  const readOwner = () => withOwnershipBoundary(async () => {
    const [active, sessionId, encoded] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_HIKE_ACTIVE),
      AsyncStorage.getItem(STORAGE_KEY_SESSION),
      AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_CONTEXT),
    ]);
    let context: DurableActivityContext | null = null;
    try { context = encoded ? JSON.parse(encoded) as DurableActivityContext : null; } catch { context = null; }
    return {
      valid: active === '1'
        && !!sessionId
        && context?.clientActivityId === sessionId
        && !!context.userId
        && !!context.ownerGeneration
        && !!context.segmentId,
    };
  });
  const boundedNative = async <T>(work: Promise<T>): Promise<{
    status: 'settled'; value: T;
  } | { status: 'failed' | 'timeout' }> => new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ status: 'timeout' });
    }, 2_000);
    work.then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: 'settled', value });
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: 'failed' });
    });
  });
  try {
    const initial = await readOwner();
    if (initial.valid) return 'preserved-active-owner';
    const commandEpoch = durableOwnershipCommandEpoch;
    const adapter = nativeAdapter ?? await (async () => {
      const Location = await import('expo-location');
      const TaskManager = await import('expo-task-manager');
      return {
        isTaskDefined: (taskName: string) => TaskManager.isTaskDefined(taskName),
        hasStarted: (taskName: string) => Location.hasStartedLocationUpdatesAsync(taskName),
        stop: (taskName: string) => Location.stopLocationUpdatesAsync(taskName),
      };
    })();
    if (!adapter.isTaskDefined(BACKGROUND_LOCATION_TASK)) return 'already-stopped';
    const probeWork = adapter.hasStarted(BACKGROUND_LOCATION_TASK);
    const probe = await boundedNative(probeWork);
    if (probe.status !== 'settled') return 'native-unavailable';
    if (!probe.value) return 'already-stopped';
    const beforeStop = await readOwner();
    if (beforeStop.valid) return 'preserved-active-owner';
    if (commandEpoch !== durableOwnershipCommandEpoch) return 'superseded';

    const stopWork = adapter.stop(BACKGROUND_LOCATION_TASK);
    const stop = await boundedNative(stopWork);
    if (stop.status === 'timeout') {
      void stopWork.then(async () => {
        if ((await readOwner()).valid) startupOrphanMutationWake?.();
      }).catch(() => undefined);
      return 'native-unavailable';
    }
    if (stop.status === 'failed') return 'native-unavailable';
    const afterStop = await readOwner();
    if (afterStop.valid) {
      startupOrphanMutationWake?.();
      return 'preserved-active-owner';
    }
    return 'orphan-stopped';
  } catch {
    return 'native-unavailable';
  }
}
