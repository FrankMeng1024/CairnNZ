# Real MySQL migration and origin results

## Verdict

**PASS** on an isolated disposable MySQL 8.0.45 instance. This is local integration evidence, not production deployment evidence.

## Isolation and setup

- Container: uniquely named `cairn-route-rev02-20260917t203209-mysql`.
- Database: uniquely named `cairn_route_rev02_20260917t203209`.
- The integration test refuses to run unless `DB_NAME` matches `^cairn_route_rev02_[a-z0-9_]+$`.
- The fixture uses only synthetic users, Activities, Routes, geometry, and `.invalid` email addresses.
- A minimal legitimate pre-036 schema fixture was derived from repository migrations 001, 002, 005, 018, 019, and 034.
- Test credentials were ephemeral and are intentionally excluded from artifacts.
- No existing database, container, or shared volume was deleted or altered.

Docker's default seccomp profile was incompatible with this local MySQL image; the uniquely scoped disposable container used `seccomp=unconfined`. The first repository-runner attempts also proved that the host lacked a `mysql` CLI. A task-local shim delegated the unchanged runner's client calls to the disposable MySQL container. Those diagnostic attempts are retained and not mislabeled as successful integration runs.

## Migration execution

Current migration: `backend/src/migrations/036_route_origin_identity.sql`.

The migration previously contained `USE cairn`, which could redirect an isolated run to the wrong database. Because revision 01 had not deployed migration 036 anywhere, this undeployed migration was safely corrected to operate on the connection-selected database.

The actual repository migration runner applied 036 and its ledger recorded it. A second runner execution reported zero new migrations with last migration 036. The raw SQL file is **not** claimed independently idempotent; rerun safety is supplied by the migration ledger. `backend/scripts/verify-migration-036.sh` is a SELECT-only postcondition verifier and supports the runner's partial/rerun diagnosis.

Hashes used by the run:

| File | SHA-256 |
|---|---|
| `036_route_origin_identity.sql` | `e3988c0801cdae8409614f4bbb2cadca24acf778b6ae85cbc90fe8e06c68d3d0` |
| `route-origin-pre036.sql` | `60981a5c735071b9e124617ce952acab19c1d05dc56693961b9b226ec4ae6ba9` |
| `routeOriginMySql.integration.js` | `7d3a997095bff391ffb24a05d1ca2501038b417062c8c7ee487b8ddf1e467eff` |
| `verify-migration-036.sh` | `626e29cf5716c462d8fcc2538982f92474f40f34c43833b4a5c4305357bc98e4` |

## Real schema postconditions

**PASS**:

- origin/identity/hash/edit columns exist with expected null/default semantics;
- unique `(user_id, client_route_id)` index exists;
- owner/source Activity index exists;
- source-session foreign key is `ON DELETE SET NULL`;
- tombstone/user foreign key exists with the intended cascade;
- tombstone table exists.

## Real model, transaction, and HTTP assertions

| Assertion | Result |
|---|---:|
| Create -> close model pool -> new model context -> reload preserves client identity, origin, live source link, gap flag, and hashes | PASS |
| Edit -> close/reload preserves immutable origin/hashes and sets current-geometry edited state | PASS |
| Cross-owner source Activity is rejected | PASS |
| Non-finalized source Activity is rejected | PASS |
| Owner-scoped client Route identity uniqueness | PASS |
| Same-owner replay converges to one Route | PASS |
| Actual source Activity delete clears only live FK link; independent Route and historical origin fact survive | PASS |
| Forced failure rolls back both delete and tombstone insertion | PASS |
| Separate real connection create/delete race leaves tombstone precedence and no Route resurrection | PASS |
| HTTP create/detail/update/client-delete/replay-delete/numeric-missing structured contracts | PASS |
| Replay after tombstone is rejected | PASS |

Integration command used the real `mysql2` driver, current `Route` model, and current Express Route handlers with only authentication/idempotency middleware replaced by deterministic local test middleware. The result was 1/1 passing integration test.

## Cleanup

After evidence capture, the unique disposable database was dropped, the unique container removed, and only volumes created for this task were removed. Cleanup is recorded in `test-output/mysql-cleanup.log`. The synthetic database is not recoverable; it contained no personal or production data.

## Deployment boundary

Migration 036 and the local backend changes remain **NOT DEPLOYED**. Production migration, production configuration, production data, OTA publication, and external services were not touched.

