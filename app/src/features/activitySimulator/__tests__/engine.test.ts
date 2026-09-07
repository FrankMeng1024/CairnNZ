jest.mock('../simulatorLog', () => ({ appendSimulatorLog: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { calculateActivityStats, type SegmentedTrackPoint } from '../../activity/activityContracts';
import { destinationPoint, distanceMeters } from '../geodesy';
import {
  activitySimulatorEngine,
  SIMULATOR_MAX_VIRTUAL_SAMPLE_INTERVAL_MS,
} from '../activitySimulatorEngine';
import { useActivitySimulatorStore } from '../useActivitySimulatorStore';
import type { SimulatorCanonicalSample } from '../activitySimulatorEngine';
import { SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS } from '../simulatorTime';

const ORIGIN = { lat: -45.0312, lng: 168.6626 };
const LEASE = {
  clientActivityId: 'activity-sim-a',
  ownerUserId: 'account-a',
  ownerGeneration: 'owner-a',
  mode: 'hiking' as const,
  segmentId: 'segment-a',
};

describe('Activity Simulator location evidence engine', () => {
  let now = 1_800_000_000_000;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    await activitySimulatorEngine.stopRuntime();
    useActivitySimulatorStore.setState({
      hydratedUserId: 'account-a',
      enabled: true,
      simulatorSessionId: null,
      boundActivityClientId: null,
      latestActivityClientId: null,
      origin: ORIGIN,
      current: ORIGIN,
      altitudeM: 100,
      altitudeMode: 'flat',
      verticalRateMPerHour: 0,
      speedPreset: 'walk',
      speedKmh: 5,
      accuracyPreset: 'good',
      customAccuracyM: null,
      signal: 'normal',
      timeScale: 1,
      waypoints: [],
      autopilotActive: false,
      joystickBearingDegrees: 0,
      joystickMagnitude: 0,
      virtualActivityStartedAtMs: now,
      virtualTimestampMs: now,
      effectiveVirtualElapsedMs: 0,
      sampleSequence: 0,
      batchSequence: 0,
      clockLimitReached: false,
      deterministicSeed: 1,
      lastDecision: null,
      lastFailure: null,
    });
  });

  afterEach(async () => {
    await activitySimulatorEngine.endActivity('discarded');
    await activitySimulatorEngine.stopRuntime();
    jest.clearAllTimers();
    jest.useRealTimers();
    now += 100_000;
  });

  function bind(samples: SimulatorCanonicalSample[]) {
    activitySimulatorEngine.bindActivity(
      LEASE,
      async sample => {
        samples.push(sample);
        return { accepted: true, reason: 'accepted', segmentId: sample.segmentId, memoryCommitted: true };
      },
      now,
    );
  }

  test('joystick creates 1 Hz canonical metre-based samples with ownership', async () => {
    const samples: SimulatorCanonicalSample[] = [];
    bind(samples);
    await activitySimulatorEngine.tick(now, true);
    useActivitySimulatorStore.getState().setJoystick(90, 1);
    await activitySimulatorEngine.tick(now + 1_000);

    expect(samples).toHaveLength(2);
    expect(samples[1]).toMatchObject({
      source: 'simulator',
      clientActivityId: LEASE.clientActivityId,
      ownerGeneration: LEASE.ownerGeneration,
      segmentId: LEASE.segmentId,
      accuracy: 5,
      speed: 5 / 3.6,
    });
    expect(samples[1].timestamp).toBeGreaterThan(samples[0].timestamp);
    expect(distanceMeters(samples[0], samples[1])).toBeCloseTo(5 / 3.6, 2);
  });

  test('waypoint autopilot emits canonical evidence and stops at destination', async () => {
    const samples: SimulatorCanonicalSample[] = [];
    bind(samples);
    const destination = destinationPoint(ORIGIN, 30, 10);
    useActivitySimulatorStore.getState().setCustomSpeed(36);
    useActivitySimulatorStore.getState().moveToWaypoint(destination);
    await activitySimulatorEngine.tick(now + 1_000);

    expect(distanceMeters(useActivitySimulatorStore.getState().current, destination)).toBeLessThan(0.01);
    expect(samples).toHaveLength(1);
    expect(useActivitySimulatorStore.getState().autopilotActive).toBe(false);
    expect(useActivitySimulatorStore.getState().waypoints).toHaveLength(0);
  });

  test('stationary samples remain stationary and never fabricate displacement', async () => {
    const samples: SimulatorCanonicalSample[] = [];
    bind(samples);
    await activitySimulatorEngine.tick(now, true);
    await activitySimulatorEngine.tick(now + 1_000);
    expect(samples).toHaveLength(2);
    expect(samples[1].speed).toBe(0);
    expect(distanceMeters(samples[0], samples[1])).toBe(0);
  });

  test('LOST suppresses samples while hidden physical movement continues', async () => {
    const samples: SimulatorCanonicalSample[] = [];
    bind(samples);
    useActivitySimulatorStore.getState().setSignal('lost');
    useActivitySimulatorStore.getState().setJoystick(0, 1);
    await activitySimulatorEngine.tick(now + 1_000);
    expect(samples).toHaveLength(0);
    expect(distanceMeters(ORIGIN, useActivitySimulatorStore.getState().current)).toBeGreaterThan(1);
  });

  test('Pause stops Activity publication but intentionally permits reposition', async () => {
    const samples: SimulatorCanonicalSample[] = [];
    bind(samples);
    activitySimulatorEngine.pauseActivity();
    useActivitySimulatorStore.getState().setJoystick(0, 1);
    await activitySimulatorEngine.tick(now + 1_000);
    expect(samples).toHaveLength(0);
    expect(distanceMeters(ORIGIN, useActivitySimulatorStore.getState().current)).toBeGreaterThan(1);

    activitySimulatorEngine.resumeActivity({ ...LEASE, ownerGeneration: 'owner-b', segmentId: 'segment-b' }, async sample => {
      samples.push(sample);
      return { accepted: true, reason: 'accepted', segmentId: sample.segmentId };
    });
    await activitySimulatorEngine.tick(now + 2_000);
    expect(samples.at(-1)).toMatchObject({ ownerGeneration: 'owner-b', segmentId: 'segment-b' });
  });

  test('backtracking, pace and climb are derived from generated samples', async () => {
    const samples: SimulatorCanonicalSample[] = [];
    bind(samples);
    useActivitySimulatorStore.setState({ verticalRateMPerHour: 360, altitudeMode: 'climb' });
    await activitySimulatorEngine.tick(now, true);
    useActivitySimulatorStore.getState().setJoystick(0, 1);
    await activitySimulatorEngine.tick(now + 1_001);
    useActivitySimulatorStore.getState().setJoystick(180, 1);
    await activitySimulatorEngine.tick(now + 2_001);

    const points: SegmentedTrackPoint[] = samples.map(sample => ({
      lat: sample.lat,
      lng: sample.lng,
      alt: sample.alt,
      accuracy: sample.accuracy,
      speed: sample.speed,
      t: sample.timestamp,
      segmentId: sample.segmentId ?? 'segment-a',
      source: 'simulator',
    }));
    const stats = calculateActivityStats(points);
    expect(distanceMeters(points[0], points.at(-1)!)).toBeLessThan(0.02);
    expect(stats.distanceM).toBeCloseTo(2 * (5 / 3.6), 1);
    expect(stats.activeDurationS).toBeCloseTo(2, 5);
    expect(stats.elevationGainM).toBeCloseTo(0.2001, 5);
    expect((stats.activeDurationS / (stats.distanceM / 1_000)) / 60).toBeCloseTo(12, 1);
  });

  test.each([2, 5, 10, 30] as const)(
    '%d× moves through canonical samples at realistic configured speed',
    async timeScale => {
      const samples: SimulatorCanonicalSample[] = [];
      const historicalStart = now - 12 * 60 * 60_000 - 60_000;
      useActivitySimulatorStore.setState({
        timeScale,
        virtualActivityStartedAtMs: null,
        virtualTimestampMs: historicalStart,
      });
      activitySimulatorEngine.bindActivity(
        LEASE,
        async sample => {
          samples.push(sample);
          return { accepted: true, reason: 'accepted', segmentId: sample.segmentId };
        },
        historicalStart,
      );
      await activitySimulatorEngine.tick(now, true);
      useActivitySimulatorStore.getState().setJoystick(90, 1);
      for (let second = 1; second <= 60; second += 1) {
        await activitySimulatorEngine.tick(now + second * 1_000);
      }

      const points: SegmentedTrackPoint[] = samples.map(sample => ({
        ...sample,
        t: sample.timestamp,
        segmentId: sample.segmentId ?? 'segment-a',
      }));
      const stats = calculateActivityStats(points);
      const expectedDurationS = 60 * timeScale;
      const expectedDistanceM = (5 / 3.6) * expectedDurationS;
      expect(stats.activeDurationS).toBe(expectedDurationS);
      expect(stats.distanceM).toBeCloseTo(expectedDistanceM, 0);
      expect((stats.activeDurationS / (stats.distanceM / 1_000)) / 60).toBeCloseTo(12, 1);
      expect(samples.at(-1)!.speed).toBeCloseTo(5 / 3.6, 6);
      expect(samples.every(sample => sample.timestamp <= now + 60_000)).toBe(true);
      expect(samples.slice(1).every((sample, index) => (
        sample.timestamp - samples[index].timestamp <= SIMULATOR_MAX_VIRTUAL_SAMPLE_INTERVAL_MS
      ))).toBe(true);
      if (timeScale === 30) {
        // One 1 Hz wall tick is a bounded batch of three 10-second samples.
        expect(samples).toHaveLength(181);
      }
    },
  );

  test('30× batching bounds displacement without multiplying emitted physical speed', async () => {
    const samples: SimulatorCanonicalSample[] = [];
    const historicalStart = now - 12 * 60 * 60_000 - 60_000;
    useActivitySimulatorStore.setState({
      timeScale: 30,
      speedPreset: 'custom',
      speedKmh: 60,
      virtualActivityStartedAtMs: null,
      virtualTimestampMs: historicalStart,
    });
    activitySimulatorEngine.bindActivity(
      LEASE,
      async sample => {
        samples.push(sample);
        return { accepted: true, reason: 'accepted', segmentId: sample.segmentId };
      },
      historicalStart,
    );
    await activitySimulatorEngine.tick(now, true);
    useActivitySimulatorStore.getState().setJoystick(90, 1);
    await activitySimulatorEngine.tick(now + 1_000);

    expect(samples).toHaveLength(4);
    expect(samples.slice(1).every(sample => sample.speed === 60 / 3.6)).toBe(true);
    expect(samples.slice(1).every((sample, index) => distanceMeters(samples[index], sample) < 200)).toBe(true);
    expect(samples.at(-1)!.timestamp - samples[0].timestamp).toBe(30_000);
    expect(distanceMeters(samples[0], samples.at(-1)!)).toBeCloseTo(500, 0);
  });

  test('an exhausted accelerated clock stays quiescent until normal Finish or Discard', async () => {
    const samples: SimulatorCanonicalSample[] = [];
    const historicalStart = now - 12 * 60 * 60_000 - 60_000;
    useActivitySimulatorStore.setState({
      timeScale: 30,
      virtualActivityStartedAtMs: historicalStart,
      virtualTimestampMs: historicalStart + SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS,
      effectiveVirtualElapsedMs: SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS,
      boundActivityClientId: LEASE.clientActivityId,
      simulatorSessionId: 'sim-limit',
      sampleSequence: 7,
      batchSequence: 9,
      clockLimitReached: true,
    });
    activitySimulatorEngine.bindActivity(
      LEASE,
      async sample => {
        samples.push(sample);
        return { accepted: true, reason: 'accepted', segmentId: sample.segmentId };
      },
      historicalStart,
    );
    await activitySimulatorEngine.tick(now + 1_000, true);
    expect(samples).toHaveLength(0);
    expect(useActivitySimulatorStore.getState()).toMatchObject({
      sampleSequence: 7,
      batchSequence: 9,
      clockLimitReached: true,
    });
  });

  test('10× stationary evidence advances time without displacement', async () => {
    const samples: SimulatorCanonicalSample[] = [];
    const historicalStart = now - 12 * 60 * 60_000 - 60_000;
    useActivitySimulatorStore.setState({
      timeScale: 10,
      virtualActivityStartedAtMs: null,
      virtualTimestampMs: historicalStart,
    });
    activitySimulatorEngine.bindActivity(
      LEASE,
      async sample => {
        samples.push(sample);
        return { accepted: true, reason: 'accepted', segmentId: sample.segmentId };
      },
      historicalStart,
    );
    await activitySimulatorEngine.tick(now, true);
    for (let second = 1; second <= 60; second += 1) {
      await activitySimulatorEngine.tick(now + second * 1_000);
    }
    const points: SegmentedTrackPoint[] = samples.map(sample => ({
      ...sample,
      t: sample.timestamp,
      segmentId: sample.segmentId ?? 'segment-a',
    }));
    const stats = calculateActivityStats(points);
    expect(stats.activeDurationS).toBe(600);
    expect(stats.distanceM).toBe(0);
    expect(samples.every(sample => sample.speed === 0)).toBe(true);
  });

  test.each([
    ['short', 2, 30_000],
    ['long', 13, 140_000],
  ] as const)('%s GPS loss preserves accelerated hidden time and publishes no connector samples', async (_label, lostWallSeconds, expectedGapMs) => {
    const samples: SimulatorCanonicalSample[] = [];
    const historicalStart = now - 12 * 60 * 60_000 - 60_000;
    useActivitySimulatorStore.setState({
      timeScale: 10,
      virtualActivityStartedAtMs: null,
      virtualTimestampMs: historicalStart,
    });
    activitySimulatorEngine.bindActivity(
      LEASE,
      async sample => {
        samples.push(sample);
        return { accepted: true, reason: 'accepted', segmentId: sample.segmentId };
      },
      historicalStart,
    );
    await activitySimulatorEngine.tick(now, true);
    useActivitySimulatorStore.getState().setSignal('lost');
    useActivitySimulatorStore.getState().setJoystick(0, 1);
    for (let second = 1; second <= lostWallSeconds; second += 1) {
      await activitySimulatorEngine.tick(now + second * 1_000);
    }
    expect(samples).toHaveLength(1);
    useActivitySimulatorStore.getState().setSignal('normal');
    await activitySimulatorEngine.tick(now + (lostWallSeconds + 1) * 1_000);

    expect(samples).toHaveLength(2);
    expect(samples[1].timestamp - samples[0].timestamp).toBe(expectedGapMs);
    expect(distanceMeters(samples[0], samples[1])).toBeGreaterThan(0);
  });
});
