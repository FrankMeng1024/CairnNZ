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

/**
 * v351 plant-cluster filter for hydrate-time migration.
 *
 * Background: pre-v351 PlantScreen.tsx:180 wrote a single VisitedPoint
 * per plant via recordCircleUnlock. Those points have UUID-style cids
 * (NOT 'migration-' prefix that hike-imported points carry). v351 removes
 * the recordCircleUnlock call on plant + server-side cleanup runs DELETE
 * memory_points WHERE client_id NOT LIKE 'migration-%'. But local
 * AsyncStorage cache from prior runs still holds plant points.
 *
 * Cannot filter by cid alone — hike-derived points written by
 * flushHikingToMemory.ts also have UUID cids (recordPoint generates
 * uuidv4 in useMemoryStore.ts:244). Must distinguish by spatial pattern:
 *   - Hike track: 50+ points strung along a path
 *   - Plant: 1 isolated point (or a small <10-point cluster tightly
 *     packed within ~30m if multiple plants happened at same location)
 *
 * Algorithm: drop any point whose 30m neighborhood contains < 20 points
 * AND whose cid does NOT start with 'migration-' (server-managed hike
 * import). Keeps all migration- points unconditionally + keeps non-
 * migration points only if they're part of a dense path cluster
 * (legitimate hike trail).
 */
function stripPlantClusters(points: VisitedPoint[]): VisitedPoint[] {
  if (points.length === 0) return points;
  const KEEP_RADIUS_M = 30;
  const KEEP_RADIUS_M2 = KEEP_RADIUS_M * KEEP_RADIUS_M;
  const KEEP_MIN_NEIGHBORS = 20;
  const M_PER_DEG = 111320;
  // Bucket index for O(N*avgK) neighbor count instead of O(N²).
  const bucketKey = (lat: number, lng: number) =>
    `${Math.round(lat * 1000)}|${Math.round(lng * 1000)}`;
  const buckets = new Map<string, VisitedPoint[]>();
  for (const p of points) {
    const k = bucketKey(p.lat, p.lng);
    const arr = buckets.get(k);
    if (arr) arr.push(p); else buckets.set(k, [p]);
  }
  const kept: VisitedPoint[] = [];
  for (const p of points) {
    if (p.cid && p.cid.startsWith('migration-')) {
      kept.push(p);
      continue;
    }
    // Check ±1 bucket (~111m) for neighbors within 30m.
    const lat1k = Math.round(p.lat * 1000);
    const lng1k = Math.round(p.lng * 1000);
    let neighbors = 0;
    for (let di = -1; di <= 1 && neighbors < KEEP_MIN_NEIGHBORS; di++) {
      for (let dj = -1; dj <= 1 && neighbors < KEEP_MIN_NEIGHBORS; dj++) {
        const bk = `${lat1k + di}|${lng1k + dj}`;
        const arr = buckets.get(bk);
        if (!arr) continue;
        for (const q of arr) {
          if (q === p) continue;
          const dLat = (q.lat - p.lat) * M_PER_DEG;
          const cosLat = Math.cos((p.lat * Math.PI) / 180);
          const dLng = (q.lng - p.lng) * M_PER_DEG * cosLat;
          if (dLat * dLat + dLng * dLng < KEEP_RADIUS_M2) {
            neighbors++;
            if (neighbors >= KEEP_MIN_NEIGHBORS) break;
          }
        }
      }
    }
    if (neighbors >= KEEP_MIN_NEIGHBORS) kept.push(p);
    // else: plant/orphan, dropped
  }
  return kept;
}

// v0.2.6.3: schema bumped from v2 (point array, no cid) to v3 (cid required).
// Storage key prefix bumped to v3 so old v2 payloads are abandoned, but
// deserialize() also accepts v2 input and synthesizes a deterministic cid
// per point so the migration round-trips correctly without losing data.
// v355: bumped v3 → v4. Server-side ran Kalman re-smooth migration
// (resmooth_memory_points.py) replacing pre-Kalman migration-v336 data
// with Kalman-smoothed migration-v355 points. Existing client caches at
// the v3 prefix hold the pre-Kalman points; on v355 first boot we want
// to abandon those caches and re-pull from server to pick up the
// Kalman-smoothed version. Bumping the prefix is the simplest way:
// memoryPersistence.hydrate finds nothing at v4, calls replacePoints([],...),
// then memorySync.pullMemoryFromServer (triggered by FGUM) populates
// useMemoryStore.points from server's now-Kalman data.
const STORAGE_KEY_PREFIX = 'cairn:memory:tiles:v4:';
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

/** base64 encode helper — Node-friendly + RN-friendly. Kept for the
 * persistence layer's potential future use (server payloads etc.); not
 * used by the v2 point-array schema below. */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// Re-export to avoid TS dead-code warnings; consumers may use them later.
void bytesToBase64;
void base64ToBytes;

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
      const cleanedPoints = stripPlantClusters(decoded.points);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('memhydrate_v351_plant_strip', {
          before: decoded.points.length,
          after: cleanedPoints.length,
          stripped: decoded.points.length - cleanedPoints.length,
        });
      } catch {/* ignore */}
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../services/bootDiagnostics').markBootPhase('memhydrate_before_replacepoints', { points_n: cleanedPoints.length });
      } catch {/* ignore */}
      useMemoryStore.getState().replacePoints(cleanedPoints, migratedInitialRevealDone);
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

/** Test-only — reset all module state. */
export function __resetForTest(): void {
  clearTimers();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  currentUserId = null;
  generation++;
}
