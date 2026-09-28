const mockOrder: string[] = [];

jest.mock('../../../store/useTrackingStore', () => ({
  useTrackingStore: { setState: jest.fn(), getState: jest.fn() },
}));
const mockRouteSetState = jest.fn();
jest.mock('../../../store/useRouteStore', () => ({
  useRouteStore: { setState: mockRouteSetState },
}));
jest.mock('../../../services/hikeTrackWriter', () => ({
  discardActiveHike: jest.fn(async () => { mockOrder.push('journal-delete'); }),
  listActiveHikes: jest.fn(async () => []),
  readActiveHikeTail: jest.fn(async () => [{
    t: 1_000,
    lat: -41,
    lng: 174,
    clientActivityId: 'activity-a',
    ownerGeneration: 'owner-a',
    segmentId: 'segment-a',
  }]),
  resumeHikeTrack: jest.fn(),
  startHikeTrack: jest.fn(),
}));
jest.mock('../../../services/sessionService', () => ({
  deleteRemoteSession: jest.fn(async () => true),
  deleteRemoteSessionByClientId: jest.fn(async () => true),
}));
jest.mock('../../../services/backgroundLocationTask', () => ({
  BACKGROUND_LOCATION_TASK: 'background-task',
  persistBackgroundContext: jest.fn(async () => { mockOrder.push('fence'); return true; }),
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: { id: 'account-a' } }) },
}));
jest.mock('../activityRegistry', () => ({
  getActivityRegistry: jest.fn(),
  getUnfinishedActivity: jest.fn(),
  registerUnfinishedActivity: jest.fn(),
  tombstoneActivity: jest.fn(async () => { mockOrder.push('tombstone'); }),
  updateUnfinishedActivity: jest.fn(async () => true),
}));
jest.mock('../activityMemoryProjector', () => ({
  scheduleActivityMemoryProjection: jest.fn(async () => { mockOrder.push('memory-intent'); }),
  reconcileActivityMemoryProjection: jest.fn(async () => { mockOrder.push('memory-reconcile'); return true; }),
  cancelActivityMemoryProjection: jest.fn(async () => { mockOrder.push('memory-cancel'); }),
}));
jest.mock('../../memory/services/recordMemoryEvidence', () => ({
  recordMemoryEvidence: jest.fn(async () => {
    mockOrder.push('memory');
    return { committed: true, deduplicated: false };
  }),
  flushRecordedMemoryEvidence: jest.fn(async () => { mockOrder.push('memory-flush'); }),
}));
jest.mock('../../../services/pendingSyncStore', () => ({
  removePending: jest.fn(async () => { mockOrder.push('pending-delete'); }),
}));

import { discardRecoverableActivity, saveRecoverableActivity, type RecoverableActivity } from '../activityRecovery';
const { recordMemoryEvidence: mockRecordMemoryEvidence } = require('../../memory/services/recordMemoryEvidence');
const { tombstoneActivity: mockTombstoneActivity } = require('../activityRegistry');
const { getActivityRegistry: mockGetActivityRegistry } = require('../activityRegistry');
const { getUnfinishedActivity: mockGetUnfinishedActivity } = require('../activityRegistry');
const { discardActiveHike: mockDiscardActiveHike } = require('../../../services/hikeTrackWriter');
const { useTrackingStore: mockTrackingStore } = require('../../../store/useTrackingStore');

const activity: RecoverableActivity = {
  sessionId: 'activity-a',
  clientActivityId: 'activity-a',
  remoteId: 10,
  userId: 'account-a',
  ownerGeneration: 'owner-a',
  activityMode: 'hiking',
  startedAt: 100,
  distanceM: 100,
  durationS: 60,
  pointCount: 1,
  saveEligible: false,
  lastPointAt: 1_000,
};

describe('Activity journal as crash-recoverable Memory intent', () => {
  beforeEach(() => {
    mockOrder.length = 0;
    jest.clearAllMocks();
    mockRecordMemoryEvidence.mockImplementation(async () => {
      mockOrder.push('memory');
      return { committed: true, deduplicated: false };
    });
    mockGetActivityRegistry.mockResolvedValue({
      version: 1,
      unfinished: {
        clientActivityId: activity.clientActivityId,
        liveOwnerGeneration: activity.ownerGeneration,
      },
      completed: [],
      tombstones: [],
    });
    mockGetUnfinishedActivity.mockResolvedValue({
      clientActivityId: activity.clientActivityId,
      userId: activity.userId,
      liveOwnerGeneration: activity.ownerGeneration,
    });
    mockTrackingStore.getState.mockReturnValue({
      stopTracking: jest.fn(async () => ({
        status: 'saved-local',
        localCommit: 'committed',
        clientActivityId: activity.clientActivityId,
      })),
    });
  });

  test('accepted headless point survives process death then Activity discard', async () => {
    await discardRecoverableActivity(activity);
    expect(mockOrder).toEqual([
      'fence', 'memory-intent', 'memory-reconcile', 'tombstone', 'pending-delete',
      'memory-cancel', 'journal-delete',
    ]);
    expect(mockRouteSetState).toHaveBeenCalledWith({ activityRouteReference: null });
  });

  test('Memory persistence failure preserves the recoverable Activity journal', async () => {
    const projector = require('../activityMemoryProjector');
    projector.reconcileActivityMemoryProjection.mockResolvedValueOnce(false);
    await expect(discardRecoverableActivity(activity)).rejects.toThrow('activity_discard_memory_projection_incomplete');
    expect(mockTombstoneActivity).not.toHaveBeenCalled();
    expect(mockDiscardActiveHike).not.toHaveBeenCalled();
  });

  test('stale recovery UI cannot discard an Activity that is already completed-local', async () => {
    mockGetActivityRegistry.mockResolvedValueOnce({
      version: 1,
      unfinished: null,
      completed: [{ clientActivityId: activity.clientActivityId, lifecycle: 'completed_local', syncState: 'pending' }],
      tombstones: [],
    });
    await expect(discardRecoverableActivity(activity)).rejects.toThrow('activity_discard_not_unfinished');
    expect(mockOrder).toEqual([]);
    expect(mockTombstoneActivity).not.toHaveBeenCalled();
    expect(mockDiscardActiveHike).not.toHaveBeenCalled();
  });

  test.each(['hiking', 'running'] as const)('%s recovery Save clears only an exact committed Finish result', async (activityMode) => {
    await expect(saveRecoverableActivity({ ...activity, activityMode })).resolves.toBe(true);
    const stopTracking = mockTrackingStore.getState().stopTracking as jest.Mock;
    stopTracking.mockResolvedValueOnce({
      status: 'recoverable-failure',
      localCommit: 'not-committed',
      clientActivityId: activity.clientActivityId,
      reason: 'local-commit-failed',
    });
    await expect(saveRecoverableActivity({ ...activity, activityMode })).resolves.toBe(false);
    stopTracking.mockRejectedValueOnce(new Error('finish-threw'));
    await expect(saveRecoverableActivity({ ...activity, activityMode })).rejects.toThrow('finish-threw');
  });

  test.each(['hiking', 'running'] as const)('%s recovery Save is single-flight under duplicate taps', async (activityMode) => {
    let release!: (value: any) => void;
    const stopTracking = jest.fn(() => new Promise(resolve => { release = resolve; }));
    mockTrackingStore.getState.mockReturnValue({ stopTracking });
    const candidate = { ...activity, activityMode };
    const first = saveRecoverableActivity(candidate);
    const second = saveRecoverableActivity(candidate);
    for (let turn = 0; turn < 40 && !release; turn += 1) await Promise.resolve();
    expect(release).toBeDefined();
    release({ status: 'saved-local', localCommit: 'committed', clientActivityId: activity.clientActivityId });
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(stopTracking).toHaveBeenCalledTimes(1);
  });
});
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
