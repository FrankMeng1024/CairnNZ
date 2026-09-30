import { storage } from '../../store/storage';
import { applySnapLabDiagnosticWriteDelay } from '../activitySimulator/snapLabFaultInjection';

export type ActivityStage =
  | 'activity-start'
  | 'observation-received'
  | 'observation-decision'
  | 'canonical-accepted'
  | 'wal-committed'
  | 'store-published'
  | 'presentation'
  | 'memory-responsibility'
  | 'memory-local-commit'
  | 'provider-state'
  | 'final-job'
  | 'final-selected'
  | 'completion-presented'
  | 'detail-selected';

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
  };
  presentationMeasurement: 'NOT_MEASURED';
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
  events: ActivityStageLedgerEvent[];
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
const META_ROOT = '@cairn:activity-stage-ledger-meta:v1:';
const QA_META_ROOT = '@cairn:snap_lab:activity-stage-ledger-meta:v1:';
export type ActivityStageLedgerRealm = 'production' | 'snap-lab';
const processMonotonicOrigin = typeof globalThis.performance?.now === 'function'
  ? Date.now() - globalThis.performance.now()
  : null;
const processId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let eventSequence = 0;
const trimTails = new Map<string, Promise<void>>();

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
  summary.capturedEventCount += 1;
  summary.firstWallTimeMs = Math.min(summary.firstWallTimeMs, event.wallTimeMs);
  summary.lastWallTimeMs = Math.max(summary.lastWallTimeMs, event.wallTimeMs);
  const stage = summary.stages[event.stage];
  summary.stages[event.stage] = stage ? {
    count: stage.count + 1,
    firstWallTimeMs: Math.min(stage.firstWallTimeMs, event.wallTimeMs),
    lastWallTimeMs: Math.max(stage.lastWallTimeMs, event.wallTimeMs),
  } : {
    count: 1,
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

/**
 * Persist one privacy-safe stage fact without joining the GPS ingest mutex.
 * Coordinates and credential-shaped fields are removed at this boundary.
 */
export function recordActivityStageEvent(input: {
  ownerUserId: string;
  clientActivityId: string;
  stage: ActivityStage;
  evidenceId?: string | null;
  wallTimeMs?: number;
  monotonicTimeMs?: number | null;
  details?: Record<string, unknown>;
}): Promise<void> {
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

/** Test/privacy boundary. Production ingest and Finish deliberately do not await this. */
export async function flushActivityStageLedger(ownerUserId?: string): Promise<void> {
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

export async function exportLatestActivityStageLedger(
  ownerUserId: string,
  realm: ActivityStageLedgerRealm = 'production',
): Promise<ActivityStageLedgerExport> {
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
  const latestActivityId = latestSummary
    && (!latestEvent || latestSummary.lastWallTimeMs >= latestEvent.wallTimeMs)
    ? latestSummary.clientActivityId
    : latestEvent?.clientActivityId ?? null;
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
    privacy: { localOnly: true, coordinatesIncluded: false, automaticUpload: false },
    presentationMeasurement: 'NOT_MEASURED',
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
    events: events.map(event => ({ ...event, ownerUserId: 'current-owner' })),
  };
}

export async function purgeActivityStageLedgerRealmForOwner(
  ownerUserId: string,
  realm: ActivityStageLedgerRealm,
): Promise<void> {
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
