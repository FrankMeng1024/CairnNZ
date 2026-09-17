import { destinationPoint, distanceMeters, initialBearingDegrees } from './geodesy';
import type { SimulatorCoordinate, SimulatorSignal } from './types';

/** Calibrated from the retained Cairn field corpus; not a physical GNSS claim. */
export const REALISTIC_GPS_PROFILE = {
  movingBiasSigmaM: 4.2,
  stationaryBiasSigmaM: 5.8,
  movingBiasTauS: 24,
  stationaryBiasTauS: 46,
  movingJitterSigmaM: 1.05,
  stationaryJitterSigmaM: 1.45,
  jitterCorrelation: 0.28,
  ordinaryOutlierChance: 0.006,
  severeOutlierChance: 0.0012,
  outlierRecoveryTauS: 6,
  minimumAccuracyM: 3.5,
  maximumAccuracyM: 65,
} as const;

export const RAW_GPS_MAX_TIME_SCALE = 10;

export interface RawGpsModelState {
  version: 1;
  seed: number;
  rngState: number;
  modelTimestampMs: number;
  nextObservationAtMs: number;
  fixIndex: number;
  moving: boolean;
  movementAgeS: number;
  biasEastM: number;
  biasNorthM: number;
  jitterEastM: number;
  jitterNorthM: number;
  outlierEastM: number;
  outlierNorthM: number;
  lastGroundTruth: SimulatorCoordinate | null;
  lastObserved: SimulatorCoordinate | null;
  lastObservationTimestampMs: number | null;
  lastAccuracyM: number | null;
}

export interface RawGpsObservation {
  coordinate: SimulatorCoordinate;
  accuracyM: number;
  speedMps: number;
  courseDegrees: number;
  errorEastM: number;
  errorNorthM: number;
  biasEastM: number;
  biasNorthM: number;
  outlier: boolean;
  cadenceMs: number;
}

export interface RawGpsStepResult {
  state: RawGpsModelState;
  observation: RawGpsObservation | null;
}

function normalizeSeed(seed: number): number {
  const integer = Number.isFinite(seed) ? Math.trunc(seed) : 1;
  return (integer >>> 0) || 0x6d2b79f5;
}

function nextUniform(state: number): { state: number; value: number } {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return { state: next || 0x6d2b79f5, value: (next >>> 0) / 4_294_967_296 };
}

function drawUniform(state: RawGpsModelState): number {
  const next = nextUniform(state.rngState);
  state.rngState = next.state;
  return next.value;
}

function drawNormal(state: RawGpsModelState): number {
  const u1 = Math.max(1e-9, drawUniform(state));
  const u2 = drawUniform(state);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function offsetCoordinate(origin: SimulatorCoordinate, eastM: number, northM: number): SimulatorCoordinate {
  const distanceM = Math.hypot(eastM, northM);
  if (distanceM < 1e-6) return { ...origin };
  const bearing = (Math.atan2(eastM, northM) * 180 / Math.PI + 360) % 360;
  return destinationPoint(origin, bearing, distanceM);
}

function nextCadenceMs(state: RawGpsModelState, moving: boolean, degraded: boolean): number {
  const draw = drawUniform(state);
  let seconds: number;
  if (moving) {
    seconds = draw < 0.56 ? 1
      : draw < 0.74 ? 2
        : draw < 0.83 ? 3
          : draw < 0.89 ? 4
            : draw < 0.93 ? 5
              : draw < 0.96 ? 6
                : draw < 0.985 ? 8
                  : 12 + Math.floor(drawUniform(state) * 14);
  } else {
    // Distance-filtered real iOS sessions become less regular at a stop, but
    // fixes continue often enough to exercise Stationary and presentation.
    seconds = draw < 0.44 ? 1
      : draw < 0.62 ? 2
        : draw < 0.73 ? 3
          : draw < 0.81 ? 4
            : draw < 0.87 ? 5
              : draw < 0.92 ? 6
                : draw < 0.96 ? 8
                  : draw < 0.985 ? 12
                    : 18 + Math.floor(drawUniform(state) * 13);
  }
  if (degraded) seconds *= drawUniform(state) < 0.7 ? 2 : 3;
  return Math.round(seconds * 1_000);
}

export function createRawGpsModelState(seed: number, timestampMs: number): RawGpsModelState {
  const normalizedSeed = normalizeSeed(seed);
  return {
    version: 1,
    seed: normalizedSeed,
    rngState: normalizedSeed,
    modelTimestampMs: timestampMs,
    nextObservationAtMs: timestampMs,
    fixIndex: 0,
    moving: false,
    movementAgeS: 0,
    biasEastM: 0,
    biasNorthM: 0,
    jitterEastM: 0,
    jitterNorthM: 0,
    outlierEastM: 0,
    outlierNorthM: 0,
    lastGroundTruth: null,
    lastObserved: null,
    lastObservationTimestampMs: null,
    lastAccuracyM: null,
  };
}

export function sanitizeRawGpsModelState(
  value: unknown,
  seed: number,
  timestampMs: number,
): RawGpsModelState {
  if (!value || typeof value !== 'object') return createRawGpsModelState(seed, timestampMs);
  const raw = value as Partial<RawGpsModelState>;
  if (raw.version !== 1 || !Number.isFinite(raw.rngState) || !Number.isFinite(raw.modelTimestampMs)) {
    return createRawGpsModelState(seed, timestampMs);
  }
  const coordinate = (candidate: unknown): SimulatorCoordinate | null => {
    if (!candidate || typeof candidate !== 'object') return null;
    const point = candidate as Partial<SimulatorCoordinate>;
    return Number.isFinite(point.lat) && Number.isFinite(point.lng)
      ? { lat: Number(point.lat), lng: Number(point.lng) }
      : null;
  };
  const finite = (candidate: unknown, fallback = 0) => Number.isFinite(Number(candidate))
    ? Number(candidate)
    : fallback;
  return {
    version: 1,
    seed: normalizeSeed(finite(raw.seed, seed)),
    rngState: normalizeSeed(finite(raw.rngState, seed)),
    modelTimestampMs: finite(raw.modelTimestampMs, timestampMs),
    nextObservationAtMs: finite(raw.nextObservationAtMs, timestampMs),
    fixIndex: Math.max(0, Math.floor(finite(raw.fixIndex))),
    moving: raw.moving === true,
    movementAgeS: Math.max(0, finite(raw.movementAgeS)),
    biasEastM: clamp(finite(raw.biasEastM), -200, 200),
    biasNorthM: clamp(finite(raw.biasNorthM), -200, 200),
    jitterEastM: clamp(finite(raw.jitterEastM), -50, 50),
    jitterNorthM: clamp(finite(raw.jitterNorthM), -50, 50),
    outlierEastM: clamp(finite(raw.outlierEastM), -250, 250),
    outlierNorthM: clamp(finite(raw.outlierNorthM), -250, 250),
    lastGroundTruth: coordinate(raw.lastGroundTruth),
    lastObserved: coordinate(raw.lastObserved),
    lastObservationTimestampMs: Number.isFinite(Number(raw.lastObservationTimestampMs))
      ? Number(raw.lastObservationTimestampMs)
      : null,
    lastAccuracyM: Number.isFinite(Number(raw.lastAccuracyM)) ? Number(raw.lastAccuracyM) : null,
  };
}

/**
 * Advances the correlated error process once per ground-truth step. A null
 * observation means the healthy source simply did not deliver a fix on this
 * virtual tick; it is not source loss.
 */
export function advanceRawGpsModel(args: {
  state: RawGpsModelState;
  groundTruth: SimulatorCoordinate;
  timestampMs: number;
  trueSpeedMps: number;
  trueCourseDegrees: number;
  signal: SimulatorSignal;
  observationAllowed: boolean;
  forceObservation?: boolean;
  forceOutlierMagnitudeM?: number;
}): RawGpsStepResult {
  const state: RawGpsModelState = { ...args.state };
  const dtS = clamp((args.timestampMs - state.modelTimestampMs) / 1_000, 0, 10);
  const truthStepM = state.lastGroundTruth ? distanceMeters(state.lastGroundTruth, args.groundTruth) : 0;
  const moving = args.trueSpeedMps >= 0.2 || truthStepM >= 0.2;
  state.movementAgeS = moving === state.moving ? state.movementAgeS + dtS : 0;
  state.moving = moving;
  state.modelTimestampMs = args.timestampMs;
  state.lastGroundTruth = { ...args.groundTruth };

  const biasTauS = moving ? REALISTIC_GPS_PROFILE.movingBiasTauS : REALISTIC_GPS_PROFILE.stationaryBiasTauS;
  const biasSigmaM = moving ? REALISTIC_GPS_PROFILE.movingBiasSigmaM : REALISTIC_GPS_PROFILE.stationaryBiasSigmaM;
  const biasRho = Math.exp(-Math.max(0.05, dtS) / biasTauS);
  const biasInnovationM = biasSigmaM * Math.sqrt(Math.max(0, 1 - biasRho ** 2));
  state.biasEastM = biasRho * state.biasEastM + biasInnovationM * drawNormal(state);
  state.biasNorthM = biasRho * state.biasNorthM + biasInnovationM * drawNormal(state);

  const jitterSigmaM = moving
    ? REALISTIC_GPS_PROFILE.movingJitterSigmaM
    : REALISTIC_GPS_PROFILE.stationaryJitterSigmaM;
  const jitterRho = REALISTIC_GPS_PROFILE.jitterCorrelation;
  const jitterInnovationM = jitterSigmaM * Math.sqrt(1 - jitterRho ** 2);
  state.jitterEastM = jitterRho * state.jitterEastM + jitterInnovationM * drawNormal(state);
  state.jitterNorthM = jitterRho * state.jitterNorthM + jitterInnovationM * drawNormal(state);

  const outlierDecay = Math.exp(-Math.max(0.05, dtS) / REALISTIC_GPS_PROFILE.outlierRecoveryTauS);
  state.outlierEastM *= outlierDecay;
  state.outlierNorthM *= outlierDecay;
  if (Math.hypot(state.outlierEastM, state.outlierNorthM) < 0.35) {
    state.outlierEastM = 0;
    state.outlierNorthM = 0;
  }

  const due = args.forceObservation || args.timestampMs >= state.nextObservationAtMs;
  if (!args.observationAllowed || !due) return { state, observation: null };

  state.fixIndex += 1;
  let injectedOutlier = false;
  const ordinaryDraw = drawUniform(state);
  const severeDraw = drawUniform(state);
  let outlierMagnitudeM = Math.max(0, args.forceOutlierMagnitudeM ?? 0);
  if (outlierMagnitudeM <= 0 && state.fixIndex > 8) {
    if (severeDraw < REALISTIC_GPS_PROFILE.severeOutlierChance) {
      outlierMagnitudeM = 75 + drawUniform(state) * 65;
    } else if (ordinaryDraw < REALISTIC_GPS_PROFILE.ordinaryOutlierChance) {
      outlierMagnitudeM = 18 + drawUniform(state) * 38;
    }
  }
  if (outlierMagnitudeM > 0) {
    const angle = drawUniform(state) * Math.PI * 2;
    state.outlierEastM += Math.cos(angle) * outlierMagnitudeM;
    state.outlierNorthM += Math.sin(angle) * outlierMagnitudeM;
    injectedOutlier = true;
  }

  let errorEastM = state.biasEastM + state.jitterEastM + state.outlierEastM;
  let errorNorthM = state.biasNorthM + state.jitterNorthM + state.outlierNorthM;
  const frozen = args.signal === 'frozen' && state.lastObserved;
  let coordinate = frozen
    ? { ...state.lastObserved! }
    : offsetCoordinate(args.groundTruth, errorEastM, errorNorthM);
  if (frozen) {
    // Preserve a literally frozen observation while truth may continue.
    const relativeM = distanceMeters(args.groundTruth, coordinate);
    const bearing = initialBearingDegrees(args.groundTruth, coordinate);
    errorEastM = Math.sin(bearing * Math.PI / 180) * relativeM;
    errorNorthM = Math.cos(bearing * Math.PI / 180) * relativeM;
  }

  const errorMagnitudeM = Math.hypot(errorEastM, errorNorthM);
  let accuracyM = 10.4 + errorMagnitudeM * 0.48 + Math.abs(drawNormal(state)) * 1.7;
  if (Math.hypot(state.outlierEastM, state.outlierNorthM) > 8) {
    accuracyM += Math.hypot(state.outlierEastM, state.outlierNorthM) * 0.19;
  }
  if (args.signal === 'poor') accuracyM = accuracyM * 2.1 + 7;
  accuracyM = clamp(
    accuracyM,
    REALISTIC_GPS_PROFILE.minimumAccuracyM,
    REALISTIC_GPS_PROFILE.maximumAccuracyM,
  );

  const observationDtS = state.lastObservationTimestampMs == null
    ? 0
    : Math.max(0.001, (args.timestampMs - state.lastObservationTimestampMs) / 1_000);
  const observedSpeedMps = state.lastObserved && observationDtS > 0
    ? distanceMeters(state.lastObserved, coordinate) / observationDtS
    : args.trueSpeedMps;
  const stationarySpeedDraw = drawUniform(state);
  const speedMps = moving
    ? clamp(args.trueSpeedMps * 0.72 + observedSpeedMps * 0.28 + drawNormal(state) * 0.12, 0, 15)
    // The snap stop has mostly zero/unknown speed, with one ordinary >0.5 m/s
    // reading in its pre-outlier cloud. Preserve that imperfection without
    // making scalar speed falsely claim motion on every fourth fix.
    : stationarySpeedDraw < 0.58
      ? 0
      : stationarySpeedDraw < 0.92 ? -1 : clamp(observedSpeedMps * 0.15, 0, 0.8);
  const courseDegrees = state.lastObserved && observedSpeedMps >= 0.5
    ? initialBearingDegrees(state.lastObserved, coordinate)
    : args.trueCourseDegrees >= 0 && moving ? args.trueCourseDegrees : -1;
  const cadenceMs = nextCadenceMs(state, moving, args.signal === 'poor');
  state.nextObservationAtMs = args.timestampMs + cadenceMs;
  state.lastObserved = coordinate;
  state.lastObservationTimestampMs = args.timestampMs;
  state.lastAccuracyM = accuracyM;

  return {
    state,
    observation: {
      coordinate,
      accuracyM,
      speedMps,
      courseDegrees,
      errorEastM,
      errorNorthM,
      biasEastM: state.biasEastM,
      biasNorthM: state.biasNorthM,
      outlier: injectedOutlier || Math.hypot(state.outlierEastM, state.outlierNorthM) >= 8,
      cadenceMs,
    },
  };
}
