/**
 * tileKey — Quadkey-style tile keys for DOC trail bbox cache.
 *
 * Sprint 66 Wave 2.
 *
 * Use slippy-map zoom 12 → ~10km × 10km tiles in NZ latitudes.
 * One tile per AsyncStorage entry. LRU eviction (see DOCTrailsCache).
 */

import type { BBox } from './DOCTrailsTypes';

const ZOOM = 12;

/** Tile key for a single (lng, lat) point. */
export function tileKeyForPoint(lng: number, lat: number): string {
  const n = 2 ** ZOOM;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return `z${ZOOM}/${x}/${y}`;
}

/** All tile keys covering a bbox (corner-inclusive). */
export function tilesForBBox(bbox: BBox): string[] {
  const n = 2 ** ZOOM;
  const x1 = Math.floor(((bbox.west + 180) / 360) * n);
  const x2 = Math.floor(((bbox.east + 180) / 360) * n);
  const lat1Rad = (bbox.north * Math.PI) / 180;
  const lat2Rad = (bbox.south * Math.PI) / 180;
  const y1 = Math.floor(
    ((1 - Math.log(Math.tan(lat1Rad) + 1 / Math.cos(lat1Rad)) / Math.PI) / 2) * n,
  );
  const y2 = Math.floor(
    ((1 - Math.log(Math.tan(lat2Rad) + 1 / Math.cos(lat2Rad)) / Math.PI) / 2) * n,
  );
  const xMin = Math.min(x1, x2);
  const xMax = Math.max(x1, x2);
  const yMin = Math.min(y1, y2);
  const yMax = Math.max(y1, y2);
  const out: string[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      out.push(`z${ZOOM}/${x}/${y}`);
    }
  }
  return out;
}

/** Compute approximate bbox of a tile key. */
export function bboxForTile(key: string): BBox | null {
  const m = key.match(/^z(\d+)\/(\d+)\/(\d+)$/);
  if (!m) return null;
  const z = parseInt(m[1], 10);
  const x = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const south = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  return { west, south, east, north };
}
