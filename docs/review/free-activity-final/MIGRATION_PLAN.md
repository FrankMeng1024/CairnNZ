# Free Activity migration plan

## Local client migration

1. Treat valid existing session UUIDs as `clientActivityId`.
2. Add owner ID, owner generation, sync/lifecycle metadata, and segment fields to new registry/journal records.
3. Import at most one valid legacy unfinished journal for the currently signed-in user only when ownership can be established. Quarantine/leave unknown-owner files hidden; never expose them cross-account.
4. Valid legacy canonical points become one `legacy-0` segment. Do not reinterpret malformed `ts/lon` debug-event rows as accepted Activity points.
5. Preserve existing per-user pending Activity/Cairn/Memory queues; upgrade records in place when their ownership and identity are explicit.
6. Pending Activity payload format v1 is upgraded to v2 once: retain the local ID as `clientActivityId`, preserve mode/user/payload, and rotate an old request-cache key so a stale response lacking identity cannot be replayed forever.
7. Create new empty journal anchors at Start. Registry-only zero-point Activities remain recoverable with Save disabled.
8. Do not delete unknown-owner legacy journals automatically. They require support tooling or an explicit future cleanup policy.
9. New emergency Save-fallback blobs use a per-user key. A legacy global blob is migrated only when its embedded owner signs in; other accounts leave it quarantined and untouched.

## Server schema (local migration only)

- `sessions.client_activity_id CHAR(36) NULL`, unique with `user_id`.
- `sessions.abandoned_at`, `sessions.abandon_reason`, and a lifecycle-derived stored `active_slot` with unique `(user_id, active_slot)`.
- `markers.client_cairn_id CHAR(36) NULL`, unique with `user_id`.
- `markers.origin_activity_client_id CHAR(36) NULL`.
- `markers.origin_session_id BIGINT UNSIGNED NULL`, FK to sessions with `ON DELETE SET NULL`.
- supporting provenance index.
- `activity_client_tombstones(user_id, client_activity_id)`.
- `marker_client_tombstones(user_id, client_cairn_id)`.

Columns remain nullable for old clients/rows. No speculative backfill is performed.

Unfinished means `finalized_at IS NULL`, not abandoned, and `end_time = start_time`. Migration preserves stale zero-evidence legacy shells and marks them abandoned. It preserves the newest of recent duplicate empty shells as the compatibility owner. It never archives a meaningful row merely to make the unique index succeed; meaningful multiplicity fails closed for explicit reconciliation.

## API compatibility

New clients send client identities. Legacy requests without them remain accepted during rollout. New responses echo client identities and server mappings. Activity/Cairn creation uses DB business uniqueness, independent of middleware response caching. A duplicate business key is accepted only when immutable facts match; conflicting reuse returns 409. Cairn-first provenance stores the weak client key and Activity creation later fills the optional numeric relationship.

Activity Start also acquires a transaction lock on the user's row. Same-mode legacy retry may reuse one identity-less shell. Cross-mode legacy Start conflicts rather than returning an Activity with the wrong type. A new client encountering a legacy shell causes a one-time authoritative UUID assignment that commits before the conflict response.

## Existing data and queues

- Existing server sessions/markers remain null in new client-ID columns; do not invent IDs or provenance from timestamps/proximity.
- Existing completed local summaries remain readable. New sync handoff adds server mappings without replacing their local ID.
- Existing unfinished files migrate only when their persisted owner matches the signed-in account.
- Existing committed Cairn outboxes remain per-user and reconstruct product visibility before a network pull.
- Existing Memory IDs remain valid; Activity reconciliation now carries them instead of minting parallel server evidence.
- The old incremental HTTP queue is compatibility transport only. Its append batches are not the sole Activity authority; full local journals/pending Save payloads survive independently.

## Rollback and production prechecks

Do not run this migration in production in this task. Before a later deploy:

1. Capture schema/table sizes and backups; verify MySQL version, online-DDL support, foreign-key integer widths and naming collisions.
2. Precheck duplicate non-null client IDs and orphan provenance candidates (expected zero because columns are new).
3. Rehearse migration 034 and rollback on a production-shaped staging snapshot; measure locks and API availability.
4. Deploy migration first, then compatible backend, while old clients remain accepted. Do not release the new client before both are healthy.
5. Run concurrent duplicate Start/Save/Cairn, Cairn-first/Activity-first, tombstone races, and response-loss tests against staging.
6. Verify old-client requests without client IDs and new-client responses that echo identities.
7. Release a reviewed internal client candidate and complete `TEST_MATRIX.md` native cases before any general rollout.

Rollback removes FK/indexes/columns only after new clients are stopped and all new-identity work is reconciled. Otherwise rollback destroys the idempotency/provenance contract and is unsafe. Tombstone tables should be dropped after dependent writers are disabled, not before.

## Production migration runner

Production currently reports ledger 032 and has the historical runner. Before 034 becomes pending, deploy and verify a tooling-only change that installs the corrected canonical runner/verifier. Then use the canonical deploy path for 034 and the feature backend.

For migration 034:

1. migration execution may continue after individual DDL errors only to make a partial state inspectable/repairable;
2. any non-zero process result or emitted MySQL `ERROR nnnn` leaves the ledger unchanged;
3. the 034 verifier checks exact columns, expressions, types, collations, indexes, FK actions, tombstone PKs, and singleton multiplicity;
4. a later invocation may write ledger 034 without DDL only if verifier-only preflight proves all postconditions;
5. the ledger update uses temporary file plus atomic rename.

Immediately before production DDL, recheck the seven known stale zero-point shells. Expected migration action is nondestructive archival with `legacy_stale_zero_shell`. Any changed/meaningful pattern blocks the migration.

After any new-client identity, provenance, or tombstone write, do not execute the 034 down migration and do not roll back to an old backend. Use a compatible backend and forward-fix.
