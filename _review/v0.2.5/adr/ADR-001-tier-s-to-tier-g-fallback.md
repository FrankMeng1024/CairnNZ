# ADR-001: Tier-S → Tier-G fallback

## Context
Tier-S = ARKit ARWorldMap relocalize (cm 级精度)。
Tier-G = GPS + ARCore plane / ARKit plane(XZ 米级,Y cm 级)。

iOS plant + iOS recall 使用 Tier-S。当 ARWorldMap 反序列化 / relocalize 失败 / worldMappingStatus 不到 Mapped,直接走 Tier-G。

## Decision
- AnchorAttachStrategy 在 Tier-S 失败(超时 / NSError / status mismatch)→ 落 Tier-G,不继续重试 Tier-S
- 落 Tier-G 时必 emit `v22-TIER-FALLBACK` telemetry 含失败原因
- BlockerSentinel 验证:Tier-S 失败 → Tier-G 必启动(不允许"裸坐标兜底")

## Consequences
- 用户体验:cm 级 → 米级降级,但永远落地不飞天
- 上报数据可见 Tier-S 失败率,Phase 4 可优化
- 实现成本:多一条 fallback path

## Failure modes
- Tier-G 也失败 → BlockerSentinel throw + 拒绝 spawn(不允许裸坐标)
- 用户可能感觉 "spawn 慢"(Tier-S 超时 + Tier-G 重定位)→ 视觉上加 loading indicator

## Expiration phase
Phase 6

## Status
active

## Signoff
- Main agent: 2026-06-16
- User review pending
