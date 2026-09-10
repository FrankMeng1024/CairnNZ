import { haversineM, type Coordinate } from '../../utils/geo';

export const ELEVATION_QUALITY_VERSION = 1;
export const MAX_VERTICAL_ACCURACY_M = 15;

export interface ElevationObservation extends Coordinate {
  t: number;
  segmentId: string;
}

export interface ElevationQualityState {
  version: typeof ELEVATION_QUALITY_VERSION;
  segmentId: string | null;
  recentAltitudesM: number[];
  filteredAltitudeM: number | null;
  gainAnchorM: number | null;
  pendingRiseStartedAtMs: number | null;
  pendingRiseDistanceM: number;
  pendingRiseSamples: number;
  previousPoint: ElevationObservation | null;
  cumulativeGainM: number;
}

export interface ElevationDecision {
  state: ElevationQualityState;
  rawAltitudeM: number | null;
  verticalAccuracyM: number | null;
  filteredAltitudeM: number | null;
  incrementM: number;
  reason:
    | 'segment-baseline'
    | 'missing-altitude'
    | 'missing-vertical-accuracy'
    | 'poor-vertical-accuracy'
    | 'within-vertical-noise-band'
    | 'pending-sustained-rise'
    | 'sustained-rise-credited'
    | 'descent-anchor-reset';
}

export function createElevationQualityState(cumulativeGainM = 0): ElevationQualityState {
  return {
    version: ELEVATION_QUALITY_VERSION,
    segmentId: null,
    recentAltitudesM: [],
    filteredAltitudeM: null,
    gainAnchorM: null,
    pendingRiseStartedAtMs: null,
    pendingRiseDistanceM: 0,
    pendingRiseSamples: 0,
    previousPoint: null,
    cumulativeGainM,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function clearPending(state: ElevationQualityState): ElevationQualityState {
  return {
    ...state,
    pendingRiseStartedAtMs: null,
    pendingRiseDistanceM: 0,
    pendingRiseSamples: 0,
  };
}

/**
 * Elevation has its own quality authority. O42 `wrong` proved that summing every
 * positive raw altitude delta turns symmetric vertical noise into fake climb.
 * This causal filter requires usable vertical accuracy, median/low-pass noise
 * reduction, a hysteresis band, and sustained time/distance before credit.
 */
export function reduceElevationObservation(
  currentState: ElevationQualityState,
  point: ElevationObservation,
): ElevationDecision {
  const rawAltitudeM = point.alt != null && Number.isFinite(point.alt) ? point.alt : null;
  const verticalAccuracyM = point.verticalAccuracy != null && Number.isFinite(point.verticalAccuracy)
    ? point.verticalAccuracy
    : null;
  const newSegment = currentState.segmentId !== point.segmentId;
  const base = newSegment
    ? { ...createElevationQualityState(currentState.cumulativeGainM), segmentId: point.segmentId }
    : currentState;

  if (rawAltitudeM === null) {
    return {
      state: { ...clearPending(base), previousPoint: point },
      rawAltitudeM,
      verticalAccuracyM,
      filteredAltitudeM: base.filteredAltitudeM,
      incrementM: 0,
      reason: 'missing-altitude',
    };
  }
  if (verticalAccuracyM === null || verticalAccuracyM < 0) {
    return {
      state: { ...clearPending(base), previousPoint: point },
      rawAltitudeM,
      verticalAccuracyM,
      filteredAltitudeM: base.filteredAltitudeM,
      incrementM: 0,
      reason: 'missing-vertical-accuracy',
    };
  }
  if (verticalAccuracyM > MAX_VERTICAL_ACCURACY_M) {
    return {
      state: { ...clearPending(base), previousPoint: point },
      rawAltitudeM,
      verticalAccuracyM,
      filteredAltitudeM: base.filteredAltitudeM,
      incrementM: 0,
      reason: 'poor-vertical-accuracy',
    };
  }

  const recentAltitudesM = [...base.recentAltitudesM, rawAltitudeM].slice(-3);
  const medianAltitudeM = median(recentAltitudesM);
  const filteredAltitudeM = base.filteredAltitudeM === null
    ? medianAltitudeM
    : base.filteredAltitudeM * 0.5 + medianAltitudeM * 0.5;
  if (base.gainAnchorM === null || newSegment) {
    return {
      state: {
        ...base,
        recentAltitudesM,
        filteredAltitudeM,
        gainAnchorM: filteredAltitudeM,
        previousPoint: point,
      },
      rawAltitudeM,
      verticalAccuracyM,
      filteredAltitudeM,
      incrementM: 0,
      reason: 'segment-baseline',
    };
  }

  // O43 hypothesis-driven calibration. The forensic establishes the required
  // quality dimensions, while the exact noise band needs the next native walk.
  // Telemetry emits the raw/filtered values and every decision for adjustment.
  const noiseBandM = Math.min(12, Math.max(4, verticalAccuracyM * 0.8));
  const riseM = filteredAltitudeM - base.gainAnchorM;
  const horizontalStepM = base.previousPoint ? haversineM(base.previousPoint, point) : 0;
  if (riseM >= noiseBandM) {
    const pendingStartedAtMs = base.pendingRiseStartedAtMs ?? point.t;
    const pendingDistanceM = base.pendingRiseDistanceM + horizontalStepM;
    const pendingSamples = base.pendingRiseSamples + 1;
    const sustained = pendingSamples >= 3
      || (point.t - pendingStartedAtMs >= 6_000 && pendingDistanceM >= 8);
    if (sustained) {
      return {
        state: {
          ...base,
          recentAltitudesM,
          filteredAltitudeM,
          gainAnchorM: filteredAltitudeM,
          pendingRiseStartedAtMs: null,
          pendingRiseDistanceM: 0,
          pendingRiseSamples: 0,
          previousPoint: point,
          cumulativeGainM: base.cumulativeGainM + riseM,
        },
        rawAltitudeM,
        verticalAccuracyM,
        filteredAltitudeM,
        incrementM: riseM,
        reason: 'sustained-rise-credited',
      };
    }
    return {
      state: {
        ...base,
        recentAltitudesM,
        filteredAltitudeM,
        pendingRiseStartedAtMs: pendingStartedAtMs,
        pendingRiseDistanceM: pendingDistanceM,
        pendingRiseSamples: pendingSamples,
        previousPoint: point,
      },
      rawAltitudeM,
      verticalAccuracyM,
      filteredAltitudeM,
      incrementM: 0,
      reason: 'pending-sustained-rise',
    };
  }

  if (riseM <= -noiseBandM) {
    return {
      state: {
        ...clearPending(base),
        recentAltitudesM,
        filteredAltitudeM,
        gainAnchorM: filteredAltitudeM,
        previousPoint: point,
      },
      rawAltitudeM,
      verticalAccuracyM,
      filteredAltitudeM,
      incrementM: 0,
      reason: 'descent-anchor-reset',
    };
  }

  return {
    state: {
      ...clearPending(base),
      recentAltitudesM,
      filteredAltitudeM,
      previousPoint: point,
    },
    rawAltitudeM,
    verticalAccuracyM,
    filteredAltitudeM,
    incrementM: 0,
    reason: 'within-vertical-noise-band',
  };
}

export function calculateQualityElevationGain(points: ReadonlyArray<ElevationObservation>): number {
  let state = createElevationQualityState();
  for (const point of points) state = reduceElevationObservation(state, point).state;
  // Finish may arrive while a genuinely sustained final climb is one sample
  // short of the live confirmation threshold. Credit only a two-sample tail;
  // a lone positive spike remains excluded.
  const supportedTailRiseM = (
    state.pendingRiseSamples >= 2
    && state.pendingRiseDistanceM >= 8
    && state.pendingRiseStartedAtMs !== null
    && state.previousPoint !== null
    && state.previousPoint.t - state.pendingRiseStartedAtMs >= 5_000
    && state.filteredAltitudeM !== null
    && state.gainAnchorM !== null
  )
    ? Math.max(0, state.filteredAltitudeM - state.gainAnchorM)
    : 0;
  return state.cumulativeGainM + supportedTailRiseM;
}
