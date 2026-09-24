import type { TrackPoint } from '../../store/useSessionStore';
import { haversineM } from '../../utils/geo';

/** Live may settle only the immediately recent display tail. Canonical truth
 * is untouched, and Finish can still refine the complete Activity. */
export const LIVE_MUTABLE_TAIL_MAX_POINTS = 10;
export const LIVE_MUTABLE_TAIL_MAX_AGE_MS = 15_000;
export const LIVE_MUTABLE_TAIL_MAX_DISTANCE_M = 18;
const EARTH_METRES_PER_DEGREE = 111_320;

function angleDelta(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function bearing(from: TrackPoint, to: TrackPoint): number {
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function pointToSegmentDistanceM(point: TrackPoint, start: TrackPoint, end: TrackPoint): number {
  const cosLat = Math.cos(start.lat * Math.PI / 180);
  const xy = (value: TrackPoint) => ({
    x: (value.lng - start.lng) * EARTH_METRES_PER_DEGREE * cosLat,
    y: (value.lat - start.lat) * EARTH_METRES_PER_DEGREE,
  });
  const p = xy(point);
  const a = { x: 0, y: 0 };
  const b = xy(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator === 0 ? 0 : Math.max(0, Math.min(1, (p.x * dx + p.y * dy) / denominator));
  return Math.hypot(p.x - dx * fraction, p.y - dy * fraction);
}

function neighbourAtDistance(points: TrackPoint[], origin: number, direction: -1 | 1, minimumM: number): number | null {
  let distanceM = 0;
  for (let index = origin + direction; index >= 0 && index < points.length; index += direction) {
    distanceM += haversineM(points[index - direction], points[index]);
    if (distanceM >= minimumM) return index;
  }
  return null;
}

function protectedIndices(points: TrackPoint[], uncertaintyM: number): number[] {
  const protectedSet = new Set<number>([0, points.length - 1]);
  for (let index = 1; index < points.length - 1; index += 1) {
    const previousNear = neighbourAtDistance(points, index, -1, 6);
    const nextNear = neighbourAtDistance(points, index, 1, 6);
    const previousCorridor = neighbourAtDistance(points, index, -1, 30);
    const nextCorridor = neighbourAtDistance(points, index, 1, 30);
    const nearTurn = previousNear != null && nextNear != null
      ? angleDelta(bearing(points[previousNear], points[index]), bearing(points[index], points[nextNear]))
      : 0;
    const corridorTurn = previousCorridor != null && nextCorridor != null
      ? angleDelta(
          bearing(points[previousCorridor], points[index]),
          bearing(points[index], points[nextCorridor]),
        )
      : 0;
    const localTurn = angleDelta(
      bearing(points[index - 1], points[index]),
      bearing(points[index], points[index + 1]),
    );
    const signedLocalTurn = ((
      bearing(points[index], points[index + 1])
      - bearing(points[index - 1], points[index])
      + 540
    ) % 360) - 180;
    const hasOpposingNearbyTurn = points.slice(
      Math.max(1, index - 2),
      Math.min(points.length - 1, index + 3),
    ).some((_point, offset) => {
      const neighbour = Math.max(1, index - 2) + offset;
      if (neighbour === index || neighbour >= points.length - 1) return false;
      const signed = ((
        bearing(points[neighbour], points[neighbour + 1])
        - bearing(points[neighbour - 1], points[neighbour])
        + 540
      ) % 360) - 180;
      return Math.abs(signed) >= 55 && Math.sign(signed) !== Math.sign(signedLocalTurn);
    });
    const evidenceSizedLocalTurn = haversineM(points[index - 1], points[index]) >= Math.max(14, uncertaintyM)
      && haversineM(points[index], points[index + 1]) >= Math.max(14, uncertaintyM)
      && localTurn >= 65;
    // A display anchor needs either evidence-sized adjacent travel or a turn
    // that survives both neighbourhood and corridor scales. This retains real
    // corners/reversals without freezing a 1–5 m alternating wobble into Live.
    const compactSupportedCorner = previousNear != null
      && nextNear != null
      && nearTurn >= 70
      && localTurn >= 55
      && !hasOpposingNearbyTurn;
    if (
      evidenceSizedLocalTurn
      || (nearTurn >= 70 && corridorTurn >= 48)
      || compactSupportedCorner
    ) {
      protectedSet.add(index);
    }
    const incomingMs = points[index].t - points[index - 1].t;
    const outgoingMs = points[index + 1].t - points[index].t;
    if (incomingMs >= 12_000 || outgoingMs >= 12_000) protectedSet.add(index);
  }
  return Array.from(protectedSet).sort((a, b) => a - b);
}

function rdp(points: TrackPoint[], toleranceM: number): TrackPoint[] {
  if (points.length <= 2) return points.slice();
  const keep = new Set<number>([0, points.length - 1]);
  const visit = (start: number, end: number) => {
    if (end - start <= 1) return;
    let farthest = -1;
    let distanceM = -1;
    for (let index = start + 1; index < end; index += 1) {
      const candidateM = pointToSegmentDistanceM(points[index], points[start], points[end]);
      if (candidateM > distanceM) {
        distanceM = candidateM;
        farthest = index;
      }
    }
    if (farthest >= 0 && distanceM > toleranceM) {
      keep.add(farthest);
      visit(start, farthest);
      visit(farthest, end);
    }
  };
  visit(0, points.length - 1);
  return Array.from(keep).sort((a, b) => a - b).map(index => points[index]);
}

function stabilizeDisplayTail(
  points: TrackPoint[],
  preserveStart: boolean,
  uncertaintyM: number,
): TrackPoint[] {
  if (points.length < 3) return points.slice();
  const protectedSet = new Set(protectedIndices(points, uncertaintyM));
  return points.map((point, index) => {
    if (
      index === points.length - 1
      || (preserveStart && index === 0)
      || (index > 0 && index < points.length - 1 && protectedSet.has(index))
    ) {
      return point;
    }
    const start = Math.max(0, index - 2);
    const end = Math.min(points.length - 1, index + 2);
    let weightTotal = 0;
    let latTotal = 0;
    let lngDeltaTotal = 0;
    for (let neighbour = start; neighbour <= end; neighbour += 1) {
      const weight = 3 - Math.abs(neighbour - index);
      weightTotal += weight;
      latTotal += points[neighbour].lat * weight;
      const deltaLng = ((points[neighbour].lng - point.lng + 540) % 360) - 180;
      lngDeltaTotal += deltaLng * weight;
    }
    const candidate = {
      ...point,
      lat: latTotal / weightTotal,
      lng: point.lng + lngDeltaTotal / weightTotal,
    };
    // Display stabilization remains tightly evidence-bounded even when hAcc
    // metadata is pessimistic. It never feeds metrics, Memory or persistence.
    const maximumShiftM = Math.max(2.5, Math.min(5, (point.accuracy ?? 8) * 0.35));
    const shiftM = haversineM(point, candidate);
    if (shiftM <= maximumShiftM || shiftM === 0) return candidate;
    const fraction = maximumShiftM / shiftM;
    return {
      ...point,
      lat: point.lat + (candidate.lat - point.lat) * fraction,
      lng: point.lng + (candidate.lng - point.lng) * fraction,
    };
  });
}

function simplifyTail(points: TrackPoint[], preserveStart = false): TrackPoint[] {
  if (points.length <= 2) return points.slice();
  const accuracies = points.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0 ? [point.accuracy] : []
  )).sort((a, b) => a - b);
  const uncertaintyM = accuracies.length > 0 ? accuracies[Math.floor(accuracies.length / 2)] : 8;
  const stabilized = stabilizeDisplayTail(points, preserveStart, uncertaintyM);
  const directM = haversineM(stabilized[0], stabilized[stabilized.length - 1]);
  // Endpoints of a noisy sample window can sit on opposite sides of the
  // corridor, so the maximum distance to their chord can approach the full
  // reported uncertainty even when every observation is only 1–5 m from the
  // real road. Keep this bounded by the measured uncertainty; alternation is
  // still required, so a one-sided excursion or genuine bend does not qualify.
  const straightEnvelopeM = Math.max(3, Math.min(12, uncertaintyM * 0.95));
  const turnSigns = stabilized.slice(1, -1).flatMap((_point, offset) => {
    const index = offset + 1;
    const incoming = bearing(stabilized[index - 1], stabilized[index]);
    const outgoing = bearing(stabilized[index], stabilized[index + 1]);
    const signed = ((outgoing - incoming + 540) % 360) - 180;
    return Math.abs(signed) >= 8 ? [Math.sign(signed)] : [];
  });
  const alternatingTurnCount = turnSigns.slice(1)
    .filter((sign, index) => sign !== turnSigns[index]).length;
  const highFrequencyWobble = turnSigns.length >= 4
    && alternatingTurnCount >= Math.ceil((turnSigns.length - 1) * 0.35);
  const uncertaintyBoundedStraight = directM >= 30
    && highFrequencyWobble
    && Math.max(...stabilized.map(point => pointToSegmentDistanceM(
      point,
      stabilized[0],
      stabilized[stabilized.length - 1],
    ))) <= straightEnvelopeM;
  const toleranceM = uncertaintyBoundedStraight
    ? straightEnvelopeM
    : Math.max(2.4, Math.min(6, uncertaintyM * 0.42));
  const boundaries = protectedIndices(stabilized, uncertaintyM).filter(index => {
    if (!uncertaintyBoundedStraight || index === 0 || index === stabilized.length - 1) return true;
    const incomingMs = stabilized[index].t - stabilized[index - 1].t;
    const outgoingMs = stabilized[index + 1].t - stabilized[index].t;
    return incomingMs >= 12_000 || outgoingMs >= 12_000;
  });
  const result: TrackPoint[] = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    const subsection = rdp(stabilized.slice(boundaries[index - 1], boundaries[index] + 1), toleranceM);
    result.push(...(result.length > 0 ? subsection.slice(1) : subsection));
  }
  return result;
}

function mutableTailStartIndex(points: TrackPoint[]): number {
  if (points.length <= 1) return 0;
  const newest = points[points.length - 1];
  let start = points.length - 1;
  let distanceM = 0;
  while (start > 0) {
    const nextStart = start - 1;
    const pointCount = points.length - nextStart;
    const ageMs = Math.max(0, newest.t - points[nextStart].t);
    const nextDistanceM = distanceM + haversineM(points[nextStart], points[start]);
    if (
      pointCount > LIVE_MUTABLE_TAIL_MAX_POINTS
      || ageMs > LIVE_MUTABLE_TAIL_MAX_AGE_MS
      || nextDistanceM > LIVE_MUTABLE_TAIL_MAX_DISTANCE_M
    ) break;
    start = nextStart;
    distanceM = nextDistanceM;
  }
  return start;
}

/**
 * Bounded causal presentation reducer. It only uses evidence received so far,
 * only revises a tail bounded simultaneously by point count, elapsed time,
 * and travelled distance, never crosses a segment/Gap, and leaves canonical
 * points/metrics untouched.
 */
export function appendCausalLivePoint(
  existing: TrackPoint[],
  point: TrackPoint,
  canonicalHistory?: TrackPoint[],
): TrackPoint[] {
  if (existing.length === 0) return [point];
  const prior = existing[existing.length - 1];
  if ((prior.segmentId ?? '__legacy') !== (point.segmentId ?? '__legacy')) return [...existing, point];

  // The accepted canonical tail lets a real corner be reinstated once enough
  // later evidence confirms it. Keeping only the simplified display would
  // irreversibly discard a corner observed before its outgoing arm.
  const history = canonicalHistory?.length ? canonicalHistory : [...existing, point];
  let segmentStart = history.length - 1;
  while (
    segmentStart > 0
    && (history[segmentStart - 1].segmentId ?? '__legacy') === (point.segmentId ?? '__legacy')
  ) segmentStart -= 1;
  const evidence = history.slice(segmentStart);
  const currentSegment = point.segmentId ?? '__legacy';
  const mutableStart = mutableTailStartIndex(evidence);
  const cutoffT = evidence[mutableStart]?.t ?? point.t;
  const prefix = existing.filter(existingPoint => (
    (existingPoint.segmentId ?? '__legacy') !== currentSegment
    || existingPoint.t < cutoffT
  ));
  // Two immutable canonical context points let the boundary settle against
  // both sides before it freezes; they are never republished or revised.
  const contextStart = Math.max(0, mutableStart - 2);
  const liveTail = simplifyTail(evidence.slice(contextStart), contextStart === 0)
    .filter(candidate => candidate.t >= cutoffT);
  return [...prefix, ...liveTail];
}

export function buildCausalLiveRoute(points: TrackPoint[]): TrackPoint[] {
  const history: TrackPoint[] = [];
  return points.reduce<TrackPoint[]>((route, point) => {
    history.push(point);
    return appendCausalLivePoint(route, point, history);
  }, []);
}
