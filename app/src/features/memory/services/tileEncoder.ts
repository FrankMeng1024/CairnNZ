/**
 * Tile encoding — converts geographic (lat/lng) coordinates to Web
 * Mercator tile coordinates at a fixed zoom level. Used by the unlock
 * engine to mark which tiles the user has explored.
 *
 * We use Web Mercator (EPSG:3857) because Mapbox already renders in
 * this projection, so tile IDs match what's on screen — no conversion
 * needed when overlaying explored regions.
 *
 * One tile at zoom 17 ≈ 30m on a side at the equator (smaller toward
 * poles). Within each tile we encode a 128×128 sub-grid, giving
 * ~0.23m precision per cell. Storage cost: 2KB per tile.
 *
 * No external dependencies. Pure functions, easy to unit-test.
 */

import { TileConfig } from '../config/memoryConfig';

export interface TileId {
  z: number;
  x: number;
  y: number;
}

export interface SubgridCell {
  tile: TileId;
  /** 0..127 within tile.x */
  col: number;
  /** 0..127 within tile.y */
  row: number;
}

/**
 * Standard slippy-map tile XYZ from a geographic coordinate.
 * @param lat Latitude in degrees (clamped to Mercator-valid range).
 * @param lng Longitude in degrees.
 * @param zoom Web Mercator zoom level (0..22).
 */
export function latLngToTile(lat: number, lng: number, zoom: number = TileConfig.zoom): TileId {
  // Mercator clamps latitude at ±85.05113° (the projection diverges).
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { z: zoom, x, y };
}

/**
 * Compute the sub-grid cell (within a zoom-17 tile) for a given
 * lat/lng. Used by the unlock engine to mark which 0.23m cells have
 * been observed.
 */
export function latLngToSubgridCell(lat: number, lng: number): SubgridCell {
  const tile = latLngToTile(lat, lng, TileConfig.zoom);
  const n = Math.pow(2, TileConfig.zoom);

  // Re-compute the fractional tile position (without floor) and
  // multiply by subgrid size to get the cell within the tile.
  const fracX = ((lng + 180) / 360) * n - tile.x;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const fracY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - tile.y;

  const col = Math.floor(fracX * TileConfig.subgridSize);
  const row = Math.floor(fracY * TileConfig.subgridSize);

  return {
    tile,
    col: Math.max(0, Math.min(TileConfig.subgridSize - 1, col)),
    row: Math.max(0, Math.min(TileConfig.subgridSize - 1, row)),
  };
}

/**
 * Stable string key for a tile (used in maps / persistence).
 */
export function tileKey(tile: TileId): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/**
 * Stable string key for a sub-grid cell.
 */
export function cellKey(cell: SubgridCell): string {
  return `${tileKey(cell.tile)}:${cell.col},${cell.row}`;
}

/**
 * Convert tile coords back to the geographic top-left corner of that
 * tile (for rendering overlays).
 */
export function tileToTopLeftLatLng(tile: TileId): { lat: number; lng: number } {
  const n = Math.pow(2, tile.z);
  const lng = (tile.x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * tile.y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lng };
}
