/**
 * Production-path local-first integration.
 *
 * Only platform/transport edges are faked. The test uses the shipped tracking
 * store, remote Start coordinator, session service protocol, Activity
 * registry, crash-safe WAL, pending snapshot store, sync daemon, GPS
 * qualification/segmentation, and completed-session store together.
 */

const mockAsyncValues = new Map<string, string>();
const mockStorageValues = new Map<string, string>();
const mockWebValues = new Map<string, string>();
let mockCurrentUserId = 'owner-a';
let mockNetworkState: 'online' | 'offline' = 'offline';
let mockNetworkListener: ((state: { state: 'online' | 'offline' }) => void) | null = null;
let mockAppStateListener: ((state: 'active' | 'background' | 'inactive') => void) | null = null;
let mockAppStateCurrent: 'active' | 'background' | 'inactive' = 'active';
let mockNativeBackgroundStarted = false;
let mockDurableActivityContext: any = null;
let mockBackgroundLocations: any[] = [];
const mockAuthenticatedFetch = jest.fn();
let mockWallTimeMs = 1_800_200_000_000;
let mockDateNowSpy: jest.SpyInstance<number, []> | null = null;

const localStorageMock = {
  getItem: (key: string) => mockWebValues.get(key) ?? null,
  setItem: (key: string, value: string) => { mockWebValues.set(key, value); },
  removeItem: (key: string) => { mockWebValues.delete(key); },
  clear: () => mockWebValues.clear(),
  key: (index: number) => [...mockWebValues.keys()][index] ?? null,
  get length() { return mockWebValues.size; },
};

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    get currentState() { return mockAppStateCurrent; },
    addEventListener: jest.fn((_event: string, listener: typeof mockAppStateListener) => {
      mockAppStateListener = listener;
      return { remove: jest.fn(() => { mockAppStateListener = null; }) };
    }),
  },
  Alert: { alert: jest.fn() },
  Linking: { openSettings: jest.fn() },
}));
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6, Balanced: 3 },
  ActivityType: { Fitness: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: -41.2865, longitude: 174.7762, accuracy: 5, speed: 1.2 },
    timestamp: Date.now(),
  })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => mockNativeBackgroundStarted),
  startLocationUpdatesAsync: jest.fn(async () => { mockNativeBackgroundStarted = true; }),
  stopLocationUpdatesAsync: jest.fn(async () => { mockNativeBackgroundStarted = false; }),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-file-system/legacy', () => ({ __esModule: true, default: {}, documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockAsyncValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockAsyncValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockAsyncValues.delete(key); }),
  },
}));
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockStorageValues.get(key) ?? null),
    getItemStrict: jest.fn(async (key: string) => mockStorageValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorageValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorageValues.delete(key); }),
    getAllKeysStrict: jest.fn(async () => [...mockStorageValues.keys()]),
    removeItemsStrict: jest.fn(async (keys: string[]) => keys.forEach(key => mockStorageValues.delete(key))),
  },
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: mockCurrentUserId } }) },
}));
jest.mock('../../../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ debugMode: false, activityGpsDistanceFilterM: 5 }) },
}));
jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));
jest.mock('../../../services/networkMonitor', () => {
  const networkMonitor = {
    start: jest.fn(async () => undefined),
    stop: jest.fn(),
    isOnline: jest.fn(() => mockNetworkState === 'online'),
    getState: jest.fn(() => ({ state: mockNetworkState })),
    onChange: jest.fn((listener: typeof mockNetworkListener) => {
      mockNetworkListener = listener;
      return () => { if (mockNetworkListener === listener) mockNetworkListener = null; };
    }),
  };
  return { __esModule: true, networkMonitor, default: networkMonitor };
});
jest.mock('../../../services/backgroundLocationTask', () => ({
  BACKGROUND_LOCATION_TASK: 'integration-background-task',
  registerBackgroundTask: jest.fn(async () => true),
  drainBackgroundLocations: jest.fn(() => mockBackgroundLocations.splice(0)),
  settleBackgroundLocationWrites: jest.fn(async () => undefined),
  persistBackgroundContext: jest.fn(async () => true),
  readDurableActivityContext: jest.fn(async () => mockDurableActivityContext),
}));
jest.mock('../../../services/debugLogger', () => ({
  debugLogger: { startSession: jest.fn(), endSession: jest.fn(async () => null), log: jest.fn(), logError: jest.fn(), isEnabled: jest.fn(() => false) },
}));
jest.mock('../../../services/crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn(), captureException: jest.fn() } }));
jest.mock('../../../services/appLog', () => ({ log: jest.fn() }));
jest.mock('../../../services/batteryMonitor', () => ({ batteryMonitor: { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined), getCurrentLevel: jest.fn(() => null), getIsCharging: jest.fn(() => false) } }));
jest.mock('../../../services/sessionRecorder', () => ({ sessionRecorder: { start: jest.fn(), stop: jest.fn() } }));
jest.mock('../../../services/telemetryUploader', () => ({ telemetryUploader: { upload: jest.fn(async () => ({ ok: true })) } }));
jest.mock('../../../services/autoPauseMonitor', () => ({ startAutoPauseMonitor: jest.fn(), stopAutoPauseMonitor: jest.fn() }));
jest.mock('../../memory/services/recordMemoryEvidence', () => ({
  recordMemoryEvidence: jest.fn(async () => ({ committed: true, deduplicated: false })),
  flushRecordedMemoryEvidence: jest.fn(async () => undefined),
}));
jest.mock('../../memory/store/useH3VisitedStore', () => ({
  useH3VisitedStore: { getState: () => ({ addPointToCells: jest.fn(), clear: jest.fn(), bulkImport: jest.fn() }) },
}));
jest.mock('../../activitySimulator/activityLocationProvider', () => ({
  activateSimulatorProvider: jest.fn(() => false), endSimulatorProvider: jest.fn(async () => undefined),
  isSimulatorProviderBound: jest.fn(() => false), pauseSimulatorProvider: jest.fn(),
  pauseSimulatorProviderForCorrection: jest.fn(async () => undefined), prepareSimulatorProvider: jest.fn(async () => false),
  reacquireSimulatorProviderAt: jest.fn(async () => undefined), restoreSimulatorProviderTail: jest.fn(),
  selectedActivityLocationSource: jest.fn(() => 'real'),
}));
jest.mock('../../activitySimulator/simulatorLog', () => ({
  appendSimulatorLog: jest.fn(), beginQaTelemetrySession: jest.fn(() => 'integration'),
  endQaTelemetrySession: jest.fn(async () => undefined), flushSimulatorLogs: jest.fn(async () => undefined),
  getQaTelemetryHealth: jest.fn(() => ({ retainedObservationCount: 1000, retainedDecisionCount: 1000 })),
}));
jest.mock('../../public/services/publicCairns', () => ({
  usePublicCairnStore: { getState: () => ({ verifyCompletedActivity: jest.fn(async () => false) }) },
  reconcilePublicActivityAfterServerAck: jest.fn(async () => undefined),
}));
jest.mock('../activityMemoryProjector', () => ({
  scheduleActivityMemoryProjection: jest.fn(async () => undefined),
  cancelActivityMemoryProjection: jest.fn(async () => undefined),
  reconcileActivityMemoryProjection: jest.fn(async () => true),
  retireActivityMemoryProjection: jest.fn(async () => true),
}));

import { useTrackingStore } from '../../../store/useTrackingStore';
import { useSessionStore } from '../../../store/useSessionStore';
import { getActivityRegistry } from '../activityRegistry';
import { getActivityRemoteStartConflict } from '../activityRemoteConflictStore';
import { __activityRemoteStartCoordinatorTest } from '../activityRemoteStartCoordinator';
import { activityGeometryFingerprint } from '../activityFinalArtifact';
import { appendHikePoint, listActiveHikes, readActiveHikeTail } from '../../../services/hikeTrackWriter';
import { listPending } from '../../../services/pendingSyncStore';
import { drainPending } from '../../../services/syncDaemon';
import { buildActivityDistanceAccumulator } from '../activityContracts';
import { deriveActivityLocationHealth } from '../activityLocationHealth';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

async function settleUntil(predicate: () => boolean, turns = 80, label = 'unspecified'): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`integration_frontier_timeout:${label}`);
}

const FIELD_RESUME_CASES = [
  {
    name: 'Run 1 #768→#769', mode: 'running' as const,
    trueGapMs: 6_000, trueGapM: 6.82, staleGapMs: 500_999, staleGapM: 552.76,
  },
  {
    name: 'Hike #479→#480', mode: 'hiking' as const,
    trueGapMs: 1_000, trueGapM: 1.06, staleGapMs: 214_999, staleGapM: 210.58,
  },
  {
    name: 'Run 2 #314→#315', mode: 'running' as const,
    trueGapMs: 10_932, trueGapM: 17.96, staleGapMs: 744_811, staleGapM: 1_172.90,
  },
];

const METERS_PER_LONGITUDE_DEGREE_AT_EQUATOR = 111_194.93;

function fieldResumePoints(fieldCase: typeof FIELD_RESUME_CASES[number], newTime: number) {
  const point = (t: number, distanceBeforeM: number, rawOrdinal: number, segmentId: string) => ({
    t,
    lat: 0,
    lng: -distanceBeforeM / METERS_PER_LONGITUDE_DEGREE_AT_EQUATOR,
    alt: 5,
    accuracy: 5,
    verticalAccuracy: 7,
    speed: fieldCase.mode === 'running' ? 2.2 : 1.2,
    rawOrdinal,
    source: 'background' as const,
    segmentId,
  });
  const segmentId = `field-resume-${fieldCase.mode}`;
  return {
    segmentId,
    stale: point(newTime - fieldCase.staleGapMs, fieldCase.staleGapM, 1, segmentId),
    predecessor: point(newTime - fieldCase.trueGapMs, fieldCase.trueGapM, 2, segmentId),
    next: point(newTime, 0, 3, segmentId),
  };
}

describe.each(['hiking', 'running'] as const)(
  'production-path local-first %s orchestration',
  (mode) => {
    jest.setTimeout(30_000);

    beforeEach(async () => {
      mockAsyncValues.clear();
      mockStorageValues.clear();
      mockWebValues.clear();
      mockAuthenticatedFetch.mockReset();
      mockCurrentUserId = 'owner-a';
      mockNetworkState = 'offline';
      mockNetworkListener = null;
      mockAppStateListener = null;
      mockAppStateCurrent = 'active';
      mockNativeBackgroundStarted = false;
      mockDurableActivityContext = null;
      mockBackgroundLocations = [];
      mockWallTimeMs = mode === 'hiking' ? 1_800_200_000_000 : 1_800_300_000_000;
      mockDateNowSpy?.mockRestore();
      mockDateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => mockWallTimeMs);
      __activityRemoteStartCoordinatorTest.reset();
      Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
      useTrackingStore.setState(useTrackingStore.getInitialState(), true);
      useSessionStore.setState({ sessions: [], currentUserId: 'owner-a' });
    });

    afterEach(async () => {
      const state = useTrackingStore.getState();
      if (state.status !== 'idle' && state.sessionId) {
        await state.discardCurrentSession();
      }
      mockDateNowSpy?.mockRestore();
      mockDateNowSpy = null;
    });

    test('slow Start, connectivity flaps, Finish, cold reopen and lost ACK converge once', async () => {
      const clientActivityId = mode === 'hiking'
        ? '10000000-0000-4000-8000-000000000101'
        : '10000000-0000-4000-8000-000000000102';
      const startDeferred = deferredResponse();
      const serverActivityId = mode === 'hiking' ? 701 : 702;
      let startCount = 0;
      let saveCount = 0;
      mockAuthenticatedFetch.mockImplementation(async (path: string) => {
        if (path === '/api/sessions/start') {
          startCount += 1;
          return startDeferred.promise;
        }
        if (path === `/api/sessions/${serverActivityId}/save`) {
          saveCount += 1;
          if (saveCount === 1) throw new Error('ack_lost_after_server_commit');
          return jsonResponse(200, {
            ok: true,
            session_id: serverActivityId,
            client_activity_id: clientActivityId,
            finalized_at: new Date().toISOString(),
            memory: { accepted: 0, rejected: 0 },
            idempotent_replay: true,
          });
        }
        return jsonResponse(404, { code: 'UNEXPECTED_TEST_PATH' });
      });

      useTrackingStore.getState().setActivityMode(mode);
      await expect(useTrackingStore.getState().startTracking(clientActivityId)).resolves.toBe(true);
      expect(useTrackingStore.getState()).toMatchObject({
        status: 'tracking', sessionId: clientActivityId, remoteSessionId: null,
      });
      expect(startCount).toBe(1);
      expect((await getActivityRegistry('owner-a')).unfinished?.clientActivityId).toBe(clientActivityId);
      expect((await listActiveHikes()).map(item => item.session_id)).toContain(clientActivityId);

      const base = mockWallTimeMs;
      const decisions: Array<{ accepted: boolean; reason: string }> = [];
      for (let index = 0; index < 7; index += 1) {
        mockWallTimeMs = base + index * 5_000;
        if (index === 2) {
          mockNetworkState = 'online';
          mockNetworkListener?.({ state: 'online' });
          mockAppStateListener?.('background');
        }
        if (index === 5) {
          mockNetworkState = 'offline';
          mockNetworkListener?.({ state: 'offline' });
          mockAppStateListener?.('active');
        }
        const source = index >= 2 && index < 5 ? 'background' as const : 'foreground' as const;
        const timestamp = base + index * 5_000;
        const coordinate = {
          lat: -41.2865,
          lng: 174.7762 + index * 0.00012,
          accuracy: 5,
          speed: mode === 'running' ? 2.4 : 1.3,
          source,
          clientActivityId,
          ownerGeneration: useTrackingStore.getState().liveOwnerGeneration ?? undefined,
        };
        if (source === 'background') {
          const state = useTrackingStore.getState();
          await appendHikePoint({
            t: timestamp,
            lat: coordinate.lat,
            lng: coordinate.lng,
            acc: coordinate.accuracy,
            speed: coordinate.speed,
            src: 'bg',
            clientActivityId,
            ownerGeneration: state.liveOwnerGeneration!,
            segmentId: state.currentSegmentId!,
          });
        }
        const decision = await useTrackingStore.getState().addTrackPoint({
          ...coordinate,
          ...(source === 'background' ? {
            continuityPreclassified: true,
            canonicalDecision: 'ACCEPT' as const,
            decisionReason: 'background-task-accepted',
            committedBeforeFence: true,
            segmentId: useTrackingStore.getState().currentSegmentId ?? undefined,
          } : {}),
        }, timestamp);
        decisions.push({ accepted: decision.accepted, reason: decision.reason });
      }
      mockWallTimeMs = base + 40_000;
      const localBeforeFinish = useTrackingStore.getState().trackPoints.map(point => ({
        t: point.t, lat: point.lat, lng: point.lng, segmentId: point.segmentId,
      }));
      expect({ localPointCount: localBeforeFinish.length, decisions }).toEqual(expect.objectContaining({
        localPointCount: expect.any(Number),
      }));
      if (localBeforeFinish.length < 5) {
        throw new Error(`insufficient_local_points:${JSON.stringify(decisions)}`);
      }
      expect((await readActiveHikeTail(clientActivityId)).length).toBe(localBeforeFinish.length);
      expect(startCount).toBe(1); // flapping coalesced into the in-flight Start

      const finished = await useTrackingStore.getState().stopTracking(`Integration ${mode}`);
      if (!finished || finished.status !== 'saved-local') {
        throw new Error(`unexpected_finish:${JSON.stringify(finished)}`);
      }
      expect(finished).toMatchObject({
        status: 'saved-local', clientActivityId, activityMode: mode, syncState: 'pending',
      });
      expect(finished.trackPoints.length).toBeGreaterThanOrEqual(2);
      const [pendingAfterFinish] = await listPending();
      expect(pendingAfterFinish).toMatchObject({
        localId: clientActivityId, userId: 'owner-a', remoteId: null, activityMode: mode,
      });
      expect(pendingAfterFinish.payload.route_points_canonical.map(point => ({
        t: point.t, lat: point.lat, lng: point.lng, segmentId: point.segment_id,
      }))).toEqual(localBeforeFinish);

      // The late Start ACK maps the completed-local registry and outbox; it
      // cannot reopen or duplicate the Activity.
      startDeferred.resolve(jsonResponse(201, {
        id: serverActivityId,
        client_activity_id: clientActivityId,
      }));
      await settleUntil(() => mockWebValues.get(`cairn-fs://cairn-pending-sync/${clientActivityId}.json`)?.includes(`\"remoteId\":${serverActivityId}`) === true);
      expect((await getActivityRegistry('owner-a')).completed).toEqual([
        expect.objectContaining({ clientActivityId, serverActivityId, syncState: 'pending' }),
      ]);

      // Simulated cold reopen: mutable tracking state is gone, durable pending
      // and registry records remain the only authority.
      useTrackingStore.setState(useTrackingStore.getInitialState(), true);
      expect((await listPending())[0]).toMatchObject({ localId: clientActivityId, remoteId: serverActivityId });

      mockNetworkState = 'online';
      const drain = await drainPending({ wakeReason: 'manual', force: true });
      expect(drain).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
      expect(saveCount).toBe(2); // first response lost, second idempotent replay
      expect(await listPending()).toEqual([]);
      expect(useSessionStore.getState().sessions.filter(
        session => (session.clientActivityId ?? session.id) === clientActivityId,
      )).toHaveLength(1);
      expect(startCount).toBe(1);
      expect(await getActivityRemoteStartConflict('owner-a', clientActivityId)).toBeNull();
    });

    test('identical evidence keeps local truth equal across opposite connectivity timelines', async () => {
      type Timeline = {
        name: string;
        clientActivityId: string;
        serverActivityId: number;
        connectivity: Array<'online' | 'offline'>;
      };
      const sources = [
        'foreground', 'background', 'background', 'background',
        'background', 'foreground', 'foreground',
      ] as const;
      // The fourth observation arrives 336 seconds after the third, preserving
      // the real Run 2 unknown interval as a disconnected section. The
      // remaining observations prove background and foreground reacquisition
      // without changing the delivered evidence between network timelines.
      const elapsedMs = [0, 5_000, 10_000, 346_000, 351_000, 356_000, 361_000];

      const run = async (timeline: Timeline) => {
        const active = useTrackingStore.getState();
        if (active.status !== 'idle' && active.sessionId) await active.discardCurrentSession();
        mockAsyncValues.clear();
        mockStorageValues.clear();
        mockWebValues.clear();
        mockAuthenticatedFetch.mockReset();
        mockNetworkListener = null;
        mockAppStateListener = null;
        mockAppStateCurrent = 'active';
        mockNativeBackgroundStarted = false;
        __activityRemoteStartCoordinatorTest.reset();
        useTrackingStore.setState(useTrackingStore.getInitialState(), true);
        useSessionStore.setState({ sessions: [], currentUserId: 'owner-a' });
        mockWallTimeMs = mode === 'hiking' ? 1_801_200_000_000 : 1_801_300_000_000;
        mockNetworkState = timeline.connectivity[0];
        let startAttempts = 0;
        let saveAttempts = 0;
        mockAuthenticatedFetch.mockImplementation(async (path: string) => {
          if (path === '/api/sessions/start') {
            startAttempts += 1;
            if (mockNetworkState === 'offline') throw new Error('transport_offline');
            return jsonResponse(201, {
              id: timeline.serverActivityId,
              client_activity_id: timeline.clientActivityId,
            });
          }
          if (path === `/api/sessions/${timeline.serverActivityId}/save`) {
            saveAttempts += 1;
            if (mockNetworkState === 'offline') throw new Error('transport_offline');
            return jsonResponse(200, {
              ok: true,
              session_id: timeline.serverActivityId,
              client_activity_id: timeline.clientActivityId,
              finalized_at: new Date().toISOString(),
              memory: { accepted: 0, rejected: 0 },
              idempotent_replay: false,
            });
          }
          return jsonResponse(404, { code: 'UNEXPECTED_TEST_PATH' });
        });

        useTrackingStore.getState().setActivityMode(mode);
        await expect(useTrackingStore.getState().startTracking(timeline.clientActivityId))
          .resolves.toBe(true);
        await settleUntil(() => startAttempts >= 1, 80, `${timeline.name}:start-attempt`);
        if (timeline.connectivity[0] === 'online') {
          await settleUntil(
            () => useTrackingStore.getState().remoteSessionId === timeline.serverActivityId,
            80,
            `${timeline.name}:initial-remote-map`,
          );
        }

        const base = mockWallTimeMs;
        const decisions: Array<{ accepted: boolean; reason: string }> = [];
        for (let index = 0; index < elapsedMs.length; index += 1) {
          mockWallTimeMs = base + elapsedMs[index];
          const nextNetwork = timeline.connectivity[index];
          if (nextNetwork !== mockNetworkState) {
            mockNetworkState = nextNetwork;
            (mockNetworkListener as ((state: { state: 'online' | 'offline' }) => void) | null)?.({ state: nextNetwork });
            if (nextNetwork === 'online'
              && useTrackingStore.getState().remoteSessionId === null) {
              await settleUntil(
                () => useTrackingStore.getState().remoteSessionId === timeline.serverActivityId,
                80,
                `${timeline.name}:reconnect-remote-map`,
              );
            }
          }
          if (index === 1) (mockAppStateListener as ((state: 'background') => void) | null)?.('background');
          if (index === 5) (mockAppStateListener as ((state: 'active') => void) | null)?.('active');
          const source = sources[index];
          const coordinate = {
            lat: -41.2865,
            lng: 174.7762 + index * 0.00012,
            accuracy: 5,
            speed: mode === 'running' ? 2.4 : 1.3,
            source,
            clientActivityId: timeline.clientActivityId,
            ownerGeneration: useTrackingStore.getState().liveOwnerGeneration ?? undefined,
          };
          if (source === 'background') {
            const state = useTrackingStore.getState();
            const segmentId = index >= 3
              ? `${timeline.clientActivityId}:reacquired`
              : state.currentSegmentId!;
            await appendHikePoint({
              t: mockWallTimeMs,
              lat: coordinate.lat,
              lng: coordinate.lng,
              acc: coordinate.accuracy,
              speed: coordinate.speed,
              src: 'bg',
              clientActivityId: timeline.clientActivityId,
              ownerGeneration: state.liveOwnerGeneration!,
              segmentId,
              ...(index === 3 ? { segmentStartReason: 'gps-reacquired' as const } : {}),
            });
          }
          const decision = await useTrackingStore.getState().addTrackPoint({
            ...coordinate,
            ...(source === 'background' ? {
              continuityPreclassified: true,
              canonicalDecision: 'ACCEPT' as const,
              decisionReason: 'background-task-accepted',
              committedBeforeFence: true,
              segmentId: index >= 3
                ? `${timeline.clientActivityId}:reacquired`
                : useTrackingStore.getState().currentSegmentId ?? undefined,
              ...(index === 3 ? { segmentStartReason: 'gps-reacquired' as const } : {}),
            } : {}),
          }, mockWallTimeMs);
          decisions.push({ accepted: decision.accepted, reason: decision.reason });
        }
        await settleUntil(
          () => useTrackingStore.getState().remoteSessionId === timeline.serverActivityId,
          80,
          `${timeline.name}:pre-finish-remote-map`,
        );
        const beforeFinish = useTrackingStore.getState();
        const raw = beforeFinish.trackPointsRaw.map(point => ({
          t: (point.t ?? base) - base,
          lat: point.lat,
          lng: point.lng,
          rawOrdinal: point.rawOrdinal,
          source: (point as typeof point & { source?: string }).source,
        }));
        const segmentOrdinals = new Map<string, number>();
        const canonical = beforeFinish.trackPoints.map(point => {
          const key = point.segmentId ?? 'missing';
          if (!segmentOrdinals.has(key)) segmentOrdinals.set(key, segmentOrdinals.size);
          return {
            t: (point.t ?? base) - base,
            lat: point.lat,
            lng: point.lng,
            segmentOrdinal: segmentOrdinals.get(key),
            segmentStartReason: point.segmentStartReason ?? null,
          };
        });
        expect(new Set(canonical.map(point => point.segmentOrdinal)).size).toBe(2);
        expect(canonical.filter(point => point.segmentStartReason === 'gps-reacquired'))
          .toHaveLength(1);
        mockWallTimeMs = base + 366_000;
        const finished = await useTrackingStore.getState().stopTracking(`Parity ${mode}`);
        if (!finished || finished.status !== 'saved-local') {
          throw new Error(`unexpected_parity_finish:${JSON.stringify(finished)}`);
        }
        expect(finished.finalGeometryFingerprint).toBe(
          activityGeometryFingerprint(finished.trackPoints),
        );
        const finalSegmentOrdinals = new Map<string, number>();
        const selectedFinal = finished.trackPoints.map(point => {
          const key = point.segmentId ?? 'missing';
          if (!finalSegmentOrdinals.has(key)) {
            finalSegmentOrdinals.set(key, finalSegmentOrdinals.size);
          }
          return {
            lat: point.lat,
            lng: point.lng,
            segmentId: `segment-${finalSegmentOrdinals.get(key)}`,
          };
        });
        if (finished.syncState === 'pending') {
          mockNetworkState = 'online';
          (mockNetworkListener as ((state: { state: 'online' }) => void) | null)?.({ state: 'online' });
          // Finish also schedules a best-effort drain. Observe that real
          // single-flight before issuing the explicit recovery wakeup.
          for (let turn = 0; turn < 20 && (await listPending()).length > 0; turn += 1) {
            await new Promise(resolve => setTimeout(resolve, 0));
            const drain = await drainPending({ wakeReason: 'manual', force: true });
            expect(drain.failed).toBe(0);
          }
        }
        expect(await listPending()).toEqual([]);
        expect(useSessionStore.getState().sessions.filter(
          session => (session.clientActivityId ?? session.id) === timeline.clientActivityId,
        )).toHaveLength(1);
        return {
          raw,
          decisions,
          canonical,
          distanceM: finished.distanceM,
          durationS: finished.durationS,
          finalGeometryState: finished.finalGeometryState,
          finalGeometryRevision: finished.finalGeometryRevision,
          selectedFinal,
          normalizedFinalGeometryFingerprint: activityGeometryFingerprint(selectedFinal),
          startAttempts,
          saveAttempts,
        };
      };

      const onlineOfflineOnline = await run({
        name: 'online-offline-online',
        clientActivityId: mode === 'hiking'
          ? '10000000-0000-4000-8000-000000000301'
          : '10000000-0000-4000-8000-000000000302',
        serverActivityId: mode === 'hiking' ? 801 : 802,
        connectivity: ['online', 'online', 'offline', 'offline', 'online', 'online', 'online'],
      });
      const offlineOnlineOffline = await run({
        name: 'offline-online-offline',
        clientActivityId: mode === 'hiking'
          ? '10000000-0000-4000-8000-000000000401'
          : '10000000-0000-4000-8000-000000000402',
        serverActivityId: mode === 'hiking' ? 901 : 902,
        connectivity: ['offline', 'offline', 'offline', 'online', 'online', 'offline', 'offline'],
      });

      expect({
        raw: offlineOnlineOffline.raw,
        decisions: offlineOnlineOffline.decisions,
        canonical: offlineOnlineOffline.canonical,
        distanceM: offlineOnlineOffline.distanceM,
        durationS: offlineOnlineOffline.durationS,
        finalGeometryState: offlineOnlineOffline.finalGeometryState,
        finalGeometryRevision: offlineOnlineOffline.finalGeometryRevision,
        selectedFinal: offlineOnlineOffline.selectedFinal,
        normalizedFinalGeometryFingerprint: offlineOnlineOffline.normalizedFinalGeometryFingerprint,
      }).toEqual({
        raw: onlineOfflineOnline.raw,
        decisions: onlineOfflineOnline.decisions,
        canonical: onlineOfflineOnline.canonical,
        distanceM: onlineOfflineOnline.distanceM,
        durationS: onlineOfflineOnline.durationS,
        finalGeometryState: onlineOfflineOnline.finalGeometryState,
        finalGeometryRevision: onlineOfflineOnline.finalGeometryRevision,
        selectedFinal: onlineOfflineOnline.selectedFinal,
        normalizedFinalGeometryFingerprint: onlineOfflineOnline.normalizedFinalGeometryFingerprint,
      });
      expect(onlineOfflineOnline.startAttempts).toBe(1);
      expect(offlineOnlineOffline.startAttempts).toBe(2);
      expect(onlineOfflineOnline.saveAttempts).toBe(1);
      expect(offlineOnlineOffline.saveAttempts).toBeGreaterThanOrEqual(1);
    });
  },
);

describe('production-path foreground resume recovery', () => {
  jest.setTimeout(30_000);

  beforeEach(() => {
    mockAsyncValues.clear();
    mockStorageValues.clear();
    mockWebValues.clear();
    mockAuthenticatedFetch.mockReset();
    mockCurrentUserId = 'owner-a';
    mockNetworkState = 'offline';
    mockNetworkListener = null;
    mockAppStateListener = null;
    mockAppStateCurrent = 'active';
    mockNativeBackgroundStarted = false;
    mockDurableActivityContext = null;
    mockBackgroundLocations = [];
    mockWallTimeMs = 1_802_000_000_000;
    mockDateNowSpy?.mockRestore();
    mockDateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => mockWallTimeMs);
    __activityRemoteStartCoordinatorTest.reset();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
    useTrackingStore.setState(useTrackingStore.getInitialState(), true);
    useSessionStore.setState({ sessions: [], currentUserId: 'owner-a' });
  });

  afterEach(async () => {
    const state = useTrackingStore.getState();
    if (state.status !== 'idle' && state.sessionId) await state.discardCurrentSession();
    mockDateNowSpy?.mockRestore();
    mockDateNowSpy = null;
  });

  const arrivals = FIELD_RESUME_CASES.flatMap((fieldCase, caseIndex) => ([
    { ...fieldCase, caseIndex, arrival: 'before-playback' as const },
    { ...fieldCase, caseIndex, arrival: 'after-playback' as const },
  ]));

  test.each(arrivals)(
    '$name uses the committed predecessor when the first fix arrives $arrival',
    async (fieldCase) => {
      const clientActivityId = `90000000-0000-4000-8000-${String(
        fieldCase.caseIndex * 2 + (fieldCase.arrival === 'before-playback' ? 1 : 2),
      ).padStart(12, '0')}`;
      useTrackingStore.getState().setActivityMode(fieldCase.mode);
      await expect(useTrackingStore.getState().startTracking(clientActivityId)).resolves.toBe(true);
      const started = useTrackingStore.getState();
      const ownerGeneration = started.liveOwnerGeneration!;
      const newTime = mockWallTimeMs + fieldCase.staleGapMs + 60_000;
      const fixture = fieldResumePoints(fieldCase, newTime);
      const stale = { ...fixture.stale, segmentStartReason: 'start' as const };

      await appendHikePoint({
        t: stale.t, lat: stale.lat, lng: stale.lng, acc: stale.accuracy,
        alt: stale.alt, vAcc: stale.verticalAccuracy, speed: stale.speed,
        rawOrdinal: stale.rawOrdinal, src: 'bg', clientActivityId,
        ownerGeneration, segmentId: fixture.segmentId, segmentStartReason: 'start',
      });
      await appendHikePoint({
        t: fixture.predecessor.t,
        lat: fixture.predecessor.lat,
        lng: fixture.predecessor.lng,
        acc: fixture.predecessor.accuracy,
        alt: fixture.predecessor.alt,
        vAcc: fixture.predecessor.verticalAccuracy,
        speed: fixture.predecessor.speed,
        rawOrdinal: fixture.predecessor.rawOrdinal,
        src: 'bg', clientActivityId, ownerGeneration, segmentId: fixture.segmentId,
      });
      useTrackingStore.setState({
        trackPoints: [stale],
        trackPointsSmoothed: [stale],
        trackPointsRaw: [stale],
        distanceAccumulator: buildActivityDistanceAccumulator([stale]),
        distanceM: 0,
        lastCoordinate: stale,
        lastCoordinateTime: stale.t,
        lastFixTimestamp: stale.t,
        currentSegmentId: fixture.segmentId,
        latestSourceLocationTime: null,
        latestSourceKind: null,
      });
      mockDurableActivityContext = {
        clientActivityId,
        userId: 'owner-a',
        ownerGeneration,
        segmentId: fixture.segmentId,
        activityMode: fieldCase.mode,
        acceptAfterMs: started.liveOwnerAcceptAfterMs,
        continuityState: null,
        rawOrdinal: 2,
        backgroundPermissionState: 'granted',
        latestSourceReceipt: {
          observationTimeMs: fixture.predecessor.t,
          receiptWallTimeMs: newTime - 250,
          source: 'background',
        },
      };

      const writer = require('../../../services/hikeTrackWriter');
      const originalRead = writer.readActiveHikeTail.bind(writer);
      let releasePlayback: () => void = () => undefined;
      const playbackGate = new Promise<void>(resolve => { releasePlayback = resolve; });
      let fullPlaybackStarted = false;
      const tailSpy = jest.spyOn(writer, 'readActiveHikeTail').mockImplementation(
        async (...args: unknown[]) => {
          const [sessionId, limit] = args as [string, number?];
          const result = await originalRead(sessionId, limit);
          if (limit == null) {
            fullPlaybackStarted = true;
            await playbackGate;
          }
          return result;
        },
      );

      try {
      mockWallTimeMs = newTime;
      const location = require('expo-location');
      location.startLocationUpdatesAsync.mockClear();
      mockAppStateCurrent = 'background';
      mockAppStateListener?.('background');
      await settleUntil(
        () => location.startLocationUpdatesAsync.mock.calls.length > 0,
        160,
        `${fieldCase.name}:background-owner`,
      );
      mockAppStateCurrent = 'active';
      mockAppStateListener?.('active');
      await settleUntil(() => fullPlaybackStarted, 160, `${fieldCase.name}:playback-start`);

      const recovering = useTrackingStore.getState();
      expect(recovering.trackPoints).toHaveLength(1);
      expect(recovering.latestSourceLocationTime).toBe(fixture.predecessor.t);
      expect(recovering.latestSourceKind).toBe('background');
      expect(deriveActivityLocationHealth({
        nowMs: newTime,
        sourceActive: true,
        latestSourceTimestamp: recovering.latestSourceLocationTime,
        latestCanonicalTimestamp: recovering.lastCoordinateTime,
        latestSourceKind: recovering.latestSourceKind,
        foregroundRecoveryUntilMs: recovering.foregroundRecoveryUntilMs,
        pendingCandidate: false,
        latestCanonicalDecisionReason: null,
        continuityGapOpen: false,
      })).toMatchObject({ sourceHealth: 'fresh', userFacingIssue: 'none' });

      const duplicate = await useTrackingStore.getState().addTrackPoint({
        ...fixture.predecessor,
        source: 'foreground',
        clientActivityId,
        ownerGeneration,
        segmentId: fixture.segmentId,
        receiptWallTimeMs: newTime,
      }, fixture.predecessor.t);
      expect(duplicate).toMatchObject({ accepted: false, reason: 'non-monotonic-durable-frontier' });
      expect(useTrackingStore.getState().latestSourceLocationTime).toBe(fixture.predecessor.t);

      if (fieldCase.arrival === 'after-playback') {
        releasePlayback();
        await settleUntil(
          () => useTrackingStore.getState().trackPoints.some(point => point.rawOrdinal === 2),
          160,
          `${fieldCase.name}:playback-published`,
        );
      }
      const decision = await useTrackingStore.getState().addTrackPoint({
        ...fixture.next,
        source: 'foreground',
        clientActivityId,
        ownerGeneration,
        segmentId: fixture.segmentId,
        receiptWallTimeMs: newTime + 50,
      }, fixture.next.t);
      expect(decision).toMatchObject({ accepted: true, segmentId: fixture.segmentId });
      expect(decision.reason).not.toBe('accepted-new-segment');

      releasePlayback();
      await settleUntil(
        () => [1, 2, 3].every(rawOrdinal => (
          useTrackingStore.getState().trackPoints.some(point => point.rawOrdinal === rawOrdinal)
        )),
        160,
        `${fieldCase.name}:foreground-published`,
      );
      const final = useTrackingStore.getState();
      expect(final.trackPoints.map(point => point.rawOrdinal)).toEqual([1, 2, 3]);
      expect(new Set(final.trackPoints.map(point => point.segmentId))).toEqual(new Set([fixture.segmentId]));
      expect(final.trackPoints.filter(point => point.segmentStartReason === 'gps-reacquired')).toEqual([]);
      expect(final.trackPointsSmoothed.at(-1)).toMatchObject({ rawOrdinal: 3, segmentId: fixture.segmentId });
      } finally {
        releasePlayback();
        tailSpy.mockRestore();
      }
    },
  );
});

describe('production-path remote Start conflict fencing', () => {
  beforeEach(() => {
    mockAsyncValues.clear();
    mockStorageValues.clear();
    mockWebValues.clear();
    mockAuthenticatedFetch.mockReset();
    mockCurrentUserId = 'owner-a';
    mockNetworkState = 'online';
    __activityRemoteStartCoordinatorTest.reset();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
    useTrackingStore.setState(useTrackingStore.getInitialState(), true);
    useSessionStore.setState({ sessions: [], currentUserId: 'owner-a' });
  });

  afterEach(async () => {
    mockCurrentUserId = 'owner-a';
    const state = useTrackingStore.getState();
    if (state.status !== 'idle' && state.sessionId) await state.discardCurrentSession();
  });

  test('unrelated 409 survives A→B and never replaces A local truth', async () => {
    const clientActivityId = '10000000-0000-4000-8000-000000000201';
    const request = deferredResponse();
    mockAuthenticatedFetch.mockImplementation(async (path: string) => (
      path === '/api/sessions/start' ? request.promise : jsonResponse(404, {})
    ));
    await useTrackingStore.getState().startTracking(clientActivityId);
    mockCurrentUserId = 'owner-b';
    request.resolve(jsonResponse(409, {
      code: 'UNFINISHED_ACTIVITY_EXISTS',
      existing_activity: {
        id: 88,
        client_activity_id: '20000000-0000-4000-8000-000000000201',
        type: 'running',
        start_time: new Date(Date.now() - 60_000).toISOString(),
        point_count: 12,
        raw_point_count: 15,
      },
      existing_activities: [],
    }));
    await settleUntil(() => mockAsyncValues.has('@cairn:activity_remote_start_conflicts:v1:owner-a'));
    expect(await getActivityRemoteStartConflict('owner-a', clientActivityId)).toMatchObject({
      state: 'owner-action-required',
      conflictingActivities: [{ serverActivityId: 88 }],
    });
    expect(await getActivityRemoteStartConflict('owner-b', clientActivityId)).toBeNull();
    expect((await getActivityRegistry('owner-a')).unfinished?.clientActivityId).toBe(clientActivityId);
    expect(useTrackingStore.getState().remoteSessionId).toBeNull();
  });
});
