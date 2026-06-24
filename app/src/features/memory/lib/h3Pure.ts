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
const RES_METERS: Record<number, number> = {
  8: 480,
  9: 180,
  10: 65,
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

/** dissolve cells -> MultiPolygon coords. 模拟 h3.cellsToMultiPolygon. */
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

  const rows = new Map<number, { ixs: Set<number>; dLng: number; anchorLat: number }>();
  for (const c of cells) {
    const d = decodeCellID(c);
    if (!d || d.res !== res) continue;
    let row = rows.get(d.iy);
    if (!row) {
      const anchorLat = (d.iy + 0.5) * dLat;
      row = { ixs: new Set(), dLng: cellDegLng(res, anchorLat), anchorLat };
      rows.set(d.iy, row);
    }
    row.ixs.add(d.ix);
  }

  type Pt = [number, number];
  type Edge = { from: Pt; to: Pt };
  const edges: Edge[] = [];

  for (const [iy, row] of rows) {
    const south = iy * dLat;
    const north = (iy + 1) * dLat;
    for (const ix of row.ixs) {
      const west = ix * row.dLng;
      const east = (ix + 1) * row.dLng;
      const swP: Pt = [west, south];
      const seP: Pt = [east, south];
      const neP: Pt = [east, north];
      const nwP: Pt = [west, north];

      const southRow = rows.get(iy - 1);
      if (!southRow || !southRow.ixs.has(ix)) {
        edges.push({ from: swP, to: seP });
      }
      if (!row.ixs.has(ix + 1)) {
        edges.push({ from: seP, to: neP });
      }
      const northRow = rows.get(iy + 1);
      if (!northRow || !northRow.ixs.has(ix)) {
        edges.push({ from: neP, to: nwP });
      }
      if (!row.ixs.has(ix - 1)) {
        edges.push({ from: nwP, to: swP });
      }
    }
  }

  if (edges.length === 0) return [];

  const ptKey = (p: Pt): string => `${p[0]},${p[1]}`;
  const byFrom = new Map<string, Edge>();
  for (const e of edges) byFrom.set(ptKey(e.from), e);

  const used = new Set<string>();
  const rings: Pt[][] = [];

  for (const startEdge of edges) {
    const startKey = ptKey(startEdge.from);
    if (used.has(startKey)) continue;

    const ring: Pt[] = [];
    let cur: Edge | undefined = startEdge;
    let safety = edges.length + 8;
    while (cur && safety-- > 0) {
      const curKey = ptKey(cur.from);
      if (used.has(curKey)) break;
      used.add(curKey);
      ring.push(cur.from);
      const nextKey = ptKey(cur.to);
      cur = byFrom.get(nextKey);
      if (cur && ptKey(cur.from) === ptKey(startEdge.from)) {
        ring.push(cur.from);
        break;
      }
    }

    if (ring.length >= 3) {
      const f = ring[0], l = ring[ring.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
      rings.push(ring);
    }
  }

  return rings.map((r) => [r]);
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
