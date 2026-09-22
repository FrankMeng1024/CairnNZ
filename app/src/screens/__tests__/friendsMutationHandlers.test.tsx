import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.setTimeout(15_000);

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockLoadFriends = jest.fn(async () => undefined);
const mockLoadCircleMarkers = jest.fn(async () => undefined);
const mockBlockUser = jest.fn();
const mockRemoveFriend = jest.fn();
const mockFetchProfileForNavigation = jest.fn();
const mockProfileAuthorityCurrent = jest.fn();
const mockViewerState: { user: { id: string } | null } = { user: { id: 'viewer-a' } };
const mockProfileAuthority = {
  viewerId: 'viewer-a', friendId: 'owner-a', friendAddedAt: 1_800_000_000_000,
  friendIdentity: { id: 'owner-a', userId: 'owner-a', name: 'Alice Example', email: 'alice@example.com' },
  contentAuthority: { viewerId: 'viewer-a', generation: 1, ownerId: 'owner-a', ownerGeneration: 0 },
};
const mockOnlineProfile = {
  id: 1,
  name: 'Alice Example',
  email: 'alice@example.com',
  memberSince: null,
  permittedContent: { encounteredCairns: 1, sharedRoutes: 1, memoryAvailable: true },
};
const mockFriendState = {
  friends: [{
    id: 'owner-a', userId: 'owner-a', name: 'Alice Example', email: 'alice@example.com',
    addedAt: 1_800_000_000_000, shareMarkers: true,
  }],
  loadFriendsFromBackend: mockLoadFriends,
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

jest.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: any) => selector(mockViewerState),
}));

jest.mock('../../store/useFriendStore', () => ({
  useFriendStore: (selector: any) => selector(mockFriendState),
  sendFriendRequest: jest.fn(),
  fetchFriendRequests: jest.fn(async () => []),
  acceptFriendRequestAPI: jest.fn(),
  rejectFriendRequestAPI: jest.fn(),
  blockUser: (...args: any[]) => mockBlockUser(...args),
  fetchFriendProfileForNavigation: (...args: any[]) => mockFetchProfileForNavigation(...args),
  friendProfileNavigationAuthorityIsCurrent: (...args: any[]) => mockProfileAuthorityCurrent(...args),
  fetchOutboundRequests: jest.fn(async () => []),
  cancelOutboundRequest: jest.fn(),
  removeFriendAPI: (...args: any[]) => mockRemoveFriend(...args),
}));

jest.mock('../../store/useMarkerStore', () => ({
  useMarkerStore: (selector: any) => selector({ loadCircleMarkers: mockLoadCircleMarkers }),
}));

import { FriendsScreen } from '../FriendsScreen';

async function renderReady() {
  const screen = render(<FriendsScreen />);
  await waitFor(() => expect(screen.getByTestId('friend-card-owner-a')).toBeTruthy());
  await waitFor(() => expect(mockLoadFriends).toHaveBeenCalledTimes(1));
  return screen;
}

async function openBlockConfirmation(screen: ReturnType<typeof render>) {
  fireEvent(screen.getByTestId('friend-card-owner-a'), 'longPress');
  await waitFor(() => expect(screen.getByTestId('friend-actions-modal')).toBeTruthy());
  fireEvent.press(screen.getByText('Block friend'));
  await waitFor(() => expect(screen.getByText('Block Alice')).toBeTruthy());
}

async function openRemoveConfirmation(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getByTestId('friend-card-owner-a'));
  await waitFor(() => expect(screen.getByTestId('friend-profile-remove-trigger')).toBeTruthy());
  fireEvent.press(screen.getByTestId('friend-profile-remove-trigger'));
  await waitFor(() => expect(screen.getByTestId('friend-profile-remove-final')).toBeTruthy());
}

describe('FriendsScreen mutation result handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockViewerState.user = { id: 'viewer-a' };
    mockFriendState.friends = [{
      id: 'owner-a', userId: 'owner-a', name: 'Alice Example', email: 'alice@example.com',
      addedAt: 1_800_000_000_000, shareMarkers: true,
    }];
    mockLoadFriends.mockResolvedValue(undefined);
    mockFetchProfileForNavigation.mockResolvedValue({
      status: 'online', profile: mockOnlineProfile, authority: mockProfileAuthority,
    });
    mockProfileAuthorityCurrent.mockReturnValue(true);
  });

  test('reopens a current friend card offline and navigates only to the separately authorized shared-content screen', async () => {
    const screen = await renderReady();
    fireEvent.press(screen.getByTestId('friend-card-owner-a'));
    await waitFor(() => expect(screen.getByText('Open shared content')).toBeTruthy());
    fireEvent.press(screen.getByText('Open shared content'));
    expect(mockNavigate).toHaveBeenLastCalledWith('FriendContent', {
      friendId: 'owner-a', friendName: 'Alice Example',
    });

    mockFetchProfileForNavigation.mockResolvedValueOnce({
      status: 'offline-fallback',
      identity: { id: 'owner-a', name: 'Alice Example', email: 'alice@example.com' },
      authority: mockProfileAuthority,
    });
    fireEvent.press(screen.getByTestId('friend-card-owner-a'));
    await waitFor(() => expect(screen.getByTestId('friend-profile-offline-fallback')).toBeTruthy());
    expect(screen.getByText('Profile details unavailable offline')).toBeTruthy();
    fireEvent.press(screen.getByText('Open shared content'));

    expect(mockFetchProfileForNavigation).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenLastCalledWith('FriendContent', {
      friendId: 'owner-a', friendName: 'Alice Example',
    });
  });

  test('an account switch clears the modal and discards a delayed account-A fallback completion', async () => {
    let release!: (value: any) => void;
    mockFetchProfileForNavigation.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const screen = await renderReady();
    fireEvent.press(screen.getByTestId('friend-card-owner-a'));
    await waitFor(() => expect(screen.getByText('Loading profile…')).toBeTruthy());

    mockViewerState.user = { id: 'viewer-b' };
    mockFriendState.friends = [];
    screen.rerender(<FriendsScreen />);
    await act(async () => {
      release({
        status: 'offline-fallback',
        identity: { id: 'owner-a', name: 'Alice Example', email: 'alice@example.com' },
        authority: mockProfileAuthority,
      });
    });

    await waitFor(() => expect(screen.queryByTestId('friend-profile-modal')).toBeNull());
    expect(screen.queryByText('Open shared content')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('a fallback invalidated by revoke or block cannot navigate', async () => {
    mockFetchProfileForNavigation.mockResolvedValueOnce({
      status: 'offline-fallback',
      identity: { id: 'owner-a', name: 'Alice Example', email: 'alice@example.com' },
      authority: mockProfileAuthority,
    });
    const screen = await renderReady();
    fireEvent.press(screen.getByTestId('friend-card-owner-a'));
    await waitFor(() => expect(screen.getByTestId('friend-profile-offline-fallback')).toBeTruthy());

    mockProfileAuthorityCurrent.mockReturnValue(false);
    fireEvent.press(screen.getByText('Open shared content'));

    expect(mockNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('friend-profile-modal')).toBeNull());
  });

  test('silently discards a superseded Block without modal, feedback, busy, navigation, or refresh completion effects', async () => {
    let release!: (value: any) => void;
    mockBlockUser.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const screen = await renderReady();
    await openBlockConfirmation(screen);
    fireEvent.press(screen.getByText('Block Alice'));
    expect(mockBlockUser).toHaveBeenCalledWith('owner-a');
    expect(screen.queryByText('Block Alice')).toBeNull();

    await act(async () => { release({ success: false, superseded: true }); });

    expect(screen.getByTestId('friend-actions-modal')).toBeTruthy();
    expect(screen.queryByText('Block Alice')).toBeNull();
    expect(mockLoadFriends).toHaveBeenCalledTimes(1);
    expect(mockLoadCircleMarkers).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('renders committed Block cleanup uncertainty and disables an unsafe retry', async () => {
    mockBlockUser.mockResolvedValue({
      success: false,
      serverCommitted: true,
      localCleanup: 'storage-uncertain',
      error: 'Block completed on the server, but downloaded shared content could not be cleared from this device.',
    });
    const screen = await renderReady();
    await openBlockConfirmation(screen);
    fireEvent.press(screen.getByText('Block Alice'));

    await waitFor(() => expect(screen.getByText(/Block completed on the server/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Block Alice' }).props.accessibilityState.disabled).toBe(true);
    expect(mockLoadFriends).toHaveBeenCalledTimes(1);
    expect(mockLoadCircleMarkers).not.toHaveBeenCalled();
  });

  test('silently discards a superseded Unfriend without profile, feedback, busy, navigation, or refresh completion effects', async () => {
    let release!: (value: any) => void;
    mockRemoveFriend.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const screen = await renderReady();
    await openRemoveConfirmation(screen);
    fireEvent.press(screen.getByTestId('friend-profile-remove-final'));
    expect(mockRemoveFriend).toHaveBeenCalledWith('owner-a');
    const busyBefore = screen.getByTestId('friend-profile-remove-final').props.accessibilityState;

    await act(async () => { release({ success: false, superseded: true }); });

    expect(screen.getByTestId('friend-profile-modal')).toBeTruthy();
    expect(screen.getByTestId('friend-profile-remove-final').props.accessibilityState).toEqual(busyBefore);
    expect(mockLoadFriends).toHaveBeenCalledTimes(1);
    expect(mockLoadCircleMarkers).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('renders committed Unfriend cleanup uncertainty and disables an unsafe retry', async () => {
    mockRemoveFriend.mockResolvedValue({
      success: false,
      serverCommitted: true,
      localCleanup: 'storage-uncertain',
      error: 'Unfriend completed on the server, but downloaded shared content could not be cleared from this device.',
    });
    const screen = await renderReady();
    await openRemoveConfirmation(screen);
    fireEvent.press(screen.getByTestId('friend-profile-remove-final'));

    await waitFor(() => expect(screen.getByText(/Unfriend completed on the server/)).toBeTruthy());
    expect(screen.getByTestId('friend-profile-remove-final').props.accessibilityState.disabled).toBe(true);
    expect(mockLoadFriends).toHaveBeenCalledTimes(1);
    expect(mockLoadCircleMarkers).not.toHaveBeenCalled();
  });
});
