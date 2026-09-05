/**
 * useTrackingStore.test — verify GPS pipeline dedupe & pause pin behavior.
 * Critical: ensures the 3× duplicate-fix bug from Sprint 41 telemetry cannot return.
 */

const mockLocation = {
  Accuracy: { BestForNavigation: 6, Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 1, longitude: 2, altitude: 3, accuracy: 5, speed: 0 },
    timestamp: Date.now(),
  })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => {}),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
};

jest.mock('expo-location', () => mockLocation);

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: 'active',
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));
jest.mock('../src/services/debugLogger', () => ({
  debugLogger: {
    startSession: jest.fn(() => 'mock-session'),
    endSession: jest.fn(async () => null),
    log: jest.fn(),
    logError: jest.fn(),
    isEnabled: jest.fn(() => false),
  },
}));
jest.mock('../src/services/crashLogger', () => ({
  crashLogger: {
    breadcrumb: jest.fn(),
    captureException: jest.fn(),
  },
}));
jest.mock('../src/services/appLog', () => ({ log: jest.fn() }));
jest.mock('../src/services/batteryMonitor', () => ({
  batteryMonitor: {
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    getCurrentLevel: jest.fn(() => null),
    getIsCharging: jest.fn(() => false),
  },
}));
jest.mock('../src/services/networkMonitor', () => ({
  networkMonitor: {
    start: jest.fn(async () => {}),
    stop: jest.fn(),
  },
}));
jest.mock('../src/services/sessionRecorder', () => ({
  sessionRecorder: { start: jest.fn(), stop: jest.fn() },
}));
jest.mock('../src/services/telemetryUploader', () => ({
  telemetryUploader: { upload: jest.fn(async () => ({ ok: true })) },
}));
jest.mock('../src/services/backgroundLocationTask', () => ({
  BACKGROUND_LOCATION_TASK: 'cairn-bg',
  registerBackgroundTask: jest.fn(async () => true),
  drainBackgroundLocations: jest.fn(() => []),
  persistBackgroundContext: jest.fn(async () => {}),
}));
jest.mock('../src/services/apiService', () => ({
  authenticatedFetch: jest.fn(async () => ({ ok: false })),
}));
jest.mock('../src/store/useAppStore', () => ({
  useAppStore: { getState: jest.fn(() => ({ user: { id: 'tracking-test-user' } })) },
}));
jest.mock('../src/services/sessionService', () => ({
  startSession: jest.fn(async () => null),
  appendPoints: jest.fn(async () => true),
  deleteRemoteSession: jest.fn(async () => true),
  saveHikeAtomic: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../src/services/autoPauseMonitor', () => ({
  startAutoPauseMonitor: jest.fn(),
  stopAutoPauseMonitor: jest.fn(),
}));

const { useTrackingStore } = require('../src/store/useTrackingStore');

describe('useTrackingStore.addTrackPoint — timestamp dedupe', () => {
  beforeEach(() => {
    useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  });

  it('adds a fix with no prior point', () => {
    useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(1);
    expect(useTrackingStore.getState().lastFixTimestamp).toBe(1000);
  });

  it('skips a duplicate fix with same timestamp at same coords (the 3× bug)', () => {
    useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(1);
  });

  it('skips a duplicate fix with same timestamp at near-identical coords (<5m)', () => {
    useTrackingStore.getState().addTrackPoint({ lat: 31.2066, lng: 121.5977 }, 1000);
    // ~1m apart, same ts
    useTrackingStore.getState().addTrackPoint({ lat: 31.20661, lng: 121.5977 }, 1000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(1);
  });

  it('KEEPS a same-timestamp fix that moved >5m (real movement during GPS reuse)', () => {
    useTrackingStore.getState().addTrackPoint({ lat: 31.2066, lng: 121.5977 }, 1000);
    // ~50m apart at the same timestamp — keep it
    useTrackingStore.getState().addTrackPoint({ lat: 31.2070, lng: 121.5983 }, 1000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(2);
  });

  it('accepts new fixes with different timestamps', () => {
    useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    useTrackingStore.getState().addTrackPoint({ lat: 1.0001, lng: 2.0001 }, 2000);
    useTrackingStore.getState().addTrackPoint({ lat: 1.0002, lng: 2.0002 }, 3000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(3);
  });

  it('still accepts fixes when timestamp is undefined (legacy callers)', () => {
    useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 });
    useTrackingStore.getState().addTrackPoint({ lat: 1.0001, lng: 2.0001 });
    expect(useTrackingStore.getState().trackPoints).toHaveLength(2);
  });

  it('reproduces the Sprint 41 bug pattern (94 fixes / 54 unique ts) — should now produce 54', () => {
    // Simulate the real telemetry: 54 unique timestamps, each fired ~1.7×
    // (foreground + background + foreground replay)
    const baseLat = 31.2066;
    const baseLng = 121.5977;
    for (let ts = 1000; ts <= 54000; ts += 1000) {
      // Slight drift per second (~3m)
      const lat = baseLat + (ts / 1000) * 0.00003;
      const lng = baseLng + (ts / 1000) * 0.00003;
      // Fire 3× with same coords + same ts (mimics the actual bug)
      useTrackingStore.getState().addTrackPoint({ lat, lng }, ts);
      useTrackingStore.getState().addTrackPoint({ lat, lng }, ts);
      useTrackingStore.getState().addTrackPoint({ lat, lng }, ts);
    }
    expect(useTrackingStore.getState().trackPoints).toHaveLength(54);
  });
});

describe('useTrackingStore.pauseTracking — pause pins', () => {
  beforeEach(() => {
    useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  });

  it('drops a pin at the current location when paused', () => {
    // Manually set tracking + lastCoordinate (skip startTracking complexity)
    useTrackingStore.setState({
      status: 'tracking',
      lastCoordinate: { lat: 31.5, lng: 121.5, alt: 5, accuracy: 10 },
    });
    useTrackingStore.getState().pauseTracking();

    const state = useTrackingStore.getState();
    expect(state.status).toBe('paused');
    expect(state.pausePins).toHaveLength(1);
    expect(state.pausePins[0]).toMatchObject({ lat: 31.5, lng: 121.5 });
  });

  it('does not drop a pin if no GPS fix yet', () => {
    useTrackingStore.setState({
      status: 'tracking',
      lastCoordinate: null,
    });
    useTrackingStore.getState().pauseTracking();

    expect(useTrackingStore.getState().pausePins).toHaveLength(0);
  });

  it('accumulates multiple pins across pause/resume cycles', () => {
    useTrackingStore.setState({
      status: 'tracking',
      lastCoordinate: { lat: 1, lng: 1 },
    });
    useTrackingStore.getState().pauseTracking();

    useTrackingStore.setState({
      status: 'tracking',
      lastCoordinate: { lat: 2, lng: 2 },
    });
    useTrackingStore.getState().pauseTracking();

    expect(useTrackingStore.getState().pausePins).toHaveLength(2);
  });
});

describe('useTrackingStore — P0 operation guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  });

  afterEach(() => {
    useTrackingStore.getState().discardCurrentSession();
  });

  it('locks synchronously during a real start and rolls back a failed location dependency', async () => {
    let resolvePermission: ((value: { status: string }) => void) | undefined;
    mockLocation.requestForegroundPermissionsAsync.mockImplementationOnce(
      () => new Promise(resolve => { resolvePermission = resolve; }),
    );

    const first = useTrackingStore.getState().startTracking();
    expect(useTrackingStore.getState().status).toBe('requesting');
    const second = useTrackingStore.getState().startTracking();
    await expect(second).resolves.toBe(false);

    resolvePermission?.({ status: 'denied' });
    await expect(first).resolves.toBe(false);
    const final = useTrackingStore.getState();
    expect(final).toMatchObject({ status: 'idle', sessionId: null });
    expect(['permission-denied', 'location-unavailable']).toContain(final.startError);
    const { startSession } = require('../src/services/sessionService');
    expect(startSession).not.toHaveBeenCalled();
  });

  it('accepts only one rapid stop pipeline', async () => {
    useTrackingStore.setState({
      status: 'tracking',
      sessionId: 'p0-stop-lock',
      remoteSessionId: 44,
      startedAt: Date.now(),
      distanceM: 0,
      trackPoints: [],
    });
    const first = useTrackingStore.getState().stopTracking();
    const second = useTrackingStore.getState().stopTracking();

    await expect(second).resolves.toBe(false);
    await expect(first).resolves.toBe(false);
    const { deleteRemoteSession } = require('../src/services/sessionService');
    expect(deleteRemoteSession).toHaveBeenCalledTimes(1);
    expect(useTrackingStore.getState().isFinishing).toBe(false);
  });
});
