/**
 * useTrackingStore.test — verify GPS pipeline dedupe & pause pin behavior.
 * Critical: ensures the 3× duplicate-fix bug from Sprint 41 telemetry cannot return.
 */

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
jest.mock('../src/services/batteryMonitor', () => ({
  batteryMonitor: {
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    getCurrentLevel: jest.fn(() => null),
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
jest.mock('../src/services/sessionService', () => ({
  deleteRemoteSession: jest.fn(async () => {}),
}));

const { useTrackingStore } = require('../src/store/useTrackingStore');

describe('useTrackingStore.addTrackPoint — timestamp dedupe', () => {
  beforeEach(() => {
    useTrackingStore.getState().reset();
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
    useTrackingStore.getState().reset();
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
