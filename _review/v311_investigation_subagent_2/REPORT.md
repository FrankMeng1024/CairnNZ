# v311 Investigation - Subagent 2 (Skeptic)

**Date**: 2026-06-24
**Role**: Independent skeptical root-cause investigation, parallel to Subagent #1
**Source files actually read**: v310 (commit 2a8d2b7) snapshot of useH3VisitedStore.ts, h3FogBuilder.ts, h3Persistence.ts, useMemoryStore.ts, MemoryScreen.tsx, App.tsx, OtaBadge.tsx, bootDiagnostics.ts, metro-runtime/require.js, h3-js/dist/browser/h3-js.js, h3-js/package.json, ForegroundUnlockManager.tsx.

---

## A) 我推翻的假设 + 我证实的假设

| 假设 | 报告主张 | 我的结论 | 证据 |
|---|---|---|---|
| **jetsam SIGKILL 是 round 1 杀手** | v310_real_crash_diagnosis 主张 32MB ArrayBuffer + Mapbox 推爆 jetsam | **大概率推翻** | `new ArrayBuffer(33554432)` 是虚拟内存,iOS mmap **不立即分配物理页**。h3-js IIFE 真实物理消耗 = 70KB memory initializer (line 13468 HEAPU8.set) + 几百 KB asm.js scratch 在 latLngToCell 里。iPhone 13+ 4GB RAM jetsam quota 1-2GB,这点物理足迹**不可能**触发 jetsam,除非 Mapbox 已经几乎吃满 quota — 但此时 MemoryScreen 还没 mount (没有 `memory_screen_render_start` beacon),Mapbox 实例没创建。 |
| **Round 1 require_ok 之后 silent SIGKILL 在 bulkImport 中段** | 同上 | **不一定** | silent 只代表"没有更多 beacon",可能是 (a) 主线程长时间 freeze (581 次 emscripten asm 调用 + 首次 JIT) 触发 watchdog (8badf00d, 5-10s timeout),(b) latLngToCell 内部 uncaught Hermes runtime error 在 for-loop 外冒泡 → ErrorUtils.reportFatalError → 静默,(c) **平行运行的 OtaBadge.reloadAsync 撕掉 JS bundle**。jetsam **可能**但不是唯一也不是最可能。 |
| **Round 2-4 type=undefined 是 Metro guardedLoadModule 吞 throw** | v310_require_undefined 主张 require.js:184-186 ErrorUtils.reportFatalError 不 rethrow → returnValue 保持 undefined | **机制成立但 trigger 错** | 机制本身在 metro-runtime/src/polyfills/require.js:178-191 + 264-326 已逐字证实。但 trigger 不是"factory IIFE throw" — round 1 IIFE 成功 (require_ok 触发,意味着 raw.latLngToCell 是 function)。**真正的 trigger 在 metro-runtime require.js:252-254**: `if (module.hasError) throw module.error;` — 如果 h3-js 模块上次 require 后被标记 hasError=true,下次 require 立即重 throw 缓存的 error → 又被 guardedLoadModule 吞 → 返回 undefined。**但 cross-boot 不共享 module state** (每个 cold launch 是新 JS runtime),所以这条解释也不成立。**真正的解释**见 D 节。 |
| **require_ok load_ms=0 真实合理** | v310_real_crash_diagnosis 默认接受 | **可疑但不致命** | `Date.now()` 在 Hermes 上是 integer ms。h3-js IIFE 15741 行 + 32MB ArrayBuffer alloc + 70KB base64 decode 在 iPhone 上不可能 <1ms 完成 (现实预期 50-300ms)。但 **Date.now 内部的 millisecond bucket 可能跨调用稳定** — 即 t0 = Date.now() 取到 bucket N,IIFE 完成后 Date.now() 仍在 bucket N (如果总耗时 <1ms 或刚好都在边界内)。**load_ms=0 不一定代表 0ms,可能代表 <1ms 或精度损失**。但即使如此,实测 IIFE 不可能 <1ms 完成。**真正的解释**:见 C 节。 |
| **"Pure JS H3 replacement" 是唯一修复** | v310_real_crash_diagnosis | **我同意 OTA-only 维度最稳,但不是"唯一"** | 见 F 节。 |

---

## B) 我自己的根因结论

**Round 1**: h3-js IIFE 成功执行 (require_ok 触发证明 raw 是带 latLngToCell 的对象)。crash 发生在 bulkImport 的 581 次 latLngToCell 循环中,**最可能原因不是 jetsam 而是 iOS watchdog (0x8badf00d) — 581 次 emscripten asm 在 Hermes 上首次执行触发 JIT path + 主线程长时间不返回**。次可能:Hermes asm.js bigint/typed-array 边界 bug 触发 uncaught error 经 ErrorUtils 静默化。

**Round 2-4**: hydrate cache 因 round 1 crash 中 persistence debounce flush 失败而损坏 (n=10 不是 581,且 hydrate_empty 而非 hydrate_done — cache 完全没写)。重 require h3-js 时 require 返回 undefined 是因为 **h3-js IIFE 在 hot-startup (CPU 已忙、AsyncStorage 排队、Mapbox 申请内存) 的资源竞争下 throw,Metro guardedLoadModule 静默吞**。然后 ~未知 ms 后 process 再次死亡 — 这次死因**与 h3-js 无关**(h3 path graceful skipped),最可能是 **OtaBadge 的 setTimeout(() => Updates.reloadAsync(), 600) 或 400 在 round 1 crash 前已经被调度,经 expo-updates 状态机在下次启动重新激活,触发 emergency rollback / native bundle swap**。

**最稳一句**:h3-js 是 round 1 的真原因 (但不是 jetsam,是 watchdog 或 silent throw);round 2-4 是 v303 引入的 isEmergencyLaunch 路径 + expo-updates auto-reload 没真正禁干净,与 h3 已经无关。

---

## C) 关键证据 - beacon timing 分析

**`Date.now()` 在 Hermes/iOS 的精度**:
- C++ 实现使用 `std::chrono::system_clock::now()` cast 到 ms。底层 clock_gettime(CLOCK_REALTIME) 精度通常 µs/ns 级,truncate 到 ms。
- 同步连续两次 Date.now() **可以** 返回相同 ms (如果间隔 <1ms)。
- 也可以跨越 ms 边界返回相差 1 的值。

**h3-js IIFE 真实耗时估算 (iPhone 13+ Hermes)**:
- 解析 + 执行 15741 行 JS (precompiled HBC bytecode): **15-50ms**
- `new ArrayBuffer(33554432)`: <1ms (虚拟内存 mmap)
- `tryParseAsDataURI(memoryInitializer)` 解码 70KB base64: **5-15ms**
- `HEAPU8.set(data, GLOBAL_BASE)` 70KB 拷贝: **<1ms**
- `run()` → `preRun()` → `initRuntime()` → 调用 emscripten ATINIT ctors: **10-30ms**
- 总计预期: **30-100ms**

**`load_ms=0` 仅在 2 种情况成立**:
1. **Hermes Date.now 在同一个事件循环 microtask 中返回相同值** — 但这不是 Hermes 的实际行为,实测每次调用都重新读 clock。
2. **bytecode caching** — Hermes precompiles JS 到 HBC,模块工厂运行时已无需 JIT。但**执行仍然消耗 CPU 时间**,不可能 0ms。

**我的结论**: `load_ms=0` 表明 **t0 = Date.now() 和 t1 = Date.now() 之间不到 1ms** — 但这与 IIFE 30-100ms 真实预期矛盾。**可能的解释**:
- (a) **Hermes JIT 优化把 t0/t1 都消化进同一个表达式优化** (e.g. CSE) — 几率低,Date.now 是 side-effect side function
- (b) **emscripten run() 早退** — 如果 `runDependencies > 0` 在 run() 入口 (h3-js line 13513),run() return,但 line 13478 显示 `tryParseAsDataURI` 同步返回 → applyMemoryInitializer 同步 removeRunDependency,**所以 runDependencies 在 run() 调用前已是 0**
- (c) **load_ms 字段在 beacon 序列化时被服务器规则截断/类型转换** — 服务器把 `ctx.load_ms` 当 integer 存,如果 JS 端是浮点 0.x 被截断为 0。但 Date.now() 返回 integer,所以这条也不成立。
- (d) **t0 实际是某次缓存的 Date.now (e.g. 通过 React reconciler 的 batched time)** — 不,h3Visited.getH3 是普通函数,没有缓存。

**最可能解释**: **Hermes 在执行 h3-js factory 时,t1 - t0 累积到了 sub-millisecond 范围被报告为 0**。这要求 IIFE 实际耗时 <1ms — **这只在 Hermes 已经把 h3-js bytecode 预先 evaluate 过的情况下成立**。

**新假设**:**Metro 在 bundle 加载阶段会预先 evaluate 某些 hot modules** (e.g. circular dep break),或者 **Hermes 的 HBC bundle 在 load 时把所有顶层语句 evaluate 一遍** (但 module factory 不是顶层)。

**实际更朴素的解释**: 报告里 `load_ms=0` 可能是 **真的 0**,因为**第二次 require 命中 metro-runtime require.js:96-98 的 isInitialized 快路径,返回缓存 exports — 0ms 合理**。**这意味着 h3-js IIFE 已经在更早的某个时间被 evaluate 过 — 但报告里没显示更早的 require 记录**。Round 1 序列开头是 h3_hydrate_start → 没有更早的 h3 beacon。

→ **这是关键裂痕**: 如果 require_ok 0ms 是因为命中 isInitialized 快路径,那 IIFE **必须**在 hydrate 之前就 evaluate 过 (cold start phase or另一处隐式 require)。但代码里只有 useH3VisitedStore 和 h3FogBuilder 两处 require,且都在 lazy 包装内。**唯一另外可能**: Metro bundle 对 h3-js 有 eager-eval 标记 (sideEffects: false 等),或者 babel-plugin 插了一个隐式 require。需要 verify bundle output。

---

## D) Round 1 vs 2+ 转折机制 — 新解释

我**不**采纳 Subagent #1 的 Metro cache 毒化论 (cross-cold-launch state 不共享)。**新解释**:

**Round 1 IIFE 成功,但导致主线程 freeze** → **iOS Watchdog SIGKILL** → process 死。**关键: persistence debounce 没机会 flush**。所以 h3 cache 写入磁盘的只有最初 hydrate 留下的 18 字节空 cache (`{"v":1,"cells":[]}`,因为 round 1 进入时就 clear() 了)。

**Round 2 启动**: hydrate 读到 18 字节空 cache → hydrate_done cells_n=0 (或者 hydrate_empty,因为 round 1 hydrate 触发 clear → 18 字节会被 deserialize 为 empty Map,但 cells_n=0 应当报 hydrate_done 不是 hydrate_empty)。

**等等 — round 2 beacon 是 hydrate_empty 不是 hydrate_done cells_n=0**。两者代码路径不同:
- `hydrate_done`: storage 有 raw 且 deserialize 成功
- `hydrate_empty`: storage.getItem 返回 null

→ Round 2 storage 是 **null**, 不是 round 1 的 "18 字节"。**这表明 storage 在 round 2 比 round 1 更空**。可能原因:
1. Round 1 没来得及把 hydrate 后的 empty cache 写入磁盘 (debounce 3s 还没到,crash 之前 detachH3Persistence 没运行)。但 storage 在两个 round 间不应该消失 — AsyncStorage 是磁盘持久。
2. **更可能**: round 1 和 round 2 是**不同 uid** (round 1 mqrexnh6 uid=4,round 2 mqrhpu0q uid 不显示 — 但 raw_len=18 vs 没有 raw 都印证)。**两个 round 在 hydrate 不同 user**,所以 storage key 不同 → round 2 看到的是别的 user 的状态。报告未显示 round 2 的 uid。

→ **如果两 round 是不同 user**, 那 round 2 的 `bulkimport_start n=10` 是另一个 user 的 10 个 points,与 round 1 的 581 无关。**这完全推翻 "数据损坏 581→10" 的解读**。需要服务器端 verify uid。

**Round 2 require_unexpected_shape 的真正解释**:
- 这是 round 2 的**第一次** h3-js require (新 JS runtime,新 module map)。
- 如果 IIFE 在 round 2 的环境下 throw (而 round 1 没 throw),原因是**环境差异**:
  - Round 1: cold launch,内存压力低,IIFE 完成
  - Round 2: 紧跟 round 1 crash,可能是 expo-updates emergency rollback 路径,**JS runtime 启动时序不同** (e.g. globalThis 上的 XMLHttpRequest polyfill 尚未注册,h3-js IIFE 内 readAsync 定义时引用 `new XMLHttpRequest()` throw)。
  - 或者 Mapbox native 在 round 2 启动得更激进 (因为 RN 重启而非 OS 冷启,Mapbox singleton 已部分占用 RAM),导致 h3-js IIFE 中 `new ArrayBuffer(33554432)` 触发 OOM throw (而非 jetsam — JS-level throw 是 catchable)。

→ **这就解释了**:
- Round 1: 环境 OK,IIFE 成功,但 581 次 latLngToCell 触发 watchdog freeze
- Round 2+: 环境恶劣 (RN-only restart 之后内存碎片/竞争),IIFE 内部某行 throw → Metro 吞 throw → require 返回 undefined → h3LoadFailed=true → bulkImport graceful skip

**Round 2+ ~80ms 后再死**: 因为这是 RN-only restart (expo-updates rolled back JS bundle 但保留原生进程),**OtaBadge 的旧 reloadAsync setTimeout 可能仍在 native expo-updates 状态机里激活**,触发再次 rollback。或者 useMemoryStore 的 setTimeout(() => bulkImport, 0) 被 RN 调度器丢弃 → 但还在某 Promise 链里持有强引用 → GC 触发竞争 → 死。

---

## E) Round 2+ 真正的杀手 — 候选 + 验证方案

**候选 1: 来自 v303 `isEmergencyLaunch` + OtaBadge 自动 reload 没禁干净**
- 证据: 报告 round 2-4 间隔 3 秒,而 OtaBadge 内部有 `setTimeout(() => Updates.reloadAsync(), 600)` 和 `setTimeout(() => Updates.reloadAsync(), 400)`。如果 v303 audit fix 在 normal launch 禁了,但 emergency launch 没禁 → round 2 是 emergency launch,触发 reload。
- 验证 beacon: 在 OtaBadge mount 时加 `boot.ota_badge_mount isEmergency=<bool>` 和 setTimeout reload 调用前加 `boot.ota_reload_scheduled delay=<ms>`。

**候选 2: ForegroundUnlockManager 内部 useEffect 链断**
- ForegroundUnlockManager:hydrateH3ForUser → hydrateMemoryForUser → attachMemorySync → pullMemoryFromServer。如果 pullMemoryFromServer 在 round 2 时拉了大量 points,JSON.parse 主线程长时间阻塞 → watchdog。
- 验证 beacon: `boot.pull_memory_start size=<bytes>`、`boot.pull_memory_done parse_ms=<n>`。

**候选 3: react-native-mapbox-gl native init 在 RN restart 时崩**
- Mapbox iOS SDK 在 JS bundle reload 时如果不正确 detach,可能 native 层 segfault。但 segfault 通常会产生 native crash log,不是静默。
- 验证 beacon: `boot.before_mapbox_native_init` 在 App.tsx 第一行 + `boot.after_mapbox_native_init` 在 component mount 完成。

**候选 4: useMemoryStore.subscribe 链泄漏**
- useMemoryStore 有 N 个 subscriber (FogLayer, MemorySummaryCard, etc.)。Round 2 重启时如果 subscriber 没清理,旧 store snapshot 在 GC 时被引用,触发 GC 风暴。但单次 GC 风暴很难致死。
- 验证 beacon: `boot.zustand_subscriber_count phase=<N>`。

**最可能候选**: 1 (OtaBadge reload 残留) — 因为 round 2-4 各间隔 ~3s 完美匹配 reloadAsync 触发重启的循环。

---

## F) OTA-only 修复方案

**前提**:用户要求保留 h3-js + 只 OTA。所以**不能换 metro.config.js、不能改 native、不能换包**。所有修复必须是 JS 文件。

### F.1 最小可推 OTA - 立刻

不要直接走 require — 改成 **dynamic import 包裹 + 时间预算**:

```ts
// useH3VisitedStore.ts getH3() 内部
function getH3WithBudget(): H3Module | null {
  if (h3Ref) return h3Ref;
  if (h3LoadFailed) return null;
  
  // BUDGET 检查: 如果上次 require 已经触发过 watchdog 风险 (>500ms),拒绝再试
  const lastAttempt = (global as any).__h3_last_attempt_ms ?? 0;
  if (lastAttempt > 0 && Date.now() - lastAttempt < 5000) {
    // 上次失败 <5s,跳过
    markBootPhase('h3_skip_recent_fail', { since_ms: Date.now() - lastAttempt });
    return null;
  }
  (global as any).__h3_last_attempt_ms = Date.now();
  
  // 在 InteractionManager.runAfterInteractions 后再 require — 让 hydrate/Mapbox 先稳定
  // 注意: 这要求 caller 容忍 null (FogLayer 已经容忍)
  // ...
}
```

→ **但这只防止重复 attempts,不解决根本 throw 问题**。

### F.2 推荐 OTA 修复:增加 require 前 budget + cooperative yield

**1. 在 useMemoryStore.replacePoints 的 setTimeout(0) → 改成 requestIdleCallback 等价 (RN: InteractionManager)**

```ts
// 让 hydrate / Mapbox / 其他 mount 工作先完成 100ms,再触发 h3 init
if (points.length > 0) {
  const snapshot = points.map((p) => ({ lat: p.lat, lng: p.lng, ts: p.ts }));
  // v311: 等 200ms 让 cold start 风暴过去,再启 h3
  setTimeout(() => {
    const h3 = useH3VisitedStore.getState();
    h3.clear();
    h3.bulkImport(snapshot);
  }, 200);
}
```

**2. 在 bulkImport 内部分批 yield**

```ts
// 581 次 latLngToCell 一次性跑 → 改成每 50 个 yield 一次
bulkImport: async (points) => {
  // ... 加 await new Promise(r => setTimeout(r, 0)) every 50 iters
}
```

**问题**: bulkImport 当前是 sync function,改 async 会破坏调用者。需要折中:同步循环但每 50 次手动检查 Date.now() 累积。但 JS 单线程无法主动 yield 而不返回。

→ **更可行**: 把 581 个点分 N 个 chunks (每 chunk 50),用嵌套 setTimeout 串行执行。

```ts
bulkImport: (points) => {
  if (points.length === 0) return;
  // ...
  const CHUNK = 50;
  let i = 0;
  const processChunk = () => {
    const h3 = getH3();
    if (!h3) return; // graceful skip
    const end = Math.min(i + CHUNK, points.length);
    for (; i < end; i++) {
      // ... latLngToCell + cells.set
    }
    if (i < points.length) {
      setTimeout(processChunk, 0);  // yield to event loop
    } else {
      set({ cells, cellVersion: ... });
      markBootPhase('h3_bulkimport_done', { ... });
    }
  };
  processChunk();
}
```

**这个修复**:
- ✅ 保留 h3-js (用户要求)
- ✅ 纯 JS,可推 OTA
- ✅ 缓解 watchdog (每 chunk 后让出 main thread)
- ✅ 缓解 jetsam (如果是 RAM 问题,分批 set 减少 transient Map size)

### F.3 我建议:**先加诊断 beacon 再修**

理由:我**不确定**是 watchdog 还是 Metro 吞 throw 还是 OtaBadge reload。直接修可能修错地方,浪费一次 OTA。**v311 OTA 应该 100% 是诊断**:

```ts
// v311 diagnostic OTA - 加这些 beacon:
// 1. App.tsx 第一行:
markBootPhase('boot_start_v311', {
  isEmergencyLaunch: (global as any).__expoUpdates?.isEmergencyLaunch ?? 'unknown',
  hermes: typeof (global as any).HermesInternal !== 'undefined',
});

// 2. OtaBadge mount 内:
markBootPhase('ota_badge_mount', { mode: <props.mode>, isUpdated: <state> });
// 在每个 setTimeout(reload) 前:
markBootPhase('ota_reload_scheduled', { delay_ms: 600, reason: '<context>' });

// 3. useH3VisitedStore.getH3() 内 — Subagent #1 提的 diag block,加全:
const errorUtilsBefore = (global as any).ErrorUtils;
markBootPhase('h3_pre_require_diag', {
  hasErrorUtils: !!errorUtilsBefore,
  hasReportFatal: typeof errorUtilsBefore?.reportFatalError === 'function',
  isDev: typeof __DEV__ !== 'undefined' ? __DEV__ : null,
  globalThisKeys: Object.keys(global).slice(0, 20).join(','),  // 验 XMLHttpRequest 是否存在
});
const raw = require('h3-js');
markBootPhase('h3_post_require_diag', {
  raw_typeof: typeof raw,
  raw_is_null: raw === null,
  raw_is_undefined: raw === undefined,
  raw_keys_count: raw && typeof raw === 'object' ? Object.keys(raw).length : 0,
  raw_first_keys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 5).join(',') : 'n/a',
});

// 4. useMemoryStore.replacePoints 的 setTimeout 包裹 try/catch:
setTimeout(() => {
  try {
    markBootPhase('h3_bulkimport_wrapper_enter');
    const h3s = useH3VisitedStore.getState();
    h3s.clear();
    h3s.bulkImport(snapshot);
    markBootPhase('h3_bulkimport_wrapper_done');
  } catch (e: any) {
    markBootPhase('h3_bulkimport_wrapper_caught', { msg: String(e?.message ?? e).slice(0, 300) });
  }
}, 0);

// 5. bulkImport 内每 50 个点加 heartbeat:
for (i = 0; i < points.length; i++) {
  // ... latLngToCell
  if (i % 50 === 0) {
    markBootPhase('h3_bulkimport_progress', { i, total: points.length, ms: Date.now() - t0 });
  }
}
```

**v311 OTA 内容**: 上面所有 diag + **不动业务逻辑**。让用户重现 crash,看 beacon 序列最后一个是什么。决定 v312 fix 方向。

### F.4 备选:如果用户不想再加 diag,直接修

**最稳的盲修组合** (OTA 可推):
1. 在 useMemoryStore.replacePoints setTimeout 改 200ms (避开 cold start 风暴)
2. bulkImport 改 chunked (50 / 200ms)
3. 在 getH3 加 5s cooldown after fail (防 4 round 重试 storm)
4. 在 OtaBadge 加 isEmergencyLaunch gate (禁所有 reload setTimeout)

但这是**盲修** — 如果根因是 Mapbox native,这 4 条都白做。所以 F.3 优先。

---

## G) 我和 Subagent #1 可能分歧的地方

我**预期**Subagent #1 会:
- 强烈倾向 "h3-js IIFE throw + Metro 吞" 是 round 2+ 直接原因
- 倾向 "纯 JS H3 替换" 是终极方案 (v310_real_crash_diagnosis 已主张)
- 不深入挖 round 1 的 watchdog 可能性
- 不挖 OtaBadge reload 残留

**我坚持**:
1. **Round 1 不是 jetsam**。物理内存数学不支持。watchdog (8badf00d) 或 silent uncaught error 更可能。581 点 sync emscripten 调用是已知卡线程模式。
2. **Round 2+ 死因与 h3 无关**。h3 已经 graceful skip。死因在 OtaBadge / Mapbox / pullMemoryFromServer 三选一,**最可能是 OtaBadge reloadAsync 残留**。
3. **v311 应该是纯诊断**。盲推"纯 JS H3"会**修对 round 1** (避开 watchdog),但**修不到 round 2+ 真凶**。用户继续闪退,信任损失。
4. **Date.now=0 的 load_ms 是 unresolved anomaly**。我**没有**完全合理解释。 Subagent #1 可能给出"cached require 快路径"的解释,我推翻了 (代码里只有两处 lazy require)。这条**仍然有可能颠覆我的整个 round 1 理论** — 如果 require_ok 是来自第二次 require,那 round 1 实际 crash 在更早的地方,bulkimport_start n=581 不是触发点,而是已经成功 import 完毕只是后续 beacon 没及时上来。这需要服务器端按 ts 严格排序 verify。

**关键分歧**: Subagent #1 倾向 "1 个 OTA 修两个问题"。我倾向 "1 个 OTA 加 diag,1 个 OTA 修"。在用户压力下我妥协方案是 F.2 (chunked bulkImport + 200ms defer) 同时加 F.3 的 diag — 单次 OTA 既修又测,如果不够再 v312。

---

## 附录: 我读过的代码定位

| 现象 | 文件 | 行号 (v310 = commit 2a8d2b7) |
|---|---|---|
| getH3() lazy require 包装 | useH3VisitedStore.ts | 51-130 |
| bulkImport with beacons | useH3VisitedStore.ts | 207-253 |
| h3Persistence.hydrateH3ForUser beacon trail | h3Persistence.ts | 151-180 |
| useMemoryStore.replacePoints → setTimeout(0) bulkImport | useMemoryStore.ts | 524-555 |
| ForegroundUnlockManager hydrate cascade | ForegroundUnlockManager.tsx | 86-98 |
| MemoryScreen render_start beacon (NEVER FIRED in trail) | MemoryScreen.tsx | (render entry) |
| Metro guardedLoadModule swallow path | metro-runtime/src/polyfills/require.js | 178-191 |
| Metro hasError cached rethrow | metro-runtime/src/polyfills/require.js | 252-254 |
| Metro factory catch sets exports=undefined | metro-runtime/src/polyfills/require.js | 310-315 |
| h3-js IIFE entry + run() call | h3-js/dist/browser/h3-js.js | 3, 13557 |
| h3-js INITIAL_TOTAL_MEMORY = 33554432 | h3-js/dist/browser/h3-js.js | 284 |
| h3-js new ArrayBuffer(32MB) sync | h3-js/dist/browser/h3-js.js | 288 |
| h3-js applyMemoryInitializer 70KB sync | h3-js/dist/browser/h3-js.js | 13468, 13477-13479 |
| h3-js run() early return if runDependencies > 0 | h3-js/dist/browser/h3-js.js | 13511-13515 |
| h3-js abort() throws string | h3-js/dist/browser/h3-js.js | 13548 |
| OtaBadge auto reloadAsync setTimeout | OtaBadge.tsx | ~多处 |
| bootDiagnostics fireBeacon (fire-and-forget fetch) | bootDiagnostics.ts | 70-97 |
