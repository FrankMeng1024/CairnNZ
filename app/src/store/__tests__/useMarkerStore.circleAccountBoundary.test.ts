const mockAuthenticatedFetch = jest.fn();
const mockSubscriptionsReset = jest.fn();
const mockFriendMemoryReset = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
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
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../../services/markerTombstones', () => ({
  isMarkerTombstoned: jest.fn(async () => false),
  listMarkerTombstones: jest.fn(async () => []),
  tombstoneMarker: jest.fn(async () => undefined),
}));
jest.mock('../useTrackingStore', () => ({
  useTrackingStore: { getState: () => ({ status: 'idle', sessionId: null }) },
}));
jest.mock('../../services/apiService', () => ({
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));
jest.mock('../../features/memory/store/useMemorySubscriptionsStore', () => ({
  useMemorySubscriptionsStore: { getState: () => ({ reset: mockSubscriptionsReset }) },
}));
jest.mock('../../features/memory/store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: { getState: () => ({ reset: mockFriendMemoryReset }) },
}));

import { useMarkerStore } from '../useMarkerStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function circleResponse(id: number, userId: string, note: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      markers: [{
        id,
        user_id: userId,
        type: 'cairn',
        text: note,
        lat: -41.2865,
        lng: 174.7762,
        permission: 'group',
        created_at: '2026-09-19T00:00:00.000Z',
      }],
    }),
  };
}

async function waitForCircleRequests(expected: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const count = mockAuthenticatedFetch.mock.calls
      .filter(([url]) => url === '/api/circle/markers').length;
    if (count >= expected) return;
    await Promise.resolve();
  }
}

describe('FR-CIRCLE-ACCOUNT-01 circle-marker account boundary', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    mockSubscriptionsReset.mockClear();
    mockFriendMemoryReset.mockClear();
    useMarkerStore.setState({
      userId: 'owner-a',
      circleMarkers: [],
      loadingCircle: false,
      hidingIds: [],
    });
  });

  test('an older account response cannot suppress or repopulate the next account', async () => {
    const accountA = deferred<ReturnType<typeof circleResponse>>();
    const accountB = deferred<ReturnType<typeof circleResponse>>();
    let circleRequestCount = 0;
    mockAuthenticatedFetch.mockImplementation(async (url: string) => {
      if (url === '/api/friend-content/encounters/verify') {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url === '/api/circle/markers') {
        circleRequestCount += 1;
        return circleRequestCount === 1 ? accountA.promise : accountB.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const loadA = useMarkerStore.getState().loadCircleMarkers();
    await waitForCircleRequests(1);

    useMarkerStore.getState().clearMarkers();
    useMarkerStore.setState({ userId: 'owner-b' });
    const loadB = useMarkerStore.getState().loadCircleMarkers();
    await waitForCircleRequests(2);

    accountB.resolve(circleResponse(202, 'friend-b', 'B marker'));
    await loadB;
    accountA.resolve(circleResponse(101, 'friend-a', 'A marker'));
    await loadA;

    const circleGets = mockAuthenticatedFetch.mock.calls
      .filter(([url]) => url === '/api/circle/markers');
    expect(circleGets).toHaveLength(2);
    expect(useMarkerStore.getState()).toMatchObject({
      userId: 'owner-b',
      loadingCircle: false,
    });
    expect(useMarkerStore.getState().circleMarkers).toEqual([
      expect.objectContaining({ serverCairnId: '202', authorId: 'friend-b', note: 'B marker' }),
    ]);
  });
});
