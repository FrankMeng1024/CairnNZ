# Activity / Map Authority — Code Evidence

Audit date: 2026-09-05. This package records current repository/runtime facts. Historical concept and migration documents were used only as context; current imports, routes, stores, and rendered production components decide reachability and behavior.

## Authority and reachability

| Evidence | Classification | What it proves |
|---|---|---|
| `AGENTS.md`; `docs/CAIRNNZ_VISUAL_DNA.md`; `docs/VISUAL_SYSTEM.md` | Current authority | Home anchors brand color; Activity is operational/map-led; Day, Sunset, Night are distinct environmental states. |
| `docs/CAIRNNZ_VISUAL_ROADMAP.md` Gate B3 | Current roadmap, sequencing now under review | Activity + Trails convergence was not started under the former order. |
| `docs/VISUAL_MIGRATION_STATE.md` | Historical migration record | Useful evidence of earlier coverage, but its binary Day/Night wording and “Mapbox unavailable” note are superseded by current three-state code and current local environment. |
| `docs/VISUAL_NORTH_STAR_LOCK.md` | Earlier north-star constraint | Still useful for anti-patterns, but its binary theme wording is superseded by the current three-state authority. |
| `app/src/navigation/RootNavigator.tsx` (`RootStackParamList`, production `Stack.Screen`s) | ACTIVE | `Hiking`, `Running`, `Routes`, `MapHistory`, `RouteEditor`, `Plant`, `MarkerDetail`, `Memory`, and `Settings` are authenticated production routes. |
| `app/src/screens/home_generated/HomeScreen.generated.tsx` action `onPress` handlers | ACTIVE | Home’s locked Hiking and Running actions navigate directly to `Hiking` and `Running`; Leave a Cairn navigates to `Plant`. |
| `app/src/navigation/RootNavigator.tsx` dev registrations | DEV / QA ONLY | `HikingPreview` and `RunningPreview` are registered only inside `__DEV__`. |
| `app/src/screens/hiking_generated/*`; `app/src/screens/running_generated/*` | DEV / QA ONLY | Generated concepts are preview infrastructure, not production Hiking/Running. |
| `app/src/dev/simWalker/*` plus `HikingScreen` mount gate | Production-hidden debug tooling | Sim Walker can ship but requires the Settings five-tap debug gate plus the explicit simulator toggle. It is not a normal production flow. |

## Active implementation inventory

| Path | Scope | Ownership / role |
|---|---|---|
| `app/src/screens/HikingScreen.tsx` | Hiking | ACTIVE production UI and Hiking-specific orchestration: select/tracking phase, route picker, stats, action tray, Cairn navigation, completion, recovery, marker detail. |
| `app/src/screens/HikingMap.tsx` | Hiking | ACTIVE native Mapbox wrapper: basemap, camera/follow, user location, live trace, approach line, start marker, cairn annotations, loading/offline states. |
| `app/src/screens/RunningScreen.tsx` | Running | ACTIVE production UI and inline duplicated Mapbox implementation: pre/running/stopped states, metrics, quick Cairn, save-name sheet, completion. |
| `app/src/store/useTrackingStore.ts` | Shared | ACTIVE tracking state machine and GPS/network/save orchestration for both activity modes. |
| `app/src/services/backgroundLocationTask.ts` | Shared | ACTIVE Expo TaskManager background location ingestion. |
| `app/src/services/hikeTrackWriter.ts` | Shared despite historical name | ACTIVE JSONL crash-recovery persistence for both `activity_mode` values. |
| `app/src/services/sessionService.ts` | Shared | ACTIVE session start, incremental append, atomic save, detail fetch, and delete API boundary. |
| `app/src/components/TooShortSheet.tsx` | Shared | ACTIVE too-short recovery sheet for Hiking and Running. |
| `app/src/components/PermissionDeniedModal.tsx` | Shared | ACTIVE location-permission recovery modal for both screens. |
| `app/src/components/UnfinishedRecoveryModal.tsx` | Shared component, Hiking host only | ACTIVE from Hiking; no Running host. |
| `app/src/screens/StopSummarySheet.tsx` | Hiking | ACTIVE Hiking completion/name/save sheet. |
| `app/src/store/useRouteStore.ts` | Shared | ACTIVE route data and selected-route source used independently by both activity screens. |
| `app/src/hooks/useRouteFollowing.ts`; `app/src/services/routeFollowing/*` | UNCERTAIN / not active in current screens | Engine and tests exist, but no production screen imports/calls `useRouteFollowing`; no turn-by-turn UI is active. |
| `app/src/config/mapbox.ts` | Shared map | ACTIVE style/token initialization, Standard configuration, layer resolution, and boot-time warm cache. |
| `app/src/hooks/useMapTheme.ts` | Shared map | ACTIVE exact Day/Sunset/Night value supplied to maps. |
| `app/src/hooks/useAppearance.ts` | Compatibility | ACTIVE binary adapter; `isDark = timeOfDay !== 'day'`, so Sunset receives Night-oriented local branches. |
| `app/src/screens/MapHistoryScreen.tsx` | Details / Trails dependency | ACTIVE activity/route detail and list map, route/track visualization, marker rendering, edit/save/delete entry. |
| `app/src/screens/RouteEditorScreen.tsx`; `app/src/components/map/DualLineLayer.tsx` | Details / Trails dependency | ACTIVE route editor and confidence-coded original/edited geometry. |
| `app/src/features/memory/screens/MemoryScreen.tsx`; `components/MemoryMap.tsx` | Memory | ACTIVE separate map composition, camera, user puck, fog, cairn pins, loading/recenter chrome. |
| `app/src/features/memory/components/FogLayer.tsx`; `CairnPinsLayer.tsx` | Memory | ACTIVE CairnNZ map-data layers. |
| `app/src/features/memory/services/flushHikingToMemory.ts` | Shared activity→Memory | ACTIVE completion bridge for both modes. |
| `app/src/features/plant/components/PinAdjustStep.tsx` | Leave a Cairn | ACTIVE Standard/Standard-Satellite placement map and pin adjustment. |

## Navigation and activity flow

```text
Home locked action
  ├─ Hiking → HikingScreen
  │    ├─ foreground permission prime + route load + unfinished scan
  │    ├─ Select: map + stats + Free Hike / saved route + Start Hiking
  │    ├─ startTracking → shared TrackingStore
  │    ├─ Tracking / Paused: HikingMap + metrics + expandable action tray
  │    │    ├─ Cairn → Plant
  │    │    └─ Finish → too-short recovery OR StopSummarySheet
  │    └─ Save → shared atomic session save + Memory flush
  │         ├─ View Activity → MapHistory(sessionId)
  │         └─ Done → Home
  └─ Running → RunningScreen
       ├─ foreground permission prime + route load
       ├─ Pre: map + stats + Free Run / saved route + Start Running
       ├─ startTracking → shared TrackingStore
       ├─ Running / Paused: inline MapView + metrics + expandable action tray
       │    ├─ Cairn → direct personal-marker mutation
       │    └─ Finish → too-short recovery OR local save-name sheet
       └─ Save → shared atomic session save + Memory flush → stopped screen
            ├─ View Activity → MapHistory(sessionId)
            └─ Done → Home
```

### Hiking state evidence

- `HikingScreen` subscribes to shared `status`, duration, distance, elevation, location, raw/smoothed points, stop state, and save-risk state.
- `phase` is local (`select | tracking`) and initializes as tracking only when the shared status equals `tracking`.
- `startTracking` is fired from Start while `phase` changes immediately; the screen does not await success on that path.
- Selected route data is reduced to `routeStart` before entering `HikingMap`; the full route line and the dormant route-following engine are not wired.
- Active metrics are distance, elapsed time, elevation gain, and GPS status. No current pace is displayed in Hiking.
- Pause/resume call the shared store. Controlled runtime proof found paused `status` makes `isTracking` false while `isTrackingOrPaused` remains true: the pre-start Start control and paused action tray coexist.
- Cairn action navigates to the full `Plant` flow. Existing map cairns open `MarkDetailSheet`.
- Finish pauses a sufficiently long activity and opens `StopSummarySheet`; too-short data opens `TooShortSheet` without discarding first.
- Save calls `stopTracking`, which saves the session and flushes the trace into Memory. View Activity navigates to `MapHistory`; Done returns Home.
- Hiking owns disk/server unfinished detection and hosts `UnfinishedRecoveryModal`.

### Running state evidence

- `RunningScreen` has a separate local `pre | running | stopped` state over the same shared tracking store.
- It requests foreground location on mount and starts shared tracking only after the Start action.
- Pre-start shows distance, time, pace, GPS, Free Run, optional route, and Start Running.
- Like Hiking, route selection is descriptive only during activity; no full selected route or route-following engine is rendered once running.
- Active metrics are distance, elapsed time, current pace, and GPS status.
- The active map is intentionally non-interactive (`scrollEnabled`, `zoomEnabled`, `rotateEnabled`, and `pitchEnabled` are false), unlike Hiking.
- Running quick-plants a personal cairn directly through `useMarkerStore`; it does not enter `Plant`.
- Finish opens a screen-local save-name sheet and then shared `stopTracking`; stopped state shows an atmospheric hero, mini trace, metrics, share, View Activity, and Done.
- No `UnfinishedRecoveryModal`, disk scan, or save-loss listener is hosted by Running. Home routes an unfinished run back to `Running`, but Running initializes to `pre`; therefore a user-facing run recovery path is absent.

## Shared tracking / persistence evidence

- Both production screens call `useKeepAwake()` unconditionally for their full mounted lifetime. Running simultaneously renders “Screen locks automatically” in pre-start, so the implemented device behavior and visible promise conflict.
- `useTrackingStore.startTracking`: creates local id/state, starts a server session, initializes JSONL persistence, monitors battery/network, requests foreground/background location, and activates exactly one foreground or background source based on `AppState`.
- `backgroundLocationTask.ts`: TaskManager source feeds the same tracking ingestion path when background permission is available.
- Store filters reject poor accuracy, teleports, stationary drift, and Hiking overspeed; it retains raw/clean/smoothed tracks.
- Pause stops active sources and duration; resume restarts the appropriate source; stop performs map matching when possible, Memory conversion, atomic remote save with idempotency, local save, and pending-sync fallback.
- `hikeTrackWriter` and app hydration retain evidence across process death. Recovery UI parity is incomplete because only Hiking consumes it.
- `startTracking` has no early `idle` guard. It resets stale listeners later, but a fast duplicate invocation can create a second local/server session before cleanup.
- Hiking guards long stop/save with `savingHike`; Running’s local save sheet closes before asynchronous `handleStop` and has no equivalent visible save lock, leaving a double-submit/state ambiguity risk.

## Map initialization and theme evidence

- `app/package-lock.json`: `@rnmapbox/maps` 10.3.1 and `mapbox-gl` 2.15.0.
- `app/app.json`: managed Expo plugin `@rnmapbox/maps` with `RNMapboxMapsImpl: mapbox`; foreground/background location descriptions and iOS background location mode are present. No checked-in native projects lock a lower-level iOS/Android Mapbox SDK version.
- `mapbox.ts:initMapbox`: token comes from `EXPO_PUBLIC_MAPBOX_TOKEN`; native telemetry is disabled. The token value was not inspected or recorded.
- `getMapStyleForTheme`: Outdoors resolves to `mapbox://styles/mapbox/standard`; Satellite resolves to `mapbox://styles/mapbox/satellite-streets-v12`.
- The header comments in `useMapTheme.ts` and the older resolver comment in `mapbox.ts` still describe Outdoors/Sunset JSON/dark-v11 switching. That documentation is stale and contradicts the active resolver immediately below, which returns Standard for every non-satellite theme.
- `buildStandardConfig`: applies `lightPreset` Day→`day`, Sunset→`dusk`, Night→`night`; `theme:'faded'`; `font:'Spectral'`; 3D objects/buildings/facades/landmarks/trees and transit labels off; pedestrian roads on.
- `StyleImport` is present in HikingMap, both Running maps, MapHistory, RouteEditor, MemoryMap, and Plant pin adjustment. Satellite skips the Standard import and therefore remains visually stable across themes.
- `mapbox.ts` retains Outdoors/Streets/navigation-night/dark URLs and a bundled sunset JSON as legacy fallbacks, but active theme resolution does not select them.
- A silent boot-time offline pack named `cairn-nz-warmup` attempts a broad NZ bounds cache at zoom 5–10. There is no user-managed offline-region/download UI in the audited activity screens.

## Map data / overlay evidence

- `HikingMap`: live trace `#3F5D37`, width 5; uncertain gap uses `Colors.textMuted` dashed; approach to route start uses caution color dashed; debug puck uses `#1E88E5` + white. All are theme-stable.
- `RunningScreen`: live trace `#7A9830`, width 5; default Mapbox user location; no activity cairn layer and no selected-route line. Theme-stable.
- `MapHistoryScreen`: track color is activity-derived, width 7; gaps use `Colors.textMuted`, width 5 dashed; nearby markers use `MARKER_META` colors.
- `RouteEditorScreen` + `DualLineLayer`: recorded original is muted gray; confident edited geometry uses shared primary; approximate uses caution; straight interpolation uses danger.
- `MARKER_META` / `FLAG_TYPES`: danger, junction, water, hut/cairn, and note colors are intrinsic semantics and do not adapt to time.
- `MemoryMap` + `FogLayer`: fog fill and two edge passes use true three-theme semantic tokens; its custom user puck remains white/blue. Cairn pins have tier/ownership semantics separate from activity traces.
- No activity-screen Fog layer, friend trace, public trace, clustering, terrain/DEM layer, sky layer, or custom base-cartography layer is active. Standard’s intrinsic top-down shading remains; 3D features are explicitly disabled.

## Map ownership

- **Mapbox-owned base:** land, roads, paths, water, labels/POIs, and Standard environmental lighting. CairnNZ configures the Standard import but does not own a custom live style JSON.
- **CairnNZ-owned map data:** traces, approach/start markers, cairn/mark annotations, Memory fog and pins, editor confidence geometry.
- **CairnNZ-owned chrome:** Back, GPS state, metrics, Start/Pause/Resume/Finish/Cairn, route picker, bottom trays, sheets/modals, permission/loading/offline/unavailable/recovery states.

## Dialog evidence

- `HikingScreen` uses product-native `Alert.alert` for catastrophic local-save recovery (Retry/Discard) and for deleting a cairn from `MarkDetailSheet`.
- `useTrackingStore` uses `Alert.alert` for one-time background-location education (Later/Open Settings).
- Hiking and Running use CairnNZ `TooShortSheet` and `PermissionDeniedModal` for normal activity recovery.
- Hiking uses bespoke `StopSummarySheet`; Running uses a separate manual save-name sheet. `UnfinishedRecoveryModal`, `TooShortSheet`, and `StopSummarySheet` still contain local sheet/scrim implementations rather than the accepted shared shell.
- No `Alert.alert` appears in active `RunningScreen` itself.

## Dependency evidence

- **Trails:** both activity screens read `useRouteStore` directly. Routes/activities/cairns are surfaced in `RoutesScreen`; details open `MapHistory`; activity traces can enter `RouteEditor` via Save as Route. Trails does not currently start Hiking/Running with a route param. Activity can therefore converge independently, while shared route/map rules will reduce Trails/detail rework.
- **Memory:** shared `stopTracking` calls `flushHikingToMemory` for both activity modes, then saves the session. Memory’s own live map is separate. Activity trace, user position, fog, and cairn semantics need a deliberate cross-map contract, but Memory need not copy activity chrome.
- **Details:** `MapHistoryScreen`, `RouteEditorScreen`, and `MarkDetailSheet` reuse the same basemap resolver, trace/marker semantics, and map-adjacent actions; a shared activity/map authority first will reduce later detail divergence.
- **Settings:** units, appearance, haptics, and Memory foreground-GPS behavior affect activity presentation or surrounding map behavior. `mapLayer` persists and is consumed by Hiking/MapHistory, but no active Settings control for it was found. Voice guidance/off-route threshold persist in the store but have no active screen consumer because route following is unwired.

## Runtime evidence boundary

`app/scripts/activity-map-authority-audit-qa.mjs` renders active production screens at 390×844 with controlled in-memory fixtures. On Web, both production activity implementations intentionally avoid loading `@rnmapbox/maps`, so captures prove app chrome, state transitions, and the authored unavailable-map state—not native tiles or GL overlays. Native cartography conclusions in this audit are code/config facts and require a later device evidence gate before visual implementation.
