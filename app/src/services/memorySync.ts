/**
 * memorySync — cloud sync layer for the Memory tile data.
 *
 * Architecture (per user request, v0.2.6.1):
 *   - Cloud is the source of truth (account-bound, follows the user)
 *   - Local AsyncStorage is an OFFLINE BUFFER ONLY
 *   - When online: upload pending points → server, then drop them from local
 *   - When offline: append locally; retry upload on next online tick
 *
 * Lifecycle (called from ForegroundUnlockManager on user change):
 *
 *   pullFromServer(userId)              // app open / login
 *     → GET /api/memory/points
 *     → useMemoryStore.replacePoints(server points + any local-pending)
 *
 *   schedulePush()                       // store subscription
 *     → debounced 5s
 *     → batch unsynced points
 *     → POST /api/memory/points
 *     → on success: mark synced + flush local (so AsyncStorage stays small)
 *
 * Offline detection: we just try the request. fetch() throwing = offline,
 * we keep the points local and try again on next push.
 */

import { authenticatedFetch } from './apiService';
import { useMemoryStore, VisitedPoint } from '../features/memory/store/useMemoryStore';

const PUSH_DEBOUNCE_MS = 5_000;
const MAX_BATCH = 500;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let unsubscribe: (() => void) | null = null;
let activeUserId: string | null = null;

interface ServerPoint {
  lat: number;
  lng: number;
  ts: number;
}

/**
 * Pull all of the user's memory points from the server. Replaces the
 * local store with: server points (marked synced) + any local-only
 * points that haven't been uploaded yet (preserved as unsynced so the
 * next push retries them).
 */
export async function pullMemoryFromServer(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const res = await authenticatedFetch('/api/memory/points', { method: 'GET' });
    if (!res.ok) return; // silent failure — local stays as-is
    const body = await res.json();
    const serverPoints: VisitedPoint[] = (body.points ?? []).map((p: ServerPoint) => ({
      lat: p.lat,
      lng: p.lng,
      ts: p.ts,
      synced: true,
    }));
    // Preserve any local-only (unsynced) points that the server doesn't
    // yet know about. The next pushPending call will upload them.
    const localUnsynced = useMemoryStore.getState().points.filter((p) => !p.synced);
    const merged = [...serverPoints, ...localUnsynced];
    // Deduplicate by ts (server-side may already have duplicates of
    // local-unsynced if a previous push partially succeeded).
    const seen = new Set<number>();
    const dedup = merged.filter((p) => {
      if (seen.has(p.ts)) return false;
      seen.add(p.ts);
      return true;
    });
    dedup.sort((a, b) => a.ts - b.ts);
    useMemoryStore.getState().replacePoints(dedup, useMemoryStore.getState().initialRevealDone);
  } catch {
    // Network down. Keep local-only state.
  }
}

async function pushPendingPoints(): Promise<void> {
  if (pushInFlight) return;
  if (!activeUserId) return;
  const allPoints = useMemoryStore.getState().points;
  const pending = allPoints.filter((p) => !p.synced);
  if (pending.length === 0) return;

  // Cap batch so we don't hammer the server with 10k points after a
  // long offline session.
  const batch = pending.slice(0, MAX_BATCH);
  pushInFlight = true;
  try {
    const res = await authenticatedFetch('/api/memory/points', {
      method: 'POST',
      body: JSON.stringify({
        points: batch.map((p) => ({ lat: p.lat, lng: p.lng, ts: p.ts })),
      }),
    });
    if (res.ok) {
      // Mark these points synced. The next debounced cycle will pick
      // up the rest if there are more than MAX_BATCH pending.
      useMemoryStore.getState().markPointsSynced(batch.map((p) => p.ts));
      if (pending.length > MAX_BATCH) {
        // More to send — re-arm immediately.
        schedulePush(0);
      }
    }
    // Non-2xx: leave them unsynced; will retry on the next state change.
  } catch {
    // Network down — keep points unsynced; they'll retry next time.
  } finally {
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

/**
 * Wire the sync service to the active user. Called from
 * ForegroundUnlockManager on user change.
 */
export function attachMemorySync(userId: string): void {
  detachMemorySync();
  activeUserId = userId;
  // Subscribe to store mutations — every recordPoint schedules a push.
  unsubscribe = useMemoryStore.subscribe(() => {
    schedulePush();
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
}

/**
 * Force an immediate push (e.g. on AppState background). Returns when
 * the request completes; safe to call repeatedly.
 */
export async function pushMemoryNow(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushPendingPoints();
}
