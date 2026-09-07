# Free Activity deletion and code-safety map

This file classifies code around the focused journey. It does not authorize deletion. “Legacy/dead” applies only to the exact member named, never automatically to its containing file.

## KEEP — current journey

| Item | Why it must remain |
|---|---|
| `HikingScreen.tsx` | Active Free Hike ready/tracking/finish/recovery/Marker map host |
| `RunningScreen.tsx` | Active Free Run ready/tracking/quick Cairn/finish/recovery host |
| `HikingMap.tsx` | Active Hike Mapbox, follow/recenter, trace, Marker, offline/loading behavior |
| `useTrackingStore.ts` | Authoritative live Activity lifecycle, GPS, persistence, background, save, Memory flush |
| `useSessionStore.ts` | Completed local Activities, track cache, rename/delete, sync reconciliation |
| `activityOperationalState.ts` | P0 shared exclusive operational-state contract |
| `activityRecovery.ts` | Shared mode-aware disk recovery/restore/discard primitives |
| `useActivitySaveLossRecovery.ts` | Active Running hard-save-loss recovery; target for Hike convergence |
| `hikeTrackWriter.ts`, `hikeTracksCache.ts` | Crash/process-death durability and completed writer lifecycle for both modes |
| `backgroundLocationTask.ts` | Lock-screen/background GPS source |
| `pendingSyncStore.ts`, `syncDaemon.ts`, session service | Offline/pending Activity save and retry |
| `StopSummarySheet.tsx` | Active Hike finish/name/progress surface |
| `TooShortSheet.tsx` | Active Hike and Run insufficient-track decision |
| `PermissionDeniedModal.tsx` | Active permission recovery surface |
| `UnfinishedRecoveryModal.tsx` | Active Continue/Discard surface |
| `MapHistoryScreen.tsx` | Active Activity Detail and post-save destination |
| `PlantScreen.tsx` and Plant steps | Active Hike and standalone Full Plant flow |
| `useMarkerStore.ts`, `markerOfflineEntities.ts` | Active local-first Cairn creation/sync and current Memory side effect |

## SHARED — used elsewhere

| Item | Other dependency |
|---|---|
| `useDistance`, date formatting, haptic service | Home, Trails, Details, Settings and other surfaces |
| Appearance/visual/map theme hooks | Product-wide three-theme authority |
| Marker store and Marker Detail | Trails Cairns, Memory, maps, standalone Plant |
| Memory/H3 stores and `flushHikingToMemory` | Home exploration, Memory/Fog, friend overlays/sync |
| Mapbox configuration and styles | Memory, Route editor/detail, Trails/Activity Detail |
| Root navigation stack | All active product flows |

## MODE-SPECIFIC — keep

| Item | Classification reason |
|---|---|
| Hike interactive `followUser` / Recenter | Genuine current Hike map behavior |
| Hike overspeed policy/banner | Mode-specific safety/data-quality rule |
| Hike Full Plant entry | Current product behavior pending Cairn decision |
| Run pace derivation/presentation | Mode-specific primary metric |
| Run follow-first active Mapbox composition | Genuine current low-interaction behavior |
| Run quick-Cairn handler | Current product behavior pending Cairn decision |
| Run Complete page/state | Active current completion flow until destination decision is approved |

## FUTURE — Route/navigation — keep

| Item | Why it is not dead |
|---|---|
| Ready-state Route pickers and `selectedRoute` | Visible current UI and future Route-context seam, although semantics are partial |
| `followingRouteId`, `useRouteFollowing` | Dormant confirmed Route/navigation capability; explicitly out of scope |
| Route approach-line support in `HikingMap` | Active visual behavior when a Route is selected and future context |
| Voice guidance/off-route/waypoint fields and services | Dormant/future navigation; must not be activated or deleted here |

## DEV / QA — keep isolated

| Item | Why |
|---|---|
| Sim Walker store, injector, overlay, map-center provider | Physical-movement simulation and recovery/track QA; debug-gated |
| Activity P0 source-contract tests | Regression proof for operational state, guards, keep-awake, recovery and attribution |
| Generated preview screens and web store bridges | Visual/reachability QA only; not ordinary production navigation |
| Debug logger, recorder, telemetry upload | Diagnostics; debug setting controls behavior |

## LEGACY / DEAD — proven at member level, safe candidate only after an approved cleanup pass

| Exact member | Proof |
|---|---|
| `RunningScreen` `runFollowUser` state | Declared once; neither value nor setter is read anywhere else in the file/repository. Active map is hard-locked. |
| `HikingScreen` `heading` / `compassEnabled` state and heading watcher effect | State/effect references are self-contained; no rendered control calls `setCompassEnabled`, and no UI reads `heading`. It remains false, so the watcher does not start. |
| `StopSummarySheet` `shareSummary` function and React Native `Share` import | Function is defined but no JSX or caller invokes it; header share button was removed. |
| `StopSummarySheet` `onConfirmAndHome` prop/destructure | Hike passes it, but the component never calls it; the secondary Done button was removed. |
| `StopSummarySheet` `_onDiscard` prop/destructure | Explicitly retained for backward compatibility but not surfaced or called; only Hike passes it. |
| Hike `saveHikeAndNav(..., 'home')` branch/callback | Only reachable through the unused `onConfirmAndHome` prop; no other caller exists. |

These findings satisfy static reachability checks (no other import/caller/dynamic import found) but still require TypeScript, unit, native finish/recovery, and bundle checks when deletion is separately authorized.

## LOCAL MIGRATION IN PROGRESS / duplicated

| Item | Classification |
|---|---|
| Hike screen-local save-loss Alerts vs Running shared `useActivitySaveLossRecovery` | **LOCAL MIGRATION IN PROGRESS / accidental divergence** |
| Hike custom recovery discovery vs Running `findRecoverableActivity` | **ACCIDENTAL DIVERGENCE with Hike-only remote fallback**; preserve behavior until tests define the intended superset |
| Stats strips and action trays | **ACCIDENTAL DIVERGENCE** over shared lifecycle |
| Hike extracted map vs two Run inline maps | **PARTLY INTENTIONAL mode composition, partly implementation duplication** |
| Hike pre-save summary vs Run name + post-save completion | **ACCIDENTAL/PRODUCT-UNRESOLVED divergence** |
| Hike map-layer consumer vs Run outdoors hardcode | **ACCIDENTAL DIVERGENCE unless product owner declares fixed Run map** |

## UNCERTAIN — do not delete

| Item | Why uncertain |
|---|---|
| Run ready-map `mapEpoch` remount and 700ms gesture gate | Active workaround for cached Mapbox camera/fly-in behavior; native behavior must be characterized before removal. |
| Hike remote unfinished-session fallback | Running lacks it, but it may be essential when local writer metadata is lost and server shell survives. |
| Wall-clock save/rename guards and AppState debounce | Encode accumulated native reliability fixes; not safely judged by UI duplication. |
| Track smoothing/snap/raw streams | Different owners serve distance, display, Memory, server audit, and recovery. |
| Proximity-derived Activity Detail Cairns | Misleading as association, but currently active map content; replace only after exact relation exists. |

## Domain deletion consequences

| Mutation | Current direct effect | What survives |
|---|---|---|
| Delete Activity | Removes local Activity and local track cache; attempts remote session delete | Cairns/Markers and personal Memory/Fog survive |
| Delete Cairn | Removes local Marker; attempts remote Marker delete | Activity and personal Memory/Fog survive |
| Discard unfinished/too-short Activity | Tears down writer/server shell and live store; creates no Activity | Any separately created Cairn and its Memory point survive |
| Explicit Reset Memory | Deletes/clears Memory independently | Activities, Routes, and Cairns survive |
