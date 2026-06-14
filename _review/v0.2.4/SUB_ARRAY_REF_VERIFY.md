# SUB_ARRAY_REF_VERIFY — Independent Reviewer Verdict

## Grep 验证
- helper `arOverlayLifecycle.ts:59-60` 用 `refs.recentPlanes.length = 0` + `refs.observedPlaneYs.length = 0` ✅ in-place truncate
- 文件内**无** `= []` 重赋(只剩 line 56 注释解释为何不能重赋)✅
- caller `UnityAROverlay.tsx:359-360` 真有 `recentPlanesRef.current.length = 0` + `observedPlaneYsRef.current.length = 0` ✅
- jest `ar-re-mount.test.ts:110` 有 `it('arrays in-place truncated ...')`,line 127 `expect(refs.recentPlanes).toBe(recentPlanesRefHolder)` 真断言同一 array ref ✅

## Jest run
- pass count: **8/8** (Time 1.238s)
- 包含目标 case `arrays in-place truncated ... caller ref holders see change` PASS

## Reverse mutation
- 临时把 helper 改回 `refs.recentPlanes = []` + `refs.observedPlaneYs = []`(模拟原 BLOCKER)
- jest fail: **1 个**(`arrays in-place truncated`),其它 7 个仍 pass
- Fail 信息: `expect(recentPlanesRefHolder.length).toBe(0)` Expected: 0 / Received: 2 — 证明 caller ref holder 在重赋情况下仍持有旧 array,未被清空
- 真打破 self-licking ✅ test 不是恒真,有真正 mutation kill power
- Restore 后再跑 8/8 全过 ✅

## Production contract
- caller in-place truncate **真在生产 unmount path 上** (UnityAROverlay.tsx line 346 helper 调用 → line 359-360 显式 truncate),不是 dead code
- 双重保险 = **必要**而非冗余: helper 的 in-place truncate 只对传入的 `inlineObjectLiteral.recentPlanes` 字段生效,但 caller 把 `recentPlanesRef.current` (即原 array reference) 作为字段值传入。helper truncate 该字段 = truncate 同一 array reference,理论上 caller ref 也已清空。caller 再 truncate 一次属于"显式防御",不是冗余 — 因为如果将来 helper 误改回 `= []`,caller 这一行还能兜底。**注释 line 356-360 也明确写了这层防御**。
- 注: 严格说,这是"双重 in-place truncate"的防御编程,helper 单独已能清空(因 ref 共享);但加了 caller 一行后,即使 helper 退化也不会出 ghost pillar bug。

## Verdict
- BLOCKER 真修了? **YES**
  - helper in-place ✅
  - caller in-place ✅
  - jest 真断言同一 array ref + 反向 mutation 真 fail ✅
  - 生产 unmount path 真走这两段 ✅
  - 主 agent 三项 claim 全部 cross-check 通过,无虚报
