# SUB_AR_REENTER_VERIFY — independent reviewer

Date: 2026-06-14
Reviewer: independent subagent (4-eye review #2)

## File existence + import

- `app/src/services/arOverlayLifecycle.ts`: EXISTS, 3346 bytes, 101 lines. Exports: `OverlayLifecycleRefs`, `createOverlayLifecycle`, `OverlayUnmountResult`, `unmountOverlay`, `isOverlayClean`, `markSpawned`, `markBulkSpawnDone`, `isBulkSpawnDone`.
- `app/src/components/UnityAROverlay.tsx`: line 32 `import { unmountOverlay } from '../services/arOverlayLifecycle';`. Line 340 `const cleanup = unmountOverlay({...})` inside the `useEffect` cleanup (return) at line 333. REAL import + REAL call site.
- `app/__tests__/ar-re-mount.test.ts`: 3982 bytes. Lines 13-20 真 import 6 个 helper (createOverlayLifecycle, unmountOverlay, isOverlayClean, markSpawned, markBulkSpawnDone, isBulkSpawnDone) from `../src/services/arOverlayLifecycle`. 同 module 同函数,无 mock,无 stub。

## Jest run

```
PASS __tests__/ar-re-mount.test.ts (5.645 s)
Tests: 7 passed, 7 total
```

7/7 PASS。覆盖:
1. fresh mount clean
2. spawnedIds dedupe
3. bulkSpawn 标记
4. unmount 发 OnClearAll Unity 消息
5. unmount 清所有 RN-side state
6. re-mount cycle: unmount → fresh → re-spawn OK
7. multi-cycle 3 轮 all clean

## Reverse mutation

- 改了什么: `unmountOverlay` body 替换为 `return { unityMessages: [] }` — 不发消息,不清 state。
- jest 跑后: **4 failed, 3 passed**。
- Failed tests:
  - `unmount sends OnClearAll`: expect length 1 got 0 (消息没发)
  - `unmount clears all RN-side state`: isOverlayClean false (state 没清)
  - `re-mount cycle`: unmountResult.unityMessages[0] undefined
  - `multi-cycle exit/enter 3 rounds`: 同上 length 0
- Passed (因为只测 fresh state / dedupe / markBulkSpawnDone, 不依赖 unmount): 3 个。
- 真打破 self-licking: **YES**。如果 helper 错,jest 立即抓到 4/7 fail。测试真依赖 helper 行为,不是循环看自己。
- Restore: `mv .bak` 还原,git diff stat 0,wc -l 101 (= 原文件)。re-run jest 7/7 PASS 确认还原干净。

## Production contract

- UnityAROverlay.tsx unmount 真调 helper: **YES**。Line 340-349,把 8 个 useRef 的 `.current` 传给 `unmountOverlay`,Set/Map/array refs 在 helper 内 in-place mutate (clear/length=0)。Scalar refs (lastSentOrigin/bulkSpawned/emptyMarkerFrameCount/lastCameraY) 在 helper 返回后由组件自己 reset (line 351-354) — 因为 JS 不能从 helper 内重赋值组件 ref 的 scalar field。**这点合理但 jest 测试没验** (test 直接传 OverlayLifecycleRefs object,helper 内 mutate scalar 字段也生效;真实组件 ref.current 是 mutable refs 持有的 holder,scalar 重置必须在 caller 做,组件代码已做)。
- Unity messages 真发: **YES**。Line 356-360,for-of 遍历 cleanup.unityMessages,调 `unityRef.current.postMessage(gameObject, method, payload)`,try/catch 包住。OnClearAll 真投递到 Unity native side。

## Verdict

- BLOCKER 真修了吗: **YES (with one Editor/Device caveat)**。
  - Helper 抽出 + jest 7 cases + reverse mutation 真破 4 个 → 不是 self-licking。
  - 生产代码真 import + 真调 + 真发 Unity 消息 + 真清 refs。
  - Same-process re-mount 路径 (RN unmount → cleanup → Unity OnClearAll → re-mount 重新 useRef) 在单元层面已闭环。

- 还没 cover 的场景:
  1. **Editor/真机端到端**: jest 没跑真 Unity bridge,不能保证 Unity 那边 `OnClearAll` 真清了 cairn GameObjects。需要 Editor Play 或真机 + telemetry/aliyun debug_snapshots 确认 Unity 收消息且执行清理 (per feedback_review_loop_dynamic.md)。
  2. **Scalar ref 重置一致性**: helper 内 mutate scalar (lastSentOrigin=null) 对 jest pass,但生产里 caller 又显式 reset 一次 — 双重保险但有点 redundant。如果 helper 签名以后被改成 immutable input,生产代码不会断 (因为它自己也 reset),但 jest 的 isOverlayClean 断言可能从 input object 直接断,与生产 ref holder 行为偏差。低风险但值得记。
  3. **多 ref 类型边界**: rejectionTracker (Map), recentPlanes/observedPlaneYs (array — helper 用 `refs.x = []` 重赋,jest 传的是同一 object,所以重赋 OK;生产 useRef 持有 array,helper 内重赋只改了 helper 内部的局部 refs 对象的 x 字段,**没改 component 的 ref.current**)。**潜在隐患**: helper 内 `refs.recentPlanes = []` 只重赋了传入对象的字段,但 caller 是 `{...spawnedIdsRef.current, recentPlanes: recentPlanesRef.current, ...}` — 这是新 literal,所以 caller 的 ref.current 不会被改回 fresh array。检查生产代码 line 340-349 看,caller 真的传了一个 inline object literal,helper 内 `refs.recentPlanes = []` 改的是这个 literal 的字段,不是 component 的 `recentPlanesRef.current` holder。**真正改 component ref 的只有 Set.clear() 和 Map.clear() (in-place mutation 通过 reference 共享生效)**。array `refs.x = []` 不会传播回 component。
     - **结论**: recentPlanes / observedPlaneYs 在生产里 unmount 后**没被清** (本来 unmount 后组件销毁也无所谓,但若 RN fast-refresh / @azesmway singleton 跨 mount 持有外部 ref 就有 leak 嫌疑)。jest 通过是因为 jest 直接断言传入 object 字段,与组件 ref 行为不一致。
- BLOCKER 单元层 = YES,集成层 = PARTIAL (array refs 重置在生产路径上**没生效**,Unity 端清除未真测)。

**建议给主 agent**:
1. 确认 array refs (recentPlanes, observedPlaneYs) 生产 unmount 是否真清 — 当前看 line 350-354 只补了 4 个 scalar,array 没补。要么 helper 改成接受 ref holders 直接 mutate,要么 caller 也加 `recentPlanesRef.current.length = 0` / `= []`。
2. 同 process re-enter 真机/Editor 测试单独开 Story (per feedback_unity_visual_test.md + feedback_review_loop_dynamic.md),不要靠这个 jest 闭环。
