/**
 * useSessionStore.test — verify per-user session isolation.
 * Critical privacy regression test: User A's sessions must NOT leak to User B.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const setupAsyncStorageMock = (options: { failRemoveOnceForKey?: string } = {}) => {
  const store: Record<string, string> = {};
  let removeFailureRemaining = options.failRemoveOnceForKey ? 1 : 0;
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      if (key === options.failRemoveOnceForKey && removeFailureRemaining > 0) {
        removeFailureRemaining -= 1;
        throw new Error('injected_track_cleanup_failure');
      }
      delete store[key];
    }),
    __peek: () => ({ ...store }),
  }));
  return store;
};

jest.mock('../src/services/apiService', () => ({
  authenticatedFetch: jest.fn(async () => ({ ok: false, json: async () => null })),
}));
jest.mock('../src/services/sessionService', () => ({
  deleteRemoteSession: jest.fn(async () => {}),
  deleteRemoteSessionByClientId: jest.fn(async () => true),
  renameRemoteSession: jest.fn(async (_id: number, name: string) => ({ ok: true, name })),
}));
jest.mock('../src/services/pendingSyncStore', () => ({
  renamePendingActivity: jest.fn(async () => true),
  removePending: jest.fn(async () => undefined),
}));
jest.mock('../src/services/crashLogger', () => ({
  crashLogger: { breadcrumb: jest.fn(), captureException: jest.fn() },
}));

describe('useSessionStore — per-user isolation', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('user A sessions do not leak to user B after switch', async () => {
    setupAsyncStorageMock();
    const { useSessionStore } = require('../src/store/useSessionStore');

    // Hydrate as user A
    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'sess-a-1',
      activityMode: 'hiking',
      regionCode: 'nz',
      startedAt: 1000,
      endedAt: 2000,
      durationS: 1000,
      distanceM: 500,
      elevationGainM: 0,
      trackPoints: [],
      markerIds: [],
    });
    expect(useSessionStore.getState().sessions).toHaveLength(1);

    // Switch to user B (re-hydrate)
    await useSessionStore.getState().hydrate('userB');
    expect(useSessionStore.getState().sessions).toHaveLength(0);
    expect(useSessionStore.getState().currentUserId).toBe('userB');

    // Add user B session
    await useSessionStore.getState().addSession({
      id: 'sess-b-1',
      activityMode: 'running',
      regionCode: 'nz',
      startedAt: 3000,
      endedAt: 4000,
      durationS: 1000,
      distanceM: 800,
      elevationGainM: 0,
      trackPoints: [],
      markerIds: [],
    });
    expect(useSessionStore.getState().sessions).toHaveLength(1);
    expect(useSessionStore.getState().sessions[0].id).toBe('sess-b-1');

    // Switch back to user A — should see only user A's session
    await useSessionStore.getState().hydrate('userA');
    expect(useSessionStore.getState().sessions).toHaveLength(1);
    expect(useSessionStore.getState().sessions[0].id).toBe('sess-a-1');
  });

  it('guest hydrate is isolated from logged-in users', async () => {
    setupAsyncStorageMock();
    const { useSessionStore } = require('../src/store/useSessionStore');

    // Logged-in user A creates a session
    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'sess-a-1',
      activityMode: 'hiking',
      regionCode: 'nz',
      startedAt: 1000,
      endedAt: 2000,
      durationS: 1000,
      distanceM: 500,
      elevationGainM: 0,
      trackPoints: [],
      markerIds: [],
    });

    // JWT expires, app re-hydrates as guest (logged out)
    await useSessionStore.getState().hydrate('guest');
    expect(useSessionStore.getState().sessions).toHaveLength(0);
    expect(useSessionStore.getState().currentUserId).toBe('guest');
  });

  it('clearSessions only clears current user, not others', async () => {
    const store = setupAsyncStorageMock();
    const { useSessionStore } = require('../src/store/useSessionStore');

    // User A has data
    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'sess-a-1',
      activityMode: 'hiking',
      regionCode: 'nz',
      startedAt: 1000,
      endedAt: 2000,
      durationS: 1000,
      distanceM: 500,
      elevationGainM: 0,
      trackPoints: [],
      markerIds: [],
    });

    // Switch to user B and clear
    await useSessionStore.getState().hydrate('userB');
    await useSessionStore.getState().clearSessions();

    // User A's data should still exist in storage
    await useSessionStore.getState().hydrate('userA');
    expect(useSessionStore.getState().sessions).toHaveLength(1);
  });

  it('uses correct storage keys (cairn_sessions_<userId>)', async () => {
    const store = setupAsyncStorageMock();
    const { useSessionStore } = require('../src/store/useSessionStore');

    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'sess-a-1',
      activityMode: 'hiking',
      regionCode: 'nz',
      startedAt: 1000,
      endedAt: 2000,
      durationS: 1000,
      distanceM: 500,
      elevationGainM: 0,
      trackPoints: [{ lat: 1, lng: 2, t: 1500 }],
      markerIds: [],
    });

    // Verify keys exist
    expect(store['cairn_sessions_userA']).toBeDefined();
    expect(store['cairn_trackpoints_userA_sess-a-1']).toBeDefined();
    // Old non-scoped key should NOT exist
    expect(store['cairn_sessions']).toBeUndefined();
    expect(store['cairn_trackpoints_sess-a-1']).toBeUndefined();
  });

  it('persists pausePins through hydrate roundtrip', async () => {
    setupAsyncStorageMock();
    const { useSessionStore } = require('../src/store/useSessionStore');

    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'sess-a-pp',
      activityMode: 'running',
      regionCode: 'nz',
      startedAt: 1000,
      endedAt: 2000,
      durationS: 1000,
      distanceM: 500,
      elevationGainM: 0,
      trackPoints: [],
      markerIds: [],
      pausePins: [
        { lat: 31.5, lng: 121.5 },
        { lat: 31.6, lng: 121.6 },
      ],
    });

    // Re-hydrate: simulate app restart for same user
    await useSessionStore.getState().hydrate('userA');
    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pausePins).toHaveLength(2);
    expect(sessions[0].pausePins?.[0]).toMatchObject({ lat: 31.5, lng: 121.5 });
    expect(sessions[0].pausePins?.[1]).toMatchObject({ lat: 31.6, lng: 121.6 });
  });

  it('never evicts pending local-authoritative Activities at the 500-item history cap', async () => {
    const storage = setupAsyncStorageMock();
    const { useSessionStore } = require('../src/store/useSessionStore');

    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'old-pending',
      activityMode: 'hiking',
      regionCode: 'nz',
      startedAt: 1,
      endedAt: 2,
      durationS: 1,
      distanceM: 1,
      elevationGainM: 0,
      trackPoints: [{ lat: -41, lng: 174, t: 1 }],
      markerIds: [],
      syncState: 'pending',
    });
    for (let index = 0; index < 505; index += 1) {
      await useSessionStore.getState().addSession({
        id: `server-${index}`,
        remoteId: index + 1,
        activityMode: 'running',
        regionCode: 'nz',
        startedAt: index + 10,
        endedAt: index + 11,
        durationS: 1,
        distanceM: 1,
        elevationGainM: 0,
        trackPoints: [],
        markerIds: [],
        syncState: 'synced',
      });
    }

    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(501);
    expect(sessions.some((session: { id: string }) => session.id === 'old-pending')).toBe(true);
    expect(JSON.parse(storage.cairn_sessions_userA)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'old-pending', syncState: 'pending' })]),
    );
    expect(storage['cairn_trackpoints_userA_old-pending']).toBeDefined();
  });

  it('renames a synced Activity only after the server accepts it', async () => {
    setupAsyncStorageMock();
    const service = require('../src/services/sessionService');
    const { useSessionStore } = require('../src/store/useSessionStore');
    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'local-a', clientActivityId: 'local-a', remoteId: 42, syncState: 'synced',
      activityMode: 'hiking', regionCode: 'nz', startedAt: 1, endedAt: 2,
      durationS: 1, distanceM: 30, elevationGainM: 0, trackPoints: [], markerIds: [], name: 'Before',
    });

    service.renameRemoteSession.mockResolvedValueOnce({ ok: false, reason: 'unavailable' });
    await expect(useSessionStore.getState().renameSession('local-a', 'False success')).resolves.toEqual({
      ok: false, reason: 'unavailable',
    });
    expect(useSessionStore.getState().sessions[0].name).toBe('Before');

    service.renameRemoteSession.mockResolvedValueOnce({ ok: true, name: 'After' });
    await expect(useSessionStore.getState().renameSession('local-a', 'After')).resolves.toEqual({ ok: true });
    expect(useSessionStore.getState().sessions[0].name).toBe('After');
    expect(service.renameRemoteSession).toHaveBeenCalledWith(42, 'After');
  });

  it('renames pending Activity outbox before changing its local projection', async () => {
    setupAsyncStorageMock();
    const pending = require('../src/services/pendingSyncStore');
    const { useSessionStore } = require('../src/store/useSessionStore');
    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'local-pending', clientActivityId: 'local-pending', syncState: 'pending',
      activityMode: 'running', regionCode: 'nz', startedAt: 1, endedAt: 2,
      durationS: 1, distanceM: 30, elevationGainM: 0, trackPoints: [], markerIds: [], name: 'Before',
    });
    pending.renamePendingActivity.mockResolvedValueOnce(false);
    await expect(useSessionStore.getState().renameSession('local-pending', 'Nope')).resolves.toEqual({
      ok: false, reason: 'pending-missing',
    });
    expect(useSessionStore.getState().sessions[0].name).toBe('Before');
    pending.renamePendingActivity.mockResolvedValueOnce(true);
    await expect(useSessionStore.getState().renameSession('local-pending', 'Queued')).resolves.toEqual({ ok: true });
    expect(useSessionStore.getState().sessions[0].name).toBe('Queued');
  });

  it('reports a durable queued server deletion without resurrecting the local Activity', async () => {
    setupAsyncStorageMock();
    const service = require('../src/services/sessionService');
    const { useSessionStore } = require('../src/store/useSessionStore');
    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'delete-me', clientActivityId: 'delete-me', serverActivityId: 42, syncState: 'synced',
      activityMode: 'hiking', regionCode: 'nz', startedAt: 1, endedAt: 2,
      durationS: 1, distanceM: 30, elevationGainM: 0, trackPoints: [], markerIds: [],
    });
    service.deleteRemoteSessionByClientId.mockResolvedValueOnce(false);
    service.deleteRemoteSession.mockResolvedValueOnce(false);

    await expect(useSessionStore.getState().deleteSession('delete-me')).resolves.toEqual({
      remoteState: 'queued',
    });
    expect(useSessionStore.getState().sessions).toHaveLength(0);
    expect(service.deleteRemoteSession).toHaveBeenCalledWith(42);
  });

  it('does not treat a missing client identity as an alias for legitimate id-only summaries', async () => {
    const storage = setupAsyncStorageMock();
    const service = require('../src/services/sessionService');
    const { useSessionStore } = require('../src/store/useSessionStore');
    await useSessionStore.getState().hydrate('userA');

    const syncedSummary = (activityMode: 'hiking' | 'running', startedAt: number) => ({
      activityMode, startedAt, endedAt: startedAt + 10, durationS: 10, distanceM: 30,
    });
    // Production markSynced can legally upsert summaries without clientActivityId.
    await useSessionStore.getState().markSynced(
      'id-only-a', 101, syncedSummary('hiking', 1), 'userA',
    );
    await useSessionStore.getState().markSynced(
      'id-only-b', 102, syncedSummary('running', 20), 'userA',
    );
    await useSessionStore.getState().addSession({
      id: 'explicit-client', clientActivityId: 'explicit-client', syncState: 'synced',
      activityMode: 'hiking', regionCode: 'nz', startedAt: 40, endedAt: 50,
      durationS: 10, distanceM: 30, elevationGainM: 0, trackPoints: [], markerIds: [],
    });

    const beforeState = useSessionStore.getState().sessions;
    const beforeBytes = storage.cairn_sessions_userA;
    await expect(useSessionStore.getState().deleteSession('never-existing')).resolves.toEqual({
      remoteState: 'deleted',
    });

    expect(useSessionStore.getState().sessions).toBe(beforeState);
    expect(useSessionStore.getState().sessions.map((item: { id: string }) => item.id).sort()).toEqual([
      'explicit-client', 'id-only-a', 'id-only-b',
    ]);
    expect(storage.cairn_sessions_userA).toBe(beforeBytes);
    expect(service.deleteRemoteSessionByClientId).not.toHaveBeenCalled();
    expect(service.deleteRemoteSession).not.toHaveBeenCalled();
  });

  it('deletes an explicit alias once and keeps owner-scoped survivors on an awaited repeat', async () => {
    const storage = setupAsyncStorageMock();
    const { useSessionStore } = require('../src/store/useSessionStore');
    await useSessionStore.getState().hydrate('userB');
    await useSessionStore.getState().markSynced('owner-b-id-only', 201, {
      activityMode: 'running', startedAt: 1, endedAt: 2, distanceM: 10,
    }, 'userB');
    const ownerBBytes = storage.cairn_sessions_userB;

    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().markSynced('survivor-id-only', 202, {
      activityMode: 'hiking', startedAt: 3, endedAt: 4, distanceM: 20,
    }, 'userA');
    await useSessionStore.getState().addSession({
      id: '42', clientActivityId: 'target-client', remoteId: 42, syncState: 'synced',
      activityMode: 'hiking', regionCode: 'nz', startedAt: 5, endedAt: 6,
      durationS: 1, distanceM: 30, elevationGainM: 0,
      trackPoints: [{ lat: -41, lng: 174, t: 5 }], markerIds: [],
    });

    await expect(useSessionStore.getState().deleteSession('target-client')).resolves.toEqual({
      remoteState: 'deleted',
    });
    expect(useSessionStore.getState().sessions.map((item: { id: string }) => item.id)).toEqual([
      'survivor-id-only',
    ]);
    expect(storage['cairn_trackpoints_userA_42']).toBeUndefined();
    const afterFirstDeleteBytes = storage.cairn_sessions_userA;

    await expect(useSessionStore.getState().deleteSession('target-client')).resolves.toEqual({
      remoteState: 'deleted',
    });
    expect(storage.cairn_sessions_userA).toBe(afterFirstDeleteBytes);
    const persistedSurvivors = JSON.parse(storage.cairn_sessions_userA);
    expect(persistedSurvivors).toEqual([expect.objectContaining({ id: 'survivor-id-only' })]);
    expect(persistedSurvivors[0].clientActivityId).toBeUndefined();
    expect(storage.cairn_sessions_userB).toBe(ownerBBytes);
    await useSessionStore.getState().hydrate('userB');
    expect(useSessionStore.getState().sessions).toEqual([expect.objectContaining({ id: 'owner-b-id-only' })]);
    expect(useSessionStore.getState().sessions[0].clientActivityId).toBeUndefined();
  });

  it('retries after strict track cleanup failure without collateral summary, track, Memory, or owner loss', async () => {
    const targetTrackKey = 'cairn_trackpoints_userA_retry-target';
    const storage = setupAsyncStorageMock({ failRemoveOnceForKey: targetTrackKey });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = require('../src/services/sessionService');
    const pending = require('../src/services/pendingSyncStore');
    const { useSessionStore } = require('../src/store/useSessionStore');
    const AsyncStorage = require('@react-native-async-storage/async-storage');

    await useSessionStore.getState().hydrate('userB');
    await useSessionStore.getState().addSession({
      id: 'owner-b-track', clientActivityId: 'owner-b-track', syncState: 'synced',
      activityMode: 'running', regionCode: 'nz', startedAt: 1, endedAt: 2,
      durationS: 1, distanceM: 10, elevationGainM: 0,
      trackPoints: [{ lat: -42, lng: 173, t: 1 }], markerIds: [],
    });
    const ownerBBytes = storage.cairn_sessions_userB;
    const ownerBTrackBytes = storage['cairn_trackpoints_userB_owner-b-track'];

    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'survivor-track', clientActivityId: 'survivor-track', syncState: 'synced',
      activityMode: 'hiking', regionCode: 'nz', startedAt: 3, endedAt: 4,
      durationS: 1, distanceM: 20, elevationGainM: 0,
      trackPoints: [{ lat: -41.1, lng: 174.1, t: 3 }], markerIds: [],
    });
    await useSessionStore.getState().addSession({
      id: 'retry-target', clientActivityId: 'retry-target', remoteId: 303, syncState: 'synced',
      activityMode: 'hiking', regionCode: 'nz', startedAt: 5, endedAt: 6,
      durationS: 1, distanceM: 30, elevationGainM: 0,
      trackPoints: [{ lat: -41.2, lng: 174.2, t: 5 }], markerIds: [],
    });
    await AsyncStorage.setItem('cairn_memory_hydrate_state_v2:userA', 'memory-authority-unchanged');

    await expect(useSessionStore.getState().deleteSession('retry-target')).rejects.toThrow(
      'injected_track_cleanup_failure',
    );
    expect(useSessionStore.getState().sessions).toEqual([
      expect.objectContaining({ id: 'survivor-track' }),
    ]);
    expect(JSON.parse(storage.cairn_sessions_userA)).toEqual([
      expect.objectContaining({ id: 'survivor-track' }),
    ]);
    expect(storage[targetTrackKey]).toBeDefined();
    expect(storage['cairn_trackpoints_userA_survivor-track']).toBeDefined();
    expect(service.deleteRemoteSessionByClientId).not.toHaveBeenCalled();

    await expect(useSessionStore.getState().deleteSession('retry-target')).resolves.toEqual({
      remoteState: 'deleted',
    });
    expect(storage[targetTrackKey]).toBeUndefined();
    expect(storage['cairn_trackpoints_userA_survivor-track']).toBeDefined();
    expect(storage['cairn_memory_hydrate_state_v2:userA']).toBe('memory-authority-unchanged');
    expect(storage.cairn_sessions_userB).toBe(ownerBBytes);
    expect(storage['cairn_trackpoints_userB_owner-b-track']).toBe(ownerBTrackBytes);
    expect(pending.removePending).toHaveBeenCalledTimes(2);
    expect(service.deleteRemoteSessionByClientId).toHaveBeenCalledTimes(1);
    expect(service.deleteRemoteSessionByClientId).toHaveBeenCalledWith('retry-target');
    warn.mockRestore();
  });

  it('refuses a late save acknowledgement after the Activity tombstone is durable', async () => {
    const storage = setupAsyncStorageMock();
    const { useSessionStore } = require('../src/store/useSessionStore');
    await useSessionStore.getState().hydrate('userB');
    await useSessionStore.getState().addSession({
      id: 'other-owner', clientActivityId: 'other-owner', syncState: 'synced',
      activityMode: 'running', regionCode: 'nz', startedAt: 1, endedAt: 2,
      durationS: 1, distanceM: 20, elevationGainM: 0, trackPoints: [], markerIds: [],
    });
    await useSessionStore.getState().hydrate('userA');
    await useSessionStore.getState().addSession({
      id: 'late-ack', clientActivityId: 'late-ack', syncState: 'pending',
      activityMode: 'hiking', regionCode: 'nz', startedAt: 1, endedAt: 2,
      durationS: 1, distanceM: 30, elevationGainM: 0, trackPoints: [], markerIds: [],
    });
    await useSessionStore.getState().deleteSession('late-ack');

    await expect(useSessionStore.getState().markSynced('late-ack', 91, {
      activityMode: 'hiking', startedAt: 1, endedAt: 2, distanceM: 30,
    }, 'userA')).resolves.toBe(false);
    expect(useSessionStore.getState().sessions).toEqual([]);
    expect(JSON.parse(storage.cairn_sessions_userA)).toEqual([]);
    await useSessionStore.getState().hydrate('userB');
    expect(useSessionStore.getState().sessions).toEqual([
      expect.objectContaining({ id: 'other-owner', clientActivityId: 'other-owner' }),
    ]);
  });
});
