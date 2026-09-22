const mockAsyncStorage = new Map<string, string>();
const mockMarkerCache = new Map<string, string>();
const mockAuthenticatedFetch = jest.fn();
const mockTombstoneMarker = jest.fn(async (..._args: unknown[]) => undefined);
let mockTrackingState: Record<string, unknown> = {
  status: 'idle',
  sessionId: null,
  ownerUserId: null,
  liveOwnerGeneration: null,
  locationProviderSource: 'real',
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockAsyncStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockAsyncStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockAsyncStorage.delete(key); }),
  },
}));
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('../../services/networkMonitor', () => ({
  __esModule: true,
  default: { onChange: jest.fn(() => () => {}) },
}));
jest.mock('../../services/crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../../services/debugLogger', () => ({ debugLogger: { log: jest.fn() } }));
jest.mock('../storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockMarkerCache.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockMarkerCache.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockMarkerCache.delete(key); }),
  },
}));
jest.mock('../../services/markerTombstones', () => ({
  isMarkerTombstoned: jest.fn(async () => false),
  listMarkerTombstones: jest.fn(async () => []),
  tombstoneMarker: (...args: unknown[]) => mockTombstoneMarker(...args),
}));
jest.mock('../useTrackingStore', () => ({
  useTrackingStore: { getState: () => mockTrackingState },
}));
jest.mock('../../services/apiService', () => ({
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));

import { useMarkerStore } from '../useMarkerStore';
import { offlineMarkers } from '../../services/markerOfflineEntities';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Cairn create acknowledgement ordering', () => {
  beforeEach(() => {
    mockAsyncStorage.clear();
    mockMarkerCache.clear();
    mockTombstoneMarker.mockClear();
    mockAuthenticatedFetch.mockReset();
    mockAuthenticatedFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, user_id: 'owner-a' }),
    });
    mockTrackingState = {
      status: 'idle',
      sessionId: null,
      ownerUserId: null,
      liveOwnerGeneration: null,
      locationProviderSource: 'real',
    };
    useMarkerStore.setState({
      userId: 'owner-a',
      markers: [],
      libraryRemoteMarkers: [],
      libraryQuery: '',
      libraryNextCursor: null,
      libraryHasMore: false,
      libraryCoverage: 'not-loaded',
      libraryLoading: false,
      libraryError: null,
    });
  });

  test('a fast server acknowledgement cannot duplicate or downgrade the local Cairn', async () => {
    const created = (await useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: '',
      authorId: 'local',
      permission: 'personal',
    })).marker;
    await settle();

    expect(useMarkerStore.getState().markers).toHaveLength(1);
    expect(useMarkerStore.getState().markers[0]).toMatchObject({
      id: created.id,
      clientCairnId: created.id,
      serverCairnId: '42',
      syncState: 'synced',
      synced: true,
    });
  });

  test('reports a durable A-owned acceptance without projecting or throwing after an A-to-B switch', async () => {
    const originalSaveLocal = offlineMarkers.saveLocal.bind(offlineMarkers);
    let durableLocalId: string | null = null;
    let releaseReturn!: () => void;
    const returnGate = new Promise<void>(resolve => { releaseReturn = resolve; });
    const saveSpy = jest.spyOn(offlineMarkers, 'saveLocal').mockImplementation(async (...args) => {
      const saved = await originalSaveLocal(...args);
      durableLocalId = saved.localId;
      await returnGate;
      return saved;
    });

    const committing = useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: '',
      authorId: 'owner-a',
      permission: 'personal',
    } as any);
    await settle();
    useMarkerStore.setState({
      userId: 'owner-b',
      markers: [{
        id: 'owner-b-cairn',
        clientCairnId: 'owner-b-cairn',
        type: 'cairn',
        regionCode: 'nz',
        lat: -42,
        lng: 171,
        note: 'Owner B',
        authorId: 'owner-b',
        createdAt: 2,
        permission: 'personal',
      }],
    });
    releaseReturn();

    await expect(committing).resolves.toMatchObject({
      state: 'durably-accepted',
      ownerId: 'owner-a',
      projection: 'owner-changed',
      marker: { authorId: 'owner-a', permission: 'personal' },
    });
    expect(useMarkerStore.getState().markers.map(marker => marker.id)).toEqual(['owner-b-cairn']);
    expect(durableLocalId).toEqual(expect.any(String));
    saveSpy.mockRestore();
  });

  test('never replaces an explicitly captured S1 origin with current S2', async () => {
    mockTrackingState = {
      status: 'tracking',
      sessionId: 'activity-s2',
      ownerUserId: 'owner-a',
      liveOwnerGeneration: 'generation-s2',
      locationProviderSource: 'real',
    };

    await expect(useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: '',
      authorId: 'owner-a',
      permission: 'personal',
      activityContext: {
        ownerUserId: 'owner-a',
        clientActivityId: 'activity-s1',
        ownerGeneration: 'generation-s1',
      },
    } as any)).rejects.toThrow('marker_activity_changed_before_commit');
    expect([...mockAsyncStorage.keys()].some(key => key.includes('offline_markers'))).toBe(false);
  });

  test('preserves captured S1 provenance when S2 starts while the durable write awaits', async () => {
    mockTrackingState = {
      status: 'tracking',
      sessionId: 'activity-s1',
      ownerUserId: 'owner-a',
      liveOwnerGeneration: 'generation-s1',
      locationProviderSource: 'real',
    };
    const originalSaveLocal = offlineMarkers.saveLocal.bind(offlineMarkers);
    let releaseReturn!: () => void;
    const returnGate = new Promise<void>(resolve => { releaseReturn = resolve; });
    const saveSpy = jest.spyOn(offlineMarkers, 'saveLocal').mockImplementation(async (...args) => {
      const saved = await originalSaveLocal(...args);
      await returnGate;
      return saved;
    });
    const committing = useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: '',
      authorId: 'owner-a',
      permission: 'personal',
      activityContext: {
        ownerUserId: 'owner-a',
        clientActivityId: 'activity-s1',
        ownerGeneration: 'generation-s1',
      },
    });
    await settle();
    mockTrackingState = {
      ...mockTrackingState,
      sessionId: 'activity-s2',
      liveOwnerGeneration: 'generation-s2',
    };
    releaseReturn();

    await expect(committing).resolves.toMatchObject({
      state: 'durably-accepted',
      marker: { originActivityClientId: 'activity-s1' },
    });
    saveSpy.mockRestore();
  });

  test('standalone create does not inherit an unrelated current Activity', async () => {
    mockTrackingState = {
      status: 'tracking',
      sessionId: 'unrelated-activity',
      ownerUserId: 'owner-a',
      liveOwnerGeneration: 'unrelated-generation',
      locationProviderSource: 'real',
    };
    const result: any = await useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: '',
      authorId: 'owner-a',
      permission: 'personal',
    });

    expect(result.marker.originActivityClientId).toBeNull();
  });

  test('synced edit becomes visible only after the server accepts it', async () => {
    const created = (await useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: 'Old words',
      authorId: 'local',
      permission: 'personal',
    })).marker;
    await settle();
    let accept!: (value: any) => void;
    mockAuthenticatedFetch.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    const saving = useMarkerStore.getState().updateMarker(created.id, { note: 'New words' });
    expect(useMarkerStore.getState().markers[0].note).toBe('Old words');
    accept({ ok: true, status: 200, json: async () => ({}) });
    await saving;
    expect(useMarkerStore.getState().markers[0].note).toBe('New words');
  });

  test('pending edit rewrites the durable create payload during an in-flight acknowledgement', async () => {
    let acceptCreate!: (value: any) => void;
    mockAuthenticatedFetch.mockImplementationOnce(() => new Promise(resolve => { acceptCreate = resolve; }));
    const created = (await useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: '',
      authorId: 'local',
      permission: 'personal',
    })).marker;
    await settle();
    await useMarkerStore.getState().updateMarker(created.id, { note: 'Durable later words' });
    await expect(offlineMarkers.getEntry(created.id)).resolves.toMatchObject({
      data: { text: 'Durable later words' },
      revision: 1,
    });
    acceptCreate({
      ok: true,
      status: 201,
      json: async () => ({ id: 42, user_id: 'owner-a' }),
    });
    await settle();
    await settle();
    expect(useMarkerStore.getState().markers[0]).toMatchObject({
      id: created.id,
      note: 'Durable later words',
      serverCairnId: '42',
      syncState: 'pending',
    });
  });

  test('failed synced edit preserves accepted content for a retained UI draft', async () => {
    const created = (await useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: 'Accepted words',
      authorId: 'local',
      permission: 'personal',
    })).marker;
    await settle();
    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(useMarkerStore.getState().updateMarker(created.id, { note: 'Draft words' })).rejects.toThrow();
    expect(useMarkerStore.getState().markers[0].note).toBe('Accepted words');
  });

  test('an account switch drops a late accepted edit response from the new account projection', async () => {
    const created = (await useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: 'Owner A',
      authorId: 'local',
      permission: 'personal',
    })).marker;
    await settle();
    let accept!: (value: any) => void;
    mockAuthenticatedFetch.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    const saving = useMarkerStore.getState().updateMarker(created.id, { note: 'Late A edit' });
    useMarkerStore.setState({
      userId: 'owner-b',
      markers: [{
        id: 'owner-b-cairn',
        clientCairnId: 'owner-b-cairn',
        type: 'cairn',
        regionCode: 'nz',
        lat: -42,
        lng: 171,
        note: 'Owner B',
        authorId: 'owner-b',
        createdAt: 2,
        permission: 'personal',
      }],
    });
    accept({ ok: true, status: 200, json: async () => ({}) });
    await expect(saving).rejects.toThrow('cairn_owner_changed_after_save');
    expect(useMarkerStore.getState().markers).toHaveLength(1);
    expect(useMarkerStore.getState().markers[0].note).toBe('Owner B');
  });

  test('modern deletion commits a tombstone and reports an unacknowledged server delete as queued', async () => {
    const created = (await useMarkerStore.getState().addMarker({
      type: 'cairn',
      regionCode: 'nz',
      lat: -43.595,
      lng: 170.142,
      note: '',
      authorId: 'local',
      permission: 'personal',
    })).marker;
    await settle();
    mockAuthenticatedFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(useMarkerStore.getState().deleteMarker(created.id)).resolves.toEqual({ remoteState: 'queued' });
    expect(mockTombstoneMarker).toHaveBeenCalledWith('owner-a', created.id);
    expect(useMarkerStore.getState().markers).toEqual([]);
  });

  test('a durable tombstone still removes a Cairn when pending-row cleanup must retry', async () => {
    useMarkerStore.setState({
      userId: 'owner-a',
      markers: [{
        id: '2b8297a2-5fa7-4d42-b194-4a9965f8e2ea',
        clientCairnId: '2b8297a2-5fa7-4d42-b194-4a9965f8e2ea',
        localId: '2b8297a2-5fa7-4d42-b194-4a9965f8e2ea',
        type: 'cairn',
        regionCode: 'nz',
        lat: -43.5,
        lng: 170.1,
        note: '',
        authorId: 'owner-a',
        createdAt: 1,
        permission: 'personal',
        synced: false,
        syncState: 'pending',
      }],
    });
    const discard = jest.spyOn(offlineMarkers, 'discard').mockRejectedValueOnce(new Error('storage busy'));

    await expect(useMarkerStore.getState().deleteMarker('2b8297a2-5fa7-4d42-b194-4a9965f8e2ea'))
      .resolves.toEqual({ remoteState: 'queued' });
    expect(mockTombstoneMarker).toHaveBeenCalled();
    expect(useMarkerStore.getState().markers).toEqual([]);

    discard.mockRestore();
  });

  test('legacy server-only deletion failure keeps the Cairn visible', async () => {
    useMarkerStore.setState({
      userId: 'owner-a',
      markers: [{
        id: '77',
        serverCairnId: '77',
        type: 'cairn',
        regionCode: 'nz',
        lat: -43.5,
        lng: 170.1,
        note: '',
        authorId: 'owner-a',
        createdAt: 1,
        permission: 'personal',
        synced: true,
      }],
    });
    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(useMarkerStore.getState().deleteMarker('77')).rejects.toThrow('HTTP 500');
    expect(useMarkerStore.getState().markers).toHaveLength(1);
  });

  test('owner-library pages join the one persisted projection used by Detail', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        markers: [{
          id: 91,
          client_cairn_id: 'cairn-owned-91',
          user_id: 'owner-a',
          type: 'cairn',
          text: 'Library words',
          lat: -43.51,
          lng: 170.11,
          permission: 'personal',
          created_at: '2026-09-10T01:00:00.000Z',
        }],
        has_more: false,
        next_cursor: null,
      }),
    });

    await useMarkerStore.getState().loadCairnLibrary({ reset: true });

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/api/markers/library?limit=40');
    expect(useMarkerStore.getState()).toMatchObject({
      libraryCoverage: 'complete',
      libraryHasMore: false,
    });
    expect(useMarkerStore.getState().markers).toEqual([
      expect.objectContaining({
        id: 'cairn-owned-91',
        clientCairnId: 'cairn-owned-91',
        serverCairnId: '91',
        note: 'Library words',
      }),
    ]);
    expect(JSON.parse(mockMarkerCache.get('cairn_markers_v026_owner-a') ?? '[]')).toEqual([
      expect.objectContaining({ id: 'cairn-owned-91', serverCairnId: '91' }),
    ]);
  });

  test('an old backend is disclosed as partial without erasing local Cairns', async () => {
    useMarkerStore.setState({
      markers: [{
        id: 'local-cairn',
        clientCairnId: 'local-cairn',
        type: 'cairn',
        regionCode: 'nz',
        lat: -43.5,
        lng: 170.1,
        note: '',
        authorId: 'owner-a',
        createdAt: 1,
        permission: 'personal',
        synced: false,
        syncState: 'pending',
      }],
    });
    mockAuthenticatedFetch
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });

    await useMarkerStore.getState().loadCairnLibrary({ reset: true });

    expect(useMarkerStore.getState()).toMatchObject({
      libraryCoverage: 'partial',
      libraryError: 'server-upgrade-required',
    });
    expect(useMarkerStore.getState().markers).toEqual([
      expect.objectContaining({ id: 'local-cairn', syncState: 'pending' }),
    ]);
  });

  describe('marker hydration authority', () => {
    test('guest hydration keeps local Cairns and makes zero authenticated backend calls', async () => {
      mockMarkerCache.set('cairn_markers_v026_guest', JSON.stringify([{
        id: 'guest-local-cairn',
        clientCairnId: 'guest-local-cairn',
        type: 'cairn',
        regionCode: 'nz',
        lat: -43.5,
        lng: 170.1,
        note: 'Local guest fallback',
        authorId: 'guest',
        createdAt: 1,
        permission: 'personal',
        synced: false,
        syncState: 'pending',
      }]));

      await useMarkerStore.getState().hydrate('guest');
      await settle();

      expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
      expect(useMarkerStore.getState()).toMatchObject({
        userId: 'guest',
        markers: [expect.objectContaining({ id: 'guest-local-cairn', note: 'Local guest fallback' })],
      });
    });

    test('authenticated hydration still fetches and publishes the matching owner response', async () => {
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{
          id: 91,
          client_cairn_id: 'owner-a-client-cairn',
          user_id: 'owner-a',
          type: 'cairn',
          text: 'Authenticated server Cairn',
          lat: -43.51,
          lng: 170.11,
          permission: 'personal',
          created_at: '2026-09-10T01:00:00.000Z',
        }],
      });

      await useMarkerStore.getState().hydrate('owner-a');
      await settle();

      expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/api/markers');
      expect(useMarkerStore.getState()).toMatchObject({
        userId: 'owner-a',
        markers: [expect.objectContaining({
          id: 'owner-a-client-cairn',
          serverCairnId: '91',
          note: 'Authenticated server Cairn',
        })],
      });
    });

    test('an account transition cannot publish an older hydration response', async () => {
      let resolveOwnerA!: (value: unknown) => void;
      mockAuthenticatedFetch
        .mockImplementationOnce(() => new Promise(resolve => { resolveOwnerA = resolve; }))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{
            id: 202,
            client_cairn_id: 'owner-b-client-cairn',
            user_id: 'owner-b',
            type: 'cairn',
            text: 'Owner B server truth',
            lat: -42,
            lng: 171,
            permission: 'personal',
            created_at: '2026-09-11T01:00:00.000Z',
          }],
        });

      await useMarkerStore.getState().hydrate('owner-a');
      await useMarkerStore.getState().hydrate('owner-b');
      await settle();
      expect(useMarkerStore.getState()).toMatchObject({
        userId: 'owner-b',
        markers: [expect.objectContaining({ id: 'owner-b-client-cairn', note: 'Owner B server truth' })],
      });

      resolveOwnerA({
        ok: true,
        status: 200,
        json: async () => [{
          id: 101,
          client_cairn_id: 'owner-a-client-cairn',
          user_id: 'owner-a',
          type: 'cairn',
          text: 'Late owner A response',
          lat: -43,
          lng: 170,
          permission: 'personal',
          created_at: '2026-09-09T01:00:00.000Z',
        }],
      });
      await settle();

      expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
      expect(useMarkerStore.getState().userId).toBe('owner-b');
      expect(useMarkerStore.getState().markers).toEqual([
        expect.objectContaining({ id: 'owner-b-client-cairn', note: 'Owner B server truth' }),
      ]);
      expect(useMarkerStore.getState().markers).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ note: 'Late owner A response' }),
      ]));
    });
  });
});
