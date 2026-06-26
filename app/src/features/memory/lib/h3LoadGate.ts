/**
 * h3LoadGate — DISABLED v341 (2026-06-26).
 *
 * Original purpose (v311): block bulkImport if h3-js emscripten WASM
 * failed in a prior boot. v323 replaced emscripten h3-js with pure JS
 * h3Pure that cannot fail (no native alloc, no WASM). The gate stopped
 * being useful at v323 but the flag was never cleared.
 *
 * Bug observed in v340 (2026-06-26): real device with flag persisted
 * from v3xx era → h3HasFailedBefore() returns true → useH3VisitedStore.
 * bulkImport early-returns → Memory cells never written → Memory map
 * stays black no matter how many points pullMemoryFromServer fetched.
 *
 * v341 fix: gate is permanently OFF. h3HasFailedBefore() always returns
 * false. primeH3FailedFlag() actively REMOVES the legacy disk flag so
 * any user upgrading from a v3xx-poisoned device clears the stuck state.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cairn_h3_load_failed_v1';

/**
 * v341: actively REMOVE the legacy h3-failed flag at boot. Users
 * upgrading from v305-v322 may have '1' persisted in AsyncStorage; the
 * flag would otherwise block bulkImport forever. h3Pure (v323+) cannot
 * fail, so clearing is safe.
 */
export async function primeH3FailedFlag(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * v341: always false. h3Pure cannot fail, so the gate is permanently
 * open. Old callers that check this return value will now always
 * proceed with the h3 path.
 */
export function h3HasFailedBefore(): boolean {
  return false;
}

/**
 * v341: no-op. Original purpose was to mark h3 as currently loading
 * so a crash mid-load could be detected next boot. h3Pure is sync and
 * cannot crash, so there is nothing to track.
 */
export function markH3InProgress(): void {
  /* no-op v341 */
}

/**
 * v341: no-op. Always-success in h3Pure makes the success/clear
 * call obsolete.
 */
export function markH3SuccessAndClear(): void {
  /* no-op v341 */
}
