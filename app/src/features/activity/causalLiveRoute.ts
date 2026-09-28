import type { TrackPoint } from '../../store/useSessionStore';

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

function localMetricDelta(from: TrackPoint, to: TrackPoint): { x: number; y: number } {
  const deltaLng = ((to.lng - from.lng + 540) % 360) - 180;
  const meanLatRad = (from.lat + to.lat) * Math.PI / 360;
  return {
    x: deltaLng * EARTH_METRES_PER_DEGREE * Math.cos(meanLatRad),
    y: (to.lat - from.lat) * EARTH_METRES_PER_DEGREE,
  };
}

/** All mutable presentation decisions are bounded to a few metres. A local
 * tangent-plane measure avoids millions of spherical trig calls during WAL
 * replay while remaining sub-centimetre-equivalent at that scale. */
function displayDistanceM(from: TrackPoint, to: TrackPoint): number {
  const delta = localMetricDelta(from, to);
  return Math.hypot(delta.x, delta.y);
}

function bearing(from: TrackPoint, to: TrackPoint): number {
  const delta = localMetricDelta(from, to);
  return (Math.atan2(delta.x, delta.y) * 180 / Math.PI + 360) % 360;
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

function protectedIndices(points: TrackPoint[], uncertaintyM: number): number[] {
  const protectedSet = new Set<number>([0, points.length - 1]);
  const adjacentDistanceM = points.slice(1).map((point, index) => displayDistanceM(points[index], point));
  const cumulativeDistanceM = [0];
  for (const distanceM of adjacentDistanceM) {
    cumulativeDistanceM.push(cumulativeDistanceM[cumulativeDistanceM.length - 1] + distanceM);
  }
  const bearingCache = new Map<number, number>();
  const cachedBearing = (from: number, to: number) => {
    const key = from * points.length + to;
    const cached = bearingCache.get(key);
    if (cached !== undefined) return cached;
    const computed = bearing(points[from], points[to]);
    bearingCache.set(key, computed);
    return computed;
  };
  const neighbourAtDistance = (origin: number, direction: -1 | 1, minimumM: number): number | null => {
    if (direction < 0) {
      for (let index = origin - 1; index >= 0; index -= 1) {
        if (cumulativeDistanceM[origin] - cumulativeDistanceM[index] >= minimumM) return index;
      }
      return null;
    }
    for (let index = origin + 1; index < points.length; index += 1) {
      if (cumulativeDistanceM[index] - cumulativeDistanceM[origin] >= minimumM) return index;
    }
    return null;
  };
  const signedLocalTurns = points.map((_point, index) => {
    if (index === 0 || index >= points.length - 1) return 0;
    return ((cachedBearing(index, index + 1) - cachedBearing(index - 1, index) + 540) % 360) - 180;
  });
  for (let index = 1; index < points.length - 1; index += 1) {
    const previousNear = neighbourAtDistance(index, -1, 6);
    const nextNear = neighbourAtDistance(index, 1, 6);
    const previousCorridor = neighbourAtDistance(index, -1, 30);
    const nextCorridor = neighbourAtDistance(index, 1, 30);
    const nearTurn = previousNear != null && nextNear != null
      ? angleDelta(cachedBearing(previousNear, index), cachedBearing(index, nextNear))
      : 0;
    const corridorTurn = previousCorridor != null && nextCorridor != null
      ? angleDelta(
          cachedBearing(previousCorridor, index),
          cachedBearing(index, nextCorridor),
        )
      : 0;
    const localTurn = angleDelta(
      cachedBearing(index - 1, index),
      cachedBearing(index, index + 1),
    );
    const signedLocalTurn = signedLocalTurns[index];
    let hasOpposingNearbyTurn = false;
    for (
      let neighbour = Math.max(1, index - 2);
      neighbour < Math.min(points.length - 1, index + 3);
      neighbour += 1
    ) {
      if (neighbour === index) continue;
      const signed = signedLocalTurns[neighbour];
      if (Math.abs(signed) >= 55 && Math.sign(signed) !== Math.sign(signedLocalTurn)) {
        hasOpposingNearbyTurn = true;
        break;
      }
    }
    const evidenceSizedLocalTurn = adjacentDistanceM[index - 1] >= Math.max(14, uncertaintyM)
      && adjacentDistanceM[index] >= Math.max(14, uncertaintyM)
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
    const shiftM = displayDistanceM(point, candidate);
    if (shiftM <= maximumShiftM || shiftM === 0) return candidate;
    const fraction = maximumShiftM / shiftM;
    return {
      ...point,
      lat: point.lat + (candidate.lat - point.lat) * fraction,
      lng: point.lng + (candidate.lng - point.lng) * fraction,
    };
  });
}

function simplifyTail(
  points: TrackPoint[],
  preserveStart = false,
  requiredFreezeBoundaryIndex: number | null = null,
): TrackPoint[] {
  if (points.length <= 2) return points.slice();
  const accuracies = points.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0 ? [point.accuracy] : []
  )).sort((a, b) => a - b);
  const uncertaintyM = accuracies.length > 0 ? accuracies[Math.floor(accuracies.length / 2)] : 8;
  const stabilized = stabilizeDisplayTail(points, preserveStart, uncertaintyM);
  const directM = displayDistanceM(stabilized[0], stabilized[stabilized.length - 1]);
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
  if (
    requiredFreezeBoundaryIndex != null
    && requiredFreezeBoundaryIndex >= 0
    && requiredFreezeBoundaryIndex < stabilized.length
  ) boundaries.push(requiredFreezeBoundaryIndex);
  boundaries.sort((left, right) => left - right);
  const uniqueBoundaries = boundaries.filter((value, index) => index === 0 || value !== boundaries[index - 1]);
  const result: TrackPoint[] = [];
  for (let index = 1; index < uniqueBoundaries.length; index += 1) {
    const subsection = rdp(
      stabilized.slice(uniqueBoundaries[index - 1], uniqueBoundaries[index] + 1),
      toleranceM,
    );
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
    const nextDistanceM = distanceM + displayDistanceM(points[nextStart], points[start]);
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
  const history = canonicalHistory?.length ? canonicalHistory : [...existing, point];
  const priorHistory = history.slice(0, -1);
  const checkpoint = createCausalLiveReplayCheckpoint(priorHistory, existing);
  appendCausalLiveReplayPoint(checkpoint, point);
  return causalLiveReplayResult(checkpoint);
}

export interface CausalLiveReplayCheckpoint {
  frozen: TrackPoint[];
  liveTail: TrackPoint[];
  segmentEvidence: TrackPoint[];
  segmentId: string | null;
  segmentHasPriorEvidence: boolean;
}

export function createCausalLiveReplayCheckpoint(
  canonical: ReadonlyArray<TrackPoint> = [],
  live: ReadonlyArray<TrackPoint> = [],
): CausalLiveReplayCheckpoint {
  if (canonical.length === 0) {
    return {
      frozen: [], liveTail: [], segmentEvidence: [], segmentId: null,
      segmentHasPriorEvidence: false,
    };
  }
  const segmentId = canonical[canonical.length - 1].segmentId ?? '__legacy';
  // Mutable decisions use at most ten points plus two immutable boundary
  // witnesses. Everything older is already represented by the frozen Live
  // prefix and need not be replayed on foreground return or the next GPS fix.
  let boundedStart = canonical.length - 1;
  const maximumEvidence = LIVE_MUTABLE_TAIL_MAX_POINTS + 2;
  while (boundedStart > 0
    && canonical.length - boundedStart < maximumEvidence
    && (canonical[boundedStart - 1].segmentId ?? '__legacy') === segmentId) boundedStart -= 1;
  const hasEarlierSegmentEvidence = boundedStart > 0
    && (canonical[boundedStart - 1].segmentId ?? '__legacy') === segmentId;
  const boundedEvidence = canonical.slice(boundedStart);
  const mutableStart = mutableTailStartIndex(boundedEvidence);
  const contextStart = Math.max(0, mutableStart - 2);
  const cutoffT = boundedEvidence[mutableStart]?.t ?? canonical[canonical.length - 1].t;
  let liveTailStart = live.length;
  while (liveTailStart > 0) {
    const candidate = live[liveTailStart - 1];
    if ((candidate.segmentId ?? '__legacy') !== segmentId || candidate.t < cutoffT) break;
    liveTailStart -= 1;
  }
  return {
    frozen: live.slice(0, liveTailStart),
    liveTail: live.slice(liveTailStart),
    segmentEvidence: boundedEvidence.slice(contextStart),
    segmentId,
    segmentHasPriorEvidence: hasEarlierSegmentEvidence || contextStart > 0,
  };
}

export function appendCausalLiveReplayPoint(state: CausalLiveReplayCheckpoint, point: TrackPoint): void {
    const nextSegmentId = point.segmentId ?? '__legacy';
    if (state.segmentId !== nextSegmentId) {
      state.frozen.push(...state.liveTail);
      state.liveTail = [];
      state.segmentEvidence = [];
      state.segmentId = nextSegmentId;
      state.segmentHasPriorEvidence = false;
    }
    state.segmentEvidence.push(point);
    const mutableStart = mutableTailStartIndex(state.segmentEvidence);
    const cutoffT = state.segmentEvidence[mutableStart]?.t ?? point.t;
    if (state.liveTail.length > 0) {
      state.frozen.push(...state.liveTail.filter(candidate => candidate.t < cutoffT));
    }
    const contextStart = Math.max(0, mutableStart - 2);
    state.liveTail = simplifyTail(
      state.segmentEvidence.slice(contextStart),
      !state.segmentHasPriorEvidence && contextStart === 0,
      mutableStart - contextStart,
    ).filter(candidate => candidate.t >= cutoffT);
    if (contextStart > 0) {
      state.segmentEvidence = state.segmentEvidence.slice(contextStart);
      state.segmentHasPriorEvidence = true;
    }
}

export function causalLiveReplayResult(state: CausalLiveReplayCheckpoint): TrackPoint[] {
  return [...state.frozen, ...state.liveTail];
}

function buildExactCausalLiveRoute(points: TrackPoint[]): TrackPoint[] {
  const state = createCausalLiveReplayCheckpoint();
  for (const point of points) {
    appendCausalLiveReplayPoint(state, point);
  }
  return causalLiveReplayResult(state);
}

export interface CausalLiveCooperativeReplayMetrics {
  processedPointCount: number;
  sliceCount: number;
  yieldCount: number;
  totalMs: number;
  maxSynchronousSliceMs: number;
}

export interface CausalLiveCooperativeReplayResult {
  route: TrackPoint[];
  metrics: CausalLiveCooperativeReplayMetrics;
}

export interface CausalLiveCooperativeReplayOptions {
  /** Fixed point cap makes work bounded even when host clocks are coarse. */
  maxPointsPerSlice?: number;
  yieldToHost?: () => Promise<void>;
  shouldContinue?: () => boolean;
}

const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();
const defaultYieldToHost = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Exact R3 reducer replay with cooperative host yields. No partial route is
 * published; callers generation-fence the final snapshot. */
export async function buildCausalLiveRouteCooperatively(
  points: ReadonlyArray<TrackPoint>,
  options: CausalLiveCooperativeReplayOptions = {},
): Promise<CausalLiveCooperativeReplayResult | null> {
  const state = createCausalLiveReplayCheckpoint();
  const maxPointsPerSlice = Math.max(1, Math.floor(options.maxPointsPerSlice ?? 16));
  const yieldToHost = options.yieldToHost ?? defaultYieldToHost;
  const startedAt = monotonicNow();
  let maxSynchronousSliceMs = 0;
  let sliceCount = 0;
  let yieldCount = 0;
  for (let offset = 0; offset < points.length; offset += maxPointsPerSlice) {
    if (options.shouldContinue && !options.shouldContinue()) return null;
    const sliceStartedAt = monotonicNow();
    const end = Math.min(points.length, offset + maxPointsPerSlice);
    for (let index = offset; index < end; index += 1) {
      appendCausalLiveReplayPoint(state, points[index]);
    }
    maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, monotonicNow() - sliceStartedAt);
    sliceCount += 1;
    if (end < points.length) {
      yieldCount += 1;
      await yieldToHost();
    }
  }
  if (options.shouldContinue && !options.shouldContinue()) return null;
  return {
    route: causalLiveReplayResult(state),
    metrics: {
      processedPointCount: points.length,
      sliceCount,
      yieldCount,
      totalMs: monotonicNow() - startedAt,
      maxSynchronousSliceMs,
    },
  };
}

export function buildCausalLiveRoute(points: TrackPoint[]): TrackPoint[] {
  if (points.length === 0) return [];
  // Recovery is the same reducer replay as incremental publication. The
  // reducer's work is already bounded by the 10-point/15-second/18-metre tail;
  // no whole-history stabilization pass is needed. Consequently a cold WAL
  // replay restores byte-for-byte the prefix that Live previously froze.
  return buildExactCausalLiveRoute(points);
}
