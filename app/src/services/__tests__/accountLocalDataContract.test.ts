import fs from 'node:fs';
import path from 'node:path';

const mockAsyncValues = new Map<string, string>();
const mockMultiRemove = jest.fn(async (keys: string[]) => {
  for (const key of keys) mockAsyncValues.delete(key);
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => [...mockAsyncValues.keys()]),
    multiRemove: mockMultiRemove,
  },
}));
jest.mock('../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockAsyncValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockAsyncValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockAsyncValues.delete(key); }),
  },
}));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'after-first-unlock',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('../../services/pendingSyncStore', () => ({
  listPending: jest.fn(async () => []), removePending: jest.fn(async () => undefined),
}));
jest.mock('../../services/hikeTrackWriter', () => ({
  listActiveHikes: jest.fn(async () => []),
  discardActiveHike: jest.fn(async () => undefined),
  deleteAcknowledgedHikeTrackArtifacts: jest.fn(async () => undefined),
}));
jest.mock('../../services/LocalRouteExtras', () => ({ deleteExtras: jest.fn(async () => undefined) }));
jest.mock('../../features/activitySimulator/simulatorLog', () => ({ clearSimulatorLogs: jest.fn(async () => undefined) }));
jest.mock('../../services/debugLogger', () => ({
  debugLogger: { clearAllSessions: jest.fn(async () => undefined) },
}));

const { purgeDeletedAccountLocalData } = require('../accountLocalData');

const appRoot = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(appRoot, 'src/services/accountLocalData.ts'), 'utf8');

describe('deleted-account local ownership isolation', () => {
  test('purge requires an exact owner and removes every owner-scoped durable family', () => {
    expect(source).toContain('account_local_purge_owner_required');
    for (const authority of [
      'listPending()',
      'removePending(activity.localId, owner)',
      'listActiveHikes()',
      'discardActiveHike(activity.session_id)',
      'deleteExtras(routeId)',
      'clearSimulatorLogs(owner)',
      'debugLogger.clearAllSessions()',
      'deleteAcknowledgedHikeTrackArtifacts(activityId, owner)',
      'cairn_sessions_${owner}',
      'cairn_trackpoints_${owner}_',
      '@cairn:activity_registry:v1:${owner}',
      '@cairn:offline_markers:v2:${owner}',
      '@cairn:offline_routes:v1:${owner}',
      'cairn:memory:tiles:v5:${owner}',
      'cairn:memory:presence:v1:${owner}',
      'cairn:memory:h3:v2:${owner}',
      'cairn_saf01_payload:${owner}',
      'cairn:plant:draft:v3:${owner}',
      '@cairn:offline_queue:v1',
      '@cairn:edit_session_active_v6_3',
      'cairn_friends',
      'cairn_last_crash',
      'cairn_boot_checkpoint_v1',
    ]) expect(source).toContain(authority);
  });

  test('real purge removes all A cache families and preserves matching B cache families', async () => {
    mockAsyncValues.clear();
    mockMultiRemove.mockClear();
    const ownerFamilies = [
      'cairn_sessions_',
      'cairn_markers_v026_',
      '@cairn:routes:v1:',
      'cairn:memory:tiles:v5:',
      'cairn:memory:presence:v1:',
      'cairn:friend-content:v2:',
      'cairn:public-cairns:v1:',
      'cairn:friend-memory-projections:v1:',
      'cairn:memory:synthetic:v1:',
    ];
    for (const prefix of ownerFamilies) {
      mockAsyncValues.set(`${prefix}A`, '[]');
      mockAsyncValues.set(`${prefix}B`, '[]');
    }
    mockAsyncValues.set('cairn_trackpoints_A_activity-a', 'private-a');
    mockAsyncValues.set('cairn_trackpoints_B_activity-b', 'private-b');
    mockAsyncValues.set('hierarchy:deepest:scope:A:trail', 'private-a');
    mockAsyncValues.set('hierarchy:deepest:scope:B:trail', 'private-b');

    await purgeDeletedAccountLocalData('A');

    for (const prefix of ownerFamilies) {
      expect(mockAsyncValues.has(`${prefix}A`)).toBe(false);
      expect(mockAsyncValues.get(`${prefix}B`)).toBe('[]');
    }
    expect(mockAsyncValues.has('cairn_trackpoints_A_activity-a')).toBe(false);
    expect(mockAsyncValues.get('cairn_trackpoints_B_activity-b')).toBe('private-b');
    expect(mockAsyncValues.has('hierarchy:deepest:scope:A:trail')).toBe(false);
    expect(mockAsyncValues.get('hierarchy:deepest:scope:B:trail')).toBe('private-b');
    expect(mockMultiRemove).toHaveBeenCalledTimes(1);
  });

  test('an interrupted server-accepted deletion resumes before another account hydrates', () => {
    expect(source).toContain("const SCHEDULED_PURGE_KEY = '@cairn:account-deletion-local-purge:v1'");
    expect(source).toContain("const SECURE_SCHEDULED_PURGE_KEY = 'cairn_account_deletion_local_purge_v1'");
    expect(source).toContain('account_local_purge_schedule_failed');
    expect(source).toContain('scheduleDeletedAccountLocalPurge');
    expect(source).toContain('completeDeletedAccountLocalPurge');
    expect(source).toContain('resumeScheduledDeletedAccountLocalPurge');
  });

  test('precise last position and account hierarchy cache cannot leak to the next account', () => {
    expect(source).toContain("'cairn_last_fix_v1'");
    expect(source).toContain("key.startsWith('hierarchy:deepest:')");
    expect(source).toContain("key.startsWith('hierarchy:panel:')");
    expect(source).toContain('key.includes(`:${owner}:`)');
  });

  test('device preferences and internal build capability are deliberately not wiped', () => {
    expect(source).not.toContain("'cairn_settings'");
    expect(source).not.toContain('EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED');
  });
});
