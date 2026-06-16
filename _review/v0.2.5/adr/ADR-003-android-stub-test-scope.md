# ADR-003: Android stub 测试范围

## Context
v0.2.5 不 build Android,但 ArcoreStubPersistence.cs 必须有反 pattern 单测保证未来不被
silently 改成"裸坐标兜底"。

## Decision
- ArcoreStubPersistence 所有方法返回 PersistenceResult.NotSupported
- 反 pattern 单测验证:任何调用 ArcoreStubPersistence.SaveAsync / LoadAsync 必返
  NotSupported(不允许返 Success)
- Editor PlayMode 单测 #if UNITY_ANDROID 跑 stub,#if UNITY_EDITOR 跑 NullPersistence

## Consequences
- 测试覆盖率:Android stub 行为 100%
- 不验证真 ARCore API,这是 ADR-002 已接受的 trade-off
- v0.2.6 切真 ARCore 时 stub 单测全删,改 ARCore 集成单测

## Failure modes
- 单测假阳性(Editor 不跑 Android #if 分支)→ 用 #if UNITY_ANDROID 多 platform Editor
  pseudo-build 验证

## Expiration phase
Phase 5

## Status
active

## Signoff
- Main agent: 2026-06-16
- User review pending
