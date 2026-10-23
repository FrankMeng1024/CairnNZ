import AsyncStorage from '@react-native-async-storage/async-storage';

let mockAuthenticatedOwnerId = 'viewer-a';
const mockFetch = jest.fn();

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({ isLoggedIn: true, user: { id: mockAuthenticatedOwnerId } }),
  },
}));

import {
  __cairnPresentationTest,
  useCairnPresentationStore,
} from '../cairnPresentationStore';

function unchangedResponse(): any {
  return {
    ok: true,
    status: 200,
    json: jest.fn(async () => ({
      unread_count: 1,
      acquired_cairn_count: 1,
      withdrawn_group_ids: [],
      groups: [{
        id: '31', group_token: 'visit:stable',
        merge_started_at: '2026-10-13T00:00:00.000Z',
        merge_until: '2026-10-13T00:00:20.000Z',
        cairn_count: 1, single_marker_id: 'marker-1', event_through_id: '11',
        unannounced_event_count: 1, unannounced_updated_event_count: 0,
        event_count: 1, updated_event_count: 0,
        friends_cairn_count: 1, public_cairn_count: 0,
      }],
    })),
  };
}

describe('Cairn presentation persisted-storage work counters', () => {
  beforeEach(async () => {
    mockAuthenticatedOwnerId = 'viewer-a';
    mockFetch.mockReset().mockImplementation(async () => unchangedResponse());
    __cairnPresentationTest.reset();
    await AsyncStorage.clear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
  });

  test('a ten-minute unchanged online window keeps HTTP authority but performs no repeat AsyncStorage write', async () => {
    await useCairnPresentationStore.getState().initialize('viewer-a');
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    (AsyncStorage.setItem as jest.Mock).mockClear();
    mockFetch.mockClear();

    for (let callback = 0; callback < 120; callback += 1) {
      await useCairnPresentationStore.getState().refresh();
    }

    expect(mockFetch).toHaveBeenCalledTimes(120);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(`${__cairnPresentationTest.cachePrefix}viewer-a`))
      .toContain('visit:stable');
  });
});
