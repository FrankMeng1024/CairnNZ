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
import { useMemoryStore, VisitedPoint } from '../store/useMemoryStore';
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
const DEBOUNCE_MS = 3_000;
/**
 * Hard cap on how long a flush can be deferred. Without this, every GPS
 * tick (every 2s during walking) re-arms the 3s debounce — meaning the
 * flush never actually fires. App kill = total memory loss.
 */
const MAX_WAIT_MS = 15_000;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let currentUserId: string | null = null;
let persistenceState: 'detached' | 'hydrating' | 'writable' | 'blocked' = 'detached';
/**
 * Generation token. Bumped on every hydrate/detach. Stale awaits check
 * this and bail out, so concurrent user switches can't corrupt state.
 */
let generation = 0;

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
}

interface SerializedMemoryV3 {
  v: 3 | 2;
  points: SerializedPoint[];
  initialRevealDone: boolean;
}

function serialize(points: VisitedPoint[], initialRevealDone: boolean): SerializedMemoryV3 {
  return {
    v: 3,
    points: points.map((p) => ({
      a: p.lat,
      o: p.lng,
      t: p.ts,
      s: p.synced ? 1 : 0,
      c: p.cid,
    })),
    initialRevealDone,
  };
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
    const parsed = JSON.parse(raw) as SerializedMemoryV3;
    if ((parsed.v !== 2 && parsed.v !== 3) || !Array.isArray(parsed.points)) return null;
    const points: VisitedPoint[] = [];
    for (const p of parsed.points) {
      if (typeof p?.a !== 'number' || typeof p?.o !== 'number') return null;
      if (!isFinite(p.a) || p.a < -90 || p.a > 90 || !isFinite(p.o) || p.o < -180 || p.o > 180) return null;
      if (typeof p.t !== 'number' || !Number.isFinite(p.t) || p.t <= 0) return null;
      if (p.s !== 0 && p.s !== 1) return null;
      if (parsed.v === 3 && (typeof p.c !== 'string' || p.c.length === 0)) return null;
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
      });
    }
    return { points, initialRevealDone: Boolean(parsed.initialRevealDone) };
  } catch {
    return null;
  }
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
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
}

/**
 * Flush a snapshot to disk. The caller (scheduleFlush) snapshots the
 * store at schedule TIME, not at flush execution time, so a user switch
 * mid-debounce cannot serialize the wrong content.
 *
 * N5 fix (v0.2.6.3): previously read useMemoryStore.getState() at flush
 * time. If the new user's clearAll fired between schedule and flush,
 * we'd serialize empty (or worse, the new user's points) to the OLD
 * user's storage key.
 */
async function flush(userId: string, snapshot: { points: VisitedPoint[]; initialRevealDone: boolean }): Promise<void> {
  if (!userId) return;
  const payload = serialize(snapshot.points, snapshot.initialRevealDone);
  // Memory evidence is a committed product record, not a best-effort cache.
  // Propagate quota / disk errors so recordMemoryEvidence cannot report a
  // durable commit when AsyncStorage rejected the write.
  await storage.setItem(storageKey(userId), JSON.stringify(payload), { strict: true });
}

/**
 * O3 fix (v0.2.6.3): scheduleFlush now updates BOTH timers' snapshots
 * on each call. Previously the maxWaitTimer was only armed once per
 * burst and held the FIRST snapshot in closure → after MAX_WAIT_MS of
 * continuous walking, it flushed stale 15-second-old data. Now we
 * keep `latestSnapshot` at module scope and the maxWaitTimer reads
 * from that on fire.
 */
let latestSnapshot: { points: VisitedPoint[]; initialRevealDone: boolean } | null = null;
let latestSnapshotUserId: string | null = null;

function scheduleFlush(): void {
  const userIdAtSchedule = currentUserId;
  if (!userIdAtSchedule || persistenceState !== 'writable') return;
  const state = useMemoryStore.getState();
  // Update the latest snapshot on EVERY call. Both timers read this
  // when they fire — so the maxWaitTimer always uses the freshest data.
  latestSnapshot = {
    points: state.points.slice(),
    initialRevealDone: state.initialRevealDone,
  };
  latestSnapshotUserId = userIdAtSchedule;

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
    if (latestSnapshot && latestSnapshotUserId === userIdAtSchedule) {
      void flush(userIdAtSchedule, latestSnapshot).catch(() => {});
    }
  }, DEBOUNCE_MS);

  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (latestSnapshot && latestSnapshotUserId === userIdAtSchedule) {
        void flush(userIdAtSchedule, latestSnapshot).catch(() => {});
      }
    }, MAX_WAIT_MS);
  }
}

/**
 * Force an immediate synchronous-flush request. Used on AppState
 * background and on logout to guarantee durability.
 */
export async function flushMemoryNow(): Promise<void> {
  const userId = currentUserId;
  if (!userId) return;
  if (persistenceState !== 'writable') throw new Error('memory_persistence_unavailable');
  clearTimers();
  const state = useMemoryStore.getState();
  await flush(userId, { points: state.points.slice(), initialRevealDone: state.initialRevealDone });
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
  try {
    raw = await storage.getItem(storageKey(userId));
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

  await markMemoryHydrateSuccess();
  if (myGeneration !== generation) return;
  persistenceState = 'writable';
  unsubscribe = useMemoryStore.subscribe(() => scheduleFlush());
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
    currentUserId = null;
    const shouldFlush = persistenceState === 'writable';
    persistenceState = 'detached';
    if (shouldFlush) await flush(userId, snapshot);
  } else {
    persistenceState = 'detached';
  }
}
