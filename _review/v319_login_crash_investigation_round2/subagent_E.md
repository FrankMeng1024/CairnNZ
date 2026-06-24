# Subagent E — v319 Home-1s-Crash 深度调查

**日期**: 2026-06-24
**Scope**: HomeScreen mount → +1s 内 sync execution 全枚举,锁定 SIGKILL/uncaught exception 真凶
**Method**: 代码静态分析。无访问 server beacons。

---

## 核心结论 (TL;DR)

**最可能真凶**: `replacePoints` → `setTimeout(100ms)` → `h3.bulkImport` 的 **h3-js lazy require + emscripten WASM 初始化**,在 Home mount 完成后 +100ms 触发,32 MB ArrayBuffer alloc 撞上 cold-start 的 Mapbox 内存预算 → iOS jetsam SIGKILL。

**次可能**: `useMemoryStore.subscribe(scheduleFlush)` 在 hydrate 完成后 attach,任何后续 store mutation (包括 H3 store mutation 经由 cross-store ref) 触发的 `scheduleFlush` 内的 `JSON.stringify(points)`,如果 points.length 几百,在 Hermes 内 sync block 主线程 → 看门狗 9s 杀进程。

**第三**: lucide-react-native 70+ icon import 全量加载 + Home render 时 ~20 个 Icon/SVG 实例 mount → Cumulative RSS pressure since boot,在 +1s 后 GC trigger 时撞到 jetsam threshold。

**关键问题**: 所有现有 beacon 都是 `fire-and-forget fetch`,SIGKILL/jetsam 发生时 TCP packet 还在 RN/iOS bridge 队列里 → server 0 条。`AsyncStorage.setItem` 看似 NSUserDefaults fast path,但实际上 `void AsyncStorage.setItem(...).catch()` 立刻返回 unresolved promise — 真正 write 通过 RCTAsyncLocalStorage 异步派发到 native module dispatch_queue,**SIGKILL 时这个队列也丢**。这就是 user 看到 Home 1s crash 但 server 没任何 beacon 的原因。

---

## A) Home mount → +1s 内所有 sync execution (按 React commit phase)

### Phase 0: setLoggedIn(true) fired in AuthScreen (handleAuth, line 684)
触发 RootNavigator + ForegroundUnlockManager `useEffect` 重运行的源头:
- `useAppStore.setState({ isLoggedIn: true })` → zustand subscribers 同步 fire (Hermes 内同步遍历 listener Set)
- RootNavigator subscriber 重计算 `isLoggedIn ? <HomeStack/> : <AuthStack/>` → schedule re-render
- ForegroundUnlockManager subscriber → `effectiveUserId` becomes `userId` → useEffect dep change → next commit schedules useEffect

### Phase 1: setTimeout(..., 0) — `nav.replace('Home')` (handleAuth line 711-721)
- v319 fix 把 nav.replace 延迟到下一 macro task
- **副作用**: 这个 tick 内 RootNavigator 已经收到 isLoggedIn=true,React schedule 渲染 HomeStack,但 currentRoute 还在 Auth
- 0ms 后: setTimeout fires → `nav.replace('Home')`
- React Navigation 6 用 reducer 更新 routing state → 触发 NativeStackNavigator render → Home 加入 stack

### Phase 2: HomeScreen.tsx:218-221 — `markBootPhase('home_screen_render_start')`
**Sync** in render phase. 写 AsyncStorage + fire fetch (两者都 async 但 dispatched sync)

### Phase 3: HomeScreen render body (line 222-234) sync work:
- `useNavigation<Nav>()` — hook, 读 nav context, 不重
- `useAppStore(s => s.uiMode)` — selector, 一次 store read
- `useSessionStore(s => s.sessions)` — **关键**: 返回新 hydrate 完的 sessions array. 引用变化 = re-render guaranteed
- `useMarkerStore(s => s.markers)` — 同上,markers array reference
- `getCurrentRegion()` — 读 region const, 不重
- `allMarkers.filter(m => m.regionCode === region.code)` — **同步 O(n) filter**。如果 markers 数千,这是 main thread block 候选。useMarkerStore.hydrate 用 JSON.parse 加载所有 markers (没 500KB guard,与 memory cache 不同)
- `sessions.length`, `markerCount` — O(1)
- `useRef(new Animated.Value(1))` × 3 — alloc 3 个 Animated.Value
- `useSafeAreaInsets()` — context read

### Phase 4: JSX render (line 236-337):
**Mount in 单 React commit:**
- `<SafeAreaView>` — native view
- `<StatusBar>` — RN imperative API call (`StatusBarManager.setStyle`)
- `<OtaBadge>` — see Phase 5
- `<Animated.View>` outer screen
- Header: `<CairnLogo size={28}>` (SVG) + `<Text>logo` + `<Text>greeting`
- Conditional `<View statsRow>`: 2 chips 含 Icon(Route) + FlagMarkerIcon (SVG)
- Conditional `<RecentRow>`: 如果 sessions.length>0 → 该组件 sync 跑 `sessions.reduce((best,s)=>...)` 找最新 session (O(n) over sessions). + useRef(Animated.Value) + useEffect (after commit)
- **3 个 ActivityCard** (Hiking, Running, Plant): 每个内含 `useRef(Animated.Value)`, `useWindowDimensions()`, Math.min/round, SVG icon, Text × 2, View accent line, **Icon(ChevronRight)** chevron
- **4 个 ToolBtn** (Trails, Friends, Memory, Settings): 每个 `useRef(Animated.Value)` + Icon (Route/Users/Map/Settings2) + Text label

**Total mount in this commit**: ~25 子组件,~12 个 Animated.Value alloc,~15 个 lucide-react-native SVG instances rendered。

### Phase 5: OtaBadge mount-time work (OtaBadge.tsx:1351-1472)
- 3 个 useState
- 4 个 useRef (Animated.Value)
- useSafeAreaInsets
- **3 个 useEffect** schedule (mount 后 commit phase 完成才 fire):
  - effect 1 (fade animation): pure Animated.timing,~280ms
  - effect 2 (pulse): no-op until state==='ready'
  - effect 3 (**OTA check chain**): **关键**
    - `await import('expo-updates')` — 异步 dynamic import,触发 native module bridge call
    - 如果 `Updates.isEnabled`: `Updates.checkForUpdateAsync()` 30s timeout
    - **如果 newer bundle**: setState('downloading') → `Updates.fetchUpdateAsync()` 60s timeout → setState('applying') → **setTimeout(600ms) `Updates.reloadAsync()`**
    - **reloadAsync 在 600ms 内调度 — 看起来跟 "Home shown 1s then crash" 几乎完全吻合**
    - 但: user 已经在 v319,如果 OTA 还在 v319 这条不触发。如果 v320 已发布则会。

### Phase 6: 第一次 useLayoutEffect / Animated.timing (Home 内 useEffect mount after commit):
- RecentRow useEffect (if mounted): conditional pulse animation
- ActivityCard 3× no mount useEffect
- ToolBtn 4× no mount useEffect

### Phase 7: After Home commits, ForegroundUnlockManager useEffect [effectiveUserId] reruns:
**这是核心 1 秒后真凶链:**

1. `markBootPhase('fgum_user_effect_enter')` — beacon fire-and-forget
2. **`InteractionManager.runAfterInteractions(() => { ... })`** — 等所有当前 InteractionHandle 释放 + 所有 RAF 完成 + UIManager flush
3. **默认 RN InteractionManager 等到所有 `Animated.timing` / `Animated.spring` 结束**。 Home 内 12 个 Animated.Value 都没 timing 启动 (只有 ActivityCard onPress 才 spring),OtaBadge fade timing 280ms → InteractionManager 大约在 **300-500ms 后** fire
4. Fire callback (fgum_hasuser_interaction_done beacon)
5. Async chain starts:
   - `detachMemorySync()` — sync
   - `resetUnlockEngineForUser()` — sync
   - `useMarkerStore.getState().clearMarkers()` — sync, set markers=[]
   - **`await hydrateH3ForUser(effectiveUserId)`**:
     - `markBootPhase('h3hydrate_entry')` fire
     - `await detachH3Persistence()` — fast
     - `useH3VisitedStore.getState().clear()` — sync
     - **`await storage.getItem(h3 storage key)`** — AsyncStorage read,可能 hundreds of KB
     - **`JSON.parse(raw)`** 如果 raw.length <= 500KB (Hermes 内 sync block 主线程)
     - `replaceCells(decoded)` — sync, Map alloc
   - **`await hydrateMemoryForUser(effectiveUserId)`**:
     - `markBootPhase('memhydrate_entry')` fire
     - `useMemoryStore.getState().resetForUserSwitch()` — sync
     - `await storage.getItem(memory key)` — 可能上 MB
     - 如果 >500KB: skip parse (v315 guard)
     - 如果 <=500KB: `JSON.parse(raw)` (sync) — points 数百
     - **`replacePoints(decoded.points, ...)`** — sync set + **`setTimeout(() => h3.bulkImport(...), 100)`**
   - `attachMemorySync(effectiveUserId)` — sync
   - `void pullMemoryFromServer(effectiveUserId)` — async fetch

### Phase 8: +100ms 后 setTimeout in replacePoints fires:
**这是最强候选真凶:**

1. `markBootPhase('replacepoints_settimeout_fired')` fire
2. `useH3VisitedStore.getState().clear()` — sync
3. **`h3.bulkImport(snapshot)`**:
   - `markBootPhase('h3_bulkimport_called')` fire
   - **`getH3()`**: 内部 **`require('h3-js')`** **第一次加载** → h3-js 是 WASM 模块,触发 emscripten init:
     - alloc 32 MB ArrayBuffer (heap buffer per emscripten default)
     - parse WASM bytecode (sync)
     - link imports (sync)
     - run __start
     - **整个过程 ~500-1500ms sync 在 Hermes 主线程**
   - 这是 v306 commit log 自述的"h3-js lazy load → 32 MB ArrayBuffer alloc"
   - **在 cold start memory pressure 高时,32MB alloc 触发 iOS jetsam → SIGKILL**

### Phase 9: 如果 h3 加载成功,bulkImport 进入 chunked loop:
- CHUNK_SIZE=50, every chunk → setTimeout(0) yield
- 581 points = 12 chunks × 50ms each
- 这部分被 v311 chunked 之后已经不会触发 watchdog,但 emscripten init 仍是单个 sync block

### Phase 10: 同时,attachMemorySync 内的 useMemoryStore.subscribe(scheduleFlush) 已经 attach:
- replacePoints 触发了 set({points,...}) → subscribers fire
- attachMemorySync 在 replacePoints **之后** 调用,所以这次 subscribe 还没生效
- 但**后续每个**: replacePoints 完成后 setTimeout 内 set({cells, cellVersion+1}) on H3 store — 不触发 memory subscribe
- 但: pullMemoryFromServer 返回后 setState → fires subscribe → `scheduleFlush`:
  - debounced 但当 trigger 时 `JSON.stringify(points)` sync — 几百点不致命

---

## B) 锁定最可能 sync block 的具体行 (按概率排序)

### #1: `useH3VisitedStore.ts:86-91` — h3-js dynamic require
```ts
// 大约在 line 86-91
h3Ref = require('h3-js');
```
**问题**: 第一次 require 在 InteractionManager fire 后 + 100ms,即 Home 可见 ~600-1100ms 后。`require('h3-js')` 触发 Metro bundle resolve + emscripten WASM 加载。在 v305+v306 之前这个发生在 Home render path 内,v306 commit log 明确说"deferred to setTimeout(0) 让 cold start memory pressure 释放"。**v311 改成 100ms**。

**为什么会 SIGKILL**:
- Hermes 加载 h3-js JS shim 不重 (~100KB JS),但 emscripten WASM heap alloc 32MB
- Mapbox 已经在 OtaBadge / Memory tab 准备 mount tile cache (~50-100MB)
- iOS jetsam threshold ~250-400MB depending on device
- Cold start 内 RN bridge + JS heap + Mapbox + h3 alloc = jetsam likely

### #2: `useMarkerStore.ts:343-357` — markers JSON.parse 无 size guard
```ts
hydrate: async (userId: string) => {
  const raw = await storage.getItem(key);
  if (raw) {
    const markers: Marker[] = JSON.parse(raw);  // ← 无 500KB guard
    set({ markers, userId });
  }
}
```
**问题**: 跟 memory hydrate 不一样,marker hydrate 没 MAX_RAW_BYTES guard。如果用户 8 个 seed cairn + 自己 plant 过 marker,JSON.parse 可能 sync block。但这个发生在 useAppStore.hydrate **登录前**,因此不是 1 秒 crash 的诱因 — 已在 hydrate 完成。可排除。

### #3: HomeScreen.tsx:227 — markers filter sync
```ts
const markerCount = allMarkers.filter(m => m.regionCode === region.code).length;
```
**问题**: 每次 useMarkerStore 内 markers 变化都 re-filter。但只在 markers ref 改时触发,且 O(n) 几千以内不致命。

### #4: HomeScreen.tsx:112 — sessions.reduce 找最新
```ts
const last = sessions.reduce((best, s) => s.startedAt > best.startedAt ? s : best);
```
**问题**: 同 #3,O(n) over 几百 sessions 不致命。

### #5: OtaBadge OTA reloadAsync
**问题**: 如果 server endpoint 返回更新 bundle,600ms 后 reloadAsync 在 user 眼里就是 "crash"。但 user 是在 v319,如果 v320 已发布则会触发 — 不是 crash,是 OTA reload。可在 server logs 看是否有 v320 manifest 请求。

---

## C) Beacon 添加建议 (在 HomeScreen 各阶段加 markBootPhase)

**问题**: 当前 HomeScreen 只有 line 220 `home_screen_render_start` 一个 beacon,之后整个 render + mount + 1s 后的工作全是黑盒。

**建议加点位:**

```ts
// HomeScreen.tsx render body
export function HomeScreen() {
  markBootPhaseSafe('home_render_enter');         // 入函数
  const nav = useNavigation<Nav>();
  const uiMode = useAppStore(s => s.uiMode);
  markBootPhaseSafe('home_after_uiMode');
  const sessions = useSessionStore(s => s.sessions);
  markBootPhaseSafe('home_after_sessions', { n: sessions.length });
  const allMarkers = useMarkerStore(s => s.markers);
  markBootPhaseSafe('home_after_markers', { n: allMarkers.length });
  const region = getCurrentRegion();
  const markerCount = allMarkers.filter(...).length;
  markBootPhaseSafe('home_after_filter');
  // ...
  // RIGHT BEFORE return JSX:
  markBootPhaseSafe('home_before_jsx_return');

  // INSIDE the JSX return, just before </SafeAreaView>:
  // (use a tiny sync effect via inline JSX is tricky; better: add a child useEffect 0)
}

// Add useEffect at top of HomeScreen body AFTER refs:
useEffect(() => {
  markBootPhaseSafe('home_mounted_first_commit');
  // schedule a +500ms beacon to confirm we survived the 1s death window
  const t1 = setTimeout(() => markBootPhaseSafe('home_alive_500ms'), 500);
  const t2 = setTimeout(() => markBootPhaseSafe('home_alive_1500ms'), 1500);
  return () => { clearTimeout(t1); clearTimeout(t2); };
}, []);
```

**OtaBadge 内加点位**:
```ts
useEffect(() => {
  markBootPhaseSafe('otabadge_mount_useeffect_run');
  // ...
  (async () => {
    markBootPhaseSafe('otabadge_async_enter');
    const Updates = await import('expo-updates');
    markBootPhaseSafe('otabadge_after_import_updates');
    // ...
    if (result.isAvailable) {
      markBootPhaseSafe('otabadge_update_available_will_download');  // ← 关键!
    } else {
      markBootPhaseSafe('otabadge_no_update');
    }
  })();
}, []);
```
**如果 user crash 时这个 beacon `otabadge_update_available_will_download` 命中 → 真凶是 OTA reload,不是 crash**。

**h3 init beacon (已存在 `h3_get_called`,但加更细)**:
```ts
function getH3() {
  markBootPhaseSafe('h3_get_called');
  // gate checks ...
  try {
    markBootPhaseSafe('h3_before_require');
    h3Ref = require('h3-js');
    markBootPhaseSafe('h3_after_require');
    return h3Ref;
  } catch {
    markBootPhaseSafe('h3_require_failed');
    // ...
  }
}
```

---

## D) **不依赖 fire-and-forget fetch 的 beacon mechanism 设计**

### 当前 mechanism 缺陷:
1. `fetch().catch()` 派发到 RN Networking 模块 → libfetch → CFNetwork → TCP socket。SIGKILL 时 socket buffer 全丢。
2. `AsyncStorage.setItem` 派发到 RCTAsyncLocalStorage dispatch_queue (background QoS) → SQLite write OR NSUserDefaults write。SIGKILL 时未执行的 dispatch_queue items 全丢。
3. `void` 包装意味着即使原本 sync 阻塞也不等待 — write 几乎 100% lost。

### 设计 A: Synchronous NSUserDefaults via Native Module (推荐)
**原理**: NSUserDefaults 的 `setObject:forKey:` 是 sync API,直接写 in-memory plist + 异步 background flush 到磁盘。即使进程被 SIGKILL,**已经 set 的 key/value 在内存中至少**;如果 iOS 已经 flush 过(每 ~3 秒 auto-flush),磁盘上有。下次启动读到。

**实现**:
```objc
// CairnSyncBeacon.m (native module)
RCT_EXPORT_METHOD(writeCheckpointSync:(NSString *)phase
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *d = [NSUserDefaults standardUserDefaults];
  NSDictionary *cp = @{@"phase": phase, @"ts": @([[NSDate date] timeIntervalSince1970] * 1000)};
  [d setObject:cp forKey:@"cairn_boot_sync_checkpoint"];
  [d synchronize];  // 强制 flush (iOS 12+ no-op but kept for safety)
  resolve(nil);
}
```

但: TurboModule async 仍 dispatched to a queue。**真正 sync 写法只在 JSI module**:
```cpp
// CairnSyncBeaconJSI.cpp
void writeCheckpointSync(jsi::Runtime& rt, const std::string& phase) {
  NSUserDefaults *d = [NSUserDefaults standardUserDefaults];
  NSDictionary *cp = @{@"phase": @(phase.c_str()), @"ts": @([[NSDate date] timeIntervalSince1970] * 1000)};
  [d setObject:cp forKey:@"cairn_boot_sync_checkpoint"];
  // No need to call synchronize - iOS auto-flushes within seconds
}
```
JSI bind → JS 端调用 `global.__cairnWriteCheckpoint(phase)` 完全 sync,直接 NSUserDefaults memcpy。**SIGKILL 时,只要 iOS auto-flush 过(~3s 内一次)→ 磁盘有记录**。

下次 boot 读 `[NSUserDefaults standardUserDefaults]` 立即可见。

### 设计 B: Sequential markBootPhase + setTimeout(0) yield
**没原生模块的最快办法**: 用现有 AsyncStorage,但 **每个 markBootPhase 后强制 yield 给 event loop**,让 dispatched native call 有机会执行:

```ts
async function markBootPhaseFlushable(phase: string, extra?: any): Promise<void> {
  markBootPhase(phase, extra);  // sync 派发 fetch + AsyncStorage
  // Yield to event loop — native module dispatch_queue 有 ~5-50ms 执行
  await new Promise(r => setTimeout(r, 0));
}
```

**问题**: 改一堆调用为 await; 且 RN AsyncStorage 用 background QoS dispatch queue,setTimeout(0) yield 给 JS event loop 但 native module 在另一线程,JS yield 不强迫 native flush。所以 B 不可靠。

### 设计 C: Console.log via native iOS log + DevTools HTTP (开发期)
仅 DEV/TestFlight: `RCTLog.log(phase)` 写入 NSLog → asl_log → 系统 log。可通过 Console.app 取回。**对 user 现场 crash 无用** — user 没法导出 system log。

### 设计 D: AsyncStorage + 高频 setTimeout pumping
```ts
// 在 fgum_hasuser_scheduled 之后,启动一个 100ms 心跳:
let heartbeatPhase = 'home_alive';
const heartbeat = setInterval(() => {
  // Each beat overwrites the previous, so on SIGKILL the LAST one
  // is what survives via NSUserDefaults auto-flush
  AsyncStorage.setItem('cairn_boot_heartbeat', JSON.stringify({
    phase: heartbeatPhase,
    ts: Date.now(),
  })).catch(() => {});
}, 100);

// 关键操作时更新 phase:
heartbeatPhase = 'before_h3_require';
// h3 加载...
heartbeatPhase = 'after_h3_require';
```
**优点**: 不需要原生模块。每 100ms 心跳 → NSUserDefaults auto-flush 周期 ~3s → SIGKILL 时最后 100ms 内的 phase 大概率持久化。
**缺点**: heartbeat 高频 setItem 本身有少量 CPU 成本 (~0.1ms each)。

### 设计 E (**推荐结合 A + D**):
1. **JSI sync native module** (设计 A) — 关键路径 (h3_before_require, otabadge_before_reload, ...) 用这个,**完全 sync**,绕过任何 dispatch
2. **AsyncStorage 心跳** (设计 D) — 在每个 awaitable boundary 启动,捕捉不可预测的 SIGKILL
3. 下次 boot 在 `drainPreviousBootCheckpoint` 同时读 `cairn_boot_sync_checkpoint` (NSUserDefaults via Native Module sync getter) 和 `cairn_boot_heartbeat` (AsyncStorage),取 ts 最大者作为"最后一次活动 phase"上报。

**实现 priority**: 直接做 D (零原生改动,30 分钟可写完)。如果 D 还抓不到,做 A。

---

## E) 关键不确定性 + 待验证

1. **OTA reload 假说**: 如果 server 上 v320 已发布,user 看到的"crash"实际是 OTA reloadAsync。**验证方法**: 查 aliyun server 上 `/api/edit-diag` 或 `/api/manifest` 的请求 log,看是否有 v320 manifest 被 fetched 之后用户 session 中断。
2. **h3-js init 假说强但未验证**: 是否真的发生在 Home +1s 取决于 InteractionManager fire 时机。InteractionManager 在 RN 上是基于 "no pending interaction handles" — OtaBadge fade animation 是 useNativeDriver=true 的,**不创建 InteractionHandle**。所以 InteractionManager 可能更早 fire,h3 init 可能在 +200-500ms 而非 +1000ms。但 Home 已 mount 此时间内,user 仍能看到 Home 一会儿。
3. **lucide-react-native 70+ icon 全量 import**: Icon.tsx line 6-49 全量 import 即使 Home 只用 4-5 个 (Route, Users, Map, Settings2, ChevronRight)。这是 module-level cost,在 HomeScreen 被 React Navigation lazy-mount 时第一次 require Icon.tsx 触发。但 setLoggedIn → HomeScreen 之间,Icon.tsx 实际上**还没被 require** (HomeScreen 文件本身可能也是 lazy)。这是 Home mount 时的额外 RSS bump,叠加在 h3 init 之上加剧 jetsam 风险。

---

## F) 立即行动建议 (按优先级)

1. **立即加 Home 内 5 个 beacon + heartbeat** (设计 D):
   - `home_render_enter`, `home_before_jsx_return`, `home_mounted_first_commit`
   - `home_alive_500ms`, `home_alive_1500ms` (via setTimeout 在 useEffect)
   - heartbeat interval 200ms updating `cairn_boot_heartbeat` AsyncStorage
2. **OtaBadge 加 `otabadge_update_available_will_download` beacon** — 排除 OTA reload 假说
3. **h3 init 加 before/after require beacon**(`h3_before_require`, `h3_after_require`) — 锁定是否 require 本身 SIGKILL
4. **下次 user 试 v320 后**:
   - 拉 server beacon 流 + drainPreviousBootCheckpoint 上报
   - 优先看 `previous_boot_died` 的 `previous_phase` — 这个是 AsyncStorage 持久化的,最可靠
5. **如果 v320 beacon 仍捕捉不到**: 实现设计 A 的 JSI sync native module(需新 EAS build,但只在 Sprint 末尾推)

---

## G) 结论 — 单一最佳猜测

**Home shown 1s then crash = h3-js lazy require + emscripten WASM 32MB alloc 撞 iOS jetsam threshold**, fired by `replacePoints → setTimeout(100)` in `hydrateMemoryForUser` 链(在 InteractionManager fire 后 ~500ms,即 Home 可见后 ~1000ms)。

**为什么 server 0 beacon**:
- `markBootPhase` 内 `fetch()` 是 fire-and-forget,SIGKILL 时 TCP buffer 丢
- `AsyncStorage.setItem` 是 dispatched async,SIGKILL 时未执行 enqueue 丢
- jetsam SIGKILL 来自 kernel,RN/JS 完全无机会执行任何 final flush

**修复方向**:
- 短期: 把 `h3.bulkImport` 从 Home post-mount 路径拆出,完全 defer 到 Memory tab 真正打开时再加载(zero cold-start cost)
- 中期: 把 h3-js 改 worker thread / WebView 内加载,避免主线程 32MB alloc
- 诊断: 心跳式 AsyncStorage 检查点(设计 D)+ JSI sync 写入(设计 A)
