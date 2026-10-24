import { resolveMapboxPublicToken } from '../../config/mapbox';

export type WalkingPlanPoint = { lat: number; lng: number };
export const WALKING_PLAN_TIMEOUT_MS = 10_000;
export type WalkingPlanErrorCode =
  | 'NO_TOKEN'
  | 'NO_ROUTE'
  | 'NETWORK'
  | 'UNAUTHORIZED'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'INVALID_RESPONSE';

export class WalkingPlanError extends Error {
  constructor(public readonly code: WalkingPlanErrorCode) {
    super(code);
  }
}

/**
 * User-initiated point-to-point walking plan for a new Route draft. This is
 * deliberately separate from Activity map matching: it never claims the
 * returned line was walked and it is never used to rewrite an existing
 * Route's endpoints.
 */
export async function planWalkingRoute(
  start: WalkingPlanPoint,
  destination: WalkingPlanPoint,
  signal?: AbortSignal,
): Promise<WalkingPlanPoint[]> {
  const token = await resolveMapboxPublicToken();
  if (!token) throw new WalkingPlanError('NO_TOKEN');
  const coords = `${start.lng},${start.lat};${destination.lng},${destination.lat}`;
  // Bound waypoint snapping at the provider as well as in the editor. This
  // lets walking paths/trails participate without allowing a remote road
  // waypoint to masquerade as the selected neighborhood.
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?alternatives=false&geometries=geojson&overview=full&steps=false&radiuses=25%3B25&access_token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), WALKING_PLAN_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', signal: controller.signal });
  } catch {
    throw new WalkingPlanError('NETWORK');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new WalkingPlanError('UNAUTHORIZED');
    if (response.status === 404) throw new WalkingPlanError('NO_ROUTE');
    if (response.status === 429) throw new WalkingPlanError('RATE_LIMIT');
    if (response.status >= 500) throw new WalkingPlanError('SERVER');
    throw new WalkingPlanError('INVALID_RESPONSE');
  }
  const payload = await response.json().catch(() => null) as any;
  const raw = payload?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2) {
    // Directions returns HTTP 200 with `NoSegment` when one of the selected
    // coordinates has no walking-network segment inside the requested radius.
    // This is a truthful provider coverage result, not a malformed response.
    // Keep the Route unchanged and let Point offer Draw as the safe fallback.
    const code = payload?.code;
    throw new WalkingPlanError(code === 'NoRoute' || code === 'NoSegment' ? 'NO_ROUTE' : 'INVALID_RESPONSE');
  }
  const points = raw
    .filter((coordinate: unknown) => Array.isArray(coordinate) && coordinate.length >= 2)
    .map((coordinate: number[]) => ({ lng: Number(coordinate[0]), lat: Number(coordinate[1]) }))
    .filter((point: WalkingPlanPoint) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (points.length < 2) throw new WalkingPlanError('INVALID_RESPONSE');
  return points;
}
