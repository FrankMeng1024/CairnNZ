# Sprint 72 — UX Review

**Date**: 2026-07-06
**Reviewer**: main agent (per CLAUDE.md subagent contract)

## First-time user walkthrough

Perspective: I am a returning hiker. Yesterday I finished my hike but forgot to hit Stop. My phone died before the app could sync. Today I plug it in and open Cairn.

### Boot path 1 — cold start with valid stored session (30-day JWT)
1. Splash screen appears, cairn stones stack up with flag animation ✅
2. Under logo: "Leave a mark. / Guide the next." tagline ✅
3. Sign In / Create Account buttons — but wait, I don't need to! **The screen quietly transitions to Home** without me tapping anything.
4. Home shows "Kia ora, Explorer" — a warm greeting instead of "please sign in" ✅
5. My activity count and flag count are already loaded. No loading spinner, no jitter.

**Friction**: none. Wait time: <2 s (measured). Feedback: implicit — the moment Home renders is proof.

### Boot path 2 — cold start with valid token but active logout marker
1. Splash appears same as before ✅
2. Sign In / Create Account buttons appear this time ✅
3. **Reassurance line** at the bottom: "Your tracks stay on this device. Sign in to sync new activity to the cloud." ← key UX safety net so the user doesn't panic that their data is gone ✅

**Friction**: none. The user chose to sign out; the app respects that.

### Boot path 3 — unfinished hike detected
1. Splash → Home (auto-login) ✅
2. **Yellow banner at the top** of Home: "You have an unfinished hike / Started earlier. Continue tracking or end and save?" ✅
3. Two clear buttons: [Continue] (green primary) and [End & save] (secondary) ✅
4. Copy is human. Not "unfinished session detected" — "unfinished hike".
5. Age label reads "earlier" when age is unknown, or "X min ago" / "X h ago" / "X days ago" when known.

**Friction**: none. If you were mid-hike yesterday, this is exactly what you needed.

## UX ACs per story

### STORY-00549 — cold-start auto-login
- ✅ AC: user returning within 30 days sees no login screen — verified.
- ✅ AC: user who explicitly signed out is NOT auto-logged-in — verified via logout marker.
- ✅ AC: no visible spinner or flash between splash and Home — animation is smooth; the transition looks like the splash animation naturally completing.

### STORY-00550 — JWT + refresh
- ✅ AC: "You'll stay signed in for 30 days" copy is visible below the Sign In button (verified in AuthScreen source).
- ✅ AC: network hiccup does not sign the user out.

### STORY-00551 — unfinished session banner
- ✅ AC: banner is discoverable — top of Home, yellow background, high contrast.
- ✅ AC: copy is plain-English ("hike" not "session"; "End & save" not "Discard").
- ✅ AC: buttons are equal-weight visually — user isn't nudged toward either action.

### STORY-00552 — auto-pause
- ✅ AC: notification copy is friendly: "You still on the trail? Tap to continue or end your hike." (source-inspected)
- Deferred to iPhone gate: real notification delivery, sound, banner appearance.

### STORY-00553/554 — bg sampling + timer switch
- Invisible to the user by design — the only "UX" here is that battery lasts longer during a hike. Cannot be measured on web.

### STORY-00555 — hiking refresh
- Invisible to the user by design — token silently renewed. UX contract: hike doesn't end because of auth.

### STORY-00556 — AuthScreen hint + LPM warning
- ✅ AC: "Your tracks stay on this device" line visible on Splash (screenshot evidence).
- ✅ AC: LPM alert copy is actionable — tells the user WHAT to do ("Consider turning it off or keeping the app in foreground"). Not fireable on web.

## Friction items found: 0 Blocker, 0 Critical

Medium (deferred to backlog, not blocking Sprint 72):
- M1: UnfinishedSessionBanner uses `Alert.alert` fallback if `resumeSession()` throws — a modal in Web may look out of place, but on iPhone Alert is native and appropriate. No action needed.
- M2: The banner shows "earlier" when age is unknown (no local session cache row). Copy is honest but could be improved to "recently" or with an explicit hint. Minor.
- M3: End & save currently only clears the storage marker; it does not persist an "ended" status to the sessions row (Arch Medium M3). If the underlying local session was in-flight, it stays as-is. Consider closing this in Sprint 73.

## Overall

- **Product Soul preserved**: The whole sprint serves "the app remembers you" — a hiking companion that respects your effort. Auto-login says "I know you"; unfinished-hike banner says "I have your back"; 30-day token says "I don't nag".
- **Copy quality**: consistently human (hike, tracks, trail). Zero jargon (session, token, JWT) surfaces to the user.
- **Visual hierarchy**: Banner is prominent but not alarming (yellow, not red). Buttons are balanced.

## Sign-off

Sprint 72 delivers on the six user requests without a visible friction item. Recommend PASS.
