# ADR-012: Phase 3.5-3.8 telemetry wiring deferred to Phase 4

## Context
Phase 3 sub-items:
- 3.1 backend migration 016 ✅ done
- 3.2 backend route /api/v025/debug-events ✅ done(live curl 验证 returned `{"inserted":1}`)
- 3.3 TelemetryBatcherV2.cs + 8 单测 ✅ done
- 3.4 RN telemetryBatcher.ts + 7 单测 ✅ done
- 3.5 接入所有 v22-* 事件埋点 — 需要 wiring across CairnSpawnerV2/AnchorRecoveryV2/PendingAnchorRetryV2/ARScreenV2 + Editor PlayMode 验证
- 3.6 Auto-mode heartbeat (Rule S) — 主 agent 在 sub-item 起始 emit `v22-AUTO-PROGRESS` event,需要工具脚本改造
- 3.7 BlockerSentinel + Telemetry 集成测试 — PlayMode tests required
- 3.8 backend smoke test — 需要真机或 Editor 跑完整 spawn flow

## Decision
将 3.5-3.8 按下面的方式延期/降级:

### A. 3.5 wiring → Phase 4 EAS build #1
Phase 4 的 ARScreen + Composition root 必须连接:
1. `ArSessionLifecycleV2.Tracker` 注入 `CairnSpawnerV2` / `PendingAnchorRetryV2` / `AnchorRecoveryV2` / `BlockerSentinel` 全部实例
2. `TelemetryBatcherV2.AddEvent` 注入到上面所有 emit fn 位置
3. RN 端 `telemetryBatcher` instance 在 App boot 时 hold,ARScreenV2 onUnityMessage 收 v025/telemetry → batcher.addEvent
4. 定时器(setInterval 5s)调 batcher.maybeFlush(force=true)

Phase 3 已完成的"3.3 + 3.4"提供了 wiring 所需的全部抽象(emit delegate + AddEvent 接口)。

### B. 3.6 heartbeat → 工具脚本(scripts/auto_progress_emit.py)放 Phase 4
Auto-mode heartbeat 是主 agent 工具,不是 v025 runtime 代码。Phase 4 创建 emit 脚本读
backend/.env + post 到 /api/v025/debug-events,主 agent 在 sub-item 起始调用一次。

### C. 3.7 集成测试 → Phase 4 PlayMode
EditMode 单测覆盖 BlockerSentinel + TelemetryBatcher 单独行为(已在 Phase 1A.12 + Phase 3.3 完成)。
两者集成的 PlayMode 测试需要真 ARSession,推迟到 Phase 4 Editor 跑。

### D. 3.8 backend smoke → Phase 4 EAS 真机
backend route 已 curl 验证 inserted=1。完整 smoke 需要真机产生 spawn flow + 看 backend 收到。
Phase 4 EAS build 自动覆盖。

## Consequences
- (+) Phase 3 的代码层完整(migration + route + 2 batcher + 15 单测)
- (+) Phase 4 的 wiring 是"已就绪材料的组装",不是新设计
- (-) Phase 3 不算"Done with full integration",更准确说是"infrastructure ready"
- (-) 主 agent heartbeat(Rule S)在 Phase 4 之前不工作 — backend 监控 60min 无 event
  来检测主 agent 死的能力延后

## Failure modes
- Phase 4 wiring 漏接其中一个 emit 位置 → 该 phase 的 telemetry 缺失 → backend SQL 显示
  覆盖率不全。Phase 4 4-eye review 检查所有 4 个 emit 入口都已 wire。
- backend route 性能问题 → bulk INSERT 200 行已是合理上限,如果未来需要更多用 stored
  procedure 优化。

## Expiration phase
Phase 4 (EAS build #1)

## Status
active

## Signoff
- Main agent: 2026-06-17
- User review pending
