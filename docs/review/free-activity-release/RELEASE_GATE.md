# Free Activity release blocker closure gate

Review date: 2026-09-07
Reviewed base: `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c` plus preserved local implementation changes
Production access: read-only

## Verdict

### READY FOR NATIVE QA

The ten code/data/infrastructure blocker groups from the independent review are closed in local code and validated with focused client tests, backend tests, a real MySQL 8.0.44 rehearsal, production read-only compatibility inspection, and Expo Web export. This verdict does not authorize or imply deployment, migration, OTA, or production release.

Physical-device validation remains mandatory. Until the signed 17-step iOS/Android matrix passes, the gate cannot advance to `READY FOR PRODUCTION CHANGE REVIEW`.

## Blocker disposition

| Blocker | Result | Principal proof |
|---|---|---|
| Authoritative unfinished singleton | CLOSED | Per-user transactional lock plus generated `active_slot` unique index; 24 distinct concurrent Starts produced 1 create and 23 deterministic conflicts |
| Immutable async account ownership | CLOSED | Entity-captured owner at every async boundary; A→B delayed-callback/ACK/outbox tests |
| GPS owner fencing | CLOSED IN CODE | Durable generation/lifecycle/time fence; post-Finish, failed-Resume, logout, and old-batch regressions; native delivery remains QA |
| Cairn tombstone concurrency/ownership | CLOSED | Serialized local tombstones; transactional server delete tombstones; account-switch fallback test |
| Completed-local transition | CLOSED | Recoverable completion intent and verified pending snapshot; phase-injection tests converge to unfinished or completed-local |
| Headless Activity → Memory | CLOSED | Canonical journal acceptance plus durable Memory evidence/reconciliation; death→Discard regression |
| Pending Activity persistence | CLOSED | Versioned/checksummed temporary write, validation, atomic replace, backup/fallback, explicit corruption |
| Memory hydration | CLOSED | Empty/unavailable/corrupt/oversize states separated; no writer attachment on unsafe hydration |
| Detail snapshot/history retention | CLOSED | Screen-owned immutable snapshot through cleanup; pending/local-authoritative rows excluded from the 100-row cap |
| Migration/deployment ledger | CLOSED LOCALLY | MySQL statement errors never advance ledger; postconditions verified; verifier-only next invocation records complete partial state |

## Evidence summary

| Gate | Result |
|---|---|
| Focused Free Activity client matrix | PASS — 18 suites, 125 tests |
| Backend contract matrix | PASS — 18 tests after final runner assertion |
| Real MySQL migration apply/verify | PASS — MySQL 8.0.44 |
| Distinct-ID concurrent Start | PASS — one row, deterministic conflicts |
| Same-ID concurrent/lost ACK Start | PASS — one row and one stable mapping |
| Legacy request lifecycle | PASS with documented cross-mode limitation |
| Partial migration / ledger truth | PASS — ledger absent after both failing invocations; `034` written only by clean verifier-only invocation |
| Production read-only compatibility | PASS for planned change; seven stale shells have a nondestructive deterministic outcome |
| Changed Free Activity TypeScript scope | PASS; whole-repository baseline remains red |
| Expo Web production export | PASS — 3,389 modules |
| `git diff --check`, shell and backend syntax | PASS |
| Native device matrix | NOT RUN — sole release gate |

## Repository-wide baseline

The full Jest sweep is not green: 64 suites, 49 passed and 15 failed; 514 tests, 470 passed, 41 failed, 3 skipped. Failures are established stale exports/configuration, Playwright specs collected by Jest, Route/geo/telemetry/i18n, and two independently reproduced adjacent baseline failures. The two adjacent failures are not introduced by this closure: `runPreviewFinally.test.ts` is untouched; `apiService-401-iron-rule.test.ts` expects a `sessionExpired` write that was already absent before this review (the closure change only awaits logout). No focused Free Activity suite failed.

Full TypeScript remains at exit 2 with 278 diagnostic lines. Filtered new/changed Free Activity implementation is clean; matches in changed `App.tsx` are unchanged navigator typing lines. This repository debt is recorded, not relabeled as a Free Activity regression.

## Remaining gate

Run and sign the complete physical-device matrix in `INDEPENDENT_REVIEW.md`. Required evidence includes iOS locked screen, OS kill versus force quit, low-power/background restrictions, permission downgrade, inaccurate/tunnel GPS and reordered native batches, Detail open during cleanup, process-death completion boundaries, and A→B→A account isolation.

No production mutation, migration, deploy, restart, DB write, file modification, push, OTA, or `git clean` occurred.
