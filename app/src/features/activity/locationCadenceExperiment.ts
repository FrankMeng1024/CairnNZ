import { haversineM } from '../../utils/geo';

export type ForegroundDistanceFilterM = 1 | 5;
export type LocationCadenceVariant = 'distanceFilter1' | 'distanceFilter5';

export interface LocationCadenceExperiment {
  distanceFilterM: ForegroundDistanceFilterM;
  variant: LocationCadenceVariant;
}

export function resolveLocationCadenceExperiment(input: {
  internalBuild: boolean;
  debugMode: boolean;
  selectedDistanceFilterM: ForegroundDistanceFilterM;
}): LocationCadenceExperiment {
  // Native O44 evidence established 1 m as the foreground production
  // candidate. Internal Debug builds retain the explicit 5 m baseline so the
  // source-cadence experiment remains reproducible; production behavior never
  // depends on Debug Mode or a persisted QA selection.
  const distanceFilterM: ForegroundDistanceFilterM = input.internalBuild && input.debugMode
    ? input.selectedDistanceFilterM
    : 1;
  return {
    distanceFilterM,
    variant: distanceFilterM === 1 ? 'distanceFilter1' : 'distanceFilter5',
  };
}

export interface PrivateLocationCoordinate {
  lat: number;
  lng: number;
  timestamp: number | null;
}

export interface MapboxLocationInput extends PrivateLocationCoordinate {
  horizontalAccuracyM: number | null;
  speedMps: number | null;
  courseDeg: number | null;
}

export interface MapboxCadenceState {
  previousLocation: PrivateLocationCoordinate | null;
  previousCallbackWallTimestamp: number | null;
  sourceSequence: number;
  headingOnlyEventsSincePreviousLocation: number;
}

export interface MapboxLocationTelemetryResult {
  state: MapboxCadenceState;
  locationChanged: boolean;
  fields: Record<string, number | boolean | string | null> | null;
}

export function createMapboxCadenceState(): MapboxCadenceState {
  return {
    previousLocation: null,
    previousCallbackWallTimestamp: null,
    sourceSequence: 0,
    headingOnlyEventsSincePreviousLocation: 0,
  };
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function rounded(value: number | null, precision = 2): number | null {
  if (value === null) return null;
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function distanceTo(
  from: Pick<PrivateLocationCoordinate, 'lat' | 'lng'>,
  to: { lat: number; lng: number } | null | undefined,
): number | null {
  if (!to || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) return null;
  return haversineM(from, to);
}

/**
 * Separates RNMapbox location-coordinate fixes from heading callbacks that
 * reuse the last CLLocation. Coordinates remain only in this short-lived
 * local state; emitted fields are relative distances, timing, and quality.
 */
export function observeMapboxLocation(
  state: MapboxCadenceState,
  current: MapboxLocationInput,
  context: {
    callbackWallTimestamp: number;
    monotonicTimestampMs: number;
    appState: string;
    latestCairnRaw: { lat: number; lng: number } | null;
    latestCanonical: { lat: number; lng: number } | null;
  },
): MapboxLocationTelemetryResult {
  if (!Number.isFinite(current.lat) || !Number.isFinite(current.lng)) {
    return { state, locationChanged: false, fields: null };
  }
  const sourceTimestamp = finiteOrNull(current.timestamp);
  const previous = state.previousLocation;
  const timestampChanged = sourceTimestamp !== null && sourceTimestamp !== previous?.timestamp;
  const coordinateChanged = previous === null
    || current.lat !== previous.lat
    || current.lng !== previous.lng;
  const locationChanged = previous === null || timestampChanged || coordinateChanged;
  if (!locationChanged) {
    return {
      state: {
        ...state,
        headingOnlyEventsSincePreviousLocation: state.headingOnlyEventsSincePreviousLocation + 1,
      },
      locationChanged: false,
      fields: null,
    };
  }

  const sourceIntervalMs = previous?.timestamp != null && sourceTimestamp != null
    ? Math.max(0, sourceTimestamp - previous.timestamp)
    : null;
  const callbackIntervalMs = state.previousCallbackWallTimestamp == null
    ? null
    : Math.max(0, context.callbackWallTimestamp - state.previousCallbackWallTimestamp);
  const currentCoordinate = { lat: current.lat, lng: current.lng };
  const fields = {
    sourceSequence: state.sourceSequence + 1,
    sourceTimestamp,
    sourceAgeMs: sourceTimestamp === null
      ? null
      : Math.max(0, context.callbackWallTimestamp - sourceTimestamp),
    sourceIntervalMs,
    callbackIntervalMs,
    monotonicTimestampMs: rounded(context.monotonicTimestampMs, 1),
    horizontalAccuracyM: rounded(finiteOrNull(current.horizontalAccuracyM)),
    reportedSpeedValid: current.speedMps != null && Number.isFinite(current.speedMps) && current.speedMps >= 0,
    reportedSpeedMps: current.speedMps != null && Number.isFinite(current.speedMps) && current.speedMps >= 0
      ? rounded(current.speedMps)
      : null,
    reportedCourseValid: current.courseDeg != null && Number.isFinite(current.courseDeg) && current.courseDeg >= 0,
    reportedCourseDeg: current.courseDeg != null && Number.isFinite(current.courseDeg) && current.courseDeg >= 0
      ? rounded(current.courseDeg, 1)
      : null,
    displacementFromPreviousMapboxLocationM: previous
      ? rounded(distanceTo(currentCoordinate, previous))
      : null,
    displacementToLatestCairnRawM: rounded(distanceTo(currentCoordinate, context.latestCairnRaw)),
    displacementToLatestCanonicalM: rounded(distanceTo(currentCoordinate, context.latestCanonical)),
    coordinateChanged,
    headingOnly: false,
    headingOnlyEventsSincePreviousLocation: state.headingOnlyEventsSincePreviousLocation,
    appState: context.appState,
  };
  return {
    state: {
      previousLocation: { ...currentCoordinate, timestamp: sourceTimestamp },
      previousCallbackWallTimestamp: context.callbackWallTimestamp,
      sourceSequence: state.sourceSequence + 1,
      headingOnlyEventsSincePreviousLocation: 0,
    },
    locationChanged: true,
    fields,
  };
}
