import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

const reduceMotionSpy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

const mockCameraSet = jest.fn();
const mockCameraFit = jest.fn();
const mockGetPointInView = jest.fn(async () => [195, 300]);
const mockNavReplace = jest.fn();
const mockNavGoBack = jest.fn();
const mockAbandonDraft = jest.fn(async (_ownerId: string, _draftId: string) => undefined);
const mockResolveDraw = jest.fn();
const mockResolvePoint = jest.fn();
const mockSearchPlaces = jest.fn();
const mockSaveDraft = jest.fn(async (..._args: any[]) => undefined);
let mockRecoveredPending: any = null;
let mockRecoveredDraftEnabled = true;
let mockScreenParams: any = {};
const mockLoadActivityTrackPoints = jest.fn();
const mockLoadActivityFinalArtifact = jest.fn();
const mockStroke = [
  { lat: -41.2865, lng: 174.7767 },
  { lat: -41.2862, lng: 174.7772 },
  { lat: -41.2865, lng: 174.7777 },
];
let mockEmittedStroke = mockStroke;
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
let mockLoadedDraft: any = mockDraft;
let mockRecoveredPast: any[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockNavGoBack, replace: mockNavReplace, navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useRoute: () => ({ params: mockScreenParams }),
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
    ReactModule.useImperativeHandle(ref, () => ({
      getCoordinateFromView: jest.fn(),
      getPointInView: mockGetPointInView,
    }));
    ReactModule.useEffect(() => {
      onCameraChanged?.({ properties: { center: [174.7772, -41.2865] } });
    }, [onCameraChanged]);
    return ReactModule.createElement(View, { testID: 'mock-map', onCameraChanged, ...props }, children);
  });
  const source = ({ id, shape, children }: any) => ReactModule.createElement(View, { testID: `source-${id}`, shape }, children);
  const layer = ({ id, style, slot }: any) => ReactModule.createElement(View, { testID: `layer-${id}`, style, slot });
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
jest.mock('../../components/BackButton', () => {
  const ReactModule = require('react'); const { Text, TouchableOpacity } = require('react-native');
  return { BackButton: ({ onPress }: any) => ReactModule.createElement(TouchableOpacity, { onPress, accessibilityLabel: 'Back' }, ReactModule.createElement(Text, null, 'Back')) };
});
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
  return { RouteDrawOverlay: ({ active, onStroke, onDrawingStart }: any) => active ? ReactModule.createElement(
    TouchableOpacity, { testID: 'emit-route-stroke', onPress: () => { onDrawingStart?.(); onStroke(mockEmittedStroke); } }, ReactModule.createElement(Text, null, 'Emit stroke'),
  ) : null };
});
jest.mock('../../features/memory/components/FogLayer', () => ({ FogLayer: () => null }));
jest.mock('../../features/memory/store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: { getState: () => ({ loadSelectedProjections: jest.fn() }) },
}));
jest.mock('../../features/memory/store/useMemorySubscriptionsStore', () => {
  const state = { subscriptions: [], load: jest.fn(async () => undefined) };
  return { useMemorySubscriptionsStore: (selector: any) => selector(state) };
});
jest.mock('../../components/map/TrimSlider', () => {
  const ReactModule = require('react'); const { Text, TouchableOpacity, View } = require('react-native');
  return { TrimSlider: ({ onTrimStartChange, onTrimEndChange }: any) => ReactModule.createElement(
    View, null,
    ReactModule.createElement(TouchableOpacity, { testID: 'trim-start-25', onPress: () => onTrimStartChange(0.25) }, ReactModule.createElement(Text, null, 'Move start')),
    ReactModule.createElement(TouchableOpacity, { testID: 'trim-end-75', onPress: () => onTrimEndChange(0.75) }, ReactModule.createElement(Text, null, 'Move end')),
  ) };
});
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
  loadRoutePlannerDraft: jest.fn(async () => mockRecoveredDraftEnabled ? ({
    schemaVersion: 1, ownerId: 'owner-a', draftId: 'plan:screen',
    history: { present: mockLoadedDraft, past: mockRecoveredPast }, name: 'Screen Route', permission: 'personal', savedAt: 1,
    pendingDraw: mockRecoveredPending,
  }) : null),
  plannerDraftMatchesRequest: () => true,
  saveRoutePlannerDraft: (...args: any[]) => mockSaveDraft(...args),
  removeRoutePlannerDraft: jest.fn(async () => undefined),
  abandonRoutePlannerDraft: (ownerId: string, draftId: string) => mockAbandonDraft(ownerId, draftId),
}));
jest.mock('../../features/route/routePlanningProvider', () => ({
  orderedShapeDeviationM: jest.requireActual('../../features/route/routePlanningProvider').orderedShapeDeviationM,
  resolveDrawPlan: (...args: any[]) => mockResolveDraw(...args),
  resolvePointPlan: (...args: any[]) => mockResolvePoint(...args),
}));
jest.mock('../../features/route/routePlaceSearch', () => ({
  RoutePlaceSearchError: class RoutePlaceSearchError extends Error {
    code: string;
    constructor(mockCode: string) { super(mockCode); this.code = mockCode; }
  },
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
const mockSessionState: { sessions: any[] } = { sessions: [] };
jest.mock('../../store/useSessionStore', () => {
  const hook: any = (selector: any) => selector(mockSessionState); hook.getState = () => mockSessionState;
  return { useSessionStore: hook, loadActivityTrackPoints: (...args: any[]) => mockLoadActivityTrackPoints(...args) };
});
jest.mock('../../features/activity/activityFinalArtifact', () => ({
  loadActivityFinalArtifact: (...args: any[]) => mockLoadActivityFinalArtifact(...args),
}));

import { OrderedRouteEditorScreen } from '../OrderedRouteEditorScreen';

describe('OrderedRouteEditorScreen closure UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecoveredPending = null;
    mockRecoveredDraftEnabled = true;
    mockScreenParams = {};
    mockLoadedDraft = mockDraft;
    mockRecoveredPast = [];
    mockEmittedStroke = mockStroke;
    mockSessionState.sessions = [];
    mockLoadActivityTrackPoints.mockResolvedValue([]);
    mockLoadActivityFinalArtifact.mockResolvedValue(null);
    mockRouteState.addRoute.mockResolvedValue('saved-route-77');
    mockSearchPlaces.mockResolvedValue([{ id: 'place-1', label: 'Wellington', center: { lat: -41.2865, lng: 174.7762 } }]);
    mockResolveDraw.mockResolvedValue({ outcome: 'review', reason: 'shape-deviation', points: mockStroke });
    mockResolvePoint.mockResolvedValue({
      outcome: 'accepted',
      points: [
        { lat: -41.2865, lng: 174.7782 },
        { lat: -41.2858, lng: 174.7777 },
        { lat: -41.2865, lng: 174.7772 },
      ],
    });
    mockGetPointInView.mockResolvedValue([195, 300]);
  });

  test('mounts real editor controls, endpoints and the shared theme line above Standard basemap', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    expect(await screen.findByDisplayValue('Screen Route')).toBeTruthy();
    expect(screen.getByTestId('route-place-search')).toBeTruthy();
    expect(screen.getByTestId('route-current-location')).toBeTruthy();
    expect(screen.getByTestId('route-overview')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-endpoints').props.shape.features.map((feature: any) => feature.properties.role)).toEqual(['Start', 'End']);
    expect(screen.getByTestId('layer-ordered-route-line').props.slot).toBe('top');
    expect(screen.getByTestId('layer-ordered-route-line').props.style.lineColor).toBe('#2F684F');
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
    expect(mockCameraFit.mock.calls[0][2][1]).toBeGreaterThanOrEqual(80);
    expect(mockDraft.parts[0].points).toHaveLength(3);
  });

  test('search timeout terminates visibly, keeps the Route unchanged, and offers retry', async () => {
    const { RoutePlaceSearchError } = require('../../features/route/routePlaceSearch');
    mockSearchPlaces.mockRejectedValueOnce(new RoutePlaceSearchError('timeout'));
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-place-search'));
    fireEvent.changeText(screen.getByLabelText('Place or city search'), 'Tokyo');
    fireEvent.press(screen.getByText('Search'));
    expect(await screen.findByText('Search took too long. Check the connection and try again.')).toBeTruthy();
    expect(screen.getByText('Retry search')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates).toEqual(
      mockDraft.parts[0].points.map(point => [point.lng, point.lat]),
    );
  });

  test('a failed new place query never leaves the previous city selectable', async () => {
    const { RoutePlaceSearchError } = require('../../features/route/routePlaceSearch');
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-place-search'));
    fireEvent.changeText(screen.getByLabelText('Place or city search'), 'Wellington');
    fireEvent.press(screen.getByText('Search'));
    expect(await screen.findByText('Wellington')).toBeTruthy();
    mockSearchPlaces.mockRejectedValueOnce(new RoutePlaceSearchError('timeout'));
    fireEvent.changeText(screen.getByLabelText('Place or city search'), 'Tokyo');
    fireEvent.press(screen.getByText('Search'));
    expect(await screen.findByText('Search took too long. Check the connection and try again.')).toBeTruthy();
    expect(screen.queryByText('Wellington')).toBeNull();
  });

  test('More remains compact and disables empty Friends union without hiding Mine', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-more'));
    expect(screen.getByText('Exploration Fog')).toBeTruthy();
    expect(screen.getByText('Mine')).toBeTruthy();
    expect(screen.getByText('Mine + Friends')).toBeTruthy();
    expect(screen.getByText('No shared Friend Fog is available. Mine stays visible.')).toBeTruthy();
    expect(screen.queryByText('Planning context')).toBeNull();
    expect(screen.queryByText('Keep one recorded section')).toBeNull();
    expect(screen.queryByText('Reset draft')).toBeNull();
    expect(screen.getByTestId('icon-Layers')).toBeTruthy();
  });

  test('Search and More have one exclusive overlay owner', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');

    fireEvent.press(screen.getByTestId('route-place-search'));
    expect(screen.getByTestId('route-place-search-modal')).toBeTruthy();
    fireEvent.press(screen.getByTestId('route-more'));
    expect(screen.queryByTestId('route-place-search-modal')).toBeNull();
    expect(screen.getByTestId('route-more-menu')).toBeTruthy();

    fireEvent.press(screen.getByTestId('route-place-search'));
    expect(screen.queryByTestId('route-more-menu')).toBeNull();
    expect(screen.getByTestId('route-place-search-modal')).toBeTruthy();
  });

  test('cold plan does not paint an unrelated fallback map before a qualified current fix', async () => {
    mockRecoveredDraftEnabled = false;
    mockScreenParams = { creationSource: 'plan' };
    let resolveLocation!: (value: any) => void;
    const LocationMock = require('expo-location');
    LocationMock.getLastKnownPositionAsync.mockReturnValueOnce(new Promise(resolve => { resolveLocation = resolve; }));
    const screen = render(<OrderedRouteEditorScreen />);
    expect(await screen.findByTestId('ordered-route-editor')).toBeTruthy();
    expect(screen.getByTestId('route-initial-location-state')).toBeTruthy();
    expect(screen.queryByTestId('mock-camera')).toBeNull();
    await act(async () => {
      resolveLocation({ coords: { latitude: 31.2304, longitude: 121.4737, accuracy: 18 }, timestamp: Date.now() });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('mock-camera').props.centerCoordinate).toEqual([121.4737, 31.2304]));
    expect(screen.getByTestId('mock-camera').props.zoomLevel).toBe(14);
  });

  test('a deliberate place choice fences a late initial GPS result', async () => {
    mockRecoveredDraftEnabled = false;
    mockScreenParams = { creationSource: 'plan' };
    let resolveLocation!: (value: any) => void;
    const LocationMock = require('expo-location');
    LocationMock.getLastKnownPositionAsync.mockReturnValueOnce(new Promise(resolve => { resolveLocation = resolve; }));
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByTestId('route-initial-location-state');
    fireEvent.press(screen.getByTestId('route-place-search'));
    fireEvent.changeText(screen.getByLabelText('Place or city search'), 'Wellington');
    fireEvent.press(screen.getByText('Search'));
    fireEvent.press(await screen.findByText('Wellington'));
    await waitFor(() => expect(screen.getByTestId('mock-camera').props.centerCoordinate).toEqual([174.7762, -41.2865]));
    await act(async () => {
      resolveLocation({ coords: { latitude: 31.2304, longitude: 121.4737, accuracy: 18 }, timestamp: Date.now() });
      await Promise.resolve();
    });
    expect(screen.getByTestId('mock-camera').props.centerCoordinate).toEqual([174.7762, -41.2865]);
  });

  test('Activity import immediately renders the complete canonical multipart geometry', async () => {
    mockRecoveredDraftEnabled = false;
    mockScreenParams = { creationSource: 'activity', fromSessionId: 'activity-good' };
    mockSessionState.sessions = [{
      id: 'activity-good',
      clientActivityId: 'client-good',
      name: 'good',
      activityMode: 'hiking',
    }];
    const canonical = [
      { lat: 31.2304, lng: 121.4737, t: 1, segmentId: 'first' },
      { lat: 31.2310, lng: 121.4748, t: 2, segmentId: 'first' },
      { lat: 31.2321, lng: 121.4741, t: 3, segmentId: 'second', segmentStartReason: 'gps-reacquired' },
      { lat: 31.2328, lng: 121.4754, t: 4, segmentId: 'second' },
    ];
    mockLoadActivityTrackPoints.mockResolvedValue(canonical);
    mockLoadActivityFinalArtifact.mockResolvedValue({ points: [canonical[0], canonical.at(-1)] });

    const screen = render(<OrderedRouteEditorScreen />);
    expect(await screen.findByDisplayValue('good Route')).toBeTruthy();
    const features = screen.getByTestId('source-ordered-route-parts').props.shape.features;
    expect(features.map((feature: any) => feature.geometry.coordinates)).toEqual([
      canonical.slice(0, 2).map(point => [point.lng, point.lat]),
      canonical.slice(2).map(point => [point.lng, point.lat]),
    ]);
    expect(screen.getByTestId('source-ordered-route-gaps')).toBeTruthy();
    expect(screen.getByTestId('mock-camera').props.bounds).toEqual(expect.objectContaining({
      ne: [121.4754, 31.2328],
      sw: [121.4737, 31.2304],
      paddingRight: 88,
    }));
  });

  test('R1 explicit Activity Back then Create starts pristine with empty Undo and a new draft identity', async () => {
    mockRecoveredDraftEnabled = true;
    mockScreenParams = {
      creationSource: 'activity', fromSessionId: 'activity-good', creationSessionId: 'create-a',
    };
    mockSessionState.sessions = [{
      id: 'activity-good', clientActivityId: 'client-good', name: 'goood', activityMode: 'hiking',
    }];
    const canonical = [
      { lat: -41.2865, lng: 174.7762, t: 1, segmentId: 'first' },
      { lat: -41.2865, lng: 174.7772, t: 2, segmentId: 'first' },
      { lat: -41.2865, lng: 174.7782, t: 3, segmentId: 'first' },
    ];
    mockLoadActivityTrackPoints.mockResolvedValue(canonical);

    const first = render(<OrderedRouteEditorScreen />);
    await first.findByDisplayValue('goood Route');
    fireEvent.press(first.getByTestId('route-tool-trim'));
    fireEvent.press(first.getByTestId('trim-start-25'));
    fireEvent.press(first.getByTestId('route-trim-apply'));
    expect(first.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false);
    fireEvent.press(first.getByLabelText('Back'));
    expect(mockAbandonDraft).toHaveBeenCalledWith('owner-a', 'activity:activity-good:create-a');
    first.unmount();

    mockScreenParams = {
      creationSource: 'activity', fromSessionId: 'activity-good', creationSessionId: 'create-b',
    };
    const second = render(<OrderedRouteEditorScreen />);
    await second.findByDisplayValue('goood Route');
    expect(second.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
    expect(second.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates)
      .toEqual(canonical.map(point => [point.lng, point.lat]));
  });

  test('R1 two explicit creates from one Activity save independent Route values', async () => {
    mockRecoveredDraftEnabled = false;
    mockSessionState.sessions = [{
      id: 'activity-good', clientActivityId: 'client-good', name: 'goood', activityMode: 'hiking',
    }];
    const canonical = [
      { lat: -41.2865, lng: 174.7762, t: 1, segmentId: 'first' },
      { lat: -41.2865, lng: 174.7772, t: 2, segmentId: 'first' },
      { lat: -41.2865, lng: 174.7782, t: 3, segmentId: 'first' },
    ];
    mockLoadActivityTrackPoints.mockResolvedValue(canonical);
    mockRouteState.addRoute.mockResolvedValueOnce('derived-a').mockResolvedValueOnce('derived-b');

    mockScreenParams = {
      creationSource: 'activity', fromSessionId: 'activity-good', creationSessionId: 'save-a',
    };
    const first = render(<OrderedRouteEditorScreen />);
    await first.findByDisplayValue('goood Route');
    fireEvent.changeText(first.getByLabelText('Route name'), 'First derived');
    fireEvent.press(first.getByTestId('ordered-route-save'));
    await waitFor(() => expect(mockNavReplace).toHaveBeenCalledWith('MapHistory', { routeId: 'derived-a' }));
    first.unmount();

    mockScreenParams = {
      creationSource: 'activity', fromSessionId: 'activity-good', creationSessionId: 'save-b',
    };
    const second = render(<OrderedRouteEditorScreen />);
    await second.findByDisplayValue('goood Route');
    fireEvent.press(second.getByTestId('route-tool-trim'));
    fireEvent.press(second.getByTestId('trim-start-25'));
    fireEvent.press(second.getByTestId('route-trim-apply'));
    fireEvent.changeText(second.getByLabelText('Route name'), 'Second derived');
    fireEvent.press(second.getByTestId('ordered-route-save'));
    await waitFor(() => expect(mockNavReplace).toHaveBeenCalledWith('MapHistory', { routeId: 'derived-b' }));

    expect(mockRouteState.addRoute).toHaveBeenCalledTimes(2);
    const firstSaved = mockRouteState.addRoute.mock.calls[0][0];
    const secondSaved = mockRouteState.addRoute.mock.calls[1][0];
    expect(firstSaved.name).toBe('First derived');
    expect(secondSaved.name).toBe('Second derived');
    expect(firstSaved.points.map(({ lat, lng }: any) => ({ lat, lng })))
      .toEqual(canonical.map(({ lat, lng }) => ({ lat, lng })));
    expect(secondSaved.points).not.toEqual(firstSaved.points);
  });

  test('a clear replacement uses the intent-safe line without opening provider review UI', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await waitFor(() => expect(screen.queryByTestId('emit-route-stroke')).toBeNull());
    expect(screen.queryByTestId('route-inline-review')).toBeNull();
    expect(screen.queryByText('Review this Route edit')).toBeNull();
    expect(screen.queryByTestId('source-ordered-route-review-candidate')).toBeNull();
    expect(screen.queryByTestId('source-ordered-route-review-original')).toBeNull();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false);
    expect(mockDraft.parts[0].points).toHaveLength(3);
  });

  test('R2 old Scenario E now replaces its uniquely anchored zigzag through the active editor', async () => {
    const { HUMAN_ROUTE_DRAWING_FIXTURES } = require('../../features/routeDrawing/humanIntentFixtures');
    const fixture = HUMAN_ROUTE_DRAWING_FIXTURES.ambiguousCrossing;
    mockLoadedDraft = {
      ...mockDraft,
      parts: [{
        id: 'scenario-e-route', resolution: 'point' as const,
        points: fixture.originalRoute.map(({ lat, lng }: any) => ({ lat, lng })),
      }],
    };
    mockEmittedStroke = fixture.rawStroke.map(({ lat, lng }: any) => ({ lat, lng }));
    mockResolveDraw.mockResolvedValueOnce({
      outcome: 'accepted',
      points: fixture.providerGeometry.map(({ lat, lng }: any) => ({ lat, lng })),
    });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await waitFor(() => expect(screen.queryByTestId('emit-route-stroke')).toBeNull());

    expect(mockResolveDraw).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Redraw from clearer positions so Cairn can preserve the right path.')).toBeNull();
    const committed = screen.getByTestId('source-ordered-route-parts').props.shape.features
      .flatMap((feature: any) => feature.geometry.coordinates);
    expect(committed).toEqual(fixture.rawStroke.map(({ lng, lat }: any) => [lng, lat]));
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false);
  });

  test('R2 true competing endpoint occurrences stay unchanged with a specific hint before provider', async () => {
    const { HUMAN_ROUTE_DRAWING_FIXTURES } = require('../../features/routeDrawing/humanIntentFixtures');
    const fixture = HUMAN_ROUTE_DRAWING_FIXTURES.trueAmbiguousOccurrences;
    mockLoadedDraft = {
      ...mockDraft,
      parts: [{
        id: 'scenario-e2-route', resolution: 'point' as const,
        points: fixture.originalRoute.map(({ lat, lng }: any) => ({ lat, lng })),
      }],
    };
    mockEmittedStroke = fixture.rawStroke.map(({ lat, lng }: any) => ({ lat, lng }));
    const original = fixture.originalRoute.map(({ lng, lat }: any) => [lng, lat]);
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    expect(await screen.findByText('Redraw from clearer positions so Cairn can preserve the right path.')).toBeTruthy();
    expect(mockResolveDraw).not.toHaveBeenCalled();
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates).toEqual(original);
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
  });

  test.each([
    { kind: 'pending-replace' as const },
    { kind: 'pending-bridge' as const, gapId: 'gap-a' },
  ])('a recovered legacy $kind transaction is discarded instead of restoring stale Draw mode', async pending => {
    mockRecoveredPending = {
      ...pending,
      draftId: 'plan:screen',
      baseRevision: 1,
      points: [
        { lat: -41.2865, lng: 174.7767 },
        { lat: -41.2858, lng: 174.7777 },
      ],
    };
    const screen = render(<OrderedRouteEditorScreen />);
    expect(await screen.findByDisplayValue('Screen Route')).toBeTruthy();
    expect(screen.queryByTestId('route-pending-multistroke')).toBeNull();
    expect(screen.queryByTestId('source-ordered-route-pending')).toBeNull();
    expect(screen.getByTestId('route-tool-point').props.accessibilityState.disabled).not.toBe(true);
    expect(screen.queryByText('Draw is still active')).toBeNull();
    expect(screen.queryByText(/Section \d/)).toBeNull();
    expect(mockDraft.parts[0].points).toHaveLength(3);
  });

  test('Point applies an accepted provider path directly and keeps its exact growth geometry visible', async () => {
    reduceMotionSpy.mockResolvedValueOnce(false);
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    await waitFor(() => expect(screen.getByTestId('source-ordered-route-growth')).toBeTruthy());
    expect(screen.queryByText('Review this walking Route')).toBeNull();
    // The accepted part is intentionally hidden while its bounded growth
    // animation renders the exact validated provider geometry.
    expect(screen.getByTestId('source-ordered-route-growth').props.shape.geometry.coordinates).toHaveLength(2);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1_200));
    });
    expect(screen.queryByTestId('source-ordered-route-growth')).toBeNull();
  });

  test('R3/R4 Point retrace selects the ordered known subpath, follows one reveal timeline, and user pan cancels it', async () => {
    reduceMotionSpy.mockResolvedValueOnce(false);
    mockLoadedDraft = {
      ...mockDraft,
      parts: [{ ...mockDraft.parts[0], resolution: 'draw-matched' as const }],
    };
    mockGetPointInView.mockResolvedValue([195, 5_000]);
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');

    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    await waitFor(() => expect(screen.getByTestId('source-ordered-route-growth')).toBeTruthy());
    const growth = screen.getByTestId('source-ordered-route-growth').props.shape.geometry.coordinates;
    expect(growth[0]).toEqual([174.7782, -41.2865]);
    expect(growth).not.toContainEqual([174.7777, -41.2858]);
    await waitFor(() => expect(mockGetPointInView).toHaveBeenCalled());
    await waitFor(() => expect(mockCameraSet).toHaveBeenCalledWith(expect.objectContaining({
      zoomLevel: 14,
      heading: 0,
      pitch: 0,
      animationDuration: 96,
    })));

    const cameraCallsBeforePan = mockCameraSet.mock.calls.length;
    fireEvent(screen.getByTestId('mock-map'), 'cameraChanged', {
      properties: { center: [174.7775, -41.2864], zoom: 14, heading: 0, pitch: 0, isUserInteraction: true },
    });
    expect(screen.queryByTestId('source-ordered-route-growth')).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    expect(mockCameraSet).toHaveBeenCalledTimes(cameraCallsBeforePan);
    const committed = screen.getByTestId('source-ordered-route-parts').props.shape.features;
    expect(committed).toHaveLength(2);
    expect(committed[1].geometry.coordinates).toEqual([
      [174.7782, -41.2865],
      [174.7772, -41.2865],
    ]);
    fireEvent.press(screen.getByLabelText('Undo last Route edit'));
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features).toHaveLength(1);
  });

  test('R3 mixed Draw then Point actions keep a coincident seam and do not append the provider triangle', async () => {
    reduceMotionSpy.mockResolvedValueOnce(true);
    mockLoadedDraft = {
      ...mockDraft,
      parts: [{ ...mockDraft.parts[0], resolution: 'draw-matched' as const }],
    };
    mockResolveDraw.mockResolvedValueOnce({ outcome: 'accepted', points: mockStroke });
    mockResolvePoint.mockResolvedValueOnce({
      outcome: 'accepted',
      points: [
        { lat: -41.2865, lng: 174.7782 },
        { lat: -41.2865, lng: 174.7772 },
      ],
    });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await waitFor(() => expect(screen.queryByTestId('emit-route-stroke')).toBeNull());

    fireEvent.press(screen.getByTestId('route-tool-point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    await waitFor(() => expect(mockResolvePoint).toHaveBeenCalledTimes(1));
    const features = screen.getByTestId('source-ordered-route-parts').props.shape.features;
    expect(features.length).toBeGreaterThanOrEqual(2);
    const before = features.at(-2).geometry.coordinates;
    const continuation = features.at(-1).geometry.coordinates;
    expect(continuation[0]).toEqual(before.at(-1));
    expect(continuation).not.toContainEqual([174.7777, -41.2858]);
  });

  test.each(['plan', 'activity'] as const)('Trim is map-visible for a %s draft, previews live, applies once, and Undo restores it', async origin => {
    mockLoadedDraft = { ...mockDraft, origin };
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    const original = screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates;
    fireEvent.press(screen.getByText('Trim'));
    expect(screen.getByTestId('route-trim-strip')).toBeTruthy();
    expect(screen.queryByText('Cancel')).toBeNull();
    expect(screen.queryByText('Drag the handles to shorten your route.')).toBeNull();
    expect(screen.getByTestId('source-ordered-route-trim-original')).toBeTruthy();
    fireEvent.press(screen.getByTestId('trim-start-25'));
    fireEvent.press(screen.getByTestId('trim-end-75'));
    const preview = screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates;
    expect(preview).not.toEqual(original);
    fireEvent.press(screen.getByTestId('route-trim-apply'));
    expect(screen.queryByTestId('route-trim-strip')).toBeNull();
    fireEvent.press(screen.getByLabelText('Undo last Route edit'));
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates).toEqual(
      mockDraft.parts[0].points.map(point => [point.lng, point.lat]),
    );
  });

  test('Trim cannot create an empty Undo transaction before either handle moves', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Trim'));
    expect(screen.getByTestId('route-trim-apply').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('route-trim-apply'));
    expect(screen.getByTestId('route-trim-strip')).toBeTruthy();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
  });

  test('Point uses the shared bottom context with exact Set start/Add point copy and no floating action', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Point'));
    expect(screen.getByTestId('route-point-context')).toBeTruthy();
    expect(screen.getByTestId('route-point-confirm')).toBeTruthy();
    expect(screen.getByText('Move map to choose.')).toBeTruthy();
    expect(screen.getByText('Add point')).toBeTruthy();
    expect(screen.queryByTestId('route-point-add-here')).toBeNull();
    expect(screen.queryByText('Add destination')).toBeNull();
    expect(screen.queryByText('Replace a section')).toBeNull();
    expect(screen.queryByText(/Section \d/)).toBeNull();
  });

  test('accepted Draw is one-shot and returns to Browse before another single-finger interaction', async () => {
    mockResolveDraw.mockResolvedValueOnce({ outcome: 'accepted', points: mockStroke });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    expect(screen.getByText('Draw to reshape your route.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await waitFor(() => expect(screen.queryByTestId('emit-route-stroke')).toBeNull());
    expect(screen.getByText('Line added. Move the map, or tap Draw to continue.')).toBeTruthy();
    expect(screen.getByTestId('route-tool-draw').props.accessibilityState.selected).toBe(false);
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    expect(screen.getByTestId('emit-route-stroke')).toBeTruthy();
  });

  test('split match on a clear replacement falls back to the raw intent without a confirmation dialog', async () => {
    mockResolveDraw.mockResolvedValueOnce({ outcome: 'manual-available', reason: 'split-match', rawPoints: mockStroke });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await waitFor(() => expect(screen.queryByTestId('emit-route-stroke')).toBeNull());
    expect(screen.queryByTestId('route-freehand-choice')).toBeNull();
    expect(screen.queryByText('Keep the line you drew?')).toBeNull();
    expect(screen.queryByText('Redraw')).toBeNull();
    expect(screen.queryByText('Use drawing')).toBeNull();
    expect(screen.queryByText(/provider|disconnected pieces/i)).toBeNull();
    expect(screen.getByTestId('source-ordered-route-parts')).toBeTruthy();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false);
  });

  test('switching Trim to Point removes the unapplied preview and keeps dock anchors stable', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    const original = screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates;
    fireEvent.press(screen.getByTestId('route-tool-trim'));
    fireEvent.press(screen.getByTestId('trim-start-25'));
    expect(screen.getByTestId('source-ordered-route-trim-original')).toBeTruthy();
    fireEvent.press(screen.getByTestId('route-tool-point'));
    expect(screen.queryByTestId('route-trim-strip')).toBeNull();
    expect(screen.queryByTestId('source-ordered-route-trim-original')).toBeNull();
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates).toEqual(original);
    expect(screen.getByTestId('route-point-context')).toBeTruthy();
    expect(screen.getByTestId('route-name-save-row')).toBeTruthy();
  });

  test('name and Save share the lowest row without a permanent readiness caption', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    const row = screen.getByTestId('route-name-save-row');
    expect(row.findByProps({ accessibilityLabel: 'Route name' })).toBeTruthy();
    expect(row.findByProps({ testID: 'ordered-route-save' })).toBeTruthy();
    expect(screen.queryByText('Ready to save')).toBeNull();
  });

  test('Save persists the accepted ordered geometry and replaces the editor with normal Route detail', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('ordered-route-save'));
    await waitFor(() => expect(mockRouteState.addRoute).toHaveBeenCalledTimes(1));
    const saved = mockRouteState.addRoute.mock.calls[0][0];
    expect(saved.orderedDraft.parts).toEqual(mockDraft.parts);
    expect(saved.points).toEqual(mockDraft.parts[0].points);
    expect(mockNavReplace).toHaveBeenCalledWith('MapHistory', { routeId: 'saved-route-77' });
    expect(screen.queryByText('Route saved')).toBeNull();
  });

  test('pending Point has an explicit Cancel while Undo remains reserved for committed history', async () => {
    mockLoadedDraft = {
      ...mockDraft,
      revision: 2,
      parts: [
        mockDraft.parts[0],
        {
          id: 'part-b', resolution: 'point' as const,
          points: [
            { lat: -41.2865, lng: 174.7782 },
            { lat: -41.2861, lng: 174.7787 },
            { lat: -41.2865, lng: 174.7792 },
          ],
        },
      ],
    };
    mockRecoveredPast = [{ draft: mockDraft, operation: 'append-point' }];
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');

    let resolveSlow!: (value: any) => void;
    mockResolvePoint.mockReturnValueOnce(new Promise(resolve => { resolveSlow = resolve; }));
    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    expect(await screen.findByText('Finding a path…')).toBeTruthy();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByText('Cancel'));
    await act(async () => {
      resolveSlow({ outcome: 'accepted', points: mockStroke });
      await Promise.resolve();
    });
    expect(screen.queryByText('Review this walking Route')).toBeNull();
    const rendered = screen.getByTestId('source-ordered-route-parts').props.shape.features;
    expect(rendered).toHaveLength(2);
  });

  test('one-shot Draw Cancel fences a slow provider reply without creating Undo history', async () => {
    let resolveSlow!: (value: any) => void;
    mockResolveDraw.mockReturnValueOnce(new Promise(resolve => { resolveSlow = resolve; }));
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    expect(await screen.findByText('Finding a path…')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-pending').props.shape.geometry.coordinates).toEqual(
      mockStroke.map(point => [point.lng, point.lat]),
    );
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByText('Cancel'));
    await act(async () => {
      resolveSlow({ outcome: 'review', reason: 'shape-deviation', points: mockStroke });
      await Promise.resolve();
    });
    expect(screen.queryByText('Review this Route edit')).toBeNull();
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates).toEqual(
      mockDraft.parts[0].points.map(point => [point.lng, point.lat]),
    );
  });

  test('Point review Cancel dismisses only the uncommitted result', async () => {
    mockResolvePoint.mockResolvedValueOnce({
      outcome: 'review',
      reason: 'endpoint-shift',
      points: mockStroke,
    });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    expect(await screen.findByTestId('route-inline-review')).toBeTruthy();
    fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByTestId('route-inline-review')).toBeNull();
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates).toEqual(
      mockDraft.parts[0].points.map(point => [point.lng, point.lat]),
    );
  });

  test('N02 same-frame repeated Point confirmation starts only one provider transaction', async () => {
    let resolveSlow!: (value: any) => void;
    mockResolvePoint.mockReturnValueOnce(new Promise(resolve => { resolveSlow = resolve; }));
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Point'));
    let action: any = screen.getByTestId('route-point-confirm');
    while (action && typeof action.props.onPress !== 'function') action = action.parent;
    expect(action).toBeTruthy();
    act(() => {
      action.props.onPress();
      action.props.onPress();
    });
    expect(mockResolvePoint).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText('Cancel'));
    await act(async () => {
      resolveSlow({ outcome: 'accepted', points: mockStroke });
      await Promise.resolve();
    });
    expect(screen.queryByTestId('route-inline-review')).toBeNull();
  });
});
