# Activity Detail convergence

Run ID: `20260916T164608+0800`  
Scope: bounded Activity Detail implementation candidate  
Source baseline: `master` / `12fa1cd0ef599e53a81cd30537ce761c5e2150ce`  
Local candidate marker: `O57`  
Deployment/device/field/user acceptance: not performed / unverified / unverified / pending

## Previous Activity Detail

The existing object branch in `MapHistoryScreen.tsx` was reachable from successful Hike/Run Finish and Trails, but it was not a complete page contract:

- target lookup primarily assumed one ID shape instead of resolving local, client, and server identity consistently;
- Activity Detail applied another render-time smoothing/simplification layer after persisted Final geometry;
- true Gaps were drawn with dashed connectors in native and web paths;
- linked Cairns fell back to spatial proximity, which could claim an unrelated nearby Cairn;
- permanent success/status chrome included internal axes and unsupported future-enhancement language;
- Delete competed with Save as Route as an equal-sized action;
- Save as Route returned to Route Editor view instead of the canonical Route Detail;
- a missing Activity target fell through to a generic Trails empty list;
- the page did not distinguish an acknowledged server delete from a durable queued delete.

An earlier report describing the branch as implemented was therefore treated as source presence, not page completion or acceptance.

## Product decisions applied

- Activity remains immutable past truth; Route is a copied, independent future-intent object.
- Historical metrics remain Activity metrics. Detail display geometry never recomputes distance, time, elevation, pace, or Memory.
- Persisted chosen Final geometry is presentation authority; Detail does not add another smoothing algorithm.
- Normal local/synced success is quiet. Only states that change understanding or action are surfaced.
- A local Activity is usable, not failed.
- Cairn association is explicit provenance/membership, never proximity.
- Delete is secondary and preserves Cairns, independent Routes, and earned Memory.
- No durable future enhancement was invented, so no promise that “More map detail will be added later” remains.

## Entry paths

Hike Finish, Run Finish, recovery/local Save, and Trails all use the existing `MapHistory` Activity object route. Finish resets the stack to `Home → Trails (Activities) → Activity Detail`; Back from Detail resets to Trails Activities and cannot expose an ended recorder. `activityMatchesTarget` resolves `id`, `clientActivityId`, `remoteId`, and `serverActivityId` while retaining the stable local object.

The mounted Detail retains a summary and track snapshot so asynchronous sync cleanup cannot replace an already visible valid Activity with a false unavailable state. A genuinely unresolved/deleted target now has an Activity-specific degraded state.

Normal navigation is proven by source and automated contracts. The screenshots use forced routes and are not normal-navigation proof.

## Identity / rename

The header order is name, Hike/Run, date, and time. Internal IDs and engineering state are absent.

Rename remains mutation-truthful:

- pending/sync-error Activities update the durable pending payload before the local projection;
- synced Activities update the server before the local projection;
- syncing, missing-payload, server rejection, and local persistence failure do not show success;
- failed input remains in the editor for retry.

Focused rename success/failure tests pass. Physical keyboard, latency, and reconnect behavior remain pending.

## Metrics

Hike prioritizes Distance, Active Time, and Elevation. Run prioritizes Distance, Active Time, and Average Pace. Run pace is derived from persisted Activity duration and distance and is not labeled “Live Pace.” Existing metric/imperial preference is reused.

## Geometry / Gap

Verified source path:

`Canonical evidence → Base Final → optional accepted enhancement → persisted chosen Final trackPoints/route_points → Activity Detail renderer`

Activity Detail renders those points directly. Native Mapbox uses one FeatureCollection containing only real segment LineStrings. Expo Web skips segment-boundary pairs. Neither renderer draws a cross-gap line. Base Final is presented normally; an accepted enhanced Final is not replaced by Detail-only smoothing.

The Gap fixture visibly renders two disconnected segments. This is Expo Web fallback evidence only; native Mapbox remains device-unverified. No GPS, Final, matching, or smoothing algorithm was retuned.

## Local / sync state

Pending and sync-error Activities retain the title, metrics, geometry, linked Cairns, and available local actions. Visible exception copy is limited to:

- loading/unavailable local route geometry;
- Waiting to sync / Syncing Activity / Retry sync;
- Missing section;
- Route needs review.

Normal success shows no permanent Saved/Synced/Route-ready badge. Retry sync invokes the existing drain worker. Server fetch failure cannot erase a valid mounted local snapshot.

## Linked Cairns

`Cairns from this Activity` uses `originActivityClientId`, the legacy explicit `sessionId`, or stable IDs already recorded in `session.markerIds`. A spatially close marker with no explicit association is excluded. The section is omitted when empty.

Tapping an associated own Cairn routes to the existing `MarkerDetail` screen using stable Cairn identity; no second Cairn-detail product was added. Existing Quick Cairn and Full Plant provenance writers are reused.

## Save as Route

Save as Route now:

- guards duplicate Detail taps and duplicate Route saves;
- opens the existing Route Editor as the confirmation/draft step;
- copies nested geometry and waypoint structures into the durable local Route outbox;
- never mutates the Activity;
- allows Back/cancel without creating a Route;
- reports save failure without leaving a false success object;
- resets successful new creation to canonical Route Detail;
- for a Gap, offers a recorded segment or an explicit reconnect stored only on the new Route.

The minimum local origin handoff records source Activity client/server identity and whether the new Route explicitly reconnected a Gap. The current backend Route schema validates a source Activity but does not persist/round-trip this origin metadata. Fresh-device provenance therefore remains a Route-specific backend dependency; no migration or deployment was performed.

## Delete

Delete is now a quiet secondary action with a shared destructive confirmation card. The copy states that Cairns, independent Routes, and earned Memory remain. No cascade was introduced.

Deletion first writes the existing durable Activity tombstone and removes local Activity persistence. The UI leaves Detail only after this durable path succeeds. It reports `Delete queued` when the server has not acknowledged the delete; the retained tombstone is retried by the existing sync daemon. `remoteId`, `serverActivityId`, and numeric legacy identity are all supported.

The visual harness opened the confirmation only and never invoked deletion.

## Day / Sunset / Night

Activity Detail reuses shared visual roles, `PrimaryButton`, `ContentSurface`, `ModalCard`, `BackButton`, typography, icons, and spacing. No independent design language or shared token rewrite was introduced.

At 390×844, Day, Sunset, and Night show readable title, labels, values, notices, actions, destructive copy, and linked-Cairn rows. Sunset keeps illuminated controls; Night uses slate/mineral surfaces rather than Day rectangles. Product-family comparison against current Home, Hike, Run, Trails, and Plant is packaged in `visual/images/board-product-family-comparison.jpg`.

The 320×568 Expo Web capture exposes the existing global `WebPhoneFrame`: it always renders a 430×932 logical frame at 0.67 scale, so a 568-pixel browser viewport clips that 624-pixel shell. This is a global web-review harness limitation, not native small-iPhone evidence, and was not changed in this page-bounded task.

## Shared component changes

No shared visual component or token was changed. The page reuses the existing Product-DNA components. Shared data-layer changes are limited to:

- Activity rename/delete result truth in `useSessionStore`;
- independent Route deep copy and local minimal origin metadata in `useRouteStore`;
- canonical post-create Route Detail navigation in `RouteEditorScreen`.

## Tests

- Required `npm run verify:changed`: **PASS, 534/534**.
- Scoped Activity/Route/Cairn/offline regression: **PASS, 55/55**.
- Focused Activity Detail selection earlier in the run: **PASS, 21/21**.
- Full `useSessionStore.test.ts`: **8 passed, 1 unrelated baseline failure**. The stale test expects a 100-item cap (`101` total with one pending item), while current production source intentionally retains 500 and returns all 106 seeded rows. This task did not change the cap or rewrite the unrelated expectation.
- Full repository TypeScript check: existing baseline remains red with 170 diagnostics; **zero diagnostics reference the task-touched Activity Detail/store/helper files**.
- `git diff --check` on task-touched source/tests/scripts: pass.

Machine-readable results and raw logs are in `TEST_RESULTS.json` and `test-output/`.

## Visual evidence

Open `visual/index.html` offline. It contains ten redacted synthetic screenshots and three boards.

Isolation result:

- fresh browser context;
- synthetic account and coordinates;
- all Cairn API reads fixture-intercepted;
- 89 `/api/edit-diag` startup/diagnostic write attempts prevented with local 409 responses;
- zero allowed product writes;
- zero production data reads or mutations;
- zero captured runtime errors.

All images are explicitly `FORCED_TEST_ROUTE`, `SYNTHETIC_FIXTURE`, and `EXPO_WEB_FALLBACK`. They do not prove native Mapbox, normal navigation, deployment, device loading, field behavior, or user acceptance.

## Known release risks explicitly not fixed

- Known production release-contract issues remain open.
- Known friend-Memory authorization issues remain open and were not exercised.
- Route origin does not survive server/fresh-device round-trip.
- Native Mapbox, GPS/CLLocation, O54 lifecycle, O55 simulator, NZ field behavior, and release configuration were not changed.
- The existing global small-viewport Expo Web phone-shell clipping remains.
- The unrelated session-cap test and repository-wide TypeScript baseline remain red.

No backend deployment, migration, OTA publication, production mutation, version change, purchase, export, feedback, account deletion, Memory reset, or friend-location request occurred.

## Device validation still required

The owner review is bounded to the five checks in `OWNER_REVIEW_CARD.md`. Native map rendering/legal ornaments, actual device loading, physical interactions, and explicit page acceptance remain pending.

## Exact changed files

Task-touched product source and tests:

- `app/src/components/OtaBadge.tsx`
- `app/src/features/activity/activityDetailPresentation.ts` (new)
- `app/src/features/activity/activityRouteState.ts`
- `app/src/features/activity/__tests__/activityDetailPresentation.test.ts` (new)
- `app/src/features/activity/__tests__/activityRouteState.test.ts`
- `app/src/features/activity/__tests__/freeActivityIntegrationContracts.test.ts`
- `app/src/features/trails/__tests__/trailsScreenContracts.test.ts`
- `app/src/screens/MapHistoryScreen.tsx`
- `app/src/screens/RouteEditorScreen.tsx`
- `app/src/store/useRouteStore.ts`
- `app/src/store/useSessionStore.ts`
- `app/src/store/__tests__/useRouteStore.offline.test.ts`
- `app/__tests__/useSessionStore.test.ts`

Task-created review/evidence files are all files under:

- `docs/review/activity-detail/20260916T164608+0800/`

Several task-touched product files were already modified in the intentionally dirty worktree. They were edited in place; no reset, cleanup, mass format, unrelated fix, dependency/configuration change, or snapshot update was performed.

## Candidate marker result

The single existing marker advanced from local `O56` to local candidate `O57` only after implementation, focused regressions, the 534/534 required gate, and visual review passed. App version, runtime version, and native build number were not changed. `O57` does not mean published, deployed, device-loaded, field-validated, or user-accepted.

Verdict: implementation candidate complete; physical-device review required before page acceptance.
