# v404-v406 Code Review — Agent 2

**Method**: 用户产品场景 (6 种) + DB 真数据视角
**Files**: 15+ 文件 with SSH aliyun 交叉验证

## Blocker
*(none — but 有 2 个 Critical 接近 Blocker)*

## Critical (Agent 2 独家发现)

### C2-1: v404 破了 Sprint 72 STORY-00551 (UnfinishedSessionBanner regression)
- `useAppStore.ts:276-296` hydrate 里 set `pendingSessionResume`
- 但 v404 保证冷启 `isLoggedIn=false`,RootNavigator (RootNavigator.tsx:117-121) 只渲染 AuthScreen
- HomeScreen 里的 `<UnfinishedSessionBanner />` (HomeScreen.tsx:372) **不 mount 直到用户手动登录**
- **场景 B 后果**: iOS jetsam 杀 JS → 用户重开 → hydrate 检测 unfinished session → set pendingSessionResume → **AuthScreen 完全看不到 banner** → 用户以为 hike 丢了 → 手动重登 → **此时**才看到 banner
- **违反 Sprint 72 STORY-00551 AC**,useAppStore.test.ts 只测 isLoggedIn/user,没测 pendingSessionResume 可见性
- **Regression**,需 v407 修

### C2-2: 弱网 finalize fire-and-forget → server route_points=null + 本地 snapped 不一致
- `useTrackingStore.ts:848-851`
- v404 拆分后 finalize 依然 fire-and-forget,`addSession()` (854 行) 已同步写本地
- **场景 C 后果**: 弱网 → snap ok → pushMemoryNow await 挂 30s (fetchWithTimeout HTTP_TIMEOUT_MS) → finalize IIFE 未 await 直接进 fire-and-forget → 用户按 Back / kill app → **服务端 route_points=null, client 本地已存 snapped**
- 下次冷启 fetchSessions 返回空 route_points 的 row,MapHistory 打开空线
- v403 是 fire-and-forget,v404 依然 fire-and-forget,payload 变了但**"finalize 失败=数据不一致"没解决**
- session 193 是快网成功,不能反证。真机建议关 Wi-Fi 只留 3G 复现

### C2-3: hydrate + FGUM 双次 attachMemorySync,abort in-flight push
- `useAppStore.ts:213` + `ForegroundUnlockManager.tsx:220`
- 用户 login → RootNavigator 渲染 → 点 Memory tab → FGUM mount → 再调 attachMemorySync → detach 一遍 abort in-flight push
- **场景 A/D 后果**: stopTracking 的 pushMemoryNow 在此时 in-flight 会被 abort。memory_points 丢一次批次(下次 5s debounce 后重推)
- v406 replay 没触发因为 replay 直接操 __cairnStores 不走 FGUM 挂载
- 真机上"hike → save → 立即点 Memory tab"必命中
- **和 Agent 1 P1-1 重复但角度不同** (Agent 1 说 AuthScreen 里第二次 hydrate,Agent 2 说 FGUM 挂载时第二次 attach)

## Medium

### M2-1: pendingSessionResume 24h stale silent-end 未 finalize server row
- `useAppStore.ts:290`
- stale > 24h 只 removeItem AsyncStorage,**没** call finalize/discard
- server 上 v404 期间产生的 orphan session 永远 "半 finalized",依赖 24h 后 client stale check 本地清 marker,server row 无人管
- 修: 应同步 discard 或 finalize with empty payload

### M2-2: HikingScreen onConfirm 无 try/catch → StopSummarySheet 挂
- `HikingScreen.tsx:1789`
- 如 pushMemoryNow 超时抛出,await reject,onConfirm async fn 抛出到 React 事件循环
- StopSummarySheet 不 unmount (setStopSummary(null) 也没执行) → 用户看不到任何反馈
- **场景 C 二次后果**
- 修: onConfirm 加 try/catch,失败也 setStopSummary(null) + 显示 toast

### M2-3: v404 route_points fallback 逻辑在 no-token 场景兑现不了 3-field 承诺
- `useTrackingStore.ts:842`
- 期望: snapped 优先,失败用 Kalman,再失败用 raw
- 但 snappedTrackPoints 是本地变量,只在 mapboxToken 存在且 snap ok 时 set
- 如无 EXPO_PUBLIC_MAPBOX_TOKEN → snappedTrackPoints=null → 直接跳 s.trackPointsSmoothed
- UI 显示 Kalman-smoothed(带 alt/speed/accuracy 六字段)→ server route_points 是六字段
- **v404 "snapped 只有 3 字段"承诺在 no-token 场景不兑现**

### M2-4: RootNavigator navigationRef 在 native build 也创建
- `RootNavigator.tsx:20` `createNavigationContainerRef()` module-level 调用,无 Platform 门
- native bundle 里这个 ref 依然创建、传给 NavigationContainer (line 77)
- tree-shake 只对 line 82-88 的 web 分支生效,不是 v406 commit 说的 "整段"
- 攻击面小但存在 (dSYM 可反查 `navigationRef` symbol)
- **tasks/errors.md 上线前必删清单需要多加一项**

## Nit

- memorySync.ts:349 client_id 有 32-char / 36-char 两种,不都是 uuidv4 (36 with hyphens)。session 193 里的 cid 是 v406 web replay 生成的绕过了 app uuidv4
- useAppStore.ts:220-244 fetchSessions 覆盖本地时 trackPoints:[] 会清本地 (不是 v404 引入的老 bug)。v405 弱网 finalize 失败场景中会放大: 本地 trackPoints 存活但下次 cold boot 被清

## 场景 A-F Summary

**A (双次冷启 attach)**: idempotent 保证不 leak subscriber 但 abort in-flight push → C2-3
**B (jetsam 后 banner)**: v404 STORY-00551 regression → C2-1
**C (弱网半 finalize)**: server route_points=null + client 本地 snapped → C2-2
**D (hydrate 未完 FGUM mount)**: 因 v404 isLoggedIn 冷启 false, FGUM 挂载不会与 hydrate 时序竞态。但 login 后立刻 Memory tab 触发 C2-3
**E (Save 完立刻 Cancel)**: **最新发现** —— onCancel resumeTracking 只 restart durationInterval,不 restart incrementalFlushInterval/drainInterval/tokenRefreshInterval。用户以为 resume,实际 60s 后没 backup, 8h 后 token 无 refresh
**F (nav.reset stack)**: CommonActions.reset unmount 老 MapHistory,GC 清。gesture disabled 挡住 iOS swipe back。**主要风险**: reset 到 MapHistory{sessionId} 用的是 local id (preState.sessionId) 不是 remoteId。MapHistoryScreen 若期望 remoteId 检索会拉不出

## 总结 5 句

1. **v404 破了 Sprint 72 STORY-00551 (UnfinishedSessionBanner)** — 没 test 到的 regression。
2. **v405 pushMemoryNow synchronous await 无 timeout wrapper** — 弱网场景 stopTracking 从 fire-and-forget 变"最多 30 秒卡 sheet",onConfirm 抛错无 catch UI 挂。
3. **v406 __cairnStores tree-shake 不完整**,navigationRef module-level 创建 native 也生效 — 上线清单需加。
4. **DB session 193 v406 只证明快网成功**,不能证明弱网/无 token fallback 分支。真机应跑 3 组: 有网有 token / 有网无 token / 无网。
5. **memorySync 双 attach 最容易真机上踩到** — 用户登录后点 Memory tab 就触发,尚无 telemetry 覆盖。建议 v407 加 breadcrumb `memory_sync:attach_epoch_bump from=N to=N+1 reason=<caller>`。
