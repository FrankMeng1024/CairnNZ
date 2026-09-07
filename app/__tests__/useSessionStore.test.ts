/**
 * useSessionStore.test — verify per-user session isolation.
 * Critical privacy regression test: User A's sessions must NOT leak to User B.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const setupAsyncStorageMock = () => {
  const store: Record<string, string> = {};
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
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

  it('never evicts pending local-authoritative Activities at the 100-item history cap', async () => {
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
    for (let index = 0; index < 105; index += 1) {
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
    expect(sessions).toHaveLength(101);
    expect(sessions.some((session: { id: string }) => session.id === 'old-pending')).toBe(true);
    expect(JSON.parse(storage.cairn_sessions_userA)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'old-pending', syncState: 'pending' })]),
    );
    expect(storage['cairn_trackpoints_userA_old-pending']).toBeDefined();
  });
});
