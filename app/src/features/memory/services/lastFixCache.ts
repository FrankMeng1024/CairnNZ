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
 * Storage key: 'cairn_last_fix_v1'. Stale fixes older than 24h are
 * ignored on hydrate (user could be in a different city).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cairn_last_fix_v1';
const STALE_MS = 24 * 60 * 60 * 1000; // 24h — ignore cached fix if older

interface CachedFix {
  lat: number;
  lng: number;
  ts: number;
}

/** Persist asynchronously. Fire-and-forget — failure is non-fatal. */
export function persistLastFix(fix: CachedFix): void {
  if (!isFinite(fix.lat) || !isFinite(fix.lng)) return;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fix)).catch(() => {
    /* ignore — storage failure shouldn't break GPS flow */
  });
}

/** Synchronous-ish hydrate: returns null if no cached fix or stale.
 *  Awaitable — caller should await before using the value. */
export async function readLastFix(): Promise<CachedFix | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedFix>;
    if (
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
    return { lat: parsed.lat, lng: parsed.lng, ts: parsed.ts };
  } catch {
    return null;
  }
}
