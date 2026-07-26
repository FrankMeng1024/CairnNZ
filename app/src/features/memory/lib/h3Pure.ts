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
 * 外部使用的函数:
 *   - latLngToCell(lat, lng, res) -> string  (only external caller)
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

