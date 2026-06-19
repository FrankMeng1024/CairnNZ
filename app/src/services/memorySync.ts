/**
 * memorySync — cloud sync layer for the Memory tile data.
 *
 * Architecture:
 *   - Cloud is the source of truth (account-bound)
 *   - Local AsyncStorage is OFFLINE BUFFER ONLY
 *   - When online: upload pending points → server → mark synced
 *   - When offline: append locally; retry on next push tick
 *
 * v0.2.6.2 fixes (J1 review):
 *   - inFlightTimestamps tracks ts of points currently being POSTed,
 *     so pull's localUnsynced merge can EXCLUDE them and not double-
 *     submit the same point through pull-then-push.
 *   - activeUserIdAtRequest captured per-request so a logout/login
 *     race cannot leak markPointsSynced into the new user's store.
 *   - Pull is gated on pushInFlight — won't run while a push is mid-flight.
 *   - Subscription explicitly skips push when only synced points changed
 *     (i.e. our own markPointsSynced caused the change).
 */

import { authenticatedFetch } from './apiService';
import { useMemoryStore, VisitedPoint } from '../features/memory/store/useMemoryStore';

const PUSH_DEBOUNCE_MS = 5_000;
const MAX_BATCH = 500;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
/** Timestamps currently being POSTed — excluded from pull-merge. */
const inFlightTimestamps: Set<number> = new Set();
let unsubscribe: (() => void) | null = null;
let activeUserId: string | null = null;
let lastUnsyncedCount = 0;

interface ServerPoint {
  lat: number;
  lng: number;
  ts: number;
}

/**
 * Pull the user's memory points from the server. Replaces the local
 * store with: server points (synced=true) merged with local-only
 * unsynced points that aren't already mid-flight.
 *
 * Will not run while a push is in flight — avoids overwriting points
 * the server has accepted but hasn't yet been marked synced locally.
 */
export async function pullMemoryFromServer(userId: string): Promise<void> {
  if (!userId) return;
  if (pushInFlight) {
    // Try again after the in-flight push settles — schedule a retry.
    setTimeout(() => { void pullMemoryFromServer(userId); }, 1500);
    return;
  }
  const myUserId = userId;
  try {
    const res = await authenticatedFetch('/api/memory/points', { method: 'GET' });
    if (!res.ok) return;
    if (myUserId !== activeUserId) return; // user switched mid-request
    const body = await res.json();
    const serverPoints: VisitedPoint[] = (body.points ?? []).map((p: ServerPoint) => ({
      lat: p.lat,
      lng: p.lng,
      ts: p.ts,
      synced: true,
    }));
    // Preserve local-only points the server doesn't yet know AND that
    // aren't currently being uploaded. The in-flight set ensures we
    // don't double-count points the server accepted but hasn't yet
    // been markPointsSynced locally.
    const localUnsynced = useMemoryStore.getState().points.filter(
      (p) => !p.synced && !inFlightTimestamps.has(p.ts)
    );
    const merged = [...serverPoints, ...localUnsynced];
    // Dedup by (lat, lng, ts) — server-side dedup happens via the
    // unique index, but the client must dedup defensively in case a
    // local-unsynced point shares ts with a server point.
    const seen = new Set<string>();
    const dedup = merged.filter((p) => {
      const key = `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}|${p.ts}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    dedup.sort((a, b) => a.ts - b.ts);
    useMemoryStore.getState().replacePoints(dedup, useMemoryStore.getState().initialRevealDone);
    lastUnsyncedCount = dedup.filter((p) => !p.synced).length;
  } catch {
    // Network down. Keep local-only state.
  }
}

async function pushPendingPoints(): Promise<void> {
  if (pushInFlight) return;
  if (!activeUserId) return;
  const myUserId = activeUserId;
  const allPoints = useMemoryStore.getState().points;
  const pending = allPoints.filter((p) => !p.synced && !inFlightTimestamps.has(p.ts));
  if (pending.length === 0) return;

  const batch = pending.slice(0, MAX_BATCH);
  // Mark in flight BEFORE the network call.
  for (const p of batch) inFlightTimestamps.add(p.ts);
  pushInFlight = true;
  try {
    const res = await authenticatedFetch('/api/memory/points', {
      method: 'POST',
      body: JSON.stringify({
        points: batch.map((p) => ({ lat: p.lat, lng: p.lng, ts: p.ts })),
      }),
    });
    // Re-check user identity — if the user logged out / switched,
    // do NOT call markPointsSynced (that would mutate the new user's
    // store).
    if (myUserId !== activeUserId) {
      return;
    }
    if (res.ok) {
      useMemoryStore.getState().markPointsSynced(batch.map((p) => p.ts));
      if (pending.length > MAX_BATCH) schedulePush(0);
    }
  } catch {
    // Offline — leave points unsynced; next push retries.
  } finally {
    for (const p of batch) inFlightTimestamps.delete(p.ts);
    pushInFlight = false;
  }
}

function schedulePush(delayMs = PUSH_DEBOUNCE_MS): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushPendingPoints();
  }, delayMs);
}

export function attachMemorySync(userId: string): void {
  detachMemorySync();
  activeUserId = userId;
  // Subscribe — but only schedule a push when the count of unsynced
  // points actually GROWS. markPointsSynced shrinks the set; pull's
  // replacePoints can either grow or shrink it. We don't want to push
  // when our own bookkeeping caused the change.
  unsubscribe = useMemoryStore.subscribe(() => {
    const unsyncedCount = useMemoryStore.getState().points.filter((p) => !p.synced).length;
    if (unsyncedCount > lastUnsyncedCount) schedulePush();
    lastUnsyncedCount = unsyncedCount;
  });
}

export function detachMemorySync(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  activeUserId = null;
  inFlightTimestamps.clear();
  lastUnsyncedCount = 0;
  // pushInFlight stays true if a request is genuinely in flight; it
  // will set itself false in the finally block. We just won't act on
  // its result because activeUserId is null.
}

export async function pushMemoryNow(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushPendingPoints();
}

/** Force-clear memory on the server (Settings → Clear my memory). */
export async function deleteAllMemoryFromServer(): Promise<boolean> {
  try {
    const res = await authenticatedFetch('/api/memory/points', { method: 'DELETE' });
    if (res.ok) {
      useMemoryStore.getState().clearAll();
      lastUnsyncedCount = 0;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Read API for sync-status indicator UI. */
export function getSyncStatus(): {
  pendingCount: number;
  inFlight: boolean;
} {
  const pending = useMemoryStore.getState().points.filter((p) => !p.synced).length;
  return { pendingCount: pending, inFlight: pushInFlight };
}
