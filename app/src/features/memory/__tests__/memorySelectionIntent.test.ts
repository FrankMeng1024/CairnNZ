const mockAuthenticatedFetch = jest.fn();

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(...args),
}));
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { useAppStore } from '../../../store/useAppStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';
import fs from 'node:fs';
import path from 'node:path';

const source = {
  friend_id: '31', friend_name: 'QA Friend', selected: false,
  authorization_version: 7, effective_at: '2026-10-23T00:00:00.000Z',
  sharing_status: 'shared' as const,
  coverage_scope: 'full_history_delayed_v1' as const,
};

describe('Memory friend selection intent', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    useAppStore.setState({ user: { id: 'viewer-a' } as any, isLoggedIn: true, hydrated: true });
    useMemorySubscriptionsStore.getState().reset();
    useMemorySubscriptionsStore.setState({ availableSources: [source] });
  });

  afterEach(() => useMemorySubscriptionsStore.getState().reset());

  test('transport failure keeps the deliberate checked intent and central retry commits it', async () => {
    mockAuthenticatedFetch.mockRejectedValueOnce(new Error('offline'));
    const request = useMemorySubscriptionsStore.getState().subscribe(31);

    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(true);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({ '31': 'select' });

    await expect(request).resolves.toBe(0);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      selectionError: 'offline',
      selectionPending: { '31': 'select' },
    });
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(true);

    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    await expect(useMemorySubscriptionsStore.getState().retrySelectionIntents()).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({});
    expect(useMemorySubscriptionsStore.getState().selectionError).toBeNull();
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(true);
  });

  test('authorization rejection is the only select failure that fails closed', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    const request = useMemorySubscriptionsStore.getState().subscribe(31);
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(true);

    await expect(request).resolves.toBe(403);
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(false);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      selectionPending: {},
      selectionError: 'unauthorized',
    });
  });

  test('projection requests wait for a new selection grant but zero selection bypasses pending preference persistence', () => {
    const fogLayer = fs.readFileSync(path.resolve(__dirname, '../components/FogLayer.tsx'), 'utf8');
    const memoryScreen = fs.readFileSync(path.resolve(__dirname, '../screens/MemoryScreen.tsx'), 'utf8');
    expect(fogLayer).toContain("scope === 'combined' && !selectionPendingKey");
    expect(fogLayer).toMatch(/selectedFriendIds\.length === 0[\s\S]{0,120}subscriptionsLoading/);
    expect(memoryScreen).toContain('selectionStillPending');
    expect(memoryScreen).toMatch(/selectionStillPending\s+\? Promise\.resolve\(\)/);
  });

  test('deselect then reselect is persisted in request order and an old DELETE cannot win', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'QA Friend' }],
      availableSources: [{ ...source, selected: true }],
    });
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>(resolve => { releaseDelete = resolve; });
    mockAuthenticatedFetch.mockImplementation(async (_path: string, init: any) => {
      if (init.method === 'DELETE') {
        await deleteGate;
        return { ok: true, status: 204 };
      }
      return { ok: true, status: 201 };
    });

    const deselect = useMemorySubscriptionsStore.getState().unsubscribe(31);
    const reselect = useMemorySubscriptionsStore.getState().subscribe(31);
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(true);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);

    releaseDelete();
    await expect(Promise.all([deselect, reselect])).resolves.toEqual([0, 201]);
    expect(mockAuthenticatedFetch.mock.calls.map(([, init]) => init.method)).toEqual(['DELETE', 'POST']);
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(true);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({});
  });

  test('last-friend DELETE 503 leaves immediate Mine intent and restart does not resurrect the friend', async () => {
    const { storage } = require('../../../store/storage');
    const values = new Map<string, string>();
    storage.getItem.mockImplementation(async (key: string) => values.get(key) ?? null);
    storage.setItem.mockImplementation(async (key: string, value: string) => { values.set(key, value); });
    storage.removeItem.mockImplementation(async (key: string) => { values.delete(key); });
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'QA Friend' }],
      availableSources: [{ ...source, selected: true }],
    });
    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const pendingDelete = useMemorySubscriptionsStore.getState().unsubscribe(31);
    expect(useMemorySubscriptionsStore.getState().subscriptions).toEqual([]);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(false);
    await expect(pendingDelete).resolves.toBe(503);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      selectionPending: { '31': 'deselect' },
      selectionError: 'unavailable',
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    useMemorySubscriptionsStore.getState().reset();
    useMemorySubscriptionsStore.setState({ availableSources: [{ ...source, selected: true }] });
    mockAuthenticatedFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ limit: null, subscriptions: [{ friend_id: 31, friend_name: 'QA Friend' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sources: [{ ...source, selected: true }] }),
      });

    await expect(useMemorySubscriptionsStore.getState().load()).resolves.toBe(true);
    expect(useMemorySubscriptionsStore.getState().subscriptions).toEqual([]);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(false);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({ '31': 'deselect' });
  });

  test('ordinary focus reuses a fresh authority read while explicit Retry forces revalidation', async () => {
    const subscriptionResponse = () => ({
      ok: true, status: 200,
      json: async () => ({ limit: null, subscriptions: [] }),
    });
    const sourceResponse = () => ({
      ok: true, status: 200,
      json: async () => ({ sources: [source] }),
    });
    mockAuthenticatedFetch
      .mockResolvedValueOnce(subscriptionResponse())
      .mockResolvedValueOnce(sourceResponse());

    await expect(useMemorySubscriptionsStore.getState().load()).resolves.toBe(true);
    await expect(useMemorySubscriptionsStore.getState().load()).resolves.toBe(true);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);

    mockAuthenticatedFetch
      .mockResolvedValueOnce(subscriptionResponse())
      .mockResolvedValueOnce(sourceResponse());
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(4);
  });

  test('two screen consumers join one authority request instead of classifying loading as failure', async () => {
    let releaseSubscriptions!: (value: any) => void;
    let releaseSources!: (value: any) => void;
    mockAuthenticatedFetch
      .mockImplementationOnce(() => new Promise(resolve => { releaseSubscriptions = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseSources = resolve; }));

    const first = useMemorySubscriptionsStore.getState().load();
    while (mockAuthenticatedFetch.mock.calls.length < 2) await Promise.resolve();
    const second = useMemorySubscriptionsStore.getState().load();
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    releaseSubscriptions({ ok: true, status: 200, json: async () => ({ limit: null, subscriptions: [] }) });
    releaseSources({ ok: true, status: 200, json: async () => ({ sources: [source] }) });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(useMemorySubscriptionsStore.getState().loading).toBe(false);
  });

  test.each([
    ['select', () => useMemorySubscriptionsStore.getState().subscribe(31)],
    ['deselect', () => {
      useMemorySubscriptionsStore.setState({
        subscriptions: [{ friend_id: 31, friend_name: 'QA Friend' }],
        availableSources: [{ ...source, selected: true }],
      });
      return useMemorySubscriptionsStore.getState().unsubscribe(31);
    }],
  ] as const)('ACCOUNT_CHANGED cancellation retires the current %s mutation without an offline banner', async (_label, mutate) => {
    const cancelled = Object.assign(new Error('Account request cancelled'), { code: 'ACCOUNT_CHANGED' });
    mockAuthenticatedFetch.mockRejectedValueOnce(cancelled);

    await expect(mutate()).resolves.toBe(0);

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      selectionPending: {},
      selectionError: null,
      selectionLastFailure: { kind: 'cancelled', causeCode: 'ACCOUNT_CHANGED' },
    });
  });
});
