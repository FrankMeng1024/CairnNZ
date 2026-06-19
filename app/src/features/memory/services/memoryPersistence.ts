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

// v0.2.6.1: schema bumped from v1 (tile bitmaps) to v2 (point array).
// Storage key prefix bumped to v2 so old v1 payloads are abandoned.
const STORAGE_KEY_PREFIX = 'cairn:memory:tiles:v2:';
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
}

interface SerializedMemoryV2 {
  v: 2;
  points: SerializedPoint[];
  initialRevealDone: boolean;
}

function serialize(points: VisitedPoint[], initialRevealDone: boolean): SerializedMemoryV2 {
  return {
    v: 2,
    points: points.map((p) => ({
      a: p.lat,
      o: p.lng,
      t: p.ts,
      s: p.synced ? 1 : 0,
    })),
    initialRevealDone,
  };
}

function deserialize(raw: string): { points: VisitedPoint[]; initialRevealDone: boolean } | null {
  try {
    const parsed = JSON.parse(raw) as SerializedMemoryV2;
    if (parsed.v !== 2 || !Array.isArray(parsed.points)) return null;
    const points: VisitedPoint[] = [];
    for (const p of parsed.points) {
      if (typeof p?.a !== 'number' || typeof p?.o !== 'number') continue;
      if (!isFinite(p.a) || !isFinite(p.o)) continue;
      points.push({
        lat: p.a,
        lng: p.o,
        ts: typeof p.t === 'number' ? p.t : Date.now(),
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
 * Flush pending state to disk for the given user. Caller passes the
 * userId so we cannot misroute A's tiles to B's storage key on a user
 * switch race.
 */
async function flush(userId: string): Promise<void> {
  if (!userId) return;
  const state = useMemoryStore.getState();
  const payload = serialize(state.points, state.initialRevealDone);
  try {
    await storage.setItem(storageKey(userId), JSON.stringify(payload));
  } catch {
    // AsyncStorage quota exceeded / disk error. Drop silently.
  }
}

function scheduleFlush(): void {
  // Capture currentUserId AT SCHEDULE TIME so the closure cannot
  // misfire if currentUserId mutates while the timer is queued.
  const userIdAtSchedule = currentUserId;
  if (!userIdAtSchedule) return;

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
    void flush(userIdAtSchedule);
  }, DEBOUNCE_MS);

  // Arm max-wait timer if not already armed. This is the
  // starvation-prevention path — guarantees a flush at least every
  // MAX_WAIT_MS even under continuous state changes.
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      void flush(userIdAtSchedule);
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
  await flush(userId);
}

/**
 * Hydrate the store from disk for the given user. Call once on app
 * boot after auth resolves.
 */
export async function hydrateMemoryForUser(userId: string): Promise<void> {
  if (!userId) return;
  // Bump generation; any in-flight hydrate from a prior call will see
  // a mismatch on resume and bail out.
  const myGeneration = ++generation;

  // Detach prior subscription FIRST and force-flush prior user before
  // we overwrite currentUserId. This is the cross-user data-corruption
  // fix.
  await detachMemoryPersistence();

  // If another hydrate started while we were awaiting detach, bail.
  if (myGeneration !== generation) return;

  currentUserId = userId;

  let raw: string | null = null;
  try {
    raw = await storage.getItem(storageKey(userId));
  } catch {
    raw = null;
  }

  // Generation check after async read.
  if (myGeneration !== generation) return;

  if (raw) {
    const decoded = deserialize(raw);
    if (decoded) {
      useMemoryStore.setState({
        points: decoded.points,
        initialRevealDone: decoded.initialRevealDone,
      });
    }
  }

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
    // Do NOT clear currentUserId until the flush is on the wire — the
    // serialize() reads from useMemoryStore.getState() synchronously,
    // so capturing userId here is sufficient.
    currentUserId = null;
    await flush(userId);
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
