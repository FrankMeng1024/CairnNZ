import type { RoutePoint } from '../../store/useRouteStore';
import {
  ROUTE_ATTACHMENT_TOLERANCE_M,
  appendOrderedSegment,
  bridgeOrderedGap,
  compareOrderedPositions,
  normalizeOrderedPoints,
  orderedIntervalCrossesGap,
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
  | { kind: 'bridge'; gapId: string; reverseCandidate: boolean }
  | { kind: 'replace'; options: RouteIntervalCandidate[] }
  | { kind: 'pending-bridge'; gapId: string; points: RoutePoint[] }
  | { kind: 'pending-replace'; points: RoutePoint[] }
  | { kind: 'reject'; code: 'ZERO_LENGTH' | 'DISCONNECTED' | 'AMBIGUOUS_INTERVAL' };

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
  const candidates: RouteAnchorCandidate[] = [];
  for (const part of draft.parts) {
    for (let pointIndex = 0; pointIndex < part.points.length - 1; pointIndex += 1) {
      const projected = projectToSegment(point, part.points[pointIndex], part.points[pointIndex + 1]);
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
      if (!existing || projected.distanceM < existing.distanceM) {
        if (existing) candidates.splice(candidates.indexOf(existing), 1);
        candidates.push({ ...anchor, point: fraction > 0 ? projected.point : { ...part.points[anchorIndex] }, distanceM: projected.distanceM });
      }
    }
  }
  return candidates.sort((a, b) => a.distanceM - b.distanceM
    || a.partId.localeCompare(b.partId) || a.pointIndex - b.pointIndex || (a.fraction ?? 0) - (b.fraction ?? 0));
}

function terminalPoint(draft: OrderedRouteDraft): RoutePoint | undefined {
  return draft.parts.at(-1)?.points.at(-1) ?? draft.startPoint;
}

export function classifyDrawTransaction(
  draft: OrderedRouteDraft,
  raw: RoutePoint[],
  selectedGapId?: string,
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
        return { kind: 'pending-bridge', gapId: selectedGapId, points: normalizeOrderedPoints(raw) };
      }
      return { kind: 'reject', code: 'DISCONNECTED' };
    }
    return { kind: 'bridge', gapId: selectedGapId, reverseCandidate: reverse && !forward };
  }
  if (draft.parts.length === 0 && !draft.startPoint) return { kind: 'new' };
  const terminal = terminalPoint(draft);
  if (terminal && routePointDistanceM(first, terminal) <= ROUTE_ATTACHMENT_TOLERANCE_M) {
    return { kind: 'append' };
  }
  const starts = nearestOrderedPositions(draft, first);
  const ends = nearestOrderedPositions(draft, last);
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
  if (options.length > 0) return { kind: 'replace', options };
  if (starts.length > 0 && ends.length === 0) return { kind: 'pending-replace', points: normalizeOrderedPoints(raw) };
  return { kind: 'reject', code: starts.length > 1 || ends.length > 1 ? 'AMBIGUOUS_INTERVAL' : 'DISCONNECTED' };
}

export function continueDrawTransaction(
  draft: OrderedRouteDraft,
  pending: Extract<DrawTransactionIntent, { kind: 'pending-bridge' | 'pending-replace' }>,
  nextStroke: RoutePoint[],
): DrawTransactionIntent {
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
