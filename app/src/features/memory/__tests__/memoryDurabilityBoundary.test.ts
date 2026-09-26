describe('Memory durable ownership boundary', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.dontMock('../services/memoryPersistence');
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
    jest.doMock('../services/memoryEvidenceJournal', () => ({
      ...jest.requireActual('../services/memoryEvidenceJournal'),
      appendDurableMemoryEvidence: jest.fn(async (input: any) => ({ ...input, v: 1, id: 'event-test' })),
      listDurableMemoryEvidence: jest.fn(async () => []),
      durableMemoryEvidenceDigest: jest.fn(() => '0:0'),
    }));
  });

  test('an evidence callback queued by Account A cannot commit after Account B takes over', async () => {
    let currentUserId = 'account-a';
    let releaseHydrate: () => void = () => {};
    const hydrateGate = new Promise<void>((resolve) => { releaseHydrate = resolve; });
    const points: any[] = [];
    const recordPoint = jest.fn((lat: number, lng: number, ts: number) => {
      points.push({ lat, lng, ts, cid: 'cid-a' });
    });
    const ensureMemoryPersistenceForUser = jest.fn(async () => hydrateGate);
    const flushMemoryNow = jest.fn(async () => {});

    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: {
        getState: () => ({ points, recordPoint }),
      },
    }));
    jest.doMock('../services/memoryPersistence', () => ({
      ensureMemoryPersistenceForUser,
      flushMemoryNow,
      getMemoryOwnerWriteEpoch: jest.fn(() => 0),
    }));
    jest.doMock('../../../services/memorySync', () => ({ attachMemorySync: jest.fn() }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ user: { id: currentUserId } }) },
    }));

    const { recordMemoryEvidence } = require('../services/recordMemoryEvidence');
    const commit = recordMemoryEvidence({ lat: -41, lng: 174, atMs: 1_000, source: 'activity_real' });
    for (let tick = 0; tick < 10 && ensureMemoryPersistenceForUser.mock.calls.length === 0; tick += 1) {
      await Promise.resolve();
    }
    expect(ensureMemoryPersistenceForUser).toHaveBeenCalledWith('account-a');

    currentUserId = 'account-b';
    releaseHydrate();
    await expect(commit).rejects.toThrow('memory_owner_changed');
    expect(recordPoint).not.toHaveBeenCalled();
    expect(flushMemoryNow).not.toHaveBeenCalled();
  });

  test('a validated headless Activity lease commits only its cross-runtime evidence journal', async () => {
    const points: any[] = [];
    const recordPoint = jest.fn((lat: number, lng: number, ts: number) => {
      points.push({ lat, lng, ts, cid: 'headless-cid' });
      return { coverageChanged: true, presenceChanged: true, metadataChanged: true };
    });
    const ensureMemoryPersistenceForUser = jest.fn(async () => undefined);
    const attachMemorySync = jest.fn();
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: {
        getState: () => ({ points, testPoints: [], recordPoint }),
      },
    }));
    jest.doMock('../services/memoryPersistence', () => ({
      ensureMemoryPersistenceForUser,
      flushMemoryNow: jest.fn(async () => undefined),
      flushSyntheticMemoryNow: jest.fn(async () => undefined),
      getMemoryOwnerWriteEpoch: jest.fn(() => 0),
    }));
    jest.doMock('../../../services/memorySync', () => ({ attachMemorySync }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ user: null, isLoggedIn: false }) },
    }));

    const { recordMemoryEvidence } = require('../services/recordMemoryEvidence');
    await expect(recordMemoryEvidence({
      lat: -41,
      lng: 174,
      atMs: 2_000,
      source: 'activity_real',
      ownerUserId: 'account-a',
      ownerAuthority: 'durable_activity_lease',
      sourceActivityClientId: 'activity-a',
      sourceSegmentId: 'segment-a',
      horizontalAccuracyM: 8,
      continuityState: 'accepted',
    })).resolves.toMatchObject({ committed: true, coverageChanged: false });
    expect(ensureMemoryPersistenceForUser).not.toHaveBeenCalled();
    expect(recordPoint).not.toHaveBeenCalled();
    expect(attachMemorySync).not.toHaveBeenCalled();
  });

  test('an Account A journal commit finishing after Account B takes over never enters B memory', async () => {
    let currentUserId = 'account-a';
    let releaseAppend: () => void = () => undefined;
    const appendGate = new Promise<void>(resolve => { releaseAppend = resolve; });
    const appendDurableMemoryEvidence = jest.fn(async (input: any) => {
      await appendGate;
      return { ...input, v: 1, id: 'event-a' };
    });
    const recordPoint = jest.fn();
    const attachMemorySync = jest.fn();
    jest.doMock('../services/memoryEvidenceJournal', () => ({
      ...jest.requireActual('../services/memoryEvidenceJournal'),
      appendDurableMemoryEvidence,
    }));
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => ({ points: [], testPoints: [], recordPoint }) },
    }));
    jest.doMock('../services/memoryPersistence', () => ({
      ensureMemoryPersistenceForUser: jest.fn(async () => undefined),
      flushMemoryNow: jest.fn(async () => undefined),
      flushSyntheticMemoryNow: jest.fn(async () => undefined),
      getMemoryOwnerWriteEpoch: jest.fn(() => 0),
    }));
    jest.doMock('../../../services/memorySync', () => ({ attachMemorySync }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ user: { id: currentUserId } }) },
    }));

    const { recordMemoryEvidence } = require('../services/recordMemoryEvidence');
    const commit = recordMemoryEvidence({
      lat: -41,
      lng: 174,
      atMs: 2_000,
      source: 'activity_real',
      ownerUserId: 'account-a',
      sourceActivityClientId: 'activity-a',
      sourceSegmentId: 'segment-a',
      horizontalAccuracyM: 8,
      continuityState: 'accepted',
    });
    for (let tick = 0; tick < 10 && appendDurableMemoryEvidence.mock.calls.length === 0; tick += 1) {
      await Promise.resolve();
    }
    currentUserId = 'account-b';
    releaseAppend();

    await expect(commit).resolves.toMatchObject({ committed: true, coverageChanged: false });
    expect(appendDurableMemoryEvidence).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'account-a' }));
    expect(recordPoint).not.toHaveBeenCalled();
    expect(attachMemorySync).not.toHaveBeenCalled();
  });

  test('headless authority cannot override a different hydrated account', async () => {
    const recordPoint = jest.fn();
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => ({ points: [], testPoints: [], recordPoint }) },
    }));
    jest.doMock('../services/memoryPersistence', () => ({
      ensureMemoryPersistenceForUser: jest.fn(async () => undefined),
      flushMemoryNow: jest.fn(async () => undefined),
      flushSyntheticMemoryNow: jest.fn(async () => undefined),
      getMemoryOwnerWriteEpoch: jest.fn(() => 0),
    }));
    jest.doMock('../../../services/memorySync', () => ({ attachMemorySync: jest.fn() }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ user: { id: 'account-b' }, isLoggedIn: true }) },
    }));

    const { recordMemoryEvidence } = require('../services/recordMemoryEvidence');
    await expect(recordMemoryEvidence({
      lat: -41,
      lng: 174,
      source: 'activity_real',
      ownerUserId: 'account-a',
      ownerAuthority: 'durable_activity_lease',
    })).rejects.toThrow('memory_owner_changed');
    expect(recordPoint).not.toHaveBeenCalled();
  });

  test('a durable flush propagates a strict storage failure', async () => {
    const setItem = jest.fn(async (_key: string, _value: string, opts?: { strict?: boolean }) => {
      if (opts?.strict) throw new Error('disk-full');
    });
    const memoryState = {
      points: [{ lat: -41, lng: 174, ts: 1_000, cid: 'cid-a', synced: false }],
      initialRevealDone: false,
      resetForUserSwitch: jest.fn(),
      replacePoints: jest.fn(),
    };
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async () => null),
        getItemStrict: jest.fn(async () => null),
        setItem,
      },
    }));
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: {
        getState: () => memoryState,
        subscribe: jest.fn(() => jest.fn()),
      },
    }));
    jest.doMock('../lib/memoryHydrateGate', () => ({
      hasMemoryHydrateFailedBefore: jest.fn(async () => false),
      usesMemoryHydrateRecovery: jest.fn(async () => false),
      markMemoryHydrateRecovery: jest.fn(async () => undefined),
      markMemoryHydrateInProgress: jest.fn(async () => undefined),
      markMemoryHydrateSuccess: jest.fn(async () => undefined),
    }));

    const persistence = require('../services/memoryPersistence');
    await persistence.hydrateMemoryForUser('account-a');
    await expect(persistence.flushMemoryNow()).rejects.toThrow('disk-full');
    expect(setItem).toHaveBeenCalledWith(
      'cairn:memory:tiles:v5:account-a',
      expect.any(String),
      { strict: true },
    );
  });

  test.each([
    ['oversized', 'x'.repeat(500_001)],
    ['corrupt', '{bad-json'],
    [
      'partial',
      JSON.stringify({
        v: 3,
        initialRevealDone: true,
        points: [
          { a: -41, o: 174, t: 1_000, s: 1, c: 'good' },
          { a: 'not-a-coordinate', o: 174, t: 2_000, s: 0, c: 'bad' },
        ],
      }),
    ],
  ])('%s Memory snapshot is preserved while a recovery writer is attached', async (_label, badSnapshot) => {
    const setItem = jest.fn(async () => undefined);
    const subscribe = jest.fn(() => jest.fn());
    const memoryState = {
      points: [],
      initialRevealDone: false,
      resetForUserSwitch: jest.fn(),
      replacePoints: jest.fn(),
    };
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => key === 'cairn:memory:tiles:v5:account-a' ? badSnapshot : null),
        getItemStrict: jest.fn(async (key: string) => key === 'cairn:memory:tiles:v5:account-a' ? badSnapshot : null),
        setItem,
      },
    }));
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => memoryState, subscribe },
    }));
    jest.doMock('../lib/memoryHydrateGate', () => ({
      hasMemoryHydrateFailedBefore: jest.fn(async () => false),
      usesMemoryHydrateRecovery: jest.fn(async () => false),
      markMemoryHydrateRecovery: jest.fn(async () => undefined),
      markMemoryHydrateInProgress: jest.fn(async () => undefined),
      markMemoryHydrateSuccess: jest.fn(async () => undefined),
    }));

    const persistence = require('../services/memoryPersistence');
    await expect(persistence.hydrateMemoryForUser('account-a')).resolves.toBeUndefined();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    await expect(persistence.flushMemoryNow({ coverage: true, presence: false })).resolves.toBeUndefined();
    expect(setItem).toHaveBeenCalledWith(
      'cairn:memory:tiles:recovery-v1:account-a',
      expect.any(String),
      { strict: true },
    );
    expect(setItem).not.toHaveBeenCalledWith(
      'cairn:memory:tiles:v5:account-a',
      expect.any(String),
      expect.anything(),
    );
  });

  test('failed Memory storage read is not treated as valid empty Memory', async () => {
    const subscribe = jest.fn(() => jest.fn());
    const memoryState = {
      points: [],
      initialRevealDone: false,
      resetForUserSwitch: jest.fn(),
      replacePoints: jest.fn(),
    };
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async () => { throw new Error('storage unavailable'); }),
        getItemStrict: jest.fn(async () => { throw new Error('storage unavailable'); }),
        setItem: jest.fn(async () => undefined),
      },
    }));
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => memoryState, subscribe },
    }));
    jest.doMock('../lib/memoryHydrateGate', () => ({
      hasMemoryHydrateFailedBefore: jest.fn(async () => false),
      usesMemoryHydrateRecovery: jest.fn(async () => false),
      markMemoryHydrateRecovery: jest.fn(async () => undefined),
      markMemoryHydrateInProgress: jest.fn(async () => undefined),
      markMemoryHydrateSuccess: jest.fn(async () => undefined),
    }));

    const persistence = require('../services/memoryPersistence');
    await expect(persistence.hydrateMemoryForUser('account-a')).rejects.toThrow('storage unavailable');
    expect(subscribe).not.toHaveBeenCalled();
  });
});
