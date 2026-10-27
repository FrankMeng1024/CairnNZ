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

type Authority = {
  authorized: boolean;
  selected: boolean;
  epoch: number;
};

function source(friendId: number, authority: Authority) {
  return {
    friend_id: String(friendId),
    friend_name: `Model Friend ${friendId}`,
    selected: authority.selected,
    authorization_version: authority.authorized ? 1 : 0,
    grant_epoch: authority.authorized ? `grant-${friendId}-${authority.epoch}` : null,
    friendship_episode_id: authority.authorized ? `episode-${friendId}-${authority.epoch}` : null,
    friendship_episode_uuid: authority.authorized
      ? `00000000-0000-4000-8000-${String(friendId * 100 + authority.epoch).padStart(12, '0')}`
      : null,
    effective_at: '2026-10-27T00:00:00.000Z',
    sharing_status: authority.authorized ? 'shared' : 'not_shared',
    coverage_scope: authority.authorized ? 'full_history_delayed_v1' : null,
  };
}

function fixedEvents(seed: number, count: number): Array<{ friendId: number; kind: string }> {
  let value = seed >>> 0;
  const kinds = ['select', 'deselect', 'read', 'revoke', 'regrant'] as const;
  return Array.from({ length: count }, () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return {
      friendId: (value & 1) === 0 ? 31 : 32,
      kind: kinds[(value >>> 1) % kinds.length],
    };
  });
}

describe('Memory authority fixed-seed reference model', () => {
  const model = new Map<number, Authority>();

  beforeEach(() => {
    model.clear();
    model.set(31, { authorized: true, selected: false, epoch: 1 });
    model.set(32, { authorized: true, selected: false, epoch: 1 });
    mockAuthenticatedFetch.mockReset();
    useAppStore.setState({ user: { id: 'model-viewer' } as any, isLoggedIn: true, hydrated: true });
    useFriendMemoryStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
    mockAuthenticatedFetch.mockImplementation(async (path: string, init: any = {}) => {
      if (path === '/api/friend-sharing/sources') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            complete: true,
            sources: [...model].map(([id, authority]) => source(id, authority)),
          }),
        };
      }
      if (path === '/api/memory-subscriptions' && !init.method) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            limit: null,
            subscriptions: [...model]
              .filter(([, authority]) => authority.authorized && authority.selected)
              .map(([id]) => ({ friend_id: id, friend_name: `Model Friend ${id}` })),
          }),
        };
      }
      if (path === '/api/memory-subscriptions' && init.method === 'POST') {
        const body = JSON.parse(init.body);
        const authority = model.get(Number(body.friend_id))!;
        const matchesGrant = authority.authorized
          && body.grant_epoch === `grant-${body.friend_id}-${authority.epoch}`
          && body.friendship_episode_id === `episode-${body.friend_id}-${authority.epoch}`;
        if (!matchesGrant) {
          return {
            ok: false,
            status: authority.authorized ? 409 : 404,
            json: async () => ({ code: authority.authorized
              ? 'AUTHORIZATION_CHANGED'
              : 'MEMORY_SOURCE_NOT_AVAILABLE' }),
          };
        }
        authority.selected = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            selected: true,
            selection_chain_id: body.selection_chain_id,
            selection_sequence: body.selection_sequence,
            selection_request_id: body.selection_request_id,
          }),
        };
      }
      const deleteMatch = path.match(/^\/api\/memory-subscriptions\/(\d+)$/);
      if (deleteMatch && init.method === 'DELETE') {
        const body = JSON.parse(init.body);
        model.get(Number(deleteMatch[1]))!.selected = false;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            selected: false,
            selection_chain_id: body.selection_chain_id,
            selection_sequence: body.selection_sequence,
            selection_request_id: body.selection_request_id,
          }),
        };
      }
      throw new Error(`unexpected ${path}`);
    });
  });

  afterEach(() => {
    useMemorySubscriptionsStore.getState().reset();
    useFriendMemoryStore.getState().reset();
  });

  test('seed 0x5eedcafe preserves confirmed selection and grant isolation through 48 events', async () => {
    await expect(useMemorySubscriptionsStore.getState().load(true)).resolves.toBe(true);
    const trace: Array<Record<string, unknown>> = [];
    for (const [index, event] of fixedEvents(0x5eedcafe, 48).entries()) {
      const authority = model.get(event.friendId)!;
      if (event.kind === 'select') {
        await useMemorySubscriptionsStore.getState().subscribe(event.friendId);
      } else if (event.kind === 'deselect') {
        await useMemorySubscriptionsStore.getState().unsubscribe(event.friendId);
      } else if (event.kind === 'revoke') {
        authority.authorized = false;
        authority.selected = false;
        await useMemorySubscriptionsStore.getState().load(true);
      } else if (event.kind === 'regrant') {
        if (!authority.authorized) {
          authority.authorized = true;
          authority.selected = false;
          authority.epoch += 1;
        }
        await useMemorySubscriptionsStore.getState().load(true);
      } else {
        await useMemorySubscriptionsStore.getState().load(true);
      }

      const state = useMemorySubscriptionsStore.getState();
      const expectedSelected = [...model]
        .filter(([, item]) => item.authorized && item.selected)
        .map(([id]) => id)
        .sort();
      const actualSelected = state.subscriptions.map(item => item.friend_id).sort();
      const actualSources = new Map(state.availableSources.map(item => [Number(item.friend_id), item]));
      expect(actualSelected).toEqual(expectedSelected);
      expect(state.selectionPending).toEqual({});
      for (const [id, expected] of model) {
        const actual = actualSources.get(id)!;
        expect(actual.selected).toBe(expected.authorized && expected.selected);
        expect(actual.sharing_status === 'not_shared').toBe(!expected.authorized);
        expect(actual.grant_epoch).toBe(expected.authorized ? `grant-${id}-${expected.epoch}` : null);
      }
      trace.push({ index, ...event, expectedSelected, actualSelected });
    }
    expect(trace).toHaveLength(48);
  });
});
