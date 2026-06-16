# v025 — Cairn AR v0.2.5 架构地图

**作用域**: `UnityARLib/Assets/Scripts/v025/` 自包含 AR 核心 + Visual + Telemetry。

老 v0.2.4 / v199 / v274 等代码不在 v025 scope 内,grep 命中 0 是 phase 0 出口判据。

---

## 目录

```
v025/
├── _README.md                       ← 本文
├── v025.Runtime.asmdef              ← Runtime assembly,只 ref ARFoundation + URP
├── Core/                            ← 接口 / 工厂 / 工具
│   ├── IAnchorPersistence.cs
│   ├── PersistenceFactory.cs        ← #if UNITY_IOS / #if UNITY_ANDROID / Editor 三分支
│   ├── ArkitWorldMapPersistence.cs
│   ├── ArcoreStubPersistence.cs     ← v0.2.5 不 build,NotSupported
│   ├── NullPersistence.cs           ← Editor
│   ├── EventTypes.cs
│   ├── PhaseStepTracker.cs
│   ├── GeoMath.cs
│   ├── LidarAvailability.cs
│   ├── FloorPlaneValidatorV2.cs
│   ├── GroundResolverV2.cs
│   ├── AnchorAttachStrategy.cs
│   └── BlockerSentinel.cs
├── Spawn/
│   ├── CairnSpawnerV2.cs
│   └── PendingAnchorRetryV2.cs
├── Anchor/
│   └── AnchorRecoveryV2.cs
├── Session/
│   └── ArSessionLifecycleV2.cs
├── Visual/
│   ├── CairnBaseRenderer.cs
│   ├── CairnTypeIconRenderer.cs     ← ADR-005 引老 SDF 纹理
│   ├── CeremonyV2Controller.cs
│   ├── TypeParticleV2Controller.cs
│   ├── BillboardYawV2.cs
│   ├── DistanceFaderV2.cs
│   ├── CairnAssemblyV2.cs
│   └── Shaders/                     ← 4 URP HLSL hand-written
├── Telemetry/
│   └── TelemetryBatcherV2.cs
├── Bridge/
│   └── CairnBridgeV2.cs
└── Tests/
    ├── v025.Tests.asmdef            ← EditMode + PlayMode test asm
    ├── AntiPattern/                 ← B/C 反 pattern 单测
    └── Unit/                        ← 算法单测 + lock-step parity
```

## 跨平台

- iOS plant + iOS recall: Tier-S (ARWorldMap relocalize) cm 级
- iOS plant ↔ Android recall: Tier-G (GPS + plane) 米级 — Phase 4 桥接,见 ADR-001
- Android: ADR-002 v0.2.5 不 build,只留代码位置 + Stub

## ADR
见 `_review/v0.2.5/adr/`:
- ADR-001 Tier-S→Tier-G fallback (active, expir Phase 6)
- ADR-002 Android 不 build (active, expir v0.2.6)
- ADR-003 Android stub 测试范围 (active, expir Phase 5)
- ADR-004 视觉降级 feature flag (active, expir v0.2.6)
- ADR-005 SDF 纹理引老 (active, expir v0.2.6)

## 工具
- `python scripts/cairn_lint.py --scope v025` 跑禁词 + catch + Monitor mitigation lint
- `python scripts/verify_progress.py --phase N` 跑证据 + ADR expiration 验证
- `python scripts/lock_plan.py --mode check` 跑 SHA-256 锁验证

Phase 内任何改动 → cairn_lint 必须通过,才能 commit(pre-commit hook 强制)。
