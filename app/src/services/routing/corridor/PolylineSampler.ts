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
  /**
   * Optional altitude in meters above sea level. Added v6.3 for brush-edit
   * elevation preservation (plan §2.1). Existing call sites continue to work
   * — `alt` is optional, and most geometry functions ignore it (only `lng`/`lat`
   * affect distance / bearing / interpolation calculations).
   *
   * Producers: GPS fixes, MapView.queryTerrainElevation (Mapbox DEM tiles),
   * legacy stored routes (may be null or undefined).
   * Consumers: elevation gain calc, route detail elevation chart, save-as-route.
   */
  alt?: number | null;
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
 *
 * v6.3 (plan §2.2): preserves `alt` if both endpoints have it. If either
 * side is missing alt, output alt is null (cannot interpolate against
 * unknown). This rule keeps elevation continuity through densification
 * without inventing data.
 */
function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  const out: LngLat = {
    lng: a.lng + (b.lng - a.lng) * t,
    lat: a.lat + (b.lat - a.lat) * t,
  };
  if (a.alt != null && b.alt != null) {
    out.alt = a.alt + (b.alt - a.alt) * t;
  } else if (a.alt != null || b.alt != null) {
    out.alt = null; // partial knowledge → record as unknown
  }
  return out;
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
 * GeoJSON coordinates are [lng, lat] (lng first), optionally with a 3rd
 * element for altitude in meters. v6.3 (plan §2.2): if a 3rd element is
 * present and is a finite number, it's preserved as `alt`; otherwise
 * `alt` is omitted.
 *
 * For MultiLineString, parts are concatenated in order. Caller may want to
 * track segment boundaries separately (this fn does not).
 */
function readCoord(c: number[]): LngLat {
  const [lng, lat, maybeAlt] = c;
  if (typeof maybeAlt === 'number' && Number.isFinite(maybeAlt)) {
    return { lng, lat, alt: maybeAlt };
  }
  return { lng, lat };
}

export function flattenGeometry(
  geom: { type: string; coordinates: any },
): LngLat[] {
  if (geom.type === 'LineString') {
    return (geom.coordinates as number[][]).map(readCoord);
  }
  if (geom.type === 'MultiLineString') {
    const out: LngLat[] = [];
    for (const part of geom.coordinates as number[][][]) {
      for (const c of part) {
        out.push(readCoord(c));
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
    return [(geom.coordinates as number[][]).map(readCoord)];
  }
  if (geom.type === 'MultiLineString') {
    return (geom.coordinates as number[][][]).map(part => part.map(readCoord));
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
