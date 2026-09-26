const files = new Map<string, string>();
const directories = new Set<string>();
const values = new Map<string, string>();
let blockNextCoverageWrite = false;
let coverageWriteEntered: (() => void) | null = null;
let releaseCoverageWrite: (() => void) | null = null;
let mountedPersistence: any = null;

function installMocks(): void {
  jest.doMock('expo-file-system/legacy', () => {
    const api = {
      documentDirectory: 'doc://',
      getInfoAsync: jest.fn(async (path: string) => ({
        exists: path.endsWith('/') ? directories.has(path) : files.has(path),
      })),
      makeDirectoryAsync: jest.fn(async (path: string) => { directories.add(path.endsWith('/') ? path : `${path}/`); }),
      writeAsStringAsync: jest.fn(async (path: string, value: string) => { files.set(path, value); }),
      readAsStringAsync: jest.fn(async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error('missing');
        return value;
      }),
      readDirectoryAsync: jest.fn(async (path: string) => [...files.keys()]
        .filter(key => key.startsWith(path))
        .map(key => key.slice(path.length))
        .filter(name => name.length > 0 && !name.includes('/'))),
      deleteAsync: jest.fn(async (path: string) => {
        if (path.endsWith('/')) {
          for (const key of [...files.keys()]) if (key.startsWith(path)) files.delete(key);
          directories.delete(path);
        } else {
          files.delete(path);
        }
      }),
      moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
        const value = files.get(from);
        if (value === undefined) throw new Error('missing-stage');
        files.set(to, value);
        files.delete(from);
      }),
    };
    return { __esModule: true, ...api, default: api };
  });
  jest.doMock('../../../store/storage', () => ({
    storage: {
      getItem: jest.fn(async (key: string) => values.get(key) ?? null),
      getItemStrict: jest.fn(async (key: string) => values.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        if (blockNextCoverageWrite && key.startsWith('cairn:memory:tiles:v5:')) {
          blockNextCoverageWrite = false;
          coverageWriteEntered?.();
          await new Promise<void>(resolve => { releaseCoverageWrite = resolve; });
        }
        values.set(key, value);
      }),
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
}

function loadMountedRuntime(): { store: any; persistence: any } {
  let store: any;
  let persistence: any;
  jest.isolateModules(() => {
    store = require('../store/useMemoryStore').useMemoryStore;
    persistence = require('../services/memoryPersistence');
  });
  mountedPersistence = persistence;
  return { store, persistence };
}

async function appendFromIsolatedRuntime(ownerUserId: string, atMs: number, lat: number): Promise<void> {
  let append: any;
  jest.isolateModules(() => {
    append = require('../services/memoryEvidenceJournal').appendDurableMemoryEvidence;
  });
  await append({
    ownerUserId,
    lat,
    lng: 170,
    atMs,
    source: 'activity_real',
    sourceActivityClientId: 'activity-a',
    sourceSegmentId: 'segment-a',
    horizontalAccuracyM: 7,
    continuityState: 'accepted',
  });
}

describe('Memory cross-runtime persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    files.clear();
    directories.clear();
    values.clear();
    blockNextCoverageWrite = false;
    coverageWriteEntered = null;
    releaseCoverageWrite = null;
    mountedPersistence = null;
    installMocks();
  });

  afterEach(async () => {
    releaseCoverageWrite?.();
    await mountedPersistence?.detachMemoryPersistence();
    // replacePoints intentionally defers the H3 cache rebuild by 100 ms.
    await new Promise(resolve => setTimeout(resolve, 120));
    jest.resetModules();
  });

  test('a mounted stale snapshot cannot erase a headless Activity event', async () => {
    const mounted = loadMountedRuntime();
    await mounted.persistence.hydrateMemoryForUser('account-a');
    mounted.store.getState().recordPoint(-45, 170, 1_000, {
      source: 'passive_real', horizontalAccuracyM: 7, continuityState: 'accepted',
    });
    await mounted.persistence.flushMemoryNow();

    await appendFromIsolatedRuntime('account-a', 20_000, -44.99);
    expect(mounted.store.getState().points).toHaveLength(1);

    await mounted.persistence.flushMemoryNow();
    expect(mounted.store.getState().points).toHaveLength(2);
    const persisted = JSON.parse(values.get('cairn:memory:tiles:v5:account-a') ?? '{}');
    expect(persisted.points).toHaveLength(2);
  });

  test('an event committed while a stale write is blocked is found by post-write verification', async () => {
    const mounted = loadMountedRuntime();
    await mounted.persistence.hydrateMemoryForUser('account-a');
    mounted.store.getState().recordPoint(-45, 170, 1_000, {
      source: 'passive_real', horizontalAccuracyM: 7, continuityState: 'accepted',
    });

    let enteredResolve: () => void = () => undefined;
    const entered = new Promise<void>(resolve => { enteredResolve = resolve; });
    coverageWriteEntered = enteredResolve;
    blockNextCoverageWrite = true;
    const staleFlush = mounted.persistence.flushMemoryNow();
    await entered;
    await appendFromIsolatedRuntime('account-a', 30_000, -44.98);
    releaseCoverageWrite?.();
    await staleFlush;

    expect(mounted.store.getState().points).toHaveLength(2);
    const persisted = JSON.parse(values.get('cairn:memory:tiles:v5:account-a') ?? '{}');
    expect(persisted.points).toHaveLength(2);
  });

  test('owner-scoped journals never cross an account switch', async () => {
    await appendFromIsolatedRuntime('account-a', 20_000, -44.99);
    const mounted = loadMountedRuntime();
    await mounted.persistence.hydrateMemoryForUser('account-b');
    await mounted.persistence.flushMemoryNow();
    expect(mounted.store.getState().points).toEqual([]);
    const persistedB = JSON.parse(values.get('cairn:memory:tiles:v5:account-b') ?? '{}');
    expect(persistedB.points).toEqual([]);
  });

  test('owner purge blocks stale evidence replay without touching another account', async () => {
    const journal = require('../services/memoryEvidenceJournal');
    const now = Date.now();
    await journal.appendDurableMemoryEvidence({
      ownerUserId: 'account-a', lat: -45, lng: 170, atMs: now - 2_000,
      source: 'passive_real', horizontalAccuracyM: 7, continuityState: 'accepted',
    });
    await journal.appendDurableMemoryEvidence({
      ownerUserId: 'account-b', lat: -44, lng: 171, atMs: now - 1_000,
      source: 'passive_real', horizontalAccuracyM: 7, continuityState: 'accepted',
    });

    await journal.purgeDurableMemoryEvidence('account-a');
    await expect(journal.listDurableMemoryEvidence('account-a')).resolves.toEqual([]);
    await expect(journal.listDurableMemoryEvidence('account-b')).resolves.toHaveLength(1);
    await expect(journal.appendDurableMemoryEvidence({
      ownerUserId: 'account-a', lat: -45, lng: 170, atMs: now - 500,
      source: 'passive_real', horizontalAccuracyM: 7, continuityState: 'accepted',
    })).rejects.toThrow('memory_evidence_purged');
    await expect(journal.appendDurableMemoryEvidence({
      ownerUserId: 'account-a', lat: -45.1, lng: 170, atMs: Date.now() + 1_000,
      source: 'passive_real', horizontalAccuracyM: 7, continuityState: 'accepted',
    })).resolves.toMatchObject({ ownerUserId: 'account-a' });
  });

  test('a long mutable tail compacts into an immutable segment without losing evidence', async () => {
    const journal = require('../services/memoryEvidenceJournal');
    for (let index = 0; index < 130; index += 1) {
      await journal.appendDurableMemoryEvidence({
        ownerUserId: 'account-a',
        lat: -45 + index * 0.0001,
        lng: 170,
        atMs: 10_000 + index,
        source: 'activity_real',
        sourceActivityClientId: 'activity-long',
        sourceSegmentId: 'segment-a',
        horizontalAccuracyM: 7,
        continuityState: 'accepted',
      });
    }
    await expect(journal.compactDurableMemoryEvidence('account-a')).resolves.toBe(130);
    await expect(journal.listDurableMemoryEvidence('account-a')).resolves.toHaveLength(130);
    const committedFiles = [...files.keys()].filter(path => path.endsWith('.json'));
    expect(committedFiles.filter(path => path.includes('/segment-'))).toHaveLength(1);
    expect(committedFiles.filter(path => !path.includes('/segment-'))).toHaveLength(0);
  });
});
