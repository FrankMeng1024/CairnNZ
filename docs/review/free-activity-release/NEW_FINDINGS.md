# New findings from independent release review

Review date: 2026-09-07

This file supplements the append-only authoritative ledger. IDs continue from FA-045.

## Open release findings

### FA-046 — no authoritative one-unfinished Activity invariant

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

`Session.createEmpty` enforces uniqueness only for `(user_id, client_activity_id)`. It does not lock or reject another unfinished row for the same user. Two real concurrent HTTP requests with distinct business IDs both returned 201 and created distinct unfinished rows. Production read-only inspection found seven unfinished zero-point rows across two users, with per-user counts of two and five. `findLatestUnfinished` returns only one and therefore hides multiplicity.

Required resolution: define an authoritative singleton transaction/constraint, a deterministic collision response, and a nondestructive migration/reconciliation policy for legacy multiples.

### FA-047 — completed-local Activity transition is not atomic

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

Finish sequentially commits the pending payload, Activity summary, and lifecycle registry through independent stores. A crash after any one await can expose contradictory authorities: replayable payload plus unfinished registry, summary without completed registry, or an unfinished recovery object after the UI reported Save. The surrounding `try` does not make the three writes atomic.

Required resolution: one durable transaction/manifest or an explicitly recoverable journal protocol whose recovery deterministically finishes/rolls forward every boundary.

### FA-048 — headless background accepted points can lose Memory on Discard

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

The headless TaskManager path durably appends accepted canonical Activity points, then only places them into the module-level `pendingBackgroundLocations` array. It does not call the durable Memory evidence boundary. After process death that queue is gone. If recovery immediately Discards, the Activity journal is deleted before a foreground completeness pass can preserve the points in Memory.

Required resolution: commit Activity and Memory evidence at the same accepted-point durability boundary, or provide an independently durable idempotent Memory outbox written before Activity discard is allowed to remove the source.

### FA-049 — account-switch ownership is resolved too late in async stores/outboxes

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

The generic offline entity resolves its per-user storage key separately for reads and writes. A drain can read A's queue, await the network, then write the result under B after login changes the resolver. Success callbacks can likewise touch the current B store/Memory. Session-store `addSession`, `markSynced`, and `markSyncState` obtain the current owner inside a shared async write tail instead of accepting the captured entity owner. Exact checks added to Activity sync narrow but cannot close a store method that changes owners inside its own await chain.

Required resolution: bind an immutable owner to each operation at enqueue, pass it through every storage/callback method, and reject writes/callbacks when the live account no longer matches. Add deterministic deferred-promise tests around logout/login.

### FA-050 — pending Activity payload storage is not a crash-safe authority

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

`savePending` overwrites the final JSON path directly and returns success if no filesystem implementation exists. `listPending` silently skips malformed/partial files. `removePending` swallows all deletion failures, not only not-found. Attempt and mapping updates are also in-place and suppress errors. A torn write can make committed Activity data disappear from replay; a suppressed cleanup failure can retain a replayable payload after higher layers believe it is gone.

Required resolution: temp write, flush/close where supported, atomic replace, reread/validate, quarantined corruption handling, and typed deletion results that distinguish absent from failed. Do not report local Save success without a durable backend.

### FA-051 — oversized/prior-failed Memory hydration can overwrite committed Memory

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

When the stored Memory payload exceeds 500 KB, hydration skips parse/restore but later subscribes the empty in-memory store. The persisted prior-hydrate-failure gate does the same immediately. A subsequent accepted point schedules a flush of the empty/new subset and can replace the previously committed payload. This violates the contract that personal Memory may only be reduced by explicit reset/account deletion.

Required resolution: never attach a replacing writer until prior state has been safely imported, compacted, or moved to a transactional representation. Preserve unreadable/oversized payloads and surface recovery state.

### FA-052 — durable background GPS context outlives safe Finish/resume ownership

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

Finish freezes foreground ingestion but leaves `cairn_bg_hike_active` enabled through payload construction and local/network Save, clearing it only near final journal rename. A headless batch can append after the saved snapshot. Resume persists an active context before proving the native watcher starts; failure can leave the durable context active while the UI remains paused. Logout calls async suspension without awaiting the durable context clear, producing another A→B headless window.

Required resolution: revoke durable acceptance synchronously/first at Finish and account switch, drain/fence already delivered batches into the frozen snapshot, and roll back context on Resume failure. Prove each boundary with controlled delayed AsyncStorage/native callbacks.

### FA-053 — open Activity Detail can lose its trace during cleanup

**Severity:** High
**Status:** OPEN

The Detail loading effect depends on the mutable `sessions` array. Sync-state/mapping changes rerun it. After cleanup removes local heavy points, a concurrent server timeout/failure falls through to empty local storage and replaces the already-visible `loadedTrackPoints` with `[]`. Copying data to state once is therefore not a sufficient snapshot guarantee.

### FA-054 — 100-item session cap can prune pending Activities

**Severity:** High
**Status:** OPEN

`addSession` blindly applies `.slice(0, MAX_SESSIONS)`. An old unsynced completed Activity can be removed from the local Activity index while its payload remains pending, contradicting the waiting-to-sync visibility contract until a later rebuild/relaunch happens to restore it.

### FA-055 — concurrent local Cairn tombstones can be lost

**Severity:** Critical
**Status:** OPEN

`markerTombstones.ts` performs an unguarded AsyncStorage read-modify-write. Concurrent tombstone commits can read the same old array and the last writer can erase the other deletion. The existing queue lock does not serialize this separate store.

### FA-056 — emergency Activity payload can embed the wrong owner

**Severity:** Critical
**Status:** OPEN

The SAF-01 key is owner-scoped, but at least one asynchronous failure construction path rereads the current user for the serialized `userId` field instead of using the captured Activity owner. An account switch can therefore produce a key/payload ownership mismatch and block safe recovery.

### FA-057 — canonical deploy ledger can certify partial DDL

**Severity:** Critical
**Status:** OPEN — PRODUCTION CHANGE BLOCKER

`docker/deploy.sh` feeds a multi-statement migration to MySQL, then treats broad duplicate/already-exists errors as if the complete file were applied and advances `.migrations_applied`. MySQL DDL autocommits, so a failure after early statements can leave a partial schema that the ledger declares complete.

### FA-058 — new client with old backend is unsafe

**Severity:** Critical
**Status:** OPEN — ROLLOUT CONSTRAINT

The new client requires server echo and business-key reconciliation that the current old backend lacks. A Start may fail validation or create a shell whose response the new client cannot accept, and retry can strand/duplicate identity. Backend-before-client ordering and a no-old-backend-rollback rule are mandatory.

## Findings fixed during this review

### FA-059 — current session writes rejected `client_op_id`

**Severity:** Critical
**Status:** FIXED LOCALLY

Real HTTP testing found that current append/finalize payloads were rejected by the strict Joi schemas because the client includes `client_op_id`. The server middleware consumes this field for idempotency, but the route schemas did not allow it. Optional `client_op_id` was added to append, Save, and update schemas. A backend contract regression test was added; real migrated-MySQL HTTP append/finalize then returned 200.

### FA-060 — recovery Save used the wrong navigation destination/back stack

**Severity:** High
**Status:** FIXED LOCALLY

Normal Hike/Run Save reset to Home → Trails/Activities → Activity Detail, but recovery Save navigated directly and did not guarantee the contract Back destination. Both recovery surfaces now use the same reset stack and immutable local Activity ID as normal Save. Static integration tests cover the path.

### FA-061 — point/context canonical validation gaps

**Severity:** Critical
**Status:** FIXED LOCALLY; broader FA-052 remains open

The writer accepted geographically invalid canonical values and could bridge over a corrupted middle/tail record; background append did not independently verify expected owner. The TaskManager context activation/deactivation order could expose a partially written owner context. The review added coordinate/time validation, valid-prefix recovery, cross-Activity rejection, expected-user checks, context validation, and active-last/disable-first ordering. Behavioral writer tests cover corrupted/out-of-range/cross-ID data and owner mismatch.

### FA-062 — Memory persistence/account setting boundary defects

**Severity:** Critical
**Status:** FIXED LOCALLY; broader FA-048/049/051 remain open

Memory evidence could capture the live user after an await; persistence flush did not request strict durable storage; logout could snapshot an empty reset over A; and old persisted always-on behavior conflicted with the new default-OFF contract. The review captured/rechecked the owner, enabled strict writes, detached before reset, filtered orphan hydration by exact owner, and added a one-time settings contract-version migration to OFF. Behavioral tests cover delayed A→B evidence rejection, strict failure propagation, and settings migration.

### FA-063 — sync owner and offline shell start-time drift

**Severity:** Critical
**Status:** FIXED LOCALLY; broader FA-049 remains open

Activity sync accepted an empty/mismatched live user in several paths and recreated an offline shell using completion-file creation time instead of the Activity start. Exact owner checks were added before and after network/tombstone boundaries, and `startedAt` is now preferred with a legacy fallback.

### FA-064 — stale logout test fixtures concealed current behavior

**Severity:** Medium
**Status:** FIXED LOCALLY

The `useAppStore` test used obsolete module fixtures and auth assertions. Virtual mocks and current logout ordering assertions were added, allowing the focused suite to execute the current suspension/persistence calls. This improves coverage but does not prove the remaining asynchronous ownership races.

## Deletion review

The independent review made no additional production-code deletion. It rechecked the implementation's removal of the duplicate active Run Complete path and the destructive, unreferenced Cairn logout queue helper. Neither was required by future Route-based Activity, navigation, voice, recovery, offline, debug/QA, or Settings flows. No broader dead-code cleanup was attempted.

## Findings added during blocker closure

### FA-065 — fenced too-short Finish did not consistently Resume

**Severity:** High
**Status:** FIXED LOCALLY — focused verification pending

Run used a duplicated point/distance expression while Hike and recovery used the shared Save authority. After Finish began durably fencing GPS, both too-short “continue” paths could dismiss without reacquiring a live lease. Run now uses `saveEligibility`, and both screens explicitly call `resumeTracking()` when continuing a paused Activity.

### FA-066 — authoritative Start conflict had unsafe materialization ordering

**Severity:** Critical
**Status:** FIXED LOCALLY — focused verification pending

During singleton integration, a client that received the existing authoritative Activity could fail while materializing its journal/detail before replacing its speculative registry row. That would leave the rejected new identity masking the server owner. Registry replacement now commits first; detail/journal hydration is best-effort after that authority transfer.

### FA-067 — singleton DDL initially misclassified legacy completion

**Severity:** Critical
**Status:** FIXED LOCALLY — real MySQL verification pending

The first singleton generated-column draft used only `finalized_at IS NULL`, but pre-`finalized_at` completed Activities can have `end_time != start_time`. A later draft incorrectly required zero metrics, which could let a partially updated meaningful Activity escape the slot. The slot and backend queries now use lifecycle only: not finalized, not abandoned, and the placeholder `end_time = start_time`. Reconciliation uses metrics/point evidence only to archive provably empty duplicates; multiple meaningful rows remain a fail-closed migration diagnostic rather than being hidden or deleted.

### FA-068 — MySQL rejected the generated-column online-DDL hint

**Severity:** Critical
**Status:** FIXED LOCALLY — re-rehearsal pending

The first real partial-state rehearsal on MySQL 8.0.44 returned error 1845 for the stored generated column with `ALGORITHM=INPLACE, LOCK=NONE`; the dependent unique index then failed because the column did not exist. The migration-specific verifier correctly failed and would prevent ledger advancement. The unsupported hint was removed for that one operation so MySQL can use its supported copy algorithm. The prior production read-only check found a small sessions table, but the production plan still treats this as a lock-bearing DDL requiring backup and preflight.

### FA-069 — tombstone business identities inherited the wrong collation

**Severity:** High
**Status:** FIXED LOCALLY — re-rehearsal pending

The MySQL 8 rehearsal showed `activity_client_tombstones.client_activity_id` and `marker_client_tombstones.client_cairn_id` using the database-default `utf8mb4_0900_ai_ci`, while the canonical Activity/Cairn identity columns use the repository convention `utf8mb4_unicode_ci`. Current parameterized equality lookups did not fail, but cross-table identity reconciliation would have an unsafe implicit-collation boundary. Migration 034 now creates both tables with the exact collation and contains an explicit conversion so a verifier-gated rerun repairs an already-created partial table. The verifier now checks exact identity type, nullability, charset, collation, and composite primary-key order.

### FA-070 — legacy numeric delete could resurrect new-identity entities

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

The new client-ID deletion endpoints write tombstones before deleting, but the existing numeric Activity and Cairn endpoints directly deleted rows. If an old client deleted an entity created by a new client, a delayed/lost-ACK create retry carrying the still-valid client identity could recreate it. The numeric paths must lock the owned row, write the appropriate tombstone whenever its business ID is non-null, and delete in the same transaction. Pure legacy rows with null identity keep their prior behavior.

### FA-071 — legacy shell identity adoption was rolled back with the conflict

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

A new-client Start against an identity-less legacy unfinished shell generated a UUID, updated the row, and returned it inside the deterministic 409 conflict. However, the conflict was thrown inside the transaction and the common catch rolled the update back. A retry could therefore report a different alleged stable identity, preventing durable client/server reconciliation. The one-time UUID assignment must commit under the existing per-user lock before the conflict is returned; repeated attempts must report the same identity and the database row must retain it.

### FA-072 — heavy Activity cleanup errors were still suppressed

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

Pending-file deletion now reports failure, but `discardActiveHike` and `deleteCompletedHikeTrack` caught and ignored their filesystem deletion failures. The ACK cleanup helper could therefore proceed to remove the completed registry record—the relaunch cleanup trigger—even though active/completed journal artifacts remained. Heavy cleanup must first verify the journal owner, confirm every deletion, and leave the synced registry ACK intact on any error so the next launch performs cleanup-only.

### FA-073 — legacy cross-mode Start could reuse the wrong Activity type

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

For an identity-less legacy unfinished Hike, another identity-less old-client Run Start entered the legacy replay branch and returned the Hike row as if it were the same operation. Later Run data could therefore finalize a server Activity typed Hiking. Same-mode legacy replay is required for lost acknowledgements, but cross-mode replay is not identity-safe. The backend must return the singleton conflict for the cross-mode case and the compatibility matrix must state that an old client must resolve or wait rather than receiving a second or mistyped shell.

### FA-074 — verified pending snapshots did not validate segment metadata

**Severity:** High
**Status:** OPEN — RELEASE BLOCKER

The v3 pending envelope checked coordinate/time shape and checksum but accepted arbitrary `segment_id` and `segment_start_reason` strings. Completion recovery then projected those values into typed Activity Detail data, while the new backend correctly accepts only the canonical bounded ID and closed reason enum. A corrupt or incompatible committed snapshot could therefore be shown locally but rejected on every sync retry. The pending boundary must validate the same canonical segment metadata and recovery must not cast unknown values into `TrackPoint`.

### FA-075 — a non-zero migration execution could still advance the ledger

**Severity:** Critical
**Status:** OPEN — RELEASE BLOCKER

The first migration-runner correction used migration-specific postcondition verification but still allowed `mysql --force` to return non-zero and then advanced the text ledger when the final schema happened to verify. That makes the same invocation both observe a statement failure and claim the migration applied, violating the locked fail-closed rule and obscuring the exact recovery boundary. The runner must leave the ledger unchanged on every non-zero MySQL status. A subsequent invocation may recognize a fully complete schema through a verifier-only preflight and atomically advance the ledger without executing any failing statement.

## Final closure disposition

The statuses above preserve discovery history. The following later evidence is the authoritative closure result.

| Finding | Final status | Verification |
|---|---|---|
| FA-046 | FIXED / VERIFIED | User lock plus unique active slot; 24 distinct-ID Start race leaves one row. |
| FA-047 | FIXED / VERIFIED | Recoverable completion intent; phase 1/2/3 death tests converge to one legal state. |
| FA-048 | FIXED / VERIFIED | Durable headless Activity→Memory reconciliation; death then Discard retains evidence. |
| FA-049 | FIXED / VERIFIED | Immutable owner through outboxes/stores/ACK/cleanup; A→B→A deferred races pass. |
| FA-050 | FIXED / VERIFIED | Versioned/checksummed atomic pending persistence, previous-good fallback, explicit cleanup failure. |
| FA-051 | FIXED / VERIFIED | Oversize/corrupt/read/persist failure blocks writer and preserves durable good Memory. |
| FA-052 | FIXED IN CODE / VERIFIED | Finish, failed Resume, logout, and old native batches fenced; physical-device delivery remains FA-026. |
| FA-053 | FIXED / VERIFIED | Mounted Detail snapshot survives sync cleanup plus server-load failure. |
| FA-054 | FIXED / VERIFIED | Pending summary remains visible beyond 100 disposable history rows. |
| FA-055 | FIXED / VERIFIED | Serialized concurrent Cairn tombstone test retains every ID. |
| FA-056 | FIXED / VERIFIED | Emergency payload key and body use captured Activity owner across account switch. |
| FA-057 | FIXED LOCALLY / VERIFIED | Corrected runner/verifier passed partial-MySQL and ledger-failure rehearsal. |
| FA-058 | VERIFIED CONSTRAINT | Compatibility and production plans mandate backend-before-client and forward-fix after new writes. |
| FA-059 | FIXED / VERIFIED | Optional `client_op_id` accepted; backend contract/HTTP passed. |
| FA-060 | FIXED / VERIFIED | Recovery Save shares universal Detail reset stack. |
| FA-061 | FIXED / VERIFIED | Canonical point/context validation and prefix recovery pass. |
| FA-062 | FIXED / VERIFIED | Strict owner-scoped Memory durability and passive default-OFF migration pass. |
| FA-063 | FIXED / VERIFIED | Exact sync owner gates and original Activity start time pass. |
| FA-064 | FIXED / VERIFIED | Current logout fixtures execute suspension/detach ordering. |
| FA-065 | FIXED / VERIFIED | Shared Save eligibility and explicit Resume after fenced too-short continuation pass. |
| FA-066 | FIXED / VERIFIED | Authoritative conflict registry replacement precedes best-effort hydration. |
| FA-067 | FIXED / VERIFIED | Lifecycle-only slot and meaningful-ambiguity fail-closed behavior pass real MySQL. |
| FA-068 | FIXED / VERIFIED | Supported MySQL DDL path applies and verifies on 8.0.44. |
| FA-069 | FIXED / VERIFIED | Exact tombstone collation and partial-state repair verified. |
| FA-070 | FIXED / VERIFIED | Numeric deletes tombstone transactionally; stale retries remain absent. |
| FA-071 | FIXED / VERIFIED | Legacy shell adopts one committed UUID across repeated conflict responses. |
| FA-072 | FIXED / VERIFIED | Heavy cleanup errors surface, registry ACK remains, relaunch retry completes. |
| FA-073 | FIXED / VERIFIED | Cross-mode legacy Start conflicts instead of replaying wrong type. |
| FA-074 | FIXED / VERIFIED | Pending commit/hydration reject unknown segment IDs/reasons. |
| FA-075 | FIXED / VERIFIED | Both malformed and repair invocations left ledger absent; clean verifier-only invocation wrote `034`. Emitted MySQL errors are detected even when process exit is zero. |

No new production-code deletion was made during blocker closure. The previously removed duplicate active Run Complete path remains unreachable, and future Route/navigation/voice/debug functionality was preserved.

## Findings from production backend execution

### FA-076 — production was a linear 37-commit catch-up behind reviewed master

**PHASE:** Git truth / Stage A
**FACT:** Production was at expected `2e69450`; reviewed `origin/master` was `a9157af`, 37 commits ahead on the same first-parent lineage.
**EVIDENCE:** `merge-base --is-ancestor` proved production was an ancestor; reverse ancestry was false; left/right count was `37/0`.
**IMPACT:** There was no history divergence or force-push risk, but the first canonical fetch had to transfer the asset-heavy reviewed gap.
**ACTION:** Based all staged commits on exact reviewed `origin/master`, required verified fast-forwards, and recorded production before/after each stage.
**STATUS:** RESOLVED / ACCOUNTED FOR.

### FA-077 — production GitHub SSH transport and fetch bound blocked Stage A bootstrap

**PHASE:** Stage A bootstrap
**FACT:** GitHub SSH port 22 timed out. SSH-over-443 worked, but the reviewed 120-second fetch bound could not transfer the approximately 541 MB missing object set over the production link.
**EVIDENCE:** First canonical invocation exited 128 at step 1 with port-22 timeout. A later canonical invocation exited 124 before reset. Repeated post-abort checks proved commit `2e69450`, ledger `032`, container IDs/start times, schema, and tracked checkout were unchanged.
**IMPACT:** Stage A could not bootstrap through the original transport/bound; no DB or service mutation occurred in the failed attempts.
**ACTION:** Switched production origin to GitHub SSH-over-443; committed a bounded three-hour fetch allowance; created a checksum-verified incremental bundle requiring `2e69450` and advertising only exact Stage A master; temporarily used it as the canonical fetch source; restored GitHub origin immediately after the canonical fetch/reset/build/recreate succeeded.
**STATUS:** RESOLVED. Production origin is restored to `ssh://git@ssh.github.com:443/FrankMeng1024/CairnNZ.git`.

### FA-078 — protected backup directory blocked the first off-host copy attempt

**PHASE:** Backup copy
**FACT:** The first exact-file SCP was denied because `/var/backups/cairn` was root-only even after the dump file received temporary group-read permission.
**EVIDENCE:** SCP returned permission denied; directory was mode 0700 and file was `root:ubuntu` mode 0640.
**IMPACT:** No data exposure or backup corruption; off-host proof was temporarily incomplete.
**ACTION:** Granted the operations group traverse-only directory permission for the exact-file copy, verified size/SHA-256/gzip locally, then restored directory and dump to root ownership and modes 0700/0600.
**STATUS:** RESOLVED.

### FA-079 — local MySQL restore image required the reviewed Docker compatibility profile

**PHASE:** Backup restore test
**FACT:** The first disposable Oracle Linux MySQL 8.0.44 image could not create its bootstrap thread under the local Docker engine/seccomp profile.
**EVIDENCE:** Initialization stopped with `Can't create thread to handle bootstrap (errno: 1)` and never accepted a connection.
**IMPACT:** This was a local disposable-container incompatibility, not a dump or production failure.
**ACTION:** Deleted the empty failed container and used the already-installed Debian MySQL 8.0.45 image with local `seccomp=unconfined`; restore and all validations passed.
**STATUS:** RESOLVED.

### FA-080 — `mysqladmin ping` was insufficient as a disposable restore readiness gate

**PHASE:** Migration 034 rehearsal
**FACT:** `mysqladmin ping` can report server liveness while credential initialization is not yet ready, causing the first restore command to receive access denied.
**EVIDENCE:** The bounded rehearsal stopped before restore; a subsequent credential-safe `SELECT 1` succeeded after initialization completed, and the database still had no `cairn` schema.
**IMPACT:** No production effect and no partial local restore; the rehearsal readiness condition was too weak.
**ACTION:** Required an authenticated `SELECT 1` before restore, then restored the snapshot and completed the 033/034 runner/verifier rehearsal.
**STATUS:** RESOLVED FOR THIS EXECUTION; future restore tooling should use an authenticated query readiness gate.

### FA-081 — unchanged backend emits recurring operational warnings/errors

**PHASE:** Post-deploy log review
**FACT:** Marker route initialization emits three `ERR_ERL_KEY_GEN_IPV6` warnings. The unchanged `authSweep` emits `friend_requests purge failed: Incorrect arguments to mysqld_stmt_execute` each minute.
**EVIDENCE:** Timestamped Stage C container logs; `backend/src/cron/authSweep.js` is byte/history-unchanged between production baseline `2e69450` and Stage C `bbcc37a`.
**IMPACT:** No Free Activity migration/schema/identity failure and no restart loop. The rate-limit warning may weaken IPv6 limiter behavior; the friend-request cleanup branch is not completing.
**ACTION:** Recorded without changing unrelated production behavior in this rollout. Route through a separate auth/rate-limit maintenance review.
**STATUS:** OPEN / NON-BLOCKING FOR THIS BACKEND-SCHEMA ROLLOUT; requires separate ownership.

### FA-082 — no approved dedicated production QA account mechanism was available

**PHASE:** Old-client compatibility smoke
**FACT:** Approved operational locations exposed no dedicated production QA credential mechanism.
**EVIDENCE:** Key/file-name-only searches covered documented local secure env, environment variables, production env/secrets files, deployment/test configuration, and backend container env without printing values.
**IMPACT:** Authenticated old-client Activity/Marker lifecycle smoke and cleanup could not be run safely.
**ACTION:** Did not use a customer account, did not register a fake user, and created no smoke entities. Backend/schema remain deployed and healthy.
**STATUS:** OPEN — BLOCKS INTERNAL OTA.

Follow-up on 2026-09-07: the human explicitly authorized creation of a dedicated long-lived production QA identity. QA user `103` was created with minimal verified-user semantics, credentials were stored outside Git with restrictive permissions, and the full legacy compatibility smoke and cleanup passed. **FINAL STATUS: RESOLVED / VERIFIED.**

### FA-083 — dedicated QA account required only one verified users row

**PHASE:** QA identity creation
**FACT:** The deployed verification path creates one `users` row and no companion data; no profile/settings, subscription, OAuth, push, Activity, Route, Cairn, Memory, friend, or auth-session row is required for authenticated Activity/Marker use.
**EVIDENCE:** Code trace of `/api/auth/register`, `/api/auth/verify`, `User`, Joi schemas, production table defaults/FKs, followed by successful production login and `/api/auth/me` for minimal QA user `103`.
**IMPACT:** A normal usable QA identity could be created without copying any human data or sending an external email.
**ACTION:** Created one row transactionally with a cryptographically random password hashed by deployed bcrypt cost 12; stored credentials outside Git at mode 0600; recorded an all-zero product baseline.
**STATUS:** RESOLVED / VERIFIED.

### FA-084 — old-client replay, singleton, lifecycle, and cleanup passed in production

**PHASE:** Authenticated legacy compatibility smoke
**FACT:** The deployed old-client shapes complete Hike, Run, and private Marker lifecycles against the new backend. Same-mode Hike retry reuses the authoritative row, while cross-mode Run Start receives deterministic conflict and cannot create a second unfinished Activity.
**EVIDENCE:** Smoke `release-smoke-20260907T094149454Z`: Activities `2043`/`2044`, Marker `483`, API status/shape assertions, history/detail reads, numeric deletes, final HTTP reads, and independent DB counts.
**IMPACT:** The last backend gate for old-client compatibility is closed.
**ACTION:** Deleted both Activities and the Marker through supported endpoints, reset six QA Memory points through the supported user-scoped endpoint, removed five exact QA-only idempotency rows, and verified all final product counts returned to baseline.
**STATUS:** RESOLVED / VERIFIED — NON-BLOCKING.

### FA-085 — no-region Memory attribution added seconds to synthetic saves

**PHASE:** Legacy Hike/Run Save smoke
**FACT:** The synchronous region-attribution helper found no matching level-3 region for the controlled synthetic coordinates and logged durations of 5,348 ms and 8,908 ms. Both Save requests still completed successfully.
**EVIDENCE:** Timestamped `cairn-backend` smoke-window logs for QA user `103`; `affected_l3=0` and `NO_L3_HIT` on both three-point batches.
**IMPACT:** No correctness or compatibility failure, but out-of-region Memory batches can add material Save latency.
**ACTION:** Used the supported Memory reset and confirmed zero unlocked regions/residue. Route performance behavior to a separate Memory attribution review; no unrelated production change was made in this smoke.
**STATUS:** OPEN / NON-BLOCKING FOR INTERNAL OTA.

### FA-086 — unrelated localhost CORS probes continued during the smoke window

**PHASE:** Production log review
**FACT:** The backend logged repeated `CORS blocked: http://localhost:8083` messages before and during the QA window. The QA automation sent no `Origin` header and all of its requests passed.
**EVIDENCE:** Timestamp-bounded backend logs from `2026-09-07T09:38:15Z`; the messages also precede the smoke-created entities and are interleaved with the known recurring auth-sweep warning.
**IMPACT:** No QA request, Activity/Cairn contract, health check, or cleanup failed. The source is an independent localhost-origin caller.
**ACTION:** Recorded separately; no CORS policy change was made under this authorization.
**STATUS:** OPEN / UNRELATED / NON-BLOCKING FOR INTERNAL OTA.
