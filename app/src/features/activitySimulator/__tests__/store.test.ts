jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../../store/useTrackingStore', () => ({
  useTrackingStore: { getState: () => ({ status: 'idle', sessionId: null }) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hydrateActivitySimulatorForUser,
  persistActivitySimulatorNow,
  useActivitySimulatorStore,
} from '../useActivitySimulatorStore';

describe('Activity Simulator user-scoped recovery state', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await hydrateActivitySimulatorForUser(null);
  });

  test('persists worldwide position and configuration for the owning account', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    useActivitySimulatorStore.getState().setEnabled(true);
    expect(useActivitySimulatorStore.getState().setOrigin({ lat: 35.6762, lng: 499.6503 })).toBe(true);
    useActivitySimulatorStore.getState().setCustomSpeed(12.5);
    useActivitySimulatorStore.getState().setTimeScale(10);
    useActivitySimulatorStore.getState().setAltitude(850);
    useActivitySimulatorStore.getState().setSignal('lost');
    await persistActivitySimulatorNow();

    await hydrateActivitySimulatorForUser(null);
    await hydrateActivitySimulatorForUser('account-a');
    expect(useActivitySimulatorStore.getState()).toMatchObject({
      enabled: true,
      speedPreset: 'custom',
      speedKmh: 12.5,
      timeScale: 10,
      altitudeM: 850,
      signal: 'lost',
    });
    expect(useActivitySimulatorStore.getState().current.lat).toBeCloseTo(35.6762, 8);
    expect(useActivitySimulatorStore.getState().current.lng).toBeCloseTo(139.6503, 8);
  });

  test('does not expose Account A Simulator state to Account B', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    useActivitySimulatorStore.getState().setEnabled(true);
    useActivitySimulatorStore.getState().setOrigin({ lat: 51.5072, lng: -0.1276 });
    await persistActivitySimulatorNow();

    await hydrateActivitySimulatorForUser('account-b');
    expect(useActivitySimulatorStore.getState()).toMatchObject({
      hydratedUserId: 'account-b',
      enabled: false,
      current: { lat: -45.0312, lng: 168.6626 },
    });

    await hydrateActivitySimulatorForUser('account-a');
    expect(useActivitySimulatorStore.getState().current.lat).toBeCloseTo(51.5072, 8);
    expect(useActivitySimulatorStore.getState().current.lng).toBeCloseTo(-0.1276, 8);
  });

  test('retains the bound Activity identity and refuses destructive reset', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    useActivitySimulatorStore.getState().bindActivity('account-a', 'activity-a', 1_000);
    expect(useActivitySimulatorStore.getState().resetWhenIdle()).toBe(false);
    expect(useActivitySimulatorStore.getState()).toMatchObject({
      boundActivityClientId: 'activity-a',
      lastFailure: expect.stringContaining('Finish or discard'),
    });
    expect(useActivitySimulatorStore.getState().setTimeScale(30)).toBe(false);
    expect(useActivitySimulatorStore.getState().timeScale).toBe(1);
  });

  test('bounds temporary waypoints to twelve and reset preserves no Activity data', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    const actions = useActivitySimulatorStore.getState();
    for (let index = 0; index < 12; index += 1) {
      expect(actions.enqueueWaypoint({ lat: -45 + index * 0.001, lng: 168 })).toBe(true);
    }
    expect(actions.enqueueWaypoint({ lat: -44, lng: 168 })).toBe(false);
    expect(useActivitySimulatorStore.getState().waypoints).toHaveLength(12);
    expect(useActivitySimulatorStore.getState().resetWhenIdle()).toBe(true);
    expect(useActivitySimulatorStore.getState().waypoints).toHaveLength(0);
  });

  test('validates latitude and bounded speed, altitude and accuracy inputs', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    const actions = useActivitySimulatorStore.getState();
    expect(actions.setOrigin({ lat: 90.1, lng: 0 })).toBe(false);
    expect(actions.setCustomSpeed(60.1)).toBe(false);
    expect(actions.setAltitude(9_001)).toBe(false);
    expect(actions.setCustomAccuracy(501)).toBe(false);
    expect(actions.setTimeScale(10)).toBe(true);
    expect(actions.setTimeScale(3 as any)).toBe(false);
  });
});
