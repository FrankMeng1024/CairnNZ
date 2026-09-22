const mockAsyncValues = new Map<string, string>();
const mockSecureValues = new Map<string, string>();
let mockFailCredentialDelete = false;
let mockFailAsyncMarkerRead = false;
let mockFailSecureMarkerRead = false;
let mockFailAsyncMarkerWrite = false;
let mockFailSecureMarkerWrite = false;
const mockAppState = { user: null as null | { id: string } };

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 1,
  getItemAsync: jest.fn(async (key: string) => {
    if (key === 'cairn_account_deletion_local_purge_v1' && mockFailSecureMarkerRead) {
      throw new Error('secure_read_failed');
    }
    return mockSecureValues.get(key) ?? null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (key === 'cairn_account_deletion_local_purge_v1' && mockFailSecureMarkerWrite) {
      throw new Error('secure_write_failed');
    }
    mockSecureValues.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    if (key === 'cairn_remember_me' && mockFailCredentialDelete) throw new Error('keychain_locked');
    mockSecureValues.delete(key);
  }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => [...mockAsyncValues.keys()]),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((key) => mockAsyncValues.delete(key)); }),
  },
}));
jest.mock('../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockAsyncValues.get(key) ?? null),
    getItemStrict: jest.fn(async (key: string) => {
      if (key === '@cairn:account-deletion-local-purge:v1' && mockFailAsyncMarkerRead) {
        throw new Error('async_read_failed');
      }
      return mockAsyncValues.get(key) ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      if (key === '@cairn:account-deletion-local-purge:v1' && mockFailAsyncMarkerWrite) {
        throw new Error('async_write_failed');
      }
      mockAsyncValues.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => { mockAsyncValues.delete(key); }),
  },
}));
jest.mock('../../store/useAppStore', () => ({ useAppStore: { getState: () => mockAppState } }));
jest.mock('../pendingSyncStore', () => ({ listPending: jest.fn(async () => []), removePending: jest.fn() }));
jest.mock('../hikeTrackWriter', () => ({
  listActiveHikes: jest.fn(async () => []),
  discardActiveHike: jest.fn(),
  deleteAcknowledgedHikeTrackArtifacts: jest.fn(async () => undefined),
}));
jest.mock('../LocalRouteExtras', () => ({ deleteExtras: jest.fn(async () => undefined) }));
jest.mock('../../features/activitySimulator/simulatorLog', () => ({ clearSimulatorLogs: jest.fn(async () => undefined) }));
jest.mock('../debugLogger', () => ({ debugLogger: { clearAllSessions: jest.fn(async () => undefined) } }));
jest.mock('../../features/memory/services/fogDisplayCache', () => ({ purgeFogDisplayCache: jest.fn(async () => undefined) }));

describe('single-slot deleted-account purge authority', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAsyncValues.clear();
    mockSecureValues.clear();
    mockFailCredentialDelete = false;
    mockFailAsyncMarkerRead = false;
    mockFailSecureMarkerRead = false;
    mockFailAsyncMarkerWrite = false;
    mockFailSecureMarkerWrite = false;
    mockAppState.user = null;
  });

  test('DELETE/SLOT-01 unresolved A rejects B before B can reserve/dispatch', async () => {
    const local = require('../accountLocalData');
    await local.reserveDeletedAccountLocalPurge('owner-a');
    await local.markDeletedAccountLocalPurgeUnknown('owner-a');

    await expect(local.reserveDeletedAccountLocalPurge('owner-b')).rejects.toThrow('account_local_purge_slot_owned:owner-a');
    await expect(local.reserveDeletedAccountLocalPurge('owner-a')).rejects.toThrow('account_local_purge_unresolved:unknown');
    await expect(local.getDeletedAccountPurgeRecord()).resolves.toMatchObject({
      ownerUserId: 'owner-a',
      state: 'unknown',
    });
  });

  test('DELETE/B-SAFE-01 delayed committed A purge cannot remove globals while B is active', async () => {
    const transitions = require('../accountTransitionAuthority');
    const local = require('../accountLocalData');
    await local.reserveDeletedAccountLocalPurge('owner-a');
    await local.scheduleDeletedAccountLocalPurge('owner-a');
    mockAppState.user = { id: 'owner-b' };
    const transition = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.completeDeletedAccountLocalPurge('owner-a', transition))
      .rejects.toThrow('account_local_purge_newer_owner_active');
    await expect(local.getDeletedAccountPurgeRecord()).resolves.toMatchObject({
      ownerUserId: 'owner-a', state: 'committed',
    });
  });

  test('DELETE/CREDENTIAL-01 keychain deletion failure keeps committed retry marker', async () => {
    const transitions = require('../accountTransitionAuthority');
    const local = require('../accountLocalData');
    await local.reserveDeletedAccountLocalPurge('owner-a');
    await local.scheduleDeletedAccountLocalPurge('owner-a');
    mockSecureValues.set('cairn_remember_me', '{"email":"a@example.test","password":"secret"}');
    mockFailCredentialDelete = true;
    const transition = transitions.beginAccountTransition({ kind: 'delete-account', expectedOwnerUserId: 'owner-a' }).authority;

    await expect(local.completeDeletedAccountLocalPurge('owner-a', transition)).rejects.toThrow('keychain_locked');
    await expect(local.getDeletedAccountPurgeRecord()).resolves.toMatchObject({
      ownerUserId: 'owner-a', state: 'committed',
    });
    expect(mockSecureValues.get('cairn_remember_me')).toContain('a@example.test');
  });

  test('DELETE/RESTART-RESERVED-01 process death before dispatch releases RESERVED and unblocks the slot', async () => {
    let local = require('../accountLocalData');
    await local.reserveDeletedAccountLocalPurge('owner-a');
    await expect(local.getDeletedAccountPurgeRecord()).resolves.toMatchObject({ state: 'reserved' });

    // Durable maps survive the simulated process/module restart.
    jest.resetModules();
    const transitions = require('../accountTransitionAuthority');
    local = require('../accountLocalData');
    const boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.resumeScheduledDeletedAccountLocalPurge(boot)).resolves.toBe(false);
    await expect(local.getDeletedAccountPurgeRecord()).resolves.toBeNull();
    await expect(local.reserveDeletedAccountLocalPurge('owner-b')).resolves.toBeUndefined();
  });

  test('DELETE/RESTART-UNKNOWN-01 process death after dispatch keeps UNKNOWN reconciliation fence', async () => {
    let local = require('../accountLocalData');
    await local.reserveDeletedAccountLocalPurge('owner-a');
    await local.markDeletedAccountLocalPurgeUnknown('owner-a');

    jest.resetModules();
    const transitions = require('../accountTransitionAuthority');
    local = require('../accountLocalData');
    const boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.resumeScheduledDeletedAccountLocalPurge(boot)).resolves.toBe(false);
    await expect(local.getDeletedAccountPurgeRecord()).resolves.toMatchObject({
      ownerUserId: 'owner-a', state: 'unknown',
    });
    await expect(local.reserveDeletedAccountLocalPurge('owner-b'))
      .rejects.toThrow('account_local_purge_slot_owned:owner-a');
  });

  test('DELETE/MONOTONIC-01 COMMITTED cannot downgrade and cold boot completes its purge', async () => {
    let transitions = require('../accountTransitionAuthority');
    let local = require('../accountLocalData');
    await local.reserveDeletedAccountLocalPurge('owner-a');
    await local.markDeletedAccountLocalPurgeUnknown('owner-a');
    await local.scheduleDeletedAccountLocalPurge('owner-a');
    await local.markDeletedAccountLocalPurgeUnknown('owner-a');
    await expect(local.getDeletedAccountPurgeRecord()).resolves.toMatchObject({ state: 'committed' });

    jest.resetModules();
    transitions = require('../accountTransitionAuthority');
    local = require('../accountLocalData');
    const boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.resumeScheduledDeletedAccountLocalPurge(boot)).resolves.toBe(true);
    await expect(local.getDeletedAccountPurgeRecord()).resolves.toBeNull();
  });

  test('DELETE/MIRROR-ASYNC-HIGH-01 restart heals Async UNKNOWN over Secure RESERVED before release', async () => {
    const asyncKey = '@cairn:account-deletion-local-purge:v1';
    const secureKey = 'cairn_account_deletion_local_purge_v1';
    let local = require('../accountLocalData');
    await local.reserveDeletedAccountLocalPurge('owner-a');
    mockFailSecureMarkerWrite = true;
    await expect(local.markDeletedAccountLocalPurgeUnknown('owner-a'))
      .rejects.toThrow('account_local_purge_mirror_write_failed');
    expect(JSON.parse(mockAsyncValues.get(asyncKey)!).state).toBe('unknown');
    expect(JSON.parse(mockSecureValues.get(secureKey)!).state).toBe('reserved');

    mockFailSecureMarkerWrite = false;
    jest.resetModules();
    const transitions = require('../accountTransitionAuthority');
    local = require('../accountLocalData');
    const boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.resumeScheduledDeletedAccountLocalPurge(boot)).resolves.toBe(false);
    expect(JSON.parse(mockAsyncValues.get(asyncKey)!).state).toBe('unknown');
    expect(JSON.parse(mockSecureValues.get(secureKey)!).state).toBe('unknown');
    await expect(local.reserveDeletedAccountLocalPurge('owner-b'))
      .rejects.toThrow('account_local_purge_slot_owned:owner-a');
  });

  test('DELETE/MIRROR-SECURE-HIGH-01 restart heals Secure UNKNOWN/COMMITTED over lower Async truth and purges', async () => {
    const asyncKey = '@cairn:account-deletion-local-purge:v1';
    const secureKey = 'cairn_account_deletion_local_purge_v1';
    let local = require('../accountLocalData');
    await local.reserveDeletedAccountLocalPurge('owner-a');
    mockFailAsyncMarkerWrite = true;
    await expect(local.markDeletedAccountLocalPurgeUnknown('owner-a'))
      .rejects.toThrow('account_local_purge_mirror_write_failed');
    expect(JSON.parse(mockAsyncValues.get(asyncKey)!).state).toBe('reserved');
    expect(JSON.parse(mockSecureValues.get(secureKey)!).state).toBe('unknown');

    mockFailAsyncMarkerWrite = false;
    jest.resetModules();
    let transitions = require('../accountTransitionAuthority');
    local = require('../accountLocalData');
    let boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.resumeScheduledDeletedAccountLocalPurge(boot)).resolves.toBe(false);
    expect(JSON.parse(mockAsyncValues.get(asyncKey)!).state).toBe('unknown');
    expect(JSON.parse(mockSecureValues.get(secureKey)!).state).toBe('unknown');
    await expect(local.reserveDeletedAccountLocalPurge('owner-b'))
      .rejects.toThrow('account_local_purge_slot_owned:owner-a');

    mockFailAsyncMarkerWrite = true;
    await expect(local.scheduleDeletedAccountLocalPurge('owner-a'))
      .rejects.toThrow('account_local_purge_mirror_write_failed');
    expect(JSON.parse(mockAsyncValues.get(asyncKey)!).state).toBe('unknown');
    expect(JSON.parse(mockSecureValues.get(secureKey)!).state).toBe('committed');

    mockFailAsyncMarkerWrite = false;
    jest.resetModules();
    transitions = require('../accountTransitionAuthority');
    local = require('../accountLocalData');
    boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.resumeScheduledDeletedAccountLocalPurge(boot)).resolves.toBe(true);
    await expect(local.getDeletedAccountPurgeRecord()).resolves.toBeNull();
  });

  test.each<[string, () => void, string]>([
    ['AsyncStorage', () => { mockFailAsyncMarkerRead = true; }, 'account_local_purge_async_read_failed'],
    ['SecureStore', () => { mockFailSecureMarkerRead = true; }, 'account_local_purge_secure_read_failed'],
  ])('DELETE/MIRROR-READ-01 %s failure is not treated as marker absence', async (_name, failRead, error) => {
    const record = JSON.stringify({
      ownerUserId: 'owner-a', state: 'reserved', updatedAt: '2026-09-20T01:00:00.000Z',
    });
    mockAsyncValues.set('@cairn:account-deletion-local-purge:v1', record);
    mockSecureValues.set('cairn_account_deletion_local_purge_v1', record);
    failRead();
    const transitions = require('../accountTransitionAuthority');
    const local = require('../accountLocalData');
    const boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.resumeScheduledDeletedAccountLocalPurge(boot)).rejects.toThrow(error);
    expect(mockAsyncValues.has('@cairn:account-deletion-local-purge:v1')).toBe(true);
    expect(mockSecureValues.has('cairn_account_deletion_local_purge_v1')).toBe(true);
  });

  test('DELETE/MARKER-CORRUPT-BOTH-01 matching schema-invalid JSON fails closed without purge or marker loss', async () => {
    const asyncKey = '@cairn:account-deletion-local-purge:v1';
    const secureKey = 'cairn_account_deletion_local_purge_v1';
    mockAsyncValues.set(asyncKey, '{}');
    mockSecureValues.set(secureKey, '{}');
    const transitions = require('../accountTransitionAuthority');
    const local = require('../accountLocalData');
    const boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.resumeScheduledDeletedAccountLocalPurge(boot))
      .rejects.toThrow('account_local_purge_async_read_failed');
    expect(mockAsyncValues.get(asyncKey)).toBe('{}');
    expect(mockSecureValues.get(secureKey)).toBe('{}');
  });

  test.each([
    ['AsyncStorage', '@cairn:account-deletion-local-purge:v1', 'account_local_purge_async_read_failed'],
    ['SecureStore', 'cairn_account_deletion_local_purge_v1', 'account_local_purge_secure_read_failed'],
  ])('DELETE/MARKER-CORRUPT-MISSING-01 %s corruption is not treated as a committed legacy owner', async (_name, key, error) => {
    const corrupt = JSON.stringify({ ownerUserId: '123', state: 'bogus' });
    if (key.startsWith('@')) mockAsyncValues.set(key, corrupt);
    else mockSecureValues.set(key, corrupt);
    const transitions = require('../accountTransitionAuthority');
    const local = require('../accountLocalData');
    const boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

    await expect(local.resumeScheduledDeletedAccountLocalPurge(boot)).rejects.toThrow(error);
    expect((key.startsWith('@') ? mockAsyncValues : mockSecureValues).get(key)).toBe(corrupt);
  });

  test('DELETE/MARKER-LEGACY-01 exact historical numeric owner remains compatible and is healed to structured mirrors', async () => {
    const asyncKey = '@cairn:account-deletion-local-purge:v1';
    const secureKey = 'cairn_account_deletion_local_purge_v1';
    mockAsyncValues.set(asyncKey, '123');
    const local = require('../accountLocalData');

    await expect(local.getDeletedAccountPurgeRecord()).resolves.toMatchObject({
      ownerUserId: '123', state: 'committed',
    });
    expect(JSON.parse(mockAsyncValues.get(asyncKey)!)).toMatchObject({ ownerUserId: '123', state: 'committed' });
    expect(JSON.parse(mockSecureValues.get(secureKey)!)).toMatchObject({ ownerUserId: '123', state: 'committed' });
  });

  test.each(['owner-a', '0', '18446744073709551616'])(
    'DELETE/MARKER-LEGACY-REJECT-01 non-historical raw owner %s fails closed',
    async raw => {
      const asyncKey = '@cairn:account-deletion-local-purge:v1';
      mockAsyncValues.set(asyncKey, raw);
      const transitions = require('../accountTransitionAuthority');
      const local = require('../accountLocalData');
      const boot = transitions.beginAccountTransition({ kind: 'cold-hydrate' }).authority;

      await expect(local.resumeScheduledDeletedAccountLocalPurge(boot))
        .rejects.toThrow('account_local_purge_async_read_failed');
      expect(mockAsyncValues.get(asyncKey)).toBe(raw);
    },
  );
});
