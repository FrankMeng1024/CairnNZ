# v428 Plan — 4-eye Review Draft

**Date**: 2026-07-22
**Author**: main agent
**Status**: Draft — awaiting 2 independent subagent reviews before Implementation phase

## Executive summary

v428 是大版本,包含 3 组独立但相关的改动。发布前必须通过:
1. Plan review (this doc) — 2 subagent 独立审
2. Code review — 3 subagent 独立审
3. Playwright web QA — 主 agent 跑
4. **OTA gate**: 3 subagent 独立看 QA + code diff, 全 PASS 才推,任一 FAIL loop

---

## SPIKE RESULTS (updated 2026-07-22 by main agent, must inform review)

### ✅ MySQL 8 spatial on aliyun — VERIFIED
- MySQL 8.0.45, `ST_Contains` works
- `GEOMETRY NOT NULL SRID 4326` + `SPATIAL INDEX idx_geom (geom)` 可创建
- Round-trip GeoJSON → GEOMETRY → GeoJSON 无损
- **约束**: `ST_Contains` 两侧 SRID 必须匹配 (用 `ST_SRID(ST_GeomFromText('POINT(x y)'), 4326)` 传入 point)

### ⚠️ shapeName 直取假设错 — REVISED
之前 plan 说"shapeName 字段直接写入 name_en"。实盘发现 3 类问题:
1. **NZ ADM1 shapeName 带后缀**: "Auckland Region" / "Wellington Region" (17 个都带 " Region"/"Territory")
2. **CN ADM2 shapeName 是拼音**: "Shanghaishi" / "Beijingshi" / "Chongqingshi" (全 2391 条中文都是汉字拼音, 无英文短名)
3. **CN ADM1**: 34 条, 也是拼音 "Shanghaishi"

**用户裁决**: 只要英语 → 主 agent 处理:
- CN ADM1 (34 条): 硬编码 mapping 表 (Shanghaishi→Shanghai, Beijingshi→Beijing, ...)
- 其他国家 ADM1: 用后缀 stripping 规则 (" Region", " State", " Province", " Territory" → 去掉)
- 边界个例 override 表 (~30 条,如 "United States", "United Kingdom" 保留原样)

### ⚠️ ADM 层级 = "city" 假设错 — REVISED
之前 plan 说 "ADM2 = 市/县级"。实盘发现:
- **NZ ADM1** (17): "Auckland Region", "Wellington Region", "Canterbury Region" — 这才是 NZ 的"城市/大区"
- **NZ ADM2** (88): 里面**没有 "Auckland"** (2010 年 Auckland Council 合并了原 7 city + 1 district, 现在 Auckland 就是 ADM1). 有 "Wellington City", "Christchurch City", "Waikato District" 等
- **CN ADM1** (34): "Shanghaishi", "Beijingshi", "Guangdongsheng" — 这才是"城市/省"
- **CN ADM2** (2391): 静安/浦东级 (用户明确不要)
- **JP ADM1** (47): 都道府県 (Tokyo/Osaka/Hokkaido)
- **JP ADM2** (~1700): 市区町村 (Shibuya-ku 等)

**用户裁决**: "最低级 = 城市, geo 支持区么? 不支持就城市为底" → 主 agent 决定:
- 用 ADM1 作为"城市/州/大区"级 (最低层),不做 ADM2 (各国语义不齐,且 CN 就是"区")
- 层级: `world (L0) → continent (L1) → country (L2) → adm1 (L3, "city")` 四层
- **不加 ADM2** —— NZ App Store 用户在 Auckland → 显示 "Auckland" (ADM1) 就是他们理解的城市

### ✅ geoBoundaries 下载 verified
- API `https://www.geoboundaries.org/api/current/gbOpen/{ISO}/{ADM_LEVEL}/` 返 metadata JSON
- `simplifiedGeometryGeoJSON` 字段 → GitHub raw GeoJSON
- 大小: NZ ADM1 simplified = **2 MB**, CN ADM2 simplified = **6.7 MB**
- 简化数据全球 ADM0+ADM1 估: ~100 MB, 一次性 seed 到 aliyun MySQL, OK

### ADM 层级最终决定 (基于 spike + 用户裁决)
| Level | 名称 | 数据源 | Row 估计 |
|---|---|---|---|
| 0 | World | 硬编码 | 1 |
| 1 | Continent | 硬编码 | 7 |
| 2 | Country | geoBoundaries ADM0 | ~200 |
| 3 | **City / State / Region** (最低) | **geoBoundaries ADM1** | ~4000 |

**No district / ADM2**. 用户在 Auckland → 面板显示 "Auckland" (ADM1). 用户在上海静安 → 面板显示 "Shanghai" (ADM1 直辖市). 用户在东京涩谷 → 面板显示 "Tokyo" (ADM1 都道府県).

---


## Scope — 3 独立改动

### 改动 A: 全球城市级高亮 (新功能)
点面板任一 region → 地图上该 region 的**真实多边形**淡绿色填充 + sage 描边。
其他区域不变(不加 mask)。高亮**一直存在**,不受 zoom 影响。用户 zoom 14 看到路,zoom out 看到高亮全景。

**数据源**: geoBoundaries CGAZ (ADM0 国家 + ADM1 省/州 + ADM2 市/县)
- CC-BY 4.0, 免费商用
- 全球 199 国, ~4000 states, ~4万 cities
- **NZ App Store 上架无合规问题** (只有 CN 区才卡台湾/藏南 - 现在不做 CN 区上架)

**技术层**:
- Backend: `regions` 表新加 `polygon_geojson LONGTEXT` 列 (存 gzip-friendly GeoJSON string, 每 region 平均 <100KB)
- Backend 新 endpoint: `GET /api/hierarchy/polygon/:region_id` → gzipped GeoJSON + `Cache-Control: max-age=86400`
- Client `hierarchyService.ts` 加 `fetchPolygon(regionId)` (24h AsyncStorage cache)
- Client `MemoryMap.tsx` 新增 `<Mapbox.ShapeSource id="hl-region"> + <Mapbox.FillLayer opacity=0.25 color=sage> + <Mapbox.LineLayer width=2 color=sage>`
- 选中 region 变化时 fetch + swap source data

**归属判断 (deepest)**:
- Backend `/deepest` 保持 bbox 快速筛选 + 加 polygon point-in-polygon 二次精确判断
- MySQL 8 `ST_Contains` (阿里云 MySQL 8 支持,需验证)
- 无 spatial index 也能跑 (bbox pre-filter 后 candidates ~10 个, sequential point-in-polygon O(n))

**命名**:
- `regions.name_en` = geoBoundaries `shapeName` 字段直接写入
- 例: China / United States / Shanghai / Auckland / Tokyo
- 无中文,无 zh 字段维护

### 改动 B: Memory hierarchy 4 bug (已完成 code, 需 review)

已完成的 code 变更 (git status 显示):
- `backend/src/routes/hierarchy.js` — 三态 (marked/walked/locked), `?drill=1` 参数, join markers 表
- `app/src/features/memory/services/hierarchyService.ts` — types 三态, drill 参数
- `app/src/features/memory/components/HierarchyPanel.tsx` — 三态 dot styles, 底部 legend, 点绿钻入, useEffect 保留旧数据修闪烁
- `app/src/features/memory/screens/MemoryScreen.tsx` — hierarchyDrill state, onSelectSibling isHere 分支

Bug 修复:
1. Bug 2 (点绿色无反应): 传 `isHere` flag 给 onSelectSibling, MemoryScreen 收到 isHere=true 就 setHierarchyDrill(true), 面板重新 fetch with `?drill=1`, 展开当前 region 的 children 为新 siblings
2. Bug 3 (三态): backend 分别 count markers 和 memory_points, 输出 state ∈ {marked, walked, locked}, client 三色 dot (实心 sepia / 空心 sepia / 灰)
3. Bug 4 (↑ 闪烁): useEffect regionId change 时 **不 reset data**, 仅在首次加载显示 spinner, 后续切换保留旧面板直到新数据到
4. Bug 5 (底部无意义提示): 移除 "N visited · M unvisited" 换成 3 dot legend (mark/visit/locked)

### 改动 C: Sim-walker debug 门禁

Sim-walker 已由 subagent 集成 (`app/src/dev/simWalker/`), 但当前 gate 只用 `EXPO_PUBLIC_SIM_MODE` env var. 用户要求改成:
- **持久门**: `useSettingsStore.debugMode` (已有, Settings 里 5-tap 版本号切换)
- **会话门**: 新加 `simWalkerActive: boolean` (in-memory only, cold restart 归零)
- **UI 入口**: Settings > Debug section 内加 "Sim walker" Switch (仅 debugMode=true 时可见)
- **激活**: HikingScreen 内 `{debugMode && simWalkerActive && <SimWalkerOverlay />}`
- **移除**: `isSimMode` env-var gate (改为兼具持久 + 会话双门)

**关闭 app 后行为**: `debugMode` 保留 (下次开 Settings 还是 ON, 因为 5-tap 已开启过), `simWalkerActive` 归零 (Zustand 不 persist 这个字段)

## Technical details — 需要审查的关键点

### Q1: 阿里云 MySQL 8 spatial 是否可用? — **✅ VERIFIED 2026-07-22**
主 agent 已 SSH 到阿里云实盘验证:
- MySQL 8.0.45 ✅
- `ST_GeomFromGeoJSON` 返回 SRID 4326
- `ST_Contains` 需 SRID 匹配, 用 `ST_SRID(ST_GeomFromText('POINT(x y)'), 4326)` 传入 point
- `GEOMETRY NOT NULL SRID 4326` + `SPATIAL INDEX idx_geom (geom)` 可创建
- Full round-trip (insert → contains → asText) works
- **结论**: 用 GEOMETRY 列 + SPATIAL INDEX + SRID 4326 一致

### Q2: geoBoundaries 数据大小?
- ADM0 (国家) ~200 features, ~50MB simplified
- ADM1 (省/州) ~4000 features, ~150MB simplified
- ADM2 (城市) ~40k features, ~500MB simplified

**风险**: 500MB 入库时间. **对策**: seed 一次入库, LONGTEXT 存 GeoJSON, MySQL 表 ~600MB 磁盘. 阿里云可接受.

### Q3: 高亮 polygon fetch 时机?
- 用户点 sibling → 立刻 fetch → mount FillLayer
- 首次 100KB 网络 (Shanghai polygon), 24h AsyncStorage cache
- 断网/慢网: 高亮延迟出现, 不阻塞 fly-to (fly 用现有 bbox center + zoom 14 逻辑)

### Q4: 点绿色钻入后 breadcrumb 如何?
现在 MemoryScreen 只有 hierarchyRegionId + hierarchyDrill 两个 state. 用户点绿色 → drill=true. 再点面板里新绿色 → 会 drill 到 grandchild.  ↑ 按钮 = go up → drill=false + regionId=parent.
**potential issue**: drill 到很深后 ↑ 只能上一层, 不能"回到起始层". **决定**: v428 接受这个, R2 再考虑 breadcrumb.

### Q5: geoBoundaries CGAZ 是"单一 topology"还是"per-country"?
CGAZ (Composite Global Administrative Zones) = 单一预处理数据集, 边界已 US State Dept 版本 clean, 无国界重叠/gap. **单文件下载**, 不用逐国拼.

### Q6: Playwright web 能否验证 fill layer 视觉?
可以. `browser_take_screenshot` 截图 + 用户回来目视验. 更严格的话可 evaluate `map.queryRenderedFeatures()` 检查 fill layer 是否有 features 命中.

## Deployment plan

1. **Backend**: seed 上海云 MySQL (dev 操作) + docker restart (自动化脚本)
2. **Client**: OTA push (无 EAS build, 无用户下载)
3. **Version**: OTA_VERSION 427 → 428
4. **Rollback**: MySQL 备份 regions 表, 出问题恢复 v427 seed

## Risks — 已识别

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 阿里云 MySQL 8 spatial 不支持 | 中 | 高 (需 turf.js fallback) | 开工第 1 步验证 |
| geoBoundaries ADM2 中国部分覆盖不全 | 低 | 中 | seed 后抽查上海/北京, 缺失则补 DataV |
| Polygon 数据太大导致 client fetch 慢 | 中 | 中 | gzip + AsyncStorage cache + 24h TTL |
| Polygon point-in-polygon 慢 | 低 | 低 | bbox pre-filter + 只当前 zoom 视口 |
| debugMode 已有 (persistent) 用户不小心开启后残留 | 低 | 低 | Settings > Debug section 已有明显 toggle |

## Definition of Done — v428 可以推 OTA 的条件

- [ ] MySQL spatial 验证通过或 fallback 确定
- [ ] geoBoundaries seed 完成, `regions` 表 rows > v427 数量
- [ ] `/api/hierarchy/polygon/:id` 返 200 + GeoJSON for 5 城市: Shanghai/Auckland/Tokyo/New York/London
- [ ] Client 三态 UI 视觉 OK (5 城市 Playwright 截图)
- [ ] 点绿色钻入行为正确 (Playwright: 上海 → 点上海 → 显示上海内容)
- [ ] ↑ 按钮闪烁修复 (Playwright: 连续切换 3 次面板, no full white flash)
- [ ] 底部 legend 3 dot 显示 (Playwright)
- [ ] Sim-walker gate: debugMode=false → 摇杆不显示; debugMode=true simWalkerActive=false → 摇杆不显示; 都=true → 显示 (Playwright)
- [ ] Sim-walker 走 100m 后 hike track 有点 (Playwright: `useTrackingStore.getState().trackPoints.length > 0`)
- [ ] **3 subagent 独立审 QA + code, 全 PASS** (OTA gate)

## Open questions for reviewers

1. GeoJSON polygon 存 LONGTEXT (JSON) vs 存 MySQL GEOMETRY 列, 哪个更好?
   - LONGTEXT: seed 简单, backend 输出直接透传. 查询时不能 ST_Contains.
   - GEOMETRY + SRID 4326: 需 `ST_GeomFromGeoJSON` seed, 支持 ST_Contains. 输出时需 `ST_AsGeoJSON` 转回.
   - 我倾向 GEOMETRY 因为要 point-in-polygon. 请审 review.

2. Highlight 高亮是否加入 zoom-in 特效 (fade in)?
   - 用户原话 "高亮效果要好". 无特效 = 直接出现. 特效 = 200ms opacity fade + 描边 pulse 一次.
   - 我倾向 fade in (低成本 UX 提升). 请审 review.

3. `MemoryMap.tsx` 已有 layer 众多 (fog / tracks / markers). 高亮 layer 插入位置?
   - 建议插在 fog 之上, tracks 之下. 保证 tracks 可见但视觉主导.

