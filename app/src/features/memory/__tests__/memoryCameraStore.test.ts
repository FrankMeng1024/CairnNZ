const mockValues = new Map<string, string>();
const mockPendingReads = new Map<string, (value: string | null) => void>();

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn((key: string) => {
      if (!key.endsWith('slow-owner')) return Promise.resolve(mockValues.get(key) ?? null);
      return new Promise<string | null>(resolve => mockPendingReads.set(key, resolve));
    }),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockValues.delete(key); }),
  },
}));

import { useMemoryCameraStore } from '../store/useMemoryCameraStore';

const city = {
  source: 'mine' as const,
  cityId: 'wellington',
  countryId: 'nz',
  bbox: [174.7, -41.4, 174.9, -41.2] as [number, number, number, number],
  center: [174.78, -41.29] as [number, number],
  zoom: 11,
};

describe('Memory manual city persistence', () => {
  beforeEach(() => {
    mockValues.clear();
    mockPendingReads.clear();
    useMemoryCameraStore.getState().reset();
  });

  test('persists and restores a manual city only for its owner', async () => {
    await useMemoryCameraStore.getState().hydrate('owner-a');
    await useMemoryCameraStore.getState().selectCity(city);
    useMemoryCameraStore.getState().reset();
    await useMemoryCameraStore.getState().hydrate('owner-a');
    expect(useMemoryCameraStore.getState().manualCity).toEqual(city);

    await useMemoryCameraStore.getState().hydrate('owner-b');
    expect(useMemoryCameraStore.getState().manualCity).toBeNull();
  });

  test('drops a late hydration result after an account switch', async () => {
    const staleCity = { ...city, cityId: 'stale' };
    mockValues.set('cairn:memory-camera:v1:slow-owner', JSON.stringify({ ownerId: 'slow-owner', manualCity: staleCity }));
    const slow = useMemoryCameraStore.getState().hydrate('slow-owner');
    await useMemoryCameraStore.getState().hydrate('current-owner');
    mockPendingReads.get('cairn:memory-camera:v1:slow-owner')?.(mockValues.get('cairn:memory-camera:v1:slow-owner')!);
    await slow;

    expect(useMemoryCameraStore.getState()).toMatchObject({
      ownerId: 'current-owner',
      hydrated: true,
      manualCity: null,
    });
  });

  test('does not restore legacy or Friend-derived exact camera metadata', async () => {
    mockValues.set('cairn:memory-camera:v1:owner-a', JSON.stringify({
      ownerId: 'owner-a',
      // Old records have no provenance and could have been written from a
      // Friend-only anchor. O87 fails them closed on launch.
      manualCity: { ...city, source: undefined },
    }));
    await useMemoryCameraStore.getState().hydrate('owner-a');
    expect(useMemoryCameraStore.getState().manualCity).toBeNull();
  });

  test('a later Recenter clear wins over an in-flight city persistence write', async () => {
    await useMemoryCameraStore.getState().hydrate('owner-a');
    const selecting = useMemoryCameraStore.getState().selectCity(city);
    const recentering = useMemoryCameraStore.getState().clearManualCity();
    await Promise.all([selecting, recentering]);

    useMemoryCameraStore.getState().reset();
    await useMemoryCameraStore.getState().hydrate('owner-a');
    expect(useMemoryCameraStore.getState().manualCity).toBeNull();
  });
});
