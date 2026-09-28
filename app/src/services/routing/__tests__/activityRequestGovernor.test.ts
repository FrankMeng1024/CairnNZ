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

  test('separate Final segments and reopened instances share one Activity-wide ceiling', async () => {
    const args = {
      ownerUserId: 'owner-segments', clientActivityId: 'activity-segments', startedAtMs: 0,
      recordedDurationMs: 3_600_000,
    };
    for (let index = 0; index < 20; index += 1) {
      const governor = createActivityMapboxRequestGovernor(args);
      const permit = await governor.authorize({
        phase: 'final',
        kind: 'map-matching',
        fingerprint: `segment-${index % 3}:window-${index}`,
        reason: 'segment-final-window',
      });
      expect(permit.allowed).toBe(true);
      await governor.complete({ receiptId: permit.receiptId!, result: 'ok', durationMs: 4 });
    }
    const reopened = createActivityMapboxRequestGovernor(args);
    await expect(reopened.authorize({
      phase: 'final', kind: 'map-matching', fingerprint: 'segment-new:window-extra', reason: 'reopen',
    })).resolves.toMatchObject({ allowed: false, reason: 'budget' });
    await expect(reopened.snapshot()).resolves.toMatchObject({
      finalMatchingInvocations: 20,
      finalMatchingLimit: 20,
      matchingLimit: 30,
    });
  });

  test('retry loops consume the persisted Final ceiling rather than bypassing it', async () => {
    let now = 10_000;
    const args = {
      ownerUserId: 'owner-retry-cap', clientActivityId: 'activity-retry-cap', startedAtMs: 0,
      recordedDurationMs: 3_600_000, now: () => now,
    };
    for (let index = 0; index < 20; index += 1) {
      const governor = createActivityMapboxRequestGovernor(args);
      const permit = await governor.authorize({
        phase: 'final', kind: 'map-matching', fingerprint: 'same-window', reason: 'bounded-retry',
      });
      expect(permit.allowed).toBe(true);
      await governor.complete({ receiptId: permit.receiptId!, result: 'http', httpStatus: 500, durationMs: 5 });
      now += 60_001;
    }
    const reopened = createActivityMapboxRequestGovernor(args);
    await expect(reopened.authorize({
      phase: 'final', kind: 'map-matching', fingerprint: 'same-window', reason: 'retry-over-cap',
    })).resolves.toMatchObject({ allowed: false, reason: 'budget' });
    await expect(reopened.snapshot()).resolves.toMatchObject({
      finalMatchingInvocations: 20,
      failedInvocations: 20,
      retriedInvocations: 19,
    });
  });

  test('permits at most two concurrent requests and two Directions fallbacks per Activity', async () => {
    const args = {
      ownerUserId: 'owner-concurrency', clientActivityId: 'activity-concurrency', startedAtMs: 0,
      recordedDurationMs: 3_600_000,
    };
    const governor = createActivityMapboxRequestGovernor(args);
    const first = await governor.authorize({
      phase: 'final', kind: 'walking-directions', fingerprint: 'directions-a', reason: 'fallback-a',
    });
    const second = await governor.authorize({
      phase: 'final', kind: 'walking-directions', fingerprint: 'directions-b', reason: 'fallback-b',
    });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    await expect(governor.authorize({
      phase: 'final', kind: 'map-matching', fingerprint: 'while-two-active', reason: 'concurrency-check',
    })).resolves.toMatchObject({ allowed: false, reason: 'concurrency' });
    await governor.complete({ receiptId: first.receiptId!, result: 'ok', durationMs: 4 });
    await governor.complete({ receiptId: second.receiptId!, result: 'ok', durationMs: 4 });
    await expect(createActivityMapboxRequestGovernor(args).authorize({
      phase: 'final', kind: 'walking-directions', fingerprint: 'directions-c', reason: 'fallback-over-cap',
    })).resolves.toMatchObject({ allowed: false, reason: 'budget' });
  });

  test('a permit released before dispatch does not count as an invocation', async () => {
    const governor = createActivityMapboxRequestGovernor({
      ownerUserId: 'owner-cancel', clientActivityId: 'activity-cancel', startedAtMs: 0, recordedDurationMs: 60_000,
    });
    const permit = await governor.authorize({
      phase: 'final', kind: 'map-matching', fingerprint: 'cancel-before-fetch', reason: 'cancellation-race',
    });
    expect(permit.allowed).toBe(true);
    await governor.releaseUndispatched(permit.receiptId!);
    await expect(governor.snapshot()).resolves.toMatchObject({
      finalMatchingInvocations: 0,
      failedInvocations: 0,
      abortedInvocations: 0,
    });
  });
});
