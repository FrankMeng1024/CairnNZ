# Free Activity architecture decisions

## AD-01 — Immutable client identities

**Current structure:** Activities use a local `sessionId` and an optional numeric remote ID; Cairns use a queue operation ID that is replaced for display after upload.

**Problem:** Server acknowledgement loss and arbitrary upload order cannot be reconciled by mutable or server-only identity.

**Decision:** Name and preserve the business identities `clientActivityId` and `clientCairnId`. Server IDs are optional mappings and never replace them. Backend uniqueness is scoped by user.

**Why:** Retries become idempotent even if the generic request-id cache misses or two requests race.

**Alternatives considered:** request idempotency keys alone (race-prone and not a permanent relationship key); server IDs only (unavailable offline).

**Migration / future impact:** additive nullable server columns support legacy clients. Future Route-started Activities use the same identity.

**Rollback / risk:** old rows have null client IDs and continue to load. Do not backfill invented client identities.

## AD-02 — Bounded user-scoped Activity registry

**Current structure:** per-session journal files are discovered by scanning; UI recovery is mode-specific and time-limited.

**Problem:** product allows exactly one unfinished Activity globally, but completed-local pending sync also needs independent durable handoff metadata.

**Decision:** maintain a small, user-scoped registry with zero-or-one unfinished record, completed-local records awaiting verified sync, server mappings, owner generation, and tombstones. Heavy points remain isolated by Activity.

**Why:** one global start gate and exact-ID recovery need one durable authority. This is intentionally not arbitrary-N unfinished UX.

**Alternative:** migrate all product data to SQLite. Rejected for this bounded pass because existing file/AsyncStorage infrastructure can be corrected without a native storage migration.

## AD-03 — Canonical segmented point contract

**Current structure:** flat points plus isolated heuristics and incompatible background JSON.

**Decision:** every durable accepted point carries `clientActivityId`, `ownerGeneration`, `segmentId`, canonical `t/lat/lng/accuracy/alt/speed/source`, and a segment-start reason where applicable. Recovery creates a new segment before live ingestion. Shared functions calculate distance, elevation, active duration, real line segments, and dashed gap connectors. The continuity classifier considers time, displacement, accuracy, implied mode speed and known recording loss. Time alone does not open a gap. Full positive intervals count inside a real segment; intervals across segment IDs count zero.

**Why:** missing time/location is represented as missing, never geometry.

**Migration:** valid legacy foreground lines become segment `legacy-0`; malformed background-shaped lines are reported/skipped rather than guessed.

## AD-04 — One live owner generation

**Decision:** the durable unfinished record owns a random generation. Foreground/background callbacks must present both client Activity ID and generation; mismatches are rejected. Starting is denied while any unfinished record exists.

**Why:** a late callback or `/start` response from A cannot mutate B.

## AD-05 — Local-first completion and ACK order

**Decision:** freeze recording, apply one save-eligibility rule, persist a completed-local product snapshot and immutable sync payload, then attempt sync. On success persist acknowledgement/mapping and relationship reconciliation before deleting the pending payload/journal. Cleanup is per Activity and repeatable.

**Why:** completed-local is product state; network sync is transport state.

## AD-06 — Tombstones

**Decision:** discard/delete records a durable client-identity tombstone before cancelling pending work or requesting remote deletion. Stale start/append/finalize/create acknowledgements consult it.

**Why:** absence alone cannot distinguish “never existed” from “intentionally removed.” Tombstones are compacted only after dependent work is harmless.

## AD-07 — One Memory evidence authority

**Decision:** accepted Activity fixes, passive exploration fixes, and final committed Cairn coordinates all use one spatially deduplicating, user-scoped durable Memory entry point. Activity source is always enabled; the setting controls only non-Activity capture.

**Why:** Memory is monotonic explored-place evidence, not Activity/Cairn-owned content.

## AD-08 — Cairn provenance is an immutable weak relationship

**Decision:** `originActivityClientId` is committed atomically with the local Cairn. The server stores the client provenance even when the Activity is absent and reconciles an optional FK when either side arrives. Activity deletion sets the navigable FK null but does not delete the Cairn or Memory.

## AD-09 — Screen boundary

**Decision:** retain Hike and Run screens/maps, while sharing lifecycle, save eligibility, completion destination, recovery, segmentation, and sync state. Run stays follow-first; Hike stays exploration-friendly.

## AD-10 — Durable acceptance boundary

**Current structure:** native foreground callbacks updated visible metrics before their asynchronous file replacement completed.

**Decision:** serialize foreground ingestion. A clean point is validated, assigned to a segment, durably journaled, then published to Activity state and Memory. Finish rejects newer callbacks and waits for any callback already inside this boundary. Headless background ingestion already journals its batch before queueing it for live state.

**Why:** “received” is not yet “accepted.” The accepted contract starts only when durable local evidence exists.

**Risk:** filesystem latency is now part of accepted-point latency. GPS callbacks are serialized rather than dropped; physical-device soak testing must measure this under long tracks and low storage.

## AD-11 — Interrupted ACK cleanup

**Problem:** ACK and identity mapping can commit before journal rename/deletion. A crash in between leaves a stale `active/` file.

**Decision:** registry lifecycle outranks filename. Discovery excludes IDs already completed or tombstoned. Every sync-daemon pass, including an empty pending queue, retries cleanup for acknowledged IDs across both active and completed paths. It removes the lightweight acknowledged registry row last.

**Why:** cleanup is a replayable transaction boundary rather than a one-shot callback.

## AD-12 — No SQLite expansion

**Decision:** retain the corrected per-Activity snapshot journal plus user-scoped AsyncStorage registry/outboxes. Do not migrate unrelated local data or add SQLite in this pass.

**Why:** the locked zero-or-one unfinished rule needs a bounded registry, not an arbitrary queryable Activity database. The existing runtime can meet the boundary once writes, identity and cleanup are serialized.

## AD-13 — Late Start acknowledgements follow lifecycle identity

**Problem:** network completion order can outlive the live store. “This Activity is no longer live” does not mean “the Activity was discarded”; it may already be completed-local and pending its full Save.

**Decision:** map a late `/start` server ID into the durable registry and pending payload without changing completion/sync state. Delete the remote shell only when a durable client tombstone explicitly authorizes it. Missing transient state is not deletion authority.

**Why:** Activity Start, Finish, a subsequent Activity, and network callbacks may resolve in any order. Immutable identity—not the current screen—decides ownership and deletion.

The same rule applies to incremental point acknowledgements: a callback may advance the shared live-upload cursor only while both its captured `clientActivityId` and owner generation still match the current recorder. Finalization callbacks never mutate a later live cursor.

## AD-14 — Logout suspends; it does not discard

**Problem:** user scoping of files is insufficient if the outgoing account's live recorder remains in the shared in-memory store, while deleting its queues would violate the locked data-retention rule.

**Decision:** logout synchronously revokes UI/native live ownership and resets shared tracking state, then finishes any in-flight journal write. It preserves the owner-scoped unfinished registry, journal, pending queues, and emergency Save payload. A matching later login recovers the exact Activity with a discontinuity; another account sees none of it.

**Why:** logout is an identity boundary, not Activity deletion or account deletion.

## AD-15 — Authoritative per-user unfinished slot

**Decision:** the server serializes Activity Start by locking the durable `users` row in a transaction. The `sessions.active_slot` stored generated column is `1` only for a legitimate unfinished lifecycle (`finalized_at IS NULL`, `abandoned_at IS NULL`, `end_time = start_time`), and unique `(user_id, active_slot)` is the final DB invariant. Same client ID is idempotent; a different ID receives deterministic existing-Activity metadata.

**Legacy rule:** archive only provably empty stale/duplicate identity-less shells, preserving every row. Metrics rank empty duplicates but never decide whether a meaningful Activity is unfinished. Multiple meaningful rows fail migration closed.

**Why:** frontend guards and per-business-ID uniqueness cannot prevent two processes/devices from creating different unfinished IDs.

## AD-16 — Recoverable completed-local intent

**Decision:** completion is a small roll-forward protocol. A durable phase intent binds owner, Activity identity, trace generation, metrics, summary, and pending payload. Relaunch replays incomplete phases. Save succeeds only after the complete local product state is verified and visible as completed-local.

**Why:** independent filesystem/AsyncStorage writes cannot be physically atomic. An idempotent intent makes every crash point converge to either the prior unfinished state or one completed-local state.

## AD-17 — Verified pending generations and cleanup-only state

**Decision:** pending Activity snapshots use a versioned/checksummed envelope, canonical schema validation, strict temporary write and atomic replacement, plus prior-good fallback. Server ACK/safe state remains durable until every owner-verified heavy artifact is absent; cleanup failure is retried as cleanup, never as server sync.

**Why:** a malformed/torn pending file must be detectable, and extra local data after ACK is safer than either local data loss or a duplicate server create.

## AD-18 — Memory hydration is fail-preserving

**Decision:** unavailable, corrupt, oversized, unsupported, partial, or prior-failed Memory is not valid empty Memory. A replacing persistence subscriber is attached only after valid hydration. Activity/headless evidence is strict-durable and can be reconciled idempotently from the canonical journal if physical stores cannot share one transaction.

**Why:** load failure cannot authorize overwriting monotonic personal exploration with an empty/new subset.

## AD-19 — Immutable asynchronous owner

**Decision:** operation/entity ownership is captured before the first await and passed through local storage, network acknowledgement, reconciliation, tombstone, Memory, and cleanup calls. Reading the current login after an await is only a reject/fence check. Logout durably disables the live lease before account release.

**Why:** shared stores are process-global; account switching must not change who owns work already in flight.

## AD-20 — Verifier-gated migration ledger

**Decision:** MySQL migration output and exit status are authoritative failure signals. Any emitted SQL error or non-zero status leaves the ledger unchanged. Migration-specific SELECT-only verification checks every required postcondition. A later clean invocation may recognize an already-complete partial migration and atomically advance the ledger without executing DDL.

**Why:** MySQL DDL auto-commits, and `mysql --force` may emit errors while returning zero. A text ledger is truthful only when it is downstream of exact verification and never advances in the same invocation as a statement error.
