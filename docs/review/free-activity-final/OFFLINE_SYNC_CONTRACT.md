# Offline and sync contract

## Local authority

- Unfinished and completed-before-verified-sync Activities are locally authoritative.
- Committed Cairns are locally authoritative until verified Cairn reconciliation.
- Memory explored cells/evidence remain lightweight local product state after sync.
- All records are scoped to the owning account; logout hides and pauses them without deleting them.
- Logout immediately revokes the outgoing account's live GPS/UI ownership. Its unfinished registry and journal remain private and recoverable when that owner signs in again.
- A clean foreground point becomes “accepted” only after its journal commit resolves. Finish waits for any acceptance already in flight.

## Server authority

After an Activity/Cairn acknowledgement, identity mapping, relationship reconciliation, and crash-safe local state transition are persisted, the server becomes authoritative for historical product detail. The currently open detail screen may retain its in-memory snapshot until navigation away.

## Identities

- `clientActivityId`: immutable from Start.
- `serverActivityId`: optional mapping.
- `clientCairnId`: immutable from Cairn commit.
- `serverCairnId`: optional mapping.
- Memory event/cell identity remains client-stable and server-idempotent.

## States

The durable Activity lifecycle uses `unfinished`, `completed_local`, and a discard tombstone. Live versus paused is operational presentation plus a durable GPS ownership context; only one owner can exist. `finalizing` is an in-memory lock, not a separate durable row: failure before the local completion commit returns to unfinished/paused, while success atomically becomes completed-local. “Parked” is unnecessary because the product permits only one unfinished Activity.

Sync is independent: `pending`, `syncing`, `sync_error`, `synced`. `sync_error` never exhausts or deletes committed data. `synced` is retained only long enough to make per-entity cleanup repeatable. The user sees Activity lifecycle (“Unfinished” or completed) separately from transport copy (“Waiting to sync” / “Sync issue · Retrying”).

## Acknowledgement order

1. Server accepts or returns the existing business entity.
2. Client persists the acknowledgement.
3. Client persists client↔server mapping.
4. Client persists required provenance reconciliation.
5. Client marks the operation acknowledged/safe.
6. Client removes obsolete per-entity payloads/journals.

Every step is repeatable. A process death before step 6 causes a safe replay, not duplicate business data.

If a crash leaves an acknowledged ID in the registry, the next daemon pass cleans both possible journal locations and removes that registry row last. Recovery discovery never promotes a completed/tombstoned ID merely because an `active/` file survived.

## Retry

Committed product data has no fixed retry exhaustion deletion. Backoff is capped, not attempts. Authentication mismatch pauses work. Permanent-looking validation errors surface `sync_error` while retaining the local entity for repair/reconciliation.

## Cleanup

- Activity journal/trace/pending payload: delete after verified handoff, mapping, and dependencies.
- Completed Activity summary: may become a lightweight server reference; no permanent offline history promise.
- Cairn pending payload/full local placeholder: delete/compact after verified handoff; Memory remains.
- Memory visited cells: keep as product data/cache; compact raw evidence after server ACK when dedupe dependencies are satisfied.
- Server tombstones: keep as compact resurrection protection until account deletion or a separately proven retention horizon.
- Local tombstones: current implementation retains them conservatively; future compaction is allowed only after server acknowledgement and proof that no local stale operation remains.

## Delete/discard protection

Record tombstone first, revoke live ownership, cancel pending operations, then request server deletion if mapped. Late callbacks and acknowledgements cannot clear a tombstone or recreate the object.
