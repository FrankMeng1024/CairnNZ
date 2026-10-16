import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.setTimeout(15_000);

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockLoadFriends = jest.fn(async () => undefined);
const mockLoadCircleMarkers = jest.fn(async () => undefined);
const mockBlockUser = jest.fn();
const mockRemoveFriend = jest.fn();
const mockSetGrant = jest.fn(async (_friendId: string, _enabled: boolean) => true);
const mockSendFriendRequest = jest.fn();
const mockFetchFriendRequests = jest.fn();
const mockFetchOutboundRequests = jest.fn();
const mockAcceptFriendRequest = jest.fn();
const mockRejectFriendRequest = jest.fn();
const mockCancelOutboundRequest = jest.fn();
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
  sendFriendRequest: (...args: any[]) => mockSendFriendRequest(...args),
  fetchFriendRequests: (...args: any[]) => mockFetchFriendRequests(...args),
  acceptFriendRequestAPI: (...args: any[]) => mockAcceptFriendRequest(...args),
  rejectFriendRequestAPI: (...args: any[]) => mockRejectFriendRequest(...args),
  blockUser: (...args: any[]) => mockBlockUser(...args),
  fetchFriendProfileForNavigation: (...args: any[]) => mockFetchProfileForNavigation(...args),
  friendProfileNavigationAuthorityIsCurrent: (...args: any[]) => mockProfileAuthorityCurrent(...args),
  fetchOutboundRequests: (...args: any[]) => mockFetchOutboundRequests(...args),
  cancelOutboundRequest: (...args: any[]) => mockCancelOutboundRequest(...args),
  removeFriendAPI: (...args: any[]) => mockRemoveFriend(...args),
}));

jest.mock('../../features/memory/store/useMemorySharingStore', () => ({
  useMemorySharingStore: (selector: any) => selector({
    grants: [{ friend_id: 'owner-a', friend_name: 'Alice Example', enabled: false }],
    grantsLoading: false,
    grantPendingIds: [],
    grantErrors: {},
    load: jest.fn(async () => undefined),
    setGrant: (friendId: string, enabled: boolean) => mockSetGrant(friendId, enabled),
  }),
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
    mockFetchFriendRequests.mockResolvedValue({ success: true, items: [] });
    mockFetchOutboundRequests.mockResolvedValue({ success: true, items: [] });
    mockSendFriendRequest.mockResolvedValue({ success: false, error: 'not configured' });
    mockAcceptFriendRequest.mockResolvedValue({ success: false, error: 'not configured' });
    mockRejectFriendRequest.mockResolvedValue({ success: false, error: 'not configured' });
    mockCancelOutboundRequest.mockResolvedValue({ success: false, error: 'not configured' });
    mockFetchProfileForNavigation.mockResolvedValue({
      status: 'online', profile: mockOnlineProfile, authority: mockProfileAuthority,
    });
    mockProfileAuthorityCurrent.mockReturnValue(true);
  });

  test('keeps friend detail action-only with one Memory switch and Remove Friend', async () => {
    const screen = await renderReady();
    fireEvent.press(screen.getByTestId('friend-card-owner-a'));
    await waitFor(() => expect(screen.getByTestId('friend-profile-memory-toggle')).toBeTruthy());
    expect(screen.queryByText('Open shared content')).toBeNull();
    expect(screen.queryByText(/encountered Cairn/)).toBeNull();
    expect(screen.queryByText(/shared Route/)).toBeNull();
    expect(screen.queryByText(/Memory sharing is available/)).toBeNull();
    expect(screen.getByTestId('friend-profile-remove-trigger')).toBeTruthy();
    fireEvent(screen.getByTestId('friend-profile-memory-toggle'), 'valueChange', true);
    expect(mockSetGrant).toHaveBeenCalledWith('owner-a', true);
    expect(mockFetchProfileForNavigation).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('an account switch clears the local friend detail', async () => {
    const screen = await renderReady();
    fireEvent.press(screen.getByTestId('friend-card-owner-a'));
    await waitFor(() => expect(screen.getByTestId('friend-profile-modal')).toBeTruthy());

    mockViewerState.user = { id: 'viewer-b' };
    mockFriendState.friends = [];
    screen.rerender(<FriendsScreen />);

    await waitFor(() => expect(screen.queryByTestId('friend-profile-modal')).toBeNull());
    expect(screen.queryByText('Open shared content')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('a server-confirmed send immediately selects Requests and renders the authoritative outgoing row', async () => {
    mockSendFriendRequest.mockResolvedValueOnce({
      success: true,
      serverCommitted: true,
      request: {
        id: 91,
        toUserId: 92,
        toName: 'Recipient Example',
        toEmail: 'recipient@example.com',
        sentAt: 1_800_000_000_000,
        status: 'pending',
        requesterShares: false,
      },
    });
    const screen = await renderReady();
    fireEvent.press(screen.getByText('Add friend'));
    await waitFor(() => expect(screen.getByTestId('add-friend-email')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('add-friend-email'), 'recipient@example.com');
    fireEvent.press(screen.getByText('Send request'));

    await waitFor(() => expect(screen.getByTestId('sent-card-91')).toBeTruthy());
    expect(screen.getByTestId('friends-tabs-active')).toHaveTextContent('Requests');
    expect(screen.getByText('recipient@example.com')).toBeTruthy();
    expect(mockSendFriendRequest).toHaveBeenCalledWith('recipient@example.com', false);
  });

  test('dismisses declined history in one tap with pending and inline error states', async () => {
    mockFetchOutboundRequests.mockResolvedValue({
      success: true,
      items: [{
        id: 91, toUserId: 92, toName: 'Recipient Example', toEmail: 'recipient@example.com',
        sentAt: 1_800_000_000_000, status: 'declined', requesterShares: false,
      }],
    });
    let release!: (value: any) => void;
    mockCancelOutboundRequest.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const screen = await renderReady();
    fireEvent.press(screen.getByText('Requests'));
    await waitFor(() => expect(screen.getByTestId('sent-card-91')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Dismiss declined request'));
    expect(mockCancelOutboundRequest).toHaveBeenCalledWith(91);
    expect(screen.queryByTestId('cancel-request-modal')).toBeNull();
    expect(screen.getByTestId('btn-cancel-outbound-91').props.accessibilityState.disabled).toBe(true);

    await act(async () => { release({ success: false, error: 'Couldn’t dismiss. Try again.' }); });
    await waitFor(() => expect(screen.getByText('Couldn’t dismiss. Try again.')).toBeTruthy());
    expect(screen.getByTestId('sent-card-91')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('btn-cancel-outbound-91').props.accessibilityState.disabled).toBe(false));

    mockCancelOutboundRequest.mockResolvedValueOnce({ success: true, serverCommitted: true });
    fireEvent.press(screen.getByLabelText('Dismiss declined request'));
    await waitFor(() => expect(mockCancelOutboundRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('sent-card-91')).toBeNull());
    expect(screen.queryByTestId('cancel-request-modal')).toBeNull();
  });

  test('accept uses independent OFF consent, returns to Friends, and marks the authoritative friend New', async () => {
    mockFetchFriendRequests.mockResolvedValue({
      success: true,
      items: [{
        id: 73,
        from_name: 'Alice Example',
        from_email: 'alice@example.com',
        requester_memory_share: true,
        sent_at: '2026-10-15T00:00:00.000Z',
      }],
    });
    mockAcceptFriendRequest.mockResolvedValueOnce({ success: true, serverCommitted: true, friendId: 'owner-a' });
    const screen = await renderReady();
    fireEvent.press(screen.getByText('Requests'));
    await waitFor(() => expect(screen.getByTestId('incoming-card-73')).toBeTruthy());
    expect(screen.getByText('Will share their Memory')).toBeTruthy();
    expect(screen.getByLabelText('Decline friend request')).toBeTruthy();
    expect(screen.getByLabelText('Accept friend request')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Accept friend request'));

    await waitFor(() => expect(screen.getByTestId('friends-tabs-active')).toHaveTextContent('Friends'));
    expect(mockAcceptFriendRequest).toHaveBeenCalledWith('73', false);
    expect(screen.getByText('New')).toBeTruthy();
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
