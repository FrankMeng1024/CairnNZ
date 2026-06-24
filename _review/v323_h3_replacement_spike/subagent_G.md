# Spike G — Cairn H3 API 使用清单

**Scope**: Cairn `app/src` 内所有 `h3-js` 调用 + 持久化 + 后端兼容性 + 替换可行性。
**调研对象**: replacement of `h3-js` (Uber emscripten-compiled C library, crashes in RN Hermes iOS).
**Method**: grep 全代码 + 读 6 个关键文件 + 后端 schema 核对。

---

## A) 完整 h3.* 调用清单

实际 grep `h3\.` 在 `app/src/` 找到 **7 处调用点**，分布在 3 个文件。`useMemoryStore.ts` 的 `h3.clear()` / `h3.bulkImport(...)` 是 zustand store handle，不是 h3-js 库调用（已排除）。真正的 h3-js 函数调用如下：

| File:Line | Function | Args | Frequency | Hot path? |
|---|---|---|---|---|
| `useH3VisitedStore.ts:185` | `latLngToCell(lat, lng, 11)` | WGS84 度 + STORE_RES=11 | **GPS 1Hz**（每个 unlockEngine.processReading 一次） | YES — 每 GPS reading 同步执行 |
| `useH3VisitedStore.ts:244` | `latLngToCell(p.lat, p.lng, 11)` | 同上 | **bulkImport chunks**：每 50 点 yield 一次。hydrate / replacePoints / recordCircleUnlock 触发。典型冷启动 ~581 点。 | YES — 这是导致 0x8badf00d 的元凶 |
| `h3FogBuilder.ts:164` | `cellToParent(cellID11, targetRes)` | res-11 cellID + targetRes∈{8,9,10} | **fog rebuild 时遍历全部 visited cells**（50k 用户走过的位置）。有 `parentSetCache` 按 (cellVersion, res) 缓存，amortized 1次/cellVersion bump/res。 | YES — 长期用户 50k cells × ~5ms/k = 250ms uncached |
| `h3FogBuilder.ts:211` | `polygonToCells([ring], res, geoJson=true)` | viewport ring 4 顶点 + targetRes∈{8..11} | **每次 fog rebuild**（FogLayer useMemo 触发：cellVersion 变 / 视口 debounce 100ms 触发） | YES — 22ms@res9, 658ms@res11 |
| `h3FogBuilder.ts:223` | `polygonToCells([ring], res-1, true)` | 同上 + 降一级 res | 仅当 viewportCells > 3500 时 demote 一次 | 偶发 hot path |
| `h3FogBuilder.ts:262` | `cellsToMultiPolygon(unvisitedIDs, geoJson=true)` | unvisited cell ID 数组 + geoJson=true | **每次 fog rebuild** 在尾部做 dissolve。perf 字段 `dissolve_ms` 单独追踪——已知是 50k cells profile 的热点。 | YES — 主要 CPU 消耗，输出 GeoJSON MultiPolygon |
| (隐含) `cellToBoundary` / `cellToLatLng` | — | — | **零调用** — Cairn 不使用 | — |
| (隐含) `gridDisk` / `gridDistance` | — | — | **零调用** — Cairn 不使用 | — |

**所用 h3-js API 总集（去重）**：4 个。
- `latLngToCell(lat, lng, res) → string` — coord → cell ID
- `cellToParent(cellID, res) → string` — coarse-grain rollup
- `polygonToCells(rings, res, geoJson) → string[]` — 视口枚举
- `cellsToMultiPolygon(ids, geoJson) → number[][][][]` — dissolve 邻接 cells 成多边形

**关键观察**：Cairn 完全没用 `cellToBoundary`（单 cell 的 hex 顶点）或 `cellToLatLng`（cell 中心点）。也没有 `gridDisk`（邻域）。这意味着 **Cairn 不使用 H3 的 hex geometry 本身**——它把 H3 当作 (a) 量化器（lat/lng→token），(b) 层级容器（parent rollup），(c) 区域到 token 列表的扫描器（polygonToCells），(d) 邻接拓扑的 dissolve 器（cellsToMultiPolygon）。

---

## B) cellID 兼容性需求

- **持久化**: 仅本地 `AsyncStorage`。`h3Persistence.ts:32` 存储 key `cairn:memory:h3:v1:${userId}`，序列化结构 `{ v: 1, cells: Array<[cellID_string, {first, last, count}]> }`。**这是一个客户端 cache，不是真理来源**——`h3Persistence.ts:147-149` 注释明确：`points = source of truth. cells = derived cache. replacePoints is the ONLY full-rebuild entry`。
- **后端 API 是否传 cellID?** **NO**。`backend/src/routes/memory.js` 完整查过：POST/GET `/api/memory/points` body 是 `{points: [{lat, lng, ts, cid}]}`，`cid` 是 client-supplied UUID（dedup 用），不是 H3 cellID。整个 backend 16 文件 grep `h3|cellID|hex_cell` 仅 package-lock.json 杂项命中（与 H3 无关的整合哈希）。
- **跨设备同步是否依赖 cellID 一致性?** **NO**。同步传 lat/lng 原始点；H3 cells 在每个客户端独立从 points 重算（见 `useMemoryStore.ts:559-573` 的 `replacePoints` → `bulkImport` 流程）。**用户切换设备 / 重装 app 都不依赖 cellID 字符串一致**。
- **是否有导入/导出 cellID 的功能?** 全代码搜过：无。
- **结论**: cellID 字符串格式 **完全是本地实现细节**，可以自由替换为任何 (lat,lng,res)→字符串 的确定性函数。替换不破坏任何外部契约。

---

## C) Fog 视觉渲染

- **每 cell 一个 polygon? 还是 dissolve 成大块?** **Dissolve**。`h3FogBuilder.ts:92-99` 注释明确：`Single MultiPolygon feature covering all unvisited hex cells in viewport. Using a MultiPolygon (vs per-hex polygons) means: FillLayer sees a connected region with no internal seams. LineLayer strokes only the outer perimeter once, not every hex edge twice — matches the "cloud, not game grid" intent.` `cellsToMultiPolygon(unvisitedIDs, true)` 把所有未访问的 hex 邻接合并成一个大 MultiPolygon。
- **用户视觉上能区分 hexagon vs 矩形 grid 吗?** **不能**，原因有 3：
  1. 输出已 dissolve——用户看到的是 **fog 外轮廓**，不是单个 hex。内部 hex 边界 **不渲染**（无 seam）。
  2. `FogLayer.tsx:102` 的 `lineBlur` 自适应（zoom<13 → blur=5，<15→3，>=15→2），刻意把任何残留的 dot 边都 blur 掉，让其读作"云"而非"游戏网格"。
  3. `memoryConfig.ts:135-138` 注释直白："塑料感主要来源是整片色块完全均匀 + 锐利边界 — 现在锐利边界靠 polygon-smooth 一轮 Chaikin 解决；透明度降一点让底图 (Topo50) 透出色调"。设计意图是"模糊的雾"，不是"hexagon 网格"。
- **换成矩形 grid 的视觉影响**:
  - 视口的 dissolve 后大轮廓：hex vs square 在 100m+ 距离上不可分辨——两者都被 lineBlur 5 抹平。
  - 单格大小：H3 res 11 = ~9m hex；UnlockConfig.radiusMeters = 25m。矩形若用 ~25m 边长即可同等粒度。
  - 唯一会暴露的位置：**视口边缘极近放大**（zoom>=16）+ **单个孤立 unvisited cell**（无 dissolve）+ **fog 完全不 blur**——但 zoom>=16 时 lineBlur 仍是 2，仍模糊，且 Cairn 的 use case 是 city walk，不是 px-level inspection。
- **结论**: 用户视觉上不能区分。Dissolve + blur + 25m 量级 + 现有视觉语言（雾，不是网格），让 hex 的几何性质对感知是**不可见的**。

---

## D) 替换可行性评估

### 方案 1: 完全保留 H3 算法（纯 JS 重写）
- **思路**: 找一个 pure-JS H3 实现（如 `h3-js` 的 wasm 版本走 Hermes 友好路径，或社区移植）。
- **LOC**: 0 业务代码改动；但需 vendor 第三方 ~6000 LOC 纯 JS H3 算法（H3 整套算法：icosahedron projection + faceIJK + h3 index 编码 + hex boundary + polygon fill）。
- **风险**: **高**。
  - 没有现成 maintained pure-JS H3。`h3-js` 是 official，依赖 emscripten；唯一替代 `h3-js@browser` 也是同一 emscripten 包。
  - Hermes JS 引擎跑 6k LOC 算术密集代码慢——`polygonToCells` + `cellsToMultiPolygon` 当前 22-90ms 是 native，pure JS 会 5-10x，违反原有 perf 目标。
  - 重写本身就是 high-stakes bug 源（H3 算法非平凡，几何/拓扑 corner case 多）。
- **保留价值**: 零。Cairn **不使用** H3 的 hex 几何或多分辨率体系（除了"较粗 res 减少 cell 数"，矩形 grid 同样可以做层级）。

### 方案 2: 用矩形 grid 替代（放弃 hex）⭐ 推荐
- **思路**: 把 H3 cellID 替换为 `"${zoomLevel}:${x}:${y}"` 风格的 mercator tile ID。所有 4 个 H3 API 都有平凡的矩形等价：
  - `latLngToCell(lat, lng, res)` → mercator project + floor 到 tile coord，纯算术 ~5 行
  - `cellToParent(cellID, targetRes)` → `(x >> (sourceRes - targetRes), y >> (sourceRes - targetRes))`，1 行
  - `polygonToCells(ring, res)` → 视口矩形 → tile range loop，~15 行
  - `cellsToMultiPolygon(ids)` → **这是唯一难的**。需要"邻接矩形合并成 MultiPolygon"算法。但 axis-aligned 矩形邻接的 outline tracing 是经典问题（marching squares 或 edge-tracking），实现 ~80-150 LOC，可测试性强。
- **LOC**: 
  - 新文件 `rectGrid.ts`：~200 LOC（4 个函数 + 测试）
  - 改动现有：5 个 import 替换 + `latLngToCell` 改成 `latLngToRect` 等 alias→ ~30 行
  - 删除：`h3LoadGate.ts`（86 LOC）、`h3FailGate` 相关 ~50 行 v311/v312 防御代码、bulkImport 的 chunked yield 防 watchdog（不再需要——纯 JS 算术 5 ms/k 不会 freeze main thread）
  - **净 LOC**: +200 新 / -150 旧 = +50 净增（但代码复杂度大幅下降，没有 32MB ArrayBuffer / emscripten 加载 / persisted failure gate）
- **风险**: **低**。
  - 算法都是初等几何，无 corner case 黑魔法。
  - cellID 字符串格式变化 → 现有 AsyncStorage cache 一次性失效（用户首次升级后从 points 重建 cells，已有 `replacePoints` 路径），无数据丢失。
  - 视觉 zero diff（见 §C）。
  - Backend zero impact（见 §B）。
  - **核心收益**: 杀死 32MB ArrayBuffer / emscripten / iOS watchdog / jetsam / 整个 v305-v323 围绕 h3-js 的 8 个 OTA 防御层。

### 推荐方案 + 理由

**方案 2（矩形 grid）**。理由按优先级：

1. **架构上 H3 不必要**：Cairn 只用 H3 做"量化 + 层级 + 区域扫描 + 邻接 dissolve"。这 4 件事 axis-aligned rectangular grid 全能做，且代码更简单。
2. **用户感知零差异**：fog 是 dissolved + blurred + sepia 色调的"云"，单格几何形状不可见。
3. **杀死整个崩溃源**：v306-v323 整套 lazy require + persisted gate + chunked bulkImport + cooldown + cross-session flag 全是为 emscripten 的 32MB ArrayBuffer + iOS watchdog 服务。换成 pure JS arithmetic 后这些防御**全部可删**。app 启动稳定性回到 v304 之前的简单状态。
4. **后端零改动**：契约是 `{lat, lng, ts, cid}`，cellID 是纯本地实现。
5. **性能更可控**：`latLngToCell` 当前 emscripten 调用 ~0.05ms/point；mercator project 是 5 行算术 ~0.001ms/point。批量 581 点从 ~30ms emscripten 降到 <1ms 纯 JS。
6. **LOC 净增小**：~50 LOC，远小于 ongoing 维护 h3-js 防御层的成本。

---

## E) 已知风险 / Corner Cases

1. **AsyncStorage cache 失效**：升级后用户的 `cairn:memory:h3:v1:` cache 里的 H3 cellID 字符串无法被新代码 parse。**Mitigation**: bump key 到 `cairn:memory:rect:v1:`；老 key 任其孤立（AsyncStorage 不会爆）。或在 hydrate 时 try parse，失败就走 replacePoints 路径从 points 重建——本来就是 fallback path，零数据丢失。

2. **cellsToMultiPolygon 替代算法的正确性**：邻接矩形 outline tracing 不是 H3 那种 "library 给好了"。实现需要：
   - 标记每个 unvisited rect 的 4 条 edge
   - 对于每条 edge，若邻居 rect 也是 unvisited 则取消（内部边）
   - 剩下的 edge 集合按"端点链"拼成 ring
   - 处理多个不连通的 region → 多个 polygon
   - 处理 hole（visited 包围在 unvisited 内部 → 内 ring）
   建议参考 marching squares 或 boost::geometry::union；测试覆盖 (a) 单 rect (b) 2 rect 邻接 (c) L 形 (d) 中空 (e) 多个不连通 group。**估 80-150 LOC + 50 LOC 测试**。

3. **极地经度跳变**：`latLngToCell` 在 |lat|>85 / 跨日期线时矩形 grid 会拉伸或环绕。当前 Cairn 用户场景（NZ city walking）远离这些区域，但 mercator project 标准范围是 ±85.05°；外加 `cellToParent` 跨 hemisphere 是平凡（>>位移，但 sign 处理需谨慎）。**Mitigation**: clip lat 到 [-85, 85] 在 entry，跨日期线场景不支持（H3 当前也是有边界 case 的，Cairn 并未测过）。

4. **零分辨率层级 reuse**：H3 的 res 8→11 间隔是 ~7×每级；矩形 grid 用 zoom 标准 (`2× per level`)。当前 `getResForZoom` 的硬编码阈值（zoom<12 → res 8 等）需要按矩形重新校准，让 viewport_cell_n 留在 ~500-3500 budget 内。**估 1 次实测调参**，不构成阻碍。

5. **视觉验证必跑 Playwright**：HTML demo 是 Cairn 视觉基准（per user memory `feedback_unity_html_baseline.md`）。替换后必须 Playwright 截图 side-by-side 对比 H3 vs Rect fog，确认 lineBlur=5 下用户视觉不可区分。**Estimated 30min**。

6. **h3LoadGate 删除是 breaking 还是简化**：是简化。`h3LoadGate.ts` 文件、`useH3VisitedStore.ts` 内 v311/v312 整段 beacon、`useMemoryStore.ts:546-558` 注释里的 setTimeout(100) 全 obsolete。**正面：删 ~150 LOC 防御代码**。

7. **没有 hex 几何带来的"未来功能限制"**：若以后想做"按 hex 显示热力图"或"hex-based gameplay"（如 Pokémon GO 风格），需要 hex。**当前 PRD 无此需求**；若未来需要 hex，可以单独引入轻量库（如 `honeycomb-grid`，纯 JS，已 Hermes 兼容）做局部 hex grid，与 fog 矩形 grid 隔离。

---

## 总结建议

**Replace h3-js with axis-aligned mercator rectangular grid.** 

- 用户视觉零变化；
- 后端零改动；
- 净 +50 LOC 但删除 ~150 LOC v306-v323 防御代码；
- 杀死 32MB emscripten ArrayBuffer 这个所有 iOS Hermes 崩溃的元凶；
- 唯一非平凡子任务是 `rectsToMultiPolygon` 邻接合并算法，~150 LOC 可独立测试。

风险列表 7 条全部可缓解或非阻塞。
