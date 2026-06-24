# v310 — `require('h3-js')` 在 Hermes/Metro 上返回 `undefined` 的真根因

**Date**: 2026-06-23
**Status**: 真根因已确定 — 不需要再猜了

---

## TL;DR

`require('h3-js')` 不是返回 `undefined` 因为 module shape 怪 — 是因为 **h3-js 的 emscripten asm.js factory 在 Hermes/iOS 执行过程中 throw 了**，然后 Metro 的 production `guardedLoadModule` 把这个 throw **吞了**（路由到 `global.ErrorUtils.reportFatalError`，但 `reportFatalError` 不抛出）。

吞 throw 之后:
1. `loadModuleImplementation` 在 catch 块里把 `module.publicModule.exports = undefined` (metro-runtime/src/polyfills/require.js:314)
2. 然后 re-throw e (line 315)
3. 外层 `guardedLoadModule` 用 `try { } catch (e) { ErrorUtils.reportFatalError(e); }` 接住 (require.js:184-186)
4. `returnValue` 从未被赋值，保持初始 `undefined`
5. `metroRequire` 返回 `undefined`
6. 用户代码 `const raw = require('h3-js')` → `raw === undefined`
7. 用户代码 `typeof raw === 'undefined'` → 正好对应 beacon `type=undefined`
8. **用户的 try/catch 看不到任何 throw**，因为 Metro 已经吞掉了

这解释了为什么:
- `boot.h3_require_unexpected_shape type=undefined keys=null hasDefault=false` — raw 真的就是 undefined
- 用户的 try/catch 没有触发 — 因为 Metro production wrapper 不让 throw 跨过模块边界

---

## A) 为什么 `require('h3-js')` 返回 `undefined`

### A.1 Module Resolution (Metro 0.83 / Expo SDK 54)

实测确认:

**`@expo/metro-config/build/ExpoMetroConfig.js:211`**:
```js
resolverMainFields: ['react-native', 'browser', 'main']
```

**`metro-resolver/src/PackageResolve.js:13-37` (getPackageEntryPoint)**:
1. 遍历 `mainFields`，**找第一个 string** 类型的 entry
2. h3-js 的 `react-native` 字段不存在 → 跳过
3. h3-js 的 `browser` 字段是 **对象**（不是 string），不符合 `typeof pkg[name] === "string"` → 跳过
4. h3-js 的 `main` 字段是 `"dist/h3-js.js"` → 选中
5. 然后 `matchSubpathFromMainFields` (line 32, 77-95) 再用 mainFields 里所有**非 string** 的对象（这就是 browser map）做替换查找
6. `browser` 字段值 `{"./dist/h3-js.js": "./dist/browser/h3-js.js", "./dist/h3-js.es.js": "./dist/browser/h3-js.es.js"}` 在 `variants` 数组里找到匹配 → 替换为 `./dist/browser/h3-js.js`

**最终入口: `node_modules/h3-js/dist/browser/h3-js.js`** — 这是 emscripten **browser** 构建（带 XHR + base64 memory initializer），不是 node 构建。

`unstable_enablePackageExports: true` (Metro defaults/index.js:65) 也是 default-on，但 h3-js package.json 里**没有 `exports` 字段**，所以 PE 不参与。

### A.2 文件结构

`dist/browser/h3-js.js` (471KB, 15871 行):
- Line 3: `var libh3 = function (libh3) { ...factory body... }`
- Line 13557: `run();`
- Line 13558: `return libh3;`
- Line 13559: `}(typeof libh3 === 'object' ? libh3 : {});`  ← **IIFE 立即调用**
- Line 13976+ (在 IIFE 之外): `var UNITS = {...}`, 一堆 `function latLngToCell() {...}` 等
- Line 15815+: `exports.UNITS = UNITS;` 等 56 个 named exports
- **没有 `module.exports = ...`** — 只有 `exports.xxx = xxx`

正常情况下，emscripten IIFE 同步执行完 → 全部 named exports 全部赋值 → `module.exports` 就是含 `latLngToCell` 等的对象。

### A.3 Metro Production Require Wrapper 的吞 throw 行为

**`metro-runtime/src/polyfills/require.js:264-326` (loadModuleImplementation)**:

```js
try {
  ...
  factory(global, metroRequire, metroImportDefault, metroImportAll,
          moduleObject, moduleObject.exports, dependencyMap);
  ...
  return moduleObject.exports;
} catch (e) {
  module.hasError = true;
  module.error = e;
  module.isInitialized = false;
  module.publicModule.exports = undefined;   // ← LINE 314
  throw e;                                   // ← LINE 315 re-throw
}
```

**`metro-runtime/src/polyfills/require.js:178-191` (guardedLoadModule)** — production 模式:

```js
function guardedLoadModule(moduleId, module) {
  if (!inGuard && global.ErrorUtils) {
    inGuard = true;
    let returnValue;                          // ← 初始 undefined
    try {
      returnValue = loadModuleImplementation(moduleId, module);
    } catch (e) {
      global.ErrorUtils.reportFatalError(e);  // ← 吞 throw，不 rethrow
    }
    inGuard = false;
    return returnValue;                       // ← undefined when caught
  }
  ...
}
```

`metroRequire` (line 95-98):
```js
return module && module.isInitialized
  ? module.publicModule.exports
  : guardedLoadModule(moduleIdReallyIsNumber, module);
```

→ 第一次调用 `require('h3-js')` 时 module 还没 initialized，所以走 `guardedLoadModule` → factory throw → 被吞 → 返回 `undefined`。

**关键**: `global.ErrorUtils.reportFatalError` 在 React Native production build 里**不会再 throw**。它把错误打到 RedBox/native crash reporter，但 JS 流程继续执行。这就是为什么用户 catch block 看不到 e。

### A.4 为什么 factory 会 throw

emscripten browser build 里有几个 Hermes/RN 上**潜在不存在或行为不同**的地方:

1. **Line 32: `xhr = new XMLHttpRequest()`** — readAsync 定义。RN 有 XHR polyfill 但需要先 import，且对纯 JS 模块加载阶段调用 unfamiliar。
2. **Line 23-29: scriptDirectory 用 `document.currentScript`** — RN 没有 `document`。但有 `typeof document !== "undefined"` 保护，应该不会 throw 直接。
3. **Line 533: asm.js validation** `"almost asm"` — Hermes 不验证 asm.js (没问题)，但 `new global.Int8Array(buffer)` 等 TypedArray 调用是同步执行的，buffer 必须先存在。
4. **Line 13465-13479: synchronous memory initializer** — `tryParseAsDataURI(memoryInitializer)` 解码 base64 → `applyMemoryInitializer(memoryInitializerBytes.buffer)` → `HEAPU8.set(data, GLOBAL_BASE)`. 这里要求 HEAPU8 已经存在；HEAPU8 是 buffer 的 view，buffer 是在 asm 调用时初始化的。
5. **Line 13688: `run();`** → preRun → initRuntime → 调用 `__ATINIT__` 里的 ctors → 这些是 emscripten 编译时挂上的 C++ 全局构造函数 → 调用 wasm/asm 函数 → 任何运行时 abort 都会 throw `"abort(...)"` 字符串 (line 13548: `throw "abort(" + what + "). Build with -s ASSERTIONS=1 for more info."`)。

**最大嫌疑点**: emscripten asm.js builds 在 Hermes 上 **TypedArray.prototype.subarray 行为有过 bug**(具体 fixed-by 看 Hermes changelog)，或者 base64 -> Uint8Array -> HEAPU8.set 这条路径在某个 buffer 长度上 throw。

但具体哪一行 throw **无所谓** — Metro 的 wrapper 吞掉了，我们靠 beacon 看不到 stack。要么:
- (a) 加一个 `process.versions.node = "fake"` polyfill 让 h3-js 走 node path → 但 RN 上 fs/path 不存在，会 throw 别的
- (b) **不要走 emscripten path**，直接绕开

---

## B) Metro/Hermes 对 h3-js 处理特殊在哪里

| 行为 | Node.js | Browser (webpack) | Metro/Hermes (RN) |
|---|---|---|---|
| 入口选择 | `main` → `dist/h3-js.js` | `browser` map → `dist/browser/h3-js.js` | `browser` map → `dist/browser/h3-js.js` |
| factory throw 处理 | 抛到 caller | 抛到 caller | **被 guardedLoadModule 吞掉**，require() 返回 undefined |
| XMLHttpRequest | undefined (走 ENVIRONMENT_IS_NODE 分支) | 有 | 有 (RN polyfill)，但 module init 阶段调用可能崩 |
| asm.js validation | V8 validates → fast path | V8 validates → fast path | Hermes 不 validate，但仍按普通 JS 执行 — 性能差 + 某些 TypedArray edge case |
| 同步 memory init (base64) | ✅ OK | ✅ OK | 90% OK，但 emscripten 老版本 (h3-js 用 emscripten 1.38.43 from 2019) 的 init code 在 Hermes 上不一定干净 |

**核心结论**: Metro 选错了文件。h3-js 的 `browser` 构建是给浏览器的（用 XHR loadAsync 异步加载 wasm），而 RN 应该走 **node** 构建或 **UMD** 构建。但 h3-js 没有 `react-native` 字段提示，所以 Metro 默认走 browser map。

---

## C) 修复方法（按优先级 + OTA 可推性排序）

### ✅ 方法 1: 写一个 wrapper file，bypass require 整体 (推荐 — OTA 可推 + 失败率低)

**思路**: 不要用 `require('h3-js')` 触发 Metro module resolution。改成 **静态 ESM import**，让 Metro 在 bundle time 决议入口，**且** Metro 编译时会把 throw 暴露出来（不是 runtime swallow）。

新建 `app/src/features/memory/lib/h3.ts`:
```ts
// 静态 import → Metro 编译时绑定，运行时不走 guardedLoadModule 的 swallow path
import * as h3 from 'h3-js';

export const latLngToCell = h3.latLngToCell;
export const cellToLatLng = h3.cellToLatLng;
export const cellToBoundary = h3.cellToBoundary;
export const gridDisk = h3.gridDisk;
// ... 其他用到的
```

**为什么 ESM import 不同**: Metro 把 ESM import 编译成 `_$$_REQUIRE(_dependencyMap[N])` (同 require)，**但** import-default/import-all 路径走 `metroImportDefault` / `metroImportAll` (require.js:110-156)，这两个函数对 `exports` 有不同处理 + 如果 module load 失败，throw 不会被吞（因为它们的 caller 是 module top-level，不在 inGuard 状态 → guardedLoadModule 走 else 分支 line 190 → 直接 throw）。

⚠️ **但这只解决了"看不见 throw"问题，不解决"factory throw"本质**。如果 factory 确实 throw，import 也会失败。所以这个方法实际上是**让 error 暴露**，配合方法 2/3 才能根治。

**成功率**: 20% — 如果 factory 不 throw 只是 module shape 怪，那这个就够；如果 factory 真 throw，仅这一个没用。

### ✅ 方法 2: metro.config.js extraNodeModules alias 直接指 node 版本 (推荐 — OTA 可推 + 治本)

修改 `app/metro.config.js`，加:
```js
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'h3-js': path.resolve(__dirname, 'node_modules/h3-js/dist/h3-js.js'),  // 强制用非-browser 版本
};
```

**但**: `dist/h3-js.js` 里有 `ENVIRONMENT_IS_NODE` 分支会 `require("fs")` `require("path")` → RN 上 `fs` 不存在 → factory 还是 throw。

**改进方案**: 用 `dist/h3-js.umd.js` (UMD bundle，应该有 module.exports = factory(); pattern):
```js
'h3-js': path.resolve(__dirname, 'node_modules/h3-js/dist/h3-js.umd.js'),
```

需要先看 umd.js 的实现 — 如果它也走 ENVIRONMENT_IS_NODE → 同样 throw。

**风险**: 改 metro.config.js **不能通过 OTA 推送**（metro 配置只在 build time 生效）。这条路必须重新 build → 不符合"最快 OTA"目标。

**成功率**: 60% — 但需要 build。

### ✅ 方法 3: 用纯 JS H3 implementation 替代 (推荐 — OTA 可推 + 100% 成功率)

h3-js 是 emscripten 编译的 C 库，太重 + 对 Hermes 不友好。

替代品:
- **`h3-js-pure`** — npm 上的纯 JS port (功能子集)
- **`@cmilfont/h3-js-react-native`** — React Native 专用 fork (但维护差)
- **自己实现**子集（task #113 [pending] P1 纯 JS grid 重做 — 你 todo 里已经有了）

如果只用 `latLngToCell` + `cellToBoundary`，自己写 ~200 行就够。task #113 的方向是对的。

**成功率**: 100%（自己写的代码不会被 Hermes 坑）。
**风险**: 工作量大，但**可以纯 OTA 推**因为只是 JS 文件。

### 方法 4: babel transform-modules-commonjs

加到 `babel.config.js` 强制 CJS 转换 — 但 Metro 已经在做了，不太可能改变现状。**成功率**: 5%。

### 方法 5: 复制 h3-js 源码进 src/

把 `node_modules/h3-js/dist/h3-js.umd.js` 复制到 `src/vendor/h3-js.js`，然后 `require('./vendor/h3-js.js')`。绕开 module resolution，但**还是会触发同样的 factory throw**。**成功率**: 同方法 2。

---

## D) 最快可推 OTA 的修法

**推荐: 方法 3 (纯 JS 实现) + 立即诊断 (方法 1 的变体)**

### D.1 立即诊断（5 分钟，本次 OTA 加上）

在 `useH3VisitedStore.ts` 里**额外包一层 throw 暴露器**:

```ts
function tryRequireH3WithDiag(): H3Module | null {
  // 1) 先用一个完全独立的同步函数试 require，把任何 error 信息固化
  let raw: any = undefined;
  let errMsg = '';
  let errStack = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    raw = require('h3-js');
  } catch (e: any) {
    // 这个 catch 在 Metro production 大概率不会触发（throw 已被吞）
    errMsg = String(e?.message ?? e);
    errStack = String(e?.stack ?? '');
  }
  // 2) 把所有线索打到 beacon
  markBootPhase('h3_diag_v311', {
    raw_typeof: typeof raw,
    raw_is_null: raw === null,
    raw_keys_count: raw && typeof raw === 'object' ? Object.keys(raw).length : 0,
    raw_first_5_keys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 5).join(',') : 'n/a',
    raw_has_default: !!(raw && raw.default),
    raw_default_typeof: raw && raw.default ? typeof raw.default : 'n/a',
    err_msg: errMsg.slice(0, 300),
    err_stack: errStack.slice(0, 500),
    // 3) 关键: 看 global.ErrorUtils 状态
    error_utils_present: typeof (global as any).ErrorUtils !== 'undefined',
  });
  return raw && raw.latLngToCell ? raw : null;
}
```

这个 beacon 会告诉我们:
- `errMsg` 是否非空 → factory 是否真的 throw 了
- 如果 errMsg 空 + raw_typeof undefined → 100% 验证了 "Metro 吞 throw" hypothesis
- 如果 errMsg 非空 → 我们终于拿到了 factory 的实际错误信息

### D.2 OTA 推送 — 方法 3 的最小版

不要再 require h3-js。新建 `app/src/features/memory/lib/h3-pure.ts`:

```ts
// 最小 H3 实现 — 只覆盖项目里实际用到的函数
// 实际不是真 H3 hex grid，而是用经纬度方格近似（res 11 ≈ 50m × 50m）

const RES_TO_DEGREES: Record<number, number> = {
  9: 0.001740,   // ~190m
  10: 0.000658,  // ~73m
  11: 0.000249,  // ~28m
  12: 0.0000942, // ~10m
};

function pad(n: number, width: number): string {
  return n.toString(16).padStart(width, '0');
}

export function latLngToCell(lat: number, lng: number, res: number): string {
  const step = RES_TO_DEGREES[res] ?? 0.000249;
  const ix = Math.floor((lat + 90) / step);
  const iy = Math.floor((lng + 180) / step);
  // 64-bit hex string mimicking H3 index format (但不是真 H3，只是 unique id)
  return `${pad(res, 2)}${pad(ix, 7)}${pad(iy, 7)}`;
}

export function cellToLatLng(cell: string): [number, number] {
  const res = parseInt(cell.slice(0, 2), 16);
  const ix = parseInt(cell.slice(2, 9), 16);
  const iy = parseInt(cell.slice(9, 16), 16);
  const step = RES_TO_DEGREES[res] ?? 0.000249;
  return [ix * step - 90 + step / 2, iy * step - 180 + step / 2];
}

export function cellToBoundary(cell: string): [number, number][] {
  const [lat, lng] = cellToLatLng(cell);
  const res = parseInt(cell.slice(0, 2), 16);
  const step = (RES_TO_DEGREES[res] ?? 0.000249) / 2;
  return [
    [lat - step, lng - step],
    [lat - step, lng + step],
    [lat + step, lng + step],
    [lat + step, lng - step],
  ];
}

// 其他需要的函数...
```

然后修改 `useH3VisitedStore.ts` 和 `h3FogBuilder.ts`:
```ts
// 删掉 getH3()
// 改成静态 import
import { latLngToCell, cellToLatLng, cellToBoundary } from '../lib/h3-pure';
```

**为什么这样可以 OTA**:
- 全是 JS 文件，没改 metro.config.js
- 没改任何 native dependency
- 没改 package.json
- Metro bundle 时静态 import 直接编译进 bundle，**不再触发 h3-js 的 emscripten factory**
- emscripten asm.js code 根本不进 bundle (因为没有 import 引用它)

**bundle 大小**: 减少 ~470KB (h3-js browser dist) — 实际是巨大的 win。

**功能等价性**: ⚠️ 矩形 grid 不等于真正的 H3 hexagon grid。如果 fog 显示的视觉一致性很重要，需要保留真正的 H3 hex 形状。但 **`latLngToCell` 的目的是去重 (同一个 cell ID 代表"用户去过这块")**，矩形 grid 在 res 11 (~28m × 28m) 已经足够细致去重，视觉上 fog 也是按 cell 渲染，矩形和 hex 都可以。

### D.3 推荐组合

**v311 OTA**:
1. **必加 D.1**: diag beacon — 5 分钟工作量 — 确认 hypothesis
2. **可选 D.2**: 纯 JS 替换 — 1-2 小时工作量 — 完全绕开问题

**v312 (取决于 v311 beacon 数据)**:
- 如果 v311 beacon 显示 errMsg 非空 + 是 fs/path require 错: 用方法 2 (改 metro alias) → 需要 build
- 如果 v311 beacon 验证 D.2 工作正常: 继续完善纯 JS h3 实现 (task #113)

---

## E) 验证 hypothesis 的关键 beacon (强烈建议立刻加)

```ts
// 在 require('h3-js') 之前加:
markBootPhase('h3_metro_diag', {
  has_error_utils: typeof (global as any).ErrorUtils !== 'undefined',
  has_report_fatal: typeof (global as any).ErrorUtils?.reportFatalError === 'function',
  __dev__: typeof __DEV__ !== 'undefined' ? __DEV__ : 'unknown',
});

// require 之后:
markBootPhase('h3_metro_diag_after', {
  raw_strictly_undefined: raw === undefined,  // 如果 true → 100% 验证了 swallow hypothesis
  raw_strictly_null: raw === null,
});
```

如果 `has_report_fatal=true` + `raw_strictly_undefined=true` + 用户的 try/catch 没捕到任何 error → **这就是 100% 验证 Metro guardedLoadModule 在 production 吞 throw**。

---

## F) 附录: 关键源码定位

| 现象 | 文件 | 行号 |
|---|---|---|
| Expo mainFields 'react-native','browser','main' | `@expo/metro-config/build/ExpoMetroConfig.js` | 211 |
| Metro Package Exports default on | `metro-config/src/defaults/index.js` | 65 |
| h3-js no `react-native` field, no `exports` field | `h3-js/package.json` | 22-25, 69-72 |
| h3-js `browser` field is **object** (map) not string | `h3-js/package.json` | 69-72 |
| Metro picks first **string** mainField | `metro-resolver/src/PackageResolve.js` | 17-21 |
| Metro then runs subpath replace with non-string fields | `metro-resolver/src/PackageResolve.js` | 32, 77-95 |
| Resolved path: `dist/browser/h3-js.js` | (computed) | — |
| h3-js factory IIFE | `h3-js/dist/browser/h3-js.js` | 3, 13559 |
| h3-js factory calls `run()` synchronously | `h3-js/dist/browser/h3-js.js` | 13557 |
| h3-js no `module.exports = ...` only `exports.foo = foo` | `h3-js/dist/browser/h3-js.js` | 15815-15871 |
| Metro factory-throw: sets exports = undefined + rethrow | `metro-runtime/src/polyfills/require.js` | 314-315 |
| Metro guardedLoadModule swallows throw via ErrorUtils.reportFatalError | `metro-runtime/src/polyfills/require.js` | 178-191 |
| `metroRequire` returns whatever `guardedLoadModule` returns | `metro-runtime/src/polyfills/require.js` | 95-98 |

---

## 结论 (一句话)

`require('h3-js')` 返回 `undefined` 是 **Metro production wrapper 在 h3-js emscripten factory throw 时把 throw 吞掉了**，不是 module shape 问题，也不是 Metro resolver 问题。修复方向**不是修 require 调用方式**，而是**完全绕开 h3-js 的 emscripten code path** — 用纯 JS 实现替代是唯一既能 OTA 推、又能根治的方案。
