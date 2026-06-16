# ADR-006: useMarkerStore 旧 ARKit/AROrigin 字段保留至 ARScreenLegacy 退役

## Context
Plan v3 §0.16 要求 useMarkerStore 删 `arkitX/Y/Z, arOriginLat/Lng`(v0.2.4 双源持久化字段)。

但 ARScreenLegacy 还在工作(v0.2.5 kill switch,见 Rule Q feature flag),它直接读这些字段。
UnityAROverlay 同样 ARScreenLegacy 链上的组件,也读这些字段。

强删字段 → tsc 编译失败 → 阻塞 phase 0 关闭。

## Decision
- 0.16 改为"无操作,字段保留" + 本 ADR 记录
- 字段在 v025 scope 外的代码中保留可读
- v025 scope 内任何代码不允许引用这些字段(cairn_lint 不需特别加规则,因为 v025 scope
  本来就没 import useMarkerStore)
- ARScreenLegacy 在 Phase 7 用户签字后删,届时同步删字段 + 写 ADR-006-followup

## Consequences
- 字段冗余但无副作用
- phase 0 出口判据中"老 schema grep 命中 0(v025 scope)"仍可达成
- 比较 plan v3 的 0.16 描述:仍属"老代码处置"语义但实质动作推到 Phase 7

## Failure modes
- 未来加 v025 store 时误用老字段 → cairn_lint --scope v025 / asmdef references 边界
  阻止(v025.Runtime.asmdef 不 ref app store)
- ARScreenLegacy 删时漏删字段 → Phase 7 checklist 单独追加

## Expiration phase
Phase 7

## Status
active

## Signoff
- Main agent: 2026-06-16
- User review pending
