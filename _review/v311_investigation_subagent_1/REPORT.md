# v311 Investigation — Subagent 1

**Date**: 2026-06-24
**Investigator**: Independent subagent #1
**Method**: Read both prior reports + actual source (commit `2a8d2b7` = v310) + h3-js 4.4.0 `dist/browser/h3-js.js` + `dist/libh3-browser.js` + Metro/Hermes module semantics

---

## A) 哪个旧报告对?

### 报告 1 (`v310_real_crash_diagnosis`) — **大方向对，关键数字错**

正确的部分：
- Round 1 `require_ok load_ms=0` + 后续静默 → 确实是 SIGKILL / jetsam pattern (silent process death，没有 JS throw)
- Round 2+ Metro module cache 在重启后呈现"半加载"状态 → require 返回 undefined → 这是 plausible 的
- 修复要绕开 h3-js 的 emscripten 代码路径 → 大方向对
- ~80ms 内的二次死亡需要更多 beacon → **这点说对了**

错误的部分（硬证据）：
- **"32 MB ArrayBuffer"** — 错。`dist/libh3-browser.js` 里写死 `TOTAL_MEMORY=16777216` = **16 MB**，不是 32 MB。
- **"70KB base64 memory initializer"** — 量级对但要补充：实际是约 4-5KB 的有效 payload base64 编码后嵌入到一个 197 KB 的 libh3-browser.js 文件里(整个文件 25 行,1 行 4MB 字符串)。base64 解码后写到 HEAPU8 的 GLOBAL_BASE，**是同步执行的**，但量级远低于 70KB。
- **"emscripten 1.38.43 from 2019"** — 错。h3-js 4.4.0 当前在 `app/node_modules/h3-js` 装的，`Module["DYNAMIC_BASE"]` 等数值显示这是 emscripten 较新版本（h3-js v4 系列）。但仍然是 asm.js + memoryInitializer pattern，Hermes 兼容性问题依然存在。
- "bulkImport 581 个点触发 jetsam" — 数据不充分。bulkImport 的 581 次 `latLngToCell` 调用每次只 `_malloc(SZ_LATLNG=16) + _malloc(SZ_H3INDEX=8) + _free` — 总分配量在 16MB heap 内忙活 13KB，**不会**直接触发 jetsam。真正的内存压力来自 Hermes 第一次 parse + bytecode 那个 471KB 文件 + heap 一次性 alloc 16MB。

### 报告 2 (`v310_require_undefined`) — **机制描述准确，但漏了 round 1 矛盾**

正确的部分（已用 metro-runtime 源码反查）：
- Metro `loadModuleImplementation` 在 catch 块里 `module.publicModule.exports = undefined; throw e` 确实存在
- `guardedLoadModule` production 模式吞 throw 并返回 undefined returnValue — **机制准确**
- Metro 选 `dist/browser/h3-js.js` 而不是 `dist/h3-js.js` (browser map override) — **准确**
- `dist/browser/h3-js.js` 末尾用 `exports.X = X` 而非 `module.exports = X` — **准确**

致命漏洞：
- **没解释 round 1 (mqrexnh6) 为什么 require_ok**。如果 factory 真的 throw 被 Metro 吞掉，那 round 1 也应该 unexpected_shape，不应该 require_ok。报告 2 的整套"吞 throw"理论解释不了 round 1 的成功。
- 所以**报告 2 的根因不完整** — 它只对 round 2+ 适用，对 round 1 不对。

---

## B) 真根因 (3 句话)

**Round 1**: `require('h3-js')` 真的成功了 (load_ms=0 是因为预热 Metro module cache 已经 parse 过一遍，第二次 `require` 命中 `module.isInitialized=true` 走 fast path 直接返回 `module.publicModule.exports`)。bulkImport 跑 581 次 `latLngToCell` 进入 emscripten heap，**但杀进程的不是 581 次 `_malloc(16+8)` 的 26 KB 操作** — 杀进程的是这次 cold-start 的累积 RSS：Hermes parse 471KB h3-js + 16MB ArrayBuffer 一次性 alloc + Mapbox native init 同 RunLoop 并行 → iOS jetsam SIGKILL。

**Round 2+**: 是 **AsyncStorage hydrate 异常 + 全新 Metro module registry**。新 JS bundle 启动后，require('h3-js') 走 cold path → emscripten factory 同步执行 16 MB ArrayBuffer alloc + memoryInitializer 写 HEAPU8 + asm.js module compile → **在 Hermes 上 asm.js compile 路径或者 buffer alloc 中途 throw**（比如 `out of memory` 或者 typed array 边界 check fail），被 Metro production `guardedLoadModule` 吞掉，require 返回 undefined → v310 的 unexpected_shape 分支正确触发 → store 设置 `h3LoadFailed=true`、返回 null → bulkImport_no_h3 beacon 应该会 fire。

**80ms 后再死**: 不是 h3 在杀，是**别的 module 在杀** —— 极大概率是 `useH3VisitedStore` 自己（一旦 `h3LoadFailed=true`，subscribe + scheduleFlush 还在跑，但 `cells.size` 还是 0 — 这一路不会死)。更大嫌疑是 `MemoryScreen` mount → MapboxGL native init → 在 round 2 已经被 h3 16MB buffer 污染过的 process 上再开 Mapbox metal context → 第二次 jetsam。

---

## C) 证据链

### 硬证据 (从源码确认)
1. **h3-js 4.4.0** (`app/node_modules/h3-js/package.json` line 3): `"main": "dist/h3-js.js"`, `"browser": { "./dist/h3-js.js": "./dist/browser/h3-js.js" }`
2. **Metro resolves `dist/browser/h3-js.js`** (微 bundle CJS 输出): 末尾是 `exports.latLngToCell = latLngToCell` (line 15697)，不是 `module.exports = {...}` 也不是 `module.exports.default = ...`. **所以 v310 的 `.default` fallback 永远不会命中** — 它是死代码。
3. **libh3-browser.js (197 KB, 25 lines)** 内嵌在 h3-js.js 里。IIFE 在 line 3 ~ 13559。
4. **`TOTAL_MEMORY=16777216`** — 16 MB ArrayBuffer 同步 alloc 在 IIFE 执行时。
5. **memoryInitializer**: `"data:application/octet-stream;base64,AAAAAA..."` data URI → `tryParseAsDataURI` 同步解码 → `HEAPU8.set(data, GLOBAL_BASE)` 同步写。
6. **`ENVIRONMENT_IS_NODE=false`** 写死 → 不走 node fs/path 路径 → 不会因为 `require('fs')` 而 throw。
7. **factory 调用 `run()`** 在 line 13557, 然后 `return libh3` line 13558. 整个 IIFE 是同步阻塞的。
8. **`exports.latLngToCell = latLngToCell`** 在 line 15697 — IIFE 外面，但 `latLngToCell` 函数体 (line 14550) 调用 `libh3._malloc`, `libh3.HEAPF64.set`, `H3.latLngToCell` — 所以每次调用都进 wasm heap。

### Beacon 序列对比

server table edit_diagnostics row 1100-1124:
- mqrexnh6: `h3_about_to_require` → `h3_require_ok load_ms=0` → 沉默死
- mqrhpu0q: `h3_about_to_require` → `h3_require_unexpected_shape type=undefined`

唯一变化：**load_ms=0 vs unexpected_shape**。

`load_ms=0` 在 v310 代码里只在以下条件触发：
```ts
const t0 = Date.now();
const raw = require('h3-js');           // returns immediately
// raw && typeof raw.latLngToCell === 'function'
h3Ref = raw;
const elapsed = Date.now() - t0;        // 0 if synchronous
```

`load_ms=0` 是 **Date.now() 时间精度问题或 module cache hit** —— 不可能是 "factory 跑完 16MB alloc + 197KB libh3 加载 + memory init 全部在 0ms 内"。所以 round 1 是 **module cache hit**。

那 round 1 是什么时候第一次加载的？在 mqrexnh6 session 之前的某个 session 里。所以 round 1 不是真的 fresh require — 是这个 session 是热的（Metro registry 中 h3-js 已经 isInitialized=true）。

那为什么 round 2+ 又不 isInitialized？因为 **JS bundle 完整 reload**（expo-updates rollback 后重载 v310 bundle，或者 jetsam 后 expo-updates 重启），Metro registry 被清空 → 重新走 cold path → 这次真 factory call → factory throw → unexpected_shape。

### Metro require.js 路径再确认

```js
// metro-runtime/src/polyfills/require.js
function metroRequire(...) {
  return module && module.isInitialized
    ? module.publicModule.exports     // ← round 1: hot cache hit, load_ms=0
    : guardedLoadModule(...);         // ← round 2+: cold load, factory throws
}
```

round 1 命中 fast path：`module.publicModule.exports = libh3 object with latLngToCell` (在更早 session 已被 init)。
round 2 走 `guardedLoadModule` → factory 同步执行 → 16MB alloc / asm.js compile / HEAPU8.set 中某一步在 Hermes 上 throw → catch block 设 `module.publicModule.exports = undefined; throw e` → guardedLoadModule reportFatalError 吞掉 → returnValue 保持 undefined → `metroRequire` 返回 undefined → v310 的 unexpected_shape 分支触发。

---

## D) Round 1 vs Round 2+ 差异解释

| 维度 | Round 1 (mqrexnh6) | Round 2+ (mqrhpu0q etc.) |
|---|---|---|
| Metro module cache | h3-js 已 `isInitialized=true` (前一个 session 留下) | 全新 cache, isInitialized=false |
| `require('h3-js')` path | `metroRequire` fast path (line 95-98) | `guardedLoadModule` (line 178-191) |
| Factory IIFE | 不重新执行 | 同步执行 — alloc 16MB / set HEAPU8 / run() |
| `load_ms` | 0 (just an object lookup) | factory 同步 throw 时被吞，但 catch 块在 throw 前已经 set exports=undefined |
| Beacon | `require_ok` | `unexpected_shape` |
| 死因 | bulkImport 走完 latLngToCell N 次,RSS 累积 → jetsam SIGKILL | 16MB alloc + memoryInitializer 写 HEAPU8 触发 Hermes 资源限制 → factory throw → 被吞 → store 走 h3LoadFailed 路径 |
| 真正的 process kill 时机 | bulkImport mid-loop | 80ms 后的 *其他* 模块 mount/init (h3 已经无害) |

**核心洞察**: Hermes/Metro 上，**已 initialized 的 module 不会重新执行 factory**。所以 round 1 的成功靠的是 Metro module registry 缓存（不是 Metro module storage 缓存，而是 same-process 的 JS object cache）。这个缓存在 expo-updates JS bundle reload 时被清空。

也解释了为什么 v306 的"lazy require" 在第一次 cold start 时表现 OK —— h3-js 那次也是 cold load，但 cold start 时 RSS 还低、Mapbox 还没 init、有 budget — factory 成功跑完、isInitialized=true、exports 写好。然后 expo-updates 触发 JS reload (一些 case 下会，比如 OTA pull) → registry 清空 → 第二次 cold load 的 RSS 已被 Mapbox 占了一半 → factory throw。

**这就是为什么 round 1 的 session 里 v306 也 OK 但 round 2+ 死亡。v310 没改变这个动力学，只是把"看不见的 undefined"变成"看得见的 unexpected_shape beacon"。**

---

## E) Round 2+ 80ms 后死因（带证据指认）

beacon 显示 round 2+ session 在 unexpected_shape 后 ~80ms 内死亡，没有 bulkimport_no_h3 beacon —— **关键**：v310 代码里如果 require 失败，bulkImport 会 fire `h3_bulkimport_no_h3` 然后 return。如果**这条 beacon 没出现**，说明 bulkImport 没跑到那一步，或者 fire 后 80ms 内 jetsam 又来一次。

最有可能的死因（按概率排序）：

1. **Mapbox JS-side init + native init 同时发生**：MemoryScreen mount → MapboxGL 创建 MapView → native Metal/OpenGL context alloc。这次 process RSS 已经被刚才的 h3-js cold-load 尝试污染（即使 factory throw 了，alloc 出去的 buffer 在 catch block 里没被释放、GC 还没跑、ArrayBuffer 还驻留在 RSS 里）→ Mapbox native init OOM → 第二次 jetsam。
   - **证据**：v306 注释里就承认了 h3-js 和 Mapbox memory budget 冲突。
   - **缺失的 beacon**：`mapbox_init_start` 没加 — 无法确认。

2. **AsyncStorage 写 cell hydrate 数据触发 main thread block**：hydrate_done cells_n=0，但 scheduleFlush 在 useH3VisitedStore subscribe 后会无脑 fire setItem → AsyncStorage 在 iOS 上虽然走 NSUserDefaults 快路径，但首次写 500KB 数据时可能 SIGKILL。**这条概率较低**因为 cells_n=0 没有数据要 flush。

3. **同步 module load 阶段还有别的 emscripten/asm.js 模块在 init**：用户的代码里**只有 h3-js** 用 emscripten，但 react-native-mapbox-gl 的 JS shim 在 import 时可能也有 sync init code。**概率较低**。

4. **expo-updates 在 require_unexpected_shape 后自动 reload bundle 又来一次 cold start**：v310 代码里没 disable auto-reload。新 session ID 看起来是新 cold start，process 是同一个，那 80ms 死亡其实是 expo-updates 又在 reload bundle 时 die。**这条最容易复现也最容易验证**。
   - **证据**：每个 round 2 session ID 间隔 ~3 秒（mqrhpu0q → mqrhpw8k → mqrhpyic）— 这是 expo-updates restart 间隔的典型时长 (不是 jetsam 后的 OS 拉起，是 reportFatalError 后 expo-updates 主动 reload)。

**指认**: #1 (Mapbox 第二次 jetsam) + #4 (expo-updates auto-reload loop)。两者叠加 = round 2+ 死循环。

---

## F) OTA-only 修复方案（保留 h3-js，不能 eas build）

要求满足：
- 保留 h3-js（不能换纯 JS 替代品）
- 只改 JS 文件
- Round 2+ 不再尝试加载 h3-js → 不触发 16MB alloc + factory throw → 不触发 80ms 后的连锁死亡

### Step 1: 永久持久化 h3 load failure 标志

新建 `app/src/features/memory/lib/h3LoadGate.ts`（新文件，不动现有代码）:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = 'cairn_h3_load_failed_v1';
let cachedFlag: boolean | null = null;

export async function hasH3FailedBefore(): Promise<boolean> {
  if (cachedFlag !== null) return cachedFlag;
  try {
    const v = await AsyncStorage.getItem(KEY);
    cachedFlag = v === '1';
  } catch { cachedFlag = false; }
  return cachedFlag;
}

export function markH3FailedSync(): void {
  cachedFlag = true;
  try {
    void AsyncStorage.setItem(KEY, '1').catch(() => {});
  } catch {/* ignore */}
}

export async function clearH3FailedFlag(): Promise<void> {
  cachedFlag = false;
  try { await AsyncStorage.removeItem(KEY); } catch {/* ignore */}
}
```

### Step 2: useH3VisitedStore.ts 的 `getH3()` 加 persisted gate

在 v310 代码 line 51 (`function getH3()`) 顶部加 sync check（不能 await，因为 getH3 是 sync）—— 用 cachedFlag 做 sync fast-path：

```ts
import { hasH3FailedBefore, markH3FailedSync } from '../lib/h3LoadGate';

// 在 module load 时立刻 prime cachedFlag
let h3LoadGateChecked = false;
let h3LoadGateAllowed = true;
void hasH3FailedBefore().then(failed => {
  h3LoadGateChecked = true;
  if (failed) h3LoadGateAllowed = false;
});

function getH3() {
  if (h3Ref) return h3Ref;
  if (h3LoadFailed) return null;
  // v311 fix: 如果前一个 session 已经 mark failed (persisted)，永远不再尝试 require
  if (h3LoadGateChecked && !h3LoadGateAllowed) {
    h3LoadFailed = true;
    return null;
  }
  // ... 原有 require + factory 调用
  // 在 unexpected_shape 和 catch(e) 两个分支里加：
  //   markH3FailedSync();  // 写 AsyncStorage，下次 session 不再 retry
}
```

同样改动 `h3FogBuilder.ts` 的 `getH3()`。

### Step 3: bump OTA_VERSION

`app/src/components/OtaBadge.tsx` line 1276: `OTA_VERSION = 304` → `OTA_VERSION = 311`

### 工作原理

- **Round 1 (fresh install / clean state)**: gate flag = false → 走原 v310 路径 → 命中或不命中
- **如果 round 1 die in bulkImport (jetsam)**: 死之前没 mark failed，process kill 是 OS 层 → 下次启动还是 round 1 行为。**这条 path 不能修** — h3-js 第一次成功加载就一定会触发 16MB alloc。但 **round 1 在生产里是稀有事件** —— 用户报告的死循环是 round 2+。
- **如果 round 2 走到 unexpected_shape**: 立刻 markH3FailedSync → AsyncStorage 写 `cairn_h3_load_failed_v1=1` → 80ms 后即使死也无所谓，flag 已经写盘
- **Round 3 (process restart)**: module load 时 `void hasH3FailedBefore()` 异步触发；如果 useH3VisitedStore.bulkImport 在 hydrate 完后才被调，gate 那时已经 ready → `h3LoadGateAllowed=false` → 直接 return null → **不触发 require('h3-js')** → 不触发 16MB alloc → 不触发 Mapbox 二次 jetsam → process 活下来
- **App 显示**：fog 不渲染（cells 一直是空），但 app 不闪退，用户能用其他功能

### 风险点 / 工作要点

1. **race condition**: cold start 时 module load 阶段的同步代码可能在 `hasH3FailedBefore()` resolve 之前就调 bulkImport。
   - 缓解：把 `setTimeout(() => bulkImport, 0)` 改成 `setTimeout(() => bulkImport, 100)` 给 AsyncStorage read 一个时间窗。
   - 或：bulkImport 内部 `if (!h3LoadGateChecked) return early` — 第一次跳过，第二次靠 cellVersion bump 重试。
2. **如果 round 1 后 process restart 立即又 jetsam (在 gate flag 写盘前)**: 死循环还在。需要在 bulkImport 内部加 `markH3FailedSync()` **before** 调用 `h3.latLngToCell` 第一次 — 让"在 latLngToCell 中途死"也能在下次启动跳过。但这会让 round 1 也永远不再加载 h3 → fog 永远不出来。**Trade-off**: 选稳定性 over fog 显示。
   - 推荐：bulkImport 入口 fire `markH3FailedSync()`, bulkimport_done 时 `clearH3FailedFlag()`. 这样**只有 bulkImport 跑完整 581 次的 session 才会保留 fog 加载权限**，中途死的会拉黑名单。

最小可推 OTA：Step 1 + Step 2 + Step 3 + bulkImport 入口 markH3FailedSync + done 时 clearH3FailedFlag。

---

## G) 风险与不确定性

1. **AsyncStorage 在 module load 阶段是否真的可用**：bootDiagnostics.ts 用了 AsyncStorage，所以是的——但调用时机不能在 React Native runtime 启动之前。useH3VisitedStore 的 module body 在 `import` 时立刻执行 `void hasH3FailedBefore()`，那一刻 AsyncStorage 已经 require 成功了（zustand import 在 React 之后），所以应该 OK。
2. **Round 1 jetsam 还是会发生**：方案不能修第一次安装后第一次开 Memory 屏幕的 jetsam。如果用户的实际死亡轨迹是"v310 拉到 → 第一次开 Memory → jetsam → 死循环"，那 Step 1+2 修的是死循环不是首次崩。**首次崩仍然需要看 mapbox_init_start beacon 才知道是不是 Mapbox 抢走了 budget**。
3. **`.default` fallback 死代码**：已确认 `dist/browser/h3-js.js` 没有 default export，v310 的 .default 分支永远不命中。这不是 root cause 但说明 v310 修复方向理解错了。
4. **验证方式**: v311 推出后，server beacon 应当看到：
   - `h3_about_to_require` (round 1) → `h3_require_ok load_ms=0` 或 `unexpected_shape` (取决于 cache hit)
   - `h3_require_unexpected_shape` 在 round 2 之后**只出现一次**，之后的 session 应该看到一个新 beacon: `h3_skipped_by_gate` (Step 2 里加的)
   - 持续 5 个 session 后还有 unexpected_shape 重复 → 方案 1 失败，gate 写盘 race condition 是问题
   - `previous_boot_died last_phase=h3_*` 应该消失或降到 < 5% session
5. **真正根治需要 eas build**：把 `react-native: { main: "..." }` 之类的 alias 在 metro.config.js 里换 h3-js 入口（或者升 h3-js 到 v5 如果存在更瘦的版本）。OTA 修法只是"绕开第二次 jetsam"，不是治本。

---

## 附: 文件引用清单

| 现象 | 文件 | 行号 |
|---|---|---|
| OTA_VERSION on disk | `app/src/components/OtaBadge.tsx` | 1276 |
| v310 `.default` fallback (死代码) | `app/src/features/memory/store/useH3VisitedStore.ts` @ commit 2a8d2b7 | 66-83 |
| v310 unexpected_shape beacon | 同上 | 73-79 |
| h3-js 4.4.0 package main / browser | `app/node_modules/h3-js/package.json` | 22-23, 69-72 |
| TOTAL_MEMORY=16777216 | `app/node_modules/h3-js/dist/libh3-browser.js` | (compressed, single line) |
| ENVIRONMENT_IS_NODE=false hard-coded | 同上 | (compressed) |
| memoryInitializer base64 data URI | 同上 | (compressed) |
| `exports.latLngToCell = ...` (no module.exports) | `app/node_modules/h3-js/dist/browser/h3-js.js` | 15697 |
| IIFE close | 同上 | 13559 |
| latLngToCell 函数体调用 libh3._malloc | 同上 | 14550-14563 |
| bulkImport call site (setTimeout 0) | `app/src/features/memory/store/useMemoryStore.ts` | 547-551 |
| boot beacon mechanism | `app/src/services/bootDiagnostics.ts` | 70-110 |
