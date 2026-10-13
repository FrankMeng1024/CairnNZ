import type { RoutePoint } from '../../store/useRouteStore';
import {
  ROUTE_ATTACHMENT_TOLERANCE_M,
  appendOrderedSegment,
  bridgeOrderedGap,
  compareOrderedPositions,
  normalizeOrderedPoints,
  prependOrderedSegment,
  orderedIntervalCrossesGap,
  orderedPositionPoint,
  replaceOrderedInterval,
  routePointDistanceM,
  type EditableRouteResolution,
  type OrderedPosition,
  type OrderedRouteDraft,
  type RouteEditResult,
} from './orderedRouteDraft';

export interface RouteAnchorCandidate extends OrderedPosition {
  distanceM: number;
  point: RoutePoint;
}

export interface RouteIntervalCandidate {
  id: string;
  start: OrderedPosition;
  end: OrderedPosition;
  reverseCandidate: boolean;
}

export type DrawTransactionIntent =
  | { kind: 'new' }
  | { kind: 'append' }
  | { kind: 'prepend' }
  | { kind: 'bridge'; gapId: string; reverseCandidate: boolean }
  | { kind: 'replace'; options: RouteIntervalCandidate[] }
  | { kind: 'pending-bridge'; gapId: string; points: RoutePoint[]; draftId: string; baseRevision: number }
  | { kind: 'pending-replace'; points: RoutePoint[]; draftId: string; baseRevision: number; ambiguity?: 'overlap' }
  | { kind: 'reject'; code: 'ZERO_LENGTH' | 'DISCONNECTED' | 'AMBIGUOUS_INTERVAL' | 'STALE_TRANSACTION' };

function projectToSegment(point: RoutePoint, a: RoutePoint, b: RoutePoint): {
  fraction: number;
  point: RoutePoint;
  distanceM: number;
} {
  const latRad = point.lat * Math.PI / 180;
  const metresPerLat = 111_000;
  const metresPerLng = metresPerLat * Math.cos(latRad);
  const ax = (a.lng - point.lng) * metresPerLng;
  const ay = (a.lat - point.lat) * metresPerLat;
  const bx = (b.lng - point.lng) * metresPerLng;
  const by = (b.lat - point.lat) * metresPerLat;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
  const projected = {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lng: a.lng + (b.lng - a.lng) * fraction,
    ...(typeof a.alt === 'number' && typeof b.alt === 'number'
      ? { alt: a.alt + (b.alt - a.alt) * fraction }
      : {}),
  };
  return { fraction, point: projected, distanceM: routePointDistanceM(point, projected) };
}

function positionKey(position: OrderedPosition): string {
  return `${position.partId}:${position.pointIndex}:${(position.fraction ?? 0).toFixed(6)}`;
}

export function nearestOrderedPositions(
  draft: OrderedRouteDraft,
  point: RoutePoint,
  toleranceM = ROUTE_ATTACHMENT_TOLERANCE_M,
): RouteAnchorCandidate[] {
  const candidates: RawAnchorCandidate[] = [];
  let partOffsetM = 0;
  let connectedGroup = 0;
  for (let partIndex = 0; partIndex < draft.parts.length; partIndex += 1) {
    const part = draft.parts[partIndex];
    let segmentOffsetM = 0;
    for (let pointIndex = 0; pointIndex < part.points.length - 1; pointIndex += 1) {
      const projected = projectToSegment(point, part.points[pointIndex], part.points[pointIndex + 1]);
      const segmentLengthM = routePointDistanceM(part.points[pointIndex], part.points[pointIndex + 1]);
      const projectedArcM = partOffsetM + segmentOffsetM + projected.fraction * segmentLengthM;
      segmentOffsetM += segmentLengthM;
      if (projected.distanceM > toleranceM) continue;
      let anchorIndex = pointIndex;
      let fraction = projected.fraction;
      if (routePointDistanceM(projected.point, part.points[pointIndex]) <= 0.35) fraction = 0;
      else if (routePointDistanceM(projected.point, part.points[pointIndex + 1]) <= 0.35) {
        anchorIndex = pointIndex + 1;
        fraction = 0;
      }
      const anchor = { partId: part.id, pointIndex: anchorIndex, ...(fraction > 0 ? { fraction } : {}) };
      const key = positionKey(anchor);
      const existing = candidates.find(candidate => positionKey(candidate) === key);
      const rawCandidate: RawAnchorCandidate = {
        ...anchor,
        point: fraction > 0 ? projected.point : { ...part.points[anchorIndex] },
        distanceM: projected.distanceM,
        partIndex,
        segmentIndex: pointIndex,
        segmentFraction: projected.fraction,
        connectedGroup,
        arcM: projectedArcM,
        tangent: segmentTangent(part.points[pointIndex], part.points[pointIndex + 1]),
      };
      if (!existing || projected.distanceM < existing.distanceM) {
        if (existing) candidates.splice(candidates.indexOf(existing), 1);
        candidates.push(rawCandidate);
      }
    }
    partOffsetM += segmentOffsetM;
    if (draft.gaps.some(gap => gap.afterPartId === part.id)) connectedGroup += 1;
  }
  const ordered = candidates.sort((a, b) => a.partIndex - b.partIndex
    || a.segmentIndex - b.segmentIndex || a.segmentFraction - b.segmentFraction || a.distanceM - b.distanceM);
  const clusters: RawAnchorCandidate[][] = [];
  for (const candidate of ordered) {
    const last = clusters.at(-1);
    if (last && sameLocalOrderedHit(last.at(-1)!, candidate)) last.push(candidate);
    else clusters.push([candidate]);
  }
  return clusters
    .map(cluster => cluster.reduce((best, candidate) => candidate.distanceM < best.distanceM ? candidate : best))
    .map(({ partIndex: _partIndex, segmentIndex: _segmentIndex, segmentFraction: _segmentFraction, connectedGroup: _connectedGroup, arcM: _arcM, tangent: _tangent, ...candidate }) => candidate)
    .sort((a, b) => a.distanceM - b.distanceM
      || a.partId.localeCompare(b.partId) || a.pointIndex - b.pointIndex || (a.fraction ?? 0) - (b.fraction ?? 0));
}

interface RawAnchorCandidate extends RouteAnchorCandidate {
  partIndex: number;
  segmentIndex: number;
  segmentFraction: number;
  connectedGroup: number;
  arcM: number;
  tangent: { x: number; y: number };
}

function segmentTangent(a: RoutePoint, b: RoutePoint): { x: number; y: number } {
  const latitude = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const x = (b.lng - a.lng) * Math.cos(latitude);
  const y = b.lat - a.lat;
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function sameLocalOrderedHit(a: RawAnchorCandidate, b: RawAnchorCandidate): boolean {
  if (a.partIndex === b.partIndex && a.segmentIndex === b.segmentIndex) return true;
  const tangentDot = a.tangent.x * b.tangent.x + a.tangent.y * b.tangent.y;
  return a.connectedGroup === b.connectedGroup
    && b.arcM - a.arcM <= 4.1
    && tangentDot > -0.25
    && routePointDistanceM(a.point, b.point) <= 4.1;
}

function terminalPoint(draft: OrderedRouteDraft): RoutePoint | undefined {
  return draft.parts.at(-1)?.points.at(-1) ?? draft.startPoint;
}

function initialPoint(draft: OrderedRouteDraft): RoutePoint | undefined {
  return draft.parts[0]?.points[0] ?? draft.startPoint;
}

function pointToLineDistanceM(point: RoutePoint, line: RoutePoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < line.length - 1; index += 1) {
    best = Math.min(best, projectToSegment(point, line[index], line[index + 1]).distanceM);
  }
  return best;
}

function directionPenalty(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint): number {
  const first = segmentTangent(a, b);
  const second = segmentTangent(c, d);
  return 1 - Math.max(-1, Math.min(1, first.x * second.x + first.y * second.y));
}

function intervalPoints(draft: OrderedRouteDraft, option: RouteIntervalCandidate): RoutePoint[] {
  const startPoint = orderedPositionPoint(draft, option.start);
  const endPoint = orderedPositionPoint(draft, option.end);
  if (!startPoint || !endPoint) return [];
  const startPart = draft.parts.findIndex(part => part.id === option.start.partId);
  const endPart = draft.parts.findIndex(part => part.id === option.end.partId);
  const points: RoutePoint[] = [];
  for (let partIndex = startPart; partIndex <= endPart; partIndex += 1) {
    const part = draft.parts[partIndex];
    if (!part) continue;
    const firstIndex = partIndex === startPart
      ? option.start.pointIndex + ((option.start.fraction ?? 0) > 0 ? 1 : 0)
      : 0;
    const lastIndex = partIndex === endPart ? option.end.pointIndex : part.points.length - 1;
    if (partIndex === startPart) points.push(startPoint);
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const point = part.points[index];
      if (point && (!points.length || routePointDistanceM(points.at(-1)!, point) > 0.35)) points.push(point);
    }
    if (partIndex === endPart && routePointDistanceM(points.at(-1)!, endPoint) > 0.35) points.push(endPoint);
  }
  return option.reverseCandidate ? points.reverse() : points;
}

function intervalShapeScore(draft: OrderedRouteDraft, raw: RoutePoint[], option: RouteIntervalCandidate): number {
  const interval = intervalPoints(draft, option);
  if (interval.length < 2 || raw.length < 2) return Number.POSITIVE_INFINITY;
  const step = Math.max(1, Math.floor(raw.length / 12));
  const samples = raw.filter((_, index) => index % step === 0 || index === raw.length - 1);
  const meanDistance = samples.reduce((sum, point) => sum + Math.min(120, pointToLineDistanceM(point, interval)), 0) / samples.length;
  const rawEntry = raw[Math.min(raw.length - 1, Math.max(1, Math.floor(raw.length * 0.15)))];
  const rawExit = raw[Math.max(0, Math.min(raw.length - 2, Math.ceil(raw.length * 0.85) - 1))];
  const oldEntry = interval[Math.min(interval.length - 1, Math.max(1, Math.floor(interval.length * 0.15)))];
  const oldExit = interval[Math.max(0, Math.min(interval.length - 2, Math.ceil(interval.length * 0.85) - 1))];
  return meanDistance
    + (directionPenalty(raw[0], rawEntry, interval[0], oldEntry)
      + directionPenalty(rawExit, raw.at(-1)!, oldExit, interval.at(-1)!)) * 18;
}

function unambiguousInterval(
  draft: OrderedRouteDraft,
  raw: RoutePoint[],
  options: RouteIntervalCandidate[],
): RouteIntervalCandidate | null {
  if (options.length === 1) return options[0];
  const ranked = options.map(option => ({ option, score: intervalShapeScore(draft, raw, option) }))
    .sort((a, b) => a.score - b.score);
  const [best, second] = ranked;
  if (!best || !Number.isFinite(best.score) || !second) return best?.option ?? null;
  // Whole-stroke shape and local direction resolve ordinary crossings. Equal
  // repeated laps stay unresolved; interval length is never the tie-breaker.
  return second.score - best.score >= Math.max(8, best.score * 0.22) ? best.option : null;
}

export function classifyDrawTransaction(
  draft: OrderedRouteDraft,
  raw: RoutePoint[],
  selectedGapId?: string,
  attachmentToleranceM = ROUTE_ATTACHMENT_TOLERANCE_M,
): DrawTransactionIntent {
  if (raw.length < 2) return { kind: 'reject', code: 'ZERO_LENGTH' };
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (selectedGapId) {
    const gap = draft.gaps.find(item => item.id === selectedGapId);
    const leftIndex = gap ? draft.parts.findIndex(part => part.id === gap.afterPartId) : -1;
    const left = leftIndex >= 0 ? draft.parts[leftIndex] : undefined;
    const right = leftIndex >= 0 ? draft.parts[leftIndex + 1] : undefined;
    if (!gap || !left || !right) return { kind: 'reject', code: 'DISCONNECTED' };
    const forward = routePointDistanceM(first, left.points.at(-1)!) <= ROUTE_ATTACHMENT_TOLERANCE_M
      && routePointDistanceM(last, right.points[0]) <= ROUTE_ATTACHMENT_TOLERANCE_M;
    const reverse = routePointDistanceM(last, left.points.at(-1)!) <= ROUTE_ATTACHMENT_TOLERANCE_M
      && routePointDistanceM(first, right.points[0]) <= ROUTE_ATTACHMENT_TOLERANCE_M;
    if (!forward && !reverse) {
      const startsAtLeft = routePointDistanceM(first, left.points.at(-1)!) <= ROUTE_ATTACHMENT_TOLERANCE_M;
      const startsAtRight = routePointDistanceM(first, right.points[0]) <= ROUTE_ATTACHMENT_TOLERANCE_M;
      if ((startsAtLeft || startsAtRight) && normalizeOrderedPoints(raw).length >= 2) {
        return {
          kind: 'pending-bridge', gapId: selectedGapId, points: normalizeOrderedPoints(raw),
          draftId: draft.draftId, baseRevision: draft.revision,
        };
      }
      return { kind: 'reject', code: 'DISCONNECTED' };
    }
    return { kind: 'bridge', gapId: selectedGapId, reverseCandidate: reverse && !forward };
  }
  if (draft.parts.length === 0 && !draft.startPoint) return { kind: 'new' };
  const toleranceM = Math.max(4, Math.min(ROUTE_ATTACHMENT_TOLERANCE_M, attachmentToleranceM));
  const starts = nearestOrderedPositions(draft, first, toleranceM);
  const ends = nearestOrderedPositions(draft, last, toleranceM);
  const options: RouteIntervalCandidate[] = [];
  for (const start of starts) {
    for (const end of ends) {
      const comparison = compareOrderedPositions(draft, start, end);
      if (comparison == null || comparison === 0) continue;
      const forward = comparison < 0;
      const a = forward ? start : end;
      const b = forward ? end : start;
      if (orderedIntervalCrossesGap(draft, a, b)) continue;
      const id = `${positionKey(a)}-${positionKey(b)}`;
      if (!options.some(option => option.id === id)) {
        options.push({
          id,
          start: { partId: a.partId, pointIndex: a.pointIndex, ...(a.fraction != null ? { fraction: a.fraction } : {}) },
          end: { partId: b.partId, pointIndex: b.pointIndex, ...(b.fraction != null ? { fraction: b.fraction } : {}) },
          reverseCandidate: !forward,
        });
      }
    }
  }
  if (options.length > 0) {
    const selected = unambiguousInterval(draft, raw, options);
    if (selected) return { kind: 'replace', options: [selected] };
    return {
      kind: 'pending-replace', points: normalizeOrderedPoints(raw),
      draftId: draft.draftId, baseRevision: draft.revision, ambiguity: 'overlap',
    };
  }
  const terminal = terminalPoint(draft);
  const beginning = initialPoint(draft);
  if (ends.length === 0 && terminal && routePointDistanceM(first, terminal) <= toleranceM) {
    return { kind: 'append' };
  }
  if (ends.length === 0 && beginning && routePointDistanceM(first, beginning) <= toleranceM) {
    return { kind: 'prepend' };
  }
  if (starts.length > 0 && ends.length === 0) {
    return {
      kind: 'pending-replace', points: normalizeOrderedPoints(raw),
      draftId: draft.draftId, baseRevision: draft.revision,
    };
  }
  return { kind: 'reject', code: starts.length > 1 || ends.length > 1 ? 'AMBIGUOUS_INTERVAL' : 'DISCONNECTED' };
}

export function continueDrawTransaction(
  draft: OrderedRouteDraft,
  pending: Extract<DrawTransactionIntent, { kind: 'pending-bridge' | 'pending-replace' }>,
  nextStroke: RoutePoint[],
): DrawTransactionIntent {
  if (pending.draftId !== draft.draftId || pending.baseRevision !== draft.revision) {
    return { kind: 'reject', code: 'STALE_TRANSACTION' };
  }
  const next = normalizeOrderedPoints(nextStroke);
  if (next.length < 2) return { kind: 'reject', code: 'ZERO_LENGTH' };
  const terminal = pending.points.at(-1);
  if (!terminal || routePointDistanceM(terminal, next[0]) > ROUTE_ATTACHMENT_TOLERANCE_M) {
    return { kind: 'reject', code: 'DISCONNECTED' };
  }
  const merged = normalizeOrderedPoints([...pending.points, ...next]);
  if (merged.length > 5_000) return { kind: 'reject', code: 'DISCONNECTED' };
  return classifyDrawTransaction(
    draft,
    merged,
    pending.kind === 'pending-bridge' ? pending.gapId : undefined,
  );
}

function orient(points: RoutePoint[], reverse: boolean): RoutePoint[] {
  return reverse ? [...points].reverse().map(point => ({ ...point })) : points;
}

export function applyDrawTransaction(
  draft: OrderedRouteDraft,
  intent: Exclude<DrawTransactionIntent, { kind: 'replace' | 'reject' }>
    | { kind: 'replace'; option: RouteIntervalCandidate },
  candidate: RoutePoint[],
  resolution: EditableRouteResolution,
): RouteEditResult {
  if (intent.kind === 'pending-bridge' || intent.kind === 'pending-replace') {
    return { ok: false, code: 'INVALID_INTERVAL', draft };
  }
  if (intent.kind === 'new' || intent.kind === 'append') {
    return appendOrderedSegment(draft, candidate, resolution);
  }
  if (intent.kind === 'prepend') {
    return prependOrderedSegment(draft, [...candidate].reverse(), resolution);
  }
  if (intent.kind === 'bridge') {
    return bridgeOrderedGap(draft, intent.gapId, orient(candidate, intent.reverseCandidate), resolution);
  }
  return replaceOrderedInterval(
    draft,
    intent.option.start,
    intent.option.end,
    orient(candidate, intent.option.reverseCandidate),
    resolution,
  );
}
