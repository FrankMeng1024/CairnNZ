const CACHE_PREFIX = 'cairn:friend-memory-projections:v1:';
const TEST_VIEWPORT = {
  bbox: [174.6, -41.4, 174.9, -41.1] as [number, number, number, number],
  key: 'test-viewport',
};

function projection(friendId = '11', authorizedAt = 1_000_000) {
  return {
    friendId,
    authorizationVersion: 4,
    grantEpoch: `grant-${friendId}`,
    friendshipEpisodeId: `episode-${friendId}`,
    coverageScope: 'full_history_delayed_v1' as const,
    projectionVersion: 'projection-4',
    cellSizeM: 200,
    cells: [{ id: 'coarse-cell', polygon: [[174.7, -41.3], [174.8, -41.3], [174.8, -41.2], [174.7, -41.2], [174.7, -41.3]] }],
    serverAuthorizedAtMs: authorizedAt,
    authorizationExpiresAtMs: authorizedAt + 24 * 60 * 60 * 1000,
  };
}

function snapshotResponse(
  friendId = 11,
  authorizationVersion = 4,
  snapshotId = `snapshot-${friendId}`,
) {
  const now = Date.now();
  const ring = projection(String(friendId)).cells[0].polygon;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      revoked_friend_ids: [],
      projections: [{
        source_friend_id: friendId,
        authorization_version: authorizationVersion,
        grant_epoch: `grant-${friendId}`,
        friendship_episode_id: `episode-${friendId}`,
        coverage_scope: 'full_history_delayed_v1',
        server_authorized_at: new Date(now - 100).toISOString(),
        authorization_expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
        manifest: {
          snapshot_id: snapshotId,
          dataset_revision: snapshotId,
          coverage_rule_version: 4,
          as_of: new Date(now).toISOString(),
          expected_pages: 1,
          expected_tiles: 1,
          expected_evidence_count: 1,
          regions: [],
          complete: false,
        },
        page: {
          snapshot_id: snapshotId,
          page_index: 0,
          tiles: [{
            id: `tile-${friendId}`,
            bbox: [174.6, -41.4, 174.9, -41.1],
            evidence_count: 1,
            geometry_sha256: `sha-${snapshotId}`,
            geometry: { type: 'MultiPolygon', coordinates: [[ring]] },
          }],
          next_cursor: null,
          complete: true,
        },
      }],
    }),
  };
}

function pagedSnapshotResponse(input: {
  friendId?: number;
  authorizationVersion?: number;
  pageIndex: number;
  tile: { id: string; bbox: [number, number, number, number]; ring: number[][] };
  nextCursor: string | null;
  expectedPages?: number;
  expectedTiles?: number;
}) {
  const now = Date.now();
  const friendId = input.friendId ?? 11;
  const snapshotId = `snapshot-${friendId}-two-regions`;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      revoked_friend_ids: [],
      projections: [{
        source_friend_id: friendId,
        authorization_version: input.authorizationVersion ?? 4,
        grant_epoch: `grant-${friendId}`,
        friendship_episode_id: `episode-${friendId}`,
        coverage_scope: 'full_history_delayed_v1',
        server_authorized_at: new Date(now - 100).toISOString(),
        authorization_expires_at: new Date(now + 5 * 60 * 1000).toISOString(),
        manifest: {
          snapshot_id: snapshotId,
          dataset_revision: 'dataset-two-regions',
          coverage_rule_version: 4,
          as_of: new Date(now).toISOString(),
          expected_pages: input.expectedPages ?? 2,
          expected_tiles: input.expectedTiles ?? 2,
          expected_evidence_count: input.expectedTiles ?? 2,
          regions: [],
          complete: false,
        },
        page: {
          snapshot_id: snapshotId,
          page_index: input.pageIndex,
          tiles: [{
            id: input.tile.id,
            bbox: input.tile.bbox,
            evidence_count: 1,
            geometry_sha256: `sha-${input.tile.id}`,
            geometry: { type: 'MultiPolygon', coordinates: [[input.tile.ring]] },
          }],
          next_cursor: input.nextCursor,
          complete: input.nextCursor === null,
        },
      }],
    }),
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
      .mockResolvedValueOnce(snapshotResponse(11, 4, 'fresh-4'))
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
    expect(useFriendMemoryStore.getState().getVisibleGeometries(null, TEST_VIEWPORT)).toHaveLength(1);

    const refresh = useMemorySubscriptionsStore.getState().load();
    expect(useFriendMemoryStore.getState().getVisibleGeometries(null, TEST_VIEWPORT)).toHaveLength(1);
    releaseSubscriptions({ ok: false, status: 503 });
    releaseSources({ ok: false, status: 503, json: async () => ({}) });
    await refresh;

    expect(useMemorySubscriptionsStore.getState().error).toContain('HTTP 503');
    expect(useFriendMemoryStore.getState().getVisibleGeometries(null, TEST_VIEWPORT)).toHaveLength(1);
  });

  test('a successful sources authority revokes geometry even if the subscriptions read fails', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const authenticatedFetch = jest.fn()
      .mockResolvedValueOnce(snapshotResponse(11, 4, 'fresh-4'))
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
    expect(useFriendMemoryStore.getState().getVisibleGeometries(null, TEST_VIEWPORT)).toHaveLength(1);

    await useMemorySubscriptionsStore.getState().load();
    expect(useFriendMemoryStore.getState().getVisibleCells()).toEqual([]);
    expect(useFriendMemoryStore.getState().authorizedSourceVersions).toEqual({});
  });

  test('a truncated sources page cannot revoke a valid source omitted from that page', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    jest.doMock('../../../store/storage', () => ({
      storage: { getAllKeysStrict: async () => [], removeItemsStrict: async () => undefined },
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const { useMemorySubscriptionsStore } = require('../store/useMemorySubscriptionsStore');
    const base = projection('11');
    const retained = {
      ...base,
      viewportKey: 'all-authorized', projectionVersion: 'retained', snapshotId: 'retained',
      datasetRevision: 'retained', complete: true, expectedPages: 1, expectedTiles: 1,
      geometry: { type: 'MultiPolygon' as const, coordinates: [[base.cells[0].polygon]] },
      tiles: [], regions: [],
    };
    useMemorySubscriptionsStore.setState({ subscriptions: [{ friend_id: 11, friend_name: 'Mia' }] });
    useFriendMemoryStore.setState({ userId: 'viewer-a', projections: { '11': retained } });

    await useFriendMemoryStore.getState().reconcileAuthorizedSources([], false);

    expect(useFriendMemoryStore.getState().projections['11']).toBe(retained);
    expect(useFriendMemoryStore.getState().authorizedSourceVersions['11']).toBe(4);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
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
      causeCode: 'INVALID_SNAPSHOT_SCHEMA',
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
    const authenticatedFetch = jest.fn(async () => snapshotResponse(11, 4, 'geometry-4'));
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
      availableSources: [{
        friend_id: '11', authorization_version: 4,
        grant_epoch: 'grant-11', friendship_episode_id: 'episode-11',
        coverage_scope: 'full_history_delayed_v1',
      }],
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
    const retainedBase = projection();
    const retained = {
      ...retainedBase,
      viewportKey: 'all-authorized',
      projectionVersion: 'retained-snapshot',
      snapshotId: 'retained-snapshot',
      datasetRevision: '4',
      complete: true,
      expectedPages: 1,
      expectedTiles: 1,
      geometry: { type: 'MultiPolygon' as const, coordinates: [[retainedBase.cells[0].polygon]] },
      tiles: [{
        id: 'retained-tile', bbox: TEST_VIEWPORT.bbox, evidenceCount: 1,
        geometrySha256: 'retained-sha',
        geometry: { type: 'MultiPolygon' as const, coordinates: [[retainedBase.cells[0].polygon]] },
      }],
      regions: [],
    };
    useFriendMemoryStore.setState({
      userId: 'viewer-a',
      projections: { '11': retained },
      sourceStates: { '11': { status: 'error', cellCount: 1, error: 'Unavailable' } },
      error: 'offline',
      lastObservedWallClockMs: Date.now(),
    });
    await useFriendMemoryStore.getState().reconcileAuthorizedSources([{
      friend_id: 11, authorization_version: 4, selected: true,
      grant_epoch: 'grant-11', friendship_episode_id: 'episode-11',
      coverage_scope: 'full_history_delayed_v1',
    }]);

    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);

    expect(authenticatedFetch).not.toHaveBeenCalled();
    expect(useFriendMemoryStore.getState().sourceStates['11']).toEqual({
      status: 'loaded', cellCount: 1,
    });
    expect(useFriendMemoryStore.getState().error).toBeNull();
    expect(useFriendMemoryStore.getState().getVisibleGeometries(null, TEST_VIEWPORT)).toHaveLength(1);
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
    releaseResponse(snapshotResponse(11, 4, 'stale-a'));
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
    releaseResponse(snapshotResponse(11, 4, 'late-projection'));
    await pending;

    expect(useFriendMemoryStore.getState().projections).toEqual({});
    expect(values.has(`${CACHE_PREFIX}viewer-a`)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  test('two retained map screens coalesce one same-source complete-dataset request', async () => {
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
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    const first = useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    while (deferred.length < 1) await Promise.resolve();
    const second = useFriendMemoryStore.getState().loadSelectedProjections(undefined, {
      key: 'distant-second-map', bbox: [168.5, -46, 168.8, -45.7],
    });
    await second;
    expect(deferred).toHaveLength(1);
    deferred[0].resolve(snapshotResponse(11, 4, 'one-complete-dataset'));
    await first;

    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    expect(useFriendMemoryStore.getState().projections['11'].projectionVersion).toBe('one-complete-dataset');
  });

  test('one complete multi-page dataset serves distant cameras without refetching', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const subscriptionState = {
      subscriptions: [{ friend_id: 11 }],
      availableSources: [{ friend_id: '11', authorization_version: 4 }],
    };
    const wellingtonBbox: [number, number, number, number] = [174.6, -41.4, 174.9, -41.1];
    const fiordlandBbox: [number, number, number, number] = [166.8, -46.2, 167.1, -45.9];
    const ringFor = (bbox: [number, number, number, number]) => [
      [bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]],
    ];
    const authenticatedFetch = jest.fn(async (_path: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      return body.cursor
        ? pagedSnapshotResponse({ pageIndex: 1, tile: { id: 'fiordland', bbox: fiordlandBbox, ring: ringFor(fiordlandBbox) }, nextCursor: null })
        : pagedSnapshotResponse({ pageIndex: 0, tile: { id: 'wellington', bbox: wellingtonBbox, ring: ringFor(wellingtonBbox) }, nextCursor: 'page-2' });
    });
    jest.doMock('../../../store/storage', () => ({ storage: { getItem: jest.fn(async () => null), removeItem: jest.fn(async () => undefined) } }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => subscriptionState },
    }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    const distantViewport = { key: 'fiordland', bbox: fiordlandBbox };
    expect(useFriendMemoryStore.getState().projections['11']).toMatchObject({
      complete: true, expectedPages: 2, expectedTiles: 2,
    });
    expect(useFriendMemoryStore.getState().getVisibleGeometries(null, TEST_VIEWPORT)[0].geometry.coordinates).toHaveLength(1);
    expect(useFriendMemoryStore.getState().getVisibleGeometries(null, distantViewport)[0].geometry.coordinates).toHaveLength(1);

    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, distantViewport);
    for (let index = 0; index < 15; index += 1) {
      await useFriendMemoryStore.getState().loadSelectedProjections(undefined, {
        key: `pinch-${index}`,
        bbox: [174.6 + index * 0.001, -41.4, 174.9 + index * 0.001, -41.1],
      });
    }
    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
  });

  test('a terminal page that omits an expected page cannot become complete', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_100);
    const appState = { user: { id: 'viewer-a' } };
    const subscriptionState = {
      subscriptions: [{ friend_id: 11 }],
      availableSources: [{ friend_id: '11', authorization_version: 4 }],
    };
    const bbox: [number, number, number, number] = TEST_VIEWPORT.bbox;
    const ring = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]];
    jest.doMock('../../../store/storage', () => ({ storage: { getItem: jest.fn(async () => null), removeItem: jest.fn(async () => undefined) } }));
    jest.doMock('../../../services/apiService', () => ({
      authenticatedFetch: jest.fn(async () => pagedSnapshotResponse({
        pageIndex: 0, tile: { id: 'only-page', bbox, ring }, nextCursor: null,
      })),
    }));
    jest.doMock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => appState } }));
    jest.doMock('../store/useMemorySubscriptionsStore', () => ({
      useMemorySubscriptionsStore: { getState: () => subscriptionState },
    }));

    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().loadSelectedProjections(undefined, TEST_VIEWPORT);
    expect(useFriendMemoryStore.getState().projections).toEqual({});
    expect(useFriendMemoryStore.getState().lastFailure).toMatchObject({
      kind: 'payload', stage: 'completeness', causeCode: 'INCOMPLETE_SNAPSHOT',
    });
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
      authenticatedFetch: jest.fn(async () => snapshotResponse(11, 4, 'about-to-be-purged')),
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
      const friendId = JSON.parse(init.body).friend_id;
      if (friendId === 11) return { ok: false, status: 503, json: async () => ({}) };
      return snapshotResponse(22, 7, 'friend-22-ok');
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
    expect(useFriendMemoryStore.getState().getVisibleGeometries(null, TEST_VIEWPORT)).toHaveLength(1);
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
    const makeResponse = (items: Array<{ id: number; auth: number; version: string }>) => {
      const item = items[0];
      return snapshotResponse(item.id, item.auth, item.version);
    };
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
    const response = (auth: number, version: string) => snapshotResponse(11, auth, version);

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
