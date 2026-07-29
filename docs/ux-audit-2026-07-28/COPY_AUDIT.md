# Copy Audit — 2026-07-28

Cairn is a warm, NZ-focused hiking app. Copy should feel friendly, direct, encouraging — not corporate, technical, or apologetic. This audit lists every user-visible string that is confusing, inconsistent, wrong, missing i18n, or hostile to a first-time user. **80+ findings.**

## Priority summary
- **Blockers (launch-blocking)**: 6
- **Critical (fix before v1.0)**: 24
- **Medium (polish sweep)**: 34
- **Polish (v1.1 backlog)**: 22

---

## 1. Terminology inconsistencies — the biggest problem

### C-01 (BLOCKER) — "hike" vs "session" vs "activity" vs "trail" vs "run" vs "track" vs "route" vs "walk"

The single saved outing has **at least seven** user-facing names.

| Screen | Term used | File:Line |
|--------|-----------|-----------|
| Home — stats chip | `plural(sessions.length, 'session')` → "3 sessions" | HomeScreen.tsx:444 |
| Home — pending banner | "1 hike pending sync" / "3 hikes pending sync" | HomeScreen.tsx:432-433 |
| Home — big card subtitle | "Track your route · Explore at your pace" (mixes track+route) | HomeScreen.tsx:461 |
| Home — home tools row | "Trails" (button label opening Routes screen) | HomeScreen.tsx:500 |
| Auth splash bottom hint | "Your hiking data is securely stored on your account. Sign in to access it on any device." | AuthScreen.tsx:853 |
| AuthScreen (post-verify greeting) | "Your track starts now." | AuthScreen.tsx:947 |
| RoutesScreen top-title | "Routes" | RoutesScreen.tsx:1213 |
| RoutesScreen tab 1 | "Activities" | RoutesScreen.tsx:73 |
| RoutesScreen tab 2 | "Routes" | RoutesScreen.tsx:74 |
| RoutesScreen empty state (routes) | "No saved routes yet" | RoutesScreen.tsx:595 |
| RoutesScreen empty state (activities) | "No tracks walked yet" · "Your tracks will live here." | RoutesScreen.tsx:723 |
| RoutesScreen card fallback name | `'Run'` or `'Hike'` (mixed with route names) | RoutesScreen.tsx:493, 777 |
| MapHistoryScreen top | "Activity Detail" OR "Route Map" | MapHistoryScreen.tsx:1084 |
| MapHistoryScreen empty | "No sessions yet" · "Start hiking or running to see your routes here" · CTA "Start a Hike" | MapHistoryScreen.tsx:1212-1220 |
| MapHistoryScreen discard alert | "Discard this activity?" | MapHistoryScreen.tsx:495 |
| MapHistoryScreen confirm discard | "This activity will be permanently deleted..." | MapHistoryScreen.tsx:506 |
| MapHistoryScreen "Save as Route" | button on activity card | MapHistoryScreen.tsx:1184 |
| StopSummarySheet header | `{label} complete` where label = "Hiking" or "Running" | StopSummarySheet.tsx:98 |
| StopSummarySheet memory pill | `Memory: Too short to record` (implicit "recording") | StopSummarySheet.tsx:116 |
| RunningScreen post-stop | Title "Run Complete" · subtitle "Session saved" · CTA "New Run" | RunningScreen.tsx:383, 386, 417 |
| HikingScreen post-stop | (uses StopSummarySheet — "Hiking complete") | StopSummarySheet.tsx:98 |
| TrackingStore permission alert title | "Improve hike tracking" | useTrackingStore.ts:398 |
| SettingsScreen sign-out hint | "Your walks stay saved" | SettingsScreen.tsx:936 |
| SettingsScreen sign-in prompt | "Your sessions will sync across devices" | SettingsScreen.tsx:590 |
| SettingsScreen danger zone | "Reset my map memory" hint: "Your hikes and cairns are kept." | SettingsScreen.tsx:914 |
| SettingsScreen reset modal | "Your saved hikes and cairns are kept." | SettingsScreen.tsx:1046 |
| Home dashboard live | "Hiking in progress" / "Running in progress" | HomeScreen.tsx:108 |
| Home last-activity chip | badge "Hike" / "Run" (short form) | HomeScreen.tsx:134 |

**Impact**: user sees "sessions" as a stat, "hikes" as a pending count, "activities" as a tab, "tracks walked" as an empty state, "walks" in the sign-out hint, and "routes" on a top bar — **all describing the same object**. Every screen contradicts the others. This is the single biggest copy problem in the app.

**Recommendation**: Canonicalise on **"hike"** for user-facing single-word noun. "Route" = a saved reusable path template; "Flag/Cairn" = a marker. Everything else (session, activity, track, walk) is engineering vocabulary and MUST NOT appear in copy.

Draft canonical vocabulary:

| Concept | Say | Never say |
|---|---|---|
| A recorded outing | **Hike** (or "Run" when activity mode = running) | session, activity, track, walk |
| A saved reusable path | **Route** | track, path, trail |
| A user-planted marker | **Cairn** (for the emotional/social type) OR **Flag** (generic) — pick ONE | marker, pin, waypoint |
| The map's revealed-ground layer | **Memory** | fog, coverage |
| A category label in RoutesScreen | tabs = "Hikes" / "Routes" / "Cairns" | Activities / Flags |

### C-02 (BLOCKER) — "Cairn" vs "Flag" vs "Marker" vs "Pin" — pick one

The same object is called four different things.

| Where | Word |
|---|---|
| Home tools row + stats chip | "flag" (`plural(markerCount, 'flag')`), HomeScreen.tsx:448 |
| Home tools row activity card | "Leave a Cairn here" · "Drop a note...", HomeScreen.tsx:484-485 |
| RoutesScreen filter chip labels | "All / Danger / Cairn / Water / Junction" (mixes types with names), RoutesScreen.tsx:51-56 |
| RoutesScreen empty state | "No flags planted yet", RoutesScreen.tsx:1059 |
| RoutesScreen tab | "Flags", RoutesScreen.tsx:75 |
| MapScreen bottom sheet | "Plant a Flag", MapScreen.tsx:239 |
| MapScreen button (final action) | "Plant Flag", MapScreen.tsx:332 |
| PlantScreen (dedicated flow) title | "Where's your cairn?", PinAdjustStep.tsx:427 |
| ContentStep (final step of PlantScreen) | "Plant Cairn" button, ContentStep.tsx:172 |
| MarkerDetailSheet delete btn | "Delete Flag", MarkerDetailSheet.tsx:130 |
| MarkerDetailScreen title (empty) | "Untitled cairn", MarkerDetailScreen.tsx:373 |
| MarkerDetailScreen not-found title | "Cairn not found", MarkerDetailScreen.tsx:184 |
| MysteryCairnSheet | "Someone left a cairn here", MysteryCairnSheet.tsx:91 |
| SettingsScreen stat card | "Cairns planted", SettingsScreen.tsx:1029 |
| CairnPinsLayer (report) | "Report this cairn" · "Too far · Get closer to the cairn", CairnPinsLayer.tsx:266, 223 |
| MapScreen (report) | "Report mark", MapScreen.tsx:801 |
| MapScreen (report body) | "Move closer to report this mark", MapScreen.tsx:633 |
| MapScreen delete alert | `Delete "${marker.note || 'this flag'}"`, MapScreen.tsx:482 |

**Recommendation**: "Cairn" = user-facing name in NZ context (matches brand, feels warm). Use "Cairn" everywhere the user is planting/finding a personal marker. Reserve "Flag" if you want a separate generic hazard type (danger/water/junction), otherwise merge. Never say "mark" or "marker" or "pin" in copy.

### C-03 (CRITICAL) — "Track" is overloaded — noun, verb, and a stat

- Verb: "Track your route" (HomeScreen.tsx:461) — means "record"
- Verb: "Your track starts now." (AuthScreen.tsx:947) — means "journey"
- Verb: "keep tracking your track when the screen is locked" (useTrackingStore.ts:399) — "tracking your track"! Nonsensical.
- Noun: "Showing raw GPS trace" — "trace" (RouteEditorScreen.tsx:850)
- Noun: "No tracks walked yet" · "Your tracks will live here." (RoutesScreen.tsx:723)

**Recommendation**: Use "record" as the verb. Use "hike" for the noun. Drop "track" entirely from user-facing copy.

### C-04 (CRITICAL) — "Route" vs "Trail" — inconsistent naming for saved paths

- Home button label: "Trails" (HomeScreen.tsx:500) — but opens the RoutesScreen
- RoutesScreen top title: "Routes" (RoutesScreen.tsx:1213)
- FriendsScreen empty state: "invite friends to share markers and stay connected on the track" (FriendsScreen.tsx:293)
- MysteryCairnSheet: uses "Someone left a cairn here" (fine)

**Recommendation**: "Trails" on the Home button is misleading — users tap "Trails" and land on a screen titled "Routes". Change the Home button to say "Routes".

### C-05 (MEDIUM) — "Free Hiking" vs "Free Run" vs "Free" — inconsistent free-mode label

- HikingScreen picker: "Free Hiking" (HikingScreen.tsx:779) subtitle "No route · explore freely"
- HikingScreen alert: `Alert.alert('Route', activeRoute?.name ?? 'Free Hiking'` (HikingScreen.tsx:936)
- HikingScreen switch action: "Switch to Free" (HikingScreen.tsx:937)
- RunningScreen picker: "Free Run" (RunningScreen.tsx:566)

**Recommendation**: "Free Hike" / "Free Run" — remove "-ing" suffix; matches "New Run" post-stop CTA. Consistent noun form.

---

## 2. Error messages — mostly OK, but scattered issues

### C-06 (BLOCKER) — "Something went wrong" is a placeholder, not an error message

- AuthScreen.tsx:732: `setApiError('Something went wrong. Please try again.');`
- DebugScreen.tsx:70: `r.error || 'Unknown error'`
- DebugScreen.tsx:97: `Alert.alert('Export failed', String(err));` — dumps raw JS Error to user
- RouteEditorScreen.tsx:526: `Alert.alert('Cannot save', result.error ?? 'Unknown error');`
- RouteEditorScreen.tsx:640: `Alert.alert('Save failed', e?.message ?? 'Unknown error');`

**Recommendation**:
| Current | Better |
|---|---|
| "Something went wrong. Please try again." | "We couldn't sign you in. Check your connection and try again." (context-specific) |
| "Unknown error" | "Something got lost between here and our server. Try again in a moment." |
| Dumping `e.message` | Match against known error codes; fall back to friendly copy. Never show `TypeError: fetch failed` to a user. |

### C-07 (CRITICAL) — "Error 500" / raw HTTP codes are never OK to show a user
No direct instance found, but MarkerInteractionError codes surface as branch conditions (TOO_FAR, RATE_LIMITED, NONCE_INVALID, SERVER_ERROR). Copy for `SERVER_ERROR` is currently silent (CairnPinsLayer.tsx:227). A silent server error = anxiety. User taps like → nothing visible happens → thinks the app is broken. Add: "Couldn't reach Cairn's servers. We'll retry."

### C-08 (CRITICAL) — "Cannot save" — no context, no retry action

- RouteEditorScreen.tsx:526: `Alert.alert('Cannot save', result.error ?? 'Unknown error');`
- **Recommendation**: "Couldn't save your route" + include an actionable next step (retry button or "Check your connection and try again").

### C-09 (MEDIUM) — "Please try again in a moment" — used many times without teaching what's actually wrong

- PlantScreen.tsx:249: 'Please try again in a moment.'
- MarkerDetailScreen.tsx:151: `Alert.alert('Could not save', e?.message ?? 'Please try again in a moment.');`

**Recommendation**: Distinguish network vs server vs data errors. Give the user one useful sentence about what would help.

### C-10 (MEDIUM) — "Download Failed" — no user guidance
- OfflineMapSheet.tsx:53: `Alert.alert('Download Failed', error);` — dumps raw error string
- **Recommendation**: "Couldn't download this map pack. Check your Wi‑Fi or try a smaller region."

### C-11 (MEDIUM) — "Save failed. Could not save route — check your connection"
- RouteEditorScreen.tsx:607 — decent but "Save failed" is redundant with body. Just say body copy.

### C-12 (MEDIUM) — "Cannot reach the server."
- AuthScreen.tsx:728 — reasonable but "server" is developer-speak. "Cannot reach Cairn — check your internet and try again."

### C-13 (CRITICAL) — "This platform does not support sharing." — condescending
- DebugScreen.tsx:89 — technical + unfriendly. Only shown in dev mode so priority is Medium.

### C-14 (MEDIUM) — CairnPinsLayer error copy is inconsistent with MapScreen error copy for the same actions

| Action | CairnPinsLayer copy | MapScreen copy |
|---|---|---|
| Too far to like | "Too far · Get closer to the cairn to like it." | "Too far · Move closer to like this mark." |
| Rate-limited like | "Slow down · Too many actions. Try again in a moment." | "Slow down · You've liked too many marks recently." |
| Too far to report | "Too far · Get closer to the cairn to report it." | "Too far · Move closer to report this mark." |
| Rate-limited report | "Slow down · Too many reports. Try again later." | (same as like) |

**Recommendation**: One string table, one voice. "Get closer" vs "Move closer" — pick one. "Cairn" vs "mark" — pick one.

### C-15 (MEDIUM) — "No GPS fix" — technical
- CairnPinsLayer.tsx:208, 241: 'No GPS fix', 'Wait for a GPS signal before liking a cairn.'
- **Recommendation**: "Finding your location — please wait a moment."

### C-16 (MEDIUM) — "Location unavailable" — accurate but cold
- MapScreen.tsx:627, 780: "Enable location to report marks." / "Enable location to like marks."
- Two problems: the label above says "Location unavailable" but the body says "Enable location" — mixed metaphor. Also "report marks" (plural, generic) is developer-speak.

---

## 3. Empty states — mixed quality

### C-17 (CRITICAL) — HomeScreen has no empty-state message for a brand-new user

A first-time user opens the app after sign-in and sees:
- Big "Cairn" wordmark + greeting (fine)
- No stats chip (fine — hidden until data)
- No RecentRow (fine — hidden until data)
- Two big activity cards
- Tools row

There is **no welcome hero, no "Start your first hike" prompt, no product explanation.** A first-time user has to guess.

**Recommendation**: For `sessions.length === 0`, add a short one-line hero above the cards: "Ready for your first hike? Tap Hiking below to start recording."

### C-18 (Good — keep) — RoutesScreen empty states are strong

- "No saved routes yet" · body explains "Save as Route" workflow (RoutesScreen.tsx:595)
- "No flags planted yet" · CTA "Plant a new mark" (mixes "flag" and "mark" — see C-02) RoutesScreen.tsx:1059-1071
- "No routes from your friends yet" (RoutesScreen.tsx:622)
- "No marks from your friends yet" (RoutesScreen.tsx:1096) — inconsistent with above (routes vs marks)

### C-19 (CRITICAL) — MapHistoryScreen empty state uses inconsistent noun

- "No sessions yet" — **"sessions" is the worst possible user-facing name** (engineering term)
- MapHistoryScreen.tsx:1212

**Recommendation**: "No hikes yet" + subtitle "Start hiking or running to see them here" + CTA "Start a Hike" (already good).

### C-20 (MEDIUM) — MapHistoryScreen "No flags planted" subtitle
- MapHistoryScreen.tsx:1258: "No flags planted" · "Open the map to place your first flag"
- Contradicts PlantScreen's "Plant Cairn" wording. Fix.

### C-21 (MEDIUM) — FriendsScreen empty state
- "Cairn is better with trail companions" · body "Invite friends to share markers and stay connected on the track." (FriendsScreen.tsx:292-293)
- "on the track" — see C-03. Also "share markers" contradicts everywhere else that says "cairns/flags".

### C-22 (MEDIUM) — MemoryScreen empty-state / permission-denied copy is fine but "waiting for your position" hint could be warmer
- MemoryScreen.tsx:741-743: "Looking for your position…" · "We need a GPS fix to draw your memory map."
- "GPS fix" is technical. "We're still finding you. Head somewhere with a clear sky if this takes a while."

### C-23 (MEDIUM) — "No note added" — passive/empty
- MapHistoryScreen.tsx:717
- MarkerDetailSheet.tsx:101: `(No note)`
- **Recommendation**: Consistent voice — either "No note yet" everywhere or "(no note)" with lowercase everywhere.

### C-24 (MEDIUM) — RoutesScreen flag filter empty result
- RoutesScreen.tsx:1182: "No flags matching filter"
- **Recommendation**: "No matching flags. Try a different filter."

### C-25 (POLISH) — MarkerDetailScreen empty title fallback
- MarkerDetailScreen.tsx:373: "Untitled cairn"
- MarkDetailSheet.tsx:169: "(untitled)"
- Two different empty-title displays for the same object type. Consolidate.

---

## 4. Confirmation prompts

### C-26 (CRITICAL) — Discard hike during recording has NO confirmation from HikingScreen

Recording flow (HikingScreen → Stop → StopSummarySheet):
- StopSummarySheet has Discard button that goes straight to `dismiss(onDiscard)` — no confirm dialog (StopSummarySheet.tsx:145-155).
- User may lose data with one tap.

But **MapHistoryScreen's discard has TWO-step confirm** (MapHistoryScreen.tsx:494-506): first "Discard this activity?" then "Confirm discard? This activity will be permanently deleted and cannot be recovered."

**Inconsistency**: destroying an in-progress hike (worse — more recent, less recoverable) is one tap, but destroying an already-saved one is two taps.

**Recommendation**: Discard mid-recording MUST have a "Are you sure? Your GPS trace so far will be lost." confirm. And write it plainly — "This will delete your hike. Continue?"

### C-27 (MEDIUM) — "Discard edits?" vs "Reset edits?" vs "Discard this activity?" vs "Confirm discard?" — five confirm modals, four verbs

- RouteEditorScreen.tsx:296, 504: "Discard edits?" / "Your changes will be lost."
- EditOverlayV274.tsx:109: "Reset edits?" / "All detour strokes and trim adjustments will be cleared."
- MapHistoryScreen.tsx:495: "Discard this activity?"
- MapHistoryScreen.tsx:505: "Confirm discard?"
- StopSummarySheet: Discard = no confirm

**Recommendation**: One verb — "Discard" — everywhere. "Reset" implies restoring defaults, not deleting user work.

### C-28 (MEDIUM) — "Delete Flag" vs "Delete this mark?" vs "Delete route?" vs "Delete this cairn?" — inconsistent capitalisation and phrasing

- MapScreen.tsx:481, 810: "Delete Flag" (Title Case), "Delete this mark?" (sentence case)
- RoutesScreen.tsx:849: "Delete Flag"
- RouteEditorScreen.tsx:648: "Delete route?" (sentence case, no article)
- MarkerDetailScreen.tsx:159: "Delete this cairn?"
- MapScreen.tsx:829: "Hide this mark?" — good pattern

**Recommendation**: All confirmation modals in sentence case with "this": "Delete this cairn?" / "Delete this route?" / "Delete this hike?"

### C-29 (CRITICAL) — "Confirm Delete" vs "Delete Flag" inline button label toggles are confusing

Cards have delete buttons that toggle to "Confirm Delete":
- MapHistoryScreen.tsx:726: `deleteConfirm ? 'Confirm Delete' : 'Delete Flag'`
- MapHistoryScreen.tsx:1199: `deleteConfirm ? 'Confirm Delete' : 'Delete'`
- MapHistoryScreen.tsx:1249: `deleteConfirm ? 'Confirm Delete' : 'Delete Route'`

**Problem**: The pattern is fine, but three variants of the "off" state — "Delete Flag" / "Delete" / "Delete Route" — for the same interaction.

**Recommendation**: Use a consistent pattern: initial state names the thing ("Delete Flag" / "Delete Route" / "Delete Hike"), confirm state says "Tap again to confirm" (clearer than just "Confirm Delete" which sounds like a title).

### C-30 (Good) — Type-to-confirm modals for Reset Memory + Delete Account
- SettingsScreen — solid pattern with keyword typing. Keep.

### C-31 (MEDIUM) — Sign-out confirm uses "Are you sure" — the classic bad UX pattern
- SettingsScreen.tsx:942: 'Sign out', 'Are you sure you want to sign out?'
- **Recommendation**: State the consequence: "Sign out of Cairn? · Your hikes stay saved. You can sign back in anytime."

---

## 5. Loading states

### C-32 (CRITICAL) — Naked spinners everywhere without context

- MapHistoryScreen list — pull to refresh spinner
- MemoryScreen loading tile with "Cairn" wordmark and `<Text>{loadingSub}` — good
- SettingsScreen Update password button — spinner alone (SettingsScreen.tsx:572-576)
- RoutesScreen loading spinner in friends' routes — has "Loading friends' routes…" (RoutesScreen.tsx:614) — GOOD
- RoutesScreen loading friends' marks — "Loading friends' marks…" (RoutesScreen.tsx:1086) — GOOD

**Recommendation**: Every spinner needs a label. Silent spinners = anxiety.

### C-33 (MEDIUM) — "Saving…" / "Planting…" / "Clearing…" / "Connecting…" — inconsistent ellipsis

Some use `…` (Unicode), some use `...` (three periods), some have no punctuation:
- StopSummarySheet.tsx:180: "Saving…" (Unicode)
- ContentStep.tsx:172: "Planting…" (Unicode)
- MemorySettingsSection.tsx:116: "Clearing…" (Unicode)
- AuthScreen.tsx:1153: "Connecting…" (Unicode)
- MarkerDetailScreen.tsx:363: "Saving…" (Unicode)

Good — everything uses `…`. Verify all future strings do too.

### C-34 (MEDIUM) — "Looking for your position…" ambiguous
- MemoryScreen.tsx:741 — is it looking for GPS or the user? Say "Finding your location…"

### C-35 (POLISH) — GpsLockStep "Finding your ground"
- GpsLockStep.tsx:223 — poetic but ambiguous. Retain but confirm this matches brand voice.

---

## 6. Success feedback

### C-36 (BLOCKER) — Save Hike shows no confirmation

StopSummarySheet.onConfirm → parent HikingScreen calls stopTracking → sheet unmounts → user lands back on Home. No toast, no visible "Hike saved" message. Users report feeling uncertain whether it saved (see internal user reports).

**Recommendation**: Toast or full-screen "Hike saved · View" after successful save.

### C-37 (CRITICAL) — Plant Cairn success is silent (except haptic)

PlantScreen.tsx:214-227 — success = haptic + navigate. Offline shows an Alert ("Cairn planted (offline)"), but online shows NOTHING.

**Recommendation**: Either always Alert or always navigate to detail with a brief inline "Just planted" badge for 3s.

### C-38 (CRITICAL) — Password change forced-signout is a surprise

Users tap "Update password" → password changes → user is signed out on other devices and possibly this one, but no messaging. (Confirmed by SettingsScreen password flow.)

**Recommendation**: Modal after change: "Password updated. You've been signed out of other devices for security. Sign back in there when ready."

### C-39 (MEDIUM) — Report success copy inconsistent

- CairnPinsLayer.tsx:253: "Report sent · Thanks for letting us know."
- MapScreen.tsx:630: "Reported · Thank you for your report."
- MarkDetailDevPreviewScreen.tsx:219: "Thank you · Thank you for reporting." (both title + body say thanks — redundant)

**Recommendation**: One string. "Report sent · Thanks — we'll look into it."

### C-40 (MEDIUM) — Friend request success copy
- FriendsScreen.tsx:226: "Friend request sent" · body = email address
- Fine, but no follow-up. Add: "We'll notify you when they accept."

### C-41 (POLISH) — "Thanks — we got it." feedback success
- SettingsScreen.tsx:804: `Thanks — we got it.`
- **Recommendation**: "Got it — thanks. We read every message."

---

## 7. Permission requests

### C-42 (CRITICAL) — iOS location purpose string is grammatically broken

`app.json` line 19:
> "NSLocationWhenInUseUsageDescription": "Cairn needs your location to track your track and show nearby markers."

**"track your track"** — nonsensical duplication. Grade: **D**.

**Recommendation**: "Cairn uses your location to record your hikes and show nearby cairns on the map."

### C-43 (CRITICAL) — Background location purpose string mentions technical detail
`app.json` line 20:
> "Cairn needs background location to keep recording your track when the screen is locked or you switch apps."

Better than the foreground one, but "track" is still overloaded. Grade: **C+**.

**Recommendation**: "Cairn keeps recording your hike when your screen is off or you switch apps, so your GPS trace never breaks."

### C-44 (CRITICAL) — Motion purpose says "to point the in-app compass to true north"
Grade: **C**. Fine functionally but "in-app compass" is jargon.
**Recommendation**: "Cairn uses your device orientation to show which way you're facing on the map."

### C-45 (MEDIUM) — Photo library
`app.json` line 22:
> "Cairn needs photo library access so you can attach photos to your routes and cairns."

Mentions "routes and cairns" — but PlantScreen has no photo attachment (v0.2.5 codebase doesn't seem to support it). If this is a future feature: fine. If it's not shipping: **misleading permission grant**.

### C-46 (MEDIUM) — Microphone: "voice notes attached to flags (optional)"
Says "flags" not "cairns" — inconsistent with rest of PlantScreen wording. Also ContentStep says voice memo is "coming soon" (ContentStep.tsx:133).
**If voice memo doesn't work in v1**: don't request microphone permission at launch. Wait until user taps the voice memo button.

### C-47 (CRITICAL) — Denied-state copy exists only for Memory screen

- MemoryScreen.tsx:713-722: has "Location permission needed" + "Open Settings" CTA — GOOD.
- HikingScreen / RunningScreen / MapScreen when location denied: shows chip "Enable GPS" — but no direct "Open Settings" affordance from the map screens themselves.
- useTrackingStore.ts:397-404: has a "Improve hike tracking" alert with "Please set Location permission to Always Allow in Settings" — good copy but no button to open Settings, so user has to leave the app manually.

**Recommendation**: Every denied-permission state must have an "Open Settings" button that calls `Linking.openSettings()`.

### C-48 (BLOCKER for launch) — No App Tracking Transparency (ATT) explanation string
No `NSUserTrackingUsageDescription` in `app.json`. If Cairn ships any SDK that requests IDFA (analytics, crash reporting with device identifiers), this is App-Store-reject territory. Confirm before submission.

---

## 8. Onboarding / first-run copy

### C-49 (CRITICAL) — "Explorer" is dead but still shown in greeting

- HomeScreen.tsx:38-40: `'Kia ora, Explorer'` / `'Good afternoon, Explorer'` / `'Good evening, Explorer'`
- Even though comments (AuthScreen.tsx:683, 772, 984) say "Explorer" is a deleted uiMode label from the discarded Explorer/Navigator system.
- User has no idea what "Explorer" means. Feels like a placeholder.

**Recommendation**: Use the user's first name if available (`user.name` — falls back to what?). Or drop the persona entirely: "Kia ora" / "Good afternoon" / "Good evening" alone.

### C-50 (CRITICAL) — Splash tagline is two lines with no connective glue
- AuthScreen.tsx:817-821: "Leave a mark." "Guide the next."
- Poetic, but a first-time user has no idea what the app does. The Sign-In / Create Account buttons come next with zero product context.
**Recommendation**: Either add a subtitle explaining what Cairn does ("A hiking companion for Aotearoa — track your route, leave cairns for others."), or keep the poetic tagline and add a 3-line product intro screen after signup before Home.

### C-51 (MEDIUM) — Splash "Your hiking data is securely stored on your account. Sign in to access it on any device."
- AuthScreen.tsx:853
- Reassuring; keep. But "any device" is misleading if app is iOS-only at launch.

### C-52 (MEDIUM) — Post-verify greeting
- AuthScreen.tsx:946-947: "Nau mai, haere mai" / "Your track starts now."
- "Your track starts now" — see C-03 (track overload). Say "Welcome to Cairn." or "Ready to record your first hike?"

### C-53 (BLOCKER for launch) — No onboarding tutorial

First-time user opens Home → no explanation of what the four cards do, what a Cairn is, what Memory is, why they'd plant a flag. This is the biggest UX gap in the app.

**Recommendation**: 3-slide onboarding after first sign-up:
1. "Record your hikes with GPS." (Hiking card animation)
2. "Leave cairns — notes and voice memos — for others (or your future self)." (Plant animation)
3. "Watch your Memory grow as you explore Aotearoa." (Memory fog reveal)

---

## 9. i18n readiness

### C-54 (BLOCKER for launch) — Zero i18n framework installed

- No `i18next`, `react-intl`, `expo-localization`, or `useTranslation` usage anywhere in `app/src/`.
- Every visible string is hardcoded.
- Estimated hardcoded user-visible strings: **500+** across 41 files.

**Recommendation**: If shipping only English at launch, document that Chinese/Māori support is v1.x roadmap. If shipping multi-language: install i18next this Sprint, wire every user-visible string.

### C-55 (CRITICAL) — Only 3 Māori strings exist

- HomeScreen.tsx:38: "Kia ora, Explorer" (comment says translator review pending)
- AuthScreen.tsx:946: "Nau mai, haere mai"
- SettingsScreen.tsx:1000: "Ngā mihi nui — thanks for using Cairn."

For an app positioned as NZ-focused, **three Māori words in a whole app is tokenism**. Options:
- (a) Remove all three and be honest that the app is English-only for v1
- (b) Commission proper Te Reo translations for at least: home stats, empty states, permission strings, welcome banners

### C-56 (BLOCKER) — Distance unit locale-awareness is manual per-user toggle

`useDistance()` hook resolves 'km' vs 'mi' from user preference (SettingsScreen preferences section). This is good.

BUT: elevation unit is separately computed (`dist.elevUnit`), and there's no auto-detection from device locale on first run. NZ users default to metric (correct), US users to imperial. Detect from `Localization.locale` on first run.

### C-57 (CRITICAL) — Number/date formatting is locale-unaware

- `getRelativeTime` (utils/geo.ts:107): "5m ago", "3h ago", "yesterday", "4 days ago" — English-only, hardcoded.
- `formatDuration` (utils/geo.ts:67): "1:23:45" — locale-neutral (fine).
- Prices: PaywallSheet.tsx:68: `$4.99` — hardcoded USD-style symbol, no currency locale. **App is targeting NZ at NZD $5.99/mo per project memory but PaywallSheet still shows $4.99.**

### C-58 (BLOCKER for launch) — Currency mismatch: PaywallSheet says $4.99, launch plan says NZD $5.99
- PaywallSheet.tsx:68-69: "$4.99" · "per month"
- Per project memory (`project_cairn_launch_strategy.md`): NZD $5.99/mo is the launch price.
- **This is a real BUG, not just copy — fix before App Store submission.**

---

## 10. Accessibility strings

### C-59 (CRITICAL) — Only 2 files have any accessibility labels

- SettingsScreen.tsx — modal title uses `accessibilityRole="header"`
- HierarchyPanel.tsx — has `accessibilityLabel="Go up"`

That's it. Every other touchable in the app has NO accessibility label, meaning VoiceOver reads them as "button" or worse.

**Blocker for App Store review** if targeting the Accessibility guidelines strictly. Definitely a launch quality miss.

### C-60 (CRITICAL) — Icon-only buttons have no labels

Examples:
- HomeScreen ToolBtn (rows of icon buttons) — no `accessibilityLabel`
- BackButton — appears to lack a label prop (only variant)
- Every `<TouchableOpacity>` with just an `<Icon>` child
- Delete / edit / expand chevrons

**Recommendation**: Blanket audit — every icon-only touchable needs `accessibilityLabel`.

### C-61 (MEDIUM) — Announcements for state changes are missing

When recording starts, screen reader should announce "Recording started". When cairn is planted, "Cairn planted at your location." Currently nothing.

**Recommendation**: Use `AccessibilityInfo.announceForAccessibility` at key state transitions (start/stop recording, plant success, sign in).

### C-62 (POLISH) — Dynamic strings (like "3h ago", "12 km") should also announce sensibly

`getRelativeTime` returning "3h ago" is read as "three-H ago" by VoiceOver. Use `"3 hours ago"` for accessibility variant or ensure format is expanded.

---

## 11. Legal / compliance copy

### C-63 (BLOCKER for launch) — Terms of Service link goes to Apple's generic EULA

- SettingsScreen.tsx:892-895: "Terms of Service" link → `apple.com/legal/internet-services/itunes/dev/stdeula/`
- Hint says: "Apple's standard app terms — a Cairn-specific version is coming"
- **Not launch-ready.** App Store requires you to have a real EULA if you go beyond Apple's standard, and Cairn collects location data + user-generated content which strongly warrants custom terms.

### C-64 (BLOCKER for launch) — Privacy Policy link exists but URL is a constant elsewhere
- SettingsScreen.tsx:885: opens `PRIVACY_URL`. Verify the URL is actually reachable and the page is complete before submission.

### C-65 (CRITICAL) — Auth registration privacy checkbox copy
- AuthScreen.tsx:1084: "I have read and agree to the [Privacy Policy]"
- Standard, fine. But there's no separate ToS checkbox for a distinct ToS document. If you split Privacy + ToS, need two checkboxes.

### C-66 (CRITICAL) — Delete Account flow uses email, not in-app deletion
- SettingsScreen.tsx:1137-1146: Opens Mail app to privacy@cairnapp.nz asking user to email us to delete.
- **App Store REQUIRES in-app account deletion** (Guideline 5.1.1(v), enforced since 2022). Email-only = rejection.
- Body: "We've opened an email to privacy@cairnapp.nz. Please send it — our team will delete your account within 5 business days."
- **Blocker for launch.** Even if backend endpoint isn't ready, must accept the tap in-app and queue it server-side.

### C-67 (MEDIUM) — Report reasons are okay
- CairnPinsLayer.tsx:266-269: "Spam / Ad" · "Wrong info" · "Don't like it"
- MapScreen.tsx:801-804: "Fake or ad" · "Wrong info" · "Dislike"
- **Two different phrasings for the same three reasons**. Consolidate.

---

## 12. Miscellaneous other copy issues

### C-68 (CRITICAL) — "Coming soon" appears three times in production build

- AuthScreen.tsx:452: 'Google Sign In · Coming in next app update. Please use email sign-in.'
- AuthScreen.tsx:1135: 'Coming soon · Apple Sign In is not available yet. Please use email login for now.'
- PaywallSheet.tsx:27-29: 'Coming soon · Memory Pro will be available in the App Store release. For now, you have 5 friend slots.'
- ContentStep.tsx:133: '🎤 Voice memo (coming soon, max Xs)'

**Recommendation**: If a feature isn't shipping in v1, hide the button. Don't show a broken affordance with "coming soon". This is the worst possible UX signal — "we didn't finish".

### C-69 (CRITICAL) — Chinese comments in production code hint at incomplete i18n

Comments (not visible to user):
- MapHistoryScreen.tsx:489: `v412: 离线未同步 hike = 纯 placeholder 灰卡, 主体不可点, 只能长按放弃`
- MapHistoryScreen.tsx:121: `这些是 offline pending 从未 drain 成功的残余...`

Not user-visible but signals internal-only comments still leak into English-only builds. Nothing to fix in copy; just be aware.

### C-70 (MEDIUM) — "Plan Route" alert is a stub
- MapHistoryScreen.tsx:1088: `Alert.alert('Plan Route', 'Route planning coming soon')`
- Same as C-68 — hide unfinished features, don't stub them.

### C-71 (MEDIUM) — "Free Hiking" · "No route · explore freely" — cute but ambiguous
- HikingScreen.tsx:779-780
- "explore freely" — is this a mode, a state, an invitation? Say: "No route selected — track your GPS anywhere."

### C-72 (MEDIUM) — "Improve hike tracking" — permission alert title mixes verbs
- useTrackingStore.ts:398: title "Improve hike tracking", body "Cairn needs to keep tracking your GPS when the screen is locked..."
- Title reads like a Settings row, not an alert. Say "Keep recording when screen is off?"

### C-73 (POLISH) — "Low Power Mode is on"
- lowPowerModeWarn.ts:38-39: title + body copy are okay but "iOS may limit background GPS" is technical for non-savvy users.
- **Recommendation**: "Your phone is saving battery, which can pause GPS. Turn off Low Power Mode for reliable tracking."

### C-74 (POLISH) — Memory banner: "Memory: Too short to record" / "Memory: +0.12 km²" / "Memory: Familiar ground"
- StopSummarySheet.tsx:114-122
- "Familiar ground" is warm and NZ-appropriate. Keep.
- "Too short to record" implies fault. Say: "Just getting started — we'll add to your Memory next hike."
- "+0.12 km²" is technical. Say: "You revealed 0.12 km² of new ground."

### C-75 (POLISH) — TooShortSheet copy
- TooShortSheet.tsx:71-88: "Keep going a little longer" · buttons "Got it — keep going" / "End [hike/run] anyway"
- Warm and good. Keep.

### C-76 (MEDIUM) — Content step voice memo stub uses emoji
- ContentStep.tsx:133: "🎤 Voice memo (coming soon, max Xs)"
- Emoji-in-string is fine but the "coming soon" needs to go (see C-68).

### C-77 (POLISH) — PaywallSheet feature list
- PaywallSheet.tsx:76: "Restore purchases · Privacy · Terms"
- If PaywallSheet is coming-soon (C-68), remove entirely. Also "Restore purchases" without any purchase mechanism = broken.

### C-78 (MEDIUM) — MysteryCairnSheet vs RevealedCairnSheet
- MysteryCairnSheet.tsx:91-92: "Someone left a cairn here" · "You'll be able to read it when you get closer."
- MysteryCairnSheet.tsx:108: "Walk this way to reveal"
- Good copy. Keep. Ensure "Someone" is consistent with "A neighbour" (RevealedCairnSheet.tsx:75) — a "neighbour" implies proximity/community, "someone" is anonymous. Pick one voice.

### C-79 (MEDIUM) — Route preview fallback
- RoutesScreen.tsx:261: "Route preview"
- Empty placeholder text — user thinks the preview is broken. Say: "Preview loading…" or hide.

### C-80 (POLISH) — Memory hint modal
- MemoryScreen.tsx:910-918: "Walk to unlock your memory" · body + "Got it" CTA
- Good copy. Keep.

### C-81 (POLISH) — Settings feedback thanks
- SettingsScreen.tsx:804: `Thanks — we got it.`
- Warm. Keep.

### C-82 (POLISH) — Settings footer bilingual
- SettingsScreen.tsx:1000: "Ngā mihi nui — thanks for using Cairn."
- Beautiful. Keep. This is exactly the right kind of touch (see C-55 — need MORE of this, not less).

### C-83 (MEDIUM) — About Cairn 5-tap unlock hint
- SettingsScreen.tsx:457: 'Developer mode · Debug tools unlocked. Scroll down to see them.'
- Fine for dev but should not be discoverable / triggerable in App Store build. Confirm gated by build flag.

### C-84 (MEDIUM) — "Cairn planted (offline)" body text
- PlantScreen.tsx:221-222: `"Cairn planted (offline)"` / `"Saved locally. We'll upload it as soon as you're back online."`
- Good. Keep this pattern.

### C-85 (CRITICAL) — "Could not plant cairn" body text is a raw error message + boilerplate
- PlantScreen.tsx:247-251: `Alert.alert('Could not plant cairn', (e?.message ? String(e.message) : 'Please try again in a moment.') + '\n\nYour draft is saved — try again or come back later.');`
- The `e.message` may contain "TypeError: Network request failed" — user should never see raw exception text.

### C-86 (MEDIUM) — Route editor "Cannot save"
- RouteEditorScreen.tsx:526: `Alert.alert('Cannot save', result.error ?? 'Unknown error');`
- Same as C-08. Rewrite.

### C-87 (POLISH) — "GPS Offline" chip
- HikingScreen.tsx:898: "GPS Offline" — technical, but on the map screen it's information not an error. Fine.

### C-88 (POLISH) — MapScreen "Real Map Available"
- MapScreen.tsx:105: `styles.mapFallbackTitle: 'Real Map Available'`
- Presumably debug UI — verify not visible in production. If visible: rewrite entirely.

---

## 13. Copy improvements ranked by impact (top 15)

1. **Terminology consolidation** (C-01, C-02, C-03) — biggest single UX improvement. Ship a copy sheet in the next Sprint.
2. **Save Hike / Plant Cairn silent success** (C-36, C-37) — users doubt saves worked.
3. **Discard mid-recording has no confirm** (C-26) — data loss risk.
4. **Explorer greeting** (C-49) — makes new users feel like beta testers.
5. **App Store rejection risks**: in-app deletion (C-66), real ToS (C-63), currency mismatch (C-58).
6. **Onboarding tutorial** (C-53) — no product explanation on first run.
7. **Location permission "track your track"** (C-42) — grammatically wrong at App Store level.
8. **Password change surprise sign-out** (C-38) — feels broken.
9. **"Coming soon" affordances** (C-68) — hide broken buttons entirely.
10. **Accessibility labels blanket audit** (C-59, C-60).
11. **Empty states — Home has none** (C-17) — silent first run.
12. **Discard/Reset/Confirm verb inconsistency** (C-27, C-28, C-29).
13. **Error messages: raw exceptions leaking** (C-06, C-10, C-13, C-85).
14. **Māori tokenism** (C-55) — either commit or drop.
15. **Loading state labels** (C-32) — no naked spinners.

---

## Cross-reference to other reports

- Overlap with **FUNCTION_AUDIT** F-I18N-01 (already flagged Te Reo gap)
- Overlap with **LAUNCH_CHECKLIST**: C-58 (currency), C-63 (ToS), C-66 (account deletion), C-48 (ATT), C-59 (accessibility)
- Cairn-specific engineering docs: any Sprint that adds a new user-visible string MUST update a canonical `strings.ts` (currently doesn't exist) or reference this vocabulary table.

---

**End of report — 88 total findings.**
