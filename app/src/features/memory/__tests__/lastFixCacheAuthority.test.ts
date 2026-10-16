describe('owner-scoped last GPS fix cache', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadWithStorage(storage: Map<string, string>, setItem?: jest.Mock) {
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      __esModule: true,
      default: {
        getItem: jest.fn(async (key: string) => storage.get(key) ?? null),
        setItem: setItem ?? jest.fn(async (key: string, value: string) => { storage.set(key, value); }),
        removeItem: jest.fn(async (key: string) => { storage.delete(key); }),
      },
    }));
    return require('../services/lastFixCache') as typeof import('../services/lastFixCache');
  }

  test('never returns another owner\'s precise coordinate', async () => {
    const storage = new Map<string, string>();
    const cache = loadWithStorage(storage);
    cache.persistLastFix('owner-a', { lat: -41, lng: 174, ts: Date.now(), accuracyM: 8 });
    await expect(cache.readLastFix('owner-a')).resolves.toMatchObject({ ownerId: 'owner-a', accuracyM: 8 });
    await expect(cache.readLastFix('owner-b')).resolves.toBeNull();
  });

  test('serialized clear wins over an older delayed write', async () => {
    const storage = new Map<string, string>();
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
    const delayedSet = jest.fn(async (key: string, value: string) => {
      await writeGate;
      storage.set(key, value);
    });
    const cache = loadWithStorage(storage, delayedSet);
    cache.persistLastFix('owner-a', { lat: -41, lng: 174, ts: Date.now(), accuracyM: null });
    await Promise.resolve();
    const clearing = cache.clearLastFix('owner-a');
    releaseWrite();
    await clearing;
    await expect(cache.readLastFix('owner-a')).resolves.toBeNull();
  });
});
