const mockPushMemoryForActivityNow = jest.fn(async (_input?: unknown) => ({ acknowledged: true, reason: 'acknowledged' }));
const mockVerify = jest.fn(async (_sourceActivityClientId: string) => true);
const mockFlushRoute = jest.fn(async (_input?: unknown) => ({ acknowledged: true, acknowledgedCount: 2, appendedCount: 2 }));
let mockPublicEnabled = true;

jest.mock('../../../services/memorySync', () => ({
  pushMemoryForActivityNow: (input: { ownerUserId: string; sourceActivityClientId: string }) => (
    mockPushMemoryForActivityNow(input)
  ),
}));
jest.mock('../services/publicCairns', () => ({
  usePublicCairnStore: {
    getState: () => ({ enabled: mockPublicEnabled, verifyCompletedActivity: mockVerify }),
  },
}));
jest.mock('../../activity/activityRouteFlushAuthority', () => ({
  flushActivityRoutePrefix: (input: unknown) => mockFlushRoute(input),
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
      ownerUserId: 'viewer-a',
      ownerGeneration: 'generation-a',
      points,
      nowMs: 100_000,
      isCurrent: () => true,
    })).resolves.toBe('attempted');

    expect(mockFlushRoute).toHaveBeenCalledTimes(1);
    expect(mockPushMemoryForActivityNow).toHaveBeenCalledWith({
      ownerUserId: 'viewer-a',
      sourceActivityClientId: activityId,
    });
    expect(mockVerify).toHaveBeenCalledWith(activityId);
    expect(mockFlushRoute.mock.invocationCallOrder[0]).toBeLessThan(mockPushMemoryForActivityNow.mock.invocationCallOrder[0]);
    expect(mockPushMemoryForActivityNow.mock.invocationCallOrder[0]).toBeLessThan(mockVerify.mock.invocationCallOrder[0]);
  });

  test('requires pilot authority, a 10-second span and current Activity identity', async () => {
    mockPublicEnabled = false;
    expect(await maybeVerifyPublicWalkingDiscovery({ sourceActivityClientId: activityId, serverActivityId: 71, ownerUserId: 'viewer-a', ownerGeneration: 'generation-a', points, isCurrent: () => true })).toBe('skipped');
    mockPublicEnabled = true;
    expect(await maybeVerifyPublicWalkingDiscovery({ sourceActivityClientId: activityId, serverActivityId: 71, ownerUserId: 'viewer-a', ownerGeneration: 'generation-a', points: points.map((p, i) => ({ ...p, t: i * 5_000 + 1_000 })), isCurrent: () => true })).toBe('skipped');
    expect(await maybeVerifyPublicWalkingDiscovery({ sourceActivityClientId: activityId, serverActivityId: 71, ownerUserId: 'viewer-a', ownerGeneration: 'generation-a', points, isCurrent: () => false })).toBe('skipped');
    expect(mockPushMemoryForActivityNow).not.toHaveBeenCalled();
  });

  test('rechecks identity after awaits and throttles an incomplete probe', async () => {
    let current = true;
    mockPushMemoryForActivityNow.mockImplementationOnce(async () => {
      current = false;
      return { acknowledged: true, reason: 'acknowledged' };
    });
    await maybeVerifyPublicWalkingDiscovery({
      sourceActivityClientId: activityId,
      serverActivityId: 71,
      ownerUserId: 'viewer-a',
      ownerGeneration: 'generation-a',
      points,
      nowMs: 100_000,
      isCurrent: () => current,
    });
    expect(mockVerify).not.toHaveBeenCalled();
    current = true;
    expect(await maybeVerifyPublicWalkingDiscovery({
      sourceActivityClientId: activityId,
      serverActivityId: 71,
      ownerUserId: 'viewer-a',
      ownerGeneration: 'generation-a',
      points,
      nowMs: 100_001,
      isCurrent: () => current,
    })).toBe('skipped');
    expect(await maybeVerifyPublicWalkingDiscovery({
      sourceActivityClientId: activityId,
      serverActivityId: 71,
      ownerUserId: 'viewer-a',
      ownerGeneration: 'generation-a',
      points,
      nowMs: 100_000 + __publicWalkingDiscoveryTest.PROBE_INTERVAL_MS,
      isCurrent: () => current,
    })).toBe('attempted');
  });

  test('does not expose walking evidence until the route append is acknowledged', async () => {
    mockFlushRoute.mockResolvedValueOnce({ acknowledged: false, acknowledgedCount: 0, appendedCount: 0 });
    await expect(maybeVerifyPublicWalkingDiscovery({
      sourceActivityClientId: activityId,
      serverActivityId: 71,
      ownerUserId: 'viewer-a',
      ownerGeneration: 'generation-a',
      points,
      nowMs: 100_000,
      isCurrent: () => true,
    })).resolves.toBe('attempted');
    expect(mockPushMemoryForActivityNow).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });
});
