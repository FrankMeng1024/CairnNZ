describe('Memory presence persistence boundary', () => {
  beforeEach(() => {
    jest.doMock('../services/memoryEvidenceJournal', () => ({
      ...jest.requireActual('../services/memoryEvidenceJournal'),
      listDurableMemoryEvidence: jest.fn(async () => []),
      durableMemoryEvidenceDigest: jest.fn(() => '0:0'),
      compactDurableMemoryEvidence: jest.fn(async () => 0),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('offline witnesses survive relaunch and a presence-only return does not rewrite coverage', async () => {
    const values = new Map<string, string>();
    const setItem = jest.fn(async (key: string, value: string) => { values.set(key, value); });
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => values.get(key) ?? null),
        getItemStrict: jest.fn(async (key: string) => values.get(key) ?? null),
        setItem,
      },
    }));
    jest.doMock('../store/useH3VisitedStore', () => ({
      useH3VisitedStore: { getState: () => ({ addPointToCells: jest.fn(), clear: jest.fn(), bulkImport: jest.fn() }) },
    }));
    jest.doMock('../services/lastFixCache', () => ({ persistLastFix: jest.fn() }));
    jest.doMock('../lib/memoryHydrateGate', () => ({
      hasMemoryHydrateFailedBefore: jest.fn(async () => false),
      usesMemoryHydrateRecovery: jest.fn(async () => false),
      markMemoryHydrateRecovery: jest.fn(async () => undefined),
      markMemoryHydrateInProgress: jest.fn(async () => undefined),
      markMemoryHydrateSuccess: jest.fn(async () => undefined),
    }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));

    const { useMemoryStore } = require('../store/useMemoryStore');
    const persistence = require('../services/memoryPersistence');
    persistence.resetMemoryPersistenceMetrics();
    await persistence.hydrateMemoryForUser('account-a');
    const day = 24 * 60 * 60 * 1000;
    useMemoryStore.getState().recordPoint(-45, 170, day, {
      source: 'passive_real', horizontalAccuracyM: 7, continuityState: 'accepted',
    });
    await persistence.flushMemoryNow();
    expect(values.has('cairn:memory:tiles:v5:account-a')).toBe(true);
    expect(values.has('cairn:memory:presence:v1:account-a')).toBe(true);
    expect(persistence.getMemoryPersistenceMetrics()).toMatchObject({
      coverageWrites: 1,
      presenceWrites: 1,
    });

    setItem.mockClear();
    const returned = useMemoryStore.getState().recordPoint(-45, 170, day * 4, {
      source: 'passive_real', horizontalAccuracyM: 6, continuityState: 'accepted',
    });
    expect(returned).toMatchObject({ coverageChanged: false, presenceChanged: true });
    await persistence.flushMemoryNow({ coverage: false, presence: true });
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0][0]).toBe('cairn:memory:presence:v1:account-a');
    expect(persistence.getMemoryPersistenceMetrics()).toMatchObject({
      coverageWrites: 1,
      presenceWrites: 2,
    });

    await persistence.detachMemoryPersistence();
    useMemoryStore.getState().resetForUserSwitch();
    await persistence.hydrateMemoryForUser('account-a');
    expect(useMemoryStore.getState().points).toHaveLength(1);
    expect(useMemoryStore.getState().presenceWitnesses.map((witness: any) => witness.observedAtMs))
      .toEqual([day, day * 4]);
    await new Promise(resolve => setTimeout(resolve, 120));
  });

  test('isolated Raw GPS Memory survives reload without entering personal coverage or presence', async () => {
    const values = new Map<string, string>();
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => values.get(key) ?? null),
        getItemStrict: jest.fn(async (key: string) => values.get(key) ?? null),
        setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
      },
    }));
    jest.doMock('../store/useH3VisitedStore', () => ({
      useH3VisitedStore: { getState: () => ({ addPointToCells: jest.fn(), clear: jest.fn(), bulkImport: jest.fn() }) },
    }));
    jest.doMock('../services/lastFixCache', () => ({ persistLastFix: jest.fn() }));
    jest.doMock('../lib/memoryHydrateGate', () => ({
      hasMemoryHydrateFailedBefore: jest.fn(async () => false),
      usesMemoryHydrateRecovery: jest.fn(async () => false),
      markMemoryHydrateRecovery: jest.fn(async () => undefined),
      markMemoryHydrateInProgress: jest.fn(async () => undefined),
      markMemoryHydrateSuccess: jest.fn(async () => undefined),
    }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));

    const { useMemoryStore } = require('../store/useMemoryStore');
    const persistence = require('../services/memoryPersistence');
    await persistence.hydrateMemoryForUser('qa-account');
    useMemoryStore.getState().recordPoint(-45.0312, 168.6626, 1_800_000_000_000, {
      source: 'simulator_test',
      sourceActivityClientId: 'qa-activity',
      horizontalAccuracyM: 14,
      continuityState: 'accepted',
    });
    await persistence.flushSyntheticMemoryNow();

    expect(values.has('cairn:memory:synthetic:v1:qa-account')).toBe(true);
    expect(useMemoryStore.getState()).toMatchObject({
      points: [],
      presenceWitnesses: [],
    });
    expect(useMemoryStore.getState().testPoints).toHaveLength(1);

    await persistence.detachMemoryPersistence();
    useMemoryStore.getState().resetForUserSwitch();
    await persistence.hydrateMemoryForUser('qa-account');
    expect(useMemoryStore.getState()).toMatchObject({
      points: [],
      presenceWitnesses: [],
    });
    expect(useMemoryStore.getState().testPoints).toEqual([
      expect.objectContaining({
        lat: -45.0312,
        lng: 168.6626,
        ts: 1_800_000_000_000,
        evidenceSource: 'simulator_test',
      }),
    ]);
    await persistence.detachMemoryPersistence();
  });

  test('corrupt presence bytes stay quarantined while new evidence uses recovery keys', async () => {
    const originalPresence = '{corrupt-owner-evidence';
    const values = new Map<string, string>([
      ['cairn:memory:tiles:v5:account-a', JSON.stringify({
        v: 4,
        initialRevealDone: true,
        points: [{ a: -45, o: 170, t: 1_000, s: 1, c: 'coverage-a', e: 'h', n: 'u' }],
      })],
      ['cairn:memory:presence:v1:account-a', originalPresence],
    ]);
    const setItem = jest.fn(async (key: string, value: string) => { values.set(key, value); });
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => values.get(key) ?? null),
        getItemStrict: jest.fn(async (key: string) => values.get(key) ?? null),
        setItem,
      },
    }));
    jest.doMock('../store/useH3VisitedStore', () => ({
      useH3VisitedStore: { getState: () => ({ addPointToCells: jest.fn(), clear: jest.fn(), bulkImport: jest.fn() }) },
    }));
    jest.doMock('../services/lastFixCache', () => ({ persistLastFix: jest.fn() }));
    jest.doMock('../lib/memoryHydrateGate', () => ({
      hasMemoryHydrateFailedBefore: jest.fn(async () => false),
      usesMemoryHydrateRecovery: jest.fn(async () => false),
      markMemoryHydrateRecovery: jest.fn(async () => undefined),
      markMemoryHydrateInProgress: jest.fn(async () => undefined),
      markMemoryHydrateSuccess: jest.fn(async () => undefined),
    }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));

    const { useMemoryStore } = require('../store/useMemoryStore');
    const persistence = require('../services/memoryPersistence');
    await expect(persistence.hydrateMemoryForUser('account-a')).resolves.toBeUndefined();
    expect(useMemoryStore.getState().points).toHaveLength(1);
    expect(useMemoryStore.getState().presenceWitnesses).toEqual([]);

    useMemoryStore.getState().recordPoint(-45.002, 170.002, 172_800_000, {
      source: 'passive_real', horizontalAccuracyM: 8, continuityState: 'accepted',
    });
    await persistence.flushMemoryNow({ coverage: false, presence: true });

    expect(values.get('cairn:memory:presence:v1:account-a')).toBe(originalPresence);
    expect(values.get('cairn:memory:presence:recovery-v1:account-a')).toContain('"v":1');
    expect(setItem).not.toHaveBeenCalledWith(
      'cairn:memory:presence:v1:account-a',
      expect.any(String),
      expect.anything(),
    );
    await persistence.detachMemoryPersistence();
    await new Promise(resolve => setTimeout(resolve, 120));
  });
});
