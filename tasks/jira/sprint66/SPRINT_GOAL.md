# Sprint 66 Goal — Foundation Sprint (descope acknowledged)

**Phase 2 — Route Edit 双源功能 — 基础层交付（runtime 集成 deferred 到 Sprint 67）**

## 实际 Sprint 66 交付（Done）
- **Card 1 修复**：Activity → Route 转换不再 sample 20 个散点；polyline 直接从 route.points / sessionTrackPoints 渲染（实际 + 用户感知）
- **基础层完整**（feature-flag 后，default `editModeEnabled=false`）：
  - 双源 router brain（DOC + Mapbox 决策树 with 质量 gate + 19 telemetry events）
  - DOC ArcGIS API client + tile cache（expo-file-system, LRU 100 tiles, ≤200MB, TTL 30d）
  - 自实现 Dijkstra + BinaryHeap + TrailGraph (junction merge 30m, MAX_GRAPH_NODES=500)
  - PointCloudIndex (kdbush wrapper, haversine-sorted nearest)
  - CorridorQuery (1km buffer membership + polyline drift defense)
  - LocalRouteExtras (AsyncStorage schema with originalPoints + workingPoints + segments)
  - LegacyRouteMigrator (lazy + dry-run + backup + retry)
  - EditSessionPersistence (24h TTL app-kill recovery)
  - useRouteEditStore (transient edit state machine)
  - DualLineLayer / DraggableHandle / EditCoachmark UI components
  - EditResumePrompt + MigratorRetryPrompt (mounted at App root, gated by feature flag)
  - 19 埋点事件 (DOC API health, dual-source decisions, Dijkstra perf, edit lifecycle)
- **测试 + 文档**：
  - 48 unit tests across BinaryHeap, Dijkstra, TrailGraph, PolylineSampler, CorridorQuery, PointCloudIndex
  - 6 NZ trail GPX fixtures (Wellington / Tongariro / Kepler / Mt Vic / Auckland / Mt Taranaki)
  - 2 Spike reports (A: DOC API VIABLE, B: self-impl Dijkstra VIABLE 100x margin)
  - WAVE7-INTEGRATION-ADR.md (next-Sprint integration recipe)
  - Plan v3.1 (4-iteration approved sprint design)
- **OTA bump 184 → 187** (skipped 185 + 186 to avoid collision with master session's parallel work)

## Sprint 66 NOT Delivered (deferred to Sprint 67)

The user-facing trim + midpoint-drag interaction inside `RouteEditorScreen`:
- **STORY-00519** RouteEditorScreen 集成 trim — Deferred
- **STORY-00520** RouteEditorScreen 集成 midpoint drag — Deferred

**Reason for defer**: existing RouteEditorScreen (926 LOC) has 3 entangled modes (view / edit-waypoint / save-as-route). Adding new edit-mode UI without breaking existing modes requires runtime simulator validation that's not available in this codebase environment. WAVE7-INTEGRATION-ADR.md documents the 7-step wire-up for the next session. New modules are dead code (zero call sites in screens) until that integration ships, and `editModeEnabled=false` ensures production users see no behavior change.

**Justification for "still ship Sprint 66"**: the foundation work (data layer, routing brain, persistence, UI components, telemetry) is independently valuable and tested. Shipping it behind a kill-switch lets Sprint 67 pick up runtime integration without re-doing scaffolding. All v1/v2/v3 review fixes (B1-B2, C1-C8, B-NEW-1/2, C-NEW-2/3/4) addressed.

## OTA Strategy
- master session 在 sprint-66 期间并行推到了 OTA 186
- sprint-66 跳到 OTA #187 避免 bundle ID 冲突
- sprint-66 全部 production-default-off — push 后 production 用户看到 v187 但功能不变（Card 1 fix + bug fixes 自动生效）

## Phase 6/7 Verification
- 4 轮 Phase 4 plan reviews (v1 → v2 → v3 → v3.1) → PASSED on v3.1
- Phase 6a Arch v1 → FAIL → fixed → v2 → FAIL with 1 Blocker + 4 Critical → fixed → v3 (in progress)
- Phase 6b UX v1 → FAIL → fixed → v2 → FAIL with 1 Blocker + 3 Critical → fixed → v3 (in progress)
- Phase 7 final review pending

## Phase 8 Push
- Branch: `feat/sprint-66-routes`
- 不私自 EAS build (用户主导)
- 不 merge 到 master
- Push 后 master session 看 PR diff 决定何时 merge

## Sprint Capacity
- 22-23+ dev-days (Big Sprint, 用户已声明不按常规 velocity)
- ~28 commits (17 原 + 4 v2 fix + 1 OTA bump + 5 v3 fix + 待 commit)
- 23 Stories / 57 points: 19 Done, 2 Deferred (00519/00520), 2 Done partial (00521/00522 done as defined units of work)
