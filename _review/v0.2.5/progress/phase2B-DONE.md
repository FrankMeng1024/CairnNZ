# Phase 2B — DONE Report

**Phase**: 2B — Visual 自包含
**起始 git tag**: v0.2.5-phase-2B-start (commit 70b846a)
**完成时间(代码层)**: 2026-06-17

## Sub-items completed
- [x] 2B.1 CairnBaseRenderer + CairnBaseGeometry (5-stone stack mesh)
- [x] 2B.2 CairnTypeIconRenderer + QuadGeometry + PlaceholderTextures (round-2 fix)
- [x] 2B.3 CeremonyV2Controller + CeremonyRingGeometry + CeremonySweepMath (atan2 wrap, round-2 fix)
- [x] 2B.4 TypeParticleV2Controller (5-type ParticleSystem dispatcher)
- [x] 2B.5 BillboardYawV2 + DistanceFaderV2 (pure-logic + MonoBehaviour wrappers)
- [x] 2B.6 CairnAssemblyV2 + V025PrefabFactory (EnsurePrefab runtime fallback, round-2 fix)
- [x] 2B.7 4 URP HLSL shaders (CairnBase + CairnTypeIcon + CairnCeremonyRing + CairnTypeParticle); ShadowCaster bias fix in round-2
- [x] 2B.8 Editor capture playground (V025CaptureWindow + EditorCoroutineHost honoring WaitUntil, round-2 fix)
- [-] 2B.9 SSIM gate → ADR-011 defers to Phase 4 EAS build #1 (Unity Editor + Playwright + designer baseline all required)
- [x] 2B.10 ARScreenV2.tsx real (lazy UnityView mount, bridge subscribe, plant button, retry, round-2 fix)
- [x] 2B.11 PROGRESS.md (this section + the main file)
- [x] 2B.12 4 眼 review sub#2B-1 (2B+3C, all fixed) + sub#2B-2 (4B+2C+2M+1Lo, all fixed/documented)
- [x] 2B.13 修光 BLOCKER + CRITICAL → verdict PASS in same round (no round-2 needed)
- [x] 2B.14 commit + tag v0.2.5-phase-3-start

## Lint / verify_progress / lock_plan status
- cairn_lint --scope v025: PASS (59 files clean — was 25 before Phase 2A; +34 in Phase 2A+2B)
- npx jest src/services/v025 src/store/v025: 46/46 PASS unchanged (RN tests not affected)
- lock_plan --mode check: PASS (15 locks)

## Files added (Phase 2B)
- v025/Visual/ — 9 .cs (renderers + assembly + prefab factory + placeholder + math helpers)
- v025/Visual/Shaders/ — 4 URP HLSL shaders
- UnityARLib/Assets/Editor/V025CaptureWindow.cs — EditorWindow + reflection-honoring coroutine host
- v025/Tests/Unit/VisualMathTests.cs (18 tests) + VisualGeometryTests.cs (11 tests)
- ARScreenV2.tsx — replaces Phase 0 stub, real lazy-Unity mount + bridge wire

## ADRs added/revised in Phase 2B
- ADR-005 revised: PlaceholderTextures fallback + Phase 4 designer SDF replacement
- ADR-011 added: Phase 2B SSIM gate deferred to Phase 4 EAS build #1

## Anti-pattern coverage added in Phase 2B
- Mesh degenerate inputs (layers=0, negative radius) — VisualGeometryTests
- PlaceholderTextures cache stability — VisualGeometryTests
- (2B.9 SSIM ≥ 0.65 visual fidelity test deferred — ADR-011)

## Next phase entry point
- Phase 3 sub-item 3.1 — backend migration 016 debug_events_v2

git tag for resume: `v0.2.5-phase-3-start`

## Phase 3 preconditions (from 4-eye concerns_for_phase_3_4)
- TelemetryBatcherV2 must consume CairnSpawnerV2 + AnchorRecoveryV2 + PendingAnchorRetryV2 emit delegates
- Composition root: ArSessionLifecycleV2 owns Tracker, batcher owns emit fn (already documented in CairnSpawnerV2.cs header)
- Backend route /api/v025/debug-events bulk INSERT into debug_events_v2 table
- Auto-mode heartbeat (Rule S): emit v22-AUTO-PROGRESS per sub-item start
