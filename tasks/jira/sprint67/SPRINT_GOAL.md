# Sprint 67 Goal — Friend System F1 (Schema + Backend + Spike + Data)

**Plan**: `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md` (v4.2 final)
**Sprint Phase**: Friend System v1 / 5 (F1 of F1-F5)
**Acceptance Mode**: auto (per PROJECT_STATE.md)

## Sprint Goal (one sentence)

Establish the schema, backend endpoints, data foundation, and Mapbox iOS fog UNION feasibility for the Friend System v1 trusted-circle model.

## Story List

| ID | Title | Type | Pts | Owner |
|----|-------|------|-----|-------|
| SPIKE-67-1 | Mapbox iOS fog UNION rendering feasibility | Spike | 3 | Arch |
| STORY-00524 | Verify auth.js login skips password length check | Story | 1 | Backend |
| STORY-00525 | Apply migration 018 + permission constant centralization | Story | 3 | DBA + Backend |
| STORY-00526 | 9163 cleanup with mysqldump backup + DRY-RUN + Kalman rebuild | Story | 3 | DBA |
| STORY-00527 | Seed 9 mock @cairn.demo accounts with single-char passwords | Story | 2 | Backend |
| STORY-00528 | Implement 8 new backend endpoints with permission filters | Story | 5 | Backend |
| STORY-00529 | hidden_items cron cleanup + TECH_SPEC §cron | Story | 2 | DevOps + Backend |

Total: 7 items (1 Spike + 6 Stories), 19 points.

## Critical Gates (CLAUDE.md compliance)

- **Spike-1 must conclude before F4 (Memory tab fog UNION) can start.**
- **9163 cleanup (STORY-00526) requires user DRY-RUN ACK before destructive operation.**
- **All backend endpoints (STORY-00528) must reject `permission='public'` on POST/PATCH.**
- **Trigger uses `SELECT ... FOR UPDATE` for race safety (v4 H2).**

## Dependencies

- All stories independent except STORY-00528 depends on STORY-00525 (schema must exist).
- STORY-00527 depends on STORY-00525 (users table needs `account_type` etc).

## Definition of Done (sprint level)

- All 7 items Done + verified
- Migration 018 applied to aliyun MySQL prod (with backup)
- 9 mock accounts can login
- 9163 has 1 Back Loop session
- 8 new endpoints pass contract tests (incl. 4 "public rejection" cases)
- Spike-1 verdict written
- node-cron registered + monitoring
- All code follows: clean / no dead code / Cairn style consistency
- Arch + UX + QA subagent reviews all PASS

## Sprint Capacity Compliance

7 items meets CLAUDE.md §Sprint capacity target (min 4, max 8). Spike counts as 1 item per §Spike Sprint guidance.
