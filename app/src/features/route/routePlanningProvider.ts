import type { RoutePoint } from '../../store/useRouteStore';
import { planWalkingRoute, type WalkingPlanPoint } from '../../services/routing/planWalkingRoute';
import { matchSegment } from '../../services/routing/mapmatch/MapMatchingClient';
import type { MatchResult, MatchSegment } from '../../services/routing/mapmatch/types';
import {
  normalizeOrderedPoints,
  routePointDistanceM,
  validRoutePoint,
} from './orderedRouteDraft';

export const ROUTE_MATCH_MAX_COORDINATES = 100;
export const ROUTE_MATCH_CHUNK_COORDINATES = 90;
export const ROUTE_MATCH_MAX_CHUNKS = 8;
export const ROUTE_DRAW_TOTAL_DEADLINE_MS = 18_000;
export const ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M = 25;
export const ROUTE_MATCH_REVIEW_DEVIATION_M = 45;
export const ROUTE_MATCH_REJECT_DEVIATION_M = 90;
export const ROUTE_FREE_TERMINAL_MAX_LATERAL_M = 10;
// Map Matching follows a trace; it is not Directions. A candidate that stays
// spatially nearby by repeatedly looping/retracing can evade point-to-line and
// Fréchet bounds while multiplying distance. Keep that provider artefact out
// of canonical geometry and retain the user's coherent manual stroke instead.
export const ROUTE_MATCH_MAX_LENGTH_RATIO = 1.8;
export const ROUTE_MATCH_MIN_LENGTH_RATIO = 0.45;

export type RouteProviderReason =
  | 'invalid-input'
  | 'no-route'
  | 'no-match'
  | 'provider-unavailable'
  | 'split-match'
  | 'endpoint-shift'
  | 'shape-deviation'
  | 'chunk-seam'
  | 'operation-timeout'
  | 'cancelled';

export interface DrawPlanPart {
  points: RoutePoint[];
  resolution: 'draw-matched' | 'draw-manual';
  /** Inclusive input indices in the resampled operation trace. */
  inputStartIndex: number;
  inputEndIndex: number;
}

export type DrawPlanResolution =
  | { outcome: 'accepted'; points: RoutePoint[]; parts: DrawPlanPart[]; callCount: number; fallbackReason?: RouteProviderReason }
  | { outcome: 'review'; points: RoutePoint[]; reason: RouteProviderReason; callCount: number }
  | { outcome: 'manual-available'; rawPoints: RoutePoint[]; reason: RouteProviderReason; callCount: number }
  | { outcome: 'rejected'; reason: RouteProviderReason; callCount: number };

export type PointPlanResolution =
  | { outcome: 'accepted'; points: RoutePoint[]; providerStartShiftM: number; providerTargetShiftM: number }
  | { outcome: 'review'; points: RoutePoint[]; reason: RouteProviderReason; providerStartShiftM: number; providerTargetShiftM: number }
  | { outcome: 'rejected'; reason: RouteProviderReason };

export type DrawMatcher = (segment: MatchSegment, options?: { signal?: AbortSignal }) => Promise<MatchResult>;
export type PointRouter = (
  start: WalkingPlanPoint,
  destination: WalkingPlanPoint,
  signal?: AbortSignal,
) => Promise<WalkingPlanPoint[]>;

/** Even arc-index resampling. It preserves order, first/last and ordered revisits. */
export function resampleOrderedForBudget(points: RoutePoint[], maxCount: number): RoutePoint[] {
  if (points.length <= maxCount) return points.map(point => ({ ...point }));
  if (maxCount < 2) return [];
  const result: RoutePoint[] = [];
  const last = points.length - 1;
  for (let index = 0; index < maxCount; index += 1) {
    result.push({ ...points[Math.round(index * last / (maxCount - 1))] });
  }
  return result;
}

export function chunkOrderedTrace(points: RoutePoint[]): RoutePoint[][] {
  const bounded = resampleOrderedForBudget(
    points,
    ROUTE_MATCH_CHUNK_COORDINATES * ROUTE_MATCH_MAX_CHUNKS - (ROUTE_MATCH_MAX_CHUNKS - 1),
  );
  const chunks: RoutePoint[][] = [];
  let offset = 0;
  while (offset < bounded.length - 1) {
    const end = Math.min(bounded.length, offset + ROUTE_MATCH_CHUNK_COORDINATES);
    chunks.push(bounded.slice(offset, end));
    if (end === bounded.length) break;
    offset = end - 1;
  }
  return chunks;
}

function pointToSegmentDistanceM(point: RoutePoint, start: RoutePoint, end: RoutePoint): number {
  const metresPerLat = 111_000;
  const metresPerLng = metresPerLat * Math.cos(point.lat * Math.PI / 180);
  const ax = (start.lng - point.lng) * metresPerLng;
  const ay = (start.lat - point.lat) * metresPerLat;
  const bx = (end.lng - point.lng) * metresPerLng;
  const by = (end.lat - point.lat) * metresPerLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function maxPointToPolylineDistanceM(source: RoutePoint[], candidate: RoutePoint[]): number {
  let max = 0;
  for (const point of source) {
    let nearest = Infinity;
    for (let index = 1; index < candidate.length; index += 1) {
      nearest = Math.min(nearest, pointToSegmentDistanceM(point, candidate[index - 1], candidate[index]));
    }
    max = Math.max(max, nearest);
  }
  return max;
}

function polylineLengthM(points: RoutePoint[]): number {
  return points.slice(1).reduce(
    (total, point, index) => total + routePointDistanceM(points[index], point),
    0,
  );
}

function orderedLengthRatioIsPlausible(source: RoutePoint[], candidate: RoutePoint[]): boolean {
  const sourceLengthM = polylineLengthM(source);
  const candidateLengthM = polylineLengthM(candidate);
  if (sourceLengthM <= 0.35 || candidateLengthM <= 0.35) return false;
  const ratio = candidateLengthM / sourceLengthM;
  return ratio >= ROUTE_MATCH_MIN_LENGTH_RATIO && ratio <= ROUTE_MATCH_MAX_LENGTH_RATIO;
}

/**
 * Equal-distance progress sampling is independent of provider vertex density.
 * It preserves traversal order while avoiding the false deviation produced by
 * comparing a two-vertex line with the same line split into hundreds of
 * vertices.
 */
function resamplePolylineProgress(points: RoutePoint[], count: number): RoutePoint[] {
  if (points.length < 2 || count < 2) return points.map(point => ({ ...point }));
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + routePointDistanceM(points[index - 1], points[index]));
  }
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= 0) return points.map(point => ({ ...point }));
  const result: RoutePoint[] = [];
  let segment = 1;
  for (let index = 0; index < count; index += 1) {
    const target = total * index / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const startDistance = cumulative[segment - 1];
    const endDistance = cumulative[segment];
    const fraction = endDistance === startDistance ? 0 : (target - startDistance) / (endDistance - startDistance);
    const start = points[segment - 1];
    const end = points[segment];
    result.push({
      lat: start.lat + (end.lat - start.lat) * fraction,
      lng: start.lng + (end.lng - start.lng) * fraction,
      ...(Number.isFinite(start.alt) && Number.isFinite(end.alt)
        ? { alt: Number(start.alt) + (Number(end.alt) - Number(start.alt)) * fraction }
        : {}),
    });
  }
  result[0] = { ...points[0] };
  result[result.length - 1] = { ...points[points.length - 1] };
  return result;
}

/** Order-sensitive discrete Fréchet distance over density-normalized paths. */
function orderedFrechetDistanceM(source: RoutePoint[], candidate: RoutePoint[]): number {
  const rows = source.length;
  const columns = candidate.length;
  const previous = new Array<number>(columns).fill(Infinity);
  const current = new Array<number>(columns).fill(Infinity);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const distance = routePointDistanceM(source[row], candidate[column]);
      if (row === 0 && column === 0) current[column] = distance;
      else if (row === 0) current[column] = Math.max(current[column - 1], distance);
      else if (column === 0) current[column] = Math.max(previous[column], distance);
      else current[column] = Math.max(Math.min(previous[column], previous[column - 1], current[column - 1]), distance);
    }
    for (let column = 0; column < columns; column += 1) {
      previous[column] = current[column];
      current[column] = Infinity;
    }
  }
  return previous[columns - 1];
}

export function orderedShapeDeviationM(source: RoutePoint[], candidate: RoutePoint[]): number {
  if (source.length < 2 || candidate.length < 2) return Infinity;
  const progressSource = resamplePolylineProgress(source, ROUTE_MATCH_MAX_COORDINATES);
  const progressCandidate = resamplePolylineProgress(candidate, ROUTE_MATCH_MAX_COORDINATES);
  return Math.max(
    // Evaluate every original vertex in both directions. Request-budget
    // sampling must never hide a provider-added spur or a collapsed detour.
    maxPointToPolylineDistanceM(source, candidate),
    maxPointToPolylineDistanceM(candidate, source),
    orderedFrechetDistanceM(progressSource, progressCandidate),
  );
}

function providerFailureReason(result: Extract<MatchResult, { ok: false }>): RouteProviderReason {
  if (result.reason === 'no-match') return 'no-match';
  if (result.reason === 'invalid-input') return 'invalid-input';
  return 'provider-unavailable';
}

function mergeDrawParts(parts: DrawPlanPart[]): DrawPlanPart[] {
  const output: DrawPlanPart[] = [];
  for (const source of parts) {
    const points = normalizeOrderedPoints(source.points);
    if (points.length < 2) continue;
    const part: DrawPlanPart = { ...source, points };
    const previous = output.at(-1);
    if (previous && previous.resolution === part.resolution
      && routePointDistanceM(previous.points.at(-1)!, part.points[0]) <= ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M) {
      part.points[0] = { ...previous.points.at(-1)! };
      previous.points.push(...part.points.slice(1));
      previous.inputEndIndex = part.inputEndIndex;
    } else {
      output.push(part);
    }
  }
  return output;
}

function joinedDrawPoints(parts: DrawPlanPart[]): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (const part of parts) {
    const start = points.length > 0
      && routePointDistanceM(points.at(-1)!, part.points[0]) <= ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M
      ? 1 : 0;
    if (start === 1) part.points[0] = { ...points.at(-1)! };
    points.push(...part.points.slice(start).map(point => ({ ...point })));
  }
  return normalizeOrderedPoints(points);
}

function rawPart(points: RoutePoint[], start: number, end: number): DrawPlanPart | null {
  const boundedStart = Math.max(0, Math.min(points.length - 1, start));
  const boundedEnd = Math.max(boundedStart, Math.min(points.length - 1, end));
  const rawPoints = normalizeOrderedPoints(points.slice(boundedStart, boundedEnd + 1));
  return rawPoints.length >= 2
    ? { points: rawPoints, resolution: 'draw-manual', inputStartIndex: boundedStart, inputEndIndex: boundedEnd }
    : null;
}

/**
 * Correct only a tiny unsupported pen-up tail when its endpoint is a lateral
 * miss beside a stable forward trend. The tail remains explicitly manual;
 * this does not relabel it as provider-routed or extend it past the user's
 * along-track intent.
 */
function reconcileFreeTerminalPenUp(chunk: RoutePoint[], parts: DrawPlanPart[]): void {
  const manual = parts.at(-1);
  const matched = parts.at(-2);
  if (!manual || !matched
    || manual.resolution !== 'draw-manual'
    || matched.resolution !== 'draw-matched'
    || manual.inputEndIndex !== chunk.length - 1) return;
  // The provider may support the final tracepoint only as an isolated sample,
  // leaving a longer manual run. Endpoint intent is still determined by the
  // final raw sample versus the stable raw direction immediately before it.
  const anchorIndex = chunk.length - 2;
  const trendStartIndex = anchorIndex - 1;
  const trendStart = chunk[trendStartIndex];
  const anchor = chunk[anchorIndex];
  const rawEnd = chunk.at(-1)!;
  const latitude = (trendStart.lat + anchor.lat + rawEnd.lat) / 3;
  const lngScale = 111_320 * Math.cos(latitude * Math.PI / 180);
  const latScale = 110_574;
  const trendX = (anchor.lng - trendStart.lng) * lngScale;
  const trendY = (anchor.lat - trendStart.lat) * latScale;
  const trendLengthM = Math.hypot(trendX, trendY);
  if (trendLengthM < 6) return;
  if (trendStartIndex > 0) {
    const before = chunk[trendStartIndex - 1];
    const previousX = (trendStart.lng - before.lng) * lngScale;
    const previousY = (trendStart.lat - before.lat) * latScale;
    const previousLengthM = Math.hypot(previousX, previousY);
    const directionAgreement = previousLengthM <= 1e-9
      ? -1
      : (previousX * trendX + previousY * trendY) / (previousLengthM * trendLengthM);
    if (directionAgreement < Math.cos(45 * Math.PI / 180)) return;
  }
  const endX = (rawEnd.lng - anchor.lng) * lngScale;
  const endY = (rawEnd.lat - anchor.lat) * latScale;
  const endDistanceM = Math.hypot(endX, endY);
  if (endDistanceM < 1) return;
  const unitX = trendX / trendLengthM;
  const unitY = trendY / trendLengthM;
  const alongM = endX * unitX + endY * unitY;
  const lateralM = Math.abs(endX * unitY - endY * unitX);
  // A genuine turn/return has little forward component or a substantial
  // lateral move. Preserve it as the user's manual geometry.
  if (alongM < Math.max(2, endDistanceM * 0.35)
    || lateralM < 3
    || lateralM > ROUTE_FREE_TERMINAL_MAX_LATERAL_M) return;
  const effectiveEnd = {
    ...rawEnd,
    lng: anchor.lng + alongM * unitX / lngScale,
    lat: anchor.lat + alongM * unitY / latScale,
  };
  if (routePointDistanceM(rawEnd, effectiveEnd) > ROUTE_FREE_TERMINAL_MAX_LATERAL_M) return;
  manual.points[manual.points.length - 1] = effectiveEnd;
}

function partsForMatchResult(
  chunk: RoutePoint[],
  result: Extract<MatchResult, { ok: true }>,
): { parts: DrawPlanPart[]; fallbackReason?: RouteProviderReason } {
  const mapped = result.segments
    .filter(segment => Number.isInteger(segment.inputStartIndex) && Number.isInteger(segment.inputEndIndex))
    .map(segment => ({
      segment,
      start: Math.max(0, Math.min(chunk.length - 1, Number(segment.inputStartIndex))),
      end: Math.max(0, Math.min(chunk.length - 1, Number(segment.inputEndIndex))),
    }))
    .filter(item => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Legacy fixtures and a provider response without tracepoint correspondence
  // can only be accepted as one whole supported run. Split output without
  // correspondence is deliberately kept manual instead of guessed together.
  if (mapped.length === 0) {
    if (result.segments.length !== 1) {
      const manual = rawPart(chunk, 0, chunk.length - 1);
      return { parts: manual ? [manual] : [], fallbackReason: 'split-match' };
    }
    mapped.push({ segment: result.segments[0], start: 0, end: chunk.length - 1 });
  }

  const parts: DrawPlanPart[] = [];
  let fallbackReason: RouteProviderReason | undefined;
  let cursor = 0;
  for (const { segment, start, end } of mapped) {
    if (start < cursor) continue;
    if (start > cursor) {
      fallbackReason = fallbackReason ?? 'split-match';
      const manual = rawPart(chunk, cursor, start);
      if (manual) parts.push(manual);
    }
    const matched = normalizeOrderedPoints(segment.points);
    const rawRun = chunk.slice(start, end + 1);
    const startShiftM = matched.length >= 2 ? routePointDistanceM(rawRun[0], matched[0]) : Infinity;
    const endShiftM = matched.length >= 2 ? routePointDistanceM(rawRun.at(-1)!, matched.at(-1)!) : Infinity;
    const deviationM = matched.length >= 2 ? orderedShapeDeviationM(rawRun, matched) : Infinity;
    const supported = matched.length >= 2
      && startShiftM <= ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M
      && endShiftM <= ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M
      && (segment.alternativesCount == null || segment.alternativesCount === 0)
      && orderedLengthRatioIsPlausible(rawRun, matched)
      && deviationM <= ROUTE_MATCH_REVIEW_DEVIATION_M;
    if (supported) {
      // Do not force the free provider endpoint back to the finger-up point.
      // Adjacent manual runs adopt this endpoint below, so the saved geometry
      // remains continuous without manufacturing a terminal hook.
      const previous = parts.at(-1);
      if (previous) previous.points[previous.points.length - 1] = { ...matched[0] };
      parts.push({
        points: matched,
        resolution: 'draw-matched',
        inputStartIndex: start,
        inputEndIndex: end,
      });
    } else {
      fallbackReason = matched.length < 2
        ? 'no-match'
        : (segment.alternativesCount ?? 0) > 0
          ? 'split-match'
        : startShiftM > ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M || endShiftM > ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M
          ? 'endpoint-shift'
          : 'shape-deviation';
      const manual = rawPart(chunk, start, end);
      if (manual) parts.push(manual);
    }
    cursor = end;
  }
  if (cursor < chunk.length - 1) {
    fallbackReason = fallbackReason ?? 'split-match';
    const manual = rawPart(chunk, cursor, chunk.length - 1);
    if (manual) {
      const previous = parts.at(-1);
      if (previous) manual.points[0] = { ...previous.points.at(-1)! };
      parts.push(manual);
    }
  }
  return { parts: mergeDrawParts(parts), fallbackReason };
}

/**
 * Draw preserves every ordered input interval. Provider-supported contiguous
 * runs become matched parts; unsupported runs remain manual parts in the same
 * atomic operation. No unknown interval is silently bridged.
 */
export async function resolveDrawPlan(
  raw: RoutePoint[],
  options: { signal?: AbortSignal; matcher?: DrawMatcher } = {},
): Promise<DrawPlanResolution> {
  const normalized = normalizeOrderedPoints(raw);
  if (normalized.length < 2 || !raw.every(validRoutePoint)) {
    return { outcome: 'rejected', reason: 'invalid-input', callCount: 0 };
  }
  const matcher = options.matcher ?? matchSegment;
  const chunks = chunkOrderedTrace(normalized);
  const parts: DrawPlanPart[] = [];
  let calls = 0;
  let globalOffset = 0;
  let fallbackReason: RouteProviderReason | undefined;
  const deadlineController = new AbortController();
  const deadlineAt = Date.now() + ROUTE_DRAW_TOTAL_DEADLINE_MS;
  const abortForCaller = () => deadlineController.abort();
  options.signal?.addEventListener('abort', abortForCaller, { once: true });
  const deadlineTimer = setTimeout(() => deadlineController.abort(), ROUTE_DRAW_TOTAL_DEADLINE_MS);
  try {
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    if (deadlineController.signal.aborted) {
      if (options.signal?.aborted) return { outcome: 'rejected', reason: 'cancelled', callCount: calls };
      fallbackReason = 'operation-timeout';
      const remaining = normalizeOrderedPoints(normalized.slice(globalOffset));
      if (remaining.length >= 2) parts.push({
        points: remaining, resolution: 'draw-manual',
        inputStartIndex: globalOffset, inputEndIndex: normalized.length - 1,
      });
      break;
    }
    calls += 1;
    let callTimer: ReturnType<typeof setTimeout> | undefined;
    const matchPromise = matcher({
      coords: chunk.map(point => ({ lng: point.lng, lat: point.lat, alt: point.alt })),
      radiuses: chunk.map(() => 25),
      viaIndicesInCoords: [0, chunk.length - 1],
    }, { signal: deadlineController.signal });
    const timeoutPromise = new Promise<MatchResult>(resolve => {
      callTimer = setTimeout(() => {
        deadlineController.abort();
        resolve({ ok: false, reason: 'timeout', detail: 'operation-deadline', durationMs: ROUTE_DRAW_TOTAL_DEADLINE_MS });
      }, Math.max(0, deadlineAt - Date.now()));
    });
    const result = await Promise.race([matchPromise, timeoutPromise]);
    if (callTimer) clearTimeout(callTimer);
    if (!result.ok) {
      if (deadlineController.signal.aborted && options.signal?.aborted) {
        return { outcome: 'rejected', reason: 'cancelled', callCount: calls };
      }
      fallbackReason = deadlineController.signal.aborted
        ? 'operation-timeout'
        : providerFailureReason(result);
      const remaining = normalizeOrderedPoints(normalized.slice(globalOffset));
      if (remaining.length >= 2) parts.push({
        points: remaining, resolution: 'draw-manual',
        inputStartIndex: globalOffset, inputEndIndex: normalized.length - 1,
      });
      break;
    } else {
      const chunkResolution = partsForMatchResult(chunk, result);
      const chunkParts = chunkResolution.parts.map(part => ({
        ...part,
        inputStartIndex: part.inputStartIndex + globalOffset,
        inputEndIndex: part.inputEndIndex + globalOffset,
      }));
      if (chunkResolution.fallbackReason) fallbackReason = chunkResolution.fallbackReason;
      const previous = parts.at(-1);
      const first = chunkParts[0];
      if (previous && first) {
        if (routePointDistanceM(previous.points.at(-1)!, first.points[0]) > ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M) {
          const remaining = normalizeOrderedPoints(normalized.slice(globalOffset));
          if (remaining.length >= 2) parts.push({
            points: remaining, resolution: 'draw-manual',
            inputStartIndex: globalOffset, inputEndIndex: normalized.length - 1,
          });
          fallbackReason = 'chunk-seam';
          break;
        }
        first.points[0] = { ...previous.points.at(-1)! };
      }
      parts.push(...chunkParts);
    }
    globalOffset += chunk.length - 1;
  }
  } finally {
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener('abort', abortForCaller);
  }
  const mergedParts = mergeDrawParts(parts);
  // A provider response can leave adjacent unsupported sub-runs at the free
  // end (for example an unsupported segment followed by a trailing gap).
  // They become one coherent manual tail only after the complete operation is
  // merged. Reconcile against that final structure so a small pen-up miss is
  // not skipped merely because the provider split the unsupported tail.
  reconcileFreeTerminalPenUp(normalized, mergedParts);
  const points = joinedDrawPoints(mergedParts);
  if (points.length < 2) {
    return { outcome: 'rejected', reason: fallbackReason ?? 'no-match', callCount: calls };
  }
  // Validate the actual post-seam/post-endpoint shape, not merely each
  // provider candidate before composition. A suspicious composed result
  // falls back to the coherent hand-drawn operation without inventing gaps.
  if (!orderedLengthRatioIsPlausible(normalized, points)
    || orderedShapeDeviationM(normalized, points) > ROUTE_MATCH_REVIEW_DEVIATION_M) {
    return {
      outcome: 'accepted',
      points: normalized,
      parts: [{
        points: normalized,
        resolution: 'draw-manual',
        inputStartIndex: 0,
        inputEndIndex: normalized.length - 1,
      }],
      callCount: calls,
      fallbackReason: 'shape-deviation',
    };
  }
  return { outcome: 'accepted', points, parts: mergedParts, callCount: calls, ...(fallbackReason ? { fallbackReason } : {}) };
}

export async function resolvePointPlan(
  start: RoutePoint,
  target: RoutePoint,
  options: { signal?: AbortSignal; router?: PointRouter } = {},
): Promise<PointPlanResolution> {
  if (!validRoutePoint(start) || !validRoutePoint(target)) {
    return { outcome: 'rejected', reason: 'invalid-input' };
  }
  if (routePointDistanceM(start, target) <= 0.35) {
    return { outcome: 'rejected', reason: 'invalid-input' };
  }
  try {
    const routed = normalizeOrderedPoints(await (options.router ?? planWalkingRoute)(start, target, options.signal));
    if (routed.length < 2) return { outcome: 'rejected', reason: 'no-route' };
    const startShift = routePointDistanceM(start, routed[0]);
    const endShift = routePointDistanceM(target, routed[routed.length - 1]);
    if (startShift > ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M || endShift > ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M) {
      return { outcome: 'review', points: routed, reason: 'endpoint-shift', providerStartShiftM: startShift, providerTargetShiftM: endShift };
    }
    // Preserve the provider's actual snapped waypoints. The editor records
    // the raw target separately and applies its bounded continuity policy to
    // choose an effective target. Replacing this endpoint with the raw tap
    // manufactured the small connector/spur we are specifically avoiding.
    return { outcome: 'accepted', points: routed, providerStartShiftM: startShift, providerTargetShiftM: endShift };
  } catch (error: any) {
    return {
      outcome: 'rejected',
      reason: error?.code === 'NO_ROUTE' ? 'no-route' : 'provider-unavailable',
    };
  }
}
