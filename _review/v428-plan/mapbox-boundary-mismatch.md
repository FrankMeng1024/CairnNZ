# v428 — Highlight polygon vs Mapbox 底图边界不重合

调研时间: 2026-07-22

## 1. 根因

Cairn 现状:
- 底图: `mapbox://styles/mapbox/outdoors-v12` → 内部合成 `composite` 源包含 `mapbox-streets-v8` tileset,其中 `admin` 图层用于绘制国界/省界 label + 虚线。
- 高亮 polygon: `/api/hierarchy/polygon/:id` 从 **geoBoundaries CGAZ**(中国 33 省来自 **DataV.阿里云** 数据集)拿 GeoJSON。

两套边界不是同一份源:

| | 顶点采样 | 简化算法 | 争议区处理 | 中国省界 |
|---|---|---|---|---|
| Mapbox `mapbox-streets-v8 admin` | Mapbox 内部数据(部分参考 OSM + 商业源) | 面向 tile 渲染,zoom 变化 LOD 不同 | 有 `worldview` 属性 (US/CN/IN/JP) | 平滑处理,与 OSM 沿海线锚定 |
| geoBoundaries CGAZ | Natural Earth + OSM + 国家统计局混合 | Douglas–Peucker,固定点密度 | 单版本,与 Mapbox 不一致 | 长江/海岸/内蒙边线偏离 100m~5km 不等 |
| DataV.阿里云 | 民政部区划 + 阿里内部修订 | 面向 GIS,顶点密集 | 大陆立场 | 与 Mapbox 沿海线偏差可达数百米 |

结论:**永远不可能对齐**——只要 polygon 数据源与 Mapbox `admin` 图层不共享同一张几何底稿,zoom 到省界就会看到"错位的双线",这是数据集本质差异,不是代码 bug。

## 2. 解决方案对比

| # | 方案 | 视觉一致性 | 费用 | 工作量 | 风险 |
|---|---|---|---|---|---|
| a | 换用 Mapbox Boundaries add-on (`mapbox.boundaries-adm1-v3`) | 完美(与底图共源) | **付费,按 tile requests 计费**,免费额度用完后按量收费,NZ + CN 覆盖 OK | 中(改客户端 source + license 申请) | 上架成本上升,超出 Cairn "免费为主" 原则 |
| b | 切 styleURL 到 `streets-v12` | 无改善(admin 数据同一份,polygon 源没换) | 免费 | 低 | 治标不治本,视觉照错 |
| c | **停 FillLayer,改 subtle glow / halo** — 不画精确边界 | 免疫问题(不显示边界) | 免费 | 低 | 视觉表达变弱,失去 "这就是那个区" 的直观感 |
| d | **复用 `mapbox-streets-v8` 内置 `admin` polygon,用 `feature-state` 高亮** | 完美(高亮层就是底图那层) | 免费(streets-v8 已在 outdoors-v12 里) | 中(需按 iso_3166_1 / iso_3166_2 匹配 regionId → 建 mapping 表) | Mapbox `admin` 图层是 **line** 类型不是 fill,不能直接 `fill-color`;需 `fill-extrusion` 或自己叠 admin-0/1 polygon;streets-v8 未公开 admin polygon,只公开 admin line ← **这条路走不通** |

**方案 d 关键失败点**: mapbox-streets-v8 的 `admin` 是 LineString,不是 Polygon。想 fill 必须闭合成面,而 tile 内的 line 只是当前 viewport 的可见片段,拼不成完整省界面。所以 d 不成立。

## 3. 推荐

**方案 c(glow / halo)+ 保留 LineLayer 但淡化**

具体做法(留给主 agent 决策):
1. `FillLayer` 保留但 opacity 大幅降低: zoom < 6 时 0.15 → zoom > 8 时 0.05,大 zoom 时几乎看不到 fill 的边缘错位。
2. `LineLayer` 改为 blur + 双层:
   - 外层: lineWidth 12, lineOpacity 0.25, lineBlur 8  ← soft halo
   - 不再画 sharp 边界线
3. 视觉表达从"精确圈地"改为"这个区域被点亮了"——用户感知"选中"而非"边界"。

**为什么不选 a**: Cairn 是免费 hiking app,Boundaries add-on 按 tile 请求付费,memory tab 是高频页面,费用不可控。用户明确 "免费为主"。

**为什么不选 b**: 换 style 不解决数据源不同的根因,只是把错位换个背景色继续显示。

**为什么不选 d**: 技术不成立(见上表)。

**为什么 c 最合适**:
- Cairn 徒步用户在小 zoom 看轮廓(halo 已经足够表达"这里"),大 zoom 进入 hike 视图根本看不到 region 高亮
- App Store NZ 上架不受影响(纯客户端渲染变化)
- 零费用
- 免疫所有未来的数据源升级问题(换 geoBoundaries 版本 / 换 DataV / 加日本数据集都不用重新对齐)

## 4. 备选(如果用户坚持看到边界)

方案 a 的实施成本可以先估算再决策:向 Mapbox 申请 Boundaries eval token,拿 NZ + CN 覆盖跑一个月真实用量,评估 tile requests 数量再定价。这条路径不推荐但保留,作为"用户觉得 halo 太弱"的 fallback。

## 关键文件位置
- `app/src/config/mapbox.ts` — styleURL 定义
- `app/src/features/memory/components/HighlightRegionLayer.tsx` — FillLayer + LineLayer 当前实现

## Sources
- [Mapbox Streets v8 tileset reference (admin layer = Mapbox proprietary global data)](https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/)
- [Mapbox pricing (Boundaries add-on 按用量计费)](https://www.mapbox.com/pricing/)
- [Mapbox Streets Style overview (administrative boundaries as global political layer)](https://www.mapbox.com/maps/streets)
