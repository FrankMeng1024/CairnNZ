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
});
