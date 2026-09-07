jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../../store/useTrackingStore', () => ({
  useTrackingStore: { getState: () => ({ status: 'idle', sessionId: null }) },
}));

import {
  alignSimulatorClockForRecovery,
  activityFreshnessNow,
  activityTimestampForSource,
  advanceSimulatorClock,
  SIMULATOR_FUTURE_SAFETY_MARGIN_MS,
  SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS,
  simulatorActivityStartTimestamp,
  simulatorTimestampIsServerSafe,
} from '../simulatorTime';
import { useActivitySimulatorStore } from '../useActivitySimulatorStore';
import type { SimulatorTimeScale } from '../types';

describe('Activity Simulator bounded historical clock', () => {
  const wallStart = 1_800_000_000_000;

  beforeEach(() => {
    useActivitySimulatorStore.setState({
      hydratedUserId: 'account-a',
      boundActivityClientId: null,
      timeScale: 1,
      virtualActivityStartedAtMs: null,
      virtualTimestampMs: 0,
      effectiveVirtualElapsedMs: 0,
      clockLimitReached: false,
    });
  });

  test('1× keeps the real wall-clock epoch and behavior', () => {
    const startedAt = simulatorActivityStartTimestamp(1, wallStart);
    const advanced = advanceSimulatorClock({
      activityStartedAtMs: startedAt,
      previousVirtualTimestampMs: startedAt,
      wallElapsedMs: 1_000,
      wallClockTimestampMs: wallStart + 1_000,
      timeScale: 1,
    });
    expect(startedAt).toBe(wallStart);
    expect(advanced.virtualTimestampMs).toBe(wallStart + 1_000);
    expect(advanced.appliedVirtualElapsedMs).toBe(1_000);
    expect(advanced.limitReached).toBe(false);
  });

  test.each([2, 5, 10, 30] as SimulatorTimeScale[])(
    '%d× advances virtual evidence at the configured scale without future timestamps',
    timeScale => {
      const startedAt = simulatorActivityStartTimestamp(timeScale, wallStart);
      const advanced = advanceSimulatorClock({
        activityStartedAtMs: startedAt,
        previousVirtualTimestampMs: startedAt,
        wallElapsedMs: 60_000,
        wallClockTimestampMs: wallStart + 60_000,
        timeScale,
      });
      expect(advanced.appliedVirtualElapsedMs).toBe(60_000 * timeScale);
      expect(advanced.effectiveVirtualElapsedMs).toBe(60_000 * timeScale);
      expect(simulatorTimestampIsServerSafe(advanced.virtualTimestampMs, wallStart + 60_000)).toBe(true);
      expect(simulatorTimestampIsServerSafe(wallStart + 60_001, wallStart + 60_000)).toBe(false);
      expect(advanced.virtualTimestampMs).toBeLessThanOrEqual(
        wallStart + 60_000 - SIMULATOR_FUTURE_SAFETY_MARGIN_MS,
      );
    },
  );

  test('30× is hard-bounded to twelve virtual hours', () => {
    const startedAt = simulatorActivityStartTimestamp(30, wallStart);
    const advanced = advanceSimulatorClock({
      activityStartedAtMs: startedAt,
      previousVirtualTimestampMs: startedAt,
      wallElapsedMs: 60 * 60_000,
      wallClockTimestampMs: wallStart + 60 * 60_000,
      timeScale: 30,
    });
    expect(advanced.virtualTimestampMs).toBe(startedAt + SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS);
    expect(advanced.effectiveVirtualElapsedMs).toBe(SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS);
    expect(advanced.limitReached).toBe(true);
    expect(simulatorTimestampIsServerSafe(advanced.virtualTimestampMs, wallStart + 60 * 60_000)).toBe(true);
  });

  test('Finish reads the same accelerated timeline while Real GPS remains wall-clock', () => {
    const startedAt = simulatorActivityStartTimestamp(10, wallStart);
    useActivitySimulatorStore.setState({
      boundActivityClientId: 'activity-a',
      timeScale: 10,
      virtualActivityStartedAtMs: startedAt,
      virtualTimestampMs: startedAt + 600_000,
    });
    expect(activityTimestampForSource('simulator', wallStart + 60_000, startedAt))
      .toBe(startedAt + 600_000);
    expect(activityTimestampForSource('real', wallStart + 60_000, startedAt))
      .toBe(wallStart + 60_000);
  });

  test('a subsequent Real Activity never inherits Simulator virtual time', () => {
    useActivitySimulatorStore.setState({
      timeScale: 30,
      virtualTimestampMs: wallStart - 4 * 60 * 60_000,
    });
    expect(activityTimestampForSource('real', wallStart, 0)).toBe(wallStart);
  });

  test('live freshness and Quick Cairn compare fixes on the selected provider timeline', () => {
    const virtualNow = wallStart - 6 * 60 * 60_000;
    useActivitySimulatorStore.setState({ virtualTimestampMs: virtualNow });
    expect(activityFreshnessNow('simulator', wallStart)).toBe(virtualNow);
    expect(activityFreshnessNow('real', wallStart)).toBe(wallStart);
  });

  test('recovery advances a lagging persisted clock to the newest durable point without rewinding', () => {
    const startedAt = simulatorActivityStartTimestamp(10, wallStart);
    useActivitySimulatorStore.setState({
      boundActivityClientId: 'activity-a',
      timeScale: 10,
      virtualActivityStartedAtMs: startedAt,
      virtualTimestampMs: startedAt + 10_000,
      effectiveVirtualElapsedMs: 10_000,
    });
    alignSimulatorClockForRecovery(startedAt + 20_000, startedAt);
    expect(useActivitySimulatorStore.getState()).toMatchObject({
      virtualTimestampMs: startedAt + 20_000,
      effectiveVirtualElapsedMs: 20_000,
    });
    alignSimulatorClockForRecovery(startedAt + 15_000, startedAt);
    expect(useActivitySimulatorStore.getState().virtualTimestampMs).toBe(startedAt + 20_000);
  });
});
