describe('Memory durable ownership boundary', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.dontMock('../services/memoryPersistence');
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
    }));
    jest.doMock('../../../services/memorySync', () => ({ attachMemorySync: jest.fn() }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ user: { id: currentUserId } }) },
    }));

    const { recordMemoryEvidence } = require('../services/recordMemoryEvidence');
    const commit = recordMemoryEvidence({ lat: -41, lng: 174, atMs: 1_000, source: 'activity' });
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
      hasMemoryHydrateFailedBefore: jest.fn(() => false),
      markMemoryHydrateInProgress: jest.fn(),
      markMemoryHydrateSuccess: jest.fn(),
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
    ['oversized', async () => 'x'.repeat(500_001), 'memory_hydration_payload_too_large'],
    ['corrupt', async () => '{bad-json', 'memory_hydration_corrupt_or_partial'],
    [
      'partial',
      async () => JSON.stringify({
        v: 3,
        initialRevealDone: true,
        points: [
          { a: -41, o: 174, t: 1_000, s: 1, c: 'good' },
          { a: 'not-a-coordinate', o: 174, t: 2_000, s: 0, c: 'bad' },
        ],
      }),
      'memory_hydration_corrupt_or_partial',
    ],
  ])('%s Memory hydration never attaches an empty writer', async (_label, readValue, expected) => {
    const setItem = jest.fn(async () => undefined);
    const subscribe = jest.fn(() => jest.fn());
    const memoryState = {
      points: [],
      initialRevealDone: false,
      resetForUserSwitch: jest.fn(),
      replacePoints: jest.fn(),
    };
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(readValue), setItem },
    }));
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => memoryState, subscribe },
    }));
    jest.doMock('../lib/memoryHydrateGate', () => ({
      hasMemoryHydrateFailedBefore: jest.fn(() => false),
      markMemoryHydrateInProgress: jest.fn(async () => undefined),
      markMemoryHydrateSuccess: jest.fn(async () => undefined),
    }));

    const persistence = require('../services/memoryPersistence');
    await expect(persistence.hydrateMemoryForUser('account-a')).rejects.toThrow(expected);
    expect(subscribe).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    await expect(persistence.flushMemoryNow()).rejects.toThrow('memory_persistence_unavailable');
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
        setItem: jest.fn(async () => undefined),
      },
    }));
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => memoryState, subscribe },
    }));
    jest.doMock('../lib/memoryHydrateGate', () => ({
      hasMemoryHydrateFailedBefore: jest.fn(() => false),
      markMemoryHydrateInProgress: jest.fn(async () => undefined),
      markMemoryHydrateSuccess: jest.fn(async () => undefined),
    }));

    const persistence = require('../services/memoryPersistence');
    await expect(persistence.hydrateMemoryForUser('account-a')).rejects.toThrow('memory_hydration_read_failed');
    expect(subscribe).not.toHaveBeenCalled();
  });
});
