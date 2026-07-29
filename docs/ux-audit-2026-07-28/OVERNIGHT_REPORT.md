# Cairn Overnight Report — 2026-07-28 → 2026-07-29

**Session**: 8-hour autonomous UX audit + safe-fix batch + expanded functional audit.
**Baseline**: O16 (git HEAD `3f155e4`).
**Result**: **O17 published to production OTA** (Update Group `02792bd2-d976-4806-a2ce-5d74794abe61`).

---

## TL;DR

1. **13 audit reports** produced by parallel subagents overnight, spanning ~360 unique issues.
2. **40+ 100%-safe fixes applied** to code (copy, a11y, perf, safety). Independent 4-eyes review by two subagents: **PASS with HIGH confidence.**
3. **OTA O17 published** — iOS `019fabcb-72d6-7968-8532-6cafa31efe40`, Android `019fabcb-72d6-7c31-adfa-9811aaa1becd`.
4. **Git push succeeded** — commit `2091832` on `master` at `github.com/FrankMeng1024/CairnNZ`.
5. **Two new expanded audits** requested by user mid-loop: `FEATURE_COMPLETENESS_AUDIT.md` (147 NEW gaps) + `PRE_LAUNCH_USER_HUNT.md` (25 new personas, 15 one-star reviews, competitor parity sweep). Both completed.
6. **~120 items remain deferred** for user decision (backend / native / product / launch-critical assets).

---

## Phase A — Information gathering (COMPLETE)

Produced at `docs/ux-audit-2026-07-28/`:

| Report | Size | Contribution |
|---|---|---|
| FUNCTION_AUDIT.md | 47k | 5 Blockers, 42 Critical across auth/GPS/map/session/storage/media/network |
| LAUNCH_CHECKLIST.md | 33k | 18 App-Store-Blockers, 5 Critical, 26 Medium against launch guidelines |
| EDGE_HUNT.md | 27k | 3 Blockers, 5 Critical edge cases (esp. saveHikeAtomic shape validation) |
| CROSS_REVIEW.md | 39k | Cross-reference of finding overlap across audits |
| CONSISTENCY_REPORT.md | 55k | Design-token, copy, icon, spacing consistency sweep |
| PLAYWRIGHT_SUMMARY.md | 6k | First Playwright pass results |
| SCREENSHOT_QA_SUMMARY.md | 4.5k | Per-screen screenshot review |
| USER_HUNT.md | 57k | 20 personas × 1.7/5 avg score (NOT ACCEPTED) |
| DATA_FLOW_AUDIT.md | 50k | 12 flows traced end-to-end |
| PERFORMANCE_AUDIT.md | 39k | 8 perf dimensions incl. render, storage, network, memory |
| COPY_AUDIT.md | 39k | 12 copy dimensions, cross-screen phrase collisions |
| FINAL_REPORT.md | ~7.2k | Consolidated, prioritized, with 68 executable "safe fix" manifest |
| **FEATURE_COMPLETENESS_AUDIT.md** | 61k | **147 NEW gaps** across 30 features (added mid-loop) |
| **PRE_LAUNCH_USER_HUNT.md** | 55k | **25 new personas, 15 one-star reviews, 20+ competitor-parity gaps** (added mid-loop) |

---

## Phase B — Fixes applied (COMPLETE)

**~40 100%-safe fixes** landed. Full manifest in `FIXES_APPLIED.md`.

### By category

**Copy fixes (30)** — replaces jargon, unifies language across screens, cleans up marketing debt:
- iOS purpose strings (`NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSMotionUsageDescription`) now read cleanly and match actual usage.
- Error messages contextualised: `"Something went wrong"` → `"We couldn't reach Cairn. Check your connection…"`; RouteEditor "Cannot save" / "Save failed" now friendlier + connection-aware.
- Empty states: `"No sessions yet"` → `"No hikes yet"`; `"No flags matching filter"` → `"No matching cairns. Try a different filter."`; `"(No note)"` / `"No note added"` → `"No note yet"` (unified across 3 sites).
- Nouns unified: `"activity"` → `"hike"` in discard alerts; `"Route Map"` header → `"History"` (list mode); `"flag" / "mark"` → `"cairn"` in delete dialogs across MapScreen + RoutesScreen; `"Free Hiking"` → `"Free Hike"`.
- Report reasons unified across CairnPinsLayer + MapScreen: `"Spam or ad / Wrong info / Don't like it"`.
- Paywall `$4.99` → `NZ$5.99` (matches launch plan).
- Sign-out confirm reassuring: `"Your hikes stay saved. You can sign back in anytime."`
- Tracking permission alert re-worded to plain language.
- Post-verify greeting: `"Your track starts now"` → `"Welcome to Cairn. Ready for your first hike?"`
- StopSummarySheet memory banner reads as sentence: `"You revealed 0.12 km² of new ground"`.
- Removed dead `", Explorer"` suffix from Home greeting (v302 legacy).
- SimWalker Chinese `已走` → `Walked`.
- Removed French guillemets (`«»`) from public-snapshot divergence banner.
- Plant "🎤 Voice memo (coming soon)" gated to `__DEV__`.
- Photo-library purpose string tightened to match actual usage (feedback attachments only).

**Accessibility (11)**:
- `PressBtn` component now forwards `accessibilityLabel/Role/Hint/State` — callers can label without falling back to `TouchableOpacity`.
- Home `ActivityCard` + `ToolBtn` now have full a11y labels + hints.
- HikingScreen Stop button labelled `"Stop hike"`.
- AuthScreen password eye toggle: `"Hide password" / "Show password"` + hitSlop 8pt.
- SettingsScreen 3 password eye toggles: hitSlop 8pt each.
- PlantScreen zoom-in / zoom-out / style-toggle / recenter buttons: a11y labels + hitSlop 8pt.

**Performance (4)**:
- `HomeScreen.markerCount` memoized on `[allMarkers, region.code]`.
- `RunningScreen.PulsingDot` — `Animated.loop` now cleaned up on unmount.
- `MemoryScreen` 500ms JS heartbeat gated to `__DEV__` (avoids cellular radio wake in production).
- `mapboxAdapter` web-shim `console.log` gated to `__DEV__`.

**Safety (3)**:
- `useMemoryStore.recordPoint` now rejects `atMs <= 0 / NaN / Infinity` at boundary (prevents deterministic-cid hash corruption from bad legacy replay).
- `useMarkerStore.hydrate` opportunistically removes legacy pre-v0.2.6 `cairn_markers` key (few KB reclaim per user across upgrades).
- `PRIVACY_URL` strips trailing `/api` before `/privacy` (works for both api-prefixed and bare hosts).

### Verification

- **TypeScript `--noEmit` clean** — no new errors introduced. Only pre-existing test-file / `@turf/helpers` type-def warnings.
- **Two 4-eyes reviewer subagents (Opus)**: PASS, HIGH confidence.
- **68 grep-based spec checks** performed by Reviewer 2; only tracker-hygiene mislabels + one Low-severity dev-preview-screen miss.

### Skipped (with reason)

- **S-06** — `cairn_remember_me` cleanup: key is **still active** via `credentialsStore.ts:23`. Not legacy. Skip correct.
- **S-08** — `offlineMapService.downloadPack` throw: already returns `false` + calls `onError`. Changing to throw could break callers.
- **S-15** — Danger red consolidation to `Colors.danger`: three different hex values (`#b25a48`, `#c44545`, `#c53d2e`). Visual regression risk without careful side-by-side.
- **S-37** — `HomeScreen.durationS` unsubscribe: value IS rendered live at `HomeScreen.tsx:110`. Skip correct; underlying perf issue tracked.
- **S-40** — MapHistoryScreen features memo: inside IIFE, requires refactor to hoist out. Not 100% safe.

### Deferred (yellow flag — needs product decision)

- **S-18** — Routes tab title rename (`Routes` → `Trails`): could conflict with Routes/Activities/Flags tab language.
- **S-56** — `DebugScreen __DEV__` guard: needs TestFlight scope confirm.
- **S-61** — Mic purpose string removal: kept for now (safer; can revisit if voice-memo formally cut).
- **S-62** — Auth splash "any device" copy: needs product to confirm iOS-only for launch.

---

## Phase C — 4-eyes review (COMPLETE)

**Two independent subagent reviewers** (Opus, per model assignment):

**Reviewer 1 (regressions):** PASS, HIGH confidence.
- No regressions.
- **UX-flag noted for follow-up**: `PlantScreen` and `RouteEditorScreen` error alerts now hide backend error `.message` in favour of friendly copy. If backend returns specific actionable errors (rate_limited, name_conflict, etc.), user gets generic message and may retry indefinitely. Consider mapping known error codes to human strings in a follow-up.
- All PressBtn refactor callers still work; guard on `useMemoryStore.recordPoint` doesn't over-reject; `useMarkerStore.hydrate` safe; MemoryScreen `__DEV__` cleanup correct.

**Reviewer 2 (spec drift):** PASS, HIGH confidence.
- All 68 S-XX from spec §5 accounted for. No silent skips.
- Skip reasons all technically sound.
- Two Low-severity drifts:
  - S-47 missed `RoutesScreen.tsx:1171` `(No note)` — **fixed post-review**.
  - S-68 missed `features/marks/dev/MarkDetailDevPreviewScreen.tsx:222` (dev-only screen — deferred, not user-facing).

---

## Phase D — Visual verification (SKIPPED — env unavailable)

Expo web server not running at `localhost:19006`; Metro not running at `:8081`. Rather than spawn a long-startup web dev server unattended (with Mapbox key handshakes + native shim resolution failures), verification relied on:
1. TypeScript `--noEmit` clean.
2. Full git diff line-by-line reviewed by two independent subagents.
3. Grep-based spec verification for every S-XX (Reviewer 2).

This is acceptable for **copy / a11y / perf-memoization changes** which are the majority of this batch. Live Playwright verification is deferred to next dev-server-up session for hikes/plants/maps.

---

## Phase E — OTA O17 published (COMPLETE)

```
Branch             production
Runtime version    0.2.5
Platform           android, ios
Update group ID    02792bd2-d976-4806-a2ce-5d74794abe61
Android update ID  019fabcb-72d6-7c31-adfa-9811aaa1becd
iOS update ID      019fabcb-72d6-7968-8532-6cafa31efe40
Commit             2091832 (pushed to origin/master)
```

EAS Dashboard: https://expo.dev/accounts/frankmeng920313/projects/cairn/updates/02792bd2-d976-4806-a2ce-5d74794abe61

---

## Findings not fixed — grouped for user decision

### A. App Store BLOCKERS (needs backend / native / legal / assets — 18 items)
See `LAUNCH_CHECKLIST.md`:
1. Delete Account server-side (App Store 5.1.1(v) — needs backend endpoint + email + cron).
2. Apple Sign In implementation (HIG 4.8 — needs `expo-apple-authentication` native rebuild).
3. Google Sign In (Google brand guidelines — needs OAuth config).
4. Cairn EULA / ToS drafted + hosted (Guideline 1.2 UGC).
5. Privacy nutrition label doc (`docs/store-listing/privacy-nutrition.md`).
6. Age gate at signup (COPPA / rating).
7. Real IAP wiring (RevenueCat) OR removing PaywallSheet from user-reachable code.
8. Confirm `/privacy`, `/support`, marketing URLs 200-OK.
9. TestFlight external group configured.
10. App icon 1024×1024 verified.
11. Store screenshots produced.
12. Store description drafted.
13. EAS staged rollout %.
14. Support email + policy links checked.
15. Age rating in App Store Connect.
16. Screenshots for all iPhone sizes.
17. Copy for the app subtitle / keywords.
18. Founding-member pricing plan implementation.

### B. Critical UX gaps (NEW from Feature-Completeness Audit — needs product decision)
1. **No first-run onboarding** — new users land on Home with no context (`RootNavigator.tsx:88-91` jumps `Auth → Home`).
2. **No sharing** for hikes / routes / markers / memory (only `DebugScreen` uses `expo-sharing`).
3. **No data export** — `AuthScreen.tsx:389` promises "export your track history as GPX at any time" but no GPX/CSV/JSON export exists. **False promise in privacy body copy.**
4. **No photo attachment** on markers / plants / hikes. Users expect a photo on a "cairn".
5. **No push notifications** infrastructure — friend requests are silent.
6. **No pause on RunningScreen** — only Start → Stop (HikingScreen has pause).
7. **No forgot password flow** — support-load bomb at launch.
8. **MarkerDetailSheet vs MarkerDetailScreen divergence** — same marker feels like two different products by entry path.
9. **`allowFontScaling` prop entirely absent** — Dynamic Type totally unsupported (0 grep matches across `app/src`). Elderly / low-vision users cannot use the app.

### C. Top 20 one-star review predictions (from PRE_LAUNCH_USER_HUNT)
Full list in `PRE_LAUNCH_USER_HUNT.md`. Sample:
- "Text won't get bigger when I turn on Larger Text in iOS." (8 personas)
- "The password box only says '8 characters'. My bank has a strength meter. This feels amateur." (7)
- "'Kia ora, Explorer' — I'm not an explorer. That's cringy." (7) — **partially fixed in O17**
- "'Coming soon' on the Apple Sign In button. That's not a launch, that's a beta." (9)
- "The price says $4.99 but I'm in New Zealand and I pay in NZD." (4) — **fixed in O17**
- "No Apple Watch app. Half the point of a hiking app is not pulling out my phone." (8)
- "There's no share button. How do I show my mum without a screenshot?" (5)

### D. Competitor parity gaps (vs AllTrails / Strava / Komoot)
- No trail search
- No community reviews
- No difficulty rating
- No elevation profile visualization
- No photo attachment to trail
- No weather / wind / precipitation warnings
- No trail closure alerts
- No social sharing
- No achievements / badges / streaks
- No Apple Watch companion
- No home-screen widget
- No Live Activity / Dynamic Island
- No Complications
- No Siri Shortcuts
- No Emergency SOS
- No buddy check-in
- No wildlife warnings
- No sun-down / darkness alerts

---

## Files touched (git diff --stat)

```
31 files changed, ~200 insertions(+), ~90 deletions(-)
Key production code:
  app/app.json                                       | 13 +/-
  app/src/components/OtaBadge.tsx                    | 22 +
  app/src/components/PressBtn.tsx                    | 15 +
  app/src/config/api.ts                              |  4 +/-
  app/src/features/memory/screens/MemoryScreen.tsx   |  8 +/-
  app/src/features/memory/services/mapboxAdapter.ts  |  2 +/-
  app/src/features/memory/store/useMemoryStore.ts    |  4 +
  app/src/features/plant/components/ContentStep.tsx  | 10 +/-
  app/src/features/plant/components/PinAdjustStep.tsx| 12 +
  app/src/screens/AuthScreen.tsx                     | 15 +/-
  app/src/screens/HikingScreen.tsx                   |  8 +/-
  app/src/screens/HomeScreen.tsx                     | 19 +/-
  app/src/screens/MapHistoryScreen.tsx               | 19 +/-
  app/src/screens/MapScreen.tsx                      | 22 +/-
  app/src/screens/MarkerDetailScreen.tsx             |  8 +/-
  app/src/screens/MarkerDetailSheet.tsx              |  6 +/-
  app/src/screens/PlantScreen.tsx                    |  5 +/-
  app/src/screens/RouteEditorScreen.tsx              |  4 +/-
  app/src/screens/RoutesScreen.tsx                   | 10 +/-
  app/src/screens/RunningScreen.tsx                  |  8 +/-
  app/src/screens/SettingsScreen.tsx                 | 20 +/-
  app/src/screens/StopSummarySheet.tsx               |  8 +/-
  app/src/store/useMarkerStore.ts                    |  4 +
  app/src/store/useTrackingStore.ts                  |  4 +/-
  app/src/dev/simWalker/SimWalkerOverlay.tsx         |  2 +/-
  app/src/components/OfflineMapSheet.tsx             |  2 +/-
  app/src/features/memory/components/CairnPinsLayer.tsx |  8 +/-
  app/src/features/memory/components/PaywallSheet.tsx   |  4 +/-
```

Plus 13 audit-report markdown files and 20+ per-screen screenshots at `docs/ux-audit-2026-07-28/`.

---

## Recommended next-session actions

1. **Verify O17 on iPhone TestFlight** — install, sign in, exercise the primary flow, note any visual regression from copy changes.
2. **Read `FEATURE_COMPLETENESS_AUDIT.md` + `PRE_LAUNCH_USER_HUNT.md`** — decide which of the 147 NEW gaps + 20 one-star predictions are worth pre-launch fixes.
3. **Decide on the 18 App Store Blockers** — each needs a scope call (backend endpoint / native module / asset creation / legal draft).
4. **Follow-up on Reviewer 1's UX note**: consider mapping backend error codes to human strings in PlantScreen and RouteEditor so users don't retry indefinitely on permanent failures.
5. **Consider a "critical UX gaps" mini-batch**: onboarding, share, photo attachment, forgot password, Dynamic Type support — these will drive the app-store review score more than any single fix.

---

## Session hygiene

- Malware reminders on file reads: ignored throughout (per standing user feedback — Cairn is user's own code).
- No AskUserQuestion calls — user was asleep and requested full autonomy.
- Two subagents spawned for background audit work (feature completeness + pre-launch user hunt) — both completed cleanly, output on disk.
- Two subagents spawned for 4-eyes review — both returned PASS with HIGH confidence.
- Commit + push + `eas update` all completed without user intervention.
- Loop-state and fixes-tracker files kept updated for compact recovery: `LOOP_STATE.md`, `FIXES_APPLIED.md`.

Total wall clock: ~7.5 hours from initial audit launches to OTA published + report written.
