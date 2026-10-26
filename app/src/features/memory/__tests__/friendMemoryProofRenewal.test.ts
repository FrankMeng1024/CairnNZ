const mockAuthenticatedFetch = jest.fn();
const mockAppState = { user: { id: 'viewer-a' } };
const mockSubscriptions = {
  subscriptions: [{ friend_id: 11, friend_name: 'Mia' }],
  availableSources: [{
    friend_id: '11', friend_name: 'Mia', selected: true,
    authorization_version: 1, grant_epoch: 'grant-a', friendship_episode_id: 'episode-a',
    coverage_scope: 'full_history_delayed_v1', sharing_status: 'shared', effective_at: '',
  }],
};

jest.mock('../../../services/apiService', () => ({ authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args) }));
jest.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => mockAppState } }));
jest.mock('../../../store/storage', () => ({ storage: { getAllKeysStrict: async () => [], removeItemsStrict: async () => undefined } }));
jest.mock('../store/useMemorySubscriptionsStore', () => ({ useMemorySubscriptionsStore: { getState: () => mockSubscriptions } }));

function snapshotResponse() {
  const now = Date.now();
  return {
    ok: true, status: 200,
    json: async () => ({
      revoked_friend_ids: [],
      projections: [{
        source_friend_id: '11', authorization_version: 1,
        grant_epoch: 'grant-a', friendship_episode_id: 'episode-a',
        coverage_scope: 'full_history_delayed_v1',
        server_authorized_at: new Date(now).toISOString(),
        authorization_expires_at: new Date(now + 5 * 60_000).toISOString(),
        manifest: {
          snapshot_id: 'snapshot-a', dataset_revision: 'dataset-a', coverage_rule_version: 4,
          as_of: new Date(now).toISOString(), expected_pages: 1, expected_tiles: 1,
          expected_evidence_count: 1, regions: [], complete: false,
        },
        page: {
          snapshot_id: 'snapshot-a', page_index: 0,
          tiles: [{ id: 'tile-a', bbox: [174, -42, 176, -40], evidence_count: 1, geometry_sha256: 'sha', geometry: { type: 'MultiPolygon', coordinates: [[[[174, -42], [176, -42], [176, -40], [174, -42]]]] } }],
          next_cursor: null, complete: true,
        },
      }],
    }),
  };
}

function renewalResponse(requestId: string, status: 'authorized' | 'denied' = 'authorized') {
  const now = Date.now();
  return {
    ok: true, status: 200,
    json: async () => ({
      request_id: requestId, complete: true,
      server_authorized_at: new Date(now).toISOString(),
      authorization_expires_at: new Date(now + 5 * 60_000).toISOString(),
      outcomes: [{
        friend_id: '11', status,
        code: status === 'authorized' ? 'PROOF_RENEWED' : 'AUTHORIZATION_CHANGED',
        ...(status === 'authorized' ? {
          grant_epoch: 'grant-a', friendship_episode_id: 'episode-a',
          authorization_version: 1, coverage_scope: 'full_history_delayed_v1',
        } : {}),
      }],
    }),
  };
}

describe('Friend Memory server proof renewal', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockAppState.user.id = 'viewer-a';
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('renews the exact grant without a second geometry acquisition', async () => {
    mockAuthenticatedFetch.mockReset()
      .mockResolvedValueOnce(snapshotResponse())
      .mockImplementationOnce(async (_path, init) => renewalResponse(JSON.parse(init.body).request_id));
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const geometryBefore = useFriendMemoryStore.getState().projections['11'].geometry;
    await useFriendMemoryStore.getState().renewAuthorizationProofs(['11']);

    expect(mockAuthenticatedFetch.mock.calls.map(call => call[0])).toEqual([
      '/api/friend-sharing/coverage-snapshot',
      '/api/friend-sharing/coverage-proof-renewal',
    ]);
    expect(useFriendMemoryStore.getState().projections['11'].geometry).toBe(geometryBefore);
    expect(JSON.parse(mockAuthenticatedFetch.mock.calls[1][1].body).sources[0]).toEqual({
      friend_id: '11', grant_epoch: 'grant-a', friendship_episode_id: 'episode-a',
      authorization_version: 1, coverage_scope: 'full_history_delayed_v1',
    });
  });

  test('a denied renewal purges that source and never resurrects its geometry', async () => {
    mockAuthenticatedFetch.mockReset()
      .mockResolvedValueOnce(snapshotResponse())
      .mockImplementationOnce(async (_path, init) => renewalResponse(JSON.parse(init.body).request_id, 'denied'));
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    expect(await useFriendMemoryStore.getState().renewAuthorizationProofs(['11'])).toBe(false);
    expect(useFriendMemoryStore.getState().projections['11']).toBeUndefined();
    expect(useFriendMemoryStore.getState().authorizedSourceVersions['11']).toBeUndefined();
    expect(useFriendMemoryStore.getState().sourceStates['11'].status).toBe('unauthorized');
    expect(useFriendMemoryStore.getState().error).toBe('unauthorized');
  });

  test('an unsupported old backend is reported and does not invent a local lease', async () => {
    mockAuthenticatedFetch.mockReset().mockResolvedValueOnce(snapshotResponse()).mockResolvedValueOnce({
      ok: false, status: 404, json: async () => ({ code: 'NOT_FOUND' }),
    });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const expiry = useFriendMemoryStore.getState().projections['11'].authorizationExpiresAtMs;
    expect(await useFriendMemoryStore.getState().renewAuthorizationProofs(['11'])).toBe(false);
    expect(useFriendMemoryStore.getState().projections['11'].authorizationExpiresAtMs).toBe(expiry);
    expect(useFriendMemoryStore.getState().lastFailure).toMatchObject({
      kind: 'http', stage: 'unsupported-backend', httpStatus: 404,
    });
    expect(useFriendMemoryStore.getState().error).toBeNull();
  });

  test('a partial response never declares proof completeness and retains still-valid cached geometry', async () => {
    mockAuthenticatedFetch.mockReset()
      .mockResolvedValueOnce(snapshotResponse())
      .mockImplementationOnce(async (_path, init) => {
        const requestId = JSON.parse(init.body).request_id;
        const response = renewalResponse(requestId);
        return { ...response, json: async () => ({ ...(await response.json()), outcomes: [] }) };
      });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const geometry = useFriendMemoryStore.getState().projections['11'].geometry;
    expect(await useFriendMemoryStore.getState().renewAuthorizationProofs(['11'])).toBe(false);
    expect(useFriendMemoryStore.getState().projections['11'].geometry).toBe(geometry);
    expect(useFriendMemoryStore.getState()).toMatchObject({
      error: null,
      lastFailure: { kind: 'payload', causeCode: 'INVALID_PROOF_RENEWAL' },
    });
  });

  test('a definitive 403 fails closed immediately while a 503 waits for the existing proof boundary', async () => {
    mockAuthenticatedFetch.mockReset()
      .mockResolvedValueOnce(snapshotResponse())
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ code: 'SERVICE_UNAVAILABLE' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ code: 'FORBIDDEN' }) });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    expect(await useFriendMemoryStore.getState().renewAuthorizationProofs(['11'])).toBe(false);
    expect(useFriendMemoryStore.getState().projections['11']).toBeDefined();
    expect(useFriendMemoryStore.getState().error).toBeNull();
    expect(await useFriendMemoryStore.getState().renewAuthorizationProofs(['11'])).toBe(false);
    expect(useFriendMemoryStore.getState().projections['11']).toBeUndefined();
    expect(useFriendMemoryStore.getState().error).toBe('unauthorized');
  });

  test('an expired cached source never falls back to a geometry download when renewal is unavailable', async () => {
    mockAuthenticatedFetch.mockReset()
      .mockResolvedValueOnce(snapshotResponse())
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ code: 'SERVICE_UNAVAILABLE' }) });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const cached = useFriendMemoryStore.getState().projections['11'];
    useFriendMemoryStore.setState({
      projections: {
        ...useFriendMemoryStore.getState().projections,
        '11': { ...cached, authorizationExpiresAtMs: Date.now() - 1 },
      },
    });

    await useFriendMemoryStore.getState().loadSelectedProjections();

    expect(mockAuthenticatedFetch.mock.calls.map(call => call[0])).toEqual([
      '/api/friend-sharing/coverage-snapshot',
      '/api/friend-sharing/coverage-proof-renewal',
    ]);
    expect(useFriendMemoryStore.getState()).toMatchObject({ loading: false, error: 'unavailable' });
    expect(useFriendMemoryStore.getState().projections['11'].geometry).toBe(cached.geometry);
  });

  test('crosses two five-minute proof boundaries without another geometry download or loader', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-26T00:00:00.000Z'));
    mockAuthenticatedFetch.mockReset().mockImplementation(async (path, init) => {
      if (path === '/api/friend-sharing/coverage-snapshot') return snapshotResponse();
      if (path === '/api/friend-sharing/coverage-proof-renewal') {
        return renewalResponse(JSON.parse(init.body).request_id);
      }
      throw new Error(`unexpected ${path}`);
    });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const geometry = useFriendMemoryStore.getState().projections['11'].geometry;

    await jest.advanceTimersByTimeAsync(4 * 60_000 + 30_000);
    await jest.advanceTimersByTimeAsync(4 * 60_000 + 30_000);

    expect(mockAuthenticatedFetch.mock.calls.filter(call => call[0] === '/api/friend-sharing/coverage-snapshot')).toHaveLength(1);
    expect(mockAuthenticatedFetch.mock.calls.filter(call => call[0] === '/api/friend-sharing/coverage-proof-renewal')).toHaveLength(2);
    expect(useFriendMemoryStore.getState().projections['11'].geometry).toBe(geometry);
    expect(useFriendMemoryStore.getState()).toMatchObject({ loading: false, error: null });
  });

  test.each([
    ['AUTHORIZATION_CHANGED', 'authorization', 'authorization', 'unauthorized'],
    ['SNAPSHOT_CHANGED', 'http', 'snapshot-consistency', 'unavailable'],
  ] as const)('409 %s preserves its structured cause', async (code, kind, stage, visibleError) => {
    mockAuthenticatedFetch.mockReset().mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ code, revoked_friend_ids: code === 'AUTHORIZATION_CHANGED' ? ['11'] : [] }),
    });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    expect(useFriendMemoryStore.getState()).toMatchObject({
      loading: false,
      error: visibleError,
      lastFailure: { kind, stage, causeCode: code, httpStatus: 409 },
    });
    expect(useFriendMemoryStore.getState().projections['11']).toBeUndefined();
  });
});
