describe('Snap Lab production-network fence', () => {
  const originalCapability = process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED;

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED = originalCapability;
  });

  test('generic app logs never enter the transport in a simulator-capable process', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
    (globalThis as any).fetch = fetchMock;
    jest.doMock('../../features/activitySimulator/capability', () => ({
      activitySimulatorBuildCapable: true,
    }));
    const appLog = require('../appLog');
    appLog.log('qa.synthetic_activity', { count: 1 });
    await appLog.flushNow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('cold-start beacons remain local in a simulator-capable process', () => {
    process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED = 'true';
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
    (globalThis as any).fetch = fetchMock;
    const boot = require('../bootDiagnostics');
    boot.markBootPhase('snap_lab_test');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
