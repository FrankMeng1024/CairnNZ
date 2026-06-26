# Memory 模块死代码审计 (v333)

只读审计, 不动任何文件. 范围: `app/src/features/memory/`.

---

## 1. 完全可删 (0 callers, 跨整个 src/ 全 grep 过)

| file:line | symbol | why dead |
|---|---|---|
| `services/globalFogBuilder.ts:109-202` | `buildGlobalFog()` | v331 切到 raster (Skia PNG mask), 这条 polygon-row-run-dissolve 路径已被替代。**整个 src/ 无任何 import**。 |
| `services/globalFogBuilder.ts:56-63` | `GlobalFogPerf` interface | 仅 `buildGlobalFog` 返回它, 无外部 consumer。 |
| `services/globalFogBuilder.ts:79-86` | `GlobalFogResult` interface | 同上。 |
| `services/globalFogBuilder.ts:91-100` | `decodeCell()` private helper | 仅 `buildGlobalFog` 内部用。 |
| **整个文件 `services/globalFogBuilder.ts`** | — | 唯一仍被引用的是 `FogBounds` interface (lines 72-77), 而该 interface **本身也已死** (见下条)。整文件可删, 把 `FogBounds` 移到 fogFloorGeometry 或直接删。 |
| `components/MemoryFogControl.ts` (整文件) | `useMemoryFogControl()` + `FogRenderMode` | 文件顶部注释声称 "type FogRenderMode is imported by other modules" — **此断言是假**。grep 显示 `MemoryMap.tsx` 自己重新声明了 `FogRenderMode` (line 42), 没有从 `MemoryFogControl` import。整个文件零外部引用。 |
| `services/tileEncoder.ts` (整文件 — `TileId` / `latLngToTile` / `tileKey` / `tileToTopLeftLatLng`) | — | grep `from.*tileEncoder` = 0 matches。v0.2.6 早期 tile-bitmap 方案的遗物, 早已被 H3 cell store 取代。 |
| `config/memoryConfig.ts:180-203` | `MemoryConfigBundle` + `getMemoryConfig()` | grep `getMemoryConfig\(\)` 仅命中自身声明。所有 consumer 都直接 import 具名常量 (`UnlockConfig`, `MysteryPreviewConfig`, etc), 这个聚合 accessor 从未被调用。 |
| `store/useMemoryStore.ts:117 + 495-528` | `applyServerEchoForPush()` (非 Aligned 变体) | 注释自承 "Kept for any non-migrated caller. Memory sync uses Aligned variant." grep 全 src/ 仅命中自身声明 + 类型签名, 0 caller。 |
| `store/useMemoryStore.ts:105 + 412` | `listVisitedPoints()` | grep `\.listVisitedPoints\b` = 0 matches。 |
| `components/MemoryMap.tsx:83-93` | `estimateInitialBounds()` | FogLayer Props 注释 "bounds: Legacy props (kept for back-compat; ignored)" — FogLayer 不读 bounds, 整套估算 + idle-bounds-update 是给已死代码喂数据。 |
| `components/MemoryMap.tsx:110, 136-149, 156-161, 217-225, 303` | `bounds` state + `updateBoundsIfChanged` + bounds 派发 | 同上, 全是死管道。 |
| `components/MemoryMap.tsx:116, 202, 303` | `currentZoom` state + `setCurrentZoom` | FogLayer 也不读 zoom (line 61 Props 注释 "ignored")。 |

---

## 2. Deprecated 标注但仍在

| file:line | content | 何时该删 |
|---|---|---|
| `config/memoryConfig.ts:75-129` | `FogConfig` (`circleVertices`, `cullThresholdFactor`, `outerRingPadFactor`, `rebuildDebounceMs`) | 注释字面写 "@deprecated v305 OTA ... Slated for deletion alongside fogBuilder in the version after v305"。`fogBuilder.ts` 文件早已不存在 (整个 polygon-union 路径都没了)。**v333 应当删**。 |
| `config/memoryConfig.ts:78` | "`Kept here this release so fogBuilder still typechecks`" | fogBuilder 已不存在, 这个理由已经过期 4 个版本。 |

---

## 3. 过期概念 (代码工作但概念已 retired)

| file:line | content | 现在的真实状态 vs 代码假设 |
|---|---|---|
| `store/useMemorySettingsStore.ts:26, 33, 55, 73-78, 84, 109-110` | `FogMode` type + `fogMode` field, 含 `'sdf-soft' \| 'sdf-sharp' \| 'off'` 三个 mode | `MemoryScreen.tsx:357-360` 自承 "removed fogMode pill row ... SDF 三 mode 在 native binary build (7/1) 前都是灰掉的"。`tryLoad()` 强制把任何 persisted 值改回 `'legacy'` (line 77-78: `fogModeRaw === 'legacy' ? 'legacy' : 'legacy'` — 三目表达式两边相同, **是死分支**)。整个 SDF 概念已 retired, 但 type+field+pill 注释占据 ~30 行。 |
| `store/useMemorySettingsStore.ts:34-37` | `useH3Fog` "kill-switch" | 注释说 "false = kill-switch for debug"。但实际开关已经从不在 UI 暴露, default true, 用户无法 toggle。剩存的逻辑是 FogLayer:113, 238 处的 early-return — 等于一个隐藏的 dev-only 开关, 但没有 dev UI。 |
| `services/globalFogBuilder.ts:1-37` 整个 docstring | "v327 Zelda-style fog of war ... row-run dissolve" | 描述的是已废弃的 polygon 路径。v331 切到 Skia raster 后, **整个 builder 不再被调用** — docstring 描述的是死代码本身。 |
| `services/unlockEngine.ts:77-79` | 注释 "`recordCircleUnlock` that pre-computed sub-grid cells, but the new point-based fog model makes that work redundant" | 这段话写于 v0.2.6.1。然而 `recordCircleUnlock` 在 `useMemoryStore.ts:268-389` **仍然 pre-compute hex grid 数百个 sub-points** (v328+ 注释)。注释和真实代码相反, 误导。 |
| `store/useMemoryStore.ts:268-389` | `recordCircleUnlock` 大块 hex-grid 生成 (~120 行) | 仅 `performInitialRevealIfNeeded` (200m radius) 和 `PlantScreen.tsx` (25m radius, 走 small-radius 分支) 调用。Plant 走 single-point 分支 (line 288), initial reveal 200m 仅 ~120 个 hex 点 — 完全可以用 bulkImportSync 一次生成, 但代码保留了为 "500m 初始 reveal" 设计的 hex grid 系统。v332 已把 initialReveal 从 500m 砍到 200m, 这块逻辑现在 over-engineered。 |

---

## 4. 误导性命名 (改名能减少未来 LLM 误导)

| file:line | current name → recommended name | 理由 |
|---|---|---|
| `components/FogLayer.tsx:85` | `FLOOR_RADIUS_M` → **删, 直接用 `MASK_PADDING_M`** | 主 agent 反复在 0/100/2800/3000 间摇摆的元凶。名字暗示 "FLOOR 是独立的位置锚点概念"。实际 v333 决策后 FLOOR 必须 = PADDING (line 84 invariant)。**两个常量同值的存在等于挖陷阱**。 |
| `components/FogLayer.tsx:126, 253-264` | `fogFloor` 变量名 | "Floor" 这个词在游戏开发里通常指 "可见 / 地板", 这里却是 "world 减去用户周围 hole 的不规则环"。建议: `worldFogRing`。 |
| `services/fogFloorGeometry.ts` 整文件名 | → `worldFogRingGeometry.ts` | 同上。文件描述的几何不是 floor, 是 "world minus circle"。 |
| `store/useMemoryStore.ts:99, 268` | `recordCircleUnlock` (大半径分支生成 hex grid) | 名字是 "record CIRCLE", 实际行为是 "tile a region with a hex grid of points"。建议把大半径分支单拆为 `recordRegionUnlockWithGrid`, small-radius 单点路径继续叫 `recordCircleUnlock`。 |
| `services/globalFogBuilder.ts:72` | `FogBounds` interface | 名字暗示 "fog 边界"。实际是 "viewport bbox", 仅被 estimateInitialBounds + dead bounds state 用。**建议: 连同 globalFogBuilder.ts 整文件删, 因为 consumer 也是死代码**。 |
| `components/MemoryMap.tsx:67` Props | `fogMode?: FogRenderMode` | Prop 仍存在但 line 106 注释 "fogMode prop kept for API compat; ignored"。**完全可删**, 没有外部调用方需要 API compat (Memory 是 leaf 组件)。 |

---

## 5. 死代码 import

| file:line | content |
|---|---|
| `components/FogLayer.tsx:46` | `Quad` import 自 `fogFloorGeometry` — Quad 类型在 FogLayer 内部 0 处使用 (renderMask 返回的 corners 是 RenderResult 上的字段, FogLayer 把它当 any 解构)。 |
| `components/MemoryMap.tsx:24` | `import { FogBounds } from '../services/globalFogBuilder';` — globalFogBuilder 整文件如果删, 这个 import 自然消失。 |
| `components/FogLayer.tsx:49, 55` | `import type { FogBounds }` + re-export — back-compat 给 MemoryMap, 但 MemoryMap 既然不应该再有 FogBounds (bounds 管道全死), 这个 re-export 也死。 |
| `config/memoryConfig.ts:87-129` 整块 FogConfig | 0 import (grep `FogConfig\.` 显示 0 matches)。 |
| `screens/MemoryScreen.tsx:78, 170, 373` | `fogMode` import + 透传给 MemoryMap | 链条全死: useMemorySettingsStore.fogMode (永远 'legacy') → MemoryScreen → MemoryMap.fogMode (ignored)。 |

---

## v333 核心代码清单 (主 agent 必须搞清的真正 active 部分)

**渲染管道 — L1 (世界级雾)**:
- `FogLayer.tsx:126-134` — `worldRectMinusCircle()` 调用, 生成 world rect + 一个 user-centered hole
- `FogLayer.tsx:247-264` — L1 ShapeSource + FillLayer (`rgba(58,42,24,0.66)`)
- `services/fogFloorGeometry.ts:56-97` — `worldRectMinusCircle()` 实现
- 关键: `FLOOR_RADIUS_M` 必须 = `MASK_PADDING_M`, 都是 3000m

**渲染管道 — L2 (本地 raster mask + halo)**:
- `services/fogMaskRenderer.ts:181-409` — `renderMask()` 整个 Skia 渲染流程
- `FogLayer.tsx:144-189` — `scheduleRender` debounced 500ms
- `FogLayer.tsx:192-212` — cellVersion / userCenter 触发器
- `FogLayer.tsx:267-296` — L2 ImageSource + RasterLayer
- 关键: L1 hole 大小必须 ≥ L2 bbox 半边, 否则 L1 brown 透过 L2 透明区域

**数据通路**:
- `store/useH3VisitedStore.ts:189-217` — `addPointToCells` (GPS 实时点)
- `store/useH3VisitedStore.ts:219-286` — `bulkImport` (chunked, initialReveal + hydrate)
- `store/useH3VisitedStore.ts:299-324` — `bulkImportSync` (flushHikingToMemory 一次性)
- `services/flushHikingToMemory.ts` — Hiking → Memory 合并入口
- `services/h3Persistence.ts` — H3 cells 持久化
- `lib/h3Pure.ts` — Pure JS H3 (v323 替代 emscripten WASM)
- `lib/h3LoadGate.ts` — 持久化 fail-flag 防 crash 回滚

**位置 + UX**:
- `MemoryScreen.tsx:289-296` — `stableCoord` (闪烁修复)
- `MemoryScreen.tsx:106-132` — cross-city detection
- `MemoryScreen.tsx:147-160` — `readLastFix` cold-start hydration
- `services/lastFixCache.ts` — AsyncStorage cache

**用户位置可视化**: `MemoryMap.tsx:298` — `<UserLocation visible={true} />` (这是用户位置真正的视觉锚点, 不是 L1 hole)

---

## 主 agent 反复 FLOOR_RADIUS_M 摇摆的根因

1. **`FLOOR_RADIUS_M` 这个常量名本身就是误导**:
   - "FLOOR" 暗示是独立的位置概念, 像 "用户站立的地板"
   - 实际它只是 "L1 polygon 的 hole 半径", 没有独立语义
   - 主 agent 看到这个名字会自然推断 "这是用户当前位置的视觉表达"

2. **历史注释挖坑** (`FogLayer.tsx:65-84` v333 改写后还在的 + 已被覆盖的 v32x 注释):
   - 早期 v32x 版本中 FLOOR 半径 = 2800m, PADDING = 3000m, **故意不同**
   - 当时设计意图: "FLOOR 给用户位置一个 ~3km 的亮圈, PADDING 给 raster 留出渲染余地"
   - v333 决策推翻了这个设计 (用户当前位置由 UserLocation 蓝点显示, **不需要 FLOOR 圈**)
   - 但代码层只把数值改了, **没改名字, 没删掉 FLOOR 概念**

3. **`fogFloor` 变量名 + `fogFloorGeometry.ts` 文件名** 持续强化 "floor 是一个独立的可见地板" 的心智模型:
   - 实际 fogFloor 是 "world rect minus circle" = 一个不规则的环, 中间是 hole
   - 主 agent 读到 "fogFloor" 会假设它是 "用户站着的那块地", 进而推 "FLOOR_RADIUS 是这块地的半径", 进而觉得 "应该可调 / 应该独立于 PADDING"

4. **`MysteryVisibilityConfig.mysteryMaxDistanceMeters = 5000`** (5km 半径) 在同一模块, 名字相似, 加剧 "Memory 模块到处都有 user-centric radius 概念" 的错觉。

5. **`MemoryFogControl.ts` 的存在 + 假注释** 让主 agent 误以为 fogMode 体系还活着, 进一步加重 "Memory 有多重 fog mode 需要协调" 的错觉。实际上 fogMode 在 v304 就已彻底死掉。

6. **`globalFogBuilder.ts` 描述的 "Zelda-style fog of war"** 是已死方案, 但 docstring 还在洗主 agent 的脑, 让主 agent 以为 polygon-row-run-dissolve 仍是当前架构, 然后试图把 v331 的 raster 方案和 globalFogBuilder 概念调和。

**建议优先清理 (按 ROI 排序)**:
1. 删 `globalFogBuilder.ts` 整文件 + 把 FogBounds (如果还需要) 内联到 MemoryMap (虽然其实 bounds 整套都死了, 也可一起删)
2. 删 `MemoryFogControl.ts` 整文件 + MemoryMap.fogMode prop + useMemorySettingsStore.fogMode/FogMode
3. 删 `tileEncoder.ts` 整文件
4. 删 `memoryConfig.ts` 中 FogConfig 整块
5. 把 FogLayer 里 `FLOOR_RADIUS_M` 合并进 `MASK_PADDING_M`, `fogFloor` 重命名为 `worldFogRing`
6. 删 MemoryMap 里 bounds/currentZoom 整套 plumbing
7. 删 useMemoryStore 里 `applyServerEchoForPush` (非 Aligned) 和 `listVisitedPoints`
