const mockFlushEncounterEvidence = jest.fn(async (_ownerUserId?: string) => ({
  status: 'acknowledged', processedWitnessCount: 1, acquiredCount: 1,
}));
const mockFlushRoute = jest.fn(async (_input?: unknown) => ({ acknowledged: true, acknowledgedCount: 2, appendedCount: 2 }));

jest.mock('../services/walkingEncounterEvidence', () => ({
  flushWalkingEncounterEvidence: (ownerUserId: string) => mockFlushEncounterEvidence(ownerUserId),
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
    __publicWalkingDiscoveryTest.reset();
  });

  test('uploads route authority before draining the independent encounter queue', async () => {
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
    expect(mockFlushEncounterEvidence).toHaveBeenCalledWith('viewer-a');
    expect(mockFlushRoute.mock.invocationCallOrder[0]).toBeLessThan(mockFlushEncounterEvidence.mock.invocationCallOrder[0]);
  });

  test('does not client-gate Friends discovery on the Public pilot and still requires real continuity', async () => {
    expect(await maybeVerifyPublicWalkingDiscovery({ sourceActivityClientId: activityId, serverActivityId: 71, ownerUserId: 'viewer-a', ownerGeneration: 'generation-a', points: points.map((p, i) => ({ ...p, t: i * 5_000 + 1_000 })), isCurrent: () => true })).toBe('skipped');
    expect(await maybeVerifyPublicWalkingDiscovery({ sourceActivityClientId: activityId, serverActivityId: 71, ownerUserId: 'viewer-a', ownerGeneration: 'generation-a', points, isCurrent: () => false })).toBe('skipped');
    expect(mockFlushEncounterEvidence).not.toHaveBeenCalled();
  });

  test('rechecks identity after awaits and throttles an incomplete probe', async () => {
    let current = true;
    mockFlushEncounterEvidence.mockImplementationOnce(async () => {
      current = false;
      return { status: 'acknowledged', processedWitnessCount: 1, acquiredCount: 0 };
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
    expect(mockFlushEncounterEvidence).toHaveBeenCalledTimes(1);
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
    expect(mockFlushEncounterEvidence).not.toHaveBeenCalled();
  });
});
