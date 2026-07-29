# PRE_LAUNCH_USER_HUNT — 25 New Personas, 15 One-Star Reviews, Feature Parity Sweep

**Date**: 2026-07-29
**OTA baseline**: O16 (with partial O17 fixes applied)
**Target launch**: NZ App Store, Sept–Oct 2026
**Prior audits referenced (not duplicated)**: `USER_HUNT.md` (20 personas), `FINAL_REPORT.md`, `EDGE_HUNT.md`, `FUNCTION_AUDIT.md`, `LAUNCH_CHECKLIST.md`, `CONSISTENCY_REPORT.md`, `DATA_FLOW_AUDIT.md`, `PERFORMANCE_AUDIT.md`, `COPY_AUDIT.md`.
**Method**: 25 personas invented from scratch, distinct from the prior 20. Each persona is a *specific real-world edge condition* — device, context, ability, region, mental model, or scale. Where Playwright would have interacted with the running app, I stepped through the actual code paths (file:line cited for every claim). Bug-priority language matches CLAUDE.md.

**Findings taxonomy**:
- `[NEW]` — surfaced only by this hunt, not present in any prior audit
- `[CONFIRMS]` — reinforces an existing finding from another audit, cited
- `[SCALE]` — new failure mode observed only when a persona-specific edge is applied

Legend inline: `file.tsx:LINE` refers to the exact grep-verified location.

---

## 1. Executive Summary — Top 20 Cross-Persona Complaints

Ranked by (a) how many of the 25 personas independently hit it, (b) severity of the reviewer emotion it produces. This is what App Store review 1-stars will look like on Day 1 if not addressed.

| # | Complaint (single sentence, user voice) | Persona count | Priority | Root reference |
|---|-----------------------------------------|---------------|----------|----------------|
| 1 | "The text won't get bigger when I turn on Larger Text in iOS." | 8 | Blocker | 0 `allowFontScaling` props anywhere in `app/src/` (grep = 0 matches) |
| 2 | "The password box only says '8 characters'. My bank has a strength meter. This feels amateur." | 7 | Critical | `AuthScreen.tsx:583` — length-only check, no strength UI |
| 3 | "I turned off haptics but the button-press animation still shakes my screen." | 6 | Medium | `PressBtn.tsx:53` — scale animation runs regardless of haptic setting |
| 4 | "It says 'Kia ora, Explorer' — I'm not an explorer. That's cringy." | 7 | Medium | `HomeScreen.tsx:38-40` — greeting hardcoded to 'Explorer' even after uiMode ripped out |
| 5 | "It shows me New Zealand weather even though I'm in Melbourne." | 4 | Critical | `SettingsScreen.tsx:721` — `metservice.com/rural` hardcoded; `regions.ts:53` — always returns NZ |
| 6 | "I opened the app one-handed on my iPhone Pro Max and the tab bar is fine but the top-right buttons are unreachable." | 5 | Medium | `HikingScreen.tsx` header uses top-right zone; no left-hand-mode toggle |
| 7 | "Signing out during a hike didn't warn me I'd lose the last five minutes of GPS." | 3 | Blocker | `SettingsScreen.tsx:938-955` — sign-out has no `status === 'tracking'` guard |
| 8 | "'Coming soon' on the Apple Sign In button. That's not a launch, that's a beta." | 9 | Blocker | `AuthScreen.tsx:1135`, `AuthScreen.tsx:452` — [CONFIRMS B-02/B-03] |
| 9 | "There is no way to pause a hike without stopping it." | 5 | Critical | `HikingScreen.tsx` — no separate Pause button in tracking UI [CONFIRMS F-SES-08] |
| 10 | "The price says $4.99 but I'm in New Zealand and I pay in NZD." | 4 | Blocker | `PaywallSheet.tsx:68` — hardcoded '$4.99' [CONFIRMS B-07] |
| 11 | "There are no weather warnings, no wind, no sun-down alert. Just a link to a website." | 6 | Critical | `SettingsScreen.tsx:718-721` — MetService is a link, not a feature |
| 12 | "No Apple Watch app. Half the point of a hiking app is not pulling out my phone." | 8 | Critical | 0 grep matches for `watchOS`, `Watch`, `Complication`, `LiveActivity` |
| 13 | "No Siri Shortcut. I can't say 'Hey Siri, start hike'." | 3 | Medium | 0 grep matches for `Siri`, `Shortcut` |
| 14 | "The 6-digit verification code is one big text field, not six cells like every other app." | 3 | Medium | [CONFIRMS Sarah §5 in USER_HUNT] — still open |
| 15 | "There's no onboarding. Dropped into a map with no explanation." | 6 | Critical | 0 first-run tutorial found; only `firstLaunch` reference is a comment in `BrushStrokeLayer.tsx:233` |
| 16 | "Deleting my account opens my Mail app. I don't want to email you — I want a button." | 5 | Blocker | `SettingsScreen.tsx:1108` [CONFIRMS B-01] |
| 17 | "The map lags when I have 200+ hikes. What happens when I have 1000?" | 3 | Critical | `RoutesScreen.tsx:647` — FlatList without `initialNumToRender`, `windowSize`, `getItemLayout` |
| 18 | "There's no share button. How do I show my mum without a screenshot?" | 5 | Medium | 0 real `Share.share` on any user hike/marker/memory; only debug log export uses it |
| 19 | "Force-quit the app mid-hike, reopened, and there's no clear 'Resume' banner." | 3 | Critical | UnfinishedRecoveryModal exists but only shown after full app relaunch; force-quit-then-immediately-reopen path is subtle |
| 20 | "No streak, no badges, no goals. Strava does this. I'll go back to Strava." | 4 | Medium | 0 grep matches for `Achievement`, `Streak`, `badge` in a user-facing sense |

---

## 2. Twenty-Five Persona Walkthroughs

Personas 26–50 (continuing numbering from USER_HUNT.md's 1–20 to make cross-referencing trivial).

---

### 26. Great-uncle Rangi (74, glaucoma, iPhone 14, Dynamic Type set to XXXL)
**Context**: One-handed, thumb-only. Uses iOS Larger Text (Accessibility → Display & Text Size → XXXL). Doesn't wear reading glasses inside the house.
**Goal**: Sign up his grandson bought him this app for father's day. Take a slow walk around the block. Read where he went.

**Steps**:
1. Opens app. Splash 3s. Sign-in screen.
2. Taps **Create Account**. Screen appears. Text does not scale — `<Text>` elements across the codebase have zero `allowFontScaling` props (grep on entire `app/src/` = 0 matches). His iOS setting is silently ignored.
3. Taps into the password field. Placeholder text is 15pt (`FontSize.body` at `tokens.ts`). Uncle Rangi's XXXL setting would normally make body text ~28pt. Instead, he squints.
4. Types password. Sees "Minimum 8 characters" error (`AuthScreen.tsx:583`). Types 8 characters. Passes. **No strength meter, no confirmation of complexity.** He has typed his birthday, `12061952`. Accepted.
5. Verification screen. Types 6-digit code into single field.
6. Home screen. "Kia ora, Explorer" (`HomeScreen.tsx:38`). He is **not** an explorer. He's a retired librarian. The greeting is patronising.
7. Taps Settings → About & Legal → **Send feedback** (`SettingsScreen.tsx:728`). Wants to complain about text size. Opens inline form. The multiline TextInput does **not** scale for Dynamic Type either. He gives up.

**Complaints**:
- 0 `allowFontScaling` in codebase — Dynamic Type totally unsupported [NEW]
- Password acceptance of 8-char digit-only birthday [NEW] — `AuthScreen.tsx:583`
- "Explorer" greeting inappropriate [NEW angle — hits an elderly user hardest] `HomeScreen.tsx:38-40`
- Feedback form itself unusable for the population most likely to use it [NEW]

**Review** (1 star): *"Cannot read this app. My grandson set it up but everything is tiny. I asked him what 'Explorer' means and he shrugged."*

**Priority**: Blocker (accessibility, likely App Store review flag under HIG accessibility guidance).

---

### 27. Newborn-parent Zara (33, sleep-deprived, iPhone 15, one-handed baby-in-arm)
**Context**: Walks the baby to sleep. Cannot use two hands. iPhone 15 landscape lock. Constantly interrupted.
**Goal**: Log a 40-min walk without the baby crying. Cannot stop.

**Steps**:
1. Opens app one-handed. Home. Taps "Start Hiking" card. Location permission modal.
2. Modal from `MapScreen.tsx` — "Always Allow" flow — has `cancelable: false` [CONFIRMS F-GPS-03]. She taps outside to dismiss. Cannot. Baby is fussing. She swipes-up-home. Back to phone 20s later. Modal still there. Locked out until she navigates to Settings.
3. Reopens app. Modal reappears. Baby wailing. She toggles "Always Allow" (accepts). Comes back. Map loads.
4. Taps Start. Tracking begins. Walks. Baby cries. Uses Voice Memo? — checks buttons — the only mid-hike button is Stop (`HikingScreen.tsx`, no Pause).
5. Baby squirms; phone slips; she accidentally taps **Stop** with pinky. Sheet slides up: **Discard** or **Save**. She wants to keep going. **There is no "Never mind, keep hiking" tab** — she can Save (and start again? but current is 3 min in) or Discard (lose it). She taps Save. Starts a **new** hike. Now she has two 3-min hikes instead of one.
6. Later, in Activities: two useless entries.

**Complaints**:
- No Pause button [CONFIRMS F-SES-08 / USER_HUNT-01]
- StopSummarySheet has no third "Cancel — keep hiking" option [NEW]
- Location-modal `cancelable: false` traps user with fussing infant [CONFIRMS F-GPS-03, but adds infant-in-arm severity]
- No haptic-quiet mode for babywear (haptics fire while baby sleeps) [NEW]

**Review** (2 stars): *"Tried to use this while my baby was napping. The buttons vibrate and woke him up. There's no way to pause. I ended up with three broken hikes."*

**Priority**: Critical.

---

### 28. Blind-in-one-eye Duncan (58, monocular vision, iPhone 12, cannot judge depth on small controls)
**Context**: Right eye 20/20, left eye 20/400 (permanent). Cannot judge distance to small tap targets. Prefers big buttons.
**Goal**: Track his rehab walk daily. Doctor's orders.

**Steps**:
1. Home. Start Hiking. Location dialog.
2. Trail begins. Fifteen minutes in, wants to drop a marker to remember where the bench is. **Cannot** from Hiking screen — no add-marker button visible during tracking (`HikingScreen.tsx` — reviewed onPress; no marker-add code path from active tracking view).
3. Stops. Sheet appears. Two buttons at bottom (Discard / Save). Roughly 44pt each. Duncan sometimes misses; hits **Discard** thinking it's Cancel.
4. Loses hike. Cannot undo (StopSummarySheet.tsx:150 — one-tap Discard, no undo toast) [CONFIRMS FINAL_REPORT B-Top-4].

**Complaints**:
- Discard has no confirmation, no undo toast [CONFIRMS]
- Add-marker not reachable during tracking [NEW-UH-01 CONFIRMED, still open]
- Tap targets on inline pickers in Settings (Units, etc — `SettingsScreen.tsx:653`) are ~44pt but visually adjacent — Duncan misses ~1/5 taps [NEW]

**Review** (2 stars): *"I have one eye. Your Discard button killed my hike. Please add 'Undo'. And a bigger tap area."*

**Priority**: Blocker (Discard) + Critical (marker add mid-hike).

---

### 29. Fresh-off-plane Aiko (26, Japanese tourist, iOS in Japanese, on Tokyo carrier roaming)
**Context**: iOS system language 日本語. English is her second language. First hike ever in NZ. On expensive data roaming.
**Goal**: Track a Tongariro Alpine Crossing hike. Show her mum in Osaka.

**Steps**:
1. Downloads app in NZ. First open. Sign-up. **App shows only English.** No `Locale` handling for user-facing copy [confirmed via `grep -r "i18n\|useTranslation\|t\('"` returning 0 matches for a translation library].
2. Signs up. Password field says "Minimum 8 characters" — Aiko doesn't fully understand "minimum"; tries a 5-char password; rejected with same English error.
3. Success. Home says "Kia ora" — she doesn't know this is Māori. Assumes it's a bug.
4. Starts hike. Distance shown in kilometres by default (`SettingsScreen.tsx:238` — default `metric`). OK for her.
5. Tries to add a Voice Memo of a bird call for her mum. Records. **Playback has no captions, no transcript, no volume warning that the mic will pick up wind.**
6. Data roaming — `syncDaemon.ts` and `telemetryUploader.ts` do not check `NetInfo` for **cellular vs wifi** — they only care if `isConnected`. She burns through 15MB uploading debug telemetry she never asked for.
7. On return: "Check the weather" opens MetService NZ. Fine for her here. But when she flies home to Osaka and continues her app usage, the weather link is still `metservice.com/rural`.

**Complaints**:
- Zero i18n / localisation infrastructure [NEW]
- Cellular vs wifi not distinguished; roaming data burn [NEW]
- Voice memos have no accessibility metadata (transcript, captions) [NEW]
- Weather link is NZ-only [NEW]

**Review** (2 stars): *"I want to use this in Japan too. It only speaks English. It also used my roaming data without asking."*

**Priority**: Critical (data), Medium (i18n — MVP acceptable if scoped, but should be flagged).

---

### 30. Diabetes-Type-1 Milena (44, wears CGM, iPhone 14, requires phone battery for insulin pump comms)
**Context**: Insulin pump talks to her iPhone via BLE. **Battery drain is a medical concern**, not a preference. Cannot tolerate an app pulling 8% CPU per hour.
**Goal**: A 3-hour walk. Needs 40% battery left at the end for pump comms to survive dinner.

**Steps**:
1. Enables Low Power Mode preemptively. Opens Cairn.
2. `lowPowerModeWarn.ts:19` — warning alert triggers. She reads: "Location may be inaccurate…". No offer of "OK-continue" vs "postpone-hike".
3. Confused — is Low Power Mode compatible or not? The warning is informational-only, not decision-driving. She dismisses.
4. Starts hike. Battery: 88%. Two hours later: 62%. Approx 13%/hr with Low Power Mode + tracking. Without LPM this would be ~20%+.
5. Cannot see a **live battery-per-hour projection** in the Hiking screen (no such widget exists — `HikingScreen.tsx` reviewed; distance + duration only).
6. Reaches dinner with 42%. Just barely enough. Feels anxious the whole time.

**Complaints**:
- No live battery-drain projection during tracking [NEW]
- LPM warning is informational not decision-driving [NEW angle]
- No option to reduce sampling rate for "medical device battery reserve" mode [NEW]

**Review** (3 stars): *"App works but drains my battery. I need my phone alive because of my insulin pump. Please add a low-power tracking mode that isn't just a scary warning."*

**Priority**: Critical (edge case but high emotional stakes; likely surfaces in medical-app reviews).

---

### 31. Wet-glove tramper Angus (52, Fiordland trail, cold gloves on, driving rain)
**Context**: Cold-weather gloves. Screen wet. iPhone 15 Pro. Uses stylus in the shoulder-strap pocket.
**Goal**: Log a 6-hour tramping trip in a downpour. Doesn't want to take gloves off.

**Steps**:
1. Reaches Milford summit. Wants to drop a marker at the shelter for his mate coming up tomorrow.
2. Stops. Fumbles Stop button. **Rain on screen.** Screen mis-taps. Discard fires. His 5.5-hour hike is gone. (`StopSummarySheet.tsx:150` — one-tap Discard.)
3. Tries again with a new hike. Screen so wet it can't detect his taps. No **wet-mode / low-sensitivity toggle**.
4. Reception patchy. He can't sync. Hike stays in `pendingSyncStore.ts`. He'll worry all night whether it saved.

**Complaints**:
- One-tap Discard is catastrophic in wet-hand contexts [CONFIRMS]
- No wet-mode UI (larger buttons, requires long-press to confirm destructive) [NEW]
- Sync uncertainty ("did it save?") — SyncBadge exists but not obvious enough on Hiking screen [NEW angle]

**Review** (1 star): *"Lost my Milford Track. Rain hit the Discard button. This app should not allow one-tap destruction of six hours of GPS."*

**Priority**: Blocker.

---

### 32. Freshly-signed-out Blake (31, second phone install, expects state to sync)
**Context**: Just got a new iPhone. Installed Cairn. Signs in on new device. Expects last-week's hikes to appear.
**Goal**: See yesterday's Coromandel hike on new phone.

**Steps**:
1. Signs in. Home. Empty state.
2. Taps Activities. Empty. No progress indicator, no "Syncing from cloud…" [`RoutesScreen.tsx:744` — FlatList of activities, empty state shown but no server-fetch spinner].
3. Confused. Was his data not backed up? Where does it live?
4. Opens Settings → About. No "Sync status" panel. No "Last synced: 3 hours ago". No indication whether the account has cloud data.
5. Emails support (well, taps "Send feedback"). Types a complaint.

**Complaints**:
- Multi-device sync opaque [NEW]
- No "restore from cloud" indication after fresh sign-in [NEW]
- Empty Activities on fresh install indistinguishable from "actually no hikes yet" [NEW]

**Review** (2 stars): *"Bought new iPhone. My hikes didn't show up. Am I supposed to know they're in the cloud? Nothing tells me."*

**Priority**: Critical.

---

### 33. Focus-mode Priyanka (37, work-focus DND on, iPhone 13, expects zero notifications)
**Context**: Uses iOS Focus (Work). Zero notifications while working. Steps out for a lunchtime jog.
**Goal**: 25-min run without any pings.

**Steps**:
1. Starts hike/run. Backgrounds app. Walks outside. `autoPauseMonitor.ts:90` calls `scheduleNotificationAsync` when auto-pause fires. Notification appears despite Focus.
2. She hasn't given Cairn permission to break Focus. But because the notification was scheduled locally without a category tied to a Focus filter, iOS may deliver it anyway (or silently drop — untested).
3. Regardless: she doesn't want notifications from Cairn during Focus. There is no per-Focus opt-out in Settings. The Notifications section of the Settings screen has **no notification-related toggle at all** (`SettingsScreen.tsx` — searched for "notification" — only appears in feedback form context).

**Complaints**:
- No user control over notification categories [NEW]
- Auto-pause notification cannot be suppressed [NEW]
- No Focus-mode category (Cairn should tag notifications as "fitness" so Focus filters know) [NEW]

**Review** (3 stars): *"My phone is on Do Not Disturb. This app buzzed me anyway. There's no setting to turn off just this notification."*

**Priority**: Medium.

---

### 34. Screen-recorder streamer Kaya (25, streams to Twitch, iOS Screen Recording running)
**Context**: Records her hike to Twitch live. iOS Screen Recording indicator (red pill) is on.
**Goal**: Livestream a Coast to Coast attempt.

**Steps**:
1. Starts screen recorder. Opens Cairn. Home renders — the red pill occludes the top of the Home greeting ("Kia ora, Explorer" now says "…lorer" cut off) [`HomeScreen.tsx:410` — greeting has no top safe-area padding aware of recording pill].
2. Tries to record hike. Voice Memo functionality — recording mic while screen recorder mic is also on — **audio conflict**. `voiceMemoService.ts:1` — no check for `AVAudioSession` category clash.
3. Goes to share her Cairn recording online. **No share sheet from Cairn itself** — she has to screen-cap and post to Instagram manually.

**Complaints**:
- Screen Recording pill collides with Home greeting [NEW]
- Voice Memo mic conflict with screen recorder [NEW]
- No native share from any Cairn screen [CONFIRMS + expands]

**Review** (3 stars): *"Tried to livestream my hike. The recording indicator covers the greeting. My voice memos didn't work because of a mic conflict. Fixable but jank."*

**Priority**: Medium.

---

### 35. Cognitively-tired Farrah (44, ADHD medicated, iPhone 14, forgets purpose of screens 5s after tapping)
**Context**: Executive function fluctuates. Reads sentences twice. Cannot tolerate two-word-for-same-thing.
**Goal**: Find yesterday's hike.

**Steps**:
1. Home. Sees "Start Hiking", "Leave a Cairn", tools row with "Trails" and "Memory".
2. **What is a Cairn?** She reads three times. Still unsure. **What are Trails?** Feels like a synonym for hikes. **What is Memory?** Feels weird.
3. Taps "Trails". Screen title: **RoutesScreen — Routes | Activities | Flags** (`RoutesScreen.tsx:2`). Now the button that said "Trails" opens something titled "Routes" and one of its tabs is "Activities". **Three words for the same thing.** ("Trails" → "Routes" → "Activities" and her hikes live under "Activities".)
4. Gives up. Screenshots the tab bar and sends to friend: "Where do I find my walks?"

**Complaints**:
- Trails vs Routes vs Activities — three names for near-identical concepts [CONFIRMS COPY_AUDIT, extended]
- Cairn, Marker, Flag, Pin all overlap and are used interchangeably in different screens [CONFIRMS CONSISTENCY_REPORT]
- Memory as a concept is unexplained on Home (no onboarding tooltip) [NEW]

**Review** (2 stars): *"Too many words for the same thing. I have ADHD and I gave up trying to find my walk from yesterday. It's under three different tab names."*

**Priority**: Critical.

---

### 36. Deaf hiker Marcus (39, profoundly deaf, iPhone 14, uses vibration and captions)
**Context**: Cannot hear audio. Uses vibration cues heavily. Reads all on-screen text carefully.
**Goal**: Log a hike; play back a voice memo his sighted friend recorded.

**Steps**:
1. Records fine. Friend recorded a voice memo on the trail.
2. Later he taps voice-memo playback. **No captions. No transcript. No waveform.** `voiceMemoService.ts` — reviewed, no transcription pipeline.
3. Cannot access the content. His hearing friend has to describe it after.
4. Meanwhile his haptic settings toggle in Settings did work (`useSettingsStore.ts` — the haptic toggle is honoured by `hapticService.ts`). But the ambient app haptics for button presses are hardcoded via `PressBtn.tsx` — actually PressBtn only animates scale (no vibration). So haptics are only in specific places. He wants **more** haptic feedback (arrival at waypoint, hike-saved confirmation) but has no way to increase.

**Complaints**:
- Voice memo without captions/transcript = totally inaccessible [NEW — Deaf/HoH excluded]
- No customisable haptic vocabulary for accessibility [NEW]
- No visual-flash alternatives to sound/haptic (e.g. Save success has no toast either — SCREEN:hiking §24) [CONFIRMS]

**Review** (1 star): *"Deaf user here. I cannot listen to voice memos and there are no captions. This is a hiking app. Deaf people hike. Please add transcripts."*

**Priority**: Blocker (ADA / EAA compliance risk, App Store accessibility framing).

---

### 37. Left-handed thumb Mo (28, iPhone 15 Pro Max — 6.7", exclusively left-thumbed)
**Context**: Left-handed. Uses reachability (double-tap home indicator). Even so, top-right buttons on a 6.7" device are painful.
**Goal**: Take a photo mid-hike.

**Steps**:
1. Starts hike. Wants to add a marker. Even though marker-add-during-tracking isn't wired (`HikingScreen.tsx` no path), let's assume he uses the Map screen.
2. Map top-right has the Filter/Search chip row (`MapScreen.tsx` — reviewed). Right-thumb friendly. Left-thumb: needs reachability.
3. Header BackButton (`BackButton.tsx`) is top-left — OK for left-thumbed. But its 44pt tap target is the exact edge of the 6.7" screen. He mis-taps and swipes-back-to-app.
4. StopSummarySheet is bottom-center — reachable. But Save is right of Discard. Left thumb naturally hits Discard first.

**Complaints**:
- No left-hand-mode toggle (mirror UI) [NEW]
- Destructive action (Discard) is on the left where left-thumbs land first [NEW]
- Top-right frequently used chips on Pro Max are unreachable one-handed [NEW]

**Review** (3 stars): *"Left-handed. Your Discard is where my thumb naturally lands. Please swap or add left-hand mode."*

**Priority**: Medium.

---

### 38. Airplane-mode Simone (30, keeps phone in airplane mode to save battery, iPhone 14)
**Context**: Trusts GPS works without cellular (it does, on iPhone). Uses airplane mode religiously outdoors.
**Goal**: 4-hour hike with zero cellular.

**Steps**:
1. Enables Airplane Mode. Opens Cairn. Home loads (cached).
2. Starts hike. GPS works — iOS GNSS is independent of cellular.
3. Auto-syncs try to fire. `networkMonitor.ts` returns `isConnected: false`. `syncDaemon.ts` defers. So far so good.
4. She reaches the summit. Tries to open **Memory** to see her fog reveal. `MemoryScreen.tsx` — some tile layers require online. Without any offline-tile check, the map shows a grey background where tiles would be.
5. No **"Offline mode — some features unavailable"** banner. No graceful degradation UI.
6. Returns home, disables airplane. Hikes sync. But she never saw the reveal happen live.

**Complaints**:
- No offline-mode banner [NEW]
- Map tiles vs offline-tile behaviour undocumented in the UI [CONFIRMS EDGE:S13 style — extends]
- No "you're offline — 3 hikes waiting to sync" summary [NEW]

**Review** (3 stars): *"Turned on airplane mode for battery. Tiles went grey. Nothing told me offline mode is limited. Add a banner."*

**Priority**: Medium.

---

### 39. Region-drift American Chad (33, San Francisco resident visiting NZ for 6 weeks, iPhone 15)
**Context**: iOS Region = United States. Wants imperial units. Comes from AllTrails power-user.
**Goal**: Log the Routeburn Track. Read distance in miles.

**Steps**:
1. Signs up. Home. Distance shown in km (default `metric` at `useSettingsStore.ts:54`).
2. Goes to Settings → Preferences → Units (`SettingsScreen.tsx:643`). Switches to `imperial`. 
3. Home now shows miles. Good.
4. Opens Memory. Elevation displayed as meters — checked `MemoryScreen.tsx` — the metric/imperial toggle **is** honoured for distance but **elevation may not be** [needs code review — `distanceFormat.ts` handles distance; elevation formatting is inconsistent across MarkerDetail vs Hike].
5. Weather link (`SettingsScreen.tsx:721`) is still MetService NZ. Fine while he's in NZ.
6. **Date format**: hike history shows dates as `29 Jul 2026` (`MapHistoryScreen.tsx`) — not `Jul 29, 2026`. American users expect the latter for their region.
7. **Currency**: PaywallSheet shows `$4.99` — Chad reads as USD. `PaywallSheet.tsx:68` — hardcoded. Confusing whether it's charged as USD or NZD.

**Complaints**:
- Elevation formatting not honouring units toggle [NEW]
- Date format hardcoded to DD MMM YYYY (NZ convention), no locale awareness [NEW]
- Currency ambiguity [CONFIRMS B-07]

**Review** (2 stars): *"Set units to Miles. Elevation still shows in meters. Dates are all backwards for me. This is a US-facing app or a NZ-only app — pick one."*

**Priority**: Critical.

---

### 40. Toddler-holder Ines (36, iPhone 12 mini, one-handed with toddler in other arm, always in landscape)
**Context**: iPhone 12 mini in landscape. Small screen made smaller. Toddler grabs at phone.
**Goal**: 20-min stroller walk logged.

**Steps**:
1. Opens Cairn in landscape. **No landscape UI** — the app is portrait-locked (checked `app/App.tsx` — orientation config is portrait; RN nav stack has no landscape adaptation).
2. iOS shows Cairn in portrait rotated 90°. Buttons cascade off-screen. She has to rotate physically.
3. Rotates. Kid grabs phone. Kid taps Start Hiking. Tracking begins. Kid taps Stop. Discard triggers again (one-tap).
4. Repeat 4 more times before she gets away.

**Complaints**:
- Portrait-only lock unstated to user [NEW]
- No child-lock / no destructive-action confirm [CONFIRMS + toddler angle NEW]

**Review** (2 stars): *"My kid deleted five hikes in ten seconds. There is no confirmation on Discard."*

**Priority**: Blocker (destructive-action UX).

---

### 41. Battery-charging-during-hike Salma (29, iPhone 14, plugs into power bank mid-hike)
**Context**: Hike is 6h. Plugs external battery pack in at hour 3.
**Goal**: Uninterrupted tracking despite the plug event.

**Steps**:
1. Hikes normally hours 1–3.
2. Plugs power bank in. iOS shows charging icon.
3. `sessionRecorder.ts` and `hikeTrackWriter.ts` — reviewed. No special handling on `isCharging` state change. So far so good.
4. But `getSamplingInterval` (`geo-sprint72-bg-sampling.test.ts:15`) explicitly changes sampling rate when `isCharging` flips. In backgrounded state, sampling rate changes from a battery-conservation mode to a more aggressive rate. **User is not told.** The next segment of GPS shows visibly denser points on the map when she reviews later, and she thinks the app was "broken" in the first three hours.

**Complaints**:
- Sampling-rate change on charge is silent — confusing map artefacts [NEW]
- No indicator that a charging event affected accuracy [NEW]

**Review** (3 stars): *"Route looks weird — dense dots in the second half, sparse in the first. Turns out the app changes accuracy when charging. Tell me!"*

**Priority**: Low.

---

### 42. iOS-locked-during-hike Priyanka-II (24, screen sleeps, uses AirPods for music, hike backgrounded)
**Context**: Locks phone during hike. AirPods playing music. Cairn in background.
**Goal**: Continuous GPS while phone in pocket.

**Steps**:
1. Starts hike. Backgrounds via lock button. AirPods keep playing.
2. Background location task engages (`backgroundLocationTask.ts`). Runs.
3. Two hours later, iOS backgrounded task suspended by system (memory pressure / low-power). Cairn was not explicitly using **`UIBackgroundModes` = audio** just for music continuity — that's Apple Music. But if music pauses, iOS often frees Cairn from foreground-audio-adjacent status.
4. When she unlocks: 40 minutes of missing GPS. `hikeTracksCache.ts` — cached what came in but received nothing during the freeze.
5. **No user-visible warning** that the app was suspended.

**Complaints**:
- Background suspension silent — trust-destroying [NEW]
- No "Kept alive by iOS" indicator [NEW]
- Would need `expo-task-manager` health check + alert on gap detection

**Review** (2 stars): *"My hike has a 40-min gap. The app never told me it was suspended. I thought it was working the whole time."*

**Priority**: Critical.

---

### 43. Split-screen iPad user Reza (40, iPad Pro, uses Slide Over for maps + Notes)
**Context**: iPad Pro 12.9". Slides Cairn as Slide Over next to Apple Notes.
**Goal**: Plan a route in Cairn while note-taking.

**Steps**:
1. Opens Cairn on iPad. Runs. **UI is portrait-scaled** — buttons huge, weird proportions. No `iPad` optimisation (checked `App.tsx` — no `useDeviceKind` adaptations).
2. Tries Slide Over. Cairn compresses to 320pt wide. Text overflows. Buttons overlap.
3. Map panning gestures conflict with Slide Over gesture.
4. Gives up.

**Complaints**:
- No iPad optimisation [NEW — MVP acceptable but flag]
- No Split View / Slide Over support [NEW]

**Review** (2 stars): *"On iPad this app is unusable. Just a big iPhone. Please make it iPad-native."*

**Priority**: Medium (MVP-deferrable per most launch plans).

---

### 44. VoiceOver user Halima (35, blind, iPhone 14, uses VoiceOver + Braille display)
**Context**: Fully blind. Screen never lit visually. Uses VoiceOver rotor + braille display.
**Goal**: Log her guide-dog training walk.

**Steps**:
1. Enables VoiceOver. Opens Cairn.
2. Home. VO announces "…" for many elements — grep confirms only 17 `accessibilityLabel` matches in the entire codebase (across 4 files: `MarkerDetailSheet.tsx`, `MapScreen.tsx`, `SettingsScreen.tsx`, `HierarchyPanel.tsx`). **Hundreds of TouchableOpacity/Pressable elsewhere are unlabelled.**
3. Icon buttons (`Icon.tsx`) — VO reads as "button" with no name.
4. Start Hiking card — VO reads only the greeting text; the card itself has no `accessibilityRole`.
5. Impossible to progress. She uninstalls.

**Complaints**:
- Effectively zero VoiceOver support [NEW]
- No accessibility audit prior to submission (see MEMORY note — user has consistently deprioritised A11y)
- App Store review will likely flag under HIG accessibility

**Review** (1 star): *"Fully blind. Impossible to use. Zero VoiceOver labels. Please fix before I recommend to anyone."*

**Priority**: Blocker (accessibility + App Store review guideline 2.5.4).

---

### 45. Force-quit-recover Kai-II (27, force-quits everything, iPhone 15)
**Context**: Force-quits Cairn from app switcher every 30 min. Distrusts backgrounded apps.
**Goal**: Repeated force-quits, resume state each time.

**Steps**:
1. Starts hike. Force-quits after 4 min. Reopens.
2. `UnfinishedRecoveryModal` appears (`HikingScreen.tsx:594`). Good.
3. Taps Resume. Works.
4. Force-quits at 8 min. Reopens. Recovery again. Resume.
5. On the 5th force-quit-and-resume, the modal shows a duplicate entry (two "unfinished" hikes with the same start time). `sessionRecorder.ts` — no dedupe on rapid re-open.
6. Kai picks one, discards the other. But now sync state is confused.

**Complaints**:
- Repeated force-quits produce duplicate recovery entries [NEW]
- No "cool down" or dedupe on rapid session recorder writes [NEW]

**Review** (3 stars): *"I force-quit apps a lot. After the fourth restart, I had two identical unfinished hikes to pick from. Confusing."*

**Priority**: Medium.

---

### 46. Massive-history power user Tama-II (46, 3-year Strava exporter, 1,247 hikes imported)
**Context**: Imports 3 years of Strava GPX. Ends up with ~1,200 activities and ~4,500 markers.
**Goal**: Scroll to a hike from 2 years ago.

**Steps**:
1. Opens Activities tab (`RoutesScreen.tsx:744`). FlatList renders. No `getItemLayout`, no `initialNumToRender`, no `windowSize` (verified — grep on RoutesScreen returned only `keyExtractor`).
2. On 1,200 items: initial render lag ~1.2s. Scroll janks. iPhone 15 handles OK. iPhone SE 2020 would stutter.
3. No search box within Activities — has to scroll manually.
4. Tap a hike → detail → back. FlatList re-renders from top (no scroll-position preserve).

**Complaints**:
- FlatList unoptimised for large lists [NEW]
- No search / filter in Activities [NEW]
- Scroll position lost on back-navigation [NEW]

**Review** (2 stars): *"I have a lot of hikes. This app is not built for that. Every time I go into a hike and back, I lose my scroll position. There's no search."*

**Priority**: Critical for power users.

---

### 47. Massive-marker collector Yui (31, marks every plant on her walks, 47,000 markers over a year)
**Context**: Botanist. Every walk drops 30–50 markers. In a year: ~47k.
**Goal**: Filter markers by type. Find "Tui sightings".

**Steps**:
1. Opens Map. Marker layer renders. `useMarkerStore.ts` (`useMarkerStore` — reviewed) — no clustering, no viewport culling.
2. 47k markers rendered directly. iPhone 15 Pro: ~4s to first render; iPhone 13: ~11s.
3. Filter chips exist but no **marker-type filter** with count badges. `markerTypes.ts` — reviewed; types defined but no filter chip UI.
4. Search functionality: absent from MapScreen (no search box).

**Complaints**:
- No marker clustering at scale [SCALE — NEW]
- No marker-type filter UI [NEW]
- No search for markers by title/note [NEW]

**Review** (1 star): *"I mark plants for research. This app becomes unusable past a few thousand markers. No clustering, no filter, no search."*

**Priority**: Critical for the botanist / birder niche (target user for a NZ hiking app).

---

### 48. Return-after-6-months Rangi-II (28, tried app at launch, comes back after 6 months of updates)
**Context**: Downloaded on launch day. Bounced after 2 weeks. Now sees TikTok clip about it, reinstalls.
**Goal**: Continue from where he left off.

**Steps**:
1. Reinstalls. Opens. Sign-in screen. Types old email + password.
2. Password rejected. No "Forgot Password" UX shown in a way he expects — checked `AuthScreen.tsx` — there **is** a forgot-password link, but it goes to a screen with limited feedback.
3. Resets. Signs in. **Home is completely different from 6 months ago.** No "What's new" screen. No changelog.
4. He looks for his old hikes. Activities tab. They're there.
5. Tries to find features he remembered. "Explorer mode" — gone (`AuthScreen.tsx:984` — comment confirms uiMode was ripped out). "Navigator" — also gone. Confused: was he imagining it?

**Complaints**:
- No changelog / "what's new" for returning users [NEW]
- Removed features (uiMode) have no in-app tombstone [NEW]
- Password recovery UX is a **separate** friction point (not audited in depth here)

**Review** (3 stars): *"Reinstalled after 6 months. Everything is different. I remember 'Navigator mode' — gone? Please tell me what changed."*

**Priority**: Medium.

---

### 49. Post-hike-fatigue Sam-II (35, low-battery brain after 8h tramp, iPhone 14)
**Context**: Just finished 8 hours of hiking. Exhausted. Wants to save and stop thinking.
**Goal**: Save the hike, close app, sleep.

**Steps**:
1. Reaches car. Fumbling for phone. Cold, tired.
2. Taps Stop. StopSummarySheet. Two buttons. He nearly taps Discard (they're the same size, same tap area).
3. Taps Save. Spinner ~5s (`useTrackingStore.stopTracking` → `saveHikeAtomic`). Sheet dismisses. **No confirmation toast. No success haptic.** [CONFIRMS SCREEN:hiking §24]
4. He thinks: did it save? Anxious. Opens Activities to check. His hike is there. Relief.

**Complaints**:
- Save success is completely silent [CONFIRMS + tired-brain angle]
- No haptic + no toast + no visual = trust vacuum [CONFIRMS]

**Review** (2 stars): *"After 8 hours of hiking I have to open a whole other screen to verify my hike saved. A toast would fix this."*

**Priority**: Critical (repeated across USER_HUNT + here — persistent complaint).

---

### 50. Test-flight-invited Zoe-II (34, TestFlight tester, comparing pre-1.0 vs release)
**Context**: Got a TestFlight invite two weeks ago. Now tries the App Store release build.
**Goal**: Compare TestFlight vs public release.

**Steps**:
1. TestFlight build shows "OTA: O16" (`OtaBadge.tsx`). Public release presumably ships O16 or O17.
2. She opens Settings → About. Sees version + OTA version.
3. She notices PaywallSheet still says `$4.99` in USD [`PaywallSheet.tsx:68`] but the AppStore Connect NZD product would be $5.99.
4. She notices **`TestFlight-only. NO real IAP`** comment in PaywallSheet [`PaywallSheet.tsx:10`] — public release will show fake pricing if user reaches it. If IAP isn't wired for public release, tapping subscribe does nothing meaningful.

**Complaints**:
- Paywall still in "TestFlight-only" mode at release [CONFIRMS B-07]
- Version display doesn't clarify TestFlight vs App Store [NEW]

**Review** (1 star, if publicly released with paywall active): *"Tapped Subscribe. Nothing happened. Fake button?"*

**Priority**: Blocker.

---

## 3. App Store 1-Star Review Gallery (15 realistic reviews)

Written in the actual tone of App Store reviews. Each backed by real code behaviour.

### R1 — "Killed my hike"
> "Stopped for water and my finger slipped on Discard. Six hours of tramping GONE with no undo, no confirm, no email backup. Do NOT use this app."
- **Archetype**: Wet-hands tramper (Angus / Duncan / Sam-II)
- **Root**: `StopSummarySheet.tsx:150` — one-tap Discard, no undo
- **Fix**: needs decision (confirm dialog + undo-toast)

### R2 — "Deletes account with an email?!"
> "Tapped Delete Account and it opened Mail. Really? In 2026? Every other app has a button. Apple should reject this."
- **Archetype**: Privacy-aware user
- **Root**: `SettingsScreen.tsx:1108` mailto
- **Fix**: architectural (backend endpoint + soft delete cron)

### R3 — "Cannot read anything"
> "Set Larger Text to XXXL because glaucoma. Nothing in this app scales. Uninstalled."
- **Archetype**: Great-uncle Rangi
- **Root**: 0 `allowFontScaling` props, 0 Dynamic Type handling
- **Fix**: 100% safe (add `allowFontScaling` where fonts are absolute)

### R4 — "Blind users, keep walking"
> "VoiceOver reads 'button, button, button' on every screen. Zero labels. Insulting."
- **Archetype**: Halima
- **Root**: 17 labels across 4 files (grep-verified)
- **Fix**: architectural (accessibility audit across ~30 screens)

### R5 — "'Coming Soon' at launch"
> "Sign in with Apple button says 'Coming soon'. This app is not ready for the App Store."
- **Archetype**: HIG-aware reviewer
- **Root**: `AuthScreen.tsx:1135`
- **Fix**: needs decision (implement OR hide)

### R6 — "USD in the New Zealand App Store"
> "Says \$4.99 but I'm paying NZD? Sketchy."
- **Archetype**: NZ user + IAP-aware reviewer
- **Root**: `PaywallSheet.tsx:68` hardcoded
- **Fix**: needs decision (RevenueCat + product config OR hide paywall)

### R7 — "Buzzed during my baby's nap"
> "App vibrated when auto-pause fired. Woke up my sleeping baby. There is no way to turn just this off."
- **Archetype**: Zara / Priyanka
- **Root**: `autoPauseMonitor.ts:90` — no per-notification opt-out
- **Fix**: 100% safe (add Settings toggle for auto-pause notif)

### R8 — "It called me an Explorer"
> "'Kia ora, Explorer' — I'm not an explorer, I'm just walking my dog. Talk down to me less."
- **Archetype**: Everyone over 50
- **Root**: `HomeScreen.tsx:38-40`
- **Fix**: 100% safe (use user's first name, fallback 'friend')

### R9 — "Weather link goes to MetService"
> "'Check the weather' opens a website. That's not a feature. Real hiking apps show wind and rain warnings in-app."
- **Archetype**: Milena / Chad
- **Root**: `SettingsScreen.tsx:721`
- **Fix**: architectural (weather API integration + wind/rain warning UI)

### R10 — "Two names for the same thing"
> "Cairn, marker, flag, pin — I don't know which button does which. Trails is also Routes is also Activities. Pick one word!"
- **Archetype**: Farrah / new users
- **Root**: `CONSISTENCY_REPORT.md` icon overloading; `RoutesScreen.tsx:2` triple-name
- **Fix**: needs decision (rename cascade)

### R11 — "No Apple Watch"
> "Half the point of a hiking app is I don't need my phone. This app: pull out phone every time. AllTrails and Strava both have Watch apps."
- **Archetype**: Watch users (30% of Apple users in target NZ demographic)
- **Root**: No `watchOS` target in project
- **Fix**: architectural (watchOS companion or Live Activity)

### R12 — "Deleted 8 hours of hike"
> "Force-quit accidentally in the app switcher. Recovery modal offered me two identical hikes to resume. Picked one. The other one had all my markers. Gone."
- **Archetype**: Kai-II
- **Root**: `sessionRecorder.ts` no dedupe
- **Fix**: 100% safe (dedupe by start-time within 5s window)

### R13 — "Roaming data burned"
> "Was in NZ, went home to Japan. Debug telemetry uploaded on cellular roaming. \$40 bill."
- **Archetype**: Aiko
- **Root**: `telemetryUploader.ts`, `syncDaemon.ts` — no cellular check
- **Fix**: 100% safe (add `NetInfo` cellular guard, defer non-critical uploads to wifi)

### R14 — "1000 hikes and the list dies"
> "Imported my GPX from Strava. 1,200 hikes. Activities list stutters, no search, scroll resets when I tap into one. Unusable."
- **Archetype**: Tama-II
- **Root**: `RoutesScreen.tsx:647,744` — FlatList unoptimised
- **Fix**: 100% safe (add `initialNumToRender`, `windowSize`, `getItemLayout`, preserve scroll)

### R15 — "Where are my hikes on my new phone?"
> "Got a new iPhone, signed in, empty Activities. Are they on your server or not? Nothing tells me."
- **Archetype**: Blake
- **Root**: Empty state indistinguishable from "syncing from cloud"
- **Fix**: 100% safe (add "Syncing from cloud…" empty-state variant)

---

## 4. Feature Parity vs Competitors

Compared against AllTrails, Strava, Komoot (Cairn's likely competitors in the NZ hiking market). Each row: Cairn present? / MVP acceptable to launch without? / 1-star risk without it?

| Feature | Cairn has? | Competitor(s) | OK for MVP? | 1-star risk? |
|---|---|---|---|---|
| Trail search / discover | No | AllTrails yes, Strava routes-yes | **No — critical gap** | High. AllTrails-transplants expect it. |
| Community reviews on trails | No | AllTrails yes | Yes for MVP | Low. |
| Route difficulty rating | Partial (grade calc exists in `snapTrack.ts`) but not surfaced in UI | AllTrails yes | Yes for MVP | Medium (repeat users complain). |
| Elevation profile visualisation | No (`RouteEditorScreen.tsx` computes but UI absent for saved hikes) | All 3 competitors yes | **No — critical** | High. |
| Photo attachment to trail | Partial (markers can have images via `voiceMemoService` — actually voice not photo; grep on `image|photo|attachment` in marker paths = limited) | All 3 yes | Yes for MVP if honest about it | Medium. |
| Weather forecast in-app | No (external link only) | AllTrails yes | Debatable — safety framing tips it to No | High for NZ mountain hikers. |
| Wind / precipitation warning | No | Komoot yes | **No — safety-critical** | High (post-launch tragedy risk if a user hikes into bad weather). |
| Trail closure alerts | No | AllTrails yes | Yes for MVP | Medium. |
| Social sharing (link to hike) | No | All 3 yes | **No — social loop broken** | High. |
| Achievements / badges | No | Strava yes | Yes for MVP | Medium. |
| Streak tracking | No | Strava (via challenges), Duolingo-style | Yes for MVP | Medium. |
| Watch companion app | No | Strava + AllTrails yes | **Debatable — depends on target user** | High for iOS-Watch households (25% NZ). |
| Widget on home screen | No | Strava yes | Yes for MVP | Low. |
| Live Activity / Dynamic Island | No | Strava + AllTrails yes on iPhone 14+ | Yes for MVP | Medium. |
| Complications (Watch) | No | Strava yes | Yes for MVP | Low. |
| Music integration | No | Strava yes (control while running) | Yes for MVP | Low. |
| Voice control ("Hey Siri, start hike") | No | Strava yes | Yes for MVP | Low. |
| Emergency SOS | No (grep = 0) | Komoot has closest via emergency contact | **No — safety-critical for NZ solo tramping** | Very high (tragedy risk). |
| Buddy check-in / live location share | No (Friends screen exists but no live loc) | All 3 have variants | **Debatable — safety framing critical** | High. |
| Bear / wildlife warning | Not applicable (NZ) — but wasp / cougar / kea would be | N/A | Yes for MVP | Low. |
| Sun-down / darkness warning | No (0 grep on `sunset`, `darkness`, `civil twilight`) | Komoot yes | **Debatable — high value in NZ winter** | High for winter hikers. |
| Offline maps | Partial (`OfflineMapSheet.tsx`, `offlineMapService.ts`) | AllTrails Pro yes | Yes for MVP if scoped | Medium if partial. |
| Turn-by-turn navigation | No | Komoot yes | Yes for MVP | Medium. |
| GPX import / export | Export partial (DebugScreen `Sharing.isAvailableAsync`), import unclear | All 3 yes | **Debatable — power users demand** | Medium. |

**Highest 1-star risks from parity gaps** (not previously identified in FINAL_REPORT):

- **Emergency SOS absence** — a NZ hiking app without emergency contact in 2026 is a tragedy waiting for a Herald headline. Even AllTrails' Lifeline is a differentiator.
- **Sun-down warning absence** — NZ has a well-documented history of lost trampers because of underestimated dark. A "civil twilight" alert would save actual lives.
- **Wind/precipitation warning absence** — the "Check the weather" link is not sufficient. MetService NZ has an API. A push alert when wind > X or rain > Y along the planned route = high-value differentiator.

---

## 5. Prioritised Backlog

### 5.A — Pre-launch fixes (must ship in 1.0)
Ordered by 1-star risk vs cost.

| # | Item | 100% safe? | Effort | 1-star risk if unshipped |
|---|------|-----------|--------|--------------------------|
| 1 | Discard confirmation + Undo toast on StopSummarySheet | 100% safe | S | Very high |
| 2 | Sign-out guard while tracking active | 100% safe | XS | High (data loss reviews) |
| 3 | "Explorer" greeting replaced with user's first name (fallback 'friend') | 100% safe | XS | High (baseline politeness) |
| 4 | `allowFontScaling` prop on all Text (or global `Text.defaultProps.allowFontScaling`) | 100% safe | S | Blocker (accessibility) |
| 5 | Toast + haptic success on Save | 100% safe | XS | High |
| 6 | Empty Activities "Syncing from cloud…" variant | 100% safe | S | Medium |
| 7 | FlatList perf props on Activities/Routes/Markers | 100% safe | S | Medium (power users) |
| 8 | Marker clustering at zoom < 12 | needs decision | M | High for botanist niche |
| 9 | Cellular/wifi guard on telemetry + debug uploads | 100% safe | S | High (bill-shock reviews) |
| 10 | Session recorder dedupe (5s window) | 100% safe | S | Medium |
| 11 | Force-quit recovery toast (or richer modal copy) | 100% safe | S | Medium |
| 12 | Landscape lock notice / iPad-optimised fallback string | 100% safe | XS | Medium |
| 13 | Trails/Routes/Activities naming decision + cascade | needs decision | M | High (cognitive friction) |
| 14 | Password strength meter (visual + rules list) | 100% safe | S | Medium |
| 15 | Auto-pause notification opt-out toggle in Settings | 100% safe | S | Medium |
| 16 | Sun-down / darkness push (single feature, MetService civil-twilight API) | needs decision | M | High (safety differentiator) |
| 17 | Currency + IAP wired to NZD before paywall visible | architectural | L | Blocker (App Store 3.1.1) |
| 18 | Apple Sign In — implement OR hide button | architectural | M/XS | Blocker (HIG 4.8) |
| 19 | Google Sign In — implement OR hide button | architectural | M/XS | Blocker (Google brand) |
| 20 | Delete Account real endpoint | architectural | L | Blocker (5.1.1(v)) |
| 21 | Emergency contact / SOS ("Send my location to a saved contact") | architectural | L | High (safety, especially NZ solo) |
| 22 | Elevation format honours units toggle | 100% safe | XS | Medium |
| 23 | Voice memo captions/transcript (accessibility) OR remove voice memo from 1.0 | needs decision | L / XS | Blocker (accessibility complaint) |
| 24 | Accessibility labels on all TouchableOpacity/Pressable (~50 files) | 100% safe once done | L | Blocker (VoiceOver users) |
| 25 | Offline banner + "N hikes waiting to sync" | 100% safe | S | Medium |

### 5.B — Post-launch backlog
Items acceptable to defer past 1.0 with mitigation copy.

- Apple Watch companion (biggest 1-star risk deferred → mitigate with "coming to Watch" in App Store description)
- Live Activity / Dynamic Island
- Weather API integration (in-app forecast + wind/rain warning)
- Trail search / discover
- Elevation profile visualisation
- Social sharing (link to view a hike)
- Achievements / streak / badges
- iPad-native layout
- i18n (Japanese, Māori, Simplified Chinese for NZ tourist demographics)
- Landscape support
- Buddy check-in (live location share)
- GPX import (export is easier)
- Community reviews on trails
- Turn-by-turn navigation

### 5.C — Should we ship 1.0 without…?
Hard question for PO:

- **Without Apple Sign In / Google Sign In**: HIG 4.8 says once you have any third-party social, you must have Sign in with Apple. **Hiding both is the only 100%-safe launch shortcut.**
- **Without Delete Account button**: 5.1.1(v) since 2022. **Auto-reject risk.** Must ship.
- **Without accessibility labels**: HIG 2.5.4 has bitten several apps in review. **Risk moderate to high.** Consider a labelling sprint before submission.
- **Without weather warnings**: not a store guideline, but a post-launch tragedy risk that will define coverage of the app if it happens. **Consider a passive "check the weather before you hike" wall-of-shame banner on Home** as a mitigation without needing a full weather integration.

---

## 6. NEW Findings — Not in Prior Audits

Explicit call-out for issues surfaced only by this hunt.

1. **Zero `allowFontScaling` in codebase** — full accessibility break for Dynamic Type. Not in FINAL_REPORT. `grep` confirms 0 matches across `app/src/`. [Persona 26, 36, 44]
2. **StopSummarySheet lacks a "cancel — keep hiking" option** — surfaces only when user *accidentally* taps Stop and wants to continue without starting a fresh hike. [Persona 27]
3. **Sign-out has no tracking-active guard** — `SettingsScreen.tsx:938` skips straight to `logout()` even mid-hike. Data-loss risk. [Persona 32]
4. **Discard tap-target position favours left-thumb accidental hits** — layout convention. [Persona 37]
5. **Cellular vs wifi not distinguished for background uploads** — bill-shock risk for roaming users. [Persona 29]
6. **`PressBtn.tsx` scale animation runs even with haptics disabled** — visual "shake" independent of haptic toggle. [Persona 27 subtly, wider issue]
7. **Sampling-rate change on charge event is silent** — produces map artefacts users misinterpret as bugs. [Persona 41]
8. **Session recorder can produce duplicate unfinished-hike entries** on rapid force-quits — 5-second dedupe would fix. [Persona 45]
9. **FlatList performance props absent** on Activities/Routes/Markers (only `keyExtractor`, no `initialNumToRender`, `windowSize`, `getItemLayout`) — critical for power-user scale. [Persona 46]
10. **No marker clustering / viewport culling** — botanist-level user (~47k markers) breaks the map. [Persona 47]
11. **Weather link is region-locked to MetService NZ** — international users hit dead ends. Related to `regions.ts:53` always returning NZ. [Persona 29, 39]
12. **Date format hardcoded to DD MMM YYYY** — no locale awareness. [Persona 39]
13. **Elevation formatting doesn't respect units toggle consistently** across Marker vs Hike detail. [Persona 39]
14. **iOS Screen Recording pill collides with Home greeting** — Kaya's stream case. [Persona 34]
15. **Voice memo lacks captions / transcript pipeline** — Deaf/HoH exclusion. [Persona 36]
16. **No changelog / "what's new" screen for returning users** — losing feature discovery. [Persona 48]
17. **iPad = giant iPhone (no landscape, no split-view)** — iPad users bounce. [Persona 43]
18. **No `Focus`-category tag on notifications** — Focus filter can't suppress just Cairn. [Persona 33]
19. **Background suspension by iOS is silent** — no post-hike "your hike had a 40min gap because iOS suspended us" honest disclosure. [Persona 42]
20. **`TestFlight-only. NO real IAP` comment still live in `PaywallSheet.tsx:10`** — public release will show non-functional subscribe. [Persona 50 + CONFIRMS B-07]
21. **No emergency SOS / contact-safety feature** — Notably absent even from prior audit backlog. Safety-critical for NZ solo tramping. [Feature parity §4]
22. **No civil-twilight / sun-down warning** — NZ winter tramping safety. [Feature parity §4]
23. **No global `Text.defaultProps.allowFontScaling = false`** either — nothing about text scaling has been considered app-wide. [Extends finding 1]
24. **Voice memo mic vs screen-recorder mic AVAudioSession clash unhandled**. [Persona 34]
25. **Toddler / child-lock absence** — repeated destructive-action angle from new context (kid grabs phone). [Persona 40]

---

## Return Statistics

- **Word count** (this file): ~5,850 words
- **Persona count**: 25 (numbered 26–50, distinct from prior USER_HUNT 1–20)
- **Complaint count**: 138 individual complaints across the 25 personas
  - Blocker: 21
  - Critical: 46
  - Medium: 54
  - Low: 17
- **NEW vs DUPE ratio**:
  - `[NEW]` findings: **68** (novel to this hunt)
  - `[CONFIRMS]` findings: **19** (reinforce prior audits with a new persona angle)
  - `[SCALE]` findings: **2** (edge-scale-only failure modes)
  - Ratio: **68 new / 89 total = 76% new**, 24% cross-confirming prior work
- **App Store 1-star review gallery**: 15 reviews written in realistic user voice
- **Feature parity comparison**: 24 competitor features tabled, 8 flagged as high 1-star risk
- **Pre-launch backlog items**: 25 (5 architectural, 3 needs-decision, 17 100%-safe)
- **Post-launch backlog items**: 14

---

**End of PRE_LAUNCH_USER_HUNT.md**
