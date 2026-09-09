jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../../store/useTrackingStore', () => ({
  useTrackingStore: { getState: () => ({ status: 'idle', sessionId: null }) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hydrateActivitySimulatorForUser,
  initializeFreshSimulatorSetupForActivityEntry,
  persistActivitySimulatorNow,
  simulatorStorageKey,
  MAX_SIMULATOR_AUTOPILOT_POINTS,
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
      startConfigured: true,
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
      startConfigured: false,
      current: { lat: -45.0312, lng: 168.6626 },
    });

    await hydrateActivitySimulatorForUser('account-a');
    expect(useActivitySimulatorStore.getState().current.lat).toBeCloseTo(51.5072, 8);
    expect(useActivitySimulatorStore.getState().current.lng).toBeCloseTo(-0.1276, 8);
  });

  test('retains the bound Activity identity, permits live time changes and refuses destructive reset', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    useActivitySimulatorStore.getState().bindActivity('account-a', 'activity-a', 1_000);
    expect(useActivitySimulatorStore.getState().resetWhenIdle()).toBe(false);
    expect(useActivitySimulatorStore.getState()).toMatchObject({
      boundActivityClientId: 'activity-a',
      lastFailure: expect.stringContaining('Finish or discard'),
    });
    expect(useActivitySimulatorStore.getState().setTimeScale(30)).toBe(true);
    expect(useActivitySimulatorStore.getState().timeScale).toBe(30);
  });

  test('bounds walking-path targets and reset preserves no Activity data', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    const actions = useActivitySimulatorStore.getState();
    for (let index = 0; index < MAX_SIMULATOR_AUTOPILOT_POINTS; index += 1) {
      expect(actions.enqueueWaypoint({ lat: -45 + index * 0.001, lng: 168 })).toBe(true);
    }
    expect(actions.enqueueWaypoint({ lat: -44, lng: 168 })).toBe(false);
    expect(useActivitySimulatorStore.getState().waypoints).toHaveLength(MAX_SIMULATOR_AUTOPILOT_POINTS);
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

  test('requires an explicit start point for a fresh account', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    expect(useActivitySimulatorStore.getState()).toMatchObject({ enabled: false, startConfigured: false });
    expect(useActivitySimulatorStore.getState().setOrigin({ lat: -41.2866, lng: 174.7756 })).toBe(true);
    expect(useActivitySimulatorStore.getState().startConfigured).toBe(true);
  });

  test('keeps map picker state ephemeral and clears it at origin/provider boundaries', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    const actions = useActivitySimulatorStore.getState();
    actions.setPickerMode('destination');
    expect(useActivitySimulatorStore.getState().pickerMode).toBe('destination');
    actions.setOrigin({ lat: -45.0312, lng: 168.6626 });
    expect(useActivitySimulatorStore.getState().pickerMode).toBeNull();
    actions.setPickerMode('reacquire');
    actions.unbindActivity();
    expect(useActivitySimulatorStore.getState().pickerMode).toBeNull();
  });

  test('fresh Activity completion clears origin while same-Activity recovery preserves it', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    const actions = useActivitySimulatorStore.getState();
    actions.setOrigin({ lat: -45.0312, lng: 168.6626 });
    actions.bindActivity('account-a', 'activity-a', 1_000);
    actions.unbindActivity();
    expect(useActivitySimulatorStore.getState().startConfigured).toBe(true);
    actions.bindActivity('account-a', 'activity-a', 1_000);
    actions.unbindActivity({ clearOrigin: true });
    expect(useActivitySimulatorStore.getState()).toMatchObject({
      startConfigured: false,
      boundActivityClientId: null,
      latestActivityClientId: null,
    });
  });

  test('fresh screen entry clears every stale setup/runtime value while preserving Debug and QA identity', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    const actions = useActivitySimulatorStore.getState();
    actions.setEnabled(true);
    actions.beginQaSession('account-a');
    actions.setOrigin({ lat: 31.2304, lng: 121.4737 });
    actions.setSignal('lost');
    actions.setTimeScale(120);
    actions.setCustomSpeed(12);
    actions.setAltitudeMode('climb');
    actions.moveToWaypoint({ lat: 31.2404, lng: 121.4837 });
    actions.setPickerMode('reacquire');
    const qaSessionId = useActivitySimulatorStore.getState().qaSessionId;

    await expect(initializeFreshSimulatorSetupForActivityEntry(
      'account-a',
      async () => null,
    )).resolves.toBe('reset');

    expect(useActivitySimulatorStore.getState()).toMatchObject({
      enabled: true,
      qaSessionId,
      startConfigured: false,
      origin: { lat: -45.0312, lng: 168.6626 },
      current: { lat: -45.0312, lng: 168.6626 },
      waypoints: [],
      autopilotActive: false,
      pickerMode: null,
      signal: 'normal',
      timeScale: 1,
      speedKmh: 5,
      altitudeMode: 'flat',
      virtualTimestampMs: 0,
      sampleSequence: 0,
    });
  });

  test('fresh screen entry preserves the exact same unfinished Activity setup for recovery', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    const actions = useActivitySimulatorStore.getState();
    actions.setEnabled(true);
    actions.setOrigin({ lat: 35.6762, lng: 139.6503 });
    actions.setTimeScale(30);
    const before = useActivitySimulatorStore.getState();

    await expect(initializeFreshSimulatorSetupForActivityEntry(
      'account-a',
      async () => ({
        clientActivityId: 'activity-recover',
        serverActivityId: null,
        userId: 'account-a',
        activityMode: 'hiking',
        startedAt: 1_000,
        lastMeaningfulAt: 2_000,
        liveOwnerGeneration: 'owner-recover',
        currentSegmentId: 'segment-recover',
        locationProviderSource: 'simulator',
        lifecycle: 'unfinished',
      }),
    )).resolves.toBe('preserved-unfinished-activity');

    expect(useActivitySimulatorStore.getState()).toMatchObject({
      startConfigured: true,
      origin: before.origin,
      current: before.current,
      timeScale: 30,
    });
  });

  test('fresh screen entry fails closed when the unfinished registry cannot be read', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    useActivitySimulatorStore.getState().setEnabled(true);
    useActivitySimulatorStore.getState().setOrigin({ lat: 35.6762, lng: 139.6503 });

    await expect(initializeFreshSimulatorSetupForActivityEntry(
      'account-a',
      async () => { throw new Error('storage unavailable'); },
    )).resolves.toBe('preserved-registry-uncertain');
    expect(useActivitySimulatorStore.getState().startConfigured).toBe(true);
    expect(useActivitySimulatorStore.getState().origin.lat).toBeCloseTo(35.6762, 8);
    expect(useActivitySimulatorStore.getState().origin.lng).toBeCloseTo(139.6503, 8);
  });

  test('does not mistake a legacy default origin for an explicit start', async () => {
    await AsyncStorage.setItem(simulatorStorageKey('account-a'), JSON.stringify({
      version: 1,
      enabled: true,
      origin: { lat: -45.0312, lng: 168.6626 },
      current: { lat: -45.0312, lng: 168.6626 },
    }));
    await hydrateActivitySimulatorForUser('account-a');
    expect(useActivitySimulatorStore.getState()).toMatchObject({
      enabled: true,
      startConfigured: false,
    });
  });

  test('keeps one QA session ID through Debug transitions and rotates explicitly', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    const first = useActivitySimulatorStore.getState().beginQaSession('account-a');
    expect(first).toMatch(/^qa-/);
    expect(useActivitySimulatorStore.getState().beginQaSession('account-a')).toBe(first);
    const next = useActivitySimulatorStore.getState().beginQaSession('account-a', true);
    expect(next).toMatch(/^qa-/);
    expect(next).not.toBe(first);
  });

  test('Simulator can be disabled independently when idle but not during its bound Activity', async () => {
    await hydrateActivitySimulatorForUser('account-a');
    useActivitySimulatorStore.getState().setEnabled(true);
    useActivitySimulatorStore.getState().bindActivity('account-a', 'activity-a', 1_000);
    useActivitySimulatorStore.getState().setEnabled(false);
    expect(useActivitySimulatorStore.getState()).toMatchObject({
      enabled: true,
      boundActivityClientId: 'activity-a',
      lastFailure: expect.stringContaining('unfinished Simulator Activity'),
    });
    useActivitySimulatorStore.getState().unbindActivity();
    useActivitySimulatorStore.getState().setEnabled(false);
    expect(useActivitySimulatorStore.getState().enabled).toBe(false);
  });
});
