# HIKE / RUN PRODUCT-DNA UI VERDICT

**Verdict:** Hike and Run now read as two priorities of one Cairn Activity instrument. The pass corrects product hierarchy, customer language, icon lineage, and Finish-state composition without changing tracking authority, metric calculations, map behaviour, lifecycle consequences, or any frozen-page design.

## Recovered Cairn DNA

Home, Friends, and Auth belong together because they share more than a palette. They compose a believable New Zealand environment with restrained mineral/forest materials, broad soft light, compact geometry, precise type, quiet space, and a disciplined surface ladder:

`environment/page → record/content surface → elevated card → sheet/modal → active control`

Home is a scenic invitation, Friends is quiet human presence, and Auth is an atmospheric entrance. Auth contributes realism, light, texture, depth, and calm—not a layout for Activity to copy. Cairn's experiential order remains world → discovery → trace → memory → shared presence → precise outdoor instrument. It is not generic fitness SaaS, a social feed, or a collection of page skins.

The derived Activity role is:

> **Cairn Activity is the living field atlas in motion: a calm, precise instrument that keeps place, trace, and the next safe action clear.**

## Hike problems found

- Active Time was the largest live metric. That made Hike feel like a workout timer even though the user is primarily trying to understand where they are, how far the journey has become, and what terrain it contains.
- Generic Mountain iconography diverged from the canonical Cairn Hike pictogram already used by Home.
- “Route truth”, “accepted GPS”, “GPS evidence”, and “route evidence” exposed tracking implementation concepts in normal UX.
- The route row repeated `HIKE` instead of describing the interactive object.
- Finish intent said “Hike Complete” before persistence and carried a large scenic hero, feedback prompt, and Share action. Those elements competed with the safe decision and drifted toward generic fitness celebration.
- The finish sheet and live action dock could coexist visually even though only the finish decision should be active.

## Run problems found

- Pace was already correctly primary and the map remained meaningful; Run did not need a structural redesign.
- Generic Footprints iconography diverged from the canonical Cairn Run pictogram.
- The shared recording hint and location-loss notice leaked the same internal GPS vocabulary as Hike.
- The local save surface presented itself as a naming task rather than a clear Finish intent.
- Required Finish-state screenshots exposed an actual layering issue: the live action dock could remain visibly active beneath the Run sheet and collide with its input/CTA during transition.

## Shared Activity system

Both modes continue to share:

- `HikingMap` as the one map/trace shell, including the existing Activity variant;
- `ActivityTopChrome` for Back, mode identity, phase, GPS health, notices, and ranked metrics;
- `ActivityStartDock` for route/readiness/start;
- `ActivityControlDock` for Pause/Resume, Cairn action, and Finish hierarchy;
- `ActivityRecenterButton` for conditional follow recovery;
- `useVisualTheme`, semantic surfaces, shared spacing/type/radius/shadow tokens;
- permission, too-short, unfinished-recovery, completion controller, and Activity Detail contracts.

Ready → Recording → Paused → Resumed → Finish intent → Processing → Detail remains the same lifecycle. Finish stays neutral until the user explicitly confirms it; Resume remains primary when paused; map controls are suppressed while a finish surface owns interaction.

## Intentional differences

- **Hike:** Distance is now the primary live metric. Active Time and Elevation support the journey; the map/trace remains the dominant environment; Plant remains the fuller exploration action; the finish intent retains a compact trace preview and journey summary.
- **Run:** Live Pace remains primary, followed by Distance and Active Time. The blue accent remains a narrow existing mode identifier; follow-first movement and Quick Cairn remain operational priorities; the finish intent remains a compact naming surface.

The modes do not use different skins, radii, material systems, or sheet semantics.

## Product-family consistency

The corrected screens carry Home/Friends/Auth continuity through natural restraint, compact geometry, production Cairn pictograms, fine borders, quiet map space, and state-led controls. They remain appropriately denser because Activity is an operational role.

Product-family review answers:

1. **Logo-free continuity:** yes; the material ladder, geometry, pictogram weight, palette, and quiet composition remain recognisably Cairn.
2. **Hike as outdoor instrument:** yes; distance/trace/place now outrank timer semantics.
3. **Run as performance-priority variant:** yes; pace is immediately readable without rings, zones, badges, or dashboard theatrics.
4. **Shared roles:** yes; top chrome, docks, map shell, health notices, controls, and lifecycle are visibly one system.
5. **Intentional differences:** yes; hierarchy and action purpose differ, not skin.
6. **Generic fitness residue:** the pre-save Hike celebration was removed; no new fitness patterns were added.
7. **Generic Mapbox residue:** the map remains a geographic instrument, while branded pictograms and Cairn materials own the chrome. Native map cartography still requires field review.
8. **Overdesign:** the Hike finish hero/feedback/share cluster was removed.
9. **Glanceability:** short-device and long-value captures preserve primary numbers, subordinate units, and action targets.
10. **Cairn calm:** yes; status colour is semantic and transient, Finish is not persistently red, and normal tracking uncertainty stays quiet.

## Component-system changes

### Existing shared components reused

- `HikingMap`
- `ActivityTopChrome`
- `ActivityStartDock`
- `ActivityControlDock`
- `ActivityRecenterButton`
- `CairnIcon`
- `PermissionDeniedModal`
- `TooShortSheet`
- `UnfinishedRecoveryModal`
- `useVisualTheme` and existing Activity/theme tokens

### Existing shared components extended

- `ActivityRecordingChrome`: uses canonical `CairnIcon` Hike/Run/Leave-a-Cairn symbols, a semantic `ROUTE` label, and user-facing path language.
- `StopSummarySheet`: retains its existing persistence contract and trace summary, but now represents Finish intent rather than a completed celebration.
- `hike-run-ui-qa.mjs`: adds deterministic long-value, degraded-location, and both Finish-intent captures.
- `activityRecordingUiContracts.test.ts`: locks metric priority, Cairn pictograms, calm health language, and finish-layer ownership.

### Local Hike components removed or replaced

- No complete Hike component was replaced.
- Removed the local completion hero, feedback prompt, and share affordance from `StopSummarySheet`.
- Replaced generic mode/Plant glyph usage with the shared canonical Cairn icon family.
- Suppressed the live dock and recenter control while Hike Finish intent is open.

### Local Run components removed or replaced

- No complete Run component was replaced.
- The existing compact local name sheet remains, but its title/label/CTA now follow the shared Finish-intent contract.
- Replaced generic mode/Cairn glyph usage with the shared canonical Cairn icon family.
- Suppressed the live dock and recenter control while Run Finish intent is open.

### Remaining intentionally mode-specific components

- Hike's finish content includes journey stats and a trace preview; Run's is a deliberately faster compact naming surface.
- Hike exposes Plant; Run exposes Quick Cairn.
- Hike owns distance/elevation hierarchy; Run owns pace/follow hierarchy.
- Existing Hike forest and Run blue semantic accents remain controlled mode identifiers.

## Visual changes

### P0 completed

- Hike primary metric changed from Active Time to Distance.
- Removed normal-user tracking-engine vocabulary.
- Corrected the premature “Complete” state to explicit Finish intent.
- Ensured finish surfaces exclusively own interaction while open.

### P1 completed

- Adopted canonical Cairn Hike/Run/Leave-a-Cairn pictograms in shared Activity chrome.
- Changed duplicated mode eyebrow to `ROUTE`.
- Simplified Hike's finish composition and aligned Run finish language.
- Expanded the reproducible visual state matrix.

### P2 intentionally deferred

- A later pass may extract a shared route-picker sheet frame and a shared finish-sheet frame if that can be done without flattening mode-specific content.
- Activity's local 24px dock radius remains unchanged pending broader token evidence.
- Native field review remains required for Mapbox labels/trails, route casing, puck, recenter, sunlight, and physical touch reachability.
- Dynamic Type is not meaningfully certifiable through Expo Web; the focused web pass instead verifies short/large devices and long values.

## Before / After

- Audit authority: `docs/review/activity-ui/HIKE_RUN_PRODUCT_DNA_AUDIT.md`
- Review board: `docs/review/activity-ui/HIKE_RUN_PRODUCT_DNA_BEFORE_AFTER.html`
- Baseline results: `docs/review/activity-ui/before/results.json`
- Final results: `docs/review/activity-ui/after/results.json`
- Ignored reproducible captures: `docs/review/activity-ui/before/` and `docs/review/activity-ui/after/`
- Rendered product-family board: `docs/review/activity-ui/after/product-family-review-board.png`

The baseline contains 25 mobile layout captures with zero runtime errors. The final matrix contains 34 layout-checked captures plus two Finish-intent captures (36 screenshots total), across Day/Sunset/Night, 360×640, 390×844, 430×932, fresh, recording, long-value, paused, sustained location issue, and Finish intent. Pause/Resume interactions passed twice for each mode and final runtime errors were empty. Reduced Motion was enabled in the browser context.

## Verification

- Focused Activity UI contract: **PASS** — 1 suite, 10 tests.
- Expo Web production export: **PASS** — 3,822 modules bundled.
- HTML evidence board: **PASS** — nine images loaded, zero broken references.
- Touched-file TypeScript diagnostic filter: **PASS** — no diagnostics in the changed Activity/OtaBadge files.
- `git diff --check` on task files: **PASS**.
- Required `npm run verify:changed`: **inherited CORE-lane failure** — the router selected CORE because unrelated backend files were already modified in the worktree. 32/33 suites and 368/375 tests passed; all seven failures are the pre-existing `__tests__/v409-offlineQueue.test.ts` helper mismatch (`readQueueSnapshot`/`clearQueue` are not functions). The same failure was present before this implementation. It was diagnosed, not retried or changed. Jest also reports the existing unknown `setupFilesAfterFramework` option.

## Freeze safety

Home, Friends, and Auth source, assets, layouts, tokens, and components were not changed. The only cross-surface visual delta is the required operational OTA marker increment from O50 to O51 wherever `OtaBadge` is displayed. Fresh baseline Home/Friends/Auth references are placed beside Activity in the review board; no shared freeze-page primitive was edited.

## Tracking safety

Zero tracking or business-logic change. This pass does not modify GPS authority, Stationary V2, O50 Final route reconstruction, matcher, Memory, metric calculations, background provider, sync, recovery, map authority, pause/resume consequences, or persistence/navigation handlers. Presentation only consumes existing state. No backend change, deployment, push, client OTA publication, app/runtime/build version change, or native release action was performed.

The one existing OTA marker was incremented exactly once: **O50 → O51**. The human may publish the validated client OTA candidate manually after visual review.

HIKE / RUN READY FOR PRODUCT-DNA VISUAL REVIEW
