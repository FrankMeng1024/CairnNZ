# Free Activity release blocker closure review

Review date: 2026-09-07

## A. Release verdict

### READY FOR NATIVE QA

The independent FAIL blockers are closed in code and real MySQL evidence. Production release readiness is not claimed: no physical-device run occurred and no production change was performed.

## B. Blockers closed

| # | Root cause | Change | Independent proof |
|---|---|---|---|
| 1 | UI/business-ID uniqueness did not constrain distinct unfinished IDs. | User-row transaction mutex plus generated `active_slot` and unique `(user_id, active_slot)`; deterministic conflict response. | 24 distinct concurrent Starts: 1 create, 23 conflicts, one DB row; direct bypass insert rejected. |
| 2 | Async completions reread whichever account was current. | Capture immutable entity owner before awaits; exact owner checks at start/append/finish/ACK/cleanup/Cairn/Memory/recovery; logout awaits suspension. | Deferred A response/outbox/callback tests while B is active; A data remains recoverable after A returns. |
| 3 | Live GPS context outlived Finish, failed Resume, and logout; timestamp order was weak. | Durable generation/lifecycle/time lease, freeze-first Finish, rollback on Resume acquisition failure, awaited disable on logout, old-batch rejection. | Foreground/background post-Finish, phase-failed Resume, logout→B→A callback, and out-of-order tests. |
| 4 | Cairn tombstones were concurrent read-modify-write and fallback owner could drift. | Serialized tombstone mutation and immutable emergency payload owner; transactional server locks/tombstones for client and numeric delete paths. | Concurrent deletes retain both tombstones; fallback account-switch and stale create-after-delete tests; real MySQL races. |
| 5 | Completion spanned independent pending/summary/registry writes with no recovery intent. | Durable completion intent phases and replay; Save success only after a complete verified pending payload, summary, and lifecycle state exist. | Failure injection after phases 1–3 converges to unfinished/recoverable or one completed-local Activity. |
| 6 | Headless accepted Activity points were only journaled/queued, not durable Memory. | Shared canonical acceptance, durable Memory evidence commit, and relaunch reconciliation from Activity journal. | Accepted background point→simulated death→Discard retains Memory; rejected/gap points add none. |
| 7 | Pending files were in-place/unverified and cleanup failures were suppressed. | Versioned/checksummed envelope, temp write, strict close/atomic replace, backup/fallback validation, explicit corruption and cleanup-incomplete state. | Corrupt write and update-death tests retain previous good state; ACK+delete failure retries cleanup without server re-create. |
| 8 | Failed/oversized hydration could attach an empty writer and overwrite good Memory. | Hydration distinguishes valid empty from unavailable/corrupt/oversize/failed; unsafe state blocks writer; durable accepted evidence writes strictly. | Oversize, parse, read, prior-failure, and persistence-failure tests preserve prior data. |
| 9 | Detail effects could replace a visible local trace after cleanup; generic cap could evict pending summaries. | Detail owns a full snapshot for its mount; local-authoritative/pending summaries are never capped as disposable history. | Open Detail remains stable through sync cleanup/network failure; pending Activity remains beyond 100 server-backed rows. |
| 10 | Multi-statement auto-commit DDL and broad duplicate handling could lie in the text ledger. | Migration-specific verifier, emitted-error detection, atomic ledger replace, and verifier-only completion recognition. | Real malformed partial run and repair run both left ledger absent; third clean verifier-only run wrote `034`. |

## C. Authoritative unfinished singleton

Unfinished is defined by lifecycle: `finalized_at IS NULL`, `abandoned_at IS NULL`, and placeholder `end_time = start_time`. Metrics do not decide lifecycle. `Session.createEmpty` locks the durable user row, checks same-ID idempotency/tombstones, reconciles allowed legacy shells, then inserts. The generated active slot is a second DB enforcement boundary. Same ID returns one Activity; different ID returns `UNFINISHED_ACTIVITY_EXISTS` with authoritative identity. Server restart/multiple processes cannot bypass either DB boundary.

The client replaces its speculative registry owner with the authoritative conflict identity before best-effort trace hydration, so a materialization error cannot mask the real unfinished Activity.

## D. Legacy unfinished reconciliation

No legacy row is silently deleted. Stale identity-less shells older than six hours are preserved as `legacy_stale_zero_shell`. For recent duplicate empty shells, the newest remains active and the rest are preserved archived. Evidence ranking may archive only zero distance/duration/point shells; multiple meaningful unfinished rows cause migration verification/unique-index failure and explicit operator review.

Production’s seven relevant rows across two users are all 161–501 hours old and contain no points or metrics, so their expected nondestructive migration result is fully specified. It must be rechecked immediately before future authorization.

## E. Account ownership isolation

Activity registry, journals, completion intents, pending payloads, Cairn outboxes/tombstones, emergency payloads, and Memory are user-scoped. Async operations carry the captured owner; current account reads are used only as rejection gates, never as ownership sources at completion. Logout awaits durable GPS lease disable, drains/finishes the outgoing journal boundary, detaches Memory persistence, resets shared visible state, and preserves A’s pending artifacts. B cannot hydrate, publish, upload, acknowledge, clean, or merge A. A later recovers its exact data.

## F. GPS fencing

An accepted native point must match Activity ID, user, generation, lifecycle `tracking`, and a sample time at/after the durable lease boundary. It must also be newer than the last accepted owner sample. Finish sets the store fence before awaiting ingestion/native stop, durably disables background context, then snapshots. A failed Resume disables any partially acquired context and leaves the Activity paused/recoverable. Logout durably disables the lease before releasing account ownership. Known process recovery rotates generation/segment; pre-boundary samples cannot enter the new segment.

Automated proof covers logic and failure injection. OS-specific batch delivery and locked-screen timing remain the native gate.

## G. Completed-local atomicity

Save success means one recoverable product state is durable: immutable identity/owner, real segmented trace, calculated metrics, completed-local summary, verified full pending sync payload, and sync distinction. A phase journal makes interrupted completion replayable. Before that boundary, relaunch yields the unfinished Activity; at/after it, relaunch yields exactly one completed-local Activity. Network success is not required for local Save.

## H. Headless Memory durability

Foreground and headless points share canonical validation/segment authority. An accepted Activity point is durably journaled and committed to the owner’s Memory evidence authority; a reconciliation intent/journal completeness pass repairs a crash between physical stores. Memory is monotonic and survives later Activity Discard. Gap connectors, malformed samples, wrong-owner samples, and rejected GPS do not create Memory.

## I. Memory hydration safety

Hydration now has explicit valid-empty, valid-loaded, unavailable, corrupt, oversized/unsupported, failed-persistence, and partial-load outcomes. Only valid states attach a writer. Load failure is never interpreted as empty, and an A hydration that resumes after B login cannot publish or attach. Debounce optimizes subsequent redundant persistence but is not the accepted-evidence durability boundary.

## J. Pending Activity durability

Pending payload v3 includes a format/version, generation, checksum, canonical segment validation, immutable owner and identity, and full sync facts. Updates use strict temporary write plus atomic replacement and retain a prior-good fallback. Parse/checksum/schema failure is reported rather than skipped. Mapping, retry metadata, ACK, and cleanup eligibility updates cannot destroy the preceding valid generation.

## K. ACK / cleanup

The enforced order is server accept/reconcile → durable local ACK → durable client/server mapping → relationship reconciliation → safe acknowledged state → per-entity cleanup. Cleanup failure is not sync failure: no duplicate server create occurs, the ACK/registry retry anchor remains, and relaunch retries cleanup only. Activity A may remove its heavy files while B remains pending. Owner verification precedes every deletion; registry metadata is deleted last.

## L. Activity Detail snapshot

A pending/local completed Detail captures the complete trace, segments, connector metadata, metrics, name, and sync state into screen-owned memory. Sync and disk cleanup cannot erase the mounted view or force a destructive refetch. After navigation away, future reopening may use the server as long-term authority. The generic 100-row cache limit applies only to disposable/server-backed history, not pending local-authoritative rows.

## M. Cairn tombstones / ownership

`clientCairnId` remains immutable through local commit, hydration, ACK, and server mapping. Full Plant and Quick Cairn persist owner and `originActivityClientId` at the Cairn commit boundary. Serialized local tombstones cannot overwrite each other. Both server deletion shapes lock the user/entity, insert a tombstone when a business ID exists, and delete in one transaction. Stale create responses/retries remain rejected. Activity deletion never deletes its Cairns or personal Memory.

## N. Migration 034 + singleton schema

MySQL 8.0.44 accepted the final production-shaped DDL. Types, nullability, composite unique indexes, generated active slot, tombstone PK/FKs/collation, Marker provenance FK and `ON DELETE SET NULL` all verified. Legacy nulls remain legal. The generated column uses MySQL’s supported lock/copy path; the production table is small, but backup and lock-aware preflight remain mandatory. Meaningful multiplicity fails closed.

## O. Migration ledger/deploy safety

The local canonical deploy now delegates migrations to a fail-closed runner. For 034, every expected postcondition is checked. `mysql --force` output is scanned because it may print SQL errors and exit zero. Any process error, emitted SQL error, or verifier failure leaves the ledger unchanged. The ledger is written via temporary file/atomic rename only after a clean apply or a later verifier-only proof of already-complete schema.

Production currently has the old runner. The future plan therefore requires a tooling-only canonical bootstrap before 034 becomes pending, followed by the canonical feature deploy. No manual backend restart, ad-hoc compose restart, MySQL restart, nginx restart, or `git clean` is required.

## P. Real MySQL rehearsal

PASS. See `MYSQL_REHEARSAL.md`. It includes pre-034 representative data, legacy reconciliation, apply/verify, 24-way distinct/same-ID concurrency, lost ACK, old-client lifecycle, Cairn upload ordering, tombstones, stale retries, partial failure/repair/ledger, rollback-before-writes, destructive rollback-after-writes, and reapply.

## Q. Compatibility matrix

- OLD CLIENT + OLD BACKEND — SUPPORTED.
- OLD CLIENT + NEW BACKEND — TEMPORARILY SAFE.
- NEW CLIENT + NEW BACKEND — SUPPORTED FOR NATIVE QA.
- NEW CLIENT + OLD BACKEND — UNSUPPORTED.

Backend-before-client and no old-backend rollback after any new-client write are mandatory. See `COMPATIBILITY_MATRIX.md`.

## R. New findings

FA-065 through FA-075 were discovered during closure, recorded before resolution, fixed, and reverified. They cover too-short Resume, Start-conflict ordering, legacy lifecycle classification, unsupported MySQL DDL hint, identity collation, numeric-delete resurrection, legacy identity rollback, heavy cleanup ordering, cross-mode legacy replay, pending segment validation, and emitted-error ledger truth. `NEW_FINDINGS.md` contains root cause and evidence.

## S. Automated evidence

- Focused client: 18 suites / 125 tests passed.
- Backend: 18 Node tests passed after the final ledger contract assertion.
- Real MySQL: MySQL 8.0.44; all final migration/HTTP/concurrency assertions passed.
- Expo Web production export: passed, 3,389 modules, `/tmp/cairnnz-free-activity-blocker-closure-web`.
- Shell syntax, backend JS syntax, and `git diff --check`: passed.
- Changed Free Activity TypeScript scope: no new diagnostics.
- Whole repository TypeScript: existing exit 2 / 278 lines.
- Full Jest: 64 suites, 49 passed/15 failed; 514 tests, 470 passed/41 failed/3 skipped. Remaining failures are recorded baseline/deferred, including independently reproduced adjacent but pre-existing failures.
- Static reachability: one shared Save authority is used by Hike, Run, recovery, and Finish; no active duplicate Run Complete navigation; committed Activity/Cairn/Memory paths have no terminal retry deletion; cleanup ordering and exact owner checks are wired.

## T. Exact remaining native gate

No physical-device validation was performed. Execute all 17 steps on the relevant iOS and Android builds:

1. Record build IDs, devices/OS, permissions, power/background settings, passive exploration OFF, and clean test accounts.
2. Run a 60+ minute locked-screen Hike with Pause/Resume/Finish and reference-track comparison.
3. Run a 60+ minute locked-screen follow-first Run; prove freeze before naming/review and no duplicate completion path.
4. Complete eligible Hike and Run in airplane mode; kill/relaunch before reconnect; verify pending Detail and delayed handoff.
5. Commit offline Full Plant and Quick Cairn, kill immediately after success, and prove corrected coordinate/provenance recovery.
6. Separately test injected crash, OS process termination, and app-switcher termination during each mode.
7. Separately test deliberate force quit/swipe-away/OEM kill; verify missing intervals appear as gaps and are not claimed.
8. After termination, separately Resume, recovery Save, and recovery Discard; reconnect and audit resurrection.
9. Repeat locked tracking under iOS Low Power Mode and Android Battery Saver.
10. Test iOS Background App Refresh OFF and Android battery/background restriction; verify truthful readiness and gap behavior.
11. Disable precise accuracy and downgrade Always/background/foreground permissions mid-Activity.
12. Test credible short blackout and long/displaced tunnel reacquisition; verify connector contributes zero metrics, Memory, Fog, and Route geometry.
13. Inject delayed/reordered native batches and lost Start/Finish/Cairn/Memory responses; audit stable IDs and server counts.
14. Kill after each completion/ACK/mapping/reconciliation/cleanup boundary.
15. Sync Activity A while Activity B remains pending/failing; include reordered pending entities.
16. Keep pending Detail mounted through network return, sync, cleanup, and a failed refetch; leave and reopen from server.
17. Account A unfinished Activity+Cairn+Memory → logout → immediate B login with delayed A callback/ACK/outbox → logout B → login A and recover.

Each run must attach wall times, IDs, video/screenshots, diagnostics, and SELECT-only server count evidence. Screen lock, OS kill, app-switcher termination, and user force quit are distinct cases.

## U. Updated production plan

`PRODUCTION_CHANGE_PLAN.md` contains the exact two-phase tooling bootstrap, backup, legacy-row preflight, corrected 034 execution/verification, canonical automatic backend recreate, health/log/old-client smoke, internal candidate, native QA, staged release, and rollback/forward-fix tree. It was not executed.

## Remaining blocker

The only release-level blocker is the complete signed physical-device matrix. Failure of any native ownership, durability, gap, account-switch, or background-delivery case reopens the relevant FA finding and returns the verdict to FAIL or HOLD. Repository-wide unrelated Jest/TypeScript debt remains deferred and visible but did not fail the focused Free Activity gate.

## Safety confirmation

No production DB mutation, migration, deploy, restart, DB write, or file modification occurred. No push, OTA, or `git clean` occurred. Unrelated working-tree changes were preserved.
