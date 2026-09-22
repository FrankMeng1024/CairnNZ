# Cairn overnight convergence

Date: 2026-09-13

Overall verdict: **CONDITIONAL HOLD — implementation and automated evidence converge; native, transition, and real-NZ field gates remain**

No OTA was published, no backend was deployed, no production data was changed, no schema migration was run, and no app/runtime/build version was changed. The Home marker remains `O52`; it was not incremented because this pass ends in HOLD rather than a validated human-testable OTA candidate.

## Authority recovery

All five overnight task files were verified readable and read completely before code changes, in numeric order beginning with `00_MASTER_ORCHESTRATOR.md`. Visual work began only after reading `docs/VISUAL_SYSTEM.md`, `docs/VISUAL_MIGRATION_STATE.md`, the asset manifest, and current QA boards.

`CairnNZ_Project_Authority.md` is not present. Work continued under the requested authority order using current source plus the newest O50/O51/O52 implementation and forensic artifacts. The main recovered authorities were O50 Final, O51 real-field, O52 precision/efficiency, O52 blind-field, SNAP/matcher dry-runs, historical `back`, Hike/Run Product DNA, Activity energy, Plant audit, and current persistence/Mapbox/Detail code.

The worktree contained unrelated/pre-existing modifications before this pass, including backend, operations, simulator, and review files. They were preserved; no reset or cleanup was performed.

## Final V2 / NZ

Detailed authority: [FINAL_V2_NZ_RECONSTRUCTION.md](./activity-real/FINAL_V2_NZ_RECONSTRUCTION.md)

- **O50 gap analysis:** keep its segment-local compositor, conservative network/topology/lateral/seam/endpoint gates, pedestrian semantics and true-Gap boundary. Its weak point was the under-finished canonical fallback on simple corridors.
- **Base Final result:** productionized an offline deterministic extension with accuracy-p65 uncertainty, simple/complex corridor classification, multi-scale structural-turn protection, bounded same-corridor micro-excursion removal and endpoint-preserving simplification. Finish now labels zero accepted network distance as Base rather than a match.
- **Mapbox result:** retained as bounded optional enhancement. The Tongariro prototype made five Matching and three walking Directions calls; candidates were returned, but the gates accepted 0 m of network geometry and safely retained 3,692 m of Base geometry.
- **DOC result:** public AllTracks returned 503 during the experiment. DOC remains a candidate NZ topology prior, not a Finish dependency or production snap authority.
- **LINZ/terrain result:** useful for topology/context/plausibility; inappropriate as metre-level alignment authority. No runtime dependency added.
- **Urban result:** generic straight/crossing fixtures remove harmless wobble and an uncertainty-scale micro-spur while preserving anchors, a larger excursion, crossing and turn structure.
- **NZ mountain result:** deterministic Tongariro/Kepler/forest/valley/sparse fixtures preserve switchbacks and reference length. The complex Tongariro Base intentionally equals frozen O50 visually; it does not flatten real trail structure to demonstrate novelty.
- **Validation class:** **SIMULATION/OFFLINE VALIDATED**. **NOT REAL NZ FIELD VALIDATED**.
- **Productionized:** Base Final, diagnostics, accurate Base/network state, generic regressions, retained O50 gates.
- **Prototype only:** live NZ Mapbox comparison, DOC, LINZ/terrain reasoning and reproducible comparison board.

## Offline Activity / Route UX

Detailed authority: [OFFLINE_ACTIVITY_ROUTE_STATE_UX.md](./activity-offline/OFFLINE_ACTIVITY_ROUTE_STATE_UX.md)

- **Internal state model:** local readiness, server sync, Final enhancement and Route readiness are orthogonal; manual action is derived separately.
- **User-visible states:** Activity saved, Waiting to sync, Sync issue/tap to retry, Route ready, Route needs review, Missing section, Saved locally, Syncing and Retry sync.
- **Offline Finish:** produces local Activity, Detail, metrics and Base Final; lack of server acknowledgement is not called save failure.
- **Online enhancement:** still attempted inside Finish's existing bound. `refining` is modelled, but no post-Finish reconnect worker was shipped.
- **Save as Route:** governed by geometry quality, not connectivity. A continuous Base Final can create a Route offline.
- **Manual review/reconnect:** a Gap offers recorded segments or explicit **Reconnect in Route**. Activity Gap truth is untouched.
- **Route independence:** points and nested collections are deep-copied into a stable local Route; Activity enhancement has no mutation path into it.
- **Sync:** per-user Route cache/outbox, stable local UUID, backend idempotency key, transient source-Activity race handling, retained failures and explicit retry.

## Hike / Run native map UI

Detailed authority: [HIKE_RUN_NATIVE_MAP_UI.md](./activity-ui/HIKE_RUN_NATIVE_MAP_UI.md)

- **Day:** forest Hike/mineral-blue Run with warm cream casing remain clear over roads and land cover.
- **Sunset:** muted route colors and stronger emissive response harmonize with warm shared surfaces.
- **Night:** pale route cores, deep-ink casing and full emissive strength correct the dim real-map failure found in the first capture.
- **Route visibility:** shared two-layer route tokens work over bright/dark roads, forest, parks and water edges without changing geometry.
- **Puck visibility:** shared amber/cream/mineral three-layer puck renders above route and differs from both modes.
- **Map style:** Mapbox Standard remains shared; Activity suppresses POI chatter while preserving place/road/pedestrian context.
- **Attribution/legal:** native ornaments remain enabled and move together above the lower dock; History and Plant adjustment no longer hide them.
- **Actual-map evidence:** six real Mapbox Standard GL JS mobile frames over public Kepler geometry plus an inspected board. Expo Web separately produced 34 complete UI frames at 360×640, 390×844 and 430×932 with all frames in bounds and zero runtime errors.
- **Native boundary:** no iOS simulator/device was available, so RN Mapbox ornament dimensions, native puck behavior and native color rendering remain unvalidated.

## Plant

Detailed authority: [PLANT_PRODUCT_DNA_REDESIGN.md](./plant/PLANT_PRODUCT_DNA_REDESIGN.md)

- **Product model:** Cairn is the durable personal place trace; Plant is the verb. Location is essential, words optional, personal default, offline valid, Activity provenance retained, rediscovery/enrichment first class.
- **Correctness fixes:** removed Plant Memory reveal; pending edits update durable payload; retry acts; synced edit verifies/rolls back; stable local/server identity; fast-ack race fixed; `hut` schema accepted; legal map ornaments enabled.
- **Quick Cairn:** remains one tap from Run using a fresh trusted Activity fix, local durable commit, haptic/toast, and continued movement. Empty content displays later as `Cairn · <date>` rather than Untitled Cairn.
- **Hike Plant:** a fresh trusted Activity fix opens compact optional compose immediately, with an Adjust location escape. It returns to Activity after commit.
- **Offline:** per-user durable outbox, idempotent identity, Saved locally/Retry sync language, local enrichment/delete before sync.
- **Product DNA:** shared tokens, typography, `BackButton`, `Icon`, `MarkForm`, `SyncBadge` and material roles; no separate Plant card system.
- **Visual result:** 390×844 standalone and in-Activity Day/Night board; empty submit, Activity-location copy and hidden moving taxonomy/audience assertions pass.

## Shared system

Reused or extended:

- `SyncBadge` now supplies one theme-aware Saved locally / Syncing / Retry sync language across Cairns and Routes.
- `offlineEntity` supplies durable payload update and explicit retry rather than separate Plant/Route queues with divergent behavior.
- `ContentSurface`, shared icons, typography, spacing, radius and visual themes drive Activity state UI.
- `activityMapPresentation` centralizes six Hike/Run theme presentations instead of local color branches.
- `activityRouteState` centralizes product derivation instead of screen-local status copy.
- O50's compositor and gates were extended rather than replaced.

Duplicated/local patterns removed:

- fixed light sync badge colors;
- separate default Mapbox puck appearances;
- per-render Hike map point remapping that defeated incremental projection;
- Plant-only offline/error wording;
- form-required taxonomy/audience decisions for a personal moving action;
- repeated “Untitled Cairn” fallbacks.

Freeze-page safety:

- Home, Friends and Auth source files were not changed.
- Their canonical artwork, layout and core anchors were not touched.
- `SyncBadge` is not used by Home/Friends/Auth.
- Existing reference captures were used for family comparison.
- No Home OTA marker increment occurred.

## O52 blind-field disposition

| O52 issue | Current disposition |
|---|---|
| lifecycle/source evidence loss (`lost run`, `hike ka`) | **unresolved**; Final continues to expose a true Gap and does not hide loss |
| segment provenance reverts after reacquisition | generic incumbent/explicit-boundary resolver added; late stale IDs ignored and tested |
| Hike incremental projection rebuilding | stable `liveTrackPoints` identity now reaches the shared incremental projector; tests pass |
| QA persistence/upload amplification | current bounded coalescing, stable cursor timestamp and delta upload source verified; not remeasured in real field |
| Memory 401 retry storm | final 401 now pauses outbox radio retries until a confirmed auth refresh; local evidence retained; tests pass |
| QA upload 401 observability cutoff | not redesigned in this pass; remains an observability risk |
| low-battery/process-lifecycle visibility | code telemetry exists; real low-power/process-death evidence still required |

## Safety

Explicit confirmations:

- **Canonical tracking truth is unchanged**, except the separately proven segment-provenance correctness fix that prevents stale callbacks from reverting to an earlier segment ID.
- Foreground/background precision intent remains BestForNavigation + 1 m.
- Hike and Run still share one canonical engine and one Activity location authority.
- Stationary V2 and Accept/Candidate/Reject semantics were not retuned for visuals.
- **Gap truth is preserved.** Each real segment is finalized independently; a missing source section is never sent as traversed geometry.
- **No wrong-road bridge** is accepted across a true Gap or ambiguous/off-network corridor.
- Canonical distance and Memory do not consume Base/Mapbox display geometry.
- Route reconnect is explicit, creates a separate Route object, and never rewrites Activity truth.
- Plant cannot reveal unexplored Memory.
- Frozen Home/Friends/Auth were not unintentionally changed.

## Validation

### Focused client tests

Final convergence lane:

- 16 suites passed
- 183 tests passed
- 0 failed
- includes tracking reducer, provenance, Final V2/NZ, offline entity/Route/Cairn, Memory 401, map presentation, route projection, Product UI contracts and Plant naming

### Activity changed-file gate

`cd app && npm run verify:changed` was run before Activity edits and again after convergence.

Final result:

- 33 suites total: 32 passed, 1 failed
- 389 tests total: 382 passed, 7 failed
- all seven failures are in `app/__tests__/v409-offlineQueue.test.ts`
- root cause: the legacy tests call `readQueueSnapshot` and `clearQueue`, which current `offlineQueue.ts` does not export
- the exact same seven failures were present in the pre-change gate
- Jest also reports its existing `setupFilesAfterFramework` configuration warning and an open-handle warning in this broad lane

This baseline was isolated, not retried to green and not changed outside scope.

### Backend tests

- 17 Node contract tests passed, 0 failed.
- Covers Activity/Memory/Route source contracts, Route create idempotency middleware, Cairn identity/provenance, `hut` create/update and immutable Plant location.

### Static checks

- TypeScript emitted no diagnostics for changed implementation files when filtered from the repository's existing full-project diagnostics.
- Scoped `git diff --check`, trailing-whitespace checks, and Node syntax checks are clean for the overnight implementation/report set.

### Regression/corpus

- Generic fixtures cover straight, crossing, U-turn, repeated traversal, Z/switchback, mapped, unmapped, mixed, timeout/no-token and true Gap.
- Existing private `back`, `snap`, `great hike`, `run issue`, `mstand`, `hike ka`, `lost run`, stationary and Stop-V evidence was used as retained authority without copying private coordinates or adding incident branches.
- NZ deterministic cases cover Tongariro/Kepler structure, heavy-tail forest drift, valley cleanup and sparse/batched observations.

### Visual QA

- Actual Mapbox: six 390×844 Day/Sunset/Night Hike/Run frames.
- Activity chrome: 34 Expo Web frames across three sizes; all in bounds; pause/resume interactions pass; zero runtime errors.
- Offline Activity: four 390×844 Day/Night Base/Gap frames; required copy present; zero runtime errors.
- Plant: four 390×844 standalone/Activity Day/Night frames; product contracts pass; zero runtime errors.
- Final: six-panel canonical/O50/Base/candidate/fused board plus machine-readable scorecard.

### Offline cases

Automated evidence accepts:

- no-token Base Final;
- locally ready Activity independent of server state;
- pending Route/Cairn durability, enrichment, retry and fast acknowledgement;
- true-Gap route review and explicit Route reconnect;
- response-loss/idempotency boundaries.

It does not substitute for a multi-hour process-lifecycle device test.

## Remaining validation

Needs a real iPhone:

- RN Mapbox Standard slots/emissive layers, native puck updates and z-order;
- native logo/attribution dimensions, tap/accessibility behavior and control collisions;
- foreground/background ownership telemetry, WAL recovery, offline Finish and later sync;
- GPS freshness and Hike Plant location adjustment;
- keyboard, haptic, VoiceOver and smallest-device review.

Needs a real low-battery field test:

- BestForNavigation + 1 m physical energy cost;
- background callback batching, low-power behavior, process suspension/relaunch;
- device warmth, screen-on/off attribution, provider overlap and QA upload volume;
- confirmation that Memory 401 no longer wakes the radio repeatedly.

Needs a real NZ mountain tester:

- mapped and unmapped trail, forest, valley, ridge/open top, switchbacks, rough/unformed route, riverbed and no-cell Finish;
- compare Activity Base/online Final to what actually happened;
- verify no trail structure loss or attractive wrong-road snap.

Needs an online/offline transition test:

- offline Activity and Route create, kill/relaunch, reconnect, Activity uploads before/after Route, response loss, retry, and account switch;
- prove Route remains independent if future Activity enhancement is later implemented.

Can be accepted from automated evidence:

- deterministic Base Final behavior and ambiguity fuse;
- canonical/Memory/Gap separation in code;
- independent state derivation and user language;
- local object deep-copy and idempotency-key contract;
- Day/Sunset/Night token contrast on actual Mapbox GL;
- Plant optional-content/personal-trace product flow;
- frozen-page source safety.

## Deployment

| Question | Answer |
|---|---|
| Native rebuild required? | **No** for the implementation: no native dependency/config/app/runtime/build version changed. Native validation is still required. |
| OTA sufficient? | **Technically yes for client JS** after human PASS and the required Home marker increment. This HOLD candidate was not marked or published. |
| Backend deployment required? | **Yes** for complete behavior: Route create idempotency middleware and Plant `hut` schema acceptance are backend changes. Follow `docs/operations/PRODUCTION_BACKEND_DEPLOY.md`. |
| Backend deployed? | **No.** |
| OTA published? | **No.** |
| Production data/schema mutated? | **No.** |

Because backend behavior is part of offline Route retry safety, do not treat a client-only OTA as the complete convergence release.

## Evidence index

- [Final V2 comparison board](../../app/_review/overnight-final-v2/comparison-board.png)
- [Actual Mapbox Activity board](../../app/_review/overnight-map-ui/activity-mapbox-board.png)
- [Offline Activity state board](../../app/_review/overnight-offline-activity/offline-activity-state-board.png)
- [Plant convergence board](../../app/_review/overnight-plant/plant-convergence-board.png)
- [Expo Hike/Run board](../../app/_review/overnight-expo-activity/activity-ui-day-board.png)

These board links intentionally point to ignored local outputs. Their tracked capture scripts make them reproducible; review/deploy authority remains in Markdown/JSON.

## Next human actions

1. Run one native iPhone/simulator visual pass for Day/Sunset/Night route, puck, ornaments, Activity Detail states and Plant; record PASS/HOLD.
2. Deploy the reviewed backend changes through the production backend runbook before testing offline Route retry/idempotency and Hut end to end.
3. Run one kill/relaunch offline-to-online iPhone scenario, then one real low-battery field recording with native telemetry.
4. Give the same candidate to a real NZ mountain tester before any “NZ validated” claim.
5. Only after those gates pass: increment the single Home marker from O52 to O53 and publish the OTA manually.

## Final handoff

The implementation converges on the requested product contracts without pretending simulation is field proof. Base validity is offline, Mapbox is optional, DOC/LINZ remain evidence candidates, Activity and Route stay separate, Cairn creation is durable and personal, and the map belongs to the shared Cairn visual system. The remaining HOLD items are physical/native/product evidence, not hidden geometry correctness work.
