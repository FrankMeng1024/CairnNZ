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

function snapshotResponse(
  grantEpoch = 'grant-a',
  snapshotId = 'snapshot-a',
  friendId = '11',
  friendshipEpisodeId = 'episode-a',
) {
  const now = Date.now();
  return {
    ok: true, status: 200,
    json: async () => ({
      revoked_friend_ids: [],
      projections: [{
        source_friend_id: friendId, authorization_version: 1,
        grant_epoch: grantEpoch, friendship_episode_id: friendshipEpisodeId,
        coverage_scope: 'full_history_delayed_v1',
        server_authorized_at: new Date(now).toISOString(),
        authorization_expires_at: new Date(now + 5 * 60_000).toISOString(),
        manifest: {
          snapshot_id: snapshotId, dataset_revision: snapshotId, coverage_rule_version: 4,
          as_of: new Date(now).toISOString(), expected_pages: 1, expected_tiles: 1,
          expected_evidence_count: 1, regions: [], complete: false,
        },
        page: {
          snapshot_id: snapshotId, page_index: 0,
          tiles: [{ id: `tile-${snapshotId}`, bbox: [174, -42, 176, -40], evidence_count: 1, geometry_sha256: `sha-${snapshotId}`, geometry: { type: 'MultiPolygon', coordinates: [[[[174, -42], [176, -42], [176, -40], [174, -42]]]] } }],
          next_cursor: null, complete: true,
        },
      }],
    }),
  };
}

function renewalResponse(
  requestId: string,
  status: 'authorized' | 'denied' = 'authorized',
  grantEpoch = 'grant-a',
) {
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
          grant_epoch: grantEpoch, friendship_episode_id: 'episode-a',
          authorization_version: 1, coverage_scope: 'full_history_delayed_v1',
        } : {}),
      }],
    }),
  };
}

function emptySnapshotResponse() {
  const response = snapshotResponse();
  return {
    ...response,
    json: async () => {
      const body = await response.json();
      const projection = body.projections[0];
      return {
        ...body,
        projections: [{
          ...projection,
          manifest: {
            ...projection.manifest,
            expected_pages: 0,
            expected_tiles: 0,
            expected_evidence_count: 0,
            complete: true,
          },
          page: { ...projection.page, tiles: [], complete: true },
        }],
      };
    },
  };
}

describe('Friend Memory server proof renewal', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockAppState.user.id = 'viewer-a';
    mockSubscriptions.subscriptions = [{ friend_id: 11, friend_name: 'Mia' }];
    mockSubscriptions.availableSources[0] = {
      friend_id: '11', friend_name: 'Mia', selected: true,
      authorization_version: 1, grant_epoch: 'grant-a', friendship_episode_id: 'episode-a',
      coverage_scope: 'full_history_delayed_v1', sharing_status: 'shared', effective_at: '',
    };
  });

  afterEach(() => {
    try { require('../store/useFriendMemoryStore').useFriendMemoryStore.getState().reset(); } catch { /* module may not have loaded */ }
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

  test('same-grant authority refresh retains expired hidden geometry for proof-only recovery', async () => {
    mockAuthenticatedFetch.mockReset().mockResolvedValueOnce(snapshotResponse());
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const cached = useFriendMemoryStore.getState().projections['11'];
    const geometry = cached.geometry;
    useFriendMemoryStore.setState({
      projections: {
        ...useFriendMemoryStore.getState().projections,
        '11': { ...cached, authorizationExpiresAtMs: Date.now() - 1 },
      },
    });

    await useFriendMemoryStore.getState().reconcileAuthorizedSources(
      mockSubscriptions.availableSources,
      true,
    );

    expect(useFriendMemoryStore.getState().projections['11']?.geometry).toBe(geometry);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
    mockAuthenticatedFetch.mockImplementationOnce(async (_path, init) => (
      renewalResponse(JSON.parse(init.body).request_id)
    ));
    await useFriendMemoryStore.getState().loadSelectedProjections();

    expect(mockAuthenticatedFetch.mock.calls.map(call => call[0])).toEqual([
      '/api/friend-sharing/coverage-snapshot',
      '/api/friend-sharing/coverage-proof-renewal',
    ]);
    expect(useFriendMemoryStore.getState().projections['11']?.geometry).toBe(geometry);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
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

  test('an expiry-boundary renewal restores the source terminal after a transient pre-renewal failure', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-26T00:00:00.000Z'));
    let renewalCalls = 0;
    mockAuthenticatedFetch.mockReset().mockImplementation(async (path, init) => {
      if (path === '/api/friend-sharing/coverage-snapshot') return snapshotResponse();
      renewalCalls += 1;
      if (renewalCalls === 1) {
        return { ok: false, status: 503, json: async () => ({ code: 'SERVICE_UNAVAILABLE' }) };
      }
      return renewalResponse(JSON.parse(init.body).request_id);
    });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();

    await jest.advanceTimersByTimeAsync(4 * 60_000 + 30_000);
    expect(useFriendMemoryStore.getState().sourceStates['11'].status).toBe('loaded');
    await jest.advanceTimersByTimeAsync(30_000);

    expect(renewalCalls).toBe(2);
    expect(useFriendMemoryStore.getState()).toMatchObject({ loading: false, error: null });
    expect(useFriendMemoryStore.getState().sourceStates['11']).toMatchObject({ status: 'loaded', cellCount: 1 });
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  });

  test('an expired proof retries transient renewal in a bounded recovery window without geometry reload', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-26T00:00:00.000Z'));
    let renewalCalls = 0;
    mockAuthenticatedFetch.mockReset().mockImplementation(async (path, init) => {
      if (path === '/api/friend-sharing/coverage-snapshot') return snapshotResponse();
      renewalCalls += 1;
      if (renewalCalls <= 2) {
        return { ok: false, status: 503, json: async () => ({ code: 'SERVICE_UNAVAILABLE' }) };
      }
      return renewalResponse(JSON.parse(init.body).request_id);
    });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();

    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(15_000);

    expect(mockAuthenticatedFetch.mock.calls.filter(call => call[0] === '/api/friend-sharing/coverage-snapshot')).toHaveLength(1);
    expect(renewalCalls).toBe(3);
    expect(useFriendMemoryStore.getState().sourceStates['11']).toMatchObject({ status: 'loaded', cellCount: 1 });
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  });

  test('a complete-empty Friend source returns to the empty terminal after expiry recovery', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-26T00:00:00.000Z'));
    let renewalCalls = 0;
    mockAuthenticatedFetch.mockReset().mockImplementation(async (path, init) => {
      if (path === '/api/friend-sharing/coverage-snapshot') return emptySnapshotResponse();
      renewalCalls += 1;
      if (renewalCalls === 1) {
        return { ok: false, status: 503, json: async () => ({ code: 'SERVICE_UNAVAILABLE' }) };
      }
      return renewalResponse(JSON.parse(init.body).request_id);
    });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    expect(useFriendMemoryStore.getState().sourceStates['11']).toMatchObject({ status: 'empty', cellCount: 0 });

    await jest.advanceTimersByTimeAsync(5 * 60_000);

    expect(useFriendMemoryStore.getState().sourceStates['11']).toMatchObject({ status: 'empty', cellCount: 0 });
    expect(useFriendMemoryStore.getState()).toMatchObject({ loading: false, error: null });
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  });

  test.each(['authorized', 'denied'] as const)('a delayed old-grant %s renewal cannot delete a newly acquired grant with the same version', async (oldStatus) => {
    let releaseOldRenewal!: () => void;
    let oldRequestId = '';
    mockAuthenticatedFetch.mockReset()
      .mockResolvedValueOnce(snapshotResponse('grant-a', 'snapshot-a'))
      .mockImplementationOnce(async (_path, init) => {
        oldRequestId = JSON.parse(init.body).request_id;
        return new Promise(resolve => {
          releaseOldRenewal = () => resolve(renewalResponse(oldRequestId, oldStatus, 'grant-a'));
        });
      })
      .mockResolvedValueOnce(snapshotResponse('grant-b', 'snapshot-b'));
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const oldRenewal = useFriendMemoryStore.getState().renewAuthorizationProofs(['11']);
    while (!releaseOldRenewal) await Promise.resolve();

    await useFriendMemoryStore.getState().purgeFriend(11);
    mockSubscriptions.availableSources[0].grant_epoch = 'grant-b';
    await useFriendMemoryStore.getState().loadSelectedProjections();
    expect(useFriendMemoryStore.getState().projections['11']).toMatchObject({ grantEpoch: 'grant-b', snapshotId: 'snapshot-b' });

    releaseOldRenewal();
    await oldRenewal;

    expect(useFriendMemoryStore.getState().projections['11']).toMatchObject({ grantEpoch: 'grant-b', snapshotId: 'snapshot-b' });
    expect(useFriendMemoryStore.getState().sourceStates['11'].status).toBe('loaded');
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  });

  test('one stale source in a batch cannot corrupt its replacement or the independently current source', async () => {
    mockSubscriptions.subscriptions = [
      { friend_id: 11, friend_name: 'Mia' },
      { friend_id: 12, friend_name: 'Noah' },
    ];
    mockSubscriptions.availableSources = [
      mockSubscriptions.availableSources[0],
      {
        friend_id: '12', friend_name: 'Noah', selected: true,
        authorization_version: 1, grant_epoch: 'grant-12', friendship_episode_id: 'episode-12',
        coverage_scope: 'full_history_delayed_v1', sharing_status: 'shared', effective_at: '',
      },
    ];
    let releaseBatch!: () => void;
    mockAuthenticatedFetch.mockReset().mockImplementation(async (path, init) => {
      if (path === '/api/friend-sharing/coverage-snapshot') {
        const id = String(JSON.parse(init.body).friend_id);
        const source = mockSubscriptions.availableSources.find(item => String(item.friend_id) === id)!;
        return snapshotResponse(
          source.grant_epoch,
          `snapshot-${id}-${source.grant_epoch}`,
          id,
          source.friendship_episode_id,
        );
      }
      const request = JSON.parse(init.body);
      return new Promise(resolve => {
        releaseBatch = () => {
          const now = Date.now();
          resolve({
            ok: true, status: 200,
            json: async () => ({
              request_id: request.request_id,
              complete: true,
              server_authorized_at: new Date(now).toISOString(),
              authorization_expires_at: new Date(now + 5 * 60_000).toISOString(),
              outcomes: request.sources.map((source: any) => ({
                friend_id: String(source.friend_id), status: 'authorized', code: 'PROOF_RENEWED',
                grant_epoch: source.grant_epoch,
                friendship_episode_id: source.friendship_episode_id,
                authorization_version: source.authorization_version,
                coverage_scope: source.coverage_scope,
              })),
            }),
          });
        };
      });
    });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const friend12AuthorizedAt = useFriendMemoryStore.getState().projections['12'].serverAuthorizedAtMs;
    const oldBatch = useFriendMemoryStore.getState().renewAuthorizationProofs(['11', '12']);
    while (!releaseBatch) await Promise.resolve();

    await useFriendMemoryStore.getState().purgeFriend(11);
    mockSubscriptions.availableSources[0].grant_epoch = 'grant-b';
    await useFriendMemoryStore.getState().loadSelectedProjections();
    releaseBatch();
    await oldBatch;

    expect(useFriendMemoryStore.getState().projections['11']).toMatchObject({
      grantEpoch: 'grant-b', snapshotId: 'snapshot-11-grant-b',
    });
    expect(useFriendMemoryStore.getState().sourceStates['11'].status).toBe('loaded');
    expect(useFriendMemoryStore.getState().projections['12']).toMatchObject({ grantEpoch: 'grant-12' });
    expect(useFriendMemoryStore.getState().projections['12'].serverAuthorizedAtMs)
      .toBeGreaterThanOrEqual(friend12AuthorizedAt);
    expect(useFriendMemoryStore.getState().sourceStates['12'].status).toBe('loaded');
  });

  test('expired transient renewal stops after the documented bounded retry sequence', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-26T00:00:00.000Z'));
    let renewalCalls = 0;
    mockAuthenticatedFetch.mockReset().mockImplementation(async (path) => {
      if (path === '/api/friend-sharing/coverage-snapshot') return snapshotResponse();
      renewalCalls += 1;
      return { ok: false, status: 503, json: async () => ({ code: 'SERVICE_UNAVAILABLE' }) };
    });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();

    await jest.advanceTimersByTimeAsync(15 * 60_000);

    // One lead renewal, one hard-expiry renewal, then 15/30/60-second retries.
    expect(renewalCalls).toBe(5);
    expect(useFriendMemoryStore.getState()).toMatchObject({
      loading: false,
      error: 'unavailable',
      sourceStates: { '11': { status: 'idle', cellCount: 0 } },
    });
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
  });

  test('a never-settling renewal times out, releases single-flight, and bounded retry restores the same grant', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-27T00:00:00.000Z'));
    let neverRequestSignal: AbortSignal | undefined;
    mockAuthenticatedFetch.mockReset()
      .mockResolvedValueOnce(snapshotResponse())
      .mockImplementationOnce(async (_path, init) => {
        neverRequestSignal = init.signal;
        return new Promise(() => undefined);
      })
      .mockImplementationOnce(async (_path, init) => renewalResponse(JSON.parse(init.body).request_id));
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const geometry = useFriendMemoryStore.getState().projections['11'].geometry;
    const projection = useFriendMemoryStore.getState().projections['11'];
    useFriendMemoryStore.setState({
      projections: {
        ...useFriendMemoryStore.getState().projections,
        '11': { ...projection, authorizationExpiresAtMs: Date.now() - 1 },
      },
    });

    let firstSettled = false;
    const firstRenewal = useFriendMemoryStore.getState().renewAuthorizationProofs(['11'])
      .then((result: boolean) => {
        firstSettled = true;
        return result;
      });
    await Promise.resolve();
    expect(mockAuthenticatedFetch.mock.calls.filter(call => call[0] === '/api/friend-sharing/coverage-proof-renewal')).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(10_001);

    expect(firstSettled).toBe(true);
    await expect(firstRenewal).resolves.toBe(false);
    expect(neverRequestSignal?.aborted).toBe(true);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
    expect(useFriendMemoryStore.getState()).toMatchObject({
      loading: false,
      error: 'offline',
      lastFailure: { kind: 'timeout' },
    });

    // The existing bounded recovery policy owns the retry. Connectivity is
    // already available for the next request; advancing to the first 15 s
    // retry must be enough—no manual renewal call or camera action is needed.
    await jest.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();
    expect(mockAuthenticatedFetch.mock.calls.filter(call => call[0] === '/api/friend-sharing/coverage-snapshot')).toHaveLength(1);
    expect(mockAuthenticatedFetch.mock.calls.filter(call => call[0] === '/api/friend-sharing/coverage-proof-renewal')).toHaveLength(2);
    expect(useFriendMemoryStore.getState().projections['11'].geometry).toBe(geometry);
    expect(useFriendMemoryStore.getState().sourceStates['11']).toMatchObject({ status: 'loaded', cellCount: 1 });
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  });

  test('account fencing aborts a hung renewal and the replacement identity is not blocked', async () => {
    let snapshotCalls = 0;
    let renewalCalls = 0;
    let neverRequestSignal: AbortSignal | undefined;
    mockAuthenticatedFetch.mockReset().mockImplementation(async (path, init) => {
      if (path === '/api/friend-sharing/coverage-snapshot') {
        snapshotCalls += 1;
        return snapshotResponse('grant-a', `snapshot-${snapshotCalls}`);
      }
      renewalCalls += 1;
      if (renewalCalls === 1) {
        neverRequestSignal = init.signal;
        return new Promise(() => undefined);
      }
      return renewalResponse(JSON.parse(init.body).request_id);
    });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const oldRenewal = useFriendMemoryStore.getState().renewAuthorizationProofs(['11']);
    await Promise.resolve();

    useFriendMemoryStore.getState().reset();
    await expect(oldRenewal).resolves.toBe(false);
    expect(neverRequestSignal?.aborted).toBe(true);
    expect(useFriendMemoryStore.getState()).toMatchObject({
      userId: null,
      projections: {},
      error: null,
      lastFailure: null,
    });

    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    await expect(useFriendMemoryStore.getState().renewAuthorizationProofs(['11'])).resolves.toBe(true);
    expect(snapshotCalls).toBe(2);
    expect(renewalCalls).toBe(2);
    expect(useFriendMemoryStore.getState().projections['11']).toMatchObject({
      snapshotId: 'snapshot-2',
      grantEpoch: 'grant-a',
    });
    expect(useFriendMemoryStore.getState().sourceStates['11'].status).toBe('loaded');
  });

  test('a complete sources refresh retains same-grant hidden geometry across deselect and reselect', async () => {
    mockAuthenticatedFetch.mockReset().mockResolvedValueOnce(snapshotResponse());
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const geometry = useFriendMemoryStore.getState().projections['11'].geometry;

    mockSubscriptions.subscriptions = [];
    mockSubscriptions.availableSources[0].selected = false;
    useFriendMemoryStore.getState().hideFriend(11);
    await useFriendMemoryStore.getState().reconcileAuthorizedSources(mockSubscriptions.availableSources, true);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
    expect(useFriendMemoryStore.getState().projections['11']?.geometry).toBe(geometry);

    mockSubscriptions.subscriptions = [{ friend_id: 11, friend_name: 'Mia' }];
    mockSubscriptions.availableSources[0].selected = true;
    await useFriendMemoryStore.getState().loadSelectedProjections();

    expect(mockAuthenticatedFetch.mock.calls.filter(call => call[0] === '/api/friend-sharing/coverage-snapshot')).toHaveLength(1);
    expect(useFriendMemoryStore.getState().projections['11']?.geometry).toBe(geometry);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  });

  test('an old denial after deselect and same-grant reselect cannot purge the current source generation', async () => {
    let releaseOldRenewal!: () => void;
    let oldRequestId = '';
    mockAuthenticatedFetch.mockReset()
      .mockResolvedValueOnce(snapshotResponse())
      .mockImplementationOnce(async (_path, init) => {
        oldRequestId = JSON.parse(init.body).request_id;
        return new Promise(resolve => {
          releaseOldRenewal = () => resolve(renewalResponse(oldRequestId, 'denied'));
        });
      });
    const { useFriendMemoryStore } = require('../store/useFriendMemoryStore');
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    const geometry = useFriendMemoryStore.getState().projections['11'].geometry;
    const oldRenewal = useFriendMemoryStore.getState().renewAuthorizationProofs(['11']);
    while (!releaseOldRenewal) await Promise.resolve();

    mockSubscriptions.subscriptions = [];
    mockSubscriptions.availableSources[0].selected = false;
    useFriendMemoryStore.getState().hideFriend(11);
    mockSubscriptions.subscriptions = [{ friend_id: 11, friend_name: 'Mia' }];
    mockSubscriptions.availableSources[0].selected = true;

    releaseOldRenewal();
    await oldRenewal;

    expect(useFriendMemoryStore.getState().projections['11']?.geometry).toBe(geometry);
    expect(useFriendMemoryStore.getState().sourceStates['11'].status).toBe('loaded');
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
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
