const mockMemory = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockMemory.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockMemory.delete(key); }),
  },
}));

import {
  acknowledgeActivity,
  completeActivity,
  getActivityRegistry,
  getUnfinishedActivity,
  isActivityTombstoned,
  mapActivityServerId,
  registerUnfinishedActivity,
  removeAcknowledgedActivity,
  tombstoneActivity,
  updateUnfinishedActivity,
} from '../activityRegistry';

function unfinished(userId: string, clientActivityId: string, activityMode: 'hiking' | 'running' = 'hiking') {
  return {
    clientActivityId,
    serverActivityId: null,
    userId,
    activityMode,
    startedAt: 100,
    lastMeaningfulAt: 100,
    liveOwnerGeneration: `${clientActivityId}-owner`,
    currentSegmentId: `${clientActivityId}-segment`,
    nextSegmentStartReason: 'start' as const,
    lifecycle: 'unfinished' as const,
  };
}

describe('bounded durable Activity registry', () => {
  beforeEach(() => mockMemory.clear());

  test('permits only one unfinished Activity globally, regardless of mode', async () => {
    await registerUnfinishedActivity(unfinished('user-singleton', '11111111-1111-4111-8111-111111111111'));
    await expect(registerUnfinishedActivity(
      unfinished('user-singleton', '22222222-2222-4222-8222-222222222222', 'running'),
    )).rejects.toThrow('unfinished_activity_exists');
  });

  test('recovery updates the exact immutable Activity identity', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    await registerUnfinishedActivity(unfinished('user-exact', id));
    await expect(updateUnfinishedActivity('user-exact', 'not-the-id', { lastMeaningfulAt: 999 })).resolves.toBe(false);
    await expect(updateUnfinishedActivity('user-exact', id, {
      currentSegmentId: 'recovery-segment',
      nextSegmentStartReason: 'process-recovery',
    })).resolves.toBe(true);
    expect((await getUnfinishedActivity('user-exact'))?.clientActivityId).toBe(id);
    expect((await getUnfinishedActivity('user-exact'))?.nextSegmentStartReason).toBe('process-recovery');
  });

  test('completed-local is no longer resumable and keeps independent sync state', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    await registerUnfinishedActivity(unfinished('user-complete', id, 'running'));
    await completeActivity({
      clientActivityId: id,
      serverActivityId: null,
      userId: 'user-complete',
      activityMode: 'running',
      startedAt: 100,
      endedAt: 200,
      lifecycle: 'completed_local',
      syncState: 'pending',
    });
    const registry = await getActivityRegistry('user-complete');
    expect(registry.unfinished).toBeNull();
    expect(registry.completed[0]).toMatchObject({ clientActivityId: id, syncState: 'pending' });
  });

  test('late Start acknowledgement maps a completed-local Activity without marking it synced', async () => {
    const id = '45454545-4545-4545-8545-454545454545';
    await completeActivity({
      clientActivityId: id,
      serverActivityId: null,
      userId: 'user-late-start',
      activityMode: 'hiking',
      startedAt: 100,
      endedAt: 200,
      lifecycle: 'completed_local',
      syncState: 'pending',
    });
    await expect(mapActivityServerId('user-late-start', id, 73)).resolves.toBe('completed');
    expect((await getActivityRegistry('user-late-start')).completed[0]).toMatchObject({
      serverActivityId: 73,
      syncState: 'pending',
    });
  });

  test('ack mapping persists before per-entity cleanup and does not affect another pending Activity', async () => {
    const a = '55555555-5555-4555-8555-555555555555';
    const b = '66666666-6666-4666-8666-666666666666';
    for (const id of [a, b]) {
      await completeActivity({
        clientActivityId: id,
        serverActivityId: null,
        userId: 'user-order',
        activityMode: id === a ? 'hiking' : 'running',
        startedAt: 100,
        endedAt: 200,
        lifecycle: 'completed_local',
        syncState: 'pending',
      });
    }
    await expect(acknowledgeActivity('user-order', a, 91)).resolves.toBe(true);
    let registry = await getActivityRegistry('user-order');
    expect(registry.completed.find(item => item.clientActivityId === a)).toMatchObject({ serverActivityId: 91, syncState: 'synced' });
    expect(registry.completed.find(item => item.clientActivityId === b)?.syncState).toBe('pending');

    await removeAcknowledgedActivity('user-order', a);
    registry = await getActivityRegistry('user-order');
    expect(registry.completed.map(item => item.clientActivityId)).toEqual([b]);
  });

  test('discard creates durable resurrection protection before removing the Activity', async () => {
    const id = '77777777-7777-4777-8777-777777777777';
    await registerUnfinishedActivity(unfinished('user-discard', id));
    await tombstoneActivity({ userId: 'user-discard', clientActivityId: id });
    expect(await getUnfinishedActivity('user-discard')).toBeNull();
    expect(await isActivityTombstoned('user-discard', id)).toBe(true);
    await expect(registerUnfinishedActivity(unfinished('user-discard', id))).rejects.toThrow('activity_tombstoned');
  });

  test('logout/account switching cannot expose another user registry', async () => {
    const id = '88888888-8888-4888-8888-888888888888';
    await registerUnfinishedActivity(unfinished('account-a', id));
    expect(await getUnfinishedActivity('account-b')).toBeNull();
    expect((await getUnfinishedActivity('account-a'))?.clientActivityId).toBe(id);
  });
});
