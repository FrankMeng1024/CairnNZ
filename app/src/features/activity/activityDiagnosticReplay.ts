import { storage } from '../../store/storage';
import type { ActivityStageLedgerExport } from './activityStageLedger';

export type ActivityDiagnosticReplayKind =
  | 'diagnostic-start'
  | 'raw-observation'
  | 'observation-decision'
  | 'canonical-promotion'
  | 'provider-exchange'
  | 'application-event'
  | 'diagnostic-finish';

export interface ActivityDiagnosticReplayRecord {
  ordinal: number;
  kind: ActivityDiagnosticReplayKind;
  wallTimeMs: number;
  monotonicTimeMs: number | null;
  data: Record<string, unknown>;
}

interface ActivityDiagnosticReplayChunk {
  schema: 'cairn-activity-diagnostic-replay-chunk';
  version: 1;
  ownerUserId: string;
  clientActivityId: string;
  chunkOrdinal: number;
  firstRecordOrdinal: number;
  lastRecordOrdinal: number;
  records: ActivityDiagnosticReplayRecord[];
  checksumAlgorithm: 'fnv1a32';
  checksum: string;
}

interface ActivityDiagnosticReplayMeta {
  schema: 'cairn-activity-diagnostic-replay-meta';
  version: 1 | 2;
  ownerUserId: string;
  clientActivityId: string;
  enabledAtMs: number;
  disabledAtMs: number | null;
  chunkCount: number;
  recordCount: number;
  persistedBytes: number;
  complete: boolean;
  incompleteReason: string | null;
  recordingState?: 'recording' | 'finished';
  recordingFinishedAtMs?: number | null;
  recoveryCount?: number;
  volatileTailMayBeMissing?: boolean;
}

export interface ActivityDiagnosticReplayExport {
  schema: 'cairn-activity-diagnostic-replay-export';
  version: 2;
  exportedAt: string;
  ownerUserId: 'current-owner';
  clientActivityId: string;
  privacy: {
    localOnly: true;
    explicitOptIn: true;
    coordinatesIncluded: true;
    automaticUpload: false;
  };
  completeness: {
    complete: boolean;
    reason: string | null;
    chunkCount: number;
    recordCount: number;
    contiguousRecordOrdinals: boolean;
    everyChunkChecksumValid: boolean;
    pendingWriteCount: number;
    durableRecordsComplete: boolean;
    recordingFinished: boolean;
    /** This means the bounded tracking-replay inputs are internally usable.
     * It does not imply upload acknowledgement or phone-side cleanup. */
    selfContainedReplayComplete: boolean;
    replayScope: 'tracking-replay-inputs-only';
    syncTerminalState:
      | 'not-recorded'
      | 'attempting-or-pending'
      | 'failed-retryable-or-terminal'
      | 'acknowledged-cleanup-pending'
      | 'acknowledged-cleanup-complete'
      | 'not-applicable-local-qa';
    fullLifecycleComplete: boolean;
    fullLifecycleReason: string | null;
    recoveryCount: number;
    volatileTailMayBeMissing: boolean;
    postFinishRecordCount: number;
  };
  checksumAlgorithm: 'fnv1a32';
  recordsChecksum: string;
  records: ActivityDiagnosticReplayRecord[];
  stageLedger: ActivityStageLedgerExport | null;
  finalArtifact: Record<string, unknown> | null;
  providerReceipts: unknown[];
  providerResponses: unknown[];
  declaredMissing: string[];
}

export interface ActivityDiagnosticProviderExchange {
  phase: 'request' | 'response';
  requestId: string;
  requestKind: 'map-matching' | 'walking-directions';
  requestFingerprint: string;
  sanitizedUrl: string;
  status: number | null;
  headers: Record<string, string>;
  body: unknown | null;
  capturedAt: string;
}

const ROOT = '@cairn:activity-diagnostic-replay:v1:';
const RECORDS_PER_CHUNK = 48;
const MAX_PERSISTED_BYTES = 8 * 1024 * 1024;
const MAX_ACTIVITIES_PER_OWNER = 3;

interface ActiveReplay {
  ownerUserId: string;
  clientActivityId: string;
  enabledAtMs: number;
  chunks: ActivityDiagnosticReplayChunk[];
  recordCount: number;
  persistedBytes: number;
  tail: Promise<void>;
  pendingWriteCount: number;
  dirtyChunkOrdinals: Set<number>;
  writeScheduled: boolean;
  flushRequested: boolean;
  complete: boolean;
  incompleteReason: string | null;
  recordingState: 'recording' | 'finished';
  recordingFinishedAtMs: number | null;
  recoveryCount: number;
  volatileTailMayBeMissing: boolean;
}

const activeReplays = new Map<string, ActiveReplay>();
const replayRecovery = new Map<string, Promise<ActiveReplay | null>>();
const encoded = (value: string) => encodeURIComponent(value);
const activityKey = (ownerUserId: string, clientActivityId: string) => (
  `${ROOT}${encoded(ownerUserId)}:${encoded(clientActivityId)}`
);
const ownerPrefix = (ownerUserId: string) => `${ROOT}${encoded(ownerUserId)}:`;
const metaKey = (ownerUserId: string, clientActivityId: string) => (
  `${activityKey(ownerUserId, clientActivityId)}:meta`
);
const chunkKey = (ownerUserId: string, clientActivityId: string, ordinal: number) => (
  `${activityKey(ownerUserId, clientActivityId)}:chunk:${ordinal.toString().padStart(6, '0')}`
);

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function recordBytes(record: ActivityDiagnosticReplayRecord): number {
  return JSON.stringify(record).length;
}

function chunkChecksum(chunk: Omit<ActivityDiagnosticReplayChunk, 'checksum'>): string {
  return fnv1a32(JSON.stringify(chunk));
}

function metaSnapshot(replay: ActiveReplay): ActivityDiagnosticReplayMeta {
  return {
    schema: 'cairn-activity-diagnostic-replay-meta',
    version: 2,
    ownerUserId: replay.ownerUserId,
    clientActivityId: replay.clientActivityId,
    enabledAtMs: replay.enabledAtMs,
    disabledAtMs: replay.recordingFinishedAtMs,
    chunkCount: replay.chunks.length,
    recordCount: replay.recordCount,
    persistedBytes: replay.persistedBytes,
    complete: replay.complete,
    incompleteReason: replay.incompleteReason,
    recordingState: replay.recordingState,
    recordingFinishedAtMs: replay.recordingFinishedAtMs,
    recoveryCount: replay.recoveryCount,
    volatileTailMayBeMissing: replay.volatileTailMayBeMissing,
  };
}

async function persistChunk(replay: ActiveReplay, chunkOrdinal: number): Promise<void> {
  const source = replay.chunks[chunkOrdinal];
  if (!source) return;
  const withoutChecksum: Omit<ActivityDiagnosticReplayChunk, 'checksum'> = {
    schema: source.schema,
    version: source.version,
    ownerUserId: source.ownerUserId,
    clientActivityId: source.clientActivityId,
    chunkOrdinal: source.chunkOrdinal,
    firstRecordOrdinal: source.firstRecordOrdinal,
    lastRecordOrdinal: source.lastRecordOrdinal,
    records: source.records,
    checksumAlgorithm: 'fnv1a32',
  };
  const persisted = { ...withoutChecksum, checksum: chunkChecksum(withoutChecksum) };
  await storage.setItem(
    chunkKey(replay.ownerUserId, replay.clientActivityId, source.chunkOrdinal),
    JSON.stringify(persisted),
    { strict: true },
  );
  await storage.setItem(
    metaKey(replay.ownerUserId, replay.clientActivityId),
    JSON.stringify(metaSnapshot(replay)),
    { strict: true },
  );
}

function scheduleDirtyChunkWrite(replay: ActiveReplay, force = false): void {
  if (force) replay.flushRequested = true;
  if (replay.writeScheduled || replay.dirtyChunkOrdinals.size === 0) return;
  const forceThisBatch = replay.flushRequested;
  const ordinals = [...replay.dirtyChunkOrdinals]
    .filter(ordinal => forceThisBatch || (
      replay.chunks[ordinal]?.records.length ?? 0
    ) >= RECORDS_PER_CHUNK)
    .sort((left, right) => left - right);
  if (ordinals.length === 0) return;
  ordinals.forEach(ordinal => replay.dirtyChunkOrdinals.delete(ordinal));
  replay.flushRequested = false;
  replay.writeScheduled = true;
  replay.pendingWriteCount += 1;
  replay.tail = replay.tail.catch(() => undefined).then(async () => {
    try {
      // Persist the immutable snapshot of chunks selected at this boundary.
      // Records arriving during AsyncStorage work remain dirty for the next
      // full-chunk/lifecycle boundary instead of turning this into one write
      // per incoming GPS callback.
      for (const ordinal of ordinals) await persistChunk(replay, ordinal);
    } catch (error) {
      replay.complete = false;
      replay.incompleteReason = `durable-write-failed:${String(error).slice(0, 80)}`;
      await storage.setItem(
        metaKey(replay.ownerUserId, replay.clientActivityId),
        JSON.stringify(metaSnapshot(replay)),
        { strict: true },
      ).catch(() => undefined);
    } finally {
      replay.pendingWriteCount = Math.max(0, replay.pendingWriteCount - 1);
      replay.writeScheduled = false;
      const fullChunkWaiting = [...replay.dirtyChunkOrdinals].some(ordinal => (
        (replay.chunks[ordinal]?.records.length ?? 0) >= RECORDS_PER_CHUNK
      ));
      if (replay.flushRequested || fullChunkWaiting) {
        scheduleDirtyChunkWrite(replay, replay.flushRequested);
      }
    }
  });
}

async function trimOwner(ownerUserId: string, keepActivityId: string): Promise<void> {
  const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(ownerPrefix(ownerUserId)));
  const activityIds = new Map<string, number>();
  for (const key of keys.filter(value => value.endsWith(':meta'))) {
    const raw = await storage.getItemStrict(key);
    try {
      const meta = raw ? JSON.parse(raw) as ActivityDiagnosticReplayMeta : null;
      if (meta?.clientActivityId) activityIds.set(meta.clientActivityId, meta.enabledAtMs ?? 0);
    } catch { /* malformed entries are retained and reported on export */ }
  }
  const evicted = [...activityIds.entries()]
    .filter(([activityId]) => activityId !== keepActivityId)
    .sort((left, right) => right[1] - left[1])
    .slice(MAX_ACTIVITIES_PER_OWNER - 1)
    .map(([activityId]) => activityId);
  for (const activityId of evicted) {
    const identity = activityKey(ownerUserId, activityId);
    const active = activeReplays.get(identity);
    if (active) await active.tail.catch(() => undefined);
    activeReplays.delete(identity);
    const prefix = `${identity}:`;
    await storage.removeItemsStrict(keys.filter(key => key.startsWith(prefix)));
  }
}

async function recoverActivityDiagnosticReplay(
  ownerUserId: string,
  clientActivityId: string,
): Promise<ActiveReplay | null> {
  const rawMeta = await storage.getItemStrict(metaKey(ownerUserId, clientActivityId));
  if (!rawMeta) return null;
  let meta: ActivityDiagnosticReplayMeta;
  try {
    meta = JSON.parse(rawMeta) as ActivityDiagnosticReplayMeta;
  } catch {
    return null;
  }
  if (meta.schema !== 'cairn-activity-diagnostic-replay-meta'
    || meta.ownerUserId !== ownerUserId
    || meta.clientActivityId !== clientActivityId) return null;

  const prefix = `${activityKey(ownerUserId, clientActivityId)}:chunk:`;
  const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(prefix)).sort();
  const chunks: ActivityDiagnosticReplayChunk[] = [];
  let durableShapeValid = true;
  for (const key of keys) {
    const raw = await storage.getItemStrict(key);
    try {
      const chunk = raw ? JSON.parse(raw) as ActivityDiagnosticReplayChunk : null;
      if (!chunk
        || chunk.schema !== 'cairn-activity-diagnostic-replay-chunk'
        || chunk.ownerUserId !== ownerUserId
        || chunk.clientActivityId !== clientActivityId
        || !validChunkChecksum(chunk)) {
        durableShapeValid = false;
        continue;
      }
      chunks.push(chunk);
    } catch {
      durableShapeValid = false;
    }
  }
  chunks.sort((left, right) => left.chunkOrdinal - right.chunkOrdinal);
  const records = chunks.flatMap(chunk => chunk.records);
  durableShapeValid = durableShapeValid
    && chunks.every((chunk, index) => chunk.chunkOrdinal === index)
    && records.every((record, index) => record.ordinal === index)
    && chunks.length === meta.chunkCount
    && records.length === meta.recordCount;
  const finish = [...records].reverse().find(record => record.kind === 'diagnostic-finish');
  const recordingFinishedAtMs = meta.recordingFinishedAtMs
    ?? meta.disabledAtMs
    ?? finish?.wallTimeMs
    ?? null;
  const recordingState = meta.recordingState
    ?? (recordingFinishedAtMs == null ? 'recording' : 'finished');
  const recoveredDuringRecording = recordingState === 'recording';
  const replay: ActiveReplay = {
    ownerUserId,
    clientActivityId,
    enabledAtMs: meta.enabledAtMs,
    chunks,
    recordCount: records.length,
    persistedBytes: records.reduce((total, record) => total + recordBytes(record), 0),
    tail: Promise.resolve(),
    pendingWriteCount: 0,
    dirtyChunkOrdinals: new Set(),
    writeScheduled: false,
    flushRequested: false,
    complete: meta.complete === true && durableShapeValid,
    incompleteReason: durableShapeValid
      ? meta.incompleteReason
      : 'missing-or-inconsistent-durable-records',
    recordingState,
    recordingFinishedAtMs,
    recoveryCount: Math.max(0, meta.recoveryCount ?? 0) + 1,
    // There is no honest way to infer whether a partially filled in-memory
    // chunk existed at process death. Preserve the durable prefix, continue
    // appending, and make that uncertainty fail-visible in every export.
    volatileTailMayBeMissing: !!meta.volatileTailMayBeMissing || recoveredDuringRecording,
  };
  activeReplays.set(activityKey(ownerUserId, clientActivityId), replay);
  await storage.setItem(metaKey(ownerUserId, clientActivityId), JSON.stringify(metaSnapshot(replay)), {
    strict: true,
  });
  return replay;
}

function ensureActivityDiagnosticReplay(
  ownerUserId: string,
  clientActivityId: string,
): Promise<ActiveReplay | null> {
  const identity = activityKey(ownerUserId, clientActivityId);
  const active = activeReplays.get(identity);
  if (active) return Promise.resolve(active);
  const pending = replayRecovery.get(identity);
  if (pending) return pending;
  const recovery = recoverActivityDiagnosticReplay(ownerUserId, clientActivityId)
    .finally(() => replayRecovery.delete(identity));
  replayRecovery.set(identity, recovery);
  return recovery;
}

/** Explicit opt-in. It is never called by normal Activity start or upload. */
export async function beginActivityDiagnosticReplay(input: {
  ownerUserId: string;
  clientActivityId: string;
  mode: 'hiking' | 'running';
  source: 'real' | 'simulator';
  wallTimeMs?: number;
}): Promise<void> {
  if (!input.ownerUserId || !input.clientActivityId) throw new Error('diagnostic_replay_identity_required');
  const identity = activityKey(input.ownerUserId, input.clientActivityId);
  const existing = await ensureActivityDiagnosticReplay(input.ownerUserId, input.clientActivityId);
  if (existing) {
    if (existing.recordingState === 'finished') {
      throw new Error('diagnostic_replay_identity_already_finished');
    }
    // Start can be called again during recovery or a double-tap. The durable
    // stream is append-only: never erase already captured evidence.
    return;
  }
  await trimOwner(input.ownerUserId, input.clientActivityId);
  const replay: ActiveReplay = {
    ownerUserId: input.ownerUserId,
    clientActivityId: input.clientActivityId,
    enabledAtMs: Math.floor(input.wallTimeMs ?? Date.now()),
    chunks: [],
    recordCount: 0,
    persistedBytes: 0,
    tail: Promise.resolve(),
    pendingWriteCount: 0,
    dirtyChunkOrdinals: new Set(),
    writeScheduled: false,
    flushRequested: false,
    complete: true,
    incompleteReason: null,
    recordingState: 'recording',
    recordingFinishedAtMs: null,
    recoveryCount: 0,
    volatileTailMayBeMissing: false,
  };
  activeReplays.set(identity, replay);
  await recordActivityDiagnosticReplayEvent({
    ...input,
    kind: 'diagnostic-start',
    data: { mode: input.mode, source: input.source, cleanGroundTruthAvailable: false },
  });
  await flushActivityDiagnosticReplay(input.ownerUserId, input.clientActivityId);
}

export async function recordActivityDiagnosticReplayEvent(input: {
  ownerUserId: string;
  clientActivityId: string;
  kind: ActivityDiagnosticReplayKind;
  data: Record<string, unknown>;
  wallTimeMs?: number;
  monotonicTimeMs?: number | null;
}): Promise<void> {
  const replay = activeReplays.get(activityKey(input.ownerUserId, input.clientActivityId))
    ?? await ensureActivityDiagnosticReplay(input.ownerUserId, input.clientActivityId);
  if (!replay || !replay.complete) return Promise.resolve();
  if (replay.recordingState === 'finished'
    && input.kind !== 'provider-exchange'
    && input.kind !== 'application-event') return Promise.resolve();
  const record: ActivityDiagnosticReplayRecord = {
    ordinal: replay.recordCount,
    kind: input.kind,
    wallTimeMs: Math.floor(input.wallTimeMs ?? Date.now()),
    monotonicTimeMs: input.monotonicTimeMs === undefined
      ? globalThis.performance?.now?.() ?? null
      : input.monotonicTimeMs,
    data: input.data,
  };
  const bytes = recordBytes(record);
  let dirtyChunkOrdinal = replay.chunks.length - 1;
  let chunkCompleted = false;
  if (replay.persistedBytes + bytes > MAX_PERSISTED_BYTES) {
    replay.complete = false;
    replay.incompleteReason = 'bounded-storage-budget-exhausted';
  } else {
    let chunk = replay.chunks[replay.chunks.length - 1];
    if (!chunk || chunk.records.length >= RECORDS_PER_CHUNK) {
      chunk = {
        schema: 'cairn-activity-diagnostic-replay-chunk',
        version: 1,
        ownerUserId: input.ownerUserId,
        clientActivityId: input.clientActivityId,
        chunkOrdinal: replay.chunks.length,
        firstRecordOrdinal: record.ordinal,
        lastRecordOrdinal: record.ordinal,
        records: [],
        checksumAlgorithm: 'fnv1a32',
        checksum: '',
      };
      replay.chunks.push(chunk);
    }
    dirtyChunkOrdinal = chunk.chunkOrdinal;
    chunk.records.push(record);
    chunk.lastRecordOrdinal = record.ordinal;
    chunkCompleted = chunk.records.length >= RECORDS_PER_CHUNK;
    replay.recordCount += 1;
    replay.persistedBytes += bytes;
  }
  if (dirtyChunkOrdinal >= 0) replay.dirtyChunkOrdinals.add(dirtyChunkOrdinal);
  // Raw observations remain synchronous and cheap. A completed chunk is a
  // natural durability boundary; lifecycle/stage events additionally flush
  // the current partial chunk so backgrounding and Save are crash-resilient.
  if (chunkCompleted) scheduleDirtyChunkWrite(replay);
  else if (input.kind === 'application-event'
    || input.kind === 'provider-exchange'
    || input.kind === 'diagnostic-finish') scheduleDirtyChunkWrite(replay, true);
  return Promise.resolve();
}

export function recordActivityDiagnosticObservation(input: {
  ownerUserId: string;
  clientActivityId: string;
  coordinate: {
    lat: number; lng: number; alt?: number | null; accuracy?: number | null;
    verticalAccuracy?: number | null; speed?: number | null; speedAccuracy?: number | null;
    course?: number | null; courseAccuracy?: number | null; source?: string;
    callbackIdentity?: string; nativeBatchSequence?: number; nativeBatchIndex?: number;
    appStateAtReceipt?: string; receiptWallTimeMs?: number; receiptMonotonicTimeMs?: number | null;
    receiptEvidenceId?: string; ownerGeneration?: string;
  };
  observationTimeMs: number;
}): Promise<void> {
  const value = input.coordinate;
  return recordActivityDiagnosticReplayEvent({
    ownerUserId: input.ownerUserId,
    clientActivityId: input.clientActivityId,
    kind: 'raw-observation',
    wallTimeMs: value.receiptWallTimeMs,
    monotonicTimeMs: value.receiptMonotonicTimeMs,
    data: {
      observationTimeMs: input.observationTimeMs,
      receiptWallTimeMs: value.receiptWallTimeMs ?? Date.now(),
      lat: value.lat,
      lng: value.lng,
      altitudeM: value.alt ?? null,
      horizontalAccuracyM: value.accuracy ?? null,
      verticalAccuracyM: value.verticalAccuracy ?? null,
      speedMps: value.speed ?? null,
      speedAccuracyMps: value.speedAccuracy ?? null,
      courseDeg: value.course ?? null,
      courseAccuracyDeg: value.courseAccuracy ?? null,
      source: value.source ?? 'foreground',
      callbackIdentity: value.callbackIdentity ?? null,
      nativeBatchSequence: value.nativeBatchSequence ?? null,
      nativeBatchIndex: value.nativeBatchIndex ?? null,
      appStateAtReceipt: value.appStateAtReceipt ?? null,
      receiptEvidenceId: value.receiptEvidenceId ?? null,
      ownerGeneration: value.ownerGeneration ?? null,
    },
  });
}

export function recordActivityDiagnosticDecision(input: {
  ownerUserId: string;
  clientActivityId: string;
  observationTimeMs: number;
  accepted: boolean;
  reason: string;
  segmentId: string | null;
  receiptEvidenceId?: string | null;
}): Promise<void> {
  return recordActivityDiagnosticReplayEvent({
    ownerUserId: input.ownerUserId,
    clientActivityId: input.clientActivityId,
    kind: 'observation-decision',
    data: input,
  });
}

/**
 * A continuity candidate can be quarantined on receipt, then promoted only
 * after a later observation corroborates it. Keep that second decision
 * explicit: rewriting the original receipt decision would destroy the actual
 * sequence and make post-hoc replay impossible.
 */
export function recordActivityDiagnosticCanonicalPromotion(input: {
  ownerUserId: string;
  clientActivityId: string;
  observationTimeMs: number;
  promotedByObservationTimeMs: number;
  reason: string;
  segmentId: string | null;
  receiptEvidenceId?: string | null;
}): Promise<void> {
  return recordActivityDiagnosticReplayEvent({
    ownerUserId: input.ownerUserId,
    clientActivityId: input.clientActivityId,
    kind: 'canonical-promotion',
    data: input,
  });
}

export function recordActivityDiagnosticProviderExchange(input: {
  ownerUserId: string;
  clientActivityId: string;
  exchange: ActivityDiagnosticProviderExchange;
}): Promise<void> {
  return recordActivityDiagnosticReplayEvent({
    ownerUserId: input.ownerUserId,
    clientActivityId: input.clientActivityId,
    kind: 'provider-exchange',
    data: input.exchange as unknown as Record<string, unknown>,
  });
}

export async function flushActivityDiagnosticReplay(
  ownerUserId: string,
  clientActivityId: string,
): Promise<void> {
  const replay = activeReplays.get(activityKey(ownerUserId, clientActivityId));
  if (!replay) return;
  do {
    scheduleDirtyChunkWrite(replay, true);
    await replay.tail;
  } while (replay.writeScheduled || replay.dirtyChunkOrdinals.size > 0);
}

export async function finishActivityDiagnosticReplay(
  ownerUserId: string,
  clientActivityId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const replay = activeReplays.get(activityKey(ownerUserId, clientActivityId))
    ?? await ensureActivityDiagnosticReplay(ownerUserId, clientActivityId);
  if (!replay) return;
  if (replay.recordingState === 'finished') return;
  await recordActivityDiagnosticReplayEvent({
    ownerUserId,
    clientActivityId,
    kind: 'diagnostic-finish',
    data,
  });
  replay.recordingState = 'finished';
  replay.recordingFinishedAtMs = Date.now();
  await flushActivityDiagnosticReplay(ownerUserId, clientActivityId);
  await storage.setItem(
    metaKey(ownerUserId, clientActivityId),
    JSON.stringify(metaSnapshot(replay)),
    { strict: true },
  );
}

function validChunkChecksum(chunk: ActivityDiagnosticReplayChunk): boolean {
  const { checksum, ...withoutChecksum } = chunk;
  return checksum === chunkChecksum(withoutChecksum);
}

export async function exportActivityDiagnosticReplay(input: {
  ownerUserId: string;
  clientActivityId: string;
  stageLedger?: ActivityStageLedgerExport | null;
  finalArtifact?: Record<string, unknown> | null;
  providerReceipts?: unknown[];
  providerResponses?: unknown[];
}): Promise<ActivityDiagnosticReplayExport> {
  await flushActivityDiagnosticReplay(input.ownerUserId, input.clientActivityId);
  const prefix = `${activityKey(input.ownerUserId, input.clientActivityId)}:chunk:`;
  const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(prefix)).sort();
  const parsedChunks: ActivityDiagnosticReplayChunk[] = [];
  for (const key of keys) {
    const raw = await storage.getItemStrict(key);
    try {
      const parsed = raw ? JSON.parse(raw) as ActivityDiagnosticReplayChunk : null;
      if (parsed?.schema === 'cairn-activity-diagnostic-replay-chunk') parsedChunks.push(parsed);
    } catch { /* completeness below is fail-visible */ }
  }
  const rawMeta = await storage.getItemStrict(metaKey(input.ownerUserId, input.clientActivityId));
  let meta: ActivityDiagnosticReplayMeta | null = null;
  try { meta = rawMeta ? JSON.parse(rawMeta) as ActivityDiagnosticReplayMeta : null; } catch { /* fail-visible */ }
  const records = parsedChunks.flatMap(chunk => chunk.records).sort((left, right) => left.ordinal - right.ordinal);
  const contiguousRecordOrdinals = records.every((record, index) => record.ordinal === index);
  const everyChunkChecksumValid = parsedChunks.every(validChunkChecksum);
  const pendingWriteCount = activeReplays.get(activityKey(input.ownerUserId, input.clientActivityId))?.pendingWriteCount ?? 0;
  const providerExchanges = records
    .filter(record => record.kind === 'provider-exchange')
    .map(record => record.data as unknown as ActivityDiagnosticProviderExchange);
  const recordedProviderReceipts = providerExchanges.filter(item => item.phase === 'request');
  const recordedProviderResponses = providerExchanges.filter(item => item.phase === 'response');
  const finishedArtifact = [...records].reverse().find(record => (
    record.kind === 'diagnostic-finish'
    && record.data.finalArtifact
  ))?.data.finalArtifact as Record<string, unknown> | undefined;
  const finishRecordIndex = records.findIndex(record => record.kind === 'diagnostic-finish');
  const recordingFinished = (meta?.recordingState === 'finished' || meta?.disabledAtMs != null)
    && finishRecordIndex >= 0;
  const recoveryCount = Math.max(0, meta?.recoveryCount ?? 0);
  const volatileTailMayBeMissing = !!meta?.volatileTailMayBeMissing;
  const postFinishRecordCount = finishRecordIndex < 0
    ? 0
    : records.slice(finishRecordIndex + 1).filter(record => (
      record.kind === 'provider-exchange' || record.kind === 'application-event'
    )).length;
  const declaredMissing = [
    ...(recordingFinished ? [] : ['recording-finish']),
    ...(volatileTailMayBeMissing ? ['volatile-tail-after-process-recovery'] : []),
    ...(input.stageLedger ? [] : ['stage-ledger']),
    ...(input.finalArtifact || finishedArtifact ? [] : ['final-artifact']),
  ];
  const durableRecordsComplete = meta?.complete === true
    && records.length === meta.recordCount
    && parsedChunks.length === meta.chunkCount
    && contiguousRecordOrdinals
    && everyChunkChecksumValid
    && pendingWriteCount === 0;
  const complete = durableRecordsComplete && recordingFinished && !volatileTailMayBeMissing;
  const selfContainedReplayComplete = complete && declaredMissing.length === 0;
  const startedAsLocalQa = records.find(record => record.kind === 'diagnostic-start')?.data.source === 'simulator';
  const syncEvents = records.filter(record => record.kind === 'application-event').map(record => record.data);
  const completedSyncPhases = syncEvents
    .filter(data => data.event === 'completed-activity-sync')
    .map(data => String(data.phase ?? ''));
  const completedUploadStagePhases = syncEvents.flatMap(data => {
    if (data.stage !== 'sync-state') return [];
    const details = data.details as Record<string, unknown> | null | undefined;
    return details?.operation === 'completed-activity-upload' ? [String(details.phase ?? '')] : [];
  });
  const syncTerminalState = startedAsLocalQa
    ? 'not-applicable-local-qa' as const
    : completedSyncPhases.includes('phone-cleanup-complete')
      ? 'acknowledged-cleanup-complete' as const
      : completedSyncPhases.includes('ack') || completedUploadStagePhases.includes('ack')
        ? 'acknowledged-cleanup-pending' as const
        : completedUploadStagePhases.some(phase => ['failed', 'unavailable', 'conflict'].includes(phase))
          ? 'failed-retryable-or-terminal' as const
          : completedSyncPhases.includes('attempt') || completedUploadStagePhases.includes('attempt')
            ? 'attempting-or-pending' as const
            : 'not-recorded' as const;
  const fullLifecycleComplete = selfContainedReplayComplete
    && syncTerminalState === 'acknowledged-cleanup-complete';
  const fullLifecycleReason = fullLifecycleComplete
    ? null
    : !selfContainedReplayComplete
      ? 'tracking-replay-inputs-incomplete'
      : syncTerminalState === 'not-applicable-local-qa'
        ? 'local-qa-recording-has-no-production-sync-lifecycle'
        : `completed-activity-sync:${syncTerminalState}`;
  const reason = !durableRecordsComplete
    ? meta?.incompleteReason ?? 'missing-or-inconsistent-durable-records'
    : !recordingFinished
      ? 'recording-not-finished'
      : volatileTailMayBeMissing
        ? 'volatile-tail-may-be-missing-after-process-recovery'
        : null;
  return {
    schema: 'cairn-activity-diagnostic-replay-export',
    version: 2,
    exportedAt: new Date().toISOString(),
    ownerUserId: 'current-owner',
    clientActivityId: input.clientActivityId,
    privacy: { localOnly: true, explicitOptIn: true, coordinatesIncluded: true, automaticUpload: false },
    completeness: {
      complete,
      reason,
      chunkCount: parsedChunks.length,
      recordCount: records.length,
      contiguousRecordOrdinals,
      everyChunkChecksumValid,
      pendingWriteCount,
      durableRecordsComplete,
      recordingFinished,
      selfContainedReplayComplete,
      replayScope: 'tracking-replay-inputs-only',
      syncTerminalState,
      fullLifecycleComplete,
      fullLifecycleReason,
      recoveryCount,
      volatileTailMayBeMissing,
      postFinishRecordCount,
    },
    checksumAlgorithm: 'fnv1a32',
    recordsChecksum: fnv1a32(JSON.stringify(records)),
    records,
    stageLedger: input.stageLedger ?? null,
    finalArtifact: input.finalArtifact ?? finishedArtifact ?? null,
    providerReceipts: input.providerReceipts ?? recordedProviderReceipts,
    providerResponses: input.providerResponses ?? recordedProviderResponses,
    declaredMissing,
  };
}

/** Export only the explicitly selected Activity. Unlike the legacy "latest"
 * helper, this cannot silently pair one Activity's timing ledger with another
 * Activity's coordinate stream. */
export async function exportActivityDiagnosticReplayIfPresent(input: {
  ownerUserId: string;
  clientActivityId: string;
  stageLedger?: ActivityStageLedgerExport | null;
}): Promise<ActivityDiagnosticReplayExport | null> {
  const rawMeta = await storage.getItemStrict(metaKey(input.ownerUserId, input.clientActivityId));
  if (!rawMeta) return null;
  return exportActivityDiagnosticReplay(input);
}

/**
 * Reconstruct the latest explicitly enabled real-Activity diagnostic after a
 * cold reopen. The stream itself remains the durable authority; this helper
 * deliberately avoids a second full export copy in AsyncStorage.
 */
export async function exportLatestActivityDiagnosticReplay(
  ownerUserId: string,
  stageLedger?: ActivityStageLedgerExport | null,
): Promise<ActivityDiagnosticReplayExport | null> {
  const keys = (await storage.getAllKeysStrict()).filter(key => (
    key.startsWith(ownerPrefix(ownerUserId)) && key.endsWith(':meta')
  ));
  const candidates: ActivityDiagnosticReplayMeta[] = [];
  for (const key of keys) {
    const raw = await storage.getItemStrict(key);
    try {
      const parsed = raw ? JSON.parse(raw) as ActivityDiagnosticReplayMeta : null;
      if (parsed?.ownerUserId === ownerUserId && parsed.clientActivityId) candidates.push(parsed);
    } catch { /* malformed metadata is ignored; direct export remains fail-visible */ }
  }
  const latest = candidates.sort((left, right) => right.enabledAtMs - left.enabledAtMs)[0];
  if (!latest) return null;
  return exportActivityDiagnosticReplay({
    ownerUserId,
    clientActivityId: latest.clientActivityId,
    stageLedger: stageLedger?.clientActivityId === latest.clientActivityId ? stageLedger : null,
  });
}

export function replayObservationsFromDiagnosticExport(value: ActivityDiagnosticReplayExport): Array<{
  timestampMs: number;
  coordinate: Record<string, unknown>;
}> {
  if (!value.completeness.complete) throw new Error('diagnostic_replay_incomplete');
  if (fnv1a32(JSON.stringify(value.records)) !== value.recordsChecksum) {
    throw new Error('diagnostic_replay_export_checksum_mismatch');
  }
  return value.records.filter(record => record.kind === 'raw-observation').map(record => ({
    timestampMs: Number(record.data.observationTimeMs),
    coordinate: {
      lat: record.data.lat,
      lng: record.data.lng,
      alt: record.data.altitudeM,
      accuracy: record.data.horizontalAccuracyM,
      verticalAccuracy: record.data.verticalAccuracyM,
      speed: record.data.speedMps,
      speedAccuracy: record.data.speedAccuracyMps,
      course: record.data.courseDeg,
      courseAccuracy: record.data.courseAccuracyDeg,
      source: record.data.source,
      callbackIdentity: record.data.callbackIdentity,
      nativeBatchSequence: record.data.nativeBatchSequence,
      nativeBatchIndex: record.data.nativeBatchIndex,
      appStateAtReceipt: record.data.appStateAtReceipt,
      receiptEvidenceId: record.data.receiptEvidenceId,
      ownerGeneration: record.data.ownerGeneration,
      receiptWallTimeMs: record.data.receiptWallTimeMs,
      receiptMonotonicTimeMs: record.monotonicTimeMs,
    },
  }));
}

export async function purgeActivityDiagnosticReplayForOwner(ownerUserId: string): Promise<void> {
  const pendingRecoveries = [...replayRecovery.entries()]
    .filter(([key]) => key.startsWith(ownerPrefix(ownerUserId)));
  await Promise.all(pendingRecoveries.map(([, recovery]) => recovery.catch(() => null)));
  pendingRecoveries.forEach(([key]) => replayRecovery.delete(key));
  for (const [key, replay] of activeReplays) {
    if (replay.ownerUserId !== ownerUserId) continue;
    await replay.tail.catch(() => undefined);
    activeReplays.delete(key);
  }
  const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(ownerPrefix(ownerUserId)));
  await storage.removeItemsStrict(keys);
}

export function activityDiagnosticReplayOwnerPrefix(ownerUserId: string): string {
  return ownerPrefix(ownerUserId);
}
