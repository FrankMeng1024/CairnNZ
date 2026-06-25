/**
 * fogFloorGeometry — generates the L1 fog floor polygon.
 *
 * Architecture (v331):
 *   - L1 (this file): "world rect minus one circle around user" GeoJSON Polygon.
 *     Fills the whole world with fog except a small circular cutout around the
 *     user. The Skia raster mask (L2) sits inside that cutout and provides
 *     per-cell precision + cream halo.
 *   - 38 vertices total (5 outer world rect + 33 inner circle).
 *     This is well below the geojson-vt + earcut bug threshold (which triggers
 *     with thousands of inner rings, see _spike/v331-pc/mapbox_fog_of_war_investigation.md).
 *
 * Why not a normal polygon-with-holes:
 *   - v325-v330 tried polygon-with-many-holes (1 outer + 1000+ inner cells).
 *     Mapbox geojson-vt simplification at zoom-out caused earcut tessellation
 *     failures (open ticket mapbox-gl-js#7023, 7+ years unresolved).
 *   - Verified on PC: F1 spike showed polygon path breaks at z≤12.
 *   - Verified on PC: F4 spike showed THIS shape (one outer ring + one
 *     32-segment circular hole) renders clean from z=2 to z=18.
 *
 * Coordinate system:
 *   - All inputs in WGS84 lat/lng.
 *   - Outer ring stays slightly inside Mapbox safe Mercator limits
 *     (Mapbox can't render exactly at ±180° antimeridian or ±85° poles).
 *   - Inner ring uses flat-earth approximation around the center; valid for
 *     radius ≤ a few km at most latitudes. Antimeridian crossing and
 *     latitude > 60° are NOT specially handled in v331 (deferred to v332).
 */

const M_PER_DEG_LAT = 111_320;

const WORLD_WEST = -179.9;
const WORLD_EAST = 179.9;
const WORLD_SOUTH = -85;
const WORLD_NORTH = 85;

export interface Quad {
  nw: [number, number]; // [lng, lat]
  ne: [number, number];
  se: [number, number];
  sw: [number, number];
}

/**
 * Build the L1 "world rect minus one circle" Polygon.
 *
 * @param centerLat   User latitude (degrees)
 * @param centerLng   User longitude (degrees)
 * @param radiusMeters Radius of the inner circular hole in meters.
 *                     MUST be larger than L2 raster bbox half-side so the
 *                     L1 polygon edge stays hidden under the L2 raster.
 *                     Recommended: paddingMeters * 1.4 (e.g. 4200m for 3000m padding).
 * @param segments    Number of segments approximating the circle. Default 32.
 *                    Bump to 64 only if user complains about polygon edges at z>16.
 */
export function worldRectMinusCircle(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  segments: number = 32,
): GeoJSON.Feature<GeoJSON.Polygon> {
  // Outer ring CCW: world rect, closed
  const outer: number[][] = [
    [WORLD_WEST, WORLD_SOUTH],
    [WORLD_EAST, WORLD_SOUTH],
    [WORLD_EAST, WORLD_NORTH],
    [WORLD_WEST, WORLD_NORTH],
    [WORLD_WEST, WORLD_SOUTH],
  ];

  // Inner ring CW (opposite winding to mark hole), closed
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const cosLatSafe = Math.max(cosLat, 1e-6);
  const inner: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    // CW: use -angle so we walk clockwise (opposite of CCW outer)
    const dx_m = radiusMeters * Math.cos(-angle);
    const dy_m = radiusMeters * Math.sin(-angle);
    const lat = centerLat + dy_m / M_PER_DEG_LAT;
    const lng = centerLng + dx_m / (M_PER_DEG_LAT * cosLatSafe);
    inner.push([lng, lat]);
  }

  return {
    type: 'Feature',
    properties: {
      outer_verts: outer.length,
      inner_verts: inner.length,
      radius_m: radiusMeters,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [outer, inner],
    },
  };
}

/**
 * Compute the four geographic corners (NW, NE, SE, SW) of the L2 raster bbox.
 * The bbox is a square in meters centered on the user.
 */
export function computeBboxCorners(
  centerLat: number,
  centerLng: number,
  halfSideMeters: number,
): Quad {
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const cosLatSafe = Math.max(cosLat, 1e-6);
  const dLat = halfSideMeters / M_PER_DEG_LAT;
  const dLng = halfSideMeters / (M_PER_DEG_LAT * cosLatSafe);
  return {
    nw: [centerLng - dLng, centerLat + dLat],
    ne: [centerLng + dLng, centerLat + dLat],
    se: [centerLng + dLng, centerLat - dLat],
    sw: [centerLng - dLng, centerLat - dLat],
  };
}
