import React from 'react';
import { act, render } from '@testing-library/react-native';

let mockRouteParams: Record<string, any> = {};
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockTrackingState: Record<string, any>;
let mockObservedReferenceAtStart: Record<string, any> | null = null;
const mockStartDockProps: Record<string, Record<string, any> | null> = {
  hike: null,
  run: null,
};
const mockTopChromeProps: Record<string, Record<string, any> | null> = {
  hike: null,
  run: null,
};
const mockMapProps: Record<string, Record<string, any> | null> = {
  hike: null,
  run: null,
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
    multiGet: jest.fn(async () => []),
    multiRemove: jest.fn(async () => undefined),
  },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: mockGoBack,
    navigate: mockNavigate,
    dispatch: jest.fn(),
  }),
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
  CommonActions: { reset: (value: unknown) => value },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({
    status: 'denied', granted: false, canAskAgain: false,
  })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(async () => { throw new Error('not used'); }),
  Accuracy: { Balanced: 3 },
}));

jest.mock('../../store/useTrackingStore', () => ({
  useTrackingStore: Object.assign(
    (selector: (state: any) => unknown) => selector(mockTrackingState),
    { getState: () => mockTrackingState, setState: jest.fn() },
  ),
}));

jest.mock('../../store/useAppStore', () => {
  const state = { user: { id: 'route-owner' }, hydrationTs: 1 };
  return {
    useAppStore: Object.assign(
      (selector: (value: any) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

jest.mock('../../store/useMarkerStore', () => ({
  useMarkerStore: Object.assign(
    (selector: (state: any) => unknown) => selector({
      userId: 'route-owner',
      markers: [],
      addMarker: jest.fn(),
      deleteMarker: jest.fn(),
      getMarkersForRegion: () => [],
    }),
    { getState: () => ({ userId: 'route-owner', markers: [] }) },
  ),
}));

jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: any) => unknown) => selector({ debugMode: false }),
}));
jest.mock('../../store/useFriendStore', () => ({
  useFriendStore: (selector: (state: any) => unknown) => selector({ friends: [] }),
}));
jest.mock('../../features/memory/store/useMemoryStore', () => ({
  useMemoryStore: (selector: (state: any) => unknown) => selector({ isExplored: () => false }),
}));
jest.mock('../../features/memory/store/useMemorySubscriptionsStore', () => ({
  useMemorySubscriptionsStore: (selector: (state: any) => unknown) => selector({ subscriptions: [] }),
}));
jest.mock('../../features/marks/store/useMarkLikeStore', () => ({
  useMarkLikeStore: (selector: (state: any) => unknown) => selector({ liked: {} }),
}));

jest.mock('../../features/activitySimulator/capability', () => ({
  activitySimulatorBuildCapable: false,
}));
jest.mock('../../features/activitySimulator/ActivitySimulatorPanel', () => ({
  ActivitySimulatorPanel: () => null,
}));
jest.mock('../../features/activitySimulator/useActivitySimulatorStore', () => ({
  initializeFreshSimulatorSetupForActivityEntry: jest.fn(async () => 'ready'),
  useActivitySimulatorStore: (selector: (state: any) => unknown) => selector({
    hydratedUserId: 'route-owner',
    enabled: false,
    observationMode: 'raw-gps',
    startConfigured: false,
    current: null,
    signal: 'normal',
    virtualTimestampMs: 1_800_000_000_000,
    pickerMode: null,
  }),
}));
jest.mock('../../features/activitySimulator/simulatorTime', () => ({
  activityFreshnessNow: () => 1_800_000_000_000,
}));
jest.mock('../../features/activitySimulator/simulatorLog', () => ({
  appendSimulatorLog: jest.fn(),
}));
jest.mock('../../features/activitySimulator/useSimulatorKeepAwake', () => ({
  useSimulatorKeepAwake: jest.fn(),
}));
jest.mock('../../features/activitySimulator/simulatorMapState', () => ({
  resolveSimulatorControlsVisible: () => false,
  resolveSimulatorMapState: ({ acceptedPosition }: any) => ({
    simulatorLocationAuthoritative: false,
    displayPosition: acceptedPosition,
  }),
  resolveHikeCameraContract: ({ displayPosition }: any) => ({
    userPosition: displayPosition,
    simulatorEnabled: false,
    instantCamera: false,
  }),
}));

jest.mock('../../features/activity/activityContracts', () => ({
  saveEligibility: () => ({ eligible: true }),
}));
jest.mock('../../features/activity/activityLocationHealth', () => ({
  deriveActivityLocationHealth: () => ({
    userFacingIssue: null,
    sourceHealth: 'fresh',
    sourceAgeMs: 0,
  }),
}));
jest.mock('../../features/activity/livePace', () => ({
  deriveLivePace: () => ({ secondsPerKm: null }),
}));
jest.mock('../../features/activity/activityRecovery', () => ({
  findRecoverableActivity: jest.fn(async () => null),
  restoreRecoverableActivity: jest.fn(async () => false),
  saveRecoverableActivity: jest.fn(async () => false),
  discardRecoverableActivity: jest.fn(async () => undefined),
}));
jest.mock('../../features/activity/useActivitySaveLossRecovery', () => ({
  useActivitySaveLossRecovery: jest.fn(),
}));

jest.mock('../../features/friends/services/friendContent', () => ({
  authorizeBorrowedRouteStart: jest.fn(async () => ({ ok: false })),
  finalizeBorrowedRouteUse: jest.fn(async () => undefined),
}));
jest.mock('../../hooks/useVisualTheme', () => ({
  useVisualTheme: () => ({
    background: '#fff', surface: '#fff', surfaceElevated: '#fff', surfaceSecondary: '#eee',
    foreground: '#111', foregroundSecondary: '#333', muted: '#666', primary: '#385',
    primaryAction: '#385', onPrimary: '#fff', border: '#ddd', icon: '#333',
    iconActive: '#385', scrim: 'rgba(0,0,0,.2)', mapOverlay: '#fff', shadow: '#000',
    disabledSurface: '#ddd', disabledText: '#777', destructive: '#a00',
  }),
}));
jest.mock('../../utils/distanceFormat', () => ({
  useDistance: () => ({
    imperial: false,
    unit: 'km',
    elevUnit: 'm',
    format: () => '0.00',
    formatElevation: () => '0',
  }),
}));
jest.mock('../../services/hapticService', () => ({
  haptic: { impact: jest.fn(), notification: jest.fn(), selection: jest.fn() },
}));
jest.mock('../../services/offlineQueue', () => ({ uuidv4: () => 'test-activity-id' }));
jest.mock('../../services/crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../../config/regions', () => ({ getCurrentRegion: () => ({ code: 'nz' }) }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));
jest.mock('../../components/TooShortSheet', () => ({ TooShortSheet: () => null }));
jest.mock('../../components/PermissionDeniedModal', () => ({ PermissionDeniedModal: () => null }));
jest.mock('../../components/UnfinishedRecoveryModal', () => ({ UnfinishedRecoveryModal: () => null }));
jest.mock('../StopSummarySheet', () => ({ StopSummarySheet: () => null }));
jest.mock('../../features/marks/components/MarkDetailSheet', () => ({ MarkDetailSheet: () => null }));

jest.mock('../HikingMap', () => ({
  HikingMap: (props: Record<string, any>) => {
    mockMapProps[props.activityVariant === 'run' ? 'run' : 'hike'] = props;
    return null;
  },
}));

jest.mock('../../components/activity/ActivityRecordingChrome', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    activityStartErrorMessage: (error: string | null) => error,
    ActivityControlDock: () => null,
    ActivityRecenterButton: () => null,
    ActivityStartDock: (props: Record<string, any>) => {
      mockStartDockProps[props.mode] = props;
      return ReactModule.createElement(
        Pressable,
        { testID: `${props.mode}-start`, onPress: props.onStart },
        ReactModule.createElement(Text, null, props.routeName),
      );
    },
    ActivityTopChrome: (props: Record<string, any>) => {
      mockTopChromeProps[props.mode] = props;
      return ReactModule.createElement(
        Pressable,
        { testID: `${props.mode}-back`, onPress: props.onBack },
        ReactModule.createElement(Text, null, 'Back'),
      );
    },
  };
});

import { useRouteStore, type Route } from '../../store/useRouteStore';
import { HikingScreen } from '../HikingScreen';
import { RunningScreen } from '../RunningScreen';

const routePoints = [
  { lat: -41.2865, lng: 174.7762 },
  { lat: -41.2861, lng: 174.7769 },
  { lat: -41.2859, lng: 174.7772 },
];

const selectedRoute: Route = {
  id: 'route-client-edited-1',
  clientRouteId: 'route-client-edited-1',
  remoteId: '6201',
  name: 'Edited exact geometry',
  createdAt: 1,
  updatedAt: 2,
  points: routePoints.map(point => ({ ...point })),
  waypoints: [],
  distanceM: 120,
  elevationGainM: 8,
  runCount: 0,
  isActive: false,
  syncState: 'synced',
  geometryEditedSinceCreation: true,
};

const screens = [
  { mode: 'hike', Screen: HikingScreen, freeName: 'Free Hike' },
  { mode: 'run', Screen: RunningScreen, freeName: 'Free Run' },
] as const;

describe('normal Hike/Run Route reference handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { routeId: selectedRoute.id };
    mockObservedReferenceAtStart = null;
    mockStartDockProps.hike = null;
    mockStartDockProps.run = null;
    mockTopChromeProps.hike = null;
    mockTopChromeProps.run = null;
    mockMapProps.hike = null;
    mockMapProps.run = null;
    mockTrackingState = {
      status: 'idle',
      transitionState: 'idle',
      isFinishing: false,
      startError: null,
      durationS: 0,
      distanceM: 0,
      elevationGainM: 0,
      locationAvailable: false,
      lastCoordinate: null,
      latestSourceLocationTime: null,
      realMotionState: 'unknown',
      realCandidatePending: false,
      realCanonicalDecisionReason: null,
      pendingSegmentStartReason: null,
      backgroundLocationPermission: 'granted',
      refreshBackgroundLocationPermission: jest.fn(async () => undefined),
      locationProviderSource: 'real',
      sessionId: null,
      activityMode: null,
      overSpeedActive: false,
      savingHikeStep: null,
      saveLostSessionId: null,
      saveLostPayload: null,
      trackPoints: [],
      trackPointsSmoothed: [],
      setActivityMode: jest.fn(),
      startTracking: jest.fn(async () => {
        mockObservedReferenceAtStart = JSON.parse(JSON.stringify(
          useRouteStore.getState().activityRouteReference,
        ));
        return true;
      }),
      stopTracking: jest.fn(),
      pauseTracking: jest.fn(),
      resumeTracking: jest.fn(),
      clearLastStopReason: jest.fn(),
      discardCurrentSession: jest.fn(),
      hydrateSaf01: jest.fn(async () => undefined),
      lastStopReason: null,
    };
    useRouteStore.setState({
      routes: [{ ...selectedRoute, points: routePoints.map(point => ({ ...point })) }],
      routeOwnerId: 'route-owner',
      routesLoading: false,
      routesLoadError: false,
      activityRouteReference: null,
      loadRoutes: jest.fn(async () => undefined),
      loadRouteDetail: jest.fn(async () => 'ready'),
    });
  });

  test.each(screens)('$mode explicit Start captures exact immutable geometry before tracking', async ({ mode, Screen }) => {
    const screen = render(<Screen />);
    expect(mockStartDockProps[mode]?.routeName).toBe(selectedRoute.name);
    expect(mockMapProps[mode]?.plannedRoutePoints).toEqual(routePoints);
    expect(useRouteStore.getState().activityRouteReference).toBeNull();

    await act(async () => { await mockStartDockProps[mode]!.onStart(); });

    expect(mockObservedReferenceAtStart).toMatchObject({
      routeId: selectedRoute.id,
      name: selectedRoute.name,
      points: routePoints,
    });
    expect(useRouteStore.getState().activityRouteReference).toMatchObject({
      routeId: selectedRoute.id,
      name: selectedRoute.name,
      points: routePoints,
    });
    expect(mockTrackingState.startTracking).toHaveBeenCalledTimes(1);

    act(() => {
      useRouteStore.setState({
        routes: [{ ...selectedRoute, points: [{ lat: 0, lng: 0 }, ...routePoints.slice(1)] }],
      });
    });
    expect(useRouteStore.getState().activityRouteReference?.points).toEqual(routePoints);
    screen.unmount();
  });

  test.each(screens)('$mode pre-start Back abandons selection and fresh entry has no reference', ({ mode, Screen, freeName }) => {
    const selected = render(<Screen />);
    expect(mockStartDockProps[mode]?.routeName).toBe(selectedRoute.name);
    expect(mockMapProps[mode]?.plannedRoutePoints).toEqual(routePoints);
    expect(useRouteStore.getState().activityRouteReference).toBeNull();

    act(() => { mockTopChromeProps[mode]!.onBack(); });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    selected.unmount();

    mockRouteParams = {};
    const fresh = render(<Screen />);
    expect(mockStartDockProps[mode]?.routeName).toBe(freeName);
    expect(mockMapProps[mode]?.plannedRoutePoints).toEqual([]);
    expect(useRouteStore.getState().activityRouteReference).toBeNull();
    fresh.unmount();
  });
});
