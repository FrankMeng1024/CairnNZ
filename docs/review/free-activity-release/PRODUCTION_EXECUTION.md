# CairnNZ Free Activity production backend execution

Execution date: 2026-09-07
Window: 2026-09-07T07:28:45Z–2026-09-07T09:45:08Z / 2026-09-07T15:28:45+0800–2026-09-07T17:45:08+0800
Operator: Codex production rollout session
Final status: `BACKEND READY FOR INTERNAL OTA`
Blocking gate: none; the authorized dedicated production QA identity and old-client compatibility smoke continuation passed with complete cleanup.
Client release: no OTA or public client release was performed.

## Git truth and rollout

The developer working tree was recorded as dirty and preserved. All rollout commits were constructed in the clean external worktree `/Users/mzm/Desktop/cairn/CairnNZ-production-rollout`.

- Initial local/origin tip: `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c`.
- Initial production tip: `2e6945047e6ef63590f2ace49f4cc0d3998ddcb1`.
- History relation: production was a linear ancestor of the reviewed origin tip by 37 commits; there was no divergence or force push.
- Every push was a verified fast-forward to `origin/master`.

| Stage | Commit(s) | Production before | Production after | Ledger before | Ledger after |
|---|---|---|---|---|---|
| A — tooling bootstrap | `0bfe2407f1c5d9e13689fccd97ecbcc9be9de64e`, `7c7b10186c027802dad31b1851f9ff551f682fc9`, final tip `eb207c1be00054675326f6d9772cb9dc97628dec` | `2e6945047e6ef63590f2ace49f4cc0d3998ddcb1` | `eb207c1be00054675326f6d9772cb9dc97628dec` | `032` | `032` |
| B — migration 033 only | `0e582e6f61836430af9afffb469d0e38f877c296` | `eb207c1be00054675326f6d9772cb9dc97628dec` | `0e582e6f61836430af9afffb469d0e38f877c296` | `032` | `033` |
| C — migration 034 + Free Activity backend | `bbcc37aae5379167f2bf74c15a5685be9cf631ad` | `0e582e6f61836430af9afffb469d0e38f877c296` | `bbcc37aae5379167f2bf74c15a5685be9cf631ad` | `033` | `034` |

Stage A remained tooling-only. The two follow-up tooling commits increased the bounded fetch timeout after the initial production transport findings; no migration or application feature entered Stage A. Final installed hashes:

- `docker/deploy.sh`: `99a9bd2bce0a7ecd05aa0108d8b9e48a7629c9272e53fb06bd469bcb224dc0c3`
- `docker/run-pending-migrations.sh`: `65aa1eb02017bcf78ea272ba35fc1f51af488bed8d19c8deff7c8d5c46240e91`
- `backend/scripts/verify-migration-034.sh`: `65e938579eff3b7ded7e52c41a58d5689449455c7cbb3921fedbbea5797ead03`

Runner/verifier executable modes were verified. Stage A contained no migration newer than 032. Shell syntax, zero-pending runner behavior, fail-closed runner assertions, and `git diff --check` passed.

## Stage A retries and tooling bootstrap

The first canonical invocation stopped in step 1 with GitHub SSH port 22 timeout, before fetch/reset, migration, build, or restart. Production remained at `2e69450`, ledger `032`, and the original container IDs/start times.

A read-only `ssh.github.com:443` probe returned the exact remote tip, so production `origin` was narrowly changed to SSH-over-443. The second canonical invocation reached the reviewed 120-second fetch limit before reset. A later monitored attempt showed the missing reviewed history was approximately 541 MB and could not fit the original bound over the production link.

The bootstrap correction was rehearsed and committed in Stage A. A complete incremental Git bundle was then created from the clean worktree, requiring exact production prerequisite `2e69450` and advertising only `master=eb207c1`. Local and production SHA-256 matched. Production `origin` temporarily pointed to that exact bundle, and the canonical command performed the fetch, hard reset, zero-migration check, build, recreate, health wait, and route smoke. The GitHub SSH-over-443 origin URL was restored immediately after success.

Stage A completed at backend start time `2026-09-07T08:15:27.645388921Z`. The ledger remained exactly `032`; migration 033 and every 034 object were independently confirmed absent. Backend and MySQL were healthy and application DB health was OK.

## Production backup and restore proof

Backup created immediately after Stage A:

- Production file: `/var/backups/cairn/cairn-prod-pre033-20260907T081832Z.sql.gz`
- Off-host copy: `/Users/mzm/Desktop/cairn/backups/cairn-prod-pre033-20260907T081832Z.sql.gz`
- Size: `81,938,319` bytes
- SHA-256: `8d0092e8aed97af88d2a91ecc9071fc015f0ca0e6702cf345879c8ef7b4756fd`
- Production commit: `eb207c1be00054675326f6d9772cb9dc97628dec`
- Production ledger: `032`

The dump used single-transaction, quick, no table locks, schema/data, triggers, routines, events, hex blob, UTF-8, and GTID-safe options. No database credential was printed or written to the execution record. Production and local gzip validation passed, byte size and checksum matched, the local directory is outside Git and mode 0700, the local file is mode 0600, and the production backup/directory returned to root-only permissions.

Restore validation used a disposable, unexposed MySQL 8.0.45 container. Restore exited zero. Verified restored facts:

- `users=30`, `sessions=32`, `markers=6`, `memory_points=848`;
- `route_points` and `route_points_raw` are JSON;
- all 23 foreign keys had zero orphan rows;
- `CHECK TABLE` passed for users, sessions, markers, and memory_points;
- no 033 or 034 objects existed in the snapshot;
- no triggers, routines, or events existed in the source schema, while the dump included the flags needed to preserve them;
- the external production migration ledger remained independently verified as `032`.

The disposable restore container was deleted after validation.

## Migration 033

Stage B contained only `backend/src/migrations/033_password_reset_email_events.sql`. Before production execution it passed a restored-snapshot MySQL 8.0.45 rehearsal.

Production execution result: clean runner application; ledger `032→033`; unchanged compatible backend rebuilt and recreated; health passed.

Independent production verification:

- table engine/collation: InnoDB / `utf8mb4_unicode_ci`;
- exactly 10 expected columns;
- `user_id BIGINT UNSIGNED`, matching `users.id`;
- primary key plus `idx_reset_email_event_request(request_id, created_at)` and `idx_reset_email_event_user(user_id, created_at)`;
- FK `fk_reset_email_event_user` uses `ON DELETE SET NULL`;
- initial and final observed row count: 0;
- every 034 object remained absent;
- production checkout exact `0e582e6`, backend healthy, DB health OK.

Password-reset observability status: `SCHEMA PRESENT`; `APPLICATION PRODUCER INACTIVE`. The deployed Stage C source has no reference to `password_reset_email_events` or `PasswordResetEmailEvent` outside migration 033.

## Stage C manifest and validation

| File | Why required | Source finding / contract |
|---|---|---|
| `backend/src/migrations/034_free_activity_client_identity.sql` | Add Activity/Cairn identities, singleton slot, provenance, tombstones, and nondestructive legacy reconciliation | FA-046, FA-057, FA-067–FA-069; migration/product contract |
| `backend/src/middleware/schemas.js` | Accept bounded client Activity/Cairn IDs, provenance, segments, stable Memory IDs, and operation IDs | FA-059, FA-074; API contract |
| `backend/src/models/Session.js` | User-lock serialization, authoritative singleton, stable identity replay/adoption, numeric-delete tombstones, provenance reconciliation | FA-046, FA-070, FA-071, FA-073 |
| `backend/src/routes/sessions.js` | Identity-aware Start/Save responses, legacy bridge, deterministic conflicts, client-ID delete/tombstone path | Activity identity/idempotency contract |
| `backend/src/routes/markers.js` | Cairn business identity, provenance, idempotent create, client/numeric delete tombstones | FA-055, FA-070; Cairn contract |
| `backend/src/routes/__tests__/freeActivityContracts.test.js` | Focused regression proof for the shipped backend/schema contract | Release-blocker closure evidence |

No app/client, Simulator, password-reset producer/model, rollback, or documentation path was present in the Stage C diff. Modified JS syntax checks, 11 focused backend contract tests, source hash matching, and `git diff --check` passed.

Migration 034 SHA-256: `ecdea52b16270dd87b3099c3723890c1e8ee57b21a235f08bce088887e0a74f6`. Verifier SHA-256: `65e938579eff3b7ded7e52c41a58d5689449455c7cbb3921fedbbea5797ead03`.

A second restored-snapshot MySQL 8.0.45 rehearsal ran the corrected runner from ledger 033. It applied only 034, passed the verifier, wrote ledger 034, and passed a second independent verifier run. Row counts remained `30/32/6/848`; all seven legacy shells were preserved and archived; no identity/provenance/tombstone row was invented; a direct second unfinished insert for one disposable-snapshot user failed on `uk_sessions_user_active_slot`. The disposable DB/container/network were removed.

## Migration 034 production result

Immediately before production DDL:

- production was exact Stage B, ledger 033;
- local and production backup checksum remained verified;
- seven legacy unfinished rows remained across two owners;
- all had zero distance, duration, accepted/raw point evidence, no recent timestamp, and no client identity;
- ages were approximately 167.1–506.8 hours;
- 033 row count was zero and every 034 object was absent;
- no concurrent DDL operator or pending metadata lock was observed;
- approximately 14.5 million 1K blocks of disk headroom remained;
- backend and MySQL were healthy.

Production execution result: migration 034 applied cleanly; verifier passed; ledger advanced `033→034`; backend image built; `cairn-backend` recreated; health and canonical route smoke passed. No partial-state recovery or manual ledger action was required.

Independent production verification passed for:

- `sessions.client_activity_id CHAR(36)` with `utf8mb4_unicode_ci` and unique `(user_id, client_activity_id)`;
- lifecycle-only stored generated `active_slot` and unique `(user_id, active_slot)`;
- `abandoned_at` and `abandon_reason`;
- `markers.client_cairn_id`, `origin_activity_client_id`, and unsigned `origin_session_id`;
- unique Cairn business key and provenance index;
- `fk_markers_origin_session ON DELETE SET NULL`;
- both InnoDB tombstone tables, exact `CHAR(36)` identity collation, composite primary keys, and expected user-FK cascades;
- no unexpected cascade on Cairn provenance;
- zero duplicate legitimate unfinished Activities;
- zero new client identity, provenance, or tombstone writes at verification time.

The seven legacy rows remain in `sessions`; all seven have `legacy_stale_zero_shell`, all have null active slot, and none contains meaningful Activity evidence. No meaningful Activity was archived. Total row counts remain `users=30`, `sessions=32`, `markers=6`, `memory_points=848`, and password-reset events `0`.

## Backend, MySQL, nginx, and logs

- Final production checkout: `bbcc37aae5379167f2bf74c15a5685be9cf631ad`.
- Final backend container: `cairn-backend`, healthy, restart count 0, started `2026-09-07T08:50:29.169070231Z`.
- Final backend image: `sha256:787e5ad6a7b584aba94cf69ab711553b5b1d099e1eb99fb011cc86f2b1642779`.
- Checkout and running-container hashes match for schemas, Session model, Activity routes, and Cairn routes.
- Binding remains `127.0.0.1:3001`.
- Direct `/health`, nginx/API public `/health`, application DB health, and unauthenticated route-registration probes passed. The five protected legacy/new routes returned expected 401 responses without credentials.
- MySQL: 8.0.45, healthy, restart count 0, original start time `2026-04-01T12:59:04.880351619Z`.
- nginx: active/running with start time `2026-05-19 13:11:17 CST`; it was not restarted.

No migration, schema, database-connection, Activity/Cairn identity, singleton, provenance, tombstone, idempotency, old-client parsing, crash-loop, or restart-loop error appeared after Stage C. Three existing `express-rate-limit` IPv6 key-generator warnings recur at Marker router startup. The unchanged `authSweep` also logs `friend_requests purge failed: Incorrect arguments to mysqld_stmt_execute` each minute. Both are recorded as separate findings; neither was introduced by the six-file Stage C diff.

## Old-client compatibility and smoke

The human authorized creation of one dedicated long-lived production QA identity. Registration/verification code and production schema inspection established that a normal verified account requires one `users` row only. User `103`, `cairnnz-production-qa@example.com`, was created at `2026-09-07T09:37:32Z` in a direct transaction using the normal verified-user shape and bcrypt cost 12. This avoided verification/welcome email side effects. Credentials are stored outside Git at `/Users/mzm/Desktop/cairn/secrets/production-qa.env`, parent mode 0700 and file mode 0600. No credential or token is present in this document.

The initial product baseline was zero Activities, unfinished Activities, active slots, Routes, Cairns, Memory, Friends, friend requests, subscriptions, OAuth links, device tokens, push-preference rows, token-blacklist rows, tombstones, unlocked regions, and idempotency rows. Public production login and `/api/auth/me` both returned 200 and resolved to QA user `103`.

Smoke `release-smoke-20260907T094149454Z` ran from `2026-09-07T09:41:49.454Z` to `2026-09-07T09:42:05.404Z` using deployed-old-client request shapes:

- legacy Hike Start without `client_activity_id` created Activity `2043`;
- identical legacy Hike retry returned the same ID with `legacy_replay=true`;
- legacy Run Start while the Hike was unfinished returned deterministic 409 `UNFINISHED_ACTIVITY_EXISTS`, retained Activity `2043` as authoritative, and created no second unfinished row;
- three controlled synthetic private points attached, Save finalized coherently, and history/detail reads passed;
- numeric delete removed the Hike with no unfinished shell or resurrection;
- the same bounded legacy lifecycle passed for Run Activity `2044`, followed by complete numeric deletion;
- legacy private Marker `483`, without `client_cairn_id` or provenance, passed create/list/read/numeric-delete and remained absent;
- six expected Memory points from the two legacy Activity saves were removed through the supported account-scoped Memory reset endpoint.

Five normal QA-owned idempotency-cache rows were the only DB residue after HTTP cleanup. Because this account's measured baseline was zero, they were removed in an exact user/time-window transaction; the affected-row count was exactly five. Final HTTP and independent DB checks show zero Activities, unfinished rows, active slots, Routes, Markers, Memory, social/OAuth rows, tombstones, unlocked regions, and idempotency rows. Global Sessions/Markers/Memory counts returned exactly to `32/6/848`; only users changed, `30→31`, for the retained QA identity. The human reference account digest is unchanged.

QA continuation gate summary:

- QA identity created: **YES**
- QA authentication: **PASS**
- Old-client Hike smoke: **PASS**
- Singleton conflict smoke: **PASS**
- Old-client Run smoke: **PASS**
- Old-client Marker smoke: **PASS**
- Cleanup: **PASS**
- Remaining smoke entities: **Activities 0; unfinished/active slots 0; Markers 0; Memory 0; tombstones 0; idempotency rows 0**
- Production logs: **PASS for compatibility/schema/identity/ownership; existing auth-sweep and unrelated localhost-CORS messages recorded separately; non-blocking no-region attribution latency recorded as FA-085**

Compatibility status remains:

- old client + new backend: production authenticated smoke passed;
- new client + new backend: supported for the next separately authorized internal QA OTA;
- new client + old backend: unsupported;
- no client OTA was published.

## Rollback and forward-fix state

At final verification there were zero production client identity, provenance, or tombstone writes, so the structural pre-new-client decision branch still exists. Migration 034 should nevertheless remain in place unless a separate reviewed decision proves a down migration necessary and safe.

The rollback policy changes irreversibly at the first production new-client identity, provenance, or tombstone write. From that point, migration 034 is forward-fix-only and an old backend/down migration combination is forbidden.

The checksum-verified Git bootstrap bundles, temporary bare bundle repository, clean rollout worktree, and all disposable MySQL containers/networks were removed after use. The protected production and off-host database backups remain in place.

## Final safety confirmation

- Production DB mutated: **YES — reviewed migrations 033/034 in the rollout, then one authorized QA user plus normal QA smoke writes and exact QA-only cleanup in this continuation.**
- Migration 033 ran: **YES.**
- Migration 034 ran: **YES.**
- Backend recreated/restarted: **YES — canonical deploy only.**
- MySQL restarted: **NO.**
- nginx restarted: **NO.**
- `origin/master` pushed: **YES — exact fast-forward staged commits.**
- Push during QA continuation: **NO.**
- Client OTA published: **NO.**
- `git clean` used: **NO.**
- Meaningful production user data deleted: **NO.**

Exact remaining backend gate before internal OTA: **none**. Publishing any internal OTA remains a separate, explicitly authorized task and was not performed here.
