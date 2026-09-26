import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const mockStorageValues = new Map<string, string>();
let mockCurrentUserId = 'raw-gps-qa';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Alert: { alert: jest.fn() },
  Linking: { openSettings: jest.fn() },
}));
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6, Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: {}, timestamp: Date.now() })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorageValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorageValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorageValues.delete(key); }),
  },
}));
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockStorageValues.get(key) ?? null),
    getItemStrict: jest.fn(async (key: string) => mockStorageValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorageValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorageValues.delete(key); }),
  },
}));
jest.mock('../store/useH3VisitedStore', () => ({
  useH3VisitedStore: { getState: () => ({
    addPointToCells: jest.fn(), clear: jest.fn(), bulkImport: jest.fn(),
  }) },
}));
jest.mock('../services/lastFixCache', () => ({ persistLastFix: jest.fn() }));
jest.mock('../lib/memoryHydrateGate', () => ({
  hasMemoryHydrateFailedBefore: jest.fn(async () => false),
  usesMemoryHydrateRecovery: jest.fn(async () => false),
  markMemoryHydrateRecovery: jest.fn(async () => undefined),
  markMemoryHydrateInProgress: jest.fn(async () => undefined),
  markMemoryHydrateSuccess: jest.fn(async () => undefined),
}));
jest.mock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
jest.mock('../../../services/memorySync', () => ({ attachMemorySync: jest.fn() }));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: { id: mockCurrentUserId } }) },
}));
jest.mock('../../../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ debugMode: true, activityGpsDistanceFilterM: 5 }) },
}));
jest.mock('../../../store/useSessionStore', () => ({
  useSessionStore: { getState: () => ({
    addSession: jest.fn(async () => undefined),
    markSynced: jest.fn(async () => true),
  }) },
}));
jest.mock('../../../services/debugLogger', () => ({
  debugLogger: { startSession: jest.fn(), endSession: jest.fn(async () => null), log: jest.fn(), logError: jest.fn(), isEnabled: jest.fn(() => false) },
}));
jest.mock('../../../services/crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn(), captureException: jest.fn() } }));
jest.mock('../../../services/appLog', () => ({ log: jest.fn() }));
jest.mock('../../../services/batteryMonitor', () => ({ batteryMonitor: { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined), getCurrentLevel: jest.fn(() => null), getIsCharging: jest.fn(() => false) } }));
jest.mock('../../../services/networkMonitor', () => ({ networkMonitor: { start: jest.fn(async () => undefined), stop: jest.fn() } }));
jest.mock('../../../services/sessionRecorder', () => ({ sessionRecorder: { start: jest.fn(), stop: jest.fn() } }));
jest.mock('../../../services/telemetryUploader', () => ({ telemetryUploader: { upload: jest.fn(async () => ({ ok: true })) } }));
jest.mock('../../../services/backgroundLocationTask', () => ({
  BACKGROUND_LOCATION_TASK: 'qa-bg', registerBackgroundTask: jest.fn(async () => true),
  drainBackgroundLocations: jest.fn(() => []), settleBackgroundLocationWrites: jest.fn(async () => undefined),
  persistBackgroundContext: jest.fn(async () => true),
}));
jest.mock('../../../services/hikeTrackWriter', () => ({
  appendHikePoint: jest.fn(async () => undefined), startHikeTrack: jest.fn(async () => undefined),
  updateHikeMeta: jest.fn(async () => undefined), updateHikeMetaStrict: jest.fn(async () => undefined), flushNow: jest.fn(async () => undefined),
  renameToCompleted: jest.fn(async () => undefined), discardActiveHike: jest.fn(async () => undefined),
  readActiveHikeTail: jest.fn(async () => []), truncateActiveHikeTrack: jest.fn(async () => undefined),
  sealHikeTrackForFinish: jest.fn(async () => true), releaseHikeTrackFinishSeal: jest.fn(async () => true),
}));
jest.mock('../../../services/pendingSyncStore', () => ({
  beginPendingPreparation: jest.fn(), finishPendingPreparation: jest.fn(),
  savePending: jest.fn(async () => undefined),
  markPendingPreparationPhase: jest.fn(async () => undefined),
  markPendingUploadReady: jest.fn(async () => undefined),
  readPendingReadonly: jest.fn(async () => null),
  removePending: jest.fn(async () => undefined),
}));
jest.mock('../../activity/activityRegistry', () => ({
  getActivityRegistry: jest.fn(async () => ({ unfinished: null, recoveryQueue: [], completed: [], tombstones: [] })),
  getUnfinishedActivity: jest.fn(async () => null), registerUnfinishedActivity: jest.fn(async () => undefined),
  updateUnfinishedActivity: jest.fn(async () => true), replaceUnfinishedActivity: jest.fn(async () => true),
  completeActivity: jest.fn(async () => undefined), acknowledgeActivity: jest.fn(async () => true),
  removeAcknowledgedActivity: jest.fn(async () => undefined), tombstoneActivity: jest.fn(async () => undefined),
  isActivityTombstoned: jest.fn(async () => false), mapActivityServerId: jest.fn(async () => true),
}));
jest.mock('../../../services/sessionService', () => ({
  startSessionResolved: jest.fn(async () => ({ kind: 'unavailable' })), fetchSessionDetail: jest.fn(async () => null),
  appendPoints: jest.fn(async () => true), deleteRemoteSession: jest.fn(async () => true),
  deleteRemoteSessionByClientId: jest.fn(async () => true), saveHikeAtomic: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn(async () => ({ ok: false })) }));
jest.mock('../../public/services/publicCairns', () => ({
  usePublicCairnStore: { getState: () => ({ verifyCompletedActivity: jest.fn(async () => false) }) },
}));
jest.mock('../../../services/autoPauseMonitor', () => ({ startAutoPauseMonitor: jest.fn(), stopAutoPauseMonitor: jest.fn() }));
jest.mock('../../activitySimulator/activityLocationProvider', () => ({
  activateSimulatorProvider: jest.fn(() => true), endSimulatorProvider: jest.fn(async () => undefined),
  isSimulatorProviderBound: jest.fn(() => false), pauseSimulatorProvider: jest.fn(),
  pauseSimulatorProviderForCorrection: jest.fn(async () => undefined), prepareSimulatorProvider: jest.fn(async () => true),
  reacquireSimulatorProviderAt: jest.fn(async () => undefined), restoreSimulatorProviderTail: jest.fn(),
  selectedActivityLocationSource: jest.fn(() => 'simulator'),
}));
jest.mock('../../activitySimulator/simulatorLog', () => ({
  appendSimulatorLog: jest.fn(), beginQaTelemetrySession: jest.fn(() => 'qa-session'),
  endQaTelemetrySession: jest.fn(async () => undefined), flushSimulatorLogs: jest.fn(async () => undefined),
  getQaTelemetryHealth: jest.fn(() => ({
    retainedObservationCount: 1_000_000,
    retainedDecisionCount: 1_000_000,
  })),
}));

const { useTrackingStore } = require('../../../store/useTrackingStore');
const { useMemoryStore } = require('../store/useMemoryStore');
const memoryPersistence = require('../services/memoryPersistence');
const { advanceRawGpsModel, createRawGpsModelState, REALISTIC_GPS_PROFILE } = require('../../activitySimulator/rawGpsObservationModel');
const { destinationPoint } = require('../../activitySimulator/geodesy');
const { deriveLivePace } = require('../../activity/livePace');
const { correlateLivePipelineTrace } = require('../../../../scripts/lib/revision03-live-pipeline-correlation.cjs');

type Truth = {
  t: number;
  eastM: number;
  northM: number;
  speedMps: number;
  courseDegrees: number;
  phase: string;
  signal?: 'normal' | 'poor' | 'frozen';
  observationAllowed?: boolean;
};

const EPOCH = 1_800_000_000_000;
const ORIGIN = { lat: -41.2865, lng: 174.7762 };
const PERFORMANCE_BUDGETS = Object.freeze({
  rawInputToDecisionP95Ms: 40,
  rawInputToDecisionMaxMs: 120,
  acceptedToMemoryP95Ms: 40,
  eventLoopDelayP95Ms: 40,
  userActionAcknowledgementMs: 50,
  persistenceFlushMs: 120,
});

function truthPoint(second: number, eastM: number, northM: number, speedMps: number, phase: string, extras: Partial<Truth> = {}): Truth {
  return {
    t: EPOCH + second * 1_000,
    eastM,
    northM,
    speedMps,
    courseDegrees: speedMps > 0 ? 90 : -1,
    phase,
    signal: 'normal',
    observationAllowed: true,
    ...extras,
  };
}

function interpolatePolyline(vertices: Array<[number, number]>, speedMps: number, phaseFor: (second: number) => string, extrasFor: (second: number) => Partial<Truth> = () => ({})): Truth[] {
  const points: Truth[] = [];
  let second = 0;
  for (let leg = 1; leg < vertices.length; leg += 1) {
    const [sx, sy] = vertices[leg - 1];
    const [ex, ey] = vertices[leg];
    const distance = Math.hypot(ex - sx, ey - sy);
    const steps = Math.max(1, Math.ceil(distance / speedMps));
    for (let index = leg === 1 ? 0 : 1; index <= steps; index += 1) {
      const fraction = index / steps;
      const east = sx + (ex - sx) * fraction;
      const north = sy + (ey - sy) * fraction;
      const bearing = (Math.atan2(ex - sx, ey - sy) * 180 / Math.PI + 360) % 360;
      points.push(truthPoint(second, east, north, speedMps, phaseFor(second), {
        courseDegrees: bearing,
        ...extrasFor(second),
      }));
      second += 1;
    }
  }
  return points;
}

function scenarios(): Record<string, Truth[]> {
  const r1: Truth[] = [];
  let east = 0;
  for (let second = 0; second <= 230; second += 1) {
    const speed = second < 55 ? 1.4
      : second < 65 ? Math.max(0.15, 1.4 - (second - 55) * 0.125)
        : second <= 155 ? 0
          : second < 168 ? Math.min(1.4, (second - 155) * 0.12)
            : 1.4;
    east += speed;
    r1.push(truthPoint(second, east, 0, speed,
      second < 55 ? 'walk' : second < 65 ? 'slow-down' : second <= 155 ? 'stationary' : second < 168 ? 'gradual-resume' : 'walk-resumed'));
  }

  const r2 = interpolatePolyline(
    [[0, 0], [70, 12], [86, 48], [48, 48], [65, 48], [110, 48]],
    1.3,
    second => second >= 100 && second < 108 ? 'pause' : second >= 108 && second < 138 ? 'short-backtrack' : 'bend-turn-forward',
  ).map((point, index, all) => index >= 100 && index < 108
    ? { ...point, eastM: all[99].eastM, northM: all[99].northM, speedMps: 0, phase: 'pause' }
    : point);

  const r3Noise = Array.from({ length: 181 }, (_, second) => truthPoint(second, second * 1.35, 0, 1.35, 'noise-corridor'));
  const r3Excursion = interpolatePolyline([[0, 0], [65, 0], [78, 28], [94, 0], [160, 0]], 1.35, () => 'intended-excursion');
  const r4 = interpolatePolyline(
    [[0, 0], [90, 0], [20, 24], [92, 48], [18, 72], [95, 96], [22, 120], [125, 145]],
    1.35,
    second => second >= 135 && second <= 190 ? 'degraded-switchback' : 'switchback',
    second => second >= 135 && second <= 190 ? { signal: 'poor' } : {},
  );
  const r5: Truth[] = [];
  for (let second = 0; second <= 330; second += 1) {
    const silent = second >= 105 && second <= 245;
    const stationary = second >= 55 && second < 105;
    const eastM = second < 55 ? second * 1.25 : stationary ? 68.75 : 68.75 + Math.max(0, second - 105) * 1.25;
    r5.push(truthPoint(second, eastM, 0, stationary ? 0 : 1.25,
      silent ? 'source-silence' : stationary ? 'fresh-stationary' : second > 245 ? 'source-restored' : 'moving',
      { observationAllowed: !silent }));
  }
  const r6: Truth[] = [];
  let runEast = 0;
  for (let second = 0; second <= 260; second += 1) {
    const speed = second < 25 ? 1.7 : second < 90 ? 2.4 : second < 150 ? 3.4 : second < 185 ? 2.2 : second < 220 ? 0 : 2.8;
    runEast += speed;
    r6.push(truthPoint(second, runEast, 0, speed,
      second < 25 ? 'run-slow' : second < 90 ? 'run-steady' : second < 150 ? 'run-faster' : second < 185 ? 'run-slowing' : second < 220 ? 'run-stop' : 'run-resume'));
  }
  return { R_GPS_01: r1, R_GPS_02: r2, R_GPS_03_NOISE: r3Noise, R_GPS_03_EXCURSION: r3Excursion, R_GPS_04: r4, R_GPS_05: r5, R_GPS_06: r6 };
}

function generateRaw(truth: Truth[], seed: number) {
  let state = createRawGpsModelState(seed, truth[0].t);
  const raw: any[] = [];
  for (const point of truth) {
    const groundTruth = destinationPoint(ORIGIN, Math.atan2(point.eastM, point.northM) * 180 / Math.PI, Math.hypot(point.eastM, point.northM));
    const stepped = advanceRawGpsModel({
      state,
      groundTruth,
      timestampMs: point.t,
      trueSpeedMps: point.speedMps,
      trueCourseDegrees: point.courseDegrees,
      signal: point.signal ?? 'normal',
      observationAllowed: point.observationAllowed !== false,
    });
    state = stepped.state;
    if (!stepped.observation) continue;
    raw.push({
      t: point.t,
      phase: point.phase,
      truth: { eastM: point.eastM, northM: point.northM, lat: groundTruth.lat, lng: groundTruth.lng },
      lat: stepped.observation.coordinate.lat,
      lng: stepped.observation.coordinate.lng,
      accuracyM: stepped.observation.accuracyM,
      speedMps: stepped.observation.speedMps,
      courseDegrees: stepped.observation.courseDegrees,
      errorEastM: stepped.observation.errorEastM,
      errorNorthM: stepped.observation.errorNorthM,
      biasEastM: stepped.observation.biasEastM,
      biasNorthM: stepped.observation.biasNorthM,
      outlier: stepped.observation.outlier,
      cadenceMs: stepped.observation.cadenceMs,
    });
  }
  return raw;
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
}

function radius(points: Array<{ lat: number; lng: number }>, center: { lat: number; lng: number }): number {
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos(center.lat * Math.PI / 180);
  return points.reduce((max, point) => Math.max(max, Math.hypot(
    (point.lat - center.lat) * latScale,
    (point.lng - center.lng) * lngScale,
  )), 0);
}

function localMeters(point: { lat: number; lng: number }): { eastM: number; northM: number } {
  return {
    eastM: (point.lng - ORIGIN.lng) * 111_320 * Math.cos(ORIGIN.lat * Math.PI / 180),
    northM: (point.lat - ORIGIN.lat) * 111_320,
  };
}

function nearestLocalDistance(
  points: Array<{ eastM: number; northM: number }>,
  target: { eastM: number; northM: number },
): number {
  return Math.min(...points.map(point => Math.hypot(
    point.eastM - target.eastM,
    point.northM - target.northM,
  )));
}

function trackingSnapshot(label: string) {
  const tracking = useTrackingStore.getState();
  const memory = useMemoryStore.getState();
  return {
    label,
    objectIdentity: {
      trackingPoints: tracking.trackPoints,
      memoryPoints: memory.testPoints,
    },
    status: tracking.status,
    rawCount: tracking.trackPointsRaw.length,
    acceptedCount: tracking.trackPoints.length,
    coverageCount: memory.testPoints.length,
    personalCoverageCount: memory.points.length,
    presenceCount: memory.presenceWitnesses.length,
    distanceM: tracking.distanceM,
    canonical: tracking.trackPoints.map((point: any) => ({ lat: point.lat, lng: point.lng, t: point.t, segmentId: point.segmentId })),
    coverage: memory.testPoints.map((point: any) => ({ lat: point.lat, lng: point.lng, ts: point.ts, cid: point.cid })),
  };
}

async function seedTracking(
  account: string,
  scenarioId: string,
  mode: 'hiking' | 'running',
  provider: 'simulator' | 'real' = 'simulator',
  startedAt = EPOCH,
) {
  mockCurrentUserId = account;
  await memoryPersistence.detachMemoryPersistence();
  await memoryPersistence.hydrateMemoryForUser(account);
  useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  useTrackingStore.setState({
    status: 'tracking',
    sessionId: `10000000-0000-4000-8000-${scenarioId.padEnd(12, '0').slice(0, 12)}`,
    ownerUserId: account,
    startedAt,
    liveOwnerGeneration: `generation-${scenarioId}`,
    liveOwnerAcceptAfterMs: startedAt,
    currentSegmentId: `segment-${scenarioId}`,
    locationProviderSource: provider,
    activityMode: mode,
  });
}

const report: any = {
  schema: 'cairnnz.revision03.raw-gps-memory.v1',
  generatedAt: null,
  environment: { runner: 'Jest/Node actual useTrackingStore + useMemoryStore + memoryPersistence', nativeDevice: false, physicalField: false },
  model: { name: 'O55 correlated Raw GPS observation model', version: 1, profile: REALISTIC_GPS_PROFILE },
  budgetsFrozenBeforeRun: PERFORMANCE_BUDGETS,
  scenarios: [],
  isolation: {},
};

describe('revision-03 realistic Raw GPS -> live isolated Memory pipeline', () => {
  jest.setTimeout(120_000);

  beforeAll(() => {
    mockStorageValues.clear();
  });

  afterAll(async () => {
    if (useTrackingStore.getState().status === 'tracking') {
      await useTrackingStore.getState().pauseTracking();
    }
    await memoryPersistence.detachMemoryPersistence();
    // replacePoints intentionally defers its H3 cache rebuild for 100 ms on
    // cold load. Let that product timer settle before Jest tears down the
    // module environment; otherwise a successful durable reload is followed
    // by a misleading post-test dynamic-import warning.
    await new Promise(resolve => setTimeout(resolve, 150));
    report.generatedAt = new Date().toISOString();
    const output = process.env.R03_GPS_EVIDENCE_OUT;
    if (output) fs.writeFileSync(output, JSON.stringify(report, (_key, value) => {
      if (_key === 'objectIdentity') return undefined;
      return value;
    }, 2));
  });

  test.each([550101, 550102, 550103])('R-GPS-01 seed %i unlocks Memory live, stays bounded at stop, finishes and reloads independently', async seed => {
    const truth = scenarios().R_GPS_01;
    const raw = generateRaw(truth, seed);
    const account = `qa-r1-${seed}`;
    await seedTracking(account, String(seed), 'hiking');
    const stages: any[] = [trackingSnapshot('before-activity')];
    const decisions: any[] = [];
    const inputToDecision: number[] = [];
    const acceptedToMemory: number[] = [];
    const eventLoopDelays: number[] = [];
    let initialCaptured = false;
    let stationaryStartCaptured = false;
    let stopCaptured = false;
    let resumedCaptured = false;

    for (const [index, observation] of raw.entries()) {
      const loopStart = performance.now();
      const loopProbe = new Promise<number>(resolve => setTimeout(() => resolve(performance.now() - loopStart), 0));
      const memoryBefore = useMemoryStore.getState().testPoints.length;
      let memoryMutationAt: number | null = null;
      const unsubscribe = useMemoryStore.subscribe((
        next: { testPoints: unknown[] },
        previous: { testPoints: unknown[] },
      ) => {
        if (next.testPoints !== previous.testPoints && memoryMutationAt === null) memoryMutationAt = performance.now();
      });
      const started = performance.now();
      const decision = await useTrackingStore.getState().addTrackPoint({
        lat: observation.lat,
        lng: observation.lng,
        accuracy: observation.accuracyM,
        speed: observation.speedMps,
        course: observation.courseDegrees,
        source: 'simulator',
        simulatorObservationMode: 'raw-gps',
        clientActivityId: useTrackingStore.getState().sessionId,
        ownerGeneration: useTrackingStore.getState().liveOwnerGeneration,
      }, observation.t);
      const ended = performance.now();
      unsubscribe();
      inputToDecision.push(ended - started);
      if (decision.accepted) acceptedToMemory.push((memoryMutationAt ?? ended) - started);
      eventLoopDelays.push(await loopProbe);
      decisions.push({ index, t: observation.t, phase: observation.phase, accepted: decision.accepted, reason: decision.reason });
      const state = useTrackingStore.getState();
      if (!initialCaptured && state.trackPoints.length >= 4) {
        initialCaptured = true;
        stages.push(trackingSnapshot('initial-accepted-motion'));
      }
      if (!stopCaptured && observation.phase === 'stationary' && observation.t >= EPOCH + 120_000) {
        stopCaptured = true;
        stages.push(trackingSnapshot('stationary-interval'));
      }
      if (!stationaryStartCaptured && observation.phase === 'stationary') {
        stationaryStartCaptured = true;
        stages.push(trackingSnapshot('stationary-start'));
      }
      if (!resumedCaptured && observation.phase === 'walk-resumed' && state.trackPoints.some((point: any) => point.t > EPOCH + 168_000)) {
        resumedCaptured = true;
        stages.push(trackingSnapshot('resumed-movement'));
      }
      expect(useMemoryStore.getState().points).toHaveLength(0);
      expect(useMemoryStore.getState().presenceWitnesses).toHaveLength(0);
      expect(useMemoryStore.getState().testPoints.length).toBeGreaterThanOrEqual(memoryBefore);
    }

    const beforeFinish = trackingSnapshot('immediately-before-finish');
    stages.push(beforeFinish);
    expect(beforeFinish.coverageCount).toBeGreaterThan(5);
    expect(stages.find(stage => stage.label === 'initial-accepted-motion')?.coverageCount).toBeGreaterThan(0);
    const stationaryStage = stages.find(stage => stage.label === 'stationary-interval');
    const stationaryStartStage = stages.find(stage => stage.label === 'stationary-start');
    expect(stationaryStage.coverageCount - stationaryStartStage.coverageCount).toBeLessThan(3);

    const finishStarted = performance.now();
    const finished = await useTrackingStore.getState().stopTracking(`R-GPS-01 ${seed}`);
    const finishMs = performance.now() - finishStarted;
    expect(finished).toBe(true);
    const afterFinish = trackingSnapshot('after-finish-handler');
    stages.push(afterFinish);
    expect(afterFinish.status).toBe('idle');
    expect(afterFinish.coverageCount).toBe(beforeFinish.coverageCount);

    const beforeReloadPoints = useMemoryStore.getState().testPoints;
    const persistenceStarted = performance.now();
    await memoryPersistence.flushSyntheticMemoryNow();
    const persistenceFlushMs = performance.now() - persistenceStarted;
    await memoryPersistence.detachMemoryPersistence();
    await memoryPersistence.hydrateMemoryForUser(account);
    const afterReload = trackingSnapshot('after-durable-reload');
    stages.push(afterReload);
    expect(afterReload.coverageCount).toBe(beforeFinish.coverageCount);
    expect(useMemoryStore.getState().testPoints).not.toBe(beforeReloadPoints);
    expect(afterReload.objectIdentity.memoryPoints).not.toBe(beforeFinish.objectIdentity.memoryPoints);

    const stopTruth = destinationPoint(ORIGIN, 90, truth.find(point => point.phase === 'stationary')!.eastM);
    const acceptedDuringStop = beforeFinish.canonical.filter((point: any) => point.t >= EPOCH + 65_000 && point.t <= EPOCH + 155_000);
    const stationaryRadiusM = radius(acceptedDuringStop, stopTruth);
    const metrics = {
      rawCount: raw.length,
      acceptedCount: decisions.filter(decision => decision.accepted).length,
      rejectedCount: decisions.filter(decision => !decision.accepted).length,
      coverageCount: beforeFinish.coverageCount,
      inputToDecisionMs: { p50: percentile(inputToDecision, 0.5), p95: percentile(inputToDecision, 0.95), max: Math.max(...inputToDecision) },
      acceptedToMemoryMs: { p50: percentile(acceptedToMemory, 0.5), p95: percentile(acceptedToMemory, 0.95), max: Math.max(...acceptedToMemory) },
      eventLoopDelayMs: { p50: percentile(eventLoopDelays, 0.5), p95: percentile(eventLoopDelays, 0.95), max: Math.max(...eventLoopDelays) },
      finishHandlerMs: finishMs,
      persistenceFlushMs,
      stationaryRadiusM,
      stationaryCoverageChange: stationaryStage.coverageCount - stationaryStartStage.coverageCount,
      rawCadenceMs: raw.slice(1).map((item, index) => item.t - raw[index].t),
      horizontalAccuracyM: raw.map(item => item.accuracyM),
      maxBiasMagnitudeM: Math.max(...raw.map(item => Math.hypot(item.biasEastM, item.biasNorthM))),
    };
    expect(metrics.inputToDecisionMs.p95).toBeLessThan(PERFORMANCE_BUDGETS.rawInputToDecisionP95Ms);
    expect(metrics.inputToDecisionMs.max).toBeLessThan(PERFORMANCE_BUDGETS.rawInputToDecisionMaxMs);
    expect(metrics.acceptedToMemoryMs.p95).toBeLessThan(PERFORMANCE_BUDGETS.acceptedToMemoryP95Ms);
    expect(metrics.eventLoopDelayMs.p95).toBeLessThan(PERFORMANCE_BUDGETS.eventLoopDelayP95Ms);
    expect(metrics.persistenceFlushMs).toBeLessThan(PERFORMANCE_BUDGETS.persistenceFlushMs);
    expect(stationaryRadiusM).toBeLessThan(30);
    report.scenarios.push({ id: 'R-GPS-01', seed, mode: 'hiking', truth, raw, decisions, stages, metrics });
  });

  test.each([
    ['R_GPS_02', 550202, 'hiking'],
    ['R_GPS_03_NOISE', 550303, 'hiking'],
    ['R_GPS_03_EXCURSION', 550304, 'hiking'],
    ['R_GPS_04', 550404, 'hiking'],
    ['R_GPS_05', 550505, 'hiking'],
    ['R_GPS_06', 550606, 'running'],
  ] as const)('%s seed %i crosses the same canonical and Memory boundary', async (scenarioId, seed, mode) => {
    const truth = scenarios()[scenarioId];
    const raw = generateRaw(truth, seed);
    const account = `qa-${scenarioId.toLowerCase()}-${seed}`;
    await seedTracking(account, String(seed), mode);
    const before = trackingSnapshot('before-activity');
    const decisions: any[] = [];
    const paceChecks: Record<string, any> = {};
    for (const [index, observation] of raw.entries()) {
      const decision = await useTrackingStore.getState().addTrackPoint({
        lat: observation.lat, lng: observation.lng, accuracy: observation.accuracyM,
        speed: observation.speedMps, course: observation.courseDegrees,
        source: 'simulator', simulatorObservationMode: 'raw-gps',
        clientActivityId: useTrackingStore.getState().sessionId,
        ownerGeneration: useTrackingStore.getState().liveOwnerGeneration,
      }, observation.t);
      decisions.push({ index, t: observation.t, phase: observation.phase, accepted: decision.accepted, reason: decision.reason });
      if (scenarioId === 'R_GPS_06' && ['run-faster', 'run-stop', 'run-resume'].includes(observation.phase)) {
        paceChecks[observation.phase] = deriveLivePace({
          points: useTrackingStore.getState().trackPoints,
          nowMs: observation.t,
          recording: true,
        });
      }
      if (scenarioId === 'R_GPS_05' && index === 2) {
        const duplicate = await useTrackingStore.getState().addTrackPoint({
          lat: observation.lat, lng: observation.lng, accuracy: observation.accuracyM,
          speed: observation.speedMps, course: observation.courseDegrees,
          source: 'simulator', simulatorObservationMode: 'raw-gps',
          clientActivityId: useTrackingStore.getState().sessionId,
          ownerGeneration: useTrackingStore.getState().liveOwnerGeneration,
        }, observation.t);
        decisions.push({ index: `${index}-duplicate`, t: observation.t, phase: 'repeated-old-timestamp', accepted: duplicate.accepted, reason: duplicate.reason });
        expect(duplicate).toMatchObject({ accepted: false, reason: 'non-monotonic-timestamp' });
      }
    }
    const beforeFinish = trackingSnapshot('immediately-before-finish');
    expect(beforeFinish.coverageCount).toBeGreaterThan(0);
    expect(beforeFinish.personalCoverageCount).toBe(0);
    expect(beforeFinish.presenceCount).toBe(0);
    const canonicalLocal: Array<{ eastM: number; northM: number }> = beforeFinish.canonical
      .map((point: { lat: number; lng: number }) => localMeters(point));
    const rawLocal = raw.map(localMeters);
    const topology: Record<string, unknown> = {};
    if (scenarioId === 'R_GPS_03_NOISE') {
      const rawNoiseExcursionM = Math.max(...rawLocal.map(point => Math.abs(point.northM)));
      const acceptedNoiseExcursionM = Math.max(...canonicalLocal.map(point => Math.abs(point.northM)));
      expect(rawNoiseExcursionM).toBeGreaterThan(30);
      expect(acceptedNoiseExcursionM).toBeLessThan(20);
      topology.rawNoiseExcursionM = rawNoiseExcursionM;
      topology.acceptedNoiseExcursionM = acceptedNoiseExcursionM;
    }
    if (scenarioId === 'R_GPS_03_EXCURSION') {
      const intendedApex = { eastM: 78, northM: 28 };
      const apexRetentionErrorM = nearestLocalDistance(canonicalLocal, intendedApex);
      const acceptedNorthExcursionM = Math.max(...canonicalLocal.map(point => point.northM));
      expect(apexRetentionErrorM).toBeLessThan(10);
      expect(acceptedNorthExcursionM).toBeGreaterThan(20);
      topology.apexRetentionErrorM = apexRetentionErrorM;
      topology.acceptedNorthExcursionM = acceptedNorthExcursionM;
    }
    if (scenarioId === 'R_GPS_04') {
      const turns = [[90, 0], [20, 24], [92, 48], [18, 72], [95, 96], [22, 120]]
        .map(([eastM, northM]) => ({ eastM, northM }));
      const retainedTurns = turns.filter(turn => nearestLocalDistance(canonicalLocal, turn) < 24).length;
      const meaningfulUnvisitedClearanceM = nearestLocalDistance(
        canonicalLocal,
        { eastM: -35, northM: 72 },
      ) - 30;
      expect(retainedTurns).toBeGreaterThanOrEqual(5);
      expect(meaningfulUnvisitedClearanceM).toBeGreaterThan(10);
      topology.retainedTurns = retainedTurns;
      topology.meaningfulUnvisitedClearanceM = meaningfulUnvisitedClearanceM;
    }
    if (scenarioId === 'R_GPS_05') {
      const silenceRaw = raw.filter(item => item.phase === 'source-silence');
      expect(silenceRaw).toHaveLength(0);
      expect(new Set(beforeFinish.canonical.map((point: any) => point.segmentId)).size).toBeGreaterThan(1);
      const trueGapMidpointClearanceM = nearestLocalDistance(
        canonicalLocal,
        { eastM: 157, northM: 0 },
      ) - 30;
      expect(trueGapMidpointClearanceM).toBeGreaterThan(25);
      topology.trueGapMidpointClearanceM = trueGapMidpointClearanceM;
    }
    if (scenarioId === 'R_GPS_06') {
      expect(beforeFinish.distanceM).toBeGreaterThan(300);
      expect(paceChecks['run-faster'].secondsPerKm).not.toBeNull();
      expect(paceChecks['run-stop'].secondsPerKm).toBeNull();
      expect(paceChecks['run-resume'].secondsPerKm).not.toBeNull();
      expect(paceChecks['run-faster'].secondsPerKm).toBeLessThan(paceChecks['run-resume'].secondsPerKm);
      const acceptedStopPoints = beforeFinish.canonical.filter((point: any) => (
        point.t >= EPOCH + 185_000 && point.t < EPOCH + 220_000
      ));
      expect(acceptedStopPoints).toHaveLength(0);
      topology.paceChecks = paceChecks;
      topology.acceptedStopPoints = acceptedStopPoints.length;
    }
    report.scenarios.push({
      id: scenarioId.replaceAll('_', '-'), seed, mode, truth, raw, decisions,
      stages: [before, beforeFinish],
      metrics: {
        rawCount: raw.length,
        acceptedCount: decisions.filter(item => item.accepted).length,
        rejectedCount: decisions.filter(item => !item.accepted).length,
        coverageCount: beforeFinish.coverageCount,
        canonicalDistanceM: beforeFinish.distanceM,
        topology,
        rawCadenceMs: raw.slice(1).map((item, index) => item.t - raw[index].t),
        horizontalAccuracyM: raw.map(item => item.accuracyM),
      },
    });
  });

  test('loaded timing correlates one observation and an accepted Memory duplicate cannot impersonate a later mutation', async () => {
    const runner = fs.readFileSync(
      path.resolve(__dirname, '../../../../scripts/revision03-raw-gps-loaded-qa.mjs'),
      'utf8',
    );
    expect(runner).toContain('correlateLivePipelineTrace');
    expect(runner).toContain('cairnEvidencePointCount');
    expect(runner).toContain('paintOpportunityAt');
    expect(runner).not.toContain('nextTracking.trackPoints.length > acceptedBefore');
    expect(runner).not.toContain('nextMemory.testPoints.length > coverageBefore');

    const correlated = correlateLivePipelineTrace({
      raw: [
        { timestamp: 1_000, sequence: 1, lat: -41, lng: 174, observedAt: 1 },
        { timestamp: 2_000, sequence: 2, lat: -41.0002, lng: 174, observedAt: 11 },
      ],
      accepted: [
        { timestamp: 1_000, lat: -41, lng: 174, observedAt: 2 },
        { timestamp: 2_000, lat: -41.0002, lng: 174, observedAt: 12 },
      ],
      memory: [
        { timestamp: 2_000, lat: -41.0002, lng: 174, observedAt: 13, coverageCount: 21 },
      ],
      decisions: [
        { timestamp: 1_000, sequence: 1, lat: -41, lng: 174, observedAt: 3, accepted: true, memoryCommitted: true, memoryDeduplicated: true },
        { timestamp: 2_000, sequence: 2, lat: -41.0002, lng: 174, observedAt: 14, accepted: true, memoryCommitted: true, memoryDeduplicated: false },
      ],
      sources: [{
        observedAt: 20,
        evidencePointCount: 21,
        contentSignature: 'qa|memory-fog-geodesic-v2|21|0|hash',
        geometryRevision: 'memory-fog-geodesic-v2',
        paintOpportunityAt: 25,
      }],
    }, 'memory-fog-geodesic-v2');
    expect(correlated.correlation).toMatchObject({ timestamp: 2_000, sequence: 2 });
    expect(correlated.acceptedToMemoryMs).toBe(1);
    expect(correlated.memoryToSourceUpdateMs).toBe(7);
    expect(correlated.sourceUpdateToPaintOpportunityMs).toBe(5);
    expect(correlated.paintOpportunityObserved).toBe(true);
    expect(correlated.deduplicatedCommitsBeforeMatchedCoverage).toHaveLength(1);

    const withoutPaint = correlateLivePipelineTrace({
      raw: [{ timestamp: 2_000, sequence: 2, lat: -41.0002, lng: 174, observedAt: 11 }],
      accepted: [{ timestamp: 2_000, lat: -41.0002, lng: 174, observedAt: 12 }],
      memory: [{ timestamp: 2_000, lat: -41.0002, lng: 174, observedAt: 13, coverageCount: 21 }],
      decisions: [{ timestamp: 2_000, sequence: 2, lat: -41.0002, lng: 174, observedAt: 14, accepted: true, memoryCommitted: true, memoryDeduplicated: false }],
      sources: [{
        observedAt: 20,
        evidencePointCount: 21,
        contentSignature: 'qa|memory-fog-geodesic-v2|21|0|hash',
        geometryRevision: 'memory-fog-geodesic-v2',
        paintOpportunityAt: null,
      }],
    }, 'memory-fog-geodesic-v2');
    expect(withoutPaint.correlation).not.toBeNull();
    expect(withoutPaint.paintOpportunityObserved).toBe(false);
    expect(withoutPaint.paintOpportunityMs).toBeNull();

    const paintBeforeSource = correlateLivePipelineTrace({
      raw: [{ timestamp: 2_000, sequence: 2, lat: -41.0002, lng: 174, observedAt: 11 }],
      accepted: [{ timestamp: 2_000, lat: -41.0002, lng: 174, observedAt: 12 }],
      memory: [{ timestamp: 2_000, lat: -41.0002, lng: 174, observedAt: 13, coverageCount: 21 }],
      decisions: [{ timestamp: 2_000, sequence: 2, lat: -41.0002, lng: 174, observedAt: 14, accepted: true, memoryCommitted: true, memoryDeduplicated: false }],
      sources: [{
        observedAt: 20,
        evidencePointCount: 21,
        contentSignature: 'qa|memory-fog-geodesic-v2|21|0|hash',
        geometryRevision: 'memory-fog-geodesic-v2',
        paintOpportunityAt: 19,
      }],
    }, 'memory-fog-geodesic-v2');
    expect(paintBeforeSource.paintOpportunityObserved).toBe(false);
    expect(paintBeforeSource.paintOpportunityMs).toBeNull();

    const truth = scenarios().R_GPS_01.filter(point => point.t <= EPOCH + 55_000);
    const raw = generateRaw(truth, 550101);
    await seedTracking('qa-dedup-correlation', 'dedup550101', 'hiking');
    let acceptedDuplicate: null | { decision: any; before: number; after: number; timestamp: number } = null;
    for (const observation of raw) {
      const before = useMemoryStore.getState().testPoints.length;
      const decision = await useTrackingStore.getState().addTrackPoint({
        lat: observation.lat,
        lng: observation.lng,
        accuracy: observation.accuracyM,
        speed: observation.speedMps,
        course: observation.courseDegrees,
        source: 'simulator',
        simulatorObservationMode: 'raw-gps',
        clientActivityId: useTrackingStore.getState().sessionId,
        ownerGeneration: useTrackingStore.getState().liveOwnerGeneration,
      }, observation.t);
      const after = useMemoryStore.getState().testPoints.length;
      if (decision.accepted && decision.memoryCommitted && decision.memoryDeduplicated) {
        acceptedDuplicate = { decision, before, after, timestamp: observation.t };
        break;
      }
    }
    expect(acceptedDuplicate).not.toBeNull();
    expect(acceptedDuplicate?.decision).toMatchObject({
      accepted: true,
      memoryCommitted: true,
      memoryDeduplicated: true,
    });
    expect(acceptedDuplicate?.after).toBe(acceptedDuplicate?.before);
  });

  test('R-GPS-07 repeat exploration traverses the O55 adapter twice, retains new presence, and keeps simulator evidence isolated', async () => {
    const account = 'qa-repeat-model';
    const baseTruth = scenarios().R_GPS_01.filter(point => point.t <= EPOCH + 55_000);
    const feedRealActivity = async (scenarioId: string, offsetMs: number) => {
      const shiftedTruth = baseTruth.map(point => ({ ...point, t: point.t + offsetMs }));
      const raw = generateRaw(shiftedTruth, 550707);
      await seedTracking(account, scenarioId, 'hiking', 'real', EPOCH + offsetMs);
      const decisions = [];
      for (const observation of raw) {
        const decision = await useTrackingStore.getState().addTrackPoint({
          lat: observation.lat,
          lng: observation.lng,
          accuracy: observation.accuracyM,
          speed: observation.speedMps,
          course: observation.courseDegrees,
          // Explicit isolated-QA injection at the normal native adapter
          // boundary. No production algorithm receives ground truth.
          source: 'foreground',
          clientActivityId: useTrackingStore.getState().sessionId,
          ownerGeneration: useTrackingStore.getState().liveOwnerGeneration,
        }, observation.t);
        decisions.push({ t: observation.t, accepted: decision.accepted, reason: decision.reason });
      }
      const beforeFinish = {
        ...trackingSnapshot(`repeat-${scenarioId}-before-finish`),
        personalCoverageCount: useMemoryStore.getState().points.length,
        presenceCount: useMemoryStore.getState().presenceWitnesses.length,
      };
      expect(decisions.some(decision => decision.accepted)).toBe(true);
      expect(await useTrackingStore.getState().stopTracking(`R-GPS-07 ${scenarioId}`)).toBe(true);
      return { raw, decisions, beforeFinish };
    };

    const first = await feedRealActivity('707100000001', 0);
    const firstCoverage = useMemoryStore.getState().points.length;
    const firstPresence = useMemoryStore.getState().presenceWitnesses.length;
    expect(firstCoverage).toBeGreaterThan(0);
    expect(firstPresence).toBeGreaterThan(0);

    const returned = await feedRealActivity('707100000002', 3_600_000);
    const afterReturn = useMemoryStore.getState();
    expect(afterReturn.points).toHaveLength(firstCoverage);
    expect(afterReturn.presenceWitnesses.length).toBeGreaterThan(firstPresence);

    await memoryPersistence.flushMemoryNow();
    const beforeReloadPoints = afterReturn.points;
    await memoryPersistence.detachMemoryPersistence();
    await memoryPersistence.hydrateMemoryForUser(account);
    expect(useMemoryStore.getState().points).toHaveLength(firstCoverage);
    expect(useMemoryStore.getState().presenceWitnesses.length).toBeGreaterThan(firstPresence);
    expect(useMemoryStore.getState().points).not.toBe(beforeReloadPoints);

    const personalCoverageBeforeSimulator = useMemoryStore.getState().points.length;
    const personalPresenceBeforeSimulator = useMemoryStore.getState().presenceWitnesses.length;
    const simulatorTruth = baseTruth.map(point => ({ ...point, t: point.t + 7_200_000 }));
    const simulatorRaw = generateRaw(simulatorTruth, 550708);
    await seedTracking(account, '707100000003', 'hiking', 'simulator', EPOCH + 7_200_000);
    for (const observation of simulatorRaw) {
      await useTrackingStore.getState().addTrackPoint({
        lat: observation.lat, lng: observation.lng, accuracy: observation.accuracyM,
        speed: observation.speedMps, course: observation.courseDegrees,
        source: 'simulator', simulatorObservationMode: 'raw-gps',
        clientActivityId: useTrackingStore.getState().sessionId,
        ownerGeneration: useTrackingStore.getState().liveOwnerGeneration,
      }, observation.t);
    }
    expect(useMemoryStore.getState().points).toHaveLength(personalCoverageBeforeSimulator);
    expect(useMemoryStore.getState().presenceWitnesses).toHaveLength(personalPresenceBeforeSimulator);
    expect(useMemoryStore.getState().testPoints.length).toBeGreaterThan(0);
    report.scenarios.push({
      id: 'R-GPS-07', seed: 550707, mode: 'hiking', truth: baseTruth,
      raw: first.raw, decisions: first.decisions,
      stages: [first.beforeFinish, returned.beforeFinish, trackingSnapshot('repeat-after-reload-and-simulator')],
      metrics: {
        firstCoverage, coverageAfterReturn: personalCoverageBeforeSimulator,
        firstPresence, presenceAfterReturn: personalPresenceBeforeSimulator,
        simulatorRawCount: simulatorRaw.length,
      },
    });
    report.isolation = {
      personalCoverageAfterFirst: firstCoverage,
      personalCoverageAfterReturn: personalCoverageBeforeSimulator,
      presenceAfterFirst: firstPresence,
      presenceAfterReturn: personalPresenceBeforeSimulator,
      simulatorPersonalCoverageDelta: useMemoryStore.getState().points.length - personalCoverageBeforeSimulator,
      simulatorPresenceDelta: useMemoryStore.getState().presenceWitnesses.length - personalPresenceBeforeSimulator,
      simulatorTestCoverage: useMemoryStore.getState().testPoints.length,
    };
  });
});
