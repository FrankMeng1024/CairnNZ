let mockCurrentUserId = 'account-a';
let mockPendingRows: any[] = [];
let mockRegistry: any = { unfinished: null, completed: [], tombstones: [] };
let mockRemoveFailureCount = 0;
const mockOrder: string[] = [];

jest.mock('../pendingSyncStore', () => ({
  listPending: jest.fn(async () => [...mockPendingRows]),
  removePending: jest.fn(async (localId: string) => {
    mockOrder.push('pending-delete');
    if (mockRemoveFailureCount > 0) {
      mockRemoveFailureCount -= 1;
      throw new Error('injected-cleanup-delete-failure');
    }
    mockPendingRows = mockPendingRows.filter(row => row.localId !== localId);
  }),
  markAttempt: jest.fn(async () => undefined),
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
      markSyncState: jest.fn(async () => undefined),
      markSynced: jest.fn(async () => { mockOrder.push('summary-ack'); return true; }),
    }),
  },
  removeLocalTrackPoints: jest.fn(async () => { mockOrder.push('points-delete'); }),
}));

import { drainPending } from '../syncDaemon';
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
    jest.clearAllMocks();
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
      'points-delete',
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
    );
    expect(mockOrder).toEqual([
      'summary-ack',
      'registry-ack',
      'pending-delete',
      'points-delete',
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
});
