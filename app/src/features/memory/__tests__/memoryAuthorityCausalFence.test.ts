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

const source = {
  friend_id: '31',
  friend_name: 'Causal Friend',
  selected: false,
  authorization_version: 7,
  grant_epoch: 'grant-a',
  friendship_episode_id: 'episode-a',
  friendship_episode_uuid: 'episode-uuid-a',
  effective_at: '2026-10-23T00:00:00.000Z',
  sharing_status: 'shared' as const,
  coverage_scope: 'full_history_delayed_v1' as const,
};

const secondSource = {
  ...source,
  friend_id: '32',
  friend_name: 'Independent Friend',
  grant_epoch: 'grant-b',
  friendship_episode_id: 'episode-b',
  friendship_episode_uuid: 'episode-uuid-b',
};

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
        friendship_episode_uuid: 'episode-uuid-a',
        coverage_scope: 'full_history_delayed_v1',
        server_authorized_at: new Date(now).toISOString(),
        authorization_expires_at: new Date(now + 5 * 60_000).toISOString(),
        manifest: {
          snapshot_id: 'causal-snapshot',
          dataset_revision: 'causal-snapshot',
          coverage_rule_version: 4,
          as_of: new Date(now).toISOString(),
          expected_pages: 1,
          expected_tiles: 1,
          expected_evidence_count: 1,
          regions: [],
          complete: false,
        },
        page: {
          snapshot_id: 'causal-snapshot',
          page_index: 0,
          tiles: [{
            id: 'causal-tile',
            bbox: [174, -42, 176, -40],
            evidence_count: 1,
            geometry_sha256: 'causal-geometry',
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

type DeferredAuthorityRead = {
  path: string;
  selectedAtDispatch: boolean;
  resolve: () => void;
};

function installAuthorityRace(initialSelected: boolean) {
  let serverSelected = initialSelected;
  const reads: DeferredAuthorityRead[] = [];
  mockAuthenticatedFetch.mockImplementation((path: string, init: any = {}) => {
    if (path === '/api/memory-subscriptions' && init.method === 'POST') {
      serverSelected = true;
      return Promise.resolve(selectionAck(init, true));
    }
    if (path === '/api/memory-subscriptions/31' && init.method === 'DELETE') {
      serverSelected = false;
      return Promise.resolve(selectionAck(init, false));
    }
    if (path === '/api/memory-subscriptions' || path === '/api/friend-sharing/sources') {
      const selectedAtDispatch = serverSelected;
      return new Promise(resolve => {
        reads.push({
          path,
          selectedAtDispatch,
          resolve: () => resolve(path === '/api/memory-subscriptions'
            ? {
                ok: true,
                status: 200,
                json: async () => ({
                  limit: null,
                  subscriptions: selectedAtDispatch
                    ? [{ friend_id: 31, friend_name: 'Causal Friend' }]
                    : [],
                }),
              }
            : {
                ok: true,
                status: 200,
                json: async () => ({
                  complete: true,
                  sources: [{ ...source, selected: selectedAtDispatch }],
                }),
              }),
        });
      });
    }
    throw new Error(`unexpected ${path}`);
  });
  return {
    reads,
    get serverSelected() { return serverSelected; },
    async releaseAll() {
      // Candidate reads are deliberately sequential; baseline reads are
      // parallel. Drain either schedule without changing the captured value.
      for (let pass = 0; pass < 6; pass += 1) {
        const pending = reads.splice(0);
        pending.forEach(read => read.resolve());
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

describe('Memory authority reads are causally fenced from newer selection commits', () => {
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

  async function prepareVisibleCache() {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Causal Friend' }],
      availableSources: [{ ...source, selected: true }],
    });
    mockAuthenticatedFetch.mockImplementation(async (path: string) => {
      if (path === '/api/friend-sharing/coverage-snapshot') return friendSnapshotResponse();
      throw new Error(`unexpected ${path}`);
    });
    await useFriendMemoryStore.getState().hydrate('viewer-a');
    await useFriendMemoryStore.getState().loadSelectedProjections();
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  }

  async function prepareHiddenReusableCache() {
    await prepareVisibleCache();
    mockAuthenticatedFetch.mockImplementationOnce(async (_path: string, init: any) => selectionAck(init, false));
    await expect(useMemorySubscriptionsStore.getState().unsubscribe(31)).resolves.toBe(200);
    expect(useFriendMemoryStore.getState().projections['31']).toBeDefined();
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
  }

  test('older false GET cannot overturn a newer POST ACK or hide its reusable geometry', async () => {
    await prepareHiddenReusableCache();
    const race = installAuthorityRace(false);

    const oldLoad = useMemorySubscriptionsStore.getState().load(true);
    while (race.reads.length === 0) await Promise.resolve();
    const select = useMemorySubscriptionsStore.getState().subscribe(31);
    await expect(select).resolves.toBe(201);
    expect(race.serverSelected).toBe(true);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);

    await race.releaseAll();
    await expect(oldLoad).resolves.toBe(true);

    expect(useMemorySubscriptionsStore.getState().subscriptions.map(item => item.friend_id)).toEqual([31]);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(true);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(1);
  });

  test('older true GET cannot overturn a newer DELETE ACK or resurrect visible geometry', async () => {
    await prepareVisibleCache();
    const race = installAuthorityRace(true);

    const oldLoad = useMemorySubscriptionsStore.getState().load(true);
    while (race.reads.length === 0) await Promise.resolve();
    const deselect = useMemorySubscriptionsStore.getState().unsubscribe(31);
    await expect(deselect).resolves.toBe(200);
    expect(race.serverSelected).toBe(false);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);

    await race.releaseAll();
    await expect(oldLoad).resolves.toBe(true);

    expect(useMemorySubscriptionsStore.getState().subscriptions).toEqual([]);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(false);
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
  });

  test('first-use sources initialization is observed before subscriptions and publishes one coherent selection', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [],
      availableSources: [],
      authorityValidatedAtMs: 0,
    });
    let initialized = false;
    const dispatchOrder: string[] = [];
    mockAuthenticatedFetch.mockImplementation(async (path: string) => {
      dispatchOrder.push(path);
      if (path === '/api/friend-sharing/sources') {
        initialized = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ complete: true, sources: [{ ...source, selected: true }] }),
        };
      }
      if (path === '/api/memory-subscriptions') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            limit: null,
            subscriptions: initialized
              ? [{ friend_id: 31, friend_name: 'Causal Friend' }]
              : [],
          }),
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);

    expect(dispatchOrder).toEqual([
      '/api/friend-sharing/sources',
      '/api/memory-subscriptions',
    ]);
    expect(useMemorySubscriptionsStore.getState().subscriptions.map(item => item.friend_id)).toEqual([31]);
    expect(useMemorySubscriptionsStore.getState().availableSources[0].selected).toBe(true);
  });

  test('durable intent hydration that started before a newer ACK cannot overwrite the confirmed selection', async () => {
    const { storage } = require('../../../store/storage');
    let releaseHydration!: (value: string) => void;
    storage.getItem.mockImplementationOnce(() => new Promise(resolve => { releaseHydration = resolve; }));
    mockAuthenticatedFetch.mockImplementation(async (path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST') {
        return selectionAck(init, true);
      }
      if (path === '/api/memory-subscriptions') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ limit: null, subscriptions: [] }),
        };
      }
      if (path === '/api/friend-sharing/sources') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ complete: true, sources: [source] }),
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    const oldLoad = useMemorySubscriptionsStore.getState().load(true);
    while (mockAuthenticatedFetch.mock.calls.length < 2) await Promise.resolve();
    await expect(useMemorySubscriptionsStore.getState().subscribe(31)).resolves.toBe(201);
    releaseHydration(JSON.stringify({ '31': 'deselect' }));
    await expect(oldLoad).resolves.toBe(true);

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      selectionPending: {},
      subscriptions: [{ friend_id: 31 }],
      availableSources: [{ selected: true }],
    });
  });

  test('a partial sources page preserves omitted authorized selection instead of treating omission as revoke', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [
        { friend_id: 31, friend_name: 'Causal Friend' },
        { friend_id: 32, friend_name: 'Independent Friend' },
      ],
      availableSources: [
        { ...source, selected: true },
        { ...secondSource, selected: true },
      ],
      authorityValidatedAtMs: 0,
    });
    mockAuthenticatedFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          limit: null,
          subscriptions: [
            { friend_id: 31, friend_name: 'Causal Friend' },
            { friend_id: 32, friend_name: 'Independent Friend' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ complete: false, sources: [{ ...source, selected: true }] }),
      });

    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(false);

    expect(useMemorySubscriptionsStore.getState().availableSources.map(item => item.friend_id).sort())
      .toEqual(['31', '32']);
    expect(useMemorySubscriptionsStore.getState().subscriptions.map(item => item.friend_id).sort())
      .toEqual([31, 32]);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      loading: false,
      authorityValidatedAtMs: 0,
    });
    expect(useMemorySubscriptionsStore.getState().error).toContain('incomplete authorization list');
  });

  test('one friend mutation tail never blocks another friend confirmation', async () => {
    useMemorySubscriptionsStore.setState({ availableSources: [source, secondSource] });
    let releaseFirst!: () => void;
    mockAuthenticatedFetch.mockImplementation(async (path: string, init: any = {}) => {
      if (path !== '/api/memory-subscriptions' || init.method !== 'POST') {
        throw new Error(`unexpected ${path}`);
      }
      const friendId = Number(JSON.parse(init.body).friend_id);
      if (friendId === 31) await new Promise<void>(resolve => { releaseFirst = resolve; });
      return selectionAck(init, true);
    });

    const first = useMemorySubscriptionsStore.getState().subscribe(31);
    const second = useMemorySubscriptionsStore.getState().subscribe(32);
    await expect(second).resolves.toBe(201);
    expect(useMemorySubscriptionsStore.getState().availableSources.find(item => item.friend_id === '32')?.selected)
      .toBe(true);
    expect(useMemorySubscriptionsStore.getState().selectionPending).toEqual({ '31': 'select' });

    releaseFirst();
    await expect(first).resolves.toBe(201);
    expect(useMemorySubscriptionsStore.getState().availableSources.every(item => item.selected)).toBe(true);
  });

  test('local removal fences only that friend while another friend mutation can still commit', async () => {
    useMemorySubscriptionsStore.setState({
      availableSources: [source, secondSource],
      subscriptions: [
        { friend_id: 31, friend_name: 'Causal Friend' },
        { friend_id: 32, friend_name: 'Independent Friend' },
      ],
      selectionPending: { '31': 'select', '32': 'select' },
    });
    let releaseSecond!: () => void;
    mockAuthenticatedFetch.mockImplementation(async (path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && init.method === 'POST'
        && Number(JSON.parse(init.body).friend_id) === 32) {
        await new Promise<void>(resolve => { releaseSecond = resolve; });
        return selectionAck(init, true);
      }
      throw new Error(`unexpected ${path}`);
    });

    const second = useMemorySubscriptionsStore.getState().subscribe(32);
    while (!releaseSecond) await Promise.resolve();
    useMemorySubscriptionsStore.getState().removeFriendLocally(31);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 32 }],
      availableSources: [{ friend_id: '32' }],
      selectionPending: { '32': 'select' },
    });
    releaseSecond();
    await expect(second).resolves.toBe(201);
    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [{ friend_id: 32 }],
      availableSources: [{ friend_id: '32', selected: true }],
      selectionPending: {},
    });
  });

  test('a confirmed revoke remains authoritative even when an older selection read says selected', async () => {
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Causal Friend' }],
      availableSources: [{ ...source, selected: true }],
      authorityValidatedAtMs: 0,
    });
    mockAuthenticatedFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          limit: null,
          subscriptions: [{ friend_id: 31, friend_name: 'Causal Friend' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          complete: true,
          sources: [{
            ...source,
            selected: false,
            authorization_version: 0,
            grant_epoch: null,
            friendship_episode_id: null,
            friendship_episode_uuid: null,
            coverage_scope: null,
            sharing_status: 'not_shared',
          }],
        }),
      });

    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);

    expect(useMemorySubscriptionsStore.getState().subscriptions).toEqual([]);
    expect(useMemorySubscriptionsStore.getState().availableSources[0]).toMatchObject({
      selected: false,
      sharing_status: 'not_shared',
      grant_epoch: null,
    });
  });

  test('DELETE authorization change purges old-grant geometry and keeps latest deselect retryable', async () => {
    await prepareVisibleCache();
    mockAuthenticatedFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'AUTHORIZATION_CHANGED',
        grant_epoch: 'grant-b',
        friendship_episode_id: 'episode-b',
        authorization_version: 1,
        coverage_scope: 'full_history_delayed_v1',
      }),
    });

    await expect(useMemorySubscriptionsStore.getState().unsubscribe(31)).resolves.toBe(409);

    expect(useMemorySubscriptionsStore.getState()).toMatchObject({
      subscriptions: [],
      selectionPending: { '31': 'deselect' },
      selectionError: 'unauthorized',
    });
    expect(useFriendMemoryStore.getState().projections['31']).toBeUndefined();
    expect(useFriendMemoryStore.getState().getVisibleGeometries()).toHaveLength(0);
  });
});
