import { storage } from '../store/storage';
import networkMonitor from './networkMonitor';
import {
  sanitizePreciseOwnerDiagnosticEvent,
  sanitizeTelemetryEventForUpload,
} from './telemetryPrivacy';

const ROOT = '@cairn:automatic-diagnostics:v1:';
const MAX_TIER_A_EVENTS_PER_OWNER = 600;
const MAX_TIER_A_BYTES_PER_OWNER = 512 * 1024;
const MAX_TIER_B_EVENTS_PER_OWNER = 6_000;
const MAX_TIER_B_BYTES_PER_OWNER = 5 * 1024 * 1024;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_BATCH_BYTES = 60 * 1024;
const MAX_EVENT_DETAILS_BYTES = 8 * 1024;
const MAX_RECENT_ACKED_STREAMS = 128;
const POLICY_CACHE_MS = 6 * 60 * 60 * 1000;
const TIER_A_FREE_TEXT_FIELD = /(?:message|msg|stack|body|text|title|name|note|description|content|diagnostic|url|uri)$/i;

export type AutomaticDiagnosticSourceType = 'activity' | 'memory' | 'route' | 'app';

export interface AutomaticDiagnosticStream {
  streamId: string;
  sourceType: AutomaticDiagnosticSourceType;
  ownerEpoch?: string;
  clientActivityId?: string;
  clientRouteId?: string;
  routeEditSessionId?: string;
  memoryScopeId?: string;
  activityMode?: 'hiking' | 'running';
  runtimeVersion?: string | null;
  updateId?: string | null;
}

export interface AutomaticDiagnosticInput {
  ownerUserId: string;
  stream: AutomaticDiagnosticStream;
  eventId?: string;
  eventCode: string;
  sourceModule: string;
  severity?: 'info' | 'warn' | 'error';
  eventAt?: number;
  monotonicMs?: number | null;
  details?: Record<string, unknown>;
  requiredPolicyTier?: 'tier_a' | 'tier_b';
}

interface QueuedAutomaticDiagnostic {
  schema: 'cairn-auto-diagnostic-event';
  version: 1;
  eventId: string;
  queueSequence: number;
  streamSequence: number;
  stream: AutomaticDiagnosticStream;
  eventCode: string;
  sourceModule: string;
  severity: 'info' | 'warn' | 'error';
  eventAt: number;
  monotonicMs: number | null;
  details: Record<string, unknown>;
  requiredPolicyTier: 'tier_a' | 'tier_b';
  capturedAt: number;
  approximateBytes: number;
}

interface StreamStatus {
  clientActivityId: string | null;
  clientRouteId: string | null;
  lastCapturedAt: number | null;
  lastDurablyQueuedAt: number | null;
  lastAttemptAt: number | null;
  lastServerAckAt: number | null;
  coverageStart: number | null;
  coverageEnd: number | null;
  sourceTypesAvailable: AutomaticDiagnosticSourceType[];
  droppedCount: number;
  failedWriteCount: number;
  lastFailure: string | null;
  nextSequence: number;
  consecutiveUploadFailures: number;
  nextAttemptAt: number | null;
  quarantinedCount: number;
  quarantinedThroughSequence: number;
}

interface OwnerMeta {
  schema: 'cairn-auto-diagnostic-owner-meta';
  version: 1;
  ownerEpoch: string;
  policy: 'unknown' | 'tier_a' | 'tier_b' | 'disabled';
  policyCheckedAt: number | null;
  policyExpiresAt: number | null;
  pendingCount: number;
  pendingBytes: number;
  streams: Record<string, StreamStatus>;
}

export interface AutomaticDiagnosticStatus extends StreamStatus {
  pendingCount: number;
  pendingBytes: number;
  quality:
    | 'NOT_CAPTURED'
    | 'CAPTURED_NOT_UPLOADED'
    | 'UPLOAD_PENDING'
    | 'SERVER_ACKED'
    | 'RETENTION_TRUNCATED'
    | 'UPLOAD_INCOMPLETE'
    | 'POLICY_DISABLED'
    | 'UNKNOWN';
}

const tails = new Map<string, Promise<unknown>>();
let eventCounter = 0;
const processSalt = Math.floor(Math.random() * 1_000);

function diagnosticAuthenticatedFetch(path: string, init: Record<string, unknown>): Promise<Response> {
  // Keep durable capture and privacy deletion storage-only. Loading the auth/
  // crash stack is deferred until an existing sync opportunity actually sends.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./apiService').authenticatedFetch(path, init);
}

function ownerPart(ownerUserId: string): string {
  return encodeURIComponent(String(ownerUserId));
}

function ownerPrefix(ownerUserId: string): string {
  return `${ROOT}${ownerPart(ownerUserId)}:`;
}

function eventPrefix(ownerUserId: string): string {
  return `${ownerPrefix(ownerUserId)}event:`;
}

function metaKey(ownerUserId: string): string {
  return `${ownerPrefix(ownerUserId)}meta`;
}

function emptyStatus(): StreamStatus {
  return {
    clientActivityId: null,
    clientRouteId: null,
    lastCapturedAt: null,
    lastDurablyQueuedAt: null,
    lastAttemptAt: null,
    lastServerAckAt: null,
    coverageStart: null,
    coverageEnd: null,
    sourceTypesAvailable: [],
    droppedCount: 0,
    failedWriteCount: 0,
    lastFailure: null,
    nextSequence: 1,
    consecutiveUploadFailures: 0,
    nextAttemptAt: null,
    quarantinedCount: 0,
    quarantinedThroughSequence: 0,
  };
}

function emptyMeta(): OwnerMeta {
  return {
    schema: 'cairn-auto-diagnostic-owner-meta',
    version: 1,
    ownerEpoch: `oe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    policy: 'unknown',
    policyCheckedAt: null,
    policyExpiresAt: null,
    pendingCount: 0,
    pendingBytes: 0,
    streams: {},
  };
}

async function readMeta(ownerUserId: string): Promise<OwnerMeta> {
  const raw = await storage.getItemStrict(metaKey(ownerUserId));
  if (!raw) return emptyMeta();
  try {
    const parsed = JSON.parse(raw) as OwnerMeta;
    if (parsed?.schema === 'cairn-auto-diagnostic-owner-meta' && parsed.version === 1) {
      parsed.pendingCount = Math.max(0, Number(parsed.pendingCount) || 0);
      parsed.pendingBytes = Math.max(0, Number(parsed.pendingBytes) || 0);
      parsed.ownerEpoch = safeIdentifier(parsed.ownerEpoch || emptyMeta().ownerEpoch, 64);
      parsed.policyExpiresAt = parsed.policyExpiresAt == null
        ? null : Number.isFinite(Number(parsed.policyExpiresAt)) ? Number(parsed.policyExpiresAt) : null;
      for (const status of Object.values(parsed.streams ?? {})) {
        status.clientActivityId = status.clientActivityId == null ? null : String(status.clientActivityId);
        status.clientRouteId = status.clientRouteId == null ? null : String(status.clientRouteId);
        status.coverageStart = status.coverageStart == null
          ? null : Number.isFinite(Number(status.coverageStart)) ? Number(status.coverageStart) : null;
        status.coverageEnd = status.coverageEnd == null
          ? null : Number.isFinite(Number(status.coverageEnd)) ? Number(status.coverageEnd) : null;
        status.sourceTypesAvailable = Array.isArray(status.sourceTypesAvailable)
          ? status.sourceTypesAvailable.filter(source => ['activity', 'memory', 'route', 'app'].includes(source))
          : [];
        status.nextSequence = Math.max(1, Number(status.nextSequence) || 1);
        status.consecutiveUploadFailures = Math.max(0, Number(status.consecutiveUploadFailures) || 0);
        status.nextAttemptAt = status.nextAttemptAt == null
          ? null : Number.isFinite(Number(status.nextAttemptAt)) ? Number(status.nextAttemptAt) : null;
        status.quarantinedCount = Math.max(0, Number(status.quarantinedCount) || 0);
        status.quarantinedThroughSequence = Math.max(0, Number(status.quarantinedThroughSequence) || 0);
      }
      return parsed;
    }
  } catch { /* corruption is repaired by a new bounded metadata snapshot */ }
  return emptyMeta();
}

async function writeMeta(ownerUserId: string, meta: OwnerMeta): Promise<void> {
  await storage.setItem(metaKey(ownerUserId), JSON.stringify(meta), { strict: true });
}

function serializeOwnerWork<T>(ownerUserId: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(ownerUserId)?.catch(() => undefined) ?? Promise.resolve();
  const next = previous.then(work);
  tails.set(ownerUserId, next);
  void next.finally(() => {
    if (tails.get(ownerUserId) === next) tails.delete(ownerUserId);
  }).catch(() => undefined);
  return next;
}

function eventStorageKey(ownerUserId: string, eventId: string, streamId?: string): string {
  return `${eventPrefix(ownerUserId)}${streamId ? `${encodeURIComponent(streamId)}:` : ''}${eventId}`;
}

async function readOwnerEvents(ownerUserId: string): Promise<Array<{ key: string; event: QueuedAutomaticDiagnostic }>> {
  const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(eventPrefix(ownerUserId))).sort();
  const values = await Promise.all(keys.map(key => storage.getItemStrict(key)));
  return values.flatMap((raw, index) => {
    if (!raw) return [];
    try {
      const event = JSON.parse(raw) as QueuedAutomaticDiagnostic;
      return event?.schema === 'cairn-auto-diagnostic-event' && event.version === 1
        ? [{ key: keys[index], event }]
        : [];
    } catch { return []; }
  }).sort((left, right) => (
    left.event.queueSequence - right.event.queueSequence
    || left.event.eventId.localeCompare(right.event.eventId)
  ));
}

async function repairCorruptedOwnerEvents(ownerUserId: string, meta: OwnerMeta): Promise<void> {
  const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(eventPrefix(ownerUserId))).sort();
  if (keys.length === 0) return;
  const values = await Promise.all(keys.map(key => storage.getItemStrict(key)));
  const corrupted: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const raw = values[index];
    try {
      const event = raw ? JSON.parse(raw) as QueuedAutomaticDiagnostic : null;
      if (event?.schema === 'cairn-auto-diagnostic-event' && event.version === 1) continue;
    } catch { /* handled below */ }
    corrupted.push(keys[index]);
    const suffix = keys[index].slice(eventPrefix(ownerUserId).length);
    const separator = suffix.indexOf(':');
    let recoveredStreamId = '__owner_corrupt__';
    if (separator > 0) {
      try { recoveredStreamId = decodeURIComponent(suffix.slice(0, separator)); } catch { /* malformed key */ }
    }
    const status = meta.streams[recoveredStreamId] ?? emptyStatus();
    status.droppedCount += 1;
    status.lastFailure = 'LOCAL_DIAGNOSTIC_EVENT_CORRUPT';
    meta.streams[recoveredStreamId] = status;
  }
  if (corrupted.length === 0) return;
  await storage.removeItemsStrict(corrupted);
  const valid = await readOwnerEvents(ownerUserId);
  meta.pendingCount = valid.length;
  meta.pendingBytes = valid.reduce((sum, item) => sum + item.event.approximateBytes, 0);
  await writeMeta(ownerUserId, meta);
}

function safeIdentifier(value: string, max: number): string {
  return String(value).replace(/[^A-Za-z0-9:._-]/g, '_').slice(0, max);
}

function tierASafeDetails(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return /^[A-Za-z0-9_.:+-]{1,160}$/.test(value) ? value : '[redacted-free-text]';
  }
  if (Array.isArray(value)) return value.slice(0, 64).map(item => tierASafeDetails(item, depth + 1));
  if (typeof value !== 'object') return null;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (TIER_A_FREE_TEXT_FIELD.test(key)) continue;
    output[key] = tierASafeDetails(nested, depth + 1);
  }
  return output;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xDC00
      && value.charCodeAt(index + 1) <= 0xDFFF) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function policyCacheIsFresh(meta: OwnerMeta, now = Date.now()): boolean {
  if (meta.policyCheckedAt == null) return false;
  const age = now - meta.policyCheckedAt;
  return age >= 0 && age < POLICY_CACHE_MS;
}

function policyAuthorizesCapture(meta: OwnerMeta, now = Date.now()): boolean {
  return policyCacheIsFresh(meta, now)
    && (meta.policy === 'tier_a' || meta.policy === 'tier_b')
    && (meta.policyExpiresAt == null || meta.policyExpiresAt > now);
}

function makeEvent(
  input: AutomaticDiagnosticInput,
  streamSequence: number,
  ownerEpoch: string,
  policyTier: 'tier_a' | 'tier_b',
): QueuedAutomaticDiagnostic {
  const eventAt = Math.max(0, Math.floor(input.eventAt ?? Date.now()));
  eventCounter = (eventCounter + 1) % 1_000;
  const queueSequence = eventAt * 1_000 + ((processSalt + eventCounter) % 1_000);
  const eventId = input.eventId
    ? safeIdentifier(input.eventId, 96)
    : `${eventAt.toString(36)}-${queueSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const requiredPolicyTier = input.requiredPolicyTier ?? 'tier_a';
  const safe = requiredPolicyTier === 'tier_b' && policyTier === 'tier_b'
    ? sanitizePreciseOwnerDiagnosticEvent({ fields: tierASafeDetails(input.details ?? {}) })
    : sanitizeTelemetryEventForUpload({ fields: tierASafeDetails(input.details ?? {}) });
  const sanitizedDetails = (safe.fields ?? {}) as Record<string, unknown>;
  const detailsBytes = utf8ByteLength(JSON.stringify(sanitizedDetails));
  const boundedDetails = detailsBytes <= MAX_EVENT_DETAILS_BYTES
    ? sanitizedDetails
    : {
      diagnosticDetailsTruncated: true,
      originalApproximateBytes: detailsBytes,
    };
  const base = {
    schema: 'cairn-auto-diagnostic-event' as const,
    version: 1 as const,
    eventId,
    queueSequence,
    streamSequence,
    stream: {
      ...input.stream,
      streamId: safeIdentifier(input.stream.streamId, 96),
      ownerEpoch: safeIdentifier(ownerEpoch, 64),
      ...(input.stream.routeEditSessionId
        ? { routeEditSessionId: safeIdentifier(input.stream.routeEditSessionId, 96) } : {}),
      ...(input.stream.memoryScopeId
        ? { memoryScopeId: safeIdentifier(input.stream.memoryScopeId, 96) } : {}),
    },
    eventCode: safeIdentifier(input.eventCode, 64),
    sourceModule: safeIdentifier(input.sourceModule, 64),
    severity: input.severity ?? 'info',
    eventAt,
    monotonicMs: input.monotonicMs == null ? null : Math.max(0, Number(input.monotonicMs)),
    details: boundedDetails,
    requiredPolicyTier,
    capturedAt: Date.now(),
  };
  const approximateBytes = JSON.stringify(base).length;
  return { ...base, approximateBytes };
}

async function enforceOwnerBounds(ownerUserId: string, meta: OwnerMeta): Promise<void> {
  const maxEvents = meta.policy === 'tier_b'
    ? MAX_TIER_B_EVENTS_PER_OWNER : MAX_TIER_A_EVENTS_PER_OWNER;
  const maxBytes = meta.policy === 'tier_b'
    ? MAX_TIER_B_BYTES_PER_OWNER : MAX_TIER_A_BYTES_PER_OWNER;
  if (meta.pendingCount <= maxEvents && meta.pendingBytes <= maxBytes) return;
  const events = await readOwnerEvents(ownerUserId);
  let bytes = events.reduce((sum, item) => sum + item.event.approximateBytes, 0);
  const remove: string[] = [];
  for (const item of events) {
    if (events.length - remove.length <= maxEvents && bytes <= maxBytes) break;
    remove.push(item.key);
    bytes -= item.event.approximateBytes;
    meta.pendingCount = Math.max(0, meta.pendingCount - 1);
    meta.pendingBytes = Math.max(0, meta.pendingBytes - item.event.approximateBytes);
    const status = meta.streams[item.event.stream.streamId] ?? emptyStatus();
    status.droppedCount += 1;
    meta.streams[item.event.stream.streamId] = status;
  }
  if (remove.length > 0) {
    await storage.removeItemsStrict(remove);
    const removed = new Set(remove);
    compactAcknowledgedStreamMetadata(meta, events.filter(item => !removed.has(item.key)));
  }
}

async function purgeTierBEventsAfterPolicyDowngrade(
  ownerUserId: string,
  meta: OwnerMeta,
): Promise<void> {
  if (meta.policy === 'tier_b') return;
  const events = await readOwnerEvents(ownerUserId);
  const precise = events.filter(item => item.event.requiredPolicyTier === 'tier_b');
  if (precise.length === 0) return;
  await storage.removeItemsStrict(precise.map(item => item.key));
  meta.pendingCount = Math.max(0, meta.pendingCount - precise.length);
  meta.pendingBytes = Math.max(0, meta.pendingBytes - precise.reduce(
    (sum, item) => sum + item.event.approximateBytes,
    0,
  ));
  const remaining = events.filter(item => item.event.requiredPolicyTier !== 'tier_b');
  compactAcknowledgedStreamMetadata(meta, remaining);
}

function compactAcknowledgedStreamMetadata(
  meta: OwnerMeta,
  pending: Array<{ event: QueuedAutomaticDiagnostic }>,
): boolean {
  const pendingStreamIds = new Set(pending.map(item => item.event.stream.streamId));
  const removable = Object.entries(meta.streams)
    .filter(([streamId]) => !pendingStreamIds.has(streamId))
    .sort((left, right) => {
      const latest = (status: StreamStatus) => Math.max(
        status.lastServerAckAt ?? 0,
        status.lastCapturedAt ?? 0,
        status.lastDurablyQueuedAt ?? 0,
        status.lastAttemptAt ?? 0,
      );
      return latest(right[1]) - latest(left[1]) || right[0].localeCompare(left[0]);
    });
  let changed = false;
  for (const [streamId] of removable.slice(MAX_RECENT_ACKED_STREAMS)) {
    delete meta.streams[streamId];
    changed = true;
  }
  return changed;
}

/** Capture is non-throwing to product callers; diagnostic storage never owns product truth. */
export function captureAutomaticDiagnosticEvent(input: AutomaticDiagnosticInput): Promise<void> {
  if (!input.ownerUserId || !input.stream?.streamId) return Promise.resolve();
  return serializeOwnerWork(input.ownerUserId, async () => {
    let meta: OwnerMeta;
    let reservedBytes = 0;
    try {
      meta = await readMeta(input.ownerUserId);
      if (!policyAuthorizesCapture(meta) || !await currentOwnerMatches(input.ownerUserId)) return;
      if (input.requiredPolicyTier === 'tier_b' && meta.policy !== 'tier_b') return;
      const streamId = safeIdentifier(input.stream.streamId, 96);
      const status = meta.streams[streamId] ?? emptyStatus();
      const event = makeEvent(input, status.nextSequence, meta.ownerEpoch, meta.policy as 'tier_a' | 'tier_b');
      if (await storage.getItemStrict(eventStorageKey(input.ownerUserId, event.eventId, event.stream.streamId))) return;
      status.lastCapturedAt = event.eventAt;
      status.coverageStart = status.coverageStart == null
        ? event.eventAt : Math.min(status.coverageStart, event.eventAt);
      status.coverageEnd = status.coverageEnd == null
        ? event.eventAt : Math.max(status.coverageEnd, event.eventAt);
      if (!status.sourceTypesAvailable.includes(event.stream.sourceType)) {
        status.sourceTypesAvailable.push(event.stream.sourceType);
      }
      status.clientActivityId = event.stream.clientActivityId ?? null;
      status.clientRouteId = event.stream.clientRouteId ?? null;
      status.nextSequence += 1;
      meta.streams[event.stream.streamId] = status;
      meta.pendingCount += 1;
      meta.pendingBytes += event.approximateBytes;
      reservedBytes = event.approximateBytes;
      // Reserve the per-stream sequence before the event write. A metadata
      // failure therefore writes no event; an event-write failure becomes an
      // explicit sequence gap instead of reusing a sequence after restart.
      await writeMeta(input.ownerUserId, meta);
      await storage.setItem(
        eventStorageKey(input.ownerUserId, event.eventId, event.stream.streamId),
        JSON.stringify(event),
        { strict: true },
      );
      reservedBytes = 0;
      status.lastDurablyQueuedAt = Date.now();
      if (status.nextSequence % 32 === 0) {
        const persisted = await readOwnerEvents(input.ownerUserId);
        meta.pendingCount = persisted.length;
        meta.pendingBytes = persisted.reduce((sum, item) => sum + item.event.approximateBytes, 0);
      }
      await enforceOwnerBounds(input.ownerUserId, meta);
      await writeMeta(input.ownerUserId, meta);
    } catch {
      // Preserve an in-process failure count when metadata is still writable.
      try {
        meta = await readMeta(input.ownerUserId);
        const streamId = safeIdentifier(input.stream.streamId, 96);
        const status = meta.streams[streamId] ?? emptyStatus();
        status.lastCapturedAt = Math.max(0, Math.floor(input.eventAt ?? Date.now()));
        status.failedWriteCount += 1;
        status.lastFailure = 'LOCAL_DIAGNOSTIC_WRITE_FAILED';
        if (reservedBytes > 0) {
          meta.pendingCount = Math.max(0, meta.pendingCount - 1);
          meta.pendingBytes = Math.max(0, meta.pendingBytes - reservedBytes);
        }
        meta.streams[streamId] = status;
        await writeMeta(input.ownerUserId, meta);
      } catch { /* storage is unavailable; recording must continue */ }
    }
  }).then(() => undefined, () => undefined);
}

function fnv1a(value: string, seed = 0x811c9dc5): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function retryBackoffMs(failures: number, identity: string, retryAfterHeader?: string | null): number {
  const serverMs = retryAfterHeader && /^\d+$/.test(retryAfterHeader)
    ? Number(retryAfterHeader) * 1_000
    : 0;
  const base = Math.min(5_000 * Math.pow(2, Math.max(0, failures - 1)), 30 * 60_000);
  const jitter = parseInt(fnv1a(identity).slice(-2), 16) / 255 * base * 0.2;
  return Math.max(serverMs, Math.round(base + jitter));
}

function batchFor(items: Array<{ key: string; event: QueuedAutomaticDiagnostic }>, droppedCount: number) {
  const chosen: typeof items = [];
  let bytes = 0;
  for (const item of items) {
    const nextBytes = bytes + item.event.approximateBytes;
    if (chosen.length > 0
      && item.event.streamSequence !== chosen[chosen.length - 1].event.streamSequence + 1) break;
    if (chosen.length >= MAX_EVENTS_PER_BATCH || (chosen.length > 0 && nextBytes > MAX_BATCH_BYTES)) break;
    chosen.push(item);
    bytes = nextBytes;
  }
  const identity = chosen.map(item => item.event.eventId).join('|');
  const first = chosen[0].event;
  const batchId = `diag-v1-${fnv1a(identity)}-${fnv1a(identity, 0x9e3779b9)}-${first.eventId.slice(-12)}`;
  return {
    chosen,
    body: {
      schema: 'cairn-auto-diagnostics-batch',
      version: 1,
      batchId,
      batchSequence: first.streamSequence,
      stream: first.stream,
      droppedCount,
      requiredPolicyTier: first.requiredPolicyTier,
      events: chosen.map(item => ({
        eventId: item.event.eventId,
        eventSequence: item.event.streamSequence,
        eventCode: item.event.eventCode,
        sourceModule: item.event.sourceModule,
        severity: item.event.severity,
        eventAt: item.event.eventAt,
        monotonicMs: item.event.monotonicMs,
        details: item.event.details,
      })),
    },
  };
}

async function currentOwnerMatches(ownerUserId: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const current = require('../store/useAppStore').useAppStore.getState().user?.id;
    return current != null && String(current) === String(ownerUserId);
  } catch { return false; }
}

async function refreshPolicy(ownerUserId: string, meta: OwnerMeta): Promise<boolean> {
  const now = Date.now();
  if (policyCacheIsFresh(meta, now)
    && (meta.policy === 'unknown' || meta.policy === 'disabled' || policyAuthorizesCapture(meta, now))) {
    return policyAuthorizesCapture(meta, now);
  }
  const response = await diagnosticAuthenticatedFetch('/api/telemetry/diagnostics/policy', {
    method: 'GET', expectedUserId: ownerUserId, skipLogoutOn401: true,
  });
  if (!response.ok) {
    meta.policy = 'unknown';
    meta.policyCheckedAt = now;
    meta.policyExpiresAt = null;
    await writeMeta(ownerUserId, meta);
    return false;
  }
  const policy = await response.json() as {
    enabled?: boolean;
    tier?: 'tier_a' | 'tier_b' | 'disabled';
    expiresAt?: string | null;
  };
  const parsedExpiry = policy.expiresAt == null ? null : Date.parse(String(policy.expiresAt));
  const validExpiry = parsedExpiry == null || (Number.isFinite(parsedExpiry) && parsedExpiry > now);
  meta.policyCheckedAt = now;
  meta.policyExpiresAt = validExpiry ? parsedExpiry : null;
  meta.policy = policy?.enabled && validExpiry && (policy.tier === 'tier_a' || policy.tier === 'tier_b')
    ? policy.tier
    : 'disabled';
  if (meta.policy === 'disabled') {
    const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(eventPrefix(ownerUserId)));
    await storage.removeItemsStrict(keys);
    meta.pendingCount = 0;
    meta.pendingBytes = 0;
    meta.streams = {};
    await writeMeta(ownerUserId, meta);
    return false;
  }
  await purgeTierBEventsAfterPolicyDowngrade(ownerUserId, meta);
  await writeMeta(ownerUserId, meta);
  return true;
}

export async function drainAutomaticDiagnosticOutbox(
  ownerUserId: string,
  options: { reason: 'hydrate' | 'network_online' | 'foreground' | 'finish' | 'sync' },
): Promise<{ acknowledgedEvents: number; failedBatches: number; skipped: boolean }> {
  if (!ownerUserId || !networkMonitor.isOnline() || !await currentOwnerMatches(ownerUserId)) {
    return { acknowledgedEvents: 0, failedBatches: 0, skipped: true };
  }
  return serializeOwnerWork(ownerUserId, async () => {
    let acknowledgedEvents = 0;
    let failedBatches = 0;
    const meta = await readMeta(ownerUserId);
    await repairCorruptedOwnerEvents(ownerUserId, meta);
    try {
      if (!await refreshPolicy(ownerUserId, meta)) {
        return { acknowledgedEvents, failedBatches, skipped: true };
      }
    } catch {
      return { acknowledgedEvents, failedBatches: 1, skipped: true };
    }
    const failedThisPass = new Set<string>();
    while (networkMonitor.isOnline() && await currentOwnerMatches(ownerUserId)) {
      const pending = await readOwnerEvents(ownerUserId);
      if (pending.length === 0) {
        if (compactAcknowledgedStreamMetadata(meta, pending)) {
          await writeMeta(ownerUserId, meta).catch(() => undefined);
        }
        break;
      }
      const now = Date.now();
      const streamId = pending.find(item => {
        const candidateId = item.event.stream.streamId;
        const candidate = meta.streams[candidateId] ?? emptyStatus();
        return !failedThisPass.has(candidateId)
          && (!candidate.nextAttemptAt || candidate.nextAttemptAt <= now)
          && item.event.streamSequence > candidate.quarantinedThroughSequence;
      })?.event.stream.streamId;
      if (!streamId) {
        if (compactAcknowledgedStreamMetadata(meta, pending)) {
          await writeMeta(ownerUserId, meta).catch(() => undefined);
        }
        break;
      }
      const sameStream = pending
        .filter(item => item.event.stream.streamId === streamId
          && item.event.streamSequence > (meta.streams[streamId]?.quarantinedThroughSequence ?? 0))
        .sort((left, right) => left.event.streamSequence - right.event.streamSequence);
      const status = meta.streams[streamId] ?? emptyStatus();
      const { chosen, body } = batchFor(sameStream, status.droppedCount);
      if (chosen.length === 0) {
        failedThisPass.add(streamId);
        continue;
      }
      if (body.stream.clientActivityId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const registry = require('../features/activity/activityRegistry');
          if (await registry.isActivityTombstoned(ownerUserId, body.stream.clientActivityId)) {
            await purgeActivityUnlocked(ownerUserId, body.stream.clientActivityId);
            continue;
          }
        } catch {
          // A missing/corrupt deletion authority is not permission to upload.
          status.lastFailure = 'LOCAL_TOMBSTONE_AUTHORITY_UNAVAILABLE';
          await writeMeta(ownerUserId, meta).catch(() => undefined);
          failedThisPass.add(streamId);
          continue;
        }
      }
      if (body.stream.clientRouteId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const routeTombstones = require('./routeTombstones');
          if (await routeTombstones.isRouteTombstoned(ownerUserId, body.stream.clientRouteId)) {
            await purgeRouteUnlocked(ownerUserId, body.stream.clientRouteId);
            continue;
          }
        } catch {
          status.lastFailure = 'LOCAL_ROUTE_TOMBSTONE_AUTHORITY_UNAVAILABLE';
          await writeMeta(ownerUserId, meta).catch(() => undefined);
          failedThisPass.add(streamId);
          continue;
        }
      }
      status.lastAttemptAt = Date.now();
      status.lastFailure = null;
      meta.streams[streamId] = status;
      await writeMeta(ownerUserId, meta).catch(() => undefined);
      let response: Response;
      try {
        response = await diagnosticAuthenticatedFetch('/api/telemetry/diagnostics/batches', {
          method: 'POST',
          body: JSON.stringify(body),
          expectedUserId: ownerUserId,
          skipLogoutOn401: true,
          headers: { 'X-Cairn-Diagnostic-Wake': options.reason },
        });
      } catch {
        status.lastFailure = 'NETWORK_UNAVAILABLE';
        status.consecutiveUploadFailures += 1;
        status.nextAttemptAt = Date.now() + retryBackoffMs(status.consecutiveUploadFailures, body.batchId);
        failedBatches += 1;
        await writeMeta(ownerUserId, meta).catch(() => undefined);
        break;
      }
      if (!response.ok) {
        let code = '';
        try { code = String((await response.clone().json())?.code ?? ''); } catch { /* no body */ }
        status.lastFailure = code || `HTTP_${response.status}`;
        status.consecutiveUploadFailures += 1;
        status.nextAttemptAt = Date.now() + retryBackoffMs(
          status.consecutiveUploadFailures,
          body.batchId,
          response.headers.get('Retry-After'),
        );
        failedBatches += 1;
        if (response.status === 403 && code !== 'DIAGNOSTIC_TIER_REQUIRED') {
          meta.policy = 'disabled';
          meta.policyCheckedAt = Date.now();
          meta.policyExpiresAt = null;
          await storage.removeItemsStrict(pending.map(item => item.key));
          meta.pendingCount = 0;
          meta.pendingBytes = 0;
          meta.streams = {};
          await writeMeta(ownerUserId, meta).catch(() => undefined);
        } else if (response.status === 403 && code === 'DIAGNOSTIC_TIER_REQUIRED') {
          await storage.removeItemsStrict(chosen.map(item => item.key));
          meta.pendingCount = Math.max(0, meta.pendingCount - chosen.length);
          meta.pendingBytes = Math.max(0, meta.pendingBytes - chosen.reduce(
            (sum, item) => sum + item.event.approximateBytes,
            0,
          ));
          status.lastFailure = code;
          status.quarantinedCount += chosen.length;
          status.quarantinedThroughSequence = Math.max(
            status.quarantinedThroughSequence,
            chosen[chosen.length - 1].event.streamSequence,
          );
          status.nextAttemptAt = null;
          await writeMeta(ownerUserId, meta).catch(() => undefined);
        } else if (response.status === 410 && body.stream.clientActivityId) {
          await purgeActivityUnlocked(ownerUserId, body.stream.clientActivityId);
        } else if (response.status === 410 && body.stream.clientRouteId) {
          await purgeRouteUnlocked(ownerUserId, body.stream.clientRouteId);
        } else if (response.status >= 400 && response.status < 500
          && ![401, 408, 425, 429].includes(response.status)) {
          status.quarantinedThroughSequence = Math.max(
            status.quarantinedThroughSequence,
            chosen[chosen.length - 1].event.streamSequence,
          );
          status.quarantinedCount += chosen.length;
          status.nextAttemptAt = null;
          await writeMeta(ownerUserId, meta).catch(() => undefined);
        } else {
          await writeMeta(ownerUserId, meta).catch(() => undefined);
        }
        if (response.status === 401
          || (response.status === 403 && code !== 'DIAGNOSTIC_TIER_REQUIRED')) break;
        if (response.status === 410) continue;
        failedThisPass.add(streamId);
        continue;
      }
      // Server commit is idempotent by owner+batchId. If local removal fails,
      // the exact same batch is replayed and acknowledged without duplication.
      try {
        await storage.removeItemsStrict(chosen.map(item => item.key));
      } catch {
        status.lastFailure = 'LOCAL_ACK_PERSIST_FAILED';
        status.consecutiveUploadFailures += 1;
        status.nextAttemptAt = Date.now() + retryBackoffMs(status.consecutiveUploadFailures, body.batchId);
        failedBatches += 1;
        await writeMeta(ownerUserId, meta).catch(() => undefined);
        break;
      }
      meta.pendingCount = Math.max(0, meta.pendingCount - chosen.length);
      meta.pendingBytes = Math.max(
        0,
        meta.pendingBytes - chosen.reduce((sum, item) => sum + item.event.approximateBytes, 0),
      );
      status.lastServerAckAt = Date.now();
      status.lastFailure = null;
      status.consecutiveUploadFailures = 0;
      status.nextAttemptAt = null;
      acknowledgedEvents += chosen.length;
      const chosenKeys = new Set(chosen.map(item => item.key));
      compactAcknowledgedStreamMetadata(meta, pending.filter(item => !chosenKeys.has(item.key)));
      await writeMeta(ownerUserId, meta).catch(() => undefined);
    }
    return { acknowledgedEvents, failedBatches, skipped: false };
  });
}

export async function getAutomaticDiagnosticStatus(
  ownerUserId: string,
  streamId: string,
): Promise<AutomaticDiagnosticStatus> {
  await tails.get(ownerUserId)?.catch(() => undefined);
  const meta = await readMeta(ownerUserId);
  await repairCorruptedOwnerEvents(ownerUserId, meta);
  const all = await readOwnerEvents(ownerUserId);
  const events = all.filter(item => item.event.stream.streamId === streamId).map(item => item.event);
  const status = meta.streams[streamId] ?? emptyStatus();
  const pendingBytes = events.reduce((sum, event) => sum + event.approximateBytes, 0);
  let quality: AutomaticDiagnosticStatus['quality'];
  if (meta.policy === 'disabled') quality = 'POLICY_DISABLED';
  else if (status.quarantinedCount > 0) quality = 'UPLOAD_INCOMPLETE';
  else if (status.droppedCount > 0) quality = 'RETENTION_TRUNCATED';
  else if (events.length > 0 && status.lastDurablyQueuedAt) quality = 'UPLOAD_PENDING';
  else if (events.length > 0) quality = 'CAPTURED_NOT_UPLOADED';
  else if (status.lastServerAckAt) quality = 'SERVER_ACKED';
  else if (status.failedWriteCount > 0) quality = 'UNKNOWN';
  else if (!policyAuthorizesCapture(meta)) quality = 'UNKNOWN';
  else quality = 'NOT_CAPTURED';
  return {
    ...status,
    pendingCount: events.length,
    pendingBytes,
    coverageStart: status.coverageStart ?? events[0]?.eventAt ?? status.lastCapturedAt,
    coverageEnd: status.coverageEnd ?? events[events.length - 1]?.eventAt ?? status.lastCapturedAt,
    sourceTypesAvailable: [...new Set([
      ...status.sourceTypesAvailable,
      ...events.map(event => event.stream.sourceType),
    ])],
    quality,
  };
}

export async function purgeAutomaticDiagnosticsForActivity(
  ownerUserId: string,
  clientActivityId: string,
): Promise<void> {
  await serializeOwnerWork(ownerUserId, () => purgeActivityUnlocked(ownerUserId, clientActivityId));
}

export async function purgeAutomaticDiagnosticsForRoute(
  ownerUserId: string,
  clientRouteId: string,
): Promise<void> {
  await serializeOwnerWork(ownerUserId, () => purgeRouteUnlocked(ownerUserId, clientRouteId));
}

async function purgeActivityUnlocked(ownerUserId: string, clientActivityId: string): Promise<void> {
  const events = await readOwnerEvents(ownerUserId);
  const matching = events.filter(item => item.event.stream.clientActivityId === clientActivityId);
  await storage.removeItemsStrict(matching.map(item => item.key));
  const meta = await readMeta(ownerUserId);
  meta.pendingCount = Math.max(0, meta.pendingCount - matching.length);
  meta.pendingBytes = Math.max(
    0,
    meta.pendingBytes - matching.reduce((sum, item) => sum + item.event.approximateBytes, 0),
  );
  const matchingStreamIds = new Set(matching.map(item => item.event.stream.streamId));
  for (const [streamId, status] of Object.entries(meta.streams)) {
    if (matchingStreamIds.has(streamId) || status.clientActivityId === clientActivityId) {
      delete meta.streams[streamId];
    }
  }
  await writeMeta(ownerUserId, meta);
}

async function purgeRouteUnlocked(ownerUserId: string, clientRouteId: string): Promise<void> {
  const events = await readOwnerEvents(ownerUserId);
  const matching = events.filter(item => item.event.stream.clientRouteId === clientRouteId);
  await storage.removeItemsStrict(matching.map(item => item.key));
  const meta = await readMeta(ownerUserId);
  meta.pendingCount = Math.max(0, meta.pendingCount - matching.length);
  meta.pendingBytes = Math.max(
    0,
    meta.pendingBytes - matching.reduce((sum, item) => sum + item.event.approximateBytes, 0),
  );
  const matchingStreamIds = new Set(matching.map(item => item.event.stream.streamId));
  for (const [streamId, status] of Object.entries(meta.streams)) {
    if (matchingStreamIds.has(streamId) || status.clientRouteId === clientRouteId) {
      delete meta.streams[streamId];
    }
  }
  await writeMeta(ownerUserId, meta);
}

export async function purgeAutomaticDiagnosticsForOwner(ownerUserId: string): Promise<void> {
  await serializeOwnerWork(ownerUserId, async () => {
    const keys = (await storage.getAllKeysStrict()).filter(key => key.startsWith(ownerPrefix(ownerUserId)));
    await storage.removeItemsStrict(keys);
  });
}

export async function _resetAutomaticDiagnosticOutboxForTesting(): Promise<void> {
  await Promise.allSettled([...tails.values()]);
  tails.clear();
  eventCounter = 0;
}
