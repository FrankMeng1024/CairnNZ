const mockValues = new Map<string, string>();
let mockAuthenticatedOwnerId: string | null = 'viewer-a';
let mockLoggedIn = true;

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockValues.delete(key); }),
  },
}));
jest.mock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      isLoggedIn: mockLoggedIn,
      user: mockAuthenticatedOwnerId === null ? null : { id: mockAuthenticatedOwnerId },
    }),
  },
}));

import {
  __cairnPresentationTest,
  purgeCairnPresentationForOwner,
  useCairnPresentationStore,
} from '../cairnPresentationStore';

const mockFetch = jest.requireMock('../../../services/apiService').authenticatedFetch as jest.Mock;
const mockSetItem = jest.requireMock('../../../store/storage').storage.setItem as jest.Mock;

function response(status: number, body: any = {}): any {
  return { ok: status >= 200 && status < 300, status, json: jest.fn(async () => body) };
}

function pending(eventThroughId = '11', cairnCount = 1): any {
  return response(200, {
    unread_count: cairnCount,
    groups: [{
      id: '31',
      group_token: 'visit:alpha',
      merge_started_at: '2026-10-13T00:00:00.000Z',
      merge_until: '2026-10-13T00:00:20.000Z',
      cairn_count: cairnCount,
      single_marker_id: cairnCount === 1 ? 'marker-1' : null,
      event_through_id: eventThroughId,
      unannounced_event_count: 1,
      unannounced_updated_event_count: 0,
      event_count: cairnCount,
      updated_event_count: 0,
    }],
  });
}

describe('Cairn presentation coordinator', () => {
  beforeEach(() => {
    mockValues.clear();
    mockFetch.mockReset();
    mockSetItem.mockReset();
    mockSetItem.mockImplementation(async (key: string, value: string) => { mockValues.set(key, value); });
    mockAuthenticatedOwnerId = 'viewer-a';
    mockLoggedIn = true;
    __cairnPresentationTest.reset();
  });

  test('claims one foreground surface and acknowledges the exact rendered event watermark', async () => {
    mockFetch.mockResolvedValueOnce(pending()).mockResolvedValueOnce(response(200));
    await useCairnPresentationStore.getState().initialize('viewer-a');
    useCairnPresentationStore.getState().claim('home');
    expect(useCairnPresentationStore.getState()).toMatchObject({
      activeSurface: 'home',
      activeGroup: { token: 'visit:alpha', eventThroughId: '11', cairnCount: 1 },
      unreadCount: 1,
    });

    await expect(useCairnPresentationStore.getState().acknowledgeActive('home')).resolves.toBe(true);
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/cairn-memory/presentation/31/announced',
      expect.objectContaining({ body: JSON.stringify({ event_through_id: '11' }) }),
    );
    expect(mockValues.get(`${__cairnPresentationTest.cachePrefix}viewer-a`)).toContain('"visit:alpha":"11"');
  });

  test('new events inside one merge window update the existing cue without another surface claim', async () => {
    mockFetch.mockResolvedValueOnce(pending('11', 1)).mockResolvedValueOnce(response(200));
    await useCairnPresentationStore.getState().initialize('viewer-a');
    useCairnPresentationStore.getState().claim('home');
    await useCairnPresentationStore.getState().acknowledgeActive('home');

    mockFetch.mockResolvedValueOnce(pending('19', 3));
    await useCairnPresentationStore.getState().refresh();
    expect(useCairnPresentationStore.getState()).toMatchObject({
      activeSurface: 'home',
      activeGroup: { token: 'visit:alpha', eventThroughId: '19', cairnCount: 3 },
    });
    expect(useCairnPresentationStore.getState().pendingGroups).toEqual([]);
  });

  test('modal/onboarding blockers defer the cue without losing its durable group', async () => {
    mockFetch.mockResolvedValueOnce(pending());
    await useCairnPresentationStore.getState().initialize('viewer-a');
    useCairnPresentationStore.getState().setPresentationBlock('dialog', true);
    useCairnPresentationStore.getState().claim('home');
    expect(useCairnPresentationStore.getState()).toMatchObject({ presentationBlocked: true, activeGroup: null });
    expect(useCairnPresentationStore.getState().pendingGroups).toHaveLength(1);
    useCairnPresentationStore.getState().setPresentationBlock('dialog', false);
    useCairnPresentationStore.getState().claim('home');
    expect(useCairnPresentationStore.getState()).toMatchObject({
      presentationBlocked: false,
      activeSurface: 'home',
      activeGroup: { token: 'visit:alpha' },
    });
  });

  test('an acknowledged watermark is not replayed after release and restart', async () => {
    mockFetch.mockResolvedValueOnce(pending()).mockResolvedValueOnce(response(200));
    await useCairnPresentationStore.getState().initialize('viewer-a');
    useCairnPresentationStore.getState().claim('hike');
    await useCairnPresentationStore.getState().acknowledgeActive('hike');
    useCairnPresentationStore.getState().release('hike');
    __cairnPresentationTest.reset();

    mockFetch.mockResolvedValueOnce(pending());
    await useCairnPresentationStore.getState().initialize('viewer-a');
    useCairnPresentationStore.getState().claim('home');
    expect(useCairnPresentationStore.getState().activeGroup).toBeNull();
  });

  test('a group announced on another device is retained for merging but not replayed', async () => {
    const announced = pending();
    const body = await announced.json();
    body.groups[0].unannounced_event_count = 0;
    mockFetch.mockResolvedValueOnce(response(200, body));
    await useCairnPresentationStore.getState().initialize('viewer-a');
    useCairnPresentationStore.getState().claim('home');
    expect(useCairnPresentationStore.getState()).toMatchObject({ activeGroup: null, pendingGroups: [] });
  });

  test('a server safety/removal update withdraws an active cue without marking content read', async () => {
    mockFetch.mockResolvedValueOnce(pending()).mockResolvedValueOnce(response(200));
    await useCairnPresentationStore.getState().initialize('viewer-a');
    useCairnPresentationStore.getState().claim('home');
    await useCairnPresentationStore.getState().acknowledgeActive('home');
    mockFetch.mockResolvedValueOnce(response(200, { groups: [], unread_count: 0 }));
    await useCairnPresentationStore.getState().refresh();
    expect(useCairnPresentationStore.getState()).toMatchObject({ activeGroup: null, activeSurface: null, unreadCount: 0 });
  });

  test('failed acknowledgement remains in the durable outbox and retries with the same watermark', async () => {
    mockFetch.mockResolvedValueOnce(pending()).mockRejectedValueOnce(new Error('offline'));
    await useCairnPresentationStore.getState().initialize('viewer-a');
    useCairnPresentationStore.getState().claim('run');
    await useCairnPresentationStore.getState().acknowledgeActive('run');
    expect(mockValues.get(`${__cairnPresentationTest.cachePrefix}viewer-a`)).toContain('"eventThroughId":"11"');

    mockFetch.mockResolvedValueOnce(response(200)).mockResolvedValueOnce(pending());
    await useCairnPresentationStore.getState().refresh();
    const posts = mockFetch.mock.calls.filter(([url]) => String(url).includes('/announced'));
    expect(posts).toHaveLength(2);
    expect(posts[1][1].body).toBe(JSON.stringify({ event_through_id: '11' }));
  });

  test('an old account response cannot cross an account boundary', async () => {
    let release!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const old = useCairnPresentationStore.getState().initialize('viewer-a');
    while (mockFetch.mock.calls.length < 1) await Promise.resolve();
    mockAuthenticatedOwnerId = 'viewer-b';
    useCairnPresentationStore.getState().clearForAccountBoundary();
    release(pending());
    await old;
    expect(useCairnPresentationStore.getState()).toMatchObject({ viewerId: null, activeGroup: null, pendingGroups: [] });
  });

  test('direct A to B switch clears coordinates and does not reuse A map refresh', async () => {
    mockFetch.mockResolvedValueOnce(pending());
    await useCairnPresentationStore.getState().initialize('viewer-a');

    let releaseA!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { releaseA = resolve; }));
    const oldMap = useCairnPresentationStore.getState().refreshAcquiredMap();
    while (mockFetch.mock.calls.length < 2) await Promise.resolve();

    mockAuthenticatedOwnerId = 'viewer-b';
    mockFetch.mockResolvedValueOnce(response(200, { groups: [], unread_count: 0 }));
    await useCairnPresentationStore.getState().initialize('viewer-b');
    expect(useCairnPresentationStore.getState()).toMatchObject({
      viewerId: 'viewer-b', unreadCount: 0, acquiredMarkers: [], pendingGroups: [],
    });

    mockFetch.mockResolvedValueOnce(response(200, {
      unread_count: 1,
      cairns: [{ marker_id: 'b-1', lat: -41.3, lng: 174.8, availability: 'available', has_unread: 1 }],
    }));
    await useCairnPresentationStore.getState().refreshAcquiredMap();
    expect(useCairnPresentationStore.getState().acquiredMarkers.map(marker => marker.markerId)).toEqual(['b-1']);
    expect(mockFetch.mock.calls.at(-1)?.[1]).toMatchObject({ expectedUserId: 'viewer-b' });

    releaseA(response(200, {
      unread_count: 9,
      cairns: [{ marker_id: 'a-private', lat: -40, lng: 175, availability: 'available', has_unread: 1 }],
    }));
    await oldMap;
    expect(useCairnPresentationStore.getState()).toMatchObject({ viewerId: 'viewer-b', unreadCount: 1 });
    expect(useCairnPresentationStore.getState().acquiredMarkers.map(marker => marker.markerId)).toEqual(['b-1']);
  });

  test('direct A to offline B switch fails closed without A unread or coordinates', async () => {
    mockFetch.mockResolvedValueOnce(pending());
    await useCairnPresentationStore.getState().initialize('viewer-a');
    useCairnPresentationStore.setState({
      unreadCount: 4,
      acquiredMarkers: [{
        markerId: 'a-private', lat: -41.2, lng: 174.7, unread: true, acquiredAt: null,
        sourceAudience: 'friends', authorName: 'A', currentFriend: true,
      }],
    });
    mockAuthenticatedOwnerId = 'viewer-b';
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await useCairnPresentationStore.getState().initialize('viewer-b');
    expect(useCairnPresentationStore.getState()).toMatchObject({
      viewerId: 'viewer-b', unreadCount: 0, acquiredMarkers: [], pendingGroups: [], error: 'offline',
    });
  });

  test('cold-start cache is fail-closed until the safety authority refresh succeeds', async () => {
    mockValues.set(`${__cairnPresentationTest.cachePrefix}viewer-a`, JSON.stringify({
      version: 1,
      viewerId: 'viewer-a',
      groups: [{
        id: '31', token: 'stale', mergeStartedAt: 1, mergeUntil: 2,
        cairnCount: 1, singleMarkerId: 'private-marker', eventThroughId: '11',
        unannouncedEventCount: 1, unannouncedUpdatedEventCount: 0,
        eventCount: 1, updatedEventCount: 0,
      }],
      acknowledged: {}, pendingAcks: {}, unreadCount: 1,
      acquiredMarkers: [{ markerId: 'private-marker', lat: -41.2, lng: 174.7, unread: true }],
    }));
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await useCairnPresentationStore.getState().initialize('viewer-a');
    expect(useCairnPresentationStore.getState()).toMatchObject({
      pendingGroups: [], activeGroup: null, acquiredMarkers: [], unreadCount: 0, error: 'offline',
    });
  });

  test('account deletion clears durable and in-process presentation evidence without touching another owner', async () => {
    mockValues.set(`${__cairnPresentationTest.cachePrefix}viewer-a`, JSON.stringify({ version: 1, viewerId: 'viewer-a' }));
    mockValues.set(`${__cairnPresentationTest.cachePrefix}viewer-b`, JSON.stringify({ version: 1, viewerId: 'viewer-b' }));
    mockFetch.mockResolvedValueOnce(pending());
    await useCairnPresentationStore.getState().initialize('viewer-a');
    await purgeCairnPresentationForOwner('viewer-a');
    expect(mockValues.has(`${__cairnPresentationTest.cachePrefix}viewer-a`)).toBe(false);
    expect(mockValues.has(`${__cairnPresentationTest.cachePrefix}viewer-b`)).toBe(true);
    expect(useCairnPresentationStore.getState()).toMatchObject({ viewerId: null, pendingGroups: [], acquiredMarkers: [] });
  });

  test('acquired map data keeps only active available finite Cairn groups', async () => {
    mockFetch.mockResolvedValueOnce(pending());
    await useCairnPresentationStore.getState().initialize('viewer-a');
    mockFetch.mockResolvedValueOnce(response(200, {
      unread_count: 1,
      cairns: [
        { marker_id: 1, lat: -41.28, lng: 174.77, availability: 'available', has_unread: 1 },
        { marker_id: 1, lat: -41.28, lng: 174.77, availability: 'available', has_unread: 1 },
        { marker_id: 2, lat: -41.29, lng: 174.78, availability: 'under_review', has_unread: 0 },
        { marker_id: 3, lat: 'bad', lng: 174.79, availability: 'available', has_unread: 0 },
      ],
    }));
    await useCairnPresentationStore.getState().refreshAcquiredMap();
    expect(useCairnPresentationStore.getState().acquiredMarkers).toEqual([
      { markerId: '1', lat: -41.28, lng: 174.77, unread: true, acquiredAt: null, sourceAudience: null, authorName: null, currentFriend: false },
    ]);
  });
});
