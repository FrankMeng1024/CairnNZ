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
  state: 'pending' | 'projecting' | 'retry' | 'complete' | 'retired' | 'cancelled';
  requestedThroughPointId: string;
  requestedThroughTimestampMs: number;
  /** Numeric evidence order when the native journal supplied one. Never compare
   * the encoded point id lexicographically: segment names and ordinals are not
   * a sortable string key. */
  requestedThroughRawOrdinal?: number | null;
  projectedThroughPointId: string | null;
  projectedThroughTimestampMs: number | null;
  projectedThroughRawOrdinal?: number | null;
  retryAttempt: number;
  nextRetryAtMs: number | null;
  lastError: string | null;
  updatedAtMs: number;
  /** ACK cleanup persisted this terminal frontier before deleting the WAL. */
  retiredAtMs?: number | null;
}

interface RuntimeRequest {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  authorityGeneration: number;
  running: boolean;
  cancelled: boolean;
  cancelGeneration: number;
  dirty: boolean;
  transientRetryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  flight: Promise<void> | null;
}

interface OwnerProjectionAuthority {
  generation: number;
  purging: boolean;
  admittedSchedulers: Set<Promise<void>>;
  discoveryFlight: Promise<number> | null;
  discoveryTimer: ReturnType<typeof setTimeout> | null;
  discoveryRetryAttempt: number;
  discoveryNextRetryAtMs: number | null;
  discoveryLastError: string | null;
}

const requests = new Map<string, RuntimeRequest>();
const storageTails = new Map<string, Promise<void>>();
const ownerAuthorities = new Map<string, OwnerProjectionAuthority>();
let metrics = {
  scheduledPoints: 0,
  projectedPoints: 0,
  deduplicatedPoints: 0,
  replayLoads: 0,
  failures: 0,
  maximumPendingPoints: 0,
  durableIntents: 0,
  retiredIntents: 0,
  discoveryAttempts: 0,
  discoveryFailures: 0,
  discoveryRetriesScheduled: 0,
};

function encoded(value: string): string { return encodeURIComponent(value); }
function intentKey(ownerUserId: string, clientActivityId: string): string {
  return `${INTENT_PREFIX}${encoded(ownerUserId)}:${encoded(clientActivityId)}`;
}
function purgeKey(ownerUserId: string): string { return `${PURGE_PREFIX}${encoded(ownerUserId)}`; }
function runtimeKey(ownerUserId: string, clientActivityId: string): string {
  return `${ownerUserId}|${clientActivityId}`;
}

function ownerAuthority(ownerUserId: string): OwnerProjectionAuthority {
  let authority = ownerAuthorities.get(ownerUserId);
  if (!authority) {
    authority = {
      generation: 0,
      purging: false,
      admittedSchedulers: new Set(),
      discoveryFlight: null,
      discoveryTimer: null,
      discoveryRetryAttempt: 0,
      discoveryNextRetryAtMs: null,
      discoveryLastError: null,
    };
    ownerAuthorities.set(ownerUserId, authority);
  }
  return authority;
}

function ownerAdmissionIsCurrent(ownerUserId: string, generation: number): boolean {
  const authority = ownerAuthority(ownerUserId);
  return !authority.purging && authority.generation === generation;
}

function pointId(point: Pick<TrackPoint, 't' | 'lat' | 'lng' | 'rawOrdinal' | 'segmentId'>): string {
  return Number.isFinite(point.rawOrdinal)
    ? `${point.segmentId ?? 'legacy'}:raw:${point.rawOrdinal}`
    : `${point.segmentId ?? 'legacy'}:${Math.floor(point.t)}:${point.lat.toFixed(7)}:${point.lng.toFixed(7)}`;
}

function pointRawOrdinal(point: Pick<TrackPoint, 'rawOrdinal'>): number | null {
  return Number.isFinite(point.rawOrdinal) ? Number(point.rawOrdinal) : null;
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
  const auth = useAppStore.getState();
  return auth.isLoggedIn === true && String(auth.user?.id ?? '') === ownerUserId;
}

function runtimeFor(
  ownerUserId: string,
  clientActivityId: string,
  ownerGeneration = 'recovered-journal',
  authorityGeneration = ownerAuthority(ownerUserId).generation,
): RuntimeRequest {
  const key = runtimeKey(ownerUserId, clientActivityId);
  let request = requests.get(key);
  if (!request) {
    request = {
      ownerUserId, clientActivityId, ownerGeneration, authorityGeneration,
      running: false, cancelled: false, cancelGeneration: 0, dirty: false,
      transientRetryAttempt: 0, retryTimer: null, flight: null,
    };
    requests.set(key, request);
  } else {
    request.ownerGeneration = ownerGeneration;
    request.authorityGeneration = authorityGeneration;
  }
  return request;
}

function requestMayRun(request: RuntimeRequest): boolean {
  return !request.cancelled
    && ownerAdmissionIsCurrent(request.ownerUserId, request.authorityGeneration)
    && ownerIsCurrent(request.ownerUserId);
}

function mergeRequestedTail(
  current: ActivityMemoryProjectionIntent | null,
  args: { ownerUserId: string; clientActivityId: string; ownerGeneration: string },
  tail: TrackPoint,
  authoritativeJournalTail = false,
): ActivityMemoryProjectionIntent {
  if (current?.state === 'retired' || current?.state === 'cancelled') return current;
  const incomingPointId = pointId(tail);
  const incomingRawOrdinal = pointRawOrdinal(tail);
  const currentRawOrdinal = current?.requestedThroughRawOrdinal;
  const samePoint = current?.requestedThroughPointId === incomingPointId;
  const provablyNewer = !current
    || samePoint
    || authoritativeJournalTail
    || (incomingRawOrdinal != null
      && currentRawOrdinal != null
      && incomingRawOrdinal > currentRawOrdinal);
  const keepCurrentRequest = Boolean(current && !provablyNewer);
  return {
    v: 2,
    ownerUserId: args.ownerUserId,
    clientActivityId: args.clientActivityId,
    ownerGeneration: current?.ownerGeneration ?? args.ownerGeneration,
    state: 'pending',
    requestedThroughPointId: keepCurrentRequest ? current!.requestedThroughPointId : incomingPointId,
    requestedThroughTimestampMs: keepCurrentRequest ? current!.requestedThroughTimestampMs : tail.t,
    requestedThroughRawOrdinal: keepCurrentRequest
      ? (current!.requestedThroughRawOrdinal ?? null)
      : incomingRawOrdinal,
    projectedThroughPointId: current?.projectedThroughPointId ?? null,
    projectedThroughTimestampMs: current?.projectedThroughTimestampMs ?? null,
    projectedThroughRawOrdinal: current?.projectedThroughRawOrdinal ?? null,
    retryAttempt: current?.retryAttempt ?? 0,
    nextRetryAtMs: null,
    lastError: null,
    updatedAtMs: Date.now(),
    retiredAtMs: current?.retiredAtMs ?? null,
  };
}

async function markFailure(request: RuntimeRequest, error: unknown): Promise<void> {
  metrics.failures += 1;
  const fallbackDelay = RETRY_MS[Math.min(request.transientRetryAttempt, RETRY_MS.length - 1)];
  request.transientRetryAttempt += 1;
  let retryAtMs = Date.now() + fallbackDelay;
  try {
    const intent = await updateIntent(request.ownerUserId, request.clientActivityId, current => {
      if (!current || current.state === 'cancelled' || current.state === 'retired') return current;
      const retryAttempt = current.retryAttempt + 1;
      const delay = RETRY_MS[Math.min(current.retryAttempt, RETRY_MS.length - 1)];
      return { ...current, state: 'retry', retryAttempt, nextRetryAtMs: Date.now() + delay,
        lastError: String(error).slice(0, 160), updatedAtMs: Date.now() };
    });
    if (intent) {
      request.transientRetryAttempt = Math.max(request.transientRetryAttempt, intent.retryAttempt);
      retryAtMs = intent.nextRetryAtMs ?? retryAtMs;
    }
  } catch {
    // The Activity WAL remains the durable source. Keep bounded in-process
    // responsibility even when checkpoint storage itself is temporarily down;
    // recovery/start/finish will rediscover the same WAL after a process loss.
  }
  if (!requestMayRun(request)) return;
  const delay = Math.max(0, retryAtMs - Date.now());
  if (request.retryTimer) clearTimeout(request.retryTimer);
  request.retryTimer = setTimeout(() => { request.retryTimer = null; startWorker(request); }, delay);
}

async function projectOnce(request: RuntimeRequest): Promise<void> {
  if (!requestMayRun(request)) return;
  let intent = await readIntent(request.ownerUserId, request.clientActivityId);
  if (intent?.state === 'cancelled' || intent?.state === 'retired') return;
  if (!intent) {
    const journal = await readHikeTrackForProjection(request.clientActivityId);
    if (journal.length === 0) return;
    intent = await updateIntent(request.ownerUserId, request.clientActivityId, current => (
      current?.state === 'cancelled' || current?.state === 'retired'
        ? current
        : mergeRequestedTail(current, request, journal[journal.length - 1])
    ));
  }
  if (!intent || intent.state === 'cancelled' || intent.state === 'retired' || !requestMayRun(request)) return;
  await updateIntent(request.ownerUserId, request.clientActivityId, current => (
    !current || current.state === 'cancelled' || current.state === 'retired' ? current
      : { ...current, state: 'projecting', nextRetryAtMs: null, updatedAtMs: Date.now() }
  ));
  metrics.replayLoads += 1;
  let journal: TrackPoint[];
  try {
    journal = await readHikeTrackForProjection(request.clientActivityId);
  } catch (error) {
    if (String(error).includes('activity_projection_journal_missing')
      && intent.state === 'complete'
      && intent.projectedThroughPointId === intent.requestedThroughPointId) {
      // R3 cleanup could delete a fully projected WAL before R4 learned to
      // retire its intent. Absence is terminal only when the registry no longer
      // knows the Activity and the persisted frontier was already complete.
      const discovery = await discoverProjection(request.ownerUserId, request.clientActivityId);
      if (!discovery.known) {
        await updateIntent(request.ownerUserId, request.clientActivityId, current => (
          !current || current.state === 'cancelled' ? current : {
            ...current,
            state: 'retired',
            retiredAtMs: Date.now(),
            retryAttempt: 0,
            nextRetryAtMs: null,
            lastError: null,
            updatedAtMs: Date.now(),
          }
        ));
        metrics.retiredIntents += 1;
        return;
      }
    }
    throw error;
  }
  if (journal.length === 0) throw new Error('activity_projection_journal_empty');
  // The WAL is the recovery truth. A delayed/older subset request can never
  // reduce its obligation, and a point accepted between intent writes is found
  // even if the first intent write failed before process interruption.
  const journalTail = journal[journal.length - 1];
  if (intent.requestedThroughPointId !== pointId(journalTail)) {
    intent = await updateIntent(request.ownerUserId, request.clientActivityId, current => (
      !current || current.state === 'cancelled' || current.state === 'retired'
        ? current
        : mergeRequestedTail(
            current,
            request,
            journalTail,
            journal.some(point => pointId(point) === current.requestedThroughPointId),
          )
    ));
  }
  if (!intent || intent.state === 'cancelled' || intent.state === 'retired' || !requestMayRun(request)) return;
  const requestedIndex = journal.findIndex(point => pointId(point) === intent!.requestedThroughPointId);
  if (requestedIndex < 0) throw new Error('activity_projection_requested_point_missing');
  let startIndex = 0;
  if (intent.projectedThroughPointId) {
    const projectedIndex = journal.findIndex(point => pointId(point) === intent!.projectedThroughPointId);
    startIndex = projectedIndex >= 0 ? projectedIndex + 1 : 0;
  }
  for (let index = startIndex; index <= requestedIndex; index += 1) {
    if (!requestMayRun(request)) return;
    intent = await readIntent(request.ownerUserId, request.clientActivityId);
    if (!intent || intent.state === 'cancelled' || intent.state === 'retired' || !requestMayRun(request)) return;
    const point = journal[index];
    // Worker-only dependency stays lazy for the same purge/load boundary as
    // ownerIsCurrent above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recordMemoryEvidence } = require('../memory/services/recordMemoryEvidence');
    if (!requestMayRun(request)) return;
    const result = await recordMemoryEvidence({
      lat: point.lat, lng: point.lng, atMs: point.t, source: 'activity_real',
      ownerUserId: request.ownerUserId, durability: 'deferred',
      sourceActivityClientId: request.clientActivityId, sourceSegmentId: point.segmentId,
      horizontalAccuracyM: point.accuracy ?? undefined, continuityState: 'accepted',
    });
    metrics.projectedPoints += 1;
    if (result.deduplicated) metrics.deduplicatedPoints += 1;
    await updateIntent(request.ownerUserId, request.clientActivityId, current => {
      if (!current || current.state === 'cancelled' || current.state === 'retired') return current;
      const currentProjectedIndex = current.projectedThroughPointId
        ? journal.findIndex(candidate => pointId(candidate) === current.projectedThroughPointId)
        : -1;
      if (currentProjectedIndex > index) return current;
      return { ...current,
        projectedThroughPointId: pointId(point), projectedThroughTimestampMs: point.t,
        projectedThroughRawOrdinal: pointRawOrdinal(point),
        retryAttempt: 0, nextRetryAtMs: null, lastError: null, updatedAtMs: Date.now() };
    });
  }
  await updateIntent(request.ownerUserId, request.clientActivityId, current => {
    if (!current || current.state === 'cancelled' || current.state === 'retired') return current;
    const caughtUp = current.projectedThroughPointId === current.requestedThroughPointId;
    return { ...current, state: caughtUp ? 'complete' : 'pending',
      retryAttempt: caughtUp ? 0 : current.retryAttempt, nextRetryAtMs: null,
      lastError: null, updatedAtMs: Date.now() };
  });
}

function startWorker(request: RuntimeRequest): void {
  if (request.running || !requestMayRun(request)) { request.dirty = true; return; }
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

async function runAdmittedSchedule(args: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  points: TrackPoint[];
}, authorityGeneration: number): Promise<void> {
  if (await strictGet(purgeKey(args.ownerUserId))) throw new Error('activity_projection_owner_purged');
  if (!ownerAdmissionIsCurrent(args.ownerUserId, authorityGeneration)) {
    throw new Error('activity_projection_owner_purged');
  }
  // Callers submit points in committed WAL order. Timestamp sorting would be
  // lossy for batched equal-timestamp points and raw-ordinal strings are not a
  // numeric order, so the submitted tail remains the proposed obligation.
  const tail = args.points[args.points.length - 1];
  const request = runtimeFor(
    args.ownerUserId,
    args.clientActivityId,
    args.ownerGeneration,
    authorityGeneration,
  );
  const cancelGeneration = request.cancelGeneration;
  let intent: ActivityMemoryProjectionIntent | null = null;
  try {
    intent = await updateIntent(args.ownerUserId, args.clientActivityId, current => (
      current?.state === 'cancelled' || current?.state === 'retired'
        ? current
        : mergeRequestedTail(current, args, tail)
    ));
  } catch (error) {
    // The accepted WAL remains discoverable truth. Keep a bounded runtime retry
    // in this process; registry/WAL discovery reconstructs the intent after a
    // process interruption without waiting for another GPS observation.
    if (ownerAdmissionIsCurrent(args.ownerUserId, authorityGeneration)) {
      request.dirty = true;
      await markFailure(request, error).catch(() => undefined);
    }
    return;
  }
  if (!intent || intent.state === 'cancelled' || intent.state === 'retired' || request.cancelled
    || request.cancelGeneration !== cancelGeneration
    || !ownerAdmissionIsCurrent(args.ownerUserId, authorityGeneration)) return;
  metrics.scheduledPoints += args.points.length;
  metrics.durableIntents += 1;
  metrics.maximumPendingPoints = Math.max(metrics.maximumPendingPoints, args.points.length);
  // Only the still-admitted scheduler may publish/revive runtime work.
  request.cancelled = false;
  if (request.retryTimer) clearTimeout(request.retryTimer);
  request.retryTimer = null;
  request.dirty = true;
  startWorker(request);
}

/** Commit downstream responsibility after the Activity WAL append. The whole
 * scheduler is owner-admitted before its first await so account purge can drain
 * an intent write that has not yet become a visible runtime worker. */
export function scheduleActivityMemoryProjection(args: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  points: TrackPoint[];
}): Promise<void> {
  if (args.points.length === 0) return Promise.resolve();
  const authority = ownerAuthority(args.ownerUserId);
  if (authority.purging) return Promise.reject(new Error('activity_projection_owner_purged'));
  const authorityGeneration = authority.generation;
  let flight!: Promise<void>;
  flight = runAdmittedSchedule(args, authorityGeneration).finally(() => {
    authority.admittedSchedulers.delete(flight);
  });
  authority.admittedSchedulers.add(flight);
  return flight;
}

interface ProjectionDiscovery {
  known: boolean;
  eligible: boolean;
  ownerGeneration: string;
}

async function discoverProjection(
  ownerUserId: string,
  clientActivityId: string,
): Promise<ProjectionDiscovery> {
  // Lazy load keeps the headless projector independent of registry startup.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getActivityRegistry } = require('./activityRegistry');
  const registry = await getActivityRegistry(ownerUserId);
  if (registry.tombstones.some((item: any) => item.clientActivityId === clientActivityId)) {
    return { known: true, eligible: false, ownerGeneration: 'discarded' };
  }
  const unfinished = [registry.unfinished, ...registry.recoveryQueue]
    .find((item: any) => item?.clientActivityId === clientActivityId);
  if (unfinished) {
    return {
      known: true,
      eligible: unfinished.locationProviderSource !== 'simulator',
      ownerGeneration: unfinished.liveOwnerGeneration ?? 'recovered-journal',
    };
  }
  const completed = registry.completed.find((item: any) => item.clientActivityId === clientActivityId);
  if (completed) {
    return {
      known: true,
      eligible: completed.locationProviderSource !== 'simulator',
      ownerGeneration: 'completed-local',
    };
  }
  return { known: false, eligible: false, ownerGeneration: 'recovered-journal' };
}

async function discoverableActivitiesForOwner(ownerUserId: string): Promise<Array<{
  clientActivityId: string;
  ownerGeneration: string;
}>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getActivityRegistry } = require('./activityRegistry');
  const registry = await getActivityRegistry(ownerUserId);
  const records = [registry.unfinished, ...registry.recoveryQueue, ...registry.completed].filter(Boolean);
  const seen = new Set<string>();
  return records.flatMap((item: any) => {
    if (item.locationProviderSource === 'simulator' || seen.has(item.clientActivityId)) return [];
    seen.add(item.clientActivityId);
    return [{
      clientActivityId: item.clientActivityId,
      ownerGeneration: item.liveOwnerGeneration ?? 'completed-local',
    }];
  });
}

async function scanActivityMemoryProjectionsForOwner(
  ownerUserId: string,
  authorityGeneration: number,
): Promise<number> {
  metrics.discoveryAttempts += 1;
  if (!ownerUserId || !ownerAdmissionIsCurrent(ownerUserId, authorityGeneration)
    || !ownerIsCurrent(ownerUserId)) return 0;
  if (await strictGet(purgeKey(ownerUserId))) return 0;
  const failures: string[] = [];
  let keys: string[] = [];
  try {
    keys = typeof storage.getAllKeysStrict === 'function' ? await storage.getAllKeysStrict() : [];
  } catch (error) {
    failures.push(`key-enumeration:${String(error).slice(0, 120)}`);
  }
  let resumed = 0;
  const started = new Set<string>();
  const ownerIntentPrefix = `${INTENT_PREFIX}${encoded(ownerUserId)}:`;
  for (const key of keys.filter(value => value.startsWith(ownerIntentPrefix))) {
    if (!ownerAdmissionIsCurrent(ownerUserId, authorityGeneration) || !ownerIsCurrent(ownerUserId)) return resumed;
    let intent: ActivityMemoryProjectionIntent | null = null;
    try {
      intent = parseIntent(await strictGet(key));
    } catch (error) {
      failures.push(`intent-read:${key.slice(-80)}:${String(error).slice(0, 120)}`);
      continue;
    }
    if (!intent || intent.ownerUserId !== ownerUserId
      || intent.state === 'cancelled' || intent.state === 'retired') continue;
    const request = runtimeFor(
      ownerUserId,
      intent.clientActivityId,
      intent.ownerGeneration,
      authorityGeneration,
    );
    request.cancelled = false;
    if (request.retryTimer) clearTimeout(request.retryTimer);
    request.retryTimer = null;
    request.dirty = true;
    startWorker(request);
    started.add(intent.clientActivityId);
    resumed += 1;
  }
  // A failed first intent write leaves no key to enumerate. The Activity
  // registry supplies owner/provenance and the strict WAL reader supplies the
  // eligible durable tail, making responsibility discoverable on cold start.
  let activities: Awaited<ReturnType<typeof discoverableActivitiesForOwner>> = [];
  try {
    activities = await discoverableActivitiesForOwner(ownerUserId);
  } catch (error) {
    failures.push(`registry-read:${String(error).slice(0, 120)}`);
  }
  for (const activity of activities) {
    if (!ownerAdmissionIsCurrent(ownerUserId, authorityGeneration) || !ownerIsCurrent(ownerUserId)) return resumed;
    if (started.has(activity.clientActivityId)) continue;
    let journal: TrackPoint[];
    try {
      journal = await readHikeTrackForProjection(activity.clientActivityId);
    } catch (error) {
      if (String(error).includes('activity_projection_journal_missing')) continue;
      failures.push(`journal-read:${activity.clientActivityId.slice(-80)}:${String(error).slice(0, 120)}`);
      continue;
    }
    if (journal.length === 0) continue;
    try {
      await scheduleActivityMemoryProjection({ ownerUserId, ...activity, points: journal });
      const registered = await readIntent(ownerUserId, activity.clientActivityId);
      if (!registered) {
        failures.push(`intent-registration:${activity.clientActivityId.slice(-80)}:intent-not-durable`);
        continue;
      }
    } catch (error) {
      if (!ownerAdmissionIsCurrent(ownerUserId, authorityGeneration) || !ownerIsCurrent(ownerUserId)) return resumed;
      failures.push(`intent-registration:${activity.clientActivityId.slice(-80)}:${String(error).slice(0, 120)}`);
      continue;
    }
    started.add(activity.clientActivityId);
    resumed += 1;
  }
  if (failures.length > 0) throw new Error(`activity_projection_discovery_failed ${failures.join('|')}`);
  return resumed;
}

function scheduleDiscoveryRetry(
  ownerUserId: string,
  authority: OwnerProjectionAuthority,
  authorityGeneration: number,
  error: unknown,
): void {
  authority.discoveryLastError = String(error).slice(0, 400);
  metrics.discoveryFailures += 1;
  if (!ownerAdmissionIsCurrent(ownerUserId, authorityGeneration) || !ownerIsCurrent(ownerUserId)) return;
  const delay = RETRY_MS[Math.min(authority.discoveryRetryAttempt, RETRY_MS.length - 1)];
  authority.discoveryRetryAttempt += 1;
  authority.discoveryNextRetryAtMs = Date.now() + delay;
  if (authority.discoveryTimer) clearTimeout(authority.discoveryTimer);
  authority.discoveryTimer = setTimeout(() => {
    authority.discoveryTimer = null;
    authority.discoveryNextRetryAtMs = null;
    if (!ownerAdmissionIsCurrent(ownerUserId, authorityGeneration) || !ownerIsCurrent(ownerUserId)) return;
    void resumeActivityMemoryProjectionsForOwner(ownerUserId).catch(() => undefined);
  }, delay);
  metrics.discoveryRetriesScheduled += 1;
}

/** Start or join the one owner-scoped discovery scan. A failed pre-intent scan
 * rejects its immediate caller for observability and also owns a bounded retry
 * timer, so accepted WAL progresses without another GPS fix or login cycle. */
export function resumeActivityMemoryProjectionsForOwner(ownerUserId: string): Promise<number> {
  if (!ownerUserId) return Promise.resolve(0);
  const authority = ownerAuthority(ownerUserId);
  if (authority.purging) return Promise.resolve(0);
  if (authority.discoveryFlight) return authority.discoveryFlight;
  const authorityGeneration = authority.generation;
  let flight!: Promise<number>;
  flight = scanActivityMemoryProjectionsForOwner(ownerUserId, authorityGeneration)
    .then(resumed => {
      if (ownerAdmissionIsCurrent(ownerUserId, authorityGeneration)) {
        authority.discoveryRetryAttempt = 0;
        authority.discoveryNextRetryAtMs = null;
        authority.discoveryLastError = null;
        if (authority.discoveryTimer) clearTimeout(authority.discoveryTimer);
        authority.discoveryTimer = null;
      }
      return resumed;
    })
    .catch(error => {
      scheduleDiscoveryRetry(ownerUserId, authority, authorityGeneration, error);
      throw error;
    })
    .finally(() => {
      if (authority.discoveryFlight === flight) authority.discoveryFlight = null;
    });
  authority.discoveryFlight = flight;
  return flight;
}

export function getActivityMemoryProjectionDiscoveryState(ownerUserId: string): {
  running: boolean;
  retryAttempt: number;
  nextRetryAtMs: number | null;
  lastError: string | null;
} {
  const authority = ownerAuthority(ownerUserId);
  return {
    running: authority.discoveryFlight !== null,
    retryAttempt: authority.discoveryRetryAttempt,
    nextRetryAtMs: authority.discoveryNextRetryAtMs,
    lastError: authority.discoveryLastError,
  };
}

export function cancelActivityMemoryProjectionDiscoveryForOwner(ownerUserId: string): void {
  const authority = ownerAuthority(ownerUserId);
  authority.generation += 1;
  if (authority.discoveryTimer) clearTimeout(authority.discoveryTimer);
  authority.discoveryTimer = null;
  authority.discoveryNextRetryAtMs = null;
  authority.discoveryRetryAttempt = 0;
  authority.discoveryLastError = null;
  for (const request of requests.values()) {
    if (request.ownerUserId !== ownerUserId) continue;
    request.cancelled = true;
    request.cancelGeneration += 1;
    if (request.retryTimer) clearTimeout(request.retryTimer);
    request.retryTimer = null;
  }
}

export async function waitForActivityMemoryProjection(clientActivityId: string): Promise<void> {
  for (const request of [...requests.values()].filter(item => item.clientActivityId === clientActivityId)) {
    if (request.flight) await request.flight;
  }
}

export async function activityMemoryProjectionIsComplete(ownerUserId: string, clientActivityId: string): Promise<boolean> {
  const intent = await readIntent(ownerUserId, clientActivityId);
  return (intent?.state === 'complete' || intent?.state === 'retired')
    && intent.projectedThroughPointId === intent.requestedThroughPointId;
}

export async function reconcileActivityMemoryProjection(ownerUserId: string, clientActivityId: string): Promise<boolean> {
  let intent = await readIntent(ownerUserId, clientActivityId);
  if (intent?.state === 'retired') return true;
  let discovery: ProjectionDiscovery | null = null;
  if (!intent) {
    discovery = await discoverProjection(ownerUserId, clientActivityId);
    if (discovery.known && !discovery.eligible) return true;
    let journal: TrackPoint[];
    try {
      journal = await readHikeTrackForProjection(clientActivityId);
    } catch (error) {
      if (String(error).includes('activity_projection_journal_missing')) {
        // A known real Activity without its intent or WAL has no proof that its
        // Memory responsibility completed. Unknown identities have no durable
        // eligible evidence to clean up.
        return !discovery.known;
      }
      return false;
    }
    if (journal.length === 0) return true;
    if (!discovery.known) return false;
    await scheduleActivityMemoryProjection({
      ownerUserId,
      clientActivityId,
      ownerGeneration: discovery.ownerGeneration,
      points: journal,
    });
    intent = await readIntent(ownerUserId, clientActivityId);
    if (!intent) return false;
  }
  const request = runtimeFor(
    ownerUserId,
    clientActivityId,
    intent.ownerGeneration,
    ownerAuthority(ownerUserId).generation,
  );
  request.cancelled = false;
  if (request.retryTimer) clearTimeout(request.retryTimer);
  request.retryTimer = null;
  request.dirty = true;
  startWorker(request);
  if (request.flight) await request.flight;
  return activityMemoryProjectionIsComplete(ownerUserId, clientActivityId);
}

/** Seal the exact completed frontier before ACK cleanup removes its WAL and
 * registry record. The durable retired intent is intentionally retained: it is
 * the crash-safe proof that a later cold launch must stay quiescent. */
export async function retireActivityMemoryProjection(
  ownerUserId: string,
  clientActivityId: string,
): Promise<boolean> {
  let intent = await readIntent(ownerUserId, clientActivityId);
  if (!intent) {
    const discovery = await discoverProjection(ownerUserId, clientActivityId);
    if (discovery.known && !discovery.eligible) return true;
    try {
      const journal = await readHikeTrackForProjection(clientActivityId);
      // A real zero-point Activity has no eligible witness to retire.
      return journal.length === 0;
    } catch {
      return false;
    }
  }
  if (intent.state === 'retired') return true;
  if (intent.state !== 'complete'
    || intent.projectedThroughPointId !== intent.requestedThroughPointId) return false;
  const request = requests.get(runtimeKey(ownerUserId, clientActivityId));
  if (request) {
    request.cancelled = true;
    request.cancelGeneration += 1;
    if (request.retryTimer) clearTimeout(request.retryTimer);
    request.retryTimer = null;
    if (request.flight) await request.flight;
  }
  intent = await updateIntent(ownerUserId, clientActivityId, current => {
    if (!current || current.state === 'cancelled') return current;
    if (current.state === 'retired') return current;
    if (current.state !== 'complete'
      || current.projectedThroughPointId !== current.requestedThroughPointId) return current;
    return {
      ...current,
      state: 'retired',
      retiredAtMs: Date.now(),
      retryAttempt: 0,
      nextRetryAtMs: null,
      lastError: null,
      updatedAtMs: Date.now(),
    };
  });
  if (intent?.state === 'retired') {
    metrics.retiredIntents += 1;
    return true;
  }
  return false;
}

export async function cancelActivityMemoryProjection(ownerUserId: string, clientActivityId: string): Promise<void> {
  const request = requests.get(runtimeKey(ownerUserId, clientActivityId));
  if (request) {
    request.cancelled = true;
    request.cancelGeneration += 1;
    if (request.retryTimer) clearTimeout(request.retryTimer);
    request.retryTimer = null;
  }
  await updateIntent(ownerUserId, clientActivityId, current => current
    ? current.state === 'retired' ? current
      : { ...current, state: 'cancelled', nextRetryAtMs: null, updatedAtMs: Date.now() }
    : null);
}

export async function purgeActivityMemoryProjectionsForOwner(ownerUserId: string): Promise<void> {
  const authority = ownerAuthority(ownerUserId);
  // Synchronous admission fence: no scheduler can enter after this point, and
  // every scheduler already past its first line is present in this exact set.
  authority.purging = true;
  authority.generation += 1;
  if (authority.discoveryTimer) clearTimeout(authority.discoveryTimer);
  authority.discoveryTimer = null;
  authority.discoveryNextRetryAtMs = null;
  authority.discoveryRetryAttempt = 0;
  authority.discoveryLastError = null;
  await storage.setItem(purgeKey(ownerUserId), JSON.stringify({ v: 1, deletedAtMs: Date.now() }), { strict: true });
  for (const request of requests.values()) {
    if (request.ownerUserId !== ownerUserId) continue;
    request.cancelled = true;
    request.cancelGeneration += 1;
    if (request.retryTimer) clearTimeout(request.retryTimer);
    request.retryTimer = null;
  }
  // Release barriers concurrently with purge in tests/production: admitted
  // scheduler mutations are finite storage operations and must drain before the
  // final owner scan. Unrelated owners are never awaited.
  if (authority.admittedSchedulers.size > 0) {
    await Promise.allSettled([...authority.admittedSchedulers]);
  }
  if (authority.discoveryFlight) await Promise.allSettled([authority.discoveryFlight]);
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
  const ownerIntentPrefix = `${INTENT_PREFIX}${encoded(ownerUserId)}:`;
  for (const key of keys.filter(value => value.startsWith(ownerIntentPrefix))) {
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
  for (const authority of ownerAuthorities.values()) if (authority.discoveryTimer) clearTimeout(authority.discoveryTimer);
  requests.clear();
  storageTails.clear();
  ownerAuthorities.clear();
  metrics = { scheduledPoints: 0, projectedPoints: 0, deduplicatedPoints: 0,
    replayLoads: 0, failures: 0, maximumPendingPoints: 0, durableIntents: 0,
    retiredIntents: 0, discoveryAttempts: 0, discoveryFailures: 0, discoveryRetriesScheduled: 0 };
}
