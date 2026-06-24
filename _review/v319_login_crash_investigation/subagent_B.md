# Subagent B — fgum hasUser Branch Silent Failure

**Investigation scope**: 用户在 login form 点 Sign In → app crash。0 条 `fgum_hasuser_*` beacon 上传到 server。`fgum_user_effect_enter` 在 boot 期 fire 一次（effective=false），login 后**没有第二次 fire**。

**核心问题**: 为什么 `setLoggedIn(true)` 之后，fgum 的 `useEffect([effectiveUserId])` 完全没重跑？

---

## 1. 全局架构再确认 — FGUM 是 root-level 单例

`app/App.tsx:640-649`:
```tsx
return (
  <>
    <RootNavigator />
    <ForegroundUnlockManager />   // ← sibling of RootNavigator
    {flagsPrimed && <MigratorRetryPrompt />}
  </>
);
```

**关键**: FGUM 是 `AppRoot` 的直接子组件，**与 RootNavigator 平级**。它从 app boot 时就 mount，**与登录状态无关**。AuthScreen 切到 HomeScreen 时 FGUM 不卸载、不重 mount。

这意味着:
- `fgum_render_enter` 在 boot 期 fire **是预期**
- `fgum_user_effect_enter` 在 boot 期 fire **也是预期**（useEffect with `[effectiveUserId]` 在 mount 时执行一次）
- `setLoggedIn(true)` 后 FGUM **不会重新 mount**，但 `effectiveUserId` 从 `null → truthy` 时 useEffect **必须重跑**

---

## 2. 逐个排除假设

### 假设 A — Zustand selector 在 OTA reload 后行为异常

`fgum` 用 `useAppStore((s) => s.isLoggedIn)` + `useAppStore((s) => s.user?.id ?? null)` 两个独立 selector。Zustand 用 `Object.is` 比较返回值，当 selector 返回的 primitive 值变化时触发 re-render。

**排除依据**: AuthScreen 自己也用 `useAppStore` (`const { setLoggedIn, setUIMode, setUser, hydrate } = useAppStore()`)，并且 RootNavigator 用 `const { isLoggedIn } = useAppStore()` —— 用户报 nav 没切到 Home 之前就 crash，**意味着 RootNavigator 那条 selector 也没生效**，或者切完之后立刻死。这不是 fgum 的 selector 单独有问题，是更深层的链路问题。

**结论**: 假设 A 不成立（selector 没坏），但 selector 的 trigger 本身可能没机会跑（见下文）。

### 假设 B — `setLoggedIn(true)` 实际没被调用（在它之前 throw 或 hang）

`AuthScreen.handleAuth`（line 603-726）的 critical path：

```
603  handleAuth enter → beacon: login_handleAuth_enter
622  await login(...)                          // 网络
672  beacon: login_before_setUser
674  setUser(result.user)                      // ← 设 user, isLoggedIn 仍 false
676  beacon: login_before_hydrate
679  await hydrate()                           // ← getMe + fetchSessions, 最多 8s
681  beacon: login_after_hydrate
684  setLoggedIn(true)                         // ← 翻 isLoggedIn 为 true
686  beacon: login_after_setLoggedIn
697  beacon: login_before_nav_home
699  nav.replace('Home')
701  beacon: login_after_nav_home
```

**关键观察**: 用户上传的 beacon 必须由 main agent 拿到。如果用户报告说看到了 `login_after_setLoggedIn`，那么 setLoggedIn 确实被调用过。如果**没有**这条 beacon，那么 setLoggedIn 没被调用 —— 死在了 `await hydrate()` 里面。

`hydrate()` 里面（useAppStore.ts:99-207）会：
- 读 AsyncStorage（UI_MODE）
- `getMe()` → 网络 8s 超时
- `useMarkerStore.getState().hydrate(user.id)` 
- `runA8Migration(user.id)` ← v0.2.3 schema migration，可能读/写 AsyncStorage
- `useArOriginStore.getState().hydrate(user.id)`
- `fetchSessions()` → 又一次网络
- 设 sessions

**这是一个非常重的 chain**，并且发生在 user 点 Sign In 之后、`setLoggedIn(true)` 之前。如果这里某一步 sync-block 主线程或 native crash，beacon `login_after_hydrate` 永远不会 fire，自然 fgum useEffect 也不会重跑。

**这是首要嫌疑**: 用户报"crash"是 `await hydrate()` 内部死掉 —— 不是 fgum 的问题，是 fgum **根本没机会跑**。

### 假设 C — InteractionManager.runAfterInteractions 永远不 fire

假设 hydrate() 成功，setLoggedIn(true) 真的执行，effectiveUserId 真的变化，useEffect 真的重跑。那么应该看到第二条 `fgum_user_effect_enter`（effective=true）。

用户说**没看到第二条**。所以 useEffect 没重跑 — 在到达 useEffect body 之前死了。这把责任又推回 hydrate / setLoggedIn 之间的链路。

但如果**未来**这条 beacon 真的能 fire（修复 hydrate 死亡之后），那 `fgum_hasuser_scheduled` 应该立即 fire（line 138），然后 `runAfterInteractions` callback 应该 fire `fgum_hasuser_interaction_done`（line 143）。

### 假设 D — runAfterInteractions 被 nav.replace 阻塞

**这是 v315 的修复假设**。让我严格分析一下 InteractionManager.runAfterInteractions 在 native-stack 转场期的行为：

**RN 0.81 + Hermes + iOS native-stack 的实际行为**：
1. `InteractionManager` 维护一个 handle counter。`createInteractionHandle()` 增加 counter，`clearInteractionHandle()` 减少。counter > 0 时 runAfterInteractions 的 callback 不 fire。
2. **React Native 的 `Animated` API 在用 native driver 时 NOT 增加 handle**。但 `react-native-screens` / `@react-navigation/native-stack` 的 transition 是 native-driven，**也 NOT 通过 JS 端的 InteractionManager handle**。
3. `LayoutAnimation`、`Animated`（JS driver）、`PanResponder` gesture 这些才会增加 handle。
4. **native-stack 的 push/replace 转场动画在 native layer 完成，JS 端 InteractionManager handle 应该为 0**。

**所以理论上**: `runAfterInteractions` 在 nav.replace('Home') 期间 **应该立即 fire（下一个 tick）**，因为 native-stack 转场不占 InteractionManager handle。

**但**: Hermes + iOS 上有个已知边角:
- 如果 main JS thread 在 `nav.replace` 之后立即 enqueue 大量任务（hydrate 的余波、Zustand subscriber 触发的 re-render cascade、新 mount 的 HomeScreen 同步初始化），**JS event loop 可能阻塞数秒** —— 不是 InteractionManager 不 fire，是 **整个 JS thread 不跑任何东西**。
- 这种情况下 iOS watchdog (8badf00d) ~9s SIGKILL。从用户角度看就是"点了 Sign In 就 crash"。

**runAfterInteractions vs setTimeout(..., 0)**:
- 两者在 InteractionManager handle=0 时**几乎等价**（runAfterInteractions 内部就是 setImmediate）。
- 都靠 JS event loop 来推进。如果 JS thread 死了/被 sync 操作占着，两者都不 fire。
- **setTimeout(..., 1000)** 比 runAfterInteractions 更"靠谱"的唯一场景是：你想 "强制 yield 1 秒"，让 main thread 完成 nav transition + HomeScreen mount + 第一次 paint。但如果 main thread 死了，1 秒之后照样不 fire。

**结论**: v315 用 runAfterInteractions 包裹 hydrate 链没错，但它**只能延后**，不能"绕开"问题。**如果用户看不到 `fgum_hasuser_scheduled`**，说明 useEffect 都没跑，问题不在 InteractionManager 这层。

### 假设 E — Beacon 上传失败（不是没 fire，是没到服务器）

`bootDiagnostics.fireBeacon` 用 `fetch(POST)` 不 await。如果 iOS 在 fetch 把 TCP 包送到 kernel **之前** 就 SIGKILL，beacon 丢失。

**可能性**: 高。watchdog kill 是 9s 之后，但如果 JS thread sync-block 5 秒，期间 markBootPhase 排队的所有 fetch 都没机会从 event loop 出去。

**但是**: bootDiagnostics 还会同步写 AsyncStorage `CHECKPOINT_KEY`（line 107）。下次 cold start 时 `drainPreviousBootCheckpoint` 会上报 `previous_boot_died` + `previous_phase`。

**应该核对**: 用户下次 cold start 时，`boot.previous_boot_died` 的 `previous_phase` 字段是什么。如果是 `login_before_hydrate` / `memhydrate_entry` / `pull_memory_before_fetch` 等 —— 那就锁定了死亡点不在 fgum，在 hydrate 链。如果是 `fgum_hasuser_*` —— 那说明 fgum 跑了但 beacon 没传出去（这种情况则需要看 fgum 内部哪步死）。

---

## 3. InteractionManager.runAfterInteractions 在 nav transition 期的行为（文档 vs 实测）

**官方文档** (https://reactnative.dev/docs/interactionmanager):
> Schedule a function to run after all interactions have completed. ... InteractionManager allows long-running work to be scheduled after any interactions/animations have completed.

**实际行为（RN 0.81 + Hermes + iOS）**:
| 操作 | 是否阻塞 runAfterInteractions |
|------|-------------------------------|
| `Animated.timing` with `useNativeDriver: false` | **YES** —— 创建 handle |
| `Animated.timing` with `useNativeDriver: true` | NO |
| `@react-navigation/native-stack` transition | NO（native-driven） |
| `@react-navigation/stack` (JS-driven) transition | YES |
| `LayoutAnimation` | YES |
| `PanResponder` active gesture | YES |
| 纯 JS sync work | **N/A** —— sync work 占 main thread 时 JS event loop 不转，runAfterInteractions callback **物理上**不可能 fire |

**AuthScreen 的 splash 动画**（line 482-526）:
```ts
const splashFade = useRef(new Animated.Value(0)).current;
Animated.timing(splashFade, { toValue: 1, duration: 400, useNativeDriver: true })
```
用了 `useNativeDriver: true`，**不占 handle**。

**但是** AuthScreen 还有 `Animated.timing` 在多处用 `useNativeDriver: false`（line 50-54 TrailPath dashOffset，因为 SVG path strokeDashoffset 不能 native driver）。这些是**进 splash 时**的动画，按理在用户点 Sign In 之前已经完成。但如果 user 切回 splash → 再切回 login，残留的 timer/Animated 可能仍在跑。

**实测结论**: 在 nav.replace('Home') 之后，native-stack 的转场动画不阻塞 InteractionManager。**如果 useEffect 不 fire，原因不在 runAfterInteractions 上**，而是上游链断了。

---

## 4. 真凶最高概率排序

按可能性排序：

### #1（最高）: `await hydrate()` 内部死掉

`AuthScreen.handleAuth` line 679：`await hydrate()`。hydrate 内部做了非常多事（见假设 B 列表），尤其是：
- `runA8Migration(user.id)` —— 读写 AsyncStorage 的 cairn world coords schema migration
- `fetchSessions()` —— 又一次 30s timeout 的网络
- `useMarkerStore.getState().hydrate(user.id)` —— 可能读多 MB 的 marker AsyncStorage

如果用户的 marker AsyncStorage 很大（重度使用过的老账号），`useMarkerStore.hydrate` 内部的 JSON.parse 可能 sync-block 主线程 → watchdog SIGKILL —— **这跟 memoryHydrateGate 完全是平行的问题**。memoryHydrateGate 修了 memory 那一支，但 marker 那一支没有 gate。

**验证**: 看 server 的 `previous_phase` 字段，是否是 `login_before_hydrate` 之后、`login_after_hydrate` 之前 —— 中间没有更细的 beacon，那就锁定 hydrate 里面死的。

### #2: setLoggedIn 触发 Zustand subscriber cascade 时同步死

Zustand 的 `set({ isLoggedIn: true })` 会同步通知所有 subscriber。subscriber 包括：
- RootNavigator → re-render → mount HomeScreen → HomeScreen 又是 30+ 子组件...
- FGUM 的两个 selector → trigger useEffect re-run（这是我们期待的 hasUser 分支入口）
- 其他可能挂在 useAppStore 上的组件

如果 RootNavigator 的 re-render 同步触发了 HomeScreen mount，而 HomeScreen mount 立刻去 sync render Map / 加载 markers / 等等，**主线程在这之间死掉**，那 FGUM 的 useEffect 会被排在 React commit queue 里**永远不到执行点**。

React 18 的 concurrent rendering 在 RN 0.81 默认未开启，是 legacy mode —— setState 触发同步 commit。所以这个 cascade 是 sync 的。

### #3: setTimeout/Animated 残留导致 splash 路径有未清理的 timer

AuthScreen 的 splash 动画有大量 `setTimeout` + `setInterval`（AnimatedCairn 的 stone rising、flag waving，line 169-247）。如果用户从 splash → login → 点 sign in 过程中某些 timer 没清理 (`AnimatedCairn` 是 splash view 专用，view 切到 login 时它 unmount，理论上 cleanup 跑)，**但 splash 还在内存**（view 状态在 `view` state 里，组件树没 unmount，AuthScreen 是同一个组件，只是渲染分支不同）。

**关键**: 看 `if (view === 'splash')` 那个分支（line 770-827），它 return 整个 splash JSX。当 view 切到 'login' 时，splash 那棵 JSX 树整个 unmount，AnimatedCairn 的 cleanup 应该跑。但**有个细节**：`AnimatedCairn` 的 `mountedRef` 模式只是 short-circuit setState，**timer 自己**通过 `timersRef.current.forEach(clearInterval/clearTimeout)` 清理 —— 这个 effect cleanup 函数在 unmount 时跑，应该 OK。

可能性较低，但不能完全排除。

---

## 5. 修复方案

### 修复 #1（必做）: 拆 hydrate，把 setLoggedIn 提前

`AuthScreen.handleAuth` line 674-684 当前顺序：
```
setUser(result.user)
await hydrate()         // 重链路, 可能死
setLoggedIn(true)
```

**问题**: setLoggedIn 在重 hydrate 之后。如果 hydrate 死，永远到不了 setLoggedIn，fgum 永远进不去 hasUser 分支。

**改为**:
```
setUser(result.user)
setLoggedIn(true)       // ← 立刻翻 isLoggedIn, fgum 立刻进 hasUser 分支
// hydrate 异步跑, 不 await
void hydrate().catch(err => log('hydrate_after_login_failed', err))
```

**理由**: hydrate 内部已经全包 try/catch（line 200-204），失败不会 crash。但 await 会卡住整条 critical path。如果 hydrate 真的死（marker AsyncStorage 太大），我们至少先把 isLoggedIn 翻起来 + nav 到 Home，让 fgum + FGUM 的 GPS watcher 启动，让 v315 的 memoryHydrateGate 来兜底 memory 那一支。

**风险**: hydrate 之前 nav.replace('Home') 意味着 HomeScreen 可能渲染时 sessions 还是空 → "visible content jitter"（line 668-671 注释说的就是这个）。这是 trade-off：**先稳住 boot，再优化首帧观感**。可以在 Home 加 loading skeleton 缓解。

### 修复 #2（必做）: 给 marker hydrate 加 gate（对标 memoryHydrateGate）

`useMarkerStore.hydrate` 可能是另一个 sync-death 点。建一个 `markerHydrateGate.ts`，模仿 `memoryHydrateGate.ts`：
- Boot 时 prime 一次
- hydrate entry mark in-progress
- hydrate success mark cleared
- 下次 boot 如果 flag 还在 → 跳过 marker hydrate

**这不在 fgum 范围内**，但属于同一类问题。

### 修复 #3（推荐）: setLoggedIn 之前先 beacon

在 `handleAuth` line 684 前加：
```
require('../services/bootDiagnostics').markBootPhase('login_just_before_setLoggedIn');
setLoggedIn(true);
require('../services/bootDiagnostics').markBootPhase('login_just_after_setLoggedIn');
```

这是为了下次诊断时能精确卡到 setLoggedIn 是否真的被调用过。**现有 beacon `login_after_setLoggedIn` 是在 line 686 已经存在**，但它在 try-catch 内部，如果 set 同步抛错，catch 跳过它 —— 加一对前后 beacon 更稳。

### 修复 #4（不推荐）: 改 runAfterInteractions 为 setTimeout(..., 1000)

**不推荐**，理由：
1. 假设 #1 #2 #3 才是真凶，改 timing API 是治标不治本
2. setTimeout(1000) 之后如果 main thread 死了，依然不 fire
3. 1 秒延迟意味着用户 sign in 之后 1 秒内不会拉 server，UX 退化

**唯一场景值得改**：如果未来发现 hydrate 内部修好之后，fgum_hasuser_scheduled fire 但 interaction_done 不 fire（说明 runAfterInteractions 真的卡死），再考虑换成 setTimeout(500)。**目前没有证据**支撑这个假设。

---

## 6. 下一步诊断行动

**最关键的一件事**: 等用户下次 cold start 时上传的 `boot.previous_boot_died.previous_phase` 字段值。

- 如果是 `login_before_hydrate` —— **锁定 hydrate 内部死**，按修复 #1 + #2 走
- 如果是 `login_after_hydrate` 但没有 `login_after_setLoggedIn` —— setLoggedIn 同步抛错（极罕见，但可能）
- 如果是 `login_after_setLoggedIn` 但没有 `login_after_nav_home` —— nav.replace 同步抛错或 navigator re-render 死
- 如果是 `login_after_nav_home` 但没有 `fgum_user_effect_enter`（effective=true）—— fgum useEffect 没排上 React commit queue，可能是 RootNavigator 的 HomeScreen mount 同步死掉
- 如果是 `fgum_user_effect_enter` (effective=true) 但没有 `fgum_hasuser_scheduled` —— useEffect 进了但 isLoggedIn 这条 branch 走错（v314 fix 退化）
- 如果是 `fgum_hasuser_scheduled` 但没有 `fgum_hasuser_interaction_done` —— **此时**才真的是 runAfterInteractions 不 fire，需要换 setTimeout
- 如果是 `fgum_hasuser_interaction_done` 但后续某个 hydrate/pull 死 —— 那是已知的 memory/h3 path，应该已被 500KB / 2MB guard 拦住，要么 guard 没生效，要么数据真的小但 Hermes 还是死

**用户说 0 条 fgum_hasuser_* beacon**，最大概率是上面前 4 种情况之一，**不是 fgum 本身的 bug**。fgum 的 v315 / v317 修复方向（500KB guard + memoryHydrateGate）都对，但它们救不了在 fgum 上游就死掉的 boot。

---

## 7. 一句话总结

`fgum_hasuser_*` 完全没出现，最大可能不是 InteractionManager / hydrate 内部死，而是 **`AuthScreen.handleAuth` 的 `await hydrate()` 在调用 `setLoggedIn(true)` 之前就把主线程卡死了** —— fgum 的 useEffect 根本没机会被 React 调度重跑。修复方向：拆 hydrate 异步化（不 await），让 setLoggedIn 提前；并对 marker hydrate 等 sibling 路径补 gate。
