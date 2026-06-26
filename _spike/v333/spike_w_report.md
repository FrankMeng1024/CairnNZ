# Spike W — Hiking/Running → Memory 自动导入现状

## TL;DR
**自动?** 半自动,且取决于 `recordMode` + Memory tab 是否打开过。
**用户感知?** **零反馈**。Save 后无 toast / 无动画 / 无 Memory 入口提示。
**结论**: v333 必须补缺口 — stopTracking 路径缺 bulkImport 闭环 + 用户反馈。

## 当前链路

### 路径 A — 实时记录(仅 MemoryScreen 挂载时生效)
1. `ForegroundUnlockManager.tsx:244` `Location.watchPositionAsync` 启动 GPS 监听
2. v322 起 FGUM **只在 MemoryScreen 挂载时运行**(`MemoryScreen.tsx:275`),不再 App 根挂载
3. 每个 GPS fix → `processReading` → `unlockEngine.ts:80` `useMemoryStore.recordPoint` → `useH3VisitedStore.addPointToCells` (Memory 实时更新)
4. `recordMode='session-only'`(`ForegroundUnlockManager.tsx:255`)进一步要求 tracking 状态

### 路径 B — Hiking Save 路径(stopTracking)
1. `HikingScreen.tsx:1733` `stopTracking(name)`
2. `useTrackingStore.ts:623` `useSessionStore.addSession({ trackPoints, ... })` — 写 Activity 本地存储 + 同步后端 sessions API
3. **不**调用 `useMemoryStore.recordPoint`,**不**调用 `useH3VisitedStore.bulkImport`
4. 同样 RunningScreen.tsx:310 `stopTracking()` 路径也无 Memory 导入

## 关键缺陷

**用户场景**: 用户在 Trails tab 开始 Hiking → 跑 1 小时 → 全程 **Memory tab 未打开** → 按 Save
**实际结果**:
- ✅ Activity 写入 (Activities 列表可见,后端有 route_points)
- ❌ Memory 几何无变化 (recordPoint 全程没被调用,因为 FGUM 没挂载)
- ❌ H3 cells 没更新,fog 没揭开
- ❌ 用户在 Memory tab 看不到这次徒步走过的路

即便 MemoryScreen 全程挂载: 走过的路是 incremental 揭开,但 Save 那一刻**无任何 UI 反馈**告诉用户"刚才那段已记入 Memory"。

## 用户反馈现状
- `HikingScreen.tsx:1091` `showSavedToast` 只用于 **Flag Saved**(`HikingScreen.tsx:1703-1706`),不是 session save
- StopSummarySheet `onConfirm` 关闭 sheet 后没有任何 Memory 相关提示
- 路径返回 selection 屏(`HikingScreen.tsx:1227`),无 Memory 入口红点 / 动画

## v333 阶段 1 必做

1. **stopTracking 路径补 bulkImport**: `useTrackingStore.ts:623` `addSession` 调用前后,把 `s.trackPoints` 投喂 `useH3VisitedStore.bulkImport(points.map(p => ({lat,lng,ts})))` — 与 `useMemoryStore.ts:386` 同一调用法。这是无 MemoryScreen 挂载时的兜底闭环。
2. **加视觉反馈** — 推荐组合:
   - **首选**: StopSummarySheet 内嵌"This hike has been added to your Memory"行 + 小地图缩略图显示揭开区域(模仿 Strava 的 post-activity map preview)
   - **次选**: Save 后 toast "Added to Memory" 2.5s, tap → 跳 MemoryScreen
   - **补充**: Tab bar Memory 图标加 1 个红点 / 脉冲动画,持续到用户首次打开 MemoryScreen

## 关键 file:line 索引
- `app/src/store/useTrackingStore.ts:468` stopTracking 入口
- `app/src/store/useTrackingStore.ts:623` addSession 调用(无 Memory 导入)
- `app/src/features/memory/components/ForegroundUnlockManager.tsx:244` GPS watcher(仅 MemoryScreen 挂载)
- `app/src/features/memory/screens/MemoryScreen.tsx:275` FGUM 挂载点(v322 移到此)
- `app/src/features/memory/services/unlockEngine.ts:80` recordPoint 调用点
- `app/src/features/memory/store/useMemoryStore.ts:386` bulkImport 调用模板
- `app/src/screens/HikingScreen.tsx:1724-1738` StopSummarySheet onConfirm
- `app/src/screens/RunningScreen.tsx:310` stopTracking 调用点
