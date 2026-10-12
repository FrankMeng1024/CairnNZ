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
export const ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M = 25;
export const ROUTE_MATCH_REVIEW_DEVIATION_M = 45;
export const ROUTE_MATCH_REJECT_DEVIATION_M = 90;

export type RouteProviderReason =
  | 'invalid-input'
  | 'no-route'
  | 'no-match'
  | 'provider-unavailable'
  | 'split-match'
  | 'endpoint-shift'
  | 'shape-deviation'
  | 'chunk-seam';

export type DrawPlanResolution =
  | { outcome: 'accepted'; points: RoutePoint[]; callCount: number }
  | { outcome: 'review'; points: RoutePoint[]; reason: RouteProviderReason; callCount: number }
  | { outcome: 'manual-available'; rawPoints: RoutePoint[]; reason: RouteProviderReason; callCount: number }
  | { outcome: 'rejected'; reason: RouteProviderReason; callCount: number };

export type PointPlanResolution =
  | { outcome: 'accepted'; points: RoutePoint[] }
  | { outcome: 'review'; points: RoutePoint[]; reason: RouteProviderReason }
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

/** Order-sensitive discrete Fréchet distance, bounded to provider limits. */
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
  const boundedSource = resampleOrderedForBudget(source, ROUTE_MATCH_MAX_COORDINATES);
  const boundedCandidate = resampleOrderedForBudget(candidate, ROUTE_MATCH_MAX_COORDINATES);
  return Math.max(
    maxPointToPolylineDistanceM(boundedSource, boundedCandidate),
    maxPointToPolylineDistanceM(boundedCandidate, boundedSource),
    orderedFrechetDistanceM(boundedSource, boundedCandidate),
  );
}

function providerFailureReason(result: Extract<MatchResult, { ok: false }>): RouteProviderReason {
  if (result.reason === 'no-match') return 'no-match';
  if (result.reason === 'invalid-input') return 'invalid-input';
  return 'provider-unavailable';
}

/**
 * Draw retains the complete submitted shape. Provider output is accepted only
 * when every bounded chunk is one coherent match with connected seams. A raw
 * connected stroke remains available for the user's explicit manual choice.
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
  const stitched: RoutePoint[] = [];
  let calls = 0;
  for (const chunk of chunks) {
    calls += 1;
    const result = await matcher({
      coords: chunk.map(point => ({ lng: point.lng, lat: point.lat, alt: point.alt })),
      radiuses: chunk.map(() => 25),
      viaIndicesInCoords: [0, chunk.length - 1],
    }, { signal: options.signal });
    if (!result.ok) {
      return {
        outcome: 'manual-available',
        rawPoints: normalized,
        reason: providerFailureReason(result),
        callCount: calls,
      };
    }
    if (result.segments.length !== 1) {
      return { outcome: 'manual-available', rawPoints: normalized, reason: 'split-match', callCount: calls };
    }
    const matched = normalizeOrderedPoints(result.segments[0].points);
    if (matched.length < 2) {
      return { outcome: 'manual-available', rawPoints: normalized, reason: 'no-match', callCount: calls };
    }
    if (routePointDistanceM(chunk[0], matched[0]) > ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M
      || routePointDistanceM(chunk[chunk.length - 1], matched[matched.length - 1]) > ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M) {
      return { outcome: 'manual-available', rawPoints: normalized, reason: 'endpoint-shift', callCount: calls };
    }
    if (stitched.length > 0) {
      const previous = stitched[stitched.length - 1];
      if (routePointDistanceM(previous, matched[0]) > ROUTE_PROVIDER_ENDPOINT_TOLERANCE_M) {
        return { outcome: 'manual-available', rawPoints: normalized, reason: 'chunk-seam', callCount: calls };
      }
      matched[0] = { ...previous };
      stitched.push(...matched.slice(1));
    } else {
      stitched.push(...matched);
    }
  }
  // Both directions plus ordered Fréchet prevent a matcher from adding an
  // unrequested far spur or collapsing a loop while retaining the raw input
  // vertices somewhere in the response.
  const maxDeviation = orderedShapeDeviationM(normalized, stitched);
  if (maxDeviation > ROUTE_MATCH_REJECT_DEVIATION_M) {
    return { outcome: 'manual-available', rawPoints: normalized, reason: 'shape-deviation', callCount: calls };
  }
  // Re-anchor only the overall endpoints after the provider has passed the
  // bounded shift check. No interior straight connector is manufactured.
  stitched[0] = { ...normalized[0] };
  stitched[stitched.length - 1] = { ...normalized[normalized.length - 1] };
  if (maxDeviation > ROUTE_MATCH_REVIEW_DEVIATION_M) {
    return { outcome: 'review', points: stitched, reason: 'shape-deviation', callCount: calls };
  }
  return { outcome: 'accepted', points: stitched, callCount: calls };
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
      return { outcome: 'review', points: routed, reason: 'endpoint-shift' };
    }
    routed[0] = { ...start };
    routed[routed.length - 1] = { ...target };
    return { outcome: 'accepted', points: routed };
  } catch (error: any) {
    return {
      outcome: 'rejected',
      reason: error?.code === 'NO_ROUTE' ? 'no-route' : 'provider-unavailable',
    };
  }
}
