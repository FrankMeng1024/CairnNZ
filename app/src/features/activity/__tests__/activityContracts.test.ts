import {
  MAX_CREDITABLE_ACTIVE_INTERVAL_MS,
  calculateActivityStats,
  calculateLifecycleDurationMs,
  saveEligibility,
  segmentTrace,
  shouldStartNewSegment,
  toServerPoint,
  type SegmentedTrackPoint,
} from '../activityContracts';

const point = (
  lat: number,
  lng: number,
  t: number,
  segmentId = 'segment-a',
  extra: Partial<SegmentedTrackPoint> = {},
): SegmentedTrackPoint => ({ lat, lng, t, segmentId, accuracy: 5, ...extra });

describe('Free Activity save authority', () => {
  test('normal Finish and recovery Save share the same eligibility outcomes', () => {
    const tooFew = [point(-41, 174, 1_000)];
    const stationary = [point(-41, 174, 1_000), point(-41, 174, 2_000)];
    const valid = [point(-41, 174, 1_000), point(-41.0003, 174, 31_000)];

    expect(saveEligibility(tooFew, 0)).toEqual({ eligible: false, reason: 'not-enough-points' });
    expect(saveEligibility(stationary, 0)).toEqual({ eligible: false, reason: 'not-enough-distance' });
    expect(saveEligibility(valid, 33)).toEqual({ eligible: true, reason: 'eligible' });
  });
});

describe('segmented Activity truth', () => {
  test('lifecycle time advances through GPS silence and freezes only when paused', () => {
    expect(calculateLifecycleDurationMs({
      accumulatedMs: 15_000,
      activeSinceMs: 100_000,
      nowMs: 710_000,
    })).toBe(625_000);
    expect(calculateLifecycleDurationMs({
      accumulatedMs: 625_000,
      activeSinceMs: null,
      nowMs: 9_999_999,
    })).toBe(625_000);
  });

  test('process recovery always starts a gap, even after one second', () => {
    const previous = point(-41, 174, 1_000);
    expect(shouldStartNewSegment({
      previous,
      next: point(-41.000001, 174, 2_000),
      mode: 'hiking',
      knownRecordingLoss: true,
    })).toBe(true);
  });

  test('short credible GPS delay remains continuous', () => {
    expect(shouldStartNewSegment({
      previous: point(-41, 174, 1_000),
      next: point(-41.00003, 174, 11_000),
      mode: 'hiking',
    })).toBe(false);
  });

  test('long uncertain reacquisition and implausible displacement open gaps', () => {
    expect(shouldStartNewSegment({
      previous: point(-41, 174, 1_000, 'a', { accuracy: 20 }),
      next: point(-41.002, 174, 1_000 + MAX_CREDITABLE_ACTIVE_INTERVAL_MS + 1, 'a', { accuracy: 20 }),
      mode: 'hiking',
    })).toBe(true);
    expect(shouldStartNewSegment({
      previous: point(-41, 174, 1_000),
      next: point(-41.01, 174, 2_000),
      mode: 'running',
    })).toBe(true);
  });

  test('gap connector is represented but excluded from distance, elevation and active time', () => {
    const points = [
      point(-41, 174, 1_000, 'a', { alt: 10 }),
      point(-41.001, 174, 61_000, 'a', { alt: 20 }),
      point(-41.1, 174.2, 10_861_000, 'b', { alt: 500, segmentStartReason: 'process-recovery' }),
      point(-41.101, 174.2, 10_921_000, 'b', { alt: 505 }),
    ];
    const trace = segmentTrace(points);
    const stats = calculateActivityStats(points);

    expect(trace.segments).toHaveLength(2);
    expect(trace.gaps).toEqual([{ from: points[1], to: points[2] }]);
    expect(stats.activeDurationS).toBe(120);
    expect(stats.elevationGainM).toBe(15);
    expect(stats.distanceM).toBeGreaterThan(200);
    expect(stats.distanceM).toBeLessThan(230);
  });

  test('an untrusted interval cannot inflate active duration inside legacy geometry', () => {
    const stats = calculateActivityStats([
      point(-41, 174, 1_000),
      point(-41.001, 174, 1_000 + MAX_CREDITABLE_ACTIVE_INTERVAL_MS * 10),
    ]);
    // Explicit segment continuity is authoritative; a time-only cap must not
    // silently remove valid active duration.
    expect(stats.activeDurationS).toBe((MAX_CREDITABLE_ACTIVE_INTERVAL_MS * 10) / 1_000);
  });

  test('foreground/background/server use one canonical segmented point shape', () => {
    expect(toServerPoint(point(-41, 174, 10_000.875, 'seg-1', {
      alt: 123,
      accuracy: 7,
      segmentStartReason: 'gps-reacquired',
    }))).toEqual({
      lat: -41,
      lng: 174,
      t: 10_000,
      alt: 123,
      acc: 7,
      segment_id: 'seg-1',
      segment_start_reason: 'gps-reacquired',
    });
  });
});
