const mockMemory = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockMemory.set(key, value); }),
  },
}));

import {
  activityRemoteConflictStorageKey,
  clearActivityRemoteStartConflict,
  getActivityRemoteStartConflict,
  persistActivityRemoteStartConflict,
  REMOTE_START_CONFLICT_RETRY_MS,
} from '../activityRemoteConflictStore';

const existing = {
  id: 91,
  clientActivityId: '22222222-2222-4222-8222-222222222222',
  type: 'running' as const,
  startedAt: '2027-01-15T08:00:00.000Z',
  pointCount: 12,
  rawPointCount: 15,
};

describe('owner-scoped remote Start conflict store', () => {
  beforeEach(() => mockMemory.clear());

  test('persists an actionable exact-identity conflict across module callers', async () => {
    const first = await persistActivityRemoteStartConflict({
      ownerUserId: 'account-a',
      clientActivityId: '11111111-1111-4111-8111-111111111111',
      ownerGeneration: 'generation-a',
      activityMode: 'hiking',
      localStartedAt: 1_800_000_000_000,
      code: 'UNFINISHED_ACTIVITY_EXISTS',
      existing,
      existingActivities: [existing],
      observedAt: 5_000,
    });
    expect(first).toMatchObject({
      state: 'owner-action-required',
      occurrenceCount: 1,
      retryNotBefore: 5_000 + REMOTE_START_CONFLICT_RETRY_MS,
      conflictingActivities: [{
        serverActivityId: 91,
        clientActivityId: existing.clientActivityId,
        activityMode: 'running',
      }],
    });

    // A process-recovery read uses only the captured owner/activity key.
    await expect(getActivityRemoteStartConflict(
      'account-a',
      '11111111-1111-4111-8111-111111111111',
    )).resolves.toEqual(first);
    await expect(getActivityRemoteStartConflict(
      'account-b',
      '11111111-1111-4111-8111-111111111111',
    )).resolves.toBeNull();
  });

  test('re-observation advances retry metadata without duplicating identity', async () => {
    const input = {
      ownerUserId: 'account-a',
      clientActivityId: '11111111-1111-4111-8111-111111111111',
      activityMode: 'hiking' as const,
      localStartedAt: 1_800_000_000_000,
      code: 'UNFINISHED_ACTIVITY_EXISTS',
      existing,
      existingActivities: [existing],
    };
    await persistActivityRemoteStartConflict({ ...input, observedAt: 10_000 });
    const second = await persistActivityRemoteStartConflict({ ...input, observedAt: 20_000 });
    expect(second.occurrenceCount).toBe(2);
    expect(second.detectedAt).toBe(10_000);
    expect(second.lastObservedAt).toBe(20_000);
    expect(second.conflictingActivities).toHaveLength(1);
  });

  test('matching reconciliation clears only the exact owner Activity', async () => {
    for (const clientActivityId of ['activity-a', 'activity-b']) {
      await persistActivityRemoteStartConflict({
        ownerUserId: 'account-a', clientActivityId, activityMode: 'hiking',
        localStartedAt: 1_000, code: 'UNFINISHED_ACTIVITY_EXISTS',
        existing, existingActivities: [], observedAt: 10_000,
      });
    }
    await clearActivityRemoteStartConflict('account-a', 'activity-a');
    expect(await getActivityRemoteStartConflict('account-a', 'activity-a')).toBeNull();
    expect(await getActivityRemoteStartConflict('account-a', 'activity-b')).not.toBeNull();
  });

  test('corrupt owner evidence fails closed and is not overwritten', async () => {
    const key = activityRemoteConflictStorageKey('account-a');
    mockMemory.set(key, '{broken');
    await expect(getActivityRemoteStartConflict('account-a', 'activity-a'))
      .rejects.toThrow('activity_remote_conflict_store_corrupt');
    await expect(persistActivityRemoteStartConflict({
      ownerUserId: 'account-a', clientActivityId: 'activity-a', activityMode: 'hiking',
      localStartedAt: 1_000, code: 'UNFINISHED_ACTIVITY_EXISTS',
      existing, existingActivities: [], observedAt: 10_000,
    })).rejects.toThrow('activity_remote_conflict_store_corrupt');
    expect(mockMemory.get(key)).toBe('{broken');
  });
});
