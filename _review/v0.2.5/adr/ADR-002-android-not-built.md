# ADR-002: Android 不 build,只留代码位置

## Context
用户硬约束:Android 代码位置留好,但 v0.2.5 不实际编译 Android。
v0.2.6 sprint 才做 Android 真机集成。

## Decision
- v025 包含 ArcoreStubPersistence.cs(NotSupported)
- Editor 跑 #if UNITY_ANDROID 分支用 stub
- 不动 Gradle / 不签 keystore / 不跑 EAS Android
- backend feature_flags 表预留 useV025 开关,Android 用户保持 false

## Consequences
- v0.2.5 收敛快(只 iOS 真机)
- Android 用户继续看老 ARScreenLegacy
- v0.2.6 sprint 单独切

## Failure modes
- 未来 ArcoreStub 实现脱节真 ARCore API → ADR-002 expiration v0.2.6 触发 review

## Expiration phase
v0.2.6(numeric phase 不适用,verify_progress 视为永久 active 直到手动归档)

## Status
active

## Signoff
- Main agent: 2026-06-16
- User review pending
