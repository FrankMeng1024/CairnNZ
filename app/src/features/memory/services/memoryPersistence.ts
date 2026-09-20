/**
 * Memory persistence — saves the explored tile map to AsyncStorage so
 * users don't lose memory across app restarts.
 *
 * Design choices:
 *   - Storage key per user (so logging out + back in different account
 *     gets a fresh slate)
 *   - Debounced writes (write at most every 3s) so heavy unlock bursts
 *     during a hike don't thrash AsyncStorage
 *   - **Max-wait force flush** (15s) so continuous walking — which
 *     re-arms the debounce on every GPS tick — still flushes regularly.
 *     Without this, a user who walks for an hour could lose every
 *     unlock if the app is killed before stopping.
 *   - **Flush captures userId in closure** so a user-switch (A→B) mid
 *     debounce window cannot misroute A's tiles to B's storage key.
 *   - Bitmap is base64-encoded (Uint8Array → string → AsyncStorage
 *     value)
 *
 * NOT in here:
 *   - Server sync (deferred to v0.2.7)
 *   - Cross-device merge (deferred — local-only is sufficient for MVP)
 *
 * The persistence layer is a pure adapter: it reads the store, writes
 * to AsyncStorage, and on hydrate writes back into the store. The
 * store itself is unaware of persistence.
 */

import { storage } from '../../../store/storage';
import { MemoryPresenceWitness, useMemoryStore, VisitedPoint } from '../store/useMemoryStore';
import {
  hasMemoryHydrateFailedBefore,
  markMemoryHydrateInProgress,
  markMemoryHydrateSuccess,
} from '../lib/memoryHydrateGate';


// v0.2.6.3: schema bumped from v2 (point array, no cid) to v3 (cid required).
// Storage key prefix bumped to v3 so old v2 payloads are abandoned, but
// deserialize() also accepts v2 input and synthesizes a deterministic cid
// per point so the migration round-trips correctly without losing data.
// v358: bumped v4 → v5. Server-side ran v358 Kalman re-smooth that fixed
// the v355 bug where sessions without 't' (timestamp) field on each
// route_points entry were silently dropped — specifically the "back"
// session (id 46). v358 synthesises ts from session.start_time + idx.
// Old v4 client caches hold the v355 data missing session 46; bumping
// the key forces a fresh pull from server which now contains 413 points
// for user 4 (vs 367 in v355) including the 46 points for the "back" hike.
const STORAGE_KEY_PREFIX = 'cairn:memory:tiles:v5:';
const PRESENCE_STORAGE_KEY_PREFIX = 'cairn:memory:presence:v1:';
// Debug Raw GPS evidence is durable for reproducible QA, but its separate key
// and store collection prevent it from entering Personal sync or sharing.
const SYNTHETIC_STORAGE_KEY_PREFIX = 'cairn:memory:synthetic:v1:';
const DEBOUNCE_MS = 3_000;
/**
 * Hard cap on how long a flush can be deferred. Without this, every GPS
 * tick (every 2s during walking) re-arms the 3s debounce — meaning the
 * flush never actually fires. App kill = total memory loss.
 */
const MAX_WAIT_MS = 15_000;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let presenceFlushTimer: ReturnType<typeof setTimeout> | null = null;
let presenceMaxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let syntheticFlushTimer: ReturnType<typeof setTimeout> | null = null;
let syntheticMaxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let currentUserId: string | null = null;
let persistenceState: 'detached' | 'hydrating' | 'writable' | 'blocked' = 'detached';
/**
 * Generation token. Bumped on every hydrate/detach. Stale awaits check
 * this and bail out, so concurrent user switches can't corrupt state.
 */
let generation = 0;
let persistenceMetrics = {
  writes: 0,
  coverageWrites: 0,
  presenceWrites: 0,
  bytes: 0,
  totalWriteMs: 0,
  maxWriteMs: 0,
};

export function resetMemoryPersistenceMetrics(): void {
  persistenceMetrics = {
    writes: 0,
    coverageWrites: 0,
    presenceWrites: 0,
    bytes: 0,
    totalWriteMs: 0,
    maxWriteMs: 0,
  };
}

export function getMemoryPersistenceMetrics(): typeof persistenceMetrics {
  return { ...persistenceMetrics };
}

// O1: removed bytesToBase64/base64ToBytes — 0 callers, `void` suppression
// confirmed dead code. If future needed, standard btoa/atob is inline-cheap.

interface SerializedPoint {
  /** lat (number) */
  a: number;
  /** lng (number) */
  o: number;
  /** ts (Unix ms) */
  t: number;
  /** synced flag (1 = synced, 0 = pending) */
  s: 0 | 1;
  /** cid (uuid v4 or sha1-derived). v3 schema; absent in v2. */
  c?: string;
  /** Evidence source: activity, passive, or historical/unknown. */
  e?: 'a' | 'p' | 'h';
  /** Stable client Activity identity. */
  i?: string;
  /** Stable canonical segment identity. */
  g?: string;
  /** Horizontal accuracy in metres. */
  h?: number;
  /** Continuity: accepted, gap, unknown. */
  n?: 'a' | 'g' | 'u';
}

interface SerializedMemoryV4 {
  v: 4 | 3 | 2;
  points: SerializedPoint[];
  initialRevealDone: boolean;
}

interface SerializedPresenceV1 {
  v: 1;
  witnesses: Array<{
    c: string;
    fa: number;
    fo: number;
    ft: number;
    a: number;
    o: number;
    t: number;
    e: 'a' | 'p';
    i?: string;
    g?: string;
    h: number;
    s: 0 | 1;
  }>;
}

interface SerializedSyntheticV1 {
  v: 1;
  provenance: 'simulator_test';
  points: Array<{
    a: number;
    o: number;
    t: number;
    c: string;
    i?: string;
    g?: string;
    h?: number;
    n: 'a' | 'g' | 'u';
  }>;
}

function serialize(points: VisitedPoint[], initialRevealDone: boolean): SerializedMemoryV4 {
  return {
    v: 4,
    points: points.map((p) => ({
      a: p.lat,
      o: p.lng,
      t: p.ts,
      s: p.synced ? 1 : 0,
      c: p.cid,
      e: p.evidenceSource === 'activity_real' ? 'a' : p.evidenceSource === 'passive_real' ? 'p' : 'h',
      i: p.sourceActivityClientId,
      g: p.sourceSegmentId,
      h: p.horizontalAccuracyM,
      n: p.continuityState === 'accepted' ? 'a' : p.continuityState === 'gap' ? 'g' : 'u',
    })),
    initialRevealDone,
  };
}

function serializePresence(witnesses: MemoryPresenceWitness[]): SerializedPresenceV1 {
  return {
    v: 1,
    witnesses: witnesses.map(witness => ({
      c: witness.cid,
      fa: witness.firstLat,
      fo: witness.firstLng,
      ft: witness.firstObservedAtMs,
      a: witness.lat,
      o: witness.lng,
      t: witness.observedAtMs,
      e: witness.evidenceSource === 'activity_real' ? 'a' : 'p',
      i: witness.sourceActivityClientId,
      g: witness.sourceSegmentId,
      h: witness.horizontalAccuracyM,
      s: witness.synced ? 1 : 0,
    })),
  };
}

function serializeSynthetic(points: VisitedPoint[]): SerializedSyntheticV1 {
  return {
    v: 1,
    provenance: 'simulator_test',
    points: points.map(point => ({
      a: point.lat,
      o: point.lng,
      t: point.ts,
      c: point.cid,
      i: point.sourceActivityClientId,
      g: point.sourceSegmentId,
      h: point.horizontalAccuracyM,
      n: point.continuityState === 'accepted' ? 'a' : point.continuityState === 'gap' ? 'g' : 'u',
    })),
  };
}

function deserializeSynthetic(raw: string): VisitedPoint[] | null {
  try {
    const parsed = JSON.parse(raw) as SerializedSyntheticV1;
    if (parsed.v !== 1 || parsed.provenance !== 'simulator_test' || !Array.isArray(parsed.points)) return null;
    return parsed.points.map(point => {
      if (![point.a, point.o, point.t].every(Number.isFinite)
        || point.a < -90 || point.a > 90 || point.o < -180 || point.o > 180
        || point.t <= 0 || typeof point.c !== 'string' || point.c.length === 0
        || (point.n !== 'a' && point.n !== 'g' && point.n !== 'u')) {
        throw new Error('invalid_synthetic_memory_point');
      }
      return {
        lat: point.a,
        lng: point.o,
        ts: point.t,
        cid: point.c,
        synced: false,
        evidenceSource: 'simulator_test' as const,
        sourceActivityClientId: typeof point.i === 'string' && point.i.length > 0 ? point.i : undefined,
        sourceSegmentId: typeof point.g === 'string' && point.g.length > 0 ? point.g : undefined,
        horizontalAccuracyM: typeof point.h === 'number' && Number.isFinite(point.h) ? point.h : undefined,
        continuityState: point.n === 'a' ? 'accepted' as const : point.n === 'g' ? 'gap' as const : 'unknown' as const,
      };
    });
  } catch {
    return null;
  }
}

/**
 * L1 fix (v0.2.6.3): for v2 (no cid) legacy points, leave cid empty.
 * The first push will arrive at the server WITHOUT cid; server applies
 * deterministicCid (sha1 of userId|ts|lat|lng) and echoes the canonical
 * cid back. The sync service's markPointsSyncedByEcho() will then write
 * the server's cid into the local point. This avoids the v2→v3
 * dual-cid duplication where client-side legacyDeterministicCid (FNV)
 * disagreed with server-side deterministicCid (sha1) and created two
 * server rows for the same physical location.
 */
function legacyDeterministicCid(_lat: number, _lng: number, _ts: number): string {
  // Empty cid is a sentinel: persistence saw a v2 point. The next
  // push round-trip will fill in the canonical server cid.
  return '';
}

function deserialize(raw: string): { points: VisitedPoint[]; initialRevealDone: boolean } | null {
  try {
    const parsed = JSON.parse(raw) as SerializedMemoryV4;
    if ((parsed.v !== 2 && parsed.v !== 3 && parsed.v !== 4) || !Array.isArray(parsed.points)) return null;
    const points: VisitedPoint[] = [];
    for (const p of parsed.points) {
      if (typeof p?.a !== 'number' || typeof p?.o !== 'number') return null;
      if (!isFinite(p.a) || p.a < -90 || p.a > 90 || !isFinite(p.o) || p.o < -180 || p.o > 180) return null;
      if (typeof p.t !== 'number' || !Number.isFinite(p.t) || p.t <= 0) return null;
      if (p.s !== 0 && p.s !== 1) return null;
      if ((parsed.v === 3 || parsed.v === 4) && (typeof p.c !== 'string' || p.c.length === 0)) return null;
      if (parsed.v === 4 && p.e !== 'a' && p.e !== 'p' && p.e !== 'h') return null;
      const ts = p.t;
      const cid = (typeof p.c === 'string' && p.c.length > 0)
        ? p.c
        : legacyDeterministicCid(p.a, p.o, ts);
      points.push({
        lat: p.a,
        lng: p.o,
        ts,
        cid,
        synced: p.s === 1,
        evidenceSource: p.e === 'a' ? 'activity_real' : p.e === 'p' ? 'passive_real' : 'historical_unknown',
        sourceActivityClientId: typeof p.i === 'string' && p.i.length > 0 ? p.i : undefined,
        sourceSegmentId: typeof p.g === 'string' && p.g.length > 0 ? p.g : undefined,
        horizontalAccuracyM: typeof p.h === 'number' && Number.isFinite(p.h) ? p.h : undefined,
        continuityState: p.n === 'a' ? 'accepted' : p.n === 'g' ? 'gap' : 'unknown',
      });
    }
    return { points, initialRevealDone: Boolean(parsed.initialRevealDone) };
  } catch {
    return null;
  }
}

function deserializePresence(raw: string): MemoryPresenceWitness[] | null {
  try {
    const parsed = JSON.parse(raw) as SerializedPresenceV1;
    if (parsed.v !== 1 || !Array.isArray(parsed.witnesses)) return null;
    const witnesses: MemoryPresenceWitness[] = [];
    for (const value of parsed.witnesses) {
      if (typeof value?.c !== 'string' || value.c.length === 0 || value.c.length > 36) return null;
      if (![value.fa, value.fo, value.a, value.o].every(Number.isFinite)) return null;
      if (value.fa < -90 || value.fa > 90 || value.a < -90 || value.a > 90
        || value.fo < -180 || value.fo > 180 || value.o < -180 || value.o > 180) return null;
      if (!Number.isFinite(value.ft) || value.ft <= 0
        || !Number.isFinite(value.t) || value.t < value.ft) return null;
      if ((value.e !== 'a' && value.e !== 'p') || (value.s !== 0 && value.s !== 1)) return null;
      if (!Number.isFinite(value.h) || value.h < 0 || value.h > 50) return null;
      if (value.e === 'a' && (typeof value.i !== 'string' || value.i.length === 0)) return null;
      witnesses.push({
        cid: value.c,
        firstLat: value.fa,
        firstLng: value.fo,
        firstObservedAtMs: value.ft,
        lat: value.a,
        lng: value.o,
        observedAtMs: value.t,
        evidenceSource: value.e === 'a' ? 'activity_real' : 'passive_real',
        sourceActivityClientId: value.e === 'a' ? value.i : undefined,
        sourceSegmentId: value.e === 'a' && typeof value.g === 'string' && value.g.length > 0 ? value.g : undefined,
        horizontalAccuracyM: value.h,
        continuityState: 'accepted',
        synced: value.s === 1,
      });
    }
    return witnesses;
  } catch {
    return null;
  }
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function presenceStorageKey(userId: string): string {
  return `${PRESENCE_STORAGE_KEY_PREFIX}${userId}`;
}

function syntheticStorageKey(userId: string): string {
  return `${SYNTHETIC_STORAGE_KEY_PREFIX}${userId}`;
}

function clearTimers(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
  if (presenceFlushTimer) {
    clearTimeout(presenceFlushTimer);
    presenceFlushTimer = null;
  }
  if (presenceMaxWaitTimer) {
    clearTimeout(presenceMaxWaitTimer);
    presenceMaxWaitTimer = null;
  }
  if (syntheticFlushTimer) {
    clearTimeout(syntheticFlushTimer);
    syntheticFlushTimer = null;
  }
  if (syntheticMaxWaitTimer) {
    clearTimeout(syntheticMaxWaitTimer);
    syntheticMaxWaitTimer = null;
  }
}

/**
 * Flush a snapshot to disk. Callers take the snapshot only when a durable
 * write actually runs; ordinary mutations therefore do not copy/serialize
 * the full Memory history.
 *
 * N5 fix (v0.2.6.3): previously read useMemoryStore.getState() at flush
 * time. If the new user's clearAll fired between schedule and flush,
 * we'd serialize empty (or worse, the new user's points) to the OLD
 * user's storage key.
 */
async function flush(userId: string, snapshot: { points: VisitedPoint[]; initialRevealDone: boolean }): Promise<void> {
  if (!userId) return;
  const payload = serialize(snapshot.points, snapshot.initialRevealDone);
  const serialized = JSON.stringify(payload);
  const startedAt = Date.now();
  // Memory evidence is a committed product record, not a best-effort cache.
  // Propagate quota / disk errors so recordMemoryEvidence cannot report a
  // durable commit when AsyncStorage rejected the write.
  await storage.setItem(storageKey(userId), serialized, { strict: true });
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  persistenceMetrics.writes += 1;
  persistenceMetrics.coverageWrites += 1;
  persistenceMetrics.bytes += serialized.length;
  persistenceMetrics.totalWriteMs += elapsedMs;
  persistenceMetrics.maxWriteMs = Math.max(persistenceMetrics.maxWriteMs, elapsedMs);
}

async function flushPresence(userId: string, witnesses: MemoryPresenceWitness[]): Promise<void> {
  if (!userId) return;
  const serialized = JSON.stringify(serializePresence(witnesses));
  const startedAt = Date.now();
  await storage.setItem(presenceStorageKey(userId), serialized, { strict: true });
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  persistenceMetrics.writes += 1;
  persistenceMetrics.presenceWrites += 1;
  persistenceMetrics.bytes += serialized.length;
  persistenceMetrics.totalWriteMs += elapsedMs;
  persistenceMetrics.maxWriteMs = Math.max(persistenceMetrics.maxWriteMs, elapsedMs);
}

async function flushSynthetic(userId: string, points: VisitedPoint[]): Promise<void> {
  if (!userId) return;
  const serialized = JSON.stringify(serializeSynthetic(points));
  const startedAt = Date.now();
  await storage.setItem(syntheticStorageKey(userId), serialized, { strict: true });
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  persistenceMetrics.writes += 1;
  persistenceMetrics.bytes += serialized.length;
  persistenceMetrics.totalWriteMs += elapsedMs;
  persistenceMetrics.maxWriteMs = Math.max(persistenceMetrics.maxWriteMs, elapsedMs);
}

/**
 * Both timers read the current owned store only when a write actually fires.
 * This keeps the max-wait snapshot current without copying full Memory on
 * every 1 m mutation.
 */
let latestSnapshotUserId: string | null = null;
let latestPresenceSnapshotUserId: string | null = null;
let latestSyntheticSnapshotUserId: string | null = null;

function scheduleFlush(): void {
  const userIdAtSchedule = currentUserId;
  if (!userIdAtSchedule || persistenceState !== 'writable') return;
  latestSnapshotUserId = userIdAtSchedule;

  const flushLatestOwnedSnapshot = () => {
    if (latestSnapshotUserId !== userIdAtSchedule || currentUserId !== userIdAtSchedule) return;
    const state = useMemoryStore.getState();
    void flush(userIdAtSchedule, {
      points: state.points.slice(),
      initialRevealDone: state.initialRevealDone,
    }).catch(() => {});
  };

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
    flushLatestOwnedSnapshot();
  }, DEBOUNCE_MS);

  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushLatestOwnedSnapshot();
    }, MAX_WAIT_MS);
  }
}

function schedulePresenceFlush(): void {
  const userIdAtSchedule = currentUserId;
  if (!userIdAtSchedule || persistenceState !== 'writable') return;
  latestPresenceSnapshotUserId = userIdAtSchedule;

  const flushLatestOwnedPresence = () => {
    if (latestPresenceSnapshotUserId !== userIdAtSchedule || currentUserId !== userIdAtSchedule) return;
    const witnesses = useMemoryStore.getState().presenceWitnesses.slice();
    void flushPresence(userIdAtSchedule, witnesses).catch(() => {});
  };

  if (presenceFlushTimer) clearTimeout(presenceFlushTimer);
  presenceFlushTimer = setTimeout(() => {
    presenceFlushTimer = null;
    if (presenceMaxWaitTimer) {
      clearTimeout(presenceMaxWaitTimer);
      presenceMaxWaitTimer = null;
    }
    flushLatestOwnedPresence();
  }, DEBOUNCE_MS);

  if (!presenceMaxWaitTimer) {
    presenceMaxWaitTimer = setTimeout(() => {
      presenceMaxWaitTimer = null;
      if (presenceFlushTimer) {
        clearTimeout(presenceFlushTimer);
        presenceFlushTimer = null;
      }
      flushLatestOwnedPresence();
    }, MAX_WAIT_MS);
  }
}

function scheduleSyntheticFlush(): void {
  const userIdAtSchedule = currentUserId;
  if (!userIdAtSchedule || persistenceState !== 'writable') return;
  latestSyntheticSnapshotUserId = userIdAtSchedule;
  const flushLatest = () => {
    if (latestSyntheticSnapshotUserId !== userIdAtSchedule || currentUserId !== userIdAtSchedule) return;
    void flushSynthetic(userIdAtSchedule, useMemoryStore.getState().testPoints.slice()).catch(() => {});
  };
  if (syntheticFlushTimer) clearTimeout(syntheticFlushTimer);
  syntheticFlushTimer = setTimeout(() => {
    syntheticFlushTimer = null;
    if (syntheticMaxWaitTimer) {
      clearTimeout(syntheticMaxWaitTimer);
      syntheticMaxWaitTimer = null;
    }
    flushLatest();
  }, DEBOUNCE_MS);
  if (!syntheticMaxWaitTimer) {
    syntheticMaxWaitTimer = setTimeout(() => {
      syntheticMaxWaitTimer = null;
      if (syntheticFlushTimer) {
        clearTimeout(syntheticFlushTimer);
        syntheticFlushTimer = null;
      }
      flushLatest();
    }, MAX_WAIT_MS);
  }
}

/**
 * Force an immediate synchronous-flush request. Used on AppState
 * background and on logout to guarantee durability.
 */
export async function flushMemoryNow(options: { coverage?: boolean; presence?: boolean } = {}): Promise<void> {
  const userId = currentUserId;
  if (!userId) return;
  if (persistenceState !== 'writable') throw new Error('memory_persistence_unavailable');
  clearTimers();
  const state = useMemoryStore.getState();
  const writeCoverage = options.coverage ?? (options.presence === undefined);
  const writePresence = options.presence ?? (options.coverage === undefined);
  if (writeCoverage) {
    await flush(userId, { points: state.points.slice(), initialRevealDone: state.initialRevealDone });
  }
  if (writePresence) {
    await flushPresence(userId, (state.presenceWitnesses ?? []).slice());
  }
}

/** Force the isolated Debug Raw GPS realm to disk without touching Personal Memory. */
export async function flushSyntheticMemoryNow(): Promise<void> {
  const userId = currentUserId;
  if (!userId) return;
  if (persistenceState !== 'writable') throw new Error('memory_persistence_unavailable');
  if (syntheticFlushTimer) {
    clearTimeout(syntheticFlushTimer);
    syntheticFlushTimer = null;
  }
  if (syntheticMaxWaitTimer) {
    clearTimeout(syntheticMaxWaitTimer);
    syntheticMaxWaitTimer = null;
  }
  await flushSynthetic(userId, useMemoryStore.getState().testPoints.slice());
}

/** Attach the durable local Memory authority on first product write. */
export async function ensureMemoryPersistenceForUser(userId: string): Promise<void> {
  if (!userId) throw new Error('memory_user_required');
  if (currentUserId === userId && persistenceState === 'writable' && unsubscribe) return;
  if (currentUserId === userId && persistenceState === 'blocked') {
    throw new Error('memory_hydration_blocked');
  }
  await hydrateMemoryForUser(userId);
}

/**
 * Hydrate the store from disk for the given user. Call once on app
 * boot after auth resolves.
 */
export async function hydrateMemoryForUser(userId: string): Promise<void> {
  if (!userId) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memhydrate_entry');
  } catch {/* ignore */}
  const myGeneration = ++generation;
  await detachMemoryPersistence(false);
  if (myGeneration !== generation) return;

  // Clearing the prior account's in-memory projection is safe; writing that
  // empty projection over this user's durable record is not. The subscriber
  // is attached only after a complete, supported payload is proven valid.
  useMemoryStore.getState().resetForUserSwitch();
  currentUserId = userId;
  persistenceState = 'hydrating';

  const block = (reason: string): never => {
    persistenceState = 'blocked';
    throw new Error(reason);
  };

  if (hasMemoryHydrateFailedBefore()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../services/bootDiagnostics').markBootPhase('memhydrate_gate_blocked');
    } catch {/* ignore */}
    block('memory_hydration_previously_failed');
  }

  try {
    await markMemoryHydrateInProgress();
  } catch {
    block('memory_hydration_gate_write_failed');
  }
  let raw: string | null = null;
  let rawPresence: string | null = null;
  let rawSynthetic: string | null = null;
  try {
    raw = await storage.getItem(storageKey(userId));
    rawPresence = await storage.getItem(presenceStorageKey(userId));
    rawSynthetic = await storage.getItem(syntheticStorageKey(userId));
  } catch {
    block('memory_hydration_read_failed');
  }
  if (myGeneration !== generation) return;

  if (raw !== null) {
    const MAX_RAW_BYTES = 500_000;
    if (raw.length > MAX_RAW_BYTES) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('memhydrate_payload_too_large', {
          raw_len: raw.length,
          limit: MAX_RAW_BYTES,
        });
      } catch {/* ignore */}
      block('memory_hydration_payload_too_large');
    }
    const decoded = deserialize(raw);
    if (!decoded) {
      persistenceState = 'blocked';
      throw new Error('memory_hydration_corrupt_or_partial');
    }

    const needsRevealMigration = decoded.initialRevealDone && decoded.points.length < 50;
    const inMemoryUnsynced = useMemoryStore.getState().points.filter((point) => !point.synced);
    const mergedForHydrate = inMemoryUnsynced.length > 0
      ? [...decoded.points, ...inMemoryUnsynced].sort((a, b) => a.ts - b.ts)
      : decoded.points;
    useMemoryStore.getState().replacePoints(
      mergedForHydrate,
      needsRevealMigration ? false : decoded.initialRevealDone,
    );
  }

  if (rawPresence !== null) {
    const MAX_PRESENCE_RAW_BYTES = 750_000;
    if (rawPresence.length > MAX_PRESENCE_RAW_BYTES) {
      block('memory_presence_hydration_payload_too_large');
    }
    const witnesses = deserializePresence(rawPresence);
    if (!witnesses) {
      persistenceState = 'blocked';
      throw new Error('memory_presence_hydration_corrupt_or_partial');
    }
    useMemoryStore.getState().replacePresenceWitnesses(witnesses);
  }

  // Synthetic QA data is disposable and never an authority for Personal
  // Memory. A corrupt/obsolete QA payload is ignored instead of blocking the
  // user's real Memory hydration.
  if (rawSynthetic !== null && rawSynthetic.length <= 500_000) {
    const decodedSynthetic = deserializeSynthetic(rawSynthetic);
    if (decodedSynthetic) useMemoryStore.getState().replaceTestPoints(decodedSynthetic);
  }

  await markMemoryHydrateSuccess();
  if (myGeneration !== generation) return;
  persistenceState = 'writable';
  unsubscribe = useMemoryStore.subscribe((next, previous) => {
    // Sync counters/status are UI state, not durable exploration mutations.
    // Presence has its own bounded record so a non-spatial update never
    // serializes lifetime exploration geometry.
    if (next.points !== previous.points || next.initialRevealDone !== previous.initialRevealDone) scheduleFlush();
    if (next.presenceWitnesses !== previous.presenceWitnesses) schedulePresenceFlush();
    if (next.testPoints !== previous.testPoints) scheduleSyntheticFlush();
  });
}

/**
 * Detach subscription (e.g. on logout) and AWAIT a final flush before
 * clearing currentUserId. Async so callers must await — otherwise the
 * pending flush would resolve after currentUserId is cleared.
 */
export async function detachMemoryPersistence(invalidateInFlight = true): Promise<void> {
  if (invalidateInFlight) generation += 1;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  clearTimers();
  if (currentUserId) {
    const userId = currentUserId;
    // Snapshot store BEFORE clearing currentUserId so we capture the
    // OLD user's content even if a concurrent clearAll runs after.
    const state = useMemoryStore.getState();
    const snapshot = { points: state.points.slice(), initialRevealDone: state.initialRevealDone };
    const presenceSnapshot = (state.presenceWitnesses ?? []).slice();
    const syntheticSnapshot = state.testPoints.slice();
    currentUserId = null;
    const shouldFlush = persistenceState === 'writable';
    persistenceState = 'detached';
    if (shouldFlush) {
      await flush(userId, snapshot);
      await flushPresence(userId, presenceSnapshot);
      await flushSynthetic(userId, syntheticSnapshot);
    }
  } else {
    persistenceState = 'detached';
  }
}
