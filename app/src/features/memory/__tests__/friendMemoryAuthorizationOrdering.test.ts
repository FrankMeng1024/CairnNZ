const CACHE_PREFIX = 'cairn:friend-memory-projections:v1:';

function projection(friendId = '11', authorizedAt = 1_000_000) {
  return {
    friendId,
    authorizationVersion: 4,
    projectionVersion: 'projection-4',
    cellSizeM: 200,
    cells: [{ id: 'coarse-cell', polygon: [[174.7, -41.3], [174.8, -41.3], [174.8, -41.2], [174.7, -41.2], [174.7, -41.3]] }],
    serverAuthorizedAtMs: authorizedAt,
    authorizationExpiresAtMs: authorizedAt + 24 * 60 * 60 * 1000,
  };
}

function persisted(userId: string, value: ReturnType<typeof projection>, savedAtMs = 1_000_000) {
  return JSON.stringify({
    v: 1,
    userId,
    savedAtMs,
    lastObservedWallClockMs: savedAtMs,
    projections: { [value.friendId]: value },
  });
}

describe('friend Memory authorization cache ordering', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('accepts an account-scoped projection only until its server-bounded expiry', async () => {
    let now = 1_000_100;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const values = new Map([[`${CACHE_PREFIX}viewer-a`, persisted('viewer-a', projection())]]);
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => values.get(key) ?? null),
        setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
      },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    expect(useFriendMemoryStore.getState().getVisibleCells()).toHaveLength(1);

    now = 1_000_000 + 24 * 60 * 60 * 1000 + 1;
    expect(useFriendMemoryStore.getState().getVisibleCells()).toEqual([]);
    expect(useFriendMemoryStore.getState().projections).toEqual({});
  });

  test('fails closed when the wall clock moves behind the last observed server cache time', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(999_000);
    const value = projection();
    const cache = persisted('viewer-a', value, 1_000_000);
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async () => cache),
        setItem: jest.fn(async () => undefined),
      },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    expect(useFriendMemoryStore.getState().userId).toBe('viewer-a');
    expect(useFriendMemoryStore.getState().projections).toEqual({});
    expect(useFriendMemoryStore.getState().getVisibleCells()).toEqual([]);
  });

  test('drops a slower prior-account hydration after a newer account switch', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    let releaseViewerA!: (value: string) => void;
    const viewerARead = new Promise<string>(resolve => { releaseViewerA = resolve; });
    const viewerA = projection('11');
    const viewerB = projection('22');
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn((key: string) => {
          if (key === `${CACHE_PREFIX}viewer-a`) return viewerARead;
          return Promise.resolve(persisted('viewer-b', viewerB));
        }),
        setItem: jest.fn(async () => undefined),
      },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const slow = useFriendMemoryStore.getState().hydrate('viewer-a');
    const fast = useFriendMemoryStore.getState().hydrate('viewer-b');
    await fast;
    releaseViewerA(persisted('viewer-a', viewerA));
    await slow;

    expect(useFriendMemoryStore.getState().userId).toBe('viewer-b');
    expect(Object.keys(useFriendMemoryStore.getState().projections)).toEqual(['22']);
  });

  test('an old-account network response cannot populate or strand the new account cache', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState: { user: { id: string } } = { user: { id: 'viewer-a' } };
    let releaseResponse!: (value: any) => void;
    const response = new Promise(resolve => { releaseResponse = resolve; });
    const authenticatedFetch = jest.fn(() => response);
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async () => null),
        setItem: jest.fn(async () => undefined),
      },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => appState },
    }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => ({ subscriptions: [{ friend_id: 11 }] }) },
    }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const oldLoad = useFriendMemoryStore.getState().loadSelectedProjections();
    await Promise.resolve();
    appState.user = { id: 'viewer-b' };
    await useFriendMemoryStore.getState().hydrate('viewer-b');
    releaseResponse({
      ok: true,
      json: async () => ({
        revoked_friend_ids: [],
        projections: [{
          source_friend_id: 11,
          authorization_version: 4,
          projection_version: 'stale-a',
          cell_size_m: 200,
          server_authorized_at: new Date(1_000_000).toISOString(),
          authorization_expires_at: new Date(1_000_000 + 24 * 60 * 60 * 1000).toISOString(),
          cells: projection().cells,
        }],
      }),
    });
    await oldLoad;

    expect(useFriendMemoryStore.getState().userId).toBe('viewer-b');
    expect(useFriendMemoryStore.getState().projections).toEqual({});
    expect(useFriendMemoryStore.getState().loading).toBe(false);
  });

  test('a deselect and purge while loading fences the earlier same-account response', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState: { user: { id: string } } = { user: { id: 'viewer-a' } };
    const subscriptionState: { subscriptions: Array<{ friend_id: number }> } = {
      subscriptions: [{ friend_id: 11 }],
    };
    let releaseResponse!: (value: any) => void;
    const response = new Promise(resolve => { releaseResponse = resolve; });
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>(resolve => { markFetchStarted = resolve; });
    const values = new Map<string, string>();
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => values.get(key) ?? null),
        setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
      },
    }));
    jest.doMock('../../../services/apiService', () => ({
      authenticatedFetch: jest.fn(() => {
        markFetchStarted();
        return response;
      }),
    }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => appState },
    }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => subscriptionState },
    }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const pending = useFriendMemoryStore.getState().loadSelectedProjections();
    await fetchStarted;
    subscriptionState.subscriptions = [];
    await useFriendMemoryStore.getState().purgeFriend('11');
    releaseResponse({
      ok: true,
      json: async () => ({
        revoked_friend_ids: [],
        projections: [{
          source_friend_id: 11,
          authorization_version: 4,
          projection_version: 'late-projection',
          cell_size_m: 200,
          server_authorized_at: new Date(1_000_000).toISOString(),
          authorization_expires_at: new Date(1_000_000 + 24 * 60 * 60 * 1000).toISOString(),
          cells: projection().cells,
        }],
      }),
    });
    await pending;

    expect(useFriendMemoryStore.getState().projections).toEqual({});
    const persistedAfterRace = JSON.parse(values.get(`${CACHE_PREFIX}viewer-a`) ?? '{}');
    expect(persistedAfterRace.projections ?? {}).toEqual({});
  });

  test('two same-source reads resolving out of order retain only the later request', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const subscriptions = [{ friend_id: 11 }];
    const deferred: Array<{ resolve: (value: any) => void }> = [];
    const authenticatedFetch = jest.fn(() => new Promise(resolve => deferred.push({ resolve })));
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: {
        getState: () => ({ subscriptions, availableSources: [{ friend_id: '11', authorization_version: 4 }] }),
      },
    }));
    const body = (version: string) => ({
      ok: true,
      json: async () => ({
        revoked_friend_ids: [],
        projections: [{
          source_friend_id: 11,
          authorization_version: 4,
          projection_version: version,
          cell_size_m: 200,
          server_authorized_at: new Date(1_000_000).toISOString(),
          authorization_expires_at: new Date(1_000_000 + 24 * 60 * 60 * 1000).toISOString(),
          cells: projection().cells,
        }],
      }),
    });

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const first = useFriendMemoryStore.getState().loadSelectedProjections();
    while (deferred.length < 1) await Promise.resolve();
    const second = useFriendMemoryStore.getState().loadSelectedProjections();
    while (deferred.length < 2) await Promise.resolve();
    deferred[1].resolve(body('newer-request'));
    await second;
    deferred[0].resolve(body('older-request'));
    await first;

    expect(useFriendMemoryStore.getState().projections['11'].projectionVersion).toBe('newer-request');
  });

  test('a purge ordered behind a slow cache write wins durably and survives relaunch hydration', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const subscriptionState = {
      subscriptions: [{ friend_id: 11 }],
      availableSources: [{ friend_id: '11', authorization_version: 4 }],
    };
    const values = new Map<string, string>();
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>(resolve => { releaseFirstWrite = resolve; });
    let writeCount = 0;
    const setItem = jest.fn(async (key: string, value: string) => {
      writeCount += 1;
      if (writeCount === 1) await firstWriteGate;
      values.set(key, value);
    });
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async (key: string) => values.get(key) ?? null), setItem },
    }));
    jest.doMock('../../../services/apiService', () => ({
      authenticatedFetch: jest.fn(async () => ({
        ok: true,
        json: async () => ({
          revoked_friend_ids: [],
          projections: [{
            source_friend_id: 11,
            authorization_version: 4,
            projection_version: 'about-to-be-purged',
            cell_size_m: 200,
            server_authorized_at: new Date(1_000_000).toISOString(),
            authorization_expires_at: new Date(1_000_000 + 24 * 60 * 60 * 1000).toISOString(),
            cells: projection().cells,
          }],
        }),
      })),
    }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => subscriptionState },
    }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const load = useFriendMemoryStore.getState().loadSelectedProjections();
    while (setItem.mock.calls.length < 1) await Promise.resolve();
    subscriptionState.subscriptions = [];
    const purge = useFriendMemoryStore.getState().purgeFriend('11');
    releaseFirstWrite();
    await Promise.all([load, purge]);

    useFriendMemoryStore.getState().reset();
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    expect(useFriendMemoryStore.getState().projections).toEqual({});
    expect(JSON.parse(values.get(`${CACHE_PREFIX}viewer-a`) ?? '{}').projections).toEqual({});
  });

  test('a valid deliberate reselection starts a fresh source generation without harming other sources', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const subscriptionState = {
      subscriptions: [{ friend_id: 11 }, { friend_id: 22 }],
      availableSources: [
        { friend_id: '11', authorization_version: 4 },
        { friend_id: '22', authorization_version: 7 },
      ],
    };
    const responses: any[] = [];
    const authenticatedFetch = jest.fn(async () => responses.shift());
    const makeResponse = (items: Array<{ id: number; auth: number; version: string }>) => ({
      ok: true,
      json: async () => ({
        revoked_friend_ids: [],
        projections: items.map(item => ({
          source_friend_id: item.id,
          authorization_version: item.auth,
          projection_version: item.version,
          cell_size_m: 200,
          server_authorized_at: new Date(1_000_000).toISOString(),
          authorization_expires_at: new Date(1_000_000 + 24 * 60 * 60 * 1000).toISOString(),
          cells: projection(String(item.id)).cells,
        })),
      }),
    });
    responses.push(makeResponse([{ id: 11, auth: 4, version: 'a-1' }, { id: 22, auth: 7, version: 'b-1' }]));
    responses.push(makeResponse([{ id: 11, auth: 4, version: 'a-2' }, { id: 22, auth: 7, version: 'b-2' }]));
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => subscriptionState },
    }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    subscriptionState.subscriptions = [{ friend_id: 22 }];
    await useFriendMemoryStore.getState().purgeFriend(11);
    expect(Object.keys(useFriendMemoryStore.getState().projections)).toEqual(['22']);

    subscriptionState.subscriptions = [{ friend_id: 11 }, { friend_id: 22 }];
    await useFriendMemoryStore.getState().loadSelectedProjections();
    expect(useFriendMemoryStore.getState().projections['11'].projectionVersion).toBe('a-2');
    expect(useFriendMemoryStore.getState().projections['22'].projectionVersion).toBe('b-2');
  });

  test('revoke or block purge fences an in-flight source even before selection state catches up', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const subscriptionState = {
      subscriptions: [{ friend_id: 11 }],
      availableSources: [{ friend_id: '11', authorization_version: 4 }],
    };
    const deferred: Array<{ resolve: (value: any) => void }> = [];
    const authenticatedFetch = jest.fn(() => new Promise(resolve => deferred.push({ resolve })));
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => subscriptionState },
    }));
    const response = (auth: number, version: string) => ({
      ok: true,
      json: async () => ({
        revoked_friend_ids: [],
        projections: [{
          source_friend_id: 11,
          authorization_version: auth,
          projection_version: version,
          cell_size_m: 200,
          server_authorized_at: new Date(1_000_000).toISOString(),
          authorization_expires_at: new Date(1_000_000 + 24 * 60 * 60 * 1000).toISOString(),
          cells: projection().cells,
        }],
      }),
    });

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const stale = useFriendMemoryStore.getState().loadSelectedProjections();
    while (deferred.length < 1) await Promise.resolve();
    await useFriendMemoryStore.getState().purgeFriend('11');
    // Selection is intentionally still present: server revoke/block state can
    // arrive before the subscriptions refresh. The source generation is the
    // ordering fence, not a coincidental UI selection update.
    deferred[0].resolve(response(4, 'revoked-late'));
    await stale;
    expect(useFriendMemoryStore.getState().projections).toEqual({});

    subscriptionState.availableSources = [{ friend_id: '11', authorization_version: 5 }];
    const fresh = useFriendMemoryStore.getState().loadSelectedProjections();
    while (deferred.length < 2) await Promise.resolve();
    deferred[1].resolve(response(5, 'fresh-after-new-grant'));
    await fresh;
    expect(useFriendMemoryStore.getState().projections['11']).toMatchObject({
      authorizationVersion: 5,
      projectionVersion: 'fresh-after-new-grant',
    });
  });
});
