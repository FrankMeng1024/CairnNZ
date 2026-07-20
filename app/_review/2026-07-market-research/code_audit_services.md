# Services + Store 代码盘点（2026-07-19）

**审计范围**：`app/src/services/` (54 个 .ts, ~14.4K 行) + `app/src/store/` (11 个 .ts, ~8K 行)
**方法**：grep 全量 import 引用 + 抽样阅读每个文件的头部 doc-comment / 首个 export
**目标**：识别死码、mock、半死代码、缺失服务，为砍功能提供 evidence

---

## 总览

| 项 | 数量 |
|---|---|
| Services 文件（不含 __tests__） | 54 |
| Services 总行数 | 14,435 |
| Store slices 文件（不含 v025 test） | 12 |
| Store 总行数 | 6,974 |
| **real-done** | 38 |
| **half-done** | 6 |
| **dead**（无引用或注释标记死） | 8 |
| **wip / behind-flag** | 12（v025 stack）|

**关键结论**：
1. **SOS 全套已完全孤立**（`sosService.ts` 247 行 + `SOSButton.tsx` 333 行 — 没有任何 screen import SOSButton）
2. **`weatherService.ts` 195 行完全没有 call site**（Open-Meteo API 完成度 100%，但产品从未接入）
3. **`v025/` 全套 (8 services + 2 stores，~1000 行) 在 kill-switch OFF 下永远不跑** — `featureFlagsClient.useV025Enabled()` 默认 `false`
4. **friend 位置分享不存在** — `useFriendStore` 只处理 marker 分享，`grep friendLocation | liveLocation | realtimeLocation` 全无结果（好消息，不用删）
5. **route/edit stack 极重**（`useRouteEditStore.ts` **2891 行** 单文件 + 支持 services ~1300 行） — 未来砍功能要谨慎（真在用）

---

## 关键服务分类

### 认证 / API 层（core，全部 real-done）

| 文件 | 状态 | 调用方 | 备注 |
|---|---|---|---|
| `apiService.ts` (104 行) | real-done | 20+ 处 authenticatedFetch | 401 IRON RULE（Sprint 72 STORY-00550） |
| `authService.ts` (187 行) | real-done | AuthScreen, useAppStore, ARScreenLegacy | register/verify/login/getMe/logout，2-step 验证码 |
| `tokenStore.ts` (55 行) | real-done | apiService, authService | AsyncStorage token |

### 地图 / 定位 / 轨迹（core，real-done）

| 文件 | 状态 | 调用方 | 备注 |
|---|---|---|---|
| `sessionService.ts` (274 行) | real-done | useTrackingStore, syncDaemon, MapHistoryScreen | startSession/appendPoints/finalizeSession/saveHikeAtomic/deleteRemoteSession |
| `sessionRecorder.ts` (242 行) | real-done | useTrackingStore | 本地 session 录制器 |
| `hikeTrackWriter.ts` (442 行) | real-done | useTrackingStore, backgroundLocationTask | v409 JSONL 磁盘写入 |
| `hikeTracksCache.ts` (272 行) | real-done | useTrackingStore | size cap + TTL 清理 |
| `backgroundLocationTask.ts` (210 行) | real-done | HikingScreen, useTrackingStore | TaskManager 后台 GPS |
| `pendingSyncStore.ts` (202 行) | real-done | useTrackingStore, syncDaemon | 已 Save 未同步 hike 队列 |
| `syncDaemon.ts` (118 行) | real-done | useAppStore hydrate, useTrackingStore | v412 后台自动上传 pending |
| `offlineQueue.ts` (302 行) | real-done | useMarkerStore, useTrackingStore | 通用离线操作队列 |
| `offlineMapService.ts` (190 行) | real-done | OfflineMapSheet, MapScreen | Mapbox offlineManager 包装，Expo Go 降级 |
| `networkMonitor.ts` (200 行) | real-done | apiService, useTrackingStore, sosService | expo-network 监听 |
| `trackStateDebounce.ts` (139 行) | real-done | ARScreenLegacy | AR 追踪状态去抖 |
| `autoPauseMonitor.ts` (176 行) | real-done | useTrackingStore (dynamic import) | Sprint 72 空闲自动结束 |
| `batteryMonitor.ts` (195 行) | real-done | useTrackingStore, sessionRecorder | expo-battery 采样（有 `battery_sample` 事件流，产品已具备 Q3.4 硬门槛测量能力） |
| `lowPowerModeWarn.ts` (45 行) | real-done | useTrackingStore (dynamic import) | Sprint 72 iOS LPM 提醒（24h dedupe） |

### Route / 编辑（massive，都在用）

| 文件 | 状态 | 调用方 | 备注 |
|---|---|---|---|
| `routeService.ts` (133 行) | real-done | useRouteStore | 后端 CRUD |
| `routeMatcher.ts` (177 行) | real-done | RouteEditorScreen | Mapbox map-matching + off-road trim |
| `LocalRouteExtras.ts` (330 行) | real-done | useRouteEditStore, LegacyRouteMigrator | originalPoints + segments AsyncStorage |
| `LegacyRouteMigrator.ts` (204 行) | real-done | useRouteEditStore | 惰性迁移 (v3.1 §0) |
| `EditSessionPersistence.ts` (410 行) | real-done | useRouteEditStore | iOS kill 恢复 (STORY-00523) |
| `editDiagSender.ts` (221 行) | real-done | useRouteEditStore, BrushOverlay | edit-diag 上报 |
| `routing/snapTrack.ts` (636 行) | real-done | useTrackingStore | v6.4 GPS→路网 snap 主管线 |
| `routing/editAnalytics.ts` (142 行) | real-done | useRouteEditStore | edit 事件分析 |
| `routing/corridor/CorridorQuery.ts` (85 行) | real-done | routing tests, brush 逻辑 | corridor 查询 |
| `routing/corridor/PointCloudIndex.ts` (121 行) | real-done | CorridorQuery | 点索引 |
| `routing/corridor/PolylineSampler.ts` (160 行) | real-done | brush/bcef, CorridorQuery | polyline 采样 |
| `routing/mapmatch/MapMatchingClient.ts` (295 行) | real-done | RouteEditorScreen edit overlay, runMapMatching | Mapbox Map Matching REST |
| `routing/mapmatch/runMapMatching.ts` (323 行) | real-done | RouteEditorScreen, useRouteEditStore | 编排 |
| `routing/mapmatch/coordSampling.ts` (438 行) | real-done | runMapMatching | 采样 & 分块 |
| `routing/mapmatch/types.ts` (78 行) | real-done | — | types-only |

### Marker / Annotation / Memory（灵魂词，real-done）

| 文件 | 状态 | 调用方 | 备注 |
|---|---|---|---|
| `memorySync.ts` (483 行) | real-done | useAppStore, useTrackingStore, FGUM | v0.2.6.3 O-round push/pull |
| `contentFilter.ts` (105 行) | real-done | ARScreenLegacy, geo tests | Sprint 51 关键字黑名单（未来升 AI moderation TODO） |

  **注**：marker visibility 默认审查 — `useMarkerStore.ts` `MarkerPermission = 'personal' \| 'group' \| 'public'`，type 允许三种但**没有默认值 hard-code personal**（用户 UI 选择时可能默认 public，需交叉参考 `PlantScreen.tsx`）

### AR / Unity（分裂：Legacy real / V2 behind flag）

| 文件 | 状态 | 调用方 | 备注 |
|---|---|---|---|
| `unityBridge.ts` (306 行) | real-done | UnityAROverlay, ARScreenLegacy | Legacy AR 消息通道 |
| `unityCairnSpawn.ts` (312 行) | real-done | ARScreenLegacy, UnityAROverlay, useMarkerStore | Legacy spawn 逻辑 |
| `unityGlobals.ts` (88 行) | real-done | unityBridge, a8Migration | 全局 Unity 状态 |
| `arAimDetector.ts` (103 行) | real-done | useAimedMarker hook | AR 瞄准检测 |
| `arOverlayLifecycle.ts` (106 行) | real-done | UnityAROverlay | overlay 生命周期 |
| `originPropagation.ts` (95 行) | real-done | UnityAROverlay (via jest 测试对齐) | v0.2.4 R2.3 projection 帮助函数 |
| `a8Migration.ts` (144 行) | real-done | useAppStore | v0.2.2→v0.2.3 schema migration |
| `v025/cairnBridgeV2.ts` (67 行) | **wip / flag-off** | ARScreenV2 only | V2 bridge |
| `v025/cairnSpawnV2.ts` (180 行) | **wip / flag-off** | ARScreenV2 only | V2 spawn |
| `v025/featureFlagsClient.ts` (85 行) | real-done | ARScreen (shim) | **fail-closed default `false`** → 整个 v025 stack 永远不跑 |
| `v025/geoMath.ts` (95 行) | wip / flag-off | v025 tests | ENU meters math |
| `v025/MessageTypes.ts` (128 行) | wip / flag-off | v025 internals | types-only |
| `v025/telemetryBatcher.ts` (99 行) | wip / flag-off | telemetrySingleton | batched debug events |
| `v025/telemetrySingleton.ts` (39 行) | wip / flag-off | ARScreenV2 only | 但 `initTelemetrySingleton()` 只在 App.tsx 中调用 — **需 grep App.tsx 才能确认是否 boot 时启用** |
| `v025/worldMapPreloader.ts` (88 行) | wip / flag-off | v025 only | ARWorldMap preload |

### Voice / TTS

| 文件 | 状态 | 调用方 | 备注 |
|---|---|---|---|
| `voiceService.ts` (152 行) | **half-done** | grep 只在 self-referenced，**未在任何 screen import** | 完整 expo-speech 包装 + TTS API，但没有 consumer，注释说 "Running screen、route navigation" 应该用它 |
| `voiceMemoService.ts` (222 行) | real-done | HikingScreen (require() 动态 import 3 处) | 5s 语音备忘录，附在 marker 上 |

### Emergency / SOS（**用户想砍**）

| 文件 | 状态 | 调用方 | 备注 |
|---|---|---|---|
| `sosService.ts` (247 行) | **DEAD in practice** | 只被 `SOSButton.tsx` import | 完整实现 — long-press 3s + 5s countdown + SMS via `Linking.openURL('sms:...')` + AsyncStorage queue + `processSOSQueue()` 中 `// TODO: Send to Cairn backend API for server-side delivery`（后端未实现） |
| `components/SOSButton.tsx` (333 行) | **DEAD** | grep 结果：**0 screen 引用 SOSButton** | 组件孤立 — 未挂到任何屏幕上 |

**Q3.4 相关注**：`useSettingsStore` 里有 `tripSharing: true` 默认字段，但**无对应 backend endpoint、无对应 service** — 设置项挂空。

### Diagnostics / Telemetry / Logging

| 文件 | 状态 | 调用方 | 备注 |
|---|---|---|---|
| `crashLogger.ts` (317 行) | real-done | 全项目 ~40 处 breadcrumb 调用 | 面包屑 + crash 上报 |
| `debugLogger.ts` (586 行) | real-done | 20+ 处 | 主诊断日志（含 battery_sample, sos_triggered, etc） |
| `debugUpload.ts` (165 行) | real-done | SettingsScreen | 截图上传 |
| `appLog.ts` (144 行) | real-done | self-only（模块被 export 但 grep 无外部 call site） | 依附 `/api/edit-diag` 端点上传日志 — **可能 half-done：接口存在但没人调用 `log(tag, payload)`** |
| `telemetryUploader.ts` (247 行) | real-done | useTrackingStore, RouteEditorScreen, ARScreenLegacy, DebugScreen | JSON 上传 |
| `bootDiagnostics.ts` (191 行) | real-done | RootNavigator | boot 阶段追踪 |
| `exportService.ts` (167 行) | **DEAD in practice** | 只在 RoutesScreen import 但 grep 发现 `// kept for future Export action` 注释，实际未调用 | shareGPX / sharePDF 未挂到 UI |

### 其他

| 文件 | 状态 | 调用方 | 备注 |
|---|---|---|---|
| `LegacyRouteMigrator.ts` | 见上表 | 迁移用 | 完成 |

---

## Store slices

| 文件 | 行数 | 状态 | 调用方 | 备注 |
|---|---|---|---|---|
| `useAppStore.ts` | 365 | real-done | 主 hub — 20+ screen/service | logout/login/hydrate/session |
| `useSessionStore.ts` | 269 | real-done | useTrackingStore, MapHistoryScreen, RoutesScreen | 完成的 sessions |
| `useSettingsStore.ts` | 125 | real-done | SettingsScreen, HikingScreen, RunningScreen | **含 `tripSharing`, `locationShare` 等孤立字段**（无 backend endpoint 支持） |
| `useTrackingStore.ts` | **1470** | real-done | HikingScreen, RunningScreen | 主追踪状态机（v412 saveHikeAtomic） |
| `useMarkerStore.ts` | 666 | real-done | 33 处 grep | permission `personal/group/public` — 无 hard-coded 默认 |
| `useRouteStore.ts` | 426 | real-done | RoutesScreen, RouteEditorScreen | route CRUD |
| `useRouteEditStore.ts` | **2891** | real-done | RouteEditorScreen, brush overlays | 单文件最巨型 store |
| `useFriendStore.ts` | 302 | real-done | FriendsScreen, MemoryFriendPickModal, MapScreen | **只有 marker 分享，没有位置分享** |
| `useArOriginStore.ts` | 233 | real-done | useAppStore, a8Migration, ARScreenLegacy | AR origin FSM |
| `storage.ts` | 57 | real-done | 全 store | MMKV 包装 |
| `brush/bcef.ts` | 261 | real-done | useRouteEditStore | brush edit 数学 |
| `v025/useCairnStoreV2.ts` | 128 | wip / flag-off | v025 only | v2 cairn store |
| `v025/useArSessionStoreV2.ts` | 106 | wip / flag-off | v025 only | v2 session store |

---

## 死代码清单（可删）

1. **`services/sosService.ts` (247 行)** — 用户明确想砍，只被孤立组件引用
2. **`components/SOSButton.tsx` (333 行)** — 无任何 screen import
3. **`services/weatherService.ts` (195 行)** — 完成 100%，**0 call site**，Open-Meteo 集成搁置
4. **`services/exportService.ts` (167 行)** — RoutesScreen 只 import 名字，实际未挂 UI（`// kept for future Export action`）
5. **`services/voiceService.ts` (152 行)** — TTS 完整包装，**0 screen import**（voiceMemoService 是另一个，voice memo 在用）
6. **`services/appLog.ts` (144 行)** — 后端 endpoint 存在但 grep 无外部 `log()` 调用（半死 / 死）
7. **`useSettingsStore` 的 `tripSharing` / `locationShare` 字段** — 无对应 service，UI toggle 挂空
8. **v025 stack 全套**（若产品决定砍 AR）：8 services + 2 stores + 1 屏幕 = ~1200 行 — **feature-flag OFF 默认，用户永远看不到**

---

## Mock / TODO / 半死清单

| 文件 | 问题 |
|---|---|
| `sosService.ts:222` | `// TODO: Send to Cairn backend API for server-side delivery` — 后端 SOS 递送未实现 |
| `contentFilter.ts:6` | 注释 "Future: AI-based content moderation API upgrade" — 目前只是黑名单 |
| `contentFilter.ts:97` | `Object.defineProperty(module.exports, ...)` — 运行时改 const 不干净 |
| `screens/AuthScreen.tsx` | 2 处 TODO |
| `screens/v025/ARScreenV2.tsx:1` | 1 处 TODO — Phase 2B.10 "will fill in real implementation" — 说明 v025 屏幕自己都是半成品 |
| `useSettingsStore` | `tripSharing`, `locationShare` UI toggle 无 backend endpoint / service — 挂空 |

**注**：整个 services + store 只有 **4 个 TODO 注释**，代码本身没有明显 mock 数据；`voiceMemoService.ts` 用 `require()` 动态 import — 不是 mock，是 Expo Go graceful degradation。

---

## 完全缺失的服务（需要新做）

对齐 MSC 官方风险 + Q3.1 NZ 痛点：

1. **DOC 步道 / hut / campsite 数据集成** — 完全没有 `docService.ts` 或类似模块。Cairn 目前完全不知道用户在走哪条步道。
2. **MetService 官方天气警报** — 只有第三方 Open-Meteo（且未接入），无 MetService 官方 API 客户端。
3. **RCCNZ / PLB 联动** — 用户想砍 SOS 是对的，但**替代方案是接入 NZ 官方求救系统**，目前无 `rccnzService.ts` 或类似。
4. **河流水位 / 山洪预警** — 无 `riverService.ts`（Q3.1 NZ 户外死因 #1）。
5. **火山警报 GeoNet** — 无 `geonetService.ts`（North Island 户外必备）。
6. **Trail difficulty / warning fetch** — DOC alerts API 未接入。

---

## 关键发现

1. **SOS 是"僵尸代码"**：`sosService.ts` 完整实现 SMS + queue + haptics 三层，但组件 `SOSButton.tsx` 未挂到任何屏幕上。**用户砍 SOS 只是把没显示的功能删掉，产品实际未受影响**。可全删 ~830 行。

2. **friend 位置分享从未存在**：grep `friendLocation / liveLocation / realtimeLocation` 全空。`useFriendStore` 只处理 marker 分享 + backend friends CRUD。**用户"想砍 friend 位置分享"是无需砍**，已经不存在。`useSettingsStore.locationShare` 是空 UI toggle。

3. **v025 AR stack 是巨型 dead branch**：`featureFlagsClient.useV025Enabled()` 默认 `false`（fail-closed），且注释明确说 "如果 backend 不可达，用户永远看不到 v025"。整个 v025/ 目录 ~1200 行代码 + Unity C# 双端契约，是 **等待 backend flag 翻的 dead weight**。若产品决定不上 v025，可整体砍。

4. **weatherService 存在但产品未接入**：Open-Meteo 完整 client、cache、WMO code decoder、broadcast text — 全好，**但 0 call site**。要么接入（3-5 行代码），要么删。这是"半死代码"最大存量。

5. **voiceService 与 voiceMemoService 是两回事**：memo 在用（HikingScreen 3 处），TTS 未在用（注释说应该用于 Running screen + route navigation + broadcast）。**settings 里的 `broadcastEnabled` 是空开关**。

6. **useRouteEditStore.ts 2891 行 = 单文件冠军**。整个 brush edit + map-match + persistence + migration 全塞在一个 store 里，砍功能高风险。若产品决定放弃 route 编辑（不是核心），可省 ~5000 行（store + services 合计）。

7. **electricity 硬门槛 Q3.4 已具备测量能力**：`batteryMonitor.ts` 有 60s 采样 + level_change + state_change 事件流，`debugLogger` 有 `battery_sample` 事件类型 → 完全可跑 real-device 5%/h 验证。缺的是 dashboard，不是数据。

8. **contentFilter 是纯 English + hard-coded regex**：34 个词的黑名单硬编码，无中文/其它语言，无 AI moderation。对 NZ 户外用户可能够用，但要国际化就是空壳。

9. **appLog 是"孤儿基础设施"**：完整实现了 debounced batch upload 到 `/api/edit-diag`，但整个 codebase **无一处 `import { log } from 'appLog'`**。要么删，要么全项目改用它替代直接 `debugLogger.log`。

10. **DOC / MetService / RCCNZ / GeoNet / River 全无**：Cairn 声称"NZ 起步的户外记录 App"，但**零** NZ 官方数据源接入。这是 MSC 官方推的核心风险信息，是最大产品差距，不是砍功能问题，是**缺功能问题**。
