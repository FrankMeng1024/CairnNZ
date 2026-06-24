/**
 * h3LoadGate — persisted h3-js load failure flag (AsyncStorage).
 *
 * Why this exists (v311):
 *   v305-v310 boot-time crash loop root cause: bulkImport runs 581 sync
 *   `latLngToCell` emscripten calls → main thread freezes 6-10s → iOS
 *   watchdog (0x8badf00d) SIGKILL. iOS auto-restarts. Round 2+ cold-load
 *   re-attempts emscripten factory under hot-restart RSS pressure →
 *   factory throws → Metro guardedLoadModule swallows → require returns
 *   undefined → app dies again → emergency rollback loop.
 *
 *   This gate breaks the loop: any bulkImport that starts but doesn't
 *   finish (sync death mid-loop OR mid-emscripten-throw) leaves the flag
 *   set on disk. Next boot reads the flag, skips h3 entirely, app stays
 *   alive (fog won't render until user clears app data, but app boots).
 *
 *   Trade-off: stability > fog visibility. A fog-less Memory screen
 *   beats an unbootable app.
 *
 * Lifecycle:
 *   - App boot: primeH3FailedFlag() reads disk into in-memory cache.
 *   - bulkImport entry: markH3InProgress() — writes "1" to disk.
 *   - bulkImport done (chunked completion): markH3SuccessAndClear() — removes key.
 *   - getH3() sync-checks h3HasFailedBefore() — if true, returns null immediately
 *     without ever calling require('h3-js').
 *
 * Sync access pattern:
 *   AsyncStorage is async, but getH3 is sync. We prime the cache at boot
 *   via primeH3FailedFlag() (fire-and-forget), then h3HasFailedBefore()
 *   reads the in-memory cache synchronously. There is a small race window
 *   on cold start where the cache may not yet be populated when bulkImport
 *   runs — we mitigate by deferring bulkImport via setTimeout(100) in
 *   useMemoryStore.replacePoints, giving AsyncStorage read a 100ms window.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cairn_h3_load_failed_v1';

// null = not yet primed. true/false = primed.
let cachedFlag: boolean | null = null;

/**
 * Read disk flag into memory. Call once at app boot, fire-and-forget.
 * After this resolves, h3HasFailedBefore() returns accurate value.
 */
export async function primeH3FailedFlag(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    cachedFlag = v === '1';
  } catch {
    cachedFlag = false;
  }
}

/**
 * Synchronous check: did h3-js load fail in a previous session?
 * Returns false if cache not yet primed (fail-open, prefer to try once).
 */
export function h3HasFailedBefore(): boolean {
  return cachedFlag === true;
}

/**
 * Mark h3-js as "currently being loaded/used". Persisted so that if
 * the process dies (watchdog / jetsam / silent crash) before clearing,
 * the next boot sees the flag and skips h3 entirely.
 *
 * Called at bulkImport entry. The write to AsyncStorage is async/
 * fire-and-forget; iOS NSUserDefaults backend flushes in ~10-50ms,
 * which fits inside the 6-10s watchdog window — so even sync death
 * during the 581-point loop should leave the flag persisted.
 */
export function markH3InProgress(): void {
  cachedFlag = true;
  void AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {/* ignore */});
}

/**
 * Mark h3-js as healthy. Called when bulkImport completes successfully.
 * Removes the flag from disk so subsequent boots will retry normally.
 */
export function markH3SuccessAndClear(): void {
  cachedFlag = false;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {/* ignore */});
}
