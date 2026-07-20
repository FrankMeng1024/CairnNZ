# Screens 代码盘点（2026-07-19）

盘点范围：`app/src/screens/*.tsx`（17 文件，17,118 行）+ `app/src/navigation/RootNavigator.tsx` + `app/src/features/memory/screens/MemoryScreen.tsx`（RootNavigator 也引用）+ `app/App.tsx`。

## 总览

- Screens 文件数：**17**（screens/ 目录）+ 1（features/memory/screens/MemoryScreen.tsx）= **18** 参与本次盘点。
- **real-done**：11（HomeScreen、HikingScreen、RunningScreen、AuthScreen、SettingsScreen、DebugScreen、PlantScreen、MarkerDetailScreen、MapHistoryScreen、MemoryScreen、RouteEditorScreen）
- **half-done**：3（MapScreen、RoutesScreen、FriendsScreen — 说明见逐条）
- **ui-only**：0
- **zombie**：4（TrailsScreen、ARScreen、ARScreenLegacy、SpikeMapboxJunctionScreen — RootNavigator 完全未引用）
- **wip**：0

**关键发现（对齐 Cairn 灵魂）**：
1. **没有 SOS / Emergency Contacts screen**。`components/SOSButton.tsx` + `services/sosService.ts` 组件存在但**在任何 screen 里都没被 import 或渲染**。HikingScreen.tsx:334, 1805, 1807 提到 "SOS" 只是**注释**说明 bottom overlay 布局（历史遗留），没有实际 SOSButton JSX。SettingsScreen.tsx:565 有 "Emergency Contacts" 行，`onPress` 打的是 `Alert.alert('Emergency Contacts', 'Configure in next update')` — **stub**。→ **符合"应该砍"的方向**，代码已是虚设，需一次性删除 SOSButton + sosService + Settings 那行。
2. **没有实时看好友位置的 screen**。SettingsScreen 有 `locationShare` toggle（line 423-424）但没有找到消费该字段做实时定位广播的代码路径。FriendsScreen 只做加好友 / 接受请求 / share marker toggle（`toggleShareMarkers`，line 431），没有"看好友在哪"的入口。→ **符合陌生人善意原则**。
3. **匿名标记 marker screen = PlantScreen + MarkerDetailScreen**，完成度高（real-done）。PlantScreen 是 3 步 GPS-lock → pin-adjust → content 的完整流程（310 行，无 mock），MarkerDetailScreen 支持 owner 编辑 + delete + publicSnapshot 分歧提示（636 行）。**public option**（"Anyone"）已有 UI（MarkerDetailScreen.tsx:330，`VisibilityConfig.enablePublicOption` gate），可实现陌生人可见。
4. **手账 / 记忆时刻 = MemoryScreen（features/memory/）**。有 fog（`useMemoryStore.points` + `FogLayer` turf.buffer），有 `MemoryScopeToggle`（自己 vs 好友），有 `useFriendMemoryStore`（订阅好友 memory 并合并），有 `PaywallSheet`。**但没有找到 on-this-day / anniversary / multi-year 时间维度回看** — Grep `on-this-day|OnThisDay|anniversary|yearsAgo` 返回 0 命中。这是产品灵魂"多年后回看"的关键 gap。
5. **没有 weather / river / volcano / 高山警告 screen**。`services/weatherService.ts` 存在（open-meteo API，缓存 15min，`fetchWeather` + `getWeatherBroadcastText` + `hasSignificantChange`）**但没有任何 screen import 它**（Grep 命中 0）。tokens.ts 里有 "MetService 严重程度色板"（severityCaution 黄 / severityDanger 红）但只在 DualLineLayer 里给路线颜色用，没有天气数据源接入。→ **需要新做**。

---

## 逐文件详情

### 1. RootNavigator.tsx (131 lines) — navigation/
- **状态**：real-done
- **一句话**：Stack navigator，isLoggedIn 分 Auth 与 14 个业务 screen；无 bottom tabs（v0.2.5 起）。
- **关键路径**：
  - `navigationRef` (line 23) — Platform.OS==='web' 才创建，暴露给 Playwright web hooks
  - `RootStackParamList` (line 50) — 定义所有 route + params
  - `RootNavigator` (line 71) — 主组件；`isLoggedIn` fork
- **依赖**：@react-navigation/native-stack, useAppStore, bootDiagnostics
- **可疑**：无。清晰。
- **注意**：14 screens 中未包含 `TrailsScreen` / `ARScreen` / `ARScreenLegacy` / `SpikeMapboxJunctionScreen` — 这 4 个是 zombie。

### 2. HomeScreen.tsx (635 lines)
- **状态**：real-done
- **一句话**：主入口 dashboard——logo + greeting + stats chips + RecentRow（活动中／最近 24h）+ 3 张活动卡（Hiking／Running／Leave a Cairn）+ 底部 4 个 ToolBtn（Trails／Friends／Memory／Settings）。
- **关键路径**：
  - `RecentRow` (line 52) — 三态：tracking / 最近 24h 内 / 隐藏；v413 加了 zombie session filter（distance>0 || duration>0）
  - `ActivityCard` (line 151) — 3 张大卡（Hiking/Running/Plant）
  - `HomeScreen` (line 221) — 主组件；boot beacon 密集埋点（home_screen_render_start, home_before_jsx, home_alive_500/2000/5000ms）
  - v324 GPS permission unified request useEffect (line 329)
  - v354 insetsReady gate (line 261) — OTA reload 首次登陆 tab-jump 修复
- **依赖**：useAppStore, useSessionStore, useMarkerStore, useTrackingStore, bootDiagnostics
- **可疑**：`{__DEV__ && <MarkDetailDevPreview>}` (line 490) — dev-only，无问题。v412 pendingBanner 未同步 hike 数量条 (line 405) — 有真实数据源。整体干净。

### 3. HikingScreen.tsx (2528 lines) — 最大文件
- **状态**：real-done（但体积膨胀）
- **一句话**：Hiking 追踪主 screen——地图 + GPS chip + compass + FAB flag picker + tracking stats + plant flag sheet + marker detail sheet + stop summary + too-short prompt + unfinished recovery modal（v412）。
- **关键路径**：
  - `MarkerPin` (line 64)
  - `CompassNeedle` (line 120) — 双色红／灰指针
  - `HikingMap` (line 156) — Mapbox MapView + trackpoints + UserLocation + LineLayer
  - `FlagPlantSheet` (line 495) — plant 4 类型 flag
  - `MarkerDetailSheet` (line 624) — 本文件内定义（vs MarkerDetailScreen 是不同的独立 screen）
  - `StopSummarySheet` (line 868)
  - `HikingScreen` (line 1098) — 主组件
- **依赖**：useTrackingStore（GPS）, useMarkerStore, useRouteStore, useAppStore, expo-location, expo-keep-awake, mapbox conditional import, previewMemoryGain, UnfinishedRecoveryModal
- **可疑**：
  - line 334, 1805, 1807：注释里说 "SOS 按钮在中间" 但实际 JSX 里没有 SOS 组件——**注释与实现不同步**，SOS 已废弃但注释还在。
  - 文件 2528 行，需要拆分（FlagPlantSheet / StopSummarySheet 各占 100+ 行内联组件，可抽 components/）。
  - v412 UnfinishedRecoveryModal 已接入 (line 43) — 真实数据流。

### 4. RunningScreen.tsx (970 lines)
- **状态**：real-done
- **一句话**：Running 锁屏——3 态（pre / running-LOCKED / running-UNLOCKED）；大字号计时 + 副 stats + 语音引导 + route 选择。
- **关键路径**：
  - `PulsingDot` (line 70)
  - `StatItem` (line 86)
  - `RunningScreen` (line 96)
- **依赖**：useTrackingStore, useRouteStore, useMarkerStore, expo-haptics, expo-keep-awake, mapbox conditional
- **可疑**：无明显 mock。line 40-61 Mapbox conditional import 是全项目通用 pattern。

### 5. AuthScreen.tsx (1341 lines)
- **状态**：real-done
- **一句话**：Sign In / Register / Google OAuth / verify code / privacy policy 全套；开屏 3 石头动画（`AnimatedCairn`）+ 波浪旗帜物理动画。
- **关键路径**：
  - `TrailPath` (line 50), `calcFlagPaths` (line 96), `AnimatedCairn` (line 136) — SVG 动画
  - `PasswordInput` (line 315), `FieldInput` (line 352)
  - `AuthScreen` (line 432) — 主组件
- **依赖**：authService（login/register/loginWithGoogle/verifyCode/resendCode）, expo-auth-session/providers/google, react-native-svg
- **可疑**：无 mock。真 Google OAuth 已接入。

### 6. SettingsScreen.tsx (1063 lines)
- **状态**：real-done（但含一处 stub）
- **一句话**：Explorer/Navigator UI mode 双卡；toggle 组（shareAfterAdd/nightMode/broadcastEnabled/locationShare/telemetry/debug）；Backend URL/API Key 编辑；Emergency Contacts；Debug 5-tap 入口；logout。
- **关键路径**：
  - `ModeCard` (line 87)
  - `ToggleRow` (line 116)
  - `SettingsScreen` (line 172)
- **依赖**：useAppStore, useSettingsStore, authService.logout, MemorySettingsSection, debugUpload, tokenStore
- **可疑**：
  - **line 565-566：Emergency Contacts → `Alert.alert('Configure in next update')` = STUB**。产品灵魂讨论要砍 SOS，这行代码应删。
  - line 423-424 `locationShare` toggle 存在但代码里没找到消费该字段做定位广播的逻辑（Grep 全项目 0 命中活动路径）— dead toggle。
  - line 456-458 `broadcastEnabled` 同上，`pending={broadcastEnabled !== true}` 显示 pending badge 但无实际网络广播实现。

### 7. DebugScreen.tsx (468 lines)
- **状态**：real-done
- **一句话**：调试面板——session 列表（re-upload/export/delete）+ telemetry toggle + backend URL/API Key + FAB visibility；5-tap unlock。
- **关键路径**：
  - `DebugScreen` (line 28)
  - `refresh` (line 43) — 每 5s 拉 debugLogger.listSessions()
  - `handleUpload/Export/Delete/RetryAll` (line 64-149)
- **依赖**：debugLogger, telemetryUploader, expo-sharing, useSettingsStore
- **可疑**：无。开发者工具，功能完整。

### 8. PlantScreen.tsx (310 lines)
- **状态**：real-done
- **一句话**：GPS-based 匿名标记流程——3 步：GpsLockStep（5s 采样）→ PinAdjustStep（Mapbox 卫星图拖钉，50m 限制）→ ContentStep（type/title/text/voice/visibility）→ commit（addMarker + nav.replace('MarkerDetail')）。
- **关键路径**：
  - `PlantScreen` (line 105) — 主组件
  - `commit` (line 159) — addMarker + AsyncStorage draft 保存/清空
  - `onContentSubmit` (line 238)
- **依赖**：useMarkerStore.addMarker, useMemoryStore（v351 已解绑 recordCircleUnlock）, useAppStore, GpsLockStep/PinAdjustStep/ContentStep（features/plant/components/）, storage
- **可疑**：
  - line 195 已注释掉的 `recordCircleUnlock` — v351 主动移除（"planting a cairn no longer unlocks fog"），保留注释解释历史，OK。
  - Title/body 用 U+001E RS 字符编码到单一 `note` 字段（line 15-25 注释）——**hack 但已文档化**，v0.2.7 计划迁移到 schema。这算 tech debt 但不是 bug。

### 9. MarkerDetailScreen.tsx (636 lines)
- **状态**：real-done
- **一句话**：Marker 详情——顶部 Mapbox 地图 hero + CairnPin 医章式 pin（v381 v10 medallion）+ 内容面板（type/vis badge/title/body/date/coord）+ owner 独占的 Edit（type/title/body/permission 可改，lat/lng 锁）+ Delete + publicSnapshot 分歧提示。
- **关键路径**：
  - `MarkerDetailScreen` (line 90)
  - `enterEdit` / `saveEdit` / `handleDelete` (line 112-164)
  - `isOwner` (line 191) — v416 fix：只信 authorId === userId 或 'local'
- **依赖**：useMarkerStore, useAppStore, CairnPin（features/memory/components/CairnPinsLayer）, splitTitleBody/encodeTitleBody, mapbox conditional
- **可疑**：无 mock。v416 owner 判定刚修复过（backend user_id 缺失 fallback 'server' 导致的假 owner 权限）。

### 10. MapScreen.tsx (1387 lines)
- **状态**：half-done
- **一句话**：全屏 Mapbox 地图 + PressableMarker + 底部 MapBottomPanel + FriendStore filter + 创建/编辑 marker sheet。功能重叠 HikingScreen + MarkerDetailScreen。
- **关键路径**：
  - `PressableMarker` (line 76)
  - `RealMap` (line 97) — Mapbox rendering
  - `CreateMarkerSheet` (line 203), `EditMarkerSheet` (line 350)
  - `MarkerDetailSheet` (line 539) — 又一个内联版本
  - `MapScreen` (line 641)
- **依赖**：useMarkerStore, useFriendStore, useTrackingStore, useMemoryStore, useMemorySubscriptionsStore, MarkDetailSheet（features/marks/），MapBottomPanel, OfflineMapSheet
- **可疑**：
  - **line 36**：`import { MARKER_META, MarkerType } from '../data/mockData'` — 从 `mockData` 引入 MARKER_META；查代码 MARKER_META 是**常量 metadata**（icon/color/bg per type），不是 mock 数据，命名误导。但**目录名 `data/mockData` 本身应该改**——上线前重命名为 `data/markerConfig` 或类似。
  - **功能重叠**：Create/Edit/Detail 三个 sheet 在本文件（1387 行）+ MarkerDetailScreen（636 行）+ HikingScreen 内 MarkerDetailSheet + PlantScreen 的 flow —— 同一功能 4 个入口／实现分叉。上线前要合流。
  - `RootNavigator` 有 `Map` route，但入口不明——HomeScreen 的 4 个 ToolBtn 没指向 Map，Trails/Friends/Memory/Settings。Map 可能只是遗留 route（旧 v0.2.4 时代主屏）。**建议：检查 nav.navigate('Map') 被谁调用；若无 → 也是 zombie**。

### 11. MapHistoryScreen.tsx (1667 lines)
- **状态**：real-done
- **一句话**：单个 session 详情——顶部 Mapbox 地图 + 轨迹 polyline + marker pins + 底部滚动面板（stats/pace/elevation）；session 列表 fallback。
- **关键路径**：
  - `NativeTrackMap` (line 91)
  - `TrackPolyline` (line 315) — web fallback SVG
  - `SessionCard` (line 404)
  - `FlagDetailSheet` (line 643)
  - `MapHistoryScreen` (line 717)
- **依赖**：useSessionStore, useTrackingStore, useMarkerStore, sessionService.fetchSessionDetail, Kalman filter (utils/geo), simplifyPolyline
- **可疑**：MARKER_META 引入自 mockData（同 MapScreen）。功能扎实。

### 12. RoutesScreen.tsx (1483 lines)
- **状态**：half-done
- **一句话**：3-tab（Activities/Routes/Flags）+ Mine/Friends scope sub-tab；每 tab 独立 FilterSortBar + FlatList + 编辑 sheet。
- **关键路径**：
  - `SegmentControl` (line 67), `ScopeTabBar` (line 91)
  - `RoutesTab` (line 531), `ActivitiesTab` (line 689), `FlagsTab` (line 975)
  - `RouteSheet` (line 304), `ActivitySheet` (line 428), `FlagEditSheet` (line 785)
  - `RoutesScreen` (line 1174)
- **依赖**：useRouteStore, useSessionStore, useMarkerStore, useTrackingStore, exportService
- **可疑**：
  - **重复代码**：FLAG_TYPES 常量在本文件 line 59-64 又定义一次（HikingScreen/MapScreen 各定义一次，共 3 处）。上线前应集中到 config/markerTypes.ts。
  - FlagEditSheet 与 MarkerDetailScreen.enterEdit 功能重叠（同一 marker 两条编辑路径）。
  - 1483 行文件，3 个大 tab 应拆分为独立文件。

### 13. RouteEditorScreen.tsx (1147 lines)
- **状态**：real-done
- **一句话**：Route 编辑器——view / edit 一条已存路线；new-from-activity 保存流程；via-point 拖拽 + trim slider + brush stroke overlay + snap-to-road 匹配；v236 从 v229 的 1900 行完整重写。
- **关键路径**：
  - `RouteEditorScreen` (line 75)
  - 引用 EditOverlayV274, DualLineLayer, BrushOverlay, BrushStrokeLayer（components/map/）
  - snapToRoadAndTrim (services/routeMatcher)
  - useRouteEditStore（大量 via/trim/brush state）
- **依赖**：useRouteStore, useRouteEditStore, useSessionStore, useTrackingStore, snapToRoadAndTrim, smoothTrackPoints
- **可疑**：`SAVE_FRACTION_FLAG = 'editModeEnabled'`  (line 73) — feature flag 名与语义不匹配（"save fraction" vs "edit mode"），但已工作。

### 14. FriendsScreen.tsx (881 lines)
- **状态**：half-done
- **一句话**：好友管理——空态插图 + Add Friend sheet（email 验证 + loading/success）+ 好友卡片列表 + share-marker toggle + 收到的 friend request accept/reject。
- **关键路径**：
  - `FriendCard` (line 78)
  - `AddFriendSheet` (line 142) — Animated slide + 键盘避让
  - `EmptyState` (line 298)
  - `FriendsScreen` (line 313)
- **依赖**：useFriendStore.friends/sendFriendRequest/fetchFriendRequests/acceptFriendRequestAPI/rejectFriendRequestAPI/toggleShareMarkers
- **可疑**：
  - **line 84**：`hasStatus = friend.online || (friend.lastSeen && friend.lastSeen !== 'N/A')` — 后端**没有 online / lastSeen 数据**（line 328-331 显式写 `online: false, lastSeen: 'N/A'`），UI 上永远不会显示 online 状态。这块 UI 是死代码，除非后端未来加接口。
  - **line 331**：`sharedMarkers: 0` — hard-coded 0，backend 没返回共享 marker 数，`friend.sharedMarkers > 0` 条件永远 false，line 113-119 的 flag chip 是死路径。
  - 状态：**功能骨架正确、后端数据缺项**——归 half-done。

### 15. MemoryScreen.tsx (~1000 行估算，实际 44502 bytes ≈ 1300 行)
- **状态**：real-done
- **一句话**：Memory tab——Mapbox 地图 + fog buffer + cairn pins（自己／好友，medallion tier）+ MemoryScopeToggle（自己 vs 好友订阅）+ FriendPickModal + PaywallSheet + ForegroundUnlockManager（v322 从 App root 挪来懒挂载）。
- **关键路径**：
  - `MemoryScreen`（主组件）
  - `_lastKnownCoord` module-scope cache (line 74) — v333 flicker fix
  - `_memoryScreenRenderCount` (line 79) — 诊断计数
- **依赖**：useMemoryStore, useMemorySettingsStore, useMemoryScopeStore, useMemorySubscriptionsStore, useFriendMemoryStore, MemoryMap, ForegroundUnlockManager, PaywallSheet
- **可疑**：
  - 版本注释 v302-v357 密集埋点（`markBootPhase` 类），说明这个 screen 是 iOS jetsam / crash 高发区，需大量诊断代码支撑。
  - **没有 on-this-day / anniversary 时间维度**——Grep 全 features/memory/ 0 命中。这是产品灵魂"多年后回看"的直接 gap。
  - `PaywallSheet` (line 35) — 存在但业务上是否真的付费未验证。

### 16. TrailsScreen.tsx (58 lines) — ZOMBIE
- **状态**：**zombie**
- **一句话**：设计文档中的 "Trails" bottom tab（v0.2.6 Variant D 两大卡布局）——TrailsHeader + RecentActivityRow + 两张 ActivityBigCard（Hiking/Running）+ LeaveCairnCard。
- **关键路径**：`TrailsScreen` (line 37)
- **依赖**：components/trails/（4 sub-components）
- **可疑**：
  - **RootNavigator 不引用**（Grep 全项目只 self-match）。v0.2.6.4 注释里说"restored v0.2.5 model after user feedback. The brief stint with BottomTabNavigator was a misread"——**这个 screen 是 BottomTabNavigator 尝试被回退后遗留的死代码**。
  - HomeScreen 已实现同样功能（3 张 activity card + Leave a Cairn），此文件重复。
  - **应删除**：TrailsScreen.tsx + components/trails/ 目录整个。

### 17. ARScreen.tsx (23 lines) — ZOMBIE
- **状态**：**zombie**
- **一句话**：v0.2.5 wrapper 路由到 ARScreenV2 或 ARScreenLegacy（根据 useV025 feature flag）。
- **关键路径**：`ARScreen` (line 17) — feature-flag fork
- **依赖**：ARScreenLegacy, ARScreenV2, useV025Enabled
- **可疑**：
  - **RootNavigator 不引用 ARScreen**（v0.2.6.4 起 AR 被 Memory 替代），ARScreen 只被 App.tsx 注释 line 205-213 引用（feature flag 初始化用它历史）。
  - **应删除**：ARScreen.tsx + ARScreenLegacy.tsx + screens/v025/ARScreenV2.tsx 三个文件 + 相关 unityCairnSpawn / UnityAROverlay 组件（3000+ 行代码）。这是最大的 zombie。

### 18. ARScreenLegacy.tsx (1945 lines) — ZOMBIE
- **状态**：**zombie**
- **一句话**：完整的 AR 界面——expo-camera + Unity AR overlay（UnityAROverlay imperative handle）+ 距离 arrow + edge arrows + acquire guidance + plant sheet + aim shutter + like/report sheet。真正的 AR 主力实现。
- **关键路径**：
  - `ARScreenLegacy` (line 206) — 主组件
  - 大量 v0.2.4 Phase 3 breadcrumb / crashLogger install
- **依赖**：UnityAROverlay, CairnEdgeArrows, DistantMarkerArrow, AcquireGuidance, AimShutter, PlantSheet, useMarkerStore, useTrackingStore, useArOriginStore, unityCairnSpawn, trackStateDebounce
- **可疑**：
  - RootNavigator 不引用；ARScreen wrapper 也不被 Navigator 引用 → 整条链死。
  - **1945 行代码 + Unity native bridge + expo-camera 全部是 dead weight**。上线前删除可减少 iOS bundle 大小 / crash surface。

### 19. SpikeMapboxJunctionScreen.tsx (576 lines) — ZOMBIE
- **状态**：**zombie**（文件自己写明 "NOT a product feature. NOT for shipping"）
- **一句话**：Mini-Spike B——测试 Mapbox vector tile 离线 junction 提取 + GCJ-02 中国坐标偏移 + RN bridge 大数据 payload 性能。**Decision-gate spike，不是产品**。
- **关键路径**：
  - `haversineM` (line 69) — 内联复制
  - `SpikeMapboxJunctionScreen` (line 152)
- **依赖**：@rnmapbox/maps.offlineManager, expo-location, InteractionManager
- **可疑**：
  - 文件顶部注释明确说 "NOT for shipping"。
  - RootNavigator 未引用。
  - **应移到 `_spikes/` 目录或删除**。上线前留在 src/screens/ 是配色错误。

---

## 上线前清理清单（按优先级）

**P0 - 立即删（产品灵魂对齐）**：
1. `screens/ARScreen.tsx` + `ARScreenLegacy.tsx` + `screens/v025/ARScreenV2.tsx`（3000+ 行）
2. `components/UnityAROverlay.tsx` + `services/unityCairnSpawn.ts` + Unity native bridge
3. `components/SOSButton.tsx` + `services/sosService.ts` + SettingsScreen line 558-566 (Emergency Contacts stub)
4. `screens/TrailsScreen.tsx` + `components/trails/`（BottomTab 时代死代码）
5. `screens/SpikeMapboxJunctionScreen.tsx`（Spike，非产品）

**P1 - 数据源接入或删（half-done 修复）**：
6. FriendsScreen 死路径：`online / lastSeen / sharedMarkers` 后端无字段 → 要么后端加字段，要么 UI 删这些字段（line 84/113-119/328-333）
7. SettingsScreen `locationShare` / `broadcastEnabled` toggle 无实际业务代码消费 → 删或接入
8. MapScreen 与 MarkerDetailScreen/HikingScreen 三处 MarkerDetailSheet 重复实现 → 合流
9. FLAG_TYPES 常量在 3 处重复定义（HikingScreen/MapScreen/RoutesScreen）→ 合到 config/markerTypes.ts
10. `data/mockData.ts` 重命名 → `data/markerConfig.ts`（内容不是 mock 是 metadata，命名误导）

**P2 - 新做（产品灵魂 gap）**：
11. **天气／河流／火山／高山警告 screen**：weatherService 已存在但零 screen 引用，需要在 Hiking/Home/Trails 增加天气面板；MetService 严重色板已存在（tokens.ts:37-44）。
12. **on-this-day / 多年后回看**：MemoryScreen 无时间维度回看功能，Grep 全 features/memory/ 0 命中。这是"数字手账"灵魂的核心缺失。

---

## Screen ↔ Store 依赖速查表

| Screen | 主要 Store |
|---|---|
| HomeScreen | useAppStore, useSessionStore, useMarkerStore, useTrackingStore |
| HikingScreen | useTrackingStore, useMarkerStore, useRouteStore, useAppStore |
| RunningScreen | useTrackingStore, useRouteStore, useMarkerStore |
| PlantScreen | useMarkerStore, useMemoryStore（v351 已解绑）, useAppStore |
| MarkerDetailScreen | useMarkerStore, useAppStore |
| MapScreen | useMarkerStore, useFriendStore, useTrackingStore, useMemoryStore, useMemorySubscriptionsStore |
| MapHistoryScreen | useSessionStore, useTrackingStore, useMarkerStore |
| RoutesScreen | useRouteStore, useSessionStore, useMarkerStore, useTrackingStore |
| RouteEditorScreen | useRouteStore, useRouteEditStore, useSessionStore, useTrackingStore |
| FriendsScreen | useFriendStore |
| SettingsScreen | useAppStore, useSettingsStore |
| MemoryScreen | useMemoryStore, useMemorySettingsStore, useMemoryScopeStore, useMemorySubscriptionsStore, useFriendMemoryStore |
| AuthScreen | useAppStore, authService |
| DebugScreen | useSettingsStore, debugLogger, telemetryUploader |
| (zombie) ARScreenLegacy | useMarkerStore, useTrackingStore, useArOriginStore |
| (zombie) TrailsScreen | (无 store，只是 sub-components 组合) |
| (zombie) SpikeMapbox... | (无 store) |
