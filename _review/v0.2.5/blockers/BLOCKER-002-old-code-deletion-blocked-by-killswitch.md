# BLOCKER-002: Phase 0.17/0.18/0.19/0.20 删除清单与 ARScreenLegacy 存活矛盾

**类型**: design-flaw
**Phase**: 0
**Sub-item**: 0.17, 0.18, 0.19, 0.20
**Date**: 2026-06-16
**Status**: open

## Description
Plan v3 §0.17-0.20 要求删除:
- 0.17 useArOriginStore.ts
- 0.18 unityCairnSpawn.ts
- 0.19 spike test crossSession.spike.test.ts
- 0.20a-c 6 个 Unity .cs(PendingAnchorRetry / AnchorDriftMonitor / CrossSessionGroundSnap /
  GroundYResolver / FloorPlaneValidator / Phase3CoroutineHost)

但所有这些被 ARScreenLegacy / UnityAROverlay / unityBridge / useAppStore / a8Migration /
useMarkerStore 引用,这些消费方都不在 v025 scope,且被 Rule Q feature flag kill switch
要求保留可工作至 Phase 7。

强删 → ARScreenLegacy 编译链断 → kill switch 死 → 真机验证失败 → 整 v0.2.5 不可发布。

具体引用:
- useArOriginStore: 7 文件(ARScreenLegacy / OtaBadge / UnityAROverlay / unityBridge /
  store / useAppStore / a8Migration)
- unityCairnSpawn: 5 文件(同 BLOCKER-001 列表 + spike.test)
- 6 个 Unity .cs:Unity 端编译失败影响整 UnityARLib

## Reproduction
- grep useArOriginStore → 7 files
- grep unityCairnSpawn → 5 files
- 删任一定义文件 → 这些消费方编译失败

## Impact
- 阻塞 sub-item: 0.17, 0.18, 0.19, 0.20a, 0.20b, 0.20c, 0.20d
- 影响 phase 闭合: yes (4 个 sub-item 不能 [x])
- 但 v025 scope 仍可干净:这些老代码全在 app/src/ 不在 v025/

## Proposed resolution
按 BLOCKER-001 的同一逻辑(ADR-006)统一处置:
1. 0.17/0.18/0.19/0.20 全部延期到 Phase 7(ARScreenLegacy 退役 sprint)
2. v025 scope 内不允许引用这些老文件 — 由 v025.Runtime.asmdef references 列表
   阻止(asmdef 不 ref unityCairnSpawn 等)
3. Phase 0 出口判据中"老 schema grep 命中数 0(v025 scope)" 仍可达成
4. 写 ADR-007 把所有"老代码处置 → Phase 7"统一记录

## Resolution log
- 2026-06-16 22:35 主 agent: 写 BLOCKER + 跳过 0.17-0.20,扩 ADR-007

## User input required
否(主 agent 自决,ADR-007 记录)
