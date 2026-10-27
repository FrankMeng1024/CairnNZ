const mockAuthenticatedFetch = jest.fn();
const mockStorageGetItem = jest.fn(async () => null as string | null);
const mockStorageSetItem = jest.fn<Promise<void>, any[]>(async () => undefined);
const mockStorageRemoveItem = jest.fn<Promise<void>, any[]>(async () => undefined);

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(args[0], args[1]),
}));
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: (_key: string, _options?: unknown) => mockStorageGetItem(),
    setItem: (...args: any[]) => mockStorageSetItem(args[0], args[1], args[2]),
    removeItem: (key: string, options?: unknown) => mockStorageRemoveItem(key, options),
  },
}));

import { useAppStore } from '../../../store/useAppStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import {
  MEMORY_SELECTION_INTENT_READ_TIMEOUT_MS,
  MEMORY_SELECTION_INTENT_WRITE_TIMEOUT_MS,
  useMemorySubscriptionsStore,
} from '../store/useMemorySubscriptionsStore';

const source = {
  friend_id: '31',
  friend_name: 'Closure Friend',
  selected: true,
  authorization_version: 7,
  grant_epoch: 'grant-a',
  friendship_episode_id: 'episode-a',
  friendship_episode_uuid: 'episode-uuid-a',
  effective_at: '2026-10-23T00:00:00.000Z',
  sharing_status: 'shared' as const,
  coverage_scope: 'full_history_delayed_v1' as const,
};

const notSharedSource = {
  ...source,
  selected: false,
  authorization_version: 0,
  grant_epoch: null,
  friendship_episode_id: null,
  friendship_episode_uuid: null,
  sharing_status: 'not_shared' as const,
  coverage_scope: null,
};

const sourcesResponse = (sources: any[] = [source], complete = true) => ({
  ok: true,
  status: 200,
  json: async () => ({ complete, sources }),
});

const subscriptionsResponse = (selected = true) => ({
  ok: true,
  status: 200,
  json: async () => ({
    limit: null,
    subscriptions: selected ? [{ friend_id: 31, friend_name: 'Closure Friend' }] : [],
  }),
});

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

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve };
}

describe('Memory authority closure edge cases', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    mockStorageGetItem.mockReset();
    mockStorageGetItem.mockResolvedValue(null);
    mockStorageSetItem.mockReset();
    mockStorageSetItem.mockResolvedValue(undefined);
    mockStorageRemoveItem.mockReset();
    mockStorageRemoveItem.mockResolvedValue(undefined);
    useAppStore.setState({ user: { id: 'viewer-a' } as any, isLoggedIn: true, hydrated: true });
    useFriendMemoryStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
  });

  afterEach(() => {
    useMemorySubscriptionsStore.getState().reset();
    useFriendMemoryStore.getState().reset();
    jest.useRealTimers();
  });

  test('durable-intent timeout aborts the cold authority chain before subscriptions can dispatch', async () => {
    jest.useFakeTimers();
    mockStorageGetItem.mockImplementation(() => new Promise(() => undefined));
    const lateSources = deferred<any>();
    mockAuthenticatedFetch.mockImplementationOnce(() => lateSources.promise);

    const load = useMemorySubscriptionsStore.getState().load(true);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(MEMORY_SELECTION_INTENT_READ_TIMEOUT_MS + 1);
    await expect(load).resolves.toBe(false);

    lateSources.resolve(sourcesResponse());
    await Promise.resolve();
    await Promise.resolve();
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({ loading: false });
  });

  test('a cold partial sources list reaches an explicit error terminal and is not authoritative success', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(sourcesResponse([source], false))
      .mockResolvedValueOnce(subscriptionsResponse(true));

    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(false);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      loading: false,
      authorityValidatedAtMs: 0,
    });
    expect(useMemorySubscriptionsStore.getState().error).toContain('incomplete authorization list');
  });

  test('DELETE 403 keeps the confirmed friend hidden and retryable until idempotent reconciliation', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Closure Friend' }],
      availableSources: [source],
      authorityValidatedAtMs: Date.now(),
    });
    const oldSubscriptions = deferred<any>();
    const oldSources = deferred<any>();
    mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && !init.method) return oldSubscriptions.promise;
      if (path === '/api/friend-sharing/sources') return oldSources.promise;
      if (path === '/api/memory-subscriptions/31' && init.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 403 });
      }
      throw new Error(`unexpected ${path}`);
    });

    const staleLoad = useMemorySubscriptionsStore.getState().load(true);
    while (mockAuthenticatedFetch.mock.calls.length < 2) await Promise.resolve();
    await expect(useMemorySubscriptionsStore.getState().unsubscribe(31)).resolves.toBe(403);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      selectionPending: { '31': 'deselect' },
      selectionError: 'unauthorized',
    });

    oldSubscriptions.resolve(subscriptionsResponse(true));
    oldSources.resolve(sourcesResponse([source]));
    await expect(staleLoad).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      selectionPending: { '31': 'deselect' },
    });

    mockAuthenticatedFetch.mockReset();
    mockAuthenticatedFetch.mockImplementationOnce(async (_path: string, init: any) => selectionAck(init, false));
    await expect(useMemorySubscriptionsStore.getState().retrySelectionIntents()).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      selectionPending: {},
      availableSources: [{ selected: false }],
    });
  });

  test('a hung durable write releases its queue and a late old completion is repaired to latest intent', async () => {
    jest.useFakeTimers();
    useMemorySubscriptionsStore.setState({ availableSources: [{ ...source, selected: false }] });
    const oldWrite = deferred<void>();
    const durable = new Map<string, string>();
    mockStorageSetItem
      .mockImplementationOnce(() => oldWrite.promise)
      .mockImplementation(async (key: string, value: string) => { durable.set(key, value); });
    mockStorageRemoveItem.mockImplementation(async (key: string) => { durable.delete(key); });
    mockAuthenticatedFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(useMemorySubscriptionsStore.getState().subscribe(31)).resolves.toBe(503);
    await expect(useMemorySubscriptionsStore.getState().unsubscribe(31)).resolves.toBe(503);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({ '31': 'deselect' });

    await jest.advanceTimersByTimeAsync(MEMORY_SELECTION_INTENT_WRITE_TIMEOUT_MS + 1);
    await Promise.resolve();
    expect([...durable.values()].map(value => JSON.parse(value))).toContainEqual({ '31': 'deselect' });

    oldWrite.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect([...durable.values()].map(value => JSON.parse(value))).toContainEqual({ '31': 'deselect' });
  });

  test('durable select is retired when current authority says not shared and retry cannot loop forever', async () => {
    mockStorageGetItem.mockResolvedValue(JSON.stringify({ '31': 'select' }));
    mockAuthenticatedFetch
      .mockResolvedValueOnce(sourcesResponse([notSharedSource]))
      .mockResolvedValueOnce(subscriptionsResponse(false));

    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      selectionPending: {},
      availableSources: [{ sharing_status: 'not_shared', selected: false }],
    });
    const calls = mockAuthenticatedFetch.mock.calls.length;
    await expect(useMemorySubscriptionsStore.getState().retrySelectionIntents()).resolves.toBe(true);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(calls);
  });

  test('durable select is retired when a complete authority list omits the source', async () => {
    mockStorageGetItem.mockResolvedValue(JSON.stringify({ '31': 'select' }));
    mockAuthenticatedFetch
      .mockResolvedValueOnce(sourcesResponse([]))
      .mockResolvedValueOnce(subscriptionsResponse(false));

    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      selectionPending: {},
      availableSources: [],
      loading: false,
    });
  });

  test('POST 404 is a definitive unavailable terminal rather than an endless optimistic selection', async () => {
    useMemorySubscriptionsStore.setState({ availableSources: [{ ...source, selected: false }] });
    mockAuthenticatedFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: 'MEMORY_SOURCE_NOT_AVAILABLE' }),
    });

    await expect(useMemorySubscriptionsStore.getState().subscribe(31)).resolves.toBe(404);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      selectionPending: {},
      selectionError: 'unauthorized',
      availableSources: [{ selected: false, sharing_status: 'not_shared' }],
    });
  });

  test.each(['subscriptions', 'sources'] as const)(
    'HTTP 200 invalid %s JSON has the typed localized terminal and retains cache',
    async target => {
      useMemorySubscriptionsStore.setState({
        subscriptions: [{ friend_id: 31, friend_name: 'Closure Friend' }],
        availableSources: [source],
      });
      const invalidJson = {
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('provider parse detail'); },
      };
      mockAuthenticatedFetch.mockImplementation((path: string) => {
        if (path === '/api/memory-subscriptions') {
          return Promise.resolve(target === 'subscriptions' ? invalidJson : subscriptionsResponse(true));
        }
        if (path === '/api/friend-sharing/sources') {
          return Promise.resolve(target === 'sources' ? invalidJson : sourcesResponse([source]));
        }
        throw new Error(`unexpected ${path}`);
      });

      await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(false);
      expect(useMemorySubscriptionsStore.getState()).toMatchObject({
        loading: false,
        subscriptions: [{ friend_id: 31 }],
        availableSources: [{ selected: true }],
      });
      expect(useMemorySubscriptionsStore.getState().error)
        .toBe('Memory friends returned invalid data. Try again.');
    },
  );

  test('invalid refresh cannot be hidden behind a fresh fast-path authority timestamp', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Closure Friend' }],
      availableSources: [source],
      authorityValidatedAtMs: Date.now(),
    });
    mockAuthenticatedFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ nope: true }) })
      .mockResolvedValueOnce(sourcesResponse([source]));
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(false);
    expect(useMemorySubscriptionsStore.getState().error).not.toBeNull();

    mockAuthenticatedFetch
      .mockResolvedValueOnce(subscriptionsResponse(true))
      .mockResolvedValueOnce(sourcesResponse([source]));
    await expect(useMemorySubscriptionsStore.getState().load()).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState().error).toBeNull();
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(4);
  });
});
