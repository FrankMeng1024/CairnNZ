# Activity P0 root-cause and fix evidence

## Evidence standard

`PROVEN` means the old source path directly demonstrated the contradiction/gap or the controlled fixture reproduced it. Native behavior that cannot be established in Expo Web is separately marked pending device verification.

## 1. Contradictory operational UI

**Cause confidence:** PROVEN
**Evidence:** `HikingScreen.tsx` previously owned a local `phase` in addition to `useTrackingStore.status`; its active branch tested `!isTracking`, so a paused store could render a Start family while the paused action tray was also present. Running similarly used local `runState` for major branches. Controlled Paused captures now assert zero `Start Hiking` / `Start Running` controls.
**Fix:** `activityOperationalState.ts` derives one mutually exclusive UI state from tracking status, finish lock, recovery, summary, and start error. Both screens consume it; live tracking/session truth takes precedence over local completion presentation.
**Why minimum safe:** Pure interpretation only; no additional store or tracking-engine rewrite.

## 2. Duplicate Start

**Cause confidence:** PROVEN
**Evidence:** The previous `startTracking()` had no entry guard and performed asynchronous work before an authoritative shared lock prevented another caller.
**Fix:** The store now checks idle/not-finishing and synchronously sets `status: 'requesting'`; later calls return `false`. The focused store test proves a locked start never invokes `startSession`.
**Why minimum safe:** Guard is at the common mutation boundary used by both screens; it does not rely on button timing.

## 3. Start readiness and failure

**Cause confidence:** PROVEN
**Evidence:** The old no-location and permission-denied paths explicitly set `status: 'tracking'` with `locationAvailable: false`; the general catch only marked location unavailable after other resources had started.
**Fix:** Foreground permission is proven before creating writer/server/monitor resources; Tracking is entered only after a real source is active. Failure rolls back created resources and returns a typed retryable error. A late remote-session response is either attached to the same live local session or deleted.
**Why minimum safe:** Reorders and guards the existing lifecycle without replacing GPS filtering, background tasks, writer, or save logic.
**Native limitation:** Permission, poor-GPS, and background-start outcomes need physical-device verification.

## 4. Duplicate Finish / save

**Cause confidence:** PROVEN
**Evidence:** The previous `stopTracking()` had no store-boundary in-flight guard, so two callers could enter the async stop/save pipeline.
**Fix:** A synchronous `isFinishing` lock rejects later calls; the too-short branch releases it. The focused rapid-stop test observes one remote shell deletion and a rejected second pipeline.
**Why minimum safe:** One flag at the shared boundary protects all callers and leaves existing atomic save/fallback behavior intact.

## 5. Running unfinished recovery

**Cause confidence:** PROVEN
**Evidence:** Disk metadata already persists `activity_mode`; Hiking scanned/hosted `UnfinishedRecoveryModal`, while Running had no corresponding scan or host. Controlled QA now seeds separate Hiking and Running files and renders the correct recovery label for each.
**Fix:** `activityRecovery.ts` filters by exact mode and owns shared restore/discard mechanics. Running now hosts the existing recovery modal; Hiking uses the same adapter.
**Why minimum safe:** Reuses the mature disk writer and existing recovery surface rather than duplicating or rewriting recovery.

## 6. Save-loss recovery parity

**Cause confidence:** PROVEN
**Evidence:** `saveLostPayload.activityMode` can identify either mode, but only Hiking hosted the SAF-01 retry/discard affordance. Running could retain the durable marker without presenting a resolution.
**Fix:** Running hosts `useActivitySaveLossRecovery('running')`, which hydrates the existing marker and exposes its existing retry/discard operations. A module guard prevents two mounted screens from stacking alerts.
**Why minimum safe:** Adds the missing host and leaves save payload, pending sync, and retry semantics unchanged.
**Later UX:** The native Alert is a correctness-oriented last-resort surface and remains a product-dialog migration item.

## 7. Keep-awake contradiction

**Cause confidence:** PROVEN
**Evidence:** Both production screens invoked unconditional `useKeepAwake()`; Running simultaneously rendered “Screen locks automatically.” Background tracking is separately owned by the location task.
**Fix:** Removed the screen-level wake locks from both activity screens.
**Why minimum safe:** It removes only the contradictory presentation-layer power policy and does not touch the background tracking task.
**Native limitation:** Actual lock-screen recording continuity requires device verification.

## 8. Foreground/background and cold recovery

**Cause confidence:** PROVEN for the code-path gap; native outcome pending
**Evidence:** The old recovery resume changed status and restarted one location source plus duration. After process death, module-owned app-state listener, background drain, incremental backup, monitors, auto-pause, and token refresh were absent.
**Fix:** A cold resume establishes a real source first and then rebuilds those runtime owners. Failure preserves the session Paused instead of claiming Tracking. Normal pause/resume does not duplicate the runtime owners.
**Why minimum safe:** Extends the existing resume boundary only when its module-level app-state owner is absent; the core tracking algorithms remain unchanged.

## 9. Running map readiness

**Cause confidence:** PROVEN
**Evidence:** Hiking used load callbacks and semantic loading/unavailable feedback; both Running MapViews lacked an equivalent state/callback path. Web QA reproduced the unavailable state for both screens.
**Fix:** Running now records loading/ready/unavailable from the existing MapView callbacks and uses `StateSurface` for ambiguous failure/loading cases.
**Why minimum safe:** Adds state visibility only; map style, camera, route, overlay, and interaction logic are untouched.

## 10. Mapbox attribution and wordmark

**Cause confidence:** PROVEN
**Evidence:** Active Hiking and Running MapViews explicitly set `logoEnabled={false}` and `attributionEnabled={false}` while using Mapbox cartography. Mapbox’s current attribution guidance requires the wordmark and attribution; the repository does not provide an approved alternative attribution implementation.
**Fix:** Re-enabled the SDK’s built-in logo and attribution on all active activity MapViews and positioned them around existing chrome.
**Why minimum safe:** Uses the vendor-owned compliant mechanism; no base style, token, telemetry setting, map data, or overlay changed.
**Native limitation:** Visibility, safe placement, and attribution interaction require physical-device verification.

## 11. Product confirmations

**Classification:**

- Background-location OS permission: SYSTEM / OS INTENTIONAL.
- Background-location education `Alert`: PRODUCT EDUCATION — LATER MIGRATION; not a P0 correctness blocker.
- Hiking/Running save-loss Retry/Discard `Alert`: CORRECTNESS SAFETY FALLBACK — LATER AUTHORED-SURFACE MIGRATION.
- Hiking Cairn deletion `Alert`: PRODUCT CONFIRMATION — LATER MIGRATION. Cairn/Plant behavior is `GLOBAL PRODUCT AUDIT REQUIRED`.
- Too-short, permission-denied, unfinished-recovery, and stop-summary surfaces: existing CairnNZ-authored product UI.

No broad dialog redesign was performed in P0.

## 12. Activity versus Route and adjacent domains

The tracking store records factual Activities. It does not make a P0 claim that an Activity is a Route or that a Route replaces an Activity. Any conclusion involving Route creation/selection, route following, Trails, Activity History, Plant/Cairn behavior, Memory, Fog product semantics, or Settings is `GLOBAL PRODUCT AUDIT REQUIRED`.

## QA evidence

Generated visual outputs below are local-only and ignored by Git. Recreate
them with `node app/scripts/activity-p0-reliability-qa.mjs`; the tracked JSON
and test contracts remain the durable evidence.

- `activity-p0-runtime-board.jpg`: actual production screens at 390x844 with controlled in-memory states.
- `runtime-evidence.json`: state list, paused-control assertion, mode-isolation assertion, and runtime errors.
- `activityOperationalState.test.ts`: exclusive-state/invariant checks.
- `activityP0Contract.test.ts`: both-screen contract, recovery host, wake-lock, store guard, and Mapbox ornament guard.
- `useTrackingStore.test.ts` (`P0 operation guards`): shared start and finish boundary tests.
