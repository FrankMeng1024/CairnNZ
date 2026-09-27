jest.mock('../../memory/services/recordMemoryEvidence', () => ({ recordMemoryEvidence: jest.fn() }));
jest.mock('../../../services/hikeTrackWriter', () => ({ readActiveHikeTail: jest.fn(async () => []) }));
jest.mock('../../../store/storage', () => ({ storage: { setItem: jest.fn(async () => undefined) } }));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: { id: 'owner-a' } }) },
}));

import {
  getActivityMemoryProjectionMetrics,
  resetActivityMemoryProjectionForTests,
  scheduleActivityMemoryProjection,
  waitForActivityMemoryProjection,
} from '../activityMemoryProjector';

const mockRecordMemoryEvidence = require('../../memory/services/recordMemoryEvidence').recordMemoryEvidence as jest.Mock;
const mockSetItem = require('../../../store/storage').storage.setItem as jest.Mock;

const point = (t: number) => ({ lat: -41 + t / 1e9, lng: 174, t, segmentId: 'segment-a' });

describe('activity Memory downstream isolation', () => {
  beforeEach(() => {
    resetActivityMemoryProjectionForTests();
    jest.clearAllMocks();
  });

  test('a stalled Memory projection does not block the source caller and coalesces later durable points', async () => {
    let release!: () => void;
    mockRecordMemoryEvidence.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ committed: true, deduplicated: false });
    }));
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', ownerGeneration: 'gen-a', points: [point(1)],
    });
    scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', ownerGeneration: 'gen-a', points: [point(2), point(3)],
    });
    expect(getActivityMemoryProjectionMetrics()).toMatchObject({ scheduledPoints: 3 });
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(1);
    release();
    await waitForActivityMemoryProjection('activity-a');
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(3);
    expect(mockSetItem).toHaveBeenCalledTimes(3);
  });
});
