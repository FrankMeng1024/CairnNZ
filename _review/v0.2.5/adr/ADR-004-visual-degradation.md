# ADR-004: 视觉降级(B6/B7/B8/C9)

## Context
PR-3 + PR-4 review 标记 B6/B7/B8/C9 视觉项暂留余地:
- B6: 仪式 sweep 低端机帧率不达标 → 允许降级到静态光圈(无动画)
- B7: 5 type 粒子动效 GPU 占用过高 → 允许从 sprite-based 降级到 mesh-based 简化
- B8: billboard SDF 在 Android low-end 模糊 → 允许 ADR-002 推迟修
- C9: distance fader curve 不匹配设计 → 允许 v0.2.6 调

## Decision
- v0.2.5 视觉范围按 plan 实现完整版
- 出现 B6/B7/B8/C9 列举的具体性能/视觉问题 → 允许走简化路径,代码必须留 enable/disable
  feature flag(useFullVisuals=true 默认)
- 真机测出问题再切 false

## Consequences
- 主流机型(iPhone 13+ / Pixel 6+)看完整版
- 旧机视觉降级,但永远落地不飞天(核心约束不变)
- 留 feature flag = 多一条 if 分支,可控

## Failure modes
- feature flag 漂移:多设备多版本不一致 → 通过 telemetry useFullVisuals 字段聚合监控

## Expiration phase
v0.2.6

## Status
active

## Signoff
- Main agent: 2026-06-16
- User review pending
