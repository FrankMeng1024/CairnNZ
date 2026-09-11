import type { ActivityMode } from '../../store/useSessionStore';
import { haversineM } from '../../utils/geo';

export const REAL_GPS_CONTINUITY_VERSION = 3;
export const REAL_GPS_CANDIDATE_MAX_AGE_MS = 5_000;
export const REAL_GPS_REACQUISITION_CANDIDATE_MAX_AGE_MS = 20_000;

const MAX_HORIZONTAL_ACCURACY_M = 25;
const MAX_RECENT_OBSERVATIONS = 6;
const MAX_RECENT_AGE_MS = 8_000;
const MAX_CANDIDATE_OBSERVATIONS = 4;
const MIN_REACQUISITION_CANDIDATE_INTERVAL_MS = 20_000;
const MAX_ESTABLISHED_EDGE_AGE_MS = 20_000;
const MAX_CREDITABLE_CONTINUOUS_INTERVAL_MS = 120_000;
const CANDIDATE_MIN_TURN_DEG = 82;
const CANDIDATE_MIN_STEP_M = 18;
const CANDIDATE_MIN_INNOVATION_M = 12;
const REPORTED_STATIONARY_SPEED_MPS = 0.5;

const MODE_MAX_SPEED_MPS: Record<ActivityMode, number> = {
  hiking: 4.17,
  running: 10,
};

export interface RealGpsObservation {
  lat: number;
  lng: number;
  t: number;
  accuracy: number | null;
  verticalAccuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  course?: number | null;
  /** Native scalar uncertainty when a provider exposes it. Expo Location does
   * not currently guarantee either field, so absence must remain correct. */
  speedAccuracy?: number | null;
  courseAccuracy?: number | null;
  source: 'foreground' | 'background' | 'significant-change';
  observationId: string;
  /** Privacy-safe source ordering; coordinates remain outside remote telemetry. */
  rawOrdinal?: number;
}

export interface TrustedMotionObservation extends RealGpsObservation {
  segmentId: string;
}

export type RealGpsMotionState = 'acquiring' | 'moving' | 'probably-stationary' | 'uncertain';

export interface PendingMotionCandidate {
  id: string;
  /** First observation retained for v1 telemetry and rollback diagnostics. */
  observation: RealGpsObservation;
  /** Ordered, bounded evidence. Candidate points are not canonical truth. */
  observations: RealGpsObservation[];
  createdAtMs: number;
  evidenceCount: number;
  reason: 'large-lateral-innovation' | 'possible-gap-reacquisition' | 'possible-stationary-jitter';
}

export function realGpsCandidateMaxAgeMs(candidate: PendingMotionCandidate): number {
  return candidate.reason === 'possible-gap-reacquisition'
    ? REAL_GPS_REACQUISITION_CANDIDATE_MAX_AGE_MS
    : REAL_GPS_CANDIDATE_MAX_AGE_MS;
}

export interface RealGpsContinuityState {
  version: typeof REAL_GPS_CONTINUITY_VERSION;
  previousTrusted: TrustedMotionObservation | null;
  lastTrusted: TrustedMotionObservation | null;
  /** Explicit canonical walking anchor. Position refinement cannot move it. */
  traversalAnchor: TrustedMotionObservation | null;
  pending: PendingMotionCandidate | null;
  motionState: RealGpsMotionState;
  /** Accuracy-eligible raw evidence only; bounded by count and time. */
  recentEligibleRaw: RealGpsObservation[];
  /** Ephemeral position refinement. Never a route/metric/Memory point. */
  positionEstimate: { lat: number; lng: number; t: number } | null;
  liveCoordinate: { lat: number; lng: number } | null;
  liveSegmentId: string | null;
  /** Raw ordering watermark. Rejections advance this, never the trusted anchor. */
  latestObservationTimestamp: number | null;
}

export interface MotionDiagnostics {
  dtFromTrustedMs: number | null;
  displacementFromTrustedM: number | null;
  impliedSpeedMps: number | null;
  lowerBoundSpeedMps: number | null;
  predictionInnovationM: number | null;
  headingDeltaDeg: number | null;
  accuracyM: number | null;
  windowCount: number;
  windowDurationMs: number;
  cumulativeProgressM: number;
  netProgressM: number;
  progressRatio: number;
  clusterRadiusM: number;
  robustDispersionM: number;
  medianStepSpeedMps: number;
  stepSpeedMadMps: number;
  coherentStepFraction: number;
  reportedMovingFraction: number;
  directionVariabilityDeg: number;
  turnSignConsistency: number;
  reportedSpeedMps: number | null;
  reportedSpeedContradiction: boolean;
  motionStateBefore: RealGpsMotionState;
  motionStateAfter: RealGpsMotionState;
}

export type MotionDecisionKind = 'ACCEPT' | 'REJECT' | 'QUARANTINE' | 'REFINE';

export interface MotionDecision {
  kind: MotionDecisionKind;
  reason:
    | 'first-trusted-fix'
    | 'coherent-motion'
    | 'poor-horizontal-accuracy'
    | 'impossible-accuracy-adjusted-speed'
    | 'possible-gap-reacquisition'
    | 'large-lateral-innovation'
    | 'possible-stationary-jitter'
    | 'stationary-cluster-refined'
    | 'stationary-cluster-suppressed'
    | 'candidate-rejoined-trusted-corridor'
    | 'candidate-new-direction-confirmed'
    | 'candidate-awaiting-second-fix'
    | 'candidate-unresolved'
    | 'candidate-timeout'
    | 'non-monotonic-observation';
  state: RealGpsContinuityState;
  diagnostics: MotionDiagnostics;
  candidateEvent?: {
    type: 'candidate_created' | 'candidate_confirmed' | 'candidate_rejected' | 'candidate_timeout';
    candidateId: string;
    candidateRawOrdinal?: number;
    delayMs: number;
    evidenceCount?: number;
    corroboratingDisplacementM?: number;
    cumulativeProgressM?: number;
    netProgressM?: number;
    detourExcessM?: number;
    reversalDeg?: number;
  };
  /** Compatibility alias for the original one-fix Candidate contract. */
  confirmedCandidate?: RealGpsObservation;
  /** Every pending observation promoted by cumulative corroboration, in order. */
  confirmedCandidates?: RealGpsObservation[];
}

type LegacyContinuityState = Partial<Omit<RealGpsContinuityState, 'version'>> & {
  version?: number;
  pending?: (Partial<PendingMotionCandidate> & { observation?: RealGpsObservation }) | null;
};

function normalizedAccuracy(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) && value >= 0 ? value : MAX_HORIZONTAL_ACCURACY_M;
}

function isObservation(value: unknown): value is RealGpsObservation {
  const observation = value as RealGpsObservation | null;
  return Boolean(
    observation
    && Number.isFinite(observation.lat)
    && Number.isFinite(observation.lng)
    && Number.isFinite(observation.t)
    && typeof observation.observationId === 'string',
  );
}

function trimRecent(points: RealGpsObservation[], nowT: number): RealGpsObservation[] {
  return points
    .filter(point => isObservation(point) && point.t >= nowT - MAX_RECENT_AGE_MS && point.t <= nowT)
    .slice(-MAX_RECENT_OBSERVATIONS);
}

export function createRealGpsContinuityState(
  points: TrustedMotionObservation[] = [],
): RealGpsContinuityState {
  const trusted = points.filter(isObservation).slice(-2);
  const latest = trusted[trusted.length - 1] ?? null;
  return {
    version: REAL_GPS_CONTINUITY_VERSION,
    previousTrusted: trusted.length > 1 ? trusted[trusted.length - 2] : null,
    lastTrusted: latest,
    traversalAnchor: latest,
    pending: null,
    motionState: trusted.length > 1 ? 'moving' : 'acquiring',
    recentEligibleRaw: trimRecent(trusted, latest?.t ?? 0),
    positionEstimate: latest ? { lat: latest.lat, lng: latest.lng, t: latest.t } : null,
    liveCoordinate: latest ? { lat: latest.lat, lng: latest.lng } : null,
    liveSegmentId: latest?.segmentId ?? null,
    latestObservationTimestamp: latest?.t ?? null,
  };
}

/**
 * Current bundles restore v3 checkpoints. Older v1/v2 pending Candidates are
 * intentionally discarded because its single-step semantics are incompatible
 * with Stationary V2; journaled canonical history remains authoritative. A
 * rollback bundle sees the unknown version, ignores it, and reconstructs from
 * the same canonical journal.
 */
export function restoreRealGpsContinuityState(
  checkpoint: unknown,
  fallbackPoints: TrustedMotionObservation[] = [],
): RealGpsContinuityState {
  const value = checkpoint as LegacyContinuityState | null;
  if (!value || value.version !== REAL_GPS_CONTINUITY_VERSION) {
    const fallback = fallbackPoints.length > 0
      ? fallbackPoints
      : value?.lastTrusted && isObservation(value.lastTrusted)
        ? [value.lastTrusted as TrustedMotionObservation]
        : [];
    const restored = createRealGpsContinuityState(fallback);
    const watermark = Number(value?.latestObservationTimestamp);
    return Number.isFinite(watermark)
      ? { ...restored, latestObservationTimestamp: Math.max(restored.latestObservationTimestamp ?? 0, watermark) }
      : restored;
  }

  const lastTrusted = value.lastTrusted && isObservation(value.lastTrusted)
    ? value.lastTrusted as TrustedMotionObservation
    : null;
  const previousTrusted = value.previousTrusted && isObservation(value.previousTrusted)
    ? value.previousTrusted as TrustedMotionObservation
    : null;
  const recent = Array.isArray(value.recentEligibleRaw)
    ? value.recentEligibleRaw.filter(isObservation)
    : [];
  const latestT = Math.max(
    Number(value.latestObservationTimestamp) || 0,
    lastTrusted?.t ?? 0,
    recent[recent.length - 1]?.t ?? 0,
  );
  const pendingObservations = Array.isArray(value.pending?.observations)
    ? value.pending!.observations.filter(isObservation).slice(-MAX_CANDIDATE_OBSERVATIONS)
    : value.pending?.observation && isObservation(value.pending.observation)
      ? [value.pending.observation]
      : [];
  const pendingReason = value.pending?.reason;
  const pending = pendingObservations.length > 0
    && (pendingReason === 'large-lateral-innovation'
      || pendingReason === 'possible-gap-reacquisition'
      || pendingReason === 'possible-stationary-jitter')
    ? {
        id: String(value.pending?.id ?? `${pendingObservations[0].observationId}:candidate`),
        observation: pendingObservations[0],
        observations: pendingObservations,
        createdAtMs: Number(value.pending?.createdAtMs) || pendingObservations[0].t,
        evidenceCount: pendingObservations.length,
        reason: pendingReason,
      }
    : null;
  const motionState: RealGpsMotionState = value.motionState === 'moving'
    || value.motionState === 'probably-stationary'
    || value.motionState === 'uncertain'
    || value.motionState === 'acquiring'
    ? value.motionState
    : previousTrusted ? 'moving' : 'acquiring';
  return {
    version: REAL_GPS_CONTINUITY_VERSION,
    previousTrusted,
    lastTrusted,
    traversalAnchor: value.traversalAnchor && isObservation(value.traversalAnchor)
      ? value.traversalAnchor as TrustedMotionObservation
      : lastTrusted,
    pending,
    motionState,
    recentEligibleRaw: trimRecent(recent, latestT),
    positionEstimate: value.positionEstimate && Number.isFinite(value.positionEstimate.lat)
      && Number.isFinite(value.positionEstimate.lng) && Number.isFinite(value.positionEstimate.t)
      ? value.positionEstimate
      : lastTrusted ? { lat: lastTrusted.lat, lng: lastTrusted.lng, t: lastTrusted.t } : null,
    liveCoordinate: value.liveCoordinate && Number.isFinite(value.liveCoordinate.lat)
      && Number.isFinite(value.liveCoordinate.lng)
      ? value.liveCoordinate
      : lastTrusted ? { lat: lastTrusted.lat, lng: lastTrusted.lng } : null,
    liveSegmentId: typeof value.liveSegmentId === 'string' ? value.liveSegmentId : lastTrusted?.segmentId ?? null,
    latestObservationTimestamp: latestT || null,
  };
}

function toRad(degrees: number): number { return degrees * Math.PI / 180; }
function toDeg(radians: number): number { return radians * 180 / Math.PI; }

function bearingDegrees(a: Pick<RealGpsObservation, 'lat' | 'lng'>, b: Pick<RealGpsObservation, 'lat' | 'lng'>): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(((b.lng - a.lng + 540) % 360) - 180);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDeltaDegrees(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}

function destinationApprox(
  origin: Pick<RealGpsObservation, 'lat' | 'lng'>,
  bearing: number,
  distanceM: number,
): { lat: number; lng: number } {
  const radians = toRad(bearing);
  const northM = Math.cos(radians) * distanceM;
  const eastM = Math.sin(radians) * distanceM;
  const lat = origin.lat + northM / 111_320;
  const lngScale = Math.max(0.2, Math.cos(toRad(origin.lat)));
  return { lat, lng: origin.lng + eastM / (111_320 * lngScale) };
}

interface WindowFeatures {
  count: number;
  durationMs: number;
  cumulativeM: number;
  netM: number;
  progressRatio: number;
  clusterRadiusM: number;
  robustDispersionM: number;
  directionVariabilityDeg: number;
  turnSignConsistency: number;
  medianAccuracyM: number;
  medianStepSpeedMps: number;
  stepSpeedMadMps: number;
  coherentStepFraction: number;
  lowReportedSpeedFraction: number;
  reportedMovingFraction: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function featuresFor(points: RealGpsObservation[]): WindowFeatures {
  if (points.length === 0) {
    return {
      count: 0, durationMs: 0, cumulativeM: 0, netM: 0, progressRatio: 0,
      clusterRadiusM: 0, robustDispersionM: 0, directionVariabilityDeg: 0,
      turnSignConsistency: 0, medianAccuracyM: MAX_HORIZONTAL_ACCURACY_M,
      medianStepSpeedMps: 0, stepSpeedMadMps: 0, coherentStepFraction: 0,
      lowReportedSpeedFraction: 0, reportedMovingFraction: 0,
    };
  }
  let cumulativeM = 0;
  const bearings: number[] = [];
  const stepSpeedsMps: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const edgeM = haversineM(points[index - 1], points[index]);
    cumulativeM += edgeM;
    if (edgeM >= 0.35) bearings.push(bearingDegrees(points[index - 1], points[index]));
    const dtS = (points[index].t - points[index - 1].t) / 1_000;
    if (dtS > 0) stepSpeedsMps.push(edgeM / dtS);
  }
  const netM = points.length > 1 ? haversineM(points[0], points[points.length - 1]) : 0;
  const centre = {
    lat: median(points.map(point => point.lat)),
    lng: median(points.map(point => point.lng)),
  };
  const centreDistancesM = points.map(point => haversineM(centre, point));
  const clusterRadiusM = Math.max(0, ...centreDistancesM);
  const robustDispersionM = median(centreDistancesM);
  const directionChanges = bearings.slice(1).map((bearing, index) => angleDeltaDegrees(bearings[index], bearing));
  const signedTurns = bearings.slice(1)
    .map((bearing, index) => ((bearing - bearings[index] + 540) % 360) - 180)
    .filter(turn => Math.abs(turn) >= 20);
  const positiveTurns = signedTurns.filter(turn => turn > 0).length;
  const turnSignConsistency = signedTurns.length > 0
    ? Math.max(positiveTurns, signedTurns.length - positiveTurns) / signedTurns.length
    : 0;
  const lowSpeedCount = points.filter(point => (
    point.speed != null && Number.isFinite(point.speed)
    && point.speed >= 0 && point.speed < REPORTED_STATIONARY_SPEED_MPS
  )).length;
  const reportedMovingCount = points.filter(point => (
    point.speed != null && Number.isFinite(point.speed)
    && point.speed >= REPORTED_STATIONARY_SPEED_MPS
  )).length;
  const medianStepSpeedMps = median(stepSpeedsMps);
  const stepSpeedMadMps = median(stepSpeedsMps.map(speed => Math.abs(speed - medianStepSpeedMps)));
  const coherentStepCount = stepSpeedsMps.filter(speed => speed >= 0.25 && speed <= 4.5).length;
  return {
    count: points.length,
    durationMs: Math.max(0, points[points.length - 1].t - points[0].t),
    cumulativeM,
    netM,
    progressRatio: cumulativeM > 0 ? netM / cumulativeM : 0,
    clusterRadiusM,
    robustDispersionM,
    directionVariabilityDeg: directionChanges.length > 0 ? median(directionChanges) : 0,
    turnSignConsistency,
    medianAccuracyM: median(points.map(point => normalizedAccuracy(point.accuracy))),
    medianStepSpeedMps,
    stepSpeedMadMps,
    coherentStepFraction: stepSpeedsMps.length > 0 ? coherentStepCount / stepSpeedsMps.length : 0,
    lowReportedSpeedFraction: lowSpeedCount / points.length,
    reportedMovingFraction: reportedMovingCount / points.length,
  };
}

function showsCumulativeProgress(features: WindowFeatures): boolean {
  return features.count >= 3
    && features.durationMs > 0
    && features.cumulativeM >= 2
    && features.netM >= 1.75
    && features.progressRatio >= 0.55;
}

function showsStationaryCluster(features: WindowFeatures): boolean {
  const uncertaintyRadiusM = Math.min(8, Math.max(3.5, features.medianAccuracyM * 0.85));
  return features.count >= 5
    && features.durationMs >= 3_000
    && features.cumulativeM >= 2
    && features.netM <= Math.max(2.5, features.medianAccuracyM * 0.55)
    && features.progressRatio <= 0.42
    && features.clusterRadiusM <= uncertaintyRadiusM
    && features.turnSignConsistency < 0.75
    && (features.lowReportedSpeedFraction >= 0.4 || features.directionVariabilityDeg >= 55);
}

function robustPositionEstimate(
  points: RealGpsObservation[],
  fallback: RealGpsObservation,
): { lat: number; lng: number; t: number } {
  const window = points.slice(-MAX_RECENT_OBSERVATIONS);
  if (window.length === 0) return { lat: fallback.lat, lng: fallback.lng, t: fallback.t };
  const weightedMedian = (axis: 'lat' | 'lng') => {
    const sorted = window
      .map(point => ({
        value: point[axis],
        // Accuracy is uncertainty evidence, not an offset to subtract. Clamp
        // its influence so one optimistic fix cannot own the estimate.
        weight: 1 / Math.min(25, Math.max(4, normalizedAccuracy(point.accuracy))),
      }))
      .sort((a, b) => a.value - b.value);
    const total = sorted.reduce((sum, item) => sum + item.weight, 0);
    let seen = 0;
    for (const item of sorted) {
      seen += item.weight;
      if (seen >= total / 2) return item.value;
    }
    return sorted[sorted.length - 1].value;
  };
  return { lat: weightedMedian('lat'), lng: weightedMedian('lng'), t: fallback.t };
}

function diagnosticsFor(
  state: RealGpsContinuityState,
  current: RealGpsObservation,
  motionStateAfter = state.motionState,
): MotionDiagnostics {
  const last = state.lastTrusted;
  const features = featuresFor(state.recentEligibleRaw);
  let dtMs: number | null = null;
  let displacementM: number | null = null;
  let impliedSpeedMps: number | null = null;
  let lowerBoundSpeedMps: number | null = null;
  let predictionInnovationM: number | null = null;
  let headingDeltaDeg: number | null = null;
  if (last) {
    dtMs = current.t - last.t;
    displacementM = haversineM(last, current);
    const dtS = dtMs > 0 ? dtMs / 1_000 : 0;
    impliedSpeedMps = dtS > 0 ? displacementM / dtS : null;
    lowerBoundSpeedMps = dtS > 0
      ? Math.max(0, displacementM - Math.hypot(normalizedAccuracy(last.accuracy), normalizedAccuracy(current.accuracy))) / dtS
      : null;
    const previous = state.previousTrusted;
    if (previous && last.t > previous.t && dtS > 0) {
      const establishedDtMs = last.t - previous.t;
      const establishedDistanceM = haversineM(previous, last);
      if (establishedDistanceM >= 4 && establishedDtMs <= MAX_ESTABLISHED_EDGE_AGE_MS) {
        const establishedBearing = bearingDegrees(previous, last);
        const currentBearing = bearingDegrees(last, current);
        headingDeltaDeg = angleDeltaDegrees(establishedBearing, currentBearing);
        const establishedSpeedMps = Math.min(establishedDistanceM / (establishedDtMs / 1_000), 6);
        predictionInnovationM = haversineM(
          destinationApprox(last, establishedBearing, establishedSpeedMps * dtS),
          current,
        );
      }
    }
  }
  const reportedSpeedMps = current.speed != null && Number.isFinite(current.speed) && current.speed >= 0
    ? current.speed
    : null;
  return {
    dtFromTrustedMs: dtMs,
    displacementFromTrustedM: displacementM,
    impliedSpeedMps,
    lowerBoundSpeedMps,
    predictionInnovationM,
    headingDeltaDeg,
    accuracyM: current.accuracy,
    windowCount: features.count,
    windowDurationMs: features.durationMs,
    cumulativeProgressM: features.cumulativeM,
    netProgressM: features.netM,
    progressRatio: features.progressRatio,
    clusterRadiusM: features.clusterRadiusM,
    robustDispersionM: features.robustDispersionM,
    medianStepSpeedMps: features.medianStepSpeedMps,
    stepSpeedMadMps: features.stepSpeedMadMps,
    coherentStepFraction: features.coherentStepFraction,
    reportedMovingFraction: features.reportedMovingFraction,
    directionVariabilityDeg: features.directionVariabilityDeg,
    turnSignConsistency: features.turnSignConsistency,
    reportedSpeedMps,
    reportedSpeedContradiction: reportedSpeedMps !== null
      && reportedSpeedMps < REPORTED_STATIONARY_SPEED_MPS
      && showsCumulativeProgress(features),
    motionStateBefore: state.motionState,
    motionStateAfter,
  };
}

function withMotionState(state: RealGpsContinuityState, motionState: RealGpsMotionState): RealGpsContinuityState {
  return state.motionState === motionState ? state : { ...state, motionState };
}

function createPending(
  state: RealGpsContinuityState,
  current: RealGpsObservation,
  reason: PendingMotionCandidate['reason'],
  nowMs: number,
): MotionDecision {
  const candidate: PendingMotionCandidate = {
    id: `${current.observationId}:candidate`,
    observation: current,
    observations: [current],
    createdAtMs: nowMs,
    evidenceCount: 1,
    reason,
  };
  const nextState = { ...state, pending: candidate, motionState: 'uncertain' as const };
  return {
    kind: 'QUARANTINE', reason, state: nextState,
    diagnostics: diagnosticsFor(state, current, 'uncertain'),
    candidateEvent: {
      type: 'candidate_created', candidateId: candidate.id,
      candidateRawOrdinal: current.rawOrdinal, delayMs: 0, evidenceCount: 1,
    },
  };
}

function hasReliableReportedSpeed(point: RealGpsObservation): boolean {
  if (point.speed == null || !Number.isFinite(point.speed) || point.speed < 0) return false;
  return point.speedAccuracy == null
    || !Number.isFinite(point.speedAccuracy)
    || point.speedAccuracy <= 0.8;
}

function hasMeasuredReliableReportedSpeed(point: RealGpsObservation): boolean {
  return point.speed != null
    && Number.isFinite(point.speed)
    && point.speed >= 0
    && point.speedAccuracy != null
    && Number.isFinite(point.speedAccuracy)
    && point.speedAccuracy <= 0.8;
}

function reportedStationary(point: RealGpsObservation): boolean {
  return hasReliableReportedSpeed(point) && Number(point.speed) < REPORTED_STATIONARY_SPEED_MPS;
}

function absoluteEdgesPlausible(
  points: Array<Pick<RealGpsObservation, 'lat' | 'lng' | 't'>>,
  mode: ActivityMode,
): boolean {
  return points.slice(1).every((point, index) => {
    const prior = points[index];
    const dtS = (point.t - prior.t) / 1_000;
    return dtS > 0 && haversineM(prior, point) / dtS <= MODE_MAX_SPEED_MPS[mode] + 1;
  });
}

function stationaryCandidateShowsRealProgress(
  base: RealGpsObservation,
  evidence: RealGpsObservation[],
  mode: ActivityMode,
): boolean {
  if (evidence.length < 2) return false;
  const anchored = [base, ...evidence];
  const anchoredFeatures = featuresFor(anchored);
  const localFeatures = featuresFor(evidence);
  if (!absoluteEdgesPlausible(anchored, mode)) return false;

  const speedVariation = anchoredFeatures.stepSpeedMadMps
    / Math.max(0.25, anchoredFeatures.medianStepSpeedMps);
  const commonEvidence = anchoredFeatures.progressRatio >= 0.72
    && anchoredFeatures.coherentStepFraction >= 0.66
    && anchoredFeatures.medianStepSpeedMps >= 0.25
    && anchoredFeatures.medianStepSpeedMps <= MODE_MAX_SPEED_MPS[mode]
    && speedVariation <= 0.75;
  if (!commonEvidence) return false;

  // Two larger, mutually consistent fixes are enough. Metre-cadence or slow
  // motion gets one more observation so cumulative evidence—not one giant
  // escape step—establishes traversal.
  const strongTwoFixProgress = evidence.length >= 2
    && evidence[0].t - base.t <= REAL_GPS_CANDIDATE_MAX_AGE_MS
    && anchoredFeatures.netM >= 4
    && anchoredFeatures.progressRatio >= 0.8
    && anchoredFeatures.directionVariabilityDeg <= 35;
  const metreCadenceProgress = evidence.length >= 3
    && localFeatures.durationMs >= 1_500
    && anchoredFeatures.netM >= 2.2
    && anchoredFeatures.directionVariabilityDeg <= 50;
  const independentSpeedSupport = anchoredFeatures.reportedMovingFraction >= 0.34
    && evidence.length >= 2
    && anchoredFeatures.netM >= 1.5;
  return strongTwoFixProgress || metreCadenceProgress || independentSpeedSupport;
}

function classifyWithoutPending(
  state: RealGpsContinuityState,
  current: RealGpsObservation,
  mode: ActivityMode,
  nowMs: number,
  acceptedReason: MotionDecision['reason'] = 'coherent-motion',
  allowLateralQuarantine = true,
  stationaryTimeoutGuard = false,
): MotionDecision {
  const diagnostics = diagnosticsFor(state, current);
  if (!state.lastTrusted) {
    return {
      kind: 'ACCEPT', reason: 'first-trusted-fix',
      state: withMotionState(state, 'acquiring'),
      diagnostics: diagnosticsFor(state, current, 'acquiring'),
    };
  }
  if (
    diagnostics.dtFromTrustedMs != null
    && diagnostics.dtFromTrustedMs > 0
    && diagnostics.dtFromTrustedMs <= 120_000
    && diagnostics.lowerBoundSpeedMps != null
    && diagnostics.lowerBoundSpeedMps > MODE_MAX_SPEED_MPS[mode]
  ) {
    if (diagnostics.dtFromTrustedMs >= MIN_REACQUISITION_CANDIDATE_INTERVAL_MS) {
      return createPending(state, current, 'possible-gap-reacquisition', nowMs);
    }
    return { kind: 'REJECT', reason: 'impossible-accuracy-adjusted-speed', state, diagnostics };
  }

  const longGapUncertaintyM = state.lastTrusted
    ? Math.max(
        25,
        normalizedAccuracy(state.lastTrusted.accuracy) + normalizedAccuracy(current.accuracy),
      )
    : 25;
  if (
    (diagnostics.dtFromTrustedMs ?? 0) > MAX_CREDITABLE_CONTINUOUS_INTERVAL_MS
    && (diagnostics.displacementFromTrustedM ?? 0) > longGapUncertaintyM * 2
  ) {
    return createPending(state, current, 'possible-gap-reacquisition', nowMs);
  }

  const accuracyM = normalizedAccuracy(current.accuracy);
  const poorAccuracyHighPointSpeed = accuracyM >= 20
    && (diagnostics.displacementFromTrustedM ?? 0) >= 30
    && (diagnostics.impliedSpeedMps ?? 0) > MODE_MAX_SPEED_MPS[mode];
  const suspiciousLateralInnovation = poorAccuracyHighPointSpeed || (
    (diagnostics.dtFromTrustedMs ?? 0) > 0
    && (diagnostics.dtFromTrustedMs ?? 0) <= MAX_ESTABLISHED_EDGE_AGE_MS
    && (diagnostics.displacementFromTrustedM ?? 0) >= Math.max(CANDIDATE_MIN_STEP_M, accuracyM * 0.9)
    && (diagnostics.predictionInnovationM ?? 0) >= Math.max(CANDIDATE_MIN_INNOVATION_M, accuracyM * 0.75)
    && (diagnostics.headingDeltaDeg ?? 0) >= CANDIDATE_MIN_TURN_DEG
    && (accuracyM >= 12 || (diagnostics.predictionInnovationM ?? 0) >= 25)
  );
  if (allowLateralQuarantine && suspiciousLateralInnovation) {
    return createPending(state, current, 'large-lateral-innovation', nowMs);
  }

  const windowFeatures = featuresFor(state.recentEligibleRaw);
  if (showsStationaryCluster(windowFeatures)) {
    const nextState = {
      ...state,
      pending: null,
      motionState: 'probably-stationary' as const,
      positionEstimate: robustPositionEstimate(state.recentEligibleRaw, current),
    };
    return {
      kind: 'REFINE', reason: 'stationary-cluster-refined', state: nextState,
      diagnostics: diagnosticsFor(state, current, 'probably-stationary'),
    };
  }

  const speedSaysStationary = reportedStationary(current);
  const lowSpeedAmbiguousEdge = speedSaysStationary
    && (diagnostics.dtFromTrustedMs ?? 0) > 0
    && (
      (diagnostics.impliedSpeedMps ?? 0) < 0.45
      || (diagnostics.impliedSpeedMps ?? 0) > MODE_MAX_SPEED_MPS[mode] + 1
      || (
        (diagnostics.displacementFromTrustedM ?? 0) >= 3
        && (diagnostics.displacementFromTrustedM ?? 0) <= Math.min(18, Math.max(10, accuracyM * 1.5))
      )
    );
  if (
    lowSpeedAmbiguousEdge
    || (
      speedSaysStationary
      && (diagnostics.dtFromTrustedMs ?? 0) > MAX_ESTABLISHED_EDGE_AGE_MS
      && (diagnostics.displacementFromTrustedM ?? 0) <= Math.min(18, Math.max(8, accuracyM * 1.25))
    )
  ) {
    return createPending(state, current, 'possible-stationary-jitter', nowMs);
  }

  const currentEdgeSupportsMotion = (diagnostics.dtFromTrustedMs ?? 0) > 0
    && (diagnostics.dtFromTrustedMs ?? 0) <= 5_000
    && (diagnostics.displacementFromTrustedM ?? 0) >= 0.55
    && (diagnostics.impliedSpeedMps ?? 0) >= 0.35
    && (diagnostics.impliedSpeedMps ?? 0) <= MODE_MAX_SPEED_MPS[mode] + 1;
  if (state.motionState === 'moving' && currentEdgeSupportsMotion) {
    return {
      kind: 'ACCEPT', reason: acceptedReason,
      state: withMotionState(state, 'moving'),
      diagnostics: diagnosticsFor(state, current, 'moving'),
    };
  }

  const reportedMoving = (stationaryTimeoutGuard
      ? hasMeasuredReliableReportedSpeed(current)
      : hasReliableReportedSpeed(current))
    && Number(current.speed) >= REPORTED_STATIONARY_SPEED_MPS;
  const positionEdgeClearlyMoving = (
    (diagnostics.dtFromTrustedMs ?? 0) > 0
    && (diagnostics.dtFromTrustedMs ?? 0) <= MAX_ESTABLISHED_EDGE_AGE_MS
    && (diagnostics.displacementFromTrustedM ?? 0) >= 2
    && (diagnostics.lowerBoundSpeedMps ?? 0) >= 0.25
    && (diagnostics.impliedSpeedMps ?? 0) <= MODE_MAX_SPEED_MPS[mode] + 1
  );
  const cumulativeWindowSupportsMotion = showsCumulativeProgress(windowFeatures)
    && windowFeatures.medianStepSpeedMps >= 0.35
    && windowFeatures.stepSpeedMadMps / Math.max(0.25, windowFeatures.medianStepSpeedMps) <= 0.75;
  if (
    (reportedMoving || positionEdgeClearlyMoving || (
      !stationaryTimeoutGuard && cumulativeWindowSupportsMotion
    ))
    && (diagnostics.displacementFromTrustedM ?? 0) >= 0.75
    && (diagnostics.impliedSpeedMps ?? 0) <= MODE_MAX_SPEED_MPS[mode] + 1
  ) {
    return {
      kind: 'ACCEPT', reason: acceptedReason,
      state: withMotionState(state, 'moving'),
      diagnostics: diagnosticsFor(state, current, 'moving'),
    };
  }
  return createPending(state, current, 'possible-stationary-jitter', nowMs);
}

function poorAccuracyDecision(state: RealGpsContinuityState, current: RealGpsObservation): MotionDecision | null {
  const accuracyM = normalizedAccuracy(current.accuracy);
  if (
    current.accuracy != null
    && (!Number.isFinite(current.accuracy) || current.accuracy < 0 || accuracyM > MAX_HORIZONTAL_ACCURACY_M)
  ) {
    return { kind: 'REJECT', reason: 'poor-horizontal-accuracy', state, diagnostics: diagnosticsFor(state, current) };
  }
  return null;
}

export function evaluateRealGpsObservation(
  stateInput: RealGpsContinuityState,
  current: RealGpsObservation,
  mode: ActivityMode,
  nowMs = Date.now(),
): MotionDecision {
  const state = restoreRealGpsContinuityState(stateInput);
  if (state.latestObservationTimestamp != null && current.t <= state.latestObservationTimestamp) {
    return { kind: 'REJECT', reason: 'non-monotonic-observation', state, diagnostics: diagnosticsFor(state, current) };
  }
  const observedBase = { ...state, latestObservationTimestamp: current.t };
  const accuracyFailure = poorAccuracyDecision(observedBase, current);
  if (accuracyFailure) return accuracyFailure;
  const observedState = {
    ...observedBase,
    recentEligibleRaw: trimRecent([...observedBase.recentEligibleRaw, current], current.t),
  };
  const pending = observedState.pending;
  if (!pending) return classifyWithoutPending(observedState, current, mode, nowMs);

  const base = observedState.lastTrusted;
  const delayMs = Math.max(0, current.t - pending.observation.t);
  if (!base || delayMs > realGpsCandidateMaxAgeMs(pending)) {
    const cleared = { ...observedState, pending: null, motionState: 'uncertain' as const };
    // O49 real `snap` incident: after a stationary-jitter Candidate expires,
    // an otherwise unsupported scalar speed must not create one final V edge.
    // A measured speed uncertainty, accuracy-adjusted position progression or
    // subsequent coherent fixes can still establish motion. Ordinary moving
    // classification outside this exact timeout boundary is unchanged.
    const next = classifyWithoutPending(
      cleared,
      current,
      mode,
      nowMs,
      'candidate-timeout',
      true,
      pending.reason === 'possible-stationary-jitter',
    );
    return {
      ...next,
      candidateEvent: {
        type: 'candidate_timeout', candidateId: pending.id,
        candidateRawOrdinal: pending.observation.rawOrdinal, delayMs,
        evidenceCount: pending.observations.length,
      },
    };
  }

  const evidence = [...pending.observations, current].slice(-MAX_CANDIDATE_OBSERVATIONS);
  const sequence = [base, ...evidence];
  const sequenceFeatures = featuresFor(sequence);
  const first = pending.observation;
  const outboundM = haversineM(base, first);
  const corroboratingM = haversineM(evidence[evidence.length - 2] ?? first, current);
  const directM = haversineM(base, current);
  const detourExcessM = Math.max(0, sequenceFeatures.cumulativeM - directM);
  const reversalDeg = angleDeltaDegrees(bearingDegrees(base, first), bearingDegrees(first, current));
  const candidateAccuracyM = normalizedAccuracy(first.accuracy);
  const rejoinedTrustedCorridor = pending.reason !== 'possible-stationary-jitter'
    && reversalDeg >= 100
    && detourExcessM >= Math.max(10, candidateAccuracyM * 0.45)
    && directM <= outboundM * 1.25 + normalizedAccuracy(current.accuracy);

  if (rejoinedTrustedCorridor) {
    const cleared = { ...observedState, pending: null, motionState: state.motionState };
    const next = classifyWithoutPending(cleared, current, mode, nowMs, 'candidate-rejoined-trusted-corridor', false);
    return {
      ...next,
      candidateEvent: {
        type: 'candidate_rejected', candidateId: pending.id,
        candidateRawOrdinal: first.rawOrdinal, delayMs,
        evidenceCount: evidence.length,
        corroboratingDisplacementM: corroboratingM,
        cumulativeProgressM: sequenceFeatures.cumulativeM,
        netProgressM: sequenceFeatures.netM,
        detourExcessM, reversalDeg,
      },
    };
  }

  const plausibilityEdges = pending.reason === 'possible-gap-reacquisition'
    ? sequence.slice(2)
    : sequence.slice(1);
  const plausibilityBaseIndex = pending.reason === 'possible-gap-reacquisition' ? 1 : 0;
  const everyEdgePlausible = plausibilityEdges.every((point, index) => {
    const prior = sequence[index + plausibilityBaseIndex];
    const dtS = (point.t - prior.t) / 1_000;
    if (dtS <= 0) return false;
    const lowerBoundM = Math.max(
      0,
      haversineM(prior, point) - Math.hypot(normalizedAccuracy(prior.accuracy), normalizedAccuracy(point.accuracy)),
    );
    return lowerBoundM / dtS <= MODE_MAX_SPEED_MPS[mode];
  });
  const candidateProgressConfirmed = pending.reason === 'possible-stationary-jitter'
    ? stationaryCandidateShowsRealProgress(base, evidence, mode)
    : showsCumulativeProgress(sequenceFeatures);
  if (everyEdgePlausible && candidateProgressConfirmed) {
    // A long, low-speed stationary tail must not be retroactively relabelled
    // as walking merely because the *current* fix supplies independent moving
    // evidence. In that transition the current fix starts traversal; only a
    // short candidate sequence (or candidates with their own reliable motion
    // evidence) may be promoted. This is what prevents startup refinement from
    // becoming a delayed false route when the user finally departs.
    const candidateBeganPromptly = first.t - base.t <= REAL_GPS_CANDIDATE_MAX_AGE_MS;
    const confirmedCandidates = pending.reason === 'possible-stationary-jitter'
      && !candidateBeganPromptly
      ? pending.observations.filter(candidate => (
          hasReliableReportedSpeed(candidate)
          && Number(candidate.speed) >= REPORTED_STATIONARY_SPEED_MPS
        ))
      : pending.observations;
    const cleared = { ...observedState, pending: null, motionState: 'moving' as const };
    return {
      kind: 'ACCEPT',
      reason: 'candidate-new-direction-confirmed',
      state: cleared,
      diagnostics: diagnosticsFor(cleared, current, 'moving'),
      candidateEvent: {
        type: 'candidate_confirmed', candidateId: pending.id,
        candidateRawOrdinal: first.rawOrdinal, delayMs,
        evidenceCount: evidence.length,
        corroboratingDisplacementM: corroboratingM,
        cumulativeProgressM: sequenceFeatures.cumulativeM,
        netProgressM: sequenceFeatures.netM,
        detourExcessM, reversalDeg,
      },
      confirmedCandidate: confirmedCandidates[0],
      confirmedCandidates,
    };
  }

  const conflictingStationaryEvidence = pending.reason === 'possible-stationary-jitter'
    && evidence.length >= 3
    && (
      sequenceFeatures.progressRatio < 0.65
      || sequenceFeatures.directionVariabilityDeg > 55
      || sequenceFeatures.stepSpeedMadMps / Math.max(0.25, sequenceFeatures.medianStepSpeedMps) > 0.9
    );
  if (
    showsStationaryCluster(sequenceFeatures)
    || conflictingStationaryEvidence
    || evidence.length >= MAX_CANDIDATE_OBSERVATIONS
  ) {
    // The resolving observation is still raw evidence. Carry it forward as
    // the first fix of a fresh bounded Candidate so a genuine stop->start is
    // not forced to wait for a fourth new callback after old jitter resolves.
    const carryForward: PendingMotionCandidate = {
      id: `${current.observationId}:candidate`,
      observation: current,
      observations: [current],
      createdAtMs: nowMs,
      evidenceCount: 1,
      reason: 'possible-stationary-jitter',
    };
    const nextState = {
      ...observedState,
      pending: carryForward,
      motionState: 'uncertain' as const,
      positionEstimate: robustPositionEstimate(observedState.recentEligibleRaw, current),
    };
    return {
      kind: 'REFINE',
      reason: showsStationaryCluster(sequenceFeatures) ? 'stationary-cluster-refined' : 'candidate-unresolved',
      state: nextState,
      diagnostics: diagnosticsFor(observedState, current, 'uncertain'),
      candidateEvent: {
        type: 'candidate_rejected', candidateId: pending.id,
        candidateRawOrdinal: first.rawOrdinal, delayMs,
        evidenceCount: evidence.length,
        corroboratingDisplacementM: corroboratingM,
        cumulativeProgressM: sequenceFeatures.cumulativeM,
        netProgressM: sequenceFeatures.netM,
        detourExcessM, reversalDeg,
      },
    };
  }

  const updatedPending: PendingMotionCandidate = {
    ...pending,
    observations: evidence,
    evidenceCount: evidence.length,
  };
  return {
    kind: 'QUARANTINE', reason: 'candidate-awaiting-second-fix',
    state: { ...observedState, pending: updatedPending, motionState: 'uncertain' },
    diagnostics: diagnosticsFor(observedState, current, 'uncertain'),
  };
}

function moveAtMostToward(
  from: { lat: number; lng: number },
  target: Pick<RealGpsObservation, 'lat' | 'lng'>,
  maxOffsetFromTargetM: number,
): { lat: number; lng: number } {
  const offsetM = haversineM(from, target);
  if (offsetM <= maxOffsetFromTargetM || offsetM === 0) return from;
  const ratio = (offsetM - maxOffsetFromTargetM) / offsetM;
  return {
    lat: from.lat + (target.lat - from.lat) * ratio,
    lng: from.lng + (target.lng - from.lng) * ratio,
  };
}

export function acceptRealGpsObservation(
  stateInput: RealGpsContinuityState,
  observation: RealGpsObservation,
  segmentId: string,
): { state: RealGpsContinuityState; liveCoordinate: { lat: number; lng: number } } {
  const state = restoreRealGpsContinuityState(stateInput);
  const segmentChanged = state.liveSegmentId !== null && state.liveSegmentId !== segmentId;
  let liveCoordinate = { lat: observation.lat, lng: observation.lng };
  if (!segmentChanged && state.liveCoordinate && state.lastTrusted) {
    const measurementWeight = observation.accuracy != null && observation.accuracy > 15 ? 0.8 : 0.9;
    const blended = {
      lat: state.liveCoordinate.lat + (observation.lat - state.liveCoordinate.lat) * measurementWeight,
      lng: state.liveCoordinate.lng + (observation.lng - state.liveCoordinate.lng) * measurementWeight,
    };
    const maxOffsetM = Math.min(2, Math.max(1, normalizedAccuracy(observation.accuracy) * 0.12));
    liveCoordinate = moveAtMostToward(blended, observation, maxOffsetM);
  }
  const trusted: TrustedMotionObservation = { ...observation, segmentId };
  const previousTrusted = segmentChanged ? null : state.lastTrusted;
  return {
    liveCoordinate,
    state: {
      ...state,
      previousTrusted,
      lastTrusted: trusted,
      traversalAnchor: trusted,
      pending: null,
      motionState: segmentChanged ? 'acquiring' : previousTrusted ? 'moving' : state.motionState,
      recentEligibleRaw: segmentChanged ? [observation] : state.recentEligibleRaw,
      positionEstimate: { lat: observation.lat, lng: observation.lng, t: observation.t },
      liveCoordinate,
      liveSegmentId: segmentId,
      latestObservationTimestamp: Math.max(state.latestObservationTimestamp ?? observation.t, observation.t),
    },
  };
}

export function discardPendingCandidate(stateInput: RealGpsContinuityState): RealGpsContinuityState {
  const state = restoreRealGpsContinuityState(stateInput);
  return state.pending ? { ...state, pending: null, motionState: 'uncertain' } : state;
}
