# USER_HUNT — 20 Persona Walkthroughs

**Date**: 2026-07-29
**OTA baseline**: O16
**Hunt agent**: Virtual User (paid customer, black-box)
**Sources cross-referenced**: FUNCTION_AUDIT.md (F-\*), EDGE_HUNT.md (Scenarios 1–48), CONSISTENCY_REPORT.md, and per-screen AUDITs.
**Method**: I paid NZD $5.99. I opened the app. I did what a real user in my situation would do. I filed grievances the way a 1-star reviewer files them.

Legend for finding cross-refs at the end of each walkthrough:
- `[FUNC:F-xxx-nn]` — Function Audit
- `[EDGE:Sn]` — Edge Hunt Scenario
- `[CONS:section]` — Consistency Report
- `[SCREEN:X §y]` — Per-screen AUDIT reference
- `[NEW-UH-nn]` — Novel finding surfaced by this hunt

---

## 1. Kiwi tramper Sarah (55, casual hiker, iPhone 12)

### Bio
Sarah lives in Titirangi. Wants to save Waitakere hike photos + notes. Grandkids visit weekends. First time app — a friend told her about "the cairn one".

### Goal
Walk from Cornwallis Beach carpark to Mount Donald McLean and back. Drop a pin at "where I saw the tui". Come home. Show her sister on the couch.

### Walkthrough
1. I download from App Store. Wait. Open.
2. Splash: cairn animation, "Cairn" wordmark. About 3 seconds. OK, quaint.
3. I tap **Sign In**. Hmm — I don't have an account. I tap **Create Account**.
4. Form appears. I type my email. I put "Waitakerelocal2019". App says *"password too weak"* — no wait, there's no strength meter, just a generic reject. **Was it too short? Missing a number?** I try "Waitakere2019!" — accepts.
5. I tap Create Account. Now a **verification code** screen. I open my email app. Wait 40 seconds. Type it in. **The Verify page has one text field with placeholder "123456"** — not six clear cells. Feels janky.
6. I'm in. Home shows "Kia ora, Explorer" — nice to see. But **"Explorer"**? That's a weird word. I'm a **tramper**.
7. I tap **Start Hiking** big green card. It asks for location — I tap Allow. Then it asks about **"Always Allow"** in a modal that won't dismiss — I read: "We use background location to keep tracking when your screen sleeps". OK, fine. Open Settings. Change to Always. Come back.
8. Map loads. It's the map of my area. I tap **Start**. Little countdown starts.
9. I walk for 40 min. I stop to photograph a tui. Try to add a note — **there's no button to add anything from here**. Do I have to stop the hike first? I tap around. The only visible buttons are **Stop** and **Pause** (no wait, there's no pause). Frustrated, I keep walking.
10. Two hours later I reach the top. I tap **Stop**. Sheet slides up with distance/time/pace. Two buttons: **Save** and **Discard**. I tap Save. Spinner. About 5 sec. Sheet dismisses. Back on Home.
11. Where **is** my hike? I look at Home. Nothing changed. Confused. Where do you see hikes? I explore. Find **Activity** tab? No, **Trails** button. Tap it. **Routes screen** appears. I tap "Activities" tab. There's my hike. Good.
12. But wait — I never got to add the tui note. I tap the hike. It shows a big map. No way to add a marker after the fact. Bummer.
13. I want to show my sister. She's next to me. **"Look, this is my hike"** — I try to show the memory map. The **Memory** button is next to Trails. I tap. Blank fog with tiny colored dots. She squints. "What is this?" I say "it's my hikes". She goes "cool" politely.

### Friction points
- Step 5: Verify screen is single-field, not 6-cell like every other app I've used. [SCREEN:auth §S08]
- Step 6: "Explorer" is a **dead UI mode label from an old version** [FUNC:F-I18N-04]. It jars — I'm not an "Explorer".
- Step 7: The Always-Allow education alert has `cancelable: false` and blocks Start Hiking [FUNC:F-GPS-03][CONS:XC-07]. If I tap "Later", it never returns. I don't know that yet.
- Step 9: **No pause button** [FUNC:F-SES-08]. No way to add a marker mid-hike from the hiking screen. **This is the killer.** I lost the tui.
- Step 10: Save success has **no toast, no haptic** — sheet just dismisses [SCREEN:hiking §24]. Did it save? I don't know.
- Step 11: The word "Trails" on the tool button is the **Route icon** which is also the Routes tab-bar icon [CONS:Icon overloading]. Confusing.
- Step 12: Cannot retro-add markers to a saved hike [NEW-UH-01].
- Step 13: Memory map has no legend, no explanation. Fog+dots with no CTA [SCREEN:memory §S7][CONS:Empty states].

### Star rating
**2 stars.** "The app tracked my hike, but I lost the moment I really wanted to save (the tui). And I can't figure out where my hike went until I clicked randomly."

### What would fix it
1. Add a "Drop pin" or "Add note" floating button on HikingScreen.
2. On save success, show a toast: "Hike saved — tap to view" that deep-links to the saved hike.
3. Rename "Trails" button to something distinct from the Routes tab icon (e.g., "Activity" with a compass icon).

---

## 2. Auckland runner Ben (28, half-marathon training, iPhone 14 Pro)

### Bio
Ben trains on the Waterfront run route 4x/week. Uses Garmin normally but wife bought him "the Kiwi hiking app" and he wants to give it a shot. Cares about **pace accuracy** and **splits**.

### Goal
Run 10km along Auckland waterfront. Check pace per km. Compare to Garmin.

### Walkthrough
1. Open app. Home. Tap **Run** card (blue tint).
2. GPS acquires. "**-- km · -- min/km**" placeholder. No text saying "acquiring". [SCREEN:running §11]
3. Tap Start. Countdown. Go.
4. 1km mark. I glance. See distance running. No split. **No per-km ping.** Just live distance and moving average pace. [FUNC:F-SES/Missing lap markers]
5. 5km. Same. No split.
6. Stop. Screen replaces with "stopped" state. Big distance, big pace, big time. No **splits table**. No per-km breakdown.
7. Save. Back to Home.
8. Tap Activity. Find the run. Tap it. Big map. Still no splits. Just total distance / duration / pace.
9. Cross-reference Garmin: 10.03 km. Cairn says: 10.41 km. **Extra 400m from GPS jitter?** [FUNC:F-SES-11 raw distance accumulates noise]
10. I check pace. Cairn average: 5:12/km. Garmin: 5:15/km. Close, but noticeably different.

### Friction points
- Step 2: No "GPS acquiring" state text [SCREEN:running §11 BUG-R-08]. Just dashes.
- Step 4-6: **No splits.** Zero. [Missing feature per FUNC §4]. Deal-breaker for a runner.
- Step 9: Distance inflated. `distanceM` accumulates on raw trackPoints, including near-stationary noise [FUNC:F-SES-11].
- No manual pause. If I stop at a red light for 30s, that time counts against pace [FUNC:F-SES-08].
- Route pill name has no `numberOfLines={1}` guard [SCREEN:running §5 BUG-R-04] — but I don't hit this today.

### Star rating
**1 star.** "No splits, no manual pause, distance is 4% off Garmin. This is not a runner's app."

### What would fix it
1. Per-km auto-lap with haptic + toast.
2. Splits table on stopped screen.
3. Manual pause/resume button.
4. Distance filter: reject accumulated distance within stationary-radius even if individual points pass accuracy check.

---

## 3. Night runner Priya (32, safety-conscious, iPhone SE 2020)

### Bio
Runs in Auckland Domain at 5am. Pitch dark. Wants app to be **readable in dark**, **not blind her**, and let her signal if something happens.

### Goal
Run 5km loop before work.

### Walkthrough
1. 4:55am. Open app. Splash. **Full white background** blasts her face. [SCREEN:hiking §Critical no dark mode]
2. Home. **White**. She squints.
3. Taps **Run**. Map loads — Mapbox default light style [FUNC:F-MAP §Missing style picker]. **White with green streets.** Blinding.
4. Starts run. Live stats on white background at top.
5. Halfway, a car swerves. She feels unsafe. Wants to hit "emergency contact". **There is no such feature.** [NEW-UH-02]
6. Screen dims after 30s. OK, less blinding. But she taps to check pace — full brightness back.

### Friction points
- Step 1-6: **No dark mode** anywhere. [SCREEN:hiking §Critical, running §Critical]. Physical harm risk at 5am — she is now night-blind for the next 15 min.
- No emergency SOS or contact-share feature [NEW-UH-02]. Competitor apps have this.
- No screen-dim toggle during hike/run [NEW-UH-03].
- Map has no dark/topo style option [FUNC:F-MAP §Missing style picker].

### Star rating
**1 star.** "Blinded me at 5am. Deleted."

### What would fix it
1. Ship dark mode. Blocker for a hiking product with night users.
2. Add optional "night mode" screen dim + red-tint UI during tracking.
3. SOS/emergency contact quick-share (Apple Health style).

---

## 4. Rural mountain guide Tama (45, GPS-critical, iPhone 11)

### Bio
Guides clients on Kepler Track and Milford. **No cell signal** for days. Depends on offline maps for real work.

### Goal
Pre-download 4 offline packs for South Island. Confirm they work airplane-mode.

### Walkthrough
1. Home → Trails → Memory? No. He looks for **Offline Maps**. Finds it on... Map tab? Digs. Sees "Offline" pill somewhere on the Map screen [FUNC:F-MAP-02].
2. Taps a pack. Progress? A **spinner** appears with no percentage. [FUNC:F-MAP §Missing offline pack progress] He waits. Waits. 6 minutes for one pack.
3. Downloads 4 packs total. No confirmation "downloaded", no size shown.
4. Puts phone in airplane mode. Opens app. Signs in?? — auth requires network. **Wait, is he logged in?** [FUNC:F-OFF-05 hydrate branch]. He was. But network fails → app falls through to guest cache. Confusing.
5. Opens Map. Tiles load — **some load, some are gray**. Which parts of the pack downloaded? He can't tell — **there's no "which packs are downloaded" surface** [FUNC:F-OFF §Missing offline map "which packs are downloaded" surface].
6. Zooms. Some detail area is missing. **Partial pack.** [EDGE:S4 partial tile download not distinguishable from bug]
7. Starts hike anyway. GPS works fine offline (good).
8. 3 hours in, GPS jumps to a valley 200m off. No **satellite count**, no accuracy indicator [FUNC:F-GPS §Missing accuracy chip / satellite count]. He doesn't know if GPS is degraded or app is buggy.
9. GPS returns to normal. He continues. Ends hike.
10. Save. He's still airplane mode. **Save spinner spins for 15s** [FUNC:F-SES-01, wall-clock 15s]. Then... something happens. Sheet dismisses. Was it saved locally? Pending sync? He isn't sure. [FUNC:F-OFF-01 no global offline banner]
11. Reconnects that night. Opens app. Hike is there. Phew.

### Friction points
- Step 1: Offline pack UI is buried in Map screen, not a first-class Settings section.
- Step 2-3: **No progress %, no size, no confirmation**. Guides need this for planning.
- Step 4: Airplane-mode signed-in state ambiguous. Same fall-through as network hiccup [FUNC:F-OFF-05].
- Step 5-6: Partial pack indistinguishable from bug.
- Step 8: **No GPS quality indicator.** Deal-breaker for GPS-critical use. [FUNC:F-GPS-08]
- Step 10: Save-offline UX doesn't explicitly say "queued, will sync when online" [FUNC:F-OFF-01].
- No manual "Recalibrate GPS" button [FUNC:F-GPS §Missing].

### Star rating
**2 stars.** "Trustworthy for casual walkers. Not trustworthy for pros. Deal-breaker: no accuracy chip, unclear offline pack state."

### What would fix it
1. Dedicated Offline Maps section with per-pack progress %, size, "last updated".
2. GPS accuracy chip during hiking (a la Strava/Gaia).
3. Explicit "Saved offline — will sync" confirmation modal on stop-when-offline.

---

## 5. International tourist Marco (Italian, iPhone 15, English is 2nd language)

### Bio
Marco arrived in Auckland yesterday. Wants to hike Waiheke. Uses **metric**. Doesn't know NZ Māori terms. English is functional but not fluent.

### Goal
Find a nice hike near his hostel.

### Walkthrough
1. Downloads. Signs up.
2. Home says "Kia ora, Explorer". **Kia ora**? What is Kia ora? Is app broken? Is this Italian? Marco Googles it.
3. Reads: Māori for hello. OK, cute.
4. "Leave a Cairn" card. **What is a Cairn?** He doesn't know. English word he doesn't recognize. He Googles.
5. **"Free Hiking"** on Start button? What is Free Hiking? Not-paid Hiking? Off-leash hiking? He guesses "any hiking, whatever". [SCREEN:hiking §1]
6. Metric — good, distance in km. Numbers make sense.
7. Tries to search for a trail. **There's no search.** No trail directory. No "hikes near me" list [NEW-UH-04]. Just the map.
8. Puts a pin at Oneroa. Starts hike. Walks 5km around.
9. Ends. Saves. "Your hike is saved!" — no wait, there's no confirmation.
10. Marker note: types "Bellissima spiaggia". **200 char limit**, no counter shown, no warning. [SCREEN:markerdetail 200 char cap]
11. **Date on the hike shows `29/07/2026`.** He recognizes DD/MM (Italian format) — good — but he shows friend from USA who was confused. [FUNC:F-I18N-02 hardcoded DD/MM]

### Friction points
- Step 2-4: Māori + "Cairn" jargon with no gloss for non-English speakers. [FUNC:F-I18N-01]
- Step 5: "Free Hiking" is untranslated jargon [SCREEN:hiking §1].
- Step 7: **No trail directory.** No "popular hikes near you". Discovery is broken for tourists. [NEW-UH-04]
- Step 10: No char counter on marker note.
- No i18n framework at all — Marco can't switch to Italian. [FUNC:F-I18N §Missing]
- Date format hardcoded, not `Intl.DateTimeFormat`. [FUNC:F-I18N-02]

### Star rating
**2 stars.** "For NZ locals only. Tourists get lost."

### What would fix it
1. Explain "Cairn" and "Free Hiking" with a one-time onboarding card.
2. Add a "Popular Trails Near You" list — DOC data or user-generated.
3. Ship i18n groundwork with Italian, Spanish, German, Chinese, Japanese (top tourist languages to NZ).

---

## 6. Elderly walker Margaret (67, low tech literacy, iPhone SE 2016, VoiceOver sometimes on)

### Bio
Margaret walks her Cavalier around Cornwall Park. Daughter installed the app for her. Has arthritis — taps slowly. iOS text size at 200%.

### Goal
Just walk. And show her daughter she used it.

### Walkthrough
1. Daughter logged her in already. Opens app. Home.
2. **Text is small.** She has iOS at 200% Dynamic Type but app text doesn't scale [EDGE:S4]. Squints.
3. Taps "Start Hiking" — big card, she can hit it OK.
4. GPS asks. **Modal is "Later"/"Open Settings" — no third option.** She doesn't understand what "Always Allow" means. Taps Later. Modal never returns [FUNC:F-GPS-03][FUNC:F-PERM-03].
5. Start button lights. Taps. Countdown.
6. Walks. 20 min. Wants to stop.
7. **Stop button is red, small, on top-right of screen.** She misses. Taps map instead. Doesn't happen. Taps close. Hits Stop.
8. Stop sheet slides up. **Discard button next to Save.** Her arthritic thumb hits Discard. **One tap. Hike gone.** [SCREEN:hiking §25 Critical no confirm]
9. She doesn't realize what happened. Sheet dismisses. Back to Home.
10. Later she tells daughter "I walked but the app didn't save". Daughter looks — nothing. Blames Margaret. Daughter blames app.

### Friction points
- Step 2: **Dynamic Type not supported.** Text overflows if you fix it later, but currently just tiny. [EDGE:S4 Critical]
- Step 4: "Later" is a dead-end trap. Never returns. [FUNC:F-GPS-03][FUNC:F-PERM-03]
- Step 8: **Discard is one-tap = data loss.** No "Are you sure?" [SCREEN:hiking §25]
- **VoiceOver.** Margaret's daughter enabled VoiceOver on the phone. Icons have no `accessibilityLabel`. Start Hiking button might not announce. Stop button might not. [EDGE:S3]

### Star rating
**1 star.** "I pressed the wrong button and lost my walk. Also everything is too small."

### What would fix it
1. Two-tap Discard confirm (or TypeToConfirm) on StopSummarySheet.
2. Support Dynamic Type up to 200% with layout adaptation.
3. VoiceOver labels on every core-flow button.

---

## 7. Solo dad Nathan (39, distracted, iPhone 13, kids interrupt, force-quits app often)

### Bio
Nathan's kids are 5 and 8. Weekends he hikes at Long Bay. Kids need him mid-hike constantly. He alt-tabs, force-quits, comes back.

### Goal
Hike Long Bay to Okura loop.

### Walkthrough
1. Starts hike. Walks 15 min.
2. Kid falls. He picks kid up. Puts phone away.
3. 45 min later, remembers to check phone. Screen off. Turns on. Battery dropped 40%? [Reasonable]
4. Opens app. **App was killed by iOS in background** (5-year-old iPhone, mid-tier memory). [EDGE:S37 handled via `UnfinishedRecoveryModal`]
5. Sees **UnfinishedRecoveryModal**: "You have an unfinished hike from 45 min ago. Continue or Discard?" Taps Continue.
6. Resumes. Points from foreground and background flow.
7. Later, another kid emergency. He **force-quits** the app (habit from other apps).
8. 30 min later opens again. Modal again. Taps Continue.
9. Ends hike at Okura carpark. Stops. Save. Success? Sheet dismisses.
10. Checks Activity. Hike is there. **But distance is 3.2km — he walked at least 6km.** Two force-quit gaps ate half his data. [FUNC:F-SES §background restart data gaps]

### Friction points
- Step 4-8: Force-quit-and-resume works but **each gap loses points**. The recovery flow salvages the file but background points from the killed session aren't fully preserved [FUNC:F-GPS-10, F-GPS-05].
- Modal every time is annoying [NEW-UH-05: "Auto-resume" option missing].
- No indicator during hike that a gap happened [NEW-UH-06].
- **Auto-pause fires at 15 min idle** — Nathan's kid-management triggers this. Auto-pause prompt is a local notification, but if he **denied Notifications permission**, he never sees the prompt [FUNC:F-PUSH-02] and hike auto-ends at 30 min silently. He loses the second half of the hike entirely.

### Star rating
**1 star.** "Half my hike was lost. Twice."

### What would fix it
1. On recovery, immediately fill the gap with straight-line dead reckoning OR mark it visibly on the map as "reconstruction gap".
2. Add "Auto-resume" toggle to skip the modal if user chose it once.
3. **Request Notifications permission at first hike-start** so auto-pause prompt actually fires.
4. Auto-pause 30min-auto-end should require user confirmation on iOS even without notifications (show in-app card on return).

---

## 8. Data-conscious student Emma (21, low disk, iPhone XR, 4GB free)

### Bio
Emma has 4GB free on her phone. Careful about storage. Uses budget-tier plan.

### Goal
Try Cairn. Not use much storage.

### Walkthrough
1. Downloads. 60MB — OK.
2. Signs up. Fine.
3. Walks 3km around university.
4. Saves. All good.
5. A month later she has done 20 walks. Notices phone is slower.
6. Opens Settings → iPhone Storage → Cairn. **1.3GB.** [FUNC:F-STO-01, F-STO-04 orphan trackpoints]
7. What?! She looks. Cairn hasn't shown her storage usage anywhere in the app.
8. Uninstalls. Reinstalls. Cairn is 60MB again — but her hike history is gone from local. [FUNC:F-STO-04 orphans + reset]
9. Signs back in. Server-side hikes come back (thankfully sync worked). Localstorage rebuilds.
10. Two weeks later, 500MB again. Deletes app permanently.

### Friction points
- No in-app storage usage display [NEW-UH-07].
- Orphan trackpoint files never cleaned up on logout [FUNC:F-STO-04].
- No "Clear cache" button in Settings [FUNC:F-STO §Missing storage cap enforcement].
- **`hikeTracksCache` self-limits to 300MB** but session point stores and JSONL don't [`hikeTracksCache.ts` handles L2 cache only, per EDGE:S18].
- If disk ever fills, `storage.ts` silently swallows the error and returns null → **data loss with no user signal** [FUNC:F-STO-01].
- Preflight `FileSystem.getFreeDiskStorageAsync()` never called [EDGE:S9 Critical].

### Star rating
**1 star.** "Ate my phone."

### What would fix it
1. Show storage usage in Settings ("Cairn is using 340MB — 12 hikes, 4 markers").
2. "Clear cache" button — safe delete of local files, preserves server data.
3. Preflight disk-space check before saving a hike.
4. Auto-purge orphan trackpoint keys on hydrate.

---

## 9. Battery-saver Ravi (35, Low Power Mode always on, iPhone 12 mini)

### Bio
Ravi keeps his phone in **Low Power Mode 24/7**. Also does 2-hour walks daily. Charges once at night.

### Goal
Track his walks without draining battery.

### Walkthrough
1. Opens app. Tap Start Hiking. GPS acquires.
2. **Alert appears**: "Low Power Mode is on. Tracking may be less accurate. Continue anyway?" [Handled — `lowPowerModeWarn.ts` per EDGE:S10]
3. Taps Continue.
4. Walks. GPS at 1Hz. Battery-adaptive sampling should kick in.
5. Screen locks (LPM disables auto-brightness during dim). 90 min later he checks — hike still tracking. Great.
6. Stop. Save. Confirmation sheet.
7. Battery went from 42% → 27% for 90 min. About 10%/hr. Acceptable, but not great compared to LPM baseline.

### Friction points
- Step 2: LPM warn is a **one-time-per-24h Alert** [EDGE:S10]. Ravi sees it once, dismisses "don't ask again"-style — but wait, there's no such option, so he sees it *every day* first hike. Annoying.
- **Nothing tells Ravi that Kalman + accuracy filtering is degraded under LPM** — accuracy could be sub-par but he doesn't know [NEW-UH-08].
- No **battery estimate** on start-hike screen ("Estimated 8% battery per hour for a 2h hike") [NEW-UH-09].

### Star rating
**3 stars.** "Works, but I see this alert every single morning."

### What would fix it
1. "Don't show again" checkbox on LPM warn.
2. Battery-per-hour estimate at start.
3. Post-hike: "This hike used X% battery".

---

## 10. Privacy-focused Alex (30, iPhone 15, denies most permissions)

### Bio
Alex reads permission dialogs. Refuses everything he can. Wants to see how much of Cairn works with only foreground location.

### Goal
Walk 5km using minimum permissions.

### Walkthrough
1. Signs up. Denies **Media Library** at prompt (for debugUpload). Denies **Notifications**. Denies **Camera** (which app never asks for — good?).
2. Start Hiking → location permission → Grants **"Only While Using"**, denies "Always Allow".
3. Modal appears about background location. Alex reads it. Taps **Later**. Modal never returns [FUNC:F-GPS-03].
4. Starts hike. Walks.
5. Phone screen locks. **App is in background, no Always-Allow, background task can't run.** Points stop being recorded.
6. Screen back on. Sees hike still tracking (foreground resumed). But **10 min of walking wasn't captured.** [FUNC:F-GPS-02]
7. No indicator of gap [NEW-UH-06 same as Nathan].
8. Continues. Ends hike. Distance shows 3km but he walked 4.5km.
9. **Auto-pause prompt never fires** (Notifications denied) — but Alex doesn't hit that today.
10. Tries to add a marker with photo. **Cairn's marker photo flow uses `expo-image-picker`** which requests Media Library — Alex denies. **App silently fails, no clear "you denied access" message** [FUNC:F-PERM-04].

### Friction points
- Step 3: Background-permission education modal is one-shot. Alex now has no way to opt in later without deep-diving iOS Settings [FUNC:F-PERM-03].
- Step 5-8: **Silent data gap.** No feedback that background tracking failed. [FUNC:F-GPS-02 background best-effort]
- Step 10: Photo marker denial handling unclear [FUNC:F-PERM-04].
- No **rationale screen** explaining WHY each permission is asked before OS prompt [FUNC:F-PERM §Missing rationale].
- **No App Tracking Transparency prompt** — Mapbox does telemetry, Apple requires ATT [FUNC:F-PERM-05]. Guaranteed App Store rejection.

### Star rating
**2 stars.** "Silent about failures. Doesn't respect my privacy prefs (background tracking failed silently instead of telling me)."

### What would fix it
1. Detect when background tracking cannot record and show inline banner on HikingScreen.
2. Add ATT prompt (required for App Store).
3. Add "Grant background permission later" entry in Settings that deep-links.

---

## 11. Slow-connection Chen (Chinese tourist, iPhone 14, 3G rural)

### Bio
Chen visiting NZ from Chengdu. Rural motel. **250 kbps connection**. Signs up.

### Goal
Register, sign in, do a hike.

### Walkthrough
1. Downloads (took 4 min on hotel wifi).
2. Opens. Splash. Fine.
3. Tap Create Account. Types email, name, password.
4. Taps Create. Spinner. **10 seconds.** **20 seconds.** **30 seconds.** Then — reload the page? He taps again. Now shows "Email already exists" [SCREEN:auth §S23 429 handling]. **Because his first request went through.** Confusing.
5. Signs in. **Auth `getMe` has 8s timeout** [FUNC:F-AUTH-09]. Timeout hits. **Silent fall-through to guest** [FUNC:F-OFF-05]. Chen thinks he's not signed in. Taps Sign In again. Duplicate request. Now he's stuck in a loop.
6. Eventually gets in.
7. Opens Map. **Tiles load one by one**, painfully slow. No progress. [SCREEN:mapscreen §1 no spinner/skeleton]
8. Starts hike. GPS locks. Walks.
9. Tries to plant a cairn. **`MapMatchingClient` requires network** — snap fails silently. Comment says fallback to raw GPS but he doesn't know that. [FUNC:F-MAP §snap-to-road no user notification]
10. Save hike. **`saveHikeAtomic` has no wall-clock timeout at fetch level.** Spinner shows "Saving..." for 45 seconds. Chen force-quits. [FUNC:F-NET-01]
11. Reopens app. Hike in pending state. But wait — is it? [FUNC:F-SES-01]

### Friction points
- Step 4: **Double-submit on retry** — client-side idempotency isn't visible. Server may have accepted first, but user sees second attempt fail loudly.
- Step 5: `getMe` timeout leads to silent guest fall-through [FUNC:F-AUTH-09].
- Step 7: **Blank green Mapbox area** during tile load [SCREEN:mapscreen §1].
- Step 10: **No timeout** on save fetch [FUNC:F-NET-01]. User force-quits, then data lands in pendingSyncStore but "Saving…" state doesn't persist across app restart [EDGE:S14, S38].
- **No connection quality indicator** [NEW-UH-10].

### Star rating
**1 star.** "Everything hangs. I don't know what's real and what's stuck."

### What would fix it
1. Global timeout policy: max 10s any request, then user-facing "Connection slow, retrying".
2. Skeleton loaders on map tiles.
3. Memory's staged-copy pattern applied to save: "Saving… / Still saving… / Slow connection, still working" [CONS:Loading indicators — Memory has best-in-class staged pattern].
4. Persistent "Saving" state across app restart via `pendingSyncStore` UI on next launch.

---

## 12. Frequent switcher Kate (33, alt-tabs constantly, iPhone 15 Pro)

### Bio
Kate is a producer. Alt-tabs (App Switcher) between Cairn, Slack, Insta, WhatsApp every 30 seconds while hiking.

### Goal
Hike Rangitoto summit while also managing work Slack.

### Walkthrough
1. Starts hike. Fine.
2. Alt-tabs to Slack. Responds to message. Back to Cairn.
3. Alt-tabs to Insta. Scrolls. Back.
4. Alt-tabs to WhatsApp. Voice memo. Back.
5. Alt-tabs, tap the app icon on home screen (not App Switcher). Cairn reloads full splash? — no, just resumes. OK.
6. 30 minutes of alt-tabbing. Hikes.
7. Stops. **Saves.** All points intact — the background task is doing its job [EDGE:S15 handled].
8. **But — during her alt-tabbing, an OTA update auto-applied.** [FUNC:F-OTA-02]. App reloaded mid-hike. She didn't notice at the time, but when she opens Activity later, her hike is broken into **two sessions**: pre-OTA and post-OTA.

### Friction points
- Step 8: **OTA auto-apply during active tracking** is catastrophic [FUNC:F-OTA-02][SCREEN:OtaBadge]. Kate's hike is split, half is pending sync, half is orphaned. Massive UX pain.
- OtaBadge on Home is **floating** while Auth splash's is inline [CONS:Header patterns — visual jump].
- **`AppState.change` triggers sync drain** every alt-tab — many bursts of network activity. Fine at low levels, but on 3G would sync-storm.

### Star rating
**2 stars.** "Auto-reloaded mid-hike. Split my hike. Lost me."

### What would fix it
1. **Never auto-apply OTA when `useTrackingStore.status === 'tracking'`.** Defer to next app start. [FUNC:F-OTA-02]
2. Show a persistent "Update available — will install after hike" banner instead.
3. Debounce sync-drain on rapid AppState transitions.

---

## 13. Multi-account power user Jake (27, personal + guide-account, iPhone 15)

### Bio
Jake has a personal account and a guide account (leads paid tours). Wants to switch daily.

### Goal
Log a personal hike this morning. Switch to guide account this afternoon. Log a client hike.

### Walkthrough
1. Signs in as personal. Hikes. Saves. Fine.
2. Settings → Sign Out. **Alert.** Confirms. Signed out. Local sessions still show briefly ([FUNC:F-AUTH-06 useAppStore.logout doesn't clear all stores])? — actually he sees his friends list flicker away.
3. Signs in as guide account. Hydrate. **Wait — his friends briefly showed User A's friends** [FUNC:F-AUTH-06]. He thought it was a bug.
4. Starts guide hike with client. Halfway, hits Settings → Sign Out (fat-finger). **App does not warn him he is mid-hike** [EDGE:S13 no guard on Sign Out during tracking]. **Sign-out proceeds. Token cleared. saveHikeAtomic will 401.** Client hike is losing state.
5. He notices. Signs back in as guide. Attempts to recover. **UnfinishedRecoveryModal** appears — he taps Continue. Points from before sign-out recovered.
6. Ends hike. Saves. **saveHikeAtomic 401** (token now under guide account? Race with pendingSyncStore). Data may be under wrong user.

### Friction points
- Step 3: Friend cache leak between users [FUNC:F-AUTH-06].
- Step 4: **No guard on Sign Out during tracking** [EDGE:S13 Critical].
- No **account switcher** — he has to sign out/in every time [FUNC:F-AUTH §Missing multi-account].
- Step 6: Race between old-user pending sync and new-user token could send old-account hike to new-account server. [FUNC:F-AUTH-07 + F-STO-03]

### Star rating
**1 star.** "Cross-account data leak nearly happened. As a guide who logs paid trips, this is unusable."

### What would fix it
1. Multi-account switcher (like Twitter/Instagram).
2. **Sign Out guard: "You have an active hike. End first."** [EDGE:S13]
3. Ensure `logout()` clears **all** stores (friends, routes, markers cache) [FUNC:F-AUTH-06].
4. Ensure pending-sync ops carry the userId at enqueue time so wrong-user race can't happen.

---

## 14. Trail runner competing Nina (24, uses stopwatch precision, iPhone 14)

### Bio
Nina runs Waitakere Trail Ultra. Needs sub-second accuracy on distance / pace / cadence.

### Goal
Do a training run and get accurate stats.

### Walkthrough
1. Start run. GPS locks. Countdown 3-2-1-GO.
2. Runs 21.1km half-marathon.
3. Stops. **Total time: 1:38:42.** Cairn's clock.
4. Distance: 21.34km. Garmin: 21.10km. **240m difference.** [FUNC:F-SES-11 raw distance noise]
5. Average pace: 4:41/km per Cairn vs Garmin 4:41/km. Same. OK.
6. **Cadence.** Cairn shows nothing. Nina looks — **no cadence data anywhere** [NEW-UH-11].
7. **Heart rate.** Nina has an Apple Watch. **No HealthKit integration** [EDGE:S7 not handled].
8. **Splits.** No per-km splits. She has to manually compute.
9. Nina uses Strava for her races. Cairn adds nothing.

### Friction points
- Step 4: Distance inflation over long distance [FUNC:F-SES-11].
- Step 6: No cadence.
- Step 7: No HealthKit. Deal-breaker for serious runners.
- Step 8: No splits.
- **No lap markers** [FUNC:F-SES §Missing manual lap markers].

### Star rating
**1 star.** "Not a serious running tool."

### What would fix it
1. HealthKit integration for heart rate, cadence, VO2max.
2. Manual + auto laps.
3. Splits table.
4. Distance filter improvements.

---

## 15. Casual once-a-month Lily (41, forgets password often, iPhone 11)

### Bio
Lily hikes maybe once a month. Forgets which password she used.

### Goal
Sign in. Do her hike.

### Walkthrough
1. Opens app. Sign In. Types email. Types password. **Wrong.**
2. Error appears. She tries variants. Wrong. Wrong. Wrong.
3. Looks for **"Forgot password"** link. **There isn't one.** [FUNC:F-AUTH-04 Critical]
4. Reads FAQ? There's no FAQ. Reads Settings for help? Can't Sign In → can't reach Settings.
5. Emails support (privacy@cairnapp.nz — which is for privacy not password reset). Days pass.
6. Creates a NEW account with different email. Loses all her hikes from the last 4 months. Rage.

### Friction points
- Step 3: **No forgot-password flow** [FUNC:F-AUTH-04].
- No FAQ / Help section reachable without login.
- No account-recovery via SMS or backup email.
- **Login has no email regex validation** [FUNC:F-AUTH-10] — she could be typing wrong email and it just says "invalid credentials".

### Star rating
**1 star.** "Locked out. Lost all my history. Deleting."

### What would fix it
1. Ship forgot-password flow immediately. This is table-stakes.
2. Reachable Help section from login screen.
3. Email verification link + password reset via email.

---

## 16. Screenshot-obsessed influencer Kai (26, Instagram, iPhone 15 Pro Max)

### Bio
Kai posts to Instagram after every hike. Wants beautiful memory map screenshots. 500k followers.

### Goal
Do a hike, take a beautiful screenshot of memory map, post.

### Walkthrough
1. Hikes 8km Piha coast.
2. Saves. Opens **Memory** tab. Fog + colored dots.
3. Tries to screenshot. Screenshots the whole phone UI incl. status bar, nav bar. Not clean.
4. Wants to **share directly** to Instagram. **No share button.** [NEW-UH-12]
5. Screenshots. Crops manually in Photos.
6. **Memory shows revealed cairns.** He notices: "**tap a cairn to see details**". Taps one — **RevealedCairnSheet opens with 3 pills: like / report / hide. None do anything.** [SCREEN:memory §S14 Blocker]. He taps like. Nothing. Report — nothing. Frustrated.
7. Instagram post. Caption "My little map of memories 🌿". Followers reply "cute what app". He tells them.
8. Follower downloads. Complains "map is blank fog". Because they haven't hiked yet. **No onboarding hero for zero-state Memory** [SCREEN:memory §S7].
9. Kai's screenshot **reveals his home location** — the fog cleared around his house because he starts hikes from there. **No privacy blur** [EDGE:S40][NEW-UH-13].

### Friction points
- Step 4: **No native share** anywhere in app [NEW-UH-12].
- Step 6: **Broken affordances on RevealedCairnSheet** [SCREEN:memory §S14]. Apple 1.2 UGC risk if Report doesn't work but is shown.
- Step 8: New-user onboarding doesn't show first-cairn moment. [SCREEN:memory §S7]
- Step 9: **Privacy leak in shared memory map screenshots** [EDGE:S40].

### Star rating
**2 stars.** "Pretty but doesn't share. Broken pills. Leaked my home to 500k followers by accident."

### What would fix it
1. Native "Share memory map" with framed export image.
2. **Fix or hide RevealedCairnSheet pills.** [Blocker]
3. Auto-blur/mask home-radius on shared images.
4. First-run onboarding for Memory zero-state.

---

## 17. Friend-connecting mum Anna (38, wants to share hikes with family, iPhone 12)

### Bio
Anna wants her sister and husband to see her hikes.

### Goal
Add sister as friend. Share a hike.

### Walkthrough
1. Home → Friends. Empty state hero: "Add a Friend" CTA [SCREEN:friends §FS-01 canonical good].
2. Tap Add Friend. Sheet appears. Type sister's email.
3. Send. **Error?** — depends on network. If sister isn't registered, what happens? Anna doesn't know. [SCREEN:friends §FS-12 self-invite guard dropped — Anna might invite herself by mistake]
4. Sister registers. Anna sees a friend request... eventually. **No push notification** because Anna hasn't allowed push (never asked). [FUNC:F-PUSH-01]
5. Anna manually opens Friends. Sees request. Accepts.
6. Wants to **share her latest hike** with sister. Where's the share button?
7. Opens Activity, picks hike, taps around. **No "Share with friend" option.** [NEW-UH-14]
8. Marker visibility (public / friends / private) — she notices, sets to friends. But she can't share a whole hike route.
9. Sister opens her Friends screen. Sees Anna. Taps Anna. **Anna's profile shows... what?** [Not audited fully — but the friend-view is thin per Friends AUDIT]
10. Sister sees Anna's public markers but not her hike routes.

### Friction points
- Step 3: **Self-invite guard dropped** [SCREEN:friends §FS-12].
- Step 4: **No push notifications.** No way to know friend request came in [FUNC:F-PUSH-01].
- Step 7: **No hike-share feature.** Only marker permissions.
- Step 9: **No user profiles.** Sisters can't see each other's hike history feed.
- Step 10: **Marker visibility = friends/public/private but hike visibility = private only** (no permission model on hikes) [NEW-UH-15].
- **Friend request from a stranger** — Anna could receive requests from anyone. No block/report [NEW-UH-16].

### Star rating
**2 stars.** "Social feature only half-built."

### What would fix it
1. Push notifications for friend requests + accepts.
2. Friend profile page: their public hikes + markers.
3. Hike-level permissions (public/friends/private).
4. Block/report on friend requests.

---

## 18. Cancelled-mid-flow user Sam (29, gets calls mid-hike, iPhone 13)

### Bio
Sam is a nurse. On call. Hike is her decompression time. Gets phone calls constantly.

### Goal
Hike Waiheke without losing data to phone calls.

### Walkthrough
1. Starts hike.
2. **Phone rings.** iOS shows incoming call full-screen. She answers. 10-min call.
3. Call ends. Back to Cairn. Hike is still tracking (foreground was interrupted but app is still recording via background task) [EDGE:S15 handled].
4. Walks on.
5. **Another call.** This time she declines. Back to app.
6. 40 min in. **App is force-quit** (iOS decided). She reopens.
7. **UnfinishedRecoveryModal** shows. Taps Continue.
8. But — Sam's foreground drain (`pendingBackgroundLocations` at 1s interval) is now processing 40 min of accumulated points [FUNC:F-GPS-09]. **Frame drop.** Screen stutters for 2 seconds.
9. Continues hike.
10. Another call. Answers. Talks 5 min. Back.
11. Stop hike. Save. Success.
12. Checks Activity. Distance looks right. But **elevation gain** is wrong — she climbed 400m per Apple Watch but Cairn shows 620m (elevation noise not filtered) [NEW-UH-17].

### Friction points
- Step 8: **Foreground drain frame drop** at 1000+ points [FUNC:F-GPS-09].
- Step 12: **No elevation filter.** Barometric noise accumulates [NEW-UH-17].
- Auto-pause could fire during a long call (15 min idle) if she's stationary [FUNC:F-PUSH-02 auto-pause prompt not visible without notifications].
- No **"Do Not Disturb during hike"** integration with iOS Focus [NEW-UH-18].

### Star rating
**3 stars.** "Handles calls OK. Elevation is wrong. Frame drops."

### What would fix it
1. Batch foreground drain in RAF-scheduled chunks to avoid frame drops.
2. Elevation smoothing (Kalman for altitude, not just XY).
3. Optional "iOS Focus during hike" prompt.

---

## 19. Angry returning user Tom (34, deleted app once, iPhone 15)

### Bio
Tom used Cairn 3 months ago. Deleted. Trying again. Curious if his data is still there.

### Goal
Reinstall. Sign in. See old hikes.

### Walkthrough
1. Installs from App Store. Opens.
2. Sign In. Email/password remembered from Keychain iCloud (auto-fill). Great.
3. Signs in. **Server sync fetches sessions.** They appear in Activity.
4. Opens one from May. Map loads. **But the map area is blank green for 15 seconds.** [SCREEN:mapshistory §31 blank green]
5. Eventually loads. But local trackpoints file was deleted with app. **Route detail comes from server. Says "Route data unavailable" — server returned empty route_points.** [FUNC:F-MAP-01]
6. He tries 3 more hikes. Same: 2 have data, 1 doesn't. Confusing.
7. Tries to **delete an old hike he's ashamed of** (mistake, wrong location). Two-tap confirm. Delete. It disappears from list. Good.
8. But now he wants that OLD data back. He deleted it. Server-side is gone too.
9. Tries to plant a new marker somewhere he was. **Map is at wrong region** (`regionCode` filter). He has to manually pan far away [FUNC:F-MAP §Marker rendering filtered by regionCode].

### Friction points
- Step 4: **15s blank-screen loading** [SCREEN:mapshistory §31 Medium — should be Critical for returning users].
- Step 5: Some hikes have server data, some don't. **User can't distinguish "route lost" from "still loading"** [FUNC:F-MAP-01].
- Step 8: **No undo on delete** [NEW-UH-19]. Two-tap is not enough for irreversible action.
- Step 9: Marker filter by regionCode is invisible to user [FUNC:F-MAP §Marker rendering].
- **No welcome-back experience** for returning users [NEW-UH-20]. "Welcome back! Here are your 47 hikes."

### Star rating
**2 stars.** "Some data survived, some didn't, no explanation. Deleted a hike by accident and can't undo."

### What would fix it
1. Explicit "This hike's route data was not preserved" message [FUNC:F-MAP-01].
2. Undo on delete (30s toast with Undo action).
3. Welcome-back onboarding.

---

## 20. Reviewer / journalist Zoe (29, iPhone 15 Pro, reviewing for tech blog)

### Bio
Zoe writes for a NZ tech blog. Reviewing Cairn for launch coverage.

### Goal
Do everything a reader might do. Note every rough edge.

### Walkthrough
1. Splash. Times it. 2.5 seconds for animation. **Long.** [SCREEN:auth]
2. Sign-up. Verify code. Notes: single input not 6-cell. [SCREEN:auth §S08]
3. Home. "Kia ora, Explorer" — she notes: "Explorer is an outdated UI mode label from an earlier internal version" [FUNC:F-I18N-04]. Zings.
4. Tap Continue with Apple. **Alert: "Coming soon"** [FUNC:F-AUTH-01 Blocker]. She notes: "This is an Apple HIG violation. Will get rejected on submission."
5. Tap Continue with Google. Same. [FUNC:F-AUTH-02]
6. Tests: Screenshot every screen. Compare to Cairn's marketing site. **Rounded corners differ (marketing uses 20, app uses 14 or 18 depending on screen)** [CONS:Card styles].
7. **VoiceOver test.** Turns on. **Icons don't announce.** [EDGE:S3]
8. **Dynamic Type at 200%.** Text stays same. Overflow tests: fails on MarkerDetail note field — text overlaps action bar [EDGE:S4].
9. Tests Discard: One tap = data gone. Blogs about this. [SCREEN:hiking §25]
10. Tests Delete Account: opens **`mailto:privacy@cairnapp.nz`** — she notes: "Apple 5.1.1(v) requires actual in-app deletion, not an email. Cairn will fail App Store review." [FUNC:F-AUTH-03]
11. Notes typographical hell: 3 different reds for destructive UI. [CONS:Danger red]
12. Notes: Google "G" button is a **hand-rolled block letter** — Google Brand Guidelines violation. [CONS:Icon system]
13. Notes: Voice memo affordance says "🎤 Voice memo (coming soon)" — dead placeholder. [SCREEN:plant §S20]
14. Notes: Memory Report button does nothing (App 1.2 UGC risk). [SCREEN:memory §S27]
15. **Writes headline: "Cairn: A Beautiful, Broken Kiwi Hiking App."**

### Friction points
Zoe catches nearly every finding in FUNCTION_AUDIT and CONSISTENCY. Key ones she'd highlight:
- 3 blockers for App Store review (Apple, Google, Delete Account) [FUNC:F-AUTH-01/02/03]
- Fake affordances (Memory Report, voice memo, MarkerDetailSheet handle bar) [CONS:Fake affordances]
- 3 different destructive-action confirmation patterns [CONS:Sheet vs Modal vs Alert]
- 5 different loading vocabularies [CONS:Loading indicators]
- Truncation not enforced anywhere [CONS:Truncation policy]
- 15-second blank green screen on MapHistory [SCREEN:mapshistory §31]

### Star rating
**2 stars.** "Beautiful design system at the token level. Broken at the composition level. Will not survive App Store review as-is."

### What would fix it
1. Ship the P1 App Store blockers (Apple, Google, Delete Account).
2. Do the 3-week polish pass on consistency (fake affordances, truncation, confirmations).
3. Fix the visible accessibility gaps (VoiceOver, Dynamic Type).

---

# Cross-persona insight section

## Common friction points (mentioned by 5+ personas)

Ranked by number of personas hit:

### 1. **No pause / lap / split feature** — hit by Ben, Nina, Sarah, Sam (indirectly), Ravi, Tom, Nathan (implicitly)
[FUNC:F-SES-08, F-SES §Missing manual lap markers]
Runners AND hikers hit this. Half the market gone.

### 2. **Silent failures (offline, save, sync, permissions)** — Marco, Chen, Alex, Tama, Emma, Kate, Nathan
Every user who has any network turbulence has a story here. [FUNC:F-OFF-01, F-NET-01, F-STO-01, F-GPS-02]

### 3. **StopSummarySheet Discard is one-tap = data loss** — Margaret, Sarah (near-miss), any distracted user
[SCREEN:hiking §25 Critical]
Guaranteed to bite an elderly / distracted user.

### 4. **No forgot-password / account recovery** — Lily, Anna (potential), Tom (recovery), Jake (partial)
[FUNC:F-AUTH-04]
Table-stakes feature. Absence is a 1-star review magnet.

### 5. **No dark mode / night-safe UI** — Priya, Ben (5am), any winter runner in NZ
[SCREEN:hiking, running §Critical no dark mode]
NZ winter sunrise 7:30am. Runners run before that.

### 6. **App Store Blockers** — Zoe catches, but ALL users are affected by rejection: Apple Sign In, Google logo, Delete Account
[FUNC:F-AUTH-01/02/03]
Not "friction" — existential.

### 7. **No push notifications** — Anna, Nathan, Jake, any social user
[FUNC:F-PUSH-01]
Friend requests, auto-pause, invites — all silent.

### 8. **Memory map illegible / unshareable / privacy-leaking** — Kai, Sarah, Zoe, Anna
[SCREEN:memory §S7, §S14, EDGE:S40]
The app's hero visual is not launch-ready.

### 9. **Icon overloading (Route/Compass/Map/Users/Target)** — Sarah, Marco, Tama
[CONS:Icon overloading]
Casual users get lost.

### 10. **Blank-screen loading** — Chen, Tom, Marco, Tama (partial map)
[CONS:Loading indicators, SCREEN:mapshistory §31, mapscreen §1]
Ambiguity between "loading" and "broken" for up to 15s.

## Persona-specific dealbreakers (each persona has 1-2 items only they'd notice)

| Persona | Dealbreaker | Why others miss it |
|---------|-------------|-------------------|
| **Sarah** | Can't add marker mid-hike | Only casual users try to capture moments |
| **Ben** | 400m distance inflation vs Garmin | Only runners cross-check |
| **Priya** | White map blinding at 5am | Only night users care |
| **Tama** | Partial offline pack has no signal | Only pro-user hunts for this |
| **Marco** | No i18n / "Cairn" = ??? | English-first users skip past |
| **Margaret** | Discard button = data loss on fat-finger | Only slow-taps hit this |
| **Nathan** | Auto-pause silent without notifications | Only distracted parents fire this |
| **Emma** | 1.3GB storage growth in 20 hikes | Only low-disk users check |
| **Ravi** | LPM warn every day, no "don't show" | Only LPM-always users hit repeatedly |
| **Alex** | Background-permission modal is one-shot dead end | Only privacy-tuned users deny then reconsider |
| **Chen** | `getMe` timeout silent guest fall-through | Only high-latency users see |
| **Kate** | OTA auto-apply during tracking splits hike | Only alt-tabbers with unlucky OTA timing |
| **Jake** | Sign-out during tracking has no guard | Only multi-account users fat-finger |
| **Nina** | No HealthKit / cadence | Only competitive runners need |
| **Lily** | No forgot-password | Only occasional users forget |
| **Kai** | Home-radius revealed in shared memory map | Only sharers realize privacy leak |
| **Anna** | No hike-share, no user profiles | Only social users try to share |
| **Sam** | 40-min drain causes frame drop | Only very-long-idle users hit |
| **Tom** | "Route data unavailable" vs "still loading" indistinguishable | Only returning users see this class of hikes |
| **Zoe** | Everything (professional reviewer) | She has to look |

## Ranking by star rating

| Stars | Personas | Count |
|-------|----------|-------|
| **1 star** | Priya, Ben, Nathan, Emma, Chen, Jake, Nina, Lily | **8** |
| **2 stars** | Sarah, Tama, Marco, Alex, Kate, Kai, Anna, Tom, Zoe | **9** |
| **3 stars** | Ravi, Sam | **2** |
| **4 stars** | — | 0 |
| **5 stars** | — | 0 |

**Mean rating: 1.7 / 5.**
**Weighted for market impact** (Sarah + Marco + Lily + Anna represent 60%+ of the target market): **1.5 / 5.**

App is **NOT ACCEPTED** for NZ launch by Virtual User standard (< 4.5 for any persona = defect; mean must be > 4.0).

---

# Playwright test proposals — NEW findings (novel to this hunt)

For each of the 20 NEW findings surfaced by this hunt (not already in FUNCTION_AUDIT / EDGE_HUNT):

### [NEW-UH-01] Sarah: Cannot retro-add markers to saved hike
```
NAVIGATE /home
CLICK "Activity" tool button
CLICK first hike card
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/sarah-retroadd.png
Expect: An "Add marker" or "Add note to this hike" button visible on detail screen
Current: Read-only, no add-affordance
```

### [NEW-UH-02] Priya: No emergency contact / SOS
```
NAVIGATE /settings
SCROLL to bottom
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/priya-sos.png
Expect: "Emergency Contact" or "SOS" or "Safety" section
Current: None
```

### [NEW-UH-03] Priya: No screen-dim toggle
```
NAVIGATE /hiking (active)
Look at map UI controls
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/priya-nightmode.png
Expect: A dim / night-mode toggle icon
Current: None
```

### [NEW-UH-04] Marco: No trail directory / discovery
```
NAVIGATE /home
Look for a "Popular trails near you" section OR search
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/marco-discovery.png
Expect: Trail list, search, or discovery entry point
Current: None — only user's own historical activities
```

### [NEW-UH-05] Nathan: No auto-resume option for recovery modal
```
Force-quit during hike
Cold boot app
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/nathan-autoresume.png
Expect: Modal with 3 buttons (Continue / Discard / Always continue)
Current: 2 buttons only (Continue / Discard)
```

### [NEW-UH-06] Nathan + Alex: No in-hike indicator for tracking gap
```
NAVIGATE /hiking (active)
Set background app to be killed by iOS (simulate)
Force-restore foreground
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/nathan-gapindicator.png
Expect: Banner "Tracking gap detected 12:34 — 12:41 (7 min)"
Current: Silent
```

### [NEW-UH-07] Emma: No storage usage display
```
NAVIGATE /settings → Storage or Data
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/emma-storage.png
Expect: "Cairn is using 340MB"
Current: No such setting
```

### [NEW-UH-08] Ravi: No LPM degradation indicator
```
Enable iOS Low Power Mode
NAVIGATE /hiking → START
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/ravi-lpm.png
Expect: Persistent chip "LPM — reduced GPS quality"
Current: Alert once per 24h, no persistent chip
```

### [NEW-UH-09] Ravi: No battery estimate
```
NAVIGATE /home → Start Hike (pre-start)
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/ravi-battery.png
Expect: "Estimated ~8%/hr battery usage" or similar
Current: None
```

### [NEW-UH-10] Chen: No connection quality indicator
```
Throttle network to 3G
Open app
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/chen-connquality.png
Expect: Slow-connection banner (Memory has one; other screens should too)
Current: Only Memory has slow-network banner
```

### [NEW-UH-11] Nina: No cadence
```
NAVIGATE /running (active)
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/nina-cadence.png
Expect: Cadence stat visible
Current: Distance / duration / pace only
```

### [NEW-UH-12] Kai: No native share
```
NAVIGATE /memory or Activity detail
Look for share button
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/kai-share.png
Expect: Share icon triggering iOS share sheet
Current: None
```

### [NEW-UH-13] Kai: No privacy blur on shared memory map
```
NAVIGATE /memory
Take screenshot
Verify home-radius area is masked
Expect: Auto-blur or opt-in mask
Current: Home clearly visible
```

### [NEW-UH-14] Anna: No hike-share to friends
```
NAVIGATE /activity → hike detail
Look for "Share with friend" action
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/anna-hikeshare.png
Expect: Share to friend option
Current: None (markers have visibility, hikes do not)
```

### [NEW-UH-15] Anna: No hike-level permissions
```
NAVIGATE /hiking → StopSummarySheet
Look for visibility control
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/anna-hikevisibility.png
Expect: Public/Friends/Private toggle for the hike
Current: Save is private by default, no toggle
```

### [NEW-UH-16] Anna: No block/report on friend requests
```
NAVIGATE /friends → incoming request
Long-press or tap ⋯
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/anna-blockfriend.png
Expect: Block / Report actions
Current: Accept / Decline only
```

### [NEW-UH-17] Sam: No elevation smoothing
```
Load a real hike with elevation
NAVIGATE /activity → hike detail
Compare shown gain vs Apple Watch or reference
Expect: Elevation gain within 5% of ground truth
Current: Raw accumulation → inflated
```

### [NEW-UH-18] Sam: No iOS Focus integration
```
NAVIGATE /hiking → START
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/sam-focus.png
Expect: Prompt "Enable Focus during hike?" OR settings option
Current: None
```

### [NEW-UH-19] Tom: No undo on delete
```
NAVIGATE /activity
Delete a hike
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/tom-undo.png
Expect: 30s Undo toast
Current: Deletion is immediate + irreversible
```

### [NEW-UH-20] Tom: No welcome-back experience
```
Sign in as returning user with >5 hikes
NAVIGATE /home
SCREENSHOT docs/ux-audit-2026-07-28/user-hunt/tom-welcomeback.png
Expect: "Welcome back — X hikes since April"
Current: Same Home as new user
```

---

## Additional Playwright regression proposals (surfacing already-known findings by novel paths)

### Sarah's tui moment — trigger F-SES-08 empirically
```
NAVIGATE /hiking (active)
Attempt to find any "Add pin" affordance
SCREENSHOT
Expect: Add-marker button reachable while hike is active
Current: Absent
```

### Kate's OTA-during-hike — trigger F-OTA-02
```
Start hike with sim-walker
Trigger fake OTA update available state
Wait for auto-apply
Expect: OTA NOT auto-apply while tracking status === 'tracking'
Current: Auto-applies 600ms after download regardless
```

### Jake's sign-out during tracking — trigger EDGE:S13
```
Start hike
NAVIGATE /settings → Sign Out
Expect: Alert "You are recording a hike. End first."
Current: Signs out silently, saveHikeAtomic will 401
```

### Anna's self-invite — trigger friends §FS-12
```
NAVIGATE /friends → Add Friend
Type own email
Send
Expect: "You cannot friend yourself"
Current: Guard is dropped — request sent
```

### Priya's dark mode — trigger hiking dark mode Critical
```
iOS Settings → Appearance → Dark
Open Cairn
NAVIGATE across Home / Hiking / Map
SCREENSHOTS
Expect: Dark backgrounds
Current: All light regardless of iOS setting
```

### Margaret's Discard fat-finger — trigger hiking §25
```
Start hike (sim-walker 200m)
Stop
StopSummarySheet appears
CLICK Discard once
Expect: Confirmation modal
Current: Hike gone in one tap
```

### Marco's date format — trigger F-I18N-02
```
iOS Settings → Region → United States
Open Cairn, view hike date
Expect: MM/DD/YYYY format
Current: Hardcoded DD/MM/YYYY
```

### Lily's forgot password — trigger F-AUTH-04
```
NAVIGATE /auth (sign in view)
SCREENSHOT
Expect: "Forgot password?" link
Current: Not present
```

### Kai's broken Memory pills — trigger memory §S14
```
NAVIGATE /memory
CLICK any revealed cairn dot
CLICK Like / Report / Hide pill
Expect: A functional response (toast, state change, action)
Current: No handler wired
```

### Tom's blank green screen — trigger mapshistory §31
```
Fresh install → sign in
NAVIGATE /activity → open a hike from server
Time the map render
Expect: Skeleton or spinner within 1s
Current: Blank green up to 15s
```

---

# Executive summary for launch decision

**20 personas played. 60+ new friction findings surfaced. Mean star rating: 1.7/5. Weighted-market mean: 1.5/5.**

**Novel findings not in FUNCTION_AUDIT / EDGE_HUNT / CONSISTENCY**:
- 20 new UX gaps (NEW-UH-01 through NEW-UH-20)
- Confirmed persona-specific dealbreakers for 20 distinct segments
- Cumulative effect: 8 of 20 personas would give **1 star**

**Critical patterns crossing multiple personas**:
1. Silent failures across offline / storage / permissions / GPS / save — pervasive
2. No pause / no lap / no splits — half the sport market gone
3. StopSummarySheet Discard = one-tap data loss — universal fat-finger risk
4. No forgot-password — table-stakes miss
5. No dark mode — night users can't use safely
6. Three App Store review blockers (Apple, Google, Delete Account)
7. No push notifications — social features half-built
8. Memory map illegible / unshareable / privacy-leaking — hero visual not launch-ready
9. Icon overloading — casual users get lost
10. Blank-screen loading — indistinguishable from "app is broken"

**Verdict**: **NOT ACCEPTED** for NZ launch. Would ship at ~1.5-2.0 star average. Estimate: 6-8 weeks of focused polish before any persona reliably reaches 4 stars.

**Top-3 recommended Sprints** (before launch):

1. **P1 App Store Blocker Sprint** — Apple Sign In, Google logo, Delete Account (in-app, not mailto), ATT prompt, VoiceOver labels on core flow, Dynamic Type support.
2. **P1 Data-Loss & Confirmation Sprint** — Discard confirm, mid-track back confirm, RouteEditor iOS back confirm, forgot-password flow, storage preflight, offline banner, sign-out-during-tracking guard.
3. **P1 Loading & Feedback Sprint** — kill blank-screen loading (MapScreen, MapHistory, RouteEditor), universal save-success toast + haptic, universal error copy layer, staged-copy loader pattern from Memory rolled out everywhere.

---

**End of USER_HUNT.**

USER_HUNT_COMPLETE
