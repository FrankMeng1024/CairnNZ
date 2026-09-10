import { haversineM } from '../../utils/geo';
import type { ActivityMode, TrackPoint } from '../../store/useSessionStore';
import { calculateQualityElevationGain } from './elevationQuality';

export type SegmentStartReason =
  | 'start'
  | 'resume'
  | 'process-recovery'
  | 'gps-reacquired'
  | 'legacy';

export interface SegmentedTrackPoint extends TrackPoint {
  segmentId: string;
  segmentStartReason?: SegmentStartReason;
  source?: 'foreground' | 'background' | 'significant-change' | 'simulator';
}

export interface GapConnector {
  from: SegmentedTrackPoint;
  to: SegmentedTrackPoint;
}

export interface SegmentedTrace {
  segments: SegmentedTrackPoint[][];
  gaps: GapConnector[];
}

export interface ActivityStats {
  distanceM: number;
  elevationGainM: number;
  activeDurationS: number;
}

/**
 * Activity time belongs to the lifecycle, not to GPS geometry. The accumulated
 * portion is frozen at Pause; while Tracking, the provider clock contributes
 * the open interval. Real Activities use wall time and Simulator Activities
 * use their bounded virtual clock.
 */
export function calculateLifecycleDurationMs(args: {
  accumulatedMs: number;
  activeSinceMs: number | null;
  nowMs: number;
}): number {
  const accumulatedMs = Number.isFinite(args.accumulatedMs)
    ? Math.max(0, args.accumulatedMs)
    : 0;
  if (args.activeSinceMs === null || !Number.isFinite(args.activeSinceMs)) {
    return accumulatedMs;
  }
  return accumulatedMs + Math.max(0, args.nowMs - args.activeSinceMs);
}

export interface SaveEligibility {
  eligible: boolean;
  reason: 'eligible' | 'not-enough-points' | 'not-enough-distance';
}

const MODE_MAX_SPEED_MPS: Record<ActivityMode, number> = {
  hiking: 4.17,
  running: 10,
};

// The recorder normally samples in seconds. A two-minute interval is the
// upper credible interval used by current dynamic/background sampling. It is
// never sufficient by itself to split a segment: position, accuracy and known
// loss state also participate.
export const MAX_CREDITABLE_ACTIVE_INTERVAL_MS = 120_000;
/** Shared horizontal-quality boundary for accepted Activity/passive evidence. */
export const MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M = 25;

const MIN_CREDIBLE_MOTION_SPEED_MPS = 0.55;
const MIN_CREDIBLE_MOTION_STEP_M = 2.5;
const MAX_CREDIBLE_MOTION_SAMPLE_INTERVAL_MS = 15_000;

/**
 * Moderate-accuracy fixes normally remain behind the indoor-drift gate. A
 * moving user may pass it only when Core Location and the immediately prior
 * native sample agree that movement is coherent. This keeps the canonical
 * route responsive without turning arbitrary raw noise into Activity truth.
 */
export function isCredibleMotionSample(args: {
  mode: ActivityMode;
  lastAccepted: Pick<TrackPoint, 'lat' | 'lng'>;
  previousRaw: Pick<TrackPoint, 'lat' | 'lng' | 't' | 'accuracy' | 'speed'> | null;
  current: Pick<TrackPoint, 'lat' | 'lng' | 't' | 'accuracy' | 'speed'>;
}): boolean {
  const { mode, lastAccepted, previousRaw, current } = args;
  if (!previousRaw) return false;
  const speed = current.speed;
  const previousSpeed = previousRaw.speed;
  const accuracy = current.accuracy;
  const previousAccuracy = previousRaw.accuracy;
  if (
    speed == null
    || previousSpeed == null
    || speed < MIN_CREDIBLE_MOTION_SPEED_MPS
    || previousSpeed < MIN_CREDIBLE_MOTION_SPEED_MPS * 0.6
    || speed > MODE_MAX_SPEED_MPS[mode]
    || accuracy == null
    || previousAccuracy == null
    || accuracy > 20
    || previousAccuracy > 20
  ) return false;

  const dtMs = current.t - previousRaw.t;
  if (dtMs <= 0 || dtMs > MAX_CREDIBLE_MOTION_SAMPLE_INTERVAL_MS) return false;
  const dtS = dtMs / 1000;
  const nativeStepM = haversineM(previousRaw, current);
  const expectedStepM = speed * dtS;
  const minimumStepM = Math.max(
    MIN_CREDIBLE_MOTION_STEP_M,
    Math.min(6, expectedStepM * 0.35),
  );
  if (nativeStepM < minimumStepM) return false;

  // Progress must move away from the current accepted anchor rather than
  // orbiting it as stationary GPS drift commonly does.
  const previousProgressM = haversineM(lastAccepted, previousRaw);
  const currentProgressM = haversineM(lastAccepted, current);
  if (currentProgressM < previousProgressM + 1) return false;

  // Do not let a noisy speed value excuse a physically implausible sample.
  const uncertaintyM = Math.max(accuracy, previousAccuracy, 5);
  const maximumStepM = Math.max(
    MODE_MAX_SPEED_MPS[mode] * dtS + uncertaintyM,
    expectedStepM * 2 + uncertaintyM,
  );
  return nativeStepM <= maximumStepM;
}

export function newSegmentId(clientActivityId: string, at = Date.now()): string {
  return `${clientActivityId}:${at}:${Math.random().toString(16).slice(2, 10)}`;
}

export function saveEligibility(
  points: ReadonlyArray<TrackPoint>,
  distanceM: number,
): SaveEligibility {
  if (points.length < 2) return { eligible: false, reason: 'not-enough-points' };
  if (distanceM < 20) return { eligible: false, reason: 'not-enough-distance' };
  return { eligible: true, reason: 'eligible' };
}

export function shouldStartNewSegment(args: {
  previous: SegmentedTrackPoint | null;
  next: Pick<SegmentedTrackPoint, 'lat' | 'lng' | 't' | 'accuracy'>;
  mode: ActivityMode;
  knownRecordingLoss?: boolean;
}): boolean {
  const { previous, next, mode, knownRecordingLoss = false } = args;
  if (!previous) return false;
  if (knownRecordingLoss) return true;

  const dtMs = next.t - previous.t;
  if (dtMs <= 0) return true;
  const dtS = dtMs / 1000;
  const distanceM = haversineM(previous, next);
  const previousAccuracy = previous.accuracy ?? 25;
  const nextAccuracy = next.accuracy ?? 25;
  const uncertaintyM = Math.max(25, previousAccuracy + nextAccuracy);
  const impliedSpeedMps = Math.max(0, distanceM - uncertaintyM) / dtS;
  const implausibleMovement = impliedSpeedMps > MODE_MAX_SPEED_MPS[mode];
  const longAndSpatiallyUncertain =
    dtMs > MAX_CREDITABLE_ACTIVE_INTERVAL_MS &&
    (distanceM > uncertaintyM * 2 || previousAccuracy > 15 || nextAccuracy > 15);

  return implausibleMovement || longAndSpatiallyUncertain;
}

export function segmentTrace(points: ReadonlyArray<TrackPoint>): SegmentedTrace {
  const segments: SegmentedTrackPoint[][] = [];
  const gaps: GapConnector[] = [];
  let current: SegmentedTrackPoint[] = [];
  let previous: SegmentedTrackPoint | null = null;

  points.forEach((raw, index) => {
    const point = raw as SegmentedTrackPoint;
    const segmentId = point.segmentId || 'legacy-0';
    const normalized: SegmentedTrackPoint = { ...point, segmentId };
    const begins = index === 0 || !previous || segmentId !== previous.segmentId;
    if (begins) {
      if (current.length > 0) segments.push(current);
      if (previous) gaps.push({ from: previous, to: normalized });
      current = [normalized];
    } else {
      current.push(normalized);
    }
    previous = normalized;
  });
  if (current.length > 0) segments.push(current);
  return { segments, gaps };
}

export function calculateActivityStats(points: ReadonlyArray<TrackPoint>): ActivityStats {
  let distanceM = 0;
  let legacyElevationGainM = 0;
  let activeDurationMs = 0;
  const normalized = points.map((point) => ({
    ...(point as SegmentedTrackPoint),
    segmentId: (point as SegmentedTrackPoint).segmentId || 'legacy-0',
  }));

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const next = normalized[index];
    if (previous.segmentId !== next.segmentId) continue;
    const dtMs = next.t - previous.t;
    if (dtMs <= 0) continue;
    distanceM += haversineM(previous, next);
    // Segment assignment is the continuity authority. Once two points are in
    // the same real segment, their full interval is active time; time alone
    // must not silently subtract duration. Untrusted intervals are represented
    // by different segment IDs before stats are calculated.
    activeDurationMs += dtMs;
    if (previous.alt != null && next.alt != null && next.alt > previous.alt) {
      legacyElevationGainM += next.alt - previous.alt;
    }
  }

  // Recovered/Simulator/legacy points may predate verticalAccuracy. Preserve
  // their historical behavior. A real native stream that supplies vertical
  // uncertainty uses the independent quality model instead.
  const hasVerticalQualityEvidence = normalized.some(point => point.verticalAccuracy != null);
  const elevationGainM = hasVerticalQualityEvidence
    ? calculateQualityElevationGain(normalized)
    : legacyElevationGainM;
  return { distanceM, elevationGainM, activeDurationS: Math.floor(activeDurationMs / 1000) };
}

export function toServerPoint(point: TrackPoint): {
  lat: number;
  lng: number;
  t: number;
  alt?: number;
  acc?: number;
  v_acc?: number;
  speed_mps?: number;
  course_deg?: number;
  raw_ordinal?: number;
  segment_id?: string;
  segment_start_reason?: SegmentStartReason;
} {
  const segmented = point as SegmentedTrackPoint;
  return {
    lat: point.lat,
    lng: point.lng,
    // Core Location timestamps can contain fractional milliseconds on iOS.
    // The server contract is integer epoch milliseconds, so normalize at the
    // shared boundary (also repairs pre-fix pending payloads when replayed).
    t: Math.floor(point.t),
    ...(point.alt != null ? { alt: point.alt } : {}),
    ...(point.accuracy != null ? { acc: point.accuracy } : {}),
    ...(point.verticalAccuracy != null ? { v_acc: point.verticalAccuracy } : {}),
    ...(point.speed != null ? { speed_mps: point.speed } : {}),
    ...(point.course != null ? { course_deg: point.course } : {}),
    ...(point.rawOrdinal != null ? { raw_ordinal: point.rawOrdinal } : {}),
    ...(segmented.segmentId ? { segment_id: segmented.segmentId } : {}),
    ...(segmented.segmentStartReason ? { segment_start_reason: segmented.segmentStartReason } : {}),
  };
}
