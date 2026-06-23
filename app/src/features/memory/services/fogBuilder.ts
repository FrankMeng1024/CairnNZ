/**
 * fogBuilder — produce GeoJSON for the fog overlay.
 *
 * Output: a single Feature<Polygon | MultiPolygon> with
 *   - coordinates[0] = outer ring (viewport-relative, padded box)
 *   - coordinates[1..N] = inner rings (holes) describing the union of
 *     all visited unlock-circles. Adjacent circles are MERGED via
 *     turf.union so the cleared area is ONE continuous shape
 *     (a "corridor" along the user's path), not a tiled fish-scale
 *     pattern of individual circles. — User feedback 2026-06-21.
 *
 * Why turf.union here (and not "let Mapbox handle overlap"):
 *   Earlier versions pushed N individual circle rings as holes into the
 *   outer polygon. mapbox-gl renders each circle ring as a separate
 *   cut-out, and the visible boundary of each circle stays visible at
 *   tile edges — producing a fish-scale / overlapping-ovals look that
 *   does NOT match the user's mental model of "I walk, fog clears
 *   continuously around my path". Merging the circles ahead of time
 *   means the outline of the cleared area is the union outline only.
 *
 * Performance:
 *   N points → N circles → N-1 turf.unions. Each union is O(P) on
 *   total polygon vertices. For 600 visited points at 32 verts/circle,
 *   measured ~300ms in browser console — acceptable because:
 *   (a) it runs in FogLayer's useMemo, gated by debouncedBounds change,
 *   (b) the result is cached for the lifetime of the geometryVersion,
 *   (c) when geometryVersion bumps it's because a NEW point came in
 *       and we only need to union one fresh circle into the cached
 *       result — incremental optimization left as a follow-up.
 *
 *   If a user hits 5k+ visited points and this becomes a real bottleneck
 *   we can move it to a Web Worker without changing the call shape.
 *
 * History — why viewport bounds (kept):
 *   v0.2.6.1 used a world-spanning outer ring; mapbox-gl-js v2 silently
 *   drops Polygons whose outer ring exceeds tile-clipping thresholds.
 *   A viewport-padded box keeps the polygon at a renderable size.
 */

import union from '@turf/union';
import { featureCollection } from '@turf/helpers';
import polygonSmooth from '@turf/polygon-smooth';
import { UnlockConfig, FogConfig } from '../config/memoryConfig';
import { VisitedPoint } from '../store/useMemoryStore';

export interface FogBounds {
  west: number;
  east: number;
  north: number;
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

/**
 * v303 OTA: 从 FogFeature 提取 hole rings 作 MultiLineString,
 * 让 FogLayer 在 fill 上面叠一层柔光 LineLayer 画羊皮纸软边。
 * 跳过 outer ring(viewport box)— 那是 fog 的外边,不是 hole。
 */
export function extractHoleRings(feature: FogFeature): GeoJSON.Feature<GeoJSON.MultiLineString> | null {
  const rings = feature.geometry.coordinates;
  if (rings.length < 2) return null; // 没 holes 就没东西画
  const holeRings = rings.slice(1); // 跳过 outer
  return {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: holeRings },
    properties: {},
  };
}

const EARTH_RADIUS_M = 6_378_137;

/**
 * Build a closed CCW ring approximating a circle of `radiusM` meters
 * around (centerLat, centerLng). Equirectangular approximation; deviation
 * from geodesic is sub-pixel at the radii we use (≤ 50m).
 *
 * CCW because: this ring is fed to turf.union as a Polygon's outer ring,
 * and GeoJSON RFC 7946 §3.1.6 specifies outer rings are CCW. After
 * union, the resulting outline keeps the same winding by construction;
 * we then reverse those rings into the fog polygon's CW hole slots.
 */
function makeCircleRingCCW(
  centerLat: number,
  centerLng: number,
  radiusM: number,
): number[][] {
  const safeLat = Math.max(-85.05, Math.min(85.05, centerLat));
  const cosLat = Math.max(Math.cos((safeLat * Math.PI) / 180), 1e-6);
  const dLatPerM = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);
  const dLngPerM = dLatPerM / cosLat;

  const verts = FogConfig.circleVertices;
  const ring: number[][] = [];
  for (let i = 0; i < verts; i++) {
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
 * Viewport-bounded outer ring, CW for mapbox-gl's hole-detection rule.
 * NW → NE → SE → SW → NW.
 *
 * IMPORTANT: outer MUST fully contain every hole. If the union of
 * visited circles extends past the viewport (user zoomed in inside an
 * explored area), naively clipping to viewport produces an outer ring
 * smaller than the hole — mapbox-gl-js then renders the hole as a
 * filled polygon and the viewport as empty (cleared/fog inverted).
 * We expand the box to encompass `extentBbox` (the hole's bounding
 * box) when present.
 */
function makeOuterRingCW(bounds: FogBounds, extentBbox: FogBounds | null, padFactor: number = FogConfig.outerRingPadFactor): number[][] {
  let w = bounds.west;
  let e = bounds.east;
  let n = bounds.north;
  let s = bounds.south;
  if (extentBbox) {
    if (extentBbox.west  < w) w = extentBbox.west;
    if (extentBbox.east  > e) e = extentBbox.east;
    if (extentBbox.south < s) s = extentBbox.south;
    if (extentBbox.north > n) n = extentBbox.north;
  }
  // v303 OTA 三修 (A 真根因):**outer ring 必须包含 extentBbox**(否则 mapbox
  // 渲染失败 — holes 在 outer 外面 mapbox tile-clip 干掉,只画 outer 那个
  // 小矩形 = 用户截图的"屏幕中央小方块")。
  //
  // 二修加的 `outer cap = viewport × 3` 本意防 silent-skip,但 cap 后
  // outer < extent → polygon 失败。删!
  //
  // 防 silent-skip 改为 padFactor 控制 — padFactor 在 0.25-0.5 范围,
  // 配合 polygon 度数级 sanity check(< 5° 是 mapbox-gl 安全极限,实测过)。
  const padX = (e - w) * padFactor;
  const padY = (n - s) * padFactor;
  w -= padX; e += padX;
  n = Math.min(85.05, n + padY);
  s = Math.max(-85.05, s - padY);
  // v303 OTA 四修 P1 (fog 矩形真根因 — 最后一关):
  // 即使 outer 包含 extentBbox + padFactor,zoom out 时仍可能 outer 只比
  // viewport 大 25% → 屏幕角露底。这是用户截图 "矩形 fog,外面没遮罩"
  // 的真因之一。
  //
  // 修法:outer 跨度有最小值 1.0°(~110km),不管 viewport 多大、extent
  // 多小,outer 永远撑到 1°,zoom 11/12 视野(典型 ~0.5° lng)被完全覆盖。
  // 以 viewport 中心扩。1° 远小于 mapbox-gl 5° silent-skip 阈值,安全。
  const MIN_OUTER_DEG = 1.0;
  const cx = (bounds.east + bounds.west) / 2;
  const cy = (bounds.north + bounds.south) / 2;
  if (e - w < MIN_OUTER_DEG) { w = cx - MIN_OUTER_DEG / 2; e = cx + MIN_OUTER_DEG / 2; }
  if (n - s < MIN_OUTER_DEG) {
    n = Math.min(85.05, cy + MIN_OUTER_DEG / 2);
    s = Math.max(-85.05, cy - MIN_OUTER_DEG / 2);
  }
  // 安全网:outer 度数 > 5° 时强制裁回 5°(以 viewport 中心为中心)。
  const ABS_MAX_DEG = 5.0;
  if (e - w > ABS_MAX_DEG) { w = cx - ABS_MAX_DEG / 2; e = cx + ABS_MAX_DEG / 2; }
  if (n - s > ABS_MAX_DEG) {
    n = Math.min(85.05, cy + ABS_MAX_DEG / 2);
    s = Math.max(-85.05, cy - ABS_MAX_DEG / 2);
  }
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
    [w, n],
  ];
}

function singleCirclePolygon(
  lat: number,
  lng: number,
  radiusM: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [makeCircleRingCCW(lat, lng, radiusM)] },
  };
}

/**
 * Union N circles into a (possibly Multi)Polygon. We do a divide-and-
 * conquer pairwise union which keeps intermediate polygons small
 * — empirical 2-4× faster than left-fold for N > 100.
 */
function unionCircles(
  circles: GeoJSON.Feature<GeoJSON.Polygon>[],
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (circles.length === 0) return null;
  if (circles.length === 1) return circles[0];

  // Divide-and-conquer
  let layer = circles as Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>;
  while (layer.length > 1) {
    const next: typeof layer = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 >= layer.length) {
        next.push(layer[i]);
        continue;
      }
      try {
        const fc = featureCollection([layer[i], layer[i + 1]]);
        const merged = union(fc as any);
        if (merged) next.push(merged as any);
        else { next.push(layer[i]); next.push(layer[i + 1]); }
      } catch {
        // turf.union throws on degenerate inputs; keep originals.
        next.push(layer[i]);
        next.push(layer[i + 1]);
      }
    }
    layer = next;
  }
  return layer[0];
}

/**
 * v303 OTA fix (N5 真根因 — 二修):zoom-aware padFactor 第一版砍太狠
 * (zoom 17+ 用 2.0),用户走过一片之后 extentBbox 已经撑大,(extent_e -
 * extent_w) × 2.0 等于把 outer ring 扩到 viewport 的 4-6 倍,**超出
 * mapbox-gl silent-skip 阈值 ~8000 pixels** → fillLayer 整个不画 → 用户
 * 看到屏幕角落露底图 + holes LineLayer 画出方框 = "方形 fog"。
 *
 * v302 的 0.5 是用 Playwright spike 实测过的安全值。这次保持 zoom-aware,
 * 但所有档位都不超过 v302 那个安全值 0.5,zoom out 时更小(0.25)防 zoom
 * out 时 (extent × pad) 仍然撑爆。
 *
 * 关键约束:padFactor × max(viewport_degrees, extent_degrees) 必须 < 0.5°
 * 才安全。下面的 padFactor 把这个安全边界 hardcode 在 zoom 区分上。
 */
function padFactorForZoom(zoom: number): number {
  if (zoom >= 17) return 0.5;   // 细节区,viewport 物理很小,pad 0.5 仍在像素安全线内
  if (zoom >= 15) return 0.5;
  if (zoom >= 14) return 0.4;
  if (zoom >= 13) return 0.3;
  return 0.25;                  // zoom out 越远 viewport 越大,pad 必须越小
}

/**
 * Build the fog Feature. The cleared area is the union of unlock-circles
 * at every visited point, punched as holes into the viewport-sized fog.
 */
export function buildFogPolygon(points: VisitedPoint[], bounds: FogBounds, zoom: number = 15): FogFeature {
  // v303 OTA 三修 (B-2 perf):log trace 整个 pipeline 每段耗时,server
  // 可远程分析阻塞点。
  const t0 = Date.now();
  const padFactor = padFactorForZoom(zoom);
  const radius = UnlockConfig.radiusMeters;
  // v303 OTA 三修 (B-2 cull 加强):580 → 1147 点用户 cullThreshold 0.5
  // 还是不够紧。改 0.85 — 圆与圆 85% 半径内重叠就丢一个,union 后视觉
  // 上仍连续(无 gap),但 union 输入数大幅减少。
  const effectiveCullFactor = points.length > 300 ? 0.85 : FogConfig.cullThresholdFactor;
  const cullThresholdM = radius * effectiveCullFactor;
  const cullThresholdSq = cullThresholdM * cullThresholdM;
  // v303 OTA 四修 P1 (fog 矩形真根因):viewport clip 三修时太狠,
  // zoom out 时 viewport 大但仍是城市中心一片 → 90% 点被丢 →
  // extentBbox 只覆盖 viewport 内 hole → outer ring 用 viewport+pad
  // 没盖到屏幕角 → 用户看到"矩形 fog,外面露底"。
  //
  // 改法:viewport clip **极宽松**(只丢点超出当前 viewport 6 倍的极
  // 外点 — 通常就是噪音/迁移导致的远点),保留所有正常解锁点入 union。
  // outer ring 在 makeOuterRingCW 内会用 extentBbox 撑大,覆盖整片走过
  // 区域 — 用户 zoom out 时 fog 会跟着扩大盖满 viewport。
  const vpDLng = bounds.east - bounds.west;
  const vpDLat = bounds.north - bounds.south;
  const clipPaddingMul = 6;  // viewport 6 倍距离之外的点才丢
  const vpW = bounds.west - vpDLng * clipPaddingMul;
  const vpE = bounds.east + vpDLng * clipPaddingMul;
  const vpS = bounds.south - vpDLat * clipPaddingMul;
  const vpN = bounds.north + vpDLat * clipPaddingMul;

  // Cull near-duplicate points so we don't union 600 essentially-identical
  // circles when the GPS is sitting still.
  const kept: VisitedPoint[] = [];
  let droppedOutOfViewport = 0;
  for (const p of points) {
    if (
      typeof p?.lat !== 'number' || typeof p?.lng !== 'number' ||
      !isFinite(p.lat) || !isFinite(p.lng)
    ) continue;
    // viewport clip:超出 viewport+1x padding 的点跳过 union(节省 90%+)
    if (p.lng < vpW || p.lng > vpE || p.lat < vpS || p.lat > vpN) {
      droppedOutOfViewport++;
      continue;
    }
    let skip = false;
    for (let i = kept.length - 1; i >= 0 && !skip; i--) {
      const dLat = (p.lat - kept[i].lat) * 111_000;
      const cosLat = Math.cos((kept[i].lat * Math.PI) / 180);
      const dLng = (p.lng - kept[i].lng) * 111_000 * cosLat;
      if (dLat * dLat + dLng * dLng < cullThresholdSq) skip = true;
    }
    if (!skip) kept.push(p);
  }

  const outer = makeOuterRingCW(bounds, null, padFactor);

  if (kept.length === 0) {
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [outer] },
      properties: {},
    };
  }

  // Build N CCW circles and union them.
  const tCull = Date.now();
  const cullMs = tCull - t0;
  const circles = kept.map((p) => singleCirclePolygon(p.lat, p.lng, radius));
  const tCirc = Date.now();
  const merged = unionCircles(circles);
  const tUnion = Date.now();
  const unionMs = tUnion - tCirc;

  const holes: number[][][] = [];
  // Track the bounding box of all hole rings so the outer ring can be
  // expanded to contain them if the viewport happens to be inside the
  // explored area.
  let extentW = Infinity, extentE = -Infinity, extentS = Infinity, extentN = -Infinity;
  function extendBy(ring: number[][]) {
    for (const c of ring) {
      if (c[0] < extentW) extentW = c[0];
      if (c[0] > extentE) extentE = c[0];
      if (c[1] < extentS) extentS = c[1];
      if (c[1] > extentN) extentN = c[1];
    }
  }
  // v303 OTA 三修 (B-2 perf): smooth gate 提到外层,perf trace 也能用
  const shouldSmooth = kept.length <= 300;
  if (merged) {
    // v303 OTA fix (N4 真根因):union 后 holes 在圆与圆 相切处出现锐角
    // 看起来像"狗啃"。@turf/polygon-smooth 用 Chaikin 算法一轮平滑 →
    // 每个锐角变两个钝角,视觉上接近圆弧。一轮 +25% vertex,可接受。
    //
    // v303 OTA 三修 (B-2 perf):N > 300 时 Chaikin 一轮可能 +25% × union 后
    // 的几千顶点 = 100-300ms 额外阻塞。skip。N 大用户走的范围也大,边
    // 缘锐角问题没那么明显(union 互锁圆数多)。
    let smoothedFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] | null = null;
    try {
      if (shouldSmooth) {
        const sm = polygonSmooth(merged as any, { iterations: 1 }) as GeoJSON.FeatureCollection<GeoJSON.Polygon>;
        if (sm && Array.isArray(sm.features) && sm.features.length > 0) {
          smoothedFeatures = sm.features;
        }
      }
    } catch {
      smoothedFeatures = null;
    }
    if (smoothedFeatures) {
      // smooth 成功:用 smoothed features 的 outer ring 当 holes
      for (const f of smoothedFeatures) {
        if (f.geometry?.type !== 'Polygon') continue;
        const outerHole = f.geometry.coordinates[0];
        if (outerHole) {
          holes.push(outerHole);
          extendBy(outerHole);
        }
      }
    } else if (merged.geometry.type === 'Polygon') {
      // smooth 失败:用原 merged polygon
      const outerHole = merged.geometry.coordinates[0];
      holes.push(outerHole);
      extendBy(outerHole);
    } else if (merged.geometry.type === 'MultiPolygon') {
      for (const poly of merged.geometry.coordinates) {
        const outerHole = poly[0];
        holes.push(outerHole);
        extendBy(outerHole);
      }
    }
  }

  const extentBbox = isFinite(extentW)
    ? { west: extentW, east: extentE, north: extentN, south: extentS }
    : null;
  const finalOuter = makeOuterRingCW(bounds, extentBbox, padFactor);

  // v303 OTA 三修 perf trace 字段:让 FogLayer log 到 server。
  const tEnd = Date.now();
  const totalMs = tEnd - t0;
  const smoothMs = tEnd - tUnion;
  const outerW = finalOuter[0]?.[0] ?? 0;
  const outerN = finalOuter[0]?.[1] ?? 0;
  const outerE = finalOuter[1]?.[0] ?? 0;
  const outerS = finalOuter[2]?.[1] ?? 0;

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [finalOuter, ...holes],
    },
    properties: {
      hole_count: holes.length,
      point_count: kept.length,
      // v303 OTA 三修 perf:server 远程诊断
      input_n: points.length,
      kept_n: kept.length,
      dropped_oov: droppedOutOfViewport,
      cull_ms: cullMs,
      union_ms: unionMs,
      smooth_ms: smoothMs,
      total_ms: totalMs,
      smoothed: shouldSmooth,
      outer_w: outerW, outer_e: outerE, outer_n: outerN, outer_s: outerS,
      extent_w: extentBbox?.west ?? null,
      extent_e: extentBbox?.east ?? null,
      extent_n: extentBbox?.north ?? null,
      extent_s: extentBbox?.south ?? null,
      pad_factor: padFactor,
      zoom,
    },
  };
}

/** Number of rendered hole rings (NOT input point count). */
export function countHoles(feature: FogFeature): number {
  return Math.max(0, feature.geometry.coordinates.length - 1);
}
