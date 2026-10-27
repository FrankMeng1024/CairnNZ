const mockAuthenticatedFetch = jest.fn();
const mockStorageRemoveItem = jest.fn(async () => undefined);

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(args[0], args[1]),
}));
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: (_key: string, _options?: unknown) => mockStorageRemoveItem(),
  },
}));

import { useAppStore } from '../../../store/useAppStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';

const source = {
  friend_id: '31',
  friend_name: 'Adversarial Friend',
  selected: false,
  authorization_version: 7,
  grant_epoch: 'grant-a',
  friendship_episode_id: 'episode-a',
  friendship_episode_uuid: 'episode-uuid-a',
  effective_at: '2026-10-23T00:00:00.000Z',
  sharing_status: 'shared' as const,
  coverage_scope: 'full_history_delayed_v1' as const,
};

type Deferred = { resolve: (value: any) => void };
function deferred(): { promise: Promise<any>; gate: Deferred } {
  let resolve!: (value: any) => void;
  return { promise: new Promise(value => { resolve = value; }), gate: { resolve } };
}

function subscriptionsResponse(selected: boolean) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      limit: null,
      subscriptions: selected ? [{ friend_id: 31, friend_name: 'Adversarial Friend' }] : [],
    }),
  };
}

function sourcesResponse(value = source) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ complete: true, sources: [value] }),
  };
}

function selectionAck(request: any, selected: boolean, status = selected ? 201 : 200) {
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

describe('Memory authority adversarial commit schedules', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    mockStorageRemoveItem.mockClear();
    useAppStore.setState({ user: { id: 'viewer-a' } as any, isLoggedIn: true, hydrated: true });
    useFriendMemoryStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
    useMemorySubscriptionsStore.setState({ availableSources: [source] });
  });

  afterEach(() => {
    useFriendMemoryStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
  });

  test('GET dispatched after POST begins but before its ACK cannot overwrite the confirmed ACK', async () => {
    const post = deferred();
    let postRequest: any;
    const subscriptions = deferred();
    const sources = deferred();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST') {
        postRequest = JSON.parse(init.body);
        return post.promise;
      }
      if (path === '/api/memory-subscriptions') return subscriptions.promise;
      if (path === '/api/friend-sharing/sources') return sources.promise;
      throw new Error(`unexpected ${path}`);
    });

    const select = useMemorySubscriptionsStore.getState().subscribe(31);
    while (mockAuthenticatedFetch.mock.calls.length < 1) await Promise.resolve();
    const load = useMemorySubscriptionsStore.getState().load(true);
    while (mockAuthenticatedFetch.mock.calls.length < 3) await Promise.resolve();
    post.gate.resolve(selectionAck(postRequest, true));
    await expect(select).resolves.toBe(201);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(true);
    subscriptions.gate.resolve(subscriptionsResponse(false));
    sources.gate.resolve(sourcesResponse({ ...source, selected: false }));
    await expect(load).resolves.toBe(true);

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 31 }],
      availableSources: [{ selected: true }],
      selectionPending: {},
    });
  });

  test('GET dispatched after DELETE begins but before its ACK cannot resurrect after confirmed DELETE', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Adversarial Friend' }],
      availableSources: [{ ...source, selected: true }],
    });
    const remove = deferred();
    let removeRequest: any;
    const subscriptions = deferred();
    const sources = deferred();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions/31' && init.method === 'DELETE') {
        removeRequest = JSON.parse(init.body);
        return remove.promise;
      }
      if (path === '/api/memory-subscriptions') return subscriptions.promise;
      if (path === '/api/friend-sharing/sources') return sources.promise;
      throw new Error(`unexpected ${path}`);
    });

    const deselect = useMemorySubscriptionsStore.getState().unsubscribe(31);
    while (mockAuthenticatedFetch.mock.calls.length < 1) await Promise.resolve();
    const load = useMemorySubscriptionsStore.getState().load(true);
    while (mockAuthenticatedFetch.mock.calls.length < 3) await Promise.resolve();
    remove.gate.resolve(selectionAck(removeRequest, false));
    await expect(deselect).resolves.toBe(200);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(false);
    subscriptions.gate.resolve(subscriptionsResponse(true));
    sources.gate.resolve(sourcesResponse({ ...source, selected: true }));
    await expect(load).resolves.toBe(true);

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      availableSources: [{ selected: false }],
      selectionPending: {},
    });
  });

  test('grant-A select ACK cannot select a replacement grant-B source', async () => {
    const post = deferred();
    let postRequest: any;
    const subscriptions = deferred();
    const sources = deferred();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST') {
        postRequest = JSON.parse(init.body);
        return post.promise;
      }
      if (path === '/api/memory-subscriptions') return subscriptions.promise;
      if (path === '/api/friend-sharing/sources') return sources.promise;
      throw new Error(`unexpected ${path}`);
    });

    const load = useMemorySubscriptionsStore.getState().load(true);
    while (mockAuthenticatedFetch.mock.calls.length < 2) await Promise.resolve();
    const select = useMemorySubscriptionsStore.getState().subscribe(31);
    while (mockAuthenticatedFetch.mock.calls.length < 3) await Promise.resolve();
    post.gate.resolve(selectionAck(postRequest, true));
    await expect(select).resolves.toBe(201);
    subscriptions.gate.resolve(subscriptionsResponse(false));
    sources.gate.resolve(sourcesResponse({
      ...source,
      selected: false,
      grant_epoch: 'grant-b',
      friendship_episode_id: 'episode-b',
      friendship_episode_uuid: 'episode-uuid-b',
    } as any));
    await expect(load).resolves.toBe(true);

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      availableSources: [{ selected: false, grant_epoch: 'grant-b' }],
      selectionPending: {},
    });
  });

  test('grant-A deselect ACK cannot deselect a replacement grant-B selection', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Adversarial Friend' }],
      availableSources: [{ ...source, selected: true }],
    });
    const remove = deferred();
    let removeRequest: any;
    const subscriptions = deferred();
    const sources = deferred();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions/31' && init.method === 'DELETE') {
        removeRequest = JSON.parse(init.body);
        return remove.promise;
      }
      if (path === '/api/memory-subscriptions') return subscriptions.promise;
      if (path === '/api/friend-sharing/sources') return sources.promise;
      throw new Error(`unexpected ${path}`);
    });

    const load = useMemorySubscriptionsStore.getState().load(true);
    while (mockAuthenticatedFetch.mock.calls.length < 2) await Promise.resolve();
    const deselect = useMemorySubscriptionsStore.getState().unsubscribe(31);
    while (mockAuthenticatedFetch.mock.calls.length < 3) await Promise.resolve();
    remove.gate.resolve(selectionAck(removeRequest, false));
    await expect(deselect).resolves.toBe(200);
    subscriptions.gate.resolve(subscriptionsResponse(true));
    sources.gate.resolve(sourcesResponse({
      ...source,
      selected: true,
      grant_epoch: 'grant-b',
      friendship_episode_id: 'episode-b',
      friendship_episode_uuid: 'episode-uuid-b',
    } as any));
    await expect(load).resolves.toBe(true);

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 31 }],
      availableSources: [{ selected: true, grant_epoch: 'grant-b' }],
      selectionPending: {},
    });
  });

  test('old shared sources response cannot undo a newer POST 403 authorization denial', async () => {
    const subscriptions = deferred();
    const sources = deferred();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST') {
        return Promise.resolve({ ok: false, status: 403 });
      }
      if (path === '/api/memory-subscriptions') return subscriptions.promise;
      if (path === '/api/friend-sharing/sources') return sources.promise;
      throw new Error(`unexpected ${path}`);
    });

    const load = useMemorySubscriptionsStore.getState().load(true);
    while (mockAuthenticatedFetch.mock.calls.length < 2) await Promise.resolve();
    await expect(useMemorySubscriptionsStore.getState().subscribe(31)).resolves.toBe(403);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].sharing_status).toBe('not_shared');
    subscriptions.gate.resolve(subscriptionsResponse(false));
    sources.gate.resolve(sourcesResponse({ ...source, selected: false }));
    await expect(load).resolves.toBe(true);

    expect(useMemorySubscriptionsStore.getState().availableSources[0]).toMatchObject({
      selected: false,
      sharing_status: 'not_shared',
    });
  });

  test('queued old-session mutation never dispatches after same-account reset/login', async () => {
    const first = deferred();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST') return first.promise;
      if (path === '/api/memory-subscriptions/31' && init.method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 200 });
      }
      throw new Error(`unexpected ${path}`);
    });

    const select = useMemorySubscriptionsStore.getState().subscribe(31);
    while (mockAuthenticatedFetch.mock.calls.length < 1) await Promise.resolve();
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    const queuedDeselect = useMemorySubscriptionsStore.getState().unsubscribe(31);
    useMemorySubscriptionsStore.getState().reset();
    useAppStore.setState({ user: { id: 'viewer-a' } as any, isLoggedIn: true, hydrated: true });
    await expect(Promise.all([select, queuedDeselect])).resolves.toEqual([0, 0]);

    expect(mockAuthenticatedFetch.mock.calls.filter(([path]) => path === '/api/memory-subscriptions/31'))
      .toHaveLength(0);
  });

  test('HTTP 200 invalid subscriptions schema is an error and retains confirmed selection', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Adversarial Friend' }],
      availableSources: [{ ...source, selected: true }],
    });
    mockAuthenticatedFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ unexpected: true }) })
      .mockResolvedValueOnce(sourcesResponse({ ...source, selected: true }));

    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(false);

    expect(useMemorySubscriptionsStore.getState().subscriptions.map(item => item.friend_id)).toEqual([31]);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(true);
    expect(useMemorySubscriptionsStore.getState().error).not.toBeNull();
  });

  test('HTTP 200 shared source without grant identity is rejected before it can authorize geometry', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(subscriptionsResponse(false))
      .mockResolvedValueOnce(sourcesResponse({
        ...source,
        grant_epoch: null,
        friendship_episode_id: null,
      } as any));

    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(false);
    expect(useMemorySubscriptionsStore.getState().error).not.toBeNull();
  });
});
