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
  /** Segment start plus a 0..1 fraction. Omitted/zero means the exact vertex. */
  pointIndex: number;
  fraction?: number;
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

/** Maps a UI distance fraction onto ordered geometry; unknown gaps contribute no length. */
export function orderedPositionAtDistanceFraction(
  draft: OrderedRouteDraft,
  fraction: number,
): OrderedPosition | null {
  if (draft.parts.length === 0 || !Number.isFinite(fraction)) return null;
  const clamped = Math.max(0, Math.min(1, fraction));
  const total = orderedDraftDistanceM(draft);
  if (total <= ROUTE_COORDINATE_EQUALITY_M) return null;
  let remaining = total * clamped;
  for (let partIndex = 0; partIndex < draft.parts.length; partIndex += 1) {
    const part = draft.parts[partIndex];
    for (let pointIndex = 0; pointIndex < part.points.length - 1; pointIndex += 1) {
      const length = routePointDistanceM(part.points[pointIndex], part.points[pointIndex + 1]);
      if (remaining <= length || (partIndex === draft.parts.length - 1 && pointIndex === part.points.length - 2)) {
        const segmentFraction = length > 0 ? Math.max(0, Math.min(1, remaining / length)) : 0;
        if (segmentFraction >= 1 - 1e-9) return { partId: part.id, pointIndex: pointIndex + 1 };
        return { partId: part.id, pointIndex, ...(segmentFraction > 0 ? { fraction: segmentFraction } : {}) };
      }
      remaining -= length;
    }
  }
  const last = draft.parts.at(-1)!;
  return { partId: last.id, pointIndex: last.points.length - 1 };
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

const ROUTE_SEAM_CLEANUP_RADIUS_M = 12;
const ROUTE_SEAM_DUPLICATE_M = 1.5;

function localVector(a: RoutePoint, b: RoutePoint): { x: number; y: number } {
  const latitude = ((a.lat + b.lat) / 2) * Math.PI / 180;
  return {
    x: (b.lng - a.lng) * Math.cos(latitude),
    y: b.lat - a.lat,
  };
}

function normalizedDot(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const length = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  return length > 0 ? (a.x * b.x + a.y * b.y) / length : 1;
}

/**
 * Remove only tiny snapped seam folds. A deliberate corner remains because
 * points outside the bounded 12m seam neighborhood are never touched. A
 * deliberate U-turn also remains anchored at the junction after its redundant
 * near-anchor backtracking samples are removed.
 */
function normalizeCandidateSeam(
  candidate: RoutePoint[],
  reference: RoutePoint | undefined,
  side: 'start' | 'end',
): RoutePoint[] {
  const points = candidate.map(clonePoint);
  if (!reference || points.length < 3) return points;
  while (points.length >= 3) {
    const anchor = side === 'start' ? points[0] : points.at(-1)!;
    const adjacent = side === 'start' ? points[1] : points.at(-2)!;
    const distance = routePointDistanceM(anchor, adjacent);
    if (distance > ROUTE_SEAM_CLEANUP_RADIUS_M) break;
    const incoming = side === 'start'
      ? localVector(reference, anchor)
      : localVector(adjacent, anchor);
    const outgoing = side === 'start'
      ? localVector(anchor, adjacent)
      : localVector(anchor, reference);
    if (distance > ROUTE_SEAM_DUPLICATE_M && normalizedDot(incoming, outgoing) >= -0.15) break;
    points.splice(side === 'start' ? 1 : points.length - 2, 1);
  }
  return points;
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
  const previous = draft.parts.at(-1)?.points.at(-2);
  const seamSafePoints = terminal
    ? normalizeCandidateSeam(connected.points, previous, 'start')
    : connected.points;
  const next = cloneOrderedDraft(draft);
  next.parts.push({
    id: makePartId(draft, `append:${next.parts.length}`),
    points: seamSafePoints,
    resolution,
  });
  next.startPoint = undefined;
  next.revision += 1;
  return { ok: true, draft: next };
}

/**
 * Extend the beginning of one ordered traversal. The supplied candidate is
 * already in canonical new-start -> old-start order; this never mutates or
 * reverses the approved route that follows it.
 */
export function prependOrderedSegment(
  draft: OrderedRouteDraft,
  candidate: RoutePoint[],
  resolution: EditableRouteResolution,
): RouteEditResult {
  const first = draft.parts[0]?.points[0] ?? draft.startPoint;
  if (!first) return appendOrderedSegment(draft, candidate, resolution);
  const normalized = normalizeOrderedPoints(candidate);
  if (normalized.length < 2) return { ok: false, code: 'ZERO_LENGTH', draft };
  if (routePointDistanceM(normalized.at(-1)!, first) > ROUTE_ATTACHMENT_TOLERANCE_M) {
    return { ok: false, code: 'DISCONNECTED', draft };
  }
  normalized[normalized.length - 1] = clonePoint(first);
  const seamSafePoints = normalizeCandidateSeam(normalized, draft.parts[0]?.points[1], 'end');
  const next = cloneOrderedDraft(draft);
  next.startPoint = undefined;
  next.parts.unshift({
    id: makePartId(draft, 'prepend'),
    points: seamSafePoints,
    resolution,
  });
  next.revision += 1;
  return { ok: true, draft: next };
}

function orderedPositionIndex(draft: OrderedRouteDraft, position: OrderedPosition): number {
  return draft.parts.findIndex(part => part.id === position.partId);
}

function normalizedPositionFraction(position: OrderedPosition): number {
  return position.fraction ?? 0;
}

export function orderedPositionPoint(
  draft: OrderedRouteDraft,
  position: OrderedPosition,
): RoutePoint | null {
  const partIndex = orderedPositionIndex(draft, position);
  if (partIndex < 0) return null;
  const part = draft.parts[partIndex];
  const fraction = normalizedPositionFraction(position);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1
    || position.pointIndex < 0 || position.pointIndex >= part.points.length) return null;
  if (fraction === 0) return clonePoint(part.points[position.pointIndex]);
  const next = part.points[position.pointIndex + 1];
  if (!next) return null;
  const start = part.points[position.pointIndex];
  return {
    lat: start.lat + (next.lat - start.lat) * fraction,
    lng: start.lng + (next.lng - start.lng) * fraction,
    ...(typeof start.alt === 'number' && typeof next.alt === 'number'
      ? { alt: start.alt + (next.alt - start.alt) * fraction }
      : {}),
  };
}

export function compareOrderedPositions(
  draft: OrderedRouteDraft,
  a: OrderedPosition,
  b: OrderedPosition,
): number | null {
  const aPart = orderedPositionIndex(draft, a);
  const bPart = orderedPositionIndex(draft, b);
  if (aPart < 0 || bPart < 0 || !orderedPositionPoint(draft, a) || !orderedPositionPoint(draft, b)) return null;
  if (aPart !== bPart) return aPart - bPart;
  return (a.pointIndex + normalizedPositionFraction(a))
    - (b.pointIndex + normalizedPositionFraction(b));
}

export function orderedIntervalCrossesGap(
  draft: OrderedRouteDraft,
  start: OrderedPosition,
  end: OrderedPosition,
): boolean {
  const startPart = orderedPositionIndex(draft, start);
  const endPart = orderedPositionIndex(draft, end);
  if (startPart < 0 || endPart < startPart) return true;
  const gapsAfter = new Set(draft.gaps.map(gap => gap.afterPartId));
  for (let index = startPart; index < endPart; index += 1) {
    if (gapsAfter.has(draft.parts[index].id)) return true;
  }
  return false;
}

export function orderedIntervalPoints(
  draft: OrderedRouteDraft,
  start: OrderedPosition,
  end: OrderedPosition,
): RoutePoint[] {
  const order = compareOrderedPositions(draft, start, end);
  const startPartIndex = orderedPositionIndex(draft, start);
  const endPartIndex = orderedPositionIndex(draft, end);
  if (order == null || order >= 0 || startPartIndex < 0 || endPartIndex < startPartIndex
    || orderedIntervalCrossesGap(draft, start, end)) return [];
  const startPoint = orderedPositionPoint(draft, start)!;
  const endPoint = orderedPositionPoint(draft, end)!;
  if (startPartIndex === endPartIndex) {
    return pointsBetweenPositions(draft.parts[startPartIndex], start, end, startPoint, endPoint);
  }
  const points = suffixFromPosition(draft.parts[startPartIndex], start, startPoint);
  for (let index = startPartIndex + 1; index < endPartIndex; index += 1) {
    const partPoints = draft.parts[index].points;
    points.push(...partPoints.slice(routePointDistanceM(points.at(-1)!, partPoints[0]) <= ROUTE_COORDINATE_EQUALITY_M ? 1 : 0).map(clonePoint));
  }
  const finalPoints = prefixThroughPosition(draft.parts[endPartIndex], end, endPoint);
  points.push(...finalPoints.slice(routePointDistanceM(points.at(-1)!, finalPoints[0]) <= ROUTE_COORDINATE_EQUALITY_M ? 1 : 0));
  return points;
}

function prefixThroughPosition(part: OrderedRoutePart, position: OrderedPosition, point: RoutePoint): RoutePoint[] {
  const prefix = part.points.slice(0, position.pointIndex + 1).map(clonePoint);
  if (normalizedPositionFraction(position) > 0) prefix.push(clonePoint(point));
  return prefix;
}

function suffixFromPosition(part: OrderedRoutePart, position: OrderedPosition, point: RoutePoint): RoutePoint[] {
  if (normalizedPositionFraction(position) === 0) return part.points.slice(position.pointIndex).map(clonePoint);
  return [clonePoint(point), ...part.points.slice(position.pointIndex + 1).map(clonePoint)];
}

function pointsBetweenPositions(
  part: OrderedRoutePart,
  start: OrderedPosition,
  end: OrderedPosition,
  startPoint: RoutePoint,
  endPoint: RoutePoint,
): RoutePoint[] {
  const output: RoutePoint[] = [clonePoint(startPoint)];
  const firstWholeIndex = start.pointIndex + (normalizedPositionFraction(start) > 0 ? 1 : 0);
  const lastWholeIndex = end.pointIndex;
  for (let index = firstWholeIndex; index <= lastWholeIndex; index += 1) {
    const point = part.points[index];
    if (point && routePointDistanceM(output.at(-1)!, point) > ROUTE_COORDINATE_EQUALITY_M) output.push(clonePoint(point));
  }
  if (routePointDistanceM(output.at(-1)!, endPoint) > ROUTE_COORDINATE_EQUALITY_M) output.push(clonePoint(endPoint));
  return output;
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
  const order = compareOrderedPositions(draft, start, end);
  if (startPartIndex < 0 || endPartIndex < 0 || order == null || order >= 0
    || orderedIntervalCrossesGap(draft, start, end)) {
    return { ok: false, code: 'INVALID_INTERVAL', draft };
  }
  const startPart = draft.parts[startPartIndex];
  const endPart = draft.parts[endPartIndex];
  const startPoint = orderedPositionPoint(draft, start)!;
  const endPoint = orderedPositionPoint(draft, end)!;
  const connected = connectCandidate(candidate, startPoint, endPoint);
  if (!connected.ok) return { ok: false, code: connected.code, draft };
  const prefix = prefixThroughPosition(startPart, start, startPoint);
  const suffix = suffixFromPosition(endPart, end, endPoint);
  const startSafe = normalizeCandidateSeam(connected.points, prefix.at(-2), 'start');
  const seamSafePoints = normalizeCandidateSeam(startSafe, suffix[1], 'end');
  const replacementParts: OrderedRoutePart[] = [];
  if (prefix.length >= 2) replacementParts.push({
    id: makePartId(draft, `replace-prefix:${startPartIndex}`),
    points: prefix.map(clonePoint),
    resolution: startPart.resolution,
  });
  replacementParts.push({
    id: makePartId(draft, `replace:${startPartIndex}`),
    points: seamSafePoints,
    resolution,
  });
  if (suffix.length >= 2) replacementParts.push({
    id: makePartId(draft, `replace-suffix:${startPartIndex}`),
    points: suffix.map(clonePoint),
    resolution: endPart.resolution,
  });
  const next = cloneOrderedDraft(draft);
  next.parts.splice(startPartIndex, endPartIndex - startPartIndex + 1, ...replacementParts);
  const lastReplacementPartId = replacementParts[replacementParts.length - 1].id;
  const removedIds = new Set(draft.parts.slice(startPartIndex, endPartIndex + 1).map(part => part.id));
  next.gaps = next.gaps.filter(gap => !removedIds.has(gap.afterPartId) || gap.afterPartId === endPart.id)
    .map(gap => gap.afterPartId === endPart.id
    ? { ...gap, afterPartId: lastReplacementPartId }
    : gap);
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
  const startSafe = normalizeCandidateSeam(connected.points, left.points.at(-2), 'start');
  const seamSafePoints = normalizeCandidateSeam(startSafe, right.points[1], 'end');
  const next = cloneOrderedDraft(draft);
  next.parts.splice(rightIndex, 0, {
    id: makePartId(draft, `bridge:${gapId}`),
    points: seamSafePoints,
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
  const order = compareOrderedPositions(draft, start, end);
  if (startPartIndex < 0 || endPartIndex < startPartIndex || order == null || order > 0) {
    return { ok: false, code: 'INVALID_INTERVAL', draft };
  }
  if (order === 0) return { ok: false, code: 'EMPTY_ROUTE', draft };
  if (start.pointIndex < 0 || end.pointIndex < 0
    || start.pointIndex >= draft.parts[startPartIndex].points.length
    || end.pointIndex >= draft.parts[endPartIndex].points.length) {
    return { ok: false, code: 'INVALID_INTERVAL', draft };
  }
  const startPoint = orderedPositionPoint(draft, start)!;
  const endPoint = orderedPositionPoint(draft, end)!;
  const kept = draft.parts.slice(startPartIndex, endPartIndex + 1).map((part, index, all) => {
    let points = part.points;
    // For a same-part trim both anchors must be applied to the original array.
    if (all.length === 1) points = pointsBetweenPositions(part, start, end, startPoint, endPoint);
    else {
      if (index === 0) points = suffixFromPosition(part, start, startPoint);
      if (index === all.length - 1) points = prefixThroughPosition(part, end, endPoint);
    }
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
  activeOperationId: string | null,
): boolean {
  return token.accountId === accountId
    && token.accountId === draft.ownerId
    && token.draftId === draft.draftId
    && token.baseRevision === draft.revision
    && activeOperationId === token.operationId;
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
  const gapsAfter = new Set(draft.gaps.map(gap => gap.afterPartId));
  for (let index = 1; index < draft.parts.length; index += 1) {
    const previous = draft.parts[index - 1];
    const current = draft.parts[index];
    if (!gapsAfter.has(previous.id)
      && routePointDistanceM(previous.points.at(-1)!, current.points[0]) > ROUTE_COORDINATE_EQUALITY_M) {
      failures.add('DISCONNECTED');
    }
  }
  return [...failures];
}
