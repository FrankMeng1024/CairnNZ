import type { RoutePoint } from '../../store/useRouteStore';

export type RouteResolution = 'recorded' | 'point' | 'draw-matched' | 'draw-manual' | 'legacy';
export type EditableRouteResolution = 'point' | 'draw-matched' | 'draw-manual';
export type RouteDraftOrigin = 'plan' | 'activity' | 'received-copy';

export interface OrderedRoutePart {
  id: string;
  points: RoutePoint[];
  resolution: RouteResolution;
}

export interface OrderedRouteGap {
  id: string;
  afterPartId: string;
  reason: 'activity-gap';
}

export interface OrderedRouteDraft {
  schemaVersion: 1;
  draftId: string;
  ownerId: string;
  origin: RouteDraftOrigin;
  revision: number;
  /** An explicit start can exist before the first Point/Draw segment. */
  startPoint?: RoutePoint;
  parts: OrderedRoutePart[];
  gaps: OrderedRouteGap[];
}

export interface OrderedPosition {
  partId: string;
  pointIndex: number;
}

export interface RouteDraftSnapshot {
  draft: OrderedRouteDraft;
  operation: string;
}

export interface RouteDraftHistory {
  present: OrderedRouteDraft;
  past: RouteDraftSnapshot[];
}

export interface RouteOperationToken {
  accountId: string;
  draftId: string;
  baseRevision: number;
  operationId: string;
  kind: 'point' | 'draw' | 'replace' | 'bridge';
}

export type RouteEditFailureCode =
  | 'INVALID_COORDINATE'
  | 'ZERO_LENGTH'
  | 'DISCONNECTED'
  | 'AMBIGUOUS_INTERVAL'
  | 'INVALID_INTERVAL'
  | 'NOT_ADJACENT_GAP'
  | 'STALE_OPERATION'
  | 'OWNER_CHANGED'
  | 'UNRESOLVED_GAPS'
  | 'EMPTY_ROUTE';

export type RouteEditResult =
  | { ok: true; draft: OrderedRouteDraft }
  | { ok: false; code: RouteEditFailureCode; draft: OrderedRouteDraft };

export const ROUTE_ATTACHMENT_TOLERANCE_M = 20;
export const ROUTE_COORDINATE_EQUALITY_M = 0.35;
export const ROUTE_MAX_PART_POINTS = 5_000;

function clonePoint(point: RoutePoint): RoutePoint {
  return { ...point };
}

export function cloneOrderedDraft(draft: OrderedRouteDraft): OrderedRouteDraft {
  return {
    ...draft,
    startPoint: draft.startPoint ? clonePoint(draft.startPoint) : undefined,
    parts: draft.parts.map(part => ({ ...part, points: part.points.map(clonePoint) })),
    gaps: draft.gaps.map(gap => ({ ...gap })),
  };
}

export function validRoutePoint(point: RoutePoint | undefined | null): point is RoutePoint {
  return Boolean(point)
    && Number.isFinite(point!.lat)
    && Number.isFinite(point!.lng)
    && point!.lat >= -90
    && point!.lat <= 90
    && point!.lng >= -180
    && point!.lng <= 180
    && (point!.alt == null || Number.isFinite(point!.alt));
}

export function routePointDistanceM(a: RoutePoint, b: RoutePoint): number {
  const radiusM = 6_371_000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const latA = toRad(a.lat);
  const latB = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Removes only consecutive numeric duplicates. Ordered revisits are retained. */
export function normalizeOrderedPoints(points: RoutePoint[]): RoutePoint[] {
  const normalized: RoutePoint[] = [];
  for (const point of points) {
    if (!validRoutePoint(point)) return [];
    const previous = normalized[normalized.length - 1];
    if (previous && routePointDistanceM(previous, point) <= ROUTE_COORDINATE_EQUALITY_M) continue;
    normalized.push(clonePoint(point));
  }
  return normalized;
}

function makePartId(draft: OrderedRouteDraft, suffix: string): string {
  return `${draft.draftId}:r${draft.revision + 1}:${suffix}`;
}

export function createEmptyOrderedDraft(args: {
  draftId: string;
  ownerId: string;
  origin?: RouteDraftOrigin;
}): OrderedRouteDraft {
  return {
    schemaVersion: 1,
    draftId: args.draftId,
    ownerId: args.ownerId,
    origin: args.origin ?? 'plan',
    revision: 0,
    parts: [],
    gaps: [],
  };
}

export function createImportedOrderedDraft(args: {
  draftId: string;
  ownerId: string;
  segments: RoutePoint[][];
}): OrderedRouteDraft {
  const parts = args.segments.map((segment, index) => {
    const points = normalizeOrderedPoints(segment);
    if (points.length < 2) throw new Error(`INVALID_IMPORTED_SEGMENT:${index}`);
    return {
      id: `${args.draftId}:import:${index}`,
      points,
      resolution: 'recorded' as const,
    };
  });
  const gaps = parts.slice(0, -1).map((part, index) => ({
    id: `${args.draftId}:gap:${index}`,
    afterPartId: part.id,
    reason: 'activity-gap' as const,
  }));
  return {
    schemaVersion: 1,
    draftId: args.draftId,
    ownerId: args.ownerId,
    origin: 'activity',
    revision: 0,
    parts,
    gaps,
  };
}

/** Wraps a pre-contract continuous Route without inventing its drawing tool. */
export function createLegacyOrderedDraft(args: {
  draftId: string;
  ownerId: string;
  points: RoutePoint[];
  origin?: RouteDraftOrigin;
  recorded?: boolean;
}): OrderedRouteDraft {
  const points = normalizeOrderedPoints(args.points);
  if (points.length < 2) throw new Error('INVALID_LEGACY_ROUTE');
  return {
    schemaVersion: 1,
    draftId: args.draftId,
    ownerId: args.ownerId,
    origin: args.origin ?? 'plan',
    revision: 0,
    parts: [{
      id: `${args.draftId}:legacy:0`,
      points,
      resolution: args.recorded ? 'recorded' : 'legacy',
    }],
    gaps: [],
  };
}

export function orderedDraftIsContinuous(draft: OrderedRouteDraft): boolean {
  return draft.parts.length > 0
    && draft.parts.every(part => part.points.length >= 2)
    && draft.gaps.length === 0;
}

export function orderedDraftCanUseOrShare(draft: OrderedRouteDraft): boolean {
  return orderedDraftIsContinuous(draft)
    && orderedDraftPoints(draft).length >= 2;
}

export function orderedDraftPoints(draft: OrderedRouteDraft): RoutePoint[] {
  const output: RoutePoint[] = [];
  draft.parts.forEach((part, partIndex) => {
    part.points.forEach((point, pointIndex) => {
      const previous = output[output.length - 1];
      if (partIndex > 0 && pointIndex === 0 && previous
        && routePointDistanceM(previous, point) <= ROUTE_COORDINATE_EQUALITY_M) return;
      output.push(clonePoint(point));
    });
  });
  return output;
}

export function orderedDraftDistanceM(draft: OrderedRouteDraft): number {
  return draft.parts.reduce((total, part) => total + part.points.reduce((sum, point, index) => (
    index === 0 ? sum : sum + routePointDistanceM(part.points[index - 1], point)
  ), 0), 0);
}

export function setOrderedDraftStart(draft: OrderedRouteDraft, point: RoutePoint): RouteEditResult {
  if (!validRoutePoint(point)) return { ok: false, code: 'INVALID_COORDINATE', draft };
  if (draft.parts.length > 0) return { ok: false, code: 'INVALID_INTERVAL', draft };
  return {
    ok: true,
    draft: { ...cloneOrderedDraft(draft), startPoint: clonePoint(point), revision: draft.revision + 1 },
  };
}

function connectCandidate(
  candidate: RoutePoint[],
  expectedStart: RoutePoint,
  expectedEnd?: RoutePoint,
): { ok: true; points: RoutePoint[] } | { ok: false; code: RouteEditFailureCode } {
  const points = normalizeOrderedPoints(candidate);
  if (points.length < 2) return { ok: false, code: candidate.every(validRoutePoint) ? 'ZERO_LENGTH' : 'INVALID_COORDINATE' };
  if (points.length > ROUTE_MAX_PART_POINTS) return { ok: false, code: 'INVALID_INTERVAL' };
  if (routePointDistanceM(points[0], expectedStart) > ROUTE_ATTACHMENT_TOLERANCE_M) {
    return { ok: false, code: 'DISCONNECTED' };
  }
  if (expectedEnd && routePointDistanceM(points[points.length - 1], expectedEnd) > ROUTE_ATTACHMENT_TOLERANCE_M) {
    return { ok: false, code: 'DISCONNECTED' };
  }
  points[0] = clonePoint(expectedStart);
  if (expectedEnd) points[points.length - 1] = clonePoint(expectedEnd);
  return { ok: true, points };
}

export function appendOrderedSegment(
  draft: OrderedRouteDraft,
  candidate: RoutePoint[],
  resolution: EditableRouteResolution,
): RouteEditResult {
  const terminal = draft.parts.length > 0
    ? draft.parts[draft.parts.length - 1].points.at(-1)
    : draft.startPoint;
  const normalized = normalizeOrderedPoints(candidate);
  if (!terminal) {
    if (normalized.length < 2) {
      return { ok: false, code: candidate.every(validRoutePoint) ? 'ZERO_LENGTH' : 'INVALID_COORDINATE', draft };
    }
  }
  const connected = terminal ? connectCandidate(candidate, terminal) : { ok: true as const, points: normalized };
  if (!connected.ok) return { ok: false, code: connected.code, draft };
  const next = cloneOrderedDraft(draft);
  next.parts.push({
    id: makePartId(draft, `append:${next.parts.length}`),
    points: connected.points,
    resolution,
  });
  next.startPoint = undefined;
  next.revision += 1;
  return { ok: true, draft: next };
}

function orderedPositionIndex(draft: OrderedRouteDraft, position: OrderedPosition): number {
  return draft.parts.findIndex(part => part.id === position.partId);
}

export function replaceOrderedInterval(
  draft: OrderedRouteDraft,
  start: OrderedPosition,
  end: OrderedPosition,
  candidate: RoutePoint[],
  resolution: EditableRouteResolution,
): RouteEditResult {
  const startPartIndex = orderedPositionIndex(draft, start);
  const endPartIndex = orderedPositionIndex(draft, end);
  if (startPartIndex < 0 || endPartIndex < 0 || startPartIndex !== endPartIndex) {
    return { ok: false, code: 'INVALID_INTERVAL', draft };
  }
  if (start.pointIndex < 0 || end.pointIndex <= start.pointIndex) {
    return { ok: false, code: 'INVALID_INTERVAL', draft };
  }
  const part = draft.parts[startPartIndex];
  if (end.pointIndex >= part.points.length) return { ok: false, code: 'INVALID_INTERVAL', draft };
  const connected = connectCandidate(candidate, part.points[start.pointIndex], part.points[end.pointIndex]);
  if (!connected.ok) return { ok: false, code: connected.code, draft };
  const prefix = part.points.slice(0, start.pointIndex);
  const suffix = part.points.slice(end.pointIndex + 1);
  const replacement = normalizeOrderedPoints([...prefix, ...connected.points, ...suffix]);
  if (replacement.length < 2) return { ok: false, code: 'ZERO_LENGTH', draft };
  const next = cloneOrderedDraft(draft);
  next.parts[startPartIndex] = { ...part, points: replacement, resolution };
  next.revision += 1;
  return { ok: true, draft: next };
}

export function bridgeOrderedGap(
  draft: OrderedRouteDraft,
  gapId: string,
  candidate: RoutePoint[],
  resolution: EditableRouteResolution,
): RouteEditResult {
  const gap = draft.gaps.find(item => item.id === gapId);
  if (!gap) return { ok: false, code: 'NOT_ADJACENT_GAP', draft };
  const leftIndex = draft.parts.findIndex(part => part.id === gap.afterPartId);
  const rightIndex = leftIndex + 1;
  if (leftIndex < 0 || rightIndex >= draft.parts.length) {
    return { ok: false, code: 'NOT_ADJACENT_GAP', draft };
  }
  const left = draft.parts[leftIndex];
  const right = draft.parts[rightIndex];
  const connected = connectCandidate(candidate, left.points.at(-1)!, right.points[0]);
  if (!connected.ok) return { ok: false, code: connected.code, draft };
  const next = cloneOrderedDraft(draft);
  next.parts.splice(rightIndex, 0, {
    id: makePartId(draft, `bridge:${gapId}`),
    points: connected.points,
    resolution,
  });
  next.gaps = next.gaps.filter(item => item.id !== gapId);
  next.revision += 1;
  return { ok: true, draft: next };
}

export function keepOnlyOrderedPart(draft: OrderedRouteDraft, partId: string): RouteEditResult {
  const part = draft.parts.find(item => item.id === partId);
  if (!part) return { ok: false, code: 'INVALID_INTERVAL', draft };
  const next = cloneOrderedDraft(draft);
  next.parts = [{ ...part, points: part.points.map(clonePoint) }];
  next.gaps = [];
  next.revision += 1;
  return { ok: true, draft: next };
}

export function trimOrderedDraft(
  draft: OrderedRouteDraft,
  start: OrderedPosition,
  end: OrderedPosition,
): RouteEditResult {
  const startPartIndex = orderedPositionIndex(draft, start);
  const endPartIndex = orderedPositionIndex(draft, end);
  if (startPartIndex < 0 || endPartIndex < startPartIndex) {
    return { ok: false, code: 'INVALID_INTERVAL', draft };
  }
  if (start.pointIndex < 0 || end.pointIndex < 0
    || start.pointIndex >= draft.parts[startPartIndex].points.length
    || end.pointIndex >= draft.parts[endPartIndex].points.length) {
    return { ok: false, code: 'INVALID_INTERVAL', draft };
  }
  const kept = draft.parts.slice(startPartIndex, endPartIndex + 1).map((part, index, all) => {
    let points = part.points;
    if (index === 0) points = points.slice(start.pointIndex);
    if (index === all.length - 1) points = points.slice(0, end.pointIndex + 1);
    return { ...part, points: points.map(clonePoint) };
  }).filter(part => part.points.length >= 2);
  if (kept.length === 0) return { ok: false, code: 'EMPTY_ROUTE', draft };
  const keptIds = new Set(kept.map(part => part.id));
  const next = cloneOrderedDraft(draft);
  next.parts = kept;
  next.gaps = next.gaps.filter(gap => {
    const left = draft.parts.findIndex(part => part.id === gap.afterPartId);
    return left >= 0 && keptIds.has(draft.parts[left].id) && keptIds.has(draft.parts[left + 1]?.id);
  });
  next.revision += 1;
  return { ok: true, draft: next };
}

export function beginRouteOperation(
  draft: OrderedRouteDraft,
  accountId: string,
  kind: RouteOperationToken['kind'],
  operationId: string,
): RouteOperationToken {
  return { accountId, draftId: draft.draftId, baseRevision: draft.revision, operationId, kind };
}

export function routeOperationIsCurrent(
  draft: OrderedRouteDraft,
  accountId: string,
  token: RouteOperationToken,
): boolean {
  return token.accountId === accountId
    && token.accountId === draft.ownerId
    && token.draftId === draft.draftId
    && token.baseRevision === draft.revision;
}

export function commitRouteHistory(
  history: RouteDraftHistory,
  result: RouteEditResult,
  operation: string,
): RouteDraftHistory {
  if (!result.ok || result.draft === history.present) return history;
  return {
    present: result.draft,
    past: [...history.past, { draft: cloneOrderedDraft(history.present), operation }].slice(-50),
  };
}

export function undoRouteHistory(history: RouteDraftHistory): RouteDraftHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    present: cloneOrderedDraft(previous.draft),
    past: history.past.slice(0, -1),
  };
}

export function validateOrderedDraft(draft: OrderedRouteDraft): RouteEditFailureCode[] {
  const failures = new Set<RouteEditFailureCode>();
  if (!draft.draftId || !draft.ownerId) failures.add('OWNER_CHANGED');
  for (const part of draft.parts) {
    if (part.points.length < 2) failures.add('ZERO_LENGTH');
    if (part.points.length > ROUTE_MAX_PART_POINTS) failures.add('INVALID_INTERVAL');
    if (!part.points.every(validRoutePoint)) failures.add('INVALID_COORDINATE');
  }
  for (const gap of draft.gaps) {
    const leftIndex = draft.parts.findIndex(part => part.id === gap.afterPartId);
    if (leftIndex < 0 || leftIndex >= draft.parts.length - 1) failures.add('NOT_ADJACENT_GAP');
  }
  return [...failures];
}
