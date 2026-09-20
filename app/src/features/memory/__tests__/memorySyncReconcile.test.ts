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
      useAppStore: { getState: () => ({ isLoggedIn: true }) },
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
      useAppStore: { getState: () => ({ isLoggedIn: true, user: { id: 'account-b' } }) },
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

    memorySync.detachMemorySync();
    state.points = [{ cid: 'b-hydrated-memory' }];
    memorySync.attachMemorySync('account-b');
    releaseDelete({ ok: true });

    await expect(deletion).resolves.toBe(false);
    expect(state.clearAll).not.toHaveBeenCalled();
    expect(state.points).toEqual([{ cid: 'b-hydrated-memory' }]);
    memorySync.detachMemorySync();
  });
});
