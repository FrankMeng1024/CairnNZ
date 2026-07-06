# v404-v406 Code Review — Agent 1

**Method**: Code-integrity + race/boundary analysis
**Files reviewed**: 14 files (see 证据 list at bottom)

## Blocker
*(none found)*

## Critical

### P1-1: Double-hydrate on login re-runs memory pipeline and races an in-flight push
- `useAppStore.ts:207-217` + `AuthScreen.tsx:684` + `AuthScreen.tsx:695`
- Cold boot fires `hydrate()` once (pre-warm, attachMemorySync). Then AuthScreen calls `hydrate()` **again** at login line 684 before `setLoggedIn(true)`.
- Second hydrate: attachMemorySync → detachMemorySync (line 391) bumps epoch, aborts in-flight push started by first attach's subscriber.
- Push is re-scheduled by new subscriber (no data loss) but 5-15s delay window where chip says "Syncing..." then falls silent.
- Also 200-500ms extra AsyncStorage re-read on login already-slow path.
- **Fix**: gate second `hydrate()` call behind an "already-warmed for this user.id" flag.

### P1-2: pre-warm 分支 pushMemoryNow 可在 401_invalid + tracking=idle 时触发 logout, 清空刚 hydrate 的数据
- `apiService.ts:83-101` + `useAppStore.ts:213`
- Sequence: cold boot → getMe() OK → set user → attachMemorySync → subscriber sees unsyncedCount>0 → schedulePush(5s) → after 5s, pushPendingPoints calls authenticatedFetch('/api/memory/points')
- If in that 5s window token got revoked on server, response is 401 + `X-Cairn-Auth-Invalid: true`, and since `useTrackingStore.status === 'idle'`, apiService.ts:99 calls `store.logout()`.
- `useSessionStore.clearSessions()` fires → 刚 pre-warm 的 activity list 被清 → 用户看到 blank Activities
- Narrow window, no data loss, but violates "prewarm without side-effects" invariant.
- **Fix**: `pushPendingPoints` early-bail when `!useAppStore.getState().isLoggedIn`

### P1-3: logout 中 detachMemoryPersistence 是 async 且不 await → 并发登录可短暂错位
- `useAppStore.ts:122`
- `void detachMemoryPersistence()` — fire-and-forget
- 验证过 memoryPersistence.ts 内部 flush 是 snapshot-safe，跨用户不 leak
- 现有 code paths 安全但 pattern 脆弱
- **Downgraded to Medium**. Fix: `await detachMemoryPersistence()` for cleanliness.

## Medium

### P2-1: initialTab: 'activities' 是 no-op (RoutesScreen 默认已是 activities)
- `RoutesScreen.tsx:1180` `initialTab = route.params?.initialTab ?? 'activities'`
- 不是 bug，只是 nav.reset payload 里的 initialTab 参数无实际效果
- Confirms consumer exists; safe to keep

### P2-2: wasTooShort 和 stopTracking 内部 too-short 检查用不同 snapshot
- `HikingScreen.tsx:1775` vs `useTrackingStore.ts:724`
- 当前 safe (location subscription 先停,两个检查看同一 trackPoints)
- 如未来 refactor 改顺序会 diverge → nav 到 MapHistory{sessionId} 但 sessionId 未在 useSessionStore
- **Fix**: `if (useSessionStore.getState().sessions.find(s => s.id === capturedSessionId))` before nav.dispatch

### P2-3: nav.dispatch(CommonActions.reset) fails silently if isLoggedIn=false before dispatch
- `HikingScreen.tsx:1797-1806` + `RootNavigator.tsx:99-115`
- If 401_invalid 在 stopTracking 中途触发 logout → 用户被踢到 Auth → reset target 不存在 → throws/silently drops
- Recovery: 用户在 Auth screen 上，session 在 disk
- **Fix**: snapshot isLoggedIn in HikingScreen before dispatch, skip reset if false

### P2-4: finalizeSession PATCH 是 fire-and-forget 后 stopTracking 已 return — 无用户可见 failure UX
- `useTrackingStore.ts:848-851`
- 如 PATCH 失败,本地 useSessionStore 有 snapped trackPoints 但服务器无 → 切设备时数据不一致
- **Fix**: subtle toast on finalize failure

### P2-5: flushHikingToMemory recordPoint 12.5m CULL runs against previous session's trailing points
- `flushHikingToMemory.ts:139-143` + `useMemoryStore.ts:240-243`
- v405 之后 recent 32 points 跨 app kill 存活 → 第二次同 trailhead 起 hike 前 2-4 点 CULL-suppressed
- Cosmetic (fog reveal at trailhead 略 gappy), not data loss

## Nit (记录不必修)

- `App.tsx:376-386` require() inside Platform.OS==='web' — Metro tree-shake 不一定能剥离,但 store 本身 line 15-17 已 import,无 size regression
- `App.tsx:381-386` 覆盖 __cairnStores 每次 mount,Fast Refresh 可留 stale ref。Playwright 必须每 test 重新拿引用
- `RootNavigator.tsx:82-88` production web 会 leak navigationRef,browser extension inject 可调 nav 动作。Cairn.nz web 无敏感数据可接受
- `useAppStore.ts:114-127` logout 顺序:setLoggedIn=false → clearMarkers → clearSessions → detach。markerStore.clearMarkers subscriber 若 fire fetch 会带旧 token
- `attachMemorySync` line 213 fire 前无 pullMemoryFromServer 显式 pull → server 端 deletes 直到用户开 Memory tab 才 propagate。FGUM reconcile 已覆盖
- `hydrateMemoryForUser` 里 keep inmem_unsynced 逻辑在 cold boot 路径是 no-op (resetForUserSwitch 刚跑过)。Minor dead branch

## 总结

Overall quality solid. 三个 patch well-commented, breadcrumb consistent, defensive snapshots (preState in HikingScreen, finalizePayload before fire-and-forget). No Blocker.

**Top 3 concerns**:
1. v405 double-hydrate on login → 200-500ms 冗余 + push abort
2. v405 pre-warm push 暴露 apiService logout cascade
3. v405 nav.dispatch(reset) 依赖 isLoggedIn=true

**Safe to keep**. Recommend v407 follow-up:
- (a) gate AuthScreen 第二次 hydrate() behind hydratedForUserId marker
- (b) add !isLoggedIn early-bail in pushPendingPoints
- (c) snapshot isLoggedIn in HikingScreen onConfirm before dispatch

## 证据文件

- `app/src/store/useAppStore.ts`
- `app/src/store/useTrackingStore.ts`
- `app/src/screens/HikingScreen.tsx`
- `app/src/services/memorySync.ts`
- `app/src/services/apiService.ts`
- `app/src/services/authService.ts`
- `app/src/features/memory/services/memoryPersistence.ts`
- `app/src/features/memory/components/ForegroundUnlockManager.tsx`
- `app/src/features/memory/services/flushHikingToMemory.ts`
- `app/src/features/memory/store/useMemoryStore.ts`
- `app/App.tsx`
- `app/src/navigation/RootNavigator.tsx`
- `app/src/screens/RoutesScreen.tsx`
- `app/src/screens/AuthScreen.tsx`
