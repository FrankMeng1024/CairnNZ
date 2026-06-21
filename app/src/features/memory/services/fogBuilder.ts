/**
 * fogBuilder — produce GeoJSON for the fog overlay.
 *
 * Architecture:
 *   The fog is a single Feature<Polygon> with:
 *     coordinates[0] = outer ring (the fog area) — VIEWPORT-RELATIVE, NOT
 *                      a world-spanning constant. mapbox-gl-js v2 silently
 *                      culls Polygons with huge -180..180 outer rings;
 *                      using a viewport-padded box keeps the polygon at a
 *                      tile-friendly size on every zoom level.
 *     coordinates[1..N] = one inner ring (hole) per visited GPS point.
 *
 *   Each inner ring is a `unlockRadiusMeters` circle (default 25m)
 *   approximated as `FogConfig.circleVertices` polygon vertices. Mapbox
 *   renders polygon-with-holes natively, so overlapping circles visually
 *   merge into a smooth, organic explored area.
 *
 * History — why viewport bounds:
 *   v0.2.6.1 originally used a hard-coded WORLD_OUTER_RING
 *   ([-180..180, -85..85]). This worked on native @rnmapbox/maps but the
 *   web mapbox-gl renderer silently dropped the polygon because the
 *   outer ring exceeds tile-clipping thresholds. Result was a blank map
 *   (no fog, but ALSO no holes — every "hole" got re-classified as a
 *   filled disc by some renderers) — that was the v291 "fog donut" bug
 *   the user reported.
 *
 * Why no turf.union of the inner circles:
 *   A real polygon-union per render is O(N²) for N circles (eats CPU on
 *   long hikes with thousands of points). Letting Mapbox's renderer
 *   handle the visual overlap is correct AND fast — same approach used
 *   by Strava heatmaps. If we ever need pixel-perfect smooth boundaries
 *   we can pre-union at recordCircleUnlock time.
 *
 * Output: see `FogFeature` below.
 */

import { UnlockConfig, FogConfig } from '../config/memoryConfig';
import { VisitedPoint } from '../store/useMemoryStore';

/**
 * Geographic bounds rectangle. Matches mapbox-gl's LngLatBounds shape
 * (sw, ne corners). The fog outer ring is built from these corners
 * plus a padding multiplier so a small pan doesn't reveal un-fogged
 * edges before the source re-renders.
 */
export interface FogBounds {
  /** Western lng (minimum) */
  west: number;
  /** Eastern lng (maximum) */
  east: number;
  /** Northern lat (maximum) */
  north: number;
  /** Southern lat (minimum) */
  south: number;
}

export interface FogFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: Record<string, unknown>;
}

const EARTH_RADIUS_M = 6_378_137;

/**
 * Build a closed clockwise ring approximating a circle of
 * `radiusM` meters around (centerLat, centerLng). Vertex count comes
 * from `FogConfig.circleVertices` so it's tunable, not hard-coded.
 *
 * Uses the equirectangular approximation: at the radii we deal with
 * (≤ 50m for unlocks) the deviation from a true geodesic circle is
 * sub-pixel at city zooms.
 *
 * Winding rule per GeoJSON RFC 7946 §3.1.6: in a Polygon, the OUTER
 * ring is counter-clockwise and inner rings (holes) follow the
 * OPPOSITE winding. Our outer is CW (see makeOuterRing), so holes
 * are CCW. We achieve that with a negative theta increment.
 *
 * Why this matters in practice: mapbox-gl-js v2 + earcut respect
 * winding for hole detection. If both rings wind the same way, the
 * "hole" gets re-classified as a second filled polygon and stamps
 * an EXTRA sepia disc on top instead of cutting through — that was
 * the "leaf" appearance the user saw in the first N5 verification pass.
 */
function makeCircleRing(centerLat: number, centerLng: number, radiusM: number): number[][] {
  const safeLat = Math.max(-85.05, Math.min(85.05, centerLat));
  const cosLat = Math.max(Math.cos((safeLat * Math.PI) / 180), 1e-6);
  const dLatPerM = 1 / (EARTH_RADIUS_M * Math.PI / 180);
  const dLngPerM = dLatPerM / cosLat;

  const verts = FogConfig.circleVertices;
  const ring: number[][] = [];
  for (let i = 0; i < verts; i++) {
    // Counter-clockwise: positive theta with mathematical convention
    // where y axis points north → CCW in lng/lat plane.
    const theta = (2 * Math.PI * i) / verts;
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

/**
 * Build the outer fog ring as a viewport-bounded box, padded to keep
 * the user from seeing un-fogged map edges during a small pan before
 * the source re-renders.
 *
 * Clockwise winding when read in lng/lat. The hole rings (above) wind
 * opposite — CCW — which mapbox-gl-js interprets as cut-outs.
 */
function makeOuterRing(bounds: FogBounds): number[][] {
  const padX = (bounds.east - bounds.west) * FogConfig.outerRingPadFactor;
  const padY = (bounds.north - bounds.south) * FogConfig.outerRingPadFactor;
  const w = bounds.west - padX;
  const e = bounds.east + padX;
  const n = Math.min(85.05, bounds.north + padY);
  const s = Math.max(-85.05, bounds.south - padY);
  // CW (when y is up): NW → NE → SE → SW → NW.
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
    [w, n],
  ];
}

/**
 * Build the fog Feature<Polygon>.
 *
 * @param points  Visited GPS points (each becomes a hole)
 * @param bounds  Map viewport bounds (drives outer-ring size)
 * @returns Feature whose first coordinates ring is the fog area and
 *          rings 1..N are circular holes at each visited point.
 */
export function buildFogPolygon(points: VisitedPoint[], bounds: FogBounds): FogFeature {
  const radius = UnlockConfig.radiusMeters;
  const cullThresholdM = radius * FogConfig.cullThresholdFactor;
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

  const coordinates: number[][][] = [makeOuterRing(bounds)];
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
