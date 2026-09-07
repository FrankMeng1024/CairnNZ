# Free Activity contract

Audit date: 2026-09-06
Repository authority: current working tree at `master` / `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c`

This is a focused, read-only product feasibility finding. It does not approve a visual design and does not activate Route following.

## Evidence language

- **FACT** — directly proven by active code, storage, API, schema, navigation, or tests.
- **HUMAN INTENT** — locked by the audit request; implementation may differ.
- **INFERENCE** — strongly suggested, but not explicitly encoded.
- **DORMANT / FUTURE** — present in code but outside the ordinary Free Activity flow.

Feasibility grades:

- **A — DIRECTLY SUPPORTED**
- **B — SUPPORTED WITH SMALL CHANGE**
- **C — REQUIRES ARCHITECTURE CHANGE**
- **D — CONFLICTS WITH CURRENT PRODUCT MODEL**
- **E — PRODUCT DECISION REQUIRED**

## Executive contract

**FACT:** CairnNZ already has one recording domain. `useTrackingStore` owns a single live session with `activityMode: 'hiking' | 'running'`; the backend `sessions.type` uses the same two modes. Hike and Run are separate screen compositions over that shared Activity lifecycle, not separate persisted products.

**FACT:** “Free Hike” and “Free Run” currently mean `selectedRoute === null`. They are explicit user-facing choices, but not an explicit persisted `startContext`. Selecting a Route currently changes ready-state labels and, for Hike, can show an approach line to its first point; neither screen connects the selection to `followingRouteId`, sends Route identity into `startTracking`, or persists Route origin on the completed Activity.

**Verdict:** the proposed model is fundamentally compatible:

```text
Activity = factual record
Hike / Run = Activity mode
Free / Route = start context
```

Current Free Activity itself is **PARTIAL as a first-class code concept** and **fully viable as the current no-Route recording path**. Making `startContext` explicit later is a small additive contract change. Making a Cairn retain durable Activity provenance is a separate schema/reconciliation architecture change.

## Proposed product contract

The following is the recommended contract for the implementation pass, subject to the open product decisions below.

1. **HUMAN INTENT:** entering Hike or Run from Home without a Route starts in the Free context.
2. **FACT / target-compatible:** Start creates one stable local Activity identity and begins the shared GPS writer.
3. **HUMAN INTENT:** the ready surface is map-led, states “Free Hike” or “Free Run,” communicates GPS readiness accurately, and has one dominant Start action. Zero metrics need not be prominent before Start.
4. **FACT / target-compatible:** during recording, both modes share lifecycle semantics and data ownership: time, distance, trace, elevation gain, GPS status, background switching, persistence, pause/resume, finish locking, recovery, and save fallback.
5. **HUMAN INTENT:** presentation differs by mode: Hike emphasizes elevation; Run emphasizes pace. This does not create separate data models.
6. **HUMAN INTENT:** Hike is map-interactive with a recoverable follow state. Run is follow-first and low-interaction; temporary Run Explore behavior remains unapproved.
7. **HUMAN INTENT:** Tracking exposes Pause; Paused exposes Resume and Finish. Start never reappears while Paused.
8. **FACT / target-compatible:** insufficient recordings are not saved as Activities. The user can keep recording or discard them.
9. **Recommended target:** a successful save produces a local Activity before navigation, then opens Activity Detail using the stable local ID. Pending server sync does not block review.
10. **HUMAN INTENT:** Activity Detail is the post-record review surface and the natural home for optional “Save as Route.” Route remains a separate object.
11. **HUMAN INTENT:** a Cairn created during an Activity may optionally retain origin-Activity provenance; deleting either Activity or Cairn never reverses personal Memory/Fog.

## Decision-by-decision feasibility

| Proposed decision | Grade | Evidence-backed conclusion |
|---|---:|---|
| Activity is the factual record; Hike/Run are modes | **A** | One shared tracking/session model and one backend sessions table already encode this. |
| Free/Route is start context | **B** | Free already equals no selected Route, but start context and Route identity are not passed to or persisted by the recorder. |
| Free Hike / Free Run work without Route selection | **A** | `selectedRoute` starts `null`; Start calls the shared recorder without a Route requirement. |
| Map-led ready state with one Start action | **B** | Layout already has this shape. De-emphasizing zero metrics is presentation-only; GPS copy/state needs correction. |
| One shared operational shell contract without one giant screen | **B** | Shared state/recovery primitives exist; stat rows, action trays, GPS/map readiness, and completion orchestration are duplicated. |
| Hike: time, distance, elevation priority | **A** | These values are already collected and rendered. |
| Run: time, distance, pace priority | **A** | Pace is already derived from shared duration/distance with unit awareness. |
| Hike pan/zoom/explore then Recenter | **A** | Active Hike releases follow on a user gesture and has an imperative Recenter action. Rotate/pitch are also enabled today. |
| Run follow-first, low-interaction | **A** | Active Run map is non-interactive and camera-following. |
| Optional future Run Explore → Recenter | **E**, then **B** | Product approval is required. Once approved, it is a bounded map-control change, not an Activity architecture change. |
| Shared Tracking → Paused → Finish lifecycle contract | **A/B** | Store and derived operational state already support it; screen presentation and completion differ. |
| Natural screen lock with background tracking | **A**, native validation required | No active screen holds a keep-awake lock. Shared AppState/background location handles both modes when permission is granted. |
| Activity Detail as standard completion destination | **B** | Detail accepts the captured local ID and falls back to local points offline. Completion must verify the local Activity exists before navigating and show pending sync honestly. |
| Save as Route belongs in Activity Detail | **A** conceptually/current UI | It is already there and accepts local trace points. Route persistence is online-only and provenance is absent. |
| Full Plant from Hike | **A** current behavior, **B/C** for polished activity flow/provenance | The flow is active; tracking continues. The user lands on Marker Detail and must go Back to Hike. Durable Activity association is absent. |
| Quick Cairn from Run | **A** current behavior, **C** for durable provenance | One local-first personal Cairn is created from the current coordinate and linked only in local Activity state. |
| Optional durable Cairn → Activity association | **C** | A stable local Activity ID exists, but marker API/schema and local-to-server reconciliation do not preserve it. |
| Activity/Cairn deletion must not reduce personal Memory | **A** for current deletion behavior | Memory points are separate and neither delete path removes them. Explicit Reset Memory remains a separate destructive action. |

## Current Free Hike journey

1. The Home Hike action opens `Hiking` with no parameters. Free Hike is selected because the screen-local Route selection is `null`.
2. The screen immediately requests/reads foreground location, primes a current fix, loads Routes, and mounts `HikingMap`. It shows zero distance/time/elevation plus a GPS item, Free Hike identity, and Start Hiking.
3. Start sets mode to hiking. The shared store synchronously reserves a local Activity ID, requests required foreground permission, starts the crash-safe writer, attempts a server session, and starts location sources.
4. The map follows the user. A pan, zoom, rotate, or pitch gesture releases follow; Recenter flies back to the current coordinate and restores follow.
5. The action tray reveals Pause, Cairn, and Finish. Pause freezes the timer and location sources; the same control becomes Resume. Finish remains available.
6. Cairn opens the three-step Plant flow. Activity tracking is not paused by navigation. The user locks GPS, adjusts the pin, enters category/content/privacy, and plants. Success opens Marker Detail; Back returns to the still-active Hike.
7. A valid Finish pauses recording and opens a Hike Complete/name sheet before persistence. Closing the sheet resumes. View Activity performs the stop/save and navigates to Activity Detail.
8. A too-short Finish opens a shared sheet: keep going or end/discard. Discard returns the recorder to ready and creates no Activity.
9. If server save fails but local queue persistence succeeds, the Activity is kept locally as pending. A hard queue/storage failure presents Retry/Discard recovery.

## Current Free Run journey

1. The Home Run action opens `Running` with no parameters. Free Run is selected because `selectedRoute` is `null`.
2. The ready screen mounts a Mapbox map, primes foreground location, loads Routes, shows zero distance/time/pace/GPS, Free Run identity, Route None, Start Running, and “Screen locks automatically.”
3. Start sets mode to running and invokes the same shared recording store/writer/backend session path as Hike.
4. During recording the camera follows at zoom 16. The map view is pointer-disabled and all active gestures are disabled. The action tray exposes Pause/Resume, Cairn, and Finish.
5. Cairn quick-plants a personal, empty-note `cairn` at the latest tracking coordinate. It is saved locally first, shows a brief toast, and stores the current local session ID only on the local Marker plus the Marker ID on the live Activity.
6. A valid Finish opens a name sheet without first pausing. While that sheet is open the timer/GPS can continue changing. Cancel keeps running; Save stops and persists the Activity.
7. The screen then shows a separate Run Complete page with distance/time/pace, a static trace preview, Share, View Activity, and Done. View Activity opens Activity Detail; Done returns Home.
8. A too-short Finish offers keep going or discard. Current Run code moves to Run Complete after discard even though no Activity exists; View Activity then falls back Home. This is confusing current behavior, not a product rule.

## Target journeys in product language

### If we designed Free Hike correctly, the user experience would be…

1. From Home, the user chooses Hike and arrives on a map clearly labeled Free Hike.
2. The screen quietly confirms whether location and the map are ready. Start is the single obvious action; empty statistics do not compete for attention.
3. Once started, the user sees elapsed time, distance, elevation gain, and GPS health. The map follows by default but can be explored; Recenter always returns to the current position.
4. Pause changes the journey into a clear paused state with Resume and Finish. Start never reappears.
5. Leaving a Cairn uses the approved Hike Cairn flow, keeps the Activity recording safely, and makes the return to the live Hike explicit.
6. Finish freezes the recording, lets the user review/name it, and saves exactly once. A too-short attempt clearly offers Continue or Discard.
7. The saved Activity opens immediately for review, even if it is waiting to sync. Its trace, Hike identity, metrics, and Cairns are trustworthy.
8. Save as Route is optional and happens from Activity Detail; it does not change what the Activity recorded.

### If we designed Free Run correctly, the user experience would be…

1. From Home, the user chooses Run and arrives on a map clearly labeled Free Run.
2. Location readiness is unambiguous, and Start is the one dominant action.
3. Once started, the screen stays follow-first and low-interaction. Time, distance, pace, and GPS health are immediately legible while the phone can naturally lock.
4. Pause becomes Resume, with Finish available only as part of the active/paused lifecycle—not as a second Start flow.
5. Leaving a Cairn follows the approved low-cost Run pattern and provides unmistakable saved/pending feedback.
6. Finish freezes the metrics before naming or confirmation. Save happens once; a too-short discarded Run never shows a false completion.
7. The saved Activity opens directly in Activity Detail, including a Run-appropriate pace presentation and clear pending-sync state when offline.
8. Saving a reusable Route remains an optional later action from that Activity.

## Settings that materially affect this journey

| Setting/authority | Actual user effect | Finding |
|---|---|---|
| Appearance (`auto/day/sunset/night`) | Changes screen, sheet, icon, and map theme families | **FACT — ACTIVE** |
| Units (`metric/imperial`) | Changes distance/elevation and Run pace units | **FACT — ACTIVE** |
| Date format | Affects shared date formatting in summary/detail, but the recorder’s default name still hardcodes `DD/MM/YYYY` | **FACT — PARTIAL / contradiction** |
| Haptic feedback | Gates Start, tray, Cairn, Finish, and confirmation haptics | **FACT — ACTIVE** |
| Map layer | Hike and Activity Detail honor outdoors/satellite; Run hardcodes outdoors and has no visible ordinary control | **FACT — PARTIAL / competing behavior** |
| OS foreground location | Required to start a genuine Activity | **FACT — ACTIVE platform authority** |
| OS background location | Enables lock-screen/app-background continuation; denial is non-fatal while foregrounded | **FACT — ACTIVE platform authority** |
| Memory always-on GPS | Runs a separate foreground location cache; it does not control Activity recording or directly write Memory | **FACT — not an Activity setting** |
| Debug mode / simulator | Injects QA movement and alters Activity gating/track behavior | **FACT — DEV/QA ONLY** |

Dormant voice guidance and off-route settings are not part of Free Activity.

## Confirmation and modal inventory

| Surface | Hike | Run | Classification |
|---|---|---|---|
| OS foreground/background permission dialogs | Yes | Yes | **OS INTENTIONAL** |
| One-time background education Alert | Shared; copy says “hike” | Shared; copy still says “hike” | **NATIVE / DEFAULT PRODUCT UI; confusing for Run** |
| PermissionDeniedModal | Yes | Yes | **GOOD CURRENT UX; duplicated host** |
| UnfinishedRecoveryModal | Yes | Yes | **GOOD CURRENT UX; shared component, divergent discovery** |
| TooShortSheet | Yes | Yes | **GOOD CURRENT UX; Run discard transition is confusing** |
| Hike StopSummarySheet | Yes | No | **FUNCTIONALLY CORRECT BUT “Complete” appears before save** |
| Run name sheet | No | Yes | **FUNCTIONALLY CORRECT BUT DUPLICATED; recording is not frozen** |
| Run Complete page | No | Yes | **GOOD standalone surface but duplicates Activity Detail and can appear after discard** |
| Save-loss Retry/Discard Alert | screen-local legacy implementation | shared P0 host | **DUPLICATED; NATIVE / DEFAULT PRODUCT UI** |
| Plant steps + save errors/offline notice | Via Hike | Not used by quick Cairn | **ACTIVE; return path and Memory copy need clarity** |
| Activity Detail two-tap delete | Post-save | Post-save | **FUNCTIONALLY CORRECT; destructive scope does not affect Memory** |

## Product decisions still required (maximum five)

1. **Question:** Which Cairn interaction contract should Hike and Run use?
   **Options:** A: Hike Full Plant / Run Quick; B: both Full Plant; C: shared simplified flow; D: Run Quick plus post-Activity enrichment.
   **Product impact:** interruption cost, content quality, privacy clarity, and whether Activity Detail becomes a Cairn-management step.
   **Why code cannot answer:** all four can be implemented; current divergence is historical, not encoded product authority.

2. **Question:** Should successful Free Activity always open Activity Detail, or may the user choose Home?
   **Options:** Detail always; Detail primary plus explicit Done/Home; mode-specific behavior.
   **Product impact:** strength of the Activity object, review completion, and number of post-stop surfaces.
   **Why code cannot answer:** Hike and Run currently embody different choices and both are technically viable.

3. **Question:** Should Run ever permit a deliberate temporary Explore mode?
   **Options:** remain fully locked; explicit Explore then Recenter; limited gestures after pause only.
   **Product impact:** safety/attention versus situational map utility.
   **Why code cannot answer:** current locking proves implementation, not user intent.

4. **Question:** When an originating Activity is deleted, should a Cairn merely lose its link or retain a non-navigable “created during a deleted Activity” provenance record?
   **Options:** `ON DELETE SET NULL`; retain immutable origin metadata without a live relationship.
   **Product impact:** history language and data minimization.
   **Why code cannot answer:** no relationship exists today; the human rule only forbids Cairn deletion by cascade.

## One-pass implementation scope recommendation

### Must do now

- Formalize one shared operational presentation contract over the existing store: Ready, Starting, Tracking, Paused, Finishing, Recovery, Error.
- Make ready-state GPS truth accurate and keep map readiness separate from location readiness.
- De-emphasize pre-start zero metrics while preserving the existing calculations.
- Preserve Hike interactive follow/recenter and Run follow-first behavior.
- Make Pause/Resume/Finish presentation identical in lifecycle semantics.
- Freeze both modes before naming/confirmation; remove Run’s live-changing finish sheet behavior.
- Make the save operation return/verify a local Activity ID before navigation; on hard local-save failure remain in recovery.
- Use Activity Detail as the common completion destination if the product owner confirms Decision 2; add Run pace and visible pending-sync truth there.
- Fix Run too-short discard so it never presents Run Complete or a View Activity action.
- Converge Hike and Run save-loss hosting on the shared P0 recovery implementation.

### Should do now

- Extract shared stat-strip and action-tray presentation contracts with mode-provided metric and Cairn callbacks.
- Normalize the one-time background education copy for Activity mode.
- Decide and implement one Cairn option with an explicit return-to-Activity contract.
- Show exact Activity-created Cairns only if durable association is approved and implemented; do not continue implying proximity equals association.
- Make Run honor the same active map-layer authority as Hike, or explicitly document a Run-specific fixed-map product rule.

### Future Route-based extension

- Add explicit `startContext: free | route` and nullable `plannedRouteId` to the Activity start/save contract.
- Route both contexts through the same recorder and completion destination.
- Preserve planned-versus-actual data separately.
- Add Route provenance to generated Routes if approved.

### Future navigation

- Route following, off-route detection, thresholds, voice, turn guidance, and waypoint announcements remain dormant and must not be activated by this pass.

### Do not touch

- Route picker/redesign, Trails information architecture, Memory visual system, global Settings redesign, route-following services, voice guidance, off-route behavior, subscription, Friends, or dormant navigation.

## Native OTA test requirements

The implementation pass cannot be accepted on Expo Web alone. Validate a development/OTA candidate on physical iOS and Android:

1. Hike and Run: rapid double Start and rapid double Finish produce one Activity only.
2. Foreground permission: allow, deny, deny-and-open-Settings, and later grant.
3. Background permission: Always/Allow all the time, While Using, and denied; verify honest copy.
4. Lock the screen for several minutes in each mode; verify timer/trace continuity after unlock.
5. Background/foreground repeatedly, including rapid transitions, low-power mode, and an incoming call/navigation interruption.
6. Pause, lock, unlock, Resume, and Finish; verify paused time/distance do not accrue.
7. Kill the app during Hike and Run; relaunch through Home and direct mode entry; Continue and Discard.
8. Finish online, offline, with a server failure, and with local queue/storage failure; verify no blank Activity Detail.
9. Open newly saved pending Activity Detail immediately; verify local map/metrics and later sync reconciliation.
10. Too-short Continue and Discard in both modes; verify no false completion.
11. Hike interactive pan/zoom/rotate/pitch and Recenter; Run locked/follow behavior; Mapbox unavailable/offline tiles.
12. Screen auto-lock behavior: confirm no keep-awake assertion in either mode.
13. Approved Cairn option: create online/offline while tracking, background during Plant, return to Activity, sync ID replacement, edit/delete, and Activity deletion survival.
14. Metric and naming behavior in metric/imperial, all appearance modes, and each date format.
