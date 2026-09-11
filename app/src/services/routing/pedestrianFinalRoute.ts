/**
 * O50 pedestrian Final route reconstruction.
 *
 * Canonical points remain immutable Activity/Memory/metric truth. This module
 * produces display geometry only, after an Activity is complete:
 *
 *   canonical evidence
 *     -> ordered ~4 s Map Matching observations
 *     -> transparent corridor evidence score
 *     -> pedestrian network / evidence-derived road offset / canonical mode
 *     -> bounded Directions fallback between already-observed anchors
 *     -> conservative crossing and off-network cleanup
 *     -> seam and whole-route validation
 *
 * It is intentionally not imported by the Live tracker.
 */

import {
  analyzeTrustedEndpointCoverage,
  evaluateIslandSeamQuality,
  evaluateMatchedGeometryQuality,
  evaluateTopologyQuality,
  evaluateWholeRouteQuality,
  resampleMatcherEvidence,
  type IslandSeamQuality,
  type MatchedGeometryQuality,
  type MatcherSubmittedPoint,
  type RawPoint,
  type SnappedPoint,
  type TopologyQuality,
  type WholeRouteValidation,
} from './snapTrack';

export type FinalRouteState =
  | 'NETWORK_CONFIDENT'
  | 'NETWORK_AMBIGUOUS'
  | 'FREE_TRAVERSAL'
  | 'OFF_NETWORK_PATH';

export type PedestrianGeometryMode =
  | 'A_PEDESTRIAN_NETWORK'
  | 'B_ROAD_OFFSET'
  | 'C_CANONICAL_DERIVED'
  | 'FREE_TRAVERSAL';

export interface LateralOffsetEvidence {
  sampleCount: number;
  signedMedianM: number;
  absoluteMedianM: number;
  madM: number;
  p95ResidualM: number;
  stableSignFraction: number;
  plausibleForAccuracy: boolean;
  stable: boolean;
}

export interface CorridorEvidence {
  score: number;
  mapboxConfidence: number;
  tracepointCoverage: number;
  ambiguityKnownFraction: number;
  unambiguousFraction: number;
  bearingAgreementScore: number;
  bearingDeltaDeg: number;
  lengthAgreementScore: number;
  lengthRatio: number;
  endpointSafetyScore: number;
  endpointDeviationM: number;
  lateralStabilityScore: number;
  temporalPersistenceScore: number;
  accuracyP95M: number;
  overlappingWindowAgreementCount: number;
  acceptedByBaseGate: boolean;
  acceptedByCoherentOverrun: boolean;
  accepted: boolean;
  reason: string;
  lateral: LateralOffsetEvidence;
}

export interface FinalRouteSection {
  sourceStart: number;
  sourceEnd: number;
  state: FinalRouteState;
  geometryMode: PedestrianGeometryMode;
  networkSource: 'map-matching' | 'walking-directions' | 'none';
  decision: 'refined' | 'canonical-derived';
  reason: string;
  confidence: number;
  corridorEvidence: CorridorEvidence | null;
  lateralOffsetM: number | null;
  canonicalDistanceM: number;
  displayDistanceM: number;
  maximumDisplayEdgeM: number;
  lengthRatio: number;
  canonicalDisplacementP50M: number;
  canonicalDisplacementP95M: number;
  canonicalDisplacementMaxM: number;
  seam: IslandSeamQuality | null;
}

export interface PedestrianFinalRequestResult {
  kind: 'map-matching' | 'walking-directions';
  sourceStart: number;
  sourceEnd: number;
  inputPointCount: number;
  sourceIndexMap: number[];
  durationMs: number;
  result: string;
  httpStatus: number | null;
  responseCode: string | null;
  matchingCount: number;
  tracepointCount: number | null;
  nullTracepointCount: number | null;
  acceptedCandidateCount: number;
  rejectedCandidateCount: number;
  profile: 'walking';
  matcherTidy: false | null;
}

export interface PedestrianFinalStats {
  algorithmVersion: 'pedestrian-final-v1';
  canonicalPointCount: number;
  resampledPointCount: number;
  mapMatchingRequestCount: number;
  directionsRequestCount: number;
  requestResults: PedestrianFinalRequestResult[];
  matchedIslandCount: number;
  directionsIslandCount: number;
  canonicalDerivedSectionCount: number;
  freeTraversalSectionCount: number;
  roadOffsetSectionCount: number;
  pedestrianNetworkSectionCount: number;
  rejectedNetworkCandidateCount: number;
  displayRefined: boolean;
  acceptedMatchedDistanceM: number;
  canonicalFallbackDistanceM: number;
  mapMatchingApiDurationMs: number;
  directionsApiDurationMs: number;
  totalApiWallDurationMs: number;
  totalApiDurationMs: number;
  durationMs: number;
  sections: FinalRouteSection[];
  preFallbackCandidateSummary: Array<{
    sourceStart: number;
    sourceEnd: number;
    mode: PedestrianGeometryMode;
    source: 'map-matching' | 'walking-directions';
    confidence: number;
    maximumDisplayEdgeM: number;
  }>;
  preFallbackWholeRouteValidation: WholeRouteValidation;
  wholeRouteValidation: WholeRouteValidation;
  finalGeometryFingerprint: string | null;
}

export interface PedestrianFinalOptions {
  mapboxToken: string;
  totalTimeoutMs?: number;
  perCallTimeoutMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
  directionsFallback?: boolean;
  maxDirectionsRequests?: number;
}

export type PedestrianFinalResult =
  | { ok: true; points: SnappedPoint[]; stats: PedestrianFinalStats }
  | { ok: false; reason: 'no_input' | 'too_short' | 'aborted'; stats: PedestrianFinalStats };

interface XY { x: number; y: number }

interface Projection {
  distanceM: number;
  signedDistanceM: number;
  segmentIndex: number;
  fraction: number;
}

interface NetworkCandidate {
  sourceStart: number;
  sourceEnd: number;
  points: SnappedPoint[];
  networkPoints: SnappedPoint[];
  source: 'map-matching' | 'walking-directions';
  state: 'NETWORK_CONFIDENT' | 'NETWORK_AMBIGUOUS';
  mode: PedestrianGeometryMode;
  reason: string;
  confidence: number;
  evidence: CorridorEvidence;
  quality: MatchedGeometryQuality;
  topology: TopologyQuality;
  seam: IslandSeamQuality;
  modalNetworkName: string | null;
}

interface CandidateBuildInput {
  canonical: RawPoint[];
  sourceStart: number;
  sourceEnd: number;
  networkPoints: SnappedPoint[];
  confidence: number;
  supportCount: number;
  expectedSupportCount: number;
  alternatives: Array<number | null>;
  names: Array<string | null>;
  source: 'map-matching' | 'walking-directions';
  routeAlternativeCount: number;
}

const EARTH_R = 6_371_000;
const MAPBOX_MATCHING_ENDPOINT = 'https://api.mapbox.com/matching/v5/mapbox/walking';
const MAPBOX_DIRECTIONS_ENDPOINT = 'https://api.mapbox.com/directions/v5/mapbox/walking';
const MATCHING_WINDOW_SIZE = 24;
const MATCHING_WINDOW_OVERLAP = 4;
const LONG_ACTIVITY_WINDOW_SIZE = 80;
const LONG_ACTIVITY_THRESHOLD = 240;
const MAX_MATCHING_REQUESTS = 33;
const DEFAULT_TOTAL_TIMEOUT_MS = 10_000;
const DEFAULT_PER_CALL_TIMEOUT_MS = 2_600;
const DEFAULT_CONCURRENCY = 4;
const MIN_NETWORK_SUPPORT = 3;
const MIN_NETWORK_DISTANCE_M = 10;
const MAX_SEAM_TRIM = 3;
const MAX_DIRECTIONS_REQUESTS = 3;
const MAX_DIRECTIONS_SPAN_M = 260;
const MIN_DIRECTIONS_SPAN_M = 28;
const ROAD_OFFSET_MIN_M = 2;
const ROAD_OFFSET_MAX_M = 20;

function toRad(value: number): number { return value * Math.PI / 180; }

function hav(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function pathLength(points: Array<{ lat: number; lng: number }>): number {
  return points.slice(1).reduce((sum, point, index) => sum + hav(points[index], point), 0);
}

function maximumEdge(points: Array<{ lat: number; lng: number }>): number {
  const edges = points.slice(1).map((point, index) => hav(points[index], point));
  return edges.length > 0 ? Math.max(...edges) : 0;
}

function bearingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angleDeltaDegrees(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function geometryFingerprint(points: Array<{ lat: number; lng: number }>): string {
  let hash = 0x811c9dc5;
  for (const point of points) {
    const text = `${point.lat.toFixed(6)},${point.lng.toFixed(6)};`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalPoint(point: RawPoint): SnappedPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    alt: point.alt,
    ...(point.t != null && Number.isFinite(point.t) ? { t: point.t } : {}),
  };
}

function localProjector(origin: { lat: number; lng: number }): {
  toXY: (point: { lat: number; lng: number }) => XY;
  toLngLat: (point: XY) => { lat: number; lng: number };
} {
  const metresPerDegree = 111_320;
  const cosLat = Math.cos(toRad(origin.lat));
  return {
    toXY: point => ({
      x: (point.lng - origin.lng) * metresPerDegree * cosLat,
      y: (point.lat - origin.lat) * metresPerDegree,
    }),
    toLngLat: point => ({
      lng: origin.lng + point.x / (metresPerDegree * cosLat),
      lat: origin.lat + point.y / metresPerDegree,
    }),
  };
}

function projectXYToSegment(point: XY, start: XY, end: XY): Projection {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared <= 0
    ? 0
    : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const projected = { x: start.x + dx * fraction, y: start.y + dy * fraction };
  const cross = dx * (point.y - projected.y) - dy * (point.x - projected.x);
  const distanceM = Math.hypot(point.x - projected.x, point.y - projected.y);
  return {
    distanceM,
    signedDistanceM: cross === 0 ? 0 : Math.sign(cross) * distanceM,
    segmentIndex: 0,
    fraction,
  };
}

function projectPointToPath(
  point: { lat: number; lng: number },
  path: Array<{ lat: number; lng: number }>,
): Projection {
  if (path.length < 2) {
    return { distanceM: Infinity, signedDistanceM: 0, segmentIndex: 0, fraction: 0 };
  }
  const projector = localProjector(point);
  const pointXY = { x: 0, y: 0 };
  let best: Projection | null = null;
  for (let index = 1; index < path.length; index += 1) {
    const projected = projectXYToSegment(
      pointXY,
      projector.toXY(path[index - 1]),
      projector.toXY(path[index]),
    );
    if (!best || projected.distanceM < best.distanceM) {
      best = { ...projected, segmentIndex: index - 1 };
    }
  }
  return best as Projection;
}

function deviationsToPath(
  canonical: Array<{ lat: number; lng: number }>,
  display: Array<{ lat: number; lng: number }>,
): { p50: number; p95: number; max: number } {
  const values = canonical.map(point => projectPointToPath(point, display).distanceM);
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length > 0 ? Math.max(...values) : 0,
  };
}

export function evaluateLateralOffsetEvidence(
  canonical: RawPoint[],
  network: Array<{ lat: number; lng: number }>,
): LateralOffsetEvidence {
  const signed = canonical.map(point => projectPointToPath(point, network).signedDistanceM)
    .filter(Number.isFinite);
  const signedMedianM = median(signed);
  const absoluteMedianM = Math.abs(signedMedianM);
  const residuals = signed.map(value => Math.abs(value - signedMedianM));
  const madM = median(residuals);
  const p95ResidualM = percentile(residuals, 0.95);
  const meaningful = signed.filter(value => Math.abs(value) >= 0.75);
  const expectedSign = Math.sign(signedMedianM);
  const stableSignFraction = meaningful.length === 0 || expectedSign === 0
    ? 0
    : meaningful.filter(value => Math.sign(value) === expectedSign).length / meaningful.length;
  const accuracies = canonical.flatMap(point => (
    typeof point.accuracy === 'number' && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  ));
  const accuracyP95 = accuracies.length > 0 ? percentile(accuracies, 0.95) : 10;
  const plausibleForAccuracy = absoluteMedianM <= Math.min(ROAD_OFFSET_MAX_M, Math.max(6, accuracyP95 * 1.35));
  const stable = signed.length >= 5
    && stableSignFraction >= 0.8
    && madM <= Math.max(2.5, absoluteMedianM * 0.35)
    && p95ResidualM <= Math.max(4, absoluteMedianM * 0.55)
    && plausibleForAccuracy;
  return {
    sampleCount: signed.length,
    signedMedianM,
    absoluteMedianM,
    madM,
    p95ResidualM,
    stableSignFraction,
    plausibleForAccuracy,
    stable,
  };
}

function pointToLineDistanceXY(point: XY, start: XY, end: XY): number {
  return projectXYToSegment(point, start, end).distanceM;
}

function rdpIndices(points: RawPoint[], toleranceM: number): number[] {
  if (points.length <= 2) return points.map((_point, index) => index);
  const projector = localProjector(points[0]);
  const xy = points.map(projector.toXY);
  const kept = new Set<number>([0, points.length - 1]);
  const visit = (start: number, end: number) => {
    if (end - start <= 1) return;
    let farthestIndex = -1;
    let farthestM = -1;
    for (let index = start + 1; index < end; index += 1) {
      const distanceM = pointToLineDistanceXY(xy[index], xy[start], xy[end]);
      if (distanceM > farthestM) {
        farthestM = distanceM;
        farthestIndex = index;
      }
    }
    if (farthestIndex >= 0 && farthestM > toleranceM) {
      kept.add(farthestIndex);
      visit(start, farthestIndex);
      visit(farthestIndex, end);
    }
  };
  visit(0, points.length - 1);
  return Array.from(kept).sort((a, b) => a - b);
}

function meaningfulNeighbour(points: RawPoint[], origin: number, direction: 1 | -1, minimumM: number): number | null {
  let travelledM = 0;
  for (let index = origin + direction; index >= 0 && index < points.length; index += direction) {
    travelledM += hav(points[index - direction], points[index]);
    if (travelledM >= minimumM) return index;
  }
  return null;
}

export function finalGeometryCriticalIndices(points: RawPoint[]): number[] {
  if (points.length === 0) return [];
  const critical = new Set<number>([0, points.length - 1]);
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = meaningfulNeighbour(points, index, -1, 10);
    const next = meaningfulNeighbour(points, index, 1, 10);
    if (previous != null && next != null) {
      const turn = angleDeltaDegrees(
        bearingDegrees(points[previous], points[index]),
        bearingDegrees(points[index], points[next]),
      );
      if (turn >= 65) {
        critical.add(index);
      }
    }
    const reversalPrevious = meaningfulNeighbour(points, index, -1, 5);
    const reversalNext = meaningfulNeighbour(points, index, 1, 5);
    if (reversalPrevious != null && reversalNext != null) {
      const reversal = angleDeltaDegrees(
        bearingDegrees(points[reversalPrevious], points[index]),
        bearingDegrees(points[index], points[reversalNext]),
      );
      if (reversal >= 135) critical.add(index);
    }
    const incomingDt = points[index].t != null && points[index - 1].t != null
      ? Number(points[index].t) - Number(points[index - 1].t)
      : 0;
    const outgoingDt = points[index + 1].t != null && points[index].t != null
      ? Number(points[index + 1].t) - Number(points[index].t)
      : 0;
    if (incomingDt >= 8_000 || outgoingDt >= 8_000) {
      critical.add(index);
    }
  }
  return Array.from(critical).sort((a, b) => a - b);
}

/**
 * Chronological, bounded Final-only cleanup. RDP is applied independently
 * between multi-scale turns/reversals and stop boundaries, so measurement
 * wobble disappears without flattening a U-turn, Z, switchback or pause.
 */
export function cleanCanonicalGeometry(points: RawPoint[]): SnappedPoint[] {
  if (points.length <= 2) return points.map(canonicalPoint);
  const accuracies = points.flatMap(point => (
    typeof point.accuracy === 'number' && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  ));
  const toleranceM = clamp((accuracies.length > 0 ? median(accuracies) : 8) * 0.28, 1.8, 3.2);
  const critical = finalGeometryCriticalIndices(points);
  const keep = new Set<number>(critical);
  for (let index = 1; index < critical.length; index += 1) {
    const start = critical[index - 1];
    const end = critical[index];
    const subsection = points.slice(start, end + 1);
    for (const localIndex of rdpIndices(subsection, toleranceM)) keep.add(start + localIndex);
  }
  const simplified = Array.from(keep).sort((a, b) => a - b).map(index => canonicalPoint(points[index]));
  // Interpolate long straight display edges instead of reintroducing noisy raw
  // vertices merely to satisfy visual density and edge-spike guardrails.
  return densifyGeometry(simplified, 16);
}

function attachDisplayMetadata(points: SnappedPoint[], canonical: RawPoint[]): SnappedPoint[] {
  if (points.length === 0 || canonical.length === 0) return points;
  const totalM = pathLength(points);
  const startT = canonical[0].t;
  const endT = canonical[canonical.length - 1].t;
  let progressedM = 0;
  return points.map((point, index) => {
    if (index > 0) progressedM += hav(points[index - 1], point);
    let nearest = canonical[0];
    let nearestM = hav(point, nearest);
    for (let candidateIndex = 1; candidateIndex < canonical.length; candidateIndex += 1) {
      const distanceM = hav(point, canonical[candidateIndex]);
      if (distanceM < nearestM) {
        nearest = canonical[candidateIndex];
        nearestM = distanceM;
      }
    }
    const fraction = totalM > 0 ? progressedM / totalM : index / Math.max(1, points.length - 1);
    return {
      lat: point.lat,
      lng: point.lng,
      ...(nearest.alt != null ? { alt: nearest.alt } : {}),
      ...(startT != null && endT != null && Number.isFinite(startT) && Number.isFinite(endT)
        ? { t: Math.round(Number(startT) + (Number(endT) - Number(startT)) * fraction) }
        : {}),
    };
  });
}

export function offsetNetworkGeometry(
  network: SnappedPoint[],
  signedOffsetM: number,
): SnappedPoint[] {
  if (network.length < 2 || Math.abs(signedOffsetM) < 0.05) return network.slice();
  const projector = localProjector(network[0]);
  const xy = network.map(projector.toXY);
  const normals = xy.slice(1).map((point, index) => {
    const dx = point.x - xy[index].x;
    const dy = point.y - xy[index].y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: -dy / length, y: dx / length };
  });
  return xy.map((point, index) => {
    const incoming = normals[Math.max(0, index - 1)];
    const outgoing = normals[Math.min(normals.length - 1, index)];
    const combined = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y };
    const combinedLength = Math.hypot(combined.x, combined.y);
    const normal = combinedLength >= 0.4
      ? { x: combined.x / combinedLength, y: combined.y / combinedLength }
      : outgoing;
    // Bound corner mitres. A large miter would create a spur at a sharp turn.
    const alignment = Math.max(0.5, normal.x * outgoing.x + normal.y * outgoing.y);
    const shiftM = clamp(signedOffsetM / alignment, -Math.abs(signedOffsetM) * 1.5, Math.abs(signedOffsetM) * 1.5);
    const shifted = projector.toLngLat({ x: point.x + normal.x * shiftM, y: point.y + normal.y * shiftM });
    return { ...network[index], ...shifted };
  });
}

function densifyGeometry(points: SnappedPoint[], maximumEdgeM = 14): SnappedPoint[] {
  if (points.length < 2) return points.slice();
  const result: SnappedPoint[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const distanceM = hav(previous, next);
    const pieces = Math.max(1, Math.ceil(distanceM / maximumEdgeM));
    for (let piece = 1; piece <= pieces; piece += 1) {
      const fraction = piece / pieces;
      result.push({
        lat: previous.lat + (next.lat - previous.lat) * fraction,
        lng: previous.lng + (next.lng - previous.lng) * fraction,
      });
    }
  }
  return result;
}

function modalValue(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let result: string | null = null;
  let maximum = 0;
  for (const [value, count] of counts) {
    if (count > maximum) {
      result = value;
      maximum = count;
    }
  }
  return result;
}

function accuracyP95(points: RawPoint[]): number {
  const values = points.flatMap(point => (
    typeof point.accuracy === 'number' && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  ));
  return values.length > 0 ? percentile(values, 0.95) : 10;
}

/**
 * Explainable corridor gate. The O49 truth envelope stays authoritative, but
 * a sub-metre p95 overrun can be accepted when every independent signal says
 * that the same persistent, unambiguous corridor explains the evidence.
 */
export function evaluateCorridorEvidence(input: {
  canonical: RawPoint[];
  network: SnappedPoint[];
  mapboxConfidence: number;
  supportCount: number;
  expectedSupportCount: number;
  alternatives: Array<number | null>;
  overlappingWindowAgreementCount?: number;
  routeAlternativeCount?: number;
}): CorridorEvidence {
  const quality = evaluateMatchedGeometryQuality(input.canonical, input.network);
  const topology = evaluateTopologyQuality(input.canonical, input.network);
  const lateral = evaluateLateralOffsetEvidence(input.canonical, input.network);
  const coverage = clamp(input.supportCount / Math.max(1, input.expectedSupportCount), 0, 1);
  const knownAlternatives = input.alternatives.filter((value): value is number => value != null);
  const ambiguityKnownFraction = knownAlternatives.length / Math.max(1, input.supportCount);
  const unambiguousFraction = knownAlternatives.length > 0
    ? knownAlternatives.filter(value => value === 0).length / knownAlternatives.length
    : (input.routeAlternativeCount ?? 0) === 0 ? 1 : 0;
  const bearingDeltaDeg = topology.bearingDeltaDeg;
  const bearingAgreementScore = clamp(1 - bearingDeltaDeg / 55, 0, 1);
  const lengthAgreementScore = clamp(1 - Math.abs(1 - quality.lengthRatio) / 0.33, 0, 1);
  const endpointSafetyScore = clamp(
    1 - quality.endpointDeviationM / Math.max(20, quality.deviationEnvelopeM * 1.35),
    0,
    1,
  );
  const lateralStabilityScore = lateral.stable
    ? clamp(0.65 + lateral.stableSignFraction * 0.35 - lateral.madM / 40, 0, 1)
    : clamp(0.4 - lateral.madM / 20, 0, 0.4);
  const temporalPersistenceScore = input.supportCount >= 8 ? 1 : clamp(input.supportCount / 8, 0, 1);
  const accuracyScore = clamp(1 - accuracyP95(input.canonical) / 50, 0, 1);
  const ambiguityScore = ambiguityKnownFraction >= 0.7
    ? unambiguousFraction
    : (input.routeAlternativeCount ?? 0) === 0 ? 0.7 : 0.25;
  const score = clamp(
    input.mapboxConfidence * 0.18
    + coverage * 0.15
    + ambiguityScore * 0.12
    + bearingAgreementScore * 0.10
    + lengthAgreementScore * 0.10
    + endpointSafetyScore * 0.10
    + lateralStabilityScore * 0.15
    + temporalPersistenceScore * 0.05
    + accuracyScore * 0.05,
    0,
    1,
  );
  const baseStructuralGate = input.mapboxConfidence >= 0.72
    && coverage >= 0.72
    && topology.accepted
    && quality.lengthRatio >= 0.72
    && quality.lengthRatio <= 1.35
    && quality.endpointDeviationM <= Math.max(20, quality.deviationEnvelopeM * 1.35)
    && score >= 0.68;
  const acceptedByBaseGate = baseStructuralGate && quality.accepted;
  const acceptedByCoherentOverrun = baseStructuralGate
    && quality.reason === 'raw_deviation'
    && quality.p95DeviationM <= quality.deviationEnvelopeM + 1
    && quality.maxDeviationM <= Math.max(18, quality.deviationEnvelopeM * 1.25)
    && ambiguityKnownFraction >= 0.7
    && unambiguousFraction >= 0.8
    && lateral.stable
    && score >= 0.78;
  const accepted = acceptedByBaseGate || acceptedByCoherentOverrun;
  const reason = acceptedByBaseGate
    ? 'composite-corridor-evidence'
    : acceptedByCoherentOverrun
      ? 'coherent-isolated-envelope-overrun'
      : !baseStructuralGate
        ? `composite-score-or-structure:${score.toFixed(3)}`
        : `truth-envelope:${quality.reason}`;
  return {
    score,
    mapboxConfidence: input.mapboxConfidence,
    tracepointCoverage: coverage,
    ambiguityKnownFraction,
    unambiguousFraction,
    bearingAgreementScore,
    bearingDeltaDeg,
    lengthAgreementScore,
    lengthRatio: quality.lengthRatio,
    endpointSafetyScore,
    endpointDeviationM: quality.endpointDeviationM,
    lateralStabilityScore,
    temporalPersistenceScore,
    accuracyP95M: accuracyP95(input.canonical),
    overlappingWindowAgreementCount: input.overlappingWindowAgreementCount ?? 0,
    acceptedByBaseGate,
    acceptedByCoherentOverrun,
    accepted,
    reason,
    lateral,
  };
}

function anchorEndpoints(points: SnappedPoint[], canonical: RawPoint[]): SnappedPoint[] {
  if (points.length < 2 || canonical.length < 2) return points;
  const result = points.slice();
  result[0] = canonicalPoint(canonical[0]);
  result[result.length - 1] = canonicalPoint(canonical[canonical.length - 1]);
  return result;
}

function buildNetworkCandidate(input: CandidateBuildInput): NetworkCandidate | null {
  const rawSubsection = input.canonical.slice(input.sourceStart, input.sourceEnd + 1);
  if (rawSubsection.length < 2 || pathLength(rawSubsection) < MIN_NETWORK_DISTANCE_M) return null;
  const endpointCoverage = analyzeTrustedEndpointCoverage(rawSubsection, input.networkPoints);
  if (!endpointCoverage.eligibleForAnchoring) return null;
  const evidence = evaluateCorridorEvidence({
    canonical: rawSubsection,
    network: input.networkPoints,
    mapboxConfidence: input.confidence,
    supportCount: input.supportCount,
    expectedSupportCount: input.expectedSupportCount,
    alternatives: input.alternatives,
    routeAlternativeCount: input.routeAlternativeCount,
  });
  if (!evidence.accepted) return null;

  const modalNetworkName = modalValue(input.names);
  const lowAmbiguity = input.source === 'walking-directions'
    ? input.routeAlternativeCount === 0
    : evidence.ambiguityKnownFraction >= 0.7 && evidence.unambiguousFraction >= 0.75;
  let mode: PedestrianGeometryMode;
  let display: SnappedPoint[];
  let reason: string;
  const networkForDisplay = densifyGeometry(input.networkPoints);
  if (
    evidence.lateral.stable
    && lowAmbiguity
    && evidence.lateral.absoluteMedianM >= ROAD_OFFSET_MIN_M
    && evidence.lateral.absoluteMedianM <= ROAD_OFFSET_MAX_M
  ) {
    mode = 'B_ROAD_OFFSET';
    display = offsetNetworkGeometry(networkForDisplay, evidence.lateral.signedMedianM);
    reason = `${evidence.reason};stable-evidence-offset`;
  } else if (
    modalNetworkName == null
    && lowAmbiguity
    && evidence.lateral.absoluteMedianM < ROAD_OFFSET_MIN_M
    && evidence.lateral.p95ResidualM <= 3.5
  ) {
    mode = 'A_PEDESTRIAN_NETWORK';
    display = networkForDisplay;
    reason = `${evidence.reason};pedestrian-aligned-network`;
  } else {
    // Road topology may still be confidently identified, but uncertain side
    // evidence is not permission to put a walker on the carriageway centre.
    mode = 'C_CANONICAL_DERIVED';
    display = cleanCanonicalGeometry(rawSubsection);
    reason = `${evidence.reason};network-side-ambiguous`;
  }
  display = anchorEndpoints(attachDisplayMetadata(display, rawSubsection), rawSubsection);
  const quality = evaluateMatchedGeometryQuality(rawSubsection, display);
  const topology = evaluateTopologyQuality(rawSubsection, display);
  const seam = evaluateIslandSeamQuality(input.canonical, input.sourceStart, input.sourceEnd, display);
  if (!quality.accepted || !topology.accepted || !seam.accepted) return null;
  return {
    sourceStart: input.sourceStart,
    sourceEnd: input.sourceEnd,
    points: display,
    networkPoints: input.networkPoints,
    source: input.source,
    state: mode === 'C_CANONICAL_DERIVED' ? 'NETWORK_AMBIGUOUS' : 'NETWORK_CONFIDENT',
    mode,
    reason,
    confidence: evidence.score,
    evidence,
    quality,
    topology,
    seam,
    modalNetworkName,
  };
}

interface MapboxTracepoint {
  matchings_index?: number;
  waypoint_index?: number;
  alternatives_count?: number;
  name?: string;
  location?: [number, number];
}

function nearestGeometryIndex(
  geometry: SnappedPoint[],
  location: [number, number],
  minimumIndex = 0,
): number {
  const target = { lng: location[0], lat: location[1] };
  let bestIndex = clamp(minimumIndex, 0, geometry.length - 1);
  let bestDistance = hav(geometry[bestIndex], target);
  for (let index = bestIndex + 1; index < geometry.length; index += 1) {
    const distance = hav(geometry[index], target);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

function cropGeometryToTracepoints(
  geometry: SnappedPoint[],
  head: [number, number] | undefined,
  tail: [number, number] | undefined,
): SnappedPoint[] | null {
  if (geometry.length < 2 || !head || !tail) return null;
  const start = nearestGeometryIndex(geometry, head);
  const end = nearestGeometryIndex(geometry, tail, start);
  if (end < start) return null;
  const result: SnappedPoint[] = [
    { lng: head[0], lat: head[1] },
    ...geometry.slice(start, end + 1),
    { lng: tail[0], lat: tail[1] },
  ];
  return result.filter((point, index) => index === 0 || hav(result[index - 1], point) > 0.05);
}

interface WindowResult {
  candidates: NetworkCandidate[];
  request: PedestrianFinalRequestResult;
  directionsHints?: Array<[number, number]>;
}

function linkedAbortController(externalSignal: AbortSignal | undefined, timeoutMs: number): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const listener = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', listener, { once: true } as any);
  }
  return {
    controller,
    dispose: () => {
      clearTimeout(timeout);
      try { externalSignal?.removeEventListener('abort', listener); } catch { /* noop */ }
    },
  };
}

async function mapMatchingWindow(
  chunk: MatcherSubmittedPoint[],
  canonical: RawPoint[],
  token: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WindowResult> {
  const startedAt = Date.now();
  const diagnostic: PedestrianFinalRequestResult = {
    kind: 'map-matching',
    sourceStart: chunk[0]?.sourceIndex ?? 0,
    sourceEnd: chunk[chunk.length - 1]?.sourceIndex ?? 0,
    inputPointCount: chunk.length,
    sourceIndexMap: chunk.map(point => point.sourceIndex),
    durationMs: 0,
    result: 'not-run',
    httpStatus: null,
    responseCode: null,
    matchingCount: 0,
    tracepointCount: null,
    nullTracepointCount: null,
    acceptedCandidateCount: 0,
    rejectedCandidateCount: 0,
    profile: 'walking',
    matcherTidy: false,
  };
  if (chunk.length < 2 || !token) {
    diagnostic.result = !token ? 'no-token' : 'too-short';
    return { candidates: [], request: diagnostic };
  }
  const coords = chunk.map(point => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(';');
  const radiuses = chunk.map(point => clamp(Math.round(point.accuracy ?? 15), 5, 50)).join(';');
  const seconds = chunk.map(point => point.t == null ? null : Math.floor(Number(point.t) / 1_000));
  const validTimes = seconds.every((value): value is number => value != null)
    && seconds.every((value, index) => index === 0 || value > Number(seconds[index - 1]));
  const timestampQuery = validTimes ? `&timestamps=${seconds.join(';')}` : '';
  const url = `${MAPBOX_MATCHING_ENDPOINT}/${coords}?geometries=geojson&overview=full&steps=true&tidy=false&radiuses=${radiuses}${timestampQuery}&access_token=${encodeURIComponent(token)}`;
  const abort = linkedAbortController(signal, timeoutMs);
  try {
    const response = await fetch(url, { signal: abort.controller.signal });
    diagnostic.httpStatus = response.status;
    if (!response.ok) {
      diagnostic.result = `http-${response.status}`;
      return { candidates: [], request: diagnostic };
    }
    const body = await response.json() as {
      code?: string;
      tracepoints?: Array<MapboxTracepoint | null>;
      matchings?: Array<{
        confidence?: number;
        geometry?: { coordinates?: Array<[number, number]> };
      }>;
    };
    diagnostic.responseCode = body.code ?? 'missing-code';
    diagnostic.matchingCount = body.matchings?.length ?? 0;
    diagnostic.tracepointCount = body.tracepoints?.length ?? 0;
    diagnostic.nullTracepointCount = body.tracepoints?.filter(point => point == null).length ?? 0;
    if (body.code !== 'Ok' || !body.matchings?.length || body.tracepoints?.length !== chunk.length) {
      diagnostic.result = body.code ?? 'unusable-response';
      return { candidates: [], request: diagnostic };
    }
    const candidates: NetworkCandidate[] = [];
    const directionsHints: Array<[number, number]> = [];
    for (const [matchingIndex, matching] of body.matchings.entries()) {
      const fullGeometry = (matching.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lng, lat }));
      if (fullGeometry.length < 2) continue;
      const supported = body.tracepoints.flatMap((tracepoint, index) => (
        tracepoint?.matchings_index === matchingIndex ? [index] : []
      ));
      const runs: number[][] = [];
      let run: number[] = [];
      for (const submittedIndex of supported) {
        if (run.length > 0 && submittedIndex !== run[run.length - 1] + 1) {
          runs.push(run);
          run = [];
        }
        run.push(submittedIndex);
      }
      if (run.length > 0) runs.push(run);
      for (const indices of runs) {
        if (indices.length < MIN_NETWORK_SUPPORT) {
          diagnostic.rejectedCandidateCount += 1;
          continue;
        }
        const headIndex = indices[0];
        const tailIndex = indices[indices.length - 1];
        directionsHints.push([chunk[headIndex].sourceIndex, chunk[tailIndex].sourceIndex]);
        const tracepoints = indices.map(index => body.tracepoints?.[index]).filter(Boolean) as MapboxTracepoint[];
        const cropped = cropGeometryToTracepoints(
          fullGeometry,
          body.tracepoints[headIndex]?.location,
          body.tracepoints[tailIndex]?.location,
        );
        if (!cropped) {
          diagnostic.rejectedCandidateCount += 1;
          continue;
        }
        const candidate = buildNetworkCandidate({
          canonical,
          sourceStart: chunk[headIndex].sourceIndex,
          sourceEnd: chunk[tailIndex].sourceIndex,
          networkPoints: cropped,
          confidence: matching.confidence ?? 0,
          supportCount: indices.length,
          expectedSupportCount: tailIndex - headIndex + 1,
          alternatives: tracepoints.map(point => point.alternatives_count ?? null),
          names: tracepoints.map(point => point.name ?? null),
          source: 'map-matching',
          routeAlternativeCount: body.matchings.length - 1,
        });
        if (candidate) {
          candidates.push(candidate);
          diagnostic.acceptedCandidateCount += 1;
        } else {
          diagnostic.rejectedCandidateCount += 1;
        }
      }
    }
    diagnostic.result = candidates.length > 0 ? 'accepted-candidate' : 'no-safe-candidate';
    return { candidates, request: diagnostic, directionsHints };
  } catch (error: any) {
    diagnostic.result = error?.name === 'AbortError' ? 'timeout-or-abort' : 'network-error';
    return { candidates: [], request: diagnostic };
  } finally {
    diagnostic.durationMs = Date.now() - startedAt;
    abort.dispose();
  }
}

function matchingWindows(points: MatcherSubmittedPoint[]): MatcherSubmittedPoint[][] {
  if (points.length <= MATCHING_WINDOW_SIZE) return points.length >= 2 ? [points] : [];
  const size = points.length > LONG_ACTIVITY_THRESHOLD ? LONG_ACTIVITY_WINDOW_SIZE : MATCHING_WINDOW_SIZE;
  const overlap = Math.min(MATCHING_WINDOW_OVERLAP, size - 2);
  const windows: MatcherSubmittedPoint[][] = [];
  for (let start = 0; start < points.length - 1; start += size - overlap) {
    const chunk = points.slice(start, Math.min(points.length, start + size));
    if (chunk.length >= 2) windows.push(chunk);
    if (start + size >= points.length) break;
  }
  // Privacy and cost guardrail: no activity can create an unbounded request fanout.
  return windows.slice(0, MAX_MATCHING_REQUESTS);
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<WindowResult>,
): Promise<WindowResult[]> {
  const results: WindowResult[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  return results;
}

function candidateOverlapAgreement(left: NetworkCandidate, right: NetworkCandidate): boolean {
  const start = Math.max(left.sourceStart, right.sourceStart);
  const end = Math.min(left.sourceEnd, right.sourceEnd);
  if (end < start) return false;
  const sample = left.networkPoints.filter((point, index) => (
    index === 0 || index === left.networkPoints.length - 1 || index % 3 === 0
  ));
  const p95 = percentile(sample.map(point => projectPointToPath(point, right.networkPoints).distanceM), 0.95);
  return p95 <= 5;
}

function annotateWindowAgreement(candidates: NetworkCandidate[]): void {
  for (const candidate of candidates) {
    const count = candidates.filter(other => (
      other !== candidate && candidateOverlapAgreement(candidate, other)
    )).length;
    candidate.evidence.overlappingWindowAgreementCount = count;
    if (count > 0) candidate.confidence = clamp(candidate.confidence + Math.min(0.04, count * 0.015), 0, 1);
  }
}

function selectNonOverlappingCandidates(candidates: NetworkCandidate[]): NetworkCandidate[] {
  if (candidates.length === 0) return [];
  // Weighted interval scheduling preserves chronology and prevents overlapping
  // window responses from owning the same evidence twice.
  const ordered = candidates.slice().sort((left, right) => (
    left.sourceEnd - right.sourceEnd || left.sourceStart - right.sourceStart
  ));
  const previous = ordered.map((candidate, index) => {
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      if (ordered[prior].sourceEnd <= candidate.sourceStart) return prior;
    }
    return -1;
  });
  const dp = new Array<number>(ordered.length + 1).fill(0);
  const take = new Array<boolean>(ordered.length).fill(false);
  for (let index = 1; index <= ordered.length; index += 1) {
    const candidate = ordered[index - 1];
    const canonicalSpanM = candidate.quality.rawLengthM;
    const value = canonicalSpanM * (0.55 + candidate.confidence * 0.45)
      + (candidate.mode === 'B_ROAD_OFFSET' || candidate.mode === 'A_PEDESTRIAN_NETWORK' ? 4 : 0);
    const withCandidate = value + dp[previous[index - 1] + 1];
    if (withCandidate > dp[index - 1]) {
      dp[index] = withCandidate;
      take[index - 1] = true;
    } else {
      dp[index] = dp[index - 1];
    }
  }
  const selected: NetworkCandidate[] = [];
  let cursor = ordered.length - 1;
  while (cursor >= 0) {
    const candidate = ordered[cursor];
    const canonicalSpanM = candidate.quality.rawLengthM;
    const value = canonicalSpanM * (0.55 + candidate.confidence * 0.45)
      + (candidate.mode === 'B_ROAD_OFFSET' || candidate.mode === 'A_PEDESTRIAN_NETWORK' ? 4 : 0);
    const withCandidate = value + dp[previous[cursor] + 1];
    if (withCandidate > dp[cursor] + 1e-6) {
      selected.push(candidate);
      cursor = previous[cursor];
    } else {
      cursor -= 1;
    }
  }
  return selected.sort((left, right) => left.sourceStart - right.sourceStart);
}

interface DirectionsResult {
  candidate: NetworkCandidate | null;
  request: PedestrianFinalRequestResult;
}

async function walkingDirectionsCandidate(
  canonical: RawPoint[],
  sourceStart: number,
  sourceEnd: number,
  token: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<DirectionsResult> {
  const startedAt = Date.now();
  const subsection = canonical.slice(sourceStart, sourceEnd + 1);
  const request: PedestrianFinalRequestResult = {
    kind: 'walking-directions',
    sourceStart,
    sourceEnd,
    inputPointCount: 2,
    sourceIndexMap: [sourceStart, sourceEnd],
    durationMs: 0,
    result: 'not-run',
    httpStatus: null,
    responseCode: null,
    matchingCount: 0,
    tracepointCount: null,
    nullTracepointCount: null,
    acceptedCandidateCount: 0,
    rejectedCandidateCount: 0,
    profile: 'walking',
    matcherTidy: null,
  };
  if (!token || subsection.length < 2) {
    request.result = !token ? 'no-token' : 'too-short';
    return { candidate: null, request };
  }
  const start = subsection[0];
  const end = subsection[subsection.length - 1];
  const coords = `${start.lng.toFixed(6)},${start.lat.toFixed(6)};${end.lng.toFixed(6)},${end.lat.toFixed(6)}`;
  const url = `${MAPBOX_DIRECTIONS_ENDPOINT}/${coords}?alternatives=true&geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(token)}`;
  const abort = linkedAbortController(signal, timeoutMs);
  try {
    const response = await fetch(url, { signal: abort.controller.signal });
    request.httpStatus = response.status;
    if (!response.ok) {
      request.result = `http-${response.status}`;
      return { candidate: null, request };
    }
    const body = await response.json() as {
      code?: string;
      routes?: Array<{
        geometry?: { coordinates?: Array<[number, number]> };
        legs?: Array<{ steps?: Array<{ name?: string }> }>;
      }>;
    };
    request.responseCode = body.code ?? 'missing-code';
    request.matchingCount = body.routes?.length ?? 0;
    if (body.code !== 'Ok' || !body.routes?.length) {
      request.result = body.code ?? 'no-route';
      return { candidate: null, request };
    }
    const candidates: NetworkCandidate[] = [];
    for (const route of body.routes) {
      const geometry = (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lng, lat }));
      if (geometry.length < 2) continue;
      const quality = evaluateMatchedGeometryQuality(subsection, geometry);
      // Directions has no tracepoint confidence. Its confidence is derived
      // only from observed-shape agreement, never from successful routing.
      const shapeConfidence = clamp(
        0.94
        - quality.p95DeviationM / 100
        - Math.abs(1 - quality.lengthRatio) * 0.35,
        0,
        0.94,
      );
      const names = route.legs?.flatMap(leg => leg.steps?.map(step => step.name ?? null) ?? []) ?? [];
      const candidate = buildNetworkCandidate({
        canonical,
        sourceStart,
        sourceEnd,
        networkPoints: geometry,
        confidence: shapeConfidence,
        supportCount: Math.min(24, subsection.length),
        expectedSupportCount: Math.min(24, subsection.length),
        alternatives: [],
        names,
        source: 'walking-directions',
        routeAlternativeCount: body.routes.length - 1,
      });
      if (candidate) candidates.push(candidate);
    }
    const candidate = candidates.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
    request.acceptedCandidateCount = candidate ? 1 : 0;
    request.rejectedCandidateCount = Math.max(0, body.routes.length - (candidate ? 1 : 0));
    request.result = candidate ? 'accepted-candidate' : 'no-safe-candidate';
    return { candidate, request };
  } catch (error: any) {
    request.result = error?.name === 'AbortError' ? 'timeout-or-abort' : 'network-error';
    return { candidate: null, request };
  } finally {
    request.durationMs = Date.now() - startedAt;
    abort.dispose();
  }
}

function uncoveredSpans(canonical: RawPoint[], candidates: NetworkCandidate[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.sourceStart > cursor) spans.push([cursor, candidate.sourceStart]);
    cursor = Math.max(cursor, candidate.sourceEnd);
  }
  if (cursor < canonical.length - 1) spans.push([cursor, canonical.length - 1]);
  return spans.filter(([start, end]) => end > start);
}

function splitSpanForDirections(canonical: RawPoint[], start: number, end: number): Array<[number, number]> {
  const critical = finalGeometryCriticalIndices(canonical.slice(start, end + 1)).map(index => start + index);
  const anchors = new Set<number>([start, end, ...critical]);
  let travelledM = 0;
  for (let index = start + 1; index <= end; index += 1) {
    travelledM += hav(canonical[index - 1], canonical[index]);
    if (travelledM >= MAX_DIRECTIONS_SPAN_M) {
      anchors.add(index);
      travelledM = 0;
    }
  }
  const ordered = Array.from(anchors).sort((left, right) => left - right);
  const spans: Array<[number, number]> = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const subsection: [number, number] = [ordered[index - 1], ordered[index]];
    const distanceM = pathLength(canonical.slice(subsection[0], subsection[1] + 1));
    if (distanceM >= MIN_DIRECTIONS_SPAN_M && distanceM <= MAX_DIRECTIONS_SPAN_M * 1.2) spans.push(subsection);
  }
  return spans;
}

function candidateSection(candidate: NetworkCandidate): FinalRouteSection {
  return {
    sourceStart: candidate.sourceStart,
    sourceEnd: candidate.sourceEnd,
    state: candidate.state,
    geometryMode: candidate.mode,
    networkSource: candidate.source,
    decision: candidate.mode === 'C_CANONICAL_DERIVED' ? 'canonical-derived' : 'refined',
    reason: candidate.reason,
    confidence: candidate.confidence,
    corridorEvidence: candidate.evidence,
    lateralOffsetM: candidate.mode === 'B_ROAD_OFFSET' ? candidate.evidence.lateral.signedMedianM : null,
    canonicalDistanceM: candidate.quality.rawLengthM,
    displayDistanceM: pathLength(candidate.points),
    maximumDisplayEdgeM: maximumEdge(candidate.points),
    lengthRatio: candidate.quality.rawLengthM > 0
      ? pathLength(candidate.points) / candidate.quality.rawLengthM
      : 1,
    canonicalDisplacementP50M: candidate.quality.p50DeviationM,
    canonicalDisplacementP95M: candidate.quality.p95DeviationM,
    canonicalDisplacementMaxM: candidate.quality.maxDeviationM,
    seam: candidate.seam,
  };
}

function fallbackSection(
  canonical: RawPoint[],
  sourceStart: number,
  sourceEnd: number,
  freeTraversal: boolean,
): { points: SnappedPoint[]; section: FinalRouteSection } {
  const raw = canonical.slice(sourceStart, sourceEnd + 1);
  let points = cleanCanonicalGeometry(raw);
  if (freeTraversal && raw.length >= 3) {
    const projector = localProjector(raw[0]);
    const startXY = projector.toXY(raw[0]);
    const endXY = projector.toXY(raw[raw.length - 1]);
    const residuals = raw.map(point => pointToLineDistanceXY(projector.toXY(point), startXY, endXY));
    const canonicalLengthM = pathLength(raw);
    const directM = hav(raw[0], raw[raw.length - 1]);
    const straightEnough = percentile(residuals, 0.95) <= Math.max(3, accuracyP95(raw) * 0.4)
      && directM / Math.max(1, canonicalLengthM) >= 0.82;
    if (straightEnough) points = [canonicalPoint(raw[0]), canonicalPoint(raw[raw.length - 1])];
  }
  points = densifyGeometry(points, 16);
  points = anchorEndpoints(attachDisplayMetadata(points, raw), raw);
  const quality = evaluateMatchedGeometryQuality(raw, points);
  const deviation = deviationsToPath(raw, points);
  const seam = evaluateIslandSeamQuality(canonical, sourceStart, sourceEnd, points);
  return {
    points,
    section: {
      sourceStart,
      sourceEnd,
      state: freeTraversal ? 'FREE_TRAVERSAL' : 'OFF_NETWORK_PATH',
      geometryMode: freeTraversal ? 'FREE_TRAVERSAL' : 'C_CANONICAL_DERIVED',
      networkSource: 'none',
      decision: 'canonical-derived',
      reason: freeTraversal
        ? 'bounded-coherent-connector-inside-evidence-envelope'
        : 'no-safe-network-candidate;bounded-heading-aware-cleanup',
      confidence: 1,
      corridorEvidence: null,
      lateralOffsetM: null,
      canonicalDistanceM: quality.rawLengthM,
      displayDistanceM: quality.matchedLengthM,
      maximumDisplayEdgeM: maximumEdge(points),
      lengthRatio: quality.lengthRatio,
      canonicalDisplacementP50M: deviation.p50,
      canonicalDisplacementP95M: deviation.p95,
      canonicalDisplacementMaxM: deviation.max,
      seam,
    },
  };
}

function splitFallbackForTransitions(
  canonical: RawPoint[],
  sourceStart: number,
  sourceEnd: number,
  freeAtHead: boolean,
  freeAtTail: boolean,
): Array<{ points: SnappedPoint[]; section: FinalRouteSection }> {
  const totalM = pathLength(canonical.slice(sourceStart, sourceEnd + 1));
  if ((!freeAtHead && !freeAtTail) || totalM <= 45) {
    return [fallbackSection(canonical, sourceStart, sourceEnd, freeAtHead || freeAtTail)];
  }
  const critical = finalGeometryCriticalIndices(canonical.slice(sourceStart, sourceEnd + 1))
    .map(index => sourceStart + index)
    .filter(index => index > sourceStart && index < sourceEnd);
  const boundaries = new Set<number>([sourceStart, sourceEnd]);
  if (freeAtHead) {
    const boundary = critical.find(index => {
      const distanceM = pathLength(canonical.slice(sourceStart, index + 1));
      return distanceM >= 28 && distanceM <= 150;
    });
    if (boundary != null) boundaries.add(boundary);
  }
  if (freeAtTail) {
    const boundary = critical.slice().reverse().find(index => {
      const distanceM = pathLength(canonical.slice(index, sourceEnd + 1));
      return distanceM >= 28 && distanceM <= 150;
    });
    if (boundary != null) boundaries.add(boundary);
  }
  const ordered = Array.from(boundaries).sort((left, right) => left - right);
  return ordered.slice(1).map((end, index) => {
    const start = ordered[index];
    const subsectionM = pathLength(canonical.slice(start, end + 1));
    const isHead = index === 0 && freeAtHead && subsectionM <= 150;
    const isTail = index === ordered.length - 2 && freeAtTail && subsectionM <= 150;
    return fallbackSection(canonical, start, end, isHead || isTail);
  });
}

function assembleFinal(
  canonical: RawPoint[],
  candidates: NetworkCandidate[],
): { points: SnappedPoint[]; sections: FinalRouteSection[] } {
  const output: SnappedPoint[] = [];
  const sections: FinalRouteSection[] = [];
  const append = (piece: SnappedPoint[]) => {
    if (piece.length === 0) return;
    const start = output.length > 0 && hav(output[output.length - 1], piece[0]) <= 0.05 ? 1 : 0;
    for (let index = start; index < piece.length; index += 1) output.push(piece[index]);
  };
  let cursor = 0;
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.sourceStart > cursor) {
      const prior = candidates[index - 1];
      const fallbacks = splitFallbackForTransitions(
        canonical,
        cursor,
        candidate.sourceStart,
        prior != null,
        true,
      );
      for (const fallback of fallbacks) {
        append(fallback.points);
        sections.push(fallback.section);
      }
    }
    append(candidate.points);
    sections.push(candidateSection(candidate));
    cursor = candidate.sourceEnd;
  }
  if (cursor < canonical.length - 1) {
    const fallback = fallbackSection(canonical, cursor, canonical.length - 1, false);
    append(fallback.points);
    sections.push(fallback.section);
  }
  if (output.length === 0) {
    const fallback = fallbackSection(canonical, 0, canonical.length - 1, false);
    return { points: fallback.points, sections: [fallback.section] };
  }
  return { points: output, sections };
}

function emptyStats(canonical: RawPoint[], durationMs = 0): PedestrianFinalStats {
  const canonicalGeometry = canonical.map(canonicalPoint);
  return {
    algorithmVersion: 'pedestrian-final-v1',
    canonicalPointCount: canonical.length,
    resampledPointCount: 0,
    mapMatchingRequestCount: 0,
    directionsRequestCount: 0,
    requestResults: [],
    matchedIslandCount: 0,
    directionsIslandCount: 0,
    canonicalDerivedSectionCount: 0,
    freeTraversalSectionCount: 0,
    roadOffsetSectionCount: 0,
    pedestrianNetworkSectionCount: 0,
    rejectedNetworkCandidateCount: 0,
    displayRefined: false,
    acceptedMatchedDistanceM: 0,
    canonicalFallbackDistanceM: pathLength(canonical),
    mapMatchingApiDurationMs: 0,
    directionsApiDurationMs: 0,
    totalApiWallDurationMs: 0,
    totalApiDurationMs: 0,
    durationMs,
    sections: [],
    preFallbackCandidateSummary: [],
    preFallbackWholeRouteValidation: evaluateWholeRouteQuality(canonical, canonicalGeometry),
    wholeRouteValidation: evaluateWholeRouteQuality(canonical, canonicalGeometry),
    finalGeometryFingerprint: canonical.length > 0 ? geometryFingerprint(canonicalGeometry) : null,
  };
}

/** Exact production O50 Final compositor. Live tracking never calls this. */
export async function reconstructPedestrianFinalRoute(
  canonical: RawPoint[],
  options: PedestrianFinalOptions,
): Promise<PedestrianFinalResult> {
  const startedAt = Date.now();
  if (canonical.length === 0) return { ok: false, reason: 'no_input', stats: emptyStats(canonical) };
  if (canonical.length < 2) return { ok: false, reason: 'too_short', stats: emptyStats(canonical) };
  if (options.signal?.aborted) return { ok: false, reason: 'aborted', stats: emptyStats(canonical) };

  const submitted = resampleMatcherEvidence(canonical, 4_000);
  const windows = options.mapboxToken ? matchingWindows(submitted) : [];
  const apiStartedAt = Date.now();
  const totalAbort = linkedAbortController(options.signal, options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);
  const matchingResults = await runBounded(
    windows,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    chunk => mapMatchingWindow(
      chunk,
      canonical,
      options.mapboxToken,
      options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS,
      totalAbort.controller.signal,
    ),
  );
  const matchingCandidates = matchingResults.flatMap(result => result.candidates);
  annotateWindowAgreement(matchingCandidates);
  let selected = selectNonOverlappingCandidates(matchingCandidates);
  const requestResults = matchingResults.map(result => result.request);

  if (options.directionsFallback !== false && options.mapboxToken && !totalAbort.controller.signal.aborted) {
    const supportedHints = matchingResults.flatMap(result => result.directionsHints ?? [])
      .filter(([start, end]) => {
        const distanceM = pathLength(canonical.slice(start, end + 1));
        const alreadyOwned = selected.some(candidate => (
          start >= candidate.sourceStart && end <= candidate.sourceEnd
        ));
        return !alreadyOwned
          && distanceM >= MIN_DIRECTIONS_SPAN_M
          && distanceM <= MAX_DIRECTIONS_SPAN_M * 1.2;
      })
      // Observed tail/head corridors get first bounded fallback opportunity:
      // endpoint safety is stronger there and completion must not starve them.
      .sort((left, right) => right[1] - left[1]);
    const genericSpans = uncoveredSpans(canonical, selected)
      .flatMap(([start, end]) => splitSpanForDirections(canonical, start, end))
      .sort((left, right) => pathLength(canonical.slice(right[0], right[1] + 1))
        - pathLength(canonical.slice(left[0], left[1] + 1)));
    const seenSpans = new Set<string>();
    const directionSpans = [...supportedHints, ...genericSpans]
      .filter(([start, end]) => {
        const key = `${start}:${end}`;
        if (seenSpans.has(key)) return false;
        seenSpans.add(key);
        return true;
      })
      .slice(0, options.maxDirectionsRequests ?? MAX_DIRECTIONS_REQUESTS);
    for (const [sourceStart, sourceEnd] of directionSpans) {
      if (totalAbort.controller.signal.aborted) break;
      const direction = await walkingDirectionsCandidate(
        canonical,
        sourceStart,
        sourceEnd,
        options.mapboxToken,
        options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS,
        totalAbort.controller.signal,
      );
      requestResults.push(direction.request);
      if (direction.candidate) {
        selected = selectNonOverlappingCandidates([...selected, direction.candidate]);
      }
    }
  }
  const totalApiWallDurationMs = Date.now() - apiStartedAt;
  totalAbort.dispose();

  const preFallbackCandidateSummary = selected.map(candidate => ({
    sourceStart: candidate.sourceStart,
    sourceEnd: candidate.sourceEnd,
    mode: candidate.mode,
    source: candidate.source,
    confidence: candidate.confidence,
    maximumDisplayEdgeM: maximumEdge(candidate.points),
  }));
  let assembled = assembleFinal(canonical, selected);
  let wholeRouteValidation = evaluateWholeRouteQuality(canonical, assembled.points);
  const preFallbackWholeRouteValidation = wholeRouteValidation;
  if (!wholeRouteValidation.accepted) {
    selected = [];
    assembled = assembleFinal(canonical, []);
    wholeRouteValidation = evaluateWholeRouteQuality(canonical, assembled.points);
  }
  if (!wholeRouteValidation.accepted) {
    assembled = {
      points: canonical.map(canonicalPoint),
      sections: [fallbackSection(canonical, 0, canonical.length - 1, false).section],
    };
    wholeRouteValidation = evaluateWholeRouteQuality(canonical, assembled.points);
  }
  const mapRequests = requestResults.filter(result => result.kind === 'map-matching');
  const directionRequests = requestResults.filter(result => result.kind === 'walking-directions');
  const canonicalFallbackDistanceM = assembled.sections
    .filter(section => section.decision === 'canonical-derived')
    .reduce((sum, section) => sum + section.canonicalDistanceM, 0);
  const acceptedMatchedDistanceM = assembled.sections
    .filter(section => section.decision === 'refined')
    .reduce((sum, section) => sum + section.canonicalDistanceM, 0);
  const stats: PedestrianFinalStats = {
    algorithmVersion: 'pedestrian-final-v1',
    canonicalPointCount: canonical.length,
    resampledPointCount: submitted.length,
    mapMatchingRequestCount: mapRequests.length,
    directionsRequestCount: directionRequests.length,
    requestResults,
    matchedIslandCount: assembled.sections.filter(section => section.networkSource === 'map-matching').length,
    directionsIslandCount: assembled.sections.filter(section => section.networkSource === 'walking-directions').length,
    canonicalDerivedSectionCount: assembled.sections.filter(section => section.decision === 'canonical-derived').length,
    freeTraversalSectionCount: assembled.sections.filter(section => section.state === 'FREE_TRAVERSAL').length,
    roadOffsetSectionCount: assembled.sections.filter(section => section.geometryMode === 'B_ROAD_OFFSET').length,
    pedestrianNetworkSectionCount: assembled.sections.filter(section => section.geometryMode === 'A_PEDESTRIAN_NETWORK').length,
    rejectedNetworkCandidateCount: requestResults.reduce((sum, result) => sum + result.rejectedCandidateCount, 0),
    displayRefined: assembled.points.length !== canonical.length
      || assembled.points.some((point, index) => canonical[index] == null || hav(point, canonical[index]) > 0.05),
    acceptedMatchedDistanceM,
    canonicalFallbackDistanceM,
    mapMatchingApiDurationMs: mapRequests.reduce((sum, result) => sum + result.durationMs, 0),
    directionsApiDurationMs: directionRequests.reduce((sum, result) => sum + result.durationMs, 0),
    totalApiWallDurationMs,
    totalApiDurationMs: requestResults.reduce((sum, result) => sum + result.durationMs, 0),
    durationMs: Date.now() - startedAt,
    sections: assembled.sections,
    preFallbackCandidateSummary,
    preFallbackWholeRouteValidation,
    wholeRouteValidation,
    finalGeometryFingerprint: geometryFingerprint(assembled.points),
  };
  return { ok: true, points: assembled.points, stats };
}
