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
}

/** One explicit submit equals one bounded search request; map panning never calls this API. */
export async function searchRoutePlaces(
  query: string,
  options: SearchOptions = {},
): Promise<RoutePlaceSearchResult[]> {
  const normalized = query.trim().slice(0, 120);
  if (normalized.length < 2) return [];
  const token = options.token ?? await resolveMapboxPublicToken();
  if (!token) throw new Error('MAPBOX_SEARCH_UNAVAILABLE');
  const request = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    q: normalized,
    limit: '5',
    types: 'place,locality,neighborhood,address,poi',
    language: 'en',
    access_token: token,
  });
  const response = await request(`https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`, {
    method: 'GET', signal: options.signal,
  });
  if (!response.ok) throw new Error(`MAPBOX_SEARCH_HTTP_${response.status}`);
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
}
