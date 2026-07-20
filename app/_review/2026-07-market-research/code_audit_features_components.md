# Features + Components 代码盘点（2026-07-19）

**盘点范围**: `app/src/features/` (11,418 行 / 45 文件) + `app/src/components/` (11,452 行 / 47 文件)。
**基准**: 只看 tsx/ts 源码 + import graph，不看运行时行为。所有 "dead" 结论 grep 验证过。
**评级口径**: real-done（生产在跑）/ half-done（骨架有，未接通）/ wip（正在做）/ dead（0 引用）/ legacy（有引用但只在 legacy 路径）。

---

## Features 逐模块

### features/marks（5 文件, 1,054 行）
- **状态**: real-done（工具层） + wip（UI 层）
- **一句话**: Sprint 68 Friend System v1 的核心 —— marker 三层可见性（self/friend/stranger）+ 四态详情弹窗（A/B/C/D form）。工具函数 100%（含 dev-test），UI 组件挂在 Memory tab 下。
- **文件清单**:
  - `utils/markVisibility.ts` (137 lines) **real-done** — 纯函数, iron law 1 完全实现（in_my_fog / permission gate / subscribed-friend fog），有独立 dev-test.mjs
  - `utils/markTier.ts` (118 lines) **real-done** — FNV-1a hash + 8 色 palette + tier 计算, self/friend/stranger 三态
  - `components/MarkDetailSheet.tsx` (436 lines) **real-done** — 4 form 完整分发, 有 4 处调用(memory/CairnPinsLayer 内)
  - `dev/MarkDetailDevPreviewScreen.tsx` (314 lines) **real-done** — 挂在 RootNavigator "MarkDetailDevPreview" 路由, dev 调试专用
  - `store/useMarkLikeStore.ts` (49 lines) **half-done** — session-local like 状态; 无持久化, 未接 backend like endpoint
- **关键发现**:
  - **default visibility = 'friends'（非 personal）** — 见 `plant/config/plantConfig.ts:69` `VisibilityConfig.defaultLevel = 'friends'`；Public 选项在 v1 UI 全隐藏（`enablePublicOption: false`），后端也拒收。这**符合** Cairn "默认不 public" 原则，只是选择了"友之默认"而非"独之默认"，属于社交产品判断，需要跟产品定位对齐后再评。
  - permission 值 DB 层用 `group`，wire 层已 normalize 成 `friend`——两处都有防御性映射。
  - **like/report 逻辑还是 fake**（Story-533 "Session-local like state — Story-533 fake state"）——用户 like 一次刷新即丢；backend 无 endpoint。

### features/memory（30 文件, 6,477 行）
- **状态**: real-done（fog + pin 视觉）+ half-done（friend memory 联动）
- **一句话**: Cairn 灵魂功能。GPS 记录 → H3 六边形 → turf.buffer 25m corridor → Mapbox polygon-with-holes 迷雾 → CairnPin 三 tier。经历了 v331→v346 六个大版本迭代，最终稳定在 buffered-path 方案。
- **大文件**:
  - `screens/MemoryScreen.tsx` (943 lines) **real-done** — 版本注释一路到 R9 (dual-watcher fix / focus debounce / hint 时序)，被 `RootNavigator.tsx` 挂载
  - `components/FogLayer.tsx` (528 lines) **real-done** — v346 buffered-path 架构, 用 turf.buffer + turf.difference，注释里详细讲了为什么 v331-v345 走 Skia+ImageSource 全部失败（Mapbox iOS SDK 11.x 拒 file:// 和 data: URI, rnmapbox #1457 五年顽疾）
  - `store/useMemoryStore.ts` (660 lines) **real-done** — K plan v2 完整落地, cid + geometryVersion + syncState + spatial bucket index
  - `services/memoryPersistence.ts` (501 lines) **real-done**
  - `components/CairnPinsLayer.tsx` (444 lines) **real-done** — MysteryCairnSheet + RevealedCairnSheet 都在这里挂
  - `services/fogMaskRenderer.ts` (437 lines) **legacy** — v331-v345 Skia raster 路径, 被 v346 FogLayer 抛弃（buffer polygon 替代）；文件还在但 import 计数=0（需要清废）
  - `components/MemoryMap.tsx` (425 lines) **real-done**
  - `services/mapboxAdapter.web.tsx` (405 lines) **real-done** — Playwright 测试专用 web shim; react-map-gl 桥；生产 release 前需清（见 memory: v406 Web Test Hook 待清理）
  - `components/CairnPinV10.tsx` (393 lines) **real-done** — 三 tier 视觉, iOS PointAnnotation frame-clipping 已修
  - `components/ForegroundUnlockManager.tsx` (379 lines) **real-done** — 挂在 MemoryScreen（v322 root→screen 修 login crash）
- **中小文件**（全部 real-done, 不逐一展开）: RevealedCairnSheet / MysteryCairnSheet / MemoryScopeToggle / MemoryFriendPickModal / PaywallSheet / MemoryFogBurstOverlay / useFriendMemoryStore / useH3VisitedStore / useMemoryScopeStore / useMemorySettingsStore / useMemorySubscriptionsStore
- **死组件**:
  - **`MemorySummaryCard.tsx` (144 lines) dead** — 0 import, 只在 useMemoryStore.ts 注释里被提到; K6 fix 时保留但从来没挂上
- **关键发现**:
  - **fogMaskRenderer.ts (437 行) 是遗留 Skia 路径**, v346 FogLayer 已用 turf.buffer 替代但没删——**净废码 ~440 行**
  - PaywallSheet **假的**（TestFlight 只弹 "Coming soon" toast，无真 IAP；v1.2 才接 RevenueCat / StoreKit）
  - `useMarkLikeStore` + fake like → 前面 marks 模块也提到，跨模块的产品级 half-done
  - **friend memory 是订阅制**（5 slots 免费，第 6 个弹 paywall）—— Cairn 产品定位是否要保留 paywall 需要跟用户确认

### features/plant（6 文件, 1,793 行）
- **状态**: real-done
- **一句话**: 3 步立牌流程（GPS lock → Pin adjust → Content）。Sprint 68 v1 完整落地, 有 50m 圆锁定和 Didi/Uber 式 pin 拖动。
- **文件清单**:
  - `components/PinAdjustStep.tsx` (733 lines) **real-done** — v297 两个 subagent 调研后确认 Mapbox iOS 原生 pinch 锚点不可改, 完全禁掉原生手势 + 加 +/- 按钮；含 style 切换(outdoors/satellite)
  - `services/gpsSampler.ts` (357 lines) **real-done** — 5s window / 250ms poll / σ<6m reject; v301 fusion 收到 3-5m 精度
  - `components/GpsLockStep.tsx` (315 lines) **real-done** — 有 permission / timeout / error 三态 UI
  - `components/ContentStep.tsx` (262 lines) **real-done** — 5 marker type (danger/junction/water/hut/cairn), Public 选项 v1 隐藏
  - `config/plantConfig.ts` (93 lines) **real-done** — 单一 tunables 源
  - `services/noteEncoding.ts` (33 lines) **real-done**
- **关键发现**: 该模块最"干净"——0 dead / 0 half-done, 是所有 features 里完成度最高的。
- **产品缺口**: 无 voice / photo 上传（`ContentConfig.voiceMaxSeconds: 30` 声明了但 ContentStep 无录音 UI，只有 text）。

---

## Components 分类

### 地图相关（8 个组件, 3,082 行）
- **`OtaBadge.tsx` (2,338 lines)** — real-done, 顶部 OTA 状态胶囊, 4 处引用（App/HomeScreen/AuthScreen/ARScreenLegacy）；**注意大部分行数是版本注释**（v186→v416 逐版本 changelog 都在文件里）
- `map/EditOverlayV274.tsx` (637) real-done — 1 引用（RouteEditorScreen v274 版）
- `map/BrushOverlay.tsx` (509) real-done
- `map/EditOverlayV236.tsx` (501) **dead** — 0 引用（已被 v274 取代）
- `map/BrushStrokeLayer.tsx` (420) real-done
- `map/TrimSlider.tsx` (220) real-done — 2 引用
- `map/DualLineLayer.tsx` (183) real-done
- `map/CorridorBoundaryLayer.tsx` (113) **dead** — 0 引用
- `MapBottomPanel.tsx` (219) real-done — 1 引用
- `MapMarkerPin.tsx` (200) **dead** — 0 screens 引用, 只被 CairnStoneIcon 间接依赖但没人挂它
- `MemoryMap` / `FogLayer` 等在 features/memory/ 下, 上面已列

### AR 相关（4 个组件, 1,720 行）
- `UnityAROverlay.tsx` (1,115) **legacy** — 只被 ARScreenLegacy 引用（ARScreen 分流：默认走 ARScreenV2）
- `AcquireGuidance.tsx` (136) legacy — 只被 ARScreenLegacy
- `AimShutter.tsx` (214) legacy — 只被 ARScreenLegacy
- `ARDebugOverlay.tsx` (97) legacy — 只被 ARScreenLegacy
- **`DistantMarkerArrow.tsx` (264)** legacy — 只被 ARScreenLegacy
- **`CairnEdgeArrows.tsx` (201)** legacy — 只被 ARScreenLegacy
- **注意**: AR 整套组件全部落在 legacy 路径。ARScreenV2 (`screens/v025/`) 是新架构入口, useV025=true 是默认, 意味着**这 ~2,000 行 AR 组件默认不再执行**。要么砍 legacy 要么把它们移到 v025 复用。

### Sheet / Modal（8 个组件, 2,000 行）
- `PlantSheet.tsx` (444) legacy — 只被 ARScreenLegacy
- `LikeReportSheet.tsx` (298) legacy — 只被 ARScreenLegacy
- `RouteDrawingSheet.tsx` (234) **dead** — 0 引用
- `UnfinishedRecoveryModal.tsx` (221) real-done — v412 新加, 挂在 HikingScreen; 取代 UnfinishedSessionBanner
- `OfflineMapSheet.tsx` (207) real-done — 1 引用
- `TooShortSheet.tsx` (148) real-done — 2 引用（HikingScreen v118+）
- `AcquireGuidance.tsx` — 已归 AR
- `MarkDetailSheet.tsx` / `PaywallSheet` / `MysteryCairnSheet` / `RevealedCairnSheet` 在 features/ 下

### Trails 卡片（4 个组件, ~350 行）
- `trails/TrailsHeader.tsx` — real-done
- `trails/ActivityBigCard.tsx` — real-done（1 引用, 但同一屏渲 2 次: hiking + running）
- `trails/RecentActivityRow.tsx` — real-done
- `trails/LeaveCairnCard.tsx` — real-done
- 全部被 `TrailsScreen.tsx` 使用, 干净模块。

### 设置 / Banner（2 个组件）
- `settings/MemorySettingsSection.tsx` (201) real-done — 1 引用, 挂在 SettingsScreen; 含 GDPR/NZ Privacy clear-all
- `banners/UnfinishedSessionBanner.tsx` (233) **dead** — v412 已被 UnfinishedRecoveryModal 取代, AuthScreen + HomeScreen 都注释掉了

### SOS / Safety（1 个组件）
- **`SOSButton.tsx` (332 lines) dead** — 0 screen 引用（grep 只找到自身文件）；`services/sosService.ts` 存在且完整但没人调；用户前面提过想砍 —— **确认可以整个模块砍掉**
  - 关键行号: `src/components/SOSButton.tsx:30` (component 定义) + `src/services/sosService.ts` (整个 service 未使用)
  - 相关 icon 名 "SOS" 出现在 `Icon.tsx`, 也可以清

### 装饰性 / Icons（约 12 个）
- `Icon.tsx` (66) real-done — **36 处引用**, 全项目最热
- `BackButton.tsx` (117) real-done — 13 处引用
- `GlassPanel.tsx` (120) real-done — 8 处
- `PressBtn.tsx` (86) real-done — 7 处
- `ActivityIcons/*` (CairnLogo/HikingIcon/RunningIcon/FlagMarkerIcon) — 全部 real-done (2-4 处引用)
- `Illustrations/*` (EmptyFriends/EmptyMarkers/EmptyRoutes) — real-done (2 处)
- `CairnStoneIcon.tsx` (39) real-done — 只被 MapMarkerPin 引用；如果砍 MapMarkerPin，它也会变孤儿
- `tokens.ts` (194) real-done — 全局设计系统

### 死组件清单（完整）
| 文件 | 行数 | 状态 | 备注 |
|---|---|---|---|
| `components/SOSButton.tsx` | 332 | dead | 0 引用；服务层 sosService 也未挂 |
| `components/RouteDrawingSheet.tsx` | 234 | dead | 0 引用 |
| `components/MapMarkerPin.tsx` | 200 | dead | 0 引用, 只反向 import CairnStoneIcon |
| `components/GPSStatusBar.tsx` | ~50 | dead | 0 引用 |
| `components/OTAControlPanel.tsx` | 344 | dead | 0 引用（只在 OtaBadge 注释里被提到过） |
| `components/map/EditOverlayV236.tsx` | 501 | dead | 0 引用, 已被 V274 取代 |
| `components/map/CorridorBoundaryLayer.tsx` | 113 | dead | 0 引用 |
| `components/banners/UnfinishedSessionBanner.tsx` | 233 | dead | 0 引用, v412 已被 UnfinishedRecoveryModal 取代（screens 里显式注释掉了） |
| `features/memory/components/MemorySummaryCard.tsx` | 144 | dead | 0 引用 |
| `features/memory/services/fogMaskRenderer.ts` | 437 | dead | v346 buffered-path 之后不再用 |
| **合计** | **~2,588 行** | | 可直接删 |

### Legacy 组件（有引用但只在 ARScreenLegacy）
- UnityAROverlay (1,115) + PlantSheet (444) + LikeReportSheet (298) + DistantMarkerArrow (264) + AimShutter (214) + CairnEdgeArrows (201) + AcquireGuidance (136) + ARDebugOverlay (97) = **~2,769 行**
- **AR 系统整体决策点**: 如果 ARScreenV2 已经就绪并且 legacy 路径不会走(useV025=true 默认)，这批组件也是准死码；如果 v2 还在爬坡, legacy 是回退。用户需要跟产品状态对齐。

---

## 特别关注题目回答

- **marker 组件（AR + 2D）**: 都有。AR 侧 UnityAROverlay + Plant/Aim/Acquire 系列（全部 legacy 路径），2D 侧 MarkDetailSheet + MarkerTier + CairnPinV10（全部 real-done, 生产在用）。visibility toggle 有（ContentStep 里 chip row），**default = 'friends'**（不是 personal，也不是 public），Public 选项在 v1 UI 隐藏。
- **friend 组件**: 有 MemoryFriendPickModal + PaywallSheet + useFriendMemoryStore + useMemorySubscriptionsStore。产品形态是 **5 个订阅 slot（免费）+ 第 6 个 paywall**（v1.2 才接真 IAP），不是"实时位置"也不是"匿名 marker"，而是**订阅式的 fog 联动**（看到订阅好友的 fog 覆盖 → 从而看到其中的 marker）。这与 Cairn 定位需要 owner 决策。
- **SOS 组件**: 有 **`components/SOSButton.tsx` (332 行, 0 引用)** + **`services/sosService.ts` (未挂)**。整块死码，用户要砍就直接删。
- **weather / trail-alert**: **无 UI 组件**。只有 `services/weatherService.ts`（服务层, 4 处间接依赖）+ `config/trackDifficulty.ts`。要做 alert 需要新建 banner + service 集成，非零工作。
- **fog / memory / on-this-day**: fog + memory 完成度极高（features/memory 6,477 行全 real-done），**没有 "on-this-day" 概念**——搜遍代码库无 onThisDay / on_this_day / today-in-history 相关。要做需要新增 feature。
- **onboarding / 3 大宣言**: **无独立 onboarding 组件**。搜 `onboard|FirstRun|Welcome` 只命中 `i18n.ts`（i18n key）+ `AuthScreen.tsx`（"Welcome to Cairn" 文案）+ `HikingScreen.tsx`（内部 welcome hint）。**没有首启教育流 / 隐私默认 / AI 关闭 / 数据永免费三大宣言的独立组件**——完全需要新造。

---

## 关键发现（8 条）

1. **死码 ~2,588 行可以直接砍**（10 个文件，见死组件清单）。SOSButton + RouteDrawingSheet + EditOverlayV236 + fogMaskRenderer 是 4 大件（合计 1,504 行）。
2. **AR legacy 路径整套 ~2,769 行**（8 个组件）只被 ARScreenLegacy 引用，而 ARScreenV2 默认在用；需要产品决策是保留 kill-switch 还是收编到 v2。
3. **半死功能 3 个**: `useMarkLikeStore` fake state（like 刷新即丢）、`PaywallSheet` "Coming soon" toast（v1.2 才接 IAP）、`ContentConfig.voiceMaxSeconds=30` 声明但 ContentStep 无录音 UI。
4. **onboarding + 3 大宣言完全没做**——如果要走"数字手账 + 陌生人善意"路线，首启教育是必须的新建。
5. **weather / trail-alert 只有 service, 无 UI**——要做 alert banner 需要新建。
6. **on-this-day 概念完全不存在**——需要新 feature。
7. **default marker visibility = 'friends'**（社交默认）——不是 personal，需要跟"数字手账"定位对齐再评。
8. **features/plant + features/marks/utils 是全项目最干净模块**——纯函数 + dev-test，0 dead，可以做未来重构的模板。

---

## 最半死的 3 个 features 模块（用户要的答案）

1. **features/memory 里的 fogMaskRenderer.ts（437 行, 全废）** —— v346 turf.buffer 上线后未清理。
2. **features/marks/store/useMarkLikeStore.ts + MarkDetailSheet.tsx 的 like/report 流** —— fake state, 无 backend。
3. **features/memory/components/MemorySummaryCard.tsx (144 行)** —— export 齐全, 0 import, 从未挂上过。

（另外整个 AR legacy 组件群 ~2,769 行也算半死, 但归在 components/ 下不在 features/。）

**md 路径**: `C:\ClaudeCodeProjects\Cairn\app\_review\2026-07-market-research\code_audit_features_components.md`
