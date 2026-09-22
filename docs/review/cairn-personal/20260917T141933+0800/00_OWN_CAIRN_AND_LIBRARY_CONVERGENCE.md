# OWN CAIRN DETAIL / ALL CAIRNS CONVERGENCE

Run ID: `20260917T141933+0800`  
Card: `CARD-CAIRN-01`  
Source branch: `master`  
Source HEAD at start: `12fa1cd0ef599e53a81cd30537ce761c5e2150ce`  
Candidate marker: `O58` (local candidate identity only)  
Verdict: **implementation complete; physical-device review and backend deployment remain separate**

## Executive result

The personal retrieval journey is now coherent in the local candidate:

`Plant / Quick Cairn -> durable owner-scoped Cairn -> Memory -> All Cairns -> one Own Cairn Detail -> truthful edit/delete`

Explicit Activity-linked own Cairns also open that same Detail and retain the same stable client identity when a server ID arrives. The list merges durable local, downloaded owner history, and paginated server history without accepting friend/public rows, tombstoned rows, duplicate acknowledgements, or late responses from a previous account.

The additive owner-history API is implemented and tested locally but has not been deployed. Against an older backend, the client degrades to an explicitly partial local/downloaded library; it does not claim complete history or a global no-result.

No OTA, backend deployment, production migration, external service mutation, or production data mutation occurred.

## Previous Own Cairn Detail

The existing page could render a marker and used pieces of the shared visual system, but it did not close the complete personal contract. Pending and synced edit outcomes were not sufficiently separated, empty Quick Cairns could expose weak storage-oriented naming, deletion/navigation boundaries were incomplete, and there was no normal direct personal library independent of map loading or permission.

The implementation keeps the existing page and creation authorities. It does not create separate editors for Activity, map, or list entry.

## Product decisions applied

- A Cairn is a durable, place-bound personal trace; its original location, creator, creation time, and Activity origin are immutable in this slice.
- An empty Quick Cairn is valid. Its readable fallback is date-based; it is not labeled `Untitled Cairn` or treated as an unfinished task.
- Only the supported name and note fields are editable. Legacy body-only records and the shared encoded title/body format round-trip without resetting type or visibility.
- Normal product copy says Cairn. Legacy internal `marker` identifiers remain where renaming would add risk without user value.
- Memory remains spatial rediscovery. All Cairns is direct personal management and is reached normally from the Memory shell outside map/loading/permission branches.
- Delete is secondary and non-cascading. It does not delete the source Activity, independent Routes, or ordinary accumulated personal Memory.

## Personal retrieval journey

The normal entry is `Home -> Memory -> All Cairns`. The control remains present while the Memory map is unavailable, loading, or lacks location permission. All Cairns opens a recent-first, owner-only list with one search field, bounded pagination, compact rows, and direct row navigation to the existing Own Cairn Detail.

The isolated browser run additionally exercised:

`forced synthetic Activity start -> actual linked Cairn row -> Detail -> actual pending edit save -> same Activity -> Home -> Memory -> All Cairns -> edited same stable Cairn -> same Detail`

The forced starting route is disclosed in `visual/capture-results.json`; the subsequent navigation and mutation steps use actual handlers. This does not prove native interaction or whole Activity Detail acceptance.

## Own Cairn Detail

- Uses one owner-scoped identity lookup across client ID, local ID, and server ID aliases.
- Presents title/date and optional known Activity context before the note and actions.
- Uses a compact location panel that is not a prerequisite for reading, editing, or returning.
- Does not start a new high-accuracy location watcher and does not show a live puck as stored Cairn truth.
- Omits dead Activity navigation when explicit provenance cannot resolve.
- Offers `Add a note` for a valid empty Quick Cairn.
- Uses the shared edit sheet and destructive confirmation, with duplicate-action guards and retained failure drafts.
- Returns through the navigation context supplied by Activity, All Cairns, Memory, or standalone Plant rather than reopening a completed Plant/recording state.

## All Cairns entry and history coverage

All Cairns is reached through the normal Memory screen, not Settings, debug UI, a long press, a map pan, or a restored Trails tab.

The new authenticated endpoint searches the complete current owner's valid Cairn history before stable cursor pagination. It is owner-scoped from authenticated request state and never accepts a caller-supplied owner. It requires backend deployment before that global history/search behavior exists outside the local candidate.

The client remains compatible with an old backend: a missing endpoint produces a truthful partial/local state using durable local Cairns and previously downloaded/cached owner records. Network errors do not erase local content, and search-empty wording distinguishes complete server scope from incomplete available scope. The screen never relabels a map-region query as “All.”

See `RETRIEVAL_COVERAGE.md` for the exact matrix.

## Editing and deletion

For a still-local/pending create, save first updates the durable pending payload and then the visible projection. It survives relaunch. A revision guard prevents an older in-flight create acknowledgement from replacing newer accepted content.

For a synced Cairn, Detail waits for the supported authenticated update result before accepting the new projection. A failure preserves prior truth, retains the user's draft, and offers a real retry. One operation may be in flight per action/object.

Modern stable-identity deletion writes a durable local tombstone, cancels a pending create where applicable, removes the projection, and attempts remote reconciliation. A late create/update acknowledgement cannot resurrect it. A legacy server-only Cairn remains present if remote deletion cannot commit. Confirmation explicitly states that Activity, Routes, and ordinary Memory do not cascade-delete.

See `MUTATION_STATE_TABLE.md` for the state-by-state contract.

## Local/server identity and offline boundaries

`cairnIdentityKeys`, stable owner-scoped matching, and `mergeOwnedCairns` establish one projection for Quick/Plant/Activity/map/list entries. Server acknowledgement adds an alias rather than replacing the stable local identity. Fast acknowledgement is deduplicated, and account/request identity is checked before applying late responses.

Offline availability includes durable pending/failed creations plus owner pages already downloaded into the persisted marker projection. It does not include remote history never downloaded to the device. The UI explains incomplete remote scope only when relevant and never treats a valid local Cairn as failed merely because it is unsynced.

## Activity Detail integration

CARD-AD-01's explicit Activity provenance remains the only association authority; no route proximity inference was added. A linked own Cairn opens the authoritative Own Cairn Detail and Back returns to the same Activity. The accepted edit then appears through the same marker projection in All Cairns.

The original CARD-AD-01 reports and images were preserved. `EVIDENCE_PROVENANCE_ADDENDUM.md` corrects the earlier board's historical/current labels without modifying Activity Detail. Activity Save as Route, Activity deletion, and Activity sync retry remain unproved by that earlier visual set and are not reclassified as passed here.

## Day / Sunset / Night

All Cairns and Own Cairn Detail use the accepted Cairn type, compact surfaces, fields, buttons, icons, sheets, and semantic theme roles. Sunset keeps illuminated controls; Night uses slate/mineral surfaces rather than bright Day rectangles. The Web map-availability check was narrowed so an invalid or absent public Mapbox token produces an honest unavailable panel rather than a blank canvas claimed as map evidence.

Captured evidence includes All Cairns and Detail in Day/Sunset/Night; empty and enriched Detail; edit, failed save, delete confirmation, pending/failed rows, true empty, search empty, map unavailable, and the normal Memory entry. It also includes 375x667 and 430x932 Web viewports for stress observation.

These are Expo Web React Native DOM captures. The 390x844 phone shell is clipped/scaled Web evidence, not native small-iPhone validation. Actual Web Mapbox, native RN Mapbox, native touch/keyboard/accessibility/haptics, and physical-device layout remain unverified.

Open the offline board at `visual/index.html`. The capture manifest is `visual/capture-results.json`.

## Shared component and dependency changes

- Shared note encoding now writes an explicit title/body separator and reads separatorless legacy content as body-only; multiline and Unicode content are preserved.
- Offline committed entities carry a revision so stale acknowledgements cannot overwrite newer durable payloads.
- The marker store owns identity merge, tombstone filtering, paginated library state, pending/synced mutation truth, and owner-switch response guards.
- The existing Web Mapbox adapter now reports availability only for a plausible public token.
- Navigation adds only `AllCairns`; Memory receives one shell-level entry. No global theme, Memory map, Trails, or Plant redesign was performed.
- The backend dependency is one additive authenticated owner-history endpoint plus idempotent create replay convergence. There is no schema migration.

## Tests

All scoped implementation and regression gates passed:

- App focused regression: **19 suites, 106 tests passed**.
- Backend focused regression: **20 tests passed**.
- Required Activity changed-file gate: `npm run verify:changed` **PASS, 542/542**.
- Scoped whitespace check: clean.
- Full TypeScript check: baseline remains non-green (`257` diagnostic lines), with **0 diagnostics in files touched by CARD-CAIRN-01**. This is recorded as an unrelated baseline limitation, not converted into a pass.

The Jest run also reports the repository's existing unknown `setupFilesAfterFramework` warning and a force-exit/open-handle warning. No retry-to-green was used.

Exact commands and raw output are recorded in `TEST_RESULTS.json` and `test-output/`.

## Safety and fixture boundary

Before runtime capture, the app used `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:9`, an intentionally unusable Web map token, a fresh browser context, synthetic identity, and synthetic coordinates. Browser interception fulfilled fixture reads and blocked every API write from escaping the harness. The run recorded `123` intercepted write attempts, `0` allowed product writes, no production reads, no production mutations, and telemetry disabled.

The high write-attempt count includes automatic diagnostic/startup writers and is precisely why interception remained active. No delete confirmation was executed against a real object. No friend-location, account deletion, purchase, feedback, export, migration, OTA, or deployment action ran.

## Requirements delta

The scoped delta reuses `RQ-CAIRN-001` through `RQ-CAIRN-008` and the existing capability IDs. It marks candidate implementation, automated proof, visual evidence, deployment, device loading, and owner acceptance independently. `RQ-CAIRN-007` and `RQ-CAIRN-008` remain out of scope/not implemented.

See `REQUIREMENTS_DELTA.md` and `REQUIREMENTS_DELTA.json`.

## Candidate marker

After local implementation gates passed and the repository still identified CARD-AD-01 as `O57`, the single Home client candidate marker was incremented exactly once to `O58`. This is local candidate identity only. Native app version, runtime version, build number, and dependencies were not changed. No OTA was published.

## Known release risks explicitly not fixed

- Previously documented production release-contract and friend-Memory authorization issues remain open and separate.
- The new owner-history endpoint and create-replay convergence require a future authorized backend deployment.
- Public/Friends/Encounter, non-owner Detail, Route provenance/planning/navigation, generalized offline mutation, Memory/Fog redesign, and Activity action evidence outside this slice remain open or out of scope.
- No New Zealand field evidence was attempted.

## Backend/deployment dependencies

Local backend code and isolated authorization/query tests are complete. Deployment is required for complete remote owner-history search/pagination and server-side convergence of a newer pending edit during idempotent create replay. The client is old-backend compatible and truthfully exposes partial coverage until then.

No migration, production configuration, backend deployment, or production data change was performed.

## Device validation still required

- Normal native Memory/Activity/list navigation and Back behavior.
- Native RN Mapbox rendering, attribution/logo placement, map-unavailable behavior, and no live-location ownership change.
- Small-iPhone readability, safe areas, long text, real keyboard avoidance, touch targets, accessibility, and haptics in all three themes.
- Offline relaunch/reconnect identity convergence and post-deployment older-history search using only disposable data.
- Safe delete/non-resurrection and non-cascade behavior in a disposable account.

The bounded checklist is `OWNER_REVIEW_CARD.md`.

## Exact changed files

The task-scoped inventory, including files that were already dirty and were edited in place, is recorded in `CHANGED_FILES.md` and `CHANGED_FILES.json`. Unrelated dirty work was neither cleaned nor reset.

## Evidence inventory

- Offline board: `visual/index.html`
- Machine capture log: `visual/capture-results.json`
- Current-reference correction: `visual/images/board-current-reference-correction.jpg`
- Core Day/Sunset/Night board: `visual/images/board-personal-core.jpg`
- States/actions board: `visual/images/board-states-and-actions.jpg`
- Raw test output: `test-output/`

## Acceptance boundary

The local implementation candidate and its automated/Expo Web evidence are complete. Backend deployment, device loading, physical-device behavior, native map rendering, and explicit owner acceptance are still pending. No whole-page or release acceptance is claimed.

