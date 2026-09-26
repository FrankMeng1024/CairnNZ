describe('Memory server reconciliation', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('an empty server snapshot drops synced cache but preserves offline unsynced evidence', async () => {
    const synced = { lat: -41, lng: 174, ts: 1_000, cid: 'synced', synced: true };
    const unsynced = { lat: -41.001, lng: 174.001, ts: 2_000, cid: 'unsynced', synced: false };
    const state: any = {
      points: [synced, unsynced],
      initialRevealDone: true,
      _unsyncedCount: 0,
      bumpInFlight: jest.fn(),
      replacePoints: jest.fn((points: any[]) => { state.points = points; }),
    };
    const subscribe = jest.fn(() => jest.fn());
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: {
        getState: () => state,
        subscribe,
      },
    }));
    jest.doMock('../../../services/apiService', () => ({
      authenticatedFetch: jest.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ points: [] }),
      })),
    }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
    jest.doMock('../../../services/appLog', () => ({ log: jest.fn() }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: 'account-a' } }) },
    }));

    const memorySync = require('../../../services/memorySync');
    memorySync.attachMemorySync('account-a');
    await memorySync.pullMemoryFromServer('account-a', { reconcile: true });
    memorySync.detachMemorySync();

    expect(state.replacePoints).toHaveBeenCalledWith([unsynced], true);
    expect(state.points).toEqual([unsynced]);
  });

  test('a final 401 pauses push retries until authentication is refreshed', async () => {
    jest.useFakeTimers();
    const pending = { lat: -41, lng: 174, ts: 1_000, cid: 'offline', synced: false };
    const state: any = {
      points: [pending],
      _unsyncedCount: 1,
      bumpInFlight: jest.fn(),
      applyServerEchoForPushAligned: jest.fn(),
    };
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: {
        getState: () => state,
        subscribe: jest.fn(() => jest.fn()),
      },
    }));
    const authenticatedFetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({}),
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
    jest.doMock('../../../services/appLog', () => ({ log: jest.fn() }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: 'account-a' } }) },
    }));

    const memorySync = require('../../../services/memorySync');
    memorySync.attachMemorySync('account-a');
    await memorySync.pushMemoryNow();
    await memorySync.pushMemoryNow();
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    expect(memorySync.getMemorySyncMetrics().authBlocked).toBe(true);

    memorySync.notifyMemoryAuthRefreshed('account-a');
    await memorySync.pushMemoryNow();
    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    memorySync.detachMemorySync();
    jest.useRealTimers();
  });

  test('presence-only sync preserves original observation time and does not require a coverage-length change', async () => {
    const witness = {
      cid: '11111111-1111-4111-8111-111111111111',
      firstLat: -45.031,
      firstLng: 168.662,
      firstObservedAtMs: 1_700_000_000_000,
      lat: -45.03101,
      lng: 168.66201,
      observedAtMs: 1_700_000_015_000,
      evidenceSource: 'passive_real',
      sourceActivityClientId: undefined,
      horizontalAccuracyM: 8,
      continuityState: 'accepted',
      synced: false,
    };
    const state: any = {
      points: [],
      presenceWitnesses: [witness],
      _unsyncedCount: 0,
      _unsyncedPresenceCount: 1,
      bumpInFlight: jest.fn(),
      applyServerEchoForPushAligned: jest.fn(),
      markPresenceWitnessesSynced: jest.fn(),
    };
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: {
        getState: () => state,
        subscribe: jest.fn(() => jest.fn()),
      },
    }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: 'account-a' } }) },
    }));
    let uploadedBody: any;
    const authenticatedFetch = jest.fn(async (_path: string, init: any) => {
      uploadedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          points: [],
          presence_witnesses: [{ cid: witness.cid, observed_at_ms: witness.observedAtMs }],
        }),
      };
    });
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
    jest.doMock('../../../services/appLog', () => ({ log: jest.fn() }));

    const memorySync = require('../../../services/memorySync');
    memorySync.attachMemorySync('account-a');
    await memorySync.pushMemoryNow();
    memorySync.detachMemorySync();

    expect(uploadedBody.points).toEqual([]);
    expect(uploadedBody.presence_witnesses[0]).toMatchObject({
      first_observed_at_ms: witness.firstObservedAtMs,
      observed_at_ms: witness.observedAtMs,
      evidence_source: 'passive_real',
    });
    expect(state.markPresenceWitnessesSynced).toHaveBeenCalledWith([witness], [witness.cid]);
    expect(memorySync.getMemorySyncMetrics()).toMatchObject({
      pushedPoints: 0,
      pushedPresenceWitnesses: 1,
    });
  });

  test('SET/DELETE-OWNER-01 a delayed A deletion cannot clear hydrated B Memory', async () => {
    let liveOwner = 'account-a';
    let releaseDelete!: (response: any) => void;
    const delayedDelete = new Promise<any>(resolve => { releaseDelete = resolve; });
    const state: any = {
      points: [{ cid: 'a-memory' }],
      presenceWitnesses: [],
      _unsyncedCount: 0,
      _unsyncedPresenceCount: 0,
      clearAll: jest.fn(() => { state.points = []; }),
    };
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: {
        getState: () => state,
        subscribe: jest.fn(() => jest.fn()),
      },
    }));
    const authenticatedFetch = jest.fn(() => delayedDelete);
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
    jest.doMock('../../../services/appLog', () => ({ log: jest.fn() }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: liveOwner } }) },
    }));

    const memorySync = require('../../../services/memorySync');
    memorySync.attachMemorySync('account-a');
    const deletion = memorySync.deleteAllMemoryFromServer('account-a');
    for (let attempt = 0; attempt < 10 && authenticatedFetch.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(authenticatedFetch).toHaveBeenCalledWith(
      '/api/memory/points',
      expect.objectContaining({ method: 'DELETE', expectedUserId: 'account-a' }),
    );

    liveOwner = 'account-b';
    memorySync.detachMemorySync();
    state.points = [{ cid: 'b-hydrated-memory' }];
    memorySync.attachMemorySync('account-b');
    releaseDelete({ ok: true });

    await expect(deletion).resolves.toBe(false);
    expect(state.clearAll).not.toHaveBeenCalled();
    expect(state.points).toEqual([{ cid: 'b-hydrated-memory' }]);
    memorySync.detachMemorySync();
  });

  test('MEM-SYNC-PARTIAL-01 a partial 2xx echo retains unacknowledged evidence and is retryable', async () => {
    jest.useFakeTimers();
    const pending = { lat: -41, lng: 174, ts: 1_000, cid: 'pending-a', synced: false };
    const state: any = {
      points: [pending],
      presenceWitnesses: [],
      _unsyncedCount: 1,
      _unsyncedPresenceCount: 0,
      bumpInFlight: jest.fn(),
      applyServerEchoForPushAligned: jest.fn(),
      markPresenceWitnessesSynced: jest.fn(),
    };
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => state, subscribe: jest.fn(() => jest.fn()) },
    }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: 'account-a' } }) },
    }));
    const authenticatedFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ points: [null], presence_witnesses: [] }),
    }));
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
    jest.doMock('../../../services/appLog', () => ({ log: jest.fn() }));

    const memorySync = require('../../../services/memorySync');
    memorySync.attachMemorySync('account-a');
    await expect(memorySync.pushMemoryNow()).resolves.toMatchObject({ status: 'failed' });
    expect(state.applyServerEchoForPushAligned).toHaveBeenCalledWith([pending], [null]);
    expect(state.points[0].synced).toBe(false);
    memorySync.detachMemorySync();
    jest.useRealTimers();
  });

  test('MEM-PULL-MALFORMED-01 a malformed reconcile page cannot wipe the local projection', async () => {
    jest.useFakeTimers();
    const existing = { lat: -41, lng: 174, ts: 1_000, cid: 'existing', synced: true };
    const state: any = {
      points: [existing],
      initialRevealDone: true,
      localHydration: {
        ownerUserId: 'account-a', status: 'ready', requiresInitialReconcile: true,
        initialReconcile: 'pending', revision: 1,
      },
      _unsyncedCount: 0,
      _unsyncedPresenceCount: 0,
      bumpInFlight: jest.fn(),
      replacePoints: jest.fn(),
    };
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => state, subscribe: jest.fn(() => jest.fn()) },
    }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: 'account-a' } }) },
    }));
    jest.doMock('../../../services/apiService', () => ({
      authenticatedFetch: jest.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ points: [{ lat: -41, lng: 174, ts: 2_000 }] }),
      })),
    }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
    jest.doMock('../../../services/appLog', () => ({ log: jest.fn() }));

    const memorySync = require('../../../services/memorySync');
    memorySync.attachMemorySync('account-a');
    await memorySync.pullMemoryFromServer('account-a', { reconcile: true });
    expect(state.replacePoints).not.toHaveBeenCalled();
    expect(state.points).toEqual([existing]);
    memorySync.detachMemorySync();
    jest.useRealTimers();
  });

  test('MEM-SYNC-OWNER-02 a delayed A push response cannot acknowledge under B', async () => {
    let liveOwner = 'account-a';
    let release!: (response: any) => void;
    const response = new Promise<any>(resolve => { release = resolve; });
    const pending = { lat: -41, lng: 174, ts: 1_000, cid: 'pending-a', synced: false };
    const state: any = {
      points: [pending], presenceWitnesses: [], _unsyncedCount: 1, _unsyncedPresenceCount: 0,
      bumpInFlight: jest.fn(), applyServerEchoForPushAligned: jest.fn(),
      markPresenceWitnessesSynced: jest.fn(),
    };
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => state, subscribe: jest.fn(() => jest.fn()) },
    }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: liveOwner } }) },
    }));
    const authenticatedFetch = jest.fn(() => response);
    jest.doMock('../../../services/apiService', () => ({ authenticatedFetch }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
    jest.doMock('../../../services/appLog', () => ({ log: jest.fn() }));

    const memorySync = require('../../../services/memorySync');
    memorySync.attachMemorySync('account-a');
    const push = memorySync.pushMemoryNow();
    await Promise.resolve();
    liveOwner = 'account-b';
    release({
      ok: true,
      status: 200,
      json: async () => ({
        points: [{ batch_index: 0, ts: pending.ts, cid: pending.cid }],
        presence_witnesses: [],
      }),
    });
    await expect(push).resolves.toMatchObject({ status: 'owner_mismatch' });
    expect(state.applyServerEchoForPushAligned).not.toHaveBeenCalled();
    memorySync.detachMemorySync();
  });

  test('MEM-RESET-PURGE-01 a journal purge failure cannot clear local snapshots or claim success', async () => {
    const state: any = {
      points: [{ cid: 'preserve-me', synced: true }],
      presenceWitnesses: [], _unsyncedCount: 0, _unsyncedPresenceCount: 0,
      clearAll: jest.fn(),
    };
    jest.doMock('../store/useMemoryStore', () => ({
      useMemoryStore: { getState: () => state, subscribe: jest.fn(() => jest.fn()) },
    }));
    jest.doMock('../../../store/useAppStore', () => ({
      useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: 'account-a' } }) },
    }));
    jest.doMock('../../../services/apiService', () => ({
      authenticatedFetch: jest.fn(async () => ({ ok: true, status: 200 })),
    }));
    const commitMemoryPersistenceReset = jest.fn(async () => undefined);
    const flushMemoryNow = jest.fn(async () => undefined);
    jest.doMock('../services/memoryPersistence', () => ({
      beginMemoryPersistenceReset: jest.fn(() => 3),
      commitMemoryPersistenceReset,
      flushMemoryNow,
    }));
    jest.doMock('../services/memoryEvidenceJournal', () => ({
      purgeDurableMemoryEvidence: jest.fn(async () => { throw new Error('purge-failed'); }),
    }));
    jest.doMock('../services/fogDisplayCache', () => ({ purgeFogDisplayCache: jest.fn() }));
    jest.doMock('../services/h3Persistence', () => ({ resetH3PersistenceForUser: jest.fn() }));
    jest.doMock('../../../services/bootDiagnostics', () => ({ markBootPhase: jest.fn() }));
    jest.doMock('../../../services/appLog', () => ({ log: jest.fn() }));

    const memorySync = require('../../../services/memorySync');
    memorySync.attachMemorySync('account-a');
    await expect(memorySync.deleteAllMemoryFromServer('account-a')).resolves.toBe(false);
    expect(commitMemoryPersistenceReset).not.toHaveBeenCalled();
    expect(state.clearAll).not.toHaveBeenCalled();
    expect(state.points).toEqual([{ cid: 'preserve-me', synced: true }]);
    expect(flushMemoryNow).toHaveBeenCalled();
    memorySync.detachMemorySync();
  });
});
