import { isMapboxTokenConfigured } from '../../config/mapbox';
import { distanceMeters, validateCoordinate } from './geodesy';
import type { SimulatorCoordinate } from './types';
import { MAX_SIMULATOR_AUTOPILOT_POINTS } from './useActivitySimulatorStore';

export type SimulatorWalkingRouteFailure =
  | 'offline'
  | 'mapbox-token-unavailable'
  | 'invalid-coordinate'
  | 'request-failed'
  | 'no-walking-route';

export type SimulatorWalkingRouteResult =
  | { ok: true; points: SimulatorCoordinate[]; distanceM: number }
  | { ok: false; reason: SimulatorWalkingRouteFailure };

interface WalkingRouteOptions {
  isOnline?: boolean;
  mapboxToken?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function boundedGeometry(points: SimulatorCoordinate[]): SimulatorCoordinate[] {
  if (points.length <= MAX_SIMULATOR_AUTOPILOT_POINTS) return points;
  const last = points.length - 1;
  return Array.from({ length: MAX_SIMULATOR_AUTOPILOT_POINTS }, (_, index) => (
    points[Math.round((index * last) / (MAX_SIMULATOR_AUTOPILOT_POINTS - 1))]
  ));
}

/** Resolve future pedestrian/trail targets. This never creates a Route. */
export async function fetchSimulatorWalkingRoute(
  origin: SimulatorCoordinate,
  destination: SimulatorCoordinate,
  options: WalkingRouteOptions = {},
): Promise<SimulatorWalkingRouteResult> {
  if (options.isOnline === false) return { ok: false, reason: 'offline' };
  const validOrigin = validateCoordinate(origin.lat, origin.lng);
  const validDestination = validateCoordinate(destination.lat, destination.lng);
  if (!validOrigin.ok || !validDestination.ok) return { ok: false, reason: 'invalid-coordinate' };

  const token = (options.mapboxToken ?? process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '').trim();
  const explicitTokenValid = token.startsWith('pk.') && token.length >= 40;
  if (!(options.mapboxToken !== undefined ? explicitTokenValid : isMapboxTokenConfigured())) {
    return { ok: false, reason: 'mapbox-token-unavailable' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
  try {
    const coordinates = `${validOrigin.coordinate.lng},${validOrigin.coordinate.lat};${validDestination.coordinate.lng},${validDestination.coordinate.lat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordinates}?alternatives=false&geometries=geojson&overview=full&steps=false&access_token=${encodeURIComponent(token)}`;
    const response = await (options.fetchImpl ?? fetch)(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, reason: 'request-failed' };
    const payload = await response.json();
    const raw = payload?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(raw) || raw.length < 2) return { ok: false, reason: 'no-walking-route' };
    const validated = raw.flatMap((coordinate: unknown) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return [];
      const result = validateCoordinate(Number(coordinate[1]), Number(coordinate[0]));
      return result.ok ? [result.coordinate] : [];
    });
    if (validated.length < 2) return { ok: false, reason: 'no-walking-route' };

    const future = distanceMeters(validOrigin.coordinate, validated[0]) <= 2
      ? validated.slice(1)
      : validated;
    if (future.length === 0) return { ok: false, reason: 'no-walking-route' };
    const points = boundedGeometry(future);
    const responseDistanceM = Number(payload?.routes?.[0]?.distance);
    return {
      ok: true,
      points,
      distanceM: Number.isFinite(responseDistanceM)
        ? responseDistanceM
        : validated.slice(1).reduce((sum, point, index) => sum + distanceMeters(validated[index], point), 0),
    };
  } catch {
    return { ok: false, reason: 'request-failed' };
  } finally {
    clearTimeout(timer);
  }
}
