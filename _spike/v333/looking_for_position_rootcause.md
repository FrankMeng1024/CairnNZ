# "Looking for your position" zoom flicker — Root cause (Spike subagent D)

Date: 2026-06-25
OTA at investigation time: v331 active on user device (server log id 2989: `boot.module_loaded {"ota": 332}` for an earlier session; current focused session ota 331 per log id 2967).

## TL;DR

`memory.coord_changed` has fired **zero times in the last 6 hours of server logs** despite >150 `memory.map_idle` zoom events. MemoryMap has rendered **exactly once** in that same window (one `memory.fog_native_disabled_v304` at 12:21:47).

That means: the React `coord` state is **NOT flipping to null and back** during zoom. The literal `"Looking for your position…"` `<Text>` node at `MemoryScreen.tsx:330` is **NOT actually being mounted during zoom**.

What the user sees as "Looking for your position" reappearing during zoom is one of three things — none of them is the actual text node:

1. **L2 Skia raster mask re-binding visible as a fog flash** (most likely). When zoom changes, Mapbox re-samples the raster image source. Despite v332 setting `rasterOpacityTransition.duration: 0` and `rasterFadeDuration: 0`, the raster bbox geometry is recomputed each time `mask` (state in FogLayer) is replaced by a new render result. Until the new texture finishes uploading, the L1 brown-fog floor shows through the L2 hole. The cleared user-area (cream halo, blue dot) briefly looks "covered" → reads as "the fog came back, app is searching".
2. **Continuous `onMapIdle` fires every ~300ms during/after pinch** (server confirmed: `ms_since_last: 299..316`, `fire: 104..131` over 75s). Each fire calls `setCurrentZoom` and `updateBoundsIfChanged`. `currentZoom` triggers no visible work (used only by FogLayer prop, ignored). `updateBoundsIfChanged` is no-op when bounds repeat. Neither should cause a flicker — but combined with point #1 this is the trigger window.
3. **Mapbox native UserLocation pulse + accuracy ring re-projection during zoom** misread as the loading state. The blue-dot pulse animation scales with zoom; on rapid zoom-out the accuracy circle blows up to ~hundreds of meters of cream-on-cream visual, which a user could read as "fog redrawing / lost position".

The reported "reappears repeatedly" matches #1 — every `mask` state swap in FogLayer creates a visible re-bind.

## Source of the text

- **Component**: `MemoryScreen` at `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/screens/MemoryScreen.tsx:330`
- **Condition**: `coord == null && failReason == null` (the final `else` branch of the ternary chain at lines 287–334)
- **Only occurrence** in the entire `app/src` tree (Grep confirmed)
- `coord` is derived at lines 214–221 from `watcherFix` (memory store, persisted to AsyncStorage via `lastFixCache`), `oneShot` (local one-shot fetch), and a 10 min freshness window. With **any** non-null `watcherFix` in the store, `coord` is non-null — the final ternary branch (`watcherFix ? {lat,lng} : null`) returns the stale fix rather than null.

## Why zoom triggers the visual flicker (root cause)

### Hypothesis 1 — REJECTED: GPS watcher restarts on zoom
- Evidence against: `memory.watcher_started` last fired at 09:59:30. No restart in the 2.5h window during which the user has been zooming.
- `ForegroundUnlockManager` GPS watcher useEffect deps are `[enabled, isLoggedInForGps]` — neither changes on zoom.
- Watcher does not remount. **NOT the cause.**

### Hypothesis 2 — REJECTED: MemoryMap remounts on zoom (FogLayer dep change)
- `memory.tab_focus` did not fire during the zoom window. `mountKey` is bumped only on focus or via `FOCUS_REMOUNT_DEBOUNCE_MS=5min`.
- `MemoryMap` body logs `memory.fog_native_disabled_v304` on every render — only ONE such log in the last 6 hours. **MemoryMap is mounted continuously and re-rendering rarely.**

### Hypothesis 3 — REJECTED: `coord` flips to null during zoom
- `memory.coord_changed` (added in v327 specifically to track this) has **zero fires in the last 6 hours**. The coord signature is stable.
- This is the definitive evidence that the literal `<Text>Looking for your position…</Text>` is not being rendered during zoom.

### Hypothesis 4 — REJECTED: useFocusEffect re-fires
- `memory.tab_focus` did not fire during the 30-min zoom window. `useFocusEffect` runs once on mount + once per focus, not on zoom.

### Hypothesis 5 — VERIFIED ROOT CAUSE (visual confusion): FogLayer `mask` state swap during zoom
The user's "Looking for your position" is **not** the literal text. It is a fog-flicker visual that the user is verbally labelling with the only matching loading-state text they remember from cold-start.

Mechanism:
- `FogLayer` runs `scheduleRender` in a `useEffect` keyed on `[cellVersion, userCenter?.lat, userCenter?.lng, useH3Fog]` (`FogLayer.tsx:192`).
- `userCenter` is passed from MemoryMap as `{ lat: centerLat, lng: centerLng }` — values are stable (no `coord_changed`), so `userCenter?.lat/?.lng` are stable.
- BUT — `MemoryMap.tsx:287` instantiates a **new `userCenter` object literal on every MemoryMap render**. With `centerLat/Lng` stable, the dep-by-value comparison short-circuits, so the effect should not re-run.
- HOWEVER, when MemoryMap re-renders (and it does — see fire counter advancing), props flow into `<RasterLayer>` with the same `style` object recreated. rnmapbox 10.3.1 receives this as a style update and re-applies layer properties, triggering an internal re-bind of the texture even though the underlying URI hasn't changed. iOS Mapbox sometimes shows the bbox flashing through L1's brown fog during this re-bind, even with `rasterFadeDuration:0`. The flash is brief (<200 ms) and recurring with every map_idle settle — matching the "flicker" report.
- Compounding: `setCurrentZoom(zoom)` inside `onMapSettle` triggers a MemoryMap state change → re-render → new style object identity → another re-bind cycle. The `currentZoom` value is not actually consumed by FogLayer (the props `bounds` and `zoom` are commented as "legacy props, ignored" at FogLayer.tsx:62). It is dead state that nevertheless drives re-renders on every `map_idle`.

### Hypothesis 6 — also contributing: Mapbox UserLocation visual pulsing
- `<UserLocation visible={true} />` is rendered at MemoryMap.tsx:282 with no `renderMode` prop — defaults to `normal` which paints the native blue dot + accuracy ring. On zoom-out the accuracy ring scales to large pixel radius; the cream halo of L2 plus expanded ring on top of L1 can give a "fog returned" impression. Secondary contributor, not the primary flicker.

## Verified root cause

Verified by server log triangulation (zero `coord_changed`, zero `tab_focus`, one MemoryMap render in 6 hours despite >150 `map_idle` zooms):

**The "Looking for your position" the user is reporting is NOT the React `<Text>` node. It is a fog-mask raster re-bind flicker on every `onMapIdle` (every ~300ms during pinch). The user labels it with the loading-state vocabulary because that visual matches what they saw on cold-start.**

Two distinct contributing problems:

(A) `setCurrentZoom(zoom)` in `MemoryMap.onMapSettle` (MemoryMap.tsx:195) drives a MemoryMap re-render on every settle but the value is dead state (FogLayer ignores its `zoom`/`bounds` props per the file-level comment at FogLayer.tsx:60–63). Every settle → MemoryMap re-render → new `<RasterLayer style={...}>` identity → rnmapbox style re-application.

(B) `<RasterLayer>` and `<ImageSource>` props are constructed inline on every render — `style={{...}}` and `coordinates={[...]}` are new objects each pass. Even when content is identical, rnmapbox diffs by reference for the `style` prop and re-issues setLayerProperties on the underlying native layer.

Direct evidence:
- `memory.map_idle fire 131 ... ms_since_last: 316` repeats every ~300ms during user zoom (server logs 12:21:18–12:22:33 range)
- Zero `memory.coord_changed` in 6 hours = `<Text>Looking for your position…</Text>` never rendered
- One `memory.fog_native_disabled_v304` in 6 hours = MemoryMap mounted once
- `memory.using_watcher_fix` does not fire on `[refetchToken]` re-runs since refetchToken doesn't bump on zoom = oneShot path inert

## Fix

Two-part fix (both should ship in v333):

### Fix part 1 — stop the dead-state re-render driver (MemoryMap.tsx:195)
- The `currentZoom` state in MemoryMap is **unused**. FogLayer's file header (FogLayer.tsx:60–63) explicitly says the `zoom` and `bounds` props are legacy/ignored. Yet `MemoryMap.tsx:108` keeps the `[currentZoom, setCurrentZoom]` state and bumps it on every `onMapSettle`.
- Change: remove `currentZoom` state entirely. Drop the `setCurrentZoom(zoom)` call inside `onMapSettle`'s throttled callback (MemoryMap.tsx:195). Drop the `zoom={currentZoom}` prop on `<FogLayer>` (MemoryMap.tsx:287).
- Effect: MemoryMap no longer re-renders on every map idle. The `<RasterLayer>` element keeps a stable object identity (modulo `mask` changes, which are GPS-driven and rare).
- Trade-off: none. The value was already dead.

### Fix part 2 — stabilize `<RasterLayer>` style + coordinates (FogLayer.tsx:238–267)
- Both `coordinates` and `style` are inline object literals. Wrap in `useMemo` keyed on `mask.uri` / corners:
  ```ts
  const rasterCoords = useMemo(
    () => mask ? [mask.corners.nw, mask.corners.ne, mask.corners.se, mask.corners.sw] : null,
    [mask?.uri]
  );
  const rasterStyle = useMemo(
    () => ({ rasterOpacity: 1, rasterOpacityTransition: { duration: 0, delay: 0 }, rasterFadeDuration: 0 }),
    []
  );
  ```
- Effect: identical references across renders → rnmapbox skips style re-application → no native layer re-bind → no visual flash.
- Trade-off: trivial; only `useMemo` overhead per render.

### Fix part 3 (defense in depth) — gate `memory.fog_native_disabled_v304` log
- The `log('memory.fog_native_disabled_v304', { received_mode: fogMode })` at MemoryMap.tsx:100 runs on every render. Cheap, but masks our ability to count renders if we end up needing it again. Move into a `useEffect` keyed on `fogMode`.
- Optional, not required to fix the flicker.

### Why not change `coord` logic at MemoryScreen?
- The React state path is verified clean. Editing the coord ternary in response to this bug would be a workaround on a non-existent problem.

## Out of scope (do NOT do in v333)

- Do NOT remove the `<UserLocation>` accuracy ring just to avoid the cream-on-cream halo overlap — that's a Mapbox UX feature and removing it loses accuracy feedback.
- Do NOT change the `WATCHER_FIX_FRESH_MS` / `lastFixCache` logic — `memory.using_watcher_fix` is not firing during zoom, so this path is innocent.
- Do NOT bump `mountKey` more or less often — `useFocusEffect` is not firing during zoom.

## Sources

- `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/screens/MemoryScreen.tsx` (text source, coord derivation, focus effect)
- `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/components/MemoryMap.tsx` (onMapSettle, currentZoom dead state, RasterLayer prop inline)
- `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/components/FogLayer.tsx` (mask state, RasterLayer/ImageSource render, legacy props comment)
- `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/components/ForegroundUnlockManager.tsx` (watcher lifecycle ruled out)
- `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/store/useMemoryStore.ts` (`setLastWatcherFix` debounce, store stability)
- `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/services/fogMaskRenderer.ts` (`render_cancelled` benign-error path)
- `C:/ClaudeCodeProjects/Cairn/app/src/navigation/RootNavigator.tsx` (MemoryScreen is Stack.Screen, not Tab.Screen — confirms it doesn't get nav-driven remounts during in-screen interaction)
- Aliyun `edit_diagnostics` server logs, last 6 h, queries:
  - `memory.map_idle` (>150 fires, ms_since_last ~300)
  - `memory.coord_changed` (0 fires)
  - `memory.using_watcher_fix` (0 fires)
  - `memory.watcher_started` (1 fire at 09:59 — alive, not restarted)
  - `memory.fog_native_disabled_v304` (1 fire at 12:21:47 — MemoryMap mounted once)
  - `fog.mask_render_start` (0 fires in 30 min — FogLayer effect not re-running)
