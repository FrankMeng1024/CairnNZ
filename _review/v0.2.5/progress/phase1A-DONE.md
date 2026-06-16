# Phase 1A — DONE Report (draft, 4-eye review pending)

**Phase**: 1A — Core 接口 + Android stub + 工具类
**起始 git tag**: v0.2.5-phase-1A-start
**完成时间(代码层)**: 2026-06-17

## Sub-items completed
- [x] 1A.1 IAnchorPersistence interface(Core/IAnchorPersistence.cs)
- [x] 1A.2 PersistenceFactory(#if UNITY_IOS / UNITY_ANDROID / Editor)
- [x] 1A.3 ArkitWorldMapPersistence(Phase 4 will fill real impl;Phase 1A returns NoCache for Load,IoError stub for Save on iOS;NotSupported on other platforms)
- [x] 1A.4 ArcoreStubPersistence(NotSupported,见 ADR-002)
- [x] 1A.5 NullPersistence(Editor / fallback)
- [x] 1A.6 EventTypes + V025Phases + V025Outcomes + PhaseStepTracker(Rule H phase/step/seq/sessionInstanceId)
- [x] 1A.7 GeoMath + 9 单测(Haversine、ENU 双向、bearing 0/90/180/270 + 范围 + 1cm round-trip)
- [x] 1A.8 LidarAvailability sticky cache + 反 pattern C8 单测(no-flicker 验证)
- [x] 1A.9 FloorPlaneValidatorV2 + 8 边界单测 + Rule P ResolveFallback() mitigation
- [x] 1A.10 GroundResolverV2 + 反 pattern B10 (no Y=0 default) 单测
- [x] 1A.11 AnchorAttachStrategy + 反 pattern C5 (no naked GPS XYZ) 单测
- [x] 1A.12 BlockerSentinel + 4 单测(emit-before-throw + null guards)

## Lint / verify_progress / lock_plan status
- cairn_lint --scope v025: PASS (23 files clean — was 4 after Phase 0)
- lock_plan --mode check: PASS (15 locks match)

## Files added
- `UnityARLib/Assets/Scripts/v025/Core/`(11 .cs):
  - IAnchorPersistence.cs, PersistenceFactory.cs, ArkitWorldMapPersistence.cs,
    ArcoreStubPersistence.cs, NullPersistence.cs, EventTypes.cs,
    PhaseStepTracker.cs, GeoMath.cs, LidarAvailability.cs,
    FloorPlaneValidatorV2.cs, GroundResolverV2.cs, AnchorAttachStrategy.cs, BlockerSentinel.cs
- `UnityARLib/Assets/Scripts/v025/Tests/Unit/`:
  - GeoMathTests.cs, FloorPlaneValidatorV2Tests.cs, BlockerSentinelTests.cs
- `UnityARLib/Assets/Scripts/v025/Tests/AntiPattern/`:
  - Lidar_AntiPattern_C8_NoFlicker.cs
  - Ground_AntiPattern_B10_NoNakedYZero.cs
  - Anchor_AntiPattern_C5_NoBareGpsXyz.cs

## Anti-pattern coverage
- C5 (naked GPS XYZ): Anchor_AntiPattern_C5
- C6/C7 (plane size + alignment): FloorPlaneValidatorV2Tests
- C8 (LiDAR flicker): Lidar_AntiPattern_C8
- B6/B7/B7' (plane normal + height): FloorPlaneValidatorV2Tests
- B10 (Y=0 default ground): Ground_AntiPattern_B10

Phase 2A 反 pattern (B1/B2/B3 + spawn-flow) 留给该 phase。

## Rule P compliance
- FloorPlaneValidatorV2 (ends with Validator) → exposes static ResolveFallback()
- LidarAvailability is named *Availability* (no Rule P trigger; it is not a Monitor/Validator/Observer)
- BlockerSentinel is named *Sentinel* (no Rule P trigger)

cairn_lint --scope v025 confirms Rule P passes.

## Next
- 1A.13 本报告 + PROGRESS.md
- 1A.14 4 眼 review (sub#1A-1 + sub#1A-2)
- 1A.15 修光 BLOCKER + CRITICAL
- 1A.16 commit + tag v0.2.5-phase-2A-start
