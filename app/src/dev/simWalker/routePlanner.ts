/**
 * SPIKE-006 sim-walker — routePlanner
 *
 * Fetches a walking polyline between two lng/lat points from Mapbox
 * Directions API (/directions/v5/mapbox/walking), builds a cumulative
 * arc-length table so we can interpolate `positionAt(m)` in O(log n),
 * and caches recent results keyed by rounded coordinates.
 *
 * Dev-only. Bundled out of production by the __DEV__ gate on isSimMode
 * in the module that imports this file.
 */

export interface RoutePoint {
  /** longitude */
  lng: number;
  /** latitude */
  lat: number;
}

export interface PlannedRoute {
  /** raw polyline coordinates from Mapbox (lng, lat pairs). */
  coords: [number, number][];
  /** cumulativeM[i] = distance in meters from coords[0] to coords[i]. */
  cumulativeM: number[];
  /** total route length in meters. */
  totalM: number;
}

const R_EARTH_M = 6_371_000;
const REQUEST_TIMEOUT_MS = 8_000;

function toRad(x: number): number {
  return (x * Math.PI) / 180;
}

/** Great-circle distance in meters between two [lng, lat] pairs. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(x));
}

/**
 * Interpolate a point on the route at the given arc-length (meters).
 * Clamps to [0, totalM]. Returns [lng, lat] or null when route empty.
 */
export function positionAt(
  route: PlannedRoute,
  m: number,
): [number, number] | null {
  if (!route || route.coords.length === 0) return null;
  const total = route.totalM;
  const clamped = Math.max(0, Math.min(total, m));
  const cum = route.cumulativeM;
  // binary search for the segment containing `clamped`
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= clamped) lo = mid;
    else hi = mid;
  }
  const segStart = cum[lo];
  const segEnd = cum[hi];
  const segLen = segEnd - segStart;
  const t = segLen > 0 ? (clamped - segStart) / segLen : 0;
  const [aLng, aLat] = route.coords[lo];
  const [bLng, bLat] = route.coords[hi];
  return [aLng + (bLng - aLng) * t, aLat + (bLat - aLat) * t];
}

// ── Cache ─────────────────────────────────────────────────────────
// Keyed by rounded coordinates so repeated planning between the same
// pair (within ~10m) reuses the previous polyline. Bounded LRU-ish:
// evict oldest when > 16 entries.

const cache = new Map<string, PlannedRoute>();
const CACHE_MAX = 16;

function cacheKey(a: RoutePoint, b: RoutePoint): string {
  // 4 decimal places ≈ 11m at equator — coarse enough to hit on repeat
  // taps at the same spot, fine enough that a real move gets a new key.
  const round = (n: number) => n.toFixed(4);
  return `${round(a.lng)},${round(a.lat)};${round(b.lng)},${round(b.lat)}`;
}

/**
 * Fetch a walking polyline from Mapbox Directions. Throws on network
 * error, timeout, or non-Ok response.
 */
export async function planWalkingRoute(
  a: RoutePoint,
  b: RoutePoint,
  mapboxToken: string,
): Promise<PlannedRoute> {
  const key = cacheKey(a, b);
  const cached = cache.get(key);
  if (cached) {
    // Refresh recency by re-inserting
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  if (!mapboxToken) {
    throw new Error('sim-walker: Mapbox token missing (EXPO_PUBLIC_MAPBOX_TOKEN).');
  }

  const url =
    `https://api.mapbox.com/directions/v5/mapbox/walking/` +
    `${a.lng},${a.lat};${b.lng},${b.lat}` +
    `?geometries=geojson&overview=full&access_token=${mapboxToken}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as { name?: string }).name === 'AbortError') {
      throw new Error('sim-walker: Directions request timed out.');
    }
    throw new Error(
      `sim-walker: Directions network error: ${(err as Error).message}`,
    );
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    throw new Error(
      `sim-walker: Directions HTTP ${res.status} ${res.statusText}`,
    );
  }

  const body: {
    code?: string;
    routes?: {
      geometry: { coordinates: [number, number][] };
    }[];
  } = await res.json();

  if (body.code !== 'Ok' || !body.routes || body.routes.length === 0) {
    throw new Error(
      `sim-walker: Directions returned no route (code=${body.code}).`,
    );
  }

  const coords = body.routes[0].geometry.coordinates;
  if (coords.length < 2) {
    throw new Error('sim-walker: Directions returned degenerate polyline.');
  }

  const cumulativeM: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulativeM.push(cumulativeM[i - 1] + haversineM(coords[i - 1], coords[i]));
  }
  const route: PlannedRoute = {
    coords,
    cumulativeM,
    totalM: cumulativeM[cumulativeM.length - 1],
  };

  // LRU eviction
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, route);

  return route;
}

/** Drop everything (test/reset). */
export function clearRouteCache(): void {
  cache.clear();
}
