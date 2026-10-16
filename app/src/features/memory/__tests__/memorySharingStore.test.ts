const mockAuthenticatedFetch = jest.fn();

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(...args),
}));

import { useMemorySharingStore } from '../store/useMemorySharingStore';

const grant = (id: string, enabled: boolean) => ({
  friend_id: id,
  friend_name: `Friend ${id}`,
  enabled,
  coverage_scope: enabled ? 'full_history_delayed_v1' as const : null,
  consent_version: enabled ? 1 : 0,
  effective_at: enabled ? '2026-10-12T00:00:00.000Z' : null,
});

describe('Memory sharing account and rollback fences', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    useMemorySharingStore.getState().reset();
    useMemorySharingStore.setState({ ownerId: 'account-a', grants: [grant('1', true), grant('2', false)] });
  });

  test('does not expose the retired bulk-sharing mutation', () => {
    expect(useMemorySharingStore.getState()).not.toHaveProperty('applyGrantSelection');
  });

  test('switching owner clears sharing state immediately and fences a late account-A load', async () => {
    let resolveA!: (value: any) => void;
    const pendingA = new Promise(resolve => { resolveA = resolve; });
    mockAuthenticatedFetch
      .mockReturnValueOnce(pendingA)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ grants: [grant('b', true)], delay_seconds: 1800 }) });

    const loadA = useMemorySharingStore.getState().load('account-a');
    const loadB = useMemorySharingStore.getState().load('account-b');
    expect(useMemorySharingStore.getState()).toMatchObject({
      ownerId: 'account-b', grants: [], loading: true,
    });
    resolveA({ ok: true, json: async () => ({ grants: [grant('a', true)], private_places: [] }) });
    await loadA;
    await loadB;

    expect(useMemorySharingStore.getState()).toMatchObject({
      ownerId: 'account-b', loading: false,
    });
    expect(useMemorySharingStore.getState().grants.map(item => item.friend_id)).toEqual(['b']);
  });

  test('grant readiness no longer requests removed private-place metadata', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ grants: [grant('1', true)], delay_seconds: 1800 }) });

    await useMemorySharingStore.getState().load('account-a');

    expect(useMemorySharingStore.getState()).toMatchObject({
      grantsLoading: false,
      loading: false,
      error: null,
    });
    expect(useMemorySharingStore.getState().grants).toEqual([grant('1', true)]);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/api/friend-sharing/grants', { expectedUserId: 'account-a' });
  });

  test('a per-friend failure rolls back only that friend and rejects a rapid duplicate write', async () => {
    let resolveRequest!: (value: any) => void;
    mockAuthenticatedFetch.mockReturnValue(new Promise(resolve => { resolveRequest = resolve; }));

    const first = useMemorySharingStore.getState().setGrant('2', true);
    const duplicate = useMemorySharingStore.getState().setGrant('2', false);
    expect(useMemorySharingStore.getState().grantPendingIds).toEqual(['2']);
    await expect(duplicate).resolves.toBe(false);
    resolveRequest({ ok: false, status: 503 });
    await expect(first).resolves.toBe(false);

    expect(useMemorySharingStore.getState().grants.map(item => [item.friend_id, item.enabled]))
      .toEqual([['1', true], ['2', false]]);
    expect(useMemorySharingStore.getState().grantPendingIds).toEqual([]);
    expect(useMemorySharingStore.getState().grantErrors['2']).toMatch(/previous choice is unchanged/i);
    expect(useMemorySharingStore.getState().grantErrors['1']).toBeUndefined();
  });
});
