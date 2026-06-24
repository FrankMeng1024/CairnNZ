/**
 * memoryHydrateGate — persistent gate for memory hydrate.
 *
 * Why this exists (v317):
 *   v315/v316 beacons confirmed: app crashes 8+ seconds after
 *   `memhydrate_entry` fires — somewhere inside the AsyncStorage
 *   getItem or JSON.parse of the memory points payload. Hermes
 *   JSON.parse on a large payload sync-blocks the main thread; iOS
 *   watchdog (0x8badf00d) SIGKILLs after ~9s.
 *
 *   v314's 500KB guard exists but only fires AFTER getItem returns —
 *   if getItem itself is slow (large value scan), we never reach the
 *   guard. Plus, even sub-500KB JSON parses can freeze on lower-end
 *   devices.
 *
 *   This gate breaks the loop: any hydrateMemoryForUser that starts
 *   but doesn't finish (sync death mid-parse) leaves a flag set on
 *   disk. Next boot reads the flag and skips hydrate entirely. The
 *   in-memory store stays empty (user sees no historical memory
 *   points) but the app boots and is usable.
 *
 * Trade-off: stability > historical data visibility. User can still
 * record new memory points; just the old cache won't auto-restore.
 *
 * Lifecycle:
 *   - App boot: primeMemoryHydrateGate() reads disk into memory cache.
 *   - hydrateMemoryForUser entry: markMemoryHydrateInProgress().
 *   - hydrateMemoryForUser success: markMemoryHydrateSuccess().
 *   - Next boot: if flag still set, hasMemoryHydrateFailedBefore()
 *     returns true → hydrate skipped.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cairn_memory_hydrate_failed_v1';
let cachedFlag: boolean | null = null;

export async function primeMemoryHydrateGate(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    cachedFlag = v === '1';
  } catch {
    cachedFlag = false;
  }
}

export function hasMemoryHydrateFailedBefore(): boolean {
  return cachedFlag === true;
}

export function markMemoryHydrateInProgress(): void {
  cachedFlag = true;
  void AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {/* ignore */});
}

export function markMemoryHydrateSuccess(): void {
  cachedFlag = false;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {/* ignore */});
}
