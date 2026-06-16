# ADR-010: Phase 1A interface design choices (IsPlatformSupported, Static ResolveFallback, GeoMath limits)

## Context
Phase 1A 4 眼 review (#1A-1, #1A-2) 提出三个设计选择问题:
1. `IAnchorPersistence.IsPlatformSupported` 是否 dead surface(无消费方)
2. `FloorPlaneValidatorV2.ResolveFallback` 是 static 方法,Rule P 要求 Mitigate*/Recover*/Resolve* 但没说 instance vs static
3. GeoMath 没有高纬度 / >1km 防御,假设全部使用在 ARSession 半径内

## Decision

### A. IsPlatformSupported 保留为 future API
- 当前 AnchorAttachStrategy 仅消费 LoadAsync outcome,不读 IsPlatformSupported。
- 但 Phase 2A 的 cairnSpawnV2.ts 在 plant flow 起始就需要"persistence 是否可用"的早期 UI hint
  ("AR 不可用,请使用地图模式")—— 这个判断点早于 Save/Load 调用。
- IsPlatformSupported 是 PRE-Save UI hint 的接口,Phase 2A 会调用。
- **不删除。Phase 2A 验证消费。**

### B. ResolveFallback 保留 static
- Rule P 的目标是"Monitor/Validator/Observer 类必须暴露 mitigation 路径",静态或实例都满足"暴露"要求。
- 当前 mapping 是常量(reason → action 一对一),没有 instance 状态依赖。
- 如果未来 Phase 4 引入 runtime tunable thresholds(例如 basement mode),届时迁移到 instance:
  - `static FallbackAction ResolveFallback(PlaneRejectReason reason)` →
    `FallbackAction ResolveFallback(PlaneRejectReason reason)` (instance)
  - 测试改动:`FloorPlaneValidatorV2.ResolveFallback(...)` → `_v.ResolveFallback(...)`
  - 这是 1 行 diff,不构成现在的 blocker。
- **保留 static + 写本 ADR + Phase 4 review 触发器**(届时 ADR 加 amendment)。

### C. GeoMath 高纬 / 远距离限制
- v0.2.5 的 ENU 转换全部在 cairn spawn 半径内(< 100m),flat-earth approximation 误差 < 1cm。
- 高纬度(> 70°N/S)地区:用户极少;若有用户在极地地区使用 Cairn,LatLngToEnuMeters 中的
  `Math.Cos(originLat)` 接近 0 但不等于 0(80° 时 cos=0.174,误差仍 < 10cm 在 100m 范围内)。
- > 1km 距离:Cairn marker 间距离用 Haversine,ENU 仅用于 AR 渲染。
- **不加 runtime guard。** 加 unit test 文档化高纬 + 5km Haversine 行为(已加 round-2)。
- 极端边界(>> 80°,>> 1km)时的失败模式由 Phase 2A cairnSpawnV2 调用方决定:
  - cairnSpawnV2 之前已用 Haversine 验证 < 100m,才进 ENU 转换
  - 验证失败 → spawn 拒绝(BlockerSentinel)
- 这是 caller-side 约束,不是 GeoMath 自身职责。

### D. AnchorAttachStrategy.cancel 在 plane scan 内 honor(已修复 round-2)
- 修复后:每个 plane scan iteration 起始 + raycast 之前检查 cancel。
- Anti-pattern test C5 加 cancellation 测试已锁住此行为。

## Consequences
- (+) Phase 2A 不被 IsPlatformSupported / ResolveFallback 静态选择阻塞
- (+) GeoMath 极端使用模式有 ADR 记录,未来高纬市场扩展时可以决策
- (-) 未来 Phase 4 ResolveFallback 迁移 instance 时需 1 行 diff + 更新本 ADR

## Failure modes
- Phase 2A cairnSpawnV2 漏调 IsPlatformSupported → UI 缺少早期 hint,但 Save/Load 仍正常返回
  NotSupported,功能不会崩溃,只影响 UX
- Phase 4 加 instance 状态但忘了迁移 ResolveFallback → ResolveFallback 还能编译,但拿不到实例
  数据 → 行为退化但不崩溃。需 Phase 4 self-check。

## Expiration phase
- §A IsPlatformSupported retention: **Phase 2A**(end-of-phase audit:cairnSpawnV2.ts 是否真消费 IsPlatformSupported?未消费 → 删 + 3 impls)
- §B Static ResolveFallback retention: Phase 4(届时 review 是否需要 instance)
- §C GeoMath caller-side constraint: 永久(架构决定)
- §D Cancellation 已修复 in round-2(无 expiration)

## Status
active

## Signoff
- Main agent: 2026-06-17
- User review pending
