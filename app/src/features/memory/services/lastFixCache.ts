/**
 * lastFixCache — AsyncStorage-backed persistence for the most recent
 * GPS watcher fix.
 *
 * v326 — added to fix Bug 2 ("random Looking for your position loop").
 *
 * Why this exists:
 *   useMemoryStore.lastWatcherFix is in-memory only. Cold-start (app
 *   killed → reopen) wipes it. fgum mounts inside MemoryScreen (v322
 *   architecture change), so when user opens Memory tab right after
 *   cold-start, the watcher hasn't emitted yet (Location.watchPositionAsync
 *   needs 1-3s on iOS). MemoryScreen then falls back to one-shot
 *   Location.getCurrentPositionAsync which has a 12s timeout. User sees
 *   "Looking for your position" for up to 12s on every cold-start.
 *
 * Fix:
 *   Persist lastWatcherFix to AsyncStorage on every successful update.
 *   On cold-start, MemoryScreen reads the cached fix immediately and
 *   uses it to draw the map. Watcher updates replace the cached fix
 *   once it's available. Worst case: user sees fog drawn at their
 *   last-known location for 1-3s, then the map snaps to the current
 *   live fix (acceptable — far better than 12s of blank "Looking for").
 *
 * Storage is owner-scoped. Stale fixes older than 24h are ignored on
 * hydrate (user could be in a different city).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'cairn:last-fix:v2:';
const STALE_MS = 24 * 60 * 60 * 1000; // 24h — ignore cached fix if older

export interface CachedFix {
  v: 2;
  ownerId: string;
  lat: number;
  lng: number;
  ts: number;
  accuracyM: number | null;
  provenance: 'real';
}

const writeTails = new Map<string, Promise<void>>();
const ownerGenerations = new Map<string, number>();

function storageKey(ownerId: string): string {
  return `${STORAGE_PREFIX}${ownerId}`;
}

function generation(ownerId: string): number {
  return ownerGenerations.get(ownerId) ?? 0;
}

function enqueue(ownerId: string, operation: () => Promise<void>): Promise<void> {
  const next = (writeTails.get(ownerId) ?? Promise.resolve())
    .catch(() => {})
    .then(operation);
  writeTails.set(ownerId, next.catch(() => {}));
  return next;
}

/** Persist asynchronously. Writes are serialized per owner so logout cleanup
 * cannot be overtaken by an older fire-and-forget write. */
export function persistLastFix(ownerId: string, fix: Omit<CachedFix, 'v' | 'ownerId' | 'provenance'>): void {
  if (!ownerId || !isFinite(fix.lat) || !isFinite(fix.lng) || !isFinite(fix.ts)) return;
  const scheduledGeneration = generation(ownerId);
  const payload: CachedFix = {
    v: 2,
    ownerId,
    lat: fix.lat,
    lng: fix.lng,
    ts: fix.ts,
    accuracyM: Number.isFinite(fix.accuracyM) && Number(fix.accuracyM) > 0
      ? Number(fix.accuracyM) : null,
    provenance: 'real',
  };
  void enqueue(ownerId, async () => {
    if (generation(ownerId) !== scheduledGeneration) return;
    await AsyncStorage.setItem(storageKey(ownerId), JSON.stringify(payload));
  }).catch(() => { /* GPS cache failure is non-fatal */ });
}

/** Synchronous-ish hydrate: returns null if no cached fix or stale.
 *  Awaitable — caller should await before using the value. */
export async function readLastFix(expectedOwnerId: string): Promise<CachedFix | null> {
  if (!expectedOwnerId) return null;
  try {
    await writeTails.get(expectedOwnerId)?.catch(() => {});
    const raw = await AsyncStorage.getItem(storageKey(expectedOwnerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedFix>;
    if (
      parsed.v !== 2 || parsed.ownerId !== expectedOwnerId || parsed.provenance !== 'real' ||
      typeof parsed.lat !== 'number' ||
      typeof parsed.lng !== 'number' ||
      typeof parsed.ts !== 'number' ||
      !isFinite(parsed.lat) ||
      !isFinite(parsed.lng) ||
      !isFinite(parsed.ts)
    ) {
      return null;
    }
    if (Date.now() - parsed.ts > STALE_MS) {
      return null; // stale — pretend we have nothing
    }
    const accuracyM = typeof parsed.accuracyM === 'number'
      && Number.isFinite(parsed.accuracyM) && parsed.accuracyM > 0
      ? parsed.accuracyM : null;
    return { v: 2, ownerId: expectedOwnerId, lat: parsed.lat, lng: parsed.lng, ts: parsed.ts, accuracyM, provenance: 'real' };
  } catch {
    return null;
  }
}

/** Invalidate pending writes first, then remove the exact owner's cache. */
export async function clearLastFix(ownerId: string): Promise<void> {
  if (!ownerId) return;
  ownerGenerations.set(ownerId, generation(ownerId) + 1);
  await enqueue(ownerId, async () => {
    await AsyncStorage.removeItem(storageKey(ownerId));
    // Retire the former device-global cache while current clients roll out.
    await AsyncStorage.removeItem('cairn_last_fix_v1');
  }).catch(() => {});
}
