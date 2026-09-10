import type { ActivityMode } from '../../store/useSessionStore';
import { haversineM } from '../../utils/geo';

export const REAL_GPS_CONTINUITY_VERSION = 1;
export const REAL_GPS_CANDIDATE_MAX_AGE_MS = 5_000;

const MODE_MAX_SPEED_MPS: Record<ActivityMode, number> = {
  hiking: 4.17,
  running: 10,
};
const MAX_HORIZONTAL_ACCURACY_M = 25;
const MIN_ESTABLISHED_EDGE_M = 4;
const MAX_ESTABLISHED_EDGE_AGE_MS = 20_000;
const MIN_REACQUISITION_CANDIDATE_INTERVAL_MS = 20_000;
const CANDIDATE_MIN_TURN_DEG = 82;
const CANDIDATE_MIN_STEP_M = 18;
const CANDIDATE_MIN_INNOVATION_M = 12;

// O43 hypothesis-driven thresholds: `wrong` proves the missing C-X-D style
// rejection, but one walk cannot establish universal values. Keep them here,
// versioned, and emit every input/decision so the next real walk can confirm or
// falsify the model without changing durable Activity truth retrospectively.

export interface RealGpsObservation {
  lat: number;
  lng: number;
  t: number;
  accuracy: number | null;
  verticalAccuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  course?: number | null;
  source: 'foreground' | 'background' | 'significant-change';
  observationId: string;
  /** Privacy-safe source ordering; coordinates remain outside remote telemetry. */
  rawOrdinal?: number;
}

export interface TrustedMotionObservation extends RealGpsObservation {
  segmentId: string;
}

export interface PendingMotionCandidate {
  id: string;
  observation: RealGpsObservation;
  createdAtMs: number;
  evidenceCount: number;
  reason: 'large-lateral-innovation' | 'possible-gap-reacquisition';
}

export interface RealGpsContinuityState {
  version: typeof REAL_GPS_CONTINUITY_VERSION;
  previousTrusted: TrustedMotionObservation | null;
  lastTrusted: TrustedMotionObservation | null;
  pending: PendingMotionCandidate | null;
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
}

export type MotionDecisionKind = 'ACCEPT' | 'REJECT' | 'QUARANTINE';

export interface MotionDecision {
  kind: MotionDecisionKind;
  reason:
    | 'first-trusted-fix'
    | 'coherent-motion'
    | 'poor-horizontal-accuracy'
    | 'impossible-accuracy-adjusted-speed'
    | 'possible-gap-reacquisition'
    | 'large-lateral-innovation'
    | 'candidate-rejoined-trusted-corridor'
    | 'candidate-new-direction-confirmed'
    | 'candidate-awaiting-second-fix'
    | 'candidate-timeout'
    | 'non-monotonic-observation';
  state: RealGpsContinuityState;
  diagnostics: MotionDiagnostics;
  candidateEvent?: {
    type: 'candidate_created' | 'candidate_confirmed' | 'candidate_rejected' | 'candidate_timeout';
    candidateId: string;
    candidateRawOrdinal?: number;
    delayMs: number;
    corroboratingDisplacementM?: number;
    detourExcessM?: number;
    reversalDeg?: number;
  };
  /** A quarantined fix promoted after one corroborating fix. */
  confirmedCandidate?: RealGpsObservation;
}

export function createRealGpsContinuityState(
  points: TrustedMotionObservation[] = [],
): RealGpsContinuityState {
  const trusted = points.slice(-2);
  return {
    version: REAL_GPS_CONTINUITY_VERSION,
    previousTrusted: trusted.length > 1 ? trusted[trusted.length - 2] : null,
    lastTrusted: trusted.length > 0 ? trusted[trusted.length - 1] : null,
    pending: null,
    liveCoordinate: trusted.length > 0
      ? { lat: trusted[trusted.length - 1].lat, lng: trusted[trusted.length - 1].lng }
      : null,
    liveSegmentId: trusted.length > 0 ? trusted[trusted.length - 1].segmentId : null,
    latestObservationTimestamp: trusted.length > 0 ? trusted[trusted.length - 1].t : null,
  };
}

function normalizedAccuracy(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) && value >= 0 ? value : MAX_HORIZONTAL_ACCURACY_M;
}

function toRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

function toDeg(radians: number): number {
  return radians * 180 / Math.PI;
}

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

function diagnosticsFor(
  state: RealGpsContinuityState,
  current: RealGpsObservation,
): MotionDiagnostics {
  const last = state.lastTrusted;
  if (!last) {
    return {
      dtFromTrustedMs: null,
      displacementFromTrustedM: null,
      impliedSpeedMps: null,
      lowerBoundSpeedMps: null,
      predictionInnovationM: null,
      headingDeltaDeg: null,
      accuracyM: current.accuracy,
    };
  }
  const dtMs = current.t - last.t;
  const displacementM = haversineM(last, current);
  const dtS = dtMs > 0 ? dtMs / 1_000 : 0;
  const jointAccuracyM = Math.hypot(
    normalizedAccuracy(last.accuracy),
    normalizedAccuracy(current.accuracy),
  );
  const impliedSpeedMps = dtS > 0 ? displacementM / dtS : null;
  const lowerBoundSpeedMps = dtS > 0
    ? Math.max(0, displacementM - jointAccuracyM) / dtS
    : null;
  let predictionInnovationM: number | null = null;
  let headingDeltaDeg: number | null = null;
  const previous = state.previousTrusted;
  if (previous && last.t > previous.t) {
    const establishedDtMs = last.t - previous.t;
    const establishedDistanceM = haversineM(previous, last);
    if (establishedDistanceM >= MIN_ESTABLISHED_EDGE_M && establishedDtMs <= MAX_ESTABLISHED_EDGE_AGE_MS) {
      const establishedBearing = bearingDegrees(previous, last);
      const currentBearing = bearingDegrees(last, current);
      headingDeltaDeg = angleDeltaDegrees(establishedBearing, currentBearing);
      const establishedSpeedMps = Math.min(
        establishedDistanceM / (establishedDtMs / 1_000),
        6,
      );
      const predicted = destinationApprox(last, establishedBearing, establishedSpeedMps * dtS);
      predictionInnovationM = haversineM(predicted, current);
    }
  }
  return {
    dtFromTrustedMs: dtMs,
    displacementFromTrustedM: displacementM,
    impliedSpeedMps,
    lowerBoundSpeedMps,
    predictionInnovationM,
    headingDeltaDeg,
    accuracyM: current.accuracy,
  };
}

function classifyWithoutPending(
  state: RealGpsContinuityState,
  current: RealGpsObservation,
  mode: ActivityMode,
  nowMs: number,
  acceptedReason: MotionDecision['reason'] = 'coherent-motion',
  allowLateralQuarantine = true,
): MotionDecision {
  const diagnostics = diagnosticsFor(state, current);
  const accuracyM = normalizedAccuracy(current.accuracy);
  if (
    current.accuracy != null
    && (!Number.isFinite(current.accuracy) || current.accuracy < 0 || accuracyM > MAX_HORIZONTAL_ACCURACY_M)
  ) {
    return { kind: 'REJECT', reason: 'poor-horizontal-accuracy', state, diagnostics };
  }
  if (!state.lastTrusted) {
    return { kind: 'ACCEPT', reason: 'first-trusted-fix', state, diagnostics };
  }
  if (
    acceptedReason !== 'candidate-new-direction-confirmed'
    && diagnostics.dtFromTrustedMs != null
    && diagnostics.dtFromTrustedMs > 0
    && diagnostics.dtFromTrustedMs <= 120_000
    && diagnostics.lowerBoundSpeedMps != null
    && diagnostics.lowerBoundSpeedMps > MODE_MAX_SPEED_MPS[mode]
  ) {
    // A physically impossible short edge is an outlier. After a meaningful
    // callback absence, however, the same geometry can mean that iOS omitted
    // the intervening walk. Briefly quarantine it so a second fix can prove a
    // new segment; never freeze on the old anchor until the 120-second cap.
    if (diagnostics.dtFromTrustedMs >= MIN_REACQUISITION_CANDIDATE_INTERVAL_MS) {
      const candidateId = `${current.observationId}:candidate`;
      return {
        kind: 'QUARANTINE',
        reason: 'possible-gap-reacquisition',
        state: {
          ...state,
          pending: {
            id: candidateId,
            observation: current,
            createdAtMs: nowMs,
            evidenceCount: 1,
            reason: 'possible-gap-reacquisition',
          },
        },
        diagnostics,
        candidateEvent: {
          type: 'candidate_created',
          candidateId,
          candidateRawOrdinal: current.rawOrdinal,
          delayMs: 0,
        },
      };
    }
    return { kind: 'REJECT', reason: 'impossible-accuracy-adjusted-speed', state, diagnostics };
  }

  const poorAccuracyHighPointSpeed = (
    accuracyM >= 20
    && diagnostics.displacementFromTrustedM != null
    && diagnostics.displacementFromTrustedM >= 30
    && diagnostics.impliedSpeedMps != null
    && diagnostics.impliedSpeedMps > MODE_MAX_SPEED_MPS[mode]
  );
  const suspiciousLateralInnovation = poorAccuracyHighPointSpeed || (
    diagnostics.dtFromTrustedMs != null
    && diagnostics.dtFromTrustedMs > 0
    && diagnostics.dtFromTrustedMs <= MAX_ESTABLISHED_EDGE_AGE_MS
    && diagnostics.displacementFromTrustedM != null
    && diagnostics.displacementFromTrustedM >= Math.max(CANDIDATE_MIN_STEP_M, accuracyM * 0.9)
    && diagnostics.predictionInnovationM != null
    && diagnostics.predictionInnovationM >= Math.max(CANDIDATE_MIN_INNOVATION_M, accuracyM * 0.75)
    && diagnostics.headingDeltaDeg != null
    && diagnostics.headingDeltaDeg >= CANDIDATE_MIN_TURN_DEG
    && (accuracyM >= 12 || diagnostics.predictionInnovationM >= 25)
  );
  if (allowLateralQuarantine && suspiciousLateralInnovation) {
    const candidateId = `${current.observationId}:candidate`;
    const pending: PendingMotionCandidate = {
      id: candidateId,
      observation: current,
      createdAtMs: nowMs,
      evidenceCount: 1,
      reason: 'large-lateral-innovation',
    };
    return {
      kind: 'QUARANTINE',
      reason: 'large-lateral-innovation',
      state: { ...state, pending },
      diagnostics,
      candidateEvent: {
        type: 'candidate_created',
        candidateId,
        candidateRawOrdinal: current.rawOrdinal,
        delayMs: 0,
      },
    };
  }
  return { kind: 'ACCEPT', reason: acceptedReason, state, diagnostics };
}

export function evaluateRealGpsObservation(
  state: RealGpsContinuityState,
  current: RealGpsObservation,
  mode: ActivityMode,
  nowMs = Date.now(),
): MotionDecision {
  if (
    state.latestObservationTimestamp != null
    && current.t <= state.latestObservationTimestamp
  ) {
    return {
      kind: 'REJECT',
      reason: 'non-monotonic-observation',
      state,
      diagnostics: diagnosticsFor(state, current),
    };
  }
  // Raw ordering and trusted motion are separate authorities: every newer raw
  // observation advances this watermark, but only acceptRealGpsObservation may
  // advance previousTrusted/lastTrusted or any Activity metric.
  const observedState = { ...state, latestObservationTimestamp: current.t };
  const pending = observedState.pending;
  if (!pending) return classifyWithoutPending(observedState, current, mode, nowMs);

  const base = observedState.lastTrusted;
  const delayMs = Math.max(0, current.t - pending.observation.t);
  if (!base || delayMs > REAL_GPS_CANDIDATE_MAX_AGE_MS) {
    const cleared = { ...observedState, pending: null };
    const decision = classifyWithoutPending(cleared, current, mode, nowMs, 'candidate-timeout');
    return {
      ...decision,
      candidateEvent: {
        type: 'candidate_timeout',
        candidateId: pending.id,
        candidateRawOrdinal: pending.observation.rawOrdinal,
        delayMs,
      },
    };
  }

  const outboundM = haversineM(base, pending.observation);
  const corroboratingM = haversineM(pending.observation, current);
  const directM = haversineM(base, current);
  const detourExcessM = Math.max(0, outboundM + corroboratingM - directM);
  const outboundBearing = bearingDegrees(base, pending.observation);
  const nextBearing = bearingDegrees(pending.observation, current);
  const reversalDeg = angleDeltaDegrees(outboundBearing, nextBearing);
  const accuracyM = normalizedAccuracy(pending.observation.accuracy);
  const cleared = { ...observedState, pending: null };

  const rejoinedTrustedCorridor = reversalDeg >= 100
    && detourExcessM >= Math.max(10, accuracyM * 0.45)
    && directM <= outboundM * 1.25 + normalizedAccuracy(current.accuracy);
  if (rejoinedTrustedCorridor) {
    const decision = classifyWithoutPending(
      cleared,
      current,
      mode,
      nowMs,
      'candidate-rejoined-trusted-corridor',
    );
    return {
      ...decision,
      candidateEvent: {
        type: 'candidate_rejected',
        candidateId: pending.id,
        candidateRawOrdinal: pending.observation.rawOrdinal,
        delayMs,
        corroboratingDisplacementM: corroboratingM,
        detourExcessM,
        reversalDeg,
      },
    };
  }

  const continuedNewDirection = reversalDeg <= 60
    && delayMs > 0
    && delayMs <= REAL_GPS_CANDIDATE_MAX_AGE_MS
    && (Math.max(0, corroboratingM - Math.hypot(accuracyM, normalizedAccuracy(current.accuracy))) / (delayMs / 1_000))
      <= MODE_MAX_SPEED_MPS[mode];
  if (continuedNewDirection) {
    // One corroborating fix is enough to prove a plausible new direction. The
    // caller commits the now-confirmed candidate and corroborating observation
    // in timestamp order so a real sharp turn is not silently cut off.
    const decision = classifyWithoutPending(
      cleared,
      current,
      mode,
      nowMs,
      'candidate-new-direction-confirmed',
      false,
    );
    return {
      ...decision,
      candidateEvent: {
        type: 'candidate_confirmed',
        candidateId: pending.id,
        candidateRawOrdinal: pending.observation.rawOrdinal,
        delayMs,
        corroboratingDisplacementM: corroboratingM,
        detourExcessM,
        reversalDeg,
      },
      confirmedCandidate: pending.observation,
    };
  }

  if (delayMs >= REAL_GPS_CANDIDATE_MAX_AGE_MS) {
    const decision = classifyWithoutPending(cleared, current, mode, nowMs, 'candidate-timeout');
    return {
      ...decision,
      candidateEvent: {
        type: 'candidate_timeout',
        candidateId: pending.id,
        candidateRawOrdinal: pending.observation.rawOrdinal,
        delayMs,
        corroboratingDisplacementM: corroboratingM,
        detourExcessM,
        reversalDeg,
      },
    };
  }

  return {
    kind: 'QUARANTINE',
    reason: 'candidate-awaiting-second-fix',
    state: {
      ...observedState,
      pending: { ...pending, evidenceCount: 2 },
    },
    diagnostics: diagnosticsFor(observedState, current),
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
  state: RealGpsContinuityState,
  observation: RealGpsObservation,
  segmentId: string,
): { state: RealGpsContinuityState; liveCoordinate: { lat: number; lng: number } } {
  const segmentChanged = state.liveSegmentId !== null && state.liveSegmentId !== segmentId;
  let liveCoordinate = { lat: observation.lat, lng: observation.lng };
  if (!segmentChanged && state.liveCoordinate && state.lastTrusted) {
    const measurementWeight = observation.accuracy != null && observation.accuracy > 15 ? 0.72 : 0.82;
    const blended = {
      lat: state.liveCoordinate.lat + (observation.lat - state.liveCoordinate.lat) * measurementWeight,
      lng: state.liveCoordinate.lng + (observation.lng - state.liveCoordinate.lng) * measurementWeight,
    };
    // Presentation smoothing may calm accepted jitter, but never leave the
    // visible tail far behind trusted truth or invent a cross-gap connector.
    const maxOffsetM = Math.min(6, Math.max(2, normalizedAccuracy(observation.accuracy) * 0.35));
    liveCoordinate = moveAtMostToward(blended, observation, maxOffsetM);
  }
  const trusted: TrustedMotionObservation = { ...observation, segmentId };
  return {
    liveCoordinate,
    state: {
      ...state,
      previousTrusted: segmentChanged ? null : state.lastTrusted,
      lastTrusted: trusted,
      pending: null,
      liveCoordinate,
      liveSegmentId: segmentId,
      latestObservationTimestamp: Math.max(
        state.latestObservationTimestamp ?? observation.t,
        observation.t,
      ),
    },
  };
}

export function discardPendingCandidate(state: RealGpsContinuityState): RealGpsContinuityState {
  return state.pending ? { ...state, pending: null } : state;
}
