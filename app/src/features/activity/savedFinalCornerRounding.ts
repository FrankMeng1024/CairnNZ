import type { TrackPoint } from '../../store/useSessionStore';
import {
  evaluateTopologyQuality,
  evaluateWholeRouteQuality,
} from '../../services/routing/snapTrack';
import { applyAdaptiveRouteVisualGeometry } from './adaptiveRouteVisualGeometry';

const EARTH_RADIUS_M = 6_371_000;

interface XY { x: number; y: number }

export interface SavedFinalCornerRoundingDiagnostics {
  consideredCorners: number;
  roundedCorners: number;
  skippedShortArm: number;
  skippedTurnShape: number;
  skippedTopologyGuard: number;
  skippedOverlapGuard: number;
  skippedProvenanceGuard: number;
  maximumTangentM: number;
  roundedCornerIndices: number[];
  maximumCorridorDeviationM: number;
  maximumAllowedCorridorDeviationM: number;
  postRoundRejected: boolean;
  postRoundRejectReason: string | null;
}

function project(point: Pick<TrackPoint, 'lat' | 'lng'>, originLat: number): XY {
  const radians = Math.PI / 180;
  return {
    x: EARTH_RADIUS_M * point.lng * radians * Math.cos(originLat * radians),
    y: EARTH_RADIUS_M * point.lat * radians,
  };
}

const distance = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

function pointToSegmentDistance(point: XY, start: XY, end: XY): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return distance(point, start);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function orientation(a: XY, b: XY, c: XY): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function strictSegmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const epsilon = 1e-7;
  return Math.abs(abC) > epsilon && Math.abs(abD) > epsilon
    && Math.abs(cdA) > epsilon && Math.abs(cdB) > epsilon
    && Math.sign(abC) !== Math.sign(abD)
    && Math.sign(cdA) !== Math.sign(cdB);
}

function nonAdjacentIntersectionCount(points: XY[]): number {
  let count = 0;
  for (let left = 0; left < points.length - 1; left += 1) {
    for (let right = left + 2; right < points.length - 1; right += 1) {
      if (right === left + 1) continue;
      if (strictSegmentsIntersect(points[left], points[left + 1], points[right], points[right + 1])) {
        count += 1;
      }
    }
  }
  return count;
}

function maximumDistanceFromSourceCorridor(candidate: XY[], source: XY[]): number {
  return candidate.reduce((maximum, point) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (let edge = 0; edge < source.length - 1; edge += 1) {
      nearest = Math.min(nearest, pointToSegmentDistance(point, source[edge], source[edge + 1]));
    }
    return Math.max(maximum, nearest);
  }, 0);
}

/**
 * Applies a tightly bounded quadratic fillet to an already accepted display
 * segment. Endpoints, segment identity, canonical GPS, stats and Memory are
 * outside this display-only transform. Hairpins, short arms and crossings are
 * intentionally retained verbatim, and whole-route gates can reject every
 * proposed curve together.
 */
export function roundSavedFinalRoadCorners(
  points: TrackPoint[],
  options: { eligibleCorners?: ReadonlyArray<boolean> } = {},
): {
  points: TrackPoint[];
  diagnostics: SavedFinalCornerRoundingDiagnostics;
} {
  const diagnostics: SavedFinalCornerRoundingDiagnostics = {
    consideredCorners: Math.max(0, points.length - 2),
    roundedCorners: 0,
    skippedShortArm: 0,
    skippedTurnShape: 0,
    skippedTopologyGuard: 0,
    skippedOverlapGuard: 0,
    skippedProvenanceGuard: 0,
    maximumTangentM: 0,
    roundedCornerIndices: [],
    maximumCorridorDeviationM: 0,
    maximumAllowedCorridorDeviationM: 0.8,
    postRoundRejected: false,
    postRoundRejectReason: null,
  };
  if (points.length < 3) return { points: points.map(point => ({ ...point })), diagnostics };
  const originLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const planar = points.map(point => project(point, originLat));
  const adaptive = applyAdaptiveRouteVisualGeometry(points, {
    eligibleCorners: options.eligibleCorners,
    armMode: 'trace',
    selectionMode: 'sharpest',
  });
  const output = adaptive.points;
  Object.assign(diagnostics, adaptive.diagnostics);
  if (diagnostics.roundedCorners > 0) {
    const roundedPlanar = output.map(point => project(point, originLat));
    const wholeRoute = evaluateWholeRouteQuality(points, output);
    const topology = evaluateTopologyQuality(points, output);
    const timestampsMonotonic = output.every((point, index) => (
      index === 0 || point.t > output[index - 1].t
    ));
    const segmentIdentityPreserved = output.every(point => (
      point.segmentId === points[0].segmentId
    ));
    const sourceIntersections = nonAdjacentIntersectionCount(planar);
    const roundedIntersections = nonAdjacentIntersectionCount(roundedPlanar);
    const maximumCorridorDeviationM = maximumDistanceFromSourceCorridor(roundedPlanar, planar);
    // A quadratic fillet departs from the original two-edge centreline by
    // roughly 0.293 of its tangent at a right angle. Scale the display-only
    // allowance with that actual treatment, while retaining a hard pedestrian
    // corridor cap. Canonical quality and topology gates still run below.
    const maximumAllowedCorridorDeviationM = Math.min(
      1.6,
      Math.max(0.8, diagnostics.maximumTangentM * 0.3),
    );
    diagnostics.maximumCorridorDeviationM = maximumCorridorDeviationM;
    diagnostics.maximumAllowedCorridorDeviationM = maximumAllowedCorridorDeviationM;
    const rejectReason = !wholeRoute.accepted
      ? `whole-route:${wholeRoute.reason}`
      : !topology.accepted
        ? `topology:${topology.reason}`
        : !timestampsMonotonic
          ? 'timestamp-order'
          : !segmentIdentityPreserved
            ? 'segment-identity'
            : roundedIntersections > sourceIntersections
              ? 'new-non-adjacent-intersection'
              : maximumCorridorDeviationM > maximumAllowedCorridorDeviationM
                ? 'source-corridor-exceeded'
                : null;
    if (rejectReason) {
      diagnostics.postRoundRejected = true;
      diagnostics.postRoundRejectReason = rejectReason;
      diagnostics.roundedCorners = 0;
      return { points: points.map(point => ({ ...point })), diagnostics };
    }
  }
  return { points: output, diagnostics };
}
