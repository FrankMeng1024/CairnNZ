# v311 Final Plan — H3 OTA 闪退真根因修复

**Date**: 2026-06-24
**Method**: 2 个并行独立 subagent (Opus) + 主 agent 二次验证 = 4 眼 review
**Constraint**: 保留 h3-js (用户要求),只 OTA,不 eas build
**Reports**:
- `_review/v311_investigation_subagent_1/REPORT.md` (主张 Metro cache hit + 持久化 gate)
- `_review/v311_investigation_subagent_2/REPORT.md` (skeptic,主张 watchdog + chunked)

---

## A) 真根因 (经过 4 眼交叉验证)

| 现象 | 真根因 |
|---|---|
| Round 1 `require_ok load_ms=0` | **Metro module cache hit (fast path)** — 早一个 session 已经成功 evaluate 过 h3-js,这次走 `isInitialized=true` 的 0ms 快路径。**load_ms=0 不是真 cold load**。 |
| Round 1 在 require_ok 后沉默死 | **iOS Watchdog (0x8badf00d)** — bulkImport 同步循环 581 次 `latLngToCell`,每次都进 emscripten asm.js heap (_malloc + HEAPF64.set + H3 算法 + _free)。Hermes 上首次执行慢,581 次 sync 调用足以让主线程 freeze 6-10s → Watchdog SIGKILL。**不是 jetsam (32MB ArrayBuffer 是虚拟内存,物理足迹只有 70KB)**。 |
| Round 2-4 `require_unexpected_shape type=undefined` | **JS bundle reload 后真 cold load** — Metro registry 清空,这次 require 真触发 emscripten IIFE。在 round 1 watchdog 后的紧凑 restart 环境下 (RSS 已被前一个进程污染或 Mapbox 已在 native 层 init),emscripten factory 在 `new ArrayBuffer(32MB)` 或 `HEAPU8.set` 路径上触发 Hermes 资源 throw。**Metro production `guardedLoadModule` 静默吞 throw** (require.js:184-186) → returnValue 保持 undefined → v310 的 unexpected_shape 分支正确识别。 |
| Round 2-4 间隔 ~3s | **expo-updates emergency rollback / 自动 restart**。每次 round 死亡后,iOS 触发新 launch,fail count 累加,直到 emergency rollback 到 embedded bundle (但 embedded 也有相同代码,所以循环继续)。3s 间隔 = native launch 到 hydrate beacon fire 的典型时长。 |
| Round 2+ 在 unexpected_shape 后 ~80ms 仍死 | 即使 h3 path graceful skip,**bulkImport 没跑** (返 null 提前 return),**但 `setTimeout(() => bulkImport, 0)` 是 useMemoryStore.replacePoints 触发的 — replacePoints 自己的 main work (set state + buildBucketIndex) 已经跑了**。这之后还有 ForegroundUnlockManager 链上后续工作:hydrateMemoryForUser → attachMemorySync → pullMemoryFromServer (network) + 多个 zustand subscribe。其中某一步在已被压力的 process 上撑不住。**实际 round 2+ 死因 ≠ h3,但根源仍然是 round 1 留下的 process 状态污染 + ForegroundUnlockManager 链 + Mapbox JS init**。 |

### 一句话根因

**v310 OTA bundle 让 boot 时同步跑 581 次 emscripten asm.js 调用,主线程冻结触发 iOS watchdog SIGKILL,iOS 自动 restart 进入 emergency rollback 循环。**

### v310 修复方向错在哪

`.default` fallback 是死代码 — h3-js browser dist 用 `exports.X=X` CJS pattern,不可能有 `.default`。v310 的诊断 beacon 是对的 (帮我们看清现象),但 fallback 逻辑没意义。

---

## B) OTA-only 修复方案 (保留 h3-js)

### Step 1: bulkImport 改 chunked + setTimeout(0) yield

**当前代码** (`useH3VisitedStore.ts` bulkImport, v310):
```ts
bulkImport: (points) => {
  // ... beacons
  for (const p of points) {  // ← 581 次 sync,主线程冻结
    cellID = h3.latLngToCell(p.lat, p.lng, STORE_RES);
    // ... cells.set
  }
  set({ cells, cellVersion: ... });
}
```

**修复后**:
```ts
bulkImport: (points) => {
  if (points.length === 0) return;
  const h3 = getH3();
  if (!h3) {
    markBootPhase('h3_bulkimport_no_h3', {});
    return;
  }
  const t0 = Date.now();
  markBootPhase('h3_bulkimport_start', { n: points.length });
  const cells = new Map(get().cells);
  const CHUNK = 50;
  let i = 0;
  let processed = 0;
  let dropped = 0;
  const processChunk = () => {
    const end = Math.min(i + CHUNK, points.length);
    for (; i < end; i++) {
      const p = points[i];
      if (!isFinite(p.lat) || !isFinite(p.lng)) { dropped++; continue; }
      let cellID: string;
      try {
        cellID = h3.latLngToCell(p.lat, p.lng, STORE_RES);
      } catch { dropped++; continue; }
      const existing = cells.get(cellID);
      if (existing) {
        cells.set(cellID, {
          first: Math.min(existing.first, p.ts),
          last: Math.max(existing.last, p.ts),
          count: existing.count + 1,
        });
      } else {
        cells.set(cellID, { first: p.ts, last: p.ts, count: 1 });
      }
      processed++;
    }
    if (i < points.length) {
      // Yield 主线程,防 watchdog
      setTimeout(processChunk, 0);
    } else {
      set({ cells, cellVersion: get().cellVersion + 1 });
      markBootPhase('h3_bulkimport_done', {
        processed,
        dropped,
        ms: Date.now() - t0,
        chunks: Math.ceil(points.length / CHUNK),
      });
    }
  };
  processChunk();
}
```

**效果**:
- 581 点 / 50 = 12 个 chunks
- 每个 chunk 跑完 setTimeout 0 让出主线程 → RN 调度器有机会处理 UI / native event loop
- iOS watchdog 看到主线程有响应 → 不 SIGKILL
- 总耗时不变 (sync sum ≈ chunked sum),但分布在 12+ 个事件循环 tick 上

### Step 2: getH3 加 5s cooldown 防 retry storm

```ts
let h3LastFailureMs = 0;
const H3_RETRY_COOLDOWN_MS = 5000;

function getH3(): H3Module | null {
  if (h3Ref) return h3Ref;
  if (h3LoadFailed) return null;
  // v311: 5s cooldown 防止同一个 session 内反复 retry require('h3-js')
  // (例如 GPS 1Hz 触发 addPointToCells → 每秒 retry → 每秒 emscripten throw)
  if (h3LastFailureMs > 0 && Date.now() - h3LastFailureMs < H3_RETRY_COOLDOWN_MS) {
    return null;
  }
  // ... existing v310 require logic ...
  // 在 unexpected_shape 和 catch(e) 两个失败分支加:
  //   h3LastFailureMs = Date.now();
}
```

### Step 3: 持久化失败标志 (AsyncStorage gate)

新文件 `app/src/features/memory/lib/h3LoadGate.ts`:
```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = 'cairn_h3_load_failed_v1';
let cachedFlag: boolean | null = null;

export async function primeH3FailedFlag(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    cachedFlag = v === '1';
  } catch { cachedFlag = false; }
}

export function h3HasFailedBefore(): boolean {
  return cachedFlag === true;
}

export function markH3InProgress(): void {
  cachedFlag = true;
  void AsyncStorage.setItem(KEY, '1').catch(() => {});
}

export function markH3SuccessAndClear(): void {
  cachedFlag = false;
  void AsyncStorage.removeItem(KEY).catch(() => {});
}
```

调用模式:
- App 启动时 `void primeH3FailedFlag()` 立即触发 read (零等待)
- `bulkImport` 入口 `markH3InProgress()` (写盘 — 即使 sync death 也会刷盘大部分情况)
- `bulkImport` done 时 `markH3SuccessAndClear()`
- `getH3()` 顶部加 `if (h3HasFailedBefore()) { h3LoadFailed = true; return null; }`

**效果**: 死循环最多 2-3 次后断开 (第 N 次 bulkImport 入口写盘 → 第 N+1 次 boot 检测到 flag → 跳过 require → 不触发 emscripten → 不 watchdog)。

**取舍**: 用户失去 fog 显示,但 app 不闪退。Trade-off 合理 (闪退 > 没 fog)。

### Step 4: bump OTA_VERSION

`app/src/components/OtaBadge.tsx` line 1276: `OTA_VERSION = 304` → `OTA_VERSION = 311`

(注意 master 上是 304;v310 在 worktree 是 310。如果 v311 push 走 master path,从 304 跳 311 是对的。)

---

## C) 验证步骤

### 推 v311 OTA 后,server beacon 应当显示

**好的迹象**:
- `h3_bulkimport_start n=N` → 一系列 `h3_bulkimport_progress` (如果加了) → `h3_bulkimport_done`
- 不再有 `h3_about_to_require` 持续重复出现的 session (cooldown + gate 起效)
- `boot_complete` beacon fire (boot 走完)
- 用户能开 Memory screen,fog 显示

**坏的迹象 (需要 v312)**:
- `h3_bulkimport_done` 从未出现 → chunked 也卡 → 真凶在别处 (Mapbox 或 ForegroundUnlockManager)
- bulkimport_done 出现但 80ms 后还死 → round 2+ 死因独立于 h3 → 需要加 Mapbox / pullMemory beacon

---

## D) 风险与不确定性

1. **chunked bulkImport 引入的延迟**: 12 chunks × ~50ms = ~600ms 才完整 import。FogLayer 首次 render 可能看到部分 fog,然后 cellVersion bump 后重渲染。**用户体验**: fog "渐进" 出现而非瞬时,可接受。
2. **AsyncStorage race**: cold start 调用 bulkImport 时,`primeH3FailedFlag` 可能还没 resolve (异步)。**缓解**: 在 useMemoryStore.replacePoints 把 `setTimeout(0)` 改 `setTimeout(100)`,给 AsyncStorage read 一个时间窗 (Sub#1 推荐)。
3. **markH3InProgress 写盘是异步的**: 如果 watchdog 在 100ms 内 SIGKILL,setItem 没 flush。但 iOS watchdog 6-10s 时间窗 + AsyncStorage NSUserDefaults 快路径 (10-50ms),实际有充足时间刷盘。
4. **未修 round 2+ 80ms 后死的"其他原因"**: 即使 h3 完全跳过,boot 链上 ForegroundUnlockManager → pullMemoryFromServer / Mapbox JS init 仍可能 OOM/crash。**对策**: v311 先解决 h3 这条主线;v312 根据 beacon 决定下一步。
5. **embedded bundle 是更老的代码**: 即使 v311 OTA 推上,emergency rollback 路径会让 app 退到 embedded (master HEAD 的 build)。**实际 master HEAD 已经有 lazy require + .default fallback 但没 chunked + 没 gate** → embedded 仍会闪退。**OTA 修不到 embedded**。所以 v311 必须先让用户成功**应用** (而不是被 rollback) 才能生效。
   - **关键**: 一旦 v311 成功跑过一次完整 boot (bulkimport_done fire),fail count 重置,不再 rollback → v311 成为稳定运行的 bundle。
   - **第一次 v311 boot 必须不死**:这就是为什么 Step 1 (chunked) 是首要修复 — 它直接阻止第一次 boot 的 watchdog。

---

## E) 实施清单 (无 ambiguity)

1. 修改 `app/src/features/memory/store/useH3VisitedStore.ts`:
   - getH3 加 5s cooldown (Step 2)
   - getH3 加 h3HasFailedBefore gate (Step 3)
   - bulkImport 改 chunked (Step 1)
   - bulkImport 入口 markH3InProgress,done clear (Step 3)

2. 新建 `app/src/features/memory/lib/h3LoadGate.ts` (Step 3)

3. 修改 `app/App.tsx`:
   - 在 boot 早期 (after_telemetry_init 附近) 加 `void primeH3FailedFlag()`

4. 修改 `app/src/features/memory/store/useMemoryStore.ts`:
   - `setTimeout(() => bulkImport, 0)` → `setTimeout(() => bulkImport, 100)` (Risk 2 缓解)

5. 修改 `app/src/components/OtaBadge.tsx`:
   - `OTA_VERSION = 304` → `OTA_VERSION = 311`

6. **不**修改: `h3FogBuilder.ts`、`h3Persistence.ts`、OtaBadge reload 逻辑 (App.tsx 的 reload 已禁,OtaBadge 的 reload 只在 isAvailable 时跑,用户已在最新版本不触发)

7. `eas update --branch production --message "v311: chunked H3 bulkImport + persistent failure gate"` 推 OTA

8. 监听 server beacon 24h,确认 bulkimport_done 出现 + 闪退率下降。
