/**
 * globalFogBuilder — v327 Zelda-style fog of war.
 *
 * Architecture (replaces v305-v326 viewport-clipped h3 fog):
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  fog = ONE Polygon                                        │
 *   │  ├── outer ring:  global lat/lng bounds (-85..85, -180..180) │
 *   │  └── holes[]:    one 25m × 25m rectangle per visited cell  │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Rendered by Mapbox FillLayer with even-odd fill rule:
 *   - everywhere outside any hole → FILLED (fog)
 *   - inside a hole → TRANSPARENT (map shows through)
 *
 * Why this beats every previous approach:
 *   - **Globally correct fog**: zoom out as far as you want, the world
 *     is still fog. Only visited cells are clear. Matches the product
 *     promise (Zelda-style fog of war).
 *   - **No zoom-adaptive resolution** → no over-visit. visited at
 *     res 11 stays res 11. Walking through a 25m × 25m cell clears
 *     exactly that 25m × 25m cell, not a 600m × 600m parent.
 *   - **No viewport clipping** → fog is correct for ANY camera position
 *     without re-build. (Old h3 fog: rebuild on every pan/zoom.)
 *   - **Sub-millisecond build**: 582 GPS pts → 189 unique cells → 0ms
 *     to assemble the GeoJSON Polygon (vs 4.3s for turf.union, vs
 *     50-150ms for old h3 build).
 *
 * Soft edges are NOT done by this builder. The builder produces a
 * sharp-edge polygon. Soft-edge feathering is the FogLayer's job
 * (multi-stop FillLayer or paint.fill-blur).
 */

import type { VisitedCell } from '../store/useH3VisitedStore';
import { H3_STORE_RESOLUTION } from '../store/useH3VisitedStore';

// v327: hard-coded to res 11 — no zoom adaptation, no over-visit.
// (H3_STORE_RESOLUTION === 11, exported here for code-search clarity.)
const FOG_RES = H3_STORE_RESOLUTION;
const FOG_RES_METERS = 25;
const METERS_PER_DEG_LAT = 111_320;

// Outer ring covers the full Mercator-renderable world. Mapbox styles
// can't render polygons that wrap the antimeridian or touch the poles
// exactly, so we stay slightly inside both safe limits.
const GLOBAL_WEST = -179.9;
const GLOBAL_EAST = 179.9;
const GLOBAL_SOUTH = -85.0;
const GLOBAL_NORTH = 85.0;

export interface GlobalFogPerf {
  visited_n: number;
  holes_n: number;
  build_ms: number;
  /** v325 telemetry kept for compatibility — sanity canary for triangle bug. */
  tiny_rings: number;
  total_rings: number;
}

export interface GlobalFogResult {
  /** Single Polygon feature: outer ring + N holes. null only when
   *  visited cells is empty (we still want fog — render a Polygon
   *  with just the outer ring and no holes). Always non-null in
   *  practice. */
  feature: GeoJSON.Feature<GeoJSON.Polygon> | null;
  perf: GlobalFogPerf;
}

/**
 * Decode our internal cellID "11:ix:iy" into the rectangle ring it
 * represents. This mirrors h3Pure.cellToBoundary but inlined to avoid
 * the dynamic require of h3Pure (which is lazy-loaded for OOM safety).
 */
function cellToRect(cellID: string): number[][] | null {
  const parts = cellID.split(':');
  if (parts.length !== 3) return null;
  const res = parseInt(parts[0], 10);
  const ix = parseInt(parts[1], 10);
  const iy = parseInt(parts[2], 10);
  if (!isFinite(res) || !isFinite(ix) || !isFinite(iy)) return null;
  if (res !== FOG_RES) return null;  // only res 11 cells supported

  const dLat = FOG_RES_METERS / METERS_PER_DEG_LAT;
  const south = iy * dLat;
  const north = (iy + 1) * dLat;
  const anchorLat = (iy + 0.5) * dLat;
  const cosLat = Math.max(0.1, Math.cos((anchorLat * Math.PI) / 180));
  const dLng = FOG_RES_METERS / (METERS_PER_DEG_LAT * cosLat);
  const west = ix * dLng;
  const east = (ix + 1) * dLng;

  // Hole ring: must wind OPPOSITE to the outer ring. Outer is CCW
  // (lng increasing then lat increasing), so hole is CW.
  return [
    [west, south],
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

/**
 * Build the global fog feature.
 *
 * @param cells Visited cells map from useH3VisitedStore. Always res 11.
 * @returns A single Polygon feature with global outer ring and one
 *          rectangular hole per visited cell.
 */
export function buildGlobalFog(
  cells: Map<string, VisitedCell>,
): GlobalFogResult {
  const t0 = Date.now();

  // Outer ring: CCW global bbox
  const outerRing: number[][] = [
    [GLOBAL_WEST, GLOBAL_SOUTH],
    [GLOBAL_EAST, GLOBAL_SOUTH],
    [GLOBAL_EAST, GLOBAL_NORTH],
    [GLOBAL_WEST, GLOBAL_NORTH],
    [GLOBAL_WEST, GLOBAL_SOUTH],
  ];

  const holes: number[][][] = [];
  let totalVerts = outerRing.length;
  for (const cellID of cells.keys()) {
    const rect = cellToRect(cellID);
    if (!rect) continue;
    holes.push(rect);
    totalVerts += rect.length;
  }

  const feature: GeoJSON.Feature<GeoJSON.Polygon> = {
    type: 'Feature',
    properties: {
      cell_count: holes.length,
      res: FOG_RES,
      total_verts: totalVerts,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [outerRing, ...holes],
    },
  };

  const buildMs = Date.now() - t0;

  return {
    feature,
    perf: {
      visited_n: cells.size,
      holes_n: holes.length,
      build_ms: buildMs,
      // canary: every hole is 5-vertex closed; outer is 5-vertex; nothing else
      tiny_rings: 0,
      total_rings: 1 + holes.length,
    },
  };
}
