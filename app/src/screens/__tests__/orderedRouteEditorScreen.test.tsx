import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';

const reduceMotionSpy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

const mockCameraSet = jest.fn();
const mockCameraFit = jest.fn();
const mockCameraCancel = jest.fn();
const mockGetPointInView = jest.fn(async () => [195, 300]);
const mockPointMotionBasemapActive = jest.fn<Promise<void>, [boolean]>(async (_active: boolean) => undefined);
const mockNavReplace = jest.fn();
let mockBeforeRemove: ((event: any) => void) | null = null;
const mockNavGoBack = jest.fn(() => {
  mockBeforeRemove?.({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });
});
const mockAbandonDraft = jest.fn(async (_ownerId: string, _draftId: string) => undefined);
const mockResolveDraw = jest.fn();
const mockResolvePoint = jest.fn();
const mockSearchPlaces = jest.fn();
const mockSaveDraft = jest.fn(async (..._args: any[]) => undefined);
let mockRecoveredPending: any = null;
let mockRecoveredDraftEnabled = true;
let mockScreenParams: any = { routeId: 'route-screen' };
const mockLoadActivityTrackPoints = jest.fn();
const mockLoadActivityFinalArtifact = jest.fn();
const mockLoadMemorySubscriptions = jest.fn(async (..._args: any[]) => undefined);
const mockLoadSelectedProjections = jest.fn(async () => undefined);
const mockHydrateFriendMemory = jest.fn(async (_ownerId: string) => undefined);
const mockFogLayer = jest.fn((_props: any) => null);
let mockMemorySubscriptions: any[] = [];
let mockFriendMemoryUserId: string | null = null;
let mockFriendMemoryError: 'offline' | 'unavailable' | null = null;
let mockFriendSourceStates: Record<string, { status: string; cellCount: number; error?: string }> = {};
let mockMemoryScopeOwner: string | null = 'owner-a';
let mockMemoryScope: 'self' | 'combined' = 'self';
let mockMapTheme: 'day' | 'night' = 'day';
const mockSetMemoryScope = jest.fn((scope: 'self' | 'combined') => { mockMemoryScope = scope; });
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
  useNavigation: () => ({
    goBack: mockNavGoBack,
    replace: mockNavReplace,
    navigate: jest.fn(),
    addListener: jest.fn((name: string, listener: (event: any) => void) => {
      if (name === 'beforeRemove') mockBeforeRemove = listener;
      return () => { if (mockBeforeRemove === listener) mockBeforeRemove = null; };
    }),
  }),
  useRoute: () => ({ params: mockScreenParams }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@rnmapbox/maps', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const Camera = ReactModule.forwardRef((props: any, ref: any) => {
    ReactModule.useImperativeHandle(ref, () => ({ setCamera: mockCameraSet, fitBounds: mockCameraFit, cancelAnimation: mockCameraCancel }));
    return ReactModule.createElement(View, { testID: 'mock-camera', ...props });
  });
  const MapView = ReactModule.forwardRef(({ children, onCameraChanged, ...props }: any, ref: any) => {
    ReactModule.useImperativeHandle(ref, () => ({
      getCoordinateFromView: jest.fn(),
      getPointInView: mockGetPointInView,
      setPointMotionBasemapActive: mockPointMotionBasemapActive,
    }));
    ReactModule.useEffect(() => {
      onCameraChanged?.({ properties: { center: [174.7772, -41.2865] } });
    }, [onCameraChanged]);
    return ReactModule.createElement(View, { testID: 'mock-map', onCameraChanged, ...props }, children);
  });
  const source = ({ id, shape, children }: any) => ReactModule.createElement(View, { testID: `source-${id}`, shape }, children);
  const layer = ({ id, style, slot, ...props }: any) => ReactModule.createElement(View, { testID: `layer-${id}`, style, slot, ...props });
  const UserLocation = ({ children, ...props }: any) => ReactModule.createElement(View, { testID: 'mock-user-location', ...props }, children);
  return {
    MapView, Camera,
    ShapeSource: source, LineLayer: layer, CircleLayer: layer, SymbolLayer: layer, UserLocation,
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
jest.mock('../../components/MapLoadOverlay', () => {
  const ReactModule = require('react'); const { View } = require('react-native');
  return { MapLoadOverlay: ({ testID, state, onRetry }: any) => ReactModule.createElement(View, { testID, state, onRetry }) };
});
jest.mock('../../components/ModalCard', () => {
  const ReactModule = require('react'); const { Text, View } = require('react-native');
  return {
    ModalCard: ({ visible, children, testID, presentation }: any) => visible
      ? ReactModule.createElement(View, { testID, presentation }, children)
      : null,
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
jest.mock('../../features/memory/components/FogLayer', () => ({ FogLayer: (props: any) => mockFogLayer(props) }));
jest.mock('../../features/memory/store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: Object.assign((selector: any) => selector({
    error: mockFriendMemoryError,
    sourceStates: mockFriendSourceStates,
    loadSelectedProjections: mockLoadSelectedProjections,
  }), { getState: () => ({
    userId: mockFriendMemoryUserId,
    error: mockFriendMemoryError,
    sourceStates: mockFriendSourceStates,
    hydrate: async (ownerId: string) => { mockFriendMemoryUserId = ownerId; await mockHydrateFriendMemory(ownerId); },
    loadSelectedProjections: mockLoadSelectedProjections,
  }) }),
}));
jest.mock('../../features/memory/store/useMemorySubscriptionsStore', () => {
  const state = {
    get subscriptions() { return mockMemorySubscriptions; },
    availableSources: [],
    loading: false,
    error: null,
    load: (...args: any[]) => mockLoadMemorySubscriptions(...args),
    subscribe: jest.fn(async () => 200),
    unsubscribe: jest.fn(async () => 200),
    isSubscribed: (friendId: number) => mockMemorySubscriptions.some(item => item.friend_id === friendId),
  };
  return {
    useMemorySubscriptionsStore: Object.assign(
      (selector: any) => selector(state),
      { getState: () => state },
    ),
  };
});
jest.mock('../../features/memory/store/useMemoryScopeStore', () => {
  const getState = () => ({
    ownerUserId: mockMemoryScopeOwner,
    scope: mockMemoryScope,
    activateOwner: jest.fn(),
    setScope: mockSetMemoryScope,
  });
  const hook: any = (selector: any) => selector(getState());
  hook.getState = getState;
  return {
    useMemoryScopeStore: hook,
    memoryScopeForNewRoute: (ownerUserId: string | number | null | undefined) => (
      ownerUserId != null
      && mockMemoryScopeOwner === String(ownerUserId)
        ? mockMemoryScope
        : 'self'
    ),
  };
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
jest.mock('../../hooks/useMapTheme', () => ({ useMapTheme: () => mockMapTheme }));
jest.mock('../../utils/distanceFormat', () => ({ useDistance: () => ({ unit: 'km', format: (metres: number) => String(metres) }) }));
jest.mock('../../config/regions', () => ({ getCurrentRegion: () => ({ centerLng: 174.77, centerLat: -41.28, defaultZoom: 12 }) }));
jest.mock('../../config/mapbox', () => ({
  buildStandardConfig: () => ({}), getMapStyleForTheme: (_layer: string, theme: string) => ({ kind: 'url', url: `mapbox://styles/test-${theme}` }), themeToStandardPreset: (theme: string) => theme,
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
  get routes() {
    return [{
      id: 'route-screen', name: 'Screen Route', permission: 'personal', creationOrigin: 'plan',
      points: mockLoadedDraft.parts.flatMap((part: any) => part.points), orderedDraft: mockLoadedDraft,
    }];
  },
  sharedRoutes: [], addRoute: jest.fn(), updateRoute: jest.fn(),
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
    mockBeforeRemove = null;
    mockRecoveredPending = null;
    mockRecoveredDraftEnabled = true;
    mockScreenParams = { routeId: 'route-screen' };
    mockLoadedDraft = mockDraft;
    mockRecoveredPast = [];
    mockMemorySubscriptions = [];
    mockFriendMemoryUserId = null;
    mockFriendMemoryError = null;
    mockFriendSourceStates = {};
    mockMemoryScopeOwner = 'owner-a';
    mockMemoryScope = 'self';
    mockMapTheme = 'day';
    mockEmittedStroke = mockStroke;
    mockSessionState.sessions = [];
    mockLoadActivityTrackPoints.mockResolvedValue([]);
    mockLoadActivityFinalArtifact.mockResolvedValue(null);
    mockRouteState.addRoute.mockResolvedValue('saved-route-77');
    mockSearchPlaces.mockResolvedValue([{ id: 'place-1', label: 'Wellington', center: { lat: -41.2865, lng: 174.7762 } }]);
    mockResolveDraw.mockResolvedValue({ outcome: 'manual-available', reason: 'shape-deviation', rawPoints: mockStroke, callCount: 1 });
    mockResolvePoint.mockResolvedValue({
      outcome: 'accepted',
      points: [
        { lat: -41.2865, lng: 174.7782 },
        { lat: -41.2858, lng: 174.7777 },
        { lat: -41.2865, lng: 174.7772 },
      ],
    });
    mockGetPointInView.mockResolvedValue([195, 300]);
    mockPointMotionBasemapActive.mockResolvedValue(undefined);
  });

  test('mounts real editor controls, endpoints and the shared theme line above Standard basemap', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    expect(await screen.findByDisplayValue('Screen Route')).toBeTruthy();
    expect(screen.queryByTestId('route-place-search')).toBeNull();
    expect(screen.getByTestId('route-current-location')).toBeTruthy();
    expect(screen.getByTestId('route-overview')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-endpoints').props.shape.features.map((feature: any) => feature.properties.role)).toEqual(['Start', 'End']);
    expect(screen.getByTestId('layer-ordered-route-line').props.slot).toBe('top');
    expect(screen.getByTestId('layer-ordered-route-line').props.style.lineColor).toBe('#2F684F');
    expect(screen.getByTestId('source-ordered-route-fog-boundary-source').props.shape).toEqual(expect.objectContaining({
      geometry: { type: 'Point', coordinates: [0, 0] },
    }));
    expect(screen.getByTestId('layer-ordered-route-fog-boundary').props.style).toEqual({ circleRadius: 0, circleOpacity: 0 });
    expect(screen.getByTestId('layer-ordered-route-line').props.aboveLayerID).toBe('ordered-route-fog-boundary');
    expect(mockFogLayer).toHaveBeenLastCalledWith(expect.objectContaining({
      belowLayerID: 'ordered-route-fog-boundary',
    }));
    const headerStyle = StyleSheet.flatten(screen.getByTestId('route-editor-header').props.style);
    expect(headerStyle.backgroundColor).toBeUndefined();
    expect(headerStyle.borderBottomWidth).toBe(0);
  });

  test('current location and overview move only the camera', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-current-location'));
    await waitFor(() => expect(mockCameraSet).toHaveBeenCalledWith(expect.objectContaining({ centerCoordinate: [174.79, -41.29] })));
    fireEvent.press(screen.getByTestId('route-overview'));
    expect(mockCameraFit).toHaveBeenCalledTimes(1);
    expect(mockCameraFit.mock.calls[0][2][1]).toBeGreaterThanOrEqual(80);
    expect(mockDraft.parts[0].points).toHaveLength(3);
  });

  test('More remains compact and disables empty Friends union without hiding Mine', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-more'));
    expect(screen.getByText('Exploration Fog')).toBeTruthy();
    expect(screen.getByText('Mine')).toBeTruthy();
    expect(screen.getByText('Mine & Friends')).toBeTruthy();
    expect(screen.getByText('No shared Friend Fog is available. Mine stays visible.')).toBeTruthy();
    expect(screen.queryByText('Planning context')).toBeNull();
    expect(screen.queryByText('Keep one recorded section')).toBeNull();
    expect(screen.queryByText('Reset draft')).toBeNull();
    expect(screen.getByTestId('icon-Layers')).toBeTruthy();
  });

  test('R9 hydrates selected Friend Fog and forwards the combined scope without changing Memory selection', async () => {
    mockMemorySubscriptions = [{ friend_id: 11, friend_name: 'First Friend' }];
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    await waitFor(() => expect(mockHydrateFriendMemory).toHaveBeenCalledWith('owner-a'));
    await waitFor(() => expect(mockLoadMemorySubscriptions).toHaveBeenCalled());
    expect(mockLoadSelectedProjections).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('route-more'));
    const combined = screen.getByText('Mine & Friends');
    expect(combined.parent?.props.accessibilityState?.disabled).not.toBe(true);
    fireEvent.press(combined);
    await waitFor(() => expect(mockFogLayer).toHaveBeenLastCalledWith(expect.objectContaining({ scopeOverride: 'combined' })));
    expect(mockMemorySubscriptions).toEqual([{ friend_id: 11, friend_name: 'First Friend' }]);
  });

  test('a terminal Friend source failure uses one central fail-closed status and keeps the checkbox immediate', async () => {
    mockMemorySubscriptions = [{ friend_id: 11, friend_name: 'First Friend' }];
    mockFriendSourceStates = { '11': { status: 'error', cellCount: 0, error: 'Unavailable' } };
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-more'));
    fireEvent.press(screen.getByText('Mine & Friends'));
    const combined = screen.getByLabelText('Mine and Friends exploration');
    expect(combined.props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    expect(combined.props.accessibilityState.busy).toBeUndefined();
    expect(screen.queryByText('No shared Friend Fog is available. Mine stays visible.')).toBeNull();
    act(() => {
      mockFogLayer.mock.calls.at(-1)?.[0].onFogPreparing?.('failed-scene', false);
      mockFogLayer.mock.calls.at(-1)?.[0].onFogUnavailable?.('failed-scene');
      fireEvent(screen.getByTestId('mock-map'), 'didFinishRenderingMapFully');
      fireEvent(screen.getByTestId('mock-map'), 'didFinishRenderingFrameFully');
    });
    expect(await screen.findByText('Shared exploration could not refresh. Mine remains visible.')).toBeTruthy();
    expect(screen.getByTestId('route-scene-retry')).toBeTruthy();
    expect(screen.queryByText('Updating exploration…')).toBeNull();
    fireEvent.press(screen.getByTestId('route-scene-retry'));
    expect(mockLoadSelectedProjections).toHaveBeenCalledTimes(1);
  });

  test('R01 cold Route core becomes usable on the native loading-map capability without a full-render or Fog callback', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    expect(screen.getByTestId('ordered-route-map-load-overlay')).toBeTruthy();

    act(() => {
      mockFogLayer.mock.calls.at(-1)?.[0].onFogPreparing?.('fog-current', false);
      fireEvent(screen.getByTestId('mock-map'), 'didFinishLoadingMap');
    });
    await waitFor(() => expect(screen.queryByTestId('ordered-route-map-load-overlay')).toBeNull());
    expect(screen.getByTestId('source-ordered-route-parts')).toBeTruthy();
    expect(screen.getByTestId('route-tool-draw').props.accessibilityState?.disabled).not.toBe(true);
    expect(await screen.findByTestId('route-scene-status')).toBeTruthy();
  });

  test('a transient Mapbox resource error after a ready scene keeps the usable Route visible', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    act(() => {
      fireEvent(screen.getByTestId('mock-map'), 'didFinishLoadingMap');
    });
    await waitFor(() => expect(screen.queryByTestId('ordered-route-map-load-overlay')).toBeNull());
    expect(screen.getByTestId('source-ordered-route-parts')).toBeTruthy();

    act(() => {
      fireEvent(screen.getByTestId('mock-map'), 'mapLoadingError', {
        type: 'resource',
        message: 'transient tile request failed',
      });
    });

    expect(screen.queryByTestId('ordered-route-map-load-overlay')).toBeNull();
    expect(screen.getByTestId('source-ordered-route-parts')).toBeTruthy();
  });

  test('a required new style scene cannot inherit the prior scene ready flag', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    act(() => {
      fireEvent(screen.getByTestId('mock-map'), 'didFinishLoadingMap');
    });
    await waitFor(() => expect(screen.queryByTestId('ordered-route-map-load-overlay')).toBeNull());

    mockMapTheme = 'night';
    screen.rerender(<OrderedRouteEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('ordered-route-map-load-overlay')).toBeTruthy());
    act(() => {
      fireEvent(screen.getByTestId('mock-map'), 'mapLoadingError', {
        type: 'style',
        message: 'required night style unavailable',
      });
    });
    expect(screen.getByTestId('ordered-route-map-load-overlay').props.state).toBe('error');
    expect(screen.getByTestId('source-ordered-route-parts')).toBeTruthy();
  });

  test('a genuine initial Mapbox failure stays fail-closed and retry starts a new cold load', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    expect(screen.getByTestId('ordered-route-map-load-overlay')).toBeTruthy();

    act(() => {
      fireEvent(screen.getByTestId('mock-map'), 'mapLoadingError', {
        type: 'style',
        message: 'initial style unavailable',
      });
    });
    expect(screen.getByTestId('ordered-route-map-load-overlay').props.state).toBe('error');
    expect(screen.getByTestId('source-ordered-route-parts')).toBeTruthy();

    act(() => screen.getByTestId('ordered-route-map-load-overlay').props.onRetry());
    await waitFor(() => expect(screen.getByTestId('ordered-route-map-load-overlay').props.state).toBe('loading'));
    expect(screen.getByTestId('ordered-route-map-load-overlay')).toBeTruthy();
  });

  test('R04/R08 Friends scope and picker operations never move the Route camera', async () => {
    mockMemorySubscriptions = [{ friend_id: 11, friend_name: 'First Friend' }];
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    mockCameraSet.mockClear();
    mockCameraFit.mockClear();
    fireEvent.press(screen.getByTestId('route-more'));
    fireEvent.press(screen.getByText('Mine & Friends'));
    fireEvent.press(screen.getByTestId('route-friend-picker-open'));
    expect(mockCameraSet).not.toHaveBeenCalled();
    expect(mockCameraFit).not.toHaveBeenCalled();
  });

  test('a new Create Route inherits Memory scope once while the active editor remains independent', async () => {
    mockRecoveredDraftEnabled = false;
    mockScreenParams = { creationSource: 'plan' };
    mockMemorySubscriptions = [{ friend_id: 11, friend_name: 'First Friend' }];
    mockMemoryScopeOwner = 'owner-a';
    mockMemoryScope = 'combined';

    const first = render(<OrderedRouteEditorScreen />);
    await first.findByText('Create Route');
    await waitFor(() => expect(mockFogLayer).toHaveBeenLastCalledWith(expect.objectContaining({ scopeOverride: 'combined' })));

    mockMemoryScope = 'self';
    fireEvent.press(first.getByTestId('route-more'));
    expect(mockFogLayer).toHaveBeenLastCalledWith(expect.objectContaining({ scopeOverride: 'combined' }));
    first.unmount();

    const second = render(<OrderedRouteEditorScreen />);
    await second.findByText('Create Route');
    await waitFor(() => expect(mockFogLayer).toHaveBeenLastCalledWith(expect.objectContaining({ scopeOverride: 'self' })));
  });

  test('a new Create Route never inherits another account\'s remembered Friends scope', async () => {
    mockRecoveredDraftEnabled = false;
    mockScreenParams = { creationSource: 'plan' };
    mockMemoryScopeOwner = 'previous-owner';
    mockMemoryScope = 'combined';
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByText('Create Route');
    await waitFor(() => expect(mockFogLayer).toHaveBeenLastCalledWith(expect.objectContaining({ scopeOverride: 'self' })));
  });

  test('R1 renders the native current-location marker without changing the loaded Route camera', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    const marker = await screen.findByTestId('mock-user-location');
    expect(marker.props.animated).toBe(true);
    expect(screen.getByTestId('layer-ordered-route-user-location-ring')).toBeTruthy();
    expect(screen.getByTestId('layer-ordered-route-user-location-dot')).toBeTruthy();
    expect(mockCameraFit).not.toHaveBeenCalled();
  });

  test('N01 a failed current-location action never points to the removed place search', async () => {
    const LocationMock = require('expo-location');
    LocationMock.getLastKnownPositionAsync.mockRejectedValueOnce(new Error('unavailable'));
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-current-location'));
    expect(await screen.findByText('Current location is unavailable. Browse the map instead.')).toBeTruthy();
    expect(screen.queryByText(/Search for a place/i)).toBeNull();
    expect(screen.queryByTestId('route-place-search')).toBeNull();
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
    await waitFor(() => expect(screen.getByTestId('mock-camera').props.defaultSettings.centerCoordinate).toEqual([121.4737, 31.2304]));
    expect(screen.getByTestId('mock-camera').props.defaultSettings.zoomLevel).toBe(14);
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
    expect(screen.getByTestId('mock-camera').props.defaultSettings.bounds).toEqual(expect.objectContaining({
      ne: [121.4754, 31.2328],
      sw: [121.4737, 31.2304],
      paddingRight: 88,
    }));
  });

  test('Activity interior-to-interior Draw replaces one true gap through the production screen handler and Undo restores it', async () => {
    const solidA = [
      { lat: -41.2865, lng: 174.7762 },
      { lat: -41.2865, lng: 174.7767 },
      { lat: -41.2865, lng: 174.7772 },
    ];
    const solidB = [
      { lat: -41.2865, lng: 174.7782 },
      { lat: -41.2865, lng: 174.7787 },
      { lat: -41.2865, lng: 174.7792 },
    ];
    mockLoadedDraft = {
      schemaVersion: 1, draftId: 'activity:gap-screen', ownerId: 'owner-a', origin: 'activity', revision: 0,
      parts: [
        { id: 'recorded-a', resolution: 'recorded', points: solidA },
        { id: 'recorded-b', resolution: 'recorded', points: solidB },
      ],
      gaps: [{ id: 'gap-a-b', afterPartId: 'recorded-a', reason: 'activity-gap' }],
    };
    mockEmittedStroke = [
      solidA[1],
      { lat: -41.2861, lng: 174.7777 },
      solidB[1],
    ];
    mockResolveDraw.mockResolvedValueOnce({
      outcome: 'accepted',
      points: mockEmittedStroke,
      parts: [{ points: mockEmittedStroke, resolution: 'draw-matched' }],
      callCount: 1,
    });

    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    expect(screen.getByTestId('source-ordered-route-gaps')).toBeTruthy();
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await waitFor(() => expect(mockResolveDraw).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('source-ordered-route-gaps')).toBeNull());

    const committed = screen.getByTestId('source-ordered-route-parts').props.shape.features
      .flatMap((feature: any) => feature.geometry.coordinates);
    expect(committed[0]).toEqual([solidA[0].lng, solidA[0].lat]);
    expect(committed).toContainEqual([solidA[1].lng, solidA[1].lat]);
    expect(committed).toContainEqual([mockEmittedStroke[1].lng, mockEmittedStroke[1].lat]);
    expect(committed).toContainEqual([solidB[1].lng, solidB[1].lat]);
    expect(committed.at(-1)).toEqual([solidB[2].lng, solidB[2].lat]);

    fireEvent.press(screen.getByLabelText('Undo last Route edit'));
    expect(screen.getByTestId('source-ordered-route-gaps')).toBeTruthy();
    const restored = screen.getByTestId('source-ordered-route-parts').props.shape.features;
    expect(restored.map((feature: any) => feature.geometry.coordinates)).toEqual([
      solidA.map(point => [point.lng, point.lat]),
      solidB.map(point => [point.lng, point.lat]),
    ]);
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
    expect(first.getByTestId('route-editor-leave-confirm').props.presentation).toBe('confirmation');
    expect(first.getByText('Keep editing')).toBeTruthy();
    fireEvent.press(first.getByText('Discard changes'));
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
      outcome: 'manual-available', reason: 'shape-deviation', callCount: 1,
      rawPoints: fixture.rawStroke.map(({ lat, lng }: any) => ({ lat, lng })),
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

  test('R2 true competing endpoint occurrences stay unchanged and ask for a clearer redraw', async () => {
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
    expect(await screen.findByText('That section is ambiguous. Redraw from clearer points; your Route is unchanged.')).toBeTruthy();
    expect(screen.queryByTestId('route-attachment-choice')).toBeNull();
    expect(screen.queryByTestId('source-ordered-route-review-original')).toBeNull();
    expect(mockResolveDraw).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
    const endpoints = screen.getByTestId('source-ordered-route-endpoints').props.shape.features;
    expect(endpoints.map((feature: any) => feature.geometry.coordinates)).toEqual([original[0], original.at(-1)]);
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
    // The accepted part is hidden while a static line-metric source retains
    // the exact validated provider geometry. The native line-trim paint value,
    // rather than repeated GeoJSON replacement, owns visible growth.
    expect(screen.getByTestId('source-ordered-route-growth').props.shape.geometry.coordinates).toHaveLength(3);
    expect(screen.getByTestId('layer-ordered-route-growth-line').props.style.lineTrimOffset).toEqual([0, 1]);
    // The reveal clock starts from the real camera-arrival signal, not the
    // nominal easing duration. This is the boundary that prevents a Point
    // head from launching while the accepted start is still near an edge.
    fireEvent(screen.getByTestId('mock-map'), 'cameraChanged', {
      properties: { center: screen.getByTestId('source-ordered-route-growth').props.shape.geometry.coordinates[0] },
    });
    fireEvent(screen.getByTestId('mock-map'), 'mapIdle', {
      properties: { center: screen.getByTestId('source-ordered-route-growth').props.shape.geometry.coordinates[0], zoom: 14 },
    });
    await act(async () => {
      // The public duration is capped at 2.2 s; the frame-cadence final paint
      // and two overlap frames must still complete inside this bound.
      await new Promise(resolve => setTimeout(resolve, 2_600));
    });
    expect(screen.queryByTestId('source-ordered-route-growth')).toBeNull();
  });

  test('Point reveals the committed Start attachment from frame zero instead of the provider road snap', async () => {
    reduceMotionSpy.mockResolvedValueOnce(false);
    mockResolvePoint.mockResolvedValueOnce({
      outcome: 'accepted',
      points: [
        // Valid provider snap, about 9 m from the canonical Route endpoint.
        { lat: -41.2865, lng: 174.7781 },
        { lat: -41.2862, lng: 174.7777 },
        { lat: -41.2865, lng: 174.7772 },
      ],
    });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    const growth = await screen.findByTestId('source-ordered-route-growth');
    expect(growth.props.shape.geometry.coordinates[0]).toEqual([174.7782, -41.2865]);
    expect(growth.props.shape.geometry.coordinates[0]).not.toEqual([174.7781, -41.2865]);
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
    await waitFor(() => expect(mockCameraSet).toHaveBeenCalledWith(expect.objectContaining({
      stops: expect.arrayContaining([expect.objectContaining({
        zoomLevel: 14,
        heading: 0,
        pitch: 0,
        animationMode: 'linearTo',
        animationDuration: expect.any(Number),
      })]),
    })));

    fireEvent(screen.getByTestId('mock-map'), 'mapIdle', {
      properties: { center: [174.7778, -41.2862], zoom: 14 },
    });
    expect(mockFogLayer.mock.calls.at(-1)?.[0].viewport).toBeNull();

    const cameraCallsBeforePan = mockCameraSet.mock.calls.length;
    fireEvent(screen.getByTestId('mock-map'), 'cameraChanged', {
      properties: { center: [174.7775, -41.2864], zoom: 14, heading: 0, pitch: 0, isUserInteraction: true },
    });
    expect(screen.queryByTestId('source-ordered-route-growth')).toBeNull();
    expect(mockCameraCancel).toHaveBeenCalledTimes(1);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    expect(mockCameraSet).toHaveBeenCalledTimes(cameraCallsBeforePan);
    fireEvent(screen.getByTestId('mock-map'), 'mapIdle', {
      properties: { center: [174.7775, -41.2864], zoom: 14 },
    });
    await waitFor(() => expect(mockFogLayer.mock.calls.at(-1)?.[0].viewport).not.toBeNull());
    // Exactly two passes rely on the visible connected U; a redundant label
    // can obscure the tight turnback on a phone-sized map.
    expect(screen.queryByTestId('source-ordered-route-repeat-labels')).toBeNull();
    const repeatLane = screen.getByTestId('source-ordered-route-repeat-lanes').props.shape.features
      .filter((feature: any) => feature.properties.role === 'repeat-lane');
    expect(repeatLane).toHaveLength(2);
    expect(repeatLane.every((feature: any) => feature.properties.offsetPx > 0)).toBe(true);
    expect(screen.getByTestId('layer-ordered-route-repeat-lane-line').props.style).toMatchObject({
      lineOffset: ['get', 'offsetPx'],
      lineCap: 'round',
      lineJoin: 'round',
    });
    expect(screen.getByTestId('source-ordered-route-repeat-lanes').props.shape.features
      .find((feature: any) => feature.properties.role === 'turn-connector')).toBeUndefined();
    expect(screen.getByTestId('layer-ordered-route-repeat-lane-line').props.style.lineWidth).toBe(7);
    fireEvent.press(screen.getByLabelText('Undo last Route edit'));
    expect(screen.queryByTestId('source-ordered-route-repeat-lanes')).toBeNull();
  });

  test('a user pan while Point provider work is pending fences later automatic camera ownership', async () => {
    reduceMotionSpy.mockResolvedValueOnce(false);
    let resolveProvider!: (value: any) => void;
    mockResolvePoint.mockReturnValueOnce(new Promise(resolve => { resolveProvider = resolve; }));
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    await waitFor(() => expect(mockResolvePoint).toHaveBeenCalledTimes(1));

    fireEvent(screen.getByTestId('mock-map'), 'cameraChanged', {
      properties: { center: [174.779, -41.287], zoom: 14, heading: 0, pitch: 0, isUserInteraction: true },
    });
    const cameraCallsAfterPan = mockCameraSet.mock.calls.length;
    await act(async () => {
      resolveProvider({
        outcome: 'accepted',
        points: [
          { lat: -41.2865, lng: 174.7782 },
          { lat: -41.2862, lng: 174.7777 },
          { lat: -41.2865, lng: 174.7772 },
        ],
      });
    });

    expect(await screen.findByTestId('source-ordered-route-growth')).toBeTruthy();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 90)); });
    expect(mockCameraSet).toHaveBeenCalledTimes(cameraCallsAfterPan);
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
    const continuation = features.flatMap((feature: any) => feature.geometry.coordinates);
    expect(continuation).not.toContainEqual([174.7777, -41.2858]);
    const endpoints = screen.getByTestId('source-ordered-route-endpoints').props.shape.features;
    expect(endpoints.at(-1).geometry.coordinates).toEqual([174.7772, -41.2865]);
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

  test('Undo exits an untouched Trim preview without creating an empty transaction', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Trim'));
    expect(screen.getByTestId('route-trim-apply').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('route-trim-apply'));
    expect(screen.getByTestId('route-trim-strip')).toBeTruthy();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByLabelText('Undo last Route edit'));
    expect(screen.queryByTestId('route-trim-strip')).toBeNull();
    expect(screen.getByTestId('route-tool-trim').props.accessibilityState.selected).toBe(false);
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
  });

  test('R7 Undo from Trim exits the mode and restores the preceding committed Route state', async () => {
    mockResolveDraw.mockResolvedValueOnce({ outcome: 'accepted', points: mockStroke });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await waitFor(() => expect(screen.queryByTestId('emit-route-stroke')).toBeNull());
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByTestId('route-tool-trim'));
    expect(screen.getByTestId('route-trim-strip')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Undo last Route edit'));
    expect(screen.queryByTestId('route-trim-strip')).toBeNull();
    expect(screen.getByTestId('route-tool-trim').props.accessibilityState.selected).toBe(false);
    await waitFor(() => expect(
      screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates,
    ).toEqual(mockDraft.parts[0].points.map(point => [point.lng, point.lat])));
  });

  test('Point uses the shared bottom context with exact Set start/Add point copy and no floating action', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Point'));
    expect(screen.getByTestId('route-point-context')).toBeTruthy();
    const contextStyle = StyleSheet.flatten(screen.getByTestId('route-context-slot').props.style);
    // React Native's Jest window uses a large font scale. The browser visual
    // gate covers the ordinary 62pt row; this fixture proves large text grows
    // instead of clipping inside that fixed-height slot.
    expect(contextStyle.height).toBe('auto');
    expect(contextStyle.minHeight).toBe(72);
    expect(screen.getByTestId('route-point-confirm')).toBeTruthy();
    expect(screen.getByTestId('route-point-confirm').props.hitSlop).toEqual({ top: 6, bottom: 6, left: 2, right: 2 });
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

  test('unmatched appended freehand commits the captured line without a dead-end decision row', async () => {
    mockEmittedStroke = [
      { lat: -41.2865, lng: 174.7782 },
      { lat: -41.2859, lng: 174.7790 },
    ];
    mockResolveDraw.mockResolvedValueOnce({ outcome: 'manual-available', reason: 'no-matches', rawPoints: mockEmittedStroke });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await screen.findByText('Drawing kept. Undo if needed.');
    expect(screen.queryByTestId('route-freehand-choice')).toBeNull();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false);
    const committed = screen.getByTestId('source-ordered-route-parts').props.shape.features
      .flatMap((feature: any) => feature.geometry.coordinates);
    expect(committed.at(-1)).toEqual([mockEmittedStroke.at(-1)!.lng, mockEmittedStroke.at(-1)!.lat]);
  });

  test('a bounded provider snap commits as walking geometry without exposing a Direct mode', async () => {
    mockResolvePoint.mockResolvedValueOnce({
      outcome: 'accepted',
      points: [
        { lat: -41.2865, lng: 174.7782 },
        { lat: -41.2865, lng: 174.7788 },
      ],
    });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-tool-point'));
    fireEvent(screen.getByTestId('mock-map'), 'cameraChanged', {
      properties: { center: [174.7790, -41.2865], zoom: 14, heading: 18, pitch: 12, isUserInteraction: true },
    });
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    await waitFor(() => expect(mockResolvePoint).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false));
    expect(screen.queryByText(/Direct/)).toBeNull();
    fireEvent.press(screen.getByTestId('ordered-route-save'));
    await waitFor(() => expect(mockRouteState.updateRoute).toHaveBeenCalledTimes(1));
    const saved = mockRouteState.updateRoute.mock.calls[0][1];
    expect(saved.orderedDraft.parts.at(-1).resolution).toBe('point');
    expect(saved.orderedDraft.parts.at(-1).points.at(-1)).toEqual({ lat: -41.2865, lng: 174.7788 });
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
    await waitFor(() => expect(mockRouteState.updateRoute).toHaveBeenCalledTimes(1));
    const saved = mockRouteState.updateRoute.mock.calls[0][1];
    expect(saved.orderedDraft.parts).toEqual(mockDraft.parts);
    expect(saved.points).toEqual(mockDraft.parts[0].points);
    expect(mockNavReplace).toHaveBeenCalledWith('MapHistory', { routeId: 'route-screen' });
    expect(screen.queryByText('Route saved')).toBeNull();
  });

  test('pending Point shows an immediate candidate End and a tool switch fences the reply', async () => {
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
    expect(screen.getByTestId('source-ordered-route-pending-endpoint')).toBeTruthy();
    expect(screen.queryByText('Cancel')).toBeNull();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('route-tool-point'));
    await waitFor(() => expect(mockPointMotionBasemapActive).toHaveBeenLastCalledWith(false));
    await act(async () => {
      resolveSlow({ outcome: 'accepted', points: mockStroke });
      await Promise.resolve();
    });
    expect(screen.queryByText('Review this walking Route')).toBeNull();
    const rendered = screen.getByTestId('source-ordered-route-parts').props.shape.features;
    expect(rendered).toHaveLength(1);
    expect(rendered[0].geometry.coordinates).toHaveLength(5);
    expect(mockPointMotionBasemapActive.mock.calls.map(([active]) => active)).toEqual([true, false]);
  });

  test('N03 tool switch restores the normal basemap even while Point motion setup is pending', async () => {
    let finishMotionSetup!: () => void;
    mockPointMotionBasemapActive.mockImplementation((active: boolean) => active
      ? new Promise<void>(resolve => { finishMotionSetup = resolve; })
      : Promise.resolve());
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');

    fireEvent.press(screen.getByTestId('route-tool-point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    expect(await screen.findByTestId('route-provider-progress')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-pending-endpoint')).toBeTruthy();
    expect(mockPointMotionBasemapActive).toHaveBeenCalledWith(true);

    fireEvent.press(screen.getByTestId('route-tool-trim'));
    await waitFor(() => expect(mockPointMotionBasemapActive).toHaveBeenLastCalledWith(false));
    expect(screen.getByTestId('route-trim-strip')).toBeTruthy();
    expect(screen.queryByTestId('route-provider-progress')).toBeNull();

    await act(async () => {
      finishMotionSetup();
      await Promise.resolve();
    });
    expect(mockResolvePoint).not.toHaveBeenCalled();
    expect(screen.queryByTestId('source-ordered-route-pending-endpoint')).toBeNull();
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features).toHaveLength(1);
  });

  test('N04 Point pending can transition through Trim Apply and Draw without a stuck or late commit', async () => {
    let resolveSlowPoint!: (value: any) => void;
    mockResolvePoint.mockReturnValueOnce(new Promise(resolve => { resolveSlowPoint = resolve; }));
    mockResolveDraw.mockResolvedValueOnce({ outcome: 'accepted', points: mockStroke });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');

    fireEvent.press(screen.getByTestId('route-tool-point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    expect(await screen.findByTestId('route-provider-progress')).toBeTruthy();

    fireEvent.press(screen.getByTestId('route-tool-trim'));
    expect(screen.getByTestId('route-trim-strip')).toBeTruthy();
    fireEvent.press(screen.getByTestId('trim-start-25'));
    fireEvent.press(screen.getByTestId('trim-end-75'));
    fireEvent.press(screen.getByTestId('route-trim-apply'));
    expect(screen.queryByTestId('route-provider-progress')).toBeNull();

    fireEvent.press(screen.getByTestId('route-tool-draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await waitFor(() => expect(mockResolveDraw).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('route-provider-progress')).toBeNull());

    const afterDraw = screen.getByTestId('source-ordered-route-parts').props.shape;
    await act(async () => {
      resolveSlowPoint({
        outcome: 'accepted',
        points: [
          { lat: -41.2865, lng: 174.7782 },
          { lat: -41.2800, lng: 174.7900 },
        ],
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId('source-ordered-route-parts').props.shape).toEqual(afterDraw);
    expect(screen.queryByTestId('source-ordered-route-pending-endpoint')).toBeNull();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false);
  });

  test('one-shot Draw tool switch fences a slow provider reply without creating Undo history', async () => {
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
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    await act(async () => {
      resolveSlow({ outcome: 'review', reason: 'shape-deviation', points: mockStroke });
      await Promise.resolve();
    });
    expect(screen.queryByText('Review this Route edit')).toBeNull();
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features[0].geometry.coordinates).toEqual(
      mockDraft.parts[0].points.map(point => [point.lng, point.lat]),
    );
  });

  test('a bounded provider endpoint shift does not add a redundant review confirmation', async () => {
    mockResolvePoint.mockResolvedValueOnce({
      outcome: 'review',
      reason: 'endpoint-shift',
      points: [
        { lat: -41.2865, lng: 174.7782 },
        { lat: -41.2862, lng: 174.7777 },
        { lat: -41.2865, lng: 174.7772 },
      ],
    });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    await waitFor(() => expect(mockResolvePoint).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('route-inline-review')).toBeNull();
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(false);
  });

  test('provider failure removes only the candidate End and leaves normal Add available', async () => {
    mockResolvePoint.mockResolvedValueOnce({ outcome: 'rejected', reason: 'provider-unavailable' });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    const before = screen.getByTestId('source-ordered-route-parts').props.shape.features;
    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    expect(await screen.findByText('Routing is unavailable. Your Route and selection are unchanged.')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features).toEqual(before);
    expect(screen.queryByTestId('source-ordered-route-pending-endpoint')).toBeNull();
    expect(screen.getByTestId('route-point-confirm')).toBeTruthy();
    expect(mockResolvePoint).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
  });

  test('Mapbox NoSegment explains the coverage limit and immediately permits Point or Draw recovery', async () => {
    mockResolvePoint.mockResolvedValueOnce({ outcome: 'rejected', reason: 'no-route', providerCode: 'NO_ROUTE' });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    const before = screen.getByTestId('source-ordered-route-parts').props.shape.features;
    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    expect(await screen.findByText('No walkable map segment near this Point or Route end. Move the Point, or Draw this section.')).toBeTruthy();
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features).toEqual(before);
    expect(screen.queryByTestId('source-ordered-route-pending-endpoint')).toBeNull();
    expect(screen.getByTestId('route-point-confirm').props.disabled).not.toBe(true);
    fireEvent.press(screen.getByTestId('route-tool-draw'));
    expect(screen.getByTestId('emit-route-stroke')).toBeTruthy();
  });

  test('R03 classified Point failure keeps the editor usable for the next Point and Draw', async () => {
    mockResolvePoint
      .mockResolvedValueOnce({ outcome: 'rejected', reason: 'provider-unavailable', providerCode: 'NETWORK' })
      .mockResolvedValueOnce({
        outcome: 'accepted',
        points: [
          { lat: -41.2865, lng: 174.7782 },
          { lat: -41.2862, lng: 174.7777 },
        ],
      });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByText('Point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    expect(await screen.findByText('Walking routing needs a connection. Your Route is unchanged.')).toBeTruthy();
    expect(screen.getByTestId('route-point-confirm')).toBeTruthy();

    fireEvent.press(screen.getByTestId('route-point-confirm'));
    await waitFor(() => expect(mockResolvePoint).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('route-provider-progress')).toBeNull());
    expect(screen.getByTestId('route-point-context')).toBeTruthy();

    fireEvent.press(screen.getByTestId('route-tool-draw'));
    fireEvent.press(screen.getByTestId('emit-route-stroke'));
    await waitFor(() => expect(mockResolveDraw).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('route-provider-progress')).toBeNull());
  });

  test('R8 failed Point remains in Point mode without Retry or Cancel workflow', async () => {
    mockResolvePoint.mockResolvedValueOnce({ outcome: 'rejected', reason: 'provider-unavailable' });
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    const before = screen.getByTestId('source-ordered-route-parts').props.shape.features;
    fireEvent.press(screen.getByTestId('route-tool-point'));
    fireEvent.press(screen.getByTestId('route-point-confirm'));
    expect(await screen.findByText('Routing is unavailable. Your Route and selection are unchanged.')).toBeTruthy();
    expect(screen.queryByTestId('route-provider-retry')).toBeNull();
    expect(screen.getByTestId('route-point-context')).toBeTruthy();
    expect(screen.getByTestId('route-tool-point').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('source-ordered-route-parts').props.shape.features).toEqual(before);
    expect(screen.getByLabelText('Undo last Route edit').props.accessibilityState.disabled).toBe(true);
  });

  test('R8 tapping Point again exits target mode without creating a request or edit', async () => {
    const screen = render(<OrderedRouteEditorScreen />);
    await screen.findByDisplayValue('Screen Route');
    fireEvent.press(screen.getByTestId('route-tool-point'));
    expect(screen.getByTestId('route-point-context')).toBeTruthy();
    fireEvent.press(screen.getByTestId('route-tool-point'));
    expect(screen.queryByTestId('route-point-context')).toBeNull();
    expect(screen.getByTestId('route-tool-point').props.accessibilityState.selected).toBe(false);
    expect(mockResolvePoint).not.toHaveBeenCalled();
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
    await waitFor(() => expect(mockResolvePoint).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByTestId('route-tool-point'));
    await act(async () => {
      resolveSlow({ outcome: 'accepted', points: mockStroke });
      await Promise.resolve();
    });
    expect(screen.queryByTestId('route-inline-review')).toBeNull();
  });
});
