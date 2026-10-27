const mockAuthenticatedFetch = jest.fn();
const mockStorageGetItem = jest.fn(async () => null as string | null);

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(args[0], args[1]),
}));
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: (_key: string, _options?: unknown) => mockStorageGetItem(),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { useAppStore } from '../../../store/useAppStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import {
  MEMORY_SELECTION_INTENT_READ_TIMEOUT_MS,
  MEMORY_SELECTION_REQUEST_TIMEOUT_MS,
  useMemorySubscriptionsStore,
} from '../store/useMemorySubscriptionsStore';

const source = {
  friend_id: '31',
  friend_name: 'Terminal Friend',
  selected: false,
  authorization_version: 7,
  grant_epoch: 'grant-a',
  friendship_episode_id: 'episode-a',
  friendship_episode_uuid: 'episode-uuid-a',
  effective_at: '2026-10-23T00:00:00.000Z',
  sharing_status: 'shared' as const,
  coverage_scope: 'full_history_delayed_v1' as const,
};

function sourcesResponse(selected = false) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ complete: true, sources: [{ ...source, selected }] }),
  };
}

function subscriptionsResponse(selected = false) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      limit: null,
      subscriptions: selected ? [{ friend_id: 31, friend_name: 'Terminal Friend' }] : [],
    }),
  };
}

function selectionAck(init: any, selected: boolean, status = selected ? 201 : 200) {
  const request = JSON.parse(init.body);
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

describe('Memory authority operations always reach a bounded terminal state', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAuthenticatedFetch.mockReset();
    mockStorageGetItem.mockReset();
    mockStorageGetItem.mockResolvedValue(null);
    useAppStore.setState({ user: { id: 'viewer-a' } as any, isLoggedIn: true, hydrated: true });
    useFriendMemoryStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
  });

  afterEach(() => {
    useMemorySubscriptionsStore.getState().reset();
    useFriendMemoryStore.getState().reset();
    jest.useRealTimers();
  });

  test('a never-resolving authority request releases loading and permits a healthy recovery load', async () => {
    mockAuthenticatedFetch.mockImplementationOnce(() => new Promise(() => undefined));
    const first = useMemorySubscriptionsStore.getState().load(true);
    expect(useMemorySubscriptionsStore.getState().loading).toBe(true);

    await jest.advanceTimersByTimeAsync(MEMORY_SELECTION_REQUEST_TIMEOUT_MS + 1);
    await expect(first).resolves.toBe(false);
    expect(useMemorySubscriptionsStore.getState().loading).toBe(false);
    expect(useMemorySubscriptionsStore.getState().error).toContain('timed out');

    mockAuthenticatedFetch
      .mockResolvedValueOnce(sourcesResponse(false))
      .mockResolvedValueOnce(subscriptionsResponse(false));
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState().loading).toBe(false);
  });

  test('headers without a completing JSON body time out instead of occupying the single-flight load', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => new Promise(() => undefined),
    });
    const load = useMemorySubscriptionsStore.getState().load(true);

    await jest.advanceTimersByTimeAsync(MEMORY_SELECTION_REQUEST_TIMEOUT_MS + 1);
    await expect(load).resolves.toBe(false);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({ loading: false });
  });

  test('hung durable intent hydration fails closed to an explicit terminal instead of hanging authority', async () => {
    mockStorageGetItem.mockImplementationOnce(() => new Promise(() => undefined));
    mockAuthenticatedFetch
      .mockResolvedValueOnce(sourcesResponse(false))
      .mockResolvedValueOnce(subscriptionsResponse(false));
    const load = useMemorySubscriptionsStore.getState().load(true);

    await jest.advanceTimersByTimeAsync(MEMORY_SELECTION_INTENT_READ_TIMEOUT_MS + 1);
    await expect(load).resolves.toBe(false);
    expect(useMemorySubscriptionsStore.getState().loading).toBe(false);
    expect(useMemorySubscriptionsStore.getState().error).toContain('intent restore timed out');
  });

  test('POST written on the server but ACK lost times out, releases its queue, and duplicate retry confirms selection', async () => {
    useMemorySubscriptionsStore.setState({ availableSources: [source] });
    let releaseOld!: (value: any) => void;
    mockAuthenticatedFetch.mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }));
    const first = useMemorySubscriptionsStore.getState().subscribe(31);
    await jest.advanceTimersByTimeAsync(MEMORY_SELECTION_REQUEST_TIMEOUT_MS + 1);
    await expect(first).resolves.toBe(0);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      selectionPending: { '31': 'select' },
      selectionLastFailure: { kind: 'timeout' },
    });

    mockAuthenticatedFetch.mockImplementationOnce(async (_path: string, init: any) => selectionAck(init, true));
    await expect(useMemorySubscriptionsStore.getState().retrySelectionIntents()).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      selectionPending: {},
      availableSources: [{ selected: true }],
    });
    const postBodies = mockAuthenticatedFetch.mock.calls
      .filter(([path, init]) => path === '/api/memory-subscriptions' && init?.method === 'POST')
      .map(([, init]) => JSON.parse(init.body));
    expect(postBodies).toHaveLength(2);
    expect(postBodies[1].selection_chain_id).toBe(postBodies[0].selection_chain_id);
    expect(postBodies[1].selection_sequence).toBeGreaterThan(postBodies[0].selection_sequence);

    releaseOld({ ok: true, status: 201 });
    await Promise.resolve();
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(true);
  });

  test('DELETE written on the server but ACK lost is recovered by a newer ordered deselect without resurrection', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Terminal Friend' }],
      availableSources: [{ ...source, selected: true }],
    });
    mockAuthenticatedFetch.mockImplementationOnce(() => new Promise(() => undefined));
    const first = useMemorySubscriptionsStore.getState().unsubscribe(31);
    await jest.advanceTimersByTimeAsync(MEMORY_SELECTION_REQUEST_TIMEOUT_MS + 1);
    await expect(first).resolves.toBe(0);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({ '31': 'deselect' });

    mockAuthenticatedFetch.mockImplementationOnce(async (_path: string, init: any) => selectionAck(init, false));
    await expect(useMemorySubscriptionsStore.getState().retrySelectionIntents()).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      selectionPending: {},
      availableSources: [{ selected: false }],
    });
    const deleteBodies = mockAuthenticatedFetch.mock.calls
      .filter(([path, init]) => path === '/api/memory-subscriptions/31' && init?.method === 'DELETE')
      .map(([, init]) => JSON.parse(init.body));
    expect(deleteBodies).toHaveLength(2);
    expect(deleteBodies[1].selection_chain_id).toBe(deleteBodies[0].selection_chain_id);
    expect(deleteBodies[1].selection_sequence).toBeGreaterThan(deleteBodies[0].selection_sequence);
  });

  test('server stale-order floor is adopted and the next bounded retry can reconcile', async () => {
    useMemorySubscriptionsStore.setState({ availableSources: [source] });
    let firstBody: any;
    mockAuthenticatedFetch
      .mockImplementationOnce((_path: string, init: any) => {
        firstBody = JSON.parse(init.body);
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            code: 'STALE_SELECTION_INTENT',
            selected: false,
            selection_chain_id: firstBody.selection_chain_id,
            selection_sequence: firstBody.selection_sequence + 4,
            selection_request_id: '00000000-0000-4000-8000-000000000001',
          }),
        });
      })
      .mockImplementationOnce(async (_path: string, init: any) => selectionAck(init, true));

    await expect(useMemorySubscriptionsStore.getState().subscribe(31)).resolves.toBe(409);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({ '31': 'select' });
    await expect(useMemorySubscriptionsStore.getState().retrySelectionIntents()).resolves.toBe(true);

    const postBodies = mockAuthenticatedFetch.mock.calls
      .filter(([path, init]) => path === '/api/memory-subscriptions' && init?.method === 'POST')
      .map(([, init]) => JSON.parse(init.body));
    expect(postBodies).toHaveLength(2);
    expect(postBodies[1].selection_chain_id).toBe(firstBody.selection_chain_id);
    expect(postBodies[1].selection_sequence).toBe(firstBody.selection_sequence + 5);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      selectionPending: {},
      availableSources: [{ selected: true }],
    });
  });

  test('a legacy or malformed 201 cannot confirm a new-client select without the ordered ACK identity', async () => {
    useMemorySubscriptionsStore.setState({ availableSources: [source] });
    mockAuthenticatedFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ user_id: 'viewer-a', friend_id: 31 }),
    });

    await expect(useMemorySubscriptionsStore.getState().subscribe(31)).resolves.toBe(0);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 31 }],
      availableSources: [{ selected: false }],
      selectionPending: { '31': 'select' },
      selectionLastFailure: { kind: 'payload' },
    });
  });

  test('a legacy or malformed 200 cannot clear a deselect until the ordered ACK identity is proven', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Terminal Friend' }],
      availableSources: [{ ...source, selected: true }],
    });
    mockAuthenticatedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Unsubscribed' }),
    });

    await expect(useMemorySubscriptionsStore.getState().unsubscribe(31)).resolves.toBe(0);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      availableSources: [{ selected: true }],
      selectionPending: { '31': 'deselect' },
      selectionLastFailure: { kind: 'payload' },
    });
  });
});
