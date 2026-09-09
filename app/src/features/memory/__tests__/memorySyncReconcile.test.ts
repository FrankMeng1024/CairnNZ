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
});
