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

  test('projection requests wait until the selection grant mutation settles', () => {
    const fogLayer = fs.readFileSync(path.resolve(__dirname, '../components/FogLayer.tsx'), 'utf8');
    const memoryScreen = fs.readFileSync(path.resolve(__dirname, '../screens/MemoryScreen.tsx'), 'utf8');
    expect(fogLayer).toContain("scope === 'combined' && !selectionPendingKey");
    expect(memoryScreen).toContain('selectionStillPending');
    expect(memoryScreen).toMatch(/selectionStillPending\s+\? Promise\.resolve\(\)/);
  });
});
