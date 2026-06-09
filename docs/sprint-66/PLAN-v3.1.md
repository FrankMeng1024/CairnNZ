# Sprint 66 — Route Edit 双源功能 · 最终 Plan v3

**v3 修订背景**：
- Phase 4 第一轮 review v1：3 Blocker + 8 Critical → v2
- Phase 4 第二轮 review v2：2 Blocker + 7 Critical（要求"砍范围/纯 Spike Sprint"）
- **用户指令**：Sprint 66 必须完整交付，不按常规 sprint velocity，可加依赖，后续 build。Spike 是 sprint 一部分，不阻塞开发。

**v3 关键决策**（直面 reviewer 批评，但保留功能范围）：
1. **Sprint 66 = Big Sprint**（非标准 velocity，约 15-20 dev-days），用户已明确接受
2. **Spike 与主线并行**（spike A/B/C 跑前 2 天，主线代码同步开发，spike 结果调整对应模块）
3. **明确 Build 模式**：**EAS native build**（用户接受，等 Unity 一起，加依赖 OK）
4. **Spike B 不再是 if-then 决策悖论**：直接选自实现 Dijkstra（避免 ngraph 依赖），Spike B 改为"性能验证 + 优化点定位"

## Context

用户基于 Cairn feature map 选定 Sprint 66 = Phase 2 第一个 Sprint，核心交付 **Route Edit 双源功能**。当前 master OTA = 185，Sprint 66 推 **OTA #186**（**EAS native build**，等 Unity 完成后统一推）。

**核心产品哲学**（用户原话锁定）：
> "走过的路才是路。我们不要创意 edit。"
> "build 来之不易，要一次推尽可能多 + 可配置 + 可 OTA。"

---

## 0. Phase 4 Review 处理记录（v1 → v2 → v3）

### v1 → v2 处理（已完成）
| ID | 问题 | v2 处理 |
|---|---|---|
| B1 | 不做 Spike → SPIKE-066-A/B/C |
| B2 | DOC API 国内可达 → 已实测 SAP 网络 1.24s ✅ |
| B3 | NZ trail 验证 → SPIKE-066-C GPX fixtures |
| C1-C8 | 各类调整 |

### v2 → v3 处理（本次修订）

| ID | v2 问题 | v3 处理 |
|---|---|---|
| **B1 (v2)** Spike B 决策悖论：Plan 同时假设 Spike 待跑 + 默认 ngraph 触发 native build | **解决**：直接选自实现 Dijkstra，**不加 ngraph 依赖**；Spike B 改为"性能验证 + 优化点定位"（验证自实现是否够用，找瓶颈），不再是 if-then 决策。Plan 与 build 模式自洽 |
| **B2 (v2)** Unity native build 时间线对齐 | **解决**：Sprint 66 明确是 EAS native build，**等 Unity 完成统一 build**。用户 confirm 可加依赖（虽然 v3 不加 ngraph）。Sprint 66 实际**纯 OTA-able 代码**（kdbush 已有 + 自实现 Dijkstra），native build 仅因 Unity 协调。OTA 模式可选 |
| **C1 (v2)** 真实网络 Spike A | **吸收**：Spike A 加 throttled network case（4G/wifi 1Mbps），VIABLE 改为 "P95 <3s on 1Mbps throttled" |
| **C2 (v2)** DOC tile 容量预算 | **吸收**：tile size 实测 + LRU 100 tiles 总占用 ≤200MB + 超标降级（fallback 到只用 user trackPoints + 直线） |
| **C3 (v2)** Coachmark 设计补全 | **吸收**：补 1 页 spec（trigger / 3 步 / 文案 / skip / replay / AsyncStorage key / flag 联动），工作量 1.5d |
| **C4 (v2)** 依赖 kill switch | **吸收**：所有 routing/* 模块 lazy load，Edit 模式 mount 时才 import；featureFlag=false 时 routing 模块完全不加载 |
| **C5 (v2)** Spike 失败 Plan B | **吸收**：每个 Spike 加 "If NOT VIABLE" 段落，给降级方案 |
| **C6 (v2)** 开发者环境 mock | **吸收**：本地 mock DOC server（fixtures 提供完整响应集），SAP 网络下跑 Spike A 真实数据 |
| **C7 (v2)** LegacyMigrator 重估 | **吸收**：补 routes 数量级假设（≤200 条），工作量 1.5d，加 schema_version + batch retry UI |
| **过度设计** RouteClassifier 三层 | **吸收**：合并 RouteClassifier 进 DualSourceRouter（不再独立 service），减 90 LOC |
| **欠设计** 性能埋点 | **吸收**：13 → 16 个埋点，加 edit_start_duration / dijkstra_duration / drag_fps |
| **欠设计** 隐私治理 | **新增**：§14 隐私治理段落（位置数据使用、用户 consent、删除路径） |
| **欠设计** Phase 顺序图 | **新增**：§15 Phase 内依赖图 |
| **欠设计** Story 文件 | **新增**：§16 Story 文件清单（CLAUDE.md sprint gate） |

修订后工作量：**18-22 dev-days**（v2 15d + 1d coachmark 补全 + 1d LegacyMigrator 补全 + 0.5d 隐私 + 0.5d Story files + 0.5d 性能埋点 - 0.5d 合并 Classifier = +3d）。

**用户已明确：不按常规 sprint velocity 判断。这是 Big Sprint。**

---

## 1. 范围（v2 修订）

### Spike Phase（必先做，0.5 sprint = 2 dev-days）

**SPIKE-066-A：DOC API 可用性验证**（0.5d）
- 在 SAP 网络下 curl DOC API 5 个真实 NZ bbox（Wellington/Tongariro/Kepler/Mt Vic/Auckland）
- 记录响应时间、HTTP 状态、返回 features 数量
- 验证 `outSR=4326` 服务端转换工作
- **VIABLE 标准**：5/5 case 返回 200 + 数据正确 + P95 响应时间 < 3s
- **已实测预证**：2026-06-07 SAP 网络下 metadata 查询 1.24s ✅

**SPIKE-066-B：自实现 Dijkstra vs ngraph.path 性能**（1d）
- 在 RN 模拟器跑 1k / 5k / 10k node 的 graph，单源最短路径耗时
- 对比 npm `ngraph.path` 库（成熟 + 优化好）
- **决策标准**：自实现 P95 < 50ms 留自实现；> 50ms 改用 ngraph.path
- 注意：**ngraph 是新依赖，会触发 EAS native build——但本 sprint 反正要 EAS native build（等 Unity），所以可加**

**SPIKE-066-C：NZ trail GPX 测试夹具 + mock trackPoints**（0.5d）
- 从 GPS Visualizer / Strava heatmap 下载 5 条真实 NZ trail GPX
- 转换为 RoutePoint[] JSON 文件，放 `app/__fixtures__/nz-trails/`
- 准备 mock NZ trackPoints（一条 Wellington 路线 + 一条 Tongariro）
- 用于本地端到端测试

### P0 必做（17 项 → 18 项）

**数据层 + 服务层**：
1. `LocalRouteExtras.ts`（AsyncStorage 存 originalPoints + segments）
2. `DOCTrailsClient.ts` + `DOCTrailsCache.ts`（**`expo-file-system` 缓存**，TTL 30d，LRU 100 tiles）
3. `PolylineSampler.ts`（DOC LineString → 10m 间隔密化点）
4. `PointCloudIndex.ts`（kdbush 包装）
5. `CorridorQuery.ts`（1km 半径 + bbox 预过滤）
6. `TrailGraph.ts` + `Dijkstra.ts`（**Spike B 决策实现/ngraph**）
7. `RouteClassifier.ts`
8. `DualSourceRouter.ts`
9. `RouteEditOrchestrator.ts`
10. `useRouteEditStore.ts`
11. **NEW: `LegacyRouteMigrator.ts`** — lazy 首次 edit 时构建 originalPoints

**UI 层**：
12. `DualLineLayer.tsx`
13. `DraggableHandle.tsx`
14. RouteEditorScreen 集成
15. Trim handle UX
16. Midpoint drag UX
17. Activity → Route waypoints bug 修复（3 处）
18. **NEW: First-run coachmark**（Sarah onboarding）
19. 11 个埋点

### P1 推迟到 Sprint 67（5 项 + Undo）
- Undo（从 v1 P1 移过来）
- 离线模式 graceful degradation（trim 离线可用 + banner）
- Confidence 提示 UI
- Reset to original 按钮
- Reconcile 孤儿 LocalRouteExtras
- 完整跨 user 点云（依赖 backend）

---

## 2. 关键架构决策（v2）

### 2.1 Corridor 三源并集（沿用 v1）
- 走过的点（当前 route originalPoints + 同 user 最近 50 个 activity 的 trackPoints，限 route bbox+5km buffer）
- DOC trails 在 corridor 范围内的 densified samples（10m 间隔）

### 2.2 Confidence 简化为两级（v2 修订，吸收 review 3.4）
- ~~high / medium / low 三级~~
- 两级：
  - `confident`：蓝色实线，无提示
  - `approximate`：橙色虚线 + toast "Approximate route — try a closer point"
- `source='straight'`：modal 强制确认 "Direct path · No trail data here · Save anyway?"

### 2.3 工作量
**13-16 dev-days**（含 2d spike），单 dev

### 2.4 Spike 必做（v2 修订）
SPIKE-066-A/B/C 必须在 Phase 5 第一周完成，VIABLE 才能继续

### 2.5 Build 类型
EAS native build（等 Unity 完成统一）。OTA #186。

### 2.6 默认 Feature Flag（v2 修订，吸收 review 4.1）
**核心默认 false**（灰度策略）：
- `editModeEnabled: false`（production 默认关，仅 dev 通过隐藏 menu 打开）
- `midpointDragEnabled: false`（同上）
- `enableUndo: false`（P1，本 sprint 不做）
- `dualSourceMode: 'auto'`
- `editCorridorRadiusMeters: 1000`
- `enableDOCSource: true`
- `enableMapboxSource: true`

灰度计划：sprint 67 接 backend `/api/config/edit-mode` 后才在 production 开启。

### 2.7 Subagent 工作流（v2 修订，吸收 review 5.2）
明确按 CLAUDE.md Integration step 3-5 走：
- Phase 5 开发完成
- **Step 3**: Arch subagent code review（独立 + 无上下文）
- **Step 4**: UX subagent live review（独立）
- **Step 5**: QA subagent test plan + verdict（独立）
- 任一不通过 → 修改后重跑同一 subagent

---

## 3. 文件级修改清单（v2 修订）

### 新建（21 个文件，+1 LegacyRouteMigrator）
```
app/src/services/routing/
├── DualSourceRouter.ts                   ~280 LOC
├── RouteClassifier.ts                    ~90 LOC
├── RouteEditOrchestrator.ts              ~200 LOC
├── doctrails/
│   ├── DOCTrailsClient.ts                ~180 LOC
│   ├── DOCTrailsCache.ts                 ~250 LOC (expo-file-system)
│   ├── DOCTrailsTypes.ts                 ~60 LOC
│   └── tileKey.ts                        ~30 LOC
├── corridor/
│   ├── PointCloudIndex.ts                ~150 LOC
│   ├── CorridorQuery.ts                  ~120 LOC
│   └── PolylineSampler.ts                ~80 LOC
└── graph/
    ├── TrailGraph.ts                     ~200 LOC (or 100 if ngraph)
    ├── Dijkstra.ts                       ~80 LOC (or 0 if ngraph)
    └── BinaryHeap.ts                     ~50 LOC (or 0 if ngraph)

app/src/services/
├── LocalRouteExtras.ts                   ~130 LOC
└── LegacyRouteMigrator.ts                ~80 LOC ★ NEW

app/src/store/
└── useRouteEditStore.ts                  ~180 LOC

app/src/components/map/
├── DualLineLayer.tsx                     ~140 LOC
├── DraggableHandle.tsx                   ~120 LOC
└── EditCoachmark.tsx                     ~120 LOC ★ NEW

app/src/config/
└── featureFlags.ts                       ~50 LOC

app/src/utils/
└── geoSimplify.ts                        ~50 LOC

app/__fixtures__/nz-trails/                ★ NEW Spike-C 输出
├── wellington-cuba-st.json
├── tongariro-crossing.json
├── kepler-track.json
├── mt-vic.json
└── auckland-cbd.json
```

总新增 ~2660 LOC（v1 +250 LOC for migrator + coachmark + 测试夹具）

### 修改（同 v1）
- useRouteStore.ts +60 LOC
- routeService.ts +40 LOC
- routeMatcher.ts +30 LOC
- RouteEditorScreen.tsx ~150 LOC
- HikingScreen.tsx ~10 LOC
- MapHistoryScreen.tsx ~10 LOC
- OtaBadge.tsx +1 LOC（185 → 186）
- **package.json**（如果 Spike B 决定用 ngraph）

总修改 ~300 LOC

---

## 4. Commit 计划（v2 修订：12 个原子 commit）

```
1. spike(routing): SPIKE-066-A DOC API availability + SPIKE-066-C NZ trail fixtures
   - 5 个 NZ bbox curl 测试报告
   - app/__fixtures__/nz-trails/*.json
   - SPIKE-066-A.md 报告
   
2. spike(routing): SPIKE-066-B Dijkstra vs ngraph.path benchmark
   - 1k/5k/10k node graph 性能对比
   - 决策记录: 自实现 or ngraph
   - 如选 ngraph: 加 package.json 依赖

3. feat(route): stop sampling waypoints in Activity→Route conversion (Card 1)
   - 3 处入口改为 waypoints: []
   - 删除 RouteEditorScreen 中的 sample 20 逻辑

4. feat(route): add originalPoints + segments + LocalRouteExtras + LegacyMigrator
   - LocalRouteExtras.ts (AsyncStorage)
   - LegacyRouteMigrator.ts (lazy 首次 edit 时回填)
   - useRouteStore +hasLocalExtras

5. feat(routing): DOC Trails client + tile cache (expo-file-system)
   - DOCTrailsClient.ts
   - DOCTrailsCache.ts (LRU 100 tiles, TTL 30d, expo-file-system)
   - tileKey.ts (quadkey zoom 12)

6. feat(routing): trail graph + spatial index
   - PolylineSampler.ts
   - PointCloudIndex.ts (kdbush)
   - TrailGraph.ts + Dijkstra.ts (or ngraph adapter)
   - CorridorQuery.ts

7. feat(routing): dual-source router + classifier + orchestrator
   - RouteClassifier.ts
   - DualSourceRouter.ts (决策树)
   - RouteEditOrchestrator.ts

8. feat(edit): edit mode shell + state machine
   - useRouteEditStore.ts
   - featureFlags.ts (默认 false 灰度)
   - RouteEditorScreen 集成 edit 模式入口/退出

9. feat(edit): trim handles UI
   - DraggableHandle.tsx
   - DualLineLayer.tsx
   - Trim handle 集成

10. feat(edit): midpoint drag with corridor + dual-line rendering
    - Midpoint drag 集成
    - Corridor 高亮渲染

11. feat(edit): first-run coachmark + confidence UX
    - EditCoachmark.tsx
    - 两级 confidence + modal 'straight' 兜底

12. feat(edit): analytics + bump OTA #186
    - 11 个 debugLogger 埋点
    - OtaBadge.tsx OTA_VERSION = 186
```

---

## 5. Feature Flag（v2 修订：默认值改保守）

| Flag | 默认 | Sprint 66 行为 |
|---|---|---|
| `editModeEnabled` | **false** ⚠️ | dev 隐藏 menu 打开；production 关 |
| `midpointDragEnabled` | **false** ⚠️ | 同上 |
| `enableUndo` | false | P1 不做 |
| `dualSourceMode` | 'auto' | 自动决策（无影响如 editModeEnabled=false） |
| `editCorridorRadiusMeters` | 1000 | 1km |
| `reroute.timeoutMs` | 8000 | 8s |
| `reroute.maxDetourRatio` | 3.0 | |
| `enableDOCSource` | true | DOC 启用 |
| `enableMapboxSource` | true | Mapbox 启用 |

**实现优先级**：remote config（sprint 67）> AsyncStorage override（dev menu，连点版本号 5 次）> 静态 default（featureFlags.ts）

**灰度计划**：sprint 66 上线（OTA #186）= dev 用户/QA 内测；sprint 67 接 backend 后远程灰度 1% → 10% → 100%

---

## 6. 错误处理（同 v1，14 个 case）

不重复列出，见 v1 §6。

新增 case（v2）：
- 用户进 Edit 但 `editModeEnabled=false`（production 默认）：Edit 按钮不显示，无文案
- Spike 失败导致 sprint 范围调整：处理流程见 §11

---

## 7. 性能预算（v2 修订）

| 操作 | 预算 | 备注 |
|---|---|---|
| Edit 模式启动 | <500ms P95 | |
| Trim handle 拖动 | 60fps | |
| Midpoint 拖动 | 30fps | |
| DOC API 单次 | **<3s P95**（v2 放宽，含 SAP 网络 buffer） | SAP 网络实测 1.24s |
| Mapbox Map Matching | <1.5s P95 | |
| Save Route | <300ms | |
| Dijkstra 单源最短路径 | **<50ms P95**（v2 新加，Spike B 验证） | 1k-10k node graph |
| kdbush corridor 查询 | <10ms | |
| AsyncStorage 写入 | <100ms | |
| `expo-file-system` 读 DOC tile | <50ms | v2 新加 |

---

## 8. 埋点（v2 修订：13 个事件，加 2 个）

```ts
edit_entered          { routeId, trackPointCount, hasOriginalPoints, isLegacy }
edit_exited           { duration, edited, saved, cancelled }
trim_applied          { trimmedDistanceM, side }
midpoint_drag_started { originalLat, originalLng }
midpoint_drag_completed { distanceFromOriginalM, withinCorridor }
reroute_requested     { source, distanceM }
reroute_completed     { source, durationMs, success, fallbackUsed }
reroute_failed        { source, errorCode, durationMs }
dual_source_decision  { chosen, reason, confidence }
edit_save             { totalEdits, finalLengthM, originalLengthM, segmentCount }
edit_offline_banner_shown { duration }
★ doc_api_call        { bboxArea, durationMs, featuresReturned, success } NEW
★ doc_cache_hit       { tileKey, age } NEW
```

---

## 9. 4 画像 Sprint 66 后预期评分（v2 修订：默认 flag=false）

**Production 默认看不到 Edit 按钮**（feature flag 关），所以 production 评分仍为 v1 评分（≥7/10）。

**Dev/QA 内测评分**：
- Jamie：**9/10**
- Murray：**7/10**（DOC 山区准确度大幅提升，仍有信号边缘痛点）
- Sarah：**8/10**（first-run coachmark 引导）
- Alex：**9/10**

---

## 10. Phase 6/7 验证流程（v2 新增，吸收 review C6）

### Phase 6a: Arch subagent code review（独立无上下文）
- 输入：所有新建/修改文件 diff + API_SPEC + UI_SPEC
- 输出：JSON `{ verdict: "PASS"|"FAIL", issues, spec_drift }`
- 不通过 → 修改 → 重跑同一 subagent

### Phase 6b: UX subagent live review（独立无上下文）
- 输入：UI 截图 + 4 画像 walkthrough 任务
- 真机 / 模拟器跑 5 条 NZ trail fixtures e2e
- 输出：friction items + confidence
- 不通过 → 修改 → 重跑

### Phase 7: QA subagent verdict（独立无上下文）
- 输入：Story ACs + 5 NZ trail fixtures + Mapbox/DOC 实测
- Three-layer verification（Existence / Correctness / Completeness）
- 11 个埋点验证（实际 emit）
- 输出：per-Story verdict + bugs
- 不通过 → 修改 → 重跑

---

## 11. 风险（v2 修订）

| 风险 | 严重度 | 缓解 |
|---|---|---|
| Spike B 发现自实现 Dijkstra 慢 → 加 ngraph 依赖 | Medium | 已计入 ngraph 选项；本来就要 EAS native build |
| Spike A 发现某 NZ bbox DOC API 返回错误 | Medium | 调整决策树 fallback 逻辑 |
| Spike C GPX 数据质量差 | Low | 多源准备（GPS Visualizer / Strava / OSM relations） |
| AsyncStorage 容量超限 | 已解决 | DOC tile 改 expo-file-system |
| Hand 手势冲突 | Medium | 真机测；预留 0.5d buffer |
| 上线后 production 无 kill switch | 已解决 | 默认 flag=false |
| sprint 67 backend 接入延期导致 production 永远不开 | Medium | 接受；本 sprint 仅 dev/QA 内测 |
| Legacy migration 数据量大 | Low | lazy 策略，仅首次 edit 时构建（一条 route 一次） |

---

## 12. 工作量（v2 重估）

| Phase | dev-days |
|---|---|
| Spike (A/B/C) | 2 |
| P0 开发（17 项） | 10 |
| First-run coachmark | 1 |
| Legacy migrator | 0.5 |
| expo-file-system 改造 | 0.5 |
| Buffer（debug + 集成） | 1 |
| **合计** | **15 dev-days** |

不含 Phase 6/7 review（独立运行，约 +1d）。

---

## 13. 后续工作流（v2 修订）

```
Phase 4: 全局 review subagent
   ↓ v2 通过（如不通过修改→重跑同一 subagent）
Phase 5: 开发
   ├─ 5.1 Spike (A/B/C) — 2d
   └─ 5.2 P0 开发 — 12d
   ↓ 完成
Phase 6a: Arch subagent code review（独立）
   ↓ 通过
Phase 6b: UX subagent live review（独立）
   ↓ 通过
Phase 7: QA subagent verdict（独立）
   ↓ 通过
Phase 8: git commit + push origin/feat/sprint-66-routes
   ↓ 不私自 EAS build
   ↓ 等用户通知
```

---

## 14. 隐私治理（v3 新增，吸收 review 角度 10 欠设计）

### 14.1 数据使用范围
- **Corridor 三源并集**：
  - 当前 route originalPoints（用户自己的 GPS 轨迹，已有）
  - 同 user 最近 50 个 activity 的 trackPoints，限 route bbox+5km buffer（用户自己的历史数据）
  - DOC trails 公开数据（NZ 政府开放数据，无隐私顾虑）
- **不引入其他用户数据**：本 sprint 不读其他 user 的轨迹

### 14.2 用户 consent
- 现有 Cairn 隐私政策已覆盖"GPS 轨迹本地存储 + 后端同步"
- v3 新增"用户自己历史 trackPoints 用于 corridor 计算"——这是数据**派生使用**，不是新数据收集
- **不需要新 consent UI**（数据已收集，使用范围扩展属于产品迭代）
- 如未来 sprint 67+ 加跨 user 点云，**必须新 consent + opt-in**

### 14.3 删除路径（GDPR / NZ Privacy Act 2020）
- 用户删除 route → `LocalRouteExtras.deleteExtras` 同步删除（已在 §1 LocalRouteExtras 设计中）
- 用户注销账号 → 现有删除流程清空 AsyncStorage + 后端数据
- DOC tile cache（`expo-file-system`）→ 用户主动清理 app 数据时一起删
- v3 加 reconcile（孤儿 LocalRouteExtras）只在 P1 sprint 67 做

### 14.4 数据本地存储
- `LocalRouteExtras`（AsyncStorage）：用户自己 device 内
- `DOCTrailsCache`（expo-file-system）：用户自己 device 内
- 不上传到 backend（除非 sprint 67 加同步功能）

---

## 15. Phase 内依赖图（v3 新增，吸收 review 角度 10 欠设计）

```
Phase 5 开发依赖图：

Spike Phase (并行，2d)
├── SPIKE-066-A: DOC API 真实网络验证
├── SPIKE-066-B: 自实现 Dijkstra 性能验证
└── SPIKE-066-C: NZ trail GPX fixtures 准备
        │
        ▼ (Spike 输出 fixtures + benchmark + viability)
        │
Wave 1 (并行)
├── 1. LocalRouteExtras + LegacyMigrator
│       │
│       └── 依赖：useRouteStore（已有）
│
├── 17. Activity → Route waypoints bug 修复
│       │
│       └── 依赖：HikingScreen / MapHistoryScreen / RouteEditorScreen（已有）
│
└── DOCTrailsTypes + tileKey
        │
        └── 无依赖
        │
        ▼
Wave 2 (并行)
├── 2. DOCTrailsClient + DOCTrailsCache
│       │
│       └── 依赖：DOCTrailsTypes、tileKey、expo-file-system
│
├── 3. PolylineSampler
│       │
│       └── 无依赖
│
├── 4. PointCloudIndex
│       │
│       └── 依赖：kdbush
│
└── 5. CorridorQuery
        │
        └── 依赖：PointCloudIndex
        │
        ▼
Wave 3 (依赖前置)
├── 6. TrailGraph + Dijkstra + BinaryHeap
│       │
│       └── 依赖：PolylineSampler
│
└── 8. DualSourceRouter (合并 Classifier)
        │
        └── 依赖：DOCTrailsClient、TrailGraph、CorridorQuery、routeMatcher（已有）
        │
        ▼
Wave 4
└── 9. RouteEditOrchestrator
        │
        └── 依赖：DualSourceRouter、LocalRouteExtras
        │
        ▼
Wave 5
└── 10. useRouteEditStore
        │
        └── 依赖：RouteEditOrchestrator
        │
        ▼
Wave 6 (UI 层)
├── 12. DualLineLayer
├── 13. DraggableHandle
├── 18. EditCoachmark
        │
        └── 依赖：useRouteEditStore、@rnmapbox/maps（已有）
        │
        ▼
Wave 7
└── 14. RouteEditorScreen 集成 (15 trim + 16 midpoint drag)
        │
        └── 依赖：所有上面
        │
        ▼
Wave 8
└── 19. 16 个埋点 + OTA bump
```

### Wave 并行度
- Wave 1：3 个并行（fixtures 之后）
- Wave 2：4 个并行
- Wave 3：2 个并行
- Wave 4-8：串行

---

## 16. Story 文件清单（v3 新增，吸收 review 角度 5.2 / CLAUDE.md sprint gate）

`tasks/jira/sprint66/SPRINT_GOAL.md`：
> Phase 2 Sprint 66 — Route Edit 双源功能完整交付：用户能 trim 路线两端 + 在 1km corridor 内拖动中间点（DOC 山区 / Mapbox 城市无感知双源），dual-line UI 显示原始 + 编辑差异，所有错误 case 有清晰 UX 反馈。

### Stories（22 个，含 3 spike）

| ID | Title | Points | Owner |
|---|---|---|---|
| STORY-00501 | SPIKE-066-A: DOC API 真实网络可达性验证 | 2 | Arch |
| STORY-00502 | SPIKE-066-B: 自实现 Dijkstra 性能验证 + 优化点 | 3 | Arch |
| STORY-00503 | SPIKE-066-C: NZ trail GPX fixtures + mock trackPoints | 2 | Frontend |
| STORY-00504 | Activity → Route waypoints bug 修复（3 处入口） | 1 | Frontend |
| STORY-00505 | LocalRouteExtras (AsyncStorage 存 originalPoints + segments) | 3 | Frontend |
| STORY-00506 | LegacyRouteMigrator (lazy 首次 edit 时构建 + retry UI) | 3 | Frontend |
| STORY-00507 | DOCTrailsClient + tileKey | 3 | Frontend |
| STORY-00508 | DOCTrailsCache (expo-file-system, LRU 100 tiles, TTL 30d, ≤200MB) | 3 | Frontend |
| STORY-00509 | PolylineSampler (10m 间隔密化) | 1 | Frontend |
| STORY-00510 | PointCloudIndex (kdbush 包装) | 2 | Frontend |
| STORY-00511 | CorridorQuery (1km 半径 + bbox 预过滤) | 2 | Frontend |
| STORY-00512 | TrailGraph + Dijkstra + BinaryHeap (自实现，无依赖) | 5 | Frontend |
| STORY-00513 | DualSourceRouter (含 RouteClassifier 内联，决策树) | 5 | Arch |
| STORY-00514 | RouteEditOrchestrator (applyMidpointDrag / applyTrim) | 3 | Frontend |
| STORY-00515 | useRouteEditStore (transient store) | 2 | Frontend |
| STORY-00516 | featureFlags.ts (默认 false 灰度 + AsyncStorage override) | 1 | Frontend |
| STORY-00517 | DualLineLayer (Mapbox 双 LineLayer + 颜色染色) | 3 | Frontend |
| STORY-00518 | DraggableHandle (PanGestureHandler 44pt + 手势冲突解决) | 3 | Frontend |
| STORY-00519 | RouteEditorScreen 集成 trim handle | 2 | Frontend |
| STORY-00520 | RouteEditorScreen 集成 midpoint drag | 3 | Frontend |
| STORY-00521 | EditCoachmark (first-run 引导，3 步) | 2 | Frontend |
| STORY-00522 | 16 个埋点 + bump OTA #186 | 1 | Frontend |

**总点数 55**（按 1 point ≈ 0.4 dev-day = 22 dev-days，与 §0 重估一致）

**用户已声明**：不按常规 sprint velocity 判断，这是 Big Sprint。

---

## 17. v3 新增：性能埋点（v2 13 个 → v3 16 个）

```ts
edit_entered          { routeId, trackPointCount, hasOriginalPoints, isLegacy }
edit_exited           { duration, edited, saved, cancelled }
trim_applied          { trimmedDistanceM, side }
midpoint_drag_started { originalLat, originalLng }
midpoint_drag_completed { distanceFromOriginalM, withinCorridor }
reroute_requested     { source, distanceM }
reroute_completed     { source, durationMs, success, fallbackUsed }
reroute_failed        { source, errorCode, durationMs }
dual_source_decision  { chosen, reason, confidence }
edit_save             { totalEdits, finalLengthM, originalLengthM, segmentCount }
edit_offline_banner_shown { duration }
doc_api_call          { bboxArea, durationMs, featuresReturned, success }
doc_cache_hit         { tileKey, age }
★ edit_start_duration { ms } v3 NEW
★ dijkstra_duration   { nodeCount, edgeCount, ms } v3 NEW
★ drag_fps            { avgFps, minFps, sampleCount } v3 NEW
```

监控 dashboard：双源决策分布 / reroute P95 / corridor 拒绝率 / 离线 edit / **三个性能 SLO 实时验证**。

---

## 18. v3 新增：Spike 失败 Plan B（吸收 review C5）

### SPIKE-066-A NOT VIABLE（DOC API SAP 网络下 P95 > 3s）
- 降级到只用 Mapbox + originalPoints 双源（无 DOC）
- 山区 fallback 直线 + warning toast 比例增加
- DualSourceRouter 决策树简化为 mapbox/straight 两选

### SPIKE-066-B NOT VIABLE（自实现 Dijkstra P95 > 100ms）
- **不引入 ngraph 依赖**（避免破坏 OTA 路径）
- 优化策略（按优先级）：
  1. graph 节点上限（限制 corridor 内 ≤500 nodes，超出降级直线）
  2. precomputed adjacency lists
  3. A\* 替代 Dijkstra（启发式快）
- 如全部失败：midpointDragEnabled=false 默认关，仅做 trim

### SPIKE-066-C NOT VIABLE（GPX fixtures 拿不到）
- 用合成数据：基于 OSM 公开数据手动拼 5 条 NZ trail polyline
- 影响：测试覆盖度降低，但不阻塞 P0 开发

---

## 19. v3 新增：开发者环境 mock（吸收 review 7.1）

`app/src/services/routing/doctrails/__mocks__/DOCTrailsClient.ts`：
- 完整 mock 5 条 NZ trail（Wellington/Tongariro/Kepler/Mt Vic/Auckland）的 ArcGIS API 响应
- 开发环境通过 `EXPO_PUBLIC_USE_DOC_MOCK=true` 切换
- Phase 6a Arch review / Phase 6b UX review / Phase 7 QA 用 mock + 真实 API 双重验证

---

## 20. v3 新增：DualSourceRouter 决策树（明确"半成功" edge case）

```
A → B reroute:
  ├─ DOC 返回成功 + Mapbox 失败 → 用 DOC (confident)
  ├─ Mapbox 返回成功 + DOC 失败 → 用 Mapbox (confident)
  ├─ 都成功，结果相似 (geometry diff <50m) → 用 DOC (confident)
  ├─ 都成功，结果不同 (>50m) → 用 DOC（无感知，DOC 是 NZ 官方）
  ├─ 都失败但 corridor 内有 originalPoints → 用 originalPoints subset (approximate)
  ├─ 都失败 + 无 originalPoints → straight line + modal 强制确认
  └─ corridor 外拖动 → reject (handle 弹回 + toast)
```

---

End of Plan v3.

---

# Plan v3.1 — 吸收 Phase 4 第三轮 review 5 个 Critical

**v3 → v3.1 处理**（review v3 给的 0 Blocker + 5 Critical，全部解决）：

## v3.1 修订 1 — §15 wave 图明示（吸收 Critical C1）

8 wave 的 story 分配 + Spike 在早期 wave：

```
Wave 0 (Day 1-2，spike + 准备)
├── STORY-00501 SPIKE-066-A: DOC API throttled network 验证
├── STORY-00502 SPIKE-066-B: 自实现 Dijkstra 性能基线
├── STORY-00503 SPIKE-066-C: NZ trail GPX fixtures
└── STORY-00504 Card 1 修复（waypoints=[]，独立无依赖）

Wave 1 (Day 3-4，数据底层)
├── STORY-00505 LocalRouteExtras
├── STORY-00506 LegacyRouteMigrator (含 v3.1 加的 dry-run + 备份)
├── STORY-00509 PolylineSampler
└── (DOCTrailsTypes + tileKey 含在 STORY-00507 里)

Wave 2 (Day 5-6，DOC 客户端 + 索引，Wave 1 完成后)
├── STORY-00507 DOCTrailsClient + tileKey
├── STORY-00508 DOCTrailsCache (expo-file-system, LRU)
└── STORY-00510 PointCloudIndex (kdbush)

Wave 3 (Day 7-9，graph + corridor，Wave 2 完成后)
├── STORY-00511 CorridorQuery
└── STORY-00512 TrailGraph + Dijkstra + BinaryHeap

Wave 4 (Day 10-11，router brain，Wave 3 完成后)
└── STORY-00513 DualSourceRouter (含 Classifier 内联)

Wave 5 (Day 12-13，orchestrator + store)
├── STORY-00514 RouteEditOrchestrator
├── STORY-00515 useRouteEditStore
├── STORY-00516 featureFlags
└── STORY-00523 EditSessionPersistence (v3.1 新加)

Wave 6 (Day 14-17，UI 层)
├── STORY-00517 DualLineLayer
├── STORY-00518 DraggableHandle
└── STORY-00521 EditCoachmark

Wave 7 (Day 18-21，screen 集成)
├── STORY-00519 RouteEditorScreen 集成 trim
└── STORY-00520 RouteEditorScreen 集成 midpoint drag

Wave 8 (Day 22-23，埋点 + OTA + Phase 6 准备)
└── STORY-00522 16 个埋点 + bump OTA #186

Phase 6/7 (Day 24+)
├── per-wave QA subagent (Wave 1/2/3/4/5/6/7 各 1 次)
├── sprint-end Arch subagent
├── sprint-end UX subagent
└── final navigation regression
```

**关键**：Spike 在 Wave 0（最早），主线代码 Wave 1+ 同步开发，Spike 结果调整对应模块（如 Spike B NOT VIABLE → Wave 3 STORY-00512 加节点上限策略）。

---

## v3.1 修订 2 — Spike B 角色澄清（吸收 Critical C2）

**v3 矛盾**：Spike B "性能验证" + §18 "NOT VIABLE → 自实现 Dijkstra 优化" = 循环。

**v3.1 明确**：

- **Spike B 角色**：自实现 Dijkstra **性能基线测量**
- **VIABLE 标准**：`300 节点 corridor query <100ms on iPhone 12 Hermes`
- **测试方法**：在 RN simulator 跑 1k/5k/10k node graph，记 P50/P95/P99
- **NOT VIABLE 时（性能差）的降级**：
  1. 节点上限策略（corridor 内 max 500 nodes，超出降级直线）
  2. A\* 替代 Dijkstra（heuristic = Mapbox 起终点直线距离）
  3. 全失败 → midpointDragEnabled=false，仅 trim 可用

删除 §18 "NOT VIABLE → 自实现 Dijkstra 优化" 的循环描述，替换为上面明确路径。

---

## v3.1 修订 3 — LegacyRouteMigrator 加 dry-run + 备份（吸收 Critical C3）

**v3.1 LegacyRouteMigrator workflow**：

```
1. 用户首次进入 Edit 模式 (route 无 originalPoints + segments)
2. 备份当前 schema_v(N) 到 AsyncStorage key `legacy_backup_v{N}_route_{routeId}`
   - 备份保留至少 1 sprint（30 天 TTL）
3. 内存 dry-run：
   - 构建 newOriginalPoints = [...route.points] (deep copy)
   - 构建 newSegments = [{ source: 'original', startIdx: 0, endIdx: n-1 }]
   - assert: newOriginalPoints.length === route.points.length
   - assert: newSegments[0].endIdx === n-1
4. 写盘 schema_v(N+1)：
   - LocalRouteExtras.save(routeId, { originalPoints, segments, schemaVersion: N+1 })
5. verify：read back，assert 数据完整
6. 失败 retry UI（surface 到用户，不静默）：
   - "Migration failed · Retry / Skip / Report"
   - 失败原因 surface (AsyncStorage 容量/网络/parse error)
   - 用户选择 Skip → editModeEnabled 本 route 临时关闭，可下次再试
```

**工作量调整**：1.5d → **2d**（+0.5d 加 dry-run + 备份 + retry UI）
**LOC**：80 LOC → **110 LOC**（+30）

---

## v3.1 修订 4 — Phase 6 改 per-wave QA subagent（吸收 Critical C4）

**v3 问题**：22 dev-days sprint 单次 QA subagent diff summary 过大，违反 CLAUDE.md "Evidence efficiency" (8 screenshots/UX + 8/QA)。

**v3.1 改为 per-wave QA**：

```
Phase 6: per-wave QA subagent (incremental)
├── Wave 1 完成 → QA subagent 验 STORY-00505/506/509
├── Wave 2 完成 → QA subagent 验 STORY-00507/508/510
├── Wave 3 完成 → QA subagent 验 STORY-00511/512
├── Wave 4 完成 → QA subagent 验 STORY-00513
├── Wave 5 完成 → QA subagent 验 STORY-00514/515/516/523
├── Wave 6 完成 → QA subagent 验 STORY-00517/518/521
└── Wave 7 完成 → QA subagent 验 STORY-00519/520

Phase 7: sprint-end 整合验证
├── Final Arch subagent (整体架构 review)
├── Final UX subagent (4 画像 e2e walkthrough)
└── Final navigation regression
```

**Evidence budget 分摊**：每 wave QA ~4 screenshots，total 28 screenshots，符合 CLAUDE.md 精神。
**Phase 6 时间**：single-pass → incremental，**+1d 验证时间**

任一 wave QA 不通过 → 该 wave stories 修复 → 重跑该 wave QA subagent（无上下文，独立）。

---

## v3.1 修订 5 — Edit 状态持久化 + Alpine corridor 标注（吸收 Critical C5）

### 5.1 加 STORY-00523 EditSessionPersistence（P0）

**问题**：iOS 后台 30min 自动回收，edit 中途 app 被 kill，midpoint drag 中途断电 → 用户回到 app 应该 resume edit 还是 discard？

**v3.1 设计**：
- Edit 模式进入时 → AsyncStorage 写入 `edit_session_active`：
  ```ts
  {
    sessionId: uuid,
    routeId: string,
    enteredAt: timestamp,
    workingPoints: RoutePoint[],
    segments: RouteSegment[],
    history: EditSnapshot[],  // for resume
  }
  ```
- App resume 时检测 `edit_session_active` 存在 → 弹 modal：
  - "你有一个未完成的编辑（上次编辑 X 分钟前）"
  - 选项 1: "继续编辑" → 恢复 useRouteEditStore 状态
  - 选项 2: "放弃" → 清除 edit_session_active
- Edit 模式正常退出（save / cancel）→ 清除 edit_session_active
- TTL：edit_session_active 24 小时后自动失效

**工作量**：0.5d
**LOC**：~80 LOC（新增）

### 5.2 Alpine corridor 1km 限制澄清

**问题**：Edit corridor 1km radius 在 alpine 山脊线场景可能过窄（hiker 在山脊上偏离 trail 800m 是常态，绕过 scree 区）。

**v3.1 决策**：
- **本 Sprint 不做 terrain-aware corridor**（适应性算法工作量太大，需要 elevation API + 山脊检测）
- **明确加入 §16 Story 清单注释**："Alpine terrain edit corridor 适应性 → P1 / Sprint 67 backlog"
- 上线后埋点 `dijkstra_node_count_p95` + `corridor_rejected_count` 监控 alpine 场景拒绝率，决定 Sprint 67 优先级

---

## v3.1 修订 6 — 建议改进 backlog（review 给的 10 项 Medium，不阻塞但记录）

| # | 建议 | Sprint 66 处理 |
|---|---|---|
| 1 | Commit 数 12 → ≥16 | **采纳**：commit 计划改为 16 个 |
| 2 | NZ trail fixture 5 → 6（加 trail 数据缺口 case） | **采纳**：fixtures 加 1 条 |
| 3 | 埋点 16 → 19（加 route_save_failure / migrator_failure / dijkstra_node_count_p95） | **采纳**：埋点改为 19 个 |
| 4 | Mock DOC server 完整设计 | 推迟到 Wave 0 STORY-00503 实施时设计 |
| 5 | Branch 策略 | **采纳**：见下方 |
| 6 | Confidence low 状态 UI 警告条 | **采纳**：合并到 STORY-00521 EditCoachmark |
| 7 | DOC tile cache LRU evict + 用户提示 | **采纳**：合并到 STORY-00508 |
| 8 | Sprint 66 内置 dev menu toggle | **采纳**：合并到 STORY-00516 featureFlags |
| 9 | 云端 route metadata 删除路径 | 推迟 Sprint 67（需要 backend 配合） |
| 10 | Spike A NOT VIABLE → 标记 "Sprint 67 重试" | **采纳**：§18 加注释 |

**Branch 策略**：
- 本 Sprint 期间 main branch hotfix 走独立 hotfix branch（不 merge 到 sprint-66）
- sprint-66 完成后 rebase main 解决冲突
- 已在 git stash 处理过 master OTA 185 升级（之前 rebase）

---

## v3.1 工作量重估

| Phase | dev-days |
|---|---|
| Spike (A/B/C) | 2 |
| P0 开发（19 项 = v3 18项 + EditSessionPersistence） | 11 |
| First-run coachmark + LegacyMigrator dry-run + Confidence UI | 2.5 |
| expo-file-system + LRU evict UI | 0.5 |
| Buffer | 1 |
| **合计开发** | **17 dev-days** |
| Phase 6 per-wave QA (8 wave) | 1 |
| Phase 7 final review | 0.5 |
| **总计** | **18.5 dev-days** |

**用户已声明**：不按常规 sprint velocity 判断，这是 Big Sprint。23 dev-days 范围内。

---

## v3.1 Story 清单（23 个，含新加 STORY-00523）

新加：**STORY-00523 EditSessionPersistence (2 points, 0.5d)**

总点数：57 points (v3 55 + 2)

---

End of Plan v3.1.
