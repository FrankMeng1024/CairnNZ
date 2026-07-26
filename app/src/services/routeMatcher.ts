/**
 * routeMatcher — snap a raw GPS trackpoint sequence to the road network.
 *
 * Wraps the Mapbox Map Matching API:
 *   POST /matching/v5/mapbox/walking/{coords}
 *
 * Used when a user converts an Activity → Route. Cairn's product
 * philosophy: "we respect routes you actually walked, but the SAVED
 * route should always start from the nearest public road, not from
 * inside someone's house." So we run the trackpoints through Map
 * Matching, then trim leading/trailing points whose snapped distance
 * to the polyline is implausibly large (> 30m == probably the user
 * was at home / off-grid).
 *
 * Failure modes:
 *   - No network → return original trackPoints, isSnapped=false
 *   - API rate limit / 429 → same
 *   - Match confidence < 0.5 (Map Matching can't make sense of the
 *     trace) → same
 *   - More than 100 input coords → downsample first (API cap)
 *
 * Always returns SOMETHING — either a snapped polyline + trim or the
 * raw trackpoints. Caller never has to handle null.
 */

import { crashLogger } from './crashLogger';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
const MAX_COORDS_PER_REQUEST = 100; // Mapbox Map Matching cap
const HOME_TRIM_THRESHOLD_M = 30; // distance from match polyline that counts as "off-road"

interface MatchedRoute {
  /** snapped (or raw) coordinate pairs */
  points: Array<{ lat: number; lng: number }>;
  /** total distance in metres (from API or computed) */
  distanceM: number;
  /** true if Map Matching API returned a valid match */
  isSnapped: boolean;
  /** how many points were trimmed off the start (off-road tail) */
  trimmedStart: number;
  /** how many points were trimmed off the end */
  trimmedEnd: number;
}

interface RawPoint { lat: number; lng: number }

/**
 * Downsample a long trackpoint list to <= MAX_COORDS_PER_REQUEST.
 * Even-spaced sampling preserves overall shape better than head/tail.
 */
function downsample(points: RawPoint[], target: number): RawPoint[] {
  if (points.length <= target) return points;
  const step = points.length / target;
  const out: RawPoint[] = [];
  for (let i = 0; i < target; i++) {
    out.push(points[Math.floor(i * step)]);
  }
  // Always include the last point so the route ends where the user did.
  if (out[out.length - 1] !== points[points.length - 1]) {
    out[out.length - 1] = points[points.length - 1];
  }
  return out;
}

function haversineMeters(a: RawPoint, b: RawPoint): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Snap a track to the road network and trim off-road head/tail.
 *
 * @param rawPoints  raw trackpoints (lat/lng)
 * @param profile    'walking' | 'cycling' | 'driving'. Default 'walking'.
 */
export async function snapToRoadAndTrim(
  rawPoints: RawPoint[],
  profile: 'walking' | 'cycling' | 'driving' = 'walking',
): Promise<MatchedRoute> {
  const fallback: MatchedRoute = {
    points: rawPoints,
    distanceM: rawPoints.reduce((sum, p, i) =>
      i === 0 ? 0 : sum + haversineMeters(rawPoints[i - 1], p), 0),
    isSnapped: false,
    trimmedStart: 0,
    trimmedEnd: 0,
  };

  if (!MAPBOX_TOKEN) {
    crashLogger.breadcrumb('routeMatcher:no-token');
    return fallback;
  }
  if (rawPoints.length < 2) {
    crashLogger.breadcrumb('routeMatcher:too-short');
    return fallback;
  }

  const sampled = downsample(rawPoints, MAX_COORDS_PER_REQUEST);
  const coordStr = sampled.map(p => `${p.lng},${p.lat}`).join(';');

  crashLogger.breadcrumb(`routeMatcher:request n=${sampled.length} profile=${profile}`);

  try {
    const url =
      `https://api.mapbox.com/matching/v5/mapbox/${profile}/${coordStr}` +
      `?geometries=geojson&overview=full&radiuses=${sampled.map(() => 25).join(';')}` +
      `&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) {
      crashLogger.breadcrumb(`routeMatcher:http-${res.status}`);
      return fallback;
    }
    const data = await res.json();
    const matching = data?.matchings?.[0];
    if (!matching || matching.confidence < 0.5) {
      crashLogger.breadcrumb(`routeMatcher:low-confidence ${matching?.confidence ?? 'none'}`);
      return fallback;
    }

    const snappedCoords: Array<[number, number]> =
      matching.geometry?.coordinates ?? [];
    const snappedPoints: RawPoint[] = snappedCoords.map(([lng, lat]) => ({ lat, lng }));

    if (snappedPoints.length < 2) {
      crashLogger.breadcrumb('routeMatcher:no-coords-in-match');
      return fallback;
    }

    // Trim head: walk from the start until the original point is within
    // HOME_TRIM_THRESHOLD_M of the snapped polyline. Approximation: just
    // check distance to nearest snapped point. Good enough for "is this
    // point on the road?".
    let trimmedStart = 0;
    for (let i = 0; i < rawPoints.length; i++) {
      const minDist = snappedPoints.reduce(
        (m, sp) => Math.min(m, haversineMeters(rawPoints[i], sp)),
        Infinity,
      );
      if (minDist <= HOME_TRIM_THRESHOLD_M) break;
      trimmedStart++;
    }

    // Trim tail: same idea from the end.
    let trimmedEnd = 0;
    for (let i = rawPoints.length - 1; i >= 0; i--) {
      const minDist = snappedPoints.reduce(
        (m, sp) => Math.min(m, haversineMeters(rawPoints[i], sp)),
        Infinity,
      );
      if (minDist <= HOME_TRIM_THRESHOLD_M) break;
      trimmedEnd++;
    }

    crashLogger.breadcrumb(
      `routeMatcher:ok n=${snappedPoints.length} dist=${Math.round(matching.distance ?? 0)} trim=${trimmedStart}/${trimmedEnd}`,
    );

    return {
      points: snappedPoints,
      distanceM: matching.distance ?? fallback.distanceM,
      isSnapped: true,
      trimmedStart,
      trimmedEnd,
    };
  } catch (err) {
    crashLogger.breadcrumb(`routeMatcher:throw ${String(err).slice(0, 60)}`);
    return fallback;
  }
}
