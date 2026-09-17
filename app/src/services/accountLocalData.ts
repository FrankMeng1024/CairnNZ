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

const SCHEDULED_PURGE_KEY = '@cairn:account-deletion-local-purge:v1';
const SECURE_SCHEDULED_PURGE_KEY = 'cairn_account_deletion_local_purge_v1';

function exactOwner(userId: string): string {
  const owner = String(userId || '');
  if (!owner || owner === 'guest' || owner === 'unknown') {
    throw new Error('account_local_purge_owner_required');
  }
  return owner;
}

/** Durable retry marker written after server acceptance but before local work. */
export async function scheduleDeletedAccountLocalPurge(userId: string): Promise<void> {
  const owner = exactOwner(userId);
  let asyncStored = false;
  let secureStored = false;
  try {
    await storage.setItem(SCHEDULED_PURGE_KEY, owner, { strict: true });
    asyncStored = true;
  } catch { /* try the independent native keychain marker below */ }
  if (Platform.OS !== 'web') {
    try {
      await SecureStore.setItemAsync(SECURE_SCHEDULED_PURGE_KEY, owner, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
      secureStored = true;
    } catch { /* handled by the fail-closed check */ }
  }
  if (!asyncStored && !secureStored) {
    throw new Error('account_local_purge_schedule_failed');
  }
}

/** Finish a scheduled purge; the marker survives any partial storage failure. */
export async function completeDeletedAccountLocalPurge(userId: string): Promise<void> {
  const owner = exactOwner(userId);
  await purgeDeletedAccountLocalData(owner);
  const scheduled = await storage.getItem(SCHEDULED_PURGE_KEY);
  if (scheduled === owner) await storage.removeItem(SCHEDULED_PURGE_KEY);
  if (Platform.OS !== 'web') {
    const secureScheduled = await SecureStore.getItemAsync(SECURE_SCHEDULED_PURGE_KEY).catch(() => null);
    if (secureScheduled === owner) {
      await SecureStore.deleteItemAsync(SECURE_SCHEDULED_PURGE_KEY).catch(() => undefined);
    }
  }
}

/** Cold-boot recovery for a server-accepted deletion interrupted on-device. */
export async function resumeScheduledDeletedAccountLocalPurge(): Promise<boolean> {
  const asyncOwner = await storage.getItem(SCHEDULED_PURGE_KEY);
  const secureOwner = Platform.OS === 'web'
    ? null
    : await SecureStore.getItemAsync(SECURE_SCHEDULED_PURGE_KEY).catch(() => null);
  const owner = asyncOwner || secureOwner;
  if (!owner) return false;
  await completeDeletedAccountLocalPurge(owner);
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
    `cairn:memory:h3:v2:${owner}`,
    `cairn_onboarding_v1_done_${owner}`,
    `cairn:plant:draft:v3:${owner}`,
    `cairn_saf01_payload:${owner}`,
    `cairn_qa_snap_review_clone_v1_${owner}`,
    // Legacy device-global stores are not safe to replay as another user.
    '@cairn:offline_queue:v1',
    '@cairn:edit_session_active_v6_3',
    '@cairn:edit_session_active',
    'cairn_friends',
    'cairn_last_crash',
    'cairn_boot_checkpoint_v1',
    'cairn_boot_checkpoint_previous_v1',
    // This cache is device-global in the current Memory architecture, but
    // its value is the outgoing account's most recent precise position.
    // Account deletion must not let another signed-in user inherit it.
    'cairn_last_fix_v1',
  ]);
  const prefixes = [
    `cairn_trackpoints_${owner}_`,
    `@cairn:activity_simulator_logs:v1:${owner}:`,
    `@cairn:activity_simulator_upload:v1:${owner}:`,
    'cairn_apple_name_',
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
