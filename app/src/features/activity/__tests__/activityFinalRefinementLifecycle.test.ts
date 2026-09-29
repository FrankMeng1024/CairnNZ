const mockValues = new Map<string, string>();
const mockPendingFiles = new Map<string, string>();
const mockSessions: any[] = [];
let mockNetworkState: 'offline' | 'online' = 'offline';
let mockRegistry: any = { unfinished: null, completed: [], tombstones: [] };
const mockReconstruct = jest.fn();
const mockSaveHikeAtomic = jest.fn(async (..._args: any[]) => ({ session_id: 77, idempotent_replay: false }));

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    getItemStrict: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockValues.delete(key); }),
    getAllKeysStrict: jest.fn(async () => [...mockValues.keys()]),
    removeItemsStrict: jest.fn(async (keys: string[]) => keys.forEach(key => mockValues.delete(key))),
  },
}));
jest.mock('expo-file-system/legacy', () => {
  const api = {
    documentDirectory: 'doc://',
    getInfoAsync: jest.fn(async (path: string) => ({
      exists: path.endsWith('/') ? true : mockPendingFiles.has(path),
      isDirectory: path.endsWith('/'),
    })),
    makeDirectoryAsync: jest.fn(async () => undefined),
    writeAsStringAsync: jest.fn(async (path: string, value: string) => { mockPendingFiles.set(path, value); }),
    readAsStringAsync: jest.fn(async (path: string) => {
      const value = mockPendingFiles.get(path);
      if (value === undefined) throw new Error('missing');
      return value;
    }),
    readDirectoryAsync: jest.fn(async (path: string) => [...mockPendingFiles.keys()]
      .filter(key => key.startsWith(path))
      .map(key => key.slice(path.length))
      .filter(name => !name.includes('/'))),
    deleteAsync: jest.fn(async (path: string, options?: { idempotent?: boolean }) => {
      const existed = mockPendingFiles.delete(path);
      if (!existed && !options?.idempotent) throw new Error('missing');
    }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      const value = mockPendingFiles.get(from);
      if (value === undefined) throw new Error('missing');
      mockPendingFiles.set(to, value);
      mockPendingFiles.delete(from);
    }),
  };
  return { __esModule: true, ...api, default: api };
});
jest.mock('../../../config/mapbox', () => ({
  resolveMapboxPublicTokenAuthority: jest.fn(async () => ({
    token: 'synthetic-never-sent', source: 'runtime-config',
  })),
}));
jest.mock('../../../services/networkMonitor', () => ({
  __esModule: true,
  default: {
    getState: () => ({ state: mockNetworkState }),
    isOnline: () => mockNetworkState === 'online',
  },
  networkMonitor: {
    getState: () => ({ state: mockNetworkState }),
    isOnline: () => mockNetworkState === 'online',
  },
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: 'owner-a' } }) },
}));
jest.mock('../../../store/useSessionStore', () => ({
  useSessionStore: { getState: () => ({
    currentUserId: 'owner-a',
    sessions: mockSessions,
    addSession: async (session: any) => {
      const index = mockSessions.findIndex(item => item.id === session.id);
      if (index < 0) mockSessions.push(session); else mockSessions[index] = session;
    },
    markSyncState: async (id: string, syncState: string) => {
      const session = mockSessions.find(item => item.id === id || item.clientActivityId === id);
      if (session) session.syncState = syncState;
    },
    markSynced: async (id: string, remoteId: number) => {
      const session = mockSessions.find(item => item.id === id || item.clientActivityId === id);
      if (!session) return false;
      session.syncState = 'synced';
      session.remoteId = remoteId;
      return true;
    },
  }) },
}));
jest.mock('../../../services/routing/pedestrianFinalRoute', () => ({
  reconstructPedestrianFinalRoute: (...args: any[]) => mockReconstruct(...args),
}));
jest.mock('../../../services/routing/snapTrack', () => ({
  analyzeTrustedEndpointCoverage: () => ({ eligibleForAnchoring: true }),
  preserveTrustedRouteEndpoints: (_canonical: any, points: any) => points,
  evaluateMatchedGeometryQuality: () => ({ accepted: true }),
}));
jest.mock('../../../services/routing/activityRequestGovernor', () => ({
  createActivityMapboxRequestGovernor: () => ({ snapshot: async () => ({ timeoutInvocations: 0 }) }),
}));
jest.mock('../../../services/sessionService', () => ({
  deleteRemoteSession: jest.fn(async () => true),
  deleteRemoteSessionByClientId: jest.fn(async () => true),
  saveHikeAtomic: (...args: any[]) => mockSaveHikeAtomic(...args),
  startSessionResolved: jest.fn(async () => ({ kind: 'started', serverActivityId: 77 })),
}));
jest.mock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('../../../services/markerTombstones', () => ({ listMarkerTombstones: jest.fn(async () => []) }));
jest.mock('../../../services/crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../../activitySimulator/simulatorLog', () => ({ appendSimulatorLog: jest.fn() }));
jest.mock('../activityRegistry', () => ({
  getActivityRegistry: async () => mockRegistry,
  isActivityTombstoned: async () => false,
  completeActivity: async (activity: any) => {
    if (!mockRegistry.completed.some((item: any) => item.clientActivityId === activity.clientActivityId)) {
      mockRegistry.completed.push(activity);
    }
  },
  acknowledgeActivity: async (_owner: string, id: string, serverId: number) => {
    const item = mockRegistry.completed.find((entry: any) => entry.clientActivityId === id);
    if (item) { item.syncState = 'synced'; item.serverActivityId = serverId; }
    return true;
  },
  removeAcknowledgedActivity: async (_owner: string, id: string) => {
    mockRegistry.completed = mockRegistry.completed.filter((item: any) => item.clientActivityId !== id);
  },
  updateCompletedActivitySyncState: async () => undefined,
}));
jest.mock('../../../services/hikeTrackWriter', () => ({
  deleteAcknowledgedHikeTrackArtifacts: jest.fn(async () => undefined),
}));
jest.mock('../activityMemoryProjector', () => ({
  reconcileActivityMemoryProjection: jest.fn(async () => true),
  retireActivityMemoryProjection: jest.fn(async () => true),
}));
jest.mock('../../public/services/publicCairns', () => ({
  reconcilePublicActivityAfterServerAck: jest.fn(async () => undefined),
}));

function requestResult() {
  return {
    kind: 'map-matching', sourceStart: 0, sourceEnd: 2, inputPointCount: 3,
    sourceIndexMap: [0, 1, 2], durationMs: 20, result: 'ok', httpStatus: 200,
    responseCode: 'Ok', matchingCount: 1, tracepointCount: 3, nullTracepointCount: 0,
    acceptedCandidateCount: 1, rejectedCandidateCount: 0, profile: 'walking',
    matcherTidy: false, invoked: true, governorReason: null, responseBytes: 128,
  };
}

describe('production offline Final queue to sync-daemon lifecycle', () => {
  beforeEach(() => {
    mockValues.clear();
    mockPendingFiles.clear();
    mockSessions.length = 0;
    mockRegistry = { unfinished: null, completed: [], tombstones: [] };
    mockNetworkState = 'offline';
    mockReconstruct.mockReset();
    mockSaveHikeAtomic.mockClear();
  });

  test.each(['hiking', 'running'] as const)(
    '%s cold reconnect upgrades once before the original idempotency key uploads',
    async (activityMode) => {
    const activityId = `activity-${activityMode}`;
    const artifactApi = require('../activityFinalArtifact');
    const queue = require('../activityFinalRefinementQueue');
    const pendingStore = require('../../../services/pendingSyncStore');
    const points = [
      { lat: -41, lng: 174, t: 1_000, segmentId: 's', accuracy: 7 },
      { lat: -40.9999, lng: 174.0001, t: 2_000, segmentId: 's', accuracy: 7 },
      { lat: -40.9998, lng: 174.0002, t: 3_000, segmentId: 's', accuracy: 7 },
    ];
    const committed = await artifactApi.commitActivityFinalArtifact({
      ownerUserId: 'owner-a', clientActivityId: activityId,
      canonicalPoints: points, displayPoints: points, source: 'base',
    });
    await pendingStore.savePending({
      contractVersion: 3,
      uploadState: 'preparing',
      preparationPhase: 'registry_committed',
      localId: activityId, userId: 'owner-a', remoteId: 77,
      idempotencyKey: 'unchanged-operation-key', activityMode, startedAt: 1_000,
      payload: {
        end_time: new Date(3_000).toISOString(), distance_m: 30, duration_s: 2, name: 'Offline',
        route_points: points, route_points_raw: points, route_points_canonical: points,
        memory_points: [],
      },
      createdAt: 3_000, lastAttemptAt: null, attemptCount: 0,
      summary: {
        startedAt: 1_000, endedAt: 3_000, durationS: 2, distanceM: 30,
        elevationGainM: 0, markerIds: [], name: 'Offline',
      },
      finalArtifact: {
        revision: 1, displayFingerprint: committed.artifact.displayFingerprint,
        canonicalFingerprint: committed.artifact.canonicalFingerprint,
        source: 'base', algorithmVersion: 'pedestrian-final-v2-base',
      },
    });
    await queue.enqueueActivityFinalRefinement({
      ownerUserId: 'owner-a', clientActivityId: activityId, baseArtifact: committed.artifact,
    });

    const offlineDaemon = require('../../../services/syncDaemon');
    await expect(offlineDaemon.drainPending({ wakeReason: 'hydrate' })).resolves.toMatchObject({
      attempted: 1, skipped: 1, succeeded: 0,
    });
    expect(mockReconstruct).not.toHaveBeenCalled();
    expect(mockSaveHikeAtomic).not.toHaveBeenCalled();
    expect(await pendingStore.readPendingReadonly(activityId)).toMatchObject({
      uploadState: 'preparing', roadRefinementState: 'pending-network',
      idempotencyKey: 'unchanged-operation-key',
    });
    expect(mockSessions[0]).toMatchObject({
      finalGeometryState: 'base_ready', roadRefinementPending: true, syncState: 'pending',
    });

    // A module reload represents a cold process: only persisted storage,
    // outbox and session projections remain. The reconnect wake must resume
    // the real durable queue before upload.
    jest.resetModules();
    mockNetworkState = 'online';
    mockReconstruct.mockResolvedValue({
      ok: true,
      points: points.map((point, index) => index === 1 ? { ...point, lng: point.lng + 0.000004 } : point),
      stats: {
        requestResults: [requestResult()], acceptedMatchedDistanceM: 30,
        canonicalDerivedSectionCount: 0, displayRefined: true,
        wholeRouteValidation: { accepted: true },
      },
    });
    const onlineDaemon = require('../../../services/syncDaemon');
    await expect(onlineDaemon.drainPending({ wakeReason: 'network_online' })).resolves.toMatchObject({
      attempted: 1, succeeded: 1, failed: 0,
    });
    expect(mockReconstruct).toHaveBeenCalledTimes(1);
    expect(mockSaveHikeAtomic).toHaveBeenCalledTimes(1);
    const uploadCall = mockSaveHikeAtomic.mock.calls[0] as any[];
    expect(uploadCall[2]).toBe('unchanged-operation-key');
    expect(uploadCall[1].route_points).toEqual(
      expect.arrayContaining([expect.objectContaining({ lng: points[1].lng + 0.000004 })]),
    );
    expect(mockSessions[0]).toMatchObject({
      finalGeometryRevision: 2, roadRefinementPending: false, syncState: 'synced',
    });
    await expect(require('../../../services/pendingSyncStore').readPendingReadonly(activityId))
      .resolves.toBeNull();

    await onlineDaemon.drainPending({ wakeReason: 'foreground' });
    expect(mockReconstruct).toHaveBeenCalledTimes(1);
    expect(mockSaveHikeAtomic).toHaveBeenCalledTimes(1);
  });
});
