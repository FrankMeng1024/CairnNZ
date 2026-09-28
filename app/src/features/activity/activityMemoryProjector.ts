import type { TrackPoint } from '../../store/useSessionStore';
import { storage } from '../../store/storage';
import { readHikeTrackForProjection } from '../../services/hikeTrackWriter';

const INTENT_PREFIX = 'cairn:activity-memory-projection:v2:';
const PURGE_PREFIX = 'cairn:activity-memory-projection-purged:v1:';
const RETRY_MS = [1_000, 5_000, 15_000, 60_000];

export interface ActivityMemoryProjectionIntent {
  v: 2;
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  state: 'pending' | 'projecting' | 'retry' | 'complete' | 'cancelled';
  requestedThroughPointId: string;
  requestedThroughTimestampMs: number;
  projectedThroughPointId: string | null;
  projectedThroughTimestampMs: number | null;
  retryAttempt: number;
  nextRetryAtMs: number | null;
  lastError: string | null;
  updatedAtMs: number;
}

interface RuntimeRequest {
  ownerUserId: string;
  clientActivityId: string;
  running: boolean;
  cancelled: boolean;
  dirty: boolean;
  transientRetryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  flight: Promise<void> | null;
}

const requests = new Map<string, RuntimeRequest>();
const storageTails = new Map<string, Promise<void>>();
let metrics = {
  scheduledPoints: 0,
  projectedPoints: 0,
  deduplicatedPoints: 0,
  replayLoads: 0,
  failures: 0,
  maximumPendingPoints: 0,
  durableIntents: 0,
};

function encoded(value: string): string { return encodeURIComponent(value); }
function intentKey(ownerUserId: string, clientActivityId: string): string {
  return `${INTENT_PREFIX}${encoded(ownerUserId)}:${encoded(clientActivityId)}`;
}
function purgeKey(ownerUserId: string): string { return `${PURGE_PREFIX}${encoded(ownerUserId)}`; }
function runtimeKey(ownerUserId: string, clientActivityId: string): string {
  return `${ownerUserId}|${clientActivityId}`;
}

function pointId(point: Pick<TrackPoint, 't' | 'lat' | 'lng' | 'rawOrdinal' | 'segmentId'>): string {
  return Number.isFinite(point.rawOrdinal)
    ? `${point.segmentId ?? 'legacy'}:raw:${point.rawOrdinal}`
    : `${point.segmentId ?? 'legacy'}:${Math.floor(point.t)}:${point.lat.toFixed(7)}:${point.lng.toFixed(7)}`;
}

function parseIntent(raw: string | null): ActivityMemoryProjectionIntent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ActivityMemoryProjectionIntent;
    return value?.v === 2
      && typeof value.ownerUserId === 'string'
      && typeof value.clientActivityId === 'string'
      && typeof value.requestedThroughPointId === 'string'
      ? value
      : null;
  } catch { return null; }
}

async function strictGet(key: string): Promise<string | null> {
  return typeof storage.getItemStrict === 'function' ? storage.getItemStrict(key) : storage.getItem(key);
}

async function withIntentStorage<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = storageTails.get(key)?.catch(() => undefined) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  storageTails.set(key, next);
  await previous;
  try { return await operation(); } finally {
    release();
    if (storageTails.get(key) === next) storageTails.delete(key);
  }
}

async function readIntent(ownerUserId: string, clientActivityId: string): Promise<ActivityMemoryProjectionIntent | null> {
  return parseIntent(await strictGet(intentKey(ownerUserId, clientActivityId)));
}

async function updateIntent(
  ownerUserId: string,
  clientActivityId: string,
  update: (current: ActivityMemoryProjectionIntent | null) => ActivityMemoryProjectionIntent | null,
): Promise<ActivityMemoryProjectionIntent | null> {
  const key = intentKey(ownerUserId, clientActivityId);
  return withIntentStorage(key, async () => {
    const next = update(parseIntent(await strictGet(key)));
    if (next) await storage.setItem(key, JSON.stringify(next), { strict: true });
    else await storage.removeItem(key, { strict: true });
    return next;
  });
}

function ownerIsCurrent(ownerUserId: string): boolean {
  // Keep account-deletion fencing loadable without initializing the entire
  // authenticated/native graph. Workers resolve owner state only when they run.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAppStore } = require('../../store/useAppStore');
  return String(useAppStore.getState().user?.id ?? '') === ownerUserId;
}

function runtimeFor(ownerUserId: string, clientActivityId: string): RuntimeRequest {
  const key = runtimeKey(ownerUserId, clientActivityId);
  let request = requests.get(key);
  if (!request) {
    request = {
      ownerUserId, clientActivityId, running: false, cancelled: false, dirty: false,
      transientRetryAttempt: 0, retryTimer: null, flight: null,
    };
    requests.set(key, request);
  }
  return request;
}

async function markFailure(request: RuntimeRequest, error: unknown): Promise<void> {
  metrics.failures += 1;
  const fallbackDelay = RETRY_MS[Math.min(request.transientRetryAttempt, RETRY_MS.length - 1)];
  request.transientRetryAttempt += 1;
  let retryAtMs = Date.now() + fallbackDelay;
  try {
    const intent = await updateIntent(request.ownerUserId, request.clientActivityId, current => {
      if (!current || current.state === 'cancelled') return current;
      const retryAttempt = current.retryAttempt + 1;
      const delay = RETRY_MS[Math.min(current.retryAttempt, RETRY_MS.length - 1)];
      return { ...current, state: 'retry', retryAttempt, nextRetryAtMs: Date.now() + delay,
        lastError: String(error).slice(0, 160), updatedAtMs: Date.now() };
    });
    if (!intent) return;
    request.transientRetryAttempt = Math.max(request.transientRetryAttempt, intent.retryAttempt);
    retryAtMs = intent.nextRetryAtMs ?? retryAtMs;
  } catch {
    // The Activity WAL remains the durable source. Keep bounded in-process
    // responsibility even when checkpoint storage itself is temporarily down;
    // recovery/start/finish will rediscover the same WAL after a process loss.
  }
  if (request.cancelled || !ownerIsCurrent(request.ownerUserId)) return;
  const delay = Math.max(0, retryAtMs - Date.now());
  if (request.retryTimer) clearTimeout(request.retryTimer);
  request.retryTimer = setTimeout(() => { request.retryTimer = null; startWorker(request); }, delay);
}

async function projectOnce(request: RuntimeRequest): Promise<void> {
  if (request.cancelled || !ownerIsCurrent(request.ownerUserId)) return;
  let intent = await readIntent(request.ownerUserId, request.clientActivityId);
  if (!intent || intent.state === 'cancelled' || intent.state === 'complete') return;
  await updateIntent(request.ownerUserId, request.clientActivityId, current => (
    !current || current.state === 'cancelled' ? current
      : { ...current, state: 'projecting', nextRetryAtMs: null, updatedAtMs: Date.now() }
  ));
  metrics.replayLoads += 1;
  const journal = await readHikeTrackForProjection(request.clientActivityId);
  if (journal.length === 0) throw new Error('activity_projection_journal_empty');
  const requestedIndex = journal.findIndex(point => pointId(point) === intent!.requestedThroughPointId);
  if (requestedIndex < 0) throw new Error('activity_projection_requested_point_missing');
  let startIndex = 0;
  if (intent.projectedThroughPointId) {
    const projectedIndex = journal.findIndex(point => pointId(point) === intent!.projectedThroughPointId);
    startIndex = projectedIndex >= 0 ? projectedIndex + 1 : 0;
  }
  for (let index = startIndex; index <= requestedIndex; index += 1) {
    if (request.cancelled || !ownerIsCurrent(request.ownerUserId)) return;
    intent = await readIntent(request.ownerUserId, request.clientActivityId);
    if (!intent || intent.state === 'cancelled') return;
    const point = journal[index];
    // Worker-only dependency stays lazy for the same purge/load boundary as
    // ownerIsCurrent above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recordMemoryEvidence } = require('../memory/services/recordMemoryEvidence');
    const result = await recordMemoryEvidence({
      lat: point.lat, lng: point.lng, atMs: point.t, source: 'activity_real',
      ownerUserId: request.ownerUserId, durability: 'deferred',
      sourceActivityClientId: request.clientActivityId, sourceSegmentId: point.segmentId,
      horizontalAccuracyM: point.accuracy ?? undefined, continuityState: 'accepted',
    });
    metrics.projectedPoints += 1;
    if (result.deduplicated) metrics.deduplicatedPoints += 1;
    await updateIntent(request.ownerUserId, request.clientActivityId, current => (
      !current || current.state === 'cancelled' ? current : { ...current,
        projectedThroughPointId: pointId(point), projectedThroughTimestampMs: point.t,
        retryAttempt: 0, nextRetryAtMs: null, lastError: null, updatedAtMs: Date.now() }
    ));
  }
  await updateIntent(request.ownerUserId, request.clientActivityId, current => {
    if (!current || current.state === 'cancelled') return current;
    const caughtUp = current.projectedThroughPointId === current.requestedThroughPointId;
    return { ...current, state: caughtUp ? 'complete' : 'pending',
      retryAttempt: caughtUp ? 0 : current.retryAttempt, nextRetryAtMs: null,
      lastError: null, updatedAtMs: Date.now() };
  });
}

function startWorker(request: RuntimeRequest): void {
  if (request.running || request.cancelled) { request.dirty = true; return; }
  request.running = true;
  const flight = (async () => {
    do {
      request.dirty = false;
      try {
        await projectOnce(request);
        request.transientRetryAttempt = 0;
      } catch (error) {
        await markFailure(request, error).catch(() => undefined);
        return;
      }
    } while (request.dirty && !request.cancelled);
  })().finally(() => {
    request.running = false;
    if (request.flight === flight) request.flight = null;
  });
  request.flight = flight;
}

/** Commit downstream responsibility after the Activity WAL append. This await
 * covers only the small durable intent write; Memory work is independently
 * tracked outside the source ingestion/TaskManager ownership boundary. */
export async function scheduleActivityMemoryProjection(args: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  points: TrackPoint[];
}): Promise<void> {
  if (args.points.length === 0) return;
  if (await strictGet(purgeKey(args.ownerUserId))) throw new Error('activity_projection_owner_purged');
  const ordered = [...args.points].sort((a, b) => a.t - b.t || pointId(a).localeCompare(pointId(b)));
  const tail = ordered[ordered.length - 1];
  await updateIntent(args.ownerUserId, args.clientActivityId, current => ({
    v: 2, ownerUserId: args.ownerUserId, clientActivityId: args.clientActivityId,
    ownerGeneration: args.ownerGeneration, state: 'pending', requestedThroughPointId: pointId(tail),
    requestedThroughTimestampMs: tail.t, projectedThroughPointId: current?.projectedThroughPointId ?? null,
    projectedThroughTimestampMs: current?.projectedThroughTimestampMs ?? null,
    retryAttempt: current?.retryAttempt ?? 0, nextRetryAtMs: null, lastError: null, updatedAtMs: Date.now(),
  }));
  metrics.scheduledPoints += args.points.length;
  metrics.durableIntents += 1;
  metrics.maximumPendingPoints = Math.max(metrics.maximumPendingPoints, args.points.length);
  const request = runtimeFor(args.ownerUserId, args.clientActivityId);
  request.cancelled = false;
  if (request.retryTimer) clearTimeout(request.retryTimer);
  request.retryTimer = null;
  request.dirty = true;
  startWorker(request);
}

export async function resumeActivityMemoryProjectionsForOwner(ownerUserId: string): Promise<number> {
  if (!ownerUserId || await strictGet(purgeKey(ownerUserId))) return 0;
  const keys = typeof storage.getAllKeysStrict === 'function' ? await storage.getAllKeysStrict() : [];
  let resumed = 0;
  for (const key of keys.filter(value => value.startsWith(INTENT_PREFIX))) {
    const intent = parseIntent(await strictGet(key));
    if (!intent || intent.ownerUserId !== ownerUserId || intent.state === 'cancelled' || intent.state === 'complete') continue;
    const request = runtimeFor(ownerUserId, intent.clientActivityId);
    request.cancelled = false;
    if (request.retryTimer) clearTimeout(request.retryTimer);
    request.retryTimer = null;
    request.dirty = true;
    startWorker(request);
    resumed += 1;
  }
  return resumed;
}

export async function waitForActivityMemoryProjection(clientActivityId: string): Promise<void> {
  for (const request of [...requests.values()].filter(item => item.clientActivityId === clientActivityId)) {
    if (request.flight) await request.flight;
  }
}

export async function activityMemoryProjectionIsComplete(ownerUserId: string, clientActivityId: string): Promise<boolean> {
  const intent = await readIntent(ownerUserId, clientActivityId);
  return intent?.state === 'complete' && intent.projectedThroughPointId === intent.requestedThroughPointId;
}

export async function reconcileActivityMemoryProjection(ownerUserId: string, clientActivityId: string): Promise<boolean> {
  const intent = await readIntent(ownerUserId, clientActivityId);
  if (!intent) return true;
  const request = runtimeFor(ownerUserId, clientActivityId);
  request.cancelled = false;
  if (request.retryTimer) clearTimeout(request.retryTimer);
  request.retryTimer = null;
  request.dirty = true;
  startWorker(request);
  if (request.flight) await request.flight;
  return activityMemoryProjectionIsComplete(ownerUserId, clientActivityId);
}

export async function cancelActivityMemoryProjection(ownerUserId: string, clientActivityId: string): Promise<void> {
  const request = requests.get(runtimeKey(ownerUserId, clientActivityId));
  if (request) {
    request.cancelled = true;
    if (request.retryTimer) clearTimeout(request.retryTimer);
    request.retryTimer = null;
  }
  await updateIntent(ownerUserId, clientActivityId, current => current
    ? { ...current, state: 'cancelled', nextRetryAtMs: null, updatedAtMs: Date.now() }
    : null);
}

export async function purgeActivityMemoryProjectionsForOwner(ownerUserId: string): Promise<void> {
  await storage.setItem(purgeKey(ownerUserId), JSON.stringify({ v: 1, deletedAtMs: Date.now() }), { strict: true });
  const inFlight: Promise<void>[] = [];
  for (const request of requests.values()) {
    if (request.ownerUserId !== ownerUserId) continue;
    request.cancelled = true;
    if (request.retryTimer) clearTimeout(request.retryTimer);
    request.retryTimer = null;
    if (request.flight) inFlight.push(request.flight);
  }
  // recordMemoryEvidence may already be inside a non-abortable durable write.
  // Account deletion waits for only those entered writes, then removes their
  // output; no later point may enter after cancelled=true above.
  if (inFlight.length > 0) await Promise.allSettled(inFlight);
  const keys = typeof storage.getAllKeysStrict === 'function' ? await storage.getAllKeysStrict() : [];
  const owned: string[] = [];
  for (const key of keys.filter(value => value.startsWith(INTENT_PREFIX))) {
    const intent = parseIntent(await strictGet(key));
    if (intent?.ownerUserId === ownerUserId) owned.push(key);
  }
  if (owned.length > 0 && typeof storage.removeItemsStrict === 'function') await storage.removeItemsStrict(owned);
  else for (const key of owned) await storage.removeItem(key, { strict: true });
}

export async function waitForAllActivityMemoryProjections(): Promise<void> {
  for (const request of requests.values()) if (request.flight) await request.flight;
}

export function getActivityMemoryProjectionMetrics(): typeof metrics { return { ...metrics }; }

export function resetActivityMemoryProjectionForTests(): void {
  for (const request of requests.values()) if (request.retryTimer) clearTimeout(request.retryTimer);
  requests.clear();
  storageTails.clear();
  metrics = { scheduledPoints: 0, projectedPoints: 0, deduplicatedPoints: 0,
    replayLoads: 0, failures: 0, maximumPendingPoints: 0, durableIntents: 0 };
}
