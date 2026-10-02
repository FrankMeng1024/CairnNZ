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
import type {
  ActivityMapboxPhase,
  ActivityMapboxRequestGovernor,
} from './activityRequestGovernor';

export type FinalRouteState =
  | 'NETWORK_CONFIDENT'
  | 'NETWORK_WEAK_SAME_CORRIDOR'
  | 'NETWORK_AMBIGUOUS'
  | 'FREE_TRAVERSAL'
  | 'OFF_NETWORK_PATH';

export type PedestrianGeometryMode =
  | 'A_PEDESTRIAN_NETWORK'
  | 'B_ROAD_OFFSET'
  | 'C_CANONICAL_DERIVED'
  | 'D_WEAK_SAME_CORRIDOR'
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
  /** Corridor identity can be strong even when exact sidewalk side is not. */
  acceptedAsWeakSameCorridor: boolean;
  corridorIdentityScore: number;
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
  promotionUtility: CandidatePromotionUtility | null;
}

export interface CandidatePromotionUtility {
  accepted: boolean;
  reason: string;
  providerGeometryRetained: boolean;
  networkAuthority: 'strong' | 'weak' | 'none';
  corridorEvidenceScore: number;
  canonicalP95DeviationM: number;
  lengthRatio: number;
  seamAccepted: boolean;
}

export interface PedestrianFinalRequestResult {
  requestId: string;
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
  /** True only once fetch is invoked; governor denials are diagnostic only. */
  invoked: boolean;
  governorReason: string | null;
  responseBytes: number;
}

export type SnapSectionClassification =
  | 'SNAP_ELIGIBLE'
  | 'LOCAL_ONLY'
  | 'AMBIGUOUS';

export type SnapSectionReasonCode =
  | 'TRACEPOINT_SUPPORTED'
  | 'LOCAL_TRACEPOINT_SUPPORT_INSUFFICIENT'
  | 'LOCAL_TRACEPOINT_SUPPORT_DISCONTINUITY'
  | 'LOCAL_CORRIDOR_ATTRIBUTION_CHANGE'
  | 'LOCAL_PARALLEL_ROAD_AMBIGUITY'
  | 'LOCAL_PROVIDER_AMBIGUITY_UNKNOWN'
  | 'LOCAL_SOURCE_UNCERTAINTY_HIGH'
  | 'LOCAL_SOURCE_CORRESPONDENCE_WEAK'
  | 'LOCAL_ENDPOINT_SUPPORT_WEAK'
  | 'LOCAL_CORRIDOR_STRUCTURE_MISMATCH'
  | 'LOCAL_TRUTH_ENVELOPE_EXCEEDED'
  | 'LOCAL_SEAM_UNSAFE'
  | 'LOCAL_ASSEMBLY_UNSAFE'
  | 'LOCAL_NO_MEANINGFUL_IMPROVEMENT'
  | 'LOCAL_DIRECTIONS_WITHOUT_MATCHING_AUTHORITY'
  | 'LOCAL_DIRECTIONS_COMPETING_ROUTES';

export interface PedestrianFinalSectionDecision {
  requestId: string;
  requestKind: 'map-matching' | 'walking-directions';
  sourceStart: number;
  sourceEnd: number;
  tracepointSupportCount: number;
  expectedTracepointCount: number;
  classification: SnapSectionClassification;
  result: 'accepted' | 'rejected' | 'not-evaluated';
  reasonCode: SnapSectionReasonCode;
  providerConfidence: number | null;
  localShapeScore: number | null;
  alternativesKnownFraction: number;
  unambiguousFraction: number;
  candidateSource: 'map-matching' | 'walking-directions';
  notes: string[];
}

export interface PedestrianFinalStats {
  algorithmVersion: 'pedestrian-final-v2-base';
  canonicalPointCount: number;
  resampledPointCount: number;
  mapMatchingRequestCount: number;
  directionsRequestCount: number;
  requestResults: PedestrianFinalRequestResult[];
  sectionDecisions: PedestrianFinalSectionDecision[];
  matchedIslandCount: number;
  directionsIslandCount: number;
  canonicalDerivedSectionCount: number;
  freeTraversalSectionCount: number;
  roadOffsetSectionCount: number;
  pedestrianNetworkSectionCount: number;
  weakSameCorridorSectionCount: number;
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
  baseFinalDiagnostics: BaseFinalDiagnostics;
  /** Opt-in QA trace. Production callers leave qualityTrace disabled so
   * response geometry is never duplicated into persisted Activity stats. */
  candidateTransformationTraces?: CandidateTransformationTrace[];
}

export interface CandidateGeometryTraceStage {
  stage:
    | 'provider-response'
    | 'source-correspondence-crop'
    | 'densified-crop'
    | 'road-offset-transformation'
    | 'pedestrian-network-transformation'
    | 'weak-corridor-transformation'
    | 'canonical-derived-transformation'
    | 'endpoint-anchoring';
  geometryFingerprint: string;
  pathLengthM: number;
  points: Array<{ lat: number; lng: number }>;
}

export interface CandidateTransformationTrace {
  requestId: string;
  sourceStart: number;
  sourceEnd: number;
  source: 'map-matching' | 'walking-directions';
  mode: PedestrianGeometryMode;
  reason: string;
  confidence: number;
  selectedByIntervalScheduler: boolean;
  retainedByAssemblySafety: boolean;
  stages: CandidateGeometryTraceStage[];
}

export interface BaseFinalDiagnostics {
  inputPointCount: number;
  collapsedPointCount: number;
  outputPointCount: number;
  effectiveUncertaintyM: number;
  simplificationToleranceM: number;
  corridorClass: 'simple' | 'complex';
  protectedTurnCount: number;
  geometricTurnCount: number;
  pauseBoundaryCount: number;
  stationaryCloudCollapsed: boolean;
  removedMicroExcursionCount: number;
  maximumRemovedExcursionDepthM: number;
  removedTransientSpikeCount: number;
  maximumRemovedTransientSpikeDepthM: number;
}

export interface LocalFinalDiagnostics extends BaseFinalDiagnostics {
  baselinePointCount: number;
  localCandidatePointCount: number;
  localToleranceM: number;
  maximumCanonicalDisplacementM: number;
  pathLengthRatio: number;
  accepted: boolean;
  rejectionReason: string | null;
}

export interface PedestrianFinalOptions {
  mapboxToken: string;
  /** HTTP boundary injection for the isolated Snap Lab. Production callers
   * omit this and use the platform fetch implementation unchanged. */
  fetchImpl?: typeof fetch;
  totalTimeoutMs?: number;
  perCallTimeoutMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
  directionsFallback?: boolean;
  maxDirectionsRequests?: number;
  requestGovernor?: ActivityMapboxRequestGovernor;
  requestPhase?: Extract<ActivityMapboxPhase, 'live' | 'final'>;
  requestReason?: string;
  /** QA-only forensic geometry trace; defaults to false. */
  qualityTrace?: boolean;
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
  state: 'NETWORK_CONFIDENT' | 'NETWORK_WEAK_SAME_CORRIDOR' | 'NETWORK_AMBIGUOUS';
  mode: PedestrianGeometryMode;
  reason: string;
  confidence: number;
  evidence: CorridorEvidence;
  quality: MatchedGeometryQuality;
  topology: TopologyQuality;
  seam: IslandSeamQuality;
  modalNetworkName: string | null;
  promotionUtility: CandidatePromotionUtility;
  trace?: CandidateTransformationTrace;
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
  diagnosticNotes?: string[];
  allowSeamTrim?: boolean;
  requestId: string;
  providerResponsePoints?: SnappedPoint[];
  qualityTrace?: boolean;
}

interface DirectionsAuthority {
  sourceStart: number;
  sourceEnd: number;
  supportCount: number;
  expectedSupportCount: number;
  alternatives: Array<number | null>;
  names: Array<string | null>;
  mapboxConfidence: number;
  matchingGeometry: SnappedPoint[];
  matchingEvidence: CorridorEvidence;
}

export interface MatchingWindowPlan {
  requestId: string;
  points: MatcherSubmittedPoint[];
}

const EARTH_R = 6_371_000;
const MAPBOX_MATCHING_ENDPOINT = 'https://api.mapbox.com/matching/v5/mapbox/walking';
const MAPBOX_DIRECTIONS_ENDPOINT = 'https://api.mapbox.com/directions/v5/mapbox/walking';
// Map Matching accepts up to 100 coordinates. Keep a bounded margin for URL
// size and preserve an overlap for chronology, but do not inherit the
// Directions API's 25-coordinate limit as a Matching decision boundary.
const MATCHING_WINDOW_SIZE = 80;
const MATCHING_WINDOW_OVERLAP = 8;
const MAX_MATCHING_REQUESTS = 33;
const DEFAULT_TOTAL_TIMEOUT_MS = 10_000;
const DEFAULT_PER_CALL_TIMEOUT_MS = 2_600;
const DEFAULT_CONCURRENCY = 2;
const MIN_NETWORK_SUPPORT = 4;
const MIN_NETWORK_DISTANCE_M = 15;
// Weak same-corridor evidence is useful for smoothing a persistent corridor,
// but a tiny endpoint run can otherwise introduce a network-shaped hook with
// no meaningful route benefit. High-confidence pedestrian/offset modes retain
// the general four-sample floor; only this weaker authority needs persistence.
const MIN_WEAK_CORRIDOR_SUPPORT = 8;
const MIN_WEAK_CORRIDOR_DISTANCE_M = 30;
const MAX_SEAM_TRIM = 3;
const MAX_DIRECTIONS_REQUESTS = 2;
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

function signedAngleDeltaDegrees(left: number, right: number): number {
  return ((right - left + 540) % 360) - 180;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function requestFingerprint(kind: string, evidence: string): string {
  let value = 0x811c9dc5;
  const input = `${kind}:${evidence}`;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return `${kind}:${value.toString(16).padStart(8, '0')}`;
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
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

function finalGeometryStructuralTurnIndices(points: RawPoint[]): number[] {
  if (points.length === 0) return [];
  const critical = new Set<number>([0, points.length - 1]);
  for (let index = 1; index < points.length - 1; index += 1) {
    // A turn is structural when it is visible at more than one walking
    // scale. A single noisy five-metre heading is not enough to freeze GPS
    // wiggle into Final, while a genuine corner or mountain switchback is
    // normally still present at ten and twenty-two metres.
    const scales = [
      { metres: 5, threshold: 125 },
      { metres: 10, threshold: 72 },
      { metres: 22, threshold: 52 },
    ];
    const scaleMatches: number[] = [];
    let strongestTurn = 0;
    for (const scale of scales) {
      const previous = meaningfulNeighbour(points, index, -1, scale.metres);
      const next = meaningfulNeighbour(points, index, 1, scale.metres);
      if (previous == null || next == null) continue;
      const turn = angleDeltaDegrees(
        bearingDegrees(points[previous], points[index]),
        bearingDegrees(points[index], points[next]),
      );
      strongestTurn = Math.max(strongestTurn, turn);
      if (turn >= scale.threshold) scaleMatches.push(scale.metres);
    }
    const incomingEdgeM = hav(points[index - 1], points[index]);
    const outgoingEdgeM = hav(points[index], points[index + 1]);
    const localTurn = angleDeltaDegrees(
      bearingDegrees(points[index - 1], points[index]),
      bearingDegrees(points[index], points[index + 1]),
    );
    const localAccuracyM = Math.max(
      3,
      Number(points[index - 1].accuracy) || 0,
      Number(points[index].accuracy) || 0,
      Number(points[index + 1].accuracy) || 0,
    );
    const evidenceSizedLocalTurn = incomingEdgeM >= Math.max(14, localAccuracyM)
      && outgoingEdgeM >= Math.max(14, localAccuracyM)
      && localTurn >= 70;
    // A real corner remains visible at corridor scale. Requiring the 22 m
    // view prevents a 1–5 m alternating GPS wobble from being promoted just
    // because it looks sharp at two tiny neighbourhoods. Near-reversals stay
    // protected even on a short out-and-back where 22 m is unavailable.
    if (
      evidenceSizedLocalTurn
      || (scaleMatches.includes(22) && scaleMatches.length >= 2)
    ) critical.add(index);
  }
  return Array.from(critical).sort((a, b) => a - b);
}

export function finalGeometryCriticalIndices(points: RawPoint[]): number[] {
  // True Pause/recovery/gap boundaries are represented by segment identity
  // before Final is invoked. Delivery cadence alone (8/15/21 seconds) is not
  // evidence that the user paused and must not freeze every sparse sample.
  const critical = new Set(finalGeometryStructuralTurnIndices(points));
  if (isCoherentClosedTraversal(points)) {
    for (let index = 1; index < points.length - 1; index += 1) {
      const turn = angleDeltaDegrees(
        bearingDegrees(points[index - 1], points[index]),
        bearingDegrees(points[index], points[index + 1]),
      );
      if (turn >= 30) critical.add(index);
    }
  }
  return [...critical].sort((left, right) => left - right);
}

function isCoherentClosedTraversal(points: RawPoint[]): boolean {
  if (points.length < 5) return false;
  const coherentTurns = points.slice(1, -1).flatMap((_point, offset) => {
    const index = offset + 1;
    if (hav(points[index - 1], points[index]) < 1 || hav(points[index], points[index + 1]) < 1) return [];
    const turn = signedAngleDeltaDegrees(
      bearingDegrees(points[index - 1], points[index]),
      bearingDegrees(points[index], points[index + 1]),
    );
    return Math.abs(turn) >= 12 ? [turn] : [];
  });
  const positive = coherentTurns.filter(turn => turn > 0).length;
  const negative = coherentTurns.filter(turn => turn < 0).length;
  const sameDirectionFraction = coherentTurns.length > 0
    ? Math.max(positive, negative) / coherentTurns.length
    : 0;
  return coherentTurns.length >= 3
    && sameDirectionFraction >= 0.75
    && coherentTurns.reduce((sum, turn) => sum + Math.abs(turn), 0) >= 220;
}

function isStationaryCloud(points: RawPoint[], uncertaintyM: number): boolean {
  if (points.length < 5) return false;
  const credibleMovingSamples = points.filter(point => (
    typeof point.speed === 'number' && Number.isFinite(point.speed) && point.speed >= 0.65
  )).length;
  if (credibleMovingSamples >= Math.max(2, Math.ceil(points.length * 0.2))) return false;
  if (isCoherentClosedTraversal(points)) return false;
  const origin = points[0];
  const radiusM = Math.max(...points.map(point => hav(origin, point)));
  const directM = hav(points[0], points[points.length - 1]);
  const travelledM = pathLength(points);
  return radiusM <= Math.max(6, uncertaintyM * 0.9)
    && directM <= Math.max(4, uncertaintyM * 0.4)
    && travelledM >= Math.max(20, uncertaintyM * 2);
}

function effectiveBaseUncertainty(points: RawPoint[]): number {
  const accuracies = points.flatMap(point => (
    typeof point.accuracy === 'number' && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  ));
  // Reported horizontal accuracy remains the primary uncertainty evidence.
  // A bounded default keeps imported/legacy paths deterministic without
  // pretending that missing accuracy is centimetre-perfect.
  return clamp(accuracies.length > 0 ? percentile(accuracies, 0.65) : 8, 3, 30);
}

function sameCorridorHeading(
  points: RawPoint[],
  start: number,
  end: number,
): boolean {
  const before = meaningfulNeighbour(points, start, -1, 5);
  const after = meaningfulNeighbour(points, end, 1, 5);
  if (before == null || after == null) return false;
  return angleDeltaDegrees(
    bearingDegrees(points[before], points[start]),
    bearingDegrees(points[end], points[after]),
  ) <= 34;
}

function collapseSameCorridorMicroExcursions(
  points: RawPoint[],
  uncertaintyM: number,
): {
  points: RawPoint[];
  removedCount: number;
  maximumRemovedDepthM: number;
} {
  if (points.length < 7) {
    return { points: points.slice(), removedCount: 0, maximumRemovedDepthM: 0 };
  }
  const maximumDepthM = clamp(uncertaintyM * 0.75, 4, 10);
  const rejoinRadiusM = clamp(uncertaintyM * 0.28, 1.5, 4);
  const removed = new Set<number>();
  let removedCount = 0;
  let maximumRemovedDepthM = 0;

  for (let start = 1; start < points.length - 5; start += 1) {
    if (removed.has(start)) continue;
    let excursionLengthM = 0;
    for (let end = start + 1; end < points.length - 1; end += 1) {
      excursionLengthM += hav(points[end - 1], points[end]);
      if (excursionLengthM > maximumDepthM * 2.9) break;
      if (end - start < 4 || hav(points[start], points[end]) > rejoinRadiusM) continue;
      if (!sameCorridorHeading(points, start, end)) continue;
      const excursion = points.slice(start, end + 1);
      const maximumDepth = Math.max(...excursion.map(point => hav(points[start], point)));
      if (maximumDepth < 2.5 || maximumDepth > maximumDepthM) continue;
      // Rejoining the same corridor after travelling several times the
      // endpoint displacement is the narrow, generic micro-spur signature.
      // Long backtracks and real route branches exceed the depth/length fuse.
      const endpointDisplacementM = Math.max(0.75, hav(points[start], points[end]));
      if (excursionLengthM / endpointDisplacementM < 3) continue;
      for (let index = start + 1; index < end; index += 1) removed.add(index);
      removedCount += 1;
      maximumRemovedDepthM = Math.max(maximumRemovedDepthM, maximumDepth);
      start = end - 1;
      break;
    }
  }
  return {
    points: points.filter((_point, index) => !removed.has(index)),
    removedCount,
    maximumRemovedDepthM,
  };
}

/**
 * Removes only a short uncertainty-bounded lateral out-and-back. The gate
 * requires opposing sharp turns, measurable detour, quick corridor return,
 * and no true source gap. A persistent corner, crossing, U-turn, backtrack,
 * Z, switchback, or parallel track fails at least one of those conditions.
 */
function collapseTransientLateralSpikes(
  points: RawPoint[],
  uncertaintyM: number,
): {
  points: RawPoint[];
  removedCount: number;
  maximumRemovedDepthM: number;
} {
  if (points.length < 5) {
    return { points: points.slice(), removedCount: 0, maximumRemovedDepthM: 0 };
  }
  // Stage 3 must still repair a short accepted burst when accuracy degrades.
  // The temporal/rejoin/opposing-turn/support gates below bound this; a larger
  // uncertainty envelope alone never authorizes straightening a path.
  const removed = new Set<number>();
  let removedCount = 0;
  let maximumRemovedDepthM = 0;

  for (let start = 0; start < points.length - 4; start += 1) {
    let best: { end: number; depthM: number; score: number } | null = null;
    for (let end = start + 4; end < Math.min(points.length, start + 12); end += 1) {
      const window = points.slice(start, end + 1);
      const directM = hav(window[0], window[window.length - 1]);
      if (directM < 8) continue;
      const travelledM = pathLength(window);
      const detourExcessM = travelledM - directM;
      if (detourExcessM < 3 || travelledM / directM < 1.24) continue;

      const depths = window.slice(1, -1).map(point => (
        projectPointToPath(point, [window[0], window[window.length - 1]]).distanceM
      ));
      const depthM = Math.max(...depths);
      const localAccuracyM = Math.max(
        uncertaintyM,
        ...window.map(point => (
          typeof point.accuracy === 'number' && Number.isFinite(point.accuracy)
            ? point.accuracy
            : 0
        )),
      );
      const localMaximumDepthM = clamp(localAccuracyM * 0.78, 4.5, 16);
      if (depthM < 3.25 || depthM > localMaximumDepthM) continue;
      // A sustained second corridor/branch has broad support. A transient GPS
      // spike peaks briefly and then converges back to the evidence chord.
      const materialSupportCount = depths.filter(value => value >= Math.max(2.5, depthM * 0.58)).length;
      if (materialSupportCount > 5) continue;

      const turns = window.slice(1, -1).map((_point, offset) => {
        const index = offset + 1;
        return signedAngleDeltaDegrees(
          bearingDegrees(window[index - 1], window[index]),
          bearingDegrees(window[index], window[index + 1]),
        );
      });
      const positiveTurn = Math.max(0, ...turns);
      const negativeTurn = Math.min(0, ...turns);
      if (positiveTurn < 55 || negativeTurn > -55) continue;

      const score = detourExcessM + depthM;
      if (!best || score > best.score) best = { end, depthM, score };
    }
    if (!best) continue;
    for (let index = start + 1; index < best.end; index += 1) removed.add(index);
    removedCount += 1;
    maximumRemovedDepthM = Math.max(maximumRemovedDepthM, best.depthM);
    start = best.end - 1;
  }
  return {
    points: points.filter((_point, index) => !removed.has(index)),
    removedCount,
    maximumRemovedDepthM,
  };
}

/**
 * Offline-safe Base Final. It removes only bounded uncertainty-sized
 * transient spikes/micro-excursions, then simplifies between multi-scale
 * structural turns. It never changes canonical truth, joins segments,
 * consults a network, or feeds Activity metrics/Memory.
 */
export function buildBaseFinalGeometry(points: RawPoint[]): {
  points: SnappedPoint[];
  diagnostics: BaseFinalDiagnostics;
} {
  if (points.length <= 2) {
    const exact = points.map(canonicalPoint);
    return {
      points: exact,
      diagnostics: {
        inputPointCount: points.length,
        collapsedPointCount: points.length,
        outputPointCount: exact.length,
        effectiveUncertaintyM: effectiveBaseUncertainty(points),
        simplificationToleranceM: 0,
        corridorClass: 'simple',
        protectedTurnCount: Math.max(0, points.length - 2),
        geometricTurnCount: Math.max(0, points.length - 2),
        pauseBoundaryCount: 0,
        stationaryCloudCollapsed: false,
        removedMicroExcursionCount: 0,
        maximumRemovedExcursionDepthM: 0,
        removedTransientSpikeCount: 0,
        maximumRemovedTransientSpikeDepthM: 0,
      },
    };
  }
  const effectiveUncertaintyM = effectiveBaseUncertainty(points);
  if (isStationaryCloud(points, effectiveUncertaintyM)) {
    const exact = [canonicalPoint(points[0]), canonicalPoint(points[points.length - 1])];
    return {
      points: exact,
      diagnostics: {
        inputPointCount: points.length,
        collapsedPointCount: 2,
        outputPointCount: 2,
        effectiveUncertaintyM,
        simplificationToleranceM: effectiveUncertaintyM,
        corridorClass: 'simple',
        protectedTurnCount: 0,
        geometricTurnCount: 0,
        pauseBoundaryCount: 0,
        stationaryCloudCollapsed: true,
        removedMicroExcursionCount: 0,
        maximumRemovedExcursionDepthM: 0,
        removedTransientSpikeCount: 0,
        maximumRemovedTransientSpikeDepthM: 0,
      },
    };
  }
  const despiked = collapseTransientLateralSpikes(points, effectiveUncertaintyM);
  const collapsed = collapseSameCorridorMicroExcursions(despiked.points, effectiveUncertaintyM);
  const allCritical = finalGeometryCriticalIndices(collapsed.points);
  const rawGeometricCritical = finalGeometryStructuralTurnIndices(collapsed.points);
  const directM = hav(collapsed.points[0], collapsed.points[collapsed.points.length - 1]);
  const rawTurnSigns = collapsed.points.slice(1, -1).flatMap((_point, offset) => {
    const index = offset + 1;
    const signed = signedAngleDeltaDegrees(
      bearingDegrees(collapsed.points[index - 1], collapsed.points[index]),
      bearingDegrees(collapsed.points[index], collapsed.points[index + 1]),
    );
    return Math.abs(signed) >= 8 ? [Math.sign(signed)] : [];
  });
  const rawAlternatingTurnCount = rawTurnSigns.slice(1)
    .filter((sign, index) => sign !== rawTurnSigns[index]).length;
  const highFrequencyWobble = rawTurnSigns.length >= 4
    && rawAlternatingTurnCount >= Math.ceil((rawTurnSigns.length - 1) * 0.35);
  const signedCorridorDistances = collapsed.points.slice(1, -1).map(point => (
    projectPointToPath(
      point,
      [collapsed.points[0], collapsed.points[collapsed.points.length - 1]],
    ).signedDistanceM
  )).filter(distanceM => Math.abs(distanceM) >= 0.75);
  const evidenceCrossesChord = signedCorridorDistances.filter(distanceM => distanceM > 0).length >= 2
    && signedCorridorDistances.filter(distanceM => distanceM < 0).length >= 2;
  const uncertaintyBoundedStraight = directM >= 30
    && highFrequencyWobble
    && evidenceCrossesChord
    && Math.max(...collapsed.points.map(point => projectPointToPath(
      point,
      [collapsed.points[0], collapsed.points[collapsed.points.length - 1]],
    ).distanceM)) <= clamp(effectiveUncertaintyM * 0.95, 3, 12);
  const geometricCritical = uncertaintyBoundedStraight
    ? [0, collapsed.points.length - 1]
    : rawGeometricCritical;
  const rawGeometricSet = new Set(rawGeometricCritical);
  const critical = uncertaintyBoundedStraight
    ? allCritical.filter(index => index === 0
      || index === collapsed.points.length - 1
      || !rawGeometricSet.has(index))
    : allCritical;
  const lengthM = pathLength(collapsed.points);
  const structuralTurnCount = Math.max(0, geometricCritical.length - 2);
  const pauseBoundaryCount = Math.max(0, critical.length - geometricCritical.length);
  const structuralTurnSigns = geometricCritical.slice(1, -1).flatMap(index => {
    const previous = meaningfulNeighbour(collapsed.points, index, -1, 6);
    const next = meaningfulNeighbour(collapsed.points, index, 1, 6);
    if (previous == null || next == null) return [];
    const signed = signedAngleDeltaDegrees(
      bearingDegrees(collapsed.points[previous], collapsed.points[index]),
      bearingDegrees(collapsed.points[index], collapsed.points[next]),
    );
    return Math.abs(signed) >= 35 ? [Math.sign(signed)] : [];
  });
  const alternatingTurnCount = structuralTurnSigns.slice(1)
    .filter((sign, index) => sign !== structuralTurnSigns[index]).length;
  // Ordinary urban routes may contain several genuine corners without being
  // mountain/switchback geometry. Complexity is geometric turn density, not
  // source cadence or stop duration.
  const corridorClass = structuralTurnCount >= 3 && (
    alternatingTurnCount >= 2
    || structuralTurnCount >= Math.max(8, Math.ceil(lengthM / 80))
  )
    ? 'complex' as const
    : 'simple' as const;
  const simplificationToleranceM = uncertaintyBoundedStraight
    ? clamp(effectiveUncertaintyM * 0.95, 3, 12)
    : corridorClass === 'complex'
    ? clamp(effectiveUncertaintyM * 0.20, 1.3, 2.5)
    : clamp(effectiveUncertaintyM * 0.55, 3, 9);
  const keep = new Set<number>(critical);
  for (let index = 1; index < critical.length; index += 1) {
    const start = critical[index - 1];
    const end = critical[index];
    const subsection = collapsed.points.slice(start, end + 1);
    for (const localIndex of rdpIndices(subsection, simplificationToleranceM)) {
      keep.add(start + localIndex);
    }
  }
  const simplified = Array.from(keep)
    .sort((a, b) => a - b)
    .map(index => canonicalPoint(collapsed.points[index]));
  const output = densifyGeometry(simplified, 16);
  return {
    points: output,
    diagnostics: {
      inputPointCount: points.length,
      collapsedPointCount: collapsed.points.length,
      outputPointCount: output.length,
      effectiveUncertaintyM,
      simplificationToleranceM,
      corridorClass,
      protectedTurnCount: structuralTurnCount,
      geometricTurnCount: structuralTurnCount,
      pauseBoundaryCount,
      stationaryCloudCollapsed: false,
      removedMicroExcursionCount: collapsed.removedCount,
      maximumRemovedExcursionDepthM: collapsed.maximumRemovedDepthM,
      removedTransientSpikeCount: despiked.removedCount,
      maximumRemovedTransientSpikeDepthM: despiked.maximumRemovedDepthM,
    },
  };
}

/**
 * Strong, network-free completion geometry. Unlike Base, this pass does not
 * promote every short alternating heading into a permanent turn. RDP's
 * deviation evidence decides which movement survives, while a strict
 * uncertainty corridor, topology gate, endpoint anchors and path-length gate
 * prevent a global-tolerance shortcut through corners, loops or backtracks.
 * Canonical evidence is never mutated or used for Activity metrics/Memory.
 */
export function buildEvidenceSupportedLocalFinalGeometry(points: RawPoint[]): {
  points: SnappedPoint[];
  diagnostics: LocalFinalDiagnostics;
} {
  const baseline = buildBaseFinalGeometry(points);
  const effectiveUncertaintyM = baseline.diagnostics.effectiveUncertaintyM;
  const rejected = (reason: string, candidatePointCount = baseline.points.length,
    maximumCanonicalDisplacementM = 0, pathLengthRatio = 1) => ({
    points: baseline.points,
    diagnostics: {
      ...baseline.diagnostics,
      baselinePointCount: baseline.points.length,
      localCandidatePointCount: candidatePointCount,
      localToleranceM: 0,
      maximumCanonicalDisplacementM,
      pathLengthRatio,
      accepted: false,
      rejectionReason: reason,
    },
  });
  if (points.length < 3 || baseline.diagnostics.stationaryCloudCollapsed) {
    return rejected(points.length < 3 ? 'insufficient-evidence' : 'stationary-cloud');
  }

  const despiked = collapseTransientLateralSpikes(points, effectiveUncertaintyM);
  const collapsed = collapseSameCorridorMicroExcursions(despiked.points, effectiveUncertaintyM);
  if (collapsed.points.length < 3) return rejected('insufficient-collapsed-evidence');
  const localToleranceM = clamp(effectiveUncertaintyM * 0.30, 3.5, 5);
  const simplified = rdpIndices(collapsed.points, localToleranceM)
    .map(index => canonicalPoint(collapsed.points[index]));
  const postRdpSpikes = collapseTransientLateralSpikes(simplified, localToleranceM);
  const postRdpExcursions = collapseSameCorridorMicroExcursions(
    postRdpSpikes.points,
    localToleranceM,
  );
  const candidate = densifyGeometry(postRdpExcursions.points, 16);
  if (candidate.length < 2) return rejected('empty-candidate');

  const topology = evaluateTopologyQuality(points, candidate);
  const wholeRoute = evaluateWholeRouteQuality(points, candidate);
  const maximumCanonicalDisplacementM = Math.max(...collapsed.points.map(point => (
    projectPointToPath(point, candidate).distanceM
  )));
  const canonicalLengthM = pathLength(points);
  const candidateLengthM = pathLength(candidate);
  const pathLengthRatio = canonicalLengthM > 0 ? candidateLengthM / canonicalLengthM : 1;
  const corridorLimitM = clamp(effectiveUncertaintyM * 0.55, 4, 7);
  const baselineFingerprint = geometryFingerprint(baseline.points);
  const candidateFingerprint = geometryFingerprint(candidate);
  const significantTurnCount = (geometry: Array<{ lat: number; lng: number }>) => {
    const headings: number[] = [];
    let anchor = 0;
    for (let index = 1; index < geometry.length; index += 1) {
      if (hav(geometry[anchor], geometry[index]) < 3) continue;
      headings.push(bearingDegrees(geometry[anchor], geometry[index]));
      anchor = index;
    }
    return headings.slice(1).filter((value, index) => (
      angleDeltaDegrees(headings[index], value) >= 28
    )).length;
  };
  const baselineTurnCount = significantTurnCount(baseline.points);
  const candidateTurnCount = significantTurnCount(candidate);
  let rejectionReason: string | null = null;
  if (topology.reason === 'lost_reversal' || topology.reason === 'bearing_disagreement') {
    rejectionReason = `topology:${topology.reason}`;
  }
  else if (candidateTurnCount > baselineTurnCount) rejectionReason = 'unsupported-turn-increase';
  else if (!wholeRoute.accepted) rejectionReason = `whole-route:${wholeRoute.reason}`;
  else if (maximumCanonicalDisplacementM > corridorLimitM) rejectionReason = 'uncertainty-corridor';
  // A local Final may remove uncertainty-sized zig-zag distance, but not a
  // material excursion/backtrack. RDP retains deviations larger than the
  // local tolerance; this independent ratio catches pathological shortcuts.
  else if (pathLengthRatio < 0.84 || pathLengthRatio > 1.03) rejectionReason = 'path-length-sanity';
  else if (candidateFingerprint === baselineFingerprint) rejectionReason = 'no-meaningful-change';
  else if (candidate.length >= baseline.points.length) rejectionReason = 'no-complexity-improvement';
  if (rejectionReason) {
    const fallback = rejected(
      rejectionReason,
      candidate.length,
      maximumCanonicalDisplacementM,
      pathLengthRatio,
    );
    fallback.diagnostics.localToleranceM = localToleranceM;
    return fallback;
  }
  return {
    points: attachDisplayMetadata(candidate, points),
    diagnostics: {
      ...baseline.diagnostics,
      outputPointCount: candidate.length,
      baselinePointCount: baseline.points.length,
      localCandidatePointCount: candidate.length,
      localToleranceM,
      maximumCanonicalDisplacementM,
      pathLengthRatio,
      accepted: true,
      rejectionReason: null,
    },
  };
}

/**
 * Chronological, bounded Final-only cleanup. RDP is applied independently
 * between multi-scale turns/reversals and stop boundaries, so measurement
 * wobble disappears without flattening a U-turn, Z, switchback or pause.
 */
export function cleanCanonicalGeometry(points: RawPoint[]): SnappedPoint[] {
  return buildBaseFinalGeometry(points).points;
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
  // Deliberately excludes lateral-side stability. Corridor identity answers
  // “which road/path?”, while lateral evidence answers “where within it?”.
  const corridorIdentityScore = clamp(
    input.mapboxConfidence * 0.25
    + coverage * 0.20
    + ambiguityScore * 0.16
    + bearingAgreementScore * 0.14
    + lengthAgreementScore * 0.12
    + endpointSafetyScore * 0.08
    + temporalPersistenceScore * 0.05,
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
  const weakTruthEnvelope = quality.accepted || (
    quality.reason === 'raw_deviation'
    && quality.p95DeviationM <= quality.deviationEnvelopeM + 2
    && quality.maxDeviationM <= Math.max(20, quality.deviationEnvelopeM * 1.4)
  );
  const acceptedAsWeakSameCorridor = !acceptedByBaseGate
    && !acceptedByCoherentOverrun
    && input.mapboxConfidence >= 0.76
    && coverage >= 0.76
    && ambiguityScore >= 0.72
    && bearingAgreementScore >= 0.58
    && topology.accepted
    && quality.lengthRatio >= 0.76
    && quality.lengthRatio <= 1.30
    && quality.endpointDeviationM <= Math.max(20, quality.deviationEnvelopeM * 1.35)
    && corridorIdentityScore >= 0.72
    && weakTruthEnvelope;
  const accepted = acceptedByBaseGate || acceptedByCoherentOverrun || acceptedAsWeakSameCorridor;
  const reason = acceptedByBaseGate
    ? 'composite-corridor-evidence'
    : acceptedByCoherentOverrun
      ? 'coherent-isolated-envelope-overrun'
      : acceptedAsWeakSameCorridor
        ? 'weak-same-corridor-identity'
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
    acceptedAsWeakSameCorridor,
    corridorIdentityScore,
    accepted,
    reason,
    lateral,
  };
}

function anchorEndpoints(
  points: SnappedPoint[],
  canonical: RawPoint[],
  anchorHead = true,
  anchorTail = true,
): SnappedPoint[] {
  if (points.length < 2 || canonical.length < 2) return points;
  const result = points.slice();
  const blendAnchor = (head: boolean) => {
    const endpointIndex = head ? 0 : result.length - 1;
    const anchor = canonicalPoint(head ? canonical[0] : canonical[canonical.length - 1]);
    const displacementM = hav(result[endpointIndex], anchor);
    const blendDistanceM = clamp(displacementM * 4, 16, 48);
    const latDelta = anchor.lat - result[endpointIndex].lat;
    const lngDelta = anchor.lng - result[endpointIndex].lng;
    let travelledM = 0;
    let previousIndex = endpointIndex;
    for (let offset = 0; offset < result.length; offset += 1) {
      const index = head ? offset : result.length - 1 - offset;
      if (offset > 0) travelledM += hav(result[previousIndex], result[index]);
      if (travelledM >= blendDistanceM) break;
      const weight = 1 - travelledM / blendDistanceM;
      result[index] = {
        ...result[index],
        lat: result[index].lat + latDelta * weight,
        lng: result[index].lng + lngDelta * weight,
      };
      previousIndex = index;
    }
    result[endpointIndex] = anchor;
  };
  if (anchorHead) blendAnchor(true);
  if (anchorTail) blendAnchor(false);
  return result;
}

function candidateTraceStage(
  stage: CandidateGeometryTraceStage['stage'],
  points: SnappedPoint[],
): CandidateGeometryTraceStage {
  const geometry = points.map(point => ({ lat: point.lat, lng: point.lng }));
  return {
    stage,
    geometryFingerprint: geometryFingerprint(geometry),
    pathLengthM: pathLength(geometry),
    points: geometry,
  };
}

export function evaluateCandidatePromotionUtility(input: {
  mode: PedestrianGeometryMode;
  evidence: CorridorEvidence;
  quality: MatchedGeometryQuality;
  seam: IslandSeamQuality;
}): CandidatePromotionUtility {
  const providerGeometryRetained = input.mode === 'A_PEDESTRIAN_NETWORK'
    || input.mode === 'B_ROAD_OFFSET'
    || input.mode === 'D_WEAK_SAME_CORRIDOR';
  const networkAuthority = input.mode === 'D_WEAK_SAME_CORRIDOR'
    ? 'weak' as const
    : input.mode === 'A_PEDESTRIAN_NETWORK' || input.mode === 'B_ROAD_OFFSET'
      ? 'strong' as const
      : 'none' as const;
  const weakUtilitySupported = input.evidence.score >= 0.76
    && input.quality.p95DeviationM <= 6
    && input.quality.lengthRatio <= 1.12;
  const strongUtilitySupported = networkAuthority === 'strong'
    && input.quality.p95DeviationM <= 6;
  const accepted = input.seam.accepted && (
    strongUtilitySupported
    || networkAuthority === 'none'
    || weakUtilitySupported
  );
  const reason = !input.seam.accepted
    ? `unsafe-seam:${input.seam.reason}`
    : strongUtilitySupported
      ? 'strong-provider-network-authority-with-bounded-truth-distance'
      : networkAuthority === 'strong'
        ? `strong-provider-line-no-bounded-utility:p95=${input.quality.p95DeviationM.toFixed(1)}`
      : networkAuthority === 'none'
        ? 'canonical-derived-not-network-promotion'
        : weakUtilitySupported
          ? 'weak-provider-line-with-bounded-truth-distance'
          : `weak-provider-line-no-bounded-utility:score=${input.evidence.score.toFixed(3)};p95=${input.quality.p95DeviationM.toFixed(1)};length=${input.quality.lengthRatio.toFixed(3)}`;
  return {
    accepted,
    reason,
    providerGeometryRetained,
    networkAuthority,
    corridorEvidenceScore: input.evidence.score,
    canonicalP95DeviationM: input.quality.p95DeviationM,
    lengthRatio: input.quality.lengthRatio,
    seamAccepted: input.seam.accepted,
  };
}

function buildNetworkCandidate(input: CandidateBuildInput): NetworkCandidate | null {
  const rawSubsection = input.canonical.slice(input.sourceStart, input.sourceEnd + 1);
  if (rawSubsection.length < 2 || pathLength(rawSubsection) < MIN_NETWORK_DISTANCE_M) {
    input.diagnosticNotes?.push('candidate:source-too-short');
    return null;
  }
  const endpointCoverage = analyzeTrustedEndpointCoverage(rawSubsection, input.networkPoints);
  if (!endpointCoverage.eligibleForAnchoring) {
    input.diagnosticNotes?.push(
      `candidate:endpoint-coverage:head=${endpointCoverage.headDisplacementM.toFixed(1)};tail=${endpointCoverage.tailDisplacementM.toFixed(1)};envelope=${endpointCoverage.anchoringEnvelopeM.toFixed(1)}`,
    );
    return null;
  }
  const evidence = evaluateCorridorEvidence({
    canonical: rawSubsection,
    network: input.networkPoints,
    mapboxConfidence: input.confidence,
    supportCount: input.supportCount,
    expectedSupportCount: input.expectedSupportCount,
    alternatives: input.alternatives,
    routeAlternativeCount: input.routeAlternativeCount,
  });
  if (!evidence.accepted) {
    input.diagnosticNotes?.push(`candidate:corridor:${evidence.reason}`);
    return null;
  }

  const modalNetworkName = modalValue(input.names);
  const lowAmbiguity = input.source === 'walking-directions'
    ? input.routeAlternativeCount === 0
    : evidence.ambiguityKnownFraction >= 0.7 && evidence.unambiguousFraction >= 0.75;
  let mode: PedestrianGeometryMode;
  let display: SnappedPoint[];
  let reason: string;
  const networkForDisplay = densifyGeometry(input.networkPoints);
  const traceStages: CandidateGeometryTraceStage[] = input.qualityTrace ? [
    candidateTraceStage('provider-response', input.providerResponsePoints ?? input.networkPoints),
    candidateTraceStage('source-correspondence-crop', input.networkPoints),
    candidateTraceStage('densified-crop', networkForDisplay),
  ] : [];
  let transformationStage: CandidateGeometryTraceStage['stage'];
  if (
    evidence.lateral.stable
    && lowAmbiguity
    && evidence.lateral.absoluteMedianM >= ROAD_OFFSET_MIN_M
    && evidence.lateral.absoluteMedianM <= ROAD_OFFSET_MAX_M
  ) {
    mode = 'B_ROAD_OFFSET';
    // A stable GPS-to-network lateral offset proves corridor identity, but it
    // does not prove which side of a mapped line contains a legal pedestrian
    // facility. Preserve provider geometry until independent side-of-road
    // authority exists; applying the noisy GPS median here can move an
    // otherwise useful response away from its network corridor.
    display = networkForDisplay;
    transformationStage = 'road-offset-transformation';
    reason = `${evidence.reason};stable-lateral-evidence;provider-line-retained`;
  } else if (
    modalNetworkName == null
    && lowAmbiguity
    && evidence.lateral.absoluteMedianM < ROAD_OFFSET_MIN_M
    && evidence.lateral.p95ResidualM <= 3.5
  ) {
    mode = 'A_PEDESTRIAN_NETWORK';
    display = networkForDisplay;
    transformationStage = 'pedestrian-network-transformation';
    reason = `${evidence.reason};pedestrian-aligned-network`;
  } else if (lowAmbiguity) {
    // Exact sidewalk side is uncertain, but the topology is not. Place a
    // smooth evidence-centred line on the identified corridor within a
    // bounded uncertainty envelope instead of falling back to GPS serration.
    if (input.supportCount < MIN_WEAK_CORRIDOR_SUPPORT
      || pathLength(rawSubsection) < MIN_WEAK_CORRIDOR_DISTANCE_M) {
      input.diagnosticNotes?.push('candidate:weak-corridor-too-short');
      return null;
    }
    mode = 'D_WEAK_SAME_CORRIDOR';
    display = networkForDisplay;
    transformationStage = 'weak-corridor-transformation';
    reason = `${evidence.reason};corridor-strong-side-uncertain;provider-line-retained`;
  } else {
    // Road topology may still be confidently identified, but uncertain side
    // evidence is not permission to put a walker on the carriageway centre.
    mode = 'C_CANONICAL_DERIVED';
    display = cleanCanonicalGeometry(rawSubsection);
    transformationStage = 'canonical-derived-transformation';
    reason = `${evidence.reason};network-side-ambiguous`;
  }
  if (input.qualityTrace) traceStages.push(candidateTraceStage(transformationStage, display));
  // Anchor over a displacement-scaled transition rather than replacing one
  // vertex. A one-edge replacement can manufacture a hook even when the
  // provider crop is good; the blended transition keeps exact chronological
  // joins while allowing the seam gate to inspect the complete shape.
  display = anchorEndpoints(
    attachDisplayMetadata(display, rawSubsection),
    rawSubsection,
    true,
    true,
  );
  if (input.qualityTrace) traceStages.push(candidateTraceStage('endpoint-anchoring', display));
  const quality = evaluateMatchedGeometryQuality(rawSubsection, display);
  const topology = evaluateTopologyQuality(rawSubsection, display);
  const seam = evaluateIslandSeamQuality(input.canonical, input.sourceStart, input.sourceEnd, display);
  if (quality.accepted && topology.accepted && !seam.accepted
    && input.allowSeamTrim !== false
    && (seam.reason === 'entry_heading' || seam.reason === 'exit_heading')) {
    for (let trim = 1; trim <= MAX_SEAM_TRIM; trim += 1) {
      const headTrim = seam.reason === 'entry_heading' ? trim : 0;
      const tailTrim = seam.reason === 'exit_heading' ? trim : 0;
      const sourceStart = input.sourceStart + headTrim;
      const sourceEnd = input.sourceEnd - tailTrim;
      if (sourceEnd - sourceStart + 1 < MIN_NETWORK_SUPPORT) break;
      const trimmedNetwork = cropGeometryToTracepoints(input.networkPoints, [
        [input.canonical[sourceStart].lng, input.canonical[sourceStart].lat],
        [input.canonical[sourceEnd].lng, input.canonical[sourceEnd].lat],
      ]);
      if (!trimmedNetwork) continue;
      const trimDiagnostics: string[] = [];
      const trimmed = buildNetworkCandidate({
        ...input,
        sourceStart,
        sourceEnd,
        networkPoints: trimmedNetwork,
        supportCount: Math.max(0, input.supportCount - headTrim - tailTrim),
        expectedSupportCount: Math.max(1, input.expectedSupportCount - headTrim - tailTrim),
        alternatives: input.alternatives.slice(headTrim, tailTrim > 0 ? -tailTrim : undefined),
        names: input.names.slice(headTrim, tailTrim > 0 ? -tailTrim : undefined),
        diagnosticNotes: trimDiagnostics,
        allowSeamTrim: false,
      });
      if (trimmed) {
        input.diagnosticNotes?.push(
          `candidate:seam-boundary-trim:head=${headTrim};tail=${tailTrim};original=${seam.reason}`,
        );
        return {
          ...trimmed,
          reason: `${trimmed.reason};bounded-seam-trim-${headTrim}-${tailTrim}`,
        };
      }
      input.diagnosticNotes?.push(...trimDiagnostics.map(note => `trim-${headTrim}-${tailTrim}:${note}`));
    }
  }
  if (!quality.accepted || !topology.accepted || !seam.accepted) {
    input.diagnosticNotes?.push(
      `candidate:display-mode=${mode};quality=${quality.reason};topology=${topology.reason};seam=${seam.reason};lateralMedian=${evidence.lateral.signedMedianM.toFixed(1)};lateralStable=${evidence.lateral.stable}`,
    );
    return null;
  }
  const promotionUtility = evaluateCandidatePromotionUtility({ mode, evidence, quality, seam });
  if (!promotionUtility.accepted) {
    input.diagnosticNotes?.push(`candidate:promotion:${promotionUtility.reason}`);
    return null;
  }
  return {
    sourceStart: input.sourceStart,
    sourceEnd: input.sourceEnd,
    points: display,
    networkPoints: input.networkPoints,
    source: input.source,
    state: mode === 'C_CANONICAL_DERIVED'
      ? 'NETWORK_AMBIGUOUS'
      : mode === 'D_WEAK_SAME_CORRIDOR' ? 'NETWORK_WEAK_SAME_CORRIDOR' : 'NETWORK_CONFIDENT',
    mode,
    reason: `${reason};promotion:${promotionUtility.reason}`,
    confidence: evidence.score,
    evidence,
    quality,
    topology,
    seam,
    modalNetworkName,
    promotionUtility,
    ...(input.qualityTrace ? {
      trace: {
        requestId: input.requestId,
        sourceStart: input.sourceStart,
        sourceEnd: input.sourceEnd,
        source: input.source,
        mode,
        reason: `${reason};promotion:${promotionUtility.reason}`,
        confidence: evidence.score,
        selectedByIntervalScheduler: false,
        retainedByAssemblySafety: false,
        stages: traceStages,
      },
    } : {}),
  };
}

export interface MapboxTracepoint {
  matchings_index?: number;
  waypoint_index?: number;
  alternatives_count?: number;
  name?: string;
  location?: [number, number];
}

export interface DerivedSnapSectionRun {
  submittedStart: number;
  submittedEnd: number;
  sourceStart: number;
  sourceEnd: number;
  submittedIndices: number[];
  classification: SnapSectionClassification;
  reasonCode: SnapSectionReasonCode;
}

function sourceCorrespondenceEnvelopeM(point: MatcherSubmittedPoint): number {
  const accuracyM = typeof point.accuracy === 'number' && Number.isFinite(point.accuracy)
    ? Math.max(0, point.accuracy)
    : 10;
  return Math.min(20, Math.max(8, accuracyM * 1.25));
}

function localTruthEnvelopeM(point: MatcherSubmittedPoint): number {
  const accuracyM = typeof point.accuracy === 'number' && Number.isFinite(point.accuracy)
    ? Math.max(0, point.accuracy)
    : 10;
  // Keep this identical to the production candidate truth envelope. Section
  // derivation may localize a persistent failing regime, but it must never
  // widen the geometry acceptance threshold to make a candidate pass.
  return Math.min(15, Math.max(8, accuracyM * 1.25));
}

function eligibleSnapSectionRegime(): {
  key: string;
  classification: SnapSectionClassification;
  reasonCode: SnapSectionReasonCode;
} {
  return {
    // Accuracy still controls the explicit uncertainty/correspondence/truth
    // gates above. Once those gates agree that adjacent observations are
    // eligible, a harmless metadata transition must not manufacture a new
    // physical section before minimum-support checks run.
    key: 'eligible:supported',
    classification: 'SNAP_ELIGIBLE',
    reasonCode: 'TRACEPOINT_SUPPORTED',
  };
}

function snapSectionRegime(
  point: MatcherSubmittedPoint,
  tracepoint: MapboxTracepoint,
): { key: string; classification: SnapSectionClassification; reasonCode: SnapSectionReasonCode } {
  const accuracyM = typeof point.accuracy === 'number' && Number.isFinite(point.accuracy)
    ? point.accuracy
    : 10;
  if (accuracyM > 30) {
    return {
      key: 'local:uncertainty-high',
      classification: 'LOCAL_ONLY',
      reasonCode: 'LOCAL_SOURCE_UNCERTAINTY_HIGH',
    };
  }
  if (tracepoint.alternatives_count == null) {
    return {
      key: 'ambiguous:provider-unknown',
      classification: 'AMBIGUOUS',
      reasonCode: 'LOCAL_PROVIDER_AMBIGUITY_UNKNOWN',
    };
  }
  if (tracepoint.alternatives_count > 0) {
    return {
      key: 'ambiguous:parallel-corridor',
      classification: 'AMBIGUOUS',
      reasonCode: 'LOCAL_PARALLEL_ROAD_AMBIGUITY',
    };
  }
  if (!tracepoint.location) {
    return {
      key: 'local:missing-correspondence',
      classification: 'LOCAL_ONLY',
      reasonCode: 'LOCAL_TRACEPOINT_SUPPORT_INSUFFICIENT',
    };
  }
  const correspondenceM = hav(point, { lng: tracepoint.location[0], lat: tracepoint.location[1] });
  if (correspondenceM > sourceCorrespondenceEnvelopeM(point)) {
    return {
      key: 'local:correspondence-weak',
      classification: 'LOCAL_ONLY',
      reasonCode: 'LOCAL_SOURCE_CORRESPONDENCE_WEAK',
    };
  }
  if (correspondenceM > localTruthEnvelopeM(point)) {
    return {
      key: 'local:truth-envelope-pressure',
      classification: 'LOCAL_ONLY',
      reasonCode: 'LOCAL_TRUTH_ENVELOPE_EXCEEDED',
    };
  }
  return eligibleSnapSectionRegime();
}

/**
 * Turn one provider sub-matching into deterministic evidence sections. The
 * split inputs are source uncertainty, tracepoint correspondence and provider
 * ambiguity—not whether an arbitrary cropped range happens to pass p95.
 * Single-sample regime flicker remains inside its neighbours so the algorithm
 * cannot p-hack a failing point away. Accepted islands require four supported
 * observations and 15 m of source movement.
 */
export function deriveSnapSectionRuns(
  chunk: MatcherSubmittedPoint[],
  tracepoints: Array<MapboxTracepoint | null>,
  matchingIndex: number,
): DerivedSnapSectionRun[] {
  const supported = tracepoints.flatMap((tracepoint, index) => (
    tracepoint?.matchings_index === matchingIndex ? [index] : []
  ));
  const contiguous: number[][] = [];
  let current: number[] = [];
  for (const index of supported) {
    if (current.length > 0 && index !== current[current.length - 1] + 1) {
      contiguous.push(current);
      current = [];
    }
    current.push(index);
  }
  if (current.length > 0) contiguous.push(current);

  const sections: DerivedSnapSectionRun[] = [];
  for (const run of contiguous) {
    const labels = run.map(index => snapSectionRegime(chunk[index], tracepoints[index]!));
    // Preserve isolated negative context inside the evaluated section. Truth-
    // envelope pressure needs three consecutive observations before it may
    // release independent evidence around it; this is a deterministic local
    // regime, not an arbitrary crop or removal of one inconvenient sample.
    // Existing provider ambiguity/correspondence regimes retain their two-fix
    // persistence contract.
    for (let offset = 0; offset < labels.length; offset += 1) {
      const start = offset;
      while (offset + 1 < labels.length && labels[offset + 1].key === labels[start].key) offset += 1;
      const length = offset - start + 1;
      const previous = labels[start - 1];
      const next = labels[offset + 1];
      if (labels[start].classification === 'SNAP_ELIGIBLE') continue;
      const isBoundedInterior = previous?.classification === 'SNAP_ELIGIBLE'
        && next?.classification === 'SNAP_ELIGIBLE';
      const minimumPersistence = labels[start].reasonCode === 'LOCAL_TRUTH_ENVELOPE_EXCEEDED' ? 3 : 2;
      // Truth pressure is useful as a split only when it is local relative to
      // supported evidence on both sides. A uniformly offset corridor still
      // belongs to the unchanged composite/lateral gates below.
      const keepAsLocalRegime = length >= minimumPersistence
        && (labels[start].reasonCode !== 'LOCAL_TRUTH_ENVELOPE_EXCEEDED' || isBoundedInterior);
      if (keepAsLocalRegime) continue;
      if (isBoundedInterior || labels[start].reasonCode === 'LOCAL_TRUTH_ENVELOPE_EXCEEDED') {
        for (let fill = start; fill <= offset; fill += 1) {
          labels[fill] = eligibleSnapSectionRegime();
        }
      }
    }

    let startOffset = 0;
    while (startOffset < run.length) {
      let endOffset = startOffset;
      while (endOffset + 1 < run.length && labels[endOffset + 1].key === labels[startOffset].key) {
        endOffset += 1;
      }
      const indices = run.slice(startOffset, endOffset + 1);
      const first = indices[0];
      const last = indices[indices.length - 1];
      const sourceDistanceM = pathLength(chunk.slice(first, last + 1));
      const tooSmall = indices.length < MIN_NETWORK_SUPPORT || sourceDistanceM < MIN_NETWORK_DISTANCE_M;
      const alreadyLocal = labels[startOffset].classification !== 'SNAP_ELIGIBLE';
      sections.push({
        submittedStart: first,
        submittedEnd: last,
        sourceStart: chunk[first].sourceIndex,
        sourceEnd: chunk[last].sourceIndex,
        submittedIndices: indices,
        classification: tooSmall ? 'LOCAL_ONLY' : labels[startOffset].classification,
        reasonCode: tooSmall && !alreadyLocal
          ? 'LOCAL_TRACEPOINT_SUPPORT_INSUFFICIENT'
          : labels[startOffset].reasonCode,
      });
      startOffset = endOffset + 1;
    }
  }
  return sections;
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

export function cropGeometryToTracepoints(
  geometry: SnappedPoint[],
  observations: Array<[number, number]>,
): SnappedPoint[] | null {
  if (geometry.length < 2 || observations.length < 2) return null;
  // Mapbox waypoint_index indexes submitted observations, not geometry
  // vertices. Follow the complete tracepoint sequence monotonically through
  // the response geometry so a loop whose tail is spatially near its head
  // cannot collapse to the first matching vertex.
  const geometryIndices: number[] = [];
  let minimumIndex = 0;
  for (const observation of observations) {
    const index = nearestGeometryIndex(geometry, observation, minimumIndex);
    geometryIndices.push(index);
    minimumIndex = index;
  }
  const start = geometryIndices[0];
  const end = geometryIndices[geometryIndices.length - 1];
  if (end <= start) return null;
  const head = observations[0];
  const tail = observations[observations.length - 1];
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
  sectionDecisions: PedestrianFinalSectionDecision[];
  directionsHints?: DirectionsAuthority[];
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
  requestId: string,
  chunk: MatcherSubmittedPoint[],
  canonical: RawPoint[],
  token: string,
  timeoutMs: number,
  signal?: AbortSignal,
  governor?: ActivityMapboxRequestGovernor,
  phase: Extract<ActivityMapboxPhase, 'live' | 'final'> = 'final',
  reason = 'qualified-unresolved-window',
  requestFetch: typeof fetch = fetch,
  qualityTrace = false,
): Promise<WindowResult> {
  const startedAt = Date.now();
  const diagnostic: PedestrianFinalRequestResult = {
    requestId,
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
    invoked: false,
    governorReason: null,
    responseBytes: 0,
  };
  if (chunk.length < 2 || !token) {
    diagnostic.result = !token ? 'no-token' : 'too-short';
    return { candidates: [], request: diagnostic, sectionDecisions: [] };
  }
  if (signal?.aborted) {
    diagnostic.result = 'aborted';
    return { candidates: [], request: diagnostic, sectionDecisions: [] };
  }
  const coords = chunk.map(point => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(';');
  const radiuses = chunk.map(point => clamp(Math.round(point.accuracy ?? 15), 5, 50)).join(';');
  const seconds = chunk.map(point => point.t == null ? null : Math.floor(Number(point.t) / 1_000));
  const validTimes = seconds.every((value): value is number => value != null)
    && seconds.every((value, index) => index === 0 || value > Number(seconds[index - 1]));
  const timestampQuery = validTimes ? `&timestamps=${seconds.join(';')}` : '';
  const url = `${MAPBOX_MATCHING_ENDPOINT}/${coords}?geometries=geojson&overview=full&steps=true&tidy=false&radiuses=${radiuses}${timestampQuery}&access_token=${encodeURIComponent(token)}`;
  let receiptId: string | null = null;
  if (governor) {
    try {
      const permit = await governor.authorize({
        phase,
        kind: 'map-matching',
        fingerprint: requestFingerprint('matching', `${coords}|${radiuses}|${seconds.join(';')}`),
        reason,
      });
      diagnostic.governorReason = permit.reason;
      if (!permit.allowed || !permit.receiptId) {
        diagnostic.result = `governor-${permit.reason}`;
        diagnostic.durationMs = Date.now() - startedAt;
        return { candidates: [], request: diagnostic, sectionDecisions: [] };
      }
      receiptId = permit.receiptId;
    } catch {
      diagnostic.governorReason = 'persistence-error';
      diagnostic.result = 'governor-persistence-error';
      diagnostic.durationMs = Date.now() - startedAt;
      return { candidates: [], request: diagnostic, sectionDecisions: [] };
    }
  }
  if (signal?.aborted) {
    if (receiptId && governor) await governor.releaseUndispatched(receiptId).catch(() => undefined);
    diagnostic.result = 'aborted';
    diagnostic.durationMs = Date.now() - startedAt;
    return { candidates: [], request: diagnostic, sectionDecisions: [] };
  }
  const abort = linkedAbortController(signal, timeoutMs);
  let completionResult: 'ok' | 'http' | 'timeout' | 'aborted' | 'network-error' | 'disused' = 'network-error';
  let completionRetryAfterMs: number | null = null;
  try {
    diagnostic.invoked = true;
    const response = await requestFetch(url, { signal: abort.controller.signal });
    diagnostic.httpStatus = response.status;
    completionRetryAfterMs = retryAfterMs(response);
    const headerBytes = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(headerBytes)) diagnostic.responseBytes = Math.max(0, headerBytes);
    if (!response.ok) {
      diagnostic.result = `http-${response.status}`;
      completionResult = 'http';
      return { candidates: [], request: diagnostic, sectionDecisions: [] };
    }
    const body = await response.json() as {
      code?: string;
      tracepoints?: Array<MapboxTracepoint | null>;
      matchings?: Array<{
        confidence?: number;
        geometry?: { coordinates?: Array<[number, number]> };
      }>;
    };
    if (diagnostic.responseBytes === 0) {
      try { diagnostic.responseBytes = new TextEncoder().encode(JSON.stringify(body)).length; } catch { /* diagnostic only */ }
    }
    diagnostic.responseCode = body.code ?? 'missing-code';
    diagnostic.matchingCount = body.matchings?.length ?? 0;
    diagnostic.tracepointCount = body.tracepoints?.length ?? 0;
    diagnostic.nullTracepointCount = body.tracepoints?.filter(point => point == null).length ?? 0;
    if (body.code !== 'Ok' || !body.matchings?.length || body.tracepoints?.length !== chunk.length) {
      diagnostic.result = body.code ?? 'unusable-response';
      completionResult = 'disused';
      return { candidates: [], request: diagnostic, sectionDecisions: [] };
    }
    const candidates: NetworkCandidate[] = [];
    const directionsHints: DirectionsAuthority[] = [];
    const sectionDecisions: PedestrianFinalSectionDecision[] = [];
    for (const [matchingIndex, matching] of body.matchings.entries()) {
      const fullGeometry = (matching.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lng, lat }));
      if (fullGeometry.length < 2) continue;
      const runs = deriveSnapSectionRuns(chunk, body.tracepoints, matchingIndex);
      for (const section of runs) {
        const indices = section.submittedIndices;
        const headIndex = section.submittedStart;
        const tailIndex = section.submittedEnd;
        const tracepoints = indices.map(index => body.tracepoints?.[index]).filter(Boolean) as MapboxTracepoint[];
        const knownAlternatives = tracepoints.flatMap(point => (
          point.alternatives_count == null ? [] : [point.alternatives_count]
        ));
        const alternativesKnownFraction = knownAlternatives.length / Math.max(1, tracepoints.length);
        const unambiguousFraction = knownAlternatives.length > 0
          ? knownAlternatives.filter(value => value === 0).length / knownAlternatives.length
          : 0;
        const baseDecision: PedestrianFinalSectionDecision = {
          requestId,
          requestKind: 'map-matching',
          sourceStart: section.sourceStart,
          sourceEnd: section.sourceEnd,
          tracepointSupportCount: tracepoints.length,
          expectedTracepointCount: tailIndex - headIndex + 1,
          classification: section.classification,
          result: 'rejected',
          reasonCode: section.reasonCode,
          providerConfidence: matching.confidence ?? 0,
          localShapeScore: null,
          alternativesKnownFraction,
          unambiguousFraction,
          candidateSource: 'map-matching',
          notes: [],
        };
        if (section.classification !== 'SNAP_ELIGIBLE') {
          diagnostic.rejectedCandidateCount += 1;
          sectionDecisions.push(baseDecision);
          continue;
        }
        const cropped = cropGeometryToTracepoints(
          fullGeometry,
          tracepoints.flatMap(tracepoint => tracepoint.location ? [tracepoint.location] : []),
        );
        if (!cropped) {
          diagnostic.rejectedCandidateCount += 1;
          sectionDecisions.push({
            ...baseDecision,
            reasonCode: 'LOCAL_TRACEPOINT_SUPPORT_INSUFFICIENT',
            notes: ['response geometry could not be cropped monotonically to supported tracepoints'],
          });
          continue;
        }
        const rawSubsection = canonical.slice(section.sourceStart, section.sourceEnd + 1);
        const matchingEvidence = evaluateCorridorEvidence({
          canonical: rawSubsection,
          network: cropped,
          mapboxConfidence: matching.confidence ?? 0,
          supportCount: indices.length,
          expectedSupportCount: tailIndex - headIndex + 1,
          alternatives: tracepoints.map(point => point.alternatives_count ?? null),
          routeAlternativeCount: Math.max(0, ...tracepoints.map(point => point.alternatives_count ?? 0)),
        });
        // Directions may only refine a corridor already identified by real
        // Matching tracepoint evidence. It cannot manufacture confidence or
        // full-sequence support from two routed endpoints.
        if ((matching.confidence ?? 0) >= 0.72
          && matchingEvidence.tracepointCoverage >= 0.76
          && matchingEvidence.ambiguityKnownFraction >= 0.7
          && matchingEvidence.unambiguousFraction >= 0.8
          && matchingEvidence.corridorIdentityScore >= 0.72) {
          directionsHints.push({
            sourceStart: section.sourceStart,
            sourceEnd: section.sourceEnd,
            supportCount: indices.length,
            expectedSupportCount: tailIndex - headIndex + 1,
            alternatives: tracepoints.map(point => point.alternatives_count ?? null),
            names: tracepoints.map(point => point.name ?? null),
            mapboxConfidence: matching.confidence ?? 0,
            matchingGeometry: cropped,
            matchingEvidence,
          });
        }
        const candidateDiagnostics: string[] = [];
        const candidate = buildNetworkCandidate({
          canonical,
          sourceStart: section.sourceStart,
          sourceEnd: section.sourceEnd,
          networkPoints: cropped,
          confidence: matching.confidence ?? 0,
          supportCount: indices.length,
          expectedSupportCount: tailIndex - headIndex + 1,
          alternatives: tracepoints.map(point => point.alternatives_count ?? null),
          names: tracepoints.map(point => point.name ?? null),
          source: 'map-matching',
          requestId: `${requestId}:matching-${matchingIndex}`,
          providerResponsePoints: fullGeometry,
          qualityTrace,
          // Matchings are disjoint sub-traces, not route alternatives. Real
          // ambiguity is reported per tracepoint by alternatives_count.
          routeAlternativeCount: Math.max(0, ...tracepoints.map(point => point.alternatives_count ?? 0)),
          diagnosticNotes: candidateDiagnostics,
        });
        if (candidate) {
          candidates.push(candidate);
          diagnostic.acceptedCandidateCount += 1;
          sectionDecisions.push({
            ...baseDecision,
            result: 'accepted',
            reasonCode: 'TRACEPOINT_SUPPORTED',
            localShapeScore: candidate.evidence.score,
            notes: [candidate.reason],
          });
        } else {
          diagnostic.rejectedCandidateCount += 1;
          const endpoint = analyzeTrustedEndpointCoverage(rawSubsection, cropped);
          const quality = evaluateMatchedGeometryQuality(rawSubsection, cropped);
          const topology = evaluateTopologyQuality(rawSubsection, cropped);
          const seam = evaluateIslandSeamQuality(canonical, section.sourceStart, section.sourceEnd, cropped);
          const reasonCode: SnapSectionReasonCode = !endpoint.eligibleForAnchoring
            ? 'LOCAL_ENDPOINT_SUPPORT_WEAK'
            : !matchingEvidence.accepted
              ? quality.reason === 'raw_deviation' || quality.reason === 'max_raw_deviation'
                ? 'LOCAL_TRUTH_ENVELOPE_EXCEEDED'
                : 'LOCAL_CORRIDOR_STRUCTURE_MISMATCH'
              : !seam.accepted
                ? 'LOCAL_SEAM_UNSAFE'
                : 'LOCAL_NO_MEANINGFUL_IMPROVEMENT';
          sectionDecisions.push({
            ...baseDecision,
            reasonCode,
            localShapeScore: matchingEvidence.score,
            notes: [
              `corridor:${matchingEvidence.reason}`,
              `evidence:confidence=${matchingEvidence.mapboxConfidence.toFixed(3)};coverage=${matchingEvidence.tracepointCoverage.toFixed(3)};score=${matchingEvidence.score.toFixed(3)};identity=${matchingEvidence.corridorIdentityScore.toFixed(3)};bearingDelta=${matchingEvidence.bearingDeltaDeg.toFixed(1)};lengthRatio=${matchingEvidence.lengthRatio.toFixed(3)};endpointDeviation=${matchingEvidence.endpointDeviationM.toFixed(1)};ambiguityKnown=${matchingEvidence.ambiguityKnownFraction.toFixed(3)};unambiguous=${matchingEvidence.unambiguousFraction.toFixed(3)};lateralMad=${matchingEvidence.lateral.madM.toFixed(1)}`,
              `quality:${quality.reason}`,
              `topology:${topology.reason}`,
              `seam:${seam.reason}`,
              ...candidateDiagnostics,
            ],
          });
        }
      }
    }
    diagnostic.result = candidates.length > 0 ? 'accepted-candidate' : 'no-safe-candidate';
    completionResult = candidates.length > 0 ? 'ok' : 'disused';
    return { candidates, request: diagnostic, directionsHints, sectionDecisions };
  } catch (error: any) {
    diagnostic.result = error?.name === 'AbortError' ? 'timeout-or-abort' : 'network-error';
    completionResult = error?.name === 'AbortError'
      ? signal?.aborted ? 'aborted' : 'timeout'
      : 'network-error';
    return { candidates: [], request: diagnostic, sectionDecisions: [] };
  } finally {
    diagnostic.durationMs = Date.now() - startedAt;
    abort.dispose();
    if (receiptId && governor) {
      await governor.complete({
        receiptId,
        result: completionResult,
        httpStatus: diagnostic.httpStatus,
        bytes: diagnostic.responseBytes,
        durationMs: diagnostic.durationMs,
        retryAfterMs: completionRetryAfterMs,
      }).catch(() => undefined);
    }
  }
}

function compactMatcherEvidence(points: MatcherSubmittedPoint[]): MatcherSubmittedPoint[] {
  if (points.length <= 2) return points.slice();
  const compacted: MatcherSubmittedPoint[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const previous = compacted[compacted.length - 1];
    const mandatory = point.mandatoryReasons.length > 0;
    const movedM = hav(previous, point);
    const elapsedMs = point.t != null && previous.t != null
      ? Number(point.t) - Number(previous.t)
      : Infinity;
    // Dense stationary observations add URL/budget cost without corridor
    // information. Preserve structural anchors, material movement, and a
    // 12-second temporal witness while never fabricating timestamps.
    if (mandatory || movedM >= 3 || elapsedMs >= 12_000) compacted.push(point);
  }
  compacted.push(points[points.length - 1]);
  return compacted;
}

function coverageFairWindowOrder(windows: MatchingWindowPlan[]): MatchingWindowPlan[] {
  if (windows.length <= 2) return windows;
  const remaining = windows.map((_window, index) => index);
  const selected: number[] = [];
  while (remaining.length > 0) {
    let chosenOffset = 0;
    let chosenScore = -Infinity;
    for (let offset = 0; offset < remaining.length; offset += 1) {
      const index = remaining[offset];
      const centre = (windows[index].points[0].sourceIndex
        + windows[index].points[windows[index].points.length - 1].sourceIndex) / 2;
      const distance = selected.length === 0
        ? -index // deterministic start endpoint first
        : Math.min(...selected.map(selectedIndex => {
            const selectedCentre = (windows[selectedIndex].points[0].sourceIndex
              + windows[selectedIndex].points[windows[selectedIndex].points.length - 1].sourceIndex) / 2;
            return Math.abs(centre - selectedCentre);
          }));
      if (distance > chosenScore) {
        chosenScore = distance;
        chosenOffset = offset;
      }
    }
    selected.push(remaining.splice(chosenOffset, 1)[0]);
  }
  return selected.map(index => windows[index]);
}

export function matchingWindows(points: MatcherSubmittedPoint[]): MatchingWindowPlan[] {
  const prepared = compactMatcherEvidence(points);
  if (prepared.length <= MATCHING_WINDOW_SIZE) {
    return prepared.length >= 2 ? [{
      requestId: `matching:${prepared[0].sourceIndex}-${prepared[prepared.length - 1].sourceIndex}`,
      points: prepared,
    }] : [];
  }
  const overlap = Math.min(MATCHING_WINDOW_OVERLAP, MATCHING_WINDOW_SIZE - 2);
  const windows: MatchingWindowPlan[] = [];
  for (let start = 0; start < prepared.length - 1; start += MATCHING_WINDOW_SIZE - overlap) {
    const chunk = prepared.slice(start, Math.min(prepared.length, start + MATCHING_WINDOW_SIZE));
    if (chunk.length >= 2) windows.push({
      requestId: `matching:${chunk[0].sourceIndex}-${chunk[chunk.length - 1].sourceIndex}`,
      points: chunk,
    });
    if (start + MATCHING_WINDOW_SIZE >= prepared.length) break;
  }
  // Persisted request ceilings can be smaller than the complete plan. Order
  // windows for useful Activity-wide opportunity rather than consuming every
  // permit at the beginning of a dense trace.
  return coverageFairWindowOrder(windows).slice(0, MAX_MATCHING_REQUESTS);
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<WindowResult>,
  signal?: AbortSignal,
): Promise<WindowResult[]> {
  const results: WindowResult[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length && !signal?.aborted) {
      const index = cursor;
      cursor += 1;
      if (signal?.aborted) break;
      results[index] = await task(items[index]);
    }
  };
  const workers = Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  if (signal) {
    await Promise.race([
      workers,
      new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true } as any);
      }),
    ]);
  } else {
    await workers;
  }
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
  sectionDecision: PedestrianFinalSectionDecision;
}

function directionsRoutesEquivalent(routes: SnappedPoint[][]): boolean {
  if (routes.length <= 1) return true;
  const reference = routes[0];
  return routes.slice(1).every(route => {
    const leftP95 = percentile(
      reference.map(point => projectPointToPath(point, route).distanceM),
      0.95,
    );
    const rightP95 = percentile(
      route.map(point => projectPointToPath(point, reference).distanceM),
      0.95,
    );
    const referenceLengthM = pathLength(reference);
    const lengthRatio = referenceLengthM > 0 ? pathLength(route) / referenceLengthM : 1;
    return leftP95 <= 5 && rightP95 <= 5 && lengthRatio >= 0.92 && lengthRatio <= 1.08;
  });
}

async function walkingDirectionsCandidate(
  canonical: RawPoint[],
  authority: DirectionsAuthority,
  token: string,
  timeoutMs: number,
  signal?: AbortSignal,
  governor?: ActivityMapboxRequestGovernor,
  phase: Extract<ActivityMapboxPhase, 'live' | 'final'> = 'final',
  reason = 'qualified-unresolved-directions-span',
  requestFetch: typeof fetch = fetch,
  qualityTrace = false,
): Promise<DirectionsResult> {
  const sourceStart = authority.sourceStart;
  const sourceEnd = authority.sourceEnd;
  const requestId = `directions:${sourceStart}-${sourceEnd}`;
  const startedAt = Date.now();
  const subsection = canonical.slice(sourceStart, sourceEnd + 1);
  const request: PedestrianFinalRequestResult = {
    requestId,
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
    invoked: false,
    governorReason: null,
    responseBytes: 0,
  };
  const baseDecision: PedestrianFinalSectionDecision = {
    requestId,
    requestKind: 'walking-directions',
    sourceStart,
    sourceEnd,
    tracepointSupportCount: authority.supportCount,
    expectedTracepointCount: authority.expectedSupportCount,
    classification: 'SNAP_ELIGIBLE',
    result: 'rejected',
    reasonCode: 'LOCAL_DIRECTIONS_WITHOUT_MATCHING_AUTHORITY',
    providerConfidence: authority.mapboxConfidence,
    localShapeScore: null,
    alternativesKnownFraction: authority.matchingEvidence.ambiguityKnownFraction,
    unambiguousFraction: authority.matchingEvidence.unambiguousFraction,
    candidateSource: 'walking-directions',
    notes: [
      'Directions has no Map Matching confidence or tracepoints; authority comes from the exact supported Matching section.',
    ],
  };
  if (!token || subsection.length < 2) {
    request.result = !token ? 'no-token' : 'too-short';
    return { candidate: null, request, sectionDecision: baseDecision };
  }
  if (signal?.aborted) {
    request.result = 'aborted';
    return { candidate: null, request, sectionDecision: baseDecision };
  }
  const start = subsection[0];
  const end = subsection[subsection.length - 1];
  const coords = `${start.lng.toFixed(6)},${start.lat.toFixed(6)};${end.lng.toFixed(6)},${end.lat.toFixed(6)}`;
  const url = `${MAPBOX_DIRECTIONS_ENDPOINT}/${coords}?alternatives=true&geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(token)}`;
  let receiptId: string | null = null;
  if (governor) {
    try {
      const permit = await governor.authorize({
        phase,
        kind: 'walking-directions',
        fingerprint: requestFingerprint('directions', `${sourceStart}:${sourceEnd}:${coords}`),
        reason,
      });
      request.governorReason = permit.reason;
      if (!permit.allowed || !permit.receiptId) {
        request.result = `governor-${permit.reason}`;
        request.durationMs = Date.now() - startedAt;
        return { candidate: null, request, sectionDecision: baseDecision };
      }
      receiptId = permit.receiptId;
    } catch {
      request.governorReason = 'persistence-error';
      request.result = 'governor-persistence-error';
      request.durationMs = Date.now() - startedAt;
      return { candidate: null, request, sectionDecision: baseDecision };
    }
  }
  if (signal?.aborted) {
    if (receiptId && governor) await governor.releaseUndispatched(receiptId).catch(() => undefined);
    request.result = 'aborted';
    request.durationMs = Date.now() - startedAt;
    return { candidate: null, request, sectionDecision: baseDecision };
  }
  const abort = linkedAbortController(signal, timeoutMs);
  let completionResult: 'ok' | 'http' | 'timeout' | 'aborted' | 'network-error' | 'disused' = 'network-error';
  let completionRetryAfterMs: number | null = null;
  try {
    request.invoked = true;
    const response = await requestFetch(url, { signal: abort.controller.signal });
    request.httpStatus = response.status;
    completionRetryAfterMs = retryAfterMs(response);
    const headerBytes = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(headerBytes)) request.responseBytes = Math.max(0, headerBytes);
    if (!response.ok) {
      request.result = `http-${response.status}`;
      completionResult = 'http';
      return { candidate: null, request, sectionDecision: baseDecision };
    }
    const body = await response.json() as {
      code?: string;
      routes?: Array<{
        geometry?: { coordinates?: Array<[number, number]> };
        legs?: Array<{ steps?: Array<{ name?: string }> }>;
      }>;
    };
    if (request.responseBytes === 0) {
      try { request.responseBytes = new TextEncoder().encode(JSON.stringify(body)).length; } catch { /* diagnostic only */ }
    }
    request.responseCode = body.code ?? 'missing-code';
    request.matchingCount = body.routes?.length ?? 0;
    if (body.code !== 'Ok' || !body.routes?.length) {
      request.result = body.code ?? 'no-route';
      completionResult = 'disused';
      return { candidate: null, request, sectionDecision: baseDecision };
    }
    const routeGeometries = body.routes.map(route => (
      (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lng, lat }))
    )).filter(route => route.length >= 2);
    if (!directionsRoutesEquivalent(routeGeometries)) {
      request.rejectedCandidateCount = routeGeometries.length;
      request.result = 'ambiguous-routes';
      completionResult = 'disused';
      return {
        candidate: null,
        request,
        sectionDecision: {
          ...baseDecision,
          classification: 'AMBIGUOUS',
          reasonCode: 'LOCAL_DIRECTIONS_COMPETING_ROUTES',
          notes: [...baseDecision.notes, `${routeGeometries.length} materially distinct Directions routes returned`],
        },
      };
    }
    const candidates: NetworkCandidate[] = [];
    const localScores = new Map<NetworkCandidate, number>();
    for (const route of body.routes) {
      const geometry = (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lng, lat }));
      if (geometry.length < 2) continue;
      const quality = evaluateMatchedGeometryQuality(subsection, geometry);
      // Diagnostic shape agreement remains separate from provider authority.
      // It is never represented as Map Matching confidence or tracepoint
      // support merely because endpoint routing returned HTTP 200.
      const localShapeScore = clamp(
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
        confidence: authority.mapboxConfidence,
        supportCount: authority.supportCount,
        expectedSupportCount: authority.expectedSupportCount,
        alternatives: authority.alternatives,
        names: [...authority.names, ...names],
        source: 'walking-directions',
        requestId,
        providerResponsePoints: geometry,
        qualityTrace,
        routeAlternativeCount: 0,
      });
      if (candidate) {
        candidates.push(candidate);
        localScores.set(candidate, localShapeScore);
      }
    }
    const candidate = candidates.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
    request.acceptedCandidateCount = candidate ? 1 : 0;
    request.rejectedCandidateCount = Math.max(0, body.routes.length - (candidate ? 1 : 0));
    request.result = candidate ? 'accepted-candidate' : 'no-safe-candidate';
    completionResult = candidate ? 'ok' : 'disused';
    return {
      candidate,
      request,
      sectionDecision: candidate ? {
        ...baseDecision,
        result: 'accepted',
        reasonCode: 'TRACEPOINT_SUPPORTED',
        localShapeScore: localScores.get(candidate) ?? null,
        notes: [...baseDecision.notes, candidate.reason],
      } : {
        ...baseDecision,
        reasonCode: 'LOCAL_TRUTH_ENVELOPE_EXCEEDED',
        notes: [...baseDecision.notes, 'Directions geometry failed unchanged endpoint, corridor, topology, truth-envelope, or seam gates.'],
      },
    };
  } catch (error: any) {
    request.result = error?.name === 'AbortError' ? 'timeout-or-abort' : 'network-error';
    completionResult = error?.name === 'AbortError'
      ? signal?.aborted ? 'aborted' : 'timeout'
      : 'network-error';
    return { candidate: null, request, sectionDecision: baseDecision };
  } finally {
    request.durationMs = Date.now() - startedAt;
    abort.dispose();
    if (receiptId && governor) {
      await governor.complete({
        receiptId,
        result: completionResult,
        httpStatus: request.httpStatus,
        bytes: request.responseBytes,
        durationMs: request.durationMs,
        retryAfterMs: completionRetryAfterMs,
      }).catch(() => undefined);
    }
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
    promotionUtility: candidate.promotionUtility,
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
        : 'no-safe-network-candidate;uncertainty-aware-base-final',
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
      promotionUtility: null,
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

function wholeRouteViolationScore(validation: WholeRouteValidation): number {
  if (validation.accepted) return 0;
  if (validation.reason === 'endpoint_change') return 1_000_000;
  if (validation.reason === 'duplicate_edge') return 100_000;
  if (validation.reason === 'edge_spike') {
    const allowed = Math.max(30, validation.maximumCanonicalEdgeM * 4);
    return 10_000 + validation.maximumFinalEdgeM / Math.max(1, allowed);
  }
  return 1_000 + Math.abs(Math.log(Math.max(0.001, validation.lengthRatio)));
}

/**
 * Final assembly safety is Activity-wide, but its fallback scope is local.
 * When otherwise valid islands interact badly at their final joins, remove
 * only the smallest candidate set needed to restore a valid complete route.
 * This prevents one unsafe window from reverting unrelated matched islands.
 */
function retainAssemblySafeCandidates(
  canonical: RawPoint[],
  candidates: NetworkCandidate[],
): {
  selected: NetworkCandidate[];
  removed: NetworkCandidate[];
  assembled: ReturnType<typeof assembleFinal>;
  initialValidation: WholeRouteValidation;
  validation: WholeRouteValidation;
} {
  let selected = candidates.slice();
  const removed: NetworkCandidate[] = [];
  let assembled = assembleFinal(canonical, selected);
  let validation = evaluateWholeRouteQuality(canonical, assembled.points);
  const initialValidation = validation;
  while (!validation.accepted && selected.length > 0) {
    const trials = selected.map((candidate, index) => {
      const retained = selected.filter((_item, itemIndex) => itemIndex !== index);
      const nextAssembled = assembleFinal(canonical, retained);
      const nextValidation = evaluateWholeRouteQuality(canonical, nextAssembled.points);
      const retainedCoverageM = retained.reduce((sum, item) => sum + item.quality.rawLengthM, 0);
      return { candidate, retained, nextAssembled, nextValidation, retainedCoverageM };
    }).sort((left, right) => {
      if (left.nextValidation.accepted !== right.nextValidation.accepted) {
        return left.nextValidation.accepted ? -1 : 1;
      }
      const penalty = wholeRouteViolationScore(left.nextValidation)
        - wholeRouteViolationScore(right.nextValidation);
      if (Math.abs(penalty) > 1e-9) return penalty;
      if (left.retainedCoverageM !== right.retainedCoverageM) {
        return right.retainedCoverageM - left.retainedCoverageM;
      }
      return left.candidate.confidence - right.candidate.confidence;
    });
    const best = trials[0];
    if (!best) break;
    removed.push(best.candidate);
    selected = best.retained;
    assembled = best.nextAssembled;
    validation = best.nextValidation;
  }
  return { selected, removed, assembled, initialValidation, validation };
}

function emptyStats(canonical: RawPoint[], durationMs = 0): PedestrianFinalStats {
  const canonicalGeometry = canonical.map(canonicalPoint);
  const baseFinalDiagnostics = buildBaseFinalGeometry(canonical).diagnostics;
  return {
    algorithmVersion: 'pedestrian-final-v2-base',
    canonicalPointCount: canonical.length,
    resampledPointCount: 0,
    mapMatchingRequestCount: 0,
    directionsRequestCount: 0,
    requestResults: [],
    sectionDecisions: [],
    matchedIslandCount: 0,
    directionsIslandCount: 0,
    canonicalDerivedSectionCount: 0,
    freeTraversalSectionCount: 0,
    roadOffsetSectionCount: 0,
    pedestrianNetworkSectionCount: 0,
    weakSameCorridorSectionCount: 0,
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
    baseFinalDiagnostics,
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
    plan => mapMatchingWindow(
      plan.requestId,
      plan.points,
      canonical,
      options.mapboxToken,
      options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS,
      totalAbort.controller.signal,
      options.requestGovernor,
      options.requestPhase ?? 'final',
      options.requestReason ?? 'qualified-unresolved-window',
      options.fetchImpl,
      options.qualityTrace ?? false,
    ),
    totalAbort.controller.signal,
  );
  const completedMatchingResults = matchingResults.filter((result): result is WindowResult => Boolean(result));
  const matchingCandidates = completedMatchingResults.flatMap(result => result.candidates);
  const allCandidates = matchingCandidates.slice();
  annotateWindowAgreement(matchingCandidates);
  let selected = selectNonOverlappingCandidates(matchingCandidates);
  const requestResults = completedMatchingResults.map(result => result.request);
  const sectionDecisions = completedMatchingResults.flatMap(result => result.sectionDecisions);

  if (options.directionsFallback !== false && options.mapboxToken && !totalAbort.controller.signal.aborted) {
    const supportedHints = completedMatchingResults.flatMap(result => result.directionsHints ?? [])
      .filter(authority => {
        const distanceM = pathLength(canonical.slice(authority.sourceStart, authority.sourceEnd + 1));
        const alreadyOwned = selected.some(candidate => (
          authority.sourceStart >= candidate.sourceStart && authority.sourceEnd <= candidate.sourceEnd
        ));
        return !alreadyOwned
          && distanceM >= MIN_DIRECTIONS_SPAN_M
          && distanceM <= MAX_DIRECTIONS_SPAN_M * 1.2;
      })
      // Observed tail/head corridors get first bounded fallback opportunity:
      // endpoint safety is stronger there and completion must not starve them.
      .sort((left, right) => right.sourceEnd - left.sourceEnd);
    const seenSpans = new Set<string>();
    const directionAuthorities = supportedHints
      .filter(authority => {
        const key = `${authority.sourceStart}:${authority.sourceEnd}`;
        if (seenSpans.has(key)) return false;
        seenSpans.add(key);
        return true;
      })
      .slice(0, options.maxDirectionsRequests ?? MAX_DIRECTIONS_REQUESTS);
    for (const authority of directionAuthorities) {
      if (totalAbort.controller.signal.aborted) break;
      const directionPromise = walkingDirectionsCandidate(
        canonical,
        authority,
        options.mapboxToken,
        options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS,
        totalAbort.controller.signal,
        options.requestGovernor,
        options.requestPhase ?? 'final',
        options.requestReason ?? 'qualified-unresolved-directions-span',
        options.fetchImpl,
        options.qualityTrace ?? false,
      );
      const direction = await Promise.race([
        directionPromise,
        new Promise<DirectionsResult | null>(resolve => {
          if (totalAbort.controller.signal.aborted) resolve(null);
          else totalAbort.controller.signal.addEventListener('abort', () => resolve(null), { once: true } as any);
        }),
      ]);
      if (!direction) break;
      requestResults.push(direction.request);
      sectionDecisions.push(direction.sectionDecision);
      if (direction.candidate) {
        allCandidates.push(direction.candidate);
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
  const intervalSelected = new Set(selected);
  const assemblySafety = retainAssemblySafeCandidates(canonical, selected);
  let assembled = assemblySafety.assembled;
  let wholeRouteValidation = assemblySafety.validation;
  const preFallbackWholeRouteValidation = assemblySafety.initialValidation;
  if (assemblySafety.removed.length > 0) {
    const removed = new Set(assemblySafety.removed);
    selected = assemblySafety.selected;
    for (let index = 0; index < sectionDecisions.length; index += 1) {
      const decision = sectionDecisions[index];
      const candidate = assemblySafety.removed.find(item => (
        item.sourceStart === decision.sourceStart
        && item.sourceEnd === decision.sourceEnd
        && item.source === decision.candidateSource
      ));
      if (candidate && removed.has(candidate) && decision.result === 'accepted') {
        sectionDecisions[index] = {
          ...decision,
          result: 'rejected',
          reasonCode: 'LOCAL_ASSEMBLY_UNSAFE',
          notes: [...decision.notes, `whole-route:${preFallbackWholeRouteValidation.reason};island removed while unrelated safe islands were retained`],
        };
      }
    }
  }
  if (!wholeRouteValidation.accepted) {
    assembled = {
      points: canonical.map(canonicalPoint),
      sections: [fallbackSection(canonical, 0, canonical.length - 1, false).section],
    };
    wholeRouteValidation = evaluateWholeRouteQuality(canonical, assembled.points);
  }
  const mapRequests = requestResults.filter(result => result.kind === 'map-matching' && result.invoked);
  const directionRequests = requestResults.filter(result => result.kind === 'walking-directions' && result.invoked);
  const canonicalFallbackDistanceM = assembled.sections
    .filter(section => section.decision === 'canonical-derived')
    .reduce((sum, section) => sum + section.canonicalDistanceM, 0);
  const acceptedMatchedDistanceM = assembled.sections
    .filter(section => section.decision === 'refined')
    .reduce((sum, section) => sum + section.canonicalDistanceM, 0);
  const baseFinalDiagnostics = buildBaseFinalGeometry(canonical).diagnostics;
  const assemblyRetained = new Set(selected);
  const stats: PedestrianFinalStats = {
    algorithmVersion: 'pedestrian-final-v2-base',
    canonicalPointCount: canonical.length,
    resampledPointCount: submitted.length,
    mapMatchingRequestCount: mapRequests.length,
    directionsRequestCount: directionRequests.length,
    requestResults,
    sectionDecisions,
    matchedIslandCount: assembled.sections.filter(section => section.networkSource === 'map-matching').length,
    directionsIslandCount: assembled.sections.filter(section => section.networkSource === 'walking-directions').length,
    canonicalDerivedSectionCount: assembled.sections.filter(section => section.decision === 'canonical-derived').length,
    freeTraversalSectionCount: assembled.sections.filter(section => section.state === 'FREE_TRAVERSAL').length,
    roadOffsetSectionCount: assembled.sections.filter(section => section.geometryMode === 'B_ROAD_OFFSET').length,
    pedestrianNetworkSectionCount: assembled.sections.filter(section => section.geometryMode === 'A_PEDESTRIAN_NETWORK').length,
    weakSameCorridorSectionCount: assembled.sections.filter(section => section.geometryMode === 'D_WEAK_SAME_CORRIDOR').length,
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
    baseFinalDiagnostics,
    ...(options.qualityTrace ? {
      candidateTransformationTraces: allCandidates.flatMap(candidate => candidate.trace ? [{
        ...candidate.trace,
        selectedByIntervalScheduler: intervalSelected.has(candidate),
        retainedByAssemblySafety: assemblyRetained.has(candidate),
      }] : []),
    } : {}),
  };
  return { ok: true, points: assembled.points, stats };
}
