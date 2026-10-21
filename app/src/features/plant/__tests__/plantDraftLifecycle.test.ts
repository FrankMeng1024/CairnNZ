import {
  claimPlantDraftSession,
  persistPlantDraft,
  plantDraftStorageKey,
  readPlantDraft,
  releasePlantDraftSession,
  removePlantDraftIfSessionMatches,
  resetPlantDraftLifecycleForTests,
} from '../plantDraftLifecycle';

describe('Plant draft identity and storage serialization', () => {
  beforeEach(() => resetPlantDraftLifecycleForTests());

  test('an older completion cannot overwrite or delete the newer session draft', async () => {
    const values = new Map<string, string>();
    let releaseOldWrite!: () => void;
    const oldWriteGate = new Promise<void>(resolve => { releaseOldWrite = resolve; });
    const key = plantDraftStorageKey('owner-a', { kind: 'standalone' });
    const storage = {
      getItem: jest.fn(async (item: string) => values.get(item) ?? null),
      setItem: jest.fn(async (item: string, value: string) => {
        if (JSON.parse(value).sessionId === 'old-session') {
          await oldWriteGate;
        }
        values.set(item, value);
      }),
      removeItem: jest.fn(async (item: string) => { values.delete(item); }),
    };

    claimPlantDraftSession(key, 'old-session');
    const oldWrite = persistPlantDraft(storage, key, 'old-session', JSON.stringify({ sessionId: 'old-session' }));
    await Promise.resolve();
    claimPlantDraftSession(key, 'new-session');
    const newWrite = persistPlantDraft(storage, key, 'new-session', JSON.stringify({ sessionId: 'new-session' }));
    releaseOldWrite();
    await Promise.all([oldWrite, newWrite]);

    expect(JSON.parse((await readPlantDraft(storage, key))!)).toEqual({ sessionId: 'new-session' });
    await expect(removePlantDraftIfSessionMatches(
      storage, key, 'old-session', 'old-session',
    )).resolves.toBe(false);
    expect(JSON.parse((await readPlantDraft(storage, key))!)).toEqual({ sessionId: 'new-session' });
  });

  test('the owning session can remove only its exact persisted envelope', async () => {
    const values = new Map<string, string>();
    const key = plantDraftStorageKey('owner-a', {
      kind: 'activity', clientActivityId: 'activity-a',
      ownerGeneration: 'generation-a', activityMode: 'hiking',
    });
    const storage = {
      getItem: async (item: string) => values.get(item) ?? null,
      setItem: async (item: string, value: string) => { values.set(item, value); },
      removeItem: async (item: string) => { values.delete(item); },
    };
    claimPlantDraftSession(key, 'session-a');
    await persistPlantDraft(storage, key, 'session-a', JSON.stringify({ sessionId: 'session-a' }));
    await expect(removePlantDraftIfSessionMatches(
      storage, key, 'session-a', 'session-a',
    )).resolves.toBe(true);
    expect(await readPlantDraft(storage, key)).toBeNull();
    releasePlantDraftSession(key, 'session-a');
  });

  test('an older save failure cannot restore its draft after the newer editor closes', async () => {
    const values = new Map<string, string>();
    const key = plantDraftStorageKey('owner-a', { kind: 'standalone' });
    const storage = {
      getItem: async (item: string) => values.get(item) ?? null,
      setItem: async (item: string, value: string) => { values.set(item, value); },
      removeItem: async (item: string) => { values.delete(item); },
    };

    claimPlantDraftSession(key, 'old-session');
    claimPlantDraftSession(key, 'new-session');
    await expect(persistPlantDraft(
      storage, key, 'new-session', JSON.stringify({ sessionId: 'new-session', title: 'newer' }),
    )).resolves.toBe(true);
    releasePlantDraftSession(key, 'new-session');

    // This models an old commit rejecting after the replacement editor has
    // already saved and closed, followed by the old failure-recovery write.
    await expect(persistPlantDraft(
      storage, key, 'old-session', JSON.stringify({ sessionId: 'old-session', title: 'older' }),
    )).resolves.toBe(false);
    expect(JSON.parse((await readPlantDraft(storage, key))!)).toEqual({
      sessionId: 'new-session', title: 'newer',
    });
  });

  test('the newest interrupted editor can finish its unmount flush after release', async () => {
    const values = new Map<string, string>();
    const key = plantDraftStorageKey('owner-a', { kind: 'standalone' });
    let releaseQueue!: () => void;
    const queueGate = new Promise<void>(resolve => { releaseQueue = resolve; });
    const storage = {
      getItem: async (item: string) => values.get(item) ?? null,
      setItem: async (item: string, value: string) => { values.set(item, value); },
      removeItem: async (item: string) => { values.delete(item); },
    };

    claimPlantDraftSession(key, 'latest-session');
    const queued = (async () => {
      await queueGate;
      return persistPlantDraft(
        storage, key, 'latest-session',
        JSON.stringify({ sessionId: 'latest-session', title: 'recover me' }),
      );
    })();
    releasePlantDraftSession(key, 'latest-session');
    releaseQueue();

    await expect(queued).resolves.toBe(true);
    expect(JSON.parse((await readPlantDraft(storage, key))!)).toEqual({
      sessionId: 'latest-session', title: 'recover me',
    });
  });
});
