const mockValues = new Map<string, string>();
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  },
}));

import { createActivityMapboxRequestGovernor } from '../activityRequestGovernor';

describe('activity-wide Mapbox request governor', () => {
  beforeEach(() => mockValues.clear());

  test('persists budgets across new governor instances and counts failed invocations', async () => {
    let now = 1_000;
    const args = {
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', startedAtMs: 0,
      recordedDurationMs: 3_600_000, now: () => now,
    };
    const first = createActivityMapboxRequestGovernor(args);
    const permit = await first.authorize({ phase: 'final', kind: 'map-matching', fingerprint: 'window-a', reason: 'unresolved-corridor' });
    expect(permit.allowed).toBe(true);
    await first.complete({ receiptId: permit.receiptId!, result: 'http', httpStatus: 500, bytes: 120, durationMs: 40 });
    const reopened = createActivityMapboxRequestGovernor(args);
    const backoff = await reopened.authorize({ phase: 'final', kind: 'map-matching', fingerprint: 'window-a', reason: 'retry' });
    expect(backoff).toMatchObject({ allowed: false, reason: 'backoff' });
    expect(await reopened.snapshot()).toMatchObject({ finalMatchingInvocations: 1, failedInvocations: 1, bytes: 120 });
    now += 60_001;
    const retry = await reopened.authorize({ phase: 'final', kind: 'map-matching', fingerprint: 'window-a', reason: 'retry' });
    expect(retry.allowed).toBe(true);
    await reopened.complete({ receiptId: retry.receiptId!, result: 'aborted', durationMs: 8 });
    expect(await reopened.snapshot()).toMatchObject({
      finalMatchingInvocations: 2,
      failedInvocations: 2,
      abortedInvocations: 1,
      retriedInvocations: 1,
    });
  });

  test.each(['passive', 'preview', 'reload'] as const)('%s work is zero-network by contract', async phase => {
    const governor = createActivityMapboxRequestGovernor({
      ownerUserId: 'owner-a', clientActivityId: `activity-${phase}`, startedAtMs: 0, recordedDurationMs: 60_000,
    });
    await expect(governor.authorize({ phase, kind: 'map-matching', fingerprint: phase, reason: 'none' }))
      .resolves.toMatchObject({ allowed: false, reason: 'phase-zero-network' });
  });
});
