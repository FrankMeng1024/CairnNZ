# Phase 3 — DONE Report

**Phase**: 3 — Telemetry 实时管线
**起始 git tag**: v0.2.5-phase-3-start (commit 1d640bd)
**完成时间(代码层)**: 2026-06-17

## Sub-items completed
- [x] 3.1 backend migration 016 debug_events_v2 — applied + verify PASS (live mysql)
- [x] 3.2 backend route /api/v025/debug-events bulk INSERT — live curl returned `{"inserted":1}` (round-1 + rate limit + PII strip)
- [x] 3.3 TelemetryBatcherV2.cs (5s/100 events/1000 cap) + 8 EditMode unit tests
- [x] 3.4 RN telemetryBatcher.ts + 7 jest tests (mirror of C#, parity-verified by review)
- [-] 3.5 接入所有 v22-* 事件埋点 → ADR-012 deferred to Phase 4 wiring
- [-] 3.6 Auto-mode heartbeat (Rule S) → ADR-012 deferred to Phase 4 (tooling, not v025 runtime)
- [-] 3.7 BlockerSentinel + Telemetry 集成测试 → ADR-012 deferred to Phase 4 PlayMode
- [-] 3.8 backend smoke test → ADR-012 deferred to Phase 4 EAS real-device
- [x] 3.9 PROGRESS.md (this section + main file)
- [x] 3.10 4 眼 review sub#3-1 (PASS) + sub#3-2 (NEEDS_REVISION 2H+2M+2Lo, all fixed/documented)
- [x] 3.11 修光 → verdict PASS in same round
- [x] 3.12 commit + tag v0.2.5-phase-4-start

## Lint / verify_progress / lock_plan status
- cairn_lint --scope v025: PASS (64 files clean — same as Phase 2B; +1 Telemetry/, +1 Tests file)
- npx jest: 53/53 PASS (5 → 6 suites; +telemetryBatcher.test.ts with 7 tests)
- lock_plan --mode check: PASS (15 locks)
- Live backend curl: `POST /api/v025/debug-events` returned `{"inserted":1}` after migration

## Files added (Phase 3)
- backend/src/migrations/016_v025_debug_events_v2.sql (CREATE TABLE + 5 indexes)
- backend/src/routes/v025/debug-events.js (rate-limited + PII stripped)
- backend/src/middleware/optionalAuthenticate.js
- v025/Telemetry/TelemetryBatcherV2.cs + Tests/Unit/TelemetryBatcherV2Tests.cs (8 tests)
- app/src/services/v025/telemetryBatcher.ts + __tests__/telemetryBatcher.test.ts (7 tests)
- _review/v0.2.5/adr/ADR-012-phase3-wiring-deferred-to-phase4.md
- _review/v0.2.5/adr/ADR-013-phase3-telemetry-policy.md

## ADRs added (Phase 3)
- ADR-012 wiring (3.5-3.8) deferred to Phase 4
- ADR-013 telemetry policy (persistent queue + user_id + retention + PII)

## Next phase entry point
- Phase 4 sub-item 4.1a — Plugins/iOS/CairnFileExclude.mm ObjC bridge

git tag for resume: `v0.2.5-phase-4-start`

## Phase 4 must include (per ADR-012 + ADR-013):
- Composition root: wire Tracker + batcher.AddEvent into all 4 emit sites
- ARScreenV2 onUnityMessage → cairnBridgeV2 + telemetryBatcher.addEvent
- setInterval(() => batcher.maybeFlush(true), 5000) in App boot
- AsyncStorage / persistentDataPath persistent queue restore
- 30-day retention cron job
- Designer prefab + materials + real SDF textures (per ADR-005 revised, ADR-011)
- Stone profile measured from HTML demo (per ADR-011)
- ARWorldMap real impl (Phase 4.2-4.7 plan)
- ObjC CairnFileExclude bridge
