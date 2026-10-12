import type { RoutePoint } from '../../store/useRouteStore';
import {
  ROUTE_ATTACHMENT_TOLERANCE_M,
  appendOrderedSegment,
  bridgeOrderedGap,
  replaceOrderedInterval,
  routePointDistanceM,
  type EditableRouteResolution,
  type OrderedPosition,
  type OrderedRouteDraft,
  type RouteEditResult,
} from './orderedRouteDraft';

export interface RouteAnchorCandidate extends OrderedPosition {
  distanceM: number;
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
  | { kind: 'reject'; code: 'ZERO_LENGTH' | 'DISCONNECTED' | 'AMBIGUOUS_INTERVAL' };

export function nearestOrderedPositions(
  draft: OrderedRouteDraft,
  point: RoutePoint,
  toleranceM = ROUTE_ATTACHMENT_TOLERANCE_M,
): RouteAnchorCandidate[] {
  const candidates: RouteAnchorCandidate[] = [];
  for (const part of draft.parts) {
    part.points.forEach((candidate, pointIndex) => {
      const distanceM = routePointDistanceM(point, candidate);
      if (distanceM <= toleranceM) candidates.push({ partId: part.id, pointIndex, distanceM });
    });
  }
  return candidates.sort((a, b) => a.distanceM - b.distanceM
    || a.partId.localeCompare(b.partId) || a.pointIndex - b.pointIndex);
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
    if (!forward && !reverse) return { kind: 'reject', code: 'DISCONNECTED' };
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
      if (start.partId !== end.partId || start.pointIndex === end.pointIndex) continue;
      const forward = start.pointIndex < end.pointIndex;
      const a = forward ? start : end;
      const b = forward ? end : start;
      const id = `${a.partId}:${a.pointIndex}-${b.pointIndex}`;
      if (!options.some(option => option.id === id)) {
        options.push({
          id,
          start: { partId: a.partId, pointIndex: a.pointIndex },
          end: { partId: b.partId, pointIndex: b.pointIndex },
          reverseCandidate: !forward,
        });
      }
    }
  }
  if (options.length > 0) return { kind: 'replace', options };
  return { kind: 'reject', code: starts.length > 1 || ends.length > 1 ? 'AMBIGUOUS_INTERVAL' : 'DISCONNECTED' };
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
