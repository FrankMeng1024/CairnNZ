# CairnNZ Trails product / UX audit

**Date:** 2026-09-13  
**Scope:** Audit only. No Trails, shared-component, navigation, Activity, Route, Cairn, offline/sync, token, backend, or test behavior was changed.  
**Audited state:** The current working tree, including its pre-existing uncommitted Activity/offline/Plant work. This is intentionally an assessment of the product a reviewer can run now, not an assumption that `master`, old filenames, or old comments are current truth.

## Executive verdict

Trails has a legitimate core, but its current information architecture overstates the coherence of the things it contains. Activities and owned Routes form a useful past-to-future journey library. Cairns are durable place traces and are most meaningful spatially in Memory; a chronological Cairn list is a secondary index, not obviously an equal third pillar. Friend Routes and Cairns turn the personal archive into a mixed social-discovery surface, and both friend-card detail paths are currently broken.

The strongest direction is to make Trails the calm personal journey library: find and reopen an Activity, find and use or maintain a Route, and surface only exceptional recovery state. Memory should own spatial Cairn rediscovery. Friends should own people and relationships; shared outdoor traces should remain quiet and spatially coherent instead of becoming another global feed.

This audit does **not** recommend implementing a generic three-tab refresh. The product structure needs to be reduced before visual work begins.

## Method and evidence boundary

Evidence was read in this order:

1. Current authority: `AGENTS.md`, `docs/VISUAL_SYSTEM.md`, `docs/VISUAL_MIGRATION_STATE.md`, `docs/VISUAL_ASSET_MANIFEST.json`, `docs/CAIRNNZ_VISUAL_DNA.md`, the final visual-migration boards, and current global visual-audit boards.
2. Product neighbors: current Home, Friends, Auth, Hike, Run, Plant, Memory, Activity Detail, Route Detail, Cairn Detail, Route Editor, navigation, stores, API adapters, offline queues, and shared components/tokens/icons.
3. Current tests and offline/Activity/Plant audit authority.
4. Historical Trails/Routes audits and generated previews, treated as historical evidence only.
5. Fresh Expo Web runtime at mobile sizes with controlled local, pending, failed, synced, empty, few-item, many-item, Day, Sunset, and Night states.

The runtime used intercepted local fixtures so the audit could distinguish UI behavior from backend availability. Mapbox had no usable access token, so the surrounding detail UI and no-map fallback are valid evidence; map-tile rendering is not scored. One Mapbox token error and one downstream page error occurred while exercising the already-broken friend Route destination. No tracking behavior was invoked or changed.

## 1. Trails in one sentence

> **Today, Trails is a mixed personal-and-social outdoor library combining chronological Activity history, reusable owned Routes, and a list of Cairns, with partial management and sync recovery.**

That role is ambiguous. It is simultaneously an Activity history, Route library, Cairn index, and limited social discovery surface. It is not a saved-place system, a complete offline-download library, or a reliable route-following launcher. “Routes, activity and cairns” in the header describes contents, not a clear user promise.

What it should probably become:

> **Trails should be the personal journey library for finding what I did and choosing what I want to repeat.**

## 2. Current user jobs

### Why open Trails instead of another surface?

| User intent | Why Trails rather than the neighboring surface? | Current support | Assessment |
| --- | --- | --- | --- |
| Find a past Hike | Home exposes only immediate entry/recent context; Memory is spatial, while Trails provides the full chronological Activity list. | Activity rows, Hike filter, recency/distance/duration sorting, Activity Detail navigation. | **Core and mostly useful at small scale.** Weak retrieval after dozens of items. |
| Find a past Run | Same distinction as Hike: Trails is the record index; Activity Detail is for one selected record. | Run filter, recognizable mode glyph, metadata, direct detail navigation. | **Core and mostly useful.** |
| Reopen one known Activity | Activity Detail cannot help until an object is selected. | Tap a row to Activity Detail. | **Core and direct.** The hidden long-press View sheet duplicates the tap. |
| Review recent exploration | Home owns the “what now” moment and Memory owns spatial consequence; Trails can provide chronological evidence. | Recent is the default sort. | **Supporting.** It should not become a dashboard or analytics feed. |
| Revisit something from months ago | Trails is the natural owner because Home and individual Detail cannot retrieve an unknown old object. | Manual date strings and linear scrolling; no Activity search or date grouping; synced history is capped at 100 locally. | **Weak.** This job fails conceptually at the requested 300-Activity scale. |
| Find a Route to repeat | Trails is the natural owned-Route library; Route Detail should act after selection. | Route search, mode filter, distance sorting, direct Route Detail. | **High-value but incomplete.** There is no Use/Start/Follow action from Trails or Route Detail. |
| Maintain a Route | Route Detail is the object owner; Trails selects it. | Rename, Edit Route, Delete, failed-sync retry in detail. | **Useful.** List-level long-press adds little. |
| Understand which Activity produced a Route | Trails is the only surface where both libraries meet. | Source IDs are sent as a creation guard, but provenance is not persisted/read/displayed. | **Not supported.** |
| Continue planning/editing | Trails would be a plausible entry if a Route draft existed. | Existing Route opens Route Detail then Route Editor; no draft/in-progress state or resume cue. | **Only indirectly supported.** Evidence does not justify a new draft system yet. |
| Reopen a known Cairn | Cairn Detail needs a selected object; Trails supplies a chronological list. | Mine list, filters, direct own-detail navigation. | **Supporting.** Useful for titled/note-bearing Cairns, weaker for numerous quick/empty ones. |
| Rediscover where Cairns are | Memory is the stronger spatial owner. | Trails shows a list and optional distance, but no spatial context. | **Poor fit.** This duplicates Memory weakly. |
| Find something available offline | A library is a reasonable place to see durable local objects. | Pending/local Activities, Routes, and Cairns render as real objects. There is no route-download/readiness model. | **Partially supported.** Local-first object visibility is good; “saved offline” navigation readiness is not an implemented product concept. |
| Manage failed sync | Trails is where an old object may first reveal a problem. | Routes show Retry sync; Activity list hides failure but detail can retry; Cairn list hides failure but detail can retry. | **Inconsistent and easy to miss.** |
| See what friends shared | Friends owns people/relationships; a spatial trace could belong in Memory. A personal archive is not the obvious owner. | Mine/Friends switches under Routes and Cairns. | **Conceptually weak and functionally broken at detail navigation.** |

### Surface ownership

| Surface | It should own | It should not ask Trails to duplicate |
| --- | --- | --- |
| Home | Desire, current conditions, start Hike/Run/Plant, immediate recent cue. | Full history, library management, dense filters. |
| Memory | Proof that movement mattered, explored geography, spatial rediscovery of Cairns and quiet traces. | Chronological Activity management or a conventional feed. |
| Activity Detail | Truth and actions for one completed Activity: trace, metrics, gaps, final/Route readiness, rename/delete, Save/Review Route, sync recovery. | Cross-Activity search and browsing. |
| Route Detail | Truth and actions for one Route: preview, readiness, use, edit/delete, exceptional sync recovery, provenance when available. | Whole-library retrieval. |
| Cairn Detail | Truth and actions for one Cairn: place, content, audience, edit/delete, exceptional sync recovery. | Global Cairn discovery. |
| Friends | People, friendship state, invitation, and relationship management. | A second generic route/cairn archive. |
| Trails | Select and reopen past Activities; select, use, and maintain owned Routes. | Social feed behavior, spatial Memory duplication, engineering status queues. |

## 3. Complete current feature inventory

Maturity meanings: **COMPLETE** = wired for its stated current job; **PARTIAL** = useful but missing a material leg; **BROKEN** = reachable path produces the wrong/failed outcome; **LEGACY** = active or retained historical model that no longer matches current language; **DEAD** = no meaningful active caller; **EXPERIMENTAL** = preview/dev path rather than product authority.

| Capability | User purpose | Entry / exit | Data source | Maturity | Actual user value |
| --- | --- | --- | --- | --- | --- |
| Home → Trails entry | Open the personal archive/library. | Home tool → `Routes` screen; Back returns through stack. | Root navigation. | COMPLETE | High; the destination is prominent and understandable by label. |
| Trails header | Orient and leave the surface. | Back; title; subtitle; conditional refresh. | Local screen state and theme. | PARTIAL | Back/title help. “Routes, activity and cairns” exposes mixed scope but not a product promise. |
| Activities / Routes / Cairns primary switch | Choose object type. | Top segmented control; stays within Trails. | Local `tab` state; internal Cairns value is still `flags`. | COMPLETE mechanically; LEGACY semantically | Fast at three items, but it falsely gives three different object models equal weight. |
| Activities data list | Browse completed local and hydrated Activities. | Activities default tab → row → Activity Detail. | `useSessionStore.sessions`; user-scoped local summaries plus hydrated server-backed summaries. | COMPLETE at small scale | Core. It is the clearest reason to open Trails. |
| Activity Hike/Run filter | Narrow history by movement mode. | All/Hiking/Running chips. | Client-side `activityMode`. | COMPLETE | Supporting once the list grows; unnecessary chrome for three items. |
| Activity sort | Find recent, longest, or most-time records. | One sort control cycles Recent/Longest/Most time. | Client-side timestamps/distance/duration. | COMPLETE | Recent is core. Distance/time sorts are optional and lower-frequency. |
| Activity search | Find an old named record. | No active control in `RoutesScreen`. A dormant older index contains search code. | None in active Trails. | DEAD in old index; absent in active screen | Missing at medium/large scale. |
| Activity date presentation | Recognize when a journey occurred. | Row metadata. | `startedAt`, formatted manually as D/M/YYYY. | PARTIAL | Necessary, but locale-insensitive and hard to scan at scale. |
| Activity row recognition | Recognize object, mode, name, distance, duration. | Bare Hike/Run glyph + two text lines. | Session summary and distance settings. | COMPLETE | Good restrained density. Map/elevation/Cairn count are correctly omitted from every row. |
| Activity row tap | Reopen one Activity. | Tap → `MapHistory({sessionId})`. | Session store plus detail hydration/snapshot. | COMPLETE | Core and direct. |
| Activity long-press sheet | Preview stats and choose View. | Long press → local `ActivitySheet` → View → same Activity Detail. | Selected session. | COMPLETE mechanically; LOW VALUE | Hidden gesture adds an extra step to the same destination and no distinct action. |
| Activity empty state | Explain how the history becomes populated. | Zero sessions → illustration/copy; Back is the only escape. | Session count. | PARTIAL | Calm explanation, but no direct Start Hike/Run action. This is acceptable only because Home is one Back away. |
| Activity filter-empty state | Recover after a mode filter returns no items. | List message. | Filtered list. | PARTIAL | Explains the state but does not offer a reset. |
| Activity library sync visibility | Notice local/pending/failed state. | No row badge; Activity Detail exposes Waiting to sync / retry. | `TrackingSession.syncState`, offline Activity queue. | PARTIAL | Keeping pending objects normal is valuable; hiding a failed item until Detail undermines recovery. |
| Activity final/Route readiness | Know whether an Activity can make a usable Route. | Activity Detail only: route ready, needs review, or missing section. | Activity Route-state projection and Final state. | COMPLETE in Detail; absent from list by design | Correctly detailed at object level. Only review-required exceptions may warrant a quiet list cue later. |
| Mine Routes list | Find and manage owned future-intent paths. | Routes → Mine → row → Route Detail. | `useRouteStore.routes`; server list merged with local cache/outbox. | COMPLETE for retrieval | Core. Distinct Route icon and elevation help, though mode is not explicit in row copy. |
| Friend Routes list | Browse shared friend paths. | Routes → Friends → row. | `/api/circle/routes` into `circleRoutes`. | BROKEN end-to-end | The list can render, but row tap passes a friend ID to an own-only detail lookup. |
| Route search | Find a saved Route by name. | Search field on non-empty Mine/Friends scope. | Client-side name match. | COMPLETE | High value for a reusable Route library. |
| Route mode filter | Find Hiking or Running Routes. | All/Hiking/Running chips. | `Route.activityMode`. | COMPLETE | Supporting. The row itself does not state the mode. |
| Route sort | Prioritize recent/longest/shortest. | Sort control. | `updatedAt` and `distanceM`. | COMPLETE | Recent is useful; extremes are optional. |
| Route row recognition | Recognize name, distance, elevation, exceptional sync. | Icon, title, distance/elevation, sync badge, chevron. | Route summary. | COMPLETE | Generally effective and calm. Does not communicate provenance, readiness, or intended mode. |
| Route local/sync badge | See pending or failed save. | Inline Saved locally / Retry sync; synced hidden. | Offline Route entity `syncState`. | COMPLETE | Good exception-oriented pattern, though pending copy can be quieter. |
| Route row tap | Open owned Route Detail. | Tap → `MapHistory({routeId})`. | Route store `routes` only. | COMPLETE for Mine; BROKEN for Friends | Core for Mine. Wrong destination model for Friends. |
| Route long-press sheet | See stats before opening Detail. | Long press → local `RouteSheet` → View. | Selected Route. | PARTIAL; LOW VALUE | Duplicates tap. Friend version disables the only action; delete handlers are passed but no delete UI exists. |
| Route empty Mine | Explain how Routes are created. | Empty Mine → View Activities. | Route count. | COMPLETE | Strong: it teaches the Activity → Route model without inventing manual drawing. |
| Route empty Friends/loading | Explain no shared content / fetch. | Friend scope → loading text or empty illustration. | Circle load flags. | PARTIAL | Loading is plain but stable. Network failure is indistinguishable from genuinely empty. |
| Route search no-results | Explain empty result set. | Search/filter result → “No routes match this filter.” | Filtered list. | PARTIAL | Copy incorrectly says filter for a search miss and offers no Clear/Reset. |
| Route manual refresh | Recheck own/friend Route lists. | Header refresh on Routes. | `loadRoutes` + `loadCircleRoutes`. | PARTIAL | Useful for shared/server change, but errors are swallowed and no failure state is shown. |
| Save Activity as Route | Turn past movement into future intent. | Activity Detail → Save/Review Route → Route Editor. | Deep-copied Activity geometry; offline Route create payload. | PARTIAL | High value and correct local-first independence. Multiple-save/provenance state is not visible. |
| Route source validation | Prevent a deleted/nonexistent Activity from creating a Route. | Save pipeline, not user-facing. | Client/server source Activity IDs and backend transaction. | COMPLETE as a creation guard | Important correctness. It is not a retained Activity ↔ Route relationship. |
| Activity → Route provenance | Explain where a Route came from. | Nowhere in list/detail. | Source IDs are sent but not stored in the Route row/model/query. | BROKEN as a relationship | Missing recognition and duplicate-prevention value. |
| Use/follow a Route from Trails | Turn saved intent into a Hike/Run. | No action from Route row/detail. User must Back/Home → Hike/Run → choose Route. | Separate screen-local route pickers. | PARTIAL product loop | The most important Route job is several steps away. |
| Hike/Run selected-Route continuity | Actually follow and record which Route was used. | Hike/Run picker says “Follow a saved route.” | Screen-local selected ID; dormant `followingRouteId`/following hook; no Route identity passed to `startTracking`. | BROKEN relative to the promise | The UI overclaims following/reuse. Running does not visibly consume geometry like Hike; no usage relation is retained. |
| Owned Cairn list | Reopen/manage a known personal place trace. | Cairns → Mine → card → Cairn Detail. | `useMarkerStore.markers`; local/offline/server reconciliation. | COMPLETE for own objects | Supporting for meaningful named/note-bearing Cairns, less useful than a map for place rediscovery. |
| Friend Cairn list | Browse friend place traces. | Cairns → Friends → card. | `/api/circle/markers` into `circleMarkers`. | BROKEN end-to-end | Card tap opens `MarkerDetail` which searches the own collection and returns “Cairn not found.” |
| Cairn type filters | Narrow by Danger/Cairn/Water/Junction. | Horizontal chips. | `Marker.type`. | PARTIAL / LEGACY | Taxonomy mixes reports and authored traces; creates high chrome for a secondary index. |
| Cairn audience filters | Narrow Mine list by Personal/Friends/Public. | Three icon-only toggles. | `Marker.permission`; legacy `group` wire value. | PARTIAL | Low discoverability, no text/accessibility explanation, and exposes Public despite ordinary public creation being disabled. |
| Cairn sort | Sort Recent or Nearest. | One sort toggle. | `createdAt`; `lastCoordinate` and client distance. | PARTIAL | Nearest is useful only with a known location; without GPS the control still says Nearest while silently sorting Recent. |
| Cairn card recognition | Recognize title/body/type/distance/audience. | `MarkCard` with type color/icon and chevron. | Marker note encoding, type metadata, current coordinate. | PARTIAL | Title fallback now avoids “Untitled Cairn,” which is valuable. Cards are visually heavy and quick Cairns remain hard to distinguish. |
| Cairn library sync visibility | Notice pending/failed state. | No list badge; Cairn Detail has Saved locally / retry. | Marker offline entity `syncState`. | PARTIAL | Local Cairns remain real, which is correct. Failed recovery is hidden until Detail. |
| Cairn empty Mine | Explain/create first Cairn. | Empty Mine → Plant a new mark. | Marker count and Plant navigation. | PARTIAL / LEGACY | Action works, but “mark” leaks old language and an on-site capture action appears only while the library is empty. |
| Cairn empty Friends/loading | Explain no friend traces. | Friend scope → loading/empty. | Circle load flags. | PARTIAL / LEGACY | Copy uses “marks”; network failure is presented as empty. |
| Cairn manual refresh | Recheck friend Cairns. | Header refresh on Cairns. | `loadCircleMarkers`. | PARTIAL | No own refresh and no explicit failure. |
| Delete/edit Activity | Maintain one record. | Activity Detail rename/delete. | Session store/offline/server mutation. | COMPLETE in current audited tree | Correctly owned by Detail, not the library row. |
| Delete/edit Route | Maintain one path. | Route Detail rename/edit/delete; Route Editor. | Route store and offline/server mutations. | COMPLETE for Mine | Correct destination ownership; no need to duplicate via long press. |
| Delete/edit Cairn | Maintain one place trace. | Cairn Detail edit/delete. | Marker store and offline/server mutations. | COMPLETE for own object in current audited tree | Correctly belongs in Detail. Friend object cannot reach valid Detail. |
| Dormant MapHistory index | Older combined Activity/Cairn history with search/time filters. | `MapHistory` without object params; no active caller found. | Sessions and own markers. | DEAD / LEGACY | Duplicates active Trails, calls Activity records “Routes,” and risks two divergent histories. |
| Generated Trails preview | QA/spec state rendering. | DEV-only `RoutesPreview`; generated source. | Static generated states/assets. | EXPERIMENTAL / LEGACY | Useful as historical review material, not current product truth. |
| Current focused Trails tests | Protect object classification, nav, states, themes. | Test suite. | Mostly static integration contracts and shared-control tests. | PARTIAL | Store/offline contracts are strong; active Trails screen behavior has little focused coverage. |

## 4. Object model

### Activity

An Activity is something the user actually did. Its durable truth includes time, mode, trace, metrics, gaps, Cairn associations, server sync, and later display enhancement. Trails should index Activities; Activity Detail should own the full truth and mutations.

### Route

A Route is future intent: a reusable, independently editable path. Current creation correctly deep-copies geometry so reconnect/final enhancement of the source Activity does not rewrite the Route. A Route can survive source Activity deletion, which is the right independence contract.

The missing relationship is provenance, not coupling. Current client/backend code validates a source Activity during creation, but the Route table insert and read model do not retain that source. Users therefore cannot see “made from Morning above the sound,” know whether an Activity already produced a Route, or understand duplicate Routes.

### Cairn

A Cairn is a durable place trace. Plant is the verb. A Cairn can relate to an Activity, but it is location-first rather than path-first. Its strongest “tomorrow value” is encountering the place again in Memory or along the source Activity. A chronology/list remains useful for direct management of titled or note-bearing Cairns, but it degrades quickly for many quick/empty traces.

### Legacy Mark / Marker / Flag concepts

- `Marker` can remain an internal technical noun while user language says Cairn.
- `Flag` remains in route params, tab types, `FlagsTab`, filters, comments, generated artifacts, and dormant screens. It should not remain user-facing product language.
- User copy still says “mark,” “marks,” and “Plant a new mark” inside the Cairn tab.
- `group` is a persistence/API compatibility value while the intended user concept is Friends. Keep it behind an adapter, not in product language.
- The current Cairn subtype taxonomy mixes safety/report types with durable authored-place identity; Trails should not cement that ambiguity through a prominent filter bar.

### Do Activities, Routes, and Cairns belong in one library?

**Activities and owned Routes: yes, with a clear past/future distinction.** They form a coherent journey lifecycle:

`Activity — what I did` → `Route — what I may repeat`

They share recognition needs and a real creation relationship, while remaining independent product objects.

**Cairns: related, but not as an equal top-level pillar by default.** They are durable personal archive objects, so a secondary index in or reachable from Trails is defensible. But they are points rather than journeys, and the product’s differentiated rediscovery surface is Memory. Giving Cairns an equal third tab makes implementation symmetry look like product coherence.

**Friend Routes/Cairns: no, not in the current personal-library structure.** They change ownership from “my archive” to discovery, add a second navigation axis, conflict with quiet/spatial social direction, and currently fail on open.

## 5. Value classification

| Feature | Class | Judgment |
| --- | --- | --- |
| Chronological owned Activity history | CORE | Primary reason to open Trails. |
| Direct Activity row → Activity Detail | CORE | Fast record retrieval. |
| Owned Route library | CORE | Stores future intent and repeatable paths. |
| Route search by name | CORE | Directly supports reuse as the library grows. |
| Direct Route row → Route Detail | CORE | Necessary selection-to-action step. |
| Local-first visibility for all object types | CORE | Pending is a real object, not an error placeholder. |
| Recent-first ordering | CORE | Best default for both Activities and Routes. |
| Hike/Run filtering | SUPPORTING | Useful with mixed histories; should appear progressively. |
| Route edit/delete/rename in Detail | SUPPORTING | Necessary maintenance, correctly secondary to use. |
| Activity rename/delete in Detail | SUPPORTING | Record maintenance, not library chrome. |
| Exceptional failed-sync cue and retry | SUPPORTING | Needed for trust; only failures should command attention. |
| Quiet Route/Activity relationship | SUPPORTING | Improves recognition and prevents duplicate confusion. |
| Cairn list/index | SUPPORTING | Useful for known titled traces and management, subordinate to Memory. |
| Activity distance/time sort | OPTIONAL | Helpful for occasional recall, not a primary control. |
| Route shortest/longest sort | OPTIONAL | Useful for selection but lower priority than name/mode/recency. |
| Pending “Saved locally” badge on every Route | OPTIONAL | Honest, but can be quieter; the object should remain visually normal. |
| Activity long-press View sheet | LOW VALUE | Duplicates tap with no distinct outcome. |
| Route long-press View sheet | LOW VALUE | Duplicates tap; friend state disables its only action. |
| Cairn permission filter group | LOW VALUE | High cognitive cost for an already-secondary list. |
| Equal three-object top navigation | LOW VALUE | Makes code categories look equally important. |
| Manual refresh with swallowed errors | LOW VALUE | Creates the appearance of control without confidence. |
| Friend content nested under Trails | HARMFUL | Mixes personal archive and discovery, adds a second tab tier, and opens invalid details. |
| Nearest label while silently sorting Recent | HARMFUL | Tells the user an ordering that is not applied. |
| Error → friend-empty collapse | HARMFUL | Misreports unavailable content as no shared content. |
| “Follow a saved route” without a retained following contract | HARMFUL | Overstates a partially wired capability. |
| Dormant second history/index in MapHistory | HARMFUL if retained | Creates two owners and stale naming/behavior. |

## 6. Missing high-value behavior

Only capabilities with a demonstrated present job are recommended:

1. **A real Route → use/repeat action.** Route Detail should offer one clear primary action that enters the appropriate Hike/Run route-use flow. It must retain Route identity and meet the actual following/navigation contract before the UI says “Follow.” Editing should not be the primary future-intent action.
2. **Medium/long-history Activity retrieval.** Add Activity name search and date grouping or time-scoped retrieval when the list warrants it. At 300 Activities, linear scrolling and D/M/YYYY rows are not sufficient. Date grouping is more useful than adding more sort chips.
3. **Retained Activity → Route provenance.** Store and expose the source relationship without coupling geometry. Show it only where it helps recognition or prevents accidental duplicate saving.
4. **Exception-only library recovery.** A failed Activity/Route/Cairn should be visible and retryable from the index or clearly lead to Detail. Pending/local remains a normal usable object. Synced remains silent.
5. **Honest loading/error/no-results distinctions.** Friend fetch failure cannot become “none shared”; a search miss should identify search and offer Clear/Reset.
6. **Valid destinations or no friend cards.** Friend Route/Cairn navigation must use a read-only shared-object detail model. Until that exists, hide those scopes rather than shipping false affordances.
7. **Route/Activity recognition differences.** Keep rows compact, but make “did” versus “can repeat” unmistakable through noun, icon, metadata, and action—not badge volume.

Not recommended from current evidence: favorites, a map/list toggle for every object, large map thumbnails on every row, an analytics dashboard, public discovery feed, generic offline-download badges, or a large saved-for-later system. Memory and object Detail already own maps; no current offline navigation/download contract justifies claiming one.

## 7. Redundancy

| Current Trails behavior | Duplicate / conflict | Recommended owner |
| --- | --- | --- |
| Cairn chronological discovery | Memory already represents meaningful place traces spatially. | Memory for rediscovery; Cairn Detail for one object; a secondary index only for management. |
| Friend Routes/Cairns global lists | Friends owns relationships; Memory is the product’s spatial quiet-presence surface. | Friends for people; product decision for spatial shared traces. |
| Activity long-press sheet with View | Tap already opens Activity Detail. | Remove sheet; Activity Detail owns actions. |
| Route long-press sheet with View | Tap already opens Route Detail. | Remove sheet; Route Detail owns actions. |
| Dormant MapHistory index | Active Trails already indexes Activities/Cairns. | Trails owns collection retrieval; MapHistory/Activity Detail owns one object only. |
| Activity list versus Home recent context | Home may preview the immediate recent object, but should not become history. | Trails owns full retrieval; Home owns only immediate context/entry. |
| Activity list versus Memory | One is chronological management, the other spatial consequence. | Keep the distinction; do not add a Trails map duplicate. |
| Route editing as the primary Detail action | Route’s primary user value is future use, not file maintenance. | Route Detail should own use first, maintenance second. |

## 8. Offline / sync

### Current behavior

| Object/state | Current Trails presentation | Current action | Understandable? |
| --- | --- | --- | --- |
| Local/pending Activity | Normal row, fully tappable; no state label. | Activity Detail says Waiting to sync. | Mostly. Local-first treatment is correct, but users cannot spot a stalled/failed row. |
| Failed Activity sync | Same normal row. | Detail can retry by draining pending work. | Weak. Failure is hidden until the user opens the object. |
| Synced Activity | Normal row. | None needed. | Correct. |
| Base-ready / enhanced Activity | No list state. | Detail explains relevant Route readiness. | Correct: engineering lifecycle should not decorate the archive. |
| Route ready | Not explicitly labeled; the object exists and opens. | Edit/delete only from Detail. | The Route itself is real; missing value is Use, not a “ready” badge. |
| Route needs review | Activity Detail owns the review-required state before/while creating a Route. | Review Route. | Correct owner. A quiet Activity-row cue is justified only if it changes the next action. |
| Missing Activity section | Activity Detail preserves gap truth. | Review/reconnect affects the Route, not Activity truth. | Correct and must remain Detail-level. |
| Local/pending Route | Normal tappable row plus Saved locally. | Edit/delete supported; sync proceeds. | Good. It does not feel like an error placeholder. |
| Failed Route sync | Normal row plus Retry sync. | Retry inline and in Detail. | Good exception visibility. |
| Synced Route | No badge. | None. | Correct. |
| Local/pending Cairn | Normal tappable card; list hides state. | Detail shows Saved locally. | Mostly. Correct first-class treatment, inconsistent with Route. |
| Failed Cairn sync | Normal card; list hides state. | Detail can retry. | Weak; issue is undiscoverable from the library. |
| Friend fetch failure | Settled as empty after errors are swallowed. | Header refresh repeats without explicit error. | No. Empty and unavailable are different truths. |

### Product rule for a future redesign

- **Local-only objects appear in their normal chronological position and remain fully usable.** Local is durability state, not object type.
- **Pending is quiet.** A small secondary “On this device”/“Saving” treatment may be used where needed, without dimming, disabling, or segregating the object.
- **Failed is explicit and actionable.** Show one calm exception cue and a Retry path. Do not turn Trails into a queue dashboard.
- **Synced is silent.** No success badge on every row.
- **Review-needed is not sync failure.** It appears only when it changes a user action, using product language such as “Review route,” never Final/Base/Gap engineering names.
- **Activity truth remains immutable.** Gap/missing-section truth stays with Activity; reconnect may improve the independent Route only.
- **Route remains independent.** Source provenance may be displayed, but source Activity deletion or later enhancement must not mutate Route geometry.

## 9. Product-DNA audit

### Family comparison

| Reference | What current authority establishes | Current Trails comparison |
| --- | --- | --- |
| Home | Environmental desire, one clear next action layer, breathing room, authored scenic/material hierarchy. | Trails should be denser and non-cinematic, but its control stack lacks Home’s clear priority and calm next action. |
| Friends | Strongest utility reference: one compact scope control, calm density-capable records, warm human detail, authored empty states. | Trails uses a primary three-way switch, then another Mine/Friends switch, then search/filter/sort at nearly equal weight. It copies control presence without preserving hierarchy. |
| Auth | Premium restraint, confident type/action hierarchy, quiet interaction zones. | Trails’ many small pills and local sheets feel procedural and less authored. Auth is a quality calibration, not a layout template. |
| Hike / Run | Map-first operational safety; mode, route, status, metrics, and primary controls are immediately legible. | Activity/Route identity in Trails is subtler than needed, and the Route library does not complete the operational handoff to Hike/Run. |
| Plant | Cairn as durable trace; Plant as verb; tomorrow-value comes from spatial/journey rediscovery. | Trails retains Mark/Flag language and promotes a list/filter model that is weaker than spatial Memory for Cairns. |

### Dimension audit

| Dimension | Current state | Judgment |
| --- | --- | --- |
| Hierarchy | Header + three main tabs + optional second scope tabs + search + filter chips + sort + rows. | Too many equal-weight levels, especially Routes/Cairns. The content begins too late and Trails reads as controls before archive. |
| Typography | Shared sizes/colors are used in the main screen; compact title/subtitle and small metadata. | Broadly Cairn-like, but tiny dense support text and manual numeric date reduce scanability. The subtitle is grammatically awkward and conceptually weak. |
| Surfaces | Activity/Route rows use restrained divider treatment; Cairns use white floating cards; sheets are locally constructed. | Activity/Route direction better matches the record-surface authority. Cairn cards create a separate visual system and violate “not floating-card-every-row,” especially at Night. |
| Spacing | Lists are efficient; header/control stack consumes substantial vertical space. | Appropriate row density, poor macro hierarchy. Three-item libraries look over-instrumented. |
| Density | Activity rows are calm; Routes add search/scope/filter/sort; Cairns add scope/type/audience/sort. | Trails is allowed to be denser than Home, but density should come from records, not control chrome. |
| Icons | Shared icon family plus accepted Hike/Run glyphs. | Geometry is mostly coherent. Route, mode, Cairn type, audience, approximation, sync, sort, and chevrons can accumulate into badge/icon noise. Audience toggles are icon-only and unclear. |
| Day | Mineral page, quiet green controls, readable rows. | The strongest theme. Still very flat and procedural; Cairn cards float as opaque white. |
| Sunset | Warm taupe page/surfaces with limited luminance separation. | Behaves like a brown-gray page tint rather than retained golden-hour light. Rows and controls flatten together. |
| Night | Current shared shell is cool blue-slate and readable; Route/Activity rows are restrained. | Better than older green-black captures. Cairn cards remain near-white Day cards inside Night, producing glare and breaking material continuity. |
| Empty states | Activities/Routes use mountain art; Cairns use the canonical Cairn illustration. | More authored than generic “No data,” but object families use inconsistent art language and Activities lacks a direct next action. Empty art is not the main problem; IA is. |
| Card/list treatment | Three different row grammars: bare Activity dividers, Route icon rows, floating Cairn cards. | Some distinction is desirable, but the third treatment is too visually separate and heavy. |
| Environmental presence | Restrained/mostly blank page with empty-state illustration. | Correct not to add Home scenery. The archive still needs authored material hierarchy, not cinematic background. |

### Component audit

| UI role | Current implementation | Shared Cairn component? | Future action |
| --- | --- | --- | --- |
| Primary object switch | `PillTabs`/`SegmentedControl` wrapper in Trails. | Yes. | **REUSE SHARED**, after IA is reduced. |
| Mine/Friends scope | Local `ScopeTabBar` using the same pill family. | Partly. | **REMOVE** from personal Trails unless a coherent discovery owner is chosen. |
| Activity record row | Local `PressBtn` row and Hike/Run icons. | Shared primitives, local composition. | **KEEP / POLISH**; make it the basis for calm archive density. |
| Route record row | Local `PressBtn` row, `Icon`, `SyncBadge`. | Shared primitives, local composition. | **KEEP / POLISH**; clarify mode/use and exceptional state. |
| Cairn record card | Shared `MarkCard`, but it uses hard-coded Day colors. | Shared by name, not by theme contract. | **EXTEND SHARED** if a list survives; move to semantic record surfaces. |
| Search | Local `TextInput` wrapper. | `TextField` exists but has different role. | **REDESIGN** as a library search role or extend a shared compact search field. |
| Filter/sort bar | Local filter chips and sort control. | Tokens/icons only. | **REDESIGN** and progressively disclose; do not create a permanent dashboard bar. |
| Sync status | Shared `SyncBadge`. | Yes. | **KEEP / POLISH** for exception-only use; ensure consistent Activity/Route/Cairn policy. |
| Activity long-press sheet | Local `Animated` modal. | `BottomSheetFrame` exists. | **REMOVE**; it has no unique product action. |
| Route long-press sheet | Local `Animated` modal. | `BottomSheetFrame` exists. | **REMOVE**; Detail owns the information/actions. |
| Detail bottom panels | Large local panels in `MapHistoryScreen`; Cairn Detail local layout. | Shared `BottomSheetFrame`, `ModalCard`, `PrimaryButton` exist. | **REDESIGN / REUSE SHARED** in a later implementation phase. |
| Empty-state composition | Local `EmptyState`, `IllustrationHalo`, route/Cairn assets. | Shared illustrations partly. | **EXTEND SHARED** only after product-specific copy/actions are settled. |
| Back affordance | Shared `BackButton`. | Yes. | **KEEP AS IS**. |
| Refresh | Local header icon and swallowed errors. | Shared icon only. | **SIMPLIFY**; keep only with honest loading/error behavior. |

### Navigation audit

| Flow | Current outcome | Finding |
| --- | --- | --- |
| Trails → owned Activity Detail | Direct and correct. | Keep. Detail’s explicit Back reset prevents the earlier Activity/Trails loop. |
| Trails → owned Route Detail | Direct and correct for a Route already in the owned store. | Keep selection; make future Use the primary Detail job. |
| Trails → owned Cairn Detail | Direct and correct in the current audited tree. | Useful secondary path. |
| Trails → friend Route Detail | Own-only lookup misses; runtime shows a Route Detail shell with “No hikes yet / Start a Hike.” | **P0 wrong-object/fallback path.** |
| Trails → friend Cairn Detail | Own-only lookup misses; runtime shows “Cairn not found.” | **P0 dead end.** |
| Activity Detail → Save/Review Route | Goes through Route Editor; Route is deep-copied and locally durable. | Valuable, but provenance is not retained for later library use. |
| Route Detail → Hike/Run | No action. User backs out and independently chooses a Route from Hike/Run. | Missing primary Route loop. |
| Detail edit/delete/retry | Owned object Details provide actions. | Correct owner; do not duplicate on library sheets. |
| Trails Back | Normal stack back. | Correct for direct Home entry. Activity-completion flow uses reset to avoid loops. |

### Empty, loading, and error states

| State | Current copy/action | Judgment |
| --- | --- | --- |
| No Activities | “No tracks walked yet”; explanation; no CTA. | Cairn language is calm. Consider one Start action later, but do not turn the archive into Home. |
| No Routes | Explains Activity → Save as Route; View Activities CTA. | Strongest Trails empty state. |
| No Cairns | “No cairns planted yet,” but body/button say mark. | Good next-step pattern, wrong terminology and questionable ownership. |
| Offline-only content | Appears as normal content. | Correct. There is no separate “offline empty” state because local data is real data. |
| Sync failure | Route badge actionable; Activity/Cairn hidden at index. | Inconsistent. |
| Search no results | “No routes match this filter.” | Does not identify search or offer Reset. |
| Friend loading | Centered text. | Stable but visually weak. |
| Friend request failure | Same eventual presentation as truly empty. | Incorrect and trust-damaging. |

## 10. Scale

| Scale | Current behavior | Product assessment |
| --- | --- | --- |
| 3 items | All content fits, but filters/sorts and two tab tiers can occupy more attention than records. | Over-instrumented. Default recency and direct rows are enough until control value is earned. |
| 30 Activities | `FlatList` performs and rows remain compact. Linear scanning, numeric dates, and no search/date grouping begin to hurt rediscovery. | Usable but not strong. Progressive search or time grouping becomes justified. |
| 300 Activities | Active store retains at most 100 server-backed summaries (pending items are retained separately); active Trails has no pagination/server history retrieval. | The product cannot actually support this history size. This is a product/data-retention decision before visual design, not a FlatList styling issue. |
| Many Routes | Name search, mode filter, recent/distance sort, and compact rows scale reasonably. Server/list pagination is absent, but expected Route count is lower than Activities. | Best-scaled current tab. Prioritize search and recency; avoid adding favorites until real volume proves the need. |
| Many Cairns | List virtualization works, but cards are taller; no search; type/audience filters are complex; quick Cairns are hard to recognize; nearest may lie without GPS. | Poor conceptual scale. Map-based rediscovery in Memory is the stronger primary behavior; a list should become a secondary searchable management index if retained. |

## 11. P0 / P1 / P2 findings

### P0 — product correctness / broken flow

1. **Friend Route opens the wrong destination state.** A friend Route card navigates with its ID, but Route Detail searches only owned Routes. Fresh runtime produced a Route Detail header above the unrelated empty “No hikes yet / Start a Hike” state.
2. **Friend Cairn cannot open.** A friend Cairn card navigates to own-only Cairn Detail and produces “Cairn not found.”
3. **Friend fetch failure is reported as empty.** Route/Cairn loaders swallow errors and mark the first fetch settled, so “none shared” and “could not load” are indistinguishable.
4. **The Route-following promise is not true end-to-end.** Hike/Run says “Follow a saved route,” but selection is screen-local, does not set the existing following state, is not passed into Activity start, and is not retained as an Activity → Route use relationship. The Trails/Route Detail flow also has no Use action.

No evidence was found that local pending Activity/Route/Cairn objects disappear from Trails in the current audited tree. Route independence from source Activity and Activity gap truth are preserved and must not be changed.

### P1 — product architecture / UX

1. Trails has no single product promise; it combines history, future intent, place traces, and social discovery.
2. Equal Activities/Routes/Cairns navigation elevates implementation types above user jobs.
3. Friend content adds a second navigation axis and conflicts with personal-archive and quiet/spatial discovery models.
4. Cairns are promoted as a list library when their differentiated value is spatial rediscovery in Memory.
5. Routes are easy to find but not easy to use; edit is primary where repeat/follow should be primary.
6. Activity retrieval does not scale: no search/date grouping in active Trails and a hidden 100-synced-summary retention ceiling.
7. Activity → Route provenance is validated transiently but not retained, so the library cannot explain the relationship or duplicates.
8. Sync/recovery policy is inconsistent across Activity, Route, and Cairn rows.
9. Long-press sheets duplicate the direct-detail action and hide behavior behind a gesture.
10. Nearest Cairn sort silently changes semantics when no coordinate exists.
11. Empty/search/error states do not consistently provide honest recovery.
12. The old parameterless MapHistory index remains a second, divergent library implementation.

### P2 — visual polish

1. Primary tab, scope tab, search, filter chips, permission toggles, sort, and badges compete at similar visual weight.
2. Sunset is a flat brown-gray material field rather than retained golden-hour light.
3. Cairn `MarkCard` hard-codes a near-white Day card, producing glaring rectangles in Night and weak theme continuity.
4. Activity, Route, and Cairn rows use three inconsistent surface grammars; Cairns look like a separate app family.
5. Local Activity/Route sheets and detail panels diverge from shared `BottomSheetFrame`, `ModalCard`, and action patterns.
6. Manual D/M/YYYY dates are less natural and scan-friendly than locale-aware/time-grouped archive labels.
7. Icon-only Cairn audience controls lack clear semantic labels and create unnecessary miniature UI.
8. The Trails subtitle and residual “mark” language reduce editorial quality.

## 12. Product decision table

| Current thing | Decision | Why | Recommended future action |
| --- | --- | --- | --- |
| Trails as a destination | REDEFINE | It has a valuable core but no clear promise. | Define it as the personal journey library: past Activities and reusable owned Routes. |
| Activities as the default | KEEP / POLISH | Past-record retrieval is the clearest frequent job. | Keep recent-first compact rows; add scale-aware retrieval. |
| Owned Routes | KEEP / POLISH | Future intent is a strong, distinct reason to return. | Keep search and direct detail; make Use/Repeat the primary Route action. |
| Equal Cairns primary tab | MOVE | Place traces are related but spatial-first, not journey-first. | Move primary rediscovery to Memory; retain a secondary index only if management evidence supports it. |
| Friend Routes inside Trails | HIDE | Mixes social discovery into a personal library and the destination is broken. | Hide until a coherent read-only shared-route discovery model exists, then place it with its proper owner. |
| Friend Cairns inside Trails | HIDE | Broken and conflicts with spatial/quiet presence direction. | Hide until Memory/shared-trace semantics and detail identity are end-to-end. |
| Three-way top tab model | SIMPLIFY | It grants unequal object models equal priority. | Use only the minimum dominant Activities/Routes choice after IA decision. |
| Mine/Friends secondary tabs | REMOVE | Adds a second navigation axis and obscures ownership. | Let Trails be implicitly mine; move social discovery elsewhere. |
| Activity compact rows | KEEP / POLISH | Correct density and recognition baseline. | Preserve name/mode/date/distance/duration; improve time grouping and exception cues. |
| Activity search | REDEFINE | Absent in active Trails but valuable at realistic history scale. | Introduce progressively for medium/large histories rather than permanent chrome for three items. |
| Activity Hike/Run filter | KEEP / POLISH | Useful with mixed histories. | Keep but lower visual weight/progressively disclose. |
| Activity Longest/Most time sorting | HIDE | Low-frequency compared with recency and retrieval. | Move into secondary sort controls; do not show by default at low counts. |
| Activity long-press sheet | REMOVE | Same destination as tap, no unique action. | Make row tap the only selection behavior; keep mutations in Detail. |
| Route name search | KEEP AS IS | Directly supports finding reusable Routes. | Preserve behavior; refine shared visual role later. |
| Route mode filter | KEEP / POLISH | Useful selection dimension. | Retain with lower visual priority and explicit row mode if needed. |
| Route Longest/Shortest sorting | SIMPLIFY | Helpful but secondary. | Keep behind one subdued sort menu/control. |
| Route long-press sheet | REMOVE | Duplicates tap; friend state is a dead end. | Route Detail owns preview/actions. |
| Route Edit as primary Detail CTA | REDEFINE | Maintenance is not the main reason a Route exists. | Use/Repeat first; Edit/Delete secondary. |
| Activity → Route deep-copy independence | KEEP AS IS | Protects local-first durability and source truth. | Preserve exactly. Display provenance without re-coupling geometry. |
| Transient source Activity guard | KEEP AS IS | Prevents creating from deleted/non-finalized Activity. | Preserve transaction/identity safety. |
| Missing persistent Route provenance | REDEFINE | The product cannot explain Activity → Route. | Persist/read a stable source relation and define cardinality/display. |
| Synced badges | HIDE | Normal success should not add status noise. | Continue hiding. |
| Pending/local object visibility | KEEP AS IS | Local-first objects are real and usable. | Preserve normal placement and actions. |
| Failed-sync handling | REDEFINE | Route is visible/actionable; Activity/Cairn are hidden; friend errors masquerade as empty. | Establish one exception-only recovery rule. |
| Base Final / engineering state in list | HIDE | Does not help recognition. | Keep internal; expose only product action states such as Review route. |
| Missing-section/Gap Activity truth | KEEP AS IS | Required truth and recent offline contract. | Keep in Activity Detail; reconnect only affects independent Route. |
| Cairn type filter bar | SIMPLIFY | Taxonomy is unresolved and the list is secondary. | Do not preserve all chips by default; revisit after Cairn ontology decision. |
| Cairn permission icon filters | REMOVE | Low discovery value and high cognitive cost. | Manage audience on Cairn/Detail, not as a permanent archive filter. |
| Cairn Nearest sort | REDEFINE | Valuable spatially but currently lies when GPS is absent. | Prefer Memory map; if retained, disable/explain until location exists. |
| `MarkCard` title fallback | KEEP AS IS | Avoids “Untitled Cairn” leakage and improves recognition. | Preserve language behavior wherever Cairn records appear. |
| `MarkCard` hard-coded Day surface | REDEFINE | Breaks Sunset/Night and record-surface authority. | Later extend shared card to semantic theme roles if the list survives. |
| “Mark”/“Flags” user language | REMOVE | Creates false concepts around Cairn. | Cairn = noun, Plant = verb; technical Marker/Flag stays internal only where necessary. |
| Manual refresh | SIMPLIFY | Useful only when it communicates loading/failure honestly. | Prefer automatic refresh; retain a manual affordance only for a real retry/recheck job. |
| Parameterless MapHistory library | REMOVE | Dead duplicate history owner with stale language. | Remove after confirming no external/deep-link dependency. Keep object Detail mode only. |
| Generated preview/old QA states | HIDE | Historical evidence, not runtime authority. | Keep out of production navigation; archive only if still useful for QA history. |

## 13. Recommended future structure

### Product promise

**Trails is my personal journey library.** It lets me find a past Activity and choose a Route to use again.

### Information architecture

1. **Activities** — default, recent-first history of what I did.
2. **Routes** — owned, searchable paths for what I may do next.
3. **Cairns** — not an equal primary mode. Memory owns spatial rediscovery. A low-prominence “Cairns” index may remain accessible from Memory or a secondary Trails library link only if users need chronological management.
4. **Friends content** — absent from personal Trails until product chooses a coherent shared-trace discovery owner and read-only details work.

This is a two-domain lifecycle, not a three-tab convention:

`Past: Activity` → optional `Save/Review as Route` → `Future: Route` → `Use Route` → new `Activity`

The Route remains independently editable. The relationship is provenance, never shared mutable geometry.

### Retrieval and density

- Show records immediately; do not front-load a dashboard.
- Recent-first is default and mostly implicit.
- Keep Hike/Run as a subordinate filter that appears when useful.
- Keep Route name search because future-intent retrieval is high value.
- Introduce Activity search and month/year grouping for larger histories; do not show a giant search/filter bar to a three-item user.
- Keep rows compact. A user should recognize an Activity from mode, name, when, distance, and duration; a Route from Route identity, name, mode, distance/elevation, and whether an action is needed.
- Do not add map thumbnails to every row without evidence. Activity/Route Detail and Memory own map context.

### Actions

- Row tap opens the correct object Detail.
- Activity Detail owns rename/delete, truth, gaps, sync recovery, and Save/Review Route.
- Route Detail owns Use first, then edit/delete, source context, and exceptional sync recovery.
- Cairn Detail owns edit/delete/audience/retry; Memory owns rediscovery.
- Remove long-press sheets unless a future distinct, high-frequency action justifies them.

### Status policy

- No synced badges.
- Local/pending objects stay normal and usable.
- One quiet pending/local explanation where necessary.
- Failed state visible and retryable.
- Review route only where it changes next action.
- Never show Base Final, sync queue names, server IDs, Gap internals, or debug readiness vocabulary.

### Visual direction for the later implementation phase

A calm personal outdoor archive: restrained page environment, efficient mineral record rows, one clear control hierarchy, mature icons, semantic Day/Sunset/Night surfaces, no cinematic background, no card-within-card dashboard, and no floating white card for every record. Friends is the quality reference for hierarchy and authorship, not a template for Trails’ information architecture.

## 14. What should NOT survive

- Friend Route and friend Cairn scopes inside personal Trails in their current form.
- Any friend card that navigates to an own-only detail store.
- The equal-weight assumption that Activities, Routes, and Cairns must remain three primary tabs because the code already has them.
- The second Mine/Friends segmented control beneath the main object control.
- Activity and Route long-press sheets whose only useful action is the same View destination as tap.
- User-facing Mark/Marks/Flag/Flags leakage; “Plant a new mark” and “friends’ marks” should not survive.
- Icon-only Cairn audience filters as permanent primary controls.
- Nearest sort that silently performs Recent sort.
- Swallowed network failures that render as empty social content.
- “Follow a saved route” until Route identity and actual following/use are wired end-to-end.
- Edit Route as the only prominent positive action on a future-intent object.
- Debug-like state proliferation: synced chips, Final/Base names, queue details, source IDs, or status badges on every row.
- The dormant parameterless MapHistory history/library once dependency checks confirm it is uncalled.
- Hard-coded opaque white Cairn cards in Sunset/Night.
- A generic file-manager or Strava-style analytics-feed redesign.

## 15. Open product decisions

These are genuine decisions where implementation evidence alone does not settle the final answer:

1. **Where exactly should the secondary Cairn index live?** Recommendation: Memory owns the map and primary rediscovery; a compact list may live inside Memory or behind a secondary Trails link. Evidence favors demotion, but current users’ Cairn-management frequency is not measured.
2. **How should shared Routes and Cairns be discovered?** Recommendation: Friends owns people; Memory owns quiet spatial traces. A shared Route may also need an explicit share/open flow. Do not restore global Friends tabs in Trails until the discovery rule is chosen.
3. **What is the Activity retention contract?** The current client retains 100 server-backed summaries, which contradicts the conceptual 300-Activity archive test. Product must choose durable full history, pagination/windowing, or an explicit retention promise before redesign claims long-term archive value.
4. **What does “Use Route” guarantee?** Product must decide the safe minimum: preselect and show geometry, active turn/corridor following, or both. The label must match the implemented contract, and Route identity should be retained with the resulting Activity if reuse/history is part of the value.
5. **Can one Activity produce multiple Routes, and how is that shown?** Route independence says yes technically; product should define whether Save as Route remains repeatable, becomes “View saved Route,” or supports named variants.

## Current-state visual evidence

Fresh ignored local evidence (not deploy-bearing Git authority):

- Board: `app/_review/overnight-trails-product-audit/trails-current-state-board.jpg`
- Machine-readable capture/result log: `app/_review/overnight-trails-product-audit/results.json`
- Individual captures: `app/_review/overnight-trails-product-audit/*.png`
- Reproducible audit capture script: `app/scripts/capture-trails-product-ux-audit.mjs`

The board includes empty Activities/Routes/Cairns; few-item Activity/Route/Cairn lists in Day/Sunset/Night; 30 Activities at 390×844; many Activities at 360×640 and 430×932; Route search no-results; local Activity/Route/Cairn details; and broken friend Route/Cairn destinations. It is current-state evidence only. No redesign mockup was produced.

Relevant existing family-comparison evidence:

- `docs/qa/visual-migration/final/product-unity-board.jpg`
- `docs/review/global-visual-audit-2026-09-04/runtime-overview/cross-page-system-review-board.jpg`
- `docs/review/global-visual-audit-2026-09-04/runtime-details/centralized-detail-convergence-board.jpg`

## Test and contract audit

Existing focused Activity/offline tests strongly cover local commit durability, independent Route snapshots, sync handoff, retry state, Activity Route readiness, and navigation contracts around completion. Shared `SegmentedControl` also has isolated tests.

Active Trails itself has no adequate focused behavioral suite for:

- main object classification and default tab;
- own versus friend destination identity;
- Activity/Route/Cairn local, pending, failed, and synced row presentation;
- empty versus loading versus error versus search-no-results;
- filter/search/sort behavior in the active screen;
- Day/Sunset/Night record surfaces;
- direct navigation and redundant long-press sheets;
- retry/delete behavior as exposed through Trails;
- Route use and Activity/Route independence at the UI boundary.

No tests were added or changed in this audit phase. Focused existing contract tests were run only to validate the audited state: **4 suites / 57 tests passed** (`freeActivityIntegrationContracts`, `activityRouteState`, `useRouteStore.offline`, and `offlineCommittedEntity`). Jest also emitted the repository's existing `setupFilesAfterFramework` configuration warning. This audit does not encode a new product decision.

## Tracking safety

No GPS, O52 precision, Stationary V2, canonical, Final V2, distance, Memory truth, tracking, backend, or offline/sync behavior was changed. The recommended structure consumes current Activity/Route/Cairn contracts and explicitly preserves local object visibility, Route independence, Activity gap truth, and the rule that reconnect affects the Route rather than rewriting Activity truth.
