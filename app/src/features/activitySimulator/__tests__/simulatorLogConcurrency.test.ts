jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../../store/useTrackingStore', () => ({
  useTrackingStore: {
    getState: () => ({
      locationProviderSource: 'simulator',
      status: 'tracking',
      sessionId: 'activity-a',
    }),
  },
}));

describe('Simulator QA event serialization', () => {
  const previousCapability = process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED;

  beforeEach(async () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED = 'true';
    const storageModule = require('@react-native-async-storage/async-storage');
    const AsyncStorage = storageModule.default ?? storageModule;
    await AsyncStorage.clear();
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED = previousCapability;
  });

  test('same-turn pipeline siblings all survive an immediate flush/export', async () => {
    const { useSettingsStore } = require('../../../store/useSettingsStore');
    const { useActivitySimulatorStore } = require('../useActivitySimulatorStore');
    const { appendSimulatorLog, readSimulatorDiagnostics } = require('../simulatorLog');
    useSettingsStore.setState({ debugMode: true, telemetryUploadEnabled: false });
    useActivitySimulatorStore.setState({
      hydratedUserId: 'account-a',
      qaSessionId: 'qa-concurrency-a',
      qaSessionStartedAt: Date.now(),
      qaSessionEndedAt: null,
      enabled: true,
    });

    for (let index = 0; index < 40; index += 1) {
      appendSimulatorLog('ACTIVITY_STATE', `pipeline-sibling-${index}`, { index }, {
        userId: 'account-a',
        qaSessionId: 'qa-concurrency-a',
        coordinateSource: 'none',
      });
    }
    const jsonl = await readSimulatorDiagnostics('account-a');
    const events = jsonl.split('\n').filter(Boolean).map((line: string) => JSON.parse(line));
    expect(events.filter((event: any) => event.eventName.startsWith('pipeline-sibling-'))).toHaveLength(40);
  });

  test('ordinary real callbacks coalesce while aggregate counts and bounded cadence samples survive', async () => {
    const { useSettingsStore } = require('../../../store/useSettingsStore');
    const { useActivitySimulatorStore } = require('../useActivitySimulatorStore');
    const {
      appendSimulatorLog,
      getQaTelemetryHealth,
      readSimulatorDiagnostics,
      SIMULATOR_LOG_LIMITS,
    } = require('../simulatorLog');
    useSettingsStore.setState({ debugMode: true, telemetryUploadEnabled: false });
    useActivitySimulatorStore.setState({
      hydratedUserId: 'account-a',
      qaSessionId: 'qa-coalesce-a',
      qaSessionStartedAt: Date.now(),
      qaSessionEndedAt: null,
      enabled: false,
    });

    for (let index = 0; index < 40; index += 1) {
      appendSimulatorLog('LOCATION', 'real_activity_location_callback', {
        sampleSource: 'foreground',
        sequenceTimestamp: 1_000 + index * 1_000,
      }, {
        userId: 'account-a',
        qaSessionId: 'qa-coalesce-a',
        coordinateSource: 'real',
      });
      appendSimulatorLog('LOCATION', 'activity_observation_received_v2', {
        sampleSource: 'foreground',
        sequenceTimestamp: 1_000 + index * 1_000,
        dtFromPreviousRawMs: index === 0 ? null : 1_000,
        displacementFromPreviousRawM: index === 0 ? null : 1.2,
      }, {
        userId: 'account-a',
        qaSessionId: 'qa-coalesce-a',
        coordinateSource: 'real',
      });
    }
    const jsonl = await readSimulatorDiagnostics('account-a');
    const events = jsonl.split('\n').filter(Boolean).map((line: string) => JSON.parse(line));
    const callbacks = events.filter((event: any) => event.eventName === 'activity_observation_received_v2');
    const health = await getQaTelemetryHealth('account-a', 'qa-coalesce-a');

    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].fields.repeatCount).toBe(40);
    expect(callbacks[0].fields.intervalSamplesMs).toHaveLength(24);
    expect(callbacks[0].fields.spatialDeltaSamplesM).toHaveLength(24);
    expect(health.rawForegroundCallbackCount).toBe(40);
    expect(health.callbackDeltaP50Ms).toBe(1_000);
    expect(health.spatialDeltaP95M).toBe(1.2);
    expect(SIMULATOR_LOG_LIMITS.durableFlushIntervalMs).toBe(30_000);
  });
});
