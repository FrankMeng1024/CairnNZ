import type { RoutePoint } from '../../store/useRouteStore';
import {
  resolveRouteDrawing,
  type DrawingViewport,
  type RouteDrawingDecision,
} from '../routeDrawing/routeDrawingIntent';
import {
  ROUTE_ATTACHMENT_TOLERANCE_M,
  appendOrderedSegment,
  bridgeOrderedGap,
  compareOrderedPositions,
  normalizeOrderedPoints,
  prependOrderedSegment,
  orderedIntervalCrossesGap,
  orderedDraftPoints,
  orderedPositionPoint,
  replaceOrderedInterval,
  routePointDistanceM,
  type EditableRouteResolution,
  type OrderedPosition,
  type OrderedRoutePart,
  type OrderedRouteDraft,
  type RouteEditResult,
} from './orderedRouteDraft';

export interface IntentAwareDrawCandidate {
  points: RoutePoint[] | null;
  resolution: EditableRouteResolution | null;
  decision: RouteDrawingDecision;
}

/**
 * Apply the O81 human-intent gate only after the ordered editor has selected
 * one unambiguous replacement interval. The raw stroke remains the shape
 * authority; provider vertices may refine it only while they stay faithful.
 */
export function selectIntentAwareDrawCandidate(input: {
  draft: OrderedRouteDraft;
  raw: RoutePoint[];
  provider: RoutePoint[] | null;
  intent: DrawTransactionIntent;
  viewport: DrawingViewport;
}): IntentAwareDrawCandidate | null {
  if (input.intent.kind !== 'replace' || input.intent.options.length !== 1) return null;
  const decision = resolveRouteDrawing({
    originalRoute: orderedDraftPoints(input.draft),
    rawStroke: input.raw,
    providerGeometry: input.provider,
    viewport: input.viewport,
  });
  if (decision.status !== 'accepted' || decision.selectedReplacement.length < 2) {
    return { points: null, resolution: null, decision };
  }
  return {
    points: decision.selectedReplacement,
    resolution: decision.selectionSource === 'provider' ? 'draw-matched' : 'draw-manual',
    decision,
  };
}

export interface RouteAnchorCandidate extends OrderedPosition {
  distanceM: number;
  point: RoutePoint;
  occurrenceId?: string;
  arcM?: number;
}

/** 24 screen pixels, bounded to avoid both sub-finger and city-scale snaps. */
export function routeAttachmentToleranceM(latitude: number, zoom: number): number {
  const safeLatitude = Math.max(-85, Math.min(85, Number.isFinite(latitude) ? latitude : 0));
  const safeZoom = Math.max(0, Math.min(24, Number.isFinite(zoom) ? zoom : 15));
  const metresPerPixel = 156543.03392 * Math.cos(safeLatitude * Math.PI / 180) / (2 ** safeZoom);
  return Math.max(4, Math.min(60, metresPerPixel * 24));
}

const ROUTE_MAX_SCREEN_ATTACHMENT_M = 60;

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
    .map(({ partIndex: _partIndex, segmentIndex: _segmentIndex, segmentFraction: _segmentFraction, connectedGroup: _connectedGroup, tangent: _tangent, ...candidate }) => ({
      ...candidate,
      occurrenceId: positionKey(candidate),
    }))
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
  // The two segments on either side of one shared vertex represent the same
  // cumulative ordered occurrence even when the Route turns sharply there or
  // the vertex is an internal Draw/Point part boundary. Distinct retraced
  // visits remain separate because their cumulative arc positions differ.
  if (a.connectedGroup === b.connectedGroup
    && Math.abs(b.arcM - a.arcM) <= 0.5
    && routePointDistanceM(a.point, b.point) <= 0.5) return true;
  const tangentDot = a.tangent.x * b.tangent.x + a.tangent.y * b.tangent.y;
  return a.connectedGroup === b.connectedGroup
    && b.arcM - a.arcM <= 4.1
    && tangentDot > -0.25
    && routePointDistanceM(a.point, b.point) <= 4.1;
}

function terminalPoint(draft: OrderedRouteDraft): RoutePoint | undefined {
  return draft.parts.at(-1)?.points.at(-1) ?? draft.startPoint;
}

function routeLengthM(points: RoutePoint[]): number {
  return points.slice(1).reduce(
    (sum, point, index) => sum + routePointDistanceM(points[index], point),
    0,
  );
}

/**
 * Activity imports are immutable evidence templates. A Draw replacement may
 * reshape an identifiable interior interval, but it may not turn almost the
 * entire recorded journey into a short chord. This guard lives immediately
 * before the mutating primitive so classifier regressions and forced intents
 * fail closed as well.
 */
export function isDestructiveActivityReplacement(
  draft: OrderedRouteDraft,
  option: RouteIntervalCandidate,
  candidate: RoutePoint[],
): boolean {
  if (draft.origin !== 'activity') return false;
  const wholeRoute = orderedDraftPoints(draft);
  const replaced = intervalPoints(draft, option);
  const normalizedCandidate = normalizeOrderedPoints(candidate);
  if (wholeRoute.length < 8 || replaced.length < 6 || normalizedCandidate.length < 2) return false;
  const wholeLengthM = routeLengthM(wholeRoute);
  const replacedLengthM = routeLengthM(replaced);
  const candidateLengthM = routeLengthM(normalizedCandidate);
  if (wholeLengthM <= 0 || replacedLengthM <= 0) return false;
  return replaced.length >= Math.max(6, Math.floor(wholeRoute.length * 0.8))
    && replacedLengthM >= wholeLengthM * 0.8
    && candidateLengthM < replacedLengthM * 0.35;
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

function intervalOptions(
  draft: OrderedRouteDraft,
  starts: RouteAnchorCandidate[],
  ends: RouteAnchorCandidate[],
): RouteIntervalCandidate[] {
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
  return options;
}

function segmentIntersection(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint): { t: number; u: number } | null {
  const latitude = a.lat * Math.PI / 180;
  const scaleX = Math.cos(latitude);
  const bx = (b.lng - a.lng) * scaleX;
  const by = b.lat - a.lat;
  const cx = (c.lng - a.lng) * scaleX;
  const cy = c.lat - a.lat;
  const dx = (d.lng - a.lng) * scaleX;
  const dy = d.lat - a.lat;
  const sx = dx - cx;
  const sy = dy - cy;
  const cross = bx * sy - by * sx;
  if (Math.abs(cross) < 1e-12) return null;
  const t = (cx * sy - cy * sx) / cross;
  const u = (cx * by - cy * bx) / cross;
  return t > 0.04 && t < 0.96 && u >= 0 && u <= 1 ? { t, u } : null;
}

function interiorCrossingCount(draft: OrderedRouteDraft, raw: RoutePoint[]): number {
  const route = orderedDraftPoints(draft);
  let count = 0;
  for (let rawIndex = 1; rawIndex < raw.length; rawIndex += 1) {
    for (let routeIndex = 1; routeIndex < route.length; routeIndex += 1) {
      if (segmentIntersection(raw[rawIndex - 1], raw[rawIndex], route[routeIndex - 1], route[routeIndex])) count += 1;
    }
  }
  return count;
}

export interface DrawTransactionDiagnostics {
  attachmentToleranceM: number;
  startCandidates: RouteAnchorCandidate[];
  endCandidates: RouteAnchorCandidate[];
  intervalCandidates: Array<RouteIntervalCandidate & { shapeScore: number }>;
  selectedIntervalId: string | null;
  ambiguityReason: 'competing-start-occurrences' | 'competing-end-occurrences' | 'near-equal-intervals' | 'none';
  interiorCrossingCount: number;
  crossingPolicy: 'interior-crossings-ignored-as-boundaries';
}

export function classifyDrawTransactionWithDiagnostics(
  draft: OrderedRouteDraft,
  raw: RoutePoint[],
  selectedGapId?: string,
  attachmentToleranceM = ROUTE_ATTACHMENT_TOLERANCE_M,
): { intent: DrawTransactionIntent; diagnostics: DrawTransactionDiagnostics } {
  const toleranceM = Math.max(4, Math.min(ROUTE_MAX_SCREEN_ATTACHMENT_M, attachmentToleranceM));
  const starts = raw[0] ? nearestOrderedPositions(draft, raw[0], toleranceM) : [];
  const ends = raw.at(-1) ? nearestOrderedPositions(draft, raw.at(-1)!, toleranceM) : [];
  const options = selectedGapId ? [] : intervalOptions(draft, starts, ends);
  const intent = classifyDrawTransaction(draft, raw, selectedGapId, attachmentToleranceM);
  const selectedIntervalId = intent.kind === 'replace' ? intent.options[0]?.id ?? null : null;
  const ambiguityReason = intent.kind === 'pending-replace' && intent.ambiguity === 'overlap'
    ? starts.length > 1 && ends.length <= 1
      ? 'competing-start-occurrences'
      : ends.length > 1 && starts.length <= 1
        ? 'competing-end-occurrences'
        : 'near-equal-intervals'
    : 'none';
  return {
    intent,
    diagnostics: {
      attachmentToleranceM: toleranceM,
      startCandidates: starts,
      endCandidates: ends,
      intervalCandidates: options.map(option => ({ ...option, shapeScore: intervalShapeScore(draft, raw, option) })),
      selectedIntervalId,
      ambiguityReason,
      interiorCrossingCount: interiorCrossingCount(draft, raw),
      crossingPolicy: 'interior-crossings-ignored-as-boundaries',
    },
  };
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
  const toleranceM = Math.max(4, Math.min(ROUTE_MAX_SCREEN_ATTACHMENT_M, attachmentToleranceM));
  if (selectedGapId) {
    const gap = draft.gaps.find(item => item.id === selectedGapId);
    const leftIndex = gap ? draft.parts.findIndex(part => part.id === gap.afterPartId) : -1;
    const left = leftIndex >= 0 ? draft.parts[leftIndex] : undefined;
    const right = leftIndex >= 0 ? draft.parts[leftIndex + 1] : undefined;
    if (!gap || !left || !right) return { kind: 'reject', code: 'DISCONNECTED' };
    const forward = routePointDistanceM(first, left.points.at(-1)!) <= toleranceM
      && routePointDistanceM(last, right.points[0]) <= toleranceM;
    const reverse = routePointDistanceM(last, left.points.at(-1)!) <= toleranceM
      && routePointDistanceM(first, right.points[0]) <= toleranceM;
    if (!forward && !reverse) {
      const startsAtLeft = routePointDistanceM(first, left.points.at(-1)!) <= toleranceM;
      const startsAtRight = routePointDistanceM(first, right.points[0]) <= toleranceM;
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

  // A dotted imported-Activity gap is already an explicit pair of adjacent
  // anchors. Drawing from one side to the other is the user's bridge intent;
  // requiring a separate "Connect next gap" selection hid that ownership in
  // UI state and made ordinary Draw reject the same valid stroke. Resolve only
  // one exact adjacent gap, never guess when multiple gaps overlap.
  const gapBridges = draft.gaps.flatMap(gap => {
    const leftIndex = draft.parts.findIndex(part => part.id === gap.afterPartId);
    const left = leftIndex >= 0 ? draft.parts[leftIndex] : undefined;
    const right = leftIndex >= 0 ? draft.parts[leftIndex + 1] : undefined;
    if (!left || !right) return [];
    const forward = routePointDistanceM(first, left.points.at(-1)!) <= toleranceM
      && routePointDistanceM(last, right.points[0]) <= toleranceM;
    const reverse = routePointDistanceM(last, left.points.at(-1)!) <= toleranceM
      && routePointDistanceM(first, right.points[0]) <= toleranceM;
    return forward || reverse
      ? [{ kind: 'bridge' as const, gapId: gap.id, reverseCandidate: reverse && !forward }]
      : [];
  });
  if (gapBridges.length === 1) return gapBridges[0];
  if (gapBridges.length > 1) return { kind: 'reject', code: 'AMBIGUOUS_INTERVAL' };

  const terminal = terminalPoint(draft);
  const beginning = initialPoint(draft);
  const startsAtTerminal = Boolean(terminal && routePointDistanceM(first, terminal) <= toleranceM);
  const starts = nearestOrderedPositions(draft, first, toleranceM);
  const ends = nearestOrderedPositions(draft, last, toleranceM);
  // A free endpoint is unambiguously an extension. Closing all the way back
  // to Start is likewise an appended traversal, even when the old Route is
  // near-closed and Start has another nearby ordered occurrence.
  if (startsAtTerminal && ends.length === 0) return { kind: 'append' };
  if (startsAtTerminal && beginning && routePointDistanceM(last, beginning) <= toleranceM) {
    return { kind: 'append' };
  }
  const options = intervalOptions(draft, starts, ends);
  if (options.length > 0) {
    const selected = unambiguousInterval(draft, raw, options);
    if (selected) {
      if (startsAtTerminal) {
        // End-to-earlier strokes have two legitimate meanings. A stroke that
        // closely retraces the selected suffix is a continued traversal and
        // must append (Test2/U-return). A materially different local shape is
        // the user's suffix correction and replaces only that ordered interval.
        // The bound scales with the same geographic attachment tolerance; a
        // sub-bound change is visually indistinguishable from normal finger
        // and matching displacement and therefore remains non-destructive.
        const suffixDifferenceM = intervalShapeScore(draft, raw, selected);
        if (suffixDifferenceM <= Math.max(12, toleranceM * 1.25)) return { kind: 'append' };
      }
      return { kind: 'replace', options: [selected] };
    }
    return {
      kind: 'pending-replace', points: normalizeOrderedPoints(raw),
      draftId: draft.draftId, baseRevision: draft.revision, ambiguity: 'overlap',
    };
  }
  // When the other end does not identify a route interval, the terminal/free
  // extension case has already returned above. Interior free strokes remain
  // pending so they cannot silently delete an untouched suffix.
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
  if (isDestructiveActivityReplacement(draft, intent.option, candidate)) {
    return { ok: false, code: 'DESTRUCTIVE_ACTIVITY_REPLACEMENT', draft };
  }
  return replaceOrderedInterval(
    draft,
    intent.option.start,
    intent.option.end,
    orient(candidate, intent.option.reverseCandidate),
    resolution,
  );
}

export interface DrawTransactionPart {
  points: RoutePoint[];
  resolution: Extract<EditableRouteResolution, 'draw-matched' | 'draw-manual'>;
}

function orientDrawParts(parts: DrawTransactionPart[], reverse: boolean): DrawTransactionPart[] {
  if (!reverse) return parts.map(part => ({ ...part, points: part.points.map(point => ({ ...point })) }));
  return [...parts].reverse().map(part => ({
    ...part,
    points: [...part.points].reverse().map(point => ({ ...point })),
  }));
}

/**
 * Applies matched/manual sub-runs as one revision. The existing transaction
 * classifier and Activity replacement guard see the complete stroke, while
 * persistence retains each contiguous run's provenance. Undo therefore
 * removes the whole Draw, never one provider chunk at a time.
 */
export function applyDrawTransactionParts(
  draft: OrderedRouteDraft,
  intent: Exclude<DrawTransactionIntent, { kind: 'replace' | 'reject' }>
    | { kind: 'replace'; option: RouteIntervalCandidate },
  sourceParts: DrawTransactionPart[],
): RouteEditResult {
  if (sourceParts.length === 0) return { ok: false, code: 'ZERO_LENGTH', draft };
  const shouldReverse = intent.kind === 'prepend'
    || (intent.kind === 'bridge' && intent.reverseCandidate)
    || (intent.kind === 'replace' && intent.option.reverseCandidate);
  const parts = orientDrawParts(sourceParts, shouldReverse)
    .map(part => ({ ...part, points: normalizeOrderedPoints(part.points) }))
    .filter(part => part.points.length >= 2);
  if (parts.length === 0) return { ok: false, code: 'ZERO_LENGTH', draft };
  for (let index = 1; index < parts.length; index += 1) {
    if (routePointDistanceM(parts[index - 1].points.at(-1)!, parts[index].points[0]) > ROUTE_ATTACHMENT_TOLERANCE_M) {
      return { ok: false, code: 'DISCONNECTED', draft };
    }
    parts[index].points[0] = { ...parts[index - 1].points.at(-1)! };
  }
  const merged = normalizeOrderedPoints(parts.flatMap((part, index) => index === 0 ? part.points : part.points.slice(1)));
  const applied = applyDrawTransaction(
    draft,
    intent,
    shouldReverse ? [...merged].reverse() : merged,
    parts[0].resolution,
  );
  if (!applied.ok || parts.length === 1) return applied;

  const marker = intent.kind === 'new' || intent.kind === 'append'
    ? ':append:'
    : intent.kind === 'prepend'
      ? ':prepend'
      : intent.kind === 'bridge'
        ? ':bridge:'
        : ':replace:';
  // Earlier Draw operations retain ids such as `:append:` and `:replace:`.
  // Looking up by the operation marker alone therefore selected the first
  // historical part on the second multi-section Draw, replaced that old part,
  // and left the newly appended merged part in place as a duplicate. Select
  // only the part created by this transaction.
  const previousPartIds = new Set(draft.parts.map(part => part.id));
  const insertedIndex = applied.draft.parts.findIndex(
    part => !previousPartIds.has(part.id) && part.id.includes(marker),
  );
  if (insertedIndex < 0) return { ok: false, code: 'INVALID_INTERVAL', draft };
  const inserted = applied.draft.parts[insertedIndex];
  parts[0].points[0] = { ...inserted.points[0] };
  parts[parts.length - 1].points[parts.at(-1)!.points.length - 1] = { ...inserted.points.at(-1)! };
  const persisted: OrderedRoutePart[] = parts.map((part, index) => ({
    id: `${inserted.id}:section:${index}`,
    points: part.points.map(point => ({ ...point })),
    resolution: part.resolution,
  }));
  const next = {
    ...applied.draft,
    parts: [...applied.draft.parts],
    gaps: applied.draft.gaps.map(gap => ({ ...gap })),
  };
  next.parts.splice(insertedIndex, 1, ...persisted);
  next.gaps = next.gaps.map(gap => gap.afterPartId === inserted.id
    ? { ...gap, afterPartId: persisted.at(-1)!.id }
    : gap);
  return { ok: true, draft: next };
}
