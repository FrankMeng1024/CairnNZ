import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockHideMark = jest.fn();
const mockDeleteMarker = jest.fn();
const mockIsExplored = jest.fn(() => true);
const mockMarkerState: any = {
  userId: 'viewer-b',
  markers: [],
  hideMark: (...args: unknown[]) => mockHideMark(...args),
  deleteMarker: (...args: unknown[]) => mockDeleteMarker(...args),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));
jest.mock('../../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});
jest.mock('../../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactModule = require('react');
    const { View: NativeView } = require('react-native');
    return ReactModule.createElement(NativeView, { testID: `icon-${name}` });
  },
}));
jest.mock('../services/mapboxAdapter', () => {
  const ReactModule = require('react');
  const { View: NativeView } = require('react-native');
  return {
    getMapbox: () => ({
      available: true,
      MarkerView: ({ children }: { children: React.ReactNode }) => ReactModule.createElement(NativeView, null, children),
      PointAnnotation: null,
      SymbolLayer: null,
      ShapeSource: null,
      Images: null,
      Image: null,
    }),
  };
});
jest.mock('../components/CairnPinV10', () => {
  const ReactModule = require('react');
  const { Text: NativeText, View: NativeView } = require('react-native');
  return {
    CairnPinV10: ({ tier }: { tier: string }) => ReactModule.createElement(NativeText, { testID: `cairn-pin-${tier}` }, 'Cairn pin'),
    MysteryPinV10: () => ReactModule.createElement(NativeView, { testID: 'mystery-pin' }),
    StrangerBlurredPinV10: () => ReactModule.createElement(NativeView, { testID: 'stranger-pin' }),
  };
});
jest.mock('../components/MysteryCairnSheet', () => {
  const ReactModule = require('react');
  const { View: NativeView } = require('react-native');
  return { MysteryCairnSheet: () => ReactModule.createElement(NativeView, { testID: 'mystery-sheet' }) };
});
jest.mock('../store/useMemoryStore', () => ({
  useMemoryStore: (selector: (state: any) => unknown) => selector({
    isExplored: mockIsExplored,
    geometryVersion: 1,
  }),
}));
jest.mock('../store/useMemorySubscriptionsStore', () => ({
  useMemorySubscriptionsStore: (selector: (state: any) => unknown) => selector({
    subscriptions: [{ friend_id: 44 }],
  }),
}));
jest.mock('../../../store/useMarkerStore', () => ({
  useMarkerStore: (selector: (state: any) => unknown) => selector(mockMarkerState),
}));
jest.mock('../../../store/useFriendStore', () => ({
  useFriendStore: (selector: (state: any) => unknown) => selector({
    friends: [{ id: '44', name: 'Friend A' }],
  }),
}));
jest.mock('../../../store/useTrackingStore', () => ({
  useTrackingStore: (selector: (state: any) => unknown) => selector({ lastCoordinate: null }),
}));
jest.mock('../../marks/store/useMarkLikeStore', () => ({
  useMarkLikeStore: (selector: (state: any) => unknown) => selector({ liked: [] }),
}));
jest.mock('../../../services/markerInteractionService', () => ({
  likeMarker: jest.fn(),
  reportMarker: jest.fn(),
  MarkerInteractionError: class MarkerInteractionError extends Error {},
}));
jest.mock('../../../services/appLog', () => ({ log: jest.fn() }));

import { CairnPinsLayer } from '../components/CairnPinsLayer';
import type { Marker } from '../../../store/useMarkerStore';

const friendMarker: Marker = {
  id: 'circle-501',
  serverCairnId: '501',
  type: 'cairn',
  regionCode: 'nz',
  lat: -41.2865,
  lng: 174.7762,
  note: 'Friend marker',
  authorId: '44',
  authorName: 'Friend A',
  createdAt: 1_800_000_000_000,
  permission: 'group',
  synced: true,
};

describe('FR-MEM-HIDE-01 Memory non-owner Cairn action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMarkerState.userId = 'viewer-b';
    mockMarkerState.markers = [];
  });

  test('Hide from my map invokes the store primitive once and closes after its immediate local action', async () => {
    let finishRemote!: () => void;
    const remotePending = new Promise<void>(resolve => { finishRemote = resolve; });
    mockHideMark.mockReturnValue(remotePending);
    const screen = render(
      <CairnPinsLayer
        markers={[friendMarker]}
        centerLat={friendMarker.lat}
        centerLng={friendMarker.lng}
      />,
    );

    fireEvent.press(screen.getByTestId('cairn-pin-friend'));
    expect(screen.getByTestId('mark-detail-sheet-form-B')).toBeTruthy();

    fireEvent.press(screen.getByTestId('mark-detail-delete-hide'));

    expect(mockHideMark).toHaveBeenCalledTimes(1);
    expect(mockHideMark).toHaveBeenCalledWith('circle-501');
    expect(screen.queryByTestId('mark-detail-sheet-form-B')).toBeNull();

    await act(async () => {
      finishRemote();
      await remotePending;
    });
  });

  test('an unexpected primitive rejection is disclosed without restoring the already hidden sheet', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockHideMark.mockRejectedValueOnce(new Error('unexpected local failure'));
    const screen = render(
      <CairnPinsLayer
        markers={[friendMarker]}
        centerLat={friendMarker.lat}
        centerLng={friendMarker.lng}
      />,
    );

    fireEvent.press(screen.getByTestId('cairn-pin-friend'));
    fireEvent.press(screen.getByTestId('mark-detail-delete-hide'));

    expect(mockHideMark).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mark-detail-sheet-form-B')).toBeNull();
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
      'Could not hide this cairn',
      'Please try again.',
    ));
  });
});
