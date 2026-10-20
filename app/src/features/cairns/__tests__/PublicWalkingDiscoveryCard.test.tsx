const mockValues = new Map<string, string>();
const mockFetch = jest.fn();
const mockAppState = { isLoggedIn: true, user: { id: 'viewer-a' } };

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../../services/apiService', () => ({ authenticatedFetch: (...args: any[]) => mockFetch(...args) }));
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  },
}));
jest.mock('../../../store/useAppStore', () => {
  const hook: any = (selector: any) => selector(mockAppState);
  hook.getState = () => mockAppState;
  return { useAppStore: hook };
});
jest.mock('../../../hooks/useVisualTheme', () => ({
  useVisualTheme: () => ({
    sheetSurface: '#fff', borderStrong: '#ccc', shadow: '#000', controlSelected: '#eee',
    primary: '#315b4e', onPrimary: '#fff', foregroundSecondary: '#666', foreground: '#111', iconInactive: '#777',
  }),
}));
jest.mock('../../../services/hapticService', () => ({ haptic: { notification: jest.fn() } }));

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { PublicWalkingDiscoveryCard } from '../../public/components/PublicWalkingDiscoveryCard';
import { __cairnPresentationTest, useCairnPresentationStore } from '../cairnPresentationStore';

const group = {
  id: '31', token: 'visit:alpha', mergeStartedAt: Date.now(), mergeUntil: Date.now() + 20_000,
  cairnCount: 1, singleMarkerId: 'marker-1', eventThroughId: '11', unannouncedEventCount: 1,
  unannouncedUpdatedEventCount: 0, eventCount: 1, updatedEventCount: 0,
};

describe('foreground Cairn presentation component', () => {
  beforeEach(() => {
    mockValues.clear();
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/announced')) return { ok: true, status: 200, json: async () => ({ announced: true }) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          unread_count: 1,
          groups: [{
            id: '31', group_token: 'visit:alpha', merge_started_at: new Date(group.mergeStartedAt).toISOString(),
            merge_until: new Date(group.mergeUntil).toISOString(), cairn_count: 1, single_marker_id: 'marker-1',
            event_through_id: '11', unannounced_event_count: 1, unannounced_updated_event_count: 0,
            event_count: 1, updated_event_count: 0,
          }],
        }),
      };
    });
    __cairnPresentationTest.reset();
    useCairnPresentationStore.setState({ viewerId: 'viewer-a', pendingGroups: [group], unreadCount: 1 });
  });

  test('renders one restrained cue and updates its count in place', async () => {
    // The store owns surface arbitration; exercise the component with an
    // already-claimed group so this unit does not race the async refresh it
    // also initiates on focus.
    useCairnPresentationStore.setState({
      pendingGroups: [], activeGroup: group, activeGroupMembers: [group], activeSurface: 'hike',
    });
    const view = render(<PublicWalkingDiscoveryCard surface="hike" safeTop={0} onOpen={jest.fn()} />);
    await view.findByText('A note was waiting here');
    act(() => useCairnPresentationStore.setState({
      activeGroup: { ...group, cairnCount: 3, singleMarkerId: null, eventThroughId: '19', eventCount: 3 },
    }));
    await view.findByText('3 notes were waiting here');
    expect(view.queryByText('A note was waiting here')).toBeNull();
    expect(view.getAllByText('Saved in Memory · Recording continues')).toHaveLength(1);
    expect(view.getByText('Open')).toBeTruthy();
    expect(view.getByText('Later')).toBeTruthy();
  });

  test('defers while another modal owns attention', async () => {
    useCairnPresentationStore.setState({
      pendingGroups: [group], activeGroup: null, activeGroupMembers: [], activeSurface: null,
    });
    const view = render(<PublicWalkingDiscoveryCard surface="run" safeTop={0} blocked onOpen={jest.fn()} />);
    await waitFor(() => expect(useCairnPresentationStore.getState().presentationBlocked).toBe(true));
    expect(view.queryByText('A note was waiting here')).toBeNull();
    expect(useCairnPresentationStore.getState().pendingGroups).toHaveLength(1);
  });
});
