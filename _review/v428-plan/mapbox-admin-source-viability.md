# Mapbox admin polygon — 免费"修正"可行性

## 结论 (先说)

**没有免费合规路径能把 geoBoundaries "修正成 Mapbox admin 样"**。Mapbox admin 数据 = Mapbox 私有数据 (不是开源 fork),TOS 禁止提取/redistribute。唯一可运行的思路是 **换数据源**（用 OSM boundary relation 或 Natural Earth 自行 seed），不是"修正成 Mapbox 样"。

---

## 路径 1: Tilequery API 一次性拉全球 admin polygons

- **合规**: 允许 — Tilequery 是官方免费 endpoint (free tier 100k/月)
- **可行性**: ❌ 结构不匹配
  - Tilequery 是 **point + radius** 查询, 不是 "give me all polygons"
  - `mapbox-streets-v8` 的 `admin` sourceLayer **只含 LineString** (边界线, 不是 polygon fill)
  - 就算暴力遍历经纬度网格拉线段再拓扑重建 polygon, 100k/月配额扫全球县级不够, 且 TOS §Restrictions 禁止"systematic extraction"
- **不推荐**

## 路径 2: 批量抓 tile 反解 + tippecanoe/mapshaper

- **合规**: ❌ 明确禁止
  - Mapbox TOS §Restrictions: 禁止 "reverse engineer, decompile, cache beyond permitted period, or use tiles outside the Services"
  - Mobile SDK cache 有 30 天限制, 且只用于 SDK 内部渲染, redistribute = 违约
- **可行性**: 技术上能做 (tile 是 protobuf); **法律上 = 直接违约风险, 账号封禁 + 潜在诉讼**
- **不推荐**

## 路径 3: `admin` = OpenMapTiles fork?

- **事实核查**: ❌ **不是**
  - Mapbox 官方 tileset reference 明确写: `admin` 层的 data source = "**Mapbox 独自データ / Mapbox proprietary data**", 全球都是, 不是 OSM 也不是 OpenMapTiles ([source](https://docs.mapbox.com/ja/data/tilesets/reference/mapbox-streets-v8/))
  - 只有 `landuse` / `road` / `poi` 等其它层是 OSM
  - Mapbox 的 admin polygon 是他们付费产品 **Mapbox Boundaries v3** (需要 Boundaries add-on 授权)
- **不存在的路径, 直接排除**

## 路径 4: `setFeatureState` 高亮底图自身的 admin polygon

- **合规**: ✅ 完全合规 (调用 client-side rendering API)
- **可行性**: ❌ **底图 admin 是 LineString, 不是 Polygon**
  - `mapbox-streets-v8` admin sourceLayer feature 只有 admin-0/admin-1/admin-2 边界**线**
  - `setFeatureState` + fill layer 需要 Polygon 几何; LineString 上只能改线颜色/粗细, 不能"填色一块行政区"
  - 底图 fill 层 (陆地/水/绿地) 存在, 但没有一个"按国家/省着色"的 polygon 层可 hook
  - 若要 fill highlight, **必须用 Mapbox Boundaries v3 付费 tileset** (`mapbox.boundaries-adm1-v3` 等), 免费不可用
- **不推荐**

---

## 最终推荐

用户目标 "把 geoBoundaries 修正成和 Mapbox 一致" **不可实现 (免费 + 合规范围内)**。三条替代实用路线, 按推荐度:

1. **✅ 首选: 换成 OSM boundary relations 直接 seed**  
   - Overpass API / Geofabrik extract 免费、ODbL 授权 (attribution 即可)
   - Mapbox 底图部分层本身就是 OSM 派生, admin 虽是私有但边界大致对齐 OSM
   - 用 `osmium extract` + `ogr2ogr` 批量生成 country/state/county polygon, seed 到 MySQL
   - 精度: 与 Mapbox admin 差异 < geoBoundaries 差异 (因为 Mapbox 私有 admin 大量参考 OSM)

2. **备选: 接受不一致, UI 上不并排显示 Mapbox 边界线**  
   - 在 Cairn map style 里把底图 `admin-0-boundary` / `admin-1-boundary` line layer 隐藏 (`visibility: none`)
   - 只显示自家 polygon fill, 用户看不到"错位"
   - 零成本, 30 分钟改 style JSON

3. **降级: 混合方案 — 隐藏底图 admin line + 自家 polygon 用 OSM 数据**  
   - 结合 1+2, 视觉一致 + 数据合规

**明确不做**: 抓 Mapbox tile 反解 (违约) / 依赖 Mapbox admin 私有数据。
