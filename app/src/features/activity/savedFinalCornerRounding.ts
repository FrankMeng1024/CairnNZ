import type { TrackPoint } from '../../store/useSessionStore';
import {
  evaluateTopologyQuality,
  evaluateWholeRouteQuality,
} from '../../services/routing/snapTrack';

const EARTH_RADIUS_M = 6_371_000;
const MIN_ARM_M = 5;
const MAX_ARM_M = 45;
const MIN_TURN_DEG = 28;
const MAX_TURN_DEG = 112;
const MAX_TANGENT_M = 2.4;
const MAX_TANGENT_ARM_RATIO = 0.18;
const CROSSING_GUARD_M = 3;

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
    postRoundRejected: false,
    postRoundRejectReason: null,
  };
  if (points.length < 3) return { points: points.map(point => ({ ...point })), diagnostics };
  const originLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const planar = points.map(point => project(point, originLat));
  interface CornerCandidate {
    cornerIndex: number;
    contextStart: number;
    contextEnd: number;
    entryEdgeStart: number;
    exitEdgeStart: number;
    tangentIn: TrackPoint;
    tangentOut: TrackPoint;
    turnDeg: number;
    tangentM: number;
  }
  const candidates: CornerCandidate[] = [];

  const accumulatedArm = (cornerIndex: number, direction: -1 | 1) => {
    let cursor = cornerIndex;
    let armM = 0;
    while (armM < MIN_ARM_M) {
      const next = cursor + direction;
      if (next < 0 || next >= points.length
        || points[next].segmentId !== points[cornerIndex].segmentId) return null;
      armM += distance(planar[cursor], planar[next]);
      cursor = next;
      if (armM > MAX_ARM_M) return null;
    }
    return { anchorIndex: cursor, armM };
  };
  const tangentAlongTrace = (cornerIndex: number, direction: -1 | 1, tangentM: number) => {
    let cursor = cornerIndex;
    let remainingM = tangentM;
    while (remainingM > 1e-6) {
      const next = cursor + direction;
      if (next < 0 || next >= points.length) return null;
      const edgeM = distance(planar[cursor], planar[next]);
      if (edgeM >= remainingM && edgeM > 1e-9) {
        return {
          point: interpolatePoint(points[cursor], points[next], remainingM / edgeM),
          edgeStart: direction < 0 ? next : cursor,
        };
      }
      remainingM -= edgeM;
      cursor = next;
    }
    return null;
  };

  for (let index = 1; index < points.length - 1; index += 1) {
    if (options.eligibleCorners && options.eligibleCorners[index] !== true) {
      diagnostics.skippedProvenanceGuard += 1;
      continue;
    }
    const incomingArm = accumulatedArm(index, -1);
    const outgoingArm = accumulatedArm(index, 1);
    const corner = planar[index];
    if (!incomingArm || !outgoingArm) {
      diagnostics.skippedShortArm += 1;
      continue;
    }
    const previous = planar[incomingArm.anchorIndex];
    const next = planar[outgoingArm.anchorIndex];
    const incomingArmM = incomingArm.armM;
    const outgoingArmM = outgoingArm.armM;
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
      continue;
    }
    if (points[index - 1].segmentId !== points[index].segmentId
      || points[index].segmentId !== points[index + 1].segmentId
      || hasNearbyNonAdjacentEdge(planar, index)) {
      diagnostics.skippedTopologyGuard += 1;
      continue;
    }

    const tangentM = Math.min(
      MAX_TANGENT_M,
      incomingArmM * MAX_TANGENT_ARM_RATIO,
      outgoingArmM * MAX_TANGENT_ARM_RATIO,
    );
    const tangentIn = tangentAlongTrace(index, -1, tangentM);
    const tangentOut = tangentAlongTrace(index, 1, tangentM);
    if (!tangentIn || !tangentOut) {
      diagnostics.skippedShortArm += 1;
      continue;
    }
    candidates.push({
      cornerIndex: index,
      contextStart: incomingArm.anchorIndex,
      contextEnd: outgoingArm.anchorIndex,
      entryEdgeStart: tangentIn.edgeStart,
      exitEdgeStart: tangentOut.edgeStart,
      tangentIn: tangentIn.point,
      tangentOut: tangentOut.point,
      turnDeg,
      tangentM,
    });
  }

  // Dense provider polylines often place several vertices around one physical
  // turn. Select the sharpest non-overlapping fillet for that local turn so a
  // road corner is rounded once without repeatedly consuming the same trace.
  const selected: CornerCandidate[] = [];
  for (const candidate of [...candidates].sort((left, right) => (
    right.turnDeg - left.turnDeg || left.cornerIndex - right.cornerIndex
  ))) {
    const overlaps = selected.some(existing => (
      candidate.contextStart < existing.contextEnd
      && existing.contextStart < candidate.contextEnd
    ));
    if (overlaps) diagnostics.skippedOverlapGuard += 1;
    else selected.push(candidate);
  }
  selected.sort((left, right) => left.cornerIndex - right.cornerIndex);

  const output: TrackPoint[] = [];
  let sourceCursor = 0;
  for (const candidate of selected) {
    while (sourceCursor <= candidate.entryEdgeStart) {
      output.push({ ...points[sourceCursor] });
      sourceCursor += 1;
    }
    const tangentInXY = project(candidate.tangentIn, originLat);
    const tangentOutXY = project(candidate.tangentOut, originLat);
    output.push(candidate.tangentIn);
    for (const fraction of [0.25, 0.5, 0.75]) {
      const inverse = 1 - fraction;
      const curved = unproject({
        x: inverse * inverse * tangentInXY.x
          + 2 * inverse * fraction * planar[candidate.cornerIndex].x
          + fraction * fraction * tangentOutXY.x,
        y: inverse * inverse * tangentInXY.y
          + 2 * inverse * fraction * planar[candidate.cornerIndex].y
          + fraction * fraction * tangentOutXY.y,
      }, originLat);
      const time = Math.round(candidate.tangentIn.t
        + (candidate.tangentOut.t - candidate.tangentIn.t) * fraction);
      output.push({
        ...points[candidate.cornerIndex],
        ...curved,
        t: time,
        segmentId: points[candidate.cornerIndex].segmentId,
        segmentStartReason: undefined,
      });
    }
    output.push(candidate.tangentOut);
    sourceCursor = candidate.exitEdgeStart + 1;
    diagnostics.maximumTangentM = Math.max(diagnostics.maximumTangentM, candidate.tangentM);
  }
  while (sourceCursor < points.length) {
    output.push({ ...points[sourceCursor] });
    sourceCursor += 1;
  }
  diagnostics.roundedCorners = selected.length;
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
              : maximumCorridorDeviationM > 0.8
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
