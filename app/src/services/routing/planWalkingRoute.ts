import { resolveMapboxPublicToken } from '../../config/mapbox';

export type WalkingPlanPoint = { lat: number; lng: number };

export class WalkingPlanError extends Error {
  constructor(public readonly code: 'NO_TOKEN' | 'NO_ROUTE' | 'NETWORK' | 'INVALID_RESPONSE') {
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
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?alternatives=false&geometries=geojson&overview=full&steps=false&access_token=${encodeURIComponent(token)}`;
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', signal });
  } catch {
    throw new WalkingPlanError('NETWORK');
  }
  if (!response.ok) throw new WalkingPlanError(response.status === 404 ? 'NO_ROUTE' : 'NETWORK');
  const payload = await response.json().catch(() => null) as any;
  const raw = payload?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new WalkingPlanError(payload?.code === 'NoRoute' ? 'NO_ROUTE' : 'INVALID_RESPONSE');
  }
  const points = raw
    .filter((coordinate: unknown) => Array.isArray(coordinate) && coordinate.length >= 2)
    .map((coordinate: number[]) => ({ lng: Number(coordinate[0]), lat: Number(coordinate[1]) }))
    .filter((point: WalkingPlanPoint) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (points.length < 2) throw new WalkingPlanError('INVALID_RESPONSE');
  return points;
}
