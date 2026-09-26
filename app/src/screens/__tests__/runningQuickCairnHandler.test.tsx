import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

const mockAddMarker = jest.fn();
const mockLinkMarker = jest.fn();
const mockAppendSimulatorLog = jest.fn();
let mockAppUserId = 'owner-a';
let mockMarkerOwnerId = 'owner-a';
let mockTrackingState: Record<string, any>;
let mockRouteParams: Record<string, any>;
let mockRoutes: Array<Record<string, any>>;
let mockActivityRouteReference: Record<string, any> | null;
const mockLoadRoutes = jest.fn(async () => undefined);
const mockLoadRouteDetail = jest.fn(async () => undefined);
const mockCaptureActivityRouteReference = jest.fn();
const mockCaptureExternalActivityRouteReference = jest.fn();
const mockClearActivityRouteReference = jest.fn();
let latestControlProps: Record<string, any> | null = null;
let latestStartProps: Record<string, any> | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: jest.fn(),
    navigate: jest.fn(),
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

jest.mock('../../store/useTrackingStore', () => ({
  useTrackingStore: Object.assign(
    (selector: (state: any) => unknown) => selector(mockTrackingState),
    { getState: () => mockTrackingState },
  ),
}));

jest.mock('../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector: (state: any) => unknown) => selector({ user: mockAppUserId ? { id: mockAppUserId } : null }),
    { getState: () => ({ user: mockAppUserId ? { id: mockAppUserId } : null }) },
  ),
}));

jest.mock('../../store/useMarkerStore', () => ({
  useMarkerStore: Object.assign(
    (selector: (state: any) => unknown) => selector({ addMarker: mockAddMarker, userId: mockMarkerOwnerId }),
    { getState: () => ({ addMarker: mockAddMarker, userId: mockMarkerOwnerId }) },
  ),
}));

jest.mock('../../store/useRouteStore', () => ({
  useRouteStore: (selector: (state: any) => unknown) => selector({
    routes: mockRoutes,
    loadRoutes: mockLoadRoutes,
    loadRouteDetail: mockLoadRouteDetail,
    activityRouteReference: mockActivityRouteReference,
    captureActivityRouteReference: mockCaptureActivityRouteReference,
    captureExternalActivityRouteReference: mockCaptureExternalActivityRouteReference,
    clearActivityRouteReference: mockClearActivityRouteReference,
  }),
}));

jest.mock('../../features/route/routeContracts', () => ({
  routeMatchesIdentity: (route: any, identity: string) => (
    route.id === identity || route.clientRouteId === identity || route.remoteId === identity
  ),
}));
jest.mock('../../features/friends/services/friendContent', () => ({
  authorizeBorrowedRouteStart: jest.fn(async () => ({ ok: false })),
  finalizeBorrowedRouteUse: jest.fn(async () => undefined),
}));
jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: any) => unknown) => selector({ debugMode: false }),
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
    hydratedUserId: 'owner-a',
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
  appendSimulatorLog: (...args: unknown[]) => mockAppendSimulatorLog(...args),
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
}));
jest.mock('../../features/activity/activityOperationalState', () => ({
  deriveActivityOperationalState: ({ trackingStatus }: any) => (
    trackingStatus === 'idle' ? 'idle' : 'tracking'
  ),
  isActivitySessionVisible: (state: string) => state !== 'idle',
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
jest.mock('../../hooks/useVisualTheme', () => ({
  useVisualTheme: () => ({
    background: '#fff',
    surface: '#fff',
    surfaceElevated: '#fff',
    foreground: '#111',
    foregroundSecondary: '#333',
    muted: '#666',
    primary: '#385',
    onPrimary: '#fff',
    border: '#ddd',
    iconActive: '#385',
    scrim: 'rgba(0,0,0,.2)',
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
  haptic: {
    impact: jest.fn(),
    notification: jest.fn(),
    selection: jest.fn(),
  },
}));
jest.mock('../../services/offlineQueue', () => ({ uuidv4: () => 'test-uuid' }));
jest.mock('../../services/crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../../config/regions', () => ({ getCurrentRegion: () => ({ code: 'nz' }) }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));
jest.mock('../../components/TooShortSheet', () => ({ TooShortSheet: () => null }));
jest.mock('../../components/PermissionDeniedModal', () => ({ PermissionDeniedModal: () => null }));
jest.mock('../../components/UnfinishedRecoveryModal', () => ({ UnfinishedRecoveryModal: () => null }));
jest.mock('../HikingMap', () => ({ HikingMap: () => null }));

jest.mock('../../components/activity/ActivityRecordingChrome', () => {
  const ReactModule = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    activityStartErrorMessage: (error: string | null) => error,
    ActivityControlDock: (props: Record<string, any>) => {
      latestControlProps = props;
      return ReactModule.createElement(
        Pressable,
        { testID: 'run-cairn', onPress: props.onCairn, disabled: props.cairnDisabled },
        ReactModule.createElement(Text, { testID: 'run-cairn-busy' }, String(props.cairnDisabled)),
      );
    },
    ActivityTopChrome: ({ notices = [] }: any) => ReactModule.createElement(
      View,
      null,
      ...notices.map((notice: any, index: number) => ReactModule.createElement(
        Text,
        { key: `${notice.label}-${index}` },
        notice.label,
      )),
    ),
    ActivityStartDock: (props: Record<string, any>) => {
      latestStartProps = props;
      return ReactModule.createElement(
        Pressable,
        { testID: 'run-start', onPress: props.onStart, disabled: props.starting },
        ReactModule.createElement(Text, null, props.routeName),
      );
    },
    ActivityRecenterButton: () => null,
  };
});

import { RunningScreen } from '../RunningScreen';

function committed(markerId: string) {
  return {
    state: 'durably-accepted',
    ownerId: 'owner-a',
    projection: 'current',
    marker: {
      id: markerId,
      clientCairnId: markerId,
      originActivityClientId: 'activity-s1',
    },
  };
}

describe('Running normal Quick Cairn handler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    latestControlProps = null;
    latestStartProps = null;
    mockAppUserId = 'owner-a';
    mockMarkerOwnerId = 'owner-a';
    mockRouteParams = {};
    mockRoutes = [];
    mockActivityRouteReference = null;
    mockCaptureActivityRouteReference.mockReturnValue(true);
    mockTrackingState = {
      status: 'tracking',
      activityMode: 'running',
      transitionState: 'idle',
      isFinishing: false,
      startError: null,
      durationS: 60,
      distanceM: 100,
      locationAvailable: true,
      lastCoordinate: { lat: -41.2865, lng: 174.7762, accuracy: 8 },
      lastCoordinateTime: 1_799_999_999_000,
      latestSourceLocationTime: 1_799_999_999_000,
      realMotionState: 'moving',
      realCandidatePending: false,
      realCanonicalDecisionReason: 'accepted',
      pendingSegmentStartReason: null,
      backgroundLocationPermission: 'granted',
      refreshBackgroundLocationPermission: jest.fn(async () => undefined),
      locationProviderSource: 'real',
      sessionId: 'activity-s1',
      ownerUserId: 'owner-a',
      liveOwnerGeneration: 'generation-s1',
      linkMarker: mockLinkMarker,
      setActivityMode: jest.fn(),
      startTracking: jest.fn(),
      stopTracking: jest.fn(),
      pauseTracking: jest.fn(),
      resumeTracking: jest.fn(),
      trackPoints: [{ lat: -41.2865, lng: 174.7762, t: 1_799_999_999_000 }],
      trackPointsSmoothed: [{ lat: -41.2865, lng: 174.7762, t: 1_799_999_999_000 }],
      lastStopReason: null,
      clearLastStopReason: jest.fn(),
      discardCurrentSession: jest.fn(),
    };
    mockLinkMarker.mockImplementation((_markerId: string, context: any) => (
      mockTrackingState.ownerUserId === context.ownerUserId
      && mockTrackingState.sessionId === context.clientActivityId
      && mockTrackingState.liveOwnerGeneration === context.ownerGeneration
    ));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('same-tick presses call addMarker once and keep the visible Cairn control busy until acceptance', async () => {
    const durable = deferred<any>();
    mockAddMarker.mockReturnValue(durable.promise);
    const screen = render(<RunningScreen />);
    expect(latestControlProps).not.toBeNull();

    act(() => {
      latestControlProps!.onCairn();
      latestControlProps!.onCairn();
    });
    expect(mockAddMarker).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('run-cairn-busy').props.children).toBe('true');
    expect(mockAddMarker.mock.calls[0][0]).toMatchObject({
      type: 'cairn',
      note: '',
      permission: 'personal',
      regionCode: 'nz',
      originActivityClientId: 'activity-s1',
      activityContext: {
        ownerUserId: 'owner-a',
        clientActivityId: 'activity-s1',
        ownerGeneration: 'generation-s1',
      },
    });

    await act(async () => { durable.resolve(committed('cairn-s1')); });
    expect(mockLinkMarker).toHaveBeenCalledWith('cairn-s1', expect.objectContaining({ clientActivityId: 'activity-s1' }));
    expect(screen.getByText('Cairn saved')).toBeTruthy();
    expect(screen.getByTestId('run-cairn-busy').props.children).toBe('false');
  });

  test('selected Route stays pre-start with no recording reference until explicit Start captures it', async () => {
    const selectedRoute = {
      id: 'route-local-1',
      clientRouteId: 'route-client-1',
      remoteId: 'route-remote-1',
      name: 'Version-bound route',
      points: [
        { lat: -41.2865, lng: 174.7762 },
        { lat: -41.286, lng: 174.777 },
      ],
    };
    mockRouteParams = { routeId: selectedRoute.id };
    mockRoutes = [selectedRoute];
    mockTrackingState = {
      ...mockTrackingState,
      status: 'idle',
      sessionId: null,
      trackPoints: [],
      trackPointsSmoothed: [],
    };
    mockTrackingState.startTracking.mockResolvedValue(true);

    const screen = render(<RunningScreen />);
    expect(latestStartProps).not.toBeNull();
    expect(latestStartProps!.routeName).toBe('Version-bound route');
    expect(screen.getByText('Version-bound route')).toBeTruthy();
    expect(mockActivityRouteReference).toBeNull();
    expect(mockCaptureActivityRouteReference).not.toHaveBeenCalled();
    expect(mockTrackingState.startTracking).not.toHaveBeenCalled();

    await act(async () => { await latestStartProps!.onStart(); });

    expect(mockCaptureActivityRouteReference).toHaveBeenCalledTimes(1);
    expect(mockCaptureActivityRouteReference).toHaveBeenCalledWith('route-local-1');
    expect(mockTrackingState.startTracking).toHaveBeenCalledTimes(1);
    expect(mockCaptureActivityRouteReference.mock.invocationCallOrder[0])
      .toBeLessThan(mockTrackingState.startTracking.mock.invocationCallOrder[0]);
  });

  test.each([
    ['S1 becomes S2', () => {
      mockTrackingState = {
        ...mockTrackingState,
        sessionId: 'activity-s2',
        liveOwnerGeneration: 'generation-s2',
      };
    }],
    ['owner A becomes B', () => {
      mockAppUserId = 'owner-b';
      mockMarkerOwnerId = 'owner-b';
      mockTrackingState = {
        ...mockTrackingState,
        ownerUserId: 'owner-b',
        sessionId: 'activity-b',
        liveOwnerGeneration: 'generation-b',
      };
    }],
  ])('suppresses late link and stale success feedback when %s', async (_label, transition) => {
    const durable = deferred<any>();
    mockAddMarker.mockReturnValue(durable.promise);
    const screen = render(<RunningScreen />);
    act(() => { latestControlProps!.onCairn(); });
    transition();
    screen.rerender(<RunningScreen />);

    await act(async () => { durable.resolve(committed('late-cairn')); });
    expect(mockLinkMarker).not.toHaveBeenCalled();
    expect(screen.queryByText('Cairn saved')).toBeNull();
    expect(screen.queryByText('Failed to plant cairn')).toBeNull();
  });

  test('a genuine pre-commit failure releases busy state and allows one successful retry', async () => {
    mockAddMarker
      .mockRejectedValueOnce(new Error('storage full'))
      .mockResolvedValueOnce(committed('retry-cairn'));
    const screen = render(<RunningScreen />);
    act(() => { latestControlProps!.onCairn(); });
    await waitFor(() => expect(screen.getByText('Failed to plant cairn')).toBeTruthy());
    expect(screen.getByTestId('run-cairn-busy').props.children).toBe('false');

    act(() => { latestControlProps!.onCairn(); });
    await waitFor(() => expect(screen.getByText('Cairn saved')).toBeTruthy());
    expect(mockAddMarker).toHaveBeenCalledTimes(2);
    expect(mockLinkMarker).toHaveBeenCalledTimes(1);
  });

  test('unmount before durable acceptance produces no late link or state update', async () => {
    const durable = deferred<any>();
    mockAddMarker.mockReturnValue(durable.promise);
    const screen = render(<RunningScreen />);
    act(() => { latestControlProps!.onCairn(); });
    screen.unmount();
    await act(async () => { durable.resolve(committed('unmounted-cairn')); });
    expect(mockLinkMarker).not.toHaveBeenCalled();
  });
});
