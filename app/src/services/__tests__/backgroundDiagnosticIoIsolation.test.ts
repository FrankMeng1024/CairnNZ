type BackgroundHandler = (event: { data: unknown; error: unknown }) => Promise<void>;

describe('background Activity ownership is isolated from diagnostic I/O', () => {
  test('held stage-ledger and simulator-log writes cannot stall the next WAL batch or foreground barrier', async () => {
    jest.resetModules();
    const mockContextValues = new Map<string, string>();
    const mockLedgerValues = new Map<string, string>();
    const mockWal: any[] = [];
    let mockHandler: BackgroundHandler | null = null;
    let mockReleaseDiagnostic: (() => void) | null = null;
    let mockDiagnosticBlocked = false;
    let mockHoldOneDiagnostic = true;
    let mockReleaseSimulatorLog: (() => void) | null = null;
    let mockSimulatorLogBlocked = false;
    let mockHoldOneSimulatorLog = true;

    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
      AppState: { currentState: 'background' },
    }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      __esModule: true,
      default: {
        getItem: jest.fn(async (key: string) => mockContextValues.get(key) ?? null),
        setItem: jest.fn(async (key: string, value: string) => { mockContextValues.set(key, value); }),
        removeItem: jest.fn(async (key: string) => { mockContextValues.delete(key); }),
      },
    }));
    jest.doMock('expo-task-manager', () => ({
      isTaskDefined: jest.fn(() => false),
      defineTask: jest.fn((_name: string, callback: BackgroundHandler) => { mockHandler = callback; }),
    }));
    jest.doMock('../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async (key: string) => mockLedgerValues.get(key) ?? null),
        getItemStrict: jest.fn(async (key: string) => mockLedgerValues.get(key) ?? null),
        setItem: jest.fn(async (key: string, value: string) => {
          if (mockHoldOneDiagnostic && key.startsWith('@cairn:activity-stage-ledger:')) {
            mockHoldOneDiagnostic = false;
            mockDiagnosticBlocked = true;
            await new Promise<void>(resolve => { mockReleaseDiagnostic = resolve; });
          }
          mockLedgerValues.set(key, value);
        }),
        getAllKeysStrict: jest.fn(async () => [...mockLedgerValues.keys()]),
        removeItemsStrict: jest.fn(async (keys: string[]) => keys.forEach(key => mockLedgerValues.delete(key))),
      },
    }));
    jest.doMock('../hikeTrackWriter', () => ({
      readActiveHikeTail: jest.fn(async () => mockWal.map(point => ({ ...point, accuracy: point.acc }))),
      appendBackgroundHikePoints: jest.fn(async (points: any[]) => { mockWal.push(...points); }),
    }));
    jest.doMock('../debugLogger', () => ({
      debugLogger: {
        isEnabled: jest.fn(() => false), getCurrentSessionId: jest.fn(() => null),
        log: jest.fn(), logError: jest.fn(),
      },
    }));
    jest.doMock('../crashLogger', () => ({
      crashLogger: { breadcrumb: jest.fn(), captureException: jest.fn() },
    }));
    jest.doMock('../../features/activitySimulator/simulatorLog', () => ({
      appendSimulatorLog: jest.fn(),
      flushSimulatorLogs: jest.fn(async () => {
        if (!mockHoldOneSimulatorLog) return;
        mockHoldOneSimulatorLog = false;
        mockSimulatorLogBlocked = true;
        await new Promise<void>(resolve => { mockReleaseSimulatorLog = resolve; });
      }),
    }));
    jest.doMock('../../features/activity/activityMemoryProjector', () => ({
      scheduleActivityMemoryProjection: jest.fn(async () => undefined),
    }));
    jest.doMock('expo-application', () => ({}));
    jest.doMock('expo-updates', () => ({}));

    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('synthetic-a', true, {
      clientActivityId: 'synthetic-a', userId: 'owner-a', ownerGeneration: 'generation-a',
      segmentId: 'segment-a', activityMode: 'hiking', acceptAfterMs: 0,
    });
    expect(mockHandler).not.toBeNull();
    const fix = (timestamp: number, latitude: number) => ({
      timestamp,
      coords: {
        latitude, longitude: 174, accuracy: 6, altitude: 0,
        altitudeAccuracy: 5, speed: 1.1, heading: 0,
      },
    });
    let firstDone = false;
    const first = mockHandler!({ data: { locations: [fix(1_000, -41)] }, error: null })
      .then(() => { firstDone = true; });
    for (let turn = 0; turn < 100
      && (!mockDiagnosticBlocked || !mockSimulatorLogBlocked || mockWal.length === 0); turn += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(mockWal).toHaveLength(1);
    expect(mockDiagnosticBlocked).toBe(true);
    expect(mockSimulatorLogBlocked).toBe(true);

    let secondDone = false;
    let barrierDone = false;
    const second = mockHandler!({ data: { locations: [fix(11_000, -40.9999)] }, error: null })
      .then(() => { secondDone = true; });
    const barrier = task.settleBackgroundLocationWrites().then(() => { barrierDone = true; });
    await new Promise(resolve => setTimeout(resolve, 120));
    expect({ firstDone, secondDone, barrierDone, walCount: mockWal.length }).toEqual({
      firstDone: true, secondDone: true, barrierDone: true, walCount: 2,
    });

    mockReleaseDiagnostic?.();
    mockReleaseSimulatorLog?.();
    await Promise.all([first, second, barrier]);
    const ledger = require('../../features/activity/activityStageLedger');
    await ledger.flushActivityStageLedger('owner-a');
  });
});
