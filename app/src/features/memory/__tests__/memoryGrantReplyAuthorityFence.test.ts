const mockAuthenticatedFetch = jest.fn();

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(args[0], args[1]),
}));
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { useAppStore } from '../../../store/useAppStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';

const grantA = {
  friend_id: '31',
  friend_name: 'Grant Friend',
  selected: false,
  authorization_version: 1,
  grant_epoch: 'grant-a',
  friendship_episode_id: 'episode-a',
  friendship_episode_uuid: 'episode-uuid-a',
  effective_at: '2026-10-23T00:00:00.000Z',
  sharing_status: 'shared' as const,
  coverage_scope: 'full_history_delayed_v1' as const,
};

const grantB = {
  ...grantA,
  grant_epoch: 'grant-b',
  friendship_episode_id: 'episode-b',
  friendship_episode_uuid: 'episode-uuid-b',
  effective_at: '2026-10-24T00:00:00.000Z',
};

type DeferredResponse = {
  promise: Promise<any>;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
};

function deferredResponse(): DeferredResponse {
  let resolve!: (value: any) => void;
  let reject!: (reason: any) => void;
  return {
    promise: new Promise((value, fail) => { resolve = value; reject = fail; }),
    resolve,
    reject,
  };
}

function orderedAck(request: any, selected: boolean, status = selected ? 201 : 200) {
  return {
    ok: true,
    status,
    json: async () => ({
      selected,
      selection_chain_id: request.selection_chain_id,
      selection_sequence: request.selection_sequence,
      selection_request_id: request.selection_request_id,
    }),
  };
}

function subscriptionsResponse(selected: boolean) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      limit: null,
      subscriptions: selected ? [{ friend_id: 31, friend_name: 'Grant Friend' }] : [],
    }),
  };
}

function sourcesResponse(selected: boolean) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      complete: true,
      sources: [{ ...grantB, selected }],
    }),
  };
}

function grantBSnapshotResponse() {
  const now = Date.now();
  return {
    ok: true,
    status: 200,
    json: async () => ({
      revoked_friend_ids: [],
      projections: [{
        source_friend_id: '31',
        authorization_version: 1,
        grant_epoch: 'grant-b',
        friendship_episode_id: 'episode-b',
        friendship_episode_uuid: 'episode-uuid-b',
        coverage_scope: 'full_history_delayed_v1',
        server_authorized_at: new Date(now).toISOString(),
        authorization_expires_at: new Date(now + 5 * 60_000).toISOString(),
        manifest: {
          snapshot_id: 'snapshot-grant-b',
          dataset_revision: 'revision-grant-b',
          coverage_rule_version: 4,
          as_of: new Date(now).toISOString(),
          expected_pages: 1,
          expected_tiles: 1,
          expected_evidence_count: 1,
          regions: [],
          complete: false,
        },
        page: {
          snapshot_id: 'snapshot-grant-b',
          page_index: 0,
          tiles: [{
            id: 'tile-grant-b',
            bbox: [174, -42, 176, -40],
            evidence_count: 1,
            geometry_sha256: 'geometry-grant-b',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [[[[174, -42], [176, -42], [176, -40], [174, -42]]]],
            },
          }],
          next_cursor: null,
          complete: true,
        },
      }],
    }),
  };
}

async function waitForMutationRequest(method: 'POST' | 'DELETE'): Promise<any> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const call = mockAuthenticatedFetch.mock.calls.find(([, init]) => init?.method === method);
    if (call) return JSON.parse(call[1].body);
    await Promise.resolve();
  }
  throw new Error(`${method} mutation was not dispatched`);
}

describe('selection mutation replies are fenced by their dispatched grant identity', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    useAppStore.setState({ user: { id: 'viewer-a' } as any, isLoggedIn: true, hydrated: true });
    useFriendMemoryStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
    useMemorySubscriptionsStore.setState({ availableSources: [grantA] });
  });

  afterEach(() => {
    useFriendMemoryStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
  });

  test('grant-A POST success arriving after grant B is established cannot select B', async () => {
    const oldPost = deferredResponse();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST') return oldPost.promise;
      if (path === '/api/memory-subscriptions') return Promise.resolve(subscriptionsResponse(false));
      if (path === '/api/friend-sharing/sources') return Promise.resolve(sourcesResponse(false));
      throw new Error(`unexpected ${path}`);
    });

    const mutation = useMemorySubscriptionsStore.getState().subscribe(31);
    const request = await waitForMutationRequest('POST');
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState().availableSources[0]).toMatchObject({
      grant_epoch: 'grant-b', selected: false,
    });

    oldPost.resolve(orderedAck(request, true));
    await mutation;

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      availableSources: [{ grant_epoch: 'grant-b', selected: false }],
      selectionPending: {},
      selectionError: null,
    });
  });

  test('grant-A DELETE success arriving after selected grant B is established cannot deselect B', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Grant Friend' }],
      availableSources: [{ ...grantA, selected: true }],
    });
    const oldDelete = deferredResponse();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions/31' && init.method === 'DELETE') return oldDelete.promise;
      if (path === '/api/memory-subscriptions') return Promise.resolve(subscriptionsResponse(true));
      if (path === '/api/friend-sharing/sources') return Promise.resolve(sourcesResponse(true));
      throw new Error(`unexpected ${path}`);
    });

    const mutation = useMemorySubscriptionsStore.getState().unsubscribe(31);
    const request = await waitForMutationRequest('DELETE');
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState().availableSources[0]).toMatchObject({
      grant_epoch: 'grant-b', selected: true,
    });

    oldDelete.resolve(orderedAck(request, false));
    await mutation;

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 31 }],
      availableSources: [{ grant_epoch: 'grant-b', selected: true }],
      selectionPending: {},
      selectionError: null,
    });
  });

  test('grant-A authorization denial arriving after valid grant B cannot purge or conceal B geometry', async () => {
    // Acquire B through the real snapshot Store before replaying a delayed A
    // mutation. This models valid same-session B geometry that must survive an
    // old A response; only the transport schedule is controlled by the test.
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Grant Friend' }],
      availableSources: [{ ...grantB, selected: true }],
    });
    mockAuthenticatedFetch.mockImplementation(async (path: string) => {
      if (path === '/api/friend-sharing/coverage-snapshot') return grantBSnapshotResponse();
      throw new Error(`unexpected ${path}`);
    });
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
    useMemorySubscriptionsStore.setState({
      subscriptions: [],
      availableSources: [grantA],
      selectionPending: {},
    });

    const oldPost = deferredResponse();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST') return oldPost.promise;
      if (path === '/api/memory-subscriptions') return Promise.resolve(subscriptionsResponse(true));
      if (path === '/api/friend-sharing/sources') return Promise.resolve(sourcesResponse(true));
      if (path === '/api/friend-sharing/coverage-snapshot') return Promise.resolve(grantBSnapshotResponse());
      throw new Error(`unexpected ${path}`);
    });

    const mutation = useMemorySubscriptionsStore.getState().subscribe(31);
    await waitForMutationRequest('POST');
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    expect(useFriendMemoryStore.getState().projections['31']).toMatchObject({ grantEpoch: 'grant-b' });

    oldPost.resolve({
      ok: false,
      status: 409,
      json: async () => ({ code: 'AUTHORIZATION_CHANGED' }),
    });
    await mutation;

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 31 }],
      availableSources: [{ grant_epoch: 'grant-b', selected: true, sharing_status: 'shared' }],
      selectionPending: {},
      selectionError: null,
    });
    expect(useFriendMemoryStore.getState().projections['31']).toMatchObject({ grantEpoch: 'grant-b' });
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  });

  test('grant-A DELETE authorization denial arriving after grant B cannot hide or purge B', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Grant Friend' }],
      availableSources: [{ ...grantA, selected: true }],
    });
    const oldDelete = deferredResponse();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions/31' && init.method === 'DELETE') return oldDelete.promise;
      if (path === '/api/memory-subscriptions') return Promise.resolve(subscriptionsResponse(true));
      if (path === '/api/friend-sharing/sources') return Promise.resolve(sourcesResponse(true));
      throw new Error(`unexpected ${path}`);
    });

    const mutation = useMemorySubscriptionsStore.getState().unsubscribe(31);
    await waitForMutationRequest('DELETE');
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    oldDelete.resolve({
      ok: false,
      status: 409,
      json: async () => ({ code: 'AUTHORIZATION_CHANGED' }),
    });
    await mutation;

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 31 }],
      availableSources: [{ grant_epoch: 'grant-b', selected: true, sharing_status: 'shared' }],
      selectionPending: {},
      selectionError: null,
    });
  });

  test.each([
    ['cancelled', { name: 'AbortError', code: 'REQUEST_CANCELLED' }],
    ['timed out', { name: 'AbortError', code: 'MEMORY_SELECTION_REQUEST_TIMEOUT', timedOut: true }],
  ])('grant-A POST that is %s after grant B cannot roll back B or leave stale pending state', async (_label, failure) => {
    const oldPost = deferredResponse();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST') return oldPost.promise;
      if (path === '/api/memory-subscriptions') return Promise.resolve(subscriptionsResponse(true));
      if (path === '/api/friend-sharing/sources') return Promise.resolve(sourcesResponse(true));
      throw new Error(`unexpected ${path}`);
    });

    const mutation = useMemorySubscriptionsStore.getState().subscribe(31);
    await waitForMutationRequest('POST');
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    oldPost.reject(Object.assign(new Error(String(_label)), failure));
    await mutation;

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 31 }],
      availableSources: [{ grant_epoch: 'grant-b', selected: true, sharing_status: 'shared' }],
      selectionPending: {},
      selectionError: null,
      selectionLastFailure: null,
    });
  });

  test('grant-A service failure after grant B cannot attach an error to B', async () => {
    const oldPost = deferredResponse();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST') return oldPost.promise;
      if (path === '/api/memory-subscriptions') return Promise.resolve(subscriptionsResponse(true));
      if (path === '/api/friend-sharing/sources') return Promise.resolve(sourcesResponse(true));
      throw new Error(`unexpected ${path}`);
    });

    const mutation = useMemorySubscriptionsStore.getState().subscribe(31);
    await waitForMutationRequest('POST');
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    oldPost.resolve({ ok: false, status: 503, json: async () => ({ code: 'SERVICE_UNAVAILABLE' }) });
    await mutation;

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 31 }],
      availableSources: [{ grant_epoch: 'grant-b', selected: true }],
      selectionPending: {},
      selectionError: null,
      selectionLastFailure: null,
    });
  });
});
