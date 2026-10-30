import type { TrackPoint } from '../../store/useSessionStore';

/** Live may settle only the immediately recent display tail. Canonical truth
 * is untouched, and Finish can still refine the complete Activity. */
export const LIVE_MUTABLE_TAIL_MAX_POINTS = 10;
export const LIVE_MUTABLE_TAIL_MAX_AGE_MS = 15_000;
export const LIVE_MUTABLE_TAIL_MAX_DISTANCE_M = 18;
// Presentation evidence is compacted to at most three samples per second.
export const LIVE_TREND_CONTEXT_MAX_POINTS = 10;
const LIVE_COVERAGE_SETTLEMENT_SCAN_MAX_POINTS = 5;
const LIVE_RECENT_CANONICAL_MAX_POINTS = 32;
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

function continuousEvidenceTravelM(
  evidence: ReadonlyArray<TrackPoint>,
  from: TrackPoint,
  through: TrackPoint,
): number | null {
  let previous = from;
  let travelledM = 0;
  for (const candidate of evidence) {
    if (candidate.t <= from.t) continue;
    if (candidate.t > through.t) break;
    if (
      (candidate.segmentId ?? '__legacy') !== (from.segmentId ?? '__legacy')
      || candidate.t - previous.t >= LIVE_PRESENTATION_GAP_BOUNDARY_MS
    ) return null;
    travelledM += displayDistanceM(previous, candidate);
    previous = candidate;
  }
  return previous.t === through.t ? travelledM : null;
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
  if (preserveReference && !point.livePresentationProvisional) return point;
  const { livePresentationProvisional: _provisional, ...durable } = point;
  if (point.liveTrendConfirmed) return durable;
  return { ...durable, liveTrendConfirmed: true };
}

function settledPresentationPoint(point: TrackPoint): TrackPoint {
  const { livePresentationProvisional: _provisional, ...durable } = point;
  if (point.liveTrendConfirmed || point.livePresentationSettled) return durable;
  return { ...durable, livePresentationSettled: true };
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

function incomingSilenceGapEvidenceKeys(
  canonical: ReadonlyArray<TrackPoint>,
  startIndex: number,
): Set<string> {
  const keys = new Set<string>();
  for (let index = Math.max(1, startIndex); index < canonical.length; index += 1) {
    const previous = canonical[index - 1];
    const point = canonical[index];
    if (
      (previous.segmentId ?? '__legacy') === (point.segmentId ?? '__legacy')
      && point.t - previous.t >= LIVE_PRESENTATION_GAP_BOUNDARY_MS
    ) keys.add(presentationEvidenceKey(point));
  }
  return keys;
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

/** Clean continuous curvature can be confirmed cheaply from consistent local
 * turn evidence. Keep this fast path; the wider coverage fallback below is for
 * valid movement whose short-edge bearings are destabilized by uncertainty. */
function sustainedCurvatureSettlementCandidate(
  evidence: ReadonlyArray<TrackPoint>,
  candidateIndex: number,
): TrackPoint | null {
  const startIndex = candidateIndex - 3;
  const endIndex = candidateIndex + 3;
  if (startIndex < 0 || endIndex >= evidence.length) return null;
  const window = evidence.slice(startIndex, endIndex + 1);
  for (let index = 1; index < window.length; index += 1) {
    if (window[index].t - window[index - 1].t >= LIVE_PRESENTATION_GAP_BOUNDARY_MS) {
      return null;
    }
  }
  const edgeDistances = window.slice(1).map((point, index) => (
    displayDistanceM(window[index], point)
  ));
  const approachM = edgeDistances.slice(0, 3).reduce((sum, value) => sum + value, 0);
  const departureM = edgeDistances.slice(3).reduce((sum, value) => sum + value, 0);
  if (approachM < 3 || departureM < 3) return null;

  const signedTurns: number[] = [];
  for (let index = 1; index < window.length - 1; index += 1) {
    if (edgeDistances[index - 1] < 0.5 || edgeDistances[index] < 0.5) continue;
    signedTurns.push(
      ((bearing(window[index], window[index + 1])
        - bearing(window[index - 1], window[index]) + 540) % 360) - 180,
    );
  }
  const meaningful = signedTurns.filter(turn => Math.abs(turn) >= 1.5);
  if (meaningful.length < 3) return null;
  const positive = meaningful.filter(turn => turn > 0);
  const negative = meaningful.filter(turn => turn < 0);
  const dominant = positive.length >= negative.length ? positive : negative;
  const opposing = positive.length >= negative.length ? negative : positive;
  const totalTurn = Math.abs(dominant.reduce((sum, turn) => sum + turn, 0));
  if (
    dominant.length < 3
    || dominant.length < Math.ceil(meaningful.length * 0.75)
    || totalTurn < 10
    || opposing.some(turn => Math.abs(turn) >= 8)
  ) return null;
  return evidence[candidateIndex];
}

/**
 * Resource expiry is not trend confirmation, but bounded presentation state
 * still needs conservative coverage anchors. Short-edge bearings are too
 * sensitive to ordinary walking GPS uncertainty: a real smooth curve can
 * alternate local turn signs even though the wider traversed corridor is
 * unambiguous. Use distance-sized evidence on both sides instead.
 *
 * The accepted candidate is retained only when the surrounding path departs
 * materially from its chord, that departure persists over travelled distance
 * on one side, and the traversed path has non-trivial excess over the chord.
 * A single spike or a brief uncertainty-sized excursion has too little spatial
 * support. No coordinate is predicted or moved, and canonical authority is
 * never changed.
 */
function supportedPathCoverageCandidateAt(
  evidence: ReadonlyArray<TrackPoint>,
  candidateIndex: number,
  precedingFrozen: TrackPoint | null,
): TrackPoint | null {
  if (candidateIndex <= 0 || candidateIndex >= evidence.length - 1) return null;
  const accuracies = evidence.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  )).sort((left, right) => left - right);
  const uncertaintyM = accuracies.length > 0
    ? accuracies[Math.floor(accuracies.length / 2)]
    : 8;
  // The checkpoint retains five immutable-context samples before the bounded
  // mutable tail. Scale support by physical travel rather than sample count,
  // while keeping ordinary walking uncertainty able to establish evidence
  // inside that fixed memory budget.
  const supportTargetM = Math.max(8, Math.min(18, uncertaintyM * 1.5));

  let startIndex = candidateIndex;
  let approachM = 0;
  while (startIndex > 0 && approachM < supportTargetM) {
    if (evidence[startIndex].t - evidence[startIndex - 1].t
      >= LIVE_PRESENTATION_GAP_BOUNDARY_MS) return null;
    approachM += displayDistanceM(evidence[startIndex - 1], evidence[startIndex]);
    startIndex -= 1;
  }
  let endIndex = candidateIndex;
  let departureM = 0;
  while (endIndex < evidence.length - 1 && departureM < supportTargetM) {
    if (evidence[endIndex + 1].t - evidence[endIndex].t
      >= LIVE_PRESENTATION_GAP_BOUNDARY_MS) return null;
    departureM += displayDistanceM(evidence[endIndex], evidence[endIndex + 1]);
    endIndex += 1;
  }
  const hasPriorAnchor = precedingFrozen != null
    && (precedingFrozen.segmentId ?? '__legacy')
      === (evidence[candidateIndex].segmentId ?? '__legacy')
    && precedingFrozen.t < evidence[candidateIndex].t;
  if ((!hasPriorAnchor && approachM < supportTargetM) || departureM < supportTargetM) return null;

  const corridorStart = hasPriorAnchor ? precedingFrozen : evidence[startIndex];
  const corridorEnd = evidence[endIndex];
  const candidateOffsetM = signedCrossTrackDistanceM(
    evidence[candidateIndex],
    corridorStart,
    corridorEnd,
  );
  const side = Math.sign(candidateOffsetM);
  // Coverage settlement is a conservative escape hatch, not the normal turn
  // detector. Geometry that stays inside the reported uncertainty envelope
  // is fundamentally ambiguous (a true shallow bend and correlated lateral
  // drift are observationally equivalent over a short window), so it cannot
  // become immutable through this fallback alone. Sustained paths eventually
  // accumulate cross-scale displacement beyond that envelope; exact turns
  // continue to use the earlier direction/turn evidence gates.
  const coverageThresholdM = Math.max(2.5, Math.min(12, uncertaintyM * 0.55));
  if (side === 0 || Math.abs(candidateOffsetM) < coverageThresholdM) return null;

  const cumulativeM = [0];
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    cumulativeM.push(cumulativeM[cumulativeM.length - 1]
      + displayDistanceM(evidence[index - 1], evidence[index]));
  }
  // When an older frozen anchor defines the chord, the first retained
  // evidence point is an interior observation and can provide genuine spatial
  // support. With a local chord it is the endpoint and therefore contributes
  // no deviation evidence.
  const supportStartIndex = hasPriorAnchor ? startIndex : startIndex + 1;
  const supportedOffsets = evidence
    .slice(supportStartIndex, endIndex)
    .map((point, offset) => ({
      localIndex: supportStartIndex - startIndex + offset,
      signedM: signedCrossTrackDistanceM(point, corridorStart, corridorEnd),
    }))
    .filter(value => Math.sign(value.signedM) === side
      && Math.abs(value.signedM) >= coverageThresholdM * 0.35);
  if (supportedOffsets.length === 0) return null;
  const opposingOffsets = evidence
    .slice(supportStartIndex, endIndex)
    .map((point, offset) => ({
      localIndex: supportStartIndex - startIndex + offset,
      signedM: signedCrossTrackDistanceM(point, corridorStart, corridorEnd),
    }))
    .filter(value => Math.sign(value.signedM) === -side
      && Math.abs(value.signedM) >= coverageThresholdM * 0.35);
  const supportedTravelM = cumulativeM[supportedOffsets.at(-1)!.localIndex]
    - cumulativeM[supportedOffsets[0].localIndex];
  const maximumSupportedDeviationM = Math.max(
    ...supportedOffsets.map(value => Math.abs(value.signedM)),
  );
  const opposingTravelM = opposingOffsets.length < 2
    ? 0
    : cumulativeM[opposingOffsets.at(-1)!.localIndex]
      - cumulativeM[opposingOffsets[0].localIndex];
  const maximumOpposingDeviationM = opposingOffsets.length === 0
    ? 0
    : Math.max(...opposingOffsets.map(value => Math.abs(value.signedM)));
  const localChordM = displayDistanceM(evidence[startIndex], corridorEnd);
  const pathExcessM = cumulativeM.at(-1)! - localChordM;
  if (
    supportedTravelM < supportTargetM * 0.75
    || Math.abs(candidateOffsetM) < maximumSupportedDeviationM * 0.55
    || pathExcessM < Math.max(0.75, uncertaintyM * 0.15)
    // A real local bend remains on one side of its chord. Material support on
    // both sides is instead evidence of an uncertainty-sized oscillation; it
    // must not be promoted merely because each half-wave has enough travel to
    // satisfy the coverage resource gate independently.
    || (opposingTravelM >= supportTargetM * 0.35
      && maximumOpposingDeviationM >= coverageThresholdM * 0.75)
  ) return null;
  return evidence[candidateIndex];
}

function meaningfulPathCoverageSettlementCandidate(
  evidence: ReadonlyArray<TrackPoint>,
  candidateIndex: number,
  precedingFrozen: TrackPoint | null,
): TrackPoint | null {
  // Confirmation can arrive after the exact apex has crossed the mutable
  // boundary. Evaluate the retained immutable context, oldest first, rather
  // than testing only the newest expired sample forever. Otherwise compact
  // loops lose the already-observed lobe/turn simply because its future
  // support arrived one reducer step too late. The scan is bounded by the
  // existing checkpoint context and every candidate must independently pass
  // the spatial-support gate above.
  const firstCandidateIndex = Math.max(
    1,
    candidateIndex - LIVE_COVERAGE_SETTLEMENT_SCAN_MAX_POINTS + 1,
  );
  for (let index = firstCandidateIndex; index <= candidateIndex; index += 1) {
    if (precedingFrozen != null && evidence[index].t <= precedingFrozen.t) continue;
    const supported = supportedPathCoverageCandidateAt(
      evidence,
      index,
      precedingFrozen,
    );
    if (supported != null) return supported;
  }
  return null;
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
  if (
    isNearUncertaintyBoundedOscillation(evidence, index)
  ) return null;
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

function hasScalarInconsistentAlternatingMotion(
  evidence: ReadonlyArray<TrackPoint>,
): boolean {
  if (evidence.length < 7) return false;
  const elapsedSeconds = (evidence.at(-1)!.t - evidence[0].t) / 1_000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return false;
  const speeds = evidence.flatMap(point => (
    point.speed != null && Number.isFinite(point.speed) && point.speed >= 0.5
      ? [point.speed]
      : []
  )).sort((left, right) => left - right);
  if (speeds.length < 3) return false;
  const reportedSpeedMps = speeds[Math.floor(speeds.length / 2)];
  const pathM = evidence.slice(1).reduce((sum, point, index) => (
    sum + displayDistanceM(evidence[index], point)
  ), 0);
  const coordinatePathSpeedMps = pathM / elapsedSeconds;
  // Scalar speed cannot reject a coordinate by itself. Combined with several
  // alternating curvature reversals, however, a materially inflated
  // coordinate-path speed is corroborating evidence that uncertainty-sized
  // lateral motion is sensor wobble rather than meaningful travel.
  if (coordinatePathSpeedMps <= Math.max(2.2, reportedSpeedMps * 1.5 + 0.1)) return false;
  const turnSigns = evidence.slice(1, -1).flatMap((_point, offset) => {
    const index = offset + 1;
    const incoming = bearing(evidence[index - 1], evidence[index]);
    const outgoing = bearing(evidence[index], evidence[index + 1]);
    const signed = ((outgoing - incoming + 540) % 360) - 180;
    return Math.abs(signed) >= 1.5 ? [Math.sign(signed)] : [];
  });
  const alternatingTurnCount = turnSigns.slice(1)
    .filter((sign, index) => sign !== turnSigns[index]).length;
  if (turnSigns.length < 5 || alternatingTurnCount < 3) return false;
  const accuracies = evidence.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  )).sort((left, right) => left - right);
  const uncertaintyM = accuracies.length > 0
    ? accuracies[Math.floor(accuracies.length / 2)]
    : 8;
  const corridorStart = evidence[0];
  const corridorEnd = evidence.at(-1)!;
  const chordM = displayDistanceM(corridorStart, corridorEnd);
  if (chordM < Math.max(6, uncertaintyM * 0.75)) return false;
  const maximumOffsetM = Math.max(...evidence.slice(1, -1).map(point => (
    Math.abs(signedCrossTrackDistanceM(point, corridorStart, corridorEnd))
  )), 0);
  return maximumOffsetM <= Math.max(14, uncertaintyM * 1.75)
    && pathM - chordM >= Math.max(4, uncertaintyM * 0.6);
}

function hasCoordinateOnlyStraightOscillation(
  evidence: ReadonlyArray<TrackPoint>,
): boolean {
  if (evidence.length < 7) return false;
  const accuracies = evidence.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  )).sort((left, right) => left - right);
  const uncertaintyM = accuracies.length > 0
    ? accuracies[Math.floor(accuracies.length / 2)]
    : 8;
  const start = evidence[0];
  const end = evidence.at(-1)!;
  const chordM = displayDistanceM(start, end);
  // Candidate windows are sized by physical/time support. Requiring a fixed
  // 30 m chord made the same lateral wave pass at dense cadence and fail at
  // sparse cadence. The uncertainty-scaled floor keeps this a corridor test
  // while allowing equivalent movement evidence to classify consistently.
  if (chordM < Math.max(12, uncertaintyM * 1.5)) return false;
  const turnSigns = evidence.slice(1, -1).flatMap((_point, offset) => {
    const index = offset + 1;
    const signed = ((bearing(evidence[index], evidence[index + 1])
      - bearing(evidence[index - 1], evidence[index]) + 540) % 360) - 180;
    return Math.abs(signed) >= 8 ? [Math.sign(signed)] : [];
  });
  const alternatingTurns = turnSigns.slice(1)
    .filter((sign, index) => sign !== turnSigns[index]).length;
  const highFrequencyWobble = turnSigns.length >= 4
    && alternatingTurns >= Math.ceil((turnSigns.length - 1) * 0.35);
  const signedOffsetsM = evidence.slice(1, -1).map(point => (
    signedCrossTrackDistanceM(point, start, end)
  ));
  const sideThresholdM = Math.max(1.5, uncertaintyM * 0.2);
  const twoSidedWobble = Math.max(...signedOffsetsM, 0) >= sideThresholdM
    && Math.min(...signedOffsetsM, 0) <= -sideThresholdM;
  if (!highFrequencyWobble && !twoSidedWobble) return false;
  const straightEnvelopeM = Math.max(4, Math.min(14, uncertaintyM * 1.25));
  const maximumOffsetM = Math.max(...signedOffsetsM.map(Math.abs), 0);
  if (maximumOffsetM > straightEnvelopeM) return false;
  const pathM = evidence.slice(1).reduce((sum, point, index) => (
    sum + displayDistanceM(evidence[index], point)
  ), 0);
  return pathM - chordM >= Math.max(4, uncertaintyM * 0.4);
}

function uncertaintyBoundedWithoutSymmetricSupport(
  evidence: ReadonlyArray<TrackPoint>,
  candidateIndex: number,
): boolean {
  if (candidateIndex <= 0 || candidateIndex >= evidence.length - 1) return false;
  // The caller already retains a hard-bounded trend context. Use all
  // continuous evidence that remains in that context when symmetric support
  // is incomplete; a point-count subwindow would reintroduce cadence
  // dependence precisely when dense sampling consumes the budget fastest.
  let startIndex = 0;
  let endIndex = evidence.length - 1;
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
  if (candidateIndex <= startIndex || candidateIndex >= endIndex) return false;
  const window = evidence.slice(startIndex, endIndex + 1);
  const accuracies = window.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  )).sort((left, right) => left - right);
  const uncertaintyM = accuracies.length > 0
    ? accuracies[Math.floor(accuracies.length / 2)]
    : 8;
  if (
    hasScalarInconsistentAlternatingMotion(window)
    || hasCoordinateOnlyStraightOscillation(window)
    || hasBriefUncertaintyExcursion(window)
  ) return true;
  if (hasCoherentCurvatureEvidence(window, candidateIndex - startIndex)) return false;
  const signedOffsetsM = window.slice(1, -1).map(point => (
    signedCrossTrackDistanceM(point, window[0], window.at(-1)!)
  ));
  const sideThresholdM = Math.max(1.5, uncertaintyM * 0.2);
  const maximumOffsetM = Math.max(...signedOffsetsM.map(Math.abs), 0);
  if (
    Math.max(...signedOffsetsM, 0) >= sideThresholdM
    && Math.min(...signedOffsetsM, 0) <= -sideThresholdM
    && maximumOffsetM <= Math.max(8, uncertaintyM * 1.25)
  ) return true;
  const candidateOffsetM = pointToSegmentDistanceM(
    evidence[candidateIndex],
    evidence[startIndex],
    evidence[endIndex],
  );
  // With incomplete future/approach support, an uncertainty-sized deviation
  // remains provisional. A geometrically material turn or detour can still
  // pass through the ordinary direction/coverage gates; a small excursion
  // cannot become immutable before its return evidence arrives.
  return candidateOffsetM <= Math.max(3, uncertaintyM * 0.85);
}

function hasBriefUncertaintyExcursion(
  evidence: ReadonlyArray<TrackPoint>,
): boolean {
  if (evidence.length < 5) return false;
  const accuracies = evidence.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  )).sort((left, right) => left - right);
  const uncertaintyM = accuracies.length > 0
    ? accuracies[Math.floor(accuracies.length / 2)]
    : 8;
  const start = evidence[0];
  const end = evidence.at(-1)!;
  const chordM = displayDistanceM(start, end);
  if (chordM < Math.max(12, uncertaintyM)) return false;
  const offsetsM = evidence.map(point => pointToSegmentDistanceM(point, start, end));
  const maximumOffsetM = Math.max(...offsetsM);
  if (
    maximumOffsetM < Math.max(2.5, uncertaintyM * 0.25)
    || maximumOffsetM > Math.max(8, uncertaintyM * 1.1)
  ) return false;
  const materialOffsetM = Math.max(1.5, maximumOffsetM * 0.35);
  const supportedIndices = offsetsM.flatMap((offsetM, index) => (
    index > 0 && index < evidence.length - 1 && offsetM >= materialOffsetM
      ? [index]
      : []
  ));
  if (supportedIndices.length === 0) return false;
  const cumulativeM = [0];
  for (let index = 1; index < evidence.length; index += 1) {
    cumulativeM.push(cumulativeM.at(-1)! + displayDistanceM(evidence[index - 1], evidence[index]));
  }
  const totalTravelM = cumulativeM.at(-1)!;
  if (totalTravelM <= 0) return false;
  const supportedTravelM = cumulativeM[supportedIndices.at(-1)!]
    - cumulativeM[supportedIndices[0]];
  // Compare the established corridors outside the excursion itself. Index
  // quartiles are cadence-sensitive after one-second evidence compaction: a
  // dense excursion can occupy most retained indices even though it covers a
  // small fraction of physical travel. The adjacent outside spans express
  // the actual before/after movement and remain valid when one side is near a
  // bounded-context edge.
  const approachIndex = Math.max(1, supportedIndices[0] - 1);
  const departureIndex = Math.min(
    evidence.length - 2,
    supportedIndices.at(-1)! + 1,
  );
  if (
    displayDistanceM(evidence[0], evidence[approachIndex]) < 1
    || displayDistanceM(evidence[departureIndex], evidence.at(-1)!) < 1
  ) return false;
  const approachBearing = bearing(evidence[0], evidence[approachIndex]);
  const departureBearing = bearing(evidence[departureIndex], evidence.at(-1)!);
  if (angleDelta(approachBearing, departureBearing) > 30) return false;
  // A transient bump occupies only a small part of an otherwise established
  // corridor. Sustained curvature, a detour and a switchback distribute their
  // cross-track support across the physical window instead of appearing as a
  // short uncertainty-sized island.
  return supportedTravelM / totalTravelM < 0.45;
}

interface OscillationMaskCacheEntry {
  length: number;
  firstKey: string;
  lastKey: string;
  lastLat: number;
  lastLng: number;
  present: boolean;
}

const oscillationMaskCache = new WeakMap<ReadonlyArray<TrackPoint>, OscillationMaskCacheEntry>();

function hasUncertaintyBoundedOscillation(
  evidence: ReadonlyArray<TrackPoint>,
): boolean {
  if (evidence.length === 0) return false;
  const firstKey = presentationEvidenceKey(evidence[0]);
  const last = evidence.at(-1)!;
  const lastKey = presentationEvidenceKey(last);
  const cached = oscillationMaskCache.get(evidence);
  if (
    cached?.length === evidence.length
    && cached.firstKey === firstKey
    && cached.lastKey === lastKey
    && cached.lastLat === last.lat
    && cached.lastLng === last.lng
  ) return cached.present;
  const present = hasScalarInconsistentAlternatingMotion(evidence)
    || hasCoordinateOnlyStraightOscillation(evidence);
  oscillationMaskCache.set(evidence, {
    length: evidence.length,
    firstKey,
    lastKey,
    lastLat: last.lat,
    lastLng: last.lng,
    present,
  });
  return present;
}

function candidateOscillationWindow(
  evidence: ReadonlyArray<TrackPoint>,
  candidateIndex: number,
): TrackPoint[] | null {
  if (candidateIndex < 0 || candidateIndex >= evidence.length) return null;
  const accuracies = evidence.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  )).sort((left, right) => left - right);
  const uncertaintyM = accuracies.length > 0
    ? accuracies[Math.floor(accuracies.length / 2)]
    : 8;
  const speeds = evidence.flatMap(point => (
    point.speed != null && Number.isFinite(point.speed) && point.speed >= 0.5
      ? [point.speed]
      : []
  )).sort((left, right) => left - right);
  const representativeSpeedMps = speeds.length > 0
    ? speeds[Math.floor(speeds.length / 2)]
    : 1.4;
  // Use a physical baseline that is long enough to distinguish a sustained
  // bend from one half-wave of ordinary walking wobble. This is still bounded
  // by the retained trend context and scales with reported uncertainty rather
  // than sampling density.
  const supportTargetM = Math.max(22, Math.min(36, uncertaintyM * 1.75));
  const minimumSupportDurationMs = Math.max(
    4_000,
    Math.min(12_000, uncertaintyM / representativeSpeedMps * 1_500),
  );
  let startIndex = candidateIndex;
  let endIndex = candidateIndex;
  let approachM = 0;
  let departureM = 0;
  while (startIndex > 0 && (
    approachM < supportTargetM
    || evidence[candidateIndex].t - evidence[startIndex].t < minimumSupportDurationMs
  )) {
    const intervalMs = evidence[startIndex].t - evidence[startIndex - 1].t;
    if (intervalMs >= LIVE_PRESENTATION_GAP_BOUNDARY_MS) break;
    approachM += displayDistanceM(evidence[startIndex - 1], evidence[startIndex]);
    startIndex -= 1;
  }
  while (endIndex < evidence.length - 1 && (
    departureM < supportTargetM
    || evidence[endIndex].t - evidence[candidateIndex].t < minimumSupportDurationMs
  )) {
    const intervalMs = evidence[endIndex + 1].t - evidence[endIndex].t;
    if (intervalMs >= LIVE_PRESENTATION_GAP_BOUNDARY_MS) break;
    departureM += displayDistanceM(evidence[endIndex], evidence[endIndex + 1]);
    endIndex += 1;
  }
  if (
    approachM < Math.max(10, uncertaintyM * 0.9)
    || departureM < Math.max(10, uncertaintyM * 0.9)
    || evidence[candidateIndex].t - evidence[startIndex].t < minimumSupportDurationMs
    || evidence[endIndex].t - evidence[candidateIndex].t < minimumSupportDurationMs
  ) return null;
  return evidence.slice(startIndex, endIndex + 1);
}

/**
 * A wider coherent bend may contain alternating short-edge bearings when GPS
 * uncertainty is similar to the distance between fixes. Detect curvature at
 * two physical scales before allowing a straight-oscillation classifier to
 * veto the candidate. This is candidate-local: uncertainty near one sample
 * never suppresses every supported anchor in the retained window.
 */
function hasCoherentCurvatureEvidence(
  window: ReadonlyArray<TrackPoint>,
  centerIndex: number,
): boolean {
  if (window.length < 5) return false;
  if (centerIndex <= 0 || centerIndex >= window.length - 1) return false;
  const accuracies = window.flatMap(point => (
    point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0
      ? [point.accuracy]
      : []
  )).sort((left, right) => left - right);
  const uncertaintyM = accuracies.length > 0
    ? accuracies[Math.floor(accuracies.length / 2)]
    : 8;
  const candidate = window[centerIndex];
  const signedTurn = (start: TrackPoint, end: TrackPoint): number => (
    ((bearing(candidate, end) - bearing(start, candidate) + 540) % 360) - 180
  );
  const scaleTurns = [1, 0.75, 0.5].map(scale => {
    const startIndex = Math.max(0, centerIndex - Math.max(1, Math.floor(centerIndex * scale)));
    const endIndex = Math.min(
      window.length - 1,
      centerIndex + Math.max(1, Math.ceil((window.length - 1 - centerIndex) * scale)),
    );
    return signedTurn(window[startIndex], window[endIndex]);
  });
  const outerTurn = scaleTurns[0];
  const outerSign = Math.sign(outerTurn);
  const supportingTurns = scaleTurns.filter(turn => (
    Math.abs(turn) >= 2 && Math.sign(turn) === outerSign
  ));
  const opposingTurns = scaleTurns.filter(turn => (
    Math.abs(turn) >= 2 && Math.sign(turn) === -outerSign
  ));
  if (
    outerSign === 0
    || Math.abs(outerTurn) < 5
    || supportingTurns.length < 2
    || opposingTurns.reduce((sum, turn) => sum + Math.abs(turn), 0)
      > supportingTurns.reduce((sum, turn) => sum + Math.abs(turn), 0) * 0.6
  ) return false;
  const pathM = window.slice(1).reduce((sum, point, index) => (
    sum + displayDistanceM(window[index], point)
  ), 0);
  const chordM = displayDistanceM(window[0], window.at(-1)!);
  const prominenceM = pointToSegmentDistanceM(candidate, window[0], window.at(-1)!);
  // A single half-wave of straight-corridor wobble can look locally curved
  // at the smallest scale. Require the wider chord departure to clear a
  // meaningful fraction of the reported uncertainty before exempting it
  // from the oscillation mask. Sustained curvature accumulates that support
  // naturally; uncertainty-sized alternating drift does not.
  return prominenceM >= Math.max(0.25, uncertaintyM * 0.02)
    // A large-radius curve can have millimetres of arc/chord excess inside the
    // bounded context even though its bearing changes coherently at every
    // scale. The turn-direction and two-sided-wobble gates carry the semantic
    // proof; this epsilon rejects numerical collinearity without erasing slow,
    // broad curves merely because memory is bounded.
    && pathM - chordM >= Math.max(0.01, uncertaintyM * 0.001);
}

function hasCoherentMultiscaleCurvature(
  evidence: ReadonlyArray<TrackPoint>,
  candidateIndex: number,
): boolean {
  const window = candidateOscillationWindow(evidence, candidateIndex);
  if (window == null) return false;
  const candidateKey = presentationEvidenceKey(evidence[candidateIndex]);
  const centerIndex = window.findIndex(point => presentationEvidenceKey(point) === candidateKey);
  return hasCoherentCurvatureEvidence(window, centerIndex);
}

function isNearUncertaintyBoundedOscillation(
  evidence: ReadonlyArray<TrackPoint>,
  candidateIndex: number,
): boolean {
  const window = candidateOscillationWindow(evidence, candidateIndex);
  if (window == null) {
    return uncertaintyBoundedWithoutSymmetricSupport(evidence, candidateIndex);
  }
  if (hasBriefUncertaintyExcursion(window)) return true;
  // Scalar-speed disagreement plus alternating coordinate motion is strong
  // local wobble evidence. A curve exemption is intentionally limited to the
  // coordinate-only straight-corridor classifier so valid Running speed and
  // real bends cannot be flattened by a walking-density assumption.
  if (
    !hasScalarInconsistentAlternatingMotion(window)
    && hasCoherentMultiscaleCurvature(evidence, candidateIndex)
  ) return false;
  evidence = window;
  return hasUncertaintyBoundedOscillation(evidence);
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
  return Array.from(protectedSet).sort((a, b) => a - b).filter(index => (
    index === 0
    || index === points.length - 1
    // Gap endpoints are exact accepted evidence; the absent side cannot
    // provide a symmetric motion check and must never be bridged.
    || points[index].t - points[index - 1].t >= LIVE_PRESENTATION_GAP_BOUNDARY_MS
    || points[index + 1].t - points[index].t >= LIVE_PRESENTATION_GAP_BOUNDARY_MS
    || !isNearUncertaintyBoundedOscillation(points, index)
  ));
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
  recentCanonicalEvidence: TrackPoint[];
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

function settleLiveTailAtEvidenceBoundary(
  state: CausalLiveReplayCheckpoint,
  evidence: ReadonlyArray<TrackPoint>,
): void {
  for (const candidate of state.liveTail) {
    const resolved = resolvedExpiredPresentationPoint(evidence, candidate);
    // A segment or silence boundary limits future evidence; it is not new
    // support for a provisional deviation. If the evidence observed before
    // the boundary cannot resolve that coordinate, discard the display-only
    // revision instead of making it immutable. Intrinsic non-provisional
    // samples remain eligible so genuine accepted boundary geometry is not
    // lost merely because recording continues in a new segment.
    if (resolved == null && candidate.livePresentationProvisional) continue;
    insertFrozenPresentationPoint(
      state,
      settledPresentationPoint(resolved ?? candidate),
    );
  }
}

export function createCausalLiveReplayCheckpoint(
  canonical: ReadonlyArray<TrackPoint> = [],
  live: ReadonlyArray<TrackPoint> = [],
): CausalLiveReplayCheckpoint {
  if (canonical.length === 0) {
    return {
      frozen: [], frozenEvidenceKeys: new Set(), liveTail: [], segmentEvidence: [], segmentId: null,
      recentCanonicalEvidence: [],
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
  const incomingGapKeys = incomingSilenceGapEvidenceKeys(canonical, rawStart);
  const compacted = compactPresentationEvidence(
    canonical.slice(rawStart),
  ).map(point => (
    incomingGapKeys.has(presentationEvidenceKey(point))
      ? { ...point, livePresentationBreakBefore: true as const }
      : point
  ));
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
  const recoveredFrozen = live.slice(0, liveTailStart)
    .flatMap((candidate, index) => {
      if (candidate.livePresentationProvisional) return [];
      if (candidate.liveTrendConfirmed || candidate.livePresentationSettled) return [candidate];
      const key = presentationEvidenceKey(candidate);
      // The first published coordinate is the immutable visual origin of this
      // checkpoint. Preserve it even after the bounded canonical context has
      // advanced beyond it; dropping it makes warm incremental replay diverge
      // from the exact cold replay.
      if (index === 0) return [candidate];
      if (recoverySupportedKeys.has(key)) return [confirmedPresentationPoint(candidate)];
      // Object reconstruction is not movement evidence. An unmarked point can
      // sit before a later durable anchor simply because it was previously in
      // the responsive tail. Resolve it against retained symmetric evidence,
      // or drop it; never turn array position into permanent geometry.
      const resolved = resolvedExpiredPresentationPoint(boundedEvidence, candidate);
      return resolved == null ? [] : [settledPresentationPoint(resolved)];
    });
  return {
    frozen: recoveredFrozen,
    frozenEvidenceKeys: new Set(recoveredFrozen.map(presentationEvidenceKey)),
    liveTail: live.slice(liveTailStart),
    segmentEvidence: boundedEvidence.slice(contextStart),
    // The active segment is the canonical suffix. Slice first so warm
    // incremental reconstruction never scans the full Activity merely to
    // recover the bounded raw-distance frontier.
    recentCanonicalEvidence: canonical
      .slice(-LIVE_RECENT_CANONICAL_MAX_POINTS)
      .filter(candidate => (candidate.segmentId ?? '__legacy') === segmentId),
    segmentId,
    segmentHasPriorEvidence: hasEarlierSegmentEvidence || contextStart > 0,
  };
}

export function appendCausalLiveReplayPoint(state: CausalLiveReplayCheckpoint, sourcePoint: TrackPoint): void {
    const nextSegmentId = sourcePoint.segmentId ?? '__legacy';
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
      settleLiveTailAtEvidenceBoundary(state, state.segmentEvidence);
      state.liveTail = [];
      state.segmentEvidence = [];
      state.recentCanonicalEvidence = [];
      state.segmentId = nextSegmentId;
      state.segmentHasPriorEvidence = false;
    }
    const previousEvidenceT = state.segmentEvidence.at(-1)?.t ?? null;
    const closesSilenceGap = previousEvidenceT != null
      && sourcePoint.t - previousEvidenceT >= LIVE_PRESENTATION_GAP_BOUNDARY_MS;
    // Keep the discontinuity as display provenance on the post-gap point.
    // The canonical observation remains untouched, while later simplification
    // can distinguish a real accepted-evidence gap from an ordinary long span
    // between retained vertices on a continuous path. This does not claim
    // that native or JS callbacks were absent between the accepted fixes.
    const point: TrackPoint = closesSilenceGap
      ? { ...sourcePoint, livePresentationBreakBefore: true }
      : sourcePoint;
    state.recentCanonicalEvidence.push(point);
    if (state.recentCanonicalEvidence.length > LIVE_RECENT_CANONICAL_MAX_POINTS) {
      state.recentCanonicalEvidence = state.recentCanonicalEvidence
        .slice(-LIVE_RECENT_CANONICAL_MAX_POINTS);
    }
    appendPresentationEvidence(state.segmentEvidence, point);
    const mutableStart = mutableTailStartIndex(state.segmentEvidence);
    const rawMutableStart = mutableTailStartIndex(state.recentCanonicalEvidence);
    const cutoffT = Math.max(
      state.segmentEvidence[mutableStart]?.t ?? point.t,
      state.recentCanonicalEvidence[rawMutableStart]?.t ?? point.t,
    );
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
    // Keep the immediately preceding accepted observation in the provisional
    // presentation tail. This provides responsive, revisable movement to the
    // road-aware layer without treating recency as trend confirmation. The
    // point deliberately does not enter `supportedIndices`, so it cannot make
    // mutable geometry authoritative merely because the tail later contracts.
    const responsiveIndex = state.segmentEvidence.length - 2;
    const responsiveApproachIndex = responsiveIndex - 1;
    const responsiveTailDeviationM = responsiveApproachIndex >= 0
      ? pointToSegmentDistanceM(
          state.segmentEvidence[responsiveIndex],
          state.segmentEvidence[responsiveApproachIndex],
          point,
        )
      : 0;
    const responsiveTailTurn = responsiveApproachIndex >= 0
      ? angleDelta(
          bearing(state.segmentEvidence[responsiveApproachIndex], state.segmentEvidence[responsiveIndex]),
          bearing(state.segmentEvidence[responsiveIndex], point),
        )
      : 0;
    const responsiveTailNeedsInterior = responsiveIndex > 0 && (
      responsiveTailDeviationM >= Math.max(0.75, Math.min(2, uncertaintyM * 0.1))
      || responsiveTailTurn >= 15
    );
    if (responsiveTailNeedsInterior) presentationProtectedIndices.add(responsiveIndex);
    const responsiveOnlyKey = responsiveTailNeedsInterior
      && !allProtectedIndices.includes(responsiveIndex)
      ? presentationEvidenceKey(state.segmentEvidence[responsiveIndex])
      : null;
    const supportedKeys = new Set(Array.from(supportedIndices).map(index => (
      presentationEvidenceKey(state.segmentEvidence[index])
    )));
    if (!state.segmentHasPriorEvidence) {
      supportedKeys.add(presentationEvidenceKey(state.segmentEvidence[0]));
    }
    // A long accepted-evidence gap is a display discontinuity even when the
    // Activity segmentId did not change. Once evidence exists on the other side, preserve both exact
    // accepted boundary observations as settled display anchors. They are not
    // movement-trend confirmation, but allowing either endpoint to age out of
    // RDP would make a previously visible gap boundary disappear and could
    // leave the renderer implying a connector across unsupported time.
    for (let index = 0; index < state.segmentEvidence.length; index += 1) {
      const candidate = state.segmentEvidence[index];
      if (candidate.t >= point.t) continue;
      const incomingGap = index > 0
        && candidate.t - state.segmentEvidence[index - 1].t
          >= LIVE_PRESENTATION_GAP_BOUNDARY_MS;
      const outgoingGap = index < state.segmentEvidence.length - 1
        && state.segmentEvidence[index + 1].t - candidate.t
          >= LIVE_PRESENTATION_GAP_BOUNDARY_MS;
      if (incomingGap || outgoingGap) {
        insertFrozenPresentationPoint(
          state,
          settledPresentationPoint(candidate),
        );
      }
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
    // A display vertex that survives uncertainty-scaled RDP and subsequently
    // leaves the raw mutable tail is bounded spatial-coverage evidence. Keep
    // it only after the candidate-local oscillation classifier has ruled out
    // a straight-corridor wobble. This prevents a long gentle bend from
    // repeatedly losing all of its progress as the window advances, without
    // turning resource expiry into movement confirmation.
    for (let index = 1; index < nextPresentation.length - 1; index += 1) {
      const candidate = nextPresentation[index];
      if (candidate.t >= cutoffT) continue;
      const candidateKey = presentationEvidenceKey(candidate);
      if (state.frozenEvidenceKeys.has(candidateKey)) continue;
      if (candidateKey === responsiveOnlyKey) continue;
      const evidenceIndex = presentationEvidenceIndex(state.segmentEvidence, candidate);
      if (
        evidenceIndex <= 0
        || evidenceIndex >= state.segmentEvidence.length - 1
        || isNearUncertaintyBoundedOscillation(state.segmentEvidence, evidenceIndex)
      ) continue;
      insertFrozenPresentationPoint(
        state,
        settledPresentationPoint(candidate),
      );
    }
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
      settleLiveTailAtEvidenceBoundary(state, beforeGapEvidence);
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
        || (candidate.livePresentationProvisional && !supportedKeys.has(candidateKey))
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
    const evidenceTravelSinceFrozenM = settlementSource != null && precedingFrozen != null
      ? continuousEvidenceTravelM(
          state.segmentEvidence,
          precedingFrozen,
          settlementSource,
        )
      : null;
    const needsSettledAnchor = settlementSource != null && (
      precedingFrozen == null
      || settlementSource.t - precedingFrozen.t >= LIVE_SETTLED_ANCHOR_MAX_AGE_MS
      // Net displacement collapses to zero on a loop, reversal or backtrack.
      // Resource settlement therefore follows actual chronological accepted
      // travel. The independent gates below still decide whether any exact
      // sample is safe to retain, so accumulated jitter is not confirmation.
      || (evidenceTravelSinceFrozenM ?? 0) >= LIVE_SETTLED_ANCHOR_MAX_DISTANCE_M
    );
    if (
      settlementSource != null
      && settlementKey != null
      && !supportedKeys.has(settlementKey)
      && !state.frozenEvidenceKeys.has(settlementKey)
      && needsSettledAnchor
      && !isNearUncertaintyBoundedOscillation(state.segmentEvidence, settlementIndex)
    ) {
      const locallySettled = localTrendSettlementCandidate(
        state.segmentEvidence,
        settlementIndex,
      ) ?? sustainedCurvatureSettlementCandidate(
        state.segmentEvidence,
        settlementIndex,
      ) ?? meaningfulPathCoverageSettlementCandidate(
        state.segmentEvidence,
        settlementIndex,
        precedingFrozen,
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
    )).map(candidate => {
      const candidateKey = presentationEvidenceKey(candidate);
      if (
        candidateKey !== responsiveOnlyKey
        || supportedKeys.has(candidateKey)
      ) {
        if (!candidate.livePresentationProvisional) return candidate;
        const { livePresentationProvisional: _provisional, ...intrinsic } = candidate;
        return intrinsic;
      }
      return candidate.livePresentationProvisional
        ? candidate
        : { ...candidate, livePresentationProvisional: true };
    });
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
