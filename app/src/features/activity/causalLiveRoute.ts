import type { TrackPoint } from '../../store/useSessionStore';

/** Live may settle only the immediately recent display tail. Canonical truth
 * is untouched, and Finish can still refine the complete Activity. */
export const LIVE_MUTABLE_TAIL_MAX_POINTS = 10;
export const LIVE_MUTABLE_TAIL_MAX_AGE_MS = 15_000;
export const LIVE_MUTABLE_TAIL_MAX_DISTANCE_M = 18;
export const LIVE_TREND_CONTEXT_MAX_POINTS = 5;
const LIVE_PRESENTATION_EVIDENCE_BUCKET_MS = 1_000;
const LIVE_PRESENTATION_GAP_BOUNDARY_MS = 12_000;
// Recovery scans this bounded canonical suffix only to reconstruct mutable
// trend context after an exact Live checkpoint. It never limits WAL paging or
// the already-published frozen route; legacy/unproven checkpoints are forced
// through complete WAL replay by activityJournalProjection.
const LIVE_RECOVERY_TREND_CONTEXT_SCAN_MAX_POINTS = 512;
const LIVE_SETTLED_ANCHOR_MAX_AGE_MS = 10_000;
const LIVE_SETTLED_ANCHOR_MAX_DISTANCE_M = 12;
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

/** Stable observation identity for display decisions. Coordinates are omitted
 * because display-only stabilization is allowed to move a provisional point. */
function presentationEvidenceKey(point: TrackPoint): string {
  if (point.observationId) return point.observationId;
  if (point.clientActivityId && point.ownerGeneration && Number.isFinite(point.rawOrdinal)) {
    return `${point.clientActivityId}:${point.ownerGeneration}:${Number(point.rawOrdinal)}`;
  }
  if (Number.isFinite(point.rawOrdinal)) {
    return `${point.segmentId ?? '__legacy'}:raw:${Number(point.rawOrdinal)}`;
  }
  return `${point.segmentId ?? '__legacy'}:t:${Math.floor(point.t)}`;
}

function confirmedPresentationPoint(point: TrackPoint, preserveReference = false): TrackPoint {
  if (preserveReference || point.liveTrendConfirmed) return point;
  return { ...point, liveTrendConfirmed: true };
}

function settledPresentationPoint(point: TrackPoint): TrackPoint {
  if (point.liveTrendConfirmed || point.livePresentationSettled) return point;
  return { ...point, livePresentationSettled: true };
}

function appendPresentationEvidence(
  evidence: TrackPoint[],
  point: TrackPoint,
): void {
  const previous = evidence.at(-1);
  const pointBucket = Math.floor(point.t / LIVE_PRESENTATION_EVIDENCE_BUCKET_MS);
  const previousBucket = previous == null
    ? null
    : Math.floor(previous.t / LIVE_PRESENTATION_EVIDENCE_BUCKET_MS);
  let currentBucketStart = evidence.length;
  while (
    currentBucketStart > 0
    && previousBucket != null
    && Math.floor(evidence[currentBucketStart - 1].t / LIVE_PRESENTATION_EVIDENCE_BUCKET_MS)
      === previousBucket
  ) currentBucketStart -= 1;
  const currentBucketCount = evidence.length - currentBucketStart;
  const hasSupportedLocalDirectionChange = (
    approach: TrackPoint | undefined,
    candidate: TrackPoint | undefined,
    departure: TrackPoint,
  ): boolean => {
    if (approach == null || candidate == null) return false;
    const uncertaintyM = Math.max(
      1,
      Math.min(12, candidate.accuracy ?? departure.accuracy ?? 8),
    );
    return displayDistanceM(approach, candidate) >= 0.5
      && displayDistanceM(candidate, departure) >= 0.5
      && angleDelta(bearing(approach, candidate), bearing(candidate, departure)) >= 35
      && pointToSegmentDistanceM(candidate, approach, departure)
        >= Math.max(0.5, Math.min(1.5, uncertaintyM * 0.1));
  };
  if (previousBucket === pointBucket) {
    // Retain the first sample as the bucket's deterministic trend anchor and
    // update a separate provisional newest sample for immediate feedback. A
    // single independently supported direction-change vertex may also remain
    // inside the bucket. Without that bounded third slot, a denser sampling
    // superset can overwrite the exact apex of a real turn merely because it
    // shares a Unix-second bucket with a later fix.
    if (currentBucketCount === 1) {
      evidence.push(point);
    } else if (currentBucketCount === 2) {
      const candidate = evidence.at(-1);
      const approach = evidence[currentBucketStart - 1]
        ?? evidence[currentBucketStart];
      if (hasSupportedLocalDirectionChange(approach, candidate, point)) {
        evidence.push(point);
      } else {
        evidence[evidence.length - 1] = point;
      }
    } else {
      // [bucket anchor, supported vertex, responsive newest]. Keep memory and
      // work bounded while preserving the already demonstrated vertex.
      evidence[evidence.length - 1] = point;
    }
    return;
  }
  // Once a bucket closes, discard its provisional newest sample. Its first
  // sample is the cadence-independent historical evidence. When the bucket
  // contains a supported interior vertex, retain that vertex and discard only
  // the responsive newest point. The new bucket's first sample then becomes
  // both its anchor and responsive newest point.
  if (
    currentBucketCount >= 2
    && point.t - (previous?.t ?? point.t) < LIVE_PRESENTATION_GAP_BOUNDARY_MS
  ) {
    if (currentBucketCount >= 3) {
      evidence.pop();
    } else {
      const approach = evidence[currentBucketStart - 1]
        ?? evidence[currentBucketStart];
      const candidate = evidence.at(-1);
      if (!hasSupportedLocalDirectionChange(approach, candidate, point)) {
        evidence.pop();
      }
    }
  }
  evidence.push(point);
}

function compactPresentationEvidence(
  points: ReadonlyArray<TrackPoint>,
): TrackPoint[] {
  const compacted: TrackPoint[] = [];
  for (const point of points) appendPresentationEvidence(compacted, point);
  return compacted;
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

function localTrendSettlementCandidate(
  evidence: ReadonlyArray<TrackPoint>,
  candidateIndex: number,
): TrackPoint | null {
  if (candidateIndex < 0 || candidateIndex >= evidence.length) return null;
  let startIndex = Math.max(0, candidateIndex - 4);
  let endIndex = Math.min(evidence.length - 1, candidateIndex + 4);
  for (let index = candidateIndex; index > startIndex; index -= 1) {
    if (evidence[index].t - evidence[index - 1].t >= LIVE_PRESENTATION_GAP_BOUNDARY_MS) {
      startIndex = index;
      break;
    }
  }
  for (let index = candidateIndex + 1; index <= endIndex; index += 1) {
    if (evidence[index].t - evidence[index - 1].t >= LIVE_PRESENTATION_GAP_BOUNDARY_MS) {
      endIndex = index - 1;
      break;
    }
  }
  // At a real gap/segment boundary only one side can exist. Three coherent
  // samples on that side are enough to resolve the boundary presentation;
  // they do not confirm a movement trend or alter the canonical endpoint.
  if (endIndex - startIndex + 1 < 3) return null;
  const candidate = evidence[candidateIndex];
  const window = evidence.slice(startIndex, endIndex + 1);
  const corridorStart = window[0];
  const corridorEnd = window[window.length - 1];
  const settlementEnvelopeM = Math.max(1, Math.min(2.5, (candidate.accuracy ?? 8) * 0.25));
  // Stable history contains only actual accepted coordinates. If symmetric
  // evidence places the point outside its local corridor, let that provisional
  // vertex age out instead of manufacturing and freezing a replacement. Clean
  // anchors remain exact, while confirmed turns are handled before settlement.
  return pointToSegmentDistanceM(candidate, corridorStart, corridorEnd)
    <= settlementEnvelopeM
    ? candidate
    : null;
}

function presentationEvidenceIndex(
  evidence: ReadonlyArray<TrackPoint>,
  candidate: TrackPoint,
): number {
  const key = presentationEvidenceKey(candidate);
  const exact = evidence.findIndex(point => presentationEvidenceKey(point) === key);
  if (exact >= 0) return exact;
  let nearestIndex = -1;
  let nearestDeltaMs = Number.POSITIVE_INFINITY;
  evidence.forEach((point, index) => {
    if ((point.segmentId ?? '__legacy') !== (candidate.segmentId ?? '__legacy')) return;
    const deltaMs = Math.abs(point.t - candidate.t);
    if (deltaMs < nearestDeltaMs) {
      nearestIndex = index;
      nearestDeltaMs = deltaMs;
    }
  });
  return nearestDeltaMs <= LIVE_PRESENTATION_EVIDENCE_BUCKET_MS ? nearestIndex : -1;
}

function resolvedExpiredPresentationPoint(
  evidence: ReadonlyArray<TrackPoint>,
  candidate: TrackPoint,
): TrackPoint | null {
  const index = presentationEvidenceIndex(evidence, candidate);
  if (index < 0) return null;
  const resolved = localTrendSettlementCandidate(evidence, index);
  return resolved == null ? null : {
    ...candidate,
    lat: resolved.lat,
    lng: resolved.lng,
  };
}

function resolvedBoundaryPresentationPoint(
  evidence: ReadonlyArray<TrackPoint>,
): TrackPoint | null {
  if (evidence.length === 0) return null;
  let continuousStart = Math.max(0, evidence.length - 7);
  for (let index = evidence.length - 1; index > continuousStart; index -= 1) {
    if (evidence[index].t - evidence[index - 1].t >= LIVE_PRESENTATION_GAP_BOUNDARY_MS) {
      continuousStart = index;
      break;
    }
  }
  const window = evidence.slice(continuousStart);
  const endpoint = window[window.length - 1];
  // A silence or segment boundary supplies no evidence about movement after
  // the last accepted observation. Extrapolating the old trend moved genuine
  // turn endpoints by 10–20 m and made the fabricated point immutable. Keep
  // the accepted endpoint exactly; presentation can resume provisionally when
  // the next segment/evidence arrives, without inventing an unseen position.
  return endpoint;
}

function signedCrossTrackDistanceM(point: TrackPoint, start: TrackPoint, end: TrackPoint): number {
  const corridor = localMetricDelta(start, end);
  const offset = localMetricDelta(start, point);
  const corridorM = Math.hypot(corridor.x, corridor.y);
  if (corridorM === 0) return 0;
  return (corridor.x * offset.y - corridor.y * offset.x) / corridorM;
}

function protectedIndices(
  points: TrackPoint[],
  uncertaintyM: number,
  includeGapBoundaries = true,
  gapBoundaryOnlyIndices?: Set<number>,
): number[] {
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
  const directionalEvidence = (start: number, end: number) => {
    let east = 0;
    let north = 0;
    let distanceM = 0;
    let edgeCount = 0;
    for (let edge = start; edge < end; edge += 1) {
      const edgeDistanceM = adjacentDistanceM[edge];
      if (edgeDistanceM < 0.5) continue;
      const radians = cachedBearing(edge, edge + 1) * Math.PI / 180;
      east += Math.sin(radians) * edgeDistanceM;
      north += Math.cos(radians) * edgeDistanceM;
      distanceM += edgeDistanceM;
      edgeCount += 1;
    }
    return {
      bearingDeg: (Math.atan2(east, north) * 180 / Math.PI + 360) % 360,
      concentration: distanceM > 0 ? Math.hypot(east, north) / distanceM : 0,
      distanceM,
      edgeCount,
    };
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
    const cornerCandidate = evidenceSizedLocalTurn
      || (nearTurn >= 70 && corridorTurn >= 48)
      || compactSupportedCorner;
    if (cornerCandidate) {
      // A single V-shaped sample is not a movement trend. Confirm a display
      // anchor only after both approach and departure contain directionally
      // coherent travel sized to observed uncertainty. Fast, sparse delivery
      // may establish this with one long edge; walking needs shorter samples.
      const trendSupportM = Math.max(7, Math.min(15, uncertaintyM * 0.85));
      const trendPrevious = neighbourAtDistance(index, -1, trendSupportM);
      const trendNext = neighbourAtDistance(index, 1, trendSupportM);
      const incomingTrend = trendPrevious == null ? null : directionalEvidence(trendPrevious, index);
      const outgoingTrend = trendNext == null ? null : directionalEvidence(index, trendNext);
      const evidenceCountSupported = (evidence: ReturnType<typeof directionalEvidence> | null) => Boolean(
        evidence && (evidence.edgeCount >= 2
          // A sparse native batch can establish a real turn with one
          // evidence-sized edge on each side. Keep this aligned with the
          // existing physical corner gate so the turn cannot leave the
          // mutable tail before its later samples confirm it.
          || evidence.distanceM >= Math.max(14, uncertaintyM)),
      );
      const trendTurn = incomingTrend && outgoingTrend
        ? angleDelta(incomingTrend.bearingDeg, outgoingTrend.bearingDeg)
        : 0;
      const trendProminenceM = trendPrevious != null && trendNext != null
        ? pointToSegmentDistanceM(points[index], points[trendPrevious], points[trendNext])
        : 0;
      const trendSupported = Boolean(
        incomingTrend && outgoingTrend
        && evidenceCountSupported(incomingTrend)
        && evidenceCountSupported(outgoingTrend)
        && incomingTrend.distanceM >= trendSupportM
        && outgoingTrend.distanceM >= trendSupportM
        && incomingTrend.concentration >= 0.9
        && outgoingTrend.concentration >= 0.9
        && trendTurn >= 30,
      );
      const excursionStart = Math.max(0, index - 3);
      const excursionEnd = Math.min(points.length - 1, index + 3);
      let excursionPathM = 0;
      for (let edge = excursionStart; edge < excursionEnd; edge += 1) {
        excursionPathM += adjacentDistanceM[edge];
      }
      const excursionChordM = displayDistanceM(points[excursionStart], points[excursionEnd]);
      const excursionProminenceM = Math.max(...points
        .slice(excursionStart + 1, excursionEnd)
        .map(candidate => pointToSegmentDistanceM(
          candidate,
          points[excursionStart],
          points[excursionEnd],
        )), 0);
      // A real short detour, U-turn or switchback may deliberately lack one
      // coherent bearing. Preserve it when its extra travelled shape exceeds
      // both display noise and a substantial fraction of uncertainty.
      const meaningfulExcursion = excursionPathM - excursionChordM
        >= Math.max(8, uncertaintyM * 0.75)
        && excursionProminenceM >= Math.max(8, uncertaintyM * 0.65);
      const prominentTrendTurn = trendSupported && (
        evidenceSizedLocalTurn
        // A short triangular excursion inside the observed uncertainty is not
        // a durable direction change merely because both sides are coherent.
        // A real sparse corner still clears this gate through evidence-sized
        // edges or prominence beyond most of the uncertainty envelope.
        || trendProminenceM >= Math.max(5, uncertaintyM * 0.75)
      );
      if (prominentTrendTurn || meaningfulExcursion) protectedSet.add(index);
    }
    // A meaningful detour can be a smooth, one-sided bow rather than a sharp
    // corner. Confirm it only when multiple observations sustain the same
    // side of a supported corridor and the travelled path is materially
    // longer than the chord. An isolated V-shaped fix therefore cannot turn
    // a presentation resource boundary into movement evidence.
    const excursionSupportM = Math.max(12, uncertaintyM);
    const excursionPrevious = neighbourAtDistance(index, -1, excursionSupportM);
    const excursionNext = neighbourAtDistance(index, 1, excursionSupportM);
    if (excursionPrevious != null && excursionNext != null && excursionNext - excursionPrevious >= 3) {
      const excursionThresholdM = Math.max(8, uncertaintyM * 0.65);
      const signedDeviationM = signedCrossTrackDistanceM(
        points[index],
        points[excursionPrevious],
        points[excursionNext],
      );
      const side = Math.sign(signedDeviationM);
      const sameSideEvidenceCount = side === 0 ? 0 : points
        .slice(excursionPrevious + 1, excursionNext)
        .filter(candidate => {
          const deviationM = signedCrossTrackDistanceM(
            candidate,
            points[excursionPrevious],
            points[excursionNext],
          );
          return Math.sign(deviationM) === side
            && Math.abs(deviationM) >= excursionThresholdM * 0.45;
        }).length;
      const excursionPathM = cumulativeDistanceM[excursionNext]
        - cumulativeDistanceM[excursionPrevious];
      const excursionChordM = displayDistanceM(
        points[excursionPrevious],
        points[excursionNext],
      );
      if (
        Math.abs(signedDeviationM) >= excursionThresholdM
        && sameSideEvidenceCount >= 2
        && excursionPathM - excursionChordM >= Math.max(6, uncertaintyM * 0.45)
      ) protectedSet.add(index);
    }
    const curvatureStart = Math.max(1, index - 2);
    const curvatureEnd = Math.min(points.length - 2, index + 2);
    const curvatureTurns = signedLocalTurns
      .slice(curvatureStart, curvatureEnd + 1)
      .filter(turn => Math.abs(turn) >= 2);
    const positiveCurvature = curvatureTurns.filter(turn => turn > 0);
    const negativeCurvature = curvatureTurns.filter(turn => turn < 0);
    const dominantCurvature = positiveCurvature.length >= negativeCurvature.length
      ? positiveCurvature
      : negativeCurvature;
    let curvatureTravelM = 0;
    for (let edge = Math.max(0, curvatureStart - 1); edge <= curvatureEnd; edge += 1) {
      curvatureTravelM += adjacentDistanceM[edge] ?? 0;
    }
    // Gradual bends do not contain one sharp corner, but a run of coherent
    // same-direction turns is still movement trend evidence. Alternating GPS
    // wobble and a single V-shaped excursion cannot satisfy this gate.
    if (
      dominantCurvature.length >= 4
      && Math.abs(dominantCurvature.reduce((sum, turn) => sum + turn, 0)) >= 18
      && dominantCurvature.length >= Math.ceil(curvatureTurns.length * 0.75)
      && curvatureTravelM >= Math.max(18, uncertaintyM * 1.4)
    ) protectedSet.add(index);
    const reversalSupportM = Math.max(7, Math.min(14, uncertaintyM * 0.85));
    const reversalPrevious = neighbourAtDistance(index, -1, reversalSupportM);
    const reversalNext = neighbourAtDistance(index, 1, reversalSupportM);
    const reversalIncoming = reversalPrevious == null
      ? null
      : directionalEvidence(reversalPrevious, index);
    const reversalOutgoing = reversalNext == null
      ? null
      : directionalEvidence(index, reversalNext);
    if (
      reversalIncoming && reversalOutgoing
      && reversalIncoming.edgeCount >= 2
      && reversalOutgoing.edgeCount >= 2
      && reversalIncoming.concentration >= 0.65
      && reversalOutgoing.concentration >= 0.65
      && angleDelta(reversalIncoming.bearingDeg, reversalOutgoing.bearingDeg) >= 135
    ) protectedSet.add(index);
    const incomingMs = points[index].t - points[index - 1].t;
    const outgoingMs = points[index + 1].t - points[index].t;
    if (includeGapBoundaries && (incomingMs >= 12_000 || outgoingMs >= 12_000)) {
      if (!protectedSet.has(index)) gapBoundaryOnlyIndices?.add(index);
      protectedSet.add(index);
    }
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
  precomputedProtectedIndices?: ReadonlyArray<number>,
): TrackPoint[] {
  if (points.length < 3) return points.slice();
  const protectedSet = new Set(
    precomputedProtectedIndices ?? protectedIndices(points, uncertaintyM),
  );
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
  precomputedProtectedIndices?: ReadonlyArray<number>,
): TrackPoint[] {
  if (points.length <= 2) return points.slice();
  const accuracies = points.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0 ? [point.accuracy] : []
  )).sort((a, b) => a - b);
  const uncertaintyM = accuracies.length > 0 ? accuracies[Math.floor(accuracies.length / 2)] : 8;
  const stableProtectedIndices = precomputedProtectedIndices
    ?? protectedIndices(points, uncertaintyM);
  const stabilized = stabilizeDisplayTail(
    points,
    preserveStart,
    uncertaintyM,
    stableProtectedIndices,
  );
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
  const excursionThresholdM = Math.max(8, uncertaintyM * 0.65);
  const signedCorridorOffsetsM = stabilized.slice(1, -1).map(point => (
    signedCrossTrackDistanceM(point, stabilized[0], stabilized[stabilized.length - 1])
  ));
  const sustainedSide = (side: -1 | 1) => signedCorridorOffsetsM
    .filter(offsetM => Math.sign(offsetM) === side
      && Math.abs(offsetM) >= excursionThresholdM * 0.45);
  const sustainedOneSidedExcursion = Math.max(
    ...signedCorridorOffsetsM.map(offsetM => Math.abs(offsetM)),
    0,
  ) >= excursionThresholdM
    && (sustainedSide(-1).length >= 2 || sustainedSide(1).length >= 2)
    && stabilized.slice(1).reduce((sum, candidate, index) => (
      sum + displayDistanceM(stabilized[index], candidate)
    ), 0) - directM >= Math.max(6, uncertaintyM * 0.45);
  const uncertaintyBoundedStraight = directM >= 30
    && highFrequencyWobble
    && !sustainedOneSidedExcursion
    && Math.max(...stabilized.map(point => pointToSegmentDistanceM(
      point,
      stabilized[0],
      stabilized[stabilized.length - 1],
    ))) <= straightEnvelopeM;
  const toleranceM = uncertaintyBoundedStraight
    ? straightEnvelopeM
    : Math.max(2.4, Math.min(6, uncertaintyM * 0.42));
  const boundaries = stableProtectedIndices.filter(index => {
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
  frozenEvidenceKeys: Set<string>;
  liveTail: TrackPoint[];
  segmentEvidence: TrackPoint[];
  segmentId: string | null;
  segmentHasPriorEvidence: boolean;
}

function insertFrozenPresentationPoint(
  state: CausalLiveReplayCheckpoint,
  point: TrackPoint,
): void {
  const key = presentationEvidenceKey(point);
  if (state.frozenEvidenceKeys.has(key)) return;
  let insertionIndex = state.frozen.length;
  while (insertionIndex > 0) {
    const previous = state.frozen[insertionIndex - 1];
    if (previous.t < point.t || (
      previous.t === point.t
      && (previous.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
        <= (point.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
    )) break;
    insertionIndex -= 1;
  }
  state.frozen.splice(insertionIndex, 0, point);
  state.frozenEvidenceKeys.add(key);
}

export function createCausalLiveReplayCheckpoint(
  canonical: ReadonlyArray<TrackPoint> = [],
  live: ReadonlyArray<TrackPoint> = [],
): CausalLiveReplayCheckpoint {
  if (canonical.length === 0) {
    return {
      frozen: [], frozenEvidenceKeys: new Set(), liveTail: [], segmentEvidence: [], segmentId: null,
      segmentHasPriorEvidence: false,
    };
  }
  const segmentId = canonical[canonical.length - 1].segmentId ?? '__legacy';
  // Mutable decisions use at most ten points plus a small immutable trend
  // context. The context can prove a sustained approach without becoming
  // mutable itself; everything older is already represented by frozen Live.
  let rawStart = Math.max(0, canonical.length - LIVE_RECOVERY_TREND_CONTEXT_SCAN_MAX_POINTS);
  while (rawStart > 0
    && canonical.length - rawStart < LIVE_RECOVERY_TREND_CONTEXT_SCAN_MAX_POINTS
    && (canonical[rawStart - 1].segmentId ?? '__legacy') === segmentId) rawStart -= 1;
  while (rawStart < canonical.length - 1
    && (canonical[rawStart].segmentId ?? '__legacy') !== segmentId) rawStart += 1;
  const hasEarlierRawSegmentEvidence = rawStart > 0
    && (canonical[rawStart - 1].segmentId ?? '__legacy') === segmentId;
  const compacted = compactPresentationEvidence(
    canonical.slice(rawStart),
  );
  let boundedStart = compacted.length - 1;
  const maximumEvidence = LIVE_MUTABLE_TAIL_MAX_POINTS + LIVE_TREND_CONTEXT_MAX_POINTS;
  while (boundedStart > 0
    && compacted.length - boundedStart < maximumEvidence) boundedStart -= 1;
  const hasEarlierSegmentEvidence = hasEarlierRawSegmentEvidence || boundedStart > 0;
  const boundedEvidence = compacted.slice(boundedStart);
  const mutableStart = mutableTailStartIndex(boundedEvidence);
  const contextStart = Math.max(0, mutableStart - LIVE_TREND_CONTEXT_MAX_POINTS);
  const recoveryAccuracies = boundedEvidence.flatMap(candidate => (
    candidate.accuracy != null && Number.isFinite(candidate.accuracy) && candidate.accuracy > 0
      ? [candidate.accuracy]
      : []
  )).sort((left, right) => left - right);
  const recoveryUncertaintyM = recoveryAccuracies.length > 0
    ? recoveryAccuracies[Math.floor(recoveryAccuracies.length / 2)]
    : 8;
  const recoverySupportedKeys = new Set(protectedIndices(
    boundedEvidence,
    recoveryUncertaintyM,
    false,
  ).filter(index => index > 0 && index < boundedEvidence.length - 1)
    .map(index => presentationEvidenceKey(boundedEvidence[index])));
  if (!hasEarlierSegmentEvidence) {
    recoverySupportedKeys.add(presentationEvidenceKey(boundedEvidence[0]));
  }
  const oldestRecoveryEvidenceT = boundedEvidence[0]?.t
    ?? canonical[canonical.length - 1].t;
  let liveTailStart = 0;
  for (let index = 0; index < live.length; index += 1) {
    const candidate = live[index];
    if (
      (candidate.segmentId ?? '__legacy') !== segmentId
      || candidate.t < oldestRecoveryEvidenceT
      || candidate.liveTrendConfirmed === true
      || candidate.livePresentationSettled === true
      || recoverySupportedKeys.has(presentationEvidenceKey(candidate))
    ) liveTailStart = index + 1;
  }
  const recoveredFrozen = live.slice(0, liveTailStart).map((candidate, index) => {
    if (candidate.liveTrendConfirmed || candidate.livePresentationSettled) return candidate;
    const key = presentationEvidenceKey(candidate);
    if (index === 0) return candidate;
    return recoverySupportedKeys.has(key)
      ? confirmedPresentationPoint(candidate)
      : settledPresentationPoint(candidate);
  });
  return {
    frozen: recoveredFrozen,
    frozenEvidenceKeys: new Set(recoveredFrozen.map(presentationEvidenceKey)),
    liveTail: live.slice(liveTailStart),
    segmentEvidence: boundedEvidence.slice(contextStart),
    segmentId,
    segmentHasPriorEvidence: hasEarlierSegmentEvidence || contextStart > 0,
  };
}

export function appendCausalLiveReplayPoint(state: CausalLiveReplayCheckpoint, point: TrackPoint): void {
    const nextSegmentId = point.segmentId ?? '__legacy';
    if (state.segmentId !== nextSegmentId) {
      const resolvedBoundary = resolvedBoundaryPresentationPoint(state.segmentEvidence);
      if (resolvedBoundary != null) {
        // Insert the resolved endpoint first. The mutable tail can contain the
        // same observation identity with its earlier provisional coordinate;
        // first-write identity fencing prevents that stale display coordinate
        // from replacing the evidence-driven boundary settlement below.
        insertFrozenPresentationPoint(
          state,
          settledPresentationPoint(resolvedBoundary),
        );
      }
      for (const candidate of state.liveTail) {
        const resolved = resolvedExpiredPresentationPoint(
          state.segmentEvidence,
          candidate,
        ) ?? candidate;
        insertFrozenPresentationPoint(
          state,
          settledPresentationPoint(resolved),
        );
      }
      state.liveTail = [];
      state.segmentEvidence = [];
      state.segmentId = nextSegmentId;
      state.segmentHasPriorEvidence = false;
    }
    const previousEvidenceT = state.segmentEvidence.at(-1)?.t ?? null;
    appendPresentationEvidence(state.segmentEvidence, point);
    const mutableStart = mutableTailStartIndex(state.segmentEvidence);
    const cutoffT = state.segmentEvidence[mutableStart]?.t ?? point.t;
    const contextStart = Math.max(0, mutableStart - LIVE_TREND_CONTEXT_MAX_POINTS);
    const accuracies = state.segmentEvidence.flatMap(candidate => (
      candidate.accuracy != null && Number.isFinite(candidate.accuracy) && candidate.accuracy > 0
        ? [candidate.accuracy]
        : []
    )).sort((left, right) => left - right);
    const uncertaintyM = accuracies.length > 0
      ? accuracies[Math.floor(accuracies.length / 2)]
      : 8;
    const gapBoundaryOnlyIndices = new Set<number>();
    const allProtectedIndices = protectedIndices(
      state.segmentEvidence,
      uncertaintyM,
      true,
      gapBoundaryOnlyIndices,
    );
    const supportedIndices = new Set(allProtectedIndices.filter(index => (
      index > 0
      && index < state.segmentEvidence.length - 1
      && !gapBoundaryOnlyIndices.has(index)
    )));
    const presentationProtectedIndices = new Set(allProtectedIndices);
    const supportedKeys = new Set(Array.from(supportedIndices).map(index => (
      presentationEvidenceKey(state.segmentEvidence[index])
    )));
    if (!state.segmentHasPriorEvidence) {
      supportedKeys.add(presentationEvidenceKey(state.segmentEvidence[0]));
    }
    const evidenceWindow = state.segmentEvidence.slice(contextStart);
    const evidenceWindowProtectedIndices = Array.from(presentationProtectedIndices)
      .map(index => index - contextStart)
      .filter(index => index > 0 && index < evidenceWindow.length - 1);
    evidenceWindowProtectedIndices.unshift(0);
    evidenceWindowProtectedIndices.push(evidenceWindow.length - 1);
    const confirmedFreezeBoundaryIndex = supportedIndices.has(mutableStart)
      ? mutableStart - contextStart
      : null;
    const nextPresentation = simplifyTail(
      evidenceWindow,
      !state.segmentHasPriorEvidence && contextStart === 0,
      // A time/distance window boundary is not itself movement evidence. Keep
      // the exact sample only when the current window independently confirms
      // it as a supported turn; an unsupported drift remains simplified.
      confirmedFreezeBoundaryIndex != null && confirmedFreezeBoundaryIndex >= 0
        ? confirmedFreezeBoundaryIndex
        : null,
      evidenceWindowProtectedIndices,
    );
    // Apply evidence-confirmed turns before any resource/window settlement in
    // this same reducer step. Otherwise first-write identity fencing lets a
    // robustly shifted `settled` point steal the identity of the exact corner,
    // permanently flattening a genuine turn that is already supported.
    for (const candidate of nextPresentation) {
      const candidateKey = presentationEvidenceKey(candidate);
      if (
        candidate.t < point.t
        && supportedKeys.has(candidateKey)
        && !state.frozenEvidenceKeys.has(candidateKey)
      ) {
        const preserveFirstReference = state.frozen.length === 0
          && candidate.t === state.segmentEvidence[0]?.t;
        const confirmed = confirmedPresentationPoint(candidate, preserveFirstReference);
        insertFrozenPresentationPoint(state, confirmed);
      }
    }
    const closesSilenceGap = previousEvidenceT != null
      && point.t - previousEvidenceT >= LIVE_PRESENTATION_GAP_BOUNDARY_MS;
    if (closesSilenceGap) {
      const beforeGapEvidence = state.segmentEvidence.slice(0, -1);
      const resolvedBoundary = resolvedBoundaryPresentationPoint(
        beforeGapEvidence,
      );
      if (resolvedBoundary != null) {
        insertFrozenPresentationPoint(
          state,
          settledPresentationPoint(resolvedBoundary),
        );
      }
      for (const candidate of state.liveTail) {
        const resolved = resolvedExpiredPresentationPoint(
          beforeGapEvidence,
          candidate,
        ) ?? candidate;
        insertFrozenPresentationPoint(
          state,
          settledPresentationPoint(resolved),
        );
      }
    }
    // Every previously visible vertex that leaves the triple-bounded mutable
    // tail is either resolved against current symmetric evidence or was
    // already frozen. Never copy a stale provisional coordinate into history,
    // and never allow an unmarked >15 s vertex to disappear on a later frame.
    for (const candidate of state.liveTail) {
      const candidateKey = presentationEvidenceKey(candidate);
      if (
        closesSilenceGap
        || candidate.t >= cutoffT
        || state.frozenEvidenceKeys.has(candidateKey)
      ) continue;
      const resolved = resolvedExpiredPresentationPoint(
        state.segmentEvidence,
        candidate,
      );
      if (resolved != null) {
        insertFrozenPresentationPoint(
          state,
          settledPresentationPoint(resolved),
        );
      }
    }
    // Periodically settle a resource-bounded display anchor from symmetric
    // evidence around an observation that has left the mutable tail. The
    // observation identity and timestamp remain intact, while its display-only
    // coordinate is projected onto the locally supported trend. This keeps a
    // long route complete without freezing a transient lateral excursion.
    // Resource expiry still does not mean trend confirmation.
    const settlementIndex = mutableStart - 1;
    const settlementSource = settlementIndex >= 0
      ? state.segmentEvidence[settlementIndex]
      : null;
    const settlementKey = settlementSource == null
      ? null
      : presentationEvidenceKey(settlementSource);
    let precedingFrozen: TrackPoint | null = null;
    if (settlementSource != null) {
      for (let index = state.frozen.length - 1; index >= 0; index -= 1) {
        const candidate = state.frozen[index];
        if (
          candidate.t < settlementSource.t
          && (candidate.segmentId ?? '__legacy') === nextSegmentId
        ) {
          precedingFrozen = candidate;
          break;
        }
      }
    }
    const needsSettledAnchor = settlementSource != null && (
      precedingFrozen == null
      || settlementSource.t - precedingFrozen.t >= LIVE_SETTLED_ANCHOR_MAX_AGE_MS
      || displayDistanceM(precedingFrozen, settlementSource)
        >= LIVE_SETTLED_ANCHOR_MAX_DISTANCE_M
    );
    if (
      settlementSource != null
      && settlementKey != null
      && !supportedKeys.has(settlementKey)
      && !state.frozenEvidenceKeys.has(settlementKey)
      && needsSettledAnchor
    ) {
      const locallySettled = localTrendSettlementCandidate(
        state.segmentEvidence,
        settlementIndex,
      );
      if (locallySettled != null) {
        insertFrozenPresentationPoint(
          state,
          settledPresentationPoint(locallySettled),
        );
      }
    }
    const latestFrozenT = state.frozen.at(-1)?.t ?? Number.NEGATIVE_INFINITY;
    state.liveTail = nextPresentation.filter(candidate => (
      candidate.t > latestFrozenT && candidate.t >= cutoffT
    ));
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
