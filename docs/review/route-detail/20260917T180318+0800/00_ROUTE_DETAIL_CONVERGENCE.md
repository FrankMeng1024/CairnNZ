# CARD-ROUTE-01 — Route Detail / Edit / Use convergence

Run: `20260917T180318+0800`  
Local candidate: `O59`  
Verdict: **implementation complete; grouped physical-device review required**

This verdict is limited to the bounded local implementation. No backend deployment, database migration, production mutation, OTA publication, device loading, native Mapbox validation, NZ field validation, or owner acceptance occurred.

## Previous Route Detail

At task start, Trails could open a Route and Activity Detail could create an independent draft, but the slice was not one coherent product journey. Post-create could land in editor view mode; Detail was edit-first; rename/delete failure truth was incomplete; a direct unknown Route had no reliable targeted state; editor `Apply` versus outer save was unclear; the gear was a visible no-op; server-only reload lost Activity provenance; and Hike/Run handoff did not make the reference-only promise and snapshot boundary sufficiently explicit.

The task-start repository was intentionally dirty. The global and scoped snapshots are preserved under `baseline/`; unrelated changes were not reset, cleaned, staged, committed, mass-formatted, or included in this card’s patch.

## Product decisions applied

- Route is independent future intent. Activity remains past truth.
- Own Route Detail is authoritative and use-first.
- The current capability is a planned reference line, not turn-by-turn navigation.
- Activity origin and current geometry state are separate facts.
- Normal success is quiet; only pending, failed, unavailable, legacy-origin, or planned-connection exceptions are surfaced.
- Apply changes an editor draft. Save commits the Route.
- Deleting a Route does not delete Activity, Cairns, or Memory.

## Product flow completed

The candidate now converges these entries on one stable Route object and the same `MapHistory` Route Detail branch:

1. Activity Detail -> Save as Route -> existing Route editor/draft -> Save Route -> canonical Own Route Detail.
2. Home -> Trails -> Routes row -> the same Own Route Detail.
3. Own Route Detail -> Edit -> Apply to draft -> Save Route -> same Detail.
4. Own Route Detail -> Use Route -> Hike or Run -> matching pre-start screen with the selected Route -> explicit Start.
5. Local/cached Route -> Detail remains usable when its server read fails.

New Route save resets the stack to Home + canonical Detail, so Back cannot reopen a completed Activity recording or creation form. Existing-route save returns to its same Detail. Normal capture flow A reopens the same stable identity through Trails.

## Route Detail

- Shows Route name, current-geometry distance, point count, defensible elevation only when present, concise origin/edit context, update date, meaningful geometry preview, primary Use Route, secondary Edit/Delete.
- Removed speculative estimated-time presentation and does not describe geometry as safe, verified, or fully walked.
- Loads a direct server identity when possible while retaining valid local content on read failure.
- Separates loading, not found/deleted/unavailable, retryable fetch failure, cached/local ready, pending sync, and permanent source failure.
- Uses one Hike/Run mode picker rather than multiple equal primary actions.
- Removes visible no-op controls; no Layers/gear substitute was invented.

## Editing and mutation truth

Entering edit copies saved geometry into an independent draft. Brush/correction operations affect that draft. The inner action reads `Apply to draft`; only the outer `Save Route` invokes the durable update/create contract. Back/close with changes presents Stay/Discard, and discard leaves the accepted Route unchanged.

Pending local changes update the durable create payload first. Synced changes wait for remote acknowledgement. Failed save keeps the draft and screen, supplies useful copy, and permits a real retry. Per-action in-flight guards block duplicate create, save, delete, and use transitions.

Rename on Detail follows the same pending-versus-synced boundary. Delete is secondary and uses one confirmation whose copy explicitly preserves Activity, Cairns, and Memory. Stable-client Routes tombstone before local removal; legacy server Routes without stable client identity remain visible when remote delete fails.

## Minimal durable origin

Migration `036_route_origin_identity.sql` adds the bounded server contract:

- owner-scoped `client_route_id` uniqueness;
- `creation_origin`;
- source Activity client identity plus nullable live session link;
- source-Activity geometry hash and Route-at-creation geometry hash;
- monotonic `geometry_edited_since_creation`;
- explicit `origin_gap_reconnected`;
- owner/client tombstones.

Creation locks the owner and source, validates that a supplied source belongs to the owner and is finalized, and distinguishes not-yet-available, not-ready, deleted, and unauthorized sources. Ordinary update cannot rewrite origin. Source Activity deletion sets only the live numeric link to null; the independent Route and historical origin fact remain. Legacy unknown origin remains `Origin not recorded`.

The model round-trip proof executes create -> reload -> edit -> reload -> source deletion and separately proves response-loss convergence, tombstone precedence, owner validation, and finalized-state validation. It uses a disposable in-memory SQL adapter around the actual model; migration rehearsal on local/staging MySQL is still required before deployment.

## Activity independence and Gap handling

- Save as Route deep-copies Activity geometry and nested Route data.
- Activity metrics, canonical movement, Final geometry, Cairns, and Memory are not mutated.
- Multiple recorded segments still require explicit section choice or explicit Route-only reconnect.
- Detail describes reconnect as `Includes a planned connection across a missing Activity section`.
- A saved Activity is not called navigation-ready merely because it exists.
- No Final/Mapbox/GPS algorithm tuning was performed.

## Hike/Run use behavior

Use Route resolves the owned Route, presents a clear Hike/Run choice, opens the matching pre-start page, and shows the correct current reference geometry/summary. Both screens say `This Route is shown on the map for reference.` Recording does not begin until the user presses Start.

At Start, the selected Route reference is deep-copied into Activity-scoped context, so later Route edits cannot silently alter the line used by an active Activity. The established active-Activity guard remains authoritative. No second location provider, dormant `RouteFollower`, voice guidance, off-route logic, or planned-geometry-to-Memory path was activated.

## Trails integration

Trails retains Activities and Routes as the two primary families. Local/pending Routes remain visible, server failure does not erase local content, accepted rename/edit is reflected on the shared object, accepted deletion removes it, and a row reaches canonical Route Detail. This card does not claim full-history pagination/search work outside the existing Trails contract.

## Day / Sunset / Night

Route Detail and the existing editor use current shared Product-DNA type, spacing, surfaces, fields, buttons, icons, sheets, and semantic theme roles. The editor overlay no longer forces bright Day surfaces into Night and Sunset controls remain readable. Current-source candidate evidence covers all three themes plus small/large and long-name/keyboard-focus browser stress.

Evidence is Expo Web with map services blocked. The fallback and surrounding composition are proved; actual Web Mapbox, native RN Mapbox, gestures, ornaments, haptics, keyboard behavior, native small-phone layout, and touch remain device work. Historical old Trails/Plant/Hike references were not used as proof of current visual alignment.

## Shared component changes

- `EditOverlayV274` accepts explicit `Apply to draft` copy and semantic surfaces.
- Canonical icon mapping adds only icons already requested by current editor controls.
- `offlineEntity` carries a bounded error code so Route sync can distinguish retryable from permanent source failure; CARD-CAIRN-01 revision/owner protections remain intact.
- Existing `flattenGeometryToParts` is exported for its focused regression; no geometry algorithm was retuned.

## Regression and tests

- Client focused regression: **17/17 suites, 133/133 tests**.
- Backend Activity/origin/model proof: **18/18 tests** using `node --test`.
- Required `npm run verify:changed`: **550/550 checks**.
- TypeScript: **0 diagnostics in CARD-ROUTE-01 touched app files**. The full project remains non-green with 253 pre-existing/unrelated diagnostic lines; they were not broadened into this task.
- Visual interaction harness: **16 captures, 4 boards, 14 recorded handler steps, 0 runtime errors**.

Two relevant regression fixtures were diagnosed rather than retried: the Final preview mock was brought to the current required `segments` shape, and an existing polyline helper was exported for the existing alternate-route preservation test. The backend `node:test` files were initially invoked with Jest; that runner mismatch is recorded and the authoritative correct-runner result is 18/18.

## Requirements delta

`REQUIREMENTS_DELTA.md` and `.json` update existing IDs `RQ-ROUTE-001` through `006`, `RQ-TRAIL-003`, and `RQ-OFFLINE-001`. `RQ-ROUTE-007` and the wider planner/guidance/version system remain out of scope. Implementation, automated proof, visual proof, deployment, device loading, and owner acceptance are deliberately separate.

## Candidate marker result

The verified task-start marker was `O58`. After local gates passed and no competing `O59` marker existed, the single Home marker advanced once to `O59`. Native app version, runtime version, build number, and dependencies did not change. O59 means local candidate identity only; it is not published, loaded, or accepted.

## Backend/deployment dependencies

The minimal origin round-trip and modern stable-identity delete path require migration 036 and the matching backend to be deployed in an approved environment before a client relies on them. Old-backend creation remains usable through compatibility fallback, but its provenance is explicitly local-only and not claimed to survive server-only reload. CARD-CAIRN-01’s owner-history/create-replay backend changes also remain local/not deployed.

No backend was deployed, no migration was run, no OTA was published, and no production service/data was touched.

## Grouped owner review readiness

This card newly proves, locally and with isolated fixtures, the Activity Route creation handoff, canonical Detail/Trails convergence, existing editor draft/save/failure behavior, server-model minimum origin round-trip, Hike/Run pre-start selection, and reference snapshot boundary.

Earlier cards already prove their own candidate Activity and personal Cairn contracts; they remain device-review pending. The combined checkpoint still needs native-device checks for the Activity -> linked Cairn -> All Cairns -> Save as Route -> Detail/edit -> Trails -> Hike/Run journey, plus the required backend patches. The five-item review card is `GROUPED_OWNER_REVIEW_CARD.md`.

## Known issues explicitly not fixed

- Friend-Memory authorization, Settings release mismatches, RevenueCat/billing, public/encounter/moderation, full Memory redesign, complete Route provenance/versioning, active navigation, iOS background/battery behavior, real-device OTA loading, and NZ field validation.
- Full-project TypeScript baseline diagnostics outside this card.
- Native map/gesture/layout proof and explicit owner acceptance.

## Exact changed files and evidence

- Source inventory: `CHANGED_FILES.md` / `CHANGED_FILES.json`.
- Attributable patch: `TASK_SCOPED.patch`.
- Touched hashes: `TOUCHED_FILE_HASHES.sha256`.
- Test source: `test-source/`.
- Test records: `TEST_RESULTS.json` and `test-output/`.
- Visual board: `visual/index.html`; capture manifest: `visual/capture-results.json`.
- Package manifest/hashes: `PACKAGE_MANIFEST.json` and `MANIFEST.sha256`.

Implementation is complete for this bounded local slice. Grouped physical-device review and separately authorized backend/OTA operations remain required.

