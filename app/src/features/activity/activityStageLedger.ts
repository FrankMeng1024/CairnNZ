import { storage } from '../../store/storage';
import { applySnapLabDiagnosticWriteDelay } from '../activitySimulator/snapLabFaultInjection';
import { recordActivityDiagnosticReplayEvent } from './activityDiagnosticReplay';

export type ActivityStage =
  | 'activity-start'
  | 'lifecycle'
  | 'health-heartbeat'
  | 'native-callback'
  | 'native-js-delivery'
  | 'observation-received'
  | 'observation-decision'
  | 'canonical-accepted'
  | 'wal-committed'
  | 'store-published'
  | 'segment-transition'
  | 'presentation'
  | 'memory-responsibility'
  | 'memory-local-commit'
  | 'provider-state'
  | 'final-job'
  | 'final-selected'
  | 'completion-presented'
  | 'detail-selected'
  | 'sync-state';

export type ActivityEvidenceCompleteness = 'complete' | 'partial' | 'not-observable-current-binary';

export interface ActivityObservabilitySummary {
  stageCounts: Partial<Record<ActivityStage, number>>;
  frontiers: Partial<Record<ActivityStage, {
    count: number;
    lastWallTimeMs: number;
    lastEvidenceId: string | null;
  }>>;
  evidenceCompleteness: {
    nativeCallback: ActivityEvidenceCompleteness;
    nativeToJsCorrelation: ActivityEvidenceCompleteness;
    jsIntake: ActivityEvidenceCompleteness;
    acceptanceDecision: ActivityEvidenceCompleteness;
    walDurability: ActivityEvidenceCompleteness;
    canonicalStore: ActivityEvidenceCompleteness;
    livePublication: ActivityEvidenceCompleteness;
    networkSync: ActivityEvidenceCompleteness;
  };
  pipelineFindings: {
    nativeCallbacksWithoutJsDelivery: number;
    jsReceiptsWithoutDecision: number;
    jsReceiptDecisionCorrelation: 'complete' | 'missing-decision' | 'unknown-retention-truncated';
    rejectedByFiltering: number;
    canonicalAcceptsWithoutWal: number;
    walCommitsWithoutStorePublication: number;
    storePublicationsWithoutPresentationEvidence: number;
    locallyCompleteWithoutUploadAck: boolean;
    refinementUnavailable: boolean;
  };
  timing: {
    maximumObservationReceiptLagMs: number | null;
    maximumWalToStoreLagMs: number | null;
    longestJsReceiptGapMs: number | null;
    longestObservationTimestampGapMs: number | null;
  };
  longObservationGaps: Array<{
    /** Gap between JavaScript receipt clocks. This is not a GPS measurement gap. */
    durationMs: number;
    receiptGapDurationMs: number;
    /** Gap between original provider observation timestamps, when both exist. */
    observationTimestampGapMs: number | null;
    fromWallTimeMs: number;
    toWallTimeMs: number;
    heartbeatCount: number;
    /** Exact overlap with retained Pause -> Resume intervals, never an estimate. */
    intentionalInactiveDurationMs: number | null;
    /** Whether retained lifecycle boundaries explain none, part, or all of the gap. */
    pauseEvidenceCompleteness: 'none' | 'partial' | 'complete' | 'unknown';
    conclusion:
      | 'recording-source-intentionally-inactive'
      | 'no-js-callback-native-cause-unknown'
      | 'js-runtime-not-observed'
      | 'none';
  }>;
  interpretationLimits: string[];
}

export interface ActivityStageLedgerEvent {
  schema: 'cairn-activity-stage-ledger';
  version: 1;
  eventId: string;
  ownerUserId: string;
  clientActivityId: string;
  stage: ActivityStage;
  wallTimeMs: number;
  monotonicTimeMs: number | null;
  processOriginWallTimeMs: number | null;
  processId: string;
  evidenceId?: string | null;
  details: Record<string, unknown>;
}

export interface ActivityStageLedgerExport {
  schema: 'cairn-activity-stage-ledger-export';
  version: 1;
  exportedAt: string;
  ownerUserId: string;
  clientActivityId: string | null;
  installedIdentity: ReturnType<typeof installedIdentity>;
  privacy: {
    localOnly: true;
    coordinatesIncluded: false;
    automaticUpload: false;
    automaticTierASummaryMirror: true;
  };
  presentationMeasurement: 'REACT_COMMIT_NOT_NATIVE_FRAME';
  diagnosticCompleteness: {
    persistence: 'complete' | 'partial';
    summaryAvailable: boolean;
    pendingEventCount: number;
    failedWriteCount: number;
    droppedEventCount: number;
    retentionTruncated: boolean;
    waitTimedOut: boolean;
    requiredStagesPresent: boolean;
    missingRequiredStages: ActivityStage[];
  };
  phaseSummary: ActivityStagePhaseSummary | null;
  observability: ActivityObservabilitySummary;
  resourceSummary: ActivityResourceSummary;
  events: ActivityStageLedgerEvent[];
}

export interface ActivityResourceSummary {
  semantics: 'JS_OBSERVED_RESOURCE_PROXY_NOT_BATTERY_MEASUREMENT';
  coverage: { startWallTimeMs: number | null; endWallTimeMs: number | null };
  counters: {
    jsLocationReceipts: number;
    acceptanceDecisions: number;
    canonicalAccepts: number;
    walCommitEvents: number;
    storePublicationEvents: number;
    segmentTransitions: number;
    providerTransitions: number;
    lifecycleTransitions: number;
    syncEvents: number;
    presentationMilestones: number;
  };
  logging: {
    logicalStageFacts: number;
    persistedEventRecords: number;
    coalescedFacts: number;
    approximateEventBytes: number;
  };
  latestHeartbeat: Record<string, unknown> | null;
  instrumentation: {
    nativeEnergyMeasured: false;
    visibleMapPixelsMeasured: false;
    nativeLocationReleaseVerified: false;
    notes: string[];
  };
}

export interface ActivityStagePhaseSummary {
  clientActivityId: string;
  capturedEventCount: number;
  firstWallTimeMs: number;
  lastWallTimeMs: number;
  stages: Partial<Record<ActivityStage, {
    count: number;
    firstWallTimeMs: number;
    lastWallTimeMs: number;
  }>>;
}

const ROOT = '@cairn:activity-stage-ledger:v1:';
const QA_ROOT = '@cairn:snap_lab:activity-stage-ledger:v1:';
const MAX_EVENTS_PER_ACTIVITY = 1_200;
const MAX_ACTIVITIES_PER_OWNER = 3;
const MAX_BUFFERED_EVENTS_PER_OWNER = 512;
const WRITE_BATCH_SIZE = 32;
const QA_WRITE_BATCH_SIZE = 1;
const EXPORT_WAIT_MS = 750;
const ROUTINE_WINDOW_SIZE = 32;
const META_ROOT = '@cairn:activity-stage-ledger-meta:v1:';
const QA_META_ROOT = '@cairn:snap_lab:activity-stage-ledger-meta:v1:';
export type ActivityStageLedgerRealm = 'production' | 'snap-lab';
const processMonotonicOrigin = typeof globalThis.performance?.now === 'function'
  ? Date.now() - globalThis.performance.now()
  : null;
const processId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let eventSequence = 0;
const trimTails = new Map<string, Promise<void>>();

interface RoutineStageBucket {
  ownerUserId: string;
  clientActivityId: string;
  stage: ActivityStage;
  count: number;
  firstWallTimeMs: number | null;
  lastWallTimeMs: number | null;
  firstMonotonicTimeMs: number | null;
  lastMonotonicTimeMs: number | null;
  firstEvidenceId: string | null;
  lastEvidenceId: string | null;
  latestDetails: Record<string, unknown>;
  numericTotals: Record<string, number>;
  numericMaxima: Record<string, number>;
}

const routineBuckets = new Map<string, RoutineStageBucket>();
const ROUTINE_STAGES = new Set<ActivityStage>([
  'observation-received',
  'canonical-accepted',
  'wal-committed',
  'store-published',
  'memory-responsibility',
  'memory-local-commit',
]);
const ROUTINE_TOTAL_FIELDS = new Set([
  'acceptedCount', 'inputCount', 'rejectedCount', 'deduplicatedCount', 'writeCount', 'bytes',
]);
const ROUTINE_MAX_FIELDS = new Set([
  'journalCommitLatencyMs', 'walToStoreLatencyMs', 'responsibilityToCommitLatencyMs', 'durationMs',
]);

interface BufferedLedgerEvent {
  key: string;
  event: ActivityStageLedgerEvent;
}

interface OwnerWriterState {
  queue: BufferedLedgerEvent[];
  inFlight: BufferedLedgerEvent[];
  failedEvents: BufferedLedgerEvent[];
  pump: Promise<void> | null;
  pumpScheduled: boolean;
  failedWriteCount: number;
  droppedEventCount: number;
  retentionTruncated: boolean;
  summaries: ActivityStagePhaseSummary[];
  metaLoaded: boolean;
  metaPersisted: boolean;
  metaReadFailed: boolean;
  metaWriteFailed: boolean;
  metaTail: Promise<void> | null;
  metaDirty: boolean;
  eventsSinceMetaPersist: number;
  eventsSinceTrim: number;
  purging: boolean;
}

interface PersistedOwnerMeta {
  schema: 'cairn-activity-stage-ledger-meta';
  version: 1;
  failedWriteCount: number;
  droppedEventCount: number;
  retentionTruncated: boolean;
  summaries: ActivityStagePhaseSummary[];
}

const ownerWriters = new Map<string, OwnerWriterState>();
const realmForActivity = (clientActivityId: string): ActivityStageLedgerRealm => (
  clientActivityId.startsWith('qa-snap-') ? 'snap-lab' : 'production'
);
const writerKey = (ownerUserId: string, realm: ActivityStageLedgerRealm) => `${realm}:${ownerUserId}`;

function writerState(ownerUserId: string, realm: ActivityStageLedgerRealm = 'production'): OwnerWriterState {
  const key = writerKey(ownerUserId, realm);
  const existing = ownerWriters.get(key);
  if (existing) return existing;
  const created: OwnerWriterState = {
    queue: [],
    inFlight: [],
    failedEvents: [],
    pump: null,
    pumpScheduled: false,
    failedWriteCount: 0,
    droppedEventCount: 0,
    retentionTruncated: false,
    summaries: [],
    metaLoaded: false,
    metaPersisted: false,
    metaReadFailed: false,
    metaWriteFailed: false,
    metaTail: null,
    metaDirty: false,
    eventsSinceMetaPersist: 0,
    eventsSinceTrim: 0,
    purging: false,
  };
  ownerWriters.set(key, created);
  return created;
}

function encoded(value: string): string { return encodeURIComponent(value); }
function activityPrefix(ownerUserId: string, clientActivityId: string, realm: ActivityStageLedgerRealm): string {
  const root = realm === 'snap-lab' ? QA_ROOT : ROOT;
  return `${root}${encoded(ownerUserId)}:${encoded(clientActivityId)}:`;
}
function ownerPrefix(ownerUserId: string, realm: ActivityStageLedgerRealm = 'production'): string {
  return `${realm === 'snap-lab' ? QA_ROOT : ROOT}${encoded(ownerUserId)}:`;
}
function metaKey(ownerUserId: string, realm: ActivityStageLedgerRealm = 'production'): string {
  return `${realm === 'snap-lab' ? QA_META_ROOT : META_ROOT}${encoded(ownerUserId)}`;
}

export function activityStageMonotonicNow(): number | null {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : null;
}

function installedIdentity() {
  let nativeApplicationVersion: string | null = null;
  let nativeBuildVersion: string | null = null;
  let applicationId: string | null = null;
  let updateId: string | null = null;
  let runtimeVersion: string | null = null;
  let channel: string | null = null;
  let updateGroup: string | null = null;
  let updateFingerprint: string | null = null;
  let isEmbeddedLaunch: boolean | null = null;
  let isEmergencyLaunch: boolean | null = null;
  try {
    // Headless/test runtimes may not install the native module. Identity is
    // optional evidence and must never prevent Activity recording.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Application = require('expo-application');
    nativeApplicationVersion = Application.nativeApplicationVersion ?? null;
    nativeBuildVersion = Application.nativeBuildVersion ?? null;
    applicationId = Application.applicationId ?? null;
  } catch { /* native identity unavailable */ }
  try {
    // Dynamic loading keeps headless and Jest runtimes usable when Updates is
    // intentionally absent. These are installed-binary facts, never source-HEAD claims.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require('expo-updates');
    updateId = Updates.updateId ?? null;
    runtimeVersion = Updates.runtimeVersion ?? null;
    channel = Updates.channel ?? null;
    const manifest = Updates.manifest as Record<string, any> | null | undefined;
    updateGroup = manifest?.metadata?.updateGroup ?? manifest?.extra?.updateGroup ?? null;
    updateFingerprint = manifest?.metadata?.fingerprint ?? manifest?.extra?.fingerprint ?? null;
    isEmbeddedLaunch = typeof Updates.isEmbeddedLaunch === 'boolean' ? Updates.isEmbeddedLaunch : null;
    isEmergencyLaunch = typeof Updates.isEmergencyLaunch === 'boolean' ? Updates.isEmergencyLaunch : null;
  } catch { /* installed native runtime may not expose expo-updates */ }
  return {
    nativeApplicationVersion,
    nativeBuildVersion,
    applicationId,
    updateId,
    runtimeVersion,
    channel,
    updateGroup,
    updateFingerprint,
    isEmbeddedLaunch,
    isEmergencyLaunch,
  };
}

function privacySafeDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 64).map(privacySafeDetails);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/(?:pk|sk)\.[A-Za-z0-9._-]+/gi, '[REDACTED_TOKEN]')
      .replace(/([?&]access_token=)[^&\s]+/gi, '$1[REDACTED_TOKEN]')
      .slice(0, 180);
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (normalized === 'lat' || normalized === 'latitude'
      || normalized === 'lng' || normalized === 'lon' || normalized === 'longitude'
      || normalized.includes('coordinate') || normalized.includes('token')) continue;
    result[key] = privacySafeDetails(child);
  }
  return result;
}

function logicalFactCount(event: ActivityStageLedgerEvent): number {
  const count = Number(event.details.logicalEventCount ?? 1);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
}

function routineBucketKey(ownerUserId: string, clientActivityId: string, stage: ActivityStage): string {
  return `${ownerUserId}\u0000${clientActivityId}\u0000${stage}`;
}

function shouldCoalesceRoutine(input: {
  clientActivityId: string;
  stage: ActivityStage;
  details?: Record<string, unknown>;
}): boolean {
  if (realmForActivity(input.clientActivityId) !== 'production') return false;
  if (ROUTINE_STAGES.has(input.stage)) {
    if (input.stage === 'canonical-accepted' && input.details?.promotedCandidate === true) return false;
    if (input.stage === 'memory-responsibility') {
      const status = String(input.details?.status ?? '');
      return status !== 'wal-discovery-required';
    }
    return true;
  }
  if (input.stage !== 'observation-decision') return false;
  const decision = String(input.details?.decision ?? '').toUpperCase();
  return decision === 'ACCEPT' || decision === 'ACCEPTED';
}

function summarizeRoutineNumbers(bucket: RoutineStageBucket, details: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(details)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (ROUTINE_TOTAL_FIELDS.has(key)) {
      bucket.numericTotals[key] = (bucket.numericTotals[key] ?? 0) + value;
    }
    if (ROUTINE_MAX_FIELDS.has(key)) {
      bucket.numericMaxima[key] = Math.max(bucket.numericMaxima[key] ?? Number.NEGATIVE_INFINITY, value);
    }
  }
}

async function ledgerGetItem(key: string, realm: ActivityStageLedgerRealm): Promise<string | null> {
  void realm;
  return storage.getItemStrict(key);
}

async function ledgerSetItem(
  key: string,
  value: string,
  realm: ActivityStageLedgerRealm,
): Promise<void> {
  void realm;
  await storage.setItem(key, value, { strict: true });
}

async function strictKeys(realm: ActivityStageLedgerRealm): Promise<string[]> {
  void realm;
  return typeof storage.getAllKeysStrict === 'function' ? storage.getAllKeysStrict() : [];
}

async function ledgerRemoveItems(keys: string[], realm: ActivityStageLedgerRealm): Promise<void> {
  void realm;
  await storage.removeItemsStrict(keys);
}

function validPhaseSummary(value: any): value is ActivityStagePhaseSummary {
  return !!value
    && typeof value.clientActivityId === 'string'
    && Number.isFinite(value.capturedEventCount)
    && Number.isFinite(value.firstWallTimeMs)
    && Number.isFinite(value.lastWallTimeMs)
    && !!value.stages
    && typeof value.stages === 'object';
}

function validOwnerMeta(value: any): value is PersistedOwnerMeta {
  return value?.schema === 'cairn-activity-stage-ledger-meta'
    && value.version === 1
    && Number.isFinite(value.failedWriteCount)
    && Number.isFinite(value.droppedEventCount)
    && typeof value.retentionTruncated === 'boolean'
    && Array.isArray(value.summaries)
    && value.summaries.every(validPhaseSummary);
}

async function ensureOwnerMetaLoaded(ownerUserId: string, state: OwnerWriterState, realm: ActivityStageLedgerRealm): Promise<void> {
  if (state.metaLoaded) return;
  let persisted: PersistedOwnerMeta | null = null;
  try {
    const raw = await ledgerGetItem(metaKey(ownerUserId, realm), realm);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (validOwnerMeta(parsed)) persisted = parsed;
      else state.metaReadFailed = true;
    }
  } catch {
    state.metaReadFailed = true;
  }
  if (persisted) {
    state.failedWriteCount += Math.max(0, Math.floor(persisted.failedWriteCount));
    state.droppedEventCount += Math.max(0, Math.floor(persisted.droppedEventCount));
    state.retentionTruncated = state.retentionTruncated || persisted.retentionTruncated;
    state.summaries = persisted.summaries
      .slice()
      .sort((left, right) => left.lastWallTimeMs - right.lastWallTimeMs)
      .slice(-MAX_ACTIVITIES_PER_OWNER);
    state.metaPersisted = true;
  }
  state.metaLoaded = true;
}

function summarizeCapturedEvent(state: OwnerWriterState, event: ActivityStageLedgerEvent): void {
  const logicalCount = logicalFactCount(event);
  let summary = state.summaries.find(item => item.clientActivityId === event.clientActivityId);
  if (!summary) {
    summary = {
      clientActivityId: event.clientActivityId,
      capturedEventCount: 0,
      firstWallTimeMs: event.wallTimeMs,
      lastWallTimeMs: event.wallTimeMs,
      stages: {},
    };
    state.summaries.push(summary);
  }
  summary.capturedEventCount += logicalCount;
  summary.firstWallTimeMs = Math.min(summary.firstWallTimeMs, event.wallTimeMs);
  summary.lastWallTimeMs = Math.max(summary.lastWallTimeMs, event.wallTimeMs);
  const stage = summary.stages[event.stage];
  summary.stages[event.stage] = stage ? {
    count: stage.count + logicalCount,
    firstWallTimeMs: Math.min(stage.firstWallTimeMs, event.wallTimeMs),
    lastWallTimeMs: Math.max(stage.lastWallTimeMs, event.wallTimeMs),
  } : {
    count: logicalCount,
    firstWallTimeMs: event.wallTimeMs,
    lastWallTimeMs: event.wallTimeMs,
  };
  state.summaries.sort((left, right) => left.lastWallTimeMs - right.lastWallTimeMs);
  if (state.summaries.length > MAX_ACTIVITIES_PER_OWNER) {
    state.summaries.splice(0, state.summaries.length - MAX_ACTIVITIES_PER_OWNER);
  }
}

function ownerMetaSnapshot(state: OwnerWriterState): PersistedOwnerMeta {
  return {
    schema: 'cairn-activity-stage-ledger-meta',
    version: 1,
    failedWriteCount: state.failedWriteCount,
    droppedEventCount: state.droppedEventCount,
    retentionTruncated: state.retentionTruncated,
    summaries: state.summaries.slice(-MAX_ACTIVITIES_PER_OWNER),
  };
}

async function persistOwnerMeta(ownerUserId: string, state: OwnerWriterState, realm: ActivityStageLedgerRealm): Promise<void> {
  const previous = state.metaTail?.catch(() => undefined) ?? Promise.resolve();
  let run!: Promise<void>;
  run = previous.then(async () => {
    const meta = ownerMetaSnapshot(state);
    try {
      await ledgerSetItem(metaKey(ownerUserId, realm), JSON.stringify(meta), realm);
      state.metaPersisted = true;
      state.metaWriteFailed = false;
      state.metaDirty = false;
      state.eventsSinceMetaPersist = 0;
    } catch {
      state.metaWriteFailed = true;
    }
  }).finally(() => {
    if (state.metaTail === run) state.metaTail = null;
  });
  state.metaTail = run;
  await run;
}

async function trimOwner(
  ownerUserId: string,
  realm: ActivityStageLedgerRealm,
  state: OwnerWriterState,
): Promise<number> {
  const prefix = ownerPrefix(ownerUserId, realm);
  const keys = (await strictKeys(realm)).filter(key => key.startsWith(prefix)).sort();
  const byActivity = new Map<string, string[]>();
  for (const key of keys) {
    const remainder = key.slice(prefix.length);
    const separator = remainder.indexOf(':');
    if (separator < 0) continue;
    const activity = remainder.slice(0, separator);
    const activityKeys = byActivity.get(activity) ?? [];
    activityKeys.push(key);
    byActivity.set(activity, activityKeys);
  }
  const summaryTime = new Map(state.summaries.map(summary => (
    [summary.clientActivityId, summary.lastWallTimeMs]
  )));
  const ordered = [...byActivity.entries()].sort((left, right) => (
    (summaryTime.get(right[0]) ?? 0) - (summaryTime.get(left[0]) ?? 0)
  ));
  const remove = ordered.flatMap(([_, activityKeys], activityIndex) => {
    if (activityIndex >= MAX_ACTIVITIES_PER_OWNER) return activityKeys;
    return activityKeys.slice(0, Math.max(0, activityKeys.length - MAX_EVENTS_PER_ACTIVITY));
  });
  if (remove.length > 0) await ledgerRemoveItems(remove, realm);
  return remove.length;
}

function scheduleTrim(
  ownerUserId: string,
  state: OwnerWriterState,
  realm: ActivityStageLedgerRealm,
  force = false,
): void {
  state.eventsSinceTrim += 1;
  if (!force && state.eventsSinceTrim < 64) return;
  state.eventsSinceTrim = 0;
  const key = writerKey(ownerUserId, realm);
  const previous = trimTails.get(key)?.catch(() => undefined) ?? Promise.resolve();
  const next = previous.then(async () => {
    await settleOwnerWriter(ownerUserId, realm);
    const state = writerState(ownerUserId, realm);
    await ensureOwnerMetaLoaded(ownerUserId, state, realm);
    const removed = await trimOwner(ownerUserId, realm, state);
    if (removed > 0) {
      state.retentionTruncated = true;
      await persistOwnerMeta(ownerUserId, state, realm);
    }
  }).catch(() => undefined);
  trimTails.set(key, next);
  void next.finally(() => {
    if (trimTails.get(key) === next) trimTails.delete(key);
  });
}

function scheduleOwnerPump(
  ownerUserId: string,
  state: OwnerWriterState,
  realm: ActivityStageLedgerRealm,
  runNow = false,
): void {
  if (state.pump || state.purging || state.queue.length === 0) return;
  // AsyncStorage's Web adapter ultimately performs synchronous localStorage
  // work. Starting that work inline from a Snap Lab observation made the
  // supposedly fire-and-forget diagnostic boundary consume the GPS callback
  // that enqueued it. Defer only the isolated QA realm to a host task; native
  // and production persistence semantics are unchanged. Explicit flush/export
  // calls pass runNow so durability remains a real, awaited storage boundary.
  if (realm === 'snap-lab' && !runNow) {
    if (state.pumpScheduled) return;
    state.pumpScheduled = true;
    setTimeout(() => {
      state.pumpScheduled = false;
      scheduleOwnerPump(ownerUserId, state, realm, true);
    }, 0);
    return;
  }
  const pump = (async () => {
    await ensureOwnerMetaLoaded(ownerUserId, state, realm);
    while (!state.purging && state.queue.length > 0) {
      const batch = state.queue.splice(
        0,
        realm === 'snap-lab' ? QA_WRITE_BATCH_SIZE : WRITE_BATCH_SIZE,
      );
      state.inFlight = batch;
      batch.forEach(item => summarizeCapturedEvent(state, item.event));
      state.metaDirty = true;
      state.eventsSinceMetaPersist += batch.length;
      if (realm === 'snap-lab' && state.summaries.some(summary => (
        summary.capturedEventCount > MAX_EVENTS_PER_ACTIVITY
      ))) state.retentionTruncated = true;
      const results = await Promise.allSettled(batch.map(async item => {
        if (realm === 'snap-lab') {
          // The acceptance lab can make this real lower storage boundary slow.
          // recordActivityStageEvent remains fire-and-forget, so a diagnostic
          // backlog must not delay canonical WAL/store publication.
          await applySnapLabDiagnosticWriteDelay(item.event.clientActivityId);
        }
        await ledgerSetItem(item.key, JSON.stringify(item.event), realm);
      }));
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') return;
        state.failedWriteCount += 1;
        state.failedEvents.push(batch[index]);
      });
      if (state.failedEvents.length > MAX_BUFFERED_EVENTS_PER_OWNER) {
        const excess = state.failedEvents.length - MAX_BUFFERED_EVENTS_PER_OWNER;
        state.failedEvents.splice(0, excess);
        state.droppedEventCount += excess;
      }
      state.inFlight = [];
      const metaFence = batch.some(item => (
        item.event.stage === 'activity-start' || item.event.stage === 'completion-presented'
      ));
      if (realm === 'production'
        || !state.metaPersisted
        || state.eventsSinceMetaPersist >= 16
        || metaFence
        || results.some(result => result.status === 'rejected')) {
        await persistOwnerMeta(ownerUserId, state, realm);
      }
      if (realm === 'snap-lab' && state.queue.length > 0) {
        // Web AsyncStorage is synchronous localStorage under an async API.
        // Promise resolution alone stays in the same browser task, so a
        // backed-up acceptance ledger could otherwise drain hundreds of
        // writes as one visible multi-hundred-ms task. Preserve real writes
        // and ordering, but cooperatively yield between bounded QA batches.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
  })().finally(() => {
    if (state.pump === pump) state.pump = null;
    if (!state.purging && state.queue.length > 0) scheduleOwnerPump(ownerUserId, state, realm, true);
  });
  state.pump = pump;
}

async function settleOwnerWriter(ownerUserId: string, realm: ActivityStageLedgerRealm): Promise<void> {
  const state = ownerWriters.get(writerKey(ownerUserId, realm));
  if (!state) return;
  scheduleOwnerPump(ownerUserId, state, realm, true);
  while (state.pump) await state.pump;
  if (state.metaDirty) await persistOwnerMeta(ownerUserId, state, realm);
  if (state.metaTail) await state.metaTail;
}

async function waitBounded<T>(promise: Promise<T>, timeoutMs: number): Promise<{
  value?: T;
  timedOut: boolean;
}> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(value => ({ value, timedOut: false })),
      new Promise<{ timedOut: true }>(resolve => {
        timer = setTimeout(() => resolve({ timedOut: true }), Math.max(0, timeoutMs));
        (timer as any)?.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function finiteDetail(event: ActivityStageLedgerEvent, key: string): number | null {
  const value = event.details[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function maximum(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length > 0 ? Math.max(...finite) : null;
}

function evidenceIds(events: ActivityStageLedgerEvent[], stage: ActivityStage): Set<string> {
  const result = new Set<string>();
  events.filter(event => event.stage === stage).forEach(event => {
    if (event.evidenceId) result.add(event.evidenceId);
    // A continuity decision has its own stable observation id, while the
    // JavaScript receipt it answers is carried as an explicit bridge. Treating
    // only the decision id as downstream evidence creates a phantom missing
    // decision for every ACCEPT/REFINE/QUARANTINE/REJECT classification.
    if (stage === 'observation-decision'
      && typeof event.details.receiptEvidenceId === 'string'
      && event.details.receiptEvidenceId.length > 0) {
      result.add(event.details.receiptEvidenceId);
    }
    const batch = event.details.evidenceIds;
    if (Array.isArray(batch)) {
      batch.filter(identity => typeof identity === 'string').forEach(identity => result.add(identity));
    }
  });
  return result;
}

function correlatedCompleteness(
  upstream: Set<string>,
  downstream: Set<string>,
  unavailable: ActivityEvidenceCompleteness = 'partial',
): ActivityEvidenceCompleteness {
  if (upstream.size === 0) return unavailable;
  return [...upstream].every(identity => downstream.has(identity)) ? 'complete' : 'partial';
}

function stageCoversEvidence(
  events: ActivityStageLedgerEvent[],
  stage: ActivityStage,
  identity: string,
): boolean {
  const direct = evidenceIds(events, stage);
  if (direct.has(identity)) return true;
  const ordinal = Number(identity.slice(identity.lastIndexOf(':') + 1));
  if (!Number.isFinite(ordinal)) return false;
  return events.some(event => {
    if (event.stage !== stage) return false;
    const first = finiteDetail(event, 'firstRawOrdinal');
    const last = finiteDetail(event, 'lastRawOrdinal');
    return first !== null && last !== null && ordinal >= first && ordinal <= last;
  });
}

function correlatedStageCompleteness(
  upstream: Set<string>,
  events: ActivityStageLedgerEvent[],
  downstreamStage: ActivityStage,
): ActivityEvidenceCompleteness {
  if (upstream.size === 0) return 'partial';
  return [...upstream].every(identity => stageCoversEvidence(events, downstreamStage, identity))
    ? 'complete'
    : 'partial';
}

function detailString(event: ActivityStageLedgerEvent | null, ...keys: string[]): string | null {
  if (!event) return null;
  for (const key of keys) {
    const value = event.details[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function detailNumber(event: ActivityStageLedgerEvent | null, ...keys: string[]): number | null {
  if (!event) return null;
  for (const key of keys) {
    const value = event.details[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function exactCompletedUploadAcknowledged(events: ActivityStageLedgerEvent[]): boolean {
  const completion = [...events].reverse().find(event => event.stage === 'completion-presented')
    ?? [...events].reverse().find(event => event.stage === 'final-selected')
    ?? null;
  if (!completion) return false;
  const expectedRevision = detailNumber(completion, 'artifactRevision', 'selectedRevision', 'revision');
  const expectedFingerprint = detailString(
    completion,
    'artifactFingerprint',
    'selectedFingerprint',
    'displayFingerprint',
  );
  const expectedCanonicalCount = detailNumber(completion, 'canonicalPointCount');
  // A legacy/truncated completion cannot establish which exact local artifact
  // the server acknowledged. Prefer honest partial evidence to a false PASS.
  if (expectedRevision === null
    || expectedFingerprint === null
    || expectedCanonicalCount === null) return false;
  return events.some(event => {
    if (event.stage !== 'sync-state'
      || event.details.operation !== 'completed-activity-upload'
      || event.details.phase !== 'ack'
      || event.details.acknowledged !== true
      || event.details.activityIdentityMatched !== true
      || event.details.serverActivityIdentityMatched !== true) return false;
    const acknowledgedRevision = detailNumber(event, 'finalRevision', 'artifactRevision');
    const acknowledgedFingerprint = detailString(event, 'finalFingerprint', 'artifactFingerprint');
    const acknowledgedCanonicalCount = detailNumber(event, 'canonicalPointCount');
    return acknowledgedRevision === expectedRevision
      && acknowledgedFingerprint === expectedFingerprint
      && acknowledgedCanonicalCount === expectedCanonicalCount;
  });
}

interface PauseEvidenceForGap {
  intentionalInactiveDurationMs: number | null;
  pauseEvidenceCompleteness: 'none' | 'partial' | 'complete' | 'unknown';
}

/**
 * Interpret only explicit Pause -> Resume pairs from one uninterrupted JS
 * process. Open/missing/cross-process boundaries are evidence of uncertainty,
 * never authority to label an entire receipt gap as intentional inactivity.
 */
function pauseEvidenceForGap(
  events: ActivityStageLedgerEvent[],
  fromWallTimeMs: number,
  toWallTimeMs: number,
): PauseEvidenceForGap {
  const lifecycle = events.filter(event => event.stage === 'lifecycle'
    && (event.details.event === 'recording-paused'
      || event.details.event === 'recording-resumed'));
  const gapProcessIds = new Set(events
    .filter(event => event.wallTimeMs >= fromWallTimeMs && event.wallTimeMs <= toWallTimeMs)
    .map(event => event.processId));
  const boundedIntervals: Array<{ fromWallTimeMs: number; toWallTimeMs: number }> = [];
  let openPause: ActivityStageLedgerEvent | null = null;
  let unknownBoundaryInGap = false;

  for (const event of lifecycle) {
    if (event.details.event === 'recording-paused') {
      if (openPause && openPause.wallTimeMs < toWallTimeMs
        && event.wallTimeMs > fromWallTimeMs) unknownBoundaryInGap = true;
      openPause = event;
      continue;
    }
    if (!openPause) {
      if (event.wallTimeMs > fromWallTimeMs && event.wallTimeMs < toWallTimeMs) {
        unknownBoundaryInGap = true;
      }
      continue;
    }
    const processDiscontinuity = event.processId !== openPause.processId
      || events.some(candidate => candidate.wallTimeMs > openPause!.wallTimeMs
        && candidate.wallTimeMs < event.wallTimeMs
        && candidate.processId !== openPause!.processId);
    if (processDiscontinuity) {
      if (openPause.wallTimeMs < toWallTimeMs && event.wallTimeMs > fromWallTimeMs) {
        unknownBoundaryInGap = true;
      }
    } else {
      boundedIntervals.push({
        fromWallTimeMs: openPause.wallTimeMs,
        toWallTimeMs: event.wallTimeMs,
      });
    }
    openPause = null;
  }

  if (openPause && openPause.wallTimeMs < toWallTimeMs) unknownBoundaryInGap = true;
  const lifecycleRelevantToGap = lifecycle.some(event => (
    event.wallTimeMs > fromWallTimeMs && event.wallTimeMs < toWallTimeMs
  )) || boundedIntervals.some(interval => (
    interval.fromWallTimeMs < toWallTimeMs && interval.toWallTimeMs > fromWallTimeMs
  ));
  if (lifecycleRelevantToGap && gapProcessIds.size > 1) unknownBoundaryInGap = true;
  if (unknownBoundaryInGap) {
    return { intentionalInactiveDurationMs: null, pauseEvidenceCompleteness: 'unknown' };
  }

  const clipped = boundedIntervals
    .map(interval => ({
      fromWallTimeMs: Math.max(fromWallTimeMs, interval.fromWallTimeMs),
      toWallTimeMs: Math.min(toWallTimeMs, interval.toWallTimeMs),
    }))
    .filter(interval => interval.toWallTimeMs > interval.fromWallTimeMs)
    .sort((left, right) => left.fromWallTimeMs - right.fromWallTimeMs);
  let inactiveDurationMs = 0;
  let frontier = fromWallTimeMs;
  for (const interval of clipped) {
    const start = Math.max(frontier, interval.fromWallTimeMs);
    if (interval.toWallTimeMs > start) inactiveDurationMs += interval.toWallTimeMs - start;
    frontier = Math.max(frontier, interval.toWallTimeMs);
  }
  const gapDurationMs = Math.max(0, toWallTimeMs - fromWallTimeMs);
  if (inactiveDurationMs >= gapDurationMs && gapDurationMs > 0) {
    return { intentionalInactiveDurationMs: gapDurationMs, pauseEvidenceCompleteness: 'complete' };
  }
  if (inactiveDurationMs > 0) {
    return { intentionalInactiveDurationMs: inactiveDurationMs, pauseEvidenceCompleteness: 'partial' };
  }
  return { intentionalInactiveDurationMs: 0, pauseEvidenceCompleteness: 'none' };
}

/** Pure, coordinate-free interpretation of the retained stage evidence. */
export function summarizeActivityObservability(
  events: ActivityStageLedgerEvent[],
  options: { retentionTruncated?: boolean } = {},
): ActivityObservabilitySummary {
  const ordered = events.slice().sort(
    (left, right) => left.wallTimeMs - right.wallTimeMs || left.eventId.localeCompare(right.eventId),
  );
  const stageCounts: Partial<Record<ActivityStage, number>> = {};
  const frontiers: ActivityObservabilitySummary['frontiers'] = {};
  for (const event of ordered) {
    stageCounts[event.stage] = (stageCounts[event.stage] ?? 0) + logicalFactCount(event);
    frontiers[event.stage] = {
      count: stageCounts[event.stage]!,
      lastWallTimeMs: event.wallTimeMs,
      lastEvidenceId: event.evidenceId ?? null,
    };
  }

  const received = evidenceIds(ordered, 'observation-received');
  const decisions = evidenceIds(ordered, 'observation-decision');
  const canonical = evidenceIds(ordered, 'canonical-accepted');
  const wal = evidenceIds(ordered, 'wal-committed');
  const store = evidenceIds(ordered, 'store-published');
  const syncAcknowledged = options.retentionTruncated !== true
    && exactCompletedUploadAcknowledged(ordered);
  const locallyComplete = ordered.some(event => (
    event.stage === 'final-selected' || event.stage === 'completion-presented'
  ));
  const refinementUnavailable = ordered.some(event => (
    (event.stage === 'final-job' || event.stage === 'sync-state')
    && (event.details.phase === 'unavailable'
      || event.details.phase === 'failed'
      || event.details.providerAvailable === false)
  ));

  const decisionsById = new Map(ordered
    .filter(event => event.stage === 'observation-decision' && event.evidenceId)
    .map(event => [event.evidenceId!, event]));
  const rejectedByFiltering = [...decisionsById.values()].filter(event => {
    const decision = String(event.details.decision ?? '').toUpperCase();
    return decision !== 'ACCEPT' && decision !== 'ACCEPTED';
  }).length;

  const observationEvents = ordered.filter(event => event.stage === 'observation-received');
  const longObservationGaps: ActivityObservabilitySummary['longObservationGaps'] = [];
  // A resume-time durable checkpoint can prove that JavaScript observed no
  // callback for an interval even when there is no later GPS receipt to close
  // a traditional receipt-to-receipt pair. It still cannot identify anything
  // upstream of Expo's JavaScript delivery boundary.
  for (const event of ordered.filter(candidate => (
    candidate.stage === 'provider-state'
    && candidate.details.eventCode === 'ACTIVITY_SILENCE_GAP'
  ))) {
    const durationMs = finiteDetail(event, 'durationMs');
    if (durationMs === null || durationMs <= 0) continue;
    const explicitAnchor = finiteDetail(event, 'receiptAnchorWallTimeMs');
    const fromWallTimeMs = explicitAnchor ?? Math.max(0, event.wallTimeMs - durationMs);
    const inside = ordered.filter(candidate => (
      candidate.wallTimeMs > fromWallTimeMs && candidate.wallTimeMs < event.wallTimeMs
    ));
    const pauseEvidence = pauseEvidenceForGap(ordered, fromWallTimeMs, event.wallTimeMs);
    longObservationGaps.push({
      durationMs,
      receiptGapDurationMs: durationMs,
      observationTimestampGapMs: null,
      fromWallTimeMs,
      toWallTimeMs: event.wallTimeMs,
      heartbeatCount: inside.filter(candidate => candidate.stage === 'health-heartbeat').length,
      ...pauseEvidence,
      conclusion: pauseEvidence.pauseEvidenceCompleteness === 'complete'
        ? 'recording-source-intentionally-inactive'
        : 'no-js-callback-native-cause-unknown',
    });
  }
  for (let index = 1; index < observationEvents.length; index += 1) {
    const from = observationEvents[index - 1];
    const to = observationEvents[index];
    const durationMs = to.wallTimeMs - from.wallTimeMs;
    if (durationMs < 7 * 60_000) continue;
    const inside = ordered.filter(event => (
      event.wallTimeMs > from.wallTimeMs && event.wallTimeMs < to.wallTimeMs
    ));
    const heartbeatCount = inside.filter(event => event.stage === 'health-heartbeat').length;
    const pauseEvidence = pauseEvidenceForGap(ordered, from.wallTimeMs, to.wallTimeMs);
    const fromObservationTimeMs = finiteDetail(from, 'observationTimeMs');
    const toObservationTimeMs = finiteDetail(to, 'observationTimeMs');
    const observationTimestampGapMs = fromObservationTimeMs === null || toObservationTimeMs === null
      ? null
      : Math.max(0, toObservationTimeMs - fromObservationTimeMs);
    const conclusion = pauseEvidence.pauseEvidenceCompleteness === 'complete'
      ? 'recording-source-intentionally-inactive' as const
      : heartbeatCount > 0
        ? 'no-js-callback-native-cause-unknown' as const
        : 'js-runtime-not-observed' as const;
    longObservationGaps.push({
      durationMs,
      receiptGapDurationMs: durationMs,
      observationTimestampGapMs,
      fromWallTimeMs: from.wallTimeMs,
      toWallTimeMs: to.wallTimeMs,
      heartbeatCount,
      ...pauseEvidence,
      conclusion,
    });
  }

  return {
    stageCounts,
    frontiers,
    evidenceCompleteness: {
      // Native evidence is held in a separate owner-correlated ring. A JS
      // ledger can never promote these stages on its own; the forensic
      // cross-ledger report is the only authority for that boundary.
      nativeCallback: 'not-observable-current-binary',
      nativeToJsCorrelation: 'not-observable-current-binary',
      jsIntake: received.size > 0 ? 'complete' : 'partial',
      acceptanceDecision: correlatedCompleteness(received, decisions),
      walDurability: correlatedStageCompleteness(canonical, ordered, 'wal-committed'),
      canonicalStore: correlatedStageCompleteness(wal, ordered, 'store-published'),
      livePublication: correlatedStageCompleteness(store, ordered, 'presentation'),
      networkSync: syncAcknowledged ? 'complete' : 'partial',
    },
    pipelineFindings: {
      nativeCallbacksWithoutJsDelivery: 0,
      jsReceiptsWithoutDecision: options.retentionTruncated === true
        ? 0
        : [...received].filter(identity => !decisions.has(identity)).length,
      jsReceiptDecisionCorrelation: options.retentionTruncated === true
        ? 'unknown-retention-truncated'
        : [...received].every(identity => decisions.has(identity))
          ? 'complete'
          : 'missing-decision',
      rejectedByFiltering,
      canonicalAcceptsWithoutWal: [...canonical]
        .filter(identity => !stageCoversEvidence(ordered, 'wal-committed', identity)).length,
      walCommitsWithoutStorePublication: [...wal]
        .filter(identity => !stageCoversEvidence(ordered, 'store-published', identity)).length,
      storePublicationsWithoutPresentationEvidence: [...store]
        .filter(identity => !stageCoversEvidence(ordered, 'presentation', identity)).length,
      locallyCompleteWithoutUploadAck: locallyComplete && !syncAcknowledged,
      refinementUnavailable,
    },
    timing: {
      maximumObservationReceiptLagMs: maximum(observationEvents.map(event => {
        const observationTimeMs = finiteDetail(event, 'observationTimeMs');
        return observationTimeMs === null ? null : Math.max(0, event.wallTimeMs - observationTimeMs);
      })),
      maximumWalToStoreLagMs: maximum(ordered
        .filter(event => event.stage === 'store-published')
        .map(event => finiteDetail(event, 'walToStoreLatencyMs'))),
      longestJsReceiptGapMs: maximum(observationEvents.slice(1).map((event, index) => (
        event.wallTimeMs - observationEvents[index].wallTimeMs
      )).concat(longObservationGaps.map(gap => gap.receiptGapDurationMs))),
      longestObservationTimestampGapMs: maximum(observationEvents.slice(1).map((event, index) => {
        const previous = finiteDetail(observationEvents[index], 'observationTimeMs');
        const current = finiteDetail(event, 'observationTimeMs');
        return previous === null || current === null ? null : Math.max(0, current - previous);
      })),
    },
    longObservationGaps,
    interpretationLimits: [
      'This installed binary cannot observe CLLocation callback receipt before Expo delivers it to JavaScript.',
      'Missing JavaScript observations alone do not prove an iOS, hardware, permission, or native-provider cause.',
      'JavaScript receipt gaps and original GPS observation-timestamp gaps are reported separately.',
      'Routine healthy stages may be represented by counted first/last windows; suppressedCount is not a native-callback count.',
      'Native callback conclusions require the separately exported owner-correlated collector coverage report.',
    ],
  };
}

/**
 * Persist one privacy-safe stage fact without joining the GPS ingest mutex.
 * Coordinates and credential-shaped fields are removed at this boundary.
 */
export interface RecordActivityStageInput {
  ownerUserId: string;
  clientActivityId: string;
  stage: ActivityStage;
  evidenceId?: string | null;
  wallTimeMs?: number;
  monotonicTimeMs?: number | null;
  details?: Record<string, unknown>;
}

function enqueueActivityStageEvent(input: RecordActivityStageInput): Promise<void> {
  if (!input.ownerUserId || !input.clientActivityId) return Promise.resolve();
  const decisionWallTimeMs = input.details?.decisionWallTimeMs;
  const wallTimeMs = Math.floor(
    input.wallTimeMs
      ?? (typeof decisionWallTimeMs === 'number' && Number.isFinite(decisionWallTimeMs)
        ? decisionWallTimeMs
        : Date.now()),
  );
  const monotonicTimeMs = input.monotonicTimeMs === undefined
    ? activityStageMonotonicNow()
    : input.monotonicTimeMs;
  if ([
    'activity-start', 'lifecycle', 'provider-state', 'final-job', 'final-selected',
    'completion-presented', 'detail-selected', 'sync-state', 'segment-transition',
  ].includes(input.stage)) {
    void recordActivityDiagnosticReplayEvent({
      ownerUserId: input.ownerUserId,
      clientActivityId: input.clientActivityId,
      kind: 'application-event',
      wallTimeMs,
      monotonicTimeMs,
      data: {
        stage: input.stage,
        evidenceId: input.evidenceId ?? null,
        details: privacySafeDetails(input.details ?? {}),
      },
    });
  }
  const sequence = eventSequence += 1;
  const eventId = `${wallTimeMs.toString().padStart(13, '0')}-${sequence.toString().padStart(8, '0')}`;
  const event: ActivityStageLedgerEvent = {
    schema: 'cairn-activity-stage-ledger',
    version: 1,
    eventId,
    ownerUserId: input.ownerUserId,
    clientActivityId: input.clientActivityId,
    stage: input.stage,
    wallTimeMs,
    monotonicTimeMs: monotonicTimeMs == null ? null : Number(monotonicTimeMs.toFixed(3)),
    processOriginWallTimeMs: processMonotonicOrigin == null ? null : Math.round(processMonotonicOrigin),
    processId,
    evidenceId: input.evidenceId ?? null,
    details: privacySafeDetails(input.details ?? {}) as Record<string, unknown>,
  };
  const realm = realmForActivity(input.clientActivityId);
  if (realm === 'production'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientActivityId)) {
    // The existing owner ledger remains the capture authority. Its persisted
    // physical events are mirrored into the bounded automatic outbox without
    // awaiting storage or network on the Activity/WAL critical path.
    Promise.resolve().then(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { captureAutomaticDiagnosticEvent } = require('../../services/automaticDiagnosticOutbox');
      const identity = installedIdentity();
      const activityMode = event.details.activityMode === 'hiking' || event.details.activityMode === 'running'
        ? event.details.activityMode
        : undefined;
      return captureAutomaticDiagnosticEvent({
        ownerUserId: input.ownerUserId,
        eventId: event.eventId,
        stream: {
          streamId: `activity:${input.clientActivityId}`,
          sourceType: 'activity',
          clientActivityId: input.clientActivityId,
          ...(activityMode ? { activityMode } : {}),
          runtimeVersion: identity.runtimeVersion,
          updateId: identity.updateId,
        },
        eventCode: typeof event.details.eventCode === 'string'
          ? event.details.eventCode
          : `ACTIVITY_${input.stage.replace(/-/g, '_').toUpperCase()}`,
        sourceModule: 'activityStageLedger',
        severity: event.details.phase === 'failed' || event.details.status === 'error' ? 'error' : 'info',
        eventAt: event.wallTimeMs,
        monotonicMs: event.monotonicTimeMs,
        details: {
          stage: event.stage,
          evidenceId: event.evidenceId,
          ...event.details,
        },
      });
    }).catch(() => undefined);
  }
  // Snap Lab accelerates hours of evidence through one foreground runtime.
  // A fixed per-Activity slot ring keeps the owner-local diagnostic boundary
  // bounded without periodic full-key scans that can stall the app. The event
  // payload retains its true monotonic eventId; production keys are unchanged.
  const storageIdentity = realm === 'snap-lab'
    ? `slot-${(sequence % MAX_EVENTS_PER_ACTIVITY).toString().padStart(4, '0')}`
    : eventId;
  const key = `${activityPrefix(input.ownerUserId, input.clientActivityId, realm)}${storageIdentity}`;
  const state = writerState(input.ownerUserId, realm);
  if (state.purging) {
    state.droppedEventCount += 1;
    return Promise.resolve();
  }
  state.queue.push({ key, event });
  if (state.queue.length > MAX_BUFFERED_EVENTS_PER_OWNER) {
    const excess = state.queue.length - MAX_BUFFERED_EVENTS_PER_OWNER;
    state.queue.splice(0, excess);
    state.droppedEventCount += excess;
  }
  scheduleOwnerPump(input.ownerUserId, state, realm);
  if (realm === 'production' || input.stage === 'activity-start' || input.stage === 'completion-presented') {
    scheduleTrim(input.ownerUserId, state, realm, realm === 'snap-lab');
  }
  // Recording means capture into the bounded owner buffer. Activity ingest,
  // background ownership and Finish never inherit diagnostic storage latency.
  return Promise.resolve();
}

function flushRoutineBucket(bucket: RoutineStageBucket): void {
  if (bucket.count <= 0 || bucket.firstWallTimeMs === null || bucket.lastWallTimeMs === null) return;
  void enqueueActivityStageEvent({
    ownerUserId: bucket.ownerUserId,
    clientActivityId: bucket.clientActivityId,
    stage: bucket.stage,
    evidenceId: bucket.lastEvidenceId,
    wallTimeMs: bucket.lastWallTimeMs,
    monotonicTimeMs: bucket.lastMonotonicTimeMs,
    details: {
      ...bucket.latestDetails,
      eventCode: 'ACTIVITY_ROUTINE_WINDOW',
      aggregation: 'routine-window',
      logicalEventCount: bucket.count,
      suppressedCount: bucket.count,
      firstWallTimeMs: bucket.firstWallTimeMs,
      lastWallTimeMs: bucket.lastWallTimeMs,
      firstMonotonicTimeMs: bucket.firstMonotonicTimeMs,
      lastMonotonicTimeMs: bucket.lastMonotonicTimeMs,
      firstEvidenceId: bucket.firstEvidenceId,
      lastEvidenceId: bucket.lastEvidenceId,
      numericTotals: bucket.numericTotals,
      numericMaxima: bucket.numericMaxima,
    },
  });
  bucket.count = 0;
  bucket.firstWallTimeMs = null;
  bucket.lastWallTimeMs = null;
  bucket.firstMonotonicTimeMs = null;
  bucket.lastMonotonicTimeMs = null;
  bucket.firstEvidenceId = null;
  bucket.lastEvidenceId = null;
  bucket.latestDetails = {};
  bucket.numericTotals = {};
  bucket.numericMaxima = {};
}

function flushRoutineBuckets(ownerUserId?: string, clientActivityId?: string, remove = false): void {
  for (const [key, bucket] of routineBuckets) {
    if (ownerUserId && bucket.ownerUserId !== ownerUserId) continue;
    if (clientActivityId && bucket.clientActivityId !== clientActivityId) continue;
    flushRoutineBucket(bucket);
    if (remove) routineBuckets.delete(key);
  }
}

export function recordActivityStageEvent(input: RecordActivityStageInput): Promise<void> {
  if (!input.ownerUserId || !input.clientActivityId) return Promise.resolve();
  if (!shouldCoalesceRoutine(input)) {
    flushRoutineBuckets(input.ownerUserId, input.clientActivityId);
    const result = enqueueActivityStageEvent(input);
    if (input.stage === 'completion-presented') {
      flushRoutineBuckets(input.ownerUserId, input.clientActivityId, true);
    }
    return result;
  }

  const key = routineBucketKey(input.ownerUserId, input.clientActivityId, input.stage);
  let bucket = routineBuckets.get(key);
  if (!bucket) {
    bucket = {
      ownerUserId: input.ownerUserId,
      clientActivityId: input.clientActivityId,
      stage: input.stage,
      count: 0,
      firstWallTimeMs: null,
      lastWallTimeMs: null,
      firstMonotonicTimeMs: null,
      lastMonotonicTimeMs: null,
      firstEvidenceId: null,
      lastEvidenceId: null,
      latestDetails: {},
      numericTotals: {},
      numericMaxima: {},
    };
    routineBuckets.set(key, bucket);
    // The first JS receipt/accept/WAL/store fact remains an exact durable
    // milestone. Later healthy repeats are represented by counted windows.
    return enqueueActivityStageEvent(input);
  }

  const decisionWallTimeMs = input.details?.decisionWallTimeMs;
  const wallTimeMs = Math.floor(input.wallTimeMs
    ?? (typeof decisionWallTimeMs === 'number' && Number.isFinite(decisionWallTimeMs)
      ? decisionWallTimeMs
      : Date.now()));
  const monotonicTimeMs = input.monotonicTimeMs === undefined
    ? activityStageMonotonicNow()
    : input.monotonicTimeMs;
  bucket.count += 1;
  bucket.firstWallTimeMs ??= wallTimeMs;
  bucket.lastWallTimeMs = wallTimeMs;
  bucket.firstMonotonicTimeMs ??= monotonicTimeMs;
  bucket.lastMonotonicTimeMs = monotonicTimeMs;
  bucket.firstEvidenceId ??= input.evidenceId ?? null;
  bucket.lastEvidenceId = input.evidenceId ?? null;
  bucket.latestDetails = privacySafeDetails(input.details ?? {}) as Record<string, unknown>;
  summarizeRoutineNumbers(bucket, bucket.latestDetails);
  if (bucket.count >= ROUTINE_WINDOW_SIZE) flushRoutineBucket(bucket);
  return Promise.resolve();
}

/**
 * Crash-sensitive diagnostic boundary. This is deliberately reserved for
 * sparse facts such as SILENCE_GAP: enqueue the exact event, settle the owner
 * writer, then prove the same evidence id can be read from strict storage.
 * A false result leaves the caller's durable pending marker replayable.
 */
export async function recordActivityStageEventDurably(
  input: RecordActivityStageInput,
): Promise<boolean> {
  if (!input.ownerUserId || !input.clientActivityId || !input.evidenceId) return false;
  try {
    await recordActivityStageEvent(input);
    await flushActivityStageLedger(input.ownerUserId);
    const realm = realmForActivity(input.clientActivityId);
    const prefix = activityPrefix(input.ownerUserId, input.clientActivityId, realm);
    const keys = (await strictKeys(realm)).filter(key => key.startsWith(prefix));
    for (const key of keys) {
      const raw = await ledgerGetItem(key, realm);
      if (!raw) continue;
      const event = JSON.parse(raw) as ActivityStageLedgerEvent;
      if (event.clientActivityId === input.clientActivityId
        && event.stage === input.stage
        && event.evidenceId === input.evidenceId) return true;
    }
  } catch { /* caller retains the replayable pending marker */ }
  return false;
}

/** Test/privacy boundary. Production ingest and Finish deliberately do not await this. */
export async function flushActivityStageLedger(ownerUserId?: string): Promise<void> {
  flushRoutineBuckets(ownerUserId);
  const targets = ownerUserId
    ? (['production', 'snap-lab'] as ActivityStageLedgerRealm[]).map(realm => ({ ownerUserId, realm }))
    : [...ownerWriters.keys()].map(key => {
        const separator = key.indexOf(':');
        return {
          realm: key.slice(0, separator) as ActivityStageLedgerRealm,
          ownerUserId: key.slice(separator + 1),
        };
      });
  await Promise.allSettled(targets.map(target => settleOwnerWriter(target.ownerUserId, target.realm)));
  if (ownerUserId) await Promise.allSettled((['production', 'snap-lab'] as ActivityStageLedgerRealm[]).map(
    realm => trimTails.get(writerKey(ownerUserId, realm)) ?? Promise.resolve(),
  ));
  else await Promise.allSettled([...trimTails.values()]);
}

const RESOURCE_HEARTBEAT_FIELDS = [
  'reason', 'appState', 'foregroundWatcherActive', 'backgroundTaskActive',
  'backgroundPermissionState', 'sourceAgeMs', 'canonicalAgeMs', 'sourceHealth', 'canonicalHealth',
  'rawPointCount', 'canonicalPointCount', 'livePublishedPointCount', 'segmentCount', 'gapCount',
  'providerStartCount', 'providerStopCount', 'providerActiveDurationMs',
  'journalAppendCount', 'journalAppendOperationCount', 'journalLogicalBytes', 'journalActualAppendBytes',
  'journalCheckpointCount', 'journalCheckpointBytes', 'journalTotalCommitMs', 'journalMaxCommitMs',
  'memoryEvidenceCalls', 'memoryEvidenceMutations', 'memoryEvidenceDeduplicated', 'memoryBatchFlushes',
  'memoryPersistenceWrites', 'memoryPersistenceBytes', 'h3PersistenceWrites', 'h3PersistenceBytes',
  'memoryNetworkSyncRequests', 'memoryNetworkSyncedPointAttempts',
] as const;

function buildActivityResourceSummary(
  events: ActivityStageLedgerEvent[],
  phaseSummary: ActivityStagePhaseSummary | null,
): ActivityResourceSummary {
  const stageCount = (stage: ActivityStage): number => (
    phaseSummary?.stages[stage]?.count
    ?? events.filter(event => event.stage === stage).reduce((sum, event) => sum + logicalFactCount(event), 0)
  );
  const logicalStageFacts = phaseSummary?.capturedEventCount
    ?? events.reduce((sum, event) => sum + logicalFactCount(event), 0);
  const latestHeartbeatEvent = [...events].reverse().find(event => event.stage === 'health-heartbeat') ?? null;
  const latestHeartbeat = latestHeartbeatEvent
    ? Object.fromEntries(RESOURCE_HEARTBEAT_FIELDS.flatMap(field => (
        latestHeartbeatEvent.details[field] === undefined ? [] : [[field, latestHeartbeatEvent.details[field]]]
      )))
    : null;
  return {
    semantics: 'JS_OBSERVED_RESOURCE_PROXY_NOT_BATTERY_MEASUREMENT',
    coverage: {
      startWallTimeMs: phaseSummary?.firstWallTimeMs ?? events[0]?.wallTimeMs ?? null,
      endWallTimeMs: phaseSummary?.lastWallTimeMs ?? events[events.length - 1]?.wallTimeMs ?? null,
    },
    counters: {
      jsLocationReceipts: stageCount('observation-received'),
      acceptanceDecisions: stageCount('observation-decision'),
      canonicalAccepts: stageCount('canonical-accepted'),
      walCommitEvents: stageCount('wal-committed'),
      storePublicationEvents: stageCount('store-published'),
      segmentTransitions: stageCount('segment-transition'),
      providerTransitions: stageCount('provider-state'),
      lifecycleTransitions: stageCount('lifecycle'),
      syncEvents: stageCount('sync-state'),
      presentationMilestones: stageCount('presentation') + stageCount('detail-selected'),
    },
    logging: {
      logicalStageFacts,
      persistedEventRecords: events.length,
      coalescedFacts: Math.max(0, logicalStageFacts - events.length),
      approximateEventBytes: events.reduce((sum, event) => sum + JSON.stringify(event).length, 0),
    },
    latestHeartbeat,
    instrumentation: {
      nativeEnergyMeasured: false,
      visibleMapPixelsMeasured: false,
      nativeLocationReleaseVerified: false,
      notes: [
        'Counts and durations are JavaScript-observed work proxies, not watts or battery attribution.',
        'A requested native location stop does not prove Core Location released its observer.',
        'Mapbox callbacks do not prove final track pixels were visible on the iPhone display.',
      ],
    },
  };
}

export async function exportLatestActivityStageLedger(
  ownerUserId: string,
  realm: ActivityStageLedgerRealm = 'production',
  requestedClientActivityId?: string,
): Promise<ActivityStageLedgerExport> {
  flushRoutineBuckets(ownerUserId, requestedClientActivityId);
  const state = writerState(ownerUserId, realm);
  const waitStartedAt = Date.now();
  const settled = await waitBounded(settleOwnerWriter(ownerUserId, realm), EXPORT_WAIT_MS);
  const waitTimedOut = settled.timedOut;
  const remainingMs = Math.max(0, EXPORT_WAIT_MS - (Date.now() - waitStartedAt));
  const prefix = ownerPrefix(ownerUserId, realm);
  const [keysResult, metaResult] = await Promise.all([
    waitBounded(strictKeys(realm), remainingMs),
    waitBounded(ledgerGetItem(metaKey(ownerUserId, realm), realm), remainingMs),
  ]);
  const keys = (keysResult.value ?? []).filter(key => key.startsWith(prefix)).sort();
  const readsResult = await waitBounded(
    Promise.all(keys.map(key => ledgerGetItem(key, realm))),
    Math.max(0, EXPORT_WAIT_MS - (Date.now() - waitStartedAt)),
  );
  const persistedEvents = (readsResult.value ?? []).flatMap(value => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as ActivityStageLedgerEvent;
      return parsed?.schema === 'cairn-activity-stage-ledger' ? [parsed] : [];
    } catch { return []; }
  });
  const bufferedEvents = [...state.inFlight, ...state.queue, ...state.failedEvents].map(item => item.event);
  const byId = new Map<string, ActivityStageLedgerEvent>();
  [...persistedEvents, ...bufferedEvents].forEach(event => byId.set(event.eventId, event));
  const allEvents = [...byId.values()].sort(
    (left, right) => left.wallTimeMs - right.wallTimeMs || left.eventId.localeCompare(right.eventId),
  );
  let persistedMeta: PersistedOwnerMeta | null = null;
  if (metaResult.value) {
    try {
      const parsed = JSON.parse(metaResult.value);
      if (validOwnerMeta(parsed)) persistedMeta = parsed;
    } catch { /* malformed metadata is reported as unavailable/partial */ }
  }
  const summaries = state.metaLoaded ? state.summaries : persistedMeta?.summaries ?? [];
  const latestEvent = allEvents[allEvents.length - 1] ?? null;
  const latestSummary = summaries[summaries.length - 1] ?? null;
  const latestActivityId = requestedClientActivityId ?? (
    latestSummary && (!latestEvent || latestSummary.lastWallTimeMs >= latestEvent.wallTimeMs)
      ? latestSummary.clientActivityId
      : latestEvent?.clientActivityId ?? null
  );
  const selected = latestActivityId
    ? allEvents.filter(event => event.clientActivityId === latestActivityId)
    : [];
  const failedWriteCount = Math.max(state.failedWriteCount, persistedMeta?.failedWriteCount ?? 0);
  const droppedEventCount = Math.max(state.droppedEventCount, persistedMeta?.droppedEventCount ?? 0);
  const retentionTruncated = selected.length > MAX_EVENTS_PER_ACTIVITY
    || state.retentionTruncated
    || persistedMeta?.retentionTruncated === true;
  const events = selected.slice(-MAX_EVENTS_PER_ACTIVITY);
  const pendingEventCount = state.queue.length + state.inFlight.length;
  const storageTimedOut = waitTimedOut || keysResult.timedOut || metaResult.timedOut || readsResult.timedOut;
  const summaryAvailable = state.metaPersisted || persistedMeta !== null;
  const snapLabRequiredStages: ActivityStage[] = [
    'activity-start',
    'observation-received',
    'observation-decision',
    'canonical-accepted',
    'wal-committed',
    'store-published',
    'memory-responsibility',
    'memory-local-commit',
    'final-selected',
    'completion-presented',
  ];
  const capturedStages = new Set(events.map(event => event.stage));
  const missingRequiredStages = realm === 'snap-lab'
    ? snapLabRequiredStages.filter(stage => !capturedStages.has(stage))
    : [];
  const partial = !summaryAvailable
    || state.metaReadFailed
    || state.metaWriteFailed
    || storageTimedOut
    || pendingEventCount > 0
    || failedWriteCount > 0
    || droppedEventCount > 0
    || retentionTruncated
    || missingRequiredStages.length > 0;
  const phaseSummary = summaries.find(summary => summary.clientActivityId === latestActivityId) ?? null;
  return {
    schema: 'cairn-activity-stage-ledger-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    ownerUserId: 'current-owner',
    clientActivityId: latestActivityId,
    installedIdentity: installedIdentity(),
    privacy: {
      localOnly: true,
      coordinatesIncluded: false,
      automaticUpload: false,
      automaticTierASummaryMirror: true,
    },
    presentationMeasurement: 'REACT_COMMIT_NOT_NATIVE_FRAME',
    diagnosticCompleteness: {
      persistence: partial ? 'partial' : 'complete',
      summaryAvailable,
      pendingEventCount,
      failedWriteCount,
      droppedEventCount,
      retentionTruncated,
      waitTimedOut: storageTimedOut,
      requiredStagesPresent: missingRequiredStages.length === 0,
      missingRequiredStages,
    },
    phaseSummary,
    observability: summarizeActivityObservability(events, { retentionTruncated }),
    resourceSummary: buildActivityResourceSummary(events, phaseSummary),
    events: events.map(event => ({ ...event, ownerUserId: 'current-owner' })),
  };
}

/** Export the bounded ledger for an Activity the Owner explicitly selected.
 * Unlike Settings' latest-only shortcut, this never silently pairs a replay
 * with a different Activity's stage ledger. */
export function exportActivityStageLedger(
  ownerUserId: string,
  clientActivityId: string,
  realm: ActivityStageLedgerRealm = 'production',
): Promise<ActivityStageLedgerExport> {
  if (!clientActivityId) throw new Error('activity_stage_ledger_identity_required');
  return exportLatestActivityStageLedger(ownerUserId, realm, clientActivityId);
}

export async function purgeActivityStageLedgerRealmForOwner(
  ownerUserId: string,
  realm: ActivityStageLedgerRealm,
): Promise<void> {
    for (const [key, bucket] of routineBuckets) {
      if (bucket.ownerUserId === ownerUserId && realmForActivity(bucket.clientActivityId) === realm) {
        routineBuckets.delete(key);
      }
    }
    const state = writerState(ownerUserId, realm);
    state.purging = true;
    try {
      // Privacy deletion is the one strict fence: an already-entered native
      // write must settle before key removal so it cannot resurrect owner data.
      if (state.pump) await state.pump;
      if (state.metaTail) await state.metaTail;
      await trimTails.get(writerKey(ownerUserId, realm))?.catch(() => undefined);
      state.queue = [];
      state.inFlight = [];
      state.failedEvents = [];
      const keys = (await strictKeys(realm)).filter(key => key.startsWith(ownerPrefix(ownerUserId, realm)));
      await ledgerRemoveItems(keys, realm);
      await ledgerRemoveItems([metaKey(ownerUserId, realm)], realm);
    } finally {
      ownerWriters.delete(writerKey(ownerUserId, realm));
    }
}

export async function purgeActivityStageLedgerForOwner(ownerUserId: string): Promise<void> {
  for (const realm of ['production', 'snap-lab'] as ActivityStageLedgerRealm[]) {
    await purgeActivityStageLedgerRealmForOwner(ownerUserId, realm);
  }
}

export function activityStageLedgerOwnerPrefix(
  ownerUserId: string,
  realm: ActivityStageLedgerRealm = 'production',
): string {
  return ownerPrefix(ownerUserId, realm);
}
