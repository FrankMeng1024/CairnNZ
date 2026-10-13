import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCameraSet = jest.fn();
const mockCameraFit = jest.fn();
const mockResolveDraw = jest.fn();
const mockSearchPlaces = jest.fn();
const mockSaveDraft = jest.fn(async () => undefined);
const mockStroke = [
  { lat: -41.2865, lng: 174.7767 },
  { lat: -41.2862, lng: 174.7772 },
  { lat: -41.2865, lng: 174.7777 },
];
const mockDraft = {
  schemaVersion: 1 as const,
  draftId: 'plan:screen', ownerId: 'owner-a', origin: 'plan' as const, revision: 1,
  parts: [{
    id: 'part-a', resolution: 'draw-manual' as const,
    points: [
      { lat: -41.2865, lng: 174.7762 },
      { lat: -41.2865, lng: 174.7772 },
      { lat: -41.2865, lng: 174.7782 },
    ],
  }],
  gaps: [],
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@rnmapbox/maps', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const Camera = ReactModule.forwardRef((props: any, ref: any) => {
    ReactModule.useImperativeHandle(ref, () => ({ setCamera: mockCameraSet, fitBounds: mockCameraFit }));
    return ReactModule.createElement(View, { testID: 'mock-camera', ...props });
  });
  const MapView = ReactModule.forwardRef(({ children, onCameraChanged, ...props }: any, ref: any) => {
    ReactModule.useImperativeHandle(ref, () => ({ getCoordinateFromView: jest.fn() }));
    ReactModule.useEffect(() => {
      onCameraChanged?.({ properties: { center: [174.7772, -41.2865] } });
    }, [onCameraChanged]);
    return ReactModule.createElement(View, { testID: 'mock-map', ...props }, children);
  });
  const source = ({ id, shape, children }: any) => ReactModule.createElement(View, { testID: `source-${id}`, shape }, children);
  const layer = ({ id, style }: any) => ReactModule.createElement(View, { testID: `layer-${id}`, style });
  return {
    MapView, Camera,
    ShapeSource: source, LineLayer: layer, CircleLayer: layer, SymbolLayer: layer,
    StyleImport: () => ReactModule.createElement(View),
  };
});
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { latitude: -41.29, longitude: 174.79 } })),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('../../components/BackButton', () => ({ BackButton: () => null }));
jest.mock('../../components/Icon', () => {
  const ReactModule = require('react'); const { View } = require('react-native');
  return { Icon: ({ name }: any) => ReactModule.createElement(View, { testID: `icon-${name}` }) };
});
jest.mock('../../components/MapLoadOverlay', () => ({ MapLoadOverlay: () => null }));
jest.mock('../../components/ModalCard', () => {
  const ReactModule = require('react'); const { Text, View } = require('react-native');
  return {
    ModalCard: ({ visible, children, testID }: any) => visible ? ReactModule.createElement(View, { testID }, children) : null,
    ModalCardHeader: ({ title, body }: any) => ReactModule.createElement(View, null,
      ReactModule.createElement(Text, null, title), body ? ReactModule.createElement(Text, null, body) : null),
  };
});
jest.mock('../../components/PrimaryButton', () => {
  const ReactModule = require('react'); const { Text, TouchableOpacity } = require('react-native');
  return { PrimaryButton: ({ label, onPress, disabled, loading, testID, ...props }: any) => ReactModule.createElement(
    TouchableOpacity, { testID, onPress, disabled: disabled || loading, accessibilityRole: 'button', ...props },
    ReactModule.createElement(Text, null, label),
  ) };
});
jest.mock('../../components/map/RouteDrawOverlay', () => {
  const ReactModule = require('react'); const { Text, TouchableOpacity } = require('react-native');
  return { RouteDrawOverlay: ({ active, onStroke }: any) => active ? ReactModule.createElement(
    TouchableOpacity, { testID: 'emit-route-stroke', onPress: () => onStroke(mockStroke) }, ReactModule.createElement(Text, null, 'Emit stroke'),
  ) : null };
});
jest.mock('../../features/memory/components/FogLayer', () => ({ FogLayer: () => null }));
jest.mock('../../features/memory/store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: { getState: () => ({ loadSelectedProjections: jest.fn() }) },
}));
jest.mock('../../components/map/TrimSlider', () => ({ TrimSlider: () => null }));
jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});
jest.mock('../../hooks/useMapTheme', () => ({ useMapTheme: () => 'day' }));
jest.mock('../../utils/distanceFormat', () => ({ useDistance: () => ({ unit: 'km', format: (metres: number) => String(metres) }) }));
jest.mock('../../config/regions', () => ({ getCurrentRegion: () => ({ centerLng: 174.77, centerLat: -41.28, defaultZoom: 12 }) }));
jest.mock('../../config/mapbox', () => ({
  buildStandardConfig: () => ({}), getMapStyleForTheme: () => ({ kind: 'url', url: 'mapbox://styles/test' }), themeToStandardPreset: () => 'day',
}));
jest.mock('../../features/route/routePlannerDraftPersistence', () => ({
  loadRoutePlannerDraft: jest.fn(async () => ({
    schemaVersion: 1, ownerId: 'owner-a', draftId: 'plan:screen',
    history: { present: mockDraft, past: [] }, name: 'Screen Route', permission: 'personal', savedAt: 1,
  })),
  plannerDraftMatchesRequest: () => true,
  saveRoutePlannerDraft: (...args: any[]) => mockSaveDraft(...args),
  removeRoutePlannerDraft: jest.fn(async () => undefined),
}));
jest.mock('../../features/route/routePlanningProvider', () => ({
  resolveDrawPlan: (...args: any[]) => mockResolveDraw(...args),
  resolvePointPlan: jest.fn(),
}));
jest.mock('../../features/route/routePlaceSearch', () => ({
  searchRoutePlaces: (...args: any[]) => mockSearchPlaces(...args),
}));
jest.mock('../../services/offlineQueue', () => ({ uuidv4: () => 'operation-1' }));
const mockAppState = { user: { id: 'owner-a' }, isLoggedIn: true };
jest.mock('../../store/useAppStore', () => {
  const hook: any = (selector: any) => selector(mockAppState); hook.getState = () => mockAppState;
  return { useAppStore: hook };
});
const mockRouteState = {
  routes: [], sharedRoutes: [], addRoute: jest.fn(), updateRoute: jest.fn(),
  loadRouteDetail: jest.fn(), loadSharedRouteDetail: jest.fn(), removeSharedRoute: jest.fn(), captureActivityRouteReference: jest.fn(),
};
jest.mock('../../store/useRouteStore', () => {
  const hook: any = (selector: any) => selector(mockRouteState); hook.getState = () => mockRouteState;
  return { useRouteStore: hook };
});
const mockSessionState = { sessions: [] };
jest.mock('../../store/useSessionStore', () => {
  const hook: any = (selector: any) => selector(mockSessionState); hook.getState = () => mockSessionState;
  return { useSessionStore: hook, loadActivityTrackPoints: jest.fn() };
});

import { OrderedRouteEditorScreen } from '../OrderedRouteEditorScreen';

describe('OrderedRouteEditorScreen closure UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchPlaces.mockResolvedValue([{ id: 'place-1', label: 'Wellington', center: { lat: -41.2865, lng: 174.7762 } }]);
    mockResolveDraw.mockResolvedValue({ outcome: 'review', reason: 'shape-deviation', points: mockStroke });
  });

  test('mounts real editor controls, endpoints and manual visual provenance', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    expect(await screen.findByDisplayValue('Screen Route')).toBeTruthy();
    expect(screen.getByTestId('route-place-search')).toBeTruthy();
    expect(screen.getByTestId('route-current-location')).toBeTruthy();
    expect(screen.getByTestId('route-overview')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-endpoints').props.shape.features.map((feature: any) => feature.properties.role)).toEqual(['Start', 'End']);
    expect(screen.getByTestId('layer-ordered-route-parts-line').props.style.lineDasharray).toEqual(
      ['match', ['get', 'resolution'], 'draw-manual', ['literal', [2, 1.4]], ['literal', [1, 0]]],
    );
  });

  test('search, current location and overview move only the camera', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-place-search'));
    fireEvent.changeText(screen.getByLabelText('Place or city search'), 'Wellington');
    fireEvent.press(screen.getByText('Search'));
    fireEvent.press(await screen.findByText('Wellington'));
    expect(mockCameraSet).toHaveBeenCalledWith(expect.objectContaining({ centerCoordinate: [174.7762, -41.2865] }));
    fireEvent.press(screen.getByTestId('route-current-location'));
    await waitFor(() => expect(mockCameraSet).toHaveBeenCalledWith(expect.objectContaining({ centerCoordinate: [174.79, -41.29] })));
    fireEvent.press(screen.getByTestId('route-overview'));
    expect(mockCameraFit).toHaveBeenCalledTimes(1);
    expect(mockDraft.parts[0].points).toHaveLength(3);
  });

  test('provider review renders candidate and original interval before acceptance', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    expect(await screen.findByText('Review this Route edit')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-review-candidate')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-review-original')).toBeTruthy();
    expect(mockDraft.parts[0].points).toHaveLength(3);
  });
});
