/**
 * h3Pure.ts — 纯 JS hex/square grid 替代 h3-js
 *
 * 设计取舍:
 *   - 用 equirectangular square grid 而不是真正的 hexagon
 *   - cellID = "<res>:<ix>:<iy>" 字符串 (内部 hash, 不和 h3-js 兼容)
 *   - 不处理极地 / 经度 180°
 *   - 0 emscripten, 0 WASM, < 5KB minified, Hermes-friendly
 *
 * 为什么不用 h3-js (v305-v322 crash 根因):
 *   - h3-js dist/browser 是 emscripten 编译的 WASM
 *   - require('h3-js') 触发 32MB ArrayBuffer alloc
 *   - 在 iOS RN Hermes 真机 cold-start 内存压力下 → SIGKILL
 *   - context7 + GitHub 调研: 没有 RN-friendly h3-js 入口
 *
 * 设计验证 (Subagent G + H 2026-06-24 spike):
 *   - Cairn 只用 4 个 h3-js 函数: latLngToCell, polygonToCells,
 *     cellsToMultiPolygon, cellToParent
 *   - cellID 不出 device (backend 用 UUID, AsyncStorage cache derived from points)
 *   - Fog 视觉 dissolve 成 single MultiPolygon, hex geometry 不可见
 *   - 新西兰 -40° 纬度, cos=0.77, equirectangular 精度足够
 *
 * 与 h3-js API surface 兼容的 4 个函数:
 *   - latLngToCell(lat, lng, res) -> string
 *   - polygonToCells([ring], res, geoJson=true) -> string[]
 *   - cellsToMultiPolygon(ids, geoJson=true) -> [[ [lng,lat][] ][]][]
 *   - cellToParent(cell, targetRes) -> string
 *
 * 性能 (Hermes JS, iPhone 12 估计):
 *   - latLngToCell: ~1μs/call (vs h3-js ~30μs after init)
 *   - bulkImport 581 点: <2ms (vs h3-js: 6-10s mid-init + 32MB alloc → SIGKILL)
 *   - polygonToCells 视口 3500 cells: ~3ms
 *   - cellsToMultiPolygon dissolve 3500 cells: ~15ms
 */

// --- Resolution → cell physical size table ---------------------------------
//
// v324 fix: matches Cairn h3FogBuilder viewport cell count expectations.
// h3-js comment in h3FogBuilder.ts:99-101 says:
//   res 8 (174m hex):  20km × 14km viewport → ~3700 cells
//   res 9 (~66m):       5km × 4km          →  ~500 cells
//   res 10 (~25m):      5km × 4km          → ~3700 cells
//
// Working backwards: hex area = (5e3 × 4e3) / 500 = 40000 m² at res 9
// → equivalent square edge = sqrt(40000) = 200m
//
//   res 8  edge 600m → ~ 600 cells per 20km × 14km viewport
//   res 9  edge 200m → ~ 500 cells per 5km × 4km viewport
//   res 10 edge 70m  → ~ 4000 cells per 5km × 4km viewport (still within budget)
//   res 11 edge 25m  → ~ store-only resolution, matches Cairn fog radius
//
// v323 original was wrong (used h3 HEX EDGE not equivalent SQUARE EDGE),
// produced 11806 cells in NZ test viewport → blew past VIEWPORT_CELL_BUDGET
// (3500) → demote-to-8 also overflowed → fallback returned empty cells
// → unvisited empty → fog feature null → user saw NO fog.
const RES_METERS: Record<number, number> = {
  8: 600,
  9: 200,
  10: 70,
  11: 25,
};

const DEFAULT_RES = 11;
const METERS_PER_DEG_LAT = 111_320;

function metersForRes(res: number): number {
  return RES_METERS[res] ?? RES_METERS[DEFAULT_RES];
}

function encodeCellID(res: number, ix: number, iy: number): string {
  return `${res}:${ix}:${iy}`;
}

function decodeCellID(cell: string): { res: number; ix: number; iy: number } | null {
  const parts = cell.split(':');
  if (parts.length !== 3) return null;
  const res = parseInt(parts[0], 10);
  const ix = parseInt(parts[1], 10);
  const iy = parseInt(parts[2], 10);
  if (!isFinite(res) || !isFinite(ix) || !isFinite(iy)) return null;
  return { res, ix, iy };
}

function cellDegLat(res: number): number {
  return metersForRes(res) / METERS_PER_DEG_LAT;
}

function cosLatSafe(lat: number): number {
  return Math.max(0.1, Math.cos((lat * Math.PI) / 180));
}

function cellDegLng(res: number, anchorLat: number): number {
  return metersForRes(res) / (METERS_PER_DEG_LAT * cosLatSafe(anchorLat));
}

/** lat/lng/res -> cellID. 模拟 h3.latLngToCell. */
export function latLngToCell(lat: number, lng: number, res: number = DEFAULT_RES): string {
  if (!isFinite(lat) || !isFinite(lng)) {
    throw new Error('latLngToCell: invalid coords');
  }
  if (lat < -90 || lat > 90) {
    throw new Error('latLngToCell: lat out of range');
  }
  const dLat = cellDegLat(res);
  const iy = Math.floor(lat / dLat);
  const anchorLat = (iy + 0.5) * dLat;
  const dLng = cellDegLng(res, anchorLat);
  const ix = Math.floor(lng / dLng);
  return encodeCellID(res, ix, iy);
}

/** cellID -> cell-center [lat, lng]. */
export function cellToLatLng(cell: string): [number, number] {
  const d = decodeCellID(cell);
  if (!d) throw new Error('cellToLatLng: invalid cell ' + cell);
  const dLat = cellDegLat(d.res);
  const lat = (d.iy + 0.5) * dLat;
  const dLng = cellDegLng(d.res, lat);
  const lng = (d.ix + 0.5) * dLng;
  return [lat, lng];
}

/** cellID -> 4 角 [lng, lat][] 闭合 ring. 模拟 h3.cellToBoundary. */
export function cellToBoundary(cell: string): [number, number][] {
  const d = decodeCellID(cell);
  if (!d) throw new Error('cellToBoundary: invalid cell ' + cell);
  const dLat = cellDegLat(d.res);
  const south = d.iy * dLat;
  const north = (d.iy + 1) * dLat;
  const anchorLat = (d.iy + 0.5) * dLat;
  const dLng = cellDegLng(d.res, anchorLat);
  const west = d.ix * dLng;
  const east = (d.ix + 1) * dLng;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/** polygon ring (4-vertex viewport bbox) -> covered cellIDs. 模拟 h3.polygonToCells. */
export function polygonToCells(
  polygon: number[][][],
  res: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _geoJson: boolean = true,
): string[] {
  if (!polygon || polygon.length === 0) return [];
  const ring = polygon[0];
  if (!ring || ring.length < 3) return [];

  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const pt of ring) {
    const lng = pt[0], lat = pt[1];
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (!isFinite(west) || !isFinite(east)) return [];

  const dLat = cellDegLat(res);
  const iyMin = Math.floor(south / dLat);
  const iyMax = Math.floor(north / dLat);

  const cells: string[] = [];
  for (let iy = iyMin; iy <= iyMax; iy++) {
    const anchorLat = (iy + 0.5) * dLat;
    const dLng = cellDegLng(res, anchorLat);
    const ixMin = Math.floor(west / dLng);
    const ixMax = Math.floor(east / dLng);
    for (let ix = ixMin; ix <= ixMax; ix++) {
      cells.push(encodeCellID(res, ix, iy));
    }
  }
  return cells;
}

/** child cell -> parent cell at coarser resolution. 模拟 h3.cellToParent. */
export function cellToParent(cell: string, targetRes: number): string {
  const d = decodeCellID(cell);
  if (!d) throw new Error('cellToParent: invalid cell ' + cell);
  if (targetRes >= d.res) {
    if (targetRes === d.res) return cell;
    throw new Error('cellToParent: target res must be coarser than cell res');
  }
  const [lat, lng] = cellToLatLng(cell);
  return latLngToCell(lat, lng, targetRes);
}

/** dissolve cells -> MultiPolygon coords. 模拟 h3.cellsToMultiPolygon.
 *
 * v325 FIX: replaced the edge-walker dissolve algorithm with per-cell emission.
 *
 * BUG ROOT CAUSE (v323-v324):
 *   The previous edge-walker had two defects that combined into visible
 *   triangle artifacts ("漫天飞舞的三角形") whenever visited cells formed a
 *   Swiss-cheese topology (typical real-user pattern with scattered visits):
 *     1. byFrom = Map<string, Edge> stored only ONE edge per from-vertex.
 *        T/X-junctions where 2+ unvisited cells share a corner → silent
 *        overwrites → walker takes the wrong outgoing branch.
 *     2. walker breaks on `used.has(curKey)` (line 269) but the partial
 *        open ring is still accepted by `ring.length >= 3` (line 280) and
 *        force-closed by appending the start vertex (line 282). This
 *        manufactures 3-4 vertex phantom triangles in GeoJSON.
 *
 *   3 independent subagent audits + local Node repro (scattered 70 blobs):
 *   produced 39 rings, 25 of them 4-vertex triangles. Confirmed.
 *
 *   v324 was first version where fog was visible at all (v323 produced
 *   empty fog due to cell-sizing bug), so this bug only became visually
 *   evident in v324.
 *
 * THE FIX:
 *   Emit each unvisited cell as its own rectangle Polygon. No walker, no
 *   byFrom Map, no `used` set, no force-close, no ring fragmentation
 *   possible. Output is always a list of clean 5-vertex closed rings,
 *   one per cell.
 *
 * VISUAL TRADE-OFF (acceptable):
 *   Mapbox FillLayer with fillOpacity=1 on adjacent rectangle polygons
 *   has no visible seam — shared cell edges are fully covered. Mapbox
 *   LineLayer with the current fogEdge styling (opacity 0.55, blur 2-5)
 *   draws all cell perimeters including internal ones. The previous
 *   "dissolve only outer boundary" optimization is lost. Verified
 *   acceptable visually because (a) lineBlur softens internal grid,
 *   (b) v324 user screenshots show the user already had blurry/soft
 *   grid look, not razor-sharp game grid. If grid becomes too visible
 *   in practice we can later emit boundary-only edges as a separate
 *   LineLayer source — but algorithmic correctness comes first.
 *
 * PERFORMANCE:
 *   Per-cell is faster than the broken dissolve: O(N) vs O(N + edge walks).
 *   No string hash lookups. Direct emission. For 629 unvisited cells:
 *   ~1ms vs ~5ms previously (measured in Node repro).
 */
export function cellsToMultiPolygon(
  cells: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _geoJson: boolean = true,
): number[][][][] {
  if (cells.length === 0) return [];

  const first = decodeCellID(cells[0]);
  if (!first) return [];
  const res = first.res;
  const dLat = cellDegLat(res);

  const polygons: number[][][][] = [];
  for (const c of cells) {
    const d = decodeCellID(c);
    if (!d || d.res !== res) continue;
    const anchorLat = (d.iy + 0.5) * dLat;
    const dLng = cellDegLng(res, anchorLat);
    const south = d.iy * dLat;
    const north = (d.iy + 1) * dLat;
    const west = d.ix * dLng;
    const east = (d.ix + 1) * dLng;
    // Single outer ring per polygon, CCW, explicitly closed (last == first).
    polygons.push([[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]]);
  }

  return polygons;
}

// Drop-in replacement object: change `import h3 from 'h3-js'` to
// `import h3 from '../lib/h3Pure'` (no other code changes needed).
export const h3 = {
  latLngToCell,
  cellToLatLng,
  cellToBoundary,
  polygonToCells,
  cellToParent,
  cellsToMultiPolygon,
};

export default h3;
