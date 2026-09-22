# Hike / Run recording UI system

Status: O42 native-review candidate. Activity Detail is intentionally unchanged.

## Authorities studied

- `docs/VISUAL_SYSTEM.md`, `docs/VISUAL_MIGRATION_STATE.md`, `docs/VISUAL_ASSET_MANIFEST.json`, and the visual QA boards.
- Home and Auth for brand restraint, navigation, type hierarchy, artwork ownership, and semantic themes.
- Friends for the strongest example of extending Home/Auth into a denser product workflow without creating a second visual language.
- Existing Hike/Run maps, Activity state contracts, Cairn actions, themes/tokens, and Simulator overlay contracts.

## CairnNZ DNA applied

- The map is the main canvas; chrome floats above it and remains compact.
- Identity is quiet: Hike/Run and recording state sit in one centered header, while Back and GPS health remain immediately legible.
- One dominant metric and two supporting metrics replace the previous equal-weight dashboard treatment.
- One strong action leads each state. Secondary actions remain visible but restrained; critical recording actions are never hidden in a disclosure tray.
- Existing semantic Day, Sunset, and Night surfaces, ink, borders, shadows, scrims, and action tokens are reused. Run retains the existing activity-blue identifier; Hike follows the current theme primary.

## Shared recording hierarchy

`ActivityRecordingChrome` provides the common family:

- `ActivityTopChrome`: navigation, mode/state identity, GPS state, ranked metrics, and at most two concise notices.
- `ActivityStartDock`: route selection, truthful location/background readiness, and the large Start action.
- `ActivityControlDock`: visible recording state plus Pause/Resume, Cairn/Plant, and Finish.
- `ActivityRecenterButton`: one consistent reachable map control.

Hike prioritises active time, then distance and elevation. Run prioritises live pace, then distance and active time. Hike retains Full Plant; Run retains Quick Cairn. Their business semantics are unchanged.

## State treatment

- Pre-start: map-first, route choice and readiness grouped with Start. Foreground-only background permission is disclosed with a Settings path; the UI does not claim background recording is available.
- Tracking: primary metric is glanceable in sunlight; Pause is the strongest reachable action. Cairn and Finish remain visible.
- Paused: amber boundary and state copy make the hold unmistakable; Resume becomes primary while Finish remains deliberately secondary.
- GPS degraded/lost: the existing Normal/Poor/Lost/Frozen contract is translated into a compact GPS status plus a short notice, not a diagnostic dashboard.
- Unfinished/recovery and Finish continue to consume the durable existing state contract and established recovery/summary sheets.

## Mapbox treatment

- Accepted canonical segments remain the live route authority; gap boundaries remain unconnected.
- A semantic casing makes the route readable across map styles. Hike uses theme primary; Run uses existing activity blue.
- Mapbox attribution/logo positions clear the recording chrome. Recenter uses the shared control.
- If the map surface is unavailable, copy truthfully states that GPS recording can continue rather than implying the Activity has stopped.

## Debug and Simulator

Debug OFF has no Simulator presentation. Debug ON remains an overlay; the core engine and all provider/canonical semantics are frozen. Overlay positions were adjusted only to avoid the new recording dock.

Replay controls now state that the value is replay time acceleration, not physical movement speed. All existing choices are directly reachable: 1×, 2×, 5×, 10×, 30×, 60×, and 120×. No new speed engine or multiplier was introduced.

## Validation

- Automated source contracts cover shared chrome, visible controls, mode-specific metric hierarchy, GPS/background truth, Mapbox trace styling, Run recenter wiring, and Simulator replay labels.
- Expo Web QA captured Hike pre-start/tracking/paused/degraded and Run pre-start/tracking/paused in Day/Sunset/Night at 390×844, plus 360×640 compact and 430×932 tall cases.
- 25/25 layout checks passed with no clipping/collision and no browser runtime errors.
- Interaction QA exercises both route pickers, Hike and Run Pause→Resume, and Finish→Cancel recovery.

## Human native-review items

- Confirm real Mapbox labels/trails/terrain, attribution placement, route/casing contrast, puck relationship, and recenter behavior on device; Web uses the intentional non-native map fallback.
- Confirm one-handed reachability and safe-area behavior on the human's phone.
- Confirm Hike Full Plant, Run Quick Cairn, unfinished recovery, keyboard/sheets, poor/lost GPS presentation, and debug-overlay coexistence in a native build.
- Judge final visual character across Day/Sunset/Night. This document records a candidate, not final visual approval.
