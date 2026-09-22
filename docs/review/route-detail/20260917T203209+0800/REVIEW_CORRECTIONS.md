# CARD-ROUTE-01 revision 02 — review corrections

Run identity: `20260917T203209+0800`  
Candidate identity: `O59` (unchanged; the unaccepted revision-01 candidate was corrected in place)  
Previous delivery SHA-256: `1ad5c5084873df71665208edbca1abaa7ca04b0968717db3fbf0859139ca4f43`

This is a bounded correction to CARD-ROUTE-01. It does not replace the original report, broaden the Route product, publish an OTA, deploy the backend, or establish native/device/owner acceptance.

## Baseline and drift

- The revision-01 archive hash matched the supplied SHA-256.
- All 25 revision-01 touched-source hashes matched the task-start worktree. No material Route-card drift was found.
- Start source identity: branch `master`, Git HEAD `12fa1cd0ef599e53a81cd30537ce761c5e2150ce`, intentionally dirty worktree.
- The exact task-start status and scoped hashes are retained under `baseline/`.
- Unrelated dirty work was preserved. No reset, clean, broad format, commit, deploy, or publication was performed.

## Finding A — ambiguous delete 404

**Status: reproduced, corrected, PASS.**

Pre-fix, an unstructured HTTP 404 from `DELETE /api/routes/client/:clientRouteId` returned `true`. The store could therefore mark the tombstone remotely complete without invoking the known numeric server-ID fallback. The actual starting test failed with expected `unsupported`, received `true`.

The service now returns an explicit `deleted | already-absent | unsupported` result. Only a structured response tied to the requested Route identity can confirm absence. An unsupported client-identity endpoint falls back only when the store already owns a numeric server Route ID; no ID is derived from a client UUID. Generic numeric-endpoint 404, malformed success, authentication failure, server error, transport failure, and timeout cannot manufacture remote success. Unknown outcomes retain the durable tombstone, retry metadata, and pending cleanup state.

The local backend now returns identity-bound structured delete responses. Immediate callers—normal deletion, tombstone reconciliation, and late create acknowledgement cleanup—use the same correction. A late acknowledgement cannot resurrect the local projection and triggers reconciliation with the known acknowledged server ID.

Proof:

- `test-output/pre-fix-defect-reproduction.log`
- `app/src/services/__tests__/routeService.contract.test.ts`
- `app/src/store/__tests__/useRouteStore.offline.test.ts`
- `test-output/client-focused-regression.log`
- real-handler deletion fixture in `visual/capture-results.json`

## Finding B — stale same-owner detail overwrite

**Status: reproduced, corrected, PASS.**

Pre-fix, a detail read begun before a successful same-owner rename/geometry save replaced both in-memory and persisted truth when it returned late. The reproduction observed `New saved name` after save, then `Old` in the store and cache.

The Route store now tracks small owner/object mutation epochs and request order. Reads capture their start epoch and revalidate owner, request identity, tombstone state, and mutation epoch immediately before publishing and before durable cache persistence. Cache writes are serialized. Accepted server `updated_at` is retained as server ordering evidence for relaunch hydration; device wall-clock time is not used to decide which server result wins. List merges apply the same mutation-preserving rule. A newer legitimate refresh remains accepted.

The correction covers metadata and geometry, stale not-found/error, out-of-order detail reads, old list hydration, deletion during read, relaunch hydration, and account switching. Failed mutations do not publish draft content as accepted truth.

Proof:

- `test-output/pre-fix-defect-reproduction.log`
- delayed-promise regressions in `app/src/store/__tests__/useRouteStore.offline.test.ts`
- `test-output/client-focused-regression.log`

## Finding C — MySQL evidence gap

**Status: corrected, PASS on disposable MySQL 8.0.45.**

Migration 036 was applied to an actual uniquely named disposable database using the repository migration runner, then the runner was re-executed to prove ledger behavior. The current model and HTTP handlers were exercised through `mysql2` against real MySQL transactions and connections. Origin/hash persistence survived pool close and model reload; immutable origin, source ownership/finalization, uniqueness, actual `ON DELETE SET NULL`, rollback, replay convergence, tombstone precedence, and a bounded create/delete race passed.

The migration's hard-coded `USE cairn` was removed because it could escape an isolated selected database. The raw SQL is not claimed independently idempotent; the migration ledger and a SELECT-only postcondition verifier provide the supported rerun contract. The migration remains local and undeployed.

See `MYSQL_INTEGRATION_RESULTS.md` and the raw MySQL logs.

## Finding D — missing behavioral evidence

**Status: corrected, PASS for local handlers/reducers; native gestures remain NOT RUN.**

- A real supported trim command creates draft geometry G1 from saved G0.
- Apply/commit-draft leaves accepted G0 unchanged.
- Save accepts G1; cache reload retains G1.
- Cancel keeps G0; failed save keeps G1 draft and G0 accepted; retry commits once.
- Activity geometry/metrics and Memory fixtures remain byte-for-byte unchanged.
- Back supports Stay and deliberate Discard.
- Back during Save is intercepted; deliberate leave suppresses unsolicited late navigation.
- repeated Save cannot begin a parallel transaction; success claims one intended navigation; timeout/failure releases the gate for retry; account/object changes prevent late state/navigation application.
- Delete cancel, confirm, old-backend fallback, pending cleanup, late responses, reload, and non-cascade boundaries are executed with disposable fixtures.

The native drawing gesture itself was not exercised. This is explicitly separate from the tested editor commands, stores, handlers, and Web interaction.

## Finding E — raw vertex count

**Status: corrected, PASS.**

`selectedRoute.points.length` was removed from ordinary Route Detail metrics. Distance and defensible available elevation use a balanced one/two-metric layout. Point count remains only an internal geometry readiness check, not a user metric. Day, Sunset, Night, a long name, and a `375×667` Web constraint were recaptured.

## Finding F — shared action label

**Status: corrected, PASS.**

The action that opens the Hike/Run chooser is now `Use Route`. The chooser retains explicit Hike and Run options and does not start recording. Mode-specific pre-start controls were not renamed.

## Test summary

| Evidence level | Result | Boundary |
|---|---:|---|
| Pre-fix actual-store/service reproduction | FAIL as expected: 2 failed, 18 passed | Proves A and B existed in the recovered candidate |
| Focused client + peer regressions | PASS: 18 suites, 164 tests | Services, Route store/editor/use, Activity, Cairn, Trails, shared offline identity |
| Focused backend regressions | PASS: 18/18 | Route origin/delete and Activity contracts |
| Real MySQL integration | PASS: 1/1 integration test plus schema verifier | MySQL 8.0.45, disposable DB, real model/HTTP handlers |
| Activity changed-file gate | PASS: 552/552 | Required repository guardrail |
| Expo Web visual/interaction fixture | PASS: 13/13 assertions, 0 runtime errors | Synthetic isolated data; native map unavailable |
| Full project TypeScript | FAIL: existing baseline, 253 diagnostic lines | No diagnostic names a revision-02 touched file |

The existing Jest warning for `setupFilesAfterFramework` and the repository-wide TypeScript baseline were not changed to manufacture a green result.

## Evidence boundaries

- The Web fixture intercepts all `/api` traffic, blocks external requests, disables telemetry, and uses synthetic coordinates/identity.
- The visual evidence is Expo Web React Native DOM with native map services unavailable. It is not native RN Mapbox, gesture, haptic, keyboard, small-device, OTA-loading, field, or owner-acceptance proof.
- The MySQL run is local disposable integration evidence, not production migration or deployment evidence.
- The O58 owner-history endpoint/create-replay changes and migration 036 still require controlled backend deployment before a grouped device review can exercise full server durability.

