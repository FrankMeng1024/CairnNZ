const mockPushMemoryNow = jest.fn(async () => {});
const mockVerify = jest.fn(async (_sourceActivityClientId: string) => true);
let mockPublicEnabled = true;

jest.mock('../../../services/memorySync', () => ({
  pushMemoryNow: () => mockPushMemoryNow(),
}));
jest.mock('../services/publicCairns', () => ({
  usePublicCairnStore: {
    getState: () => ({ enabled: mockPublicEnabled, verifyCompletedActivity: mockVerify }),
  },
}));

import {
  __publicWalkingDiscoveryTest,
  maybeVerifyPublicWalkingDiscovery,
} from '../services/publicWalkingDiscovery';

const activityId = '11111111-1111-4111-8111-111111111111';
const points = [
  { lat: -41, lng: 174, t: 1_000, segment_id: 'segment-a' },
  { lat: -41.0001, lng: 174.0001, t: 12_000, segment_id: 'segment-a' },
];

describe('walking-first Public encounter probe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPublicEnabled = true;
    __publicWalkingDiscoveryTest.reset();
  });

  test('uploads live witness authority before asking the server to decide', async () => {
    await expect(maybeVerifyPublicWalkingDiscovery({
      sourceActivityClientId: activityId,
      serverActivityId: 71,
      points,
      nowMs: 100_000,
      isCurrent: () => true,
    })).resolves.toBe('attempted');

    expect(mockPushMemoryNow).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith(activityId);
    expect(mockPushMemoryNow.mock.invocationCallOrder[0]).toBeLessThan(mockVerify.mock.invocationCallOrder[0]);
  });

  test('requires pilot authority, a 10-second span and current Activity identity', async () => {
    mockPublicEnabled = false;
    expect(await maybeVerifyPublicWalkingDiscovery({ sourceActivityClientId: activityId, serverActivityId: 71, points, isCurrent: () => true })).toBe('skipped');
    mockPublicEnabled = true;
    expect(await maybeVerifyPublicWalkingDiscovery({ sourceActivityClientId: activityId, serverActivityId: 71, points: points.map((p, i) => ({ ...p, t: i * 5_000 + 1_000 })), isCurrent: () => true })).toBe('skipped');
    expect(await maybeVerifyPublicWalkingDiscovery({ sourceActivityClientId: activityId, serverActivityId: 71, points, isCurrent: () => false })).toBe('skipped');
    expect(mockPushMemoryNow).not.toHaveBeenCalled();
  });

  test('throttles duplicate callbacks and rechecks identity after awaits', async () => {
    let current = true;
    mockPushMemoryNow.mockImplementationOnce(async () => { current = false; });
    await maybeVerifyPublicWalkingDiscovery({
      sourceActivityClientId: activityId,
      serverActivityId: 71,
      points,
      nowMs: 100_000,
      isCurrent: () => current,
    });
    expect(mockVerify).not.toHaveBeenCalled();
    current = true;
    expect(await maybeVerifyPublicWalkingDiscovery({
      sourceActivityClientId: activityId,
      serverActivityId: 71,
      points,
      nowMs: 100_001,
      isCurrent: () => current,
    })).toBe('skipped');
  });
});
