/**
 * PolylineSampler — Densify a LineString to evenly-spaced points.
 *
 * Used to convert DOC trail polylines into corridor candidate points
 * (every ~10m so kdbush can index them).
 *
 * Sprint 66 Wave 1.
 */

export interface LngLat {
  lng: number;
  lat: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance in meters between two lng/lat points. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

/**
 * Linear interpolate between a and b at fraction t in [0, 1].
 * Uses simple lng/lat lerp — accurate enough for ~10m intervals.
 */
function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
}

/**
 * Densify a polyline so consecutive points are no more than `intervalM` meters apart.
 *
 * Input: ordered list of LngLat from a LineString.
 * Output: same start/end, with intermediate points inserted via linear interp.
 *
 * Time: O(N) for total output length.
 */
export function densify(coords: LngLat[], intervalM: number = 10): LngLat[] {
  if (coords.length < 2) return [...coords];
  const out: LngLat[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const dist = haversineMeters(prev, curr);
    if (dist <= intervalM) {
      out.push(curr);
      continue;
    }
    const steps = Math.ceil(dist / intervalM);
    for (let s = 1; s <= steps; s++) {
      out.push(lerp(prev, curr, s / steps));
    }
  }
  return out;
}

/**
 * Flatten a LineString OR MultiLineString geometry into LngLat[].
 *
 * GeoJSON coordinates are [lng, lat] (lng first).
 *
 * For MultiLineString, parts are concatenated in order. Caller may want to
 * track segment boundaries separately (this fn does not).
 */
export function flattenGeometry(
  geom: { type: string; coordinates: any },
): LngLat[] {
  if (geom.type === 'LineString') {
    return (geom.coordinates as number[][]).map(([lng, lat]) => ({ lng, lat }));
  }
  if (geom.type === 'MultiLineString') {
    const out: LngLat[] = [];
    for (const part of geom.coordinates as number[][][]) {
      for (const [lng, lat] of part) {
        out.push({ lng, lat });
      }
    }
    return out;
  }
  return [];
}

/**
 * Flatten a LineString OR MultiLineString geometry into separate parts.
 *
 * Post-merge audit (FUNC-010): MultiLineString gaps were previously bridged
 * by densify+edge-build because flattenGeometry concatenated parts with no
 * boundary marker. Returning parts separately lets TrailGraph densify each
 * part independently and only build edges within a part — no fake edges
 * across real-world trail gaps.
 *
 * LineString → array with one part. MultiLineString → array of parts (same
 * order as the GeoJSON). Empty for unknown geometry types.
 */
export function flattenGeometryToParts(
  geom: { type: string; coordinates: any },
): LngLat[][] {
  if (geom.type === 'LineString') {
    return [(geom.coordinates as number[][]).map(([lng, lat]) => ({ lng, lat }))];
  }
  if (geom.type === 'MultiLineString') {
    return (geom.coordinates as number[][][]).map(part =>
      part.map(([lng, lat]) => ({ lng, lat })),
    );
  }
  return [];
}

/**
 * Compute total length of a polyline in meters.
 */
export function polylineLengthM(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1], coords[i]);
  }
  return total;
}
