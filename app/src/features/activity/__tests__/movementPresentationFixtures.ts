import type { ActivityMode, TrackPoint } from '../../../store/useSessionStore';
import { haversineM } from '../../../utils/geo';
import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsObservation,
} from '../realGpsContinuity';

const LAT = -41.25;
const LNG = 174.75;
const METRES_PER_DEGREE = 111_320;
const LNG_SCALE = METRES_PER_DEGREE * Math.cos(LAT * Math.PI / 180);

export type PlanarPoint = readonly [number, number];
export type NoiseModel = 'none' | 'correlated' | 'alternating' | 'slow-bias' | 'lateral-wave';
type FixtureObservation = TrackPoint & RealGpsObservation & {
  segmentId: string;
  clientActivityId: string;
  ownerGeneration: string;
};

export interface KnownPath {
  points: PlanarPoint[];
  cumulativeM: number[];
  totalM: number;
}

export interface SampledKnownPath {
  observations: FixtureObservation[];
  truth: TrackPoint[];
}

export interface PresentationMetrics {
  displayLengthM: number;
  acceptedLengthM: number;
  truthLengthM: number;
  acceptedToDisplayP95M: number;
  acceptedToDisplayMaxM: number;
  truthToDisplayP95M: number;
  orderedLandmarkMaxM: number;
  orderedLandmarksCovered: number;
}

function buildPath(points: PlanarPoint[]): KnownPath {
  const cumulativeM = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeM.push(cumulativeM[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    ));
  }
  return { points, cumulativeM, totalM: cumulativeM.at(-1) ?? 0 };
}

export function parametricPath(
  sample: (progress: number) => PlanarPoint,
  subdivisions = 2_000,
): KnownPath {
  return buildPath(Array.from({ length: subdivisions + 1 }, (_, index) => (
    sample(index / subdivisions)
  )));
}

export function polylinePath(vertices: PlanarPoint[], subdivisionsPerEdge = 120): KnownPath {
  const points: PlanarPoint[] = [];
  for (let edge = 0; edge < vertices.length - 1; edge += 1) {
    for (let step = 0; step < subdivisionsPerEdge; step += 1) {
      const progress = step / subdivisionsPerEdge;
      points.push([
        vertices[edge][0] + (vertices[edge + 1][0] - vertices[edge][0]) * progress,
        vertices[edge][1] + (vertices[edge + 1][1] - vertices[edge][1]) * progress,
      ]);
    }
  }
  points.push(vertices.at(-1)!);
  return buildPath(points);
}

function interpolate(path: KnownPath, distanceM: number): PlanarPoint {
  if (distanceM <= 0) return path.points[0];
  if (distanceM >= path.totalM) return path.points.at(-1)!;
  let low = 1;
  let high = path.cumulativeM.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (path.cumulativeM[middle] < distanceM) low = middle + 1;
    else high = middle;
  }
  const spanM = path.cumulativeM[low] - path.cumulativeM[low - 1];
  const fraction = spanM <= 0 ? 0 : (distanceM - path.cumulativeM[low - 1]) / spanM;
  return [
    path.points[low - 1][0]
      + (path.points[low][0] - path.points[low - 1][0]) * fraction,
    path.points[low - 1][1]
      + (path.points[low][1] - path.points[low - 1][1]) * fraction,
  ];
}

function continuousNoise(
  seconds: number,
  amplitudeM: number,
  model: NoiseModel,
  phase: number,
  periodSeconds: number,
): PlanarPoint {
  if (model === 'none') return [0, 0];
  if (model === 'lateral-wave') return [
    0,
    amplitudeM * Math.sin((seconds / periodSeconds) * Math.PI * 2 + phase),
  ];
  if (model === 'correlated') return [
    amplitudeM * (0.72 * Math.sin(seconds * 0.62 + phase)
      + 0.28 * Math.sin(seconds * 0.17 + phase * 0.7)),
    amplitudeM * (0.78 * Math.sin(seconds * 0.8 + phase)
      + 0.22 * Math.cos(seconds * 0.31 + phase * 0.4)),
  ];
  if (model === 'alternating') return [
    amplitudeM * Math.sin(seconds * 2.1 + phase),
    amplitudeM * Math.sin(seconds * 1.8 + phase + 0.7),
  ];
  return [
    amplitudeM * Math.sin(seconds * 0.09 + phase),
    amplitudeM * Math.cos(seconds * 0.07 + phase),
  ];
}

function asTrackPoint(
  eastM: number,
  northM: number,
  t: number,
  index: number,
  accuracyM: number,
  speedMps: number,
  segmentId: string,
): FixtureObservation {
  return {
    lat: LAT + northM / METRES_PER_DEGREE,
    lng: LNG + eastM / LNG_SCALE,
    t,
    accuracy: accuracyM,
    speed: speedMps,
    source: 'background',
    clientActivityId: 'known-path',
    ownerGeneration: 'known-generation',
    segmentId,
    observationId: `${segmentId}:${index}`,
    rawOrdinal: index,
  };
}

export function sampleKnownPath(
  path: KnownPath,
  options: {
    speedMps: number;
    cadenceSeconds: number;
    accuracyM?: number;
    noiseAmplitudeM?: number;
    noiseModel?: NoiseModel;
    phase?: number;
    noisePeriodSeconds?: number;
    rotationRadians?: number;
    segmentId?: string;
  },
): SampledKnownPath {
  const {
    speedMps,
    cadenceSeconds,
    accuracyM = 6,
    noiseAmplitudeM = 0,
    noiseModel = 'none',
    phase = 0,
    noisePeriodSeconds = 8,
    rotationRadians = 0,
    segmentId = 'known-segment',
  } = options;
  const observations: FixtureObservation[] = [];
  const truth: TrackPoint[] = [];
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  const durationSeconds = path.totalM / speedMps;
  for (
    let index = 0, seconds = 0;
    seconds <= durationSeconds + 1e-7;
    index += 1, seconds = index * cadenceSeconds
  ) {
    const physical = interpolate(path, Math.min(path.totalM, seconds * speedMps));
    const noise = continuousNoise(
      seconds,
      noiseAmplitudeM,
      noiseModel,
      phase,
      noisePeriodSeconds,
    );
    const rotate = ([eastM, northM]: PlanarPoint): PlanarPoint => [
      eastM * cosine - northM * sine,
      eastM * sine + northM * cosine,
    ];
    const physicalRotated = rotate(physical);
    const observedRotated = rotate([physical[0] + noise[0], physical[1] + noise[1]]);
    const timestamp = 1_800_000_000_000 + Math.round(seconds * 1_000);
    truth.push(asTrackPoint(
      physicalRotated[0], physicalRotated[1], timestamp, index,
      accuracyM, speedMps, segmentId,
    ));
    observations.push(asTrackPoint(
      observedRotated[0], observedRotated[1], timestamp, index,
      accuracyM, speedMps, segmentId,
    ));
  }
  return { observations, truth };
}

export function qualifyForLive(
  observations: FixtureObservation[],
  mode: ActivityMode = 'hiking',
): TrackPoint[] {
  let state = createRealGpsContinuityState();
  const qualified: TrackPoint[] = [];
  const seen = new Set<string>();
  for (const point of observations) {
    const observation: RealGpsObservation = point;
    const decision = evaluateRealGpsObservation(state, observation, mode, observation.t);
    state = decision.state;
    if (decision.kind !== 'ACCEPT') continue;
    for (const candidate of [...(decision.confirmedCandidates ?? []), observation]) {
      const identity = candidate.observationId ?? `${point.segmentId}:${candidate.rawOrdinal}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const accepted = acceptRealGpsObservation(state, candidate, point.segmentId);
      state = accepted.state;
      qualified.push({
        ...candidate,
        ...accepted.liveCoordinate,
        clientActivityId: point.clientActivityId,
        ownerGeneration: point.ownerGeneration,
        segmentId: point.segmentId,
      });
    }
  }
  return qualified;
}

export function pathLengthM(points: ReadonlyArray<TrackPoint>): number {
  return points.slice(1).reduce((sum, point, index) => (
    sum + haversineM(points[index], point)
  ), 0);
}

function localXY(point: TrackPoint): PlanarPoint {
  return [(point.lng - LNG) * LNG_SCALE, (point.lat - LAT) * METRES_PER_DEGREE];
}

function pointToSegmentM(point: PlanarPoint, start: PlanarPoint, end: PlanarPoint): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const denominator = dx * dx + dy * dy;
  const fraction = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator,
  ));
  return Math.hypot(
    point[0] - start[0] - dx * fraction,
    point[1] - start[1] - dy * fraction,
  );
}

function directedDistances(
  source: ReadonlyArray<TrackPoint>,
  display: ReadonlyArray<TrackPoint>,
): number[] {
  const route = display.map(localXY);
  return source.map(candidate => {
    const point = localXY(candidate);
    if (route.length === 0) return Number.POSITIVE_INFINITY;
    if (route.length === 1) return Math.hypot(point[0] - route[0][0], point[1] - route[0][1]);
    let best = Number.POSITIVE_INFINITY;
    for (let index = 1; index < route.length; index += 1) {
      best = Math.min(best, pointToSegmentM(point, route[index - 1], route[index]));
    }
    return best;
  }).sort((left, right) => left - right);
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
}

function orderedLandmarkDistance(
  truth: ReadonlyArray<TrackPoint>,
  display: ReadonlyArray<TrackPoint>,
): { maxM: number; covered: number } {
  if (truth.length === 0 || display.length === 0) {
    return { maxM: Number.POSITIVE_INFINITY, covered: 0 };
  }
  const fractions = [0.12, 0.28, 0.44, 0.60, 0.76, 0.90];
  let minimumSegmentIndex = 1;
  let maximumM = 0;
  let covered = 0;
  for (const fraction of fractions) {
    const landmark = truth[Math.min(truth.length - 1, Math.round((truth.length - 1) * fraction))];
    const landmarkXY = localXY(landmark);
    let bestIndex = -1;
    let bestM = Number.POSITIVE_INFINITY;
    for (let index = minimumSegmentIndex; index < display.length; index += 1) {
      const distanceM = pointToSegmentM(
        landmarkXY,
        localXY(display[index - 1]),
        localXY(display[index]),
      );
      if (distanceM < bestM) {
        bestM = distanceM;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) minimumSegmentIndex = bestIndex;
    if (bestM <= 9) covered += 1;
    maximumM = Math.max(maximumM, bestM);
  }
  return { maxM: maximumM, covered };
}

export function presentationMetrics(
  truth: ReadonlyArray<TrackPoint>,
  accepted: ReadonlyArray<TrackPoint>,
  display: ReadonlyArray<TrackPoint>,
): PresentationMetrics {
  const acceptedDistances = directedDistances(accepted, display);
  const truthDistances = directedDistances(truth, display);
  const landmarks = orderedLandmarkDistance(truth, display);
  return {
    displayLengthM: pathLengthM(display),
    acceptedLengthM: pathLengthM(accepted),
    truthLengthM: pathLengthM(truth),
    acceptedToDisplayP95M: percentile(acceptedDistances, 0.95),
    acceptedToDisplayMaxM: acceptedDistances.at(-1) ?? 0,
    truthToDisplayP95M: percentile(truthDistances, 0.95),
    orderedLandmarkMaxM: landmarks.maxM,
    orderedLandmarksCovered: landmarks.covered,
  };
}
