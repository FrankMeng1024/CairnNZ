# First iPhone review — Hike and Run only

This is one small review, not whole-app acceptance. Do not begin until the installed candidate is identified.

## Version prerequisite

1. On Home, retain a screenshot showing the existing **O56** marker.
2. In Settings → Help & About/About, retain app version **0.2.6** and build **56** if shown.
3. The ordinary UI does **not** expose the Expo update ID. If available from the owner’s existing EAS/update record, retain update ID `01a09c0e-993b-759b-95e8-084f1f45238f`; otherwise record `UPDATE_ID_UNKNOWN`.
4. If any displayed identity differs, stop and classify the review as `BLOCKED_BY_VERSION_IDENTITY`. Publication alone does not prove the phone loaded it.

Use a safe short route, adequate battery, normal permissions, and no sharing/public/destructive/commercial actions.

## Group 1 — Recording chrome and native map in three appearances

**Prerequisites:** identified build, safe outdoor/known location, Hike and Run available.  
**Steps:** For Hike and Run, inspect Ready then a short Recording state in Day, Sunset, and Night. Do not change global design settings mid-hazard. Check map, route reference if one is safely available, puck, metrics, GPS state, Mapbox logo/info, Back, Pause/Cairn/Finish.  
**Expected:** controls and selected/unselected states remain distinct; route/puck/basemap do not collapse; legal controls do not overlap core actions; Sunset/Night text remains legible.  
**Retain:** one full-screen Ready and one Recording screenshot per appearance/mode, plus version identity.  
**Proves:** current installed native composition. **Does not prove:** long-duration GPS, background behavior, NZ generalization, or user acceptance of Details.

## Group 2 — Pause/Resume and Finish→Cancel state truth

**Prerequisites:** one safely active Hike and Run with movement.  
**Steps:** Pause; open Finish; Cancel; verify still paused. Resume once, then tap Resume repeatedly only if the UI still permits it; observe one transition. Open Finish while recording; Cancel; verify recording continues. Move again and observe timer/location/route progress together. If a too-short sheet appears while paused, record whether **Continue** preserves paused or resumes—do not assume.  
**Expected:** regular Cancel preserves exact prior state; one Resume transition; Finish/Back stay available during recovery; time/location recover coherently.  
**Retain:** screenshots before Finish, in confirmation, after Cancel, and after subsequent movement; note timestamps and mode.  
**Proves:** current physical interaction/lifecycle presentation. **Does not prove:** source silence, background Core Location, long offline recovery, or every race.

## Group 3 — Clean Path and Raw GPS only if Debug is genuinely reachable

**Prerequisites:** a visible authorized Debug entry in this exact installed build. If absent, record `BLOCKED_BY_BUILD_GATE` and stop this group. Do not unlock it or search for a hidden gesture.  
**Steps:** Use the actual current UI mode names **Clean Path** and **Raw GPS**. Run one scenario in each mode separately; retain seed, observation timing, delivery timing, and mode. Include stationary-with-continuing-fixes and complete-source-silence as separate cases if the UI supports them.  
**Expected:** simulated provider is explicit; source observations, canonical acceptance, and UI state are not conflated.  
**Retain:** mode screen, seed/settings, and resulting diagnostic state.  
**Proves:** simulator/diagnostic contracts only. Frozen ground truth with continuing observations differs from stopping all simulator output. Stationary does not prove source health; no new canonical point does not prove source loss. Simulation cannot prove real Core Location background, low-battery, or NZ field behavior.

## Group 4 — Finish landing and bounded Trails check

**Prerequisites:** a short personal test Activity whose creation is acceptable to retain; do not delete production history.  
**Steps:** Finish normally. Confirm the current **Activity Detail** opens for that Activity. Review name, stats, route/sync/refinement language, Cairns, actions, and Back. Then Home → Trails → Activities → open the same Activity → Back. If a personal Route already safely exists, Trails → Routes → Detail → Back; do not delete/edit it.  
**Expected:** newly finished and historical entry reach the same Activity object/Detail; Back is predictable; existing promises match actual state.  
**Retain:** finish landing, Trails row, reopened Detail, and version identity.  
**Proves:** landing/navigation consistency on this candidate. **Does not prove:** Activity/Route Detail final design acceptance, durable final worker, mutation error handling, or full-history pagination.

## Current-state observations only

Memory and Activity/Route/Cairn Details are not final acceptance tasks in this first review. Do not treat seeing them as approval. Do not test real friend-location access, non-owner sharing, Memory reset, account deletion, purchases, feedback submission, export jobs, public reporting/hiding, or production mutations. Missing Debug/device/permission capability makes only the affected row UNVERIFIED; it does not invalidate the local audit.
