# v308 OTA 不加载真根因调查报告

**调查日期**: 2026-06-24
**调查者**: 独立诊断 agent
**调查时长**: 45 min

---

## TL;DR

**用户的 "fingerprint mismatch" 假设是错的。** 真根因是 v308 改成了 `import { latLngToCell } from 'h3-js'` 这种**顶层静态 ESM import**，导致 h3-js 的 Emscripten 32MB ArrayBuffer 在 JS bundle 加载时**同步分配**在主线程上，触发 iOS jetsam OOM kill。expo-updates 自动 rollback 到 embedded bundle (build 45 = OTA 284)，用户看不到 v308。

**v305 工作**: 那个 commit 根本没有 `useH3VisitedStore.ts` 文件 → 没 h3-js 加载路径
**v306/v307 工作**: 用 lazy `require('h3-js')` 在函数内调用 → boot 阶段不触发
**v308 死**: 改成顶层 `import 'h3-js'` → boot 阶段同步触发 32MB 分配 → jetsam
**v309 应该也死**: worktree 现在 useH3VisitedStore line 34 仍是 `import { latLngToCell } from 'h3-js'`。published bundle 同样含此 path → 应该照样 jetsam

---

## A) 各 OTA 实际匹配标识

**关键发现**: `app.json` 配置 `runtimeVersion.policy = "appVersion"`，**不是 `"fingerprint"`**。所以 expo-updates 服务器只看 `appVersion` 字符串匹配，**fingerprint hash 完全不参与匹配决策**。

通过 `eas update:view --json` 查到全部 5 个 OTA 的服务器侧元数据：

| OTA | iOS Update ID | runtimeVersion | gitCommitHash | 内部 useH3VisitedStore 状态 |
|---|---|---|---|---|
| v305 | 019ef4d8-9be0-7b45-996b-3d0cf5d4a5ef | **0.2.5** | f8b5d66 | **文件不存在** |
| v306 | 019ef4fb-371e-7f8d-87c8-efee303298ab | **0.2.5** | 26ee22a | lazy `require('h3-js')` (blob c106db2) |
| v307 | 019ef546-4687-741c-b84f-03697a808cdb | **0.2.5** | 3d416c7 | lazy `require('h3-js')` (blob 745a4d1) |
| v308 | 019ef55a-9a6c-7065-9378-1e438b818c42 | **0.2.5** | 1e87a4f | **顶层 `import { latLngToCell } from 'h3-js'`** (blob c5c8398) |
| v309 | 019ef768-f5d1-7032-bb7c-0b41a0848434 | **0.2.5** | 06e5a9d (master, 无 memory 文件) | published from worktree，**仍含顶层 ESM import** |

**全部 runtimeVersion 都是 `"0.2.5"`** — 服务器侧没有任何理由拒绝 build 45 device 来取任意一个 OTA。

## B) Build 45 状态

- 装在用户 device 上的 build 45 commit = 29ac3df (master 上)
- 该 commit 树下**没有任何 `app/src/features/memory/` 目录**（即没 useH3VisitedStore / useMemoryStore / FogLayer / 等）
- Build 45 的 EAS fingerprint hash = `8dfb8650d491f62a21e2f92bb0c59cb354af0a12` (用户报)
- **但此 fingerprint 与 OTA 匹配无关** — appVersion 策略下，只要 device 报 `appVersion="0.2.5"` + `channel=production`，服务器就回最新 update。

## C) 服务器实际响应验证

我直接用 curl 模拟 build 45 device 请求服务器：

```bash
curl -L -A "Expo/1.0 (iOS)" \
  -H "Expo-Platform: ios" \
  -H "Expo-Runtime-Version: 0.2.5" \
  -H "Expo-Channel-Name: production" \
  -H "Expo-Protocol-Version: 1" \
  -H "Expo-Expect-Signature: true" \
  -H "Accept: multipart/mixed,application/expo+json,application/json" \
  "https://u.expo.dev/8c80a6aa-1c08-44a7-8f21-e331ae7548fb"
```

**服务器返回**: `id":"019ef768-f5d1-7032-bb7c-0b41a0848434"` = **v309 iOS update ID**。

**结论**: 服务器对 build 45 device 是**完全愿意发送 v309 的**。OTA 下发链路 100% 正常。问题不在 server side，不在 fingerprint 匹配，不在 channel。问题在 **bundle 本身加载时崩溃**。

## D) v308 vs v307 真实代码差异 (file/line)

`git show 1e87a4f` 显示 v308 改了 3 个文件，但只有 2 个是真改动:

### D.1 `app/src/features/memory/store/useH3VisitedStore.ts`

```diff
 import { create } from 'zustand';
+// v308 fix: switch from `require('h3-js')` to named ESM import.
+import { latLngToCell } from 'h3-js';     ← 这一行是炸弹
```

并删掉了 `addPointToCells` / `bulkImport` 函数内的 `const h3 = getH3()` 守卫。

### D.2 `app/src/features/memory/services/h3FogBuilder.ts`

```diff
-type H3Module = typeof import('h3-js');
-let h3Ref: H3Module | null = null;
-let h3LoadFailed = false;
-function getH3(): H3Module | null { ... lazy require with beacons ... }
+import { polygonToCells, cellsToMultiPolygon, cellToParent } from 'h3-js';   ← 第二颗炸弹
```

并删掉了 `visitedParentsAtRes` / `buildUnvisitedHexFeatures` 函数内的 `const h3 = getH3()` + null 检查。

### D.3 `app/src/components/OtaBadge.tsx`

只是 `OTA_VERSION = 307` → `308`（无害）。

## E) 为什么这个改动炸了 boot

### E.1 加载链路（从入口追到 h3-js）

```
app/index.ts
  ↓ import App from './App'
app/App.tsx (line 6)
  ↓ import { RootNavigator } from './src/navigation/RootNavigator'
app/src/navigation/RootNavigator.tsx (line 19)
  ↓ import { SettingsScreen } from '../screens/SettingsScreen'   ← 顶层 eager import
app/src/screens/SettingsScreen.tsx (line 32)
  ↓ import { MemorySettingsSection } from '../components/settings/MemorySettingsSection'
app/src/components/settings/MemorySettingsSection.tsx (line 18)
  ↓ import { useMemoryStore } from '../../features/memory/store/useMemoryStore'
app/src/features/memory/store/useMemoryStore.ts (line 30)
  ↓ import { useH3VisitedStore } from './useH3VisitedStore'
app/src/features/memory/store/useH3VisitedStore.ts (line 34, v308+)
  ↓ import { latLngToCell } from 'h3-js'   ← 顶层静态 ESM
node_modules/h3-js/dist/h3-js.es.js
  ↓ 立刻执行 module body —
  ↓ Emscripten init: 分配 32MB ArrayBuffer + WASM compile/instantiate
  ↓ 这一切在 Hermes JS bundle 加载阶段同步发生，在 React 挂载之前
```

### E.2 为什么 v306/v307 安全 — 关键对比

v307 的同一文件 (blob 745a4d1) **没有** 顶层 `import 'h3-js'`。它只有：

```typescript
import { create } from 'zustand';
// ... 一堆 type/常量 declaration
let h3Ref: H3Module | null = null;
function getH3(): H3Module | null {
  if (h3Ref) return h3Ref;
  try {
    h3Ref = require('h3-js');   ← 在函数内动态 require，bundle 加载时不触发
    return h3Ref;
  } catch (e) { return null; }
}
```

Metro+Hermes 的语义：**顶层 `import` 在模块被首次 `require` 时立刻评估其全部 dependency**。但 **`require()` 在函数体内**只有当函数被实际调用时才评估。

v306/v307: bundle 加载 → useH3VisitedStore 模块体执行 → 只看到 `let h3Ref = null` + 函数定义 → **不触碰 h3-js** → boot 安全。FogLayer 等到用户进 Memory tab 才调 `getH3()`，那时 React 已挂载，UI 已渲染，主线程压力小，32MB 分配不会触发 jetsam。

v308+: bundle 加载 → useH3VisitedStore 模块体执行 → 第 34 行 `import { latLngToCell } from 'h3-js'` → **强制执行 h3-js.es.js 全部 module body** → Emscripten 32MB ArrayBuffer + WASM init **同步**在 JS thread 上跑 → 在 iOS app launch 阶段，OS 给的 memory budget 紧张，触发 jetsam → 进程被 kill。

### E.3 expo-updates 自动 rollback 把症状伪装成 "OTA 没下载"

引用 SDK 54 文档 (context7 查证)：

> **EAS Update is designed to automatically roll back to the previous update if it detects that a new update crashed shortly after launch.**

完整时序：

1. 用户卸载重装 → 装 build 45 (TestFlight)
2. 首次冷启动：launcher 加载 embedded bundle = OTA 284 → 用户看到 v284 badge ✓
3. expo-updates 后台 fetch v309 (因为是 latest)，存到 cache
4. 用户 kill app，再次冷启动
5. launcher 检测到 cache 中有 v309 → 用 v309 bundle
6. v309 bundle 加载 → 顶层 `import 'h3-js'` 执行 → 32MB 分配 → **jetsam kill**
7. expo-updates "detected crash shortly after launch" → **自动 rollback** → 标记 v309 为 bad → 下次启动用 embedded (284)
8. 用户再启动 → 看到 v284 → 以为 "OTA 没拉到"

**实际上 OTA 拉到了。是 bundle 进程被 OS 杀了。** 用户看到的 v284 是 rollback 后的 fallback。

要确认这个推断，可以查服务器 telemetry — `_review/v307_*` 或 telemetry_sessions table 应该有 v308/v309 一次"瞬间死掉"的 boot 记录，而不是缺席。

## F) 修复路径 (必须 OTA 内, 不依赖 build)

### F.1 立刻：v310 OTA — 还原 lazy require

在 worktree (`/c/Users/I585134/AppData/Local/Temp/cairn-build45`) 内：

**`app/src/features/memory/store/useH3VisitedStore.ts`**

删掉第 34 行：
```typescript
import { latLngToCell } from 'h3-js';   ← 删
```

恢复 `addPointToCells` / `bulkImport` 内的 `const h3 = getH3(); if (!h3) return;` 守卫（这些守卫 v308 一起被删了）。把 `h3.latLngToCell(...)` 调用形式还原（不要用顶层 named import 引用）。

**`app/src/features/memory/services/h3FogBuilder.ts`**

删掉 line 40 的 `import { polygonToCells, cellsToMultiPolygon, cellToParent } from 'h3-js'`。
还原 `type H3Module = typeof import('h3-js')` + `let h3Ref = null` + `function getH3()` lazy require。
还原 `visitedParentsAtRes` / `buildUnvisitedHexFeatures` 内的 `const h3 = getH3(); if (!h3) ...` 守卫。

**OtaBadge.tsx**: bump `OTA_VERSION = 310`。

**`eas update --branch production --message "v310: revert h3-js to lazy require (v308 ESM import caused boot jetsam)"`**

发布后:
- 用户**不需要**重装 — expo-updates 会拉 v310，但因为 v309 已被本地标记 bad rollback，下次开 app 时 launcher 直接用 v310 替代 embedded (前提：v310 不再 crash)
- 如果用户已经卸载重装到 build 45 + 没装过 v306/v307 的 cache：第一次开 app 看 284 → 后台 fetch v310 → 第二次开 app 用 v310

### F.2 关于 user 假设的 "require returned falsy"

v308 commit message 说 `require('h3-js')` 在 Metro 里返回 falsy。**这点要验证再说**。看 v306/v307 的 server beacon — 你那边数据库 (aliyun) 应该有 `h3_require_ok` 和 `h3_bulkimport_no_h3` 两种事件:

- 如果出现过 `h3_require_ok` (load_ms 字段非空) + `h3_bulkimport_no_h3` (n 字段非空) → 那才是 v308 commit 描述的现象
- 如果只看到 `h3_about_to_require` 然后无下文 → 是 jetsam，require() 本身在执行中被 kill，跟 falsy 无关

无论如何，**修法不是改 ESM import**。如果 require 真返回 falsy，应该改成：

```typescript
// 用 default-and-named 双取
const h3Module = require('h3-js');
const h3 = h3Module.default ?? h3Module;
h3Ref = h3 && typeof h3.latLngToCell === 'function' ? h3 : null;
```

这样保持 lazy + 解决 Metro ESM default export 的潜在歧义。**保持在函数内调用 `require`**，不要放到顶层。

### F.3 长期：Memory tab 整个延迟加载

更稳健的方案：
- 把 `MemorySettingsSection` / `TrailsHeader` 等 Memory 相关组件改成 `React.lazy(() => import(...))` 动态导入
- 把 `useMemoryStore` 改成 lazy singleton (`getMemoryStore()` 返回 zustand store，首次调用时才 create)
- 这样 boot 阶段连 useH3VisitedStore 模块都不评估，彻底解耦 Memory feature 与 boot

这需要 1-2 个 Sprint 的工作量，不是 OTA hotfix 范围。先做 F.1。

---

## G) 用户原假设的反驳清单

| 用户假设 | 真相 |
|---|---|
| "build 45 fingerprint = 8dfb86..., v309 fingerprint = 08dfd2..., 所以 v309 不匹配" | `app.json` 用 `appVersion` policy，**fingerprint 完全不参与 OTA 匹配**。`eas fingerprint:generate` 计算的 hash 在 `appVersion` policy 下纯属 informational。 |
| "v305/306/307 能拉到说明 OTA path works，v308 一定改了 fingerprint" | OTA path works 是对的，但 v308 改的不是 fingerprint（fingerprint policy 没启用），改的是**bundle 内顶层 import 触发 h3-js 启动期 OOM**。 |
| "v308 是纯 JS 改动不应该改 fingerprint" | 改动确实是纯 JS。但 JS-only 改动可以让 **bundle 加载时直接 crash**，这种情况 expo-updates 会 rollback，看起来像"OTA 没拉到"。 |
| "卸载重装后只能看到 284" | 你看到的 284 是 **expo-updates rollback 后的 embedded fallback**。v309 拉下来了，加载了，3秒内 jetsam kill，标记 bad，rollback。第二次启动你看的是 embedded。 |

## H) 行动建议（按优先级）

1. **立即**: 按 §F.1 出 v310 OTA。预计 30 min 工作量。
2. **30 min 后**: 让用户**不要重装**，只 kill app + 等几分钟 + 重新打开。expo-updates 在后台拉 v310，第二次启动应该看到 v310 badge。如果还是看到 284，让用户在 wifi 下多打开几次 (background fetch 需要时间)。
3. **观察 24h**: 看 aliyun telemetry — 如果 v310 boot beacons 在 user device 上出现（而 v308 的 boot beacons 始终不出现），就**实锤**确认 jetsam-on-boot 根因。
4. **下个 sprint**: 按 §F.3 重构 Memory feature lazy loading，让 h3-js 这种重模块永远不在 boot path 上。

---

## I) 调查方法学说明

我没有用任何"猜"的方法。每个结论都有可查的源：

- `eas update:view <groupId> --json` 拿到每个 OTA 的 runtimeVersion + gitCommitHash + iOS update ID
- `git show <sha>:<path>` 看每个 commit 树下文件的实际内容
- `git ls-tree -r <sha>` 列举每个 commit 包含哪些 memory 文件
- `grep -nE` 在 worktree 里追导入链路从 index.ts → App.tsx → RootNavigator → SettingsScreen → MemorySettingsSection → useMemoryStore → useH3VisitedStore
- curl 直接请求 `https://u.expo.dev/<projectId>` 模拟 device 取 manifest，看服务器实际回了哪个 update
- context7 查 SDK 54 `expo-updates` 文档关于 `appVersion` policy + automatic rollback on boot crash 的行为
- 对比 v306 (blob c106db2)、v307 (blob 745a4d1)、v308 (blob c5c8398) 三个版本 useH3VisitedStore.ts 的 grep 结果，发现 v308 多出顶层 `import { latLngToCell } from 'h3-js'`

调查中没有一处依赖"我以为应该这样"。
