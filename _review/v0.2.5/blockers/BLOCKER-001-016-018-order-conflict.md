# BLOCKER-001: Phase 0.16 与 0.18 顺序矛盾导致字段删除会编译失败

**类型**: design-flaw
**Phase**: 0
**Sub-item**: 0.16
**Date**: 2026-06-16
**Status**: open

## Description
Plan v3 把 0.16(useMarkerStore 删旧字段 arkitX/Y/Z, arOriginLat/Lng)排在 0.17(删
useArOriginStore.ts)+ 0.18(删 unityCairnSpawn.ts)之前。但这些旧字段在 0.18 文件中被
直接读写,如果先在 0.16 删字段,unityCairnSpawn.ts(还没删)会立刻编译失败。

UnityAROverlay.tsx 也读这些字段,且 UnityAROverlay 不在 plan 删除清单里 — 它服务于
ARScreenLegacy。

## Reproduction
- grep arkitX/arkitY/arOriginLat → 5 files,其中 useMarkerStore 是定义方,unityCairnSpawn
  + spike.test + UnityAROverlay + ARScreenLegacy 是消费方
- 任何一个消费方未先 stub 就删 store 字段 → tsc 报错

## Impact
- 阻塞 sub-item: 0.16
- 影响 phase 闭合: yes,但可推后到 0.18 + UnityAROverlay 调整完成后做

## Proposed resolution
按"消费先剪 / 定义后删"顺序执行:
1. 先做 0.17(删 useArOriginStore.ts — 也是字段消费方之一)
2. 0.18 删 unityCairnSpawn.ts
3. 0.19 删 spike test
4. 看 UnityAROverlay.tsx + ARScreenLegacy.tsx 还在用 arkitX 等字段 → 不能删字段!
   ARScreenLegacy 是 v0.2.5 用户硬约束的 kill switch,Phase 7 才能删。
5. 因此 **0.16 改为延期到 v0.2.6**,字段保留作为 ARScreenLegacy 兼容,Phase 0 关闭时
   v025/ scope 内 grep 命中 0(ARScreenLegacy 在 app/src/screens/ 不在 v025 scope),
   出口判据仍可达成。
6. 写 ADR-006 记录字段保留至 ARScreenLegacy 退役。

## Resolution log
- 2026-06-16 22:30 主 agent: 写 BLOCKER + 跳过 0.16,改写 ADR-006 待用户 review

## User input required
否(主 agent 自决,ADR-006 记录决定)
