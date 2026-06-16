# ADR-014: Phase 4 ArkitWorldMap real impl + composition wiring requires EAS build verification

## Context
Phase 4 plan §4.2 / §4.7 要求 ArkitWorldMapPersistence 完整实现(GetARWorldMapAsync /
Serialize / TryDeserialize / SetWorldMap)+ 双 Tier 集成。

主 agent 在 session 期间评估:**写完整 ARFoundation 6.0+ ARKit ARWorldMap C# 代码、
不在 Unity Editor 测试、不在 EAS iOS device 验证 = 风险高**(API 签名 hallucination
可能导致编译失败或运行时 NullReference)。

## Decision

### A. Phase 1A shell 保留为生产代码
- ArkitWorldMapPersistence Phase 1A 实现保留:Editor + Android 返回 NotSupported,
  iOS 真机返回 NoCache(load) / IoError(save)
- shell 已通过 cairn_lint + Phase 1A 单测 + Phase 2A AnchorAttachStrategy 集成测试
- 行为正确:Tier-S NoCache → AnchorAttachStrategy 走 Tier-G → 正确 fallback

### B. Phase 4 真机时启用 HAS_ARKIT_WORLDMAP define
- Phase 5 EAS build 之前(用户授权后):
  1. 主 agent 写 ArkitWorldMapPersistence.iOS.cs(`#if HAS_ARKIT_WORLDMAP` 守护)
  2. 在 ProjectSettings/PlayerSettings → ARKit XR Plugin 文件中确认 ARWorldMap API 存在
  3. UnityARLib/ProjectSettings/ProjectSettings.asset 加 `HAS_ARKIT_WORLDMAP` 到 iOS
     scripting define symbols
  4. Editor 运行 — 编译过 → 提交
- Phase 5 EAS build #1 真机 plant + recall:验证 GetARWorldMapAsync + SetWorldMap +
  worldMappingStatus=Mapped 真有效

### C. WorldMapLoadGateV2 + ObjC bridge + worldMapPreloader.ts + backend route 已在 Phase 4 完成
- ObjC bridge `Plugins/iOS/CairnFileExclude.mm` ✅
- `WorldMapLoadGateV2.cs` + 5 单测 ✅
- `worldMapPreloader.ts` ✅
- `backend/src/routes/v025/worldmaps.js`(rate-limited,50MB cap)✅
- 这些都是 ArkitWorldMapPersistence.iOS.cs 的支撑代码,已就绪

### D. 双 Tier 集成已经在 AnchorAttachStrategy + Anchor_C5 测试覆盖
- AnchorAttachStrategy.AttachAsync:Tier-S Load → NoCache/Timeout/MapVersionMismatch/MapCorrupt → Tier-G plane scan → Tier-G raycast → Refused
- Anti-pattern C5 测试 pin 所有路径不返回 naked GPS XYZ
- Phase 4 真机测试时:plant 手机A → recall 手机A 同位置 = AttachedTierS
  → 距离误差 <2cm。失败 → ADR-001 Tier-G fallback 触发,误差 <2m。

## Consequences
- (+) Phase 4 closeout 不需要 hallucinated ARKit API 代码
- (+) 4.1 + 4.3 + 4.4 + 4.5 + 4.6 全部完成,Phase 4 EAS 真机时启用 4.2 是 1 文件改动
- (+) Phase 1A shell 保持测试通过,不破坏既有 4 眼 review 结果
- (-) "Phase 4 完成"语义:**代码层完整 + ARWorldMap 真实路径需 Phase 5 EAS 启用**

## Failure modes
- Phase 5 EAS 启用 HAS_ARKIT_WORLDMAP 时编译失败 → 主 agent 修 API 签名
  (Editor 错误立即可见,不是真机才发现)
- ARWorldMap.TryDeserialize 在不同 ARKit 版本失败 → MapVersionMismatch outcome
  已加(Phase 1A round-2 ADR-010 修),caller 行为正确

## Expiration phase
Phase 5(EAS build #1)— 届时 HAS_ARKIT_WORLDMAP 启用,本 ADR 归档

## Status
active

## Signoff
- Main agent: 2026-06-17
- User review pending
