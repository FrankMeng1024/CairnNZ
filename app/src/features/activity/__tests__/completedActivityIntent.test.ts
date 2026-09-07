const mockOrder: string[] = [];

jest.mock('../../../store/useSessionStore', () => {
  const addSession = jest.fn(async () => { mockOrder.push('summary'); });
  return {
    useSessionStore: { getState: () => ({ addSession }) },
    __mockAddSession: addSession,
  };
});
jest.mock('../activityRegistry', () => {
  const completeActivity = jest.fn(async () => { mockOrder.push('registry'); });
  return { completeActivity, __mockCompleteActivity: completeActivity };
});

import { reconcileCompletedActivityIntent } from '../completedActivityIntent';
import type { PendingHike } from '../../../services/pendingSyncStore';
const { __mockAddSession: mockAddSession } = require('../../../store/useSessionStore');
const { __mockCompleteActivity: mockCompleteActivity } = require('../activityRegistry');

const intent: PendingHike = {
  contractVersion: 3,
  localId: 'activity-a',
  userId: 'account-a',
  remoteId: 12,
  idempotencyKey: 'operation-a',
  activityMode: 'hiking',
  startedAt: 1_000,
  payload: {
    end_time: new Date(5_000).toISOString(),
    distance_m: 42,
    duration_s: 4,
    name: 'Crash-safe hike',
    route_points: [
      { lat: -41, lng: 174, t: 1_000, segment_id: 's1' },
      { lat: -41.001, lng: 174.001, t: 5_000, segment_id: 's1' },
    ],
    route_points_raw: [],
    memory_points: [],
  },
  summary: {
    startedAt: 1_000,
    endedAt: 5_000,
    distanceM: 42,
    durationS: 4,
    elevationGainM: 3,
    name: 'Crash-safe hike',
    markerIds: ['cairn-a'],
  },
  createdAt: 5_000,
  lastAttemptAt: null,
  attemptCount: 0,
};

describe('completed-local intent roll-forward', () => {
  beforeEach(() => {
    mockOrder.length = 0;
    jest.clearAllMocks();
    mockAddSession.mockImplementation(async () => { mockOrder.push('summary'); });
    mockCompleteActivity.mockImplementation(async () => { mockOrder.push('registry'); });
  });

  test('phase 1 intent reconstructs a complete Detail before lifecycle completion', async () => {
    const completed = await reconcileCompletedActivityIntent('account-a', intent);
    expect(mockOrder).toEqual(['summary', 'registry']);
    expect(completed).toMatchObject({
      id: 'activity-a',
      clientActivityId: 'activity-a',
      remoteId: 12,
      distanceM: 42,
      syncState: 'pending',
      trackPoints: [
        expect.objectContaining({ lat: -41, segmentId: 's1' }),
        expect.objectContaining({ lat: -41.001, segmentId: 's1' }),
      ],
    });
  });

  test('death/failure before phase 2 leaves the intent retryable', async () => {
    mockAddSession.mockRejectedValueOnce(new Error('process-death-phase-2'));
    await expect(reconcileCompletedActivityIntent('account-a', intent)).rejects.toThrow('phase-2');
    expect(mockCompleteActivity).not.toHaveBeenCalled();
    await expect(reconcileCompletedActivityIntent('account-a', intent)).resolves.toBeDefined();
    expect(mockOrder).toEqual(['summary', 'registry']);
  });

  test('death/failure before phase 3 replays the idempotent summary then completes registry', async () => {
    mockCompleteActivity.mockRejectedValueOnce(new Error('process-death-phase-3'));
    await expect(reconcileCompletedActivityIntent('account-a', intent)).rejects.toThrow('phase-3');
    await expect(reconcileCompletedActivityIntent('account-a', intent)).resolves.toBeDefined();
    expect(mockAddSession).toHaveBeenCalledTimes(2);
    expect(mockCompleteActivity).toHaveBeenCalledTimes(2);
    expect(mockOrder).toEqual(['summary', 'summary', 'registry']);
  });

  test('never projects an intent into a different account', async () => {
    await expect(reconcileCompletedActivityIntent('account-b', intent)).rejects.toThrow('owner_mismatch');
    expect(mockAddSession).not.toHaveBeenCalled();
  });
});
