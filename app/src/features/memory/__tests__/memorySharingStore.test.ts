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

  test('bulk grant failure restores the complete previous selection', async () => {
    mockAuthenticatedFetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(useMemorySharingStore.getState().applyGrantSelection(['2'])).resolves.toBe(false);

    expect(useMemorySharingStore.getState().grants.map(item => [item.friend_id, item.enabled]))
      .toEqual([['1', true], ['2', false]]);
    expect(useMemorySharingStore.getState().error).toMatch(/previous sharing choices are unchanged/i);
  });

  test('a late failed mutation cannot restore the previous account after reset', async () => {
    let resolveRequest!: (value: any) => void;
    mockAuthenticatedFetch.mockReturnValue(new Promise(resolve => { resolveRequest = resolve; }));

    const pending = useMemorySharingStore.getState().applyGrantSelection(['2']);
    useMemorySharingStore.getState().reset();
    resolveRequest({ ok: false, status: 503 });

    await expect(pending).resolves.toBe(false);
    expect(useMemorySharingStore.getState()).toMatchObject({ grants: [], loading: false, error: null });
  });

  test('switching owner clears exact places immediately and fences a late account-A load', async () => {
    let resolveA!: (value: any) => void;
    const pendingA = new Promise(resolve => { resolveA = resolve; });
    mockAuthenticatedFetch
      .mockReturnValueOnce(pendingA)
      .mockReturnValueOnce(pendingA)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ grants: [grant('b', true)], delay_seconds: 1800 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ private_places: [] }) });
    useMemorySharingStore.setState({
      ownerId: 'account-a',
      privatePlaces: [{ id: 9, label: 'A home', lat: -41.2, lng: 174.7, radius_m: 250 }],
    });

    const loadA = useMemorySharingStore.getState().load('account-a');
    const loadB = useMemorySharingStore.getState().load('account-b');
    expect(useMemorySharingStore.getState()).toMatchObject({
      ownerId: 'account-b', grants: [], privatePlaces: [], loading: true,
    });
    resolveA({ ok: true, json: async () => ({ grants: [grant('a', true)], private_places: [] }) });
    await loadA;
    await loadB;

    expect(useMemorySharingStore.getState()).toMatchObject({
      ownerId: 'account-b', privatePlaces: [], loading: false,
    });
    expect(useMemorySharingStore.getState().grants.map(item => item.friend_id)).toEqual(['b']);
  });
});
