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

jest.mock('expo-location', () => ({ __esModule: true, ...mockLocation, default: mockLocation }));

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
  persistBackgroundContext: jest.fn(async () => true),
}));
jest.mock('../src/services/hikeTrackWriter', () => ({
  appendHikePoint: jest.fn(async () => {}),
  startHikeTrack: jest.fn(async () => {}),
  updateHikeMeta: jest.fn(async () => {}),
  flushNow: jest.fn(async () => {}),
  renameToCompleted: jest.fn(async () => {}),
  discardActiveHike: jest.fn(async () => {}),
  readActiveHikeTail: jest.fn(async () => []),
  truncateActiveHikeTrack: jest.fn(async () => {}),
}));
jest.mock('../src/services/pendingSyncStore', () => ({
  savePending: jest.fn(async () => undefined),
  removePending: jest.fn(async () => undefined),
}));
jest.mock('../src/features/memory/services/recordMemoryEvidence', () => ({
  recordMemoryEvidence: jest.fn(async () => ({ committed: true, deduplicated: false })),
}));
jest.mock('../src/features/activity/activityRegistry', () => ({
  getUnfinishedActivity: jest.fn(async () => null),
  registerUnfinishedActivity: jest.fn(async () => {}),
  updateUnfinishedActivity: jest.fn(async () => true),
  replaceUnfinishedActivity: jest.fn(async () => true),
  completeActivity: jest.fn(async () => {}),
  acknowledgeActivity: jest.fn(async () => true),
  removeAcknowledgedActivity: jest.fn(async () => {}),
  tombstoneActivity: jest.fn(async () => {}),
  isActivityTombstoned: jest.fn(async () => false),
}));
jest.mock('../src/services/apiService', () => ({
  authenticatedFetch: jest.fn(async () => ({ ok: false })),
}));
jest.mock('../src/store/useAppStore', () => ({
  useAppStore: { getState: jest.fn(() => ({ user: { id: 'tracking-test-user' } })) },
}));
jest.mock('../src/services/sessionService', () => ({
  startSession: jest.fn(async () => null),
  startSessionResolved: jest.fn(async () => ({ kind: 'unavailable' })),
  appendPoints: jest.fn(async () => true),
  deleteRemoteSession: jest.fn(async () => true),
  deleteRemoteSessionByClientId: jest.fn(async () => true),
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
    useTrackingStore.setState({
      status: 'tracking',
      sessionId: '11111111-1111-4111-8111-111111111111',
      ownerUserId: 'tracking-test-user',
      startedAt: 1,
      liveOwnerGeneration: 'test-owner-generation',
      liveOwnerAcceptAfterMs: 1,
      currentSegmentId: 'test-segment',
    });
  });

  it('adds a fix with no prior point', async () => {
    await useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(1);
    expect(useTrackingStore.getState().lastFixTimestamp).toBe(1000);
  });

  it('does not publish a foreground fix until its durable journal commit resolves', async () => {
    const { appendHikePoint } = require('../src/services/hikeTrackWriter');
    const callsBefore = appendHikePoint.mock.calls.length;
    let releaseWrite: () => void = () => {};
    appendHikePoint.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseWrite = resolve; }));

    const acceptance = useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    for (let tick = 0; tick < 10 && appendHikePoint.mock.calls.length === callsBefore; tick += 1) {
      await Promise.resolve();
    }
    expect(appendHikePoint.mock.calls.length).toBe(callsBefore + 1);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(0);

    releaseWrite();
    await acceptance;
    expect(useTrackingStore.getState().trackPoints).toHaveLength(1);
  });

  it('skips a duplicate fix with same timestamp at same coords (the 3× bug)', async () => {
    await useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    await useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    await useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(1);
  });

  it('skips a duplicate fix with same timestamp at near-identical coords (<5m)', async () => {
    await useTrackingStore.getState().addTrackPoint({ lat: 31.2066, lng: 121.5977 }, 1000);
    // ~1m apart, same ts
    await useTrackingStore.getState().addTrackPoint({ lat: 31.20661, lng: 121.5977 }, 1000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(1);
  });

  it('rejects a same-timestamp fix even when coordinates differ (native batch order is authoritative)', async () => {
    await useTrackingStore.getState().addTrackPoint({ lat: 31.2066, lng: 121.5977 }, 1000);
    // A timestamp cannot represent two ordered samples safely.
    await useTrackingStore.getState().addTrackPoint({ lat: 31.2070, lng: 121.5983 }, 1000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(1);
  });

  it('accepts new fixes with different timestamps', async () => {
    await useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 }, 1000);
    await useTrackingStore.getState().addTrackPoint({ lat: 1.0001, lng: 2.0001 }, 2000);
    await useTrackingStore.getState().addTrackPoint({ lat: 1.0002, lng: 2.0002 }, 3000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(3);
  });

  it('retains a valid fix after long GPS loss as a new segment, without a fake connector', async () => {
    await useTrackingStore.getState().addTrackPoint({ lat: -41, lng: 174, accuracy: 5 }, 1_000);
    await useTrackingStore.getState().addTrackPoint({ lat: -41.01, lng: 174, accuracy: 5 }, 601_000);
    const points = useTrackingStore.getState().trackPoints;
    expect(points).toHaveLength(2);
    expect(points[1].segmentId).not.toBe(points[0].segmentId);
    expect(useTrackingStore.getState().distanceM).toBe(0);
    expect(useTrackingStore.getState().durationS).toBe(0);
  });

  it('reacquires from the last accepted anchor even after a recent rejected fix', async () => {
    await useTrackingStore.getState().addTrackPoint({ lat: -41, lng: 174, accuracy: 5 }, 1_000);
    const rejected = await useTrackingStore.getState().addTrackPoint(
      { lat: -41, lng: 174, accuracy: 60 },
      590_000,
    );
    const reacquired = await useTrackingStore.getState().addTrackPoint(
      { lat: -41.01, lng: 174, accuracy: 5 },
      601_000,
    );

    expect(rejected).toMatchObject({ accepted: false, reason: 'poor-accuracy' });
    expect(reacquired).toMatchObject({ accepted: true, reason: 'accepted-new-segment' });
    expect(useTrackingStore.getState().trackPoints).toHaveLength(2);
    expect(useTrackingStore.getState().distanceM).toBe(0);
  });

  it('repeats real-style loss and recovery without connector distance or Memory traversal', async () => {
    const fixes = [
      { lat: -41, t: 1_000 },
      { lat: -41.0001, t: 11_000 },
      { lat: -41.01, t: 601_000 },
      { lat: -41.0101, t: 611_000 },
      { lat: -41.02, t: 1_301_000 },
      { lat: -41.0201, t: 1_311_000 },
    ];
    for (const fix of fixes) {
      const result = await useTrackingStore.getState().addTrackPoint({
        lat: fix.lat,
        lng: 174,
        accuracy: 5,
        speed: 1,
      }, fix.t);
      expect(result.accepted).toBe(true);
    }

    const state = useTrackingStore.getState();
    expect(new Set(state.trackPoints.map((item: any) => item.segmentId))).toHaveProperty('size', 3);
    expect(state.distanceM).toBeGreaterThan(30);
    expect(state.distanceM).toBeLessThan(40);
    const memoryCalls = require('../src/features/memory/services/recordMemoryEvidence').recordMemoryEvidence.mock.calls
      .map((call: any[]) => call[0])
      .filter((item: any) => item.source === 'activity');
    expect(memoryCalls.slice(-fixes.length).map((item: any) => item.lat)).toEqual(fixes.map(item => item.lat));
  });

  it('still accepts fixes when timestamp is undefined (legacy callers)', async () => {
    await useTrackingStore.getState().addTrackPoint({ lat: 1, lng: 2 });
    await useTrackingStore.getState().addTrackPoint({ lat: 1.0001, lng: 2.0001 });
    expect(useTrackingStore.getState().trackPoints).toHaveLength(2);
  });

  it('parallel replay produces exactly the same accepted trace as one source', async () => {
    const baseLat = 31.2066;
    const baseLng = 121.5977;
    const feed = async (copies: number) => {
      for (let ts = 1000; ts <= 54000; ts += 1000) {
        const lat = baseLat + (ts / 1000) * 0.00003;
        const lng = baseLng + (ts / 1000) * 0.00003;
        for (let copy = 0; copy < copies; copy += 1) {
          await useTrackingStore.getState().addTrackPoint({ lat, lng }, ts);
        }
      }
      return useTrackingStore.getState().trackPoints.map((p: any) => ({ lat: p.lat, lng: p.lng, t: p.t }));
    };

    const singleSource = await feed(1);
    useTrackingStore.setState(useTrackingStore.getInitialState(), true);
    useTrackingStore.setState({
      status: 'tracking',
      sessionId: '11111111-1111-4111-8111-111111111111',
      ownerUserId: 'tracking-test-user',
      startedAt: 1,
      liveOwnerGeneration: 'test-owner-generation',
      liveOwnerAcceptAfterMs: 1,
      currentSegmentId: 'test-segment',
    });
    const replayed = await feed(3);

    // Quality/stationary gates may intentionally cull some unique fixes;
    // replaying the same foreground/background fix must never add more.
    expect(singleSource.length).toBeGreaterThan(0);
    expect(replayed).toEqual(singleSource);
    /*
     * The historical incident emitted each native fix three times. This
     * comparison remains valid as acceptance gates evolve because it asserts
     * identity of the resulting trace rather than a stale fixed point count.
     */
  });
});

describe('useTrackingStore.pauseTracking — pause pins', () => {
  beforeEach(() => {
    useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  });

  it('drops a pin at the current location when paused', async () => {
    // Manually set tracking + lastCoordinate (skip startTracking complexity)
    useTrackingStore.setState({
      status: 'tracking',
      lastCoordinate: { lat: 31.5, lng: 121.5, alt: 5, accuracy: 10 },
    });
    await useTrackingStore.getState().pauseTracking();

    const state = useTrackingStore.getState();
    expect(state.status).toBe('paused');
    expect(state.pausePins).toHaveLength(1);
    expect(state.pausePins[0]).toMatchObject({ lat: 31.5, lng: 121.5 });
  });

  it('does not drop a pin if no GPS fix yet', async () => {
    useTrackingStore.setState({
      status: 'tracking',
      lastCoordinate: null,
    });
    await useTrackingStore.getState().pauseTracking();

    expect(useTrackingStore.getState().pausePins).toHaveLength(0);
  });

  it('accumulates multiple pins across pause/resume cycles', async () => {
    useTrackingStore.setState({
      status: 'tracking',
      lastCoordinate: { lat: 1, lng: 1 },
    });
    await useTrackingStore.getState().pauseTracking();

    useTrackingStore.setState({
      status: 'tracking',
      lastCoordinate: { lat: 2, lng: 2 },
    });
    await useTrackingStore.getState().pauseTracking();

    expect(useTrackingStore.getState().pausePins).toHaveLength(2);
  });
});

describe('useTrackingStore — Simulator uses the canonical acceptance boundary', () => {
  const seedSimulatorActivity = () => {
    useTrackingStore.setState(useTrackingStore.getInitialState(), true);
    useTrackingStore.setState({
      status: 'tracking',
      sessionId: 'simulator-activity',
      ownerUserId: 'tracking-test-user',
      startedAt: 1,
      liveOwnerGeneration: 'simulator-generation',
      liveOwnerAcceptAfterMs: 1,
      currentSegmentId: 'simulator-segment',
      locationProviderSource: 'simulator',
    });
  };

  const sample = (extra: Record<string, unknown> = {}) => ({
    lat: 0,
    lng: 0,
    accuracy: 5,
    speed: 1,
    source: 'simulator' as const,
    clientActivityId: 'simulator-activity',
    ownerGeneration: 'simulator-generation',
    ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    require('../src/store/useAppStore').useAppStore.getState.mockReturnValue({ user: { id: 'tracking-test-user' } });
    seedSimulatorActivity();
  });

  it('journals an accepted Simulator sample and commits Memory through normal authorities', async () => {
    const decision = await useTrackingStore.getState().addTrackPoint(sample(), 1_000);
    expect(decision).toMatchObject({ accepted: true, reason: 'accepted', memoryCommitted: true });
    expect(require('../src/services/hikeTrackWriter').appendHikePoint).toHaveBeenCalledWith(
      expect.objectContaining({ src: 'sim', clientActivityId: 'simulator-activity' }),
    );
    expect(require('../src/features/memory/services/recordMemoryEvidence').recordMemoryEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'activity', ownerUserId: 'tracking-test-user' }),
    );
  });

  it('lets the normal accuracy gate reject poor synthetic evidence', async () => {
    const decision = await useTrackingStore.getState().addTrackPoint(sample({ accuracy: 60 }), 1_000);
    expect(decision).toMatchObject({ accepted: false, reason: 'poor-accuracy' });
    expect(useTrackingStore.getState().trackPoints).toHaveLength(0);
    expect(useTrackingStore.getState().trackPointsRaw).toHaveLength(1);
  });

  it('fences stale Real callbacks from a Simulator Activity', async () => {
    const decision = await useTrackingStore.getState().addTrackPoint(sample({ source: 'foreground' }), 1_000);
    expect(decision).toMatchObject({ accepted: false, reason: 'provider-source-mismatch' });
  });

  it.each(['hiking', 'running'] as const)(
    '%s starts at the selected distant virtual origin with no real-device connector',
    async activityMode => {
      useTrackingStore.setState({ activityMode });
      const shanghai = await useTrackingStore.getState().addTrackPoint(
        sample({ lat: 31.2304, lng: 121.4737, source: 'foreground' }),
        1_000,
      );
      const queenstown = await useTrackingStore.getState().addTrackPoint(
        sample({ lat: -45.0312, lng: 168.6626 }),
        1_001,
      );
      expect(shanghai).toMatchObject({ accepted: false, reason: 'provider-source-mismatch' });
      expect(queenstown).toMatchObject({ accepted: true });
      expect(useTrackingStore.getState()).toMatchObject({ distanceM: 0, durationS: 0 });
      expect(useTrackingStore.getState().trackPoints).toEqual([
        expect.objectContaining({ lat: -45.0312, lng: 168.6626, segmentStartReason: 'start' }),
      ]);
    },
  );

  it('fences stale Simulator callbacks from a Real Activity', async () => {
    useTrackingStore.setState({ locationProviderSource: 'real' });
    const decision = await useTrackingStore.getState().addTrackPoint(sample(), 1_000);
    expect(decision).toMatchObject({ accepted: false, reason: 'provider-source-mismatch' });
  });

  it('derives distance and elevation from accepted samples without using GPS as the timer', async () => {
    await useTrackingStore.getState().addTrackPoint(sample({ alt: 10 }), 1_000);
    await useTrackingStore.getState().addTrackPoint(sample({ lat: 0.00001, alt: 11 }), 2_000);
    await useTrackingStore.getState().addTrackPoint(sample({ lat: 0, alt: 10 }), 3_000);
    expect(useTrackingStore.getState()).toMatchObject({
      durationS: 0,
      elevationGainM: 1,
    });
    expect(useTrackingStore.getState().distanceM).toBeGreaterThan(2);
  });

  it('creates a zero-metric segment boundary after long untrusted loss', async () => {
    await useTrackingStore.getState().addTrackPoint(sample(), 1_000);
    const decision = await useTrackingStore.getState().addTrackPoint(
      sample({ lat: 0.01 }),
      601_000,
    );
    expect(decision).toMatchObject({ accepted: true, reason: 'accepted-new-segment' });
    expect(useTrackingStore.getState()).toMatchObject({ distanceM: 0, durationS: 0, elevationGainM: 0 });
    expect(useTrackingStore.getState().trackPoints[1].segmentId)
      .not.toBe(useTrackingStore.getState().trackPoints[0].segmentId);
  });

  it('supports unbounded explicit reacquisitions with zero gap distance', async () => {
    const fixes = [
      { lat: -45.0312, lng: 168.6626, segmentId: 'segment-1' },
      { lat: 35.6762, lng: 139.6503, segmentId: 'segment-2', segmentStartReason: 'gps-reacquired' },
      { lat: 69.6492, lng: 18.9553, segmentId: 'segment-3', segmentStartReason: 'gps-reacquired' },
      { lat: 64.1466, lng: -21.9426, segmentId: 'segment-4', segmentStartReason: 'gps-reacquired' },
    ];
    for (let index = 0; index < fixes.length; index += 1) {
      const decision = await useTrackingStore.getState().addTrackPoint(
        sample(fixes[index]),
        1_000 + index,
      );
      expect(decision.accepted).toBe(true);
    }
    const state = useTrackingStore.getState();
    expect(state.trackPoints.map((point: any) => point.segmentId)).toEqual([
      'segment-1', 'segment-2', 'segment-3', 'segment-4',
    ]);
    expect(state).toMatchObject({ distanceM: 0, durationS: 0, elevationGainM: 0 });
  });

  it('rolls back only committed Simulator route evidence and recalculates canonical metrics', async () => {
    const { destinationPoint } = require('../src/features/activitySimulator/geodesy');
    const origin = { lat: -45.0312, lng: 168.6626 };
    const points: any[] = [{ ...origin, t: 1_000, alt: 100, segmentId: 'simulator-segment' }];
    for (let index = 1; index <= 8; index += 1) {
      points.push({
        ...destinationPoint(points[index - 1], 90, 10),
        t: 1_000 + index * 10_000,
        alt: 100 + index,
        segmentId: 'simulator-segment',
      });
    }
    useTrackingStore.setState({
      trackPoints: points,
      trackPointsSmoothed: points,
      trackPointsRaw: [...points, { ...points[8], t: points[8].t + 1, accuracy: 99 }],
      distanceM: 80,
      durationS: 80,
      elevationGainM: 8,
      lastCoordinate: points[8],
      lastCoordinateTime: points[8].t,
      lastFixTimestamp: points[8].t,
    });
    const simulatorStore = require('../src/features/activitySimulator/useActivitySimulatorStore').useActivitySimulatorStore;
    simulatorStore.setState({
      enabled: true,
      startConfigured: true,
      signal: 'normal',
      current: points[8],
      altitudeM: points[8].alt,
      virtualTimestampMs: points[8].t,
    });

    const memoryCalls = require('../src/features/memory/services/recordMemoryEvidence').recordMemoryEvidence.mock.calls.length;
    const result = await useTrackingStore.getState().rollbackSimulatorTail(50);
    expect(result).toMatchObject({ ok: true, removedPointCount: 5 });
    expect(result.actualDistanceM).toBeCloseTo(50, 1);
    expect(useTrackingStore.getState()).toMatchObject({ durationS: 80, elevationGainM: 3 });
    expect(useTrackingStore.getState().distanceM).toBeCloseTo(30, 5);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(4);
    expect(simulatorStore.getState().current).toMatchObject({
      lat: useTrackingStore.getState().trackPoints[3].lat,
      lng: useTrackingStore.getState().trackPoints[3].lng,
    });
    expect(require('../src/services/hikeTrackWriter').truncateActiveHikeTrack).toHaveBeenCalledWith(
      'simulator-activity',
      expect.arrayContaining([expect.objectContaining({ src: 'sim' })]),
    );
    expect(require('../src/features/memory/services/recordMemoryEvidence').recordMemoryEvidence.mock.calls.length)
      .toBe(memoryCalls);
  });

  it('does not record samples while the real Activity lifecycle is paused', async () => {
    useTrackingStore.setState({ status: 'paused' });
    const decision = await useTrackingStore.getState().addTrackPoint(sample(), 1_000);
    expect(decision).toMatchObject({ accepted: false, reason: 'inactive-or-unowned' });
    expect(useTrackingStore.getState().trackPoints).toHaveLength(0);
  });

  it('does not derive accelerated stationary duration from canonical heartbeats', async () => {
    const decisions = [];
    for (let virtualSecond = 0; virtualSecond <= 60; virtualSecond += 10) {
      decisions.push(await useTrackingStore.getState().addTrackPoint(
        sample({ speed: 0 }),
        1_000 + virtualSecond * 1_000,
      ));
    }
    expect(decisions.some(decision => decision.reason === 'stationary-suppressed')).toBe(true);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(3);
    expect(useTrackingStore.getState().durationS).toBe(0);
    expect(useTrackingStore.getState().distanceM).toBe(0);
  });

  it('keeps accelerated sample and Memory evidence ordering strictly monotonic', async () => {
    const recordMemoryEvidence = require('../src/features/memory/services/recordMemoryEvidence').recordMemoryEvidence;
    for (let index = 0; index < 6; index += 1) {
      const decision = await useTrackingStore.getState().addTrackPoint(
        sample({ lat: index * 0.0000125 }),
        1_000 + index * 10_000,
      );
      expect(decision.reason).not.toBe('non-monotonic-timestamp');
    }
    const activityEvidenceTimes = recordMemoryEvidence.mock.calls
      .map((call: any[]) => call[0])
      .filter((args: any) => args.source === 'activity')
      .map((args: any) => args.atMs);
    expect(activityEvidenceTimes).toEqual([...activityEvidenceTimes].sort((a, b) => a - b));
    expect(new Set(activityEvidenceTimes).size).toBe(activityEvidenceTimes.length);
  });

  it('derives a 10× Hike at 5 km/h as about 833 m in ten Activity minutes', async () => {
    const { destinationPoint } = require('../src/features/activitySimulator/geodesy');
    let position = { lat: -45.0312, lng: 168.6626 };
    for (let index = 0; index <= 60; index += 1) {
      if (index > 0) position = destinationPoint(position, 0, (5 / 3.6) * 10);
      const decision = await useTrackingStore.getState().addTrackPoint(
        sample({ ...position, speed: 5 / 3.6 }),
        1_000 + index * 10_000,
      );
      expect(decision.accepted).toBe(true);
    }
    const state = useTrackingStore.getState();
    // Lifecycle time is tested independently; geometry still proves that a
    // realistic 5 km/h source was not falsified by the 10x replay cadence.
    expect(state.durationS).toBe(0);
    expect(state.distanceM).toBeCloseTo(833.33, 0);
  });

  it('derives a 10× Run pace from realistic 10 km/h evidence, not 100 km/h', async () => {
    const { destinationPoint } = require('../src/features/activitySimulator/geodesy');
    useTrackingStore.setState({ activityMode: 'running' });
    let position = { lat: -45.0312, lng: 168.6626 };
    for (let index = 0; index <= 60; index += 1) {
      if (index > 0) position = destinationPoint(position, 90, (10 / 3.6) * 10);
      const decision = await useTrackingStore.getState().addTrackPoint(
        sample({ ...position, speed: 10 / 3.6 }),
        1_000 + index * 10_000,
      );
      expect(decision.accepted).toBe(true);
    }
    const state = useTrackingStore.getState();
    expect(state.durationS).toBe(0);
    expect(state.distanceM).toBeCloseTo(1_666.67, 0);
  });

  it.each([
    ['Hike 5 km/h 1×', 'hiking', 5, 1, 13.89],
    ['Hike 5 km/h 10×', 'hiking', 5, 10, 138.89],
    ['Run 10 km/h 10×', 'running', 10, 10, 277.78],
  ] as const)('%s accepts every ten-second movement sample', async (_label, mode, speedKmh, timeScale, expectedDistanceM) => {
    const { destinationPoint } = require('../src/features/activitySimulator/geodesy');
    useTrackingStore.setState({ activityMode: mode });
    let position = { lat: -45.0312, lng: 168.6626 };
    const decisions = [];
    for (let wallSecond = 0; wallSecond <= 10; wallSecond += 1) {
      if (wallSecond > 0) {
        position = destinationPoint(position, 90, (speedKmh / 3.6) * timeScale);
      }
      decisions.push(await useTrackingStore.getState().addTrackPoint(
        sample({ ...position, speed: speedKmh / 3.6 }),
        1_000 + wallSecond * timeScale * 1_000,
      ));
    }
    expect(decisions.every(decision => decision.accepted)).toBe(true);
    expect(decisions.map(decision => decision.reason)).not.toContain('non-monotonic-timestamp');
    expect(useTrackingStore.getState()).toMatchObject({ durationS: 0 });
    expect(useTrackingStore.getState().distanceM).toBeCloseTo(expectedDistanceM, 0);
  });
});

describe('useTrackingStore — P0 operation guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    require('../src/store/useAppStore').useAppStore.getState.mockReturnValue({ user: { id: 'tracking-test-user' } });
    useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  });

  afterEach(async () => {
    await useTrackingStore.getState().discardCurrentSession();
    jest.useRealTimers();
  });

  it('advances lifecycle time without GPS and freezes only for explicit Pause', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-09T08:00:00.000Z'));

    await expect(useTrackingStore.getState().startTracking()).resolves.toBe(true);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(10_500);
    expect(useTrackingStore.getState().durationS).toBe(10);

    await useTrackingStore.getState().pauseTracking();
    const pausedDuration = useTrackingStore.getState().durationS;
    await jest.advanceTimersByTimeAsync(20_000);
    expect(useTrackingStore.getState().durationS).toBe(pausedDuration);

    await expect(useTrackingStore.getState().resumeTracking()).resolves.toBe(true);
    await jest.advanceTimersByTimeAsync(5_500);
    expect(useTrackingStore.getState().durationS).toBeGreaterThanOrEqual(pausedDuration + 5);
    expect(useTrackingStore.getState().durationS).toBeLessThanOrEqual(pausedDuration + 6);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(0);
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

    for (let tick = 0; tick < 20 && !resolvePermission; tick += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(resolvePermission).toBeDefined();
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
      ownerUserId: 'tracking-test-user',
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
    // Opening Finish on an ineligible Activity preserves the same unfinished
    // Activity and its server mapping until the user explicitly discards it.
    expect(deleteRemoteSession).not.toHaveBeenCalled();
    expect(useTrackingStore.getState().isFinishing).toBe(false);
  });

  it.each(['foreground', 'background'] as const)('rejects a delayed %s callback after Finish establishes the synchronous fence', async (source) => {
    const { persistBackgroundContext } = require('../src/services/backgroundLocationTask');
    let releaseFence: (value: boolean) => void = () => {};
    persistBackgroundContext.mockImplementationOnce(
      () => new Promise<boolean>(resolve => { releaseFence = resolve; }),
    );
    useTrackingStore.setState({
      status: 'tracking',
      sessionId: 'finish-fence-activity',
      ownerUserId: 'tracking-test-user',
      remoteSessionId: 44,
      startedAt: 1,
      distanceM: 0,
      trackPoints: [],
      liveOwnerGeneration: 'finish-fence-generation',
      liveOwnerAcceptAfterMs: 1,
      currentSegmentId: 'finish-fence-segment',
    });

    const finishing = useTrackingStore.getState().stopTracking();
    expect(useTrackingStore.getState().isFinishing).toBe(true);
    await useTrackingStore.getState().addTrackPoint({
      lat: -41,
      lng: 174,
      source,
      clientActivityId: 'finish-fence-activity',
      ownerGeneration: 'finish-fence-generation',
    }, 2_000);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(0);
    releaseFence(true);
    await expect(finishing).resolves.toBe(false);
  });

  it('failed Resume acquisition leaves the Activity paused and clears durable native ownership', async () => {
    const { persistBackgroundContext } = require('../src/services/backgroundLocationTask');
    mockLocation.watchPositionAsync.mockRejectedValueOnce(new Error('native-watch-failed'));
    useTrackingStore.setState({
      status: 'paused',
      sessionId: 'resume-failure-activity',
      ownerUserId: 'tracking-test-user',
      startedAt: 1,
      activityMode: 'hiking',
      liveOwnerGeneration: 'old-generation',
      liveOwnerAcceptAfterMs: 1,
      currentSegmentId: 'old-segment',
    });

    await expect(useTrackingStore.getState().resumeTracking()).resolves.toBe(false);
    expect(useTrackingStore.getState()).toMatchObject({
      status: 'paused',
      startError: 'initialization-failed',
    });
    expect(persistBackgroundContext).toHaveBeenLastCalledWith(null, false);
  });

  it('rejects a native sample older than the current ownership boundary', async () => {
    useTrackingStore.setState({
      status: 'tracking',
      sessionId: 'resume-boundary-activity',
      ownerUserId: 'tracking-test-user',
      startedAt: 1,
      liveOwnerGeneration: 'new-generation',
      liveOwnerAcceptAfterMs: 5_000,
      currentSegmentId: 'new-segment',
    });
    await useTrackingStore.getState().addTrackPoint({
      lat: -41,
      lng: 174,
      clientActivityId: 'resume-boundary-activity',
      ownerGeneration: 'new-generation',
      source: 'background',
    }, 4_999);
    expect(useTrackingStore.getState().trackPoints).toHaveLength(0);
  });

  it('logout suspension completes its durable fence before an A callback can reach B', async () => {
    const appStore = require('../src/store/useAppStore').useAppStore;
    useTrackingStore.setState({
      status: 'tracking',
      sessionId: 'account-a-activity',
      ownerUserId: 'tracking-test-user',
      startedAt: 1,
      liveOwnerGeneration: 'account-a-generation',
      liveOwnerAcceptAfterMs: 1,
      currentSegmentId: 'account-a-segment',
    });
    await useTrackingStore.getState().suspendForUserSwitch();
    appStore.getState.mockReturnValue({ user: { id: 'account-b' } });
    await useTrackingStore.getState().addTrackPoint({
      lat: -41,
      lng: 174,
      clientActivityId: 'account-a-activity',
      ownerGeneration: 'account-a-generation',
      source: 'background',
    }, 2_000);
    expect(useTrackingStore.getState()).toMatchObject({ status: 'idle', sessionId: null });
    expect(useTrackingStore.getState().trackPoints).toHaveLength(0);
  });
});
