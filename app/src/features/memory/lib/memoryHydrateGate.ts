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
 *   This gate breaks the loop per account. A hydrate that does not finish
 *   leaves `in_progress`; the next boot selects a fresh recovery snapshot
 *   namespace while preserving the old bytes for support/recovery. Server
 *   reconciliation can then safely repopulate the writable projection.
 *
 * Lifecycle:
 *   - hydrateMemoryForUser awaits hasMemoryHydrateFailedBefore(userId).
 *   - entry writes an account-scoped in-progress marker.
 *   - a stale marker is promoted to durable recovery mode.
 *   - normal success clears the marker; recovery success keeps the recovery
 *     namespace selected so the preserved snapshot is never overwritten.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_PREFIX = 'cairn_memory_hydrate_state_v2:';
type HydrateGateState = 'clear' | 'in_progress' | 'recovery_unreconciled' | 'recovery_reconciled';
const cachedState = new Map<string, HydrateGateState>();

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

async function readState(userId: string): Promise<HydrateGateState> {
  const cached = cachedState.get(userId);
  if (cached) return cached;
  try {
    const value = await AsyncStorage.getItem(storageKey(userId));
    const state: HydrateGateState = value === '1'
      ? 'in_progress'
      : value === 'recovery_reconciled'
        ? 'recovery_reconciled'
      : value === 'recovery' || value === 'recovery_unreconciled'
        ? 'recovery_unreconciled'
        : 'clear';
    cachedState.set(userId, state);
    return state;
  } catch {
    cachedState.set(userId, 'clear');
    return 'clear';
  }
}

export async function primeMemoryHydrateGate(userId?: string): Promise<void> {
  if (userId) await readState(userId);
}

export async function hasMemoryHydrateFailedBefore(userId: string): Promise<boolean> {
  return (await readState(userId)) === 'in_progress';
}

export async function usesMemoryHydrateRecovery(userId: string): Promise<boolean> {
  return (await readState(userId)).startsWith('recovery_');
}

export async function isMemoryHydrateRecoveryReconciled(userId: string): Promise<boolean> {
  return (await readState(userId)) === 'recovery_reconciled';
}

export async function markMemoryHydrateRecovery(userId: string): Promise<void> {
  cachedState.set(userId, 'recovery_unreconciled');
  await AsyncStorage.setItem(storageKey(userId), 'recovery_unreconciled');
}

export async function markMemoryHydrateRecoveryReconciled(userId: string): Promise<void> {
  cachedState.set(userId, 'recovery_reconciled');
  await AsyncStorage.setItem(storageKey(userId), 'recovery_reconciled');
}

export async function markMemoryHydrateInProgress(userId: string): Promise<void> {
  if (await usesMemoryHydrateRecovery(userId)) return;
  cachedState.set(userId, 'in_progress');
  await AsyncStorage.setItem(storageKey(userId), '1');
}

export async function markMemoryHydrateSuccess(userId: string): Promise<void> {
  if (await usesMemoryHydrateRecovery(userId)) return;
  cachedState.set(userId, 'clear');
  await AsyncStorage.removeItem(storageKey(userId));
}

/** Clear both durable and process-local recovery authority after a verified
 * privacy reset. Without clearing the cache, restoring the same account in
 * this process could reopen an obsolete recovery namespace. */
export async function clearMemoryHydrateState(userId: string): Promise<void> {
  cachedState.delete(userId);
  await AsyncStorage.removeItem(storageKey(userId));
}
