# Phase 4 — DONE Report

**Phase**: 4 — iOS ARWorldMap Editor 集成
**起始 git tag**: v0.2.5-phase-4-start (commit 213d4b4)
**完成时间(代码层)**: 2026-06-17

## Sub-items completed
- [x] 4.1a CairnFileExclude.mm ObjC bridge (NSURLIsExcludedFromBackupKey)
- [x] 4.1b ArkitWorldMapPersistence.cs DllImport + Editor mock — Phase 1A shell retained per ADR-014; Phase 5 enables HAS_ARKIT_WORLDMAP define + writes ArkitWorldMapPersistence.iOS.cs (1-file change)
- [x] 4.1c .meta marks iOS only — meta authored
- [-] 4.2 ArkitWorldMapPersistence 完整 → ADR-014 deferred to Phase 5 (single-file enable)
- [x] 4.3 WorldMapLoadGateV2.cs + 7 unit tests (round-2 + terminal latch)
- [x] 4.4 worldMapPreloader.ts (preload + 404-empty-body + delete-on-error)
- [x] 4.5 backend route v025/worldmaps.js (rate-limited + 50MB cap + path-safe)
- [x] 4.6 ARWorldMap anti-pattern coverage — Phase 1A Anchor_C5_NoBareGpsXyz pins Tier-S NoCache→Tier-G fallback; new MapVersionMismatch/MapCorrupt outcomes covered by AnchorAttachStrategy
- [x] 4.7 双 Tier 集成 — composition root V025Bootstrap.cs wires AnchorAttachStrategy + lifecycle.Tracker + Telemetry; Phase 1A Anchor_C5 EditMode pins logical correctness; PlayMode cross-device test deferred to Phase 5
- [x] 4.8 PROGRESS.md
- [x] 4.9 4 眼 review (sub#4-1 0B+2C+3M+2Lo + sub#4-2 1B+1C+1M+2Lo) — all fixed in same round
- [x] 4.10 修光 → final verdict PASS
- [x] 4.11 commit + tag v0.2.5-phase-5-start

## Lint / lock_plan / jest status
- cairn_lint --scope v025: PASS (71 files clean — was 64 in Phase 3)
- npx jest: 53/53 PASS unchanged (RN side: cairnBridgeV2/cairnSpawnV2/featureFlags/geoMath/stores/telemetryBatcher)
- lock_plan PASS (15 locks)
- Live backend test (Phase 3): curl 200 + DB row inserted

## Files added (Phase 4)
- UnityARLib/Assets/Plugins/iOS/CairnFileExclude.mm + .meta
- v025/Anchor/WorldMapLoadGateV2.cs + Tests/Unit/WorldMapLoadGateV2Tests.cs (7 tests)
- v025/Bootstrap/V025Bootstrap.cs (composition root)
- app/src/services/v025/worldMapPreloader.ts
- app/src/services/v025/telemetrySingleton.ts
- backend/src/routes/v025/worldmaps.js
- App.tsx + ARScreenV2.tsx wiring

## ADRs added (Phase 4)
- ADR-014 ArkitWorldMap real impl deferred to Phase 5 (single-file enable)

## Phase 5 entry point
- Phase 5 must enable HAS_ARKIT_WORLDMAP define in ProjectSettings
- Phase 5 must write ArkitWorldMapPersistence.iOS.cs (real ARKit ARWorldMap calls)
- Phase 5 must run EAS build #1 + real-device plant + recall + verify Tier-S cm precision
- Phase 5 cross-device test: device A plant → device B recall → expect Tier-G fallback (ADR-001)
- ⏸ Phase 5/6/7 require explicit user "EAS#1 build 授权" per USER_AUTHORIZATION.md

git tag for resume: `v0.2.5-phase-5-start`
