import { resolveMapboxPublicToken } from '../../config/mapbox';

export interface RoutePlaceSearchResult {
  id: string;
  label: string;
  center: { lat: number; lng: number };
}

interface SearchOptions {
  signal?: AbortSignal;
  token?: string;
  fetchImpl?: typeof fetch;
  proximity?: { lat: number; lng: number } | null;
  timeoutMs?: number;
}

export type RoutePlaceSearchErrorCode = 'unavailable' | 'unauthorized' | 'timeout' | 'cancelled' | 'request-failed';

export class RoutePlaceSearchError extends Error {
  constructor(public readonly code: RoutePlaceSearchErrorCode) {
    super(`ROUTE_PLACE_SEARCH_${code.toUpperCase().replace('-', '_')}`);
  }
}

/** One explicit submit equals one bounded search request; map panning never calls this API. */
export async function searchRoutePlaces(
  query: string,
  options: SearchOptions = {},
): Promise<RoutePlaceSearchResult[]> {
  const normalized = query.trim().slice(0, 120);
  if (normalized.length < 2) return [];
  const token = options.token ?? await resolveMapboxPublicToken();
  if (!token) throw new RoutePlaceSearchError('unavailable');
  const request = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = Math.max(250, options.timeoutMs ?? 8_000);
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) throw new RoutePlaceSearchError('cancelled');
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const params = new URLSearchParams({
    q: normalized,
    limit: '5',
    // Geocoding v6 has global city/street/address coverage but no POI type.
    // Sending `poi` made the real request invalid in every supported market.
    types: 'place,locality,neighborhood,street,address',
    language: 'en',
    access_token: token,
  });
  if (options.proximity && Number.isFinite(options.proximity.lat) && Number.isFinite(options.proximity.lng)) {
    params.set('proximity', `${options.proximity.lng},${options.proximity.lat}`);
  }
  try {
    const response = await request(`https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`, {
      method: 'GET', signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) throw new RoutePlaceSearchError('unauthorized');
    if (!response.ok) throw new RoutePlaceSearchError('request-failed');
    const payload = await response.json() as any;
    return (Array.isArray(payload?.features) ? payload.features : []).flatMap((feature: any) => {
      const coordinates = feature?.geometry?.coordinates;
      const lng = Number(coordinates?.[0]);
      const lat = Number(coordinates?.[1]);
      const label = String(feature?.properties?.full_address ?? feature?.properties?.name_preferred
        ?? feature?.properties?.name ?? '').trim();
      if (!feature?.id || !label || !Number.isFinite(lat) || !Number.isFinite(lng)
        || lat < -90 || lat > 90 || lng < -180 || lng > 180) return [];
      return [{ id: String(feature.id), label, center: { lat, lng } }];
    });
  } catch (error) {
    if (error instanceof RoutePlaceSearchError) throw error;
    if (timedOut) throw new RoutePlaceSearchError('timeout');
    if (options.signal?.aborted || controller.signal.aborted) throw new RoutePlaceSearchError('cancelled');
    throw new RoutePlaceSearchError('request-failed');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
