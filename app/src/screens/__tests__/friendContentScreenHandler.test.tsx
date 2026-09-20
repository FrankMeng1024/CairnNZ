import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockFetchFriendContent = jest.fn();
const mockFetchFriendRoute = jest.fn();
const mockPrepareFriendRouteUse = jest.fn();

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }: any) => ReactModule.createElement(View, props, children),
    SafeAreaProvider: ({ children }: any) => ReactModule.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { friendId: 'owner-a', friendName: 'Alice' } }),
}));

jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

jest.mock('../../features/friends/services/friendContent', () => ({
  fetchFriendCairn: jest.fn(),
  fetchFriendContent: (...args: any[]) => mockFetchFriendContent(...args),
  fetchFriendRoute: (...args: any[]) => mockFetchFriendRoute(...args),
  hideFriendContent: jest.fn(),
  prepareFriendRouteUse: (...args: any[]) => mockPrepareFriendRouteUse(...args),
}));

import { FriendContentScreen } from '../FriendContentScreen';

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const route = {
  id: '202', author: { id: 'owner-a', name: 'Alice' }, name: 'Route lease', description: '',
  distanceM: 1400, elevationGainM: 80, readOnly: true as const,
  resourceRevision: 'route-v1', authorizationRevision: 'auth-v1',
};
const detail = {
  ...route,
  description: 'A permitted route',
  points: [{ lat: -41.3, lng: 174.8 }, { lat: -41.301, lng: 174.802 }],
};
const launch = {
  leaseId: 'lease-1', viewerId: 'viewer-a', ownerId: 'owner-a', routeId: '202', name: 'Route lease',
  points: detail.points, distanceM: 1400, elevationGainM: 80, resourceRevision: 'route-v1',
  contentVersion: 'content-v1', authorizationRevision: 'auth-v1', issuedAt: 1_800_000_000_000,
  expiresAt: 1_800_043_200_000,
};

describe('FriendContentScreen borrowed Route handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchFriendContent.mockResolvedValue({
      cairns: [], routes: [route], source: 'network',
      lastCheckedAt: 1_800_000_000_000, expiresAt: 1_800_086_400_000,
    });
    mockFetchFriendRoute.mockResolvedValue({ content: detail, source: 'offline-cache', expiresAt: launch.expiresAt });
    mockPrepareFriendRouteUse.mockResolvedValue({ launch, source: 'offline-authorization' });
  });

  test('ordinary Detail Use action carries a stored offline authorization only to pre-start navigation', async () => {
    const screen = render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <FriendContentScreen />
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(mockFetchFriendContent).toHaveBeenCalledWith('owner-a'));
    await waitFor(() => expect(screen.getByText('Route lease')).toBeTruthy());
    fireEvent.press(screen.getByText('Route lease'));
    await waitFor(() => expect(screen.getByTestId('friend-route-detail')).toBeTruthy());
    fireEvent.press(screen.getByText('Use for Hike'));
    await waitFor(() => expect(mockPrepareFriendRouteUse).toHaveBeenCalledWith(detail));
    expect(mockNavigate).toHaveBeenCalledWith('Hiking', { sharedRouteLease: launch });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
