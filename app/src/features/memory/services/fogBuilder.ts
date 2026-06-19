/**
 * fogBuilder — produce GeoJSON for the fog overlay.
 *
 * v0.2.6.1 (this rewrite): the fog is now built from a sequence of GPS
 * POINTS, not from rectangular Web Mercator tiles. Each point becomes a
 * `unlockRadiusMeters` circle (default 25m) rendered as a 32-vertex
 * polygon hole in the global outer ring. Mapbox draws polygon-with-
 * many-holes natively, so overlapping circles visually merge into a
 * smooth, organic explored area — exactly what the user asked for
 * (a "circle around me" model, not a square tile grid).
 *
 * Why no turf.js union: a real polygon-union per render is O(N²) for
 * N circles (eats CPU on long hikes). Letting Mapbox's renderer handle
 * the visual overlap is correct AND fast — same trick that Strava and
 * other GPS apps use for their heatmaps.
 *
 * Output:
 *   Feature<Polygon>
 *     coordinates[0] = world outer ring (clockwise)
 *     coordinates[1..N] = one inner ring per visited point (CCW)
 */

import { UnlockConfig } from '../config/memoryConfig';
import { VisitedPoint } from '../store/useMemoryStore';

const WORLD_OUTER_RING: number[][] = [
  [-180,  85.05],
  [ 180,  85.05],
  [ 180, -85.05],
  [-180, -85.05],
  [-180,  85.05],
];

const CIRCLE_VERTICES = 32;
const EARTH_RADIUS_M = 6_378_137;

/**
 * Build a 32-vertex closed counter-clockwise ring approximating a
 * circle of `radiusM` meters around (centerLat, centerLng).
 *
 * Uses the equirectangular approximation: at the radii we deal with
 * (≤ 50m for unlocks) the deviation from a true geodesic circle is
 * sub-pixel at city zooms.
 */
function makeCircleRing(centerLat: number, centerLng: number, radiusM: number): number[][] {
  const safeLat = Math.max(-85.05, Math.min(85.05, centerLat));
  const cosLat = Math.max(Math.cos((safeLat * Math.PI) / 180), 1e-6);
  const dLatPerM = 1 / (EARTH_RADIUS_M * Math.PI / 180);
  const dLngPerM = dLatPerM / cosLat;

  const ring: number[][] = [];
  for (let i = 0; i < CIRCLE_VERTICES; i++) {
    const theta = -2 * Math.PI * (i / CIRCLE_VERTICES);
    const dx = radiusM * Math.cos(theta);
    const dy = radiusM * Math.sin(theta);
    ring.push([
      centerLng + dx * dLngPerM,
      safeLat + dy * dLatPerM,
    ]);
  }
  ring.push([...ring[0]]);
  return ring;
}

export interface FogFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: Record<string, unknown>;
}

/**
 * Build the fog polygon from an array of visited GPS points. Each
 * point gets a `unlockRadiusMeters` circle hole.
 *
 * For dense paths we cull neighbours within `cullThresholdM` meters —
 * adjacent circles already overlap so additional rings cost geometry
 * without adding visual area. Cull threshold defaults to half the
 * unlock radius so ~50% overlap is preserved for a smooth boundary.
 */
export function buildFogPolygon(points: VisitedPoint[]): FogFeature {
  const radius = UnlockConfig.radiusMeters;
  const cullThresholdM = radius * 0.5;
  const cullThresholdSq = cullThresholdM * cullThresholdM;

  const kept: VisitedPoint[] = [];
  for (const p of points) {
    if (
      typeof p?.lat !== 'number' || typeof p?.lng !== 'number' ||
      !isFinite(p.lat) || !isFinite(p.lng)
    ) continue;
    let skip = false;
    for (let i = kept.length - 1; i >= 0 && !skip; i--) {
      const dLat = (p.lat - kept[i].lat) * 111_000;
      const cosLat = Math.cos((kept[i].lat * Math.PI) / 180);
      const dLng = (p.lng - kept[i].lng) * 111_000 * cosLat;
      if (dLat * dLat + dLng * dLng < cullThresholdSq) skip = true;
    }
    if (!skip) kept.push(p);
  }

  const coordinates: number[][][] = [WORLD_OUTER_RING];
  for (const p of kept) {
    coordinates.push(makeCircleRing(p.lat, p.lng, radius));
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates,
    },
    properties: {},
  };
}

/** Number of rendered circles in the polygon (excludes outer ring). */
export function countHoles(feature: FogFeature): number {
  return Math.max(0, feature.geometry.coordinates.length - 1);
}
