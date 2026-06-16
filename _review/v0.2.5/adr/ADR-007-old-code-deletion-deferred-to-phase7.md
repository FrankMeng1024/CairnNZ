# ADR-007: 老代码删除统一延期至 Phase 7 (ARScreenLegacy 退役 sprint)

## Context
Plan v3 §0.17-0.20 要求删除老 RN store / service / Unity .cs 共 9 个文件。
但所有被 ARScreenLegacy + UnityAROverlay + unityBridge + useMarkerStore 等 kill switch
保留路径引用。Rule Q 要求 ARScreenLegacy 在 Phase 7 用户签字后才删。

## Decision
- 0.17 useArOriginStore.ts: **保留** 至 Phase 7
- 0.18 unityCairnSpawn.ts: **保留** 至 Phase 7
- 0.19 unityCairnSpawn.crossSession.spike.test.ts: **保留** 至 Phase 7
- 0.20a grep ✅ 已做(本 ADR 同 BLOCKER-002 中列出消费方)
- 0.20b/c 6 个 Unity .cs: **保留** 至 Phase 7
- 0.20d Unity Editor 编译验证: 仍可做(代码不动,验证当前编译通过)

替代:v025 scope 内确保不引用这些老文件:
- v025.Runtime.asmdef references 显式列出(只 ref ARFoundation/URP/Unity 系列,不 ref
  老 .cs)
- cairn_lint --scope v025 grep 老文件名命中 0
- Phase 7 时:用户签字 → 一次性删 ARScreenLegacy + UnityAROverlay 链上所有老代码 + 字段

## Consequences
- Phase 0 出口判据"老 schema grep 命中 0(v025 scope)" 可达成 — v025 目录内无引用
- v0.2.5 总体可执行,EAS build 真机验证不被阻塞
- 老代码冗余在 git 中保留,Phase 7 一次性清理

## Failure modes
- 老代码意外被 v025 scope 文件引用 → cairn_lint scope=v025 + asmdef boundary 双保险
- Phase 7 漏删 → checklist 单独追加(已记录在本 ADR)

## Expiration phase
Phase 7

## Status
active

## Signoff
- Main agent: 2026-06-16
- User review pending
