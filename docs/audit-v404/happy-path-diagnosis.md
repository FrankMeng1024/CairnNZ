# Happy Path 通链诊断 — hike→save→memory→activity detail

**日期**: 2026-07-06 (post v404)
**范围**: 用户描述的核心 happy path 8 步

---

## 8 步逐点核证

| # | 步骤 | 当前状态 | 证据 |
|---|---|---|---|
| 1 | 点开 hike → HikingScreen | ✅ OK | RootNavigator.tsx:87 |
| 2 | 走一段路 GPS 正常记录 | ✅ OK | session 191 有 154 raw points |
| 3 | 切后台不影响 GPS | ✅ OK (Sprint 72 STORY-553) | 后台采样降频已挂 |
| 4 | 黑屏不影响 GPS | ⚠️ 未真机 gate | expo-location background 需 keep-awake, 未在 iOS 真机验证 |
| 5 | Save 时 snap-to-road 后保存 activity | 🟡 v404 已修代码,真机未验 | useTrackingStore.ts:829-846 已加 route_points snapped payload |
| 6 | Save 同时扩展 memory | ❌ **BROKEN** | memory_points 表新增 0 条 (test session 191) |
| 7 | 保存好自动跳 Activity Detail | ❌ **BROKEN** | HikingScreen.tsx:1777 只调 stopTracking(name), 没 nav.navigate |
| 8 | Back → activity list | ❌ **BROKEN** | 依赖 #7, 且当前 stack 中 stopTracking 后仍在 HikingScreen |
| 9 | 打开 memory → 走过路解锁 | ❌ **BROKEN** | 见 #6, memory_points 无新增 |
| 10 | 路上 mark 显示为可见 | ❌ **BROKEN** | CairnPinsLayer.tsx:89 靠 `isExplored(lat,lng)` → useMemoryStore fog 状态, 而 useMemoryStore 没有该 hike 的点 (#6 根因) |

---

## 4 处代码修复点

### 修复 1: `attachMemorySync` 时机错误 (根因: #6/#9/#10 一起中招)

**当前逻辑**:
- `attachMemorySync(userId)` 只在 `MemoryScreen` 挂载时调用 (v322 迁移, MemoryScreen.tsx:578)
- `pushPendingPoints()` (memorySync.ts:327): `if (!activeUserId) return;`
- 用户流程: 冷启 → Auth → Home → Hiking → Stop → save → pushMemoryNow() 被 stopTracking:822 await
- **如果用户从没开过 Memory tab**, `activeUserId=null`, pushMemoryNow **静默 no-op**
- 结果: memory_points 表 0 新增

**证据**:
- Grep 全 app `attachMemorySync` 消费者 = 仅 ForegroundUnlockManager.tsx:220
- ForegroundUnlockManager 仅在 MemoryScreen render 内挂载
- test session 191 已确认 memory_points=0 且 sessions.route_points 有 63 点 (说明 pushMemoryNow 走了 return early 分支)

**修复位置**: `useAppStore.hydrate` 里登录成功后调 `attachMemorySync(user.id)` (与 markerStore/sessionStore hydrate 并列)。detach 由 `logout()` 补 `detachMemorySync()`。

**影响**: 修完之后 pushMemoryNow 才有权限 POST → memory_points 有新增 → useMemoryStore 有 unlocked cells → mark 可见 (CairnPinsLayer isExplored=true)

### 修复 2: stopTracking 完成后自动 nav 到 Activity Detail (根因: #7)

**当前逻辑**:
- HikingScreen.tsx:1777 `stopTracking(name); setStopSummary(null);`
- stopTracking 是 async, 但**没有 await**, 也**没有 nav.navigate**
- UI 依赖 `status === idle` observer 回到 HikingScreen 的 selection 屏
- 用户看到自己**还在 Hiking 页,没跳去看刚刚保存的 activity**

**修复位置**: HikingScreen.tsx onConfirm handler
- await stopTracking(name)
- 从 useSessionStore 读最新 session id (刚 addSession 的)
- `nav.reset({ routes: [{ name: 'Home' }, { name: 'MapHistory', params: { sessionId } }] })`
- 用 reset 让 back 能回到 Home,再从 Home 进 activity list (Trails/Routes)

### 修复 3: back stack 语义 (根因: #8)

**当前逻辑** (修复 2 之后):
- nav.reset 到 Home + MapHistory 双栈 → back 从 MapHistory 回 Home → 用户再点 Trails 看 list

**你的期望**: back 直接回 Activity list (Trails Activities sub-tab)

**修复位置**: 修复 2 的 nav.reset 参数改成:
```
nav.reset({
  routes: [
    { name: 'Home' },
    { name: 'Routes', params: { initialTab: 'activities' } },
    { name: 'MapHistory', params: { sessionId } }
  ]
})
```
back 顺序: MapHistory → Routes (activities tab) → Home。符合 "back → activity list" 直觉。

### 修复 4: memory_points batch POST 后端联调 (次要,可能 memorySync fix 后就自愈)

**待验**:
- 修复 1 后跑一次 hike, 看服务器 `SELECT COUNT(*) FROM memory_points WHERE created_at > NOW()-INTERVAL 5 MINUTE` 是否 > 0
- 如果仍 0, 查 backend `/api/memory/points` POST endpoint 是否 400/500 (可能 payload schema 变更, 见 memorySync.ts:349 `cid` 字段)

---

## 修复顺序建议

**v405 (一次性 hotfix, 三条一起改)**:
1. `useAppStore.hydrate` — 登录成功后 attachMemorySync(user.id) + logout() detachMemorySync
2. `useAppStore.logout` — 补 detachMemorySync
3. `HikingScreen.tsx:1777 onConfirm` — await stopTracking → nav.reset 三层栈到 MapHistory

**真机验证 (v405 推后)**:
- Session 完成后, aliyun 查 memory_points 表增量 (期望 > 0)
- Activity Detail 跳转体验 (期望立刻跳)
- Memory tab 打开 → fog 已消 + mark 可见

**次要遗留 (等 v405 验证结果)**:
- 修复 4 backend batch endpoint 是否需要额外查
- 修复黑屏 GPS 真机 gate (步骤 4)

---

## Web Playwright 能验证的部分

- 修复 1: attachMemorySync 挂载时机 — 可以在 hydrate 后检查 `getSyncStatus().pendingCount` 是否响应 (需 web mock backend)
- 修复 2/3: nav.reset 后 URL 变化 → 可以断言 route name 是 MapHistory
- 修复 4: 需要真 backend, web 测不了

真机的部分 (黑屏 GPS + memory_points 实际写入 backend + Activity Detail 显示) 只能推 v405 后你亲自跑。