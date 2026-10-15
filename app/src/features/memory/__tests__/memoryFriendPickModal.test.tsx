import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockAuthenticatedFetch = jest.fn();

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(...args),
}));
jest.mock('../../../store/storage', () => ({
  storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
jest.mock('../../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

import { useAppStore } from '../../../store/useAppStore';
import { useFriendStore } from '../../../store/useFriendStore';
import { MemoryFriendPickModal } from '../components/MemoryFriendPickModal';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';

const sources = [
  { friend_id: '11', friend_name: 'First Friend', selected: false, authorization_version: 1, effective_at: '2026-10-15T00:00:00Z', sharing_status: 'shared' as const, coverage_scope: 'full_history_delayed_v1' as const },
  { friend_id: '22', friend_name: 'Second Friend', selected: false, authorization_version: 1, effective_at: '2026-10-15T00:00:00Z', sharing_status: 'shared' as const, coverage_scope: 'full_history_delayed_v1' as const },
  { friend_id: '33', friend_name: 'Unavailable Friend', selected: false, authorization_version: 0, effective_at: '', sharing_status: 'not_shared' as const, coverage_scope: null },
];

function ok(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function projection(friendId: number) {
  const start = friendId === 11 ? 174.7 : 168.6;
  const now = Date.now();
  return {
    source_friend_id: friendId,
    authorization_version: 1,
    projection_version: `projection-${friendId}`,
    cell_size_m: 200,
    server_authorized_at: new Date(now - 60_000).toISOString(),
    authorization_expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
    regions: [],
    cells: [{
      id: `cell-${friendId}`,
      polygon: [[start, -41], [start + 0.001, -41], [start + 0.001, -41.001], [start, -41.001], [start, -41]],
    }],
  };
}

describe('Memory friend picker interaction owner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ user: { id: 'viewer' } as any, isLoggedIn: true, hydrated: true });
    useFriendStore.setState({
      friends: [
        { id: '11', userId: '11', name: 'First Friend', email: 'first@example.com', addedAt: 1, shareMarkers: false },
        { id: '22', userId: '22', name: 'Second Friend', email: 'second@example.com', addedAt: 1, shareMarkers: false },
      ],
    });
    useMemorySubscriptionsStore.getState().reset();
    useMemorySubscriptionsStore.setState({ availableSources: sources, subscriptions: [], loading: false, error: null });
    useFriendMemoryStore.getState().reset();
    useMemoryScopeStore.setState({ scope: 'self', selectedFriendId: null });
  });

  test('selects two friends while open, loads each source independently, and deselects without friendship semantics', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    mockAuthenticatedFetch.mockImplementation(async (path: string, init: any = {}) => {
      if (path === '/api/memory-subscriptions' && !init.method) {
        return ok({ limit: null, count: 0, subscriptions: [] });
      }
      if (path === '/api/friend-sharing/sources') return ok({ sources });
      if (path === '/api/memory-subscriptions' && init.method === 'POST') return ok({}, 201);
      if (path.startsWith('/api/memory-subscriptions/') && init.method === 'DELETE') return ok({});
      if (path === '/api/friend-sharing/projections') {
        const friendId = JSON.parse(init.body).friend_ids[0];
        if (friendId === 11) await firstGate;
        return ok({ revoked_friend_ids: [], projections: [projection(friendId)] });
      }
      throw new Error(`unexpected ${init.method ?? 'GET'} ${path}`);
    });

    const onClose = jest.fn();
    const screen = render(<MemoryFriendPickModal visible onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('memory-friend-row-11')).toBeTruthy());

    fireEvent.press(screen.getByTestId('memory-friend-row-11'));
    await waitFor(() => expect(screen.getByText('Loading shared area…')).toBeTruthy());
    expect(screen.getByTestId('memory-friend-pick-modal')).toBeTruthy();
    fireEvent.press(screen.getByTestId('memory-friend-row-22'));

    await waitFor(() => expect(useMemorySubscriptionsStore.getState().subscriptions).toHaveLength(2));
    await waitFor(() => expect(useFriendMemoryStore.getState().sourceStates['22']).toMatchObject({ status: 'loaded', cellCount: 1 }));
    expect(screen.getByTestId('memory-friend-pick-modal')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    releaseFirst();
    await waitFor(() => expect(useFriendMemoryStore.getState().sourceStates['11']).toMatchObject({ status: 'loaded', cellCount: 1 }));
    expect(new Set(useFriendMemoryStore.getState().getVisibleCells().map(cell => cell.sourceFriendId)))
      .toEqual(new Set(['11', '22']));
    expect(useMemoryScopeStore.getState().scope).toBe('combined');

    fireEvent.press(screen.getByTestId('memory-friend-row-11'));
    await waitFor(() => expect(useMemorySubscriptionsStore.getState().subscriptions.map(item => item.friend_id)).toEqual([22]));
    expect(useFriendMemoryStore.getState().projections['11']).toBeUndefined();
    expect(screen.getByTestId('memory-friend-pick-modal')).toBeTruthy();
    expect(screen.getByText('Not shared with you')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
