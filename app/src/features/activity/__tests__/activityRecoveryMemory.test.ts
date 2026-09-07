const mockOrder: string[] = [];

jest.mock('../../../store/useTrackingStore', () => ({
  useTrackingStore: { setState: jest.fn(), getState: jest.fn() },
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
  updateUnfinishedActivity: jest.fn(),
}));
jest.mock('../../memory/services/recordMemoryEvidence', () => ({
  recordMemoryEvidence: jest.fn(async () => {
    mockOrder.push('memory');
    return { committed: true, deduplicated: false };
  }),
}));
jest.mock('../../../services/pendingSyncStore', () => ({
  removePending: jest.fn(async () => { mockOrder.push('pending-delete'); }),
}));

import { discardRecoverableActivity, type RecoverableActivity } from '../activityRecovery';
const { recordMemoryEvidence: mockRecordMemoryEvidence } = require('../../memory/services/recordMemoryEvidence');
const { tombstoneActivity: mockTombstoneActivity } = require('../activityRegistry');
const { discardActiveHike: mockDiscardActiveHike } = require('../../../services/hikeTrackWriter');

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
  });

  test('accepted headless point survives process death then Activity discard', async () => {
    await discardRecoverableActivity(activity);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledWith(expect.objectContaining({
      lat: -41,
      lng: 174,
      atMs: 1_000,
      ownerUserId: 'account-a',
      source: 'reconciliation',
    }));
    expect(mockOrder).toEqual(['fence', 'memory', 'tombstone', 'pending-delete', 'journal-delete']);
  });

  test('Memory persistence failure preserves the recoverable Activity journal', async () => {
    mockRecordMemoryEvidence.mockRejectedValueOnce(new Error('disk-full'));
    await expect(discardRecoverableActivity(activity)).rejects.toThrow('disk-full');
    expect(mockTombstoneActivity).not.toHaveBeenCalled();
    expect(mockDiscardActiveHike).not.toHaveBeenCalled();
  });
});
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
