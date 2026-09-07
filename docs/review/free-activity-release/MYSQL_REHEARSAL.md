# Migration 034 real MySQL rehearsal

Review date: 2026-09-07
Engine: disposable `mysql:8.0`, MySQL 8.0.44
Binding: `127.0.0.1:33077` only
Production writes: none

## Result

PASS. The final 034 schema, singleton behavior, legacy reconciliation, identity/idempotency contracts, tombstones, partial-state recovery, verifier, and ledger semantics were exercised against real MySQL rather than SQLite.

## Schema and representative data

The rehearsal began from a production-shaped pre-034 subset for `users`, `sessions`, `markers`, and `memory_points`. Fixtures included:

- completed legacy Activities where `end_time != start_time` and `finalized_at` is absent;
- stale and recent zero-point legacy unfinished shells;
- an older meaningful unfinished Activity competing with a newer empty shell;
- a separate database containing two meaningful unfinished Activities to test fail-closed behavior;
- null legacy identities and Cairn upload orders;
- database defaults different from the repository identity collation.

Final schema verification proved:

- nullable `sessions.client_activity_id CHAR(36)` and unique `(user_id, client_activity_id)`;
- lifecycle-derived stored `active_slot`, unique `(user_id, active_slot)`;
- `abandoned_at` and bounded reconciliation reason;
- nullable Marker identity/provenance fields and `BIGINT UNSIGNED` FK compatibility;
- `origin_session_id ON DELETE SET NULL`;
- Activity/Cairn tombstone composite keys and exact `utf8mb4_unicode_ci` identity collation;
- expected index and FK names with no collision.

## Legacy reconciliation evidence

- Stale zero-point identity-less shells older than six hours were preserved and marked `legacy_stale_zero_shell`; none were deleted.
- Among multiple recent empty shells, the newest remains active and older empty shells are preserved as `legacy_duplicate_zero_shell`.
- A meaningful older unfinished Activity outranked a newer empty shell; the meaningful row retained the active slot.
- Completed legacy history remained inactive because `end_time != start_time`.
- Two meaningful unfinished rows caused creation of the singleton unique index to fail with duplicate key, the verifier failed, and both rows remained intact. This is intentional fail-closed behavior requiring explicit reconciliation.

## Real concurrent Activity evidence

Against the migrated DB and current HTTP backend:

- 24 different `client_activity_id` Starts for one user: exactly 1 HTTP 201 create and 23 deterministic HTTP 409 `UNFINISHED_ACTIVITY_EXISTS`; DB active count 1.
- 24 concurrent Starts with the same ID: all reconciled to one server ID; one create and 23 replays; DB row count 1.
- Lost Start response followed by retry returned the same mapping.
- Reuse of one ID with different immutable facts returned 409.
- A new-client Start against a legacy identity-less shell assigned one authoritative UUID, committed it under the user lock, and returned that same UUID on repeated conflict responses.
- Direct second active INSERT bypassing the application failed on `uk_sessions_user_active_slot`; the DB count remained one.

## Old client behavior

- Legacy same-mode Start retry returned the existing identity-less shell.
- Legacy cross-mode Start did not reuse the wrong type; it returned the singleton conflict and created no second row.
- Legacy standalone Start, append, Save, list, detail, numeric delete, Marker create/list/numeric delete all executed successfully.
- The cross-mode conflict is classified as temporarily safe: an old client may surface a generic failure but cannot corrupt type or violate the singleton.

## Cairn, provenance, tombstone, and ACK evidence

- Same-ID concurrent Cairn requests produced one row; immutable-fact mismatch returned 409.
- Cairn-first stored weak `origin_activity_client_id`; later Activity Start populated `origin_session_id`.
- Activity-first immediately populated both provenance forms.
- Numeric and client-ID Activity/Cairn deletes wrote tombstones transactionally before deletion.
- A stale create after delete returned tombstone conflict and did not resurrect data.
- Concurrent same-ID create/delete races ended with zero visible rows and one tombstone for both entity types.
- Activity deletion left the Cairn and weak provenance intact while the numeric FK became null.

## Partial migration and ledger truth

The failure injection pre-created an invalid `activity_client_tombstones.client_activity_id VARCHAR(10)` before 034.

1. First runner invocation: migration emitted statement errors and failed postconditions; exit 1; ledger absent.
2. The malformed disposable table was removed as the explicit local repair.
3. Second invocation: `--force` completed missing DDL while emitting duplicate-object errors; all postconditions then passed, but exit remained 1 and ledger remained absent.
4. Third invocation: verifier-only preflight proved the schema complete, executed no DDL, and atomically wrote ledger `034`.

This proves both MySQL DDL auto-commit recovery and the rule that a statement error never advances the ledger. The runner checks both process status and emitted `ERROR nnnn` records because MySQL `--force` can print errors while exiting zero.

## Rollback truth

- Before new-client traffic, exact down/up rehearsal retained all representative legacy rows and restored the verified schema.
- After client identities/tombstones were inserted, down/up was structurally possible but erased those identities and tombstones. Therefore the down migration is destructive after new-client writes and is not a production rollback mechanism then.
- Post-new-client failures require a compatible backend and forward fix; an old backend/down migration combination is forbidden.

## Locking assessment

The generated stored column required MySQL’s supported copy/lock path after an unsupported online-DDL hint was removed. Production’s sessions table is very small (32 inspected rows, approximately 400 KiB data), but the rollout still requires a fresh backup and lock-aware preflight. No production DDL was run.
