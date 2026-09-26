let mockCurrentUserId = 'account-a';
let mockPendingRows: any[] = [];
let mockRegistry: any = { unfinished: null, completed: [], tombstones: [] };
let mockRemoveFailureCount = 0;
const mockOrder: string[] = [];
const mockFailures: any[] = [];
const mockSavedPending: any[] = [];
const mockAddedSessions: any[] = [];
let mockArtifact: any = null;

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
jest.mock('../../features/activity/activityRegistry', () => ({
  acknowledgeActivity: jest.fn(async () => { mockOrder.push('registry-ack'); return true; }),
  completeActivity: jest.fn(async () => undefined),
  getActivityRegistry: jest.fn(async () => mockRegistry),
  isActivityTombstoned: jest.fn(async () => false),
  removeAcknowledgedActivity: jest.fn(async () => { mockOrder.push('registry-remove'); }),
  updateCompletedActivitySyncState: jest.fn(async () => undefined),
}));
jest.mock('../../features/activity/activityFinalArtifact', () => ({
  loadActivityFinalArtifact: jest.fn(async () => mockArtifact),
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

import { classifyPendingSyncFailure, drainPending, recoverPreparingActivityCompletion } from '../syncDaemon';
const { saveHikeAtomic: mockSaveHikeAtomic } = require('../sessionService');
const { acknowledgeActivity: mockAcknowledgeActivity } = require('../../features/activity/activityRegistry');

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
    jest.clearAllMocks();
  });

  test('a crash after refined artifact commit rolls the Base outbox forward before upload', async () => {
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
    expect(mockSavedPending).toHaveLength(1);
    expect(mockSavedPending[0]).toMatchObject({
      uploadState: 'preparing',
      finalArtifact: { revision: 2, displayFingerprint: 'refined-display' },
      payload: {
        route_points: [
          {
            lat: -41, lng: 174, t: 1_000, alt: 88, acc: 6, v_acc: 9,
            speed_mps: 1.2, course_deg: 45, raw_ordinal: 3,
            segment_id: 'segment-a', segment_start_reason: 'start',
          },
          { lat: -41.002, lng: 174.002, t: 5_000, alt: 92, segment_id: 'segment-a' },
        ],
      },
    });
    expect(mockAddedSessions[0]).toMatchObject({
      finalGeometryRevision: 2,
      finalGeometryFingerprint: 'refined-display',
      trackPoints: mockArtifact.points,
    });
    expect(preparing.uploadState).toBe('ready');
    expect(preparing.finalArtifact.revision).toBe(2);
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
      'heavy-trace-delete',
      'registry-remove',
    ]);
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

  test('an explicit owner retry may re-attempt an action-required row', async () => {
    mockPendingRows = [{ ...pending, failureKind: 'action_required', lastAttemptAt: Date.now(), attemptCount: 1 }];
    await expect(drainPending({ wakeReason: 'manual', force: true })).resolves.toMatchObject({
      attempted: 1,
      succeeded: 1,
    });
  });
});
