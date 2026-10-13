# Migration and rollback

## Files

- Up: `backend/src/migrations/045_memory_friends_cairn_contract.sql`
- Down: `backend/src/migrations/rollback/045_memory_friends_cairn_contract.down.sql`

045 adds receipt/delay metadata, explicit grant scope/consent, selector preference,
immutable Cairn revisions/acquisitions/collections, local visits, presentation
events and scoped review/audit tables. The review fix adds `decision_scope` to
cases and audit plus an atomic logical acquisition key on
`(viewer_id, marker_id, content_revision)`. It also adds
`markers.content_changed_at DATETIME(3)`, backfilled from legacy `updated_at`,
so material revisions can be ordered against millisecond visit entry.

## Safe rehearsal result

The existing harness created a random local MySQL 8.0.36 container, applied the
current schema fixture plus migrations 035-045, ran 24 Memory/Cairn HTTP/DB
assertions and 21 Public regression assertions, then
retained only that explicitly named disposable container for the down test.
After 045 down:

```text
new_tables       0
new_columns      0
friend_trigger   0
legacy_cap_trigger 1
```

The container was then removed.

## Production warning

The down migration deletes acquired history, review state, local visits and
presentation events. It must never be used in production without an approved
export/retention/recovery plan. This task did not run any production migration.
Release requires separately authorized backend deployment, migration ordering,
feature flags, monitoring and named moderation ownership.
