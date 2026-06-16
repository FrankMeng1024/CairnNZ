# Phase 2A — DONE Report

**Phase**: 2A — GPS path main flow (RN + Unity bridge)
**起始 git tag**: v0.2.5-phase-2A-start (commit 82cacd3)
**完成时间(代码层)**: 2026-06-17

## Sub-items completed
- [x] 2A.1 cairnSpawnV2.ts + 8 单测(`app/src/services/v025/cairnSpawnV2.ts:1`)
- [x] 2A.2 geoMath.ts + parity fixture loader 单测(`app/src/services/v025/geoMath.ts:1` consumes `_review/v0.2.5/fixtures/geomath_parity.json`)
- [x] 2A.3 CairnSpawnerV2.cs(`v025/Spawn/CairnSpawnerV2.cs`)+ 3 单测
- [x] 2A.4 PendingAnchorRetryV2.cs(`v025/Spawn/PendingAnchorRetryV2.cs`)+ 5 单测(per-attempt telemetry round-2)
- [x] 2A.5 AnchorRecoveryV2.cs(`v025/Anchor/AnchorRecoveryV2.cs`)+ 6 单测 + Rule P MitigateOrReset
- [x] 2A.6 ArSessionLifecycleV2(`v025/Session/ArSessionLifecycleV2.cs`)+ 7 单测(含 Teardown-during-spawn)
- [x] 2A.7 useCairnStoreV2 + useArSessionStoreV2(`app/src/store/v025/`)+ 15 单测
- [x] 2A.8 CairnBridgeV2 RN + Unity sides(`app/src/services/v025/cairnBridgeV2.ts` + `UnityARLib/.../v025/Bridge/CairnBridgeV2.cs`)+ MiniJson + 4 Unity 单测 + 3 RN 单测
- [x] 2A.9 反 pattern B1(`Spawn_AntiPattern_B1_NoTierAArkitXyz.cs`)— scope=Core only(round-2 修)
- [x] 2A.10 GpsAlgorithmLockStepTests.cs — pin constants + behavioral parity
- [x] 2A.11 PROGRESS.md
- [x] 2A.12 4 眼 review:Round-1 sub#2A-1 (1B/4C) + sub#2A-2 (2M/5Lo)。所有 BLOCKER/CRITICAL fixed in same round.
- [x] 2A.13 修光 BLOCKER + CRITICAL,verdict 终态 PASS → `_review/v0.2.5/verdicts/phase2A-signoff.md`
- [x] 2A.14 commit + tag v0.2.5-phase-2B-start

## Lint / verify_progress / lock_plan status
- cairn_lint --scope v025: PASS (48 files clean — was 25 before Phase 2A)
- npx jest src/services/v025 src/store/v025: 46/46 PASS (5 suites)
- lock_plan --mode check: PASS (15 locks)

## Anti-pattern coverage added in Phase 2A
- B1 (no naked GPS XYZ): Spawn_AntiPattern_B1_NoTierAArkitXyz (reflection-based)
- B3 (no infinite retry): PendingAnchorRetryV2 wall-clock timeout test

## Files added (Phase 2A)
- v025/Spawn/CairnSpawnerV2.cs + PendingAnchorRetryV2.cs (+ tests)
- v025/Anchor/AnchorRecoveryV2.cs (+ tests)
- v025/Session/ArSessionLifecycleV2.cs (+ tests)
- v025/Bridge/CairnBridgeV2.cs (+ MiniJson + tests) — round-2 BLOCKER fix
- v025/Tests/AntiPattern/Spawn_AntiPattern_B1_NoTierAArkitXyz.cs
- v025/Tests/Unit/GpsAlgorithmLockStepTests.cs
- app/src/services/v025/{geoMath,cairnSpawnV2,cairnBridgeV2,MessageTypes,featureFlagsClient}.ts (+ __tests__)
- app/src/store/v025/{useArSessionStoreV2,useCairnStoreV2}.ts (+ tests)

## Next phase entry point
- Phase 2B sub-item 2B.1 — CairnBaseRenderer.cs

git tag for resume: `v0.2.5-phase-2B-start`

## Phase 2B preconditions (from 4-eye concerns)
- CairnAssemblyV2 must subscribe to v025/spawn-ok and instantiate prefab at finalXyz
- If Phase 2B adds Task<AnchorAttachOutcome> producers, refactor AntiPattern B1 to IAttachOutcomeProducer
- UI must add wait-for-flags gate or accept first-launch fail-closed window
- useCairnStoreV2 needs UI-side filter for stale 'refused' entries
- CairnBaseRenderer / CairnTypeIconRenderer / CeremonyV2Controller / TypeParticleV2Controller all in v025/Visual/
- 4 URP HLSL shaders in v025/Visual/Shaders/
- ADR-005 allows引老 SDF 纹理 (Resources/cairn_type_sdf/)
- 视觉对比 SSIM:Playwright 截 HTML demo `localhost:8766/design_v2026-06_variant_C_3D.html?v=22day10` → Editor capture 4 时点 → ≥ 0.65
