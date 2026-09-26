import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { storage } from '../store/storage';
import { listPending, removePending } from './pendingSyncStore';
import {
  listActiveHikes,
  discardActiveHike,
  deleteAcknowledgedHikeTrackArtifacts,
} from './hikeTrackWriter';
import { deleteExtras } from './LocalRouteExtras';
import { clearSimulatorLogs } from '../features/activitySimulator/simulatorLog';
import { debugLogger } from './debugLogger';
import { purgeFogDisplayCache } from '../features/memory/services/fogDisplayCache';
import { purgeDurableMemoryEvidence } from '../features/memory/services/memoryEvidenceJournal';
import { clearCredentialsStrict } from './credentialsStore';
import {
  isAccountTransitionCurrent,
  type AccountTransitionAuthority,
} from './accountTransitionAuthority';

const SCHEDULED_PURGE_KEY = '@cairn:account-deletion-local-purge:v1';
const SECURE_SCHEDULED_PURGE_KEY = 'cairn_account_deletion_local_purge_v1';

export type DeletedAccountPurgeState = 'reserved' | 'unknown' | 'committed';

export interface DeletedAccountPurgeRecord {
  ownerUserId: string;
  state: DeletedAccountPurgeState;
  updatedAt: string;
}

function exactOwner(userId: string): string {
  const owner = String(userId || '');
  if (!owner || owner === 'guest' || owner === 'unknown') {
    throw new Error('account_local_purge_owner_required');
  }
  return owner;
}

function legacyDeletedAccountOwnerId(raw: string): string | null {
  // The pre-R4 marker contained only the server's users.id value. That column
  // is BIGINT UNSIGNED, so accepting arbitrary non-JSON text as an owner would
  // turn corruption into COMMITTED purge authority.
  if (!/^[1-9][0-9]{0,19}$/.test(raw)) return null;
  if (raw.length === 20 && raw > '18446744073709551615') return null;
  return raw;
}

function decodeRecord(raw: string | null): DeletedAccountPurgeRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (parsed
      && typeof parsed === 'object'
      && typeof (parsed as any).ownerUserId === 'string'
      && ['reserved', 'unknown', 'committed'].includes((parsed as any).state)) {
      return {
        ownerUserId: exactOwner((parsed as any).ownerUserId),
        state: (parsed as any).state,
        updatedAt: typeof (parsed as any).updatedAt === 'string' ? (parsed as any).updatedAt : '',
      };
    }
  } catch {
    // Only the exact historical decimal-id encoding is a valid non-JSON
    // marker. Never reinterpret malformed structured data as an owner id.
  }
  const legacyOwner = legacyDeletedAccountOwnerId(raw);
  if (legacyOwner) return { ownerUserId: legacyOwner, state: 'committed', updatedAt: '' };
  throw new Error('account_local_purge_marker_corrupt');
}

function recordPriority(state: DeletedAccountPurgeState): number {
  return state === 'committed' ? 3 : state === 'unknown' ? 2 : 1;
}

export async function getDeletedAccountPurgeRecord(): Promise<DeletedAccountPurgeRecord | null> {
  let asyncRecord: DeletedAccountPurgeRecord | null;
  let secureRecord: DeletedAccountPurgeRecord | null = null;
  try {
    asyncRecord = decodeRecord(await storage.getItemStrict(SCHEDULED_PURGE_KEY));
  } catch {
    throw new Error('account_local_purge_async_read_failed');
  }
  if (Platform.OS !== 'web') {
    try {
      secureRecord = decodeRecord(await SecureStore.getItemAsync(SECURE_SCHEDULED_PURGE_KEY));
    } catch {
      throw new Error('account_local_purge_secure_read_failed');
    }
  }
  if (asyncRecord && secureRecord && asyncRecord.ownerUserId !== secureRecord.ownerUserId) {
    throw new Error('account_local_purge_owner_conflict');
  }
  const authoritative = !asyncRecord
    ? secureRecord
    : !secureRecord
      ? asyncRecord
      : recordPriority(asyncRecord.state) >= recordPriority(secureRecord.state)
    ? asyncRecord
    : secureRecord;
  if (!authoritative) return null;

  const asyncNeedsHealing = !asyncRecord
    || asyncRecord.ownerUserId !== authoritative.ownerUserId
    || asyncRecord.state !== authoritative.state;
  const secureNeedsHealing = Platform.OS !== 'web' && (
    !secureRecord
    || secureRecord.ownerUserId !== authoritative.ownerUserId
    || secureRecord.state !== authoritative.state
  );
  if (asyncNeedsHealing || secureNeedsHealing) {
    // A lower-priority/missing copy may never be exposed as authoritative on
    // a later boot. Heal both mirrors now or fail closed before any release.
    await persistDeletedAccountPurgeRecord(authoritative);
  }
  return authoritative;
}

async function persistDeletedAccountPurgeRecord(record: DeletedAccountPurgeRecord): Promise<void> {
  const payload = JSON.stringify(record);
  let asyncStored = false;
  let secureStored = false;
  try {
    await storage.setItem(SCHEDULED_PURGE_KEY, payload, { strict: true });
    asyncStored = true;
  } catch { /* try the independent native keychain marker below */ }
  if (Platform.OS !== 'web') {
    try {
      await SecureStore.setItemAsync(SECURE_SCHEDULED_PURGE_KEY, payload, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
      secureStored = true;
    } catch { /* handled by the fail-closed check */ }
  }
  if (!asyncStored || (Platform.OS !== 'web' && !secureStored)) {
    throw new Error('account_local_purge_mirror_write_failed');
  }
}

async function writePurgeState(userId: string, state: DeletedAccountPurgeState): Promise<void> {
  const owner = exactOwner(userId);
  const existing = await getDeletedAccountPurgeRecord();
  if (existing && existing.ownerUserId !== owner) {
    throw new Error(`account_local_purge_slot_owned:${existing.ownerUserId}`);
  }
  // Server truth is monotonic. In particular, a cleanup/keychain failure
  // after DELETE 2xx must not downgrade COMMITTED to UNKNOWN.
  if (existing && recordPriority(existing.state) >= recordPriority(state)) return;
  await persistDeletedAccountPurgeRecord({
    ownerUserId: owner,
    state,
    updatedAt: new Date().toISOString(),
  });
}

/** Claim the single durable slot before dispatching DELETE. */
export async function reserveDeletedAccountLocalPurge(userId: string): Promise<void> {
  const owner = exactOwner(userId);
  const existing = await getDeletedAccountPurgeRecord();
  if (existing) {
    throw new Error(existing.ownerUserId === owner
      ? `account_local_purge_unresolved:${existing.state}`
      : `account_local_purge_slot_owned:${existing.ownerUserId}`);
  }
  await persistDeletedAccountPurgeRecord({
    ownerUserId: owner,
    state: 'reserved',
    updatedAt: new Date().toISOString(),
  });
}

/** A dispatched request had an ambiguous outcome and must not be retried. */
export async function markDeletedAccountLocalPurgeUnknown(userId: string): Promise<void> {
  await writePurgeState(userId, 'unknown');
}

/** Server acknowledgement promotes the reservation to purge authority. */
export async function scheduleDeletedAccountLocalPurge(userId: string): Promise<void> {
  await writePurgeState(userId, 'committed');
}

/** Release only a known-precommit reservation. */
export async function clearDeletedAccountPurgeReservation(userId: string): Promise<void> {
  const owner = exactOwner(userId);
  const existing = await getDeletedAccountPurgeRecord();
  if (!existing || existing.ownerUserId !== owner || existing.state !== 'reserved') return;
  await storage.removeItem(SCHEDULED_PURGE_KEY, { strict: true });
  if (Platform.OS !== 'web') {
    await SecureStore.deleteItemAsync(SECURE_SCHEDULED_PURGE_KEY);
  }
}

/** Clear a reserved/unknown slot only after the same owner was reconciled. */
export async function clearDeletedAccountPurgeAfterReconciliation(userId: string): Promise<void> {
  const owner = exactOwner(userId);
  const existing = await getDeletedAccountPurgeRecord();
  if (!existing || existing.ownerUserId !== owner || existing.state === 'committed') return;
  await storage.removeItem(SCHEDULED_PURGE_KEY, { strict: true });
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(SECURE_SCHEDULED_PURGE_KEY);
}

/** Server-confirmed restore cancels every deletion-purge state for that owner. */
export async function clearDeletedAccountPurgeAfterRestore(userId: string): Promise<void> {
  const owner = exactOwner(userId);
  const existing = await getDeletedAccountPurgeRecord();
  if (!existing || existing.ownerUserId !== owner) return;
  await storage.removeItem(SCHEDULED_PURGE_KEY, { strict: true });
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(SECURE_SCHEDULED_PURGE_KEY);
}

/** Finish a committed purge; every retry authority survives until credentials are gone. */
export async function completeDeletedAccountLocalPurge(
  userId: string,
  transition: AccountTransitionAuthority,
): Promise<void> {
  const owner = exactOwner(userId);
  if (!isAccountTransitionCurrent(transition)) throw new Error('account_transition_required');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const currentOwner = require('../store/useAppStore').useAppStore.getState().user?.id;
    if (currentOwner != null && String(currentOwner) !== owner) {
      throw new Error('account_local_purge_newer_owner_active');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'account_local_purge_newer_owner_active') throw error;
    // Store may be unavailable during very early cold boot; no account has
    // been published yet, and the caller still holds the transition.
  }
  const scheduled = await getDeletedAccountPurgeRecord();
  if (!scheduled || scheduled.ownerUserId !== owner || scheduled.state !== 'committed') {
    throw new Error('account_local_purge_not_committed');
  }
  await purgeDeletedAccountLocalData(owner);
  if (!isAccountTransitionCurrent(transition)) throw new Error('account_transition_lost');
  await purgeDeletedAccountDeviceGlobalData(owner, transition);
  if (!isAccountTransitionCurrent(transition)) throw new Error('account_transition_lost');
  await clearCredentialsStrict();
  if (!isAccountTransitionCurrent(transition)) throw new Error('account_transition_lost');
  await storage.removeItem(SCHEDULED_PURGE_KEY, { strict: true });
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(SECURE_SCHEDULED_PURGE_KEY);
}

/** Cold-boot recovery for a server-accepted deletion interrupted on-device. */
export async function resumeScheduledDeletedAccountLocalPurge(
  transition: AccountTransitionAuthority,
): Promise<boolean> {
  const record = await getDeletedAccountPurgeRecord();
  if (!record) return false;
  if (record.state === 'reserved') {
    // DELETE promotes RESERVED to UNKNOWN durably immediately before network
    // dispatch. Therefore a RESERVED marker surviving process death proves
    // dispatch never began and can be released without reconciliation.
    await clearDeletedAccountPurgeReservation(record.ownerUserId);
    return false;
  }
  if (record.state !== 'committed') return false;
  await completeDeletedAccountLocalPurge(record.ownerUserId, transition);
  return true;
}

/**
 * Remove durable device data owned by an account after the backend has
 * accepted account deletion. Global device preferences and internal-build
 * capability remain intact; account-scoped QA evidence is removed.
 */
export async function purgeDeletedAccountLocalData(userId: string): Promise<void> {
  const owner = exactOwner(userId);

  const routeCacheKey = `@cairn:routes:v1:${owner}`;
  const routeIds: string[] = [];
  const activityIds = new Set<string>();
  try {
    const raw = await storage.getItem(routeCacheKey);
    const routes = raw ? JSON.parse(raw) : [];
    if (Array.isArray(routes)) {
      for (const route of routes) {
        if (typeof route?.id === 'string' || typeof route?.id === 'number') {
          routeIds.push(String(route.id));
        }
      }
    }
  } catch { /* account cache is removed below */ }

  try {
    const raw = await storage.getItem(`cairn_sessions_${owner}`);
    const sessions = raw ? JSON.parse(raw) : [];
    if (Array.isArray(sessions)) {
      for (const session of sessions) {
        const id = session?.clientActivityId ?? session?.id;
        if (typeof id === 'string' || typeof id === 'number') activityIds.add(String(id));
      }
    }
  } catch { /* owner cache is removed below */ }

  const pending = await listPending().catch(() => []);
  for (const activity of pending) {
    if (String(activity.userId) === owner) {
      activityIds.add(activity.localId);
      await removePending(activity.localId, owner);
    }
  }

  const active = await listActiveHikes().catch(() => []);
  for (const activity of active) {
    if (String(activity.user_id ?? '') === owner) {
      activityIds.add(activity.session_id);
      await discardActiveHike(activity.session_id);
    }
  }

  await Promise.all([...activityIds].map((activityId) => (
    deleteAcknowledgedHikeTrackArtifacts(activityId, owner)
  )));
  await Promise.all(routeIds.map((routeId) => deleteExtras(routeId)));
  await clearSimulatorLogs(owner).catch(() => undefined);
  await purgeDurableMemoryEvidence(owner);
  // Fence deferred/chunked precise-geometry writes before the broad key sweep;
  // otherwise an in-flight cache write could recreate data after deletion.
  await purgeFogDisplayCache(owner);
  // Generic pre-O56 debug logs were not owner-scoped. Once the current
  // logger has ended during logout, removing the legacy set is the only
  // privacy-safe deletion behavior; Debug configuration itself is retained.
  await debugLogger.clearAllSessions().catch(() => undefined);

  const exact = new Set([
    `cairn_sessions_${owner}`,
    `cairn_markers_v026_${owner}`,
    routeCacheKey,
    `@cairn:offline_markers:v2:${owner}`,
    `@cairn:offline_routes:v1:${owner}`,
    `@cairn:marker_tombstones:v1:${owner}`,
    `@cairn:activity_registry:v1:${owner}`,
    `@cairn:activity_simulator:v1:${owner}`,
    `cairn:memory:tiles:v5:${owner}`,
    `cairn:memory:tiles:recovery-v1:${owner}`,
    `cairn:memory:presence:v1:${owner}`,
    `cairn:memory:presence:recovery-v1:${owner}`,
    `cairn_memory_hydrate_state_v2:${encodeURIComponent(owner)}`,
    `cairn:memory:h3:v2:${owner}`,
    `cairn:memory:fog-display:v1:${owner}`,
    `cairn:memory:fog-display:v2:${owner}`,
    `cairn:memory:fog-display:v3:${owner}`,
    `cairn:friend-content:v2:${owner}`,
    `cairn:public-cairns:v1:${owner}`,
    `cairn:friend-memory-projections:v1:${owner}`,
    `cairn:memory:synthetic:v1:${owner}`,
    `cairn_onboarding_v1_done_${owner}`,
    `cairn:plant:draft:v3:${owner}`,
    `cairn_saf01_payload:${owner}`,
    `cairn_qa_snap_review_clone_v1_${owner}`,
  ]);
  const prefixes = [
    `cairn_trackpoints_${owner}_`,
    `@cairn:activity_final:v1:${owner}:`,
    `@cairn:activity_simulator_logs:v1:${owner}:`,
    `@cairn:activity_simulator_upload:v1:${owner}:`,
    `cairn:memory:fog-display:v3:${owner}:chunk:`,
  ];
  const keys = await AsyncStorage.getAllKeys();
  const hierarchyOwned = (key: string) => (
    key.startsWith('hierarchy:deepest:') || key.startsWith('hierarchy:panel:')
  ) && key.includes(`:${owner}:`);
  const owned = keys.filter((key) => (
    exact.has(key) || prefixes.some((prefix) => key.startsWith(prefix)) || hierarchyOwned(key)
  ));
  if (owned.length > 0) await AsyncStorage.multiRemove(owned);
}

/**
 * Remove legacy device-global outgoing-account state only while the shared
 * account transition excludes installation of a replacement account. This
 * function intentionally stays separate from owner-keyed delayed purges so
 * a late A retry cannot erase B's device-global state.
 */
export async function purgeDeletedAccountDeviceGlobalData(
  userId: string,
  transition: AccountTransitionAuthority,
): Promise<void> {
  exactOwner(userId);
  if (!isAccountTransitionCurrent(transition)) throw new Error('account_transition_required');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const currentOwner = require('../store/useAppStore').useAppStore.getState().user?.id;
    if (currentOwner != null && String(currentOwner) !== String(userId)) {
      throw new Error('account_local_purge_newer_owner_active');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'account_local_purge_newer_owner_active') throw error;
  }
  const exact = new Set([
    '@cairn:offline_queue:v1',
    '@cairn:edit_session_active_v6_3',
    '@cairn:edit_session_active',
    'cairn_friends',
    'cairn_last_crash',
    'cairn_boot_checkpoint_v1',
    'cairn_boot_checkpoint_previous_v1',
    'cairn_last_fix_v1',
  ]);
  const keys = await AsyncStorage.getAllKeys();
  const removable = keys.filter((key) => exact.has(key) || key.startsWith('cairn_apple_name_'));
  if (removable.length > 0) await AsyncStorage.multiRemove(removable);
}
