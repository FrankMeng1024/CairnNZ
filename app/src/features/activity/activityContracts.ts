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

export type ActivityDistanceMethod = 'geometry' | 'reported-speed-corroborated';

export interface ActivityDistanceSegmentAccumulator {
  segmentId: string;
  first: Pick<TrackPoint, 'lat' | 'lng' | 't'>;
  previous: Pick<TrackPoint, 'lat' | 'lng' | 't' | 'speed' | 'speedAccuracy'>;
  geometryDistanceM: number;
  reportedSpeedDistanceM: number;
  edgeCount: number;
  reportedSpeedEdgeCount: number;
}

export interface ActivityDistanceAccumulator {
  completedDistanceM: number;
  active: ActivityDistanceSegmentAccumulator | null;
}

export interface ActivityDistanceEstimate {
  distanceM: number;
  method: ActivityDistanceMethod;
  geometryDistanceM: number;
  reportedSpeedDistanceM: number;
  reportedSpeedCoverage: number;
  segmentNetProgressM: number;
}

// Declared before the O65 recovery tuning run. A scalar-speed estimate is
// allowed to correct positional path inflation only after a useful local
// sequence supports it. Missing/zero/contradictory speed therefore never
// vetoes coordinate movement. These are metric semantics only: canonical GPS,
// Memory, Live and Final geometry stay independent and map-free.
export const DISTANCE_SPEED_MIN_EDGES = 4;
export const DISTANCE_SPEED_MIN_COVERAGE = 0.8;
export const DISTANCE_SPEED_MIN_GEOMETRY_RATIO = 0.8;
// Do not substitute scalar speed for already-stable geometry. A correction is
// justified only when it removes at least ~2% of cumulative positional excess.
export const DISTANCE_SPEED_MAX_GEOMETRY_RATIO = 0.98;
export const DISTANCE_SPEED_MIN_NET_PROGRESS_RATIO = 0.97;
const DISTANCE_SPEED_MAX_MPS = 15;

export function createActivityDistanceAccumulator(): ActivityDistanceAccumulator {
  return { completedDistanceM: 0, active: null };
}

function chooseSegmentDistance(
  segment: ActivityDistanceSegmentAccumulator,
): ActivityDistanceEstimate {
  const reportedSpeedCoverage = segment.edgeCount > 0
    ? segment.reportedSpeedEdgeCount / segment.edgeCount
    : 0;
  const segmentNetProgressM = haversineM(segment.first, segment.previous);
  const geometryRatio = segment.geometryDistanceM > 0
    ? segment.reportedSpeedDistanceM / segment.geometryDistanceM
    : 0;
  const speedIsCorroborated = segment.edgeCount >= DISTANCE_SPEED_MIN_EDGES
    && reportedSpeedCoverage >= DISTANCE_SPEED_MIN_COVERAGE
    && geometryRatio >= DISTANCE_SPEED_MIN_GEOMETRY_RATIO
    && geometryRatio <= DISTANCE_SPEED_MAX_GEOMETRY_RATIO
    && segment.reportedSpeedDistanceM
      >= segmentNetProgressM * DISTANCE_SPEED_MIN_NET_PROGRESS_RATIO;
  return {
    distanceM: speedIsCorroborated
      ? Math.min(segment.geometryDistanceM, segment.reportedSpeedDistanceM)
      : segment.geometryDistanceM,
    method: speedIsCorroborated ? 'reported-speed-corroborated' : 'geometry',
    geometryDistanceM: segment.geometryDistanceM,
    reportedSpeedDistanceM: segment.reportedSpeedDistanceM,
    reportedSpeedCoverage,
    segmentNetProgressM,
  };
}

export function activityDistanceEstimate(
  accumulator: ActivityDistanceAccumulator,
): ActivityDistanceEstimate {
  if (!accumulator.active) {
    return {
      distanceM: accumulator.completedDistanceM,
      method: 'geometry',
      geometryDistanceM: accumulator.completedDistanceM,
      reportedSpeedDistanceM: 0,
      reportedSpeedCoverage: 0,
      segmentNetProgressM: 0,
    };
  }
  const active = chooseSegmentDistance(accumulator.active);
  return { ...active, distanceM: accumulator.completedDistanceM + active.distanceM };
}

function speedEdgeDistanceM(
  previous: Pick<TrackPoint, 't' | 'speed' | 'speedAccuracy'>,
  next: Pick<TrackPoint, 't' | 'speed' | 'speedAccuracy'>,
): number | null {
  const dtS = (next.t - previous.t) / 1_000;
  if (dtS <= 0 || dtS > MAX_CREDITABLE_ACTIVE_INTERVAL_MS / 1_000) return null;
  const speeds = [previous.speed, next.speed];
  if (!speeds.every(value => (
    value != null
    && Number.isFinite(value)
    && value >= 0
    && value <= DISTANCE_SPEED_MAX_MPS
  ))) return null;
  // When the provider exposes scalar uncertainty, a clearly weak value does
  // not enter the metric. Absence remains usable only through repeated
  // geometry/progress corroboration in chooseSegmentDistance.
  const speedAccuracies = [previous.speedAccuracy, next.speedAccuracy]
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (speedAccuracies.some(value => value > 1.5)) return null;
  return ((Number(speeds[0]) + Number(speeds[1])) / 2) * dtS;
}

export function appendActivityDistancePoint(
  accumulator: ActivityDistanceAccumulator,
  rawPoint: TrackPoint,
): ActivityDistanceAccumulator {
  const point = rawPoint as SegmentedTrackPoint;
  const segmentId = point.segmentId || 'legacy-0';
  const previousSegment = accumulator.active;
  if (!previousSegment || previousSegment.segmentId !== segmentId) {
    const completedDistanceM = previousSegment
      ? accumulator.completedDistanceM + chooseSegmentDistance(previousSegment).distanceM
      : accumulator.completedDistanceM;
    return {
      completedDistanceM,
      active: {
        segmentId,
        first: { lat: point.lat, lng: point.lng, t: point.t },
        previous: {
          lat: point.lat,
          lng: point.lng,
          t: point.t,
          speed: point.speed,
          speedAccuracy: point.speedAccuracy,
        },
        geometryDistanceM: 0,
        reportedSpeedDistanceM: 0,
        edgeCount: 0,
        reportedSpeedEdgeCount: 0,
      },
    };
  }
  if (point.t <= previousSegment.previous.t) return accumulator;
  const speedDistanceM = speedEdgeDistanceM(previousSegment.previous, point);
  return {
    completedDistanceM: accumulator.completedDistanceM,
    active: {
      ...previousSegment,
      previous: {
        lat: point.lat,
        lng: point.lng,
        t: point.t,
        speed: point.speed,
        speedAccuracy: point.speedAccuracy,
      },
      geometryDistanceM: previousSegment.geometryDistanceM
        + haversineM(previousSegment.previous, point),
      reportedSpeedDistanceM: previousSegment.reportedSpeedDistanceM
        + (speedDistanceM ?? 0),
      edgeCount: previousSegment.edgeCount + 1,
      reportedSpeedEdgeCount: previousSegment.reportedSpeedEdgeCount
        + (speedDistanceM === null ? 0 : 1),
    },
  };
}

export function buildActivityDistanceAccumulator(
  points: ReadonlyArray<TrackPoint>,
): ActivityDistanceAccumulator {
  return points.reduce(appendActivityDistancePoint, createActivityDistanceAccumulator());
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

export interface SegmentProvenanceResolution {
  /** Null means the caller must allocate a new segment identifier. */
  segmentId: string | null;
  startsNewSegment: boolean;
  startReason?: SegmentStartReason;
  ignoredStaleIncoming: boolean;
}

/**
 * Reconcile asynchronous foreground/background provenance without allowing a
 * late callback from an older provider context to move canonical truth back
 * into an earlier segment. A provider may introduce a different segment only
 * with an explicit boundary reason; physical continuity classification remains
 * the fallback authority when no durable boundary exists.
 */
export function resolveSegmentProvenance(args: {
  tailSegmentId: string | null;
  currentSegmentId: string | null;
  incomingSegmentId?: string;
  incomingStartReason?: SegmentStartReason;
  pendingStartReason?: SegmentStartReason;
  physicalGap: boolean;
}): SegmentProvenanceResolution {
  const incumbent = args.currentSegmentId ?? args.tailSegmentId;
  // The first accepted point establishes provenance. There is no earlier
  // canonical segment for an asynchronous callback to regress into.
  if (args.tailSegmentId === null) {
    return {
      segmentId: args.incomingSegmentId ?? incumbent,
      startsNewSegment: false,
      startReason: args.incomingStartReason,
      ignoredStaleIncoming: false,
    };
  }
  const incomingDiffersFromIncumbent = Boolean(
    args.incomingSegmentId
    && incumbent
    && args.incomingSegmentId !== incumbent,
  );
  const explicitIncomingBoundary = Boolean(
    args.incomingStartReason
    && (args.tailSegmentId === null || args.incomingSegmentId !== args.tailSegmentId),
  );

  if (explicitIncomingBoundary) {
    // If the provider supplies a durable reason but no identifier, the
    // caller must allocate one. Reusing the incumbent would label a boundary
    // while silently preserving the old segment.
    const segmentId = args.incomingSegmentId ?? null;
    return {
      segmentId,
      startsNewSegment: Boolean(args.tailSegmentId),
      startReason: args.incomingStartReason,
      ignoredStaleIncoming: false,
    };
  }

  if (args.pendingStartReason && args.currentSegmentId) {
    return {
      segmentId: args.currentSegmentId,
      startsNewSegment: Boolean(
        args.tailSegmentId && args.currentSegmentId !== args.tailSegmentId,
      ),
      startReason: args.pendingStartReason,
      ignoredStaleIncoming: incomingDiffersFromIncumbent,
    };
  }

  if (args.physicalGap) {
    return {
      segmentId: null,
      startsNewSegment: true,
      startReason: 'gps-reacquired',
      ignoredStaleIncoming: incomingDiffersFromIncumbent,
    };
  }

  return {
    segmentId: incomingDiffersFromIncumbent
      ? incumbent
      : (args.incomingSegmentId ?? incumbent),
    startsNewSegment: false,
    ignoredStaleIncoming: incomingDiffersFromIncumbent,
  };
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
  const distanceAccumulator = buildActivityDistanceAccumulator(points);
  const distanceM = activityDistanceEstimate(distanceAccumulator).distanceM;
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
    ...(point.accuracy != null ? { acc: point.accuracy >= 0 ? point.accuracy : undefined } : {}),
    ...(point.verticalAccuracy != null ? { v_acc: point.verticalAccuracy >= 0 ? point.verticalAccuracy : undefined } : {}),
    ...(point.speed != null ? { speed_mps: point.speed >= 0 ? point.speed : undefined } : {}),
    ...(point.course != null ? { course_deg: point.course >= 0 ? point.course : undefined } : {}),
    ...(point.rawOrdinal != null ? { raw_ordinal: point.rawOrdinal } : {}),
    ...(segmented.segmentId ? { segment_id: segmented.segmentId } : {}),
    ...(segmented.segmentStartReason ? { segment_start_reason: segmented.segmentStartReason } : {}),
  };
}
