/**
 * Fog GeoJSON builder.
 *
 * Produces a single GeoJSON Polygon Feature with:
 *   - Outer ring = the whole world (or visible viewport extent)
 *   - Inner rings = "holes" for explored tiles
 *
 * Mapbox FillLayer renders this Polygon by filling the outer ring
 * minus the holes — exactly what we want for fog (dark everywhere
 * except where the user has walked).
 *
 * For v0.2.6 MVP we use one rectangular hole per explored zoom-17
 * tile (≈30m on a side). Sub-tile precision (which cells inside the
 * tile are unlocked) is captured in the bitmap but visualized as a
 * single rectangle. This is much cheaper than marching-squares and
 * looks fine at the typical viewing zoom levels (14-18).
 *
 * Future: replace one-rect-per-tile with proper marching-squares for
 * sub-tile precision — only worth it if telemetry shows users zoom
 * way in and notice the rectangular borders.
 */

import { ExploredTile } from '../store/useMemoryStore';
import { tileToTopLeftLatLng } from './tileEncoder';
import { TileConfig } from '../config/memoryConfig';

export type FogPolygonFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: { kind: 'fog' };
};

/** Outer ring covering the entire Mercator world (clockwise). */
const WORLD_OUTER_RING: number[][] = [
  [-180, 85.05112878],
  [-180, -85.05112878],
  [180, -85.05112878],
  [180, 85.05112878],
  [-180, 85.05112878],
];

/**
 * Build the fog GeoJSON Feature: world outer ring + one hole per
 * explored tile. Holes wind counter-clockwise per GeoJSON RFC 7946.
 */
export function buildFogPolygon(tiles: ExploredTile[]): FogPolygonFeature {
  const holes: number[][][] = [];

  for (const tile of tiles) {
    const parts = tile.key.split('/');
    if (parts.length !== 3) continue;
    const z = parseInt(parts[0], 10);
    const x = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    const tl = tileToTopLeftLatLng({ z, x, y });
    const br = tileToTopLeftLatLng({ z, x: x + 1, y: y + 1 });
    // Counter-clockwise hole ring (outer is clockwise above):
    holes.push([
      [tl.lng, tl.lat],
      [tl.lng, br.lat],
      [br.lng, br.lat],
      [br.lng, tl.lat],
      [tl.lng, tl.lat],
    ]);
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [WORLD_OUTER_RING, ...holes],
    },
    properties: { kind: 'fog' },
  };
}

/** Tile size in meters for telemetry / debug output. */
export function tileMetersAtLatitude(lat: number): number {
  const earthCirc = 40075016.686;
  const tilesPerWorld = Math.pow(2, TileConfig.zoom);
  return (earthCirc * Math.cos((lat * Math.PI) / 180)) / tilesPerWorld;
}

/** Diagnostic — how many holes are in the fog polygon. */
export function countHoles(feature: FogPolygonFeature): number {
  return Math.max(0, feature.geometry.coordinates.length - 1);
}
