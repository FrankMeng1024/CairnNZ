# CairnNZ Trails personal journey library redesign

**Date:** 2026-09-13  
**Authority:** `docs/review/trails/TRAILS_PRODUCT_UX_AUDIT.md`  
**Status:** Implemented and ready for Product-DNA visual review. No deployment was performed.

## Product definition

**Trails is Cairn's personal journey library: the place to rediscover what the user has done and find a Route they may want to use again.**

The implemented lifecycle is:

```text
Activity — what I did
    ↓ Save as Route
Route — what I may want to repeat
```

Trails no longer presents implementation categories as equal product pillars. It is not a social feed, Cairn database browser, file manager, or sync dashboard.

## Information architecture

The main screen now contains exactly two first-class families:

1. **Activities** — recent-first personal movement history.
2. **Routes** — recent-first reusable personal intent.

A shared `SegmentedControl` switches between the two. The former `Mine / Friends` tier and equal Cairns tab are absent. This removes a second navigation axis and keeps one stable personal ownership model.

The library uses one compact record family rather than independent card systems. Activity semantics emphasize mode and time; Route semantics emphasize name and use. Normal tap opens the real Detail destination directly.

## Activities

### Hierarchy

Each Activity record prioritizes the recognition data that earned its place in the audit:

- user name, falling back to Hike or Run;
- explicit Hike/Run identity;
- relative/local date;
- distance and duration;
- elevation only when non-zero.

There is no map instance, persistent success badge, local badge, processing badge, quality chip, action menu, or nested card per row. Full geometry, gap truth, route readiness, Cairns, rename, and delete stay in Activity Detail.

### History retrieval

- Activities are recent-first and grouped by month.
- Search matches user names and Hike/Run language.
- The compact `All / Hikes / Runs` filter and search appear progressively at eight Activities, avoiding controls for a three-item archive.
- Search/filter no-results is distinct from true empty and provides one clear reset.
- First-ever empty state directly offers Start a Hike and Start a Run.

### Exceptions

Pending, syncing, and locally saved Activities look like ordinary records. Only `sync_error` produces library chrome, using the shared failed `SyncBadge` and retry action. The retry is a sibling action rather than a nested button inside the row's Detail target.

Route-ready is treated as normal and remains silent. Review-needed/missing-section truth remains in Activity Detail, where it affects the Save as Route decision; it is not broadcast across the archive.

### Scaling

- `SectionList` provides mobile virtualization with bounded initial/batch/window sizes.
- Activity summaries remain lightweight; geometry is still loaded by Detail rather than every row.
- Local summary retention increased from 100 to 500 while retaining pending records ahead of the cap.
- Runtime QA seeded 300 Activities: only 55 record rows were mounted in the tested viewport, confirming a bounded tree.
- The existing backend list returns summary rows in recent order and omits route geometry. Pagination remains a future infrastructure concern beyond the validated 300-record target.

## Routes

### Hierarchy

Routes share the Activity record geometry but use a Route pictogram, Route name, mode-aware “Hike route / Run route,” distance/elevation, and a quiet “Use” cue. This makes future intent legible without unrelated color coding or badge volume.

### Search

Name search is always present for a non-empty Route library. Search no-results identifies the query state and offers reset. No advanced sorting menu or multi-chip filter bar was added.

### Reuse / use flow

The strongest currently truthful journey is now wired:

```text
Trails → Routes → Route Detail → Use for a Hike / Use for a Run
       → matching pre-start Activity with the Route selected
```

Route Detail leads with this primary action. Edit and Delete remain secondary maintenance controls. A Route with no mode asks the user to choose Hike or Run. If required geometry cannot be hydrated, the screen reports that the Route is unavailable instead of claiming a working action.

The Hike and Run pre-start screens receive the stable Route identity, hydrate missing detail geometry, and show the Route as quiet dashed reference geometry when Mapbox is available. The copy deliberately says **“Route selected · shown on the map for guidance”**. This is map guidance, not turn-by-turn navigation, and the UI does not claim otherwise.

### Independence

The existing deep-copy contract remains intact: a Route owns its geometry and does not rewrite or follow later Activity enhancement. Route list refresh now preserves already hydrated local detail geometry. Detail hydration uses the remote ID when available while retaining the stable local ID used by offline-created Routes.

## Cairns

Cairns are removed from the primary Trails hierarchy. No substitute Cairn management library or secondary shortcut was invented.

Rediscovery remains owned by:

- Memory/map for spatial return;
- Activity association for journey context;
- Cairn Detail for one durable place trace.

No Cairn data, store, backend behavior, Plant flow, Memory flow, or valid Detail navigation was deleted. Internal `Marker`/`Flag` compatibility types remain where required, but none leak into normal Trails UI.

## Removed

The current personal Trails surface no longer contains:

- `Mine / Friends` scope navigation;
- friend Routes or friend Cairns;
- an equal Cairns/Flags primary tab;
- audience, Cairn-type, distance-sort, duration-sort, and refresh chrome;
- long-press Activity/Route sheets whose only useful action duplicated row tap;
- user-facing Mark, Marker, or Flag language;
- persistent pending/local/synced status on library records;
- live map previews or heavyweight card trees per record.

The dormant parameterless `MapHistory` index is runtime-deprecated: a parameterless entry redirects to `Routes`/Activities. Object-specific `MapHistory` continues to serve Activity Detail, Route Detail, and the existing QA clone. This removes the second active history architecture without risking a destructive rewrite of the intertwined Detail implementation.

## Offline / sync

Local-first objects remain real objects:

| State | Library treatment | Behavior |
| --- | --- | --- |
| Local/pending Activity | Normal Activity record | Opens Activity Detail; no alarming badge. |
| Local/pending Route | Normal Route record | Opens and can be used like a Route while its local geometry exists. |
| Synced | No status chrome | Normal object. |
| Failed sync | Shared `Retry sync` badge | Retry is directly actionable and does not replace Detail navigation. |
| Server Route fetch fails with local Routes | Local Routes remain visible plus quiet notice | Retry checks the server; device Routes remain usable. |
| Server Route fetch fails with no local Route | Unavailable state, not false empty | Try again is offered. |
| Initial Route load | Loading state | Store begins in loading, preventing a false-empty flash. |

The Route store continues to merge its cache and offline outbox before server truth. Activity hydration's established network-failure path continues to preserve local state. No new Trails-specific sync vocabulary was introduced.

## Product DNA

Trails now uses the current shared Cairn system rather than its former local UI system:

- semantic Day/Sunset/Night roles through `useVisualTheme`;
- the shared `SegmentedControl`, `PrimaryButton`, `SyncBadge`, `BackButton`, `Icon`, and Hike/Run pictograms;
- standard spacing, typography, radius, input, record, border, and action roles;
- page → record → elevated/detail → active-control hierarchy;
- compact border-separated records instead of giant rounded cards or card-within-card composition.

Family comparison against current Home, Friends, and Hike confirms that the typography, forest accent, mineral surfaces, controls, and quiet spacing belong to the same product. Trails is intentionally denser than Home because it is a retrieval surface, but it does not become a dashboard or fitness feed.

### Product-family check

1. Without the title, shared controls, type, icons, forest accent, and mineral surfaces still identify Cairn.
2. It is visibly related to Home, Friends, Hike/Run, Auth, and Plant while retaining library density.
3. Date grouping plus past/future language makes the personal journey-library role clear.
4. Activity and Route are immediately distinguished by time/mode versus reuse/name semantics.
5. Only a failed sync appears as engineering-adjacent state, translated into the user action “Retry sync.”
6. Offline objects are normal records.
7. Route reuse is visible in the row cue and primary in Detail.
8. Former two-tier tabs, redundant sheets, sorts, and Cairn filter chrome are gone.
9. Night uses the cool slate/mineral system rather than black or Day rectangles.
10. The 300-Activity runtime fixture remains bounded and readable.

## Day / Sunset / Night

- **Day:** warm mineral page, quiet translucent records, restrained forest actions.
- **Sunset:** an existing-token light-to-mineral environmental gradient restores illumination and depth; it does not apply a brown overlay or introduce Trails-only colors.
- **Night:** cool slate background and records, bright but controlled text, semantic borders, and a muted green action accent. No hard-coded light row survives.

The same record and control geometry is retained in all three states.

## Shared components

| UI role | Implementation |
| --- | --- |
| Primary family switch | Reused shared `SegmentedControl`. |
| Primary/empty actions | Reused shared `PrimaryButton`. |
| Failed recovery | Reused shared `SyncBadge`; no Trails terminology fork. |
| Navigation | Reused shared `BackButton`. |
| Object identity | Reused canonical `Icon`, `HikingIcon`, and `RunningIcon`. |
| Theme/material/type/spacing | Reused `useVisualTheme` and token roles. |
| Activity projection/grouping | Small pure Trails domain module, not a visual system. |
| Records | One domain-specific compact record family; no premature global abstraction. |

The old Trails-local tabs, filter bars, item sheets, Cairn cards, illustrations, and per-tab surface variants are no longer mounted by Trails.

## Visual evidence

Current-state audit evidence is retained locally at:

- `app/_review/overnight-trails-product-audit/trails-current-state-board.jpg`

The reproducible post-implementation capture script is:

- `app/scripts/capture-trails-personal-library-qa.mjs`

Post-implementation boards:

- `app/_review/trails-personal-library/trails-before-after-board.jpg`
- `app/_review/trails-personal-library/trails-after-themes-and-states.jpg`
- `app/_review/trails-personal-library/trails-after-scale-search-and-use.jpg`
- `app/_review/trails-personal-library/trails-product-family.jpg`
- `app/_review/trails-personal-library/results.json`

The 22 runtime captures cover empty/few/300 Activities, 50 Routes, local/pending and failed records, local Routes during server failure, Activity/Route search, search no-results, Route use, Day/Sunset/Night, and 360×640 / 390×844 / 430×932. The family board includes current Home, Friends, Hike, Trails, and the Route-selected Hike state. Generated screenshots and boards remain ignored local QA artifacts, consistent with repository policy.

Runtime result: no page errors, no console errors, no visible legacy Trails language, bounded 300-Activity rendering, and successful Route Detail → Hike navigation.

## Tests

Added or extended focused coverage includes:

- Activity/Route classification and sorting;
- month grouping, Activity search, Hike/Run filtering, and 300-item projection;
- two-family personal-only IA;
- absence of friend/Cairn/legacy layers;
- direct Detail navigation and absence of long-press View sheets;
- loading versus false-empty behavior;
- exception-only sync presentation;
- local Route survival during server failure;
- stable local Route identity through remote detail hydration;
- truthful Hike/Run Route-use flow;
- parameterless legacy index redirect;
- semantic theme usage and bounded list configuration.

Results:

- Focused Trails + Activity/offline regression: **6 suites, 74 tests passed**.
- Post-QA Trails/store rerun: **3 suites, 19 tests passed**.
- Changed implementation files: **no filtered TypeScript errors**. The full repository typecheck retains unrelated existing generated/test/legacy errors.
- Expo Web runtime QA: **22 captures, zero runtime errors**.
- Production Expo Web export: **passed**.
- `npm run verify:changed`: **32 suites / 382 tests passed; 1 stale suite / 7 tests failed**. The sole failure is the pre-existing `__tests__/v409-offlineQueue.test.ts`, which imports removed `readQueueSnapshot` and `clearQueue` exports. It was reproduced before and after this work and was not retried or changed for a cosmetic green result. Jest also reports the existing `setupFilesAfterFramework` configuration warning.

## Safety

- GPS, one-metre precision, location ownership, Stationary V2, canonical geometry, O50/V2 Final, distance truth, Memory truth, and Gap semantics were not modified by this Trails pass.
- Hike/Run changes only accept a selected Route and pass its copied geometry to the existing map presentation. They do not change tracking capture, persistence, or Final.
- Route geometry remains independent from its source Activity; no Activity truth is rewritten.
- Local Activities and Routes remain visible and keep stable local identity through sync/detail hydration.
- No backend schema or deployment was performed.
- Frozen Home, Friends, and Auth source was not modified. They were only rendered as visual-family references.
- Plant/Cairn and Memory behavior was not modified.
- Existing unrelated working-tree changes were preserved.
- The validated client candidate increments the sole OTA marker once, from O52 to O53. App/runtime/build versions were not changed, and no OTA was published.

## Remaining product decisions

These are deliberately outside this implementation and do not block the accepted personal-library structure:

1. **Completed Route-use semantics:** decide what event counts as “used” before incrementing `runCount` or retaining a completed Activity ↔ Route-use relationship. Merely opening Hike/Run should not count.
2. **Activity-derived provenance:** product evidence favors “made from this Activity,” but the current Route read model does not retain source provenance. Persist it only with a deliberate schema/privacy contract; never couple Route geometry back to Activity enhancement.
3. **Secondary Cairn management:** keep Cairns absent until real retrieval demand shows that Memory, Activity association, and Cairn Detail are insufficient. If needed later, define a secondary access point rather than restoring equal three-tab hierarchy.
4. **Pagination beyond the validated range:** 300 Activities is now usable and bounded. Introduce cursor pagination only when account scale or payload telemetry justifies backend/client complexity.

No unresolved decision supports restoring friend content, the Cairn primary tab, redundant View sheets, or legacy terminology to personal Trails.
