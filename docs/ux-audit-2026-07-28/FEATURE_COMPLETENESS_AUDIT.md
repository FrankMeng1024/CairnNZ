# Feature Completeness Audit — 2026-07-28

**Codebase**: `C:\ClaudeCodeProjects\Cairn\app\src\`
**OTA baseline**: O16 (with in-flight O17 edits per `git status`)
**Audit type**: code-only walk-through (Playwright unavailable — Expo web at `localhost:19006` and Metro at `:8081` both returned HTTP 000)
**De-duplication against**: `FUNCTION_AUDIT.md`, `EDGE_HUNT.md`, `CROSS_REVIEW.md`, `CONSISTENCY_REPORT.md`, `COPY_AUDIT.md`, `LAUNCH_CHECKLIST.md`, `DATA_FLOW_AUDIT.md`, `PERFORMANCE_AUDIT.md`, `USER_HUNT.md`, `SCREENSHOT_QA_SUMMARY.md`, `FINAL_REPORT.md`, and the 12 per-screen `AUDIT.md` files in `docs/ux-audit-2026-07-28/*/`.
**Focus**: *NEW* gaps/inconsistencies not already surfaced by those reports.
**Editorial rule**: list, do not fix. Cite file:line for every finding.

Legend for IDs: `MP` = missing piece · `IC` = inconsistency · `EC` = edge case not handled · `CP` = copy inconsistency.

---

## 1. Executive Summary

**Features audited**: 30 (all listed in the prompt).
**NEW gaps found (not already in existing audits)**: **147** (MP: 62 · IC: 41 · EC: 30 · CP: 14).
**Playwright screenshots produced**: 0 (Expo web + Metro not running).
**Code-cited findings**: 100% cite file:line.

### Top 10 NEW gaps (this audit only — see LAUNCH_CHECKLIST/FINAL_REPORT for the previously catalogued 44 Blockers)

1. **No first-run onboarding at all** (`RootNavigator.tsx:88-91` jumps `Auth` → `Home` directly; grep for `Onboarding|firstRun` returns zero matches in `app/src`). New user lands on Home with zero explanation of what "Kia ora, Explorer", "Leave a Cairn here", or "Memory" mean. **Blocker for launch UX.** *(MP-3-01)*
2. **No age gate at signup** (`AuthScreen.tsx` grep for `age|dateOfBirth|COPPA` = 0 matches). Any age can register; Cairn stores GPS = COPPA / regional data-privacy exposure. *(MP-1-06)*
3. **`RunningScreen` has no pause** — only Start → Stop. `pauseTracking`/`resumeTracking` from `useTrackingStore` are wired into `HikingScreen.tsx:92-93` but never imported by `RunningScreen.tsx` (only `startTracking`, `stopTracking`; grep confirms). Runners who need to answer a phone lose their session integrity. *(IC-5-01, parity vs Hiking)*
4. **No sharing at all for hikes/routes** — `expo-sharing` is imported ONLY in `DebugScreen.tsx:17` and `Share.share` is called ONLY in `features/memory/components/CairnPinsLayer.tsx:281`. There is no "Share this hike", "Share route", "Share marker (as user-facing action outside memory-cairn-share)". No screenshot-of-map export. *(MP-22-01)*
5. **No data export beyond debug session ZIP** — `AuthScreen.tsx:389` promises "Portability: export your track history as GPX at any time" (part of the privacy body copy shown at register). The word "GPX" appears in exactly one place — that marketing bullet. There is no GPX/CSV/JSON export UI, no route export, no `expo-file-system` write-to-share for hike data. **The app promises portability it does not deliver.** *(MP-23-01, Blocker for App Store submission because it's a false promise in the register/privacy text)*
6. **No photo attachment on markers/plants/hikes** — `expo-image-picker` is imported ONLY in `services/debugUpload.ts:27` (for debug screenshot upload). `ContentStep.tsx` (plant flow content step) does not allow the user to attach a photo. `MarkerDetailScreen.tsx` has no photo section. `PlantScreen`/`HikingScreen` never call the camera. UI has "cairn" markers with no image — but user expects a photo. *(MP-24-01)*
7. **No push notifications infrastructure** — `expo-notifications` used only inside `autoPauseMonitor.ts:89-90` for local auto-pause. No permission request flow (grep `Notifications.requestPermissions` = 0 matches for a user-facing prompt), no APNs registration, no `getDevicePushTokenAsync`, no server delivery. Friend-request-received? Silent. *(MP-18-01)*
8. **`AuthScreen` has no forgot-password flow** — grep `forgot|reset.password` = 0 matches anywhere in `app/src`. This duplicates F-AUTH-04 from FUNCTION_AUDIT but is worth restating: launching without password reset is a support-load bomb. *(MP-1-01 · already partly caught)*
9. **`Memory` screen has no way to share your fog-of-war** — user's proudest artifact in the app (their explored area) has no export, no screenshot, no "share your map" affordance. `features/memory/screens/MemoryScreen.tsx` grep for `share|export` returns zero matches. *(MP-12-04)*
10. **`MarkerDetailSheet` (compact) is functionally divergent from `MarkerDetailScreen` (full)** — the sheet has NO edit action, NO permission chip, NO public-snapshot banner, NO type-badge; only note text + delete. Same marker feels like two products depending on entry path. *(IC-11-01)*

---

## 2. Feature-by-Feature Breakdown

Each section notes: file paths, cross-cutting checks (Home reachability, offline, empty/error/loading, unmount, backgrounding, session expiry, analytics, network graceful degradation, hitSlop 44pt, dark mode), and NEW findings.

---

### FEATURE 1 · Auth (Sign In / Sign Up / Verify / Sign Out / Delete Account / Apple / Google / Password change)
**Screen(s)**: `app/src/screens/AuthScreen.tsx` (1149 lines).
**Store(s)**: `app/src/store/useAppStore.ts`; `app/src/services/credentialsStore.ts`.
**Service(s)**: `app/src/services/authService.ts`; `app/src/services/tokenStore.ts`.
**Playwright evidence**: none (server down).

**Missing pieces**
- MP-1-01: No Forgot Password link/flow — `AuthScreen.tsx` grep `forgot|reset` = 0. (Also in FUNCTION_AUDIT F-AUTH-04; restated for completeness.)
- MP-1-02: No email-verification resend cooldown state feedback beyond the 60s tick on Verify screen (`AuthScreen.tsx:783`). Nothing tells user "we sent a new code" if backend silently fails.
- MP-1-03: No "Terms & Conditions" checkbox on register — only privacy body block (`AuthScreen.tsx:389`). Guideline 1.2 (UGC) requires acceptance.
- MP-1-04: No password strength meter on register (`AuthScreen.tsx:1030`); only "Min. 8 characters" placeholder.
- MP-1-05: No multi-account / account-switcher (a single JWT lives in SecureStore under `cairn_jwt`).
- MP-1-06: No age gate at signup — grep `dateOfBirth|birthday|age` = 0 in `AuthScreen.tsx`. COPPA exposure.
- MP-1-07: No "Sign in with email link" (magic-link) option — verification email is code-only.
- MP-1-08: No CAPTCHA / rate-limit visibility on signup — client burst-taps hit backend rate limiter with generic error.
- MP-1-09: The sign-out network call is fire-and-forget (comment at `SettingsScreen.tsx:1119-1124`); no "logout completed on server" confirmation.

**Inconsistencies**
- IC-1-01: On the register screen the branding is "Kia ora" via `getGreeting()` in HomeScreen (Home only); AuthScreen shows only "Cairn" + wordmark animation. First-time NZ user sees no Māori greeting until they've already made an account.
- IC-1-02: `AuthScreen.tsx:1132-1145` renders both Google + Apple stubs on iOS; both are `Alert.alert('Coming soon')`. On Android, HIG doesn't require Apple, but code renders both platforms identically. No `Platform.OS` split. (Related to F-AUTH-01/02; new observation is the platform-uniform bug.)
- IC-1-03: Field `email` validation regex `AuthScreen.tsx:44 /^[^\s@]+@[^\s@]+\.[^\s@]+$/` (FriendsScreen) vs no regex in Auth login (`AuthScreen.tsx:577`). Same product, two different email-validity contracts.

**Edge cases not handled**
- EC-1-01: `AuthScreen.tsx:646` — `saveCredentials` SecureStore failure silently swallowed (already in F-AUTH-12; edge is: user then thinks "Remember me" is on and doesn't notice next launch).
- EC-1-02: `AuthScreen.tsx:512-524` opportunistic legacy-key clear happens only on AuthScreen mount; dormant users who never revisit AuthScreen keep the plaintext key forever.
- EC-1-03: `promptGoogleAsync` hardcoded stub — if a future OTA re-enables Google without also updating the AuthScreen consumer, the button silently no-ops.
- EC-1-04: Verify-code screen (`AuthScreen.tsx:897`) accepts 6 digits; on paste of longer numeric string, no truncation feedback — user thinks paste worked but only first 6 chars register.

**Copy**
- CP-1-01: Register privacy block promises "Portability: export your track history as GPX at any time" (`AuthScreen.tsx:389`). No GPX export exists anywhere in-app. Legally binding false statement.
- CP-1-02: Coming-soon copy differs: Apple = `'Coming soon' | 'Apple Sign In is not available yet. Please use email login for now.'` (`AuthScreen.tsx:1135`); Google = `'Google Sign In' | 'Coming in next app update. Please use email sign-in.'` (`AuthScreen.tsx:452`). Mixed "app update" vs "yet"; mixed "email login" vs "email sign-in".

---

### FEATURE 2 · Onboarding (First-run)
**Screen(s)**: (none — this feature does not exist).
**Playwright evidence**: n/a.

**Missing pieces**
- MP-2-01: No onboarding flow at all — grep for `Onboarding|firstRun|Welcome|onboard` returns 0 matches inside `app/src/screens/**`. RootNavigator jumps `Auth → Home` (`RootNavigator.tsx:88`).
- MP-2-02: No permission-priming screen — the unified permission request happens 800ms after Home mounts (`HomeScreen.tsx:337-360`) with **no explanation** of *why* Cairn needs GPS. Native iOS dialog fires cold. Apple HIG recommends a pre-permission rationale screen.
- MP-2-03: No product tour of Home tools (Trails / Friends / Memory / Settings) — user has to guess what each pill means.
- MP-2-04: No demo hike / "try it out" mode.
- MP-2-05: No "meet your first cairn" tutorial explaining what a cairn is.

**Inconsistencies** — n/a (feature absent).

**Edge cases not handled**
- EC-2-01: If iOS denies location permission on the cold prompt (from `HomeScreen.tsx:349`) the app never re-asks and never explains. Downstream Hiking/Plant screens re-request only when `canAskAgain=true`.

**Copy**
- CP-2-01: The Home greeting mixes English + Māori ("Kia ora, Explorer") without ever teaching the user the word. First-time user with no cultural context reads it as gibberish.

---

### FEATURE 3 · Home
**Screen(s)**: `app/src/screens/HomeScreen.tsx` (647 lines).
**Store(s)**: `useSessionStore`, `useMarkerStore`, `useTrackingStore`.
**Service(s)**: `appLog`, `bootDiagnostics`.
**Playwright evidence**: none.

**Missing pieces**
- MP-3-01: No affordance for users who have zero data (no hikes yet) to see a "start your first hike" primary CTA — the Hiking card is one of three equal ActivityCards (`HomeScreen.tsx:458-495`). New user cannot tell which is the recommended starting action.
- MP-3-02: `pendingBanner` (line 428) shows "N hikes pending sync" but has no tap-target — user cannot tap it to see which hikes are pending or trigger a retry.
- MP-3-03: No pull-to-refresh on Home. Sessions/markers only refresh via natural store subscription.
- MP-3-04: No stats history — `statsRow` (line 440) shows total sessions + flag count, but there is no "week", "month", "year" toggle even though hiking-app norms include it.
- MP-3-05: No "streak" surfaced (X days in a row). The greeting says "Kia ora, Explorer" but never rewards consistency.
- MP-3-06: No offline banner on Home — pending banner shows only for `syncState === 'pending'|'syncing'`, not for the actual "you are offline right now" condition.

**Inconsistencies**
- IC-3-01: `RecentRow` (`HomeScreen.tsx:53-156`) has two branches (live-tracking / last-activity-within-24h). The live branch shows distance + duration; the recent branch shows distance OR duration depending on `last.distanceM > 10`. Same row, two very different data densities.
- IC-3-02: `ActivityCard` for Plant has `flex={0.4}` (`HomeScreen.tsx:494`) which visually diminishes it; but on very small screens the label wraps and looks broken. Hiking + Running are `flex=1`.
- IC-3-03: Tools row (`HomeScreen.tsx:499-504`) uses icons "Route / Users / Map / Settings2" — "Memory" is labelled but iconized as `Map`, which duplicates the *concept* of "Map" (there is no top-level Map entry, but the icon reads as "Map" not "Memory").

**Edge cases not handled**
- EC-3-01: `insetsReady` (`HomeScreen.tsx:269-283`) has a 250ms fallback timer for iPhones with `insets.bottom=0`. If insets never populate AND the timer misses (JS-thread starvation), the user sees a blank cream screen indefinitely — no crash, no recovery UI.
- EC-3-02: `useEffect` at line 337 requests foreground location 800ms after mount. If user backgrounds Home during that 800ms window and returns after 10 minutes, the effect still fires on the delayed timer — potentially in an app-suspended state — with no explicit `AppState.active` gate.
- EC-3-03: The `validSessions` filter (line 123) drops sessions where `distanceM===0 && durationS===0`. Sessions where the user *walked but had bad GPS and no distance recorded but did have duration* still surface — but the copy conditional at line 135 (`distanceM > 10 ? distance : formatDuration`) shows the duration only for those. Mixed messaging.

**Copy**
- CP-3-01: `Colors.severityWarning` amber pill "Enable GPS" (`HikingScreen.tsx:722`) and Home's pending banner use identical warning aesthetic — user cannot tell "waiting for GPS" apart from "pending sync" at a glance.
- CP-3-02: Greeting variants at lines 38-40 use "Kia ora, Explorer / Good afternoon, Explorer / Good evening, Explorer". Only morning is Te Reo; the design intent (per code comment) is "occasional Te Reo touch" but the placement makes it feel like the app forgot to translate afternoon/evening.

---

### FEATURE 4 · Hiking
**Screen(s)**: `app/src/screens/HikingScreen.tsx` (1432 lines); `app/src/screens/HikingMap.tsx` (504 lines); `app/src/screens/StopSummarySheet.tsx` (248 lines); `app/src/screens/CompassNeedle.tsx`; `app/src/components/TooShortSheet.tsx`; `app/src/components/UnfinishedRecoveryModal.tsx`.
**Store(s)**: `useTrackingStore.ts` (1937 lines).
**Service(s)**: `backgroundLocationTask.ts`, `hikeTrackWriter.ts`, `autoPauseMonitor.ts`, `batteryMonitor.ts`, `sessionRecorder.ts`, `sessionService.ts`.
**Playwright evidence**: none.

**Missing pieces**
- MP-4-01: No manual "Add note" during hike — a user cannot annotate mid-hike ("saw a fantail here") without stopping and planting a flag. Not the same UX.
- MP-4-02: No planned-route comparison mid-hike — you can select a Free / saved route (`HikingScreen.tsx:590-591`) but during tracking there is no "you have deviated X meters from route" chip.
- MP-4-03: No accuracy meter chip during hike — `locationAvailable` is boolean-only; no GPS accuracy_m surfaced. `signalLost` chip (line 566) fires at 120s of gap but no continuous quality display.
- MP-4-04: No total-ascent-remaining if a route is selected.
- MP-4-05: No "share live location with a friend" feature (see also MP-14-05 for Friends).
- MP-4-06: No auto-lap markers (every 1 km) — even the running-app parallel gets locked-screen stats but no lap.
- MP-4-07: No manual Pause button on the map surface. Pause is only reachable **via Stop → summary sheet → dismiss (which resumes)**. This is confusing (comment `HikingScreen.tsx:88-93` acknowledges "the gap is simply treated as signal loss in the recorded track"). The user cannot voluntarily pause without hitting Stop.

**Inconsistencies**
- IC-4-01: Route-selection filter uses `TOO_FAR_M = 25_000` meters (`HikingScreen.tsx:795`) — hard-coded. `RunningScreen` route picker does not apply the same filter (no `TOO_FAR_M` in that file).
- IC-4-02: Compass sensor default is off (`HikingScreen.tsx:160` — "lid closed"). Running has no compass at all. Same activity family, different feature sets.
- IC-4-03: "Free Hiking" (`HikingScreen.tsx:591`) vs "Free Run" (`RunningScreen.tsx:201`) — parallel-but-different phrasing.
- IC-4-04: Live map recenter FAB imperative pattern (`HikingScreen.tsx:125`) exists in Hiking. Running has no equivalent — user cannot recenter to their live position.

**Edge cases not handled**
- EC-4-01: `unfinishedRecoveryModal` disk-scan runs 800ms after Hiking mount (`HikingScreen.tsx:234`). If the user is inside sim-walker mode with a mid-hike jetsam kill, the sim state doesn't write to disk (comment 279-283) → no recovery.
- EC-4-02: `signalLostFor > 120_000` (line 566) — during an actual 2h summit ridge with no GPS, the pill says "signal lost 120min ago" (`signalLostMin`) but the user still sees `locationAvailable=false` and Start button greyed. Confusing dual signals.
- EC-4-03: Save-Hike-Atomic malformed response validated (`sessionService.ts:247-255`) but response-shape divergence not surfaced to user — Alert says generic message.
- EC-4-04: Pause-during-`stopTracking`-flush race: `StopSummarySheet.tsx:63` guards against double-dismiss but does not guard against re-triggering pauseTracking during the 15s save window.

**Copy**
- CP-4-01: TooShortSheet says "Got it" / "End anyway" (used in `HikingScreen` and `RunningScreen`) — but the copy in the sheet doesn't tell the user *how* short is too short (threshold: <2 GPS points, per `useTrackingStore` too-short pre-check).
- CP-4-02: Recovery modal talks about "unfinished hike" but the underlying store's `activityMode` may be "running" — the modal doesn't dynamically say "unfinished run".

---

### FEATURE 5 · Running
**Screen(s)**: `app/src/screens/RunningScreen.tsx` (943 lines).
**Store(s)**: `useTrackingStore.ts` (shared with Hiking).
**Service(s)**: same GPS pipeline.
**Playwright evidence**: none.

**Missing pieces**
- MP-5-01: **No Pause action** — `RunningScreen.tsx` imports only `startTracking, stopTracking, setActivityMode` (lines 121-122 and 118). Even after unlock (line 664-698), the "middle button" is Plant, not Pause. Runner who catches breath must Stop → resume = new session.
- MP-5-02: No auto-pause opt-out surface for running.
- MP-5-03: No "target pace" / interval training feature.
- MP-5-04: No heart-rate display (would require HealthKit — flagged in EDGE_HUNT Scenario 7 as N/A, but the feature-gap is real for a "running" screen).
- MP-5-05: No cadence, no vertical oscillation, no advanced running metrics — but the lock screen calls itself a "premium lock screen" (`RunningScreen.tsx:2`).
- MP-5-06: No "New Run" flow from the stopped state routes back to a *pre* state that requires re-tapping Start — no continuous session chain.
- MP-5-07: Locked-mode double-tap-to-unlock (`RunningScreen.tsx:281-294`) requires 2 taps within 500ms. No indicator of "1 more tap" beyond the two dot pips (line 654-657); if the user's finger is cold/wet the second tap timing is fragile.
- MP-5-08: No manual GPS calibration or "wait for GPS" indicator during pre-run — `foregroundGranted` (line 103) is a boolean, no accuracy meter.

**Inconsistencies**
- IC-5-01: Running has no `signalLost` chip. Hiking has one (`HikingScreen.tsx:566`). Parity gap.
- IC-5-02: Running has no compass. Hiking has an on/off compass needle. Parity gap.
- IC-5-03: The stopped-summary card (`RunningScreen.tsx:389-407`) uses **CircleCheck** icon and never mentions Memory gain. Hiking's StopSummarySheet always shows Memory gain (`StopSummarySheet.tsx:112-123`). Parity gap.
- IC-5-04: `handleStop` (line 304-312) uses stopTracking and reads `useTrackingStore.getState().status !== 'idle'` synchronously to decide whether to render `stopped` state — the tracking store might still be `paused` from a too-short pre-check, leading to a `runState='running'` while the user thinks they stopped.
- IC-5-05: Running has a stopped-state landing (`RunningScreen.tsx:369-423`); Hiking navigates back to Home via stopTracking. Two "just completed" experiences.

**Edge cases not handled**
- EC-5-01: `plantCairn` in running (`RunningScreen.tsx:322-349`) drops a `'cairn'` type. Plant flow in Plant screen defaults to `'danger'` (`PlantScreen.tsx:75`). Different silent defaults for the same conceptual "plant".
- EC-5-02: Lock timer clears on tap; if user leaves the screen locked for hours the tap-timer state (`tapCount`, `tapTimer`) is fine, but the pulse animation `Animated.loop` (line 70-75) never stops — potential battery drain on very long runs.
- EC-5-03: Plant toast at line 693 has a 1500ms auto-dismiss but no accessibility announcement.

**Copy**
- CP-5-01: "Free Hiking" vs "Free Run" — same concept, different noun form (`RunningScreen.tsx:201`).
- CP-5-02: "Screen locks automatically" (`RunningScreen.tsx:543`) — user has no idea what that means until it happens.

---

### FEATURE 6 · Map (live)
**Screen(s)**: `app/src/screens/MapScreen.tsx` (1068 lines); `app/src/screens/HikingMap.tsx`.
**Store(s)**: `useMarkerStore`, `useTrackingStore`, `useMemoryStore`, `useMemorySubscriptionsStore`, `useFriendStore`, `useMarkLikeStore`.
**Service(s)**: `offlineMapService.ts`, `markerInteractionService.ts`.
**Playwright evidence**: none.

**Missing pieces**
- MP-6-01: MapScreen shows a "Real Map Available / Build with EAS" fallback (`MapScreen.tsx:100-134`) when `MapView === null`. On the real device this is fine, but there is no offline-map-not-downloaded state distinct from "Mapbox not built".
- MP-6-02: No layer toggle (topo / satellite / hybrid) beyond `getPrimaryMapStyle()` config default.
- MP-6-03: No live weather overlay.
- MP-6-04: No "share my location" overlay for friends.
- MP-6-05: No 3D terrain toggle even though `@rnmapbox/maps` supports it.
- MP-6-06: No search-for-address / find-a-trail input on MapScreen.
- MP-6-07: No breadcrumb of prior sessions overlaid ("show me all my hikes on one map") — MemoryScreen does fog but that is different.

**Inconsistencies**
- IC-6-01: MapScreen's `CreateMarkerSheet` (`MapScreen.tsx:194+`) has a 4-card grid picker for flag type; PlantScreen (`ContentStep.tsx`) has a different picker layout. Two ways to plant a marker, two UIs.
- IC-6-02: MapScreen marker permission chip uses `permIconNames` (`MapScreen.tsx:224`) with keys `personal/group/public`; MarkerDetailScreen uses same keys but different labels ("Just me" vs "Only me"). See CP-6-01.

**Edge cases not handled**
- EC-6-01: MapScreen fallback grid (`MapScreen.tsx:111-131`) positions markers at `col%3 / row/3` with hard-coded fractions — with 20+ markers the pins overlap and become unclickable.
- EC-6-02: MapScreen has no "click on empty map to drop a pin" affordance — user must go through PlantScreen route. Contradicts common map-app expectation.
- EC-6-03: MapScreen note input on CreateMarkerSheet is capped at 50 chars (`MapScreen.tsx:284`) but PlantScreen ContentStep uses `ContentConfig.textMaxChars` (from plantConfig). Same "note" field, different max lengths.

**Copy**
- CP-6-01: "Only me" (`MapScreen.tsx:227`) vs "Just me" (`MarkerDetailScreen.tsx:89`). Same permission, different label.
- CP-6-02: MapScreen: "Plant a Flag" (`MapScreen.tsx:239`); HomeScreen: "Leave a Cairn here" (`HomeScreen.tsx:484`); PlantScreen internally uses "cairn"/"flag" interchangeably; MarkerDetailScreen title: "Cairn not found" (`MarkerDetailScreen.tsx:184`). Four different nouns for the same object across four screens.

---

### FEATURE 7 · Map History (Activities)
**Screen(s)**: `app/src/screens/MapHistoryScreen.tsx` (1737 lines).
**Store(s)**: `useSessionStore`.
**Service(s)**: `sessionService.ts`, `hikeTracksCache.ts`.
**Playwright evidence**: none.

**Missing pieces**
- MP-7-01: No search bar in MapHistory — `grep search|Search|SearchBar` returns 0 in the file. User with 100 hikes cannot find "my hike near Waikanae last winter".
- MP-7-02: No date-range filter — no time filter chips ("Last 7 days / Last month / All time").
- MP-7-03: No activity-type filter ("hikes only / runs only") on the list.
- MP-7-04: No sort control ("recent / longest / most elevation").
- MP-7-05: No batch delete / batch export.
- MP-7-06: No "compare two sessions" mode.
- MP-7-07: No export for individual session (GPX / PDF / image).
- MP-7-08: No rename in-place — session names come from StopSummarySheet's default, no post-hoc rename.
- MP-7-09: No public/private toggle per session (visibility permissions exist for markers, not sessions).
- MP-7-10: No "add a note" retroactively to a completed hike.

**Inconsistencies**
- IC-7-01: Pending banner: MapHistory renders "离线未同步 hike = 纯 placeholder 灰卡" (`MapHistoryScreen.tsx:489` — the code comment) but the presentation is a greyed card with only long-press-to-abandon. HomeScreen pending banner (`HomeScreen.tsx:428`) uses a text summary, no long-press. Same state, two visual languages.
- IC-7-02: Track polyline gap logic (`MapHistoryScreen.tsx:186-206`) uses `GAP_THRESHOLD_MS = 120_000` AND `GAP_DIST_THRESHOLD_M = 200`. HikingScreen (live) uses `SIGNAL_GAP_MS = 120_000` only (no distance). Post-hoc and live are subtly different — a live hike that showed no gap could render as gap in history.
- IC-7-03: Markers on the history map are filtered to bbox-plus-200m (`MapHistoryScreen.tsx:138`). MemoryScreen's revealed-cairn logic uses `UnlockConfig.radiusMeters = 25`. Inconsistent "near-the-track" radii.

**Edge cases not handled**
- EC-7-01: `NativeTrackMap` degenerate-bbox fallback (`MapHistoryScreen.tsx:116-128`) expands to 555m minimum span. For a 3m stationary session (someone tapped Start Hiking then Save 5 seconds later), the map still zooms to a 555m circle centered on nowhere useful.
- EC-7-02: `hasPanned` recenter button (`MapHistoryScreen.tsx:288`) fires from `onRegionDidChange` `isUserInteraction`. On iOS 17 Mapbox 11.x, `isUserInteraction` is sometimes null on programmatic reset — recenter button may never appear.

**Copy**
- CP-7-01: MapHistory session names default to `"Hike — DD/MM/YYYY"` (`StopSummarySheet.tsx:80`). Locale hardcoded to DD/MM. US users see confusion.

---

### FEATURE 8 · Route Editor
**Screen(s)**: `app/src/screens/RouteEditorScreen.tsx` (1149 lines).
**Store(s)**: `useRouteStore.ts`, `useRouteEditStore.ts` (2871 lines!).
**Service(s)**: `routeMatcher.ts`, `LocalRouteExtras.ts`, `LegacyRouteMigrator.ts`.
**Playwright evidence**: none.

**Missing pieces**
- MP-8-01: No route sharing — RouteEditor doesn't offer "share this route with a friend".
- MP-8-02: No route export (GPX/KML) — see MP-23-01.
- MP-8-03: No route difficulty grading UI (though schema likely supports it).
- MP-8-04: No route duplicate ("save as new").
- MP-8-05: No "reverse this route".
- MP-8-06: No offline pack download from within the route editor.
- MP-8-07: No community routes / discover tab. RoutesScreen has a "friends" scope in the sub-tab but no public discover.

**Inconsistencies**
- IC-8-01: RouteEditor imports `snapToRoadAndTrim` (line 33); the Snap warning at line 848 fires only when NOT `isEditing`. Consumers see "snap" applied on new routes but silently skipped on edits.
- IC-8-02: Delete path (line 654) calls `deleteRoute(routeId)` — no confirmation dialog visible in the snippet (contrast with MarkerDetail's `handleDelete` at `MarkerDetailScreen.tsx:157-175` which has a Confirm alert). Parity risk.

**Edge cases not handled**
- EC-8-01: `useRouteEditStore` is 2871 lines. High risk of state-management complexity — no bounds check on route length. A 20,000-point route may blow through JS memory during snap.
- EC-8-02: RouteEditor exit while snap-in-progress: the `snapWarning` at line 848 shows post-hoc; if user Backs out mid-snap the promise leaks.
- EC-8-03: Save with empty name — placeholder is "Route name (required)" (`RouteEditorScreen.tsx:899`) but no blocking validation shown in the excerpt.

**Copy** — none new.

---

### FEATURE 9 · Routes Screen (three-tab: Activities / Routes / Flags)
**Screen(s)**: `app/src/screens/RoutesScreen.tsx` (1476 lines).
**Store(s)**: `useRouteStore`, `useSessionStore`, `useMarkerStore`.
**Playwright evidence**: none.

**Missing pieces**
- MP-9-01: Only the Routes and Flags sub-tabs have Mine/Friends scope (`RoutesScreen.tsx:88-90` comment: "sub-tab used inside Flags and Routes tabs (NOT Activities — v4 §10 binding)"). Activities has no scope at all — user cannot see their friends' activities.
- MP-9-02: No filter for Route tab by distance / elevation / duration.
- MP-9-03: No "download for offline" per route — button absent.
- MP-9-04: No "starred / favourites" bucket.
- MP-9-05: No search bar (repeat of MP-7-01 pattern).
- MP-9-06: `FLAG_FILTERS` at line 51-57 has only 5 categories (`all/danger/cairn/water/junction`) — no filter for `scenic` or other type existing in `markerTypes.ts`.

**Inconsistencies**
- IC-9-01: Segment tab order is `Activities / Routes / Flags` (`RoutesScreen.tsx:73`) — but the URL param `initialTab` in `RootStackParamList.Routes` (RootNavigator) supports `'routes' | 'activities' | 'flags'`. So the tab order and the API-param order differ.
- IC-9-02: Empty states: Routes empty uses `EmptyRoutes` illustration; Activities uses `EmptyRoutes` too (`RoutesScreen.tsx:723`); Flags-Mine uses inline `emptyHero` (line 1049) without a shared illustration. Three empty states, two visual patterns.
- IC-9-03: `MARKER_META` (line 27) vs `MARKER_TYPES` in `config/markerTypes.ts` — legacy/new naming coexists.

**Edge cases not handled**
- EC-9-01: `hasFetchedFriends=false` never flips true if fetch rejects (line 561 comment) — the "friends" scope stays in "Loading friends' routes..." forever.

**Copy** — none new.

---

### FEATURE 10 · Marker Detail (full screen)
**Screen(s)**: `app/src/screens/MarkerDetailScreen.tsx` (657 lines).
**Playwright evidence**: none.

**Missing pieces**
- MP-10-01: No photo section. Marker has no `photoUri` field in the model but a hiking cairn is inherently photo-worthy.
- MP-10-02: No voice-memo playback UI (voiceMemoUri field exists on Marker at `useMarkerStore.ts:51-52` — read by PlantScreen, but MarkerDetailScreen doesn't render a play control).
- MP-10-03: No "get directions" — user cannot navigate TO the marker via Apple/Google Maps handoff.
- MP-10-04: No "who else has liked this" list.
- MP-10-05: No report flow (report exists in `CairnPinsLayer.tsx:266` but only on the Memory map, not on the marker's own detail screen).
- MP-10-06: No comments / discussion under a public marker.
- MP-10-07: No history — "when was this last edited".

**Inconsistencies**
- IC-10-01: Detail screen renders `CairnPin` medallion (`MarkerDetailScreen.tsx:239`). MapScreen renders a hollow `markerPin` circle (`MapScreen.tsx:181`). Same marker, two visuals.
- IC-10-02: Edit / delete buttons are gated by `useOnlineOnly` (`MarkerDetailScreen.tsx:407-411`) with an inline "Needs internet" append. MarkerDetailSheet has no online-gate. Parity gap.

**Edge cases not handled**
- EC-10-01: `isOwner = marker.authorId === userId || marker.authorId === 'local'` (line 202). If `userId` is empty string (logged out mid-session), all local markers appear as owned by the empty string — no owner. Edit/delete disappear silently.
- EC-10-02: The `snapshotBanner` public-divergence banner (line 384) only shows for owner + snap differs. If the snapshot is stale by 2 years, no age indicator.

**Copy**
- CP-10-01: "This cannot be undone" appears in `handleDelete` alert (line 161) and in modal in Settings ("Reset your map memory?" body). Consistent phrasing across two — but the Marker delete alert uses full sentence "It will be removed from your Memory and (if shared) from public view. This cannot be undone." while Settings-reset says "This clears every place you have walked on your map." — inconsistent structure.

---

### FEATURE 11 · Marker Detail Sheet (bottom sheet)
**Screen(s)**: `app/src/screens/MarkerDetailSheet.tsx` (170 lines).
**Playwright evidence**: none.

**Missing pieces**
- MP-11-01: No edit action.
- MP-11-02: No permission chip.
- MP-11-03: No public-snapshot banner.
- MP-11-04: No sync-state indicator (`SyncBadge`).
- MP-11-05: No photo, no voice memo.
- MP-11-06: No online-only gate on delete — a user offline can still tap Delete; the delete propagates via `useMarkerStore` optimistic path, but the sheet doesn't warn.

**Inconsistencies**
- IC-11-01: **Sheet and Screen are two entirely different products** — Sheet is a compact "type badge + note + distance + delete" (`MarkerDetailSheet.tsx:84-133`), Screen is a full edit/permission-manage surface (`MarkerDetailScreen.tsx`). Users tapping on a marker from HikingScreen get the sheet; users tapping via MapHistory / RoutesScreen Flags-tab get the Screen. The choice of which one appears feels arbitrary.
- IC-11-02: Sheet uses `MARKER_META` from `data/mockData` (line 13); Screen uses `MARKER_TYPES` from `config/markerTypes.ts`. Two type registries.
- IC-11-03: Sheet's delete button uses inline two-tap confirm (`MarkerDetailSheet.tsx:66-82`); Screen uses `Alert.alert` modal confirm. Two different destructive-action patterns.

**Edge cases not handled**
- EC-11-01: `hitSlop={10}` on the close chip (`MarkerDetailSheet.tsx:94`) is only 10pt — below Apple HIG 44pt guidance.

**Copy**
- CP-11-01: "Delete Flag" (sheet, line 130) vs "Delete" (screen). Sheet still uses "Flag" language.

---

### FEATURE 12 · Memory
**Screen(s)**: `app/src/features/memory/screens/MemoryScreen.tsx`; components in `app/src/features/memory/components/*.tsx`.
**Store(s)**: `useMemoryStore`, `useMemorySubscriptionsStore`, `useFriendMemoryStore`.
**Service(s)**: `memorySync.ts` (511 lines), `flushHikingToMemory`.
**Playwright evidence**: none.

**Missing pieces**
- MP-12-01: No voice-recording UI within Memory (voice memos live inside markers only).
- MP-12-02: No playback/scrubbing timeline of "when did I explore this".
- MP-12-03: No transcript for voice memos anywhere.
- MP-12-04: **No export/share of Memory** (grep `share|export` in MemoryScreen = 0).
- MP-12-05: No time-lapse / animation of fog reveal.
- MP-12-06: `PaywallSheet` (`features/memory/components/PaywallSheet.tsx:27`) triggers Alert.alert "Coming soon" — the actual paywall path stops here. Already flagged as F-B-07 / L-05 in existing audits; here noted because Memory is the primary consumer.
- MP-12-07: Friend memory subscription cap = 5 (per PaywallSheet comment). No UI to *unsubscribe* one friend without unsubscribing all.

**Inconsistencies**
- IC-12-01: `MysteryCairnSheet` at `features/memory/components/MysteryCairnSheet.tsx:3` shows a distinct sheet for "not-yet-within-25m" markers. `RevealedCairnSheet` is the reveal counterpart. Both differ from MarkerDetailSheet (used elsewhere). Three sheet variants for a single conceptual object.

**Edge cases not handled**
- EC-12-01: `MemoryScreen.tsx:505-506` sets `failReason='permission'` on denied location. No CTA to reopen iOS Settings.
- EC-12-02: Foreground unlock relies on `ForegroundUnlockManager` — no visible progress if unlock is slow.
- EC-12-03: `PaywallSheet` `Alert.alert('Coming soon', ...)` (line 27) doesn't cancel-close the sheet — user is stuck in a paywall they can't dismiss until they tap OK on the alert.

**Copy** — none new.

---

### FEATURE 13 · Plant
**Screen(s)**: `app/src/screens/PlantScreen.tsx` (328 lines); `app/src/features/plant/components/GpsLockStep.tsx`, `PinAdjustStep.tsx`, `ContentStep.tsx`.
**Store(s)**: `useMarkerStore`.
**Playwright evidence**: none.

**Missing pieces**
- MP-13-01: No photo attach step (see MP-6, MP-10).
- MP-13-02: `voiceUri` field is on `PlantDraft` (line 67) but `ContentStep.tsx` comment 7 says "voice (UI stub)". Voice input is not wired.
- MP-13-03: No preview of the marker before commit — user sees GPS lock → pin adjust → content, then commits.
- MP-13-04: Draft persistence works (`draftKey`, line 78), but no UI surface to show "you have an unsaved plant draft — resume?"
- MP-13-05: No offline queue visibility in the Plant flow itself (Alert at line 220 shows once, then vanishes).
- MP-13-06: No "geofence for finder" — even though the schema supports permission=personal/group/public, there is no radius / hint / breadcrumb for the finder.

**Inconsistencies**
- IC-13-01: Default marker type = `'danger'` (`PlantScreen.tsx:75`). RunningScreen quick-plant defaults to `'cairn'` (`RunningScreen.tsx:333`). MapScreen CreateMarkerSheet defaults to `null` (user must pick). Three defaults.
- IC-13-02: Plant flow uses `haptic.notification('success')` (line 215) after 250ms delay before navigation. HikingScreen flag-plant (via HikingMap tap) uses `haptic.impact('medium')` immediately with no ceremony delay.
- IC-13-03: `defaultVisibility()` (line 82) reads `VisibilityConfig.defaultLevel` — which maps `'friends'` → `'group'`. Elsewhere the permission is called `'group'` (backend), `'group'` (client), but UI labels it as "Friends". Naming three deep.

**Edge cases not handled**
- EC-13-01: Legacy draft migration (line 141-146) reads `parsed.gpsLat ?? parsed.lat ?? null` — if both are null (corrupted draft), draft still hydrates with `null` and step-2 gates it off, but user gets no explanation.
- EC-13-02: On successful plant but zero-ID response (line 228), silent fallback to nav.goBack — user sees nothing planted, no toast.
- EC-13-03: The 250ms haptic delay (line 226) blocks the nav.replace even if user backgrounds the app during that window; on return the replace runs against a stale nav stack.

**Copy** — none new beyond CP-6-02.

---

### FEATURE 14 · Friends
**Screen(s)**: `app/src/screens/FriendsScreen.tsx` (799 lines).
**Store(s)**: `useFriendStore.ts` (139 lines).
**Playwright evidence**: none.

**Missing pieces**
- MP-14-01: No profile view for a friend — tapping a friend card doesn't open their profile / their shared markers.
- MP-14-02: No unfriend / remove friend action. Once added, permanent.
- MP-14-03: No block-user flow — required for UGC on App Store review.
- MP-14-04: No search-existing-users — only "invite by email".
- MP-14-05: No live-location share.
- MP-14-06: No group / party chat.
- MP-14-07: `online`/`lastSeen` are hardcoded to `false`/`'N/A'` (`FriendsScreen.tsx:319-320` — "Backend doesn't (yet) return online status / last seen"). Feature affordance exists in the card (`onlineDot`) but is decorative only.
- MP-14-08: `sharedMarkers` is hardcoded 0 (line 321).
- MP-14-09: No pending outbound request state — user who sends a request cannot see it in "pending" until the other side accepts or rejects.

**Inconsistencies**
- IC-14-01: Add-friend sheet slide-in `translateY:300` (line 141) matches Hiking route picker; but MarkerDetailSheet uses `translateY:400` (line 57). Three sheets, two starting-offsets.
- IC-14-02: Friend request accept/reject buttons are 36x36 (`FriendsScreen.tsx:647`) — below 44pt Apple HIG.

**Edge cases not handled**
- EC-14-01: `sendFriendRequest(email)` returns `{ success, error? }` (line 188) — on `success===false && error===undefined`, fallback error "Failed to send request" (line 197) is shown. If backend returns 401, user has no path to re-auth — treated as "failed".
- EC-14-02: Incoming request expansion (`requestsExpanded`) has no auto-collapse on empty.
- EC-14-03: `busyRequestId` state (line 338) tracks single-request busy; if user accepts A, then rejects B before A resolves, the busy state races.

**Copy**
- CP-14-01: "Friend request sent" (line 226) but if the other user doesn't exist, backend rejects; the sheet still says "Friend request sent". Silent misrepresentation.

---

### FEATURE 15 · Profile
**Screen(s)**: (none — only inline "profile card" at `SettingsScreen.tsx:837-865`).
**Playwright evidence**: none.

**Missing pieces**
- MP-15-01: **No dedicated Profile screen** — `RootStackParamList` (RootNavigator.tsx:44-58) has no `Profile` entry. The profile card is embedded inside Settings.
- MP-15-02: No avatar upload — the letter-avatar (`SettingsScreen.tsx:842`) is initials-only; no `expo-image-picker` wired to user profile.
- MP-15-03: No editable display name.
- MP-15-04: No profile stats (total km, total ascent, total hikes) — the profile card only shows name + email.
- MP-15-05: No public-facing profile URL / handle.

**Inconsistencies** — n/a (feature effectively absent).

**Edge cases not handled**
- EC-15-01: On avatar generation, initials use first-word only (implied). No fallback for single-name user.

**Copy** — none new.

---

### FEATURE 16 · Settings
**Screen(s)**: `app/src/screens/SettingsScreen.tsx` (1551 lines); components in `app/src/components/settings/*`.
**Playwright evidence**: none.

**Missing pieces**
- MP-16-01: No notification-preferences section (because notifications don't exist system-wide — MP-18-01).
- MP-16-02: No language switcher.
- MP-16-03: No region switcher UI (region lives in `config/regions.ts`; user can't change it).
- MP-16-04: No dark mode toggle exposed — `nightMode` field is retained in useSettingsStore but "toggle is hidden" (`SettingsScreen.tsx:238` comment).
- MP-16-05: No "clear cache" / "reset app" beyond memory-reset and account-delete.
- MP-16-06: No "connected accounts" section.
- MP-16-07: No "download all my data" (GDPR / NZ Privacy Act — required for launch in NZ).

**Inconsistencies**
- IC-16-01: The Reset Memory + Delete Account modals both use `TypeToConfirmModal` with different keywords: `'clear track'` vs `'delete account'`. Two-word phrases; users must type exactly (case-insensitive) — but "clear track" is ambiguous (clear which track?). Naming.
- IC-16-02: `useOnlineOnly` gate is used in `MarkerDetailScreen` but not in Settings actions — Reset Memory attempts online delete and shows a generic Alert on failure (line 1062).
- IC-16-03: Debug mode (line 962) exposes Sim Walker + Debug screen inside Settings only when `debugMode===true`. This is toggled by "5-tap on About Cairn row" — undocumented in-app; the app-store-review-safe pattern is fine, but there is no user-visible affordance for legitimate power users.

**Edge cases not handled**
- EC-16-01: The Delete Account flow (`SettingsScreen.tsx:1085-1149`) always signs out locally regardless of whether mailto succeeded — if user changes mind after seeing mail app fail, they are already signed out.
- EC-16-02: `handleChangePassword` catches AbortController but does not surface "network took too long" distinctly from generic errors.

**Copy**
- CP-16-01: "Sign out" hint = "Your walks stay saved" (line 936). But delete-account body says walks "will be removed" (line 1082). Both use "walks" — consistent noun choice, but "walks" is a different word than "hikes" which is used across every other screen.
- CP-16-02: Footer: "Ngā mihi nui — thanks for using Cairn" (line 1000). Only place in the app where the Māori-English gloss is inline. Elsewhere (Kia ora) it's Māori-only.

---

### FEATURE 17 · Debug
**Screen(s)**: `app/src/screens/DebugScreen.tsx` (275 lines).
**Playwright evidence**: none.

**Missing pieces**
- MP-17-01: `DebugScreen` renders always if `debugMode===true` (`SettingsScreen.tsx:961`) — no explicit `__DEV__` guard. Production users with the 5-tap gesture can reach it. **Confirmed intentional** ("App Store review safety" comment at SettingsScreen:23) but it means non-dev users can dump full session data.
- MP-17-02: No "clear crash logs" separate from "clear all debug logs".
- MP-17-03: No download-all-telemetry button.

**Inconsistencies** — n/a.

**Edge cases not handled**
- EC-17-01: `Sharing.shareAsync` fallback (`DebugScreen.tsx:88-89`) shows "Sharing unavailable" but doesn't offer a copy-path-to-clipboard alternative.

**Copy** — none new.

---

### FEATURE 18 · Notifications
**Screen(s)**: n/a (permission flow embedded in `services/autoPauseMonitor.ts`).
**Playwright evidence**: none.

**Missing pieces**
- MP-18-01: **No system-wide notification permission request flow** — `expo-notifications` is imported ONLY at `autoPauseMonitor.ts:89`; permission for it is *never* explicitly requested (grep `Notifications.requestPermissions` = 0). iOS silently drops the auto-pause notification unless the user happens to have granted notifications somewhere earlier.
- MP-18-02: No push-notification registration (no `getDevicePushTokenAsync`, no APNs certificate wiring in code).
- MP-18-03: No in-app notification tray.
- MP-18-04: No badge count on app icon.
- MP-18-05: No sound customisation.
- MP-18-06: No cold-boot handler for tapped notifications (already surfaced in EDGE_HUNT §1; restated as core gap).

**Inconsistencies** — n/a (feature absent).

**Edge cases not handled**
- EC-18-01: `autoPauseMonitor.scheduleNotificationAsync` (line 90) fires without checking permission grant — if denied, the promise resolves but no notification lands; user thinks "we haven't paused because we're moving" when actually the notification silently dropped.

**Copy** — none new.

---

### FEATURE 19 · Paywall / IAP
**Screen(s)**: `app/src/features/memory/components/PaywallSheet.tsx`.
**Playwright evidence**: none.

**Missing pieces**
- MP-19-01: No real IAP wired — see F-B-07 in FUNCTION_AUDIT / L-05 in LAUNCH_CHECKLIST. Confirmed at `PaywallSheet.tsx:8` (`// TestFlight-only. NO real IAP. Tap "Subscribe" → "Coming soon" toast.`).
- MP-19-02: No restore-purchase button.
- MP-19-03: No pricing localisation — hardcoded `$4.99` USD (already flagged).
- MP-19-04: No annual tier / trial / promo-code path.

**Inconsistencies** — n/a beyond the currency mismatch already flagged.

**Edge cases not handled**
- EC-19-01: If user is offline, PaywallSheet's Alert still fires "Coming soon" — no offline gate.

**Copy** — see CP-1-02 style copy inconsistency; PaywallSheet's "Coming soon" is yet a third variant.

---

### FEATURE 20 · Offline mode
**Screen(s)**: `app/src/components/OfflineMapSheet.tsx`.
**Service(s)**: `app/src/services/offlineMapService.ts` (175 lines), `networkMonitor.ts`, `offlineQueue.ts`, `pendingSyncStore.ts`, `offlineEntity.ts`.
**Playwright evidence**: none.

**Missing pieces**
- MP-20-01: No offline-mode indicator in the top bar of any screen (except MarkerDetailScreen's edit-button gate).
- MP-20-02: No queue-inspection UI — user cannot see what is pending sync (Home banner just shows count).
- MP-20-03: No manual "retry now" button — sync is automatic via `syncDaemon`.
- MP-20-04: No conflict-resolution UI (when local and server diverge, `sessionService.ts` picks one strategy without user consent).
- MP-20-05: No "prepare for offline trip" checklist — user must know to download offline pack from `OfflineMapSheet` before losing signal.

**Inconsistencies**
- IC-20-01: `useOnlineOnly` hook is used in `MarkerDetailScreen` but not applied consistently — Settings actions, Friends actions, and RouteEditor save don't check `online` state visibly.

**Edge cases not handled**
- EC-20-01: `Alert.alert('Download Failed', error)` (`OfflineMapSheet.tsx:53`) shows raw error text; if Mapbox throws a stack, user sees noise.
- EC-20-02: `NZ_OFFLINE_PACKS` (`config/offlinePacks.ts`) is a static list; no dynamic tiles for outside-NZ users.

**Copy** — none new.

---

### FEATURE 21 · Sync
**Service(s)**: `syncDaemon.ts`, `pendingSyncStore.ts`, `offlineQueue.ts`, `sessionService.ts`, `memorySync.ts`.
**Playwright evidence**: none.

**Missing pieces**
- MP-21-01: No user-visible sync log — grep for sync UI outside of the pending-count banner returns nothing.
- MP-21-02: No sync-progress indicator (e.g., 3/10 uploading).
- MP-21-03: No exponential-backoff visualisation.
- MP-21-04: No "sync only over WiFi" toggle for non-map data.
- MP-21-05: No conflict-resolution UI (repeat of MP-20-04, restated because sync layer is where it happens).

**Inconsistencies**
- IC-21-01: `syncState` values shown in `SyncBadge`: `pending / syncing / synced / failed`. But `MarkerDetailScreen.tsx:291-293` hides badge only when `synced` — leaves `failed` visible in perpetuity with no retry action next to it.

**Edge cases not handled**
- EC-21-01: `syncDaemon.drainPending` (called at HikingScreen:326) — if network flapping, drain may partially succeed leaving some markers in `syncing` state that never resolves.

**Copy** — none new.

---

### FEATURE 22 · Sharing
**Screen(s)**: n/a (embedded in `CairnPinsLayer.tsx`, `DebugScreen.tsx`).
**Playwright evidence**: none.

**Missing pieces**
- MP-22-01: **No sharing surface for hikes, routes, markers-outside-cairn-memory, screenshots, or profile.** Only two share sites in entire app: (1) `CairnPinsLayer.tsx:281` — shares a memory-cairn text message; (2) `DebugScreen.tsx:92` — shares a debug ZIP.
- MP-22-02: No deep-link generation ("cairn://hike/123").
- MP-22-03: No universal-links (already EDGE_HUNT §2).

**Inconsistencies** — n/a.

**Edge cases not handled** — n/a.

**Copy** — none new.

---

### FEATURE 23 · Data export (CSV / GPX / JSON)
**Playwright evidence**: none.

**Missing pieces**
- MP-23-01: **No data export whatsoever**. `AuthScreen.tsx:389` promises GPX export as part of the register privacy pledge. No implementation exists. NZ Privacy Act 2020 Principle 6 requires personal-info access on request — the register-time promise makes this contractual, not aspirational.
- MP-23-02: No CSV export of hike list.
- MP-23-03: No JSON dump for "download all my data".

**Inconsistencies** — n/a.

**Edge cases** — n/a.

**Copy**
- CP-23-01: The GPX promise is the false-promise line. Restated for weight.

---

### FEATURE 24 · Media (photos, video, voice memos)
**Service(s)**: `app/src/services/voiceMemoService.ts` (217 lines).
**Playwright evidence**: none.

**Missing pieces**
- MP-24-01: No photo attach anywhere in the primary user flow (grep `ImagePicker` outside `debugUpload.ts` = 0).
- MP-24-02: No video record/playback.
- MP-24-03: Voice memo record exists in `voiceMemoService.ts` (record, stop, cancel, play, persist per marker) but the UI to trigger it is a "UI stub" (`PlantScreen.tsx:7`).
- MP-24-04: No transcript of voice memos.
- MP-24-05: No thumbnail generation or gallery.

**Inconsistencies**
- IC-24-01: Voice memo file is written to `FileSystem.documentDirectory/voice_memos/` (`voiceMemoService.ts:201`). No sync path to server. If user reinstalls, all voice memos gone.

**Edge cases**
- EC-24-01: `stopRecording` error case (line 121) is swallowed with breadcrumb; user sees nothing.

**Copy** — none new.

---

### FEATURE 25 · Search
**Playwright evidence**: none.

**Missing pieces**
- MP-25-01: **No search anywhere in the app.** Grep for `SearchBar|onChangeSearch|searchTerm` returns zero matches. Not in MapHistory, RoutesScreen, FriendsScreen, or MapScreen.
- MP-25-02: No global address search.
- MP-25-03: No trail-name search.
- MP-25-04: No friend search.

**Inconsistencies** — n/a.
**Edge cases** — n/a.
**Copy** — n/a.

---

### FEATURE 26 · Filter
**Playwright evidence**: none.

**Missing pieces**
- MP-26-01: Filter exists on RoutesScreen tabs (FilterSortBar, `RoutesScreen.tsx:179`) but not elsewhere.
- MP-26-02: No filter on MapHistory (repeat MP-7-03).
- MP-26-03: No filter on Friends by "recent" / "shared markers".

**Inconsistencies**
- IC-26-01: RoutesScreen filters are a `ScrollView horizontal` chip strip; no equivalent pattern used elsewhere. There's no shared FilterBar component.

**Edge cases** — n/a.
**Copy** — n/a.

---

### FEATURE 27 · Empty states
**Playwright evidence**: none.

**Missing pieces**
- MP-27-01: MapScreen has no empty state — when 0 markers exist, the map shows only the basemap + no message. New user thinks the feature is broken.
- MP-27-02: Debug screen has an empty state ("No sessions yet. Start tracking with debug mode on." `DebugScreen.tsx:235`) but no other empty affordance.
- MP-27-03: MapHistoryScreen empty state exists but is text-only.
- MP-27-04: Memory screen `failReason` states cover 'permission'/'timeout'/'error' but there is no zero-hike empty (`MemoryScreen.tsx:623-627` comment says "no hike imported = NO area unlocked"). A fog-of-war app with zero unlocked area = blank grey world. User doesn't know why.

**Inconsistencies**
- IC-27-01: FriendsScreen empty state uses `IllustrationHalo + EmptyFriends` (line 289-297). RoutesScreen empty states are inline `emptyHero` blocks. Two design languages for empty.

**Edge cases** — n/a.
**Copy** — n/a.

---

### FEATURE 28 · Error states
**Playwright evidence**: none.

**Missing pieces**
- MP-28-01: No global error boundary user-facing UI — `ErrorBoundary.tsx` exists in components but wraps only critical paths (grep would confirm).
- MP-28-02: No offline global banner (repeat MP-20-01).
- MP-28-03: Network error surfacing uses `Alert.alert` (12+ sites). No unified toast system.
- MP-28-04: HikingScreen `catch (_recoverErr)` (line 663) silently discards recovery failures — user sees the modal close but has no idea the recovery didn't work.
- MP-28-05: `saveHikeAtomic` malformed response (`sessionService.ts:247-255`) throws — but the consumer might catch and swallow.

**Inconsistencies**
- IC-28-01: Alerts are inconsistent: some have both Cancel + primary (Alert.alert(title, msg, [Cancel, Save])); some have only OK. No component-level "AlertConfirm" wrapper.

**Edge cases** — see individual features.
**Copy** — see individual features.

---

### FEATURE 29 · Loading states
**Playwright evidence**: none.

**Missing pieces**
- MP-29-01: No shared Skeleton component — some screens use `ActivityIndicator`, some use nothing, some use "Loading friends' routes…" text.
- MP-29-02: RoutesScreen loading (`RoutesScreen.tsx:614`) is text-only.
- MP-29-03: SettingsScreen change-password button has no loading state visible in the excerpt beyond `ActivityIndicator` swap.

**Inconsistencies**
- IC-29-01: `ActivityIndicator size="small" color="#fff"` used in AddFriendSheet, StopSummarySheet, TypeToConfirmModal, and MarkerDetailScreen — but colour varies ("Colors.primary" in others). Not brand-consistent.

**Edge cases** — n/a.
**Copy** — n/a.

---

### FEATURE 30 · Success states
**Playwright evidence**: none.

**Missing pieces**
- MP-30-01: Plant success uses `haptic.notification('success')` + 250ms delay + nav.replace (`PlantScreen.tsx:214-227`). MarkerDetailScreen save uses no haptic. Running plant uses a text toast. Three success-feedback patterns.
- MP-30-02: FriendRequest success uses inline `successState` panel with `CircleCheck` icon (FriendsScreen.tsx:222-228). No confetti / celebration for the first friend.
- MP-30-03: No "you unlocked X new places" success animation post-hike — Memory delta is shown as text on StopSummarySheet only.

**Inconsistencies** — see MP-30-01.
**Edge cases** — n/a.
**Copy** — n/a.

---

## 3. Cross-Feature Inconsistencies (roll-up)

- CX-01: **Marker vs Cairn vs Flag** — same object, 4 different nouns (see CP-6-02). Restated at the cross-feature level because it's system-wide.
- CX-02: **Two marker detail surfaces** (Sheet vs Screen, IC-11-01) — a single conceptual object with divergent UX per entry point.
- CX-03: **Three empty-state design languages** (IllustrationHalo, inline emptyHero, text-only).
- CX-04: **Three success-feedback patterns** (haptic + toast, haptic + delay + nav, inline panel).
- CX-05: **Two sheet-slide-in starting offsets** (300 vs 400 translateY).
- CX-06: **Two API naming conventions** — camelCase (`/api/auth/register`) vs snake_case (`/api/auth/password`) — already flagged in FUNCTION_AUDIT F-AUTH-13; system-wide.
- CX-07: **HitSlop below Apple HIG (44pt) at multiple sites** — see MarkerDetailSheet close chip (10pt), Friends accept/reject 36x36 (line 647).
- CX-08: **Dark mode not wired anywhere**, but `nightMode` field lives in `useSettingsStore`.
- CX-09: **No accessibility labels on core icon-only buttons** — 18 total occurrences across only 5 files (see FUNCTION_AUDIT §12). Cross-feature failure.
- CX-10: **No dynamic-type support anywhere** (EDGE_HUNT §4). Cross-feature failure.
- CX-11: **Language mixing** — Kia ora / Ngā mihi nui / English UI without a shared locale toggle.
- CX-12: **Three marker-type registries coexist** — `MARKER_META` in `data/mockData`, `MARKER_TYPES` in `config/markerTypes.ts`, `FLAG_TYPES` in `data/flagTypes.ts`. Renaming risk on future edits.
- CX-13: **`useTrackingStore.pauseTracking` orphaned in Running** (IC-5-01, MP-4-07). The action exists, is exported, and is consumed only by HikingScreen — Running never wires it.
- CX-14: **Draft/pending storage keys are scattered** — `cairn:plant:draft:v3:<uid>`, `cairn_remember_me`, `cairn_logout_marker`, `cairn_jwt`, `cairn_offline_packs`. Mix of AsyncStorage + SecureStore + custom `storage.ts`. No inventory or migration story.

---

## 4. Priority Matrix

**Blocker (must-fix before App Store submission or before onboarding first paying user)**
- MP-1-06 (age gate) — COPPA / privacy compliance.
- MP-2-01 (no onboarding) — first-run UX shipping blocker.
- MP-14-03 (no block-user) — App Store Guideline 1.2 for UGC.
- MP-18-01 (no notification permission flow) — silent failures during shipping.
- MP-19-01 restated (paywall stub) — already Blocker in FINAL_REPORT.
- MP-23-01 (GPX export promised but absent) — false statement in register text.

**Critical (must-fix during launch prep sprints)**
- MP-1-01 (no forgot-password), MP-1-03 (no ToS checkbox), MP-1-07 (no magic-link fallback).
- MP-3-01 (no first-hike CTA), MP-3-02 (pending banner untappable).
- MP-4-07 (no manual Pause on Hiking), MP-5-01 (no Pause on Running).
- MP-7-01/03/07 (MapHistory: no search, no filter, no export).
- MP-9-01 (Activities has no Friends scope, missing feature parity).
- MP-10-01/02/03 (Marker Detail: no photo, no voice playback, no directions).
- MP-11-01/02/03/04 (MarkerDetailSheet missing basic parity with MarkerDetailScreen).
- MP-12-04 (no Memory export).
- MP-13-01/02 (Plant: no photo, voice UI stub).
- MP-14-01/02/03/09 (Friends: no profile, no unfriend, no block, no outbound).
- MP-15-01 (no Profile screen at all).
- MP-16-07 (no "download all my data").
- MP-22-01 (no sharing).
- MP-25-01 (no search anywhere).
- IC-11-01, IC-12-01 (three sheets for a single marker concept).
- CX-01 (Marker/Cairn/Flag naming).
- CX-13 (Running orphaned pauseTracking).

**Medium (schedule post-launch)**
- MP-3-04/05 (weekly stats, streaks), MP-6-02/03/05 (map layers, weather, 3D).
- MP-7-04/05/06/08/09/10 (MapHistory quality-of-life).
- MP-8-01–07 (RouteEditor: share, export, difficulty, duplicate, reverse, offline pack).
- MP-10-04/05/06/07 (Marker Detail social).
- MP-16-02/03/05/06 (Settings: language, region, cache reset, connected accounts).
- MP-20-02/03/04 (offline queue UI).
- MP-24-01/02/04/05 (media pipeline).
- MP-30-01/02/03 (success ceremony).

**Low (polish)**
- CP-*: copy inconsistencies (14 sites).
- IC-3-01 through IC-29-01: visual polish.
- CX-05/07 (offsets, hitSlop tuning).

---

## 5. Playwright Evidence Index

**Playwright unavailable** — Expo web at `http://localhost:19006` returned HTTP 000; Metro at `:8081` returned HTTP 000. This is a code-only audit as authorised by the prompt ("If Playwright not available, still do the code audit fully.").

The `docs/ux-audit-2026-07-28/feature-audit-screenshots/` directory was created and is empty.

Re-runnable evidence checklist (for the next session that boots Expo web):

1. `browser_navigate` → `http://localhost:19006` (or wherever Expo runs).
2. `browser_take_screenshot` at each of the 30 features listed above (2 viewports × primary state each = 60 screenshots).
3. Save under `docs/ux-audit-2026-07-28/feature-audit-screenshots/<feature-slug>-<step>.png`.
4. After each key state: `browser_console_messages(level="error")` — 0 errors expected.
5. Navigation regression: Home → Hiking → Home; Home → Settings → Home; etc. Console errors at each transition.

Screenshot filename convention (for future runs): `auth-01.png` … `settings-04.png`; `hiking-live-01.png`; `memory-empty-01.png`; etc.

---

## Appendix — File paths referenced

- `app/src/screens/AuthScreen.tsx` (1149 lines)
- `app/src/screens/HomeScreen.tsx` (647)
- `app/src/screens/HikingScreen.tsx` (1432) + `HikingMap.tsx` (504)
- `app/src/screens/RunningScreen.tsx` (943)
- `app/src/screens/MapScreen.tsx` (1068)
- `app/src/screens/MapHistoryScreen.tsx` (1737)
- `app/src/screens/RoutesScreen.tsx` (1476)
- `app/src/screens/RouteEditorScreen.tsx` (1149)
- `app/src/screens/MarkerDetailScreen.tsx` (657)
- `app/src/screens/MarkerDetailSheet.tsx` (170)
- `app/src/screens/PlantScreen.tsx` (328)
- `app/src/screens/FriendsScreen.tsx` (799)
- `app/src/screens/SettingsScreen.tsx` (1551)
- `app/src/screens/DebugScreen.tsx` (275)
- `app/src/screens/StopSummarySheet.tsx` (248)
- `app/src/features/memory/screens/MemoryScreen.tsx`
- `app/src/features/memory/components/PaywallSheet.tsx`
- `app/src/features/plant/components/ContentStep.tsx`
- `app/src/navigation/RootNavigator.tsx`
- `app/src/services/authService.ts` (187)
- `app/src/services/sessionService.ts` (281) — saveHikeAtomic at line 184
- `app/src/services/voiceMemoService.ts` (217)
- `app/src/services/offlineMapService.ts` (175)
- `app/src/store/useTrackingStore.ts` (1937)
- `app/src/store/useAppStore.ts` (304)
- `app/src/store/useFriendStore.ts` (139)
- `app/src/store/useMarkerStore.ts` (693)
- `app/src/store/useRouteEditStore.ts` (2871)
- `app/src/store/useSessionStore.ts` (216)

---

*End of Feature Completeness Audit — 2026-07-28.*
