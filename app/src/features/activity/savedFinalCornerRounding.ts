import type { TrackPoint } from '../../store/useSessionStore';

const EARTH_RADIUS_M = 6_371_000;
const MIN_ARM_M = 5;
const MAX_ARM_M = 45;
const MIN_TURN_DEG = 28;
const MAX_TURN_DEG = 112;
const MAX_TANGENT_M = 1.35;
const MAX_TANGENT_ARM_RATIO = 0.12;
const CROSSING_GUARD_M = 3;

interface XY { x: number; y: number }

export interface SavedFinalCornerRoundingDiagnostics {
  consideredCorners: number;
  roundedCorners: number;
  skippedShortArm: number;
  skippedTurnShape: number;
  skippedTopologyGuard: number;
  maximumTangentM: number;
}

function project(point: Pick<TrackPoint, 'lat' | 'lng'>, originLat: number): XY {
  const radians = Math.PI / 180;
  return {
    x: EARTH_RADIUS_M * point.lng * radians * Math.cos(originLat * radians),
    y: EARTH_RADIUS_M * point.lat * radians,
  };
}

function unproject(point: XY, originLat: number): Pick<TrackPoint, 'lat' | 'lng'> {
  const degrees = 180 / Math.PI;
  return {
    lat: point.y / EARTH_RADIUS_M * degrees,
    lng: point.x / (EARTH_RADIUS_M * Math.cos(originLat * Math.PI / 180)) * degrees,
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

function interpolatePoint(
  start: TrackPoint,
  end: TrackPoint,
  fraction: number,
): TrackPoint {
  const alt = start.alt != null && end.alt != null
    ? start.alt + (end.alt - start.alt) * fraction
    : start.alt ?? end.alt;
  return {
    ...start,
    lat: start.lat + (end.lat - start.lat) * fraction,
    lng: start.lng + (end.lng - start.lng) * fraction,
    t: Math.round(start.t + (end.t - start.t) * fraction),
    ...(alt == null ? {} : { alt }),
    segmentId: start.segmentId ?? end.segmentId,
    segmentStartReason: undefined,
  };
}

function hasNearbyNonAdjacentEdge(points: XY[], cornerIndex: number): boolean {
  const corner = points[cornerIndex];
  for (let edge = 0; edge < points.length - 1; edge += 1) {
    // The two incident edges and their immediate neighbours are the same road
    // trace, not evidence of a crossing or folded topology.
    if (edge >= cornerIndex - 2 && edge <= cornerIndex + 1) continue;
    if (pointToSegmentDistance(corner, points[edge], points[edge + 1]) < CROSSING_GUARD_M) {
      return true;
    }
  }
  return false;
}

/**
 * Applies a sub-metre quadratic fillet only to an already accepted road-match
 * segment. Endpoints, segment identity, canonical GPS, stats and Memory are
 * outside this display-only transform. Hairpins, short arms and crossings are
 * intentionally retained verbatim.
 */
export function roundSavedFinalRoadCorners(points: TrackPoint[]): {
  points: TrackPoint[];
  diagnostics: SavedFinalCornerRoundingDiagnostics;
} {
  const diagnostics: SavedFinalCornerRoundingDiagnostics = {
    consideredCorners: Math.max(0, points.length - 2),
    roundedCorners: 0,
    skippedShortArm: 0,
    skippedTurnShape: 0,
    skippedTopologyGuard: 0,
    maximumTangentM: 0,
  };
  if (points.length < 3) return { points: points.map(point => ({ ...point })), diagnostics };
  const originLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const planar = points.map(point => project(point, originLat));
  const output: TrackPoint[] = [{ ...points[0] }];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = planar[index - 1];
    const corner = planar[index];
    const next = planar[index + 1];
    const incomingArmM = distance(previous, corner);
    const outgoingArmM = distance(corner, next);
    if (incomingArmM < MIN_ARM_M || outgoingArmM < MIN_ARM_M
      || incomingArmM > MAX_ARM_M || outgoingArmM > MAX_ARM_M) {
      diagnostics.skippedShortArm += 1;
      output.push({ ...points[index] });
      continue;
    }
    const incoming = {
      x: (corner.x - previous.x) / incomingArmM,
      y: (corner.y - previous.y) / incomingArmM,
    };
    const outgoing = {
      x: (next.x - corner.x) / outgoingArmM,
      y: (next.y - corner.y) / outgoingArmM,
    };
    const turnDeg = Math.acos(Math.max(-1, Math.min(1,
      incoming.x * outgoing.x + incoming.y * outgoing.y,
    ))) * 180 / Math.PI;
    if (turnDeg < MIN_TURN_DEG || turnDeg > MAX_TURN_DEG) {
      diagnostics.skippedTurnShape += 1;
      output.push({ ...points[index] });
      continue;
    }
    if (points[index - 1].segmentId !== points[index].segmentId
      || points[index].segmentId !== points[index + 1].segmentId
      || hasNearbyNonAdjacentEdge(planar, index)) {
      diagnostics.skippedTopologyGuard += 1;
      output.push({ ...points[index] });
      continue;
    }

    const tangentM = Math.min(
      MAX_TANGENT_M,
      incomingArmM * MAX_TANGENT_ARM_RATIO,
      outgoingArmM * MAX_TANGENT_ARM_RATIO,
    );
    const tangentIn = interpolatePoint(points[index - 1], points[index],
      (incomingArmM - tangentM) / incomingArmM);
    const tangentOut = interpolatePoint(points[index], points[index + 1],
      tangentM / outgoingArmM);
    const tangentInXY = project(tangentIn, originLat);
    const tangentOutXY = project(tangentOut, originLat);
    output.push(tangentIn);
    for (const fraction of [0.25, 0.5, 0.75]) {
      const inverse = 1 - fraction;
      const curved = unproject({
        x: inverse * inverse * tangentInXY.x
          + 2 * inverse * fraction * corner.x
          + fraction * fraction * tangentOutXY.x,
        y: inverse * inverse * tangentInXY.y
          + 2 * inverse * fraction * corner.y
          + fraction * fraction * tangentOutXY.y,
      }, originLat);
      const time = Math.round(tangentIn.t + (tangentOut.t - tangentIn.t) * fraction);
      output.push({
        ...points[index],
        ...curved,
        t: time,
        segmentId: points[index].segmentId,
        segmentStartReason: undefined,
      });
    }
    output.push(tangentOut);
    diagnostics.roundedCorners += 1;
    diagnostics.maximumTangentM = Math.max(diagnostics.maximumTangentM, tangentM);
  }
  output.push({ ...points[points.length - 1] });
  return { points: output, diagnostics };
}
