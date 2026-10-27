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
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';
import fs from 'node:fs';
import path from 'node:path';

const source = {
  friend_id: '31', friend_name: 'QA Friend', selected: false,
  authorization_version: 7, effective_at: '2026-10-23T00:00:00.000Z',
  sharing_status: 'shared' as const,
  coverage_scope: 'full_history_delayed_v1' as const,
};

const authorizedSource = {
  ...source,
  grant_epoch: 'grant-a',
  friendship_episode_id: 'episode-a',
};

function friendSnapshotResponse() {
  const now = Date.now();
  return {
    ok: true,
    status: 200,
    json: async () => ({
      revoked_friend_ids: [],
      projections: [{
        source_friend_id: '31',
        authorization_version: 7,
        grant_epoch: 'grant-a',
        friendship_episode_id: 'episode-a',
        coverage_scope: 'full_history_delayed_v1',
        server_authorized_at: new Date(now).toISOString(),
        authorization_expires_at: new Date(now + 5 * 60_000).toISOString(),
        manifest: {
          snapshot_id: 'selection-snapshot',
          dataset_revision: 'selection-snapshot',
          coverage_rule_version: 4,
          as_of: new Date(now).toISOString(),
          expected_pages: 1,
          expected_tiles: 1,
          expected_evidence_count: 1,
          regions: [],
          complete: false,
        },
        page: {
          snapshot_id: 'selection-snapshot',
          page_index: 0,
          tiles: [{
            id: 'selection-tile',
            bbox: [174, -42, 176, -40],
            evidence_count: 1,
            geometry_sha256: 'selection-geometry',
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

describe('Memory friend selection intent', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    useAppStore.setState({ user: { id: 'viewer-a' } as any, isLoggedIn: true, hydrated: true });
    useFriendMemoryStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
    useMemorySubscriptionsStore.setState({ availableSources: [source] });
  });

  afterEach(() => {
    useFriendMemoryStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
  });

  async function prepareHiddenCachedFriend() {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'QA Friend' }],
      availableSources: [{ ...authorizedSource, selected: true }],
    });
    mockAuthenticatedFetch.mockImplementation(async (path: string, init: any) => {
      if (path === '/api/friend-sharing/coverage-snapshot') return friendSnapshotResponse();
      if (init?.method === 'DELETE') return { ok: true, status: 200 };
      throw new Error(`unexpected ${path}`);
    });
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
    await expect(useMemorySubscriptionsStore.getState().unsubscribe(31)).resolves.toBe(200);
    expect(useFriendMemoryStore.getState().projections['31']).toBeDefined();
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
  }

  test.each([
    ['ACCOUNT_CHANGED', Object.assign(new Error('Account request cancelled'), { code: 'ACCOUNT_CHANGED' })],
    ['AbortError', Object.assign(new Error('Request aborted'), { name: 'AbortError' })],
  ])('%s reselect cancellation rolls back optimistic UI and never reveals cached geometry without ACK', async (_label, cancelled) => {
    await prepareHiddenCachedFriend();
    mockAuthenticatedFetch.mockImplementation(async (path: string) => {
      if (path === '/api/memory-subscriptions') throw cancelled;
      throw new Error(`unexpected ${path}`);
    });

    const reselect = useMemorySubscriptionsStore.getState().subscribe(31);
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(true);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({ '31': 'select' });
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);

    await expect(reselect).resolves.toBe(0);

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      selectionPending: {},
      selectionError: null,
      selectionLastFailure: { kind: 'cancelled' },
    });
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(false);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(false);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
  });

  test('cancelled deselect restores the last server-confirmed selection without losing cache', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'QA Friend' }],
      availableSources: [{ ...authorizedSource, selected: true }],
    });
    mockAuthenticatedFetch.mockImplementation(async (path: string) => {
      if (path === '/api/friend-sharing/coverage-snapshot') return friendSnapshotResponse();
      if (path === '/api/memory-subscriptions/31') {
        throw Object.assign(new Error('Account request cancelled'), { code: 'ACCOUNT_CHANGED' });
      }
      throw new Error(`unexpected ${path}`);
    });
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();

    const deselect = useMemorySubscriptionsStore.getState().unsubscribe(31);
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(false);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
    await expect(deselect).resolves.toBe(0);

    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({});
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(true);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(true);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  });

  test('genuine reselect ACK reveals the same cached geometry without another coverage request', async () => {
    await prepareHiddenCachedFriend();
    const geometry = useFriendMemoryStore.getState().projections['31'].geometry;
    mockAuthenticatedFetch.mockImplementation(async (path: string) => {
      if (path === '/api/memory-subscriptions') return { ok: true, status: 201 };
      throw new Error(`unexpected ${path}`);
    });

    const reselect = useMemorySubscriptionsStore.getState().subscribe(31);
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(true);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
    await expect(reselect).resolves.toBe(201);

    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(true);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({});
    expect(useFriendMemoryStore.getState().projections['31'].geometry).toBe(geometry);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
    expect(mockAuthenticatedFetch.mock.calls.filter(call => call[0] === '/api/friend-sharing/coverage-snapshot')).toHaveLength(1);
  });

  test('rapid select then deselect never flashes cached geometry and latest intent wins', async () => {
    await prepareHiddenCachedFriend();
    let releaseSelect!: () => void;
    mockAuthenticatedFetch.mockImplementation(async (path: string, init: any) => {
      if (path === '/api/memory-subscriptions' && init?.method === 'POST') {
        await new Promise<void>(resolve => { releaseSelect = resolve; });
        return { ok: true, status: 201 };
      }
      if (path === '/api/memory-subscriptions/31' && init?.method === 'DELETE') {
        return { ok: true, status: 200 };
      }
      throw new Error(`unexpected ${path}`);
    });

    const select = useMemorySubscriptionsStore.getState().subscribe(31);
    const deselect = useMemorySubscriptionsStore.getState().unsubscribe(31);
    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(false);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({ '31': 'deselect' });
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
    while (!releaseSelect) await Promise.resolve();
    releaseSelect();
    await expect(Promise.all([select, deselect])).resolves.toEqual([0, 200]);

    expect(useMemorySubscriptionsStore.getState().isSubscribed(31)).toBe(false);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(false);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({});
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
  });

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
    // Checkbox intent is immediate; source.selected remains the last
    // server-confirmed value until DELETE acknowledgement.
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(true);
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
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(true);
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
