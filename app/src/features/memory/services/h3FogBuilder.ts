/**
 * h3FogBuilder — given (viewport bounds, visited cells, zoom),
 * compute the set of *unvisited* H3 hex polygons to render as fog.
 *
 * v305 OTA: replaces the turf.union polygon-with-holes approach.
 *
 * Algorithm:
 *   1. Pick resolution R from zoom (zoom-adaptive — see getResForZoom).
 *   2. h3.polygonToCells(viewport, R) → all cells overlapping viewport.
 *   3. For each viewport cell, check if it's in visited (at res R or
 *      its res-11 ancestors). If NOT, emit a hex polygon as fog.
 *   4. Return FeatureCollection + perf trace.
 *
 * Why zoom-adaptive resolution:
 *   res 11 (~9m hex) is too fine for a city-wide view. Spike measured
 *   a 5km × 4km viewport @ res 11 = 25,732 cells / 658ms — main thread
 *   block. res 9 (~174m hex) at same viewport = 527 cells / 22ms. We
 *   degrade resolution as zoom decreases.
 *
 * Visited-set lookup at varying resolution:
 *   Store keeps cells at H3_STORE_RESOLUTION (res 11). When rendering
 *   at res R < 11, a parent cell is "visited" if ANY of its res-11
 *   children are visited. h3-js provides cellToChildren / cellToParent.
 *   We use cellToParent(visitedCell11, R) precomputed into a Set lookup.
 *
 * Fallback for cell-count explosion:
 *   If viewport cells exceed VIEWPORT_CELL_BUDGET (3500), demote res
 *   by 1 and recompute. Log so we can tune budget.
 */

import { H3_STORE_RESOLUTION, useH3VisitedStore, VisitedCell } from '../store/useH3VisitedStore';
import { h3HasFailedBefore } from '../lib/h3LoadGate';

/**
 * v306 fix: lazy-require h3-js. Same reason as in useH3VisitedStore —
 * defer the 32 MB ArrayBuffer allocation until the user opens Memory.
 * On lazy-load failure (OOM, hostile Hermes version) FogLayer falls
 * back to "no fog rendered" rather than crashing the app.
 *
 * v311: also consult the persisted h3LoadGate. If a previous session
 * died mid-bulkImport, never re-require here either — same crash
 * loop avoidance as useH3VisitedStore.getH3.
 */
type H3Module = typeof import('h3-js');
let h3Ref: H3Module | null = null;
let h3LoadFailed = false;
let h3LastFailureMs = 0;
const H3_RETRY_COOLDOWN_MS = 5000;

function getH3(): H3Module | null {
  if (h3Ref) return h3Ref;
  if (h3LoadFailed) return null;
  // v311: persisted gate (cross-session crash loop break).
  if (h3HasFailedBefore()) {
    h3LoadFailed = true;
    return null;
  }
  // v311: in-session retry cooldown.
  if (h3LastFailureMs > 0 && Date.now() - h3LastFailureMs < H3_RETRY_COOLDOWN_MS) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // v323: pure JS h3Pure replaces h3-js (see useH3VisitedStore.ts)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h3Ref = require('../lib/h3Pure').default;
    return h3Ref;
  } catch {
    h3LoadFailed = true;
    h3LastFailureMs = Date.now();
    return null;
  }
}

export interface FogBounds {
  west: number;
  east: number;
  north: number;
  south: number;
}

export interface H3FogPerf {
  res_used: number;
  viewport_cell_n: number;
  unvisited_n: number;
  build_ms: number;
  demoted: boolean;
  /** ms spent inside cellsToMultiPolygon. Tracked separately because it's
   *  a known hot spot in long-walker (50k cells) profiles. */
  dissolve_ms: number;
}

export interface H3FogResult {
  /** Single MultiPolygon feature covering all unvisited hex cells in
   *  viewport. Using a MultiPolygon (vs per-hex polygons) means:
   *    - FillLayer sees a connected region with no internal seams.
   *    - LineLayer strokes only the outer perimeter once, not every
   *      hex edge twice — matches the "cloud, not game grid" intent.
   *  null when no unvisited cells (viewport fully explored). */
  feature: GeoJSON.Feature<GeoJSON.MultiPolygon> | null;
  perf: H3FogPerf;
}

/** Cap on cells we'll process per build. Above this we degrade res-1. */
const VIEWPORT_CELL_BUDGET = 3500;

/**
 * Zoom → H3 resolution.
 * Tuned from spike data:
 *   - res 8 (174m hex):  20km × 14km viewport → 90ms (~3700 cells)
 *   - res 9 (~66m):      5km × 4km   →  22ms  ~500 cells
 *   - res 10 (~25m):     5km × 4km   → 120ms ~3700 cells
 *   - res 11 (~9m):      5km × 4km   → 658ms ~25k cells (too slow)
 */
export function getResForZoom(zoom: number): number {
  if (zoom < 12) return 8;
  if (zoom < 14) return 9;
  if (zoom < 16) return 10;
  return 11;
}

/** Construct a closed CCW ring for the viewport (h3-js geoJson=true mode). */
function viewportRing(b: FogBounds): number[][] {
  // Coordinates as [lng, lat] per GeoJSON spec.
  return [
    [b.west, b.south],
    [b.east, b.south],
    [b.east, b.north],
    [b.west, b.north],
    [b.west, b.south],
  ];
}

/**
 * Build the set of visited "parent cells" at resolution R, computed
 * from the stored res-11 visited cells.
 *
 * For R = 11 this is just the keys of cells.
 * For R < 11 each stored res-11 cell maps to its res-R parent.
 *
 * v305 OTA REVIEW4: cached by (cellVersion, res). Without the cache,
 * a long-time user (50k visited cells) running zoom 11 (res 8) would
 * eat ~250ms cellToParent CPU on every fog rebuild. With the cache
 * it's amortized to one compute per cellVersion bump per res seen.
 */
const parentSetCache = new Map<string, Set<string>>();

function visitedParentsAtRes(
  cells: Map<string, VisitedCell>,
  targetRes: number,
  cellVersion: number,
): Set<string> {
  if (targetRes === H3_STORE_RESOLUTION) {
    // No parent projection needed; just use the keys as-is. Don't cache —
    // the Map itself IS the answer at this resolution.
    return new Set(cells.keys());
  }
  const h3 = getH3();
  if (!h3) return new Set();  // h3-js failed to load — degrade gracefully
  const key = `${cellVersion}:${targetRes}`;
  const cached = parentSetCache.get(key);
  if (cached) return cached;
  const out = new Set<string>();
  for (const id of cells.keys()) {
    try {
      out.add(h3.cellToParent(id, targetRes));
    } catch {
      // skip malformed
    }
  }
  // Keep cache small — only the 2 most recent (cellVersion, res) combos.
  if (parentSetCache.size > 4) {
    const firstKey = parentSetCache.keys().next().value;
    if (firstKey) parentSetCache.delete(firstKey);
  }
  parentSetCache.set(key, out);
  return out;
}

/**
 * Main entry — build unvisited hex polygons for the given viewport.
 *
 * @param bounds  Viewport in WGS84 degrees.
 * @param cells   Visited cells (res 11) from useH3VisitedStore.
 * @param zoom    Current map zoom level (controls resolution).
 */
export function buildUnvisitedHexFeatures(
  bounds: FogBounds,
  cells: Map<string, VisitedCell>,
  zoom: number,
): H3FogResult {
  const t0 = Date.now();
  let res = getResForZoom(zoom);
  let demoted = false;
  const cellVersion = useH3VisitedStore.getState().cellVersion;

  // v306 fix: bail out early if h3-js failed to load. FogLayer renders
  // nothing in that case (rather than crash). Subsequent retries will
  // come from new addPointToCells / pan events; each goes through
  // getH3() and short-circuits the same way.
  const h3 = getH3();
  if (!h3) {
    return {
      feature: null,
      perf: { res_used: res, viewport_cell_n: 0, unvisited_n: 0, build_ms: Date.now() - t0, demoted: false, dissolve_ms: 0 },
    };
  }

  // Compute viewport cells. If too many, demote res-1 and recompute.
  const ring = viewportRing(bounds);
  let viewportCells: string[];
  try {
    viewportCells = h3.polygonToCells([ring], res, true);
  } catch {
    return {
      feature: null,
      perf: { res_used: res, viewport_cell_n: 0, unvisited_n: 0, build_ms: Date.now() - t0, demoted: false, dissolve_ms: 0 },
    };
  }

  if (viewportCells.length > VIEWPORT_CELL_BUDGET && res > 8) {
    res = res - 1;
    demoted = true;
    try {
      viewportCells = h3.polygonToCells([ring], res, true);
    } catch {
      viewportCells = [];
    }
  }

  // Visited cells projected to the active resolution.
  const visitedAtRes = visitedParentsAtRes(cells, res, cellVersion);

  // Collect unvisited cell IDs.
  const unvisitedIDs: string[] = [];
  for (const id of viewportCells) {
    if (!visitedAtRes.has(id)) unvisitedIDs.push(id);
  }
  const unvisitedCount = unvisitedIDs.length;

  if (unvisitedCount === 0) {
    return {
      feature: null,
      perf: {
        res_used: res,
        viewport_cell_n: viewportCells.length,
        unvisited_n: 0,
        build_ms: Date.now() - t0,
        demoted,
        dissolve_ms: 0,
      },
    };
  }

  // Dissolve adjacent hex cells into a single MultiPolygon. Without
  // this each hex would be a separate polygon → shared edges drawn
  // twice by LineLayer + visible internal grid lines.
  const tDissolve = Date.now();
  let multiPolygonCoords: number[][][][];
  try {
    // cellsToMultiPolygon returns Array<Polygon> where each Polygon is
    // Array<Ring> where each Ring is Array<[lng, lat]>. Matches
    // GeoJSON MultiPolygon coordinates shape exactly.
    multiPolygonCoords = h3.cellsToMultiPolygon(unvisitedIDs, true);
  } catch {
    multiPolygonCoords = [];
  }
  const dissolveMs = Date.now() - tDissolve;

  // Defensive: cellsToMultiPolygon may return rings that aren't
  // explicitly closed. Close any open rings (first vs last vertex).
  for (const poly of multiPolygonCoords) {
    for (const ring of poly) {
      if (ring.length > 0) {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          ring.push([first[0], first[1]]);
        }
      }
    }
  }

  if (multiPolygonCoords.length === 0) {
    return {
      feature: null,
      perf: {
        res_used: res,
        viewport_cell_n: viewportCells.length,
        unvisited_n: unvisitedCount,
        build_ms: Date.now() - t0,
        demoted,
        dissolve_ms: dissolveMs,
      },
    };
  }

  const feature: GeoJSON.Feature<GeoJSON.MultiPolygon> = {
    type: 'Feature',
    properties: { cell_count: unvisitedCount, res },
    geometry: {
      type: 'MultiPolygon',
      coordinates: multiPolygonCoords,
    },
  };

  return {
    feature,
    perf: {
      res_used: res,
      viewport_cell_n: viewportCells.length,
      unvisited_n: unvisitedCount,
      build_ms: Date.now() - t0,
      demoted,
      dissolve_ms: dissolveMs,
    },
  };
}
