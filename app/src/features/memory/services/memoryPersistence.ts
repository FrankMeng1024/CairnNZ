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
      if (typeof p?.a !== 'number' || typeof p?.o !== 'number') continue;
      if (!isFinite(p.a) || !isFinite(p.o)) continue;
      const ts = typeof p.t === 'number' ? p.t : Date.now();
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
  try {
    await storage.setItem(storageKey(userId), JSON.stringify(payload));
  } catch {
    // AsyncStorage quota exceeded / disk error. Drop silently.
  }
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
  if (!userIdAtSchedule) return;
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
      void flush(userIdAtSchedule, latestSnapshot);
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
        void flush(userIdAtSchedule, latestSnapshot);
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
  clearTimers();
  const state = useMemoryStore.getState();
  await flush(userId, { points: state.points.slice(), initialRevealDone: state.initialRevealDone });
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
  // v317: persisted gate — if a previous session died mid-hydrate
  // (sync JSON.parse death, iOS watchdog SIGKILL), this flag is still
  // set on disk. Skip the hydrate entirely so the app boots even if
  // the memory cache is too big for Hermes JSON.parse.
  if (hasMemoryHydrateFailedBefore()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../services/bootDiagnostics').markBootPhase('memhydrate_gate_blocked');
    } catch {/* ignore */}
    // Still attach subscriber so future flushes work (but skip the parse).
    currentUserId = userId;
    unsubscribe = useMemoryStore.subscribe(() => {
      scheduleFlush();
    });
    return;
  }
  // v321 fine-grained: confirm gate check passed
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memhydrate_after_gate_check');
  } catch {/* ignore */}
  // v317: mark in-progress on disk BEFORE the heavy parse so that if
  // we sync-die, next boot reads the flag and skips hydrate.
  markMemoryHydrateInProgress();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memhydrate_after_markInProgress');
  } catch {/* ignore */}
  // Bump generation; any in-flight hydrate from a prior call will see
  // a mismatch on resume and bail out.
  const myGeneration = ++generation;

  // Detach prior subscription FIRST and force-flush prior user before
  // we overwrite currentUserId. This is the cross-user data-corruption
  // fix.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memhydrate_before_detach');
  } catch {/* ignore */}
  await detachMemoryPersistence();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memhydrate_after_detach');
  } catch {/* ignore */}

  if (myGeneration !== generation) return;

  // O1 fix (v0.2.6.3): reset the in-memory store NOW (after the old
  // user's flush completed in detachMemoryPersistence). This way the
  // hydrate replacePoints below has a clean slate AND the empty-disk
  // case (no raw) leaves the store correctly empty for the new user.
  useMemoryStore.getState().resetForUserSwitch();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memhydrate_after_resetSwitch');
  } catch {/* ignore */}

  currentUserId = userId;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memhydrate_before_getitem');
  } catch {/* ignore */}
  let raw: string | null = null;
  try {
    raw = await storage.getItem(storageKey(userId));
  } catch {
    raw = null;
  }

  // Generation check after async read.
  if (myGeneration !== generation) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memhydrate_after_getitem', { raw_len: raw ? raw.length : -1 });
  } catch {/* ignore */}

  if (raw) {
    // v314/v315 fix: guard against MB-sized AsyncStorage payloads. JSON.parse
    // on multi-MB raw in Hermes sync-blocks main thread → iOS watchdog
    // SIGKILL. Bail rather than freeze. v315: tightened from 2MB to 500KB
    // — server beacons showed app dying inside JSON.parse with payloads
    // smaller than 2MB on lower-end devices.
    const MAX_RAW_BYTES = 500_000;  // 500 KB
    if (raw.length > MAX_RAW_BYTES) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('memhydrate_payload_too_large', {
          raw_len: raw.length,
          limit: MAX_RAW_BYTES,
        });
      } catch {/* ignore */}
      // Subscribe still attached below for future flushes — but skip
      // the parse + replacePoints to avoid the freeze.
    } else {
      const decoded = deserialize(raw);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('memhydrate_after_decode', { points_n: decoded ? decoded.points.length : -1 });
      } catch {/* ignore */}
      if (decoded) {
      // L7 fix: use the store's replacePoints action which bumps
      // geometryVersion and rebuilds _bucketIndex. Direct setState
      // bypassed those, leaving FogLayer / CairnPinsLayer stale.
      //
      // R-round B2 migration (v0.2.6.x): legacy v290 users had
      // recordCircleUnlock ignore radiusMeters → single point only.
      // After OTA-291 the hex-grid tile path won't re-run because
      // initialRevealDone=true. Detect this signature (initialRevealDone
      // AND only a handful of points) and force a re-reveal so the
      // user finally sees the connected fog they were promised.
      // Threshold 50: a single visit + plant on day 1 = ~2-3 points;
      // even an active week of walking is well under 50 unique cells
      // before the next launch. New hex grid emits ~560 points,
      // leaving headroom on both sides.
      const needsRevealMigration =
        decoded.initialRevealDone && decoded.points.length < 50;
      const migratedInitialRevealDone = needsRevealMigration
        ? false
        : decoded.initialRevealDone;
      // v351 migration: strip plant-origin points from local cache.
      // Pre-v351 PlantScreen.tsx:180 called recordCircleUnlock which
      // wrote a single point per plant into useMemoryStore.points,
      // then memorySync pushed those to server. v351 dropped that
      // PlantScreen call AND cleaned server-side (DELETE FROM
      // memory_points WHERE user_id=N AND client_id NOT LIKE
      // 'migration-%'). But local AsyncStorage may still hold the
      // hydrated plant points from a previous run. Plant points have
      // UUID-style client_id (NOT 'migration-' prefix); hike points
      // written by flushHikingToMemory ALSO have UUID cids in some
      // versions — so we can't filter by cid alone. Instead detect
      // plant pattern: small spatially-tight cluster (<10 points
      // within 30m of each other) with cid != 'migration-*'. Any
      // such cluster gets dropped — they're plant artefacts not hike
      // tracks. Hike tracks are 50+ points strung along a path, not
      // tightly clustered.
      // v397: user explicit request that plant unlock its own location.
      // v351 stripPlantClusters used to delete plant-origin points from
      // local cache on hydrate; that's now reversed — plant points are
      // legitimate visited points that user wants to keep.
      const cleanedPoints = decoded.points;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('memhydrate_v351_plant_strip', {
          before: decoded.points.length,
          after: cleanedPoints.length,
          stripped: decoded.points.length - cleanedPoints.length,
        });
      } catch {/* ignore */}
      // v401 真根因: hydrate 在 plant 后才完成 (boot lifecycle 异步).
      // AsyncStorage 是 plant 前的 snapshot, replacePoints 直接抹掉
      // in-memory 包含的 plant points. 真机 log 证明:
      //   77520 v399.plant_unlock points_after=372
      //   81511 fog_built n=372 (plant hole 短暂出现)
      //   81557 memhydrate_v351_plant_strip + replacepoints_entry
      //   81906 fog_built n=371 (replacePoints 把 plant 删了)
      // 修法: hydrate 前抓 in-memory 的 unsynced points (plant 来的),
      // 合并到 cache 后 replacePoints. 跟 reconcile 同样的逻辑.
      const inMemoryUnsynced = useMemoryStore.getState().points.filter((p) => !p.synced);
      const mergedForHydrate = inMemoryUnsynced.length > 0
        ? [...cleanedPoints, ...inMemoryUnsynced].sort((a, b) => a.ts - b.ts)
        : cleanedPoints;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('memhydrate_keep_inmem_unsynced', {
          cache_n: cleanedPoints.length,
          unsynced_n: inMemoryUnsynced.length,
          merged_n: mergedForHydrate.length,
        });
      } catch {/* ignore */}
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('memhydrate_before_replacepoints', { points_n: mergedForHydrate.length });
      } catch {/* ignore */}
      useMemoryStore.getState().replacePoints(mergedForHydrate, migratedInitialRevealDone);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('memhydrate_after_replacepoints');
      } catch {/* ignore */}
    }
    }  // close v314 else (raw.length <= MAX_RAW_BYTES)
  }

  // v317: hydrate completed (or raw was null/empty). Clear in-progress flag.
  markMemoryHydrateSuccess();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../services/bootDiagnostics').markBootPhase('memhydrate_success_cleared_flag');
  } catch {/* ignore */}

  // Subscribe to subsequent updates so we persist on change.
  unsubscribe = useMemoryStore.subscribe(() => {
    scheduleFlush();
  });
}

/**
 * Detach subscription (e.g. on logout) and AWAIT a final flush before
 * clearing currentUserId. Async so callers must await — otherwise the
 * pending flush would resolve after currentUserId is cleared.
 */
export async function detachMemoryPersistence(): Promise<void> {
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
    await flush(userId, snapshot);
  }
}


