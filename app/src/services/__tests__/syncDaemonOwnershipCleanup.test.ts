let mockCurrentUserId = 'account-a';
let mockPendingRows: any[] = [];
let mockRegistry: any = { unfinished: null, completed: [], tombstones: [] };
let mockRemoveFailureCount = 0;
const mockOrder: string[] = [];
const mockFailures: any[] = [];
const mockSavedPending: any[] = [];
const mockAddedSessions: any[] = [];
let mockArtifact: any = null;
let mockTombstoned = false;
let mockOnline = false;
const mockPersistRemoteConflict = jest.fn(async (_input?: unknown) => ({
  conflictingActivities: [{ serverActivityId: 88 }],
}));
const mockClearRemoteConflict = jest.fn(async (_ownerUserId?: string, _clientActivityId?: string) => undefined);

jest.mock('../pendingSyncStore', () => ({
  ensurePendingUploadReady: jest.fn(async () => true),
  isPendingPreparationActive: jest.fn(() => false),
  listPending: jest.fn(async () => [...mockPendingRows]),
  savePending: jest.fn(async (hike: any) => { mockSavedPending.push(hike); }),
  markPendingPreparationPhase: jest.fn(async () => undefined),
  markPendingUploadReady: jest.fn(async () => undefined),
  removePending: jest.fn(async (localId: string) => {
    mockOrder.push('pending-delete');
    if (mockRemoveFailureCount > 0) {
      mockRemoveFailureCount -= 1;
      throw new Error('injected-cleanup-delete-failure');
    }
    mockPendingRows = mockPendingRows.filter(row => row.localId !== localId);
  }),
  markAttempt: jest.fn(async (localId: string, failure: any = {}) => {
    mockFailures.push(failure);
    mockPendingRows = mockPendingRows.map(row => row.localId === localId ? {
      ...row,
      attemptCount: (row.attemptCount ?? 0) + 1,
      lastAttemptAt: Date.now(),
      failureKind: failure.kind ?? 'retryable',
      failureStatus: failure.status ?? null,
      failureCode: failure.code ?? null,
    } : row);
  }),
  updateRemoteId: jest.fn(async () => undefined),
  resetForResync: jest.fn(async () => true),
}));
jest.mock('../sessionService', () => ({
  deleteRemoteSession: jest.fn(async () => true),
  deleteRemoteSessionByClientId: jest.fn(async () => true),
  saveHikeAtomic: jest.fn(async (remoteId: number) => ({ session_id: remoteId })),
  startSessionResolved: jest.fn(async () => ({ kind: 'unavailable' })),
}));
jest.mock('../apiService', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('../markerTombstones', () => ({ listMarkerTombstones: jest.fn(async () => []) }));
jest.mock('../crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../networkMonitor', () => ({
  __esModule: true,
  default: {
    isOnline: jest.fn(() => mockOnline),
    getState: jest.fn(() => ({ state: mockOnline ? 'online' : 'offline' })),
    onChange: jest.fn(() => () => undefined),
    start: jest.fn(async () => undefined),
  },
  networkMonitor: {
    isOnline: jest.fn(() => mockOnline),
    getState: jest.fn(() => ({ state: mockOnline ? 'online' : 'offline' })),
    onChange: jest.fn(() => () => undefined),
    start: jest.fn(async () => undefined),
  },
}));
jest.mock('../../features/activity/activityRegistry', () => ({
  acknowledgeActivity: jest.fn(async () => { mockOrder.push('registry-ack'); return true; }),
  completeActivity: jest.fn(async () => true),
  getActivityRegistry: jest.fn(async () => mockRegistry),
  isActivityTombstoned: jest.fn(async () => mockTombstoned),
  mapActivityServerId: jest.fn(async () => 'completed'),
  removeAcknowledgedActivity: jest.fn(async () => { mockOrder.push('registry-remove'); }),
  updateCompletedActivitySyncState: jest.fn(async () => undefined),
}));
jest.mock('../../features/activity/activityRemoteConflictStore', () => ({
  persistActivityRemoteStartConflict: (input: unknown) => mockPersistRemoteConflict(input),
  clearActivityRemoteStartConflict: (ownerUserId: string, clientActivityId: string) => (
    mockClearRemoteConflict(ownerUserId, clientActivityId)
  ),
}));
jest.mock('../../features/activity/activityFinalArtifact', () => ({
  loadActivityFinalArtifact: jest.fn(async () => mockArtifact),
  activityGeometryFingerprint: jest.fn((points: any[]) => JSON.stringify(
    points.map(point => [point.lat, point.lng, point.segmentId ?? '']),
  )),
}));
jest.mock('../../features/activity/activityMemoryProjector', () => ({
  reconcileActivityMemoryProjection: jest.fn(async () => true),
  retireActivityMemoryProjection: jest.fn(async () => { mockOrder.push('projection-retire'); return true; }),
}));
jest.mock('../../features/activitySimulator/simulatorLog', () => ({
  appendSimulatorLog: jest.fn(),
}));
jest.mock('../hikeTrackWriter', () => ({
  deleteAcknowledgedHikeTrackArtifacts: jest.fn(async () => { mockOrder.push('heavy-trace-delete'); }),
}));
jest.mock('../../store/useSessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      currentUserId: mockCurrentUserId,
      sessions: [],
      addSession: jest.fn(async (session: any) => { mockAddedSessions.push(session); }),
      markSyncState: jest.fn(async () => undefined),
      markSynced: jest.fn(async () => { mockOrder.push('summary-ack'); return true; }),
    }),
  },
}));

import {
  classifyPendingSyncFailure,
  cleanupAcknowledgedActivityArtifacts,
  drainPending,
  recoverPreparingActivityCompletion,
} from '../syncDaemon';
const { saveHikeAtomic: mockSaveHikeAtomic } = require('../sessionService');
const { startSessionResolved: mockStartSessionResolved } = require('../sessionService');
const { resetForResync: mockResetForResync } = require('../pendingSyncStore');
const { acknowledgeActivity: mockAcknowledgeActivity } = require('../../features/activity/activityRegistry');
const { deleteRemoteSessionByClientId: mockDeleteRemoteSessionByClientId } = require('../sessionService');
const { reconcileActivityMemoryProjection: mockReconcileActivityMemoryProjection } = require('../../features/activity/activityMemoryProjector');
const { retireActivityMemoryProjection: mockRetireActivityMemoryProjection } = require('../../features/activity/activityMemoryProjector');

const pending = {
  contractVersion: 3,
  localId: 'activity-a',
  userId: 'account-a',
  remoteId: 77,
  idempotencyKey: '99999999-9999-4999-8999-999999999999',
  activityMode: 'hiking',
  startedAt: 1_000,
  payload: {
    end_time: new Date(5_000).toISOString(),
    distance_m: 100,
    duration_s: 4,
    name: 'Pending',
    route_points: [{ lat: -41, lng: 174, t: 1_000 }, { lat: -41.001, lng: 174.001, t: 5_000 }],
    route_points_raw: [],
    memory_points: [],
  },
  createdAt: 5_000,
  lastAttemptAt: null,
  attemptCount: 0,
};

describe('Activity ACK ownership and cleanup phases', () => {
  beforeEach(() => {
    mockCurrentUserId = 'account-a';
    mockPendingRows = [{ ...pending }];
    mockRegistry = { unfinished: null, completed: [], tombstones: [] };
    mockRemoveFailureCount = 0;
    mockOrder.length = 0;
    mockFailures.length = 0;
    mockSavedPending.length = 0;
    mockAddedSessions.length = 0;
    mockArtifact = null;
    mockTombstoned = false;
    mockOnline = false;
    mockPersistRemoteConflict.mockClear();
    mockClearRemoteConflict.mockClear();
    jest.clearAllMocks();
    mockStartSessionResolved.mockResolvedValue({ kind: 'unavailable' });
    mockResetForResync.mockResolvedValue(true);
    mockReconcileActivityMemoryProjection.mockResolvedValue(true);
    mockRetireActivityMemoryProjection.mockImplementation(async () => {
      mockOrder.push('projection-retire');
      return true;
    });
  });

  test('a committed frozen Base upload is released without depending on a missing or newer local artifact', async () => {
    const preparing: any = {
      ...pending,
      uploadState: 'preparing',
      preparationPhase: 'registry_committed',
      summary: {
        startedAt: 1_000,
        endedAt: 5_000,
        distanceM: 100,
        durationS: 4,
        elevationGainM: 2,
        name: 'Pending',
        markerIds: [],
      },
      finalArtifact: {
        revision: 1,
        displayFingerprint: 'base-display',
        canonicalFingerprint: 'canonical-truth',
        source: 'base',
        algorithmVersion: 'pedestrian-final-v2-base',
      },
    };
    mockArtifact = {
      revision: 2,
      displayFingerprint: 'refined-display',
      canonicalFingerprint: 'canonical-truth',
      source: 'matched',
      algorithmVersion: 'pedestrian-final-v2-base',
      points: [
        {
          lat: -41, lng: 174, t: 1_000.8, alt: 88, accuracy: 6,
          verticalAccuracy: 9, speed: 1.2, course: 45, rawOrdinal: 3,
          segmentId: 'segment-a', segmentStartReason: 'start',
        },
        { lat: -41.002, lng: 174.002, t: 5_000, alt: 92, segmentId: 'segment-a' },
      ],
    };

    await expect(recoverPreparingActivityCompletion(preparing)).resolves.toBe(true);
    // The first request identity remains the exact Base snapshot. Optional
    // refinement has its own versioned server operation after the Base ACK.
    expect(mockSavedPending).toHaveLength(0);
    expect(mockAddedSessions).toHaveLength(0);
    expect(preparing.uploadState).toBe('ready');
    expect(preparing.finalArtifact.revision).toBe(1);
    expect(preparing.payload.route_points[0].lat).toBe(-41);
  });

  test('an O97 ready revision-2 outbox is normalized to the server initial revision contract', async () => {
    const legacyReady = {
      ...pending,
      uploadState: 'ready',
      preparationPhase: 'registry_committed',
      payload: {
        ...pending.payload,
        route_points: [
          { lat: -41, lng: 174, t: 1_000, segment_id: 'segment-a' },
          { lat: -41.001, lng: 174.001, t: 5_000, segment_id: 'segment-a' },
        ],
        route_points_canonical: [
          { lat: -41, lng: 174, t: 1_000, segment_id: 'segment-a' },
          { lat: -41.001, lng: 174.001, t: 5_000, segment_id: 'segment-a' },
        ],
      },
      finalArtifact: {
        revision: 2,
        displayFingerprint: 'legacy-refined-display',
        canonicalFingerprint: 'legacy-canonical',
        source: 'matched',
        algorithmVersion: 'pedestrian-final-v4-road-fillet',
      },
    };
    mockPendingRows = [legacyReady];

    await expect(drainPending({ wakeReason: 'hydrate', force: true })).resolves.toMatchObject({
      attempted: 1, succeeded: 1, failed: 0,
    });

    const uploaded = mockSaveHikeAtomic.mock.calls[0][1];
    expect(uploaded).toMatchObject({
      final_geometry_revision: 1,
      final_geometry_algorithm: 'pedestrian-final-v4-road-fillet',
    });
    expect(uploaded.final_geometry_fingerprint).not.toBe('legacy-refined-display');
    expect(uploaded.final_geometry_canonical_fingerprint).not.toBe('legacy-canonical');
  });

  test('a cleanup delete failure after durable ACK never causes a second upload', async () => {
    mockRegistry = {
      unfinished: null,
      completed: [{ clientActivityId: 'activity-a', serverActivityId: 77, syncState: 'synced' }],
      tombstones: [],
    };
    mockRemoveFailureCount = 1;
    const result = await drainPending();
    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    expect(mockSaveHikeAtomic).not.toHaveBeenCalled();
    expect(mockOrder).toEqual([
      'pending-delete',
      'pending-delete',
      'projection-retire',
      'heavy-trace-delete',
      'registry-remove',
    ]);
  });

  test('normal upload persists summary and registry ACK before cleanup', async () => {
    await expect(drainPending()).resolves.toMatchObject({ attempted: 1, succeeded: 1 });
    expect(mockSaveHikeAtomic).toHaveBeenCalledWith(
      77,
      pending.payload,
      pending.idempotencyKey,
      pending.localId,
      pending.userId,
    );
    expect(mockOrder).toEqual([
      'summary-ack',
      'registry-ack',
      'pending-delete',
      'projection-retire',
      'heavy-trace-delete',
      'registry-remove',
    ]);
  });

  test('two consecutive first-sync Activities upload once with independent identities', async () => {
    const second = {
      ...pending,
      localId: 'activity-b',
      remoteId: 78,
      idempotencyKey: '88888888-8888-4888-8888-888888888888',
      startedAt: 6_000,
      createdAt: 10_000,
      payload: {
        ...pending.payload,
        end_time: new Date(10_000).toISOString(),
        route_points: [
          { lat: -42, lng: 173, t: 6_000 },
          { lat: -42.001, lng: 173.001, t: 10_000 },
        ],
      },
    };
    mockPendingRows = [{ ...pending }, second];

    await expect(drainPending({ wakeReason: 'manual', force: true })).resolves.toMatchObject({
      attempted: 2, succeeded: 2, failed: 0,
    });
    expect(mockSaveHikeAtomic.mock.calls.map((call: any[]) => ({
      remoteId: call[0], idempotencyKey: call[2], localId: call[3], userId: call[4],
    }))).toEqual([
      {
        remoteId: 77,
        idempotencyKey: pending.idempotencyKey,
        localId: 'activity-a',
        userId: 'account-a',
      },
      {
        remoteId: 78,
        idempotencyKey: second.idempotencyKey,
        localId: 'activity-b',
        userId: 'account-a',
      },
    ]);
    expect(mockPendingRows).toEqual([]);
    await expect(drainPending({ wakeReason: 'foreground' })).resolves.toMatchObject({
      attempted: 0, succeeded: 0,
    });
    expect(mockSaveHikeAtomic).toHaveBeenCalledTimes(2);
  });

  test('acknowledged cleanup retains the Activity WAL when projection completion cannot be proved', async () => {
    mockRegistry = {
      unfinished: null,
      completed: [{
        clientActivityId: 'activity-a', serverActivityId: 77,
        syncState: 'synced', locationProviderSource: 'real',
      }],
      tombstones: [],
    };
    mockReconcileActivityMemoryProjection.mockResolvedValueOnce(false);
    await expect(cleanupAcknowledgedActivityArtifacts('account-a', 'activity-a')).resolves.toBe(false);
    expect(mockOrder).toEqual(['pending-delete']);
  });

  test('acknowledged cleanup retains WAL and registry when terminal retirement is not durable', async () => {
    mockRegistry = {
      unfinished: null,
      completed: [{
        clientActivityId: 'activity-a', serverActivityId: 77,
        syncState: 'synced', locationProviderSource: 'real',
      }],
      tombstones: [],
    };
    mockRetireActivityMemoryProjection.mockImplementationOnce(async () => {
      mockOrder.push('projection-retire');
      return false;
    });
    await expect(cleanupAcknowledgedActivityArtifacts('account-a', 'activity-a')).resolves.toBe(false);
    expect(mockOrder).toEqual(['pending-delete', 'projection-retire']);
  });

  test('accelerated historical epochs replay unchanged through normal sync and reconciliation', async () => {
    const startedAt = 1_700_000_000_000;
    const endedAt = startedAt + 600_000;
    const accelerated = {
      ...pending,
      startedAt,
      payload: {
        ...pending.payload,
        end_time: new Date(endedAt).toISOString(),
        distance_m: 833.33,
        duration_s: 600,
        route_points: [
          { lat: -45.0312, lng: 168.6626, t: startedAt, segment_id: 'sim-segment' },
          { lat: -45.0237, lng: 168.6626, t: endedAt, segment_id: 'sim-segment' },
        ],
        memory_points: [
          { lat: -45.0312, lng: 168.6626, ts: startedAt, cid: '11111111-1111-4111-8111-111111111111' },
        ],
      },
      summary: {
        startedAt,
        endedAt,
        distanceM: 833.33,
        durationS: 600,
        elevationGainM: 0,
        name: 'Accelerated QA',
        markerIds: ['qa-cairn'],
      },
    };
    mockPendingRows = [accelerated];
    mockRegistry = {
      unfinished: null,
      completed: [{
        clientActivityId: accelerated.localId,
        serverActivityId: 77,
        syncState: 'pending',
        locationProviderSource: 'simulator',
      }],
      tombstones: [],
    };

    await expect(drainPending()).resolves.toMatchObject({ attempted: 1, succeeded: 1 });
    expect(mockSaveHikeAtomic).toHaveBeenCalledWith(
      77,
      accelerated.payload,
      accelerated.idempotencyKey,
      accelerated.localId,
      accelerated.userId,
    );
    expect(accelerated.payload.route_points.map(point => point.t)).toEqual([startedAt, endedAt]);
    expect(Date.parse(accelerated.payload.end_time)).toBe(endedAt);
  });

  test('A response arriving after B login cannot acknowledge or clean A locally', async () => {
    let resolveNetwork!: (value: { session_id: number }) => void;
    mockSaveHikeAtomic.mockImplementationOnce(() => new Promise(resolve => { resolveNetwork = resolve; }));
    const draining = drainPending();
    await new Promise(resolve => setTimeout(resolve, 0));
    mockCurrentUserId = 'account-b';
    resolveNetwork({ session_id: 77 });
    await expect(draining).resolves.toMatchObject({ skipped: 1, succeeded: 0 });
    expect(mockAcknowledgeActivity).not.toHaveBeenCalled();
    expect(mockPendingRows).toHaveLength(1);
    expect(mockOrder).toEqual([]);
  });

  test('a delete committed while the save ACK is held cannot revive the Activity', async () => {
    let resolveNetwork!: (value: { session_id: number; client_activity_id: string }) => void;
    mockSaveHikeAtomic.mockImplementationOnce(() => new Promise(resolve => { resolveNetwork = resolve; }));
    const draining = drainPending();
    await new Promise(resolve => setTimeout(resolve, 0));
    mockTombstoned = true;
    resolveNetwork({ session_id: 77, client_activity_id: pending.localId });

    await expect(draining).resolves.toMatchObject({ skipped: 1, succeeded: 0, failed: 0 });
    expect(mockDeleteRemoteSessionByClientId).toHaveBeenCalledWith(pending.localId);
    expect(mockPendingRows).toHaveLength(0);
    expect(mockOrder).toEqual(['pending-delete']);
    expect(mockAcknowledgeActivity).not.toHaveBeenCalled();
  });

  test.each([
    [{ status: 0 }, 'retryable'],
    [{ status: 408 }, 'retryable'],
    [{ status: 425 }, 'retryable'],
    [{ status: 429 }, 'retryable'],
    [{ status: 503 }, 'retryable'],
    [{ status: 401 }, 'auth_required'],
    [{ status: 409, body: { code: 'ACTIVITY_IDENTITY_MISMATCH' } }, 'action_required'],
    [{ status: 400 }, 'action_required'],
    [{ status: 403 }, 'action_required'],
    [{ status: 422 }, 'action_required'],
    [{ malformed: true }, 'action_required'],
  ])('classifies durable replay failure %p as %s', (error, expected) => {
    expect(classifyPendingSyncFailure(error).kind).toBe(expected);
  });

  test('a validation failure remains durable and is not timer/reconnect retried', async () => {
    mockSaveHikeAtomic.mockRejectedValueOnce(Object.assign(new Error('bad point'), {
      status: 422,
      body: { code: 'INVALID_POINT' },
    }));
    await expect(drainPending()).resolves.toMatchObject({ attempted: 1, failed: 1 });
    expect(mockFailures).toContainEqual(expect.objectContaining({
      kind: 'action_required',
      status: 422,
      code: 'INVALID_POINT',
    }));
    expect(mockPendingRows).toHaveLength(1);
    mockSaveHikeAtomic.mockClear();
    await expect(drainPending({ wakeReason: 'network_online' })).resolves.toMatchObject({
      attempted: 0,
      skipped: 1,
    });
    expect(mockSaveHikeAtomic).not.toHaveBeenCalled();
  });

  test('a due road deadline cannot busy-wake a ready upload during upload backoff', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
    try {
      mockOnline = true;
      mockPendingRows = [{
        ...pending,
        uploadState: 'ready',
        failureKind: 'retryable',
        lastAttemptAt: Date.now(),
        attemptCount: 4,
        roadRefinementState: 'pending-retry',
        roadRefinementNextRetryAt: Date.now() - 10_000,
      }];
      const listPending = require('../pendingSyncStore').listPending as jest.Mock;
      await expect(drainPending()).resolves.toMatchObject({ attempted: 0, skipped: 1 });
      const readsAfterDrain = listPending.mock.calls.length;
      await jest.advanceTimersByTimeAsync(250);
      expect(listPending).toHaveBeenCalledTimes(readsAfterDrain);
      expect(mockSaveHikeAtomic).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(40_000);
      expect(mockSaveHikeAtomic).toHaveBeenCalledTimes(1);
    } finally {
      mockOnline = false;
      jest.useRealTimers();
    }
  });

  test('an actual 429 Save failure persists one retry row, never 50ms-spins, then succeeds when due', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
    try {
      mockOnline = true;
      mockSaveHikeAtomic
        .mockRejectedValueOnce(Object.assign(new Error('rate limited'), {
          status: 429,
          body: { code: 'RATE_LIMITED' },
        }))
        .mockResolvedValueOnce({ session_id: 77, client_activity_id: pending.localId });
      const listPending = require('../pendingSyncStore').listPending as jest.Mock;
      await expect(drainPending({ wakeReason: 'manual', force: true })).resolves.toMatchObject({
        attempted: 1, failed: 1, succeeded: 0,
      });
      expect(mockPendingRows).toHaveLength(1);
      expect(mockPendingRows[0]).toMatchObject({
        failureKind: 'retryable', failureStatus: 429, failureCode: 'RATE_LIMITED',
        attemptCount: 1, lastAttemptAt: Date.now(),
      });
      expect(mockSaveHikeAtomic).toHaveBeenCalledTimes(1);
      const readsAfterFailure = listPending.mock.calls.length;

      await jest.advanceTimersByTimeAsync(250);
      expect(mockSaveHikeAtomic).toHaveBeenCalledTimes(1);
      expect(listPending.mock.calls.length - readsAfterFailure).toBeLessThanOrEqual(1);

      await jest.advanceTimersByTimeAsync(4_749);
      expect(mockSaveHikeAtomic).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(mockSaveHikeAtomic).toHaveBeenCalledTimes(2);
      expect(mockPendingRows).toHaveLength(0);
    } finally {
      mockOnline = false;
      jest.useRealTimers();
    }
  });

  test.each(['auth_required', 'action_required'] as const)(
    'a due ready-road deadline never auto-wakes a %s upload disposition',
    async failureKind => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
      try {
        mockOnline = true;
        mockPendingRows = [{
          ...pending,
          uploadState: 'ready',
          failureKind,
          failureStatus: failureKind === 'auth_required' ? 401 : 409,
          lastAttemptAt: Date.now(),
          attemptCount: 1,
          roadRefinementState: 'pending-retry',
          roadRefinementNextRetryAt: Date.now() - 10_000,
        }];
        const listPending = require('../pendingSyncStore').listPending as jest.Mock;
        await expect(drainPending({ wakeReason: 'network_online' })).resolves.toMatchObject({
          attempted: 0,
          skipped: 1,
        });
        const readsAfterDrain = listPending.mock.calls.length;
        await jest.advanceTimersByTimeAsync(60_000);
        expect(listPending).toHaveBeenCalledTimes(readsAfterDrain);
        expect(mockSaveHikeAtomic).not.toHaveBeenCalled();
      } finally {
        mockOnline = false;
        jest.useRealTimers();
      }
    },
  );

  test('an explicit owner retry may re-attempt an action-required row', async () => {
    mockPendingRows = [{ ...pending, failureKind: 'action_required', lastAttemptAt: Date.now(), attemptCount: 1 }];
    await expect(drainPending({ wakeReason: 'manual', force: true })).resolves.toMatchObject({
      attempted: 1,
      succeeded: 1,
    });
  });

  test('a dependency conflict receives a bounded scheduled liveness retry after the other Activity resolves', async () => {
    mockPendingRows = [{ ...pending, remoteId: null }];
    mockStartSessionResolved.mockResolvedValueOnce({
      kind: 'conflict',
      code: 'OTHER_ACTIVITY_UNFINISHED',
      existing: { clientActivityId: 'activity-other' },
      existingActivities: [],
    });
    await expect(drainPending({ wakeReason: 'manual', force: true })).resolves.toMatchObject({
      attempted: 1,
      failed: 1,
    });
    expect(mockPendingRows[0]).toMatchObject({ failureKind: 'dependency' });
    expect(mockPersistRemoteConflict).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'account-a',
      clientActivityId: 'activity-a',
      code: 'OTHER_ACTIVITY_UNFINISHED',
    }));

    mockPendingRows[0].lastAttemptAt = Date.now() - 60_000;
    mockStartSessionResolved.mockResolvedValueOnce({ kind: 'started', serverActivityId: 91 });
    await expect(drainPending({ wakeReason: 'scheduled_retry' })).resolves.toMatchObject({
      attempted: 1,
      succeeded: 1,
    });
    expect(mockSaveHikeAtomic).toHaveBeenCalledWith(
      91,
      expect.any(Object),
      pending.idempotencyKey,
      pending.localId,
      pending.userId,
    );
  });

  test('a lost Start ACK with the same client identity maps and completes one server Activity', async () => {
    mockPendingRows = [{ ...pending, remoteId: null }];
    mockStartSessionResolved.mockResolvedValueOnce({
      kind: 'conflict',
      code: 'UNFINISHED_ACTIVITY_EXISTS',
      existing: {
        id: 91,
        clientActivityId: pending.localId,
        type: pending.activityMode,
        startedAt: new Date(pending.startedAt).toISOString(),
        pointCount: 0,
        rawPointCount: 0,
      },
      existingActivities: [],
    });
    await expect(drainPending({ wakeReason: 'manual', force: true })).resolves.toMatchObject({
      attempted: 1,
      succeeded: 1,
    });
    expect(mockSaveHikeAtomic).toHaveBeenCalledWith(
      91,
      expect.any(Object),
      pending.idempotencyKey,
      pending.localId,
      pending.userId,
    );
    expect(mockPersistRemoteConflict).not.toHaveBeenCalled();
    expect(mockClearRemoteConflict).toHaveBeenCalledWith(pending.userId, pending.localId);
  });

  test('a structured 404 resets the dead server identity instead of becoming a permanent action error', async () => {
    mockSaveHikeAtomic.mockRejectedValueOnce(Object.assign(new Error('missing'), {
      status: 404,
      body: { code: 'SESSION_NOT_FOUND_RESYNC' },
    }));
    await expect(drainPending({ wakeReason: 'manual', force: true })).resolves.toMatchObject({
      attempted: 1,
      skipped: 1,
      failed: 0,
    });
    expect(mockResetForResync).toHaveBeenCalledWith(pending.localId);
    expect(mockFailures).toEqual([]);
  });
});
