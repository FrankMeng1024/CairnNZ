import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRouteState: any = {
  routes: [],
  sharedRoutes: [],
  routesLoading: false,
  routesLoadError: false,
  loadRoutes: jest.fn(async () => undefined),
  loadSharedRoutes: jest.fn(async () => undefined),
  retryRouteSync: jest.fn(async () => undefined),
};
const mockSessionState: any = { sessions: [] };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { initialTab: 'routes' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const ReactModule = require('react'); const { View } = require('react-native');
    return ReactModule.createElement(View, props, children);
  },
}));
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...props }: any) => {
    const ReactModule = require('react'); const { View } = require('react-native');
    return ReactModule.createElement(View, props, children);
  },
}));
jest.mock('../../components/BackButton', () => ({ BackButton: () => null }));
jest.mock('../../components/ActivityIcons', () => ({ HikingIcon: () => null, RunningIcon: () => null }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));
jest.mock('../../components/SyncBadge', () => ({ SyncBadge: () => null }));
jest.mock('../../components/PressBtn', () => {
  const ReactModule = require('react'); const { TouchableOpacity } = require('react-native');
  return { PressBtn: ({ children, onPress, ...props }: any) => ReactModule.createElement(TouchableOpacity, { onPress, ...props }, children) };
});
jest.mock('../../components/PrimaryButton', () => {
  const ReactModule = require('react'); const { Text, TouchableOpacity } = require('react-native');
  return { PrimaryButton: ({ label, onPress, testID, disabled }: any) => ReactModule.createElement(
    TouchableOpacity, { onPress, testID, disabled }, ReactModule.createElement(Text, null, label),
  ) };
});
jest.mock('../../components/ModalCard', () => {
  const ReactModule = require('react'); const { Text, View } = require('react-native');
  return {
    ModalCard: ({ visible, children, testID, onClosed }: any) => {
      const previous = ReactModule.useRef(visible);
      ReactModule.useEffect(() => {
        if (previous.current && !visible) onClosed?.();
        previous.current = visible;
      }, [visible, onClosed]);
      return visible ? ReactModule.createElement(View, { testID }, children) : null;
    },
    ModalCardHeader: ({ title, body }: any) => ReactModule.createElement(View, null,
      ReactModule.createElement(Text, null, title), ReactModule.createElement(Text, null, body)),
  };
});
jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});
jest.mock('../../utils/distanceFormat', () => ({
  useDistance: () => ({
    unit: 'km', elevUnit: 'm', format: (value: number) => String(value), formatElevation: (value: number) => String(value),
  }),
}));
jest.mock('../../store/useSessionStore', () => {
  const useSessionStore = (selector: any) => selector(mockSessionState);
  return { useSessionStore };
});
jest.mock('../../store/useRouteStore', () => {
  const useRouteStore = (selector: any) => selector(mockRouteState);
  return { useRouteStore };
});

import { RoutesScreen } from '../RoutesScreen';

const ownRoute = {
  id: 'mine-1', name: 'Harbour Loop', createdAt: Date.UTC(2026, 9, 13), updatedAt: Date.UTC(2026, 9, 13),
  points: [], waypoints: [], distanceM: 5200, elevationGainM: 80, runCount: 0, isActive: false, syncState: 'synced',
};
const receivedRoute = {
  ...ownRoute, id: 'received-1', name: 'Ridge Link', createdAt: Date.UTC(2026, 8, 20),
  isSharedDelivery: true, sharedDeliveryId: 'delivery-1', sharedBy: 'Aroha',
};
const activity = {
  id: 'activity-1', activityMode: 'hiking', startedAt: Date.UTC(2026, 7, 2), endedAt: Date.UTC(2026, 7, 2) + 1000,
  durationS: 3600, distanceM: 4000, elevationGainM: 100, trackPoints: [], markerIds: [], name: 'Old Ridge', syncState: 'synced',
};

describe('RoutesScreen final creation and sibling-list flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteState.routes = [ownRoute];
    mockRouteState.sharedRoutes = [receivedRoute];
    mockSessionState.sessions = [activity];
  });

  test('uses compact ownership controls, Route creation dates, and truthful source labels', async () => {
    const screen = render(<RoutesScreen />);
    expect(await screen.findByTestId('trails-routes-list')).toBeTruthy();
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getAllByText('Mine').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Received')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('October 2026')).toBeTruthy();
    expect(screen.getByText('September 2026')).toBeTruthy();
    expect(screen.getByText('Shared by Aroha')).toBeTruthy();
    expect(screen.queryByText('Hike route')).toBeNull();
  });

  test('Activity selection closes its one owner modal and navigates exactly once without chooser remount', async () => {
    const screen = render(<RoutesScreen />);
    await screen.findByTestId('trails-routes-list');
    fireEvent.press(screen.getByTestId('routes-create'));
    expect(screen.getByTestId('route-create-source')).toBeTruthy();
    fireEvent.press(screen.getByTestId('route-create-activity'));
    expect(screen.queryByTestId('route-create-source')).toBeNull();
    expect(screen.getByTestId('route-activity-picker')).toBeTruthy();

    const row = screen.getByTestId('route-activity-activity-1');
    fireEvent.press(row);
    fireEvent.press(row);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('RouteEditor', {
      creationSource: 'activity', fromSessionId: 'activity-1',
    }));
    expect(mockNavigate.mock.calls.filter(call => call[0] === 'RouteEditor')).toHaveLength(1);
    expect(screen.queryByTestId('route-create-source')).toBeNull();
    expect(screen.queryByTestId('route-activity-picker')).toBeNull();
  });

  test('a received row opens the normal Route detail identity', async () => {
    const screen = render(<RoutesScreen />);
    await screen.findByTestId('trails-routes-list');
    fireEvent.press(screen.getByTestId('route-record-received-1'));
    expect(mockNavigate).toHaveBeenCalledWith('MapHistory', { sharedDeliveryId: 'delivery-1' });
  });
});
