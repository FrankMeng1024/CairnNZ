const CACHE_PREFIX = 'cairn:friend-memory-projections:v1:';
const TEST_VIEWPORT = {
  bbox: [174.6, -41.4, 174.9, -41.1] as [number, number, number, number],
  key: 'test-viewport',
};

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

  test('never hydrates durable Friend geometry and retires the legacy payload', async () => {
    let now = 1_000_100;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const values = new Map([
      [`${CACHE_PREFIX}viewer-a`, persisted('viewer-a', projection())],
      [`${CACHE_PREFIX}signed-out-old-account`, persisted('signed-out-old-account', projection('22'))],
      ['unrelated-key', 'keep'],
    ]);
    const removeItem = jest.fn(async (key: string) => { values.delete(key); });
    const removeItemsStrict = jest.fn(async (keys: string[]) => keys.forEach(key => values.delete(key)));
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => values.get(key) ?? null),
        setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
        removeItem,
        getAllKeysStrict: jest.fn(async () => [...values.keys()]),
        removeItemsStrict,
      },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    expect(useFriendMemoryStore.getState().projections).toEqual({});
    expect(useFriendMemoryStore.getState().getVisibleCells()).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(removeItem).not.toHaveBeenCalled();
    expect(removeItemsStrict).toHaveBeenCalledWith([
      `${CACHE_PREFIX}viewer-a`,
      `${CACHE_PREFIX}signed-out-old-account`,
    ]);
    expect(values.has(`${CACHE_PREFIX}viewer-a`)).toBe(false);
    expect(values.has(`${CACHE_PREFIX}signed-out-old-account`)).toBe(false);
    expect(values.get('unrelated-key')).toBe('keep');

    now = 1_000_000 + 24 * 60 * 60 * 1000 + 1;
    expect(useFriendMemoryStore.getState().getVisibleCells()).toEqual([]);
    expect(useFriendMemoryStore.getState().projections).toEqual({});
  });

  test('a routine sources refresh preserves an unexpired proof if the subscriptions read fails', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    let releaseSubscriptions!: (value: any) => void;
    let releaseSources!: (value: any) => void;
    const authenticatedFetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          revoked_friend_ids: [],
          projections: [{
            source_friend_id: 11,
            authorization_version: 4,
            projection_version: 'fresh-4',
            cell_size_m: 200,
            server_authorized_at: new Date(1_000_000).toISOString(),
            authorization_expires_at: new Date(1_000_000 + 86_400_000).toISOString(),
            cells: projection().cells,
            regions: [],
          }],
        }),
      })
      .mockImplementationOnce(() => new Promise(resolve => { releaseSubscriptions = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseSources = resolve; }));
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const { useMemorySubscriptionsStore } = require('../store/useMemorySubscriptionsStore');
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 11, friend_name: 'Mia' }],
      availableSources: [{
        friend_id: '11', friend_name: 'Mia', selected: true,
        authorization_version: 4, effective_at: new Date(0).toISOString(),
        sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
      }],
    });
    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    expect(useFriendMemoryStore.getState().getVisibleCells()).toHaveLength(1);

    const refresh = useMemorySubscriptionsStore.getState().load();
    expect(useFriendMemoryStore.getState().getVisibleCells()).toHaveLength(1);
    releaseSubscriptions({ ok: false, status: 503 });
    releaseSources({ ok: false, status: 503, json: async () => ({}) });
    await refresh;

    expect(useMemorySubscriptionsStore.getState().error).toContain('HTTP 503');
    expect(useFriendMemoryStore.getState().getVisibleCells()).toHaveLength(1);
  });

  test('a successful sources authority revokes geometry even if the subscriptions read fails', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const authenticatedFetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          revoked_friend_ids: [],
          projections: [{
            source_friend_id: 11,
            authorization_version: 4,
            projection_version: 'fresh-4',
            cell_size_m: 200,
            server_authorized_at: new Date(1_000_000).toISOString(),
            authorization_expires_at: new Date(1_000_000 + 86_400_000).toISOString(),
            cells: projection().cells,
            regions: [],
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sources: [] }) });
    jest.doMock('../../../store/storage', () => ({
      storage: { removeItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const { useMemorySubscriptionsStore } = require('../store/useMemorySubscriptionsStore');
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 11, friend_name: 'Mia' }],
      availableSources: [{
        friend_id: '11', friend_name: 'Mia', selected: true,
        authorization_version: 4, effective_at: new Date(0).toISOString(),
        sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
      }],
    });
    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    expect(useFriendMemoryStore.getState().getVisibleCells()).toHaveLength(1);

    await useMemorySubscriptionsStore.getState().load();
    expect(useFriendMemoryStore.getState().getVisibleCells()).toEqual([]);
    expect(useFriendMemoryStore.getState().authorizedSourceVersions).toEqual({});
  });

  test('a half-open Friends projection request times out into a truthful error state', async () => {
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>(resolve => { markFetchStarted = resolve; });
    const authenticatedFetch = jest.fn((_path: string, options: RequestInit) => new Promise((_resolve, reject) => {
      markFetchStarted();
      options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));

    const { useFriendMemoryStore, FRIEND_MEMORY_PROJECTION_TIMEOUT_MS } = require('../store/useFriendMemoryStore');
    const { useMemorySubscriptionsStore } = require('../store/useMemorySubscriptionsStore');
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 11, friend_name: 'Mia' }],
      availableSources: [{
        friend_id: '11', friend_name: 'Mia', selected: true,
        authorization_version: 4, effective_at: new Date(0).toISOString(),
        sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
      }],
    });
    const pending = useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    await fetchStarted;
    expect(useFriendMemoryStore.getState().sourceStates['11']?.status).toBe('loading');
    await jest.advanceTimersByTimeAsync(FRIEND_MEMORY_PROJECTION_TIMEOUT_MS + 1);
    await pending;
    expect(useFriendMemoryStore.getState().loading).toBe(false);
    expect(useFriendMemoryStore.getState().sourceStates['11']).toMatchObject({
      status: 'error', error: 'Friend Memory timed out',
    });
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toEqual([]);
    jest.useRealTimers();
  });

  test.each([
    {
      label: 'invalid JSON',
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
      stage: 'decode',
      causeCode: 'SyntaxError',
    },
    {
      label: 'schema-invalid JSON',
      json: async () => ({ projections: 'not-an-array' }),
      stage: 'validate',
      causeCode: 'INVALID_SCHEMA',
    },
  ])('HTTP 200 $label is a terminal payload failure, never offline', async ({ json, stage, causeCode }) => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const authenticatedFetch = jest.fn(async () => ({ ok: true, status: 200, json }));
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const { useMemorySubscriptionsStore } = require('../store/useMemorySubscriptionsStore');
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 11, friend_name: 'Mia' }],
      availableSources: [{
        friend_id: '11', friend_name: 'Mia', selected: true,
        authorization_version: 4, effective_at: new Date(0).toISOString(),
        sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
      }],
    });

    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);

    expect(useFriendMemoryStore.getState()).toMatchObject({
      loading: false,
      error: 'unavailable',
      sourceStates: { '11': { status: 'error', cellCount: 0 } },
      lastFailure: {
        kind: 'payload',
        operation: 'friend-coverage',
        stage,
        httpStatus: 200,
        causeCode,
      },
    });
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

  test('a verified session geometry is fenced and cannot reappear after a wall-clock rollback', async () => {
    let now = 1_000_100;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const appState = { user: { id: 'viewer-a' } };
    const authenticatedFetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        revoked_friend_ids: [],
        projections: [{
          source_friend_id: 11,
          authorization_version: 4,
          projection_version: 'geometry-4',
          cell_size_m: 200,
          server_authorized_at: new Date(1_000_000).toISOString(),
          authorization_expires_at: new Date(1_000_000 + 86_400_000).toISOString(),
          cells: [],
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[[[174.7, -41.3], [174.8, -41.3], [174.8, -41.2], [174.7, -41.2], [174.7, -41.3]]]],
          },
          regions: [],
        }],
      }),
    }));
    jest.doMock('../../../store/storage', () => ({
      storage: { removeItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const { useMemorySubscriptionsStore } = require('../store/useMemorySubscriptionsStore');
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 11, friend_name: 'Mia' }],
      availableSources: [{
        friend_id: '11', friend_name: 'Mia', selected: true,
        authorization_version: 4, effective_at: new Date(0).toISOString(),
        sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
      }],
    });
    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);

    now = 999_000;
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toEqual([]);
    expect(useFriendMemoryStore.getState().projections).toEqual({});
    expect(useFriendMemoryStore.getState().authorizedSourceVersions).toEqual({});
    now = 1_000_100;
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toEqual([]);
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  });

  test('retry clears a stale source error when the retained authorized projection is reusable', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const subscriptionState = {
      subscriptions: [{ friend_id: 11 }],
      availableSources: [{ friend_id: '11', authorization_version: 4 }],
    };
    const authenticatedFetch = jest.fn();
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => null), removeItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => subscriptionState },
    }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const retained = { ...projection(), viewportKey: TEST_VIEWPORT.key, regions: [] };
    useFriendMemoryStore.setState({
      userId: 'viewer-a',
      projections: { '11': retained },
      sourceStates: { '11': { status: 'error', cellCount: 1, error: 'Unavailable' } },
      error: 'offline',
      lastObservedWallClockMs: Date.now(),
    });
    await useFriendMemoryStore.getState().reconcileAuthorizedSources([{
      friend_id: 11, authorization_version: 4, selected: true,
    }]);

    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);

    expect(authenticatedFetch).not.toHaveBeenCalled();
    expect(useFriendMemoryStore.getState().sourceStates['11']).toEqual({
      status: 'loaded', cellCount: 1,
    });
    expect(useFriendMemoryStore.getState().error).toBeNull();
    expect(useFriendMemoryStore.getState().getVisibleCells()).toHaveLength(1);
  });

  test('an account switch never restores either account durable Friend geometry', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const viewerA = projection('11');
    const viewerB = projection('22');
    const values = new Map([
      [`${CACHE_PREFIX}viewer-a`, persisted('viewer-a', viewerA)],
      [`${CACHE_PREFIX}viewer-b`, persisted('viewer-b', viewerB)],
    ]);
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => values.get(key) ?? null),
        setItem: jest.fn(async () => undefined),
        removeItem: jest.fn(async (key: string) => { values.delete(key); }),
      },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().hydrate('viewer-b');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(useFriendMemoryStore.getState().userId).toBe('viewer-b');
    expect(useFriendMemoryStore.getState().projections).toEqual({});
    expect(values.size).toBe(0);
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
    const oldLoad = useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
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
    const values = new Map<string, string>([[`${CACHE_PREFIX}viewer-a`, persisted('viewer-a', projection())]]);
    const setItem = jest.fn(async (key: string, value: string) => { values.set(key, value); });
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => values.get(key) ?? null),
        setItem,
        removeItem: jest.fn(async (key: string) => { values.delete(key); }),
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
    const pending = useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
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
    expect(values.has(`${CACHE_PREFIX}viewer-a`)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
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
    const first = useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    while (deferred.length < 1) await Promise.resolve();
    const second = useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    while (deferred.length < 2) await Promise.resolve();
    deferred[1].resolve(body('newer-request'));
    await second;
    deferred[0].resolve(body('older-request'));
    await first;

    expect(useFriendMemoryStore.getState().projections['11'].projectionVersion).toBe('newer-request');
  });

  test('loads and purges remain session-only and relaunch cannot restore borrowed geometry', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const subscriptionState = {
      subscriptions: [{ friend_id: 11 }],
      availableSources: [{ friend_id: '11', authorization_version: 4 }],
    };
    const values = new Map<string, string>();
    values.set(`${CACHE_PREFIX}viewer-a`, persisted('viewer-a', projection()));
    const setItem = jest.fn(async (key: string, value: string) => { values.set(key, value); });
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => values.get(key) ?? null),
        setItem,
        removeItem: jest.fn(async (key: string) => { values.delete(key); }),
      },
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
    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    expect(useFriendMemoryStore.getState().projections['11']).toBeDefined();
    subscriptionState.subscriptions = [];
    await useFriendMemoryStore.getState().purgeFriend('11');

    useFriendMemoryStore.getState().reset();
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await Promise.resolve();
    expect(useFriendMemoryStore.getState().projections).toEqual({});
    expect(values.has(`${CACHE_PREFIX}viewer-a`)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  test('one contributor failure is isolated while another contributor remains loaded and visible', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const subscriptionState = {
      subscriptions: [{ friend_id: 11 }, { friend_id: 22 }],
      availableSources: [
        { friend_id: '11', authorization_version: 4 },
        { friend_id: '22', authorization_version: 7 },
      ],
    };
    const authenticatedFetch = jest.fn(async (_path: string, init: { body: string }) => {
      const friendId = JSON.parse(init.body).friend_ids[0];
      if (friendId === 11) return { ok: false, status: 503, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          revoked_friend_ids: [],
          projections: [{
            source_friend_id: 22,
            authorization_version: 7,
            projection_version: 'friend-22-ok',
            cell_size_m: 200,
            server_authorized_at: new Date(1_000_000).toISOString(),
            authorization_expires_at: new Date(1_000_000 + 24 * 60 * 60 * 1000).toISOString(),
            cells: projection('22').cells,
            regions: [],
          }],
        }),
      };
    });
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => subscriptionState },
    }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);

    expect(useFriendMemoryStore.getState().sourceStates).toMatchObject({
      '11': { status: 'error', cellCount: 0 },
      '22': { status: 'loaded', cellCount: 1 },
    });
    expect(Object.keys(useFriendMemoryStore.getState().projections)).toEqual(['22']);
    expect(useFriendMemoryStore.getState().getVisibleCells()).toHaveLength(1);
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
    // Projection loads are intentionally isolated per contributor so one
    // failed friend cannot suppress another. Supply one response per source.
    responses.push(makeResponse([{ id: 11, auth: 4, version: 'a-1' }]));
    responses.push(makeResponse([{ id: 22, auth: 7, version: 'b-1' }]));
    responses.push(makeResponse([{ id: 11, auth: 4, version: 'a-2' }]));
    responses.push(makeResponse([{ id: 22, auth: 7, version: 'b-2' }]));
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => subscriptionState },
    }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    subscriptionState.subscriptions = [{ friend_id: 22 }];
    await useFriendMemoryStore.getState().purgeFriend(11);
    expect(Object.keys(useFriendMemoryStore.getState().projections)).toEqual(['22']);

    subscriptionState.subscriptions = [{ friend_id: 11 }, { friend_id: 22 }];
    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    expect(useFriendMemoryStore.getState().projections['11'].projectionVersion).toBe('a-2');
    expect(useFriendMemoryStore.getState().projections['22'].projectionVersion).toBe('b-1');
    expect(authenticatedFetch).toHaveBeenCalledTimes(3);
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
    const stale = useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    while (deferred.length < 1) await Promise.resolve();
    await useFriendMemoryStore.getState().purgeFriend('11');
    // Selection is intentionally still present: server revoke/block state can
    // arrive before the subscriptions refresh. The source generation is the
    // ordering fence, not a coincidental UI selection update.
    deferred[0].resolve(response(4, 'revoked-late'));
    await stale;
    expect(useFriendMemoryStore.getState().projections).toEqual({});

    subscriptionState.availableSources = [{ friend_id: '11', authorization_version: 5 }];
    const fresh = useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    while (deferred.length < 2) await Promise.resolve();
    deferred[1].resolve(response(5, 'fresh-after-new-grant'));
    await fresh;
    expect(useFriendMemoryStore.getState().projections['11']).toMatchObject({
      authorizationVersion: 5,
      projectionVersion: 'fresh-after-new-grant',
    });
  });
});
