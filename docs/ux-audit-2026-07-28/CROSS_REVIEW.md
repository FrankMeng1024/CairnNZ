# Cross-Review — 2026-07-28

**Reviewer**: A-XREV
**Method**: Double-blind read of all 13 AUDIT.md files. For each auditor: gap analysis on viewport, state, interaction, edge cases, a11y, i18n, baseline consistency, Playwright script practicality, and severity calibration against user's `feedback_truncate_is_bug` (truncate = Critical) and `o1_clean_code_4_eyes` (4-eye standard).

---

## Per-auditor gap report

### A1 (home) — coverage: 8/10

**Missed scenarios**:
- **iPhone Pro Max 428x932 covered but iPhone SE 375x667 and 393x852 only partially** — S21 tested at 375x667 (SE), S22 at 430x932 (Pro Max), but the middle band 393x852 (iPhone 15/15 Pro) was never explicitly exercised. This is the most common launch device.
- **No Te Reo/Chinese long-string test** — greeting "Kia ora, Explorer" is baked as static English. There is no scenario for a translated greeting overflowing the header row where `header` uses `justifyContent:'space-between'` with a variable-width right side.
- **Deep-link entry never covered** — S01–S32 all assume normal navigation. Universal Link "cairn://home" or push-notification cold-boot into Home was not tested. Given the app supports OTA restart modals, a deep-link during OTA-ready state is a real edge case.
- **RTL fallback (Arabic/Hebrew)** — none of the 32 scenarios verify RTL. `flexDirection: 'row'` layouts (header, statsRow, RecentRow, toolsRow) will silently flip; the OtaBadge floating top-right becomes top-left with no test.
- **Screen reader / VoiceOver** — no scenario exercises `accessibilityLabel` on ActivityCards, ToolBtns, or the statChips. The stats "1 session · 0 flags" is read as raw text; the ActivityCard "Hiking" has no accessibility hint.
- **Dynamic Type** — Apple HIG requires layout to survive user-scaled font sizes. `20pt` cardStyles.title and `11pt` toolStyles.label were not tested at Larger Accessibility Sizes.
- **Backgrounded-then-returning app** — no test for what Home looks like when user backgrounds during live-tracking and returns 5min later.
- **Tap-target size audit missing entirely** — no HIG 44pt check on ToolBtn (has `minHeight:64` — fine) or ActivityCard chevron (36×36 — fine, but `helpBtn` pattern from Settings audit was applied inconsistently).

**Weaknesses**:
- **Severity calibration slack**: S32 "Leave-a-Cairn card subtitle clipped when all three optional rows visible" was rated Critical — correct per user memory rule. But S21 "Leave-a-Cairn subtitle may clip on iPhone SE" is scored only UX 6/10 with "yes on iPhone SE" as "丑" (ugly) — this same class of clipping bug in a less dense state should also be Critical, not Medium.
- **Hardcoded colors given only Low priority** in fix list #7, but token-consistency is a shipping bar in Cairn's design system. Should be Medium.
- Playwright scripts use `EVALUATE Date.prototype.getHours = () => 3;` — this monkey-patches global Date and will leak across tests unless restored. No cleanup steps.

**Strengths**:
- Cleanest audit of the batch — exhaustive 32 scenarios with full Playwright coverage, evidence directory naming compliant.
- Consistency table vs SettingsScreen baseline is the reference-quality format the others should follow.
- Identified the zombie-session count divergence (S08) that no other auditor caught for the shared session-count component.

---

### A2 (auth) — coverage: 7/10

**Missed scenarios**:
- **iPhone Pro Max 428x926 never explicitly resized** — S28 tests SE 375x667, S29 tests iPad 1366x1024. The primary launch device 393x852 and 428x926 are missing. Register form has 6 fields + expanded policy; density is device-sensitive.
- **Splash animation performance profiling** — S01 identifies setInterval `16ms` risk on low-end iOS but no scenario measures FPS or paint timing.
- **Password field paste-from-Keychain edge case** — S33 covers autofill but not pasted-then-edited paths (user pastes a long autofilled password then adds a character).
- **Auth timeout / server 504** — S23 covers offline fetch, S19 covers 401, S20 covers 429, but no scenario for slow-but-eventually-succeeding server (7s response). This is where users double-tap Sign In.
- **"Continue with Apple" on iPad, no Face ID** — Apple ID sign-in has device fallback flows.
- **Verify email deep-link (magic-link)** — the code implies 6-digit code, but no test for tapping a verify link from Mail app.
- **Register with existing email** — the 409 friendly-message case is mentioned in S20 but has no dedicated scenario.
- **Remember-me across app reinstall** — the security concern about SecureStore is flagged (potential-kiln #4) but not tested.

**Weaknesses**:
- **Critical P1 items not marked Blocker in the severity column** — Apple Sign In stub, Google G logo violation, and iPad no-adapt are correctly flagged as P1 above, but scenario cards use UX scores 4/10 (S13) and 4/10 (S14) which reads as "borderline" not "shipping blocker". Should be scored ≤3/10 for consistency.
- Playwright scripts for S15–S18 use `CLICK checkbox` without a text or role selector — will fail with multiple checkboxes on the register form (there's Remember me + Privacy).
- S20 uses `EVALUATE for(let i=0;i<40;i++){fetch(...)}` — this is client-side test spam; in Cairn's backend, rate limits are IP-based, not per-fetch. May not reproduce.
- Verify-code UI critique (S8) says "6 independent cells" is industry standard — but Cairn's `oneTimeCode` textContentType with single input is the modern iOS-native pattern that pairs with iOS Messages autofill. Recommendation should acknowledge tradeoff.

**Strengths**:
- Only audit that identified App Store rejection risks (HIG 4.8 Apple Sign In, Google brand guidelines).
- Comprehensive 38-scenario coverage, prioritized P1–P4.
- Caught CairnLogo `marginTop: -7` alignment hack across login/register/verify views.
- Identified potential setInterval memory leak in AnimatedCairn.

---

### A3 (hiking) — coverage: 8/10

**Missed scenarios**:
- **iPhone Pro Max viewport** — S35 tests SE 375, but not 428x926. Given the stats bar has 4 items + optional route pill + Stop button, wider viewport tests matter.
- **Landscape orientation** — none of 37 scenarios test landscape. Hiking screens are often viewed in landscape when hiker uses phone as GPS.
- **Screen-locked wake / lock-screen widget** — no scenario for what shows when phone is locked mid-hike (useKeepAwake covered but not lock-screen persistence).
- **Very long hike >24h** — `formatDuration` at 25h could break the tabular-nums layout. Not tested.
- **Multi-day pause** — hike paused for 12h, resume flow.
- **Airplane mode toggle mid-hike** — offline transitions during live tracking.
- **Marker planting during hike** — Plant Cairn integration with tracking store not tested in this audit (delegated implicitly to Plant audit A5).
- **Bluetooth heart-rate sensor connect/disconnect** — Cairn may support external sensors; no scenario.
- **A11y / VoiceOver** — no scenario for accessibility labels on the Stop button, live-tracking dot pulse announcement.
- **i18n** — no Chinese/Te Reo overflow test for the Signal Lost pill or "Kia ora" contextual copy.

**Weaknesses**:
- **Rated #37 (No dark mode) as Critical (safety)** — this is defensible framing but no other auditor treated the missing dark mode consistently; A4 (running) has permanent dark mode, A11 (mapshistory) skips the topic. Cross-screen severity inconsistency.
- Playwright scripts use `browser_wait_for time=2` inconsistently with the numeric convention elsewhere ("WAIT 1500" vs "WAIT 2s").
- Score composite 7.1/10 conflates scored scenarios with unrated infrastructure items — hard to reproduce.

**Strengths**:
- Only audit that caught the Discard-without-confirm data-loss risk (S25).
- Sim-walker watermark absence (S9, S12) — data-provenance thinking that other auditors missed even where sim-walker overlaps their screen.
- Emit-consumer paired thinking on the recovery modal (S26–S28) with real proof of "0-point disk gate" working correctly.
- Excellent coverage of GPS lost / signal states.

---

### A4 (running) — coverage: 7/10

**Missed scenarios**:
- **iPhone Pro Max 430x932 explicit test missing** — only 375x667 (S10) and 320x568 (S13) covered. 320 is a legacy device outside launch target.
- **Landscape** — same as A3; running screen's lock hero at 60pt would break landscape.
- **Screen off / auto-lock disable behavior** — Running screen locks itself but no test for what happens if user's OS-level auto-lock fires.
- **Watch companion (WatchOS)** — no scenario acknowledges Watch or health-app integration.
- **HealthKit permission flow** — Running data often syncs to Apple Health; not tested.
- **Voice cues / audio milestones** — no scenario for haptic-only vs audio-cue feedback during run.
- **VoiceOver on locked screen** — the double-tap unlock gesture is inaccessible for VoiceOver users who need explore-by-touch.
- **Pace calc during GPS loss recovery** — S17 covers loss, but not "GPS lost then recovered mid-run" pace recomputation.
- **Long route name at 428x** — S32 says routeLabel may push layout but never tests at 428x with a 100-char name.

**Weaknesses**:
- **BUG-R-01 "GPS chip hard-coded" rated Critical** — same bug appears in MapScreen audit A10 (#6, rated 1/10 and 2/10) as Blocker. Cross-audit severity mismatch. It's the same code pattern — both should be same severity.
- **Rated #35 "no distance filter for far routes" as Low** — but A3 hiking audit rated the same "too far" filter behavior as UX 6/10 with more nuance (S05: user autonomy blocked). Cross-screen inconsistency.
- Playwright scripts for #12, #15, #20 use `Inject useTrackingStore.setState({...})` pseudocode — not directly executable syntax like other audits.
- BUG-R-19 "zombie session divergence" is Critical but its Playwright test only screenshots — doesn't assert the runState value.

**Strengths**:
- Caught the Plant button disabled-state visual gap (BUG-R-15) — no visible disabled indicator, a real UX bug.
- Identified the runState-vs-store.status divergence (BUG-R-19) — same class of issue as A1's zombie session count.
- Rich coverage of the double-tap unlock gesture states (#18, #19).
- BUG-R-13 caught wrong subtitle "Session saved" after discard — copy accuracy audit that others missed.

---

### A5 (plant) — coverage: 8/10

**Missed scenarios**:
- **iPhone Pro Max 428x926 partial** — S08 tests 375 vs 430, but doesn't cover 393x852 (iPhone 15) which is the modal launch device.
- **Landscape** — 3-step flow in landscape not tested; PinAdjust map + confirm CTA would clip.
- **Voice memo placeholder** — S20 correctly flags the emoji + non-functional design, but no scenario for what happens if user taps the placeholder box (does it Alert "coming soon"? Or nothing? Or expand into a disabled UI?).
- **Deep GPS deny recovery via Settings return** — S04/S05 identify no `Linking.openSettings()`, but no test for the app-lifecycle event when user returns from Settings.
- **Concurrent GPS lock + navigation away** — user starts GpsLock, backgrounds app, foregrounds — does the 5s sampler recover?
- **Mapbox tile authentication expiry** — S16 covers general tile failure, but not mid-session auth token refresh.
- **Character encoding** — title + body with emoji is not tested against the `\u001E` separator encoding (a `\u001E` in user text would break decode).
- **Draft resume UX** — draft-persistence is mentioned in S23 (offline preservation) but no scenario tests "user closes app, reopens 3 days later — does draft still exist and where does it appear?"

**Weaknesses**:
- **P1 lists permission-denied dead-end (S04/S05) at score 2-3** — correct severity, but no `Linking.openSettings()` alternative CTA in Playwright script.
- S13 (pin color mismatch) rated 5/10 — but per user's `feedback_truncate_is_bug` philosophy on visual drift, color-shift between step 2 (orange) and post-commit (red) is a data-visualization bug worth Critical.
- Playwright script S20 uses `text=Plant a Cairn` — same click text used repeatedly across scenarios; needs `testID` for reliability.
- Voice memo emoji (S20) rated 4/10 — this is a shipping issue per Settings O12 baseline principle (hide unshipped features). Should be Critical, not just P2.

**Strengths**:
- 28 scenarios covering 3-step flow deeply.
- Only audit that recognized `Linking.openSettings()` deep-link gap for permission recovery.
- Product-soul copy voice analysis — off-key notes like "Pin stays within 50 m of your GPS spot" catching "GPS jargon".
- Traced the v297/v298/v299/v420 fix history from code comments — showing the file has been battle-hardened.
- Caught the icon inconsistency between chip Mountain and pin CairnStoneIcon (S17).

---

### A6 (routes) — coverage: 9/10

**Missed scenarios**:
- **iPhone Pro Max 428x926 never resized** — S04 tests 375 for SegmentControl only. Route card at 428 with a 100-char name (S18) untested at wider viewport.
- **Landscape orientation** — 3 sub-tabs in landscape not tested.
- **Sub-tab keyboard navigation** — A11y / iPad keyboard user tabbing through segments not tested.
- **Very deep scroll performance** — S07 flags perf risk at 200 items but doesn't measure with Chrome DevTools trace.
- **Filter combinations** — filter chips + sort chips together (activity mode + recent + starred) — no combinatorial test.
- **VoiceOver on 3 sub-tabs** — SegmentControl accessibilityRole/State not verified.
- **Search-by-text** — explicitly removed in v124 (S24), but there's no test for "user has 50+ routes — how do they find one?".
- **Pull-to-refresh** — S08 identifies gap but no test for what SHOULD happen (does route store expose a refresh trigger?).
- **Multi-select / batch delete** — none of 36 scenarios test if user can delete multiple routes at once.

**Weaknesses**:
- Correctly identified `numberOfLines` gap on cardTitle (S18) as Critical per user policy — but same file has flag cards (S34) with correct `numberOfLines={1}`, so the fix pattern is already established elsewhere. Cross-reference not made.
- S12 "zombie session displays" — this is the SAME bug A1 identified in HomeScreen statsRow. Rated Critical on both; opportunity to note it's a shared bug across screens.
- S36 "dead FlagEditSheet" rated Medium — correct per O2 clean-code rule from user memory.
- Playwright master script skeleton (bottom) uses `@playwright/test` import which is the API test runner, not the Playwright MCP — inconsistent with rest of the audits.

**Strengths**:
- Only audit to run a full **Cross-cutting findings** section (CC-1 through CC-8) — this is the reference-quality format.
- Identified 4 silent state fallbacks (S33, S13, S08, CC-2) as a cumulative Critical — mature severity thinking.
- Locale-fixed date bug (S09) — an easy miss.
- Empty-state CTA inconsistency (CC-6) — cross-tab pattern audit that no other auditor did within their own screen.
- Dead code identification (S36 FlagEditSheet, ~180 lines) with citation of specific line ranges.

---

### A7 (memory) — coverage: 8/10

**Missed scenarios**:
- **iPhone Pro Max 428x926** — S22 only tests 375 iPhone SE. Panel width 236 was validated but at Pro Max width the same panel looks under-scale.
- **Landscape** — Fog map metaphor may be quite different in landscape; not tested.
- **World-view zoom-out perf at 20+ hikes** — mentioned in S8 (build_ms >500ms) but not tested with a large-scale hike seed.
- **Antimeridian bbox** — S11 flags this as a Blocker-level risk (Fiji/NZ) but no Playwright scenario reproduces it.
- **Multi-friend fog union at 5+ subscriptions** — S19 covers fog union but not stress-testing with 10 friends.
- **Fog union while zoom-in animation is running** — race between `unionTurf` completing and `mapMoved` firing.
- **RevealedCairnSheet screen reader** — S14 covers stub buttons but not VoiceOver announcements.
- **Fog corridor at International Date Line** — same class as antimeridian.
- **Very deep hierarchy** — country → region → city → suburb tap depth beyond 3 levels not tested.

**Weaknesses**:
- **S14 rated "Blocker" for unwired handlers** — but the same audit rates S23 (production hook not stripped) as Critical only. The `__cairnStores` on production build is more severe than stub button handlers (security vs cosmetic).
- **S27 report action rated Blocker (App Store 1.2)** — correct call.
- Playwright script S9 assumes `[testID="hierarchy-panel"]` selector but no test-ID inventory provided.
- Score aggregation summary shows Blocker=2 + Critical=4, but S3 is listed twice under Critical (tap target + Friends empty state) — should be split.
- S9 panel height math ("edge 20 from top on iPhone SE") not verified with Playwright.

**Strengths**:
- Excellent narrative on v333/v346/v352/v368/v445/v447 fix history — demonstrates deep code archaeology.
- Only audit to identify the Apple App Store Guideline 1.2 UGC report-flow blocker (S27).
- S11 antimeridian center-of-bbox bug — very sharp catch, geographic math thinking.
- S13 bearing arrow "doesn't account for device heading" — nuanced UX finding.
- Fog v.s. panel size analysis (S9, S22) with real math.

---

### A8 (friends) — coverage: 7/10 (partial — file truncated at FS-21)

**Missed scenarios**:
- **File is INCOMPLETE** — task brief says "21 scenarios" but the file ends abruptly at FS-21 with no Part B (MarkerDetailScreen), no Part C (MarkerPin), no Part D (MarkDetailSheet). The audit covers FriendsScreen only in section FS-01 through FS-21, plus a truncated MarkerDetail section that never rendered.
- **iPhone Pro Max 428x926** — no explicit resize tested. FS-01 hedges "verify at 320px viewport" but doesn't test the actual target 428.
- **Landscape / iPad** — not covered.
- **Long friend name at 320w** — FS-16 identifies unbounded wrap but doesn't test at 320 or 375.
- **Circle-based friend tier** — Cairn's Sprint 70 STORY-00542 paywall at >=6 friends is mentioned only in the Memory audit (S25); no scenario in Friends audit for the cap-hit → PaywallSheet.
- **Friend request from stranger with mutual friends** — social-graph edge case not covered.
- **Blocked user** — no scenario.
- **Delete-friend flow** — nowhere in the visible portion of the audit.
- **Notification permission** for incoming friend requests — not tested.
- **Deep-link "cairn://friends?add=email"** — no scenario.

**Weaknesses**:
- **Audit is INCOMPLETE — this is the biggest gap in the batch**. Sections B/C/D never delivered. Ratings that ARE present (FS-01 through FS-21) are calibrated well.
- FS-12 "self-invite guard dropped" — rated Medium, but this is a user-facing regression that would generate a confusing "server error" for a common mistake. Should be Critical.
- FS-16 "Long username unbounded wrap" — correctly identified per `feedback_truncate_is_bug` but rated Medium; the user rule says truncate/clipping = Critical minimum. Wrap into 2 lines is the same class of bug.
- Playwright scripts assume `[testID="request-accept"]` selectors that don't seem to exist in the codebase.

**Strengths**:
- FS-03 identified fire-and-forget `loadCircleMarkers()` on friend-accept as a real data-integrity risk.
- FS-18 caught the missing try/catch on `fetchFriendRequests` — silent offline empty state.
- FS-19 status dot regex-parsing "45m ago" is a fragility catch.
- FS-11 traced success-path leak carefully.
- Copy analysis quality (FS-05, FS-06) matches product soul.

---

### A9 (settings) — coverage: 8/10

**Missed scenarios**:
- **iPhone Pro Max 428x926** — A31 tests 375 only. Settings is the baseline reference — should be tested at every launch viewport.
- **Landscape orientation** — cards stack vertically; landscape layout not tested.
- **Dynamic Type accessibility** — A9 flags `helpBtn` hitSlop but not Larger Accessibility Sizes for the whole screen.
- **iPad presentation** — Settings often benefits from split-view on iPad; not tested.
- **RTL** — labelColor + chevron positioning is `flexDirection: 'row'`; RTL flip untested.
- **Sign-out during network offline** — logout API call may fail; retry / fallback not tested.
- **Password reset via forgot-password link** — Settings has Change Password but the "forgot" flow lives in AuthScreen; cross-screen link not tested.
- **Progress-cards zero state** — A8 tests badges but not "0 places explored / 0 cairns planted" first-run.
- **Feedback attach 5 photos + text 1000 chars** — mixed max state.

**Weaknesses**:
- **A25 "Delete account mailto"** flagged as App Store Guideline 5.1.1(v) risk but severity marked Medium. This is a shipping Blocker per Apple 2022+ enforcement; should be Blocker.
- C1 "Danger color inconsistency" (three reds) — correctly identified but not tied to any specific fix priority. User's O2 clean-code rule says all decisions traceable; C1 lacks a proposed single token.
- **A19 5-tap unlock** rated Medium at 6/10 — but the user memory shows this is a deliberate discoverability tradeoff (App Store safety) that shouldn't be a bug at all.
- Playwright A28 test `on web tap Sign out → accept confirm` — `page.on('dialog', ...)` handler not shown; will hang.

**Strengths**:
- **This IS the baseline audit** — the reference other audits measure against. Consistency table for other auditors depends on this file being right.
- Excellent C1–C8 cross-cutting section (danger colors, tap targets, silent success, silent link fails, indent math).
- Identified the DebugScreen visual style drift (C7) from Settings — cross-screen dev-view consistency check.
- Traced multi-shape error handling (A7) — noting real hardening effort.
- Cross-check on tap-target sizes (C2) with three specific offenders and math.

---

### A10 (mapscreen) — coverage: 9/10

**Missed scenarios**:
- **iPhone Pro Max 428x926 tested (S40)** — good. iPhone SE tested (S41). Full viewport matrix best of the batch. Missing 393x852 (iPhone 15).
- **Landscape** — not tested.
- **Marker cluster over 500+** — S4 identifies clustering absence and tests 120 markers; no perf trace with Chrome DevTools.
- **User location outside NZ** — S50 identifies region-locked fallback; no test for actual non-NZ user.
- **Route overlay from Trails** — S38 identifies feature parity gap; not fully tested.
- **Sim-walker on MapScreen** — S37 identifies inconsistency (Hiking-only) but doesn't test what a debug user expects.
- **Offline pack corruption / stale tiles** — S36 identifies no offline banner, no scenario for corrupted cache.

**Weaknesses**:
- Playwright script uses `CLICK Enable GPS` — but S7 explicitly identifies the chip has no onPress handler, so the click is a no-op. Script should assert-no-navigation instead.
- BUG severity #6 (GPS chip hardcoded amber) is rated 1/10 for consistency — but A4 rates the same bug (BUG-R-01) 3/10. Same code, different severities across screens.
- S26 "Save with no GPS fix" rated 5/10 — but this is a **data-integrity bug** (plants ghost markers at region center). Should be Blocker or Critical.
- S17 badge count 3-digit overflow — user policy `feedback_truncate_is_bug` says overflow = Critical; rated 3/10 which is roughly Critical, but explicit priority tag missing.

**Strengths**:
- Most thorough audit of the batch — 50 scenarios, tightest viewport testing, best severity thinking.
- Only audit to explicitly test iPhone 14 Pro Dynamic Island safe-area math (S5, S39).
- Identified fake affordance (S7 GPS chip inert) — textbook UX bug catch.
- Caught data-integrity bug (S26 ghost markers at region center) that would produce silent bad data.
- S32 date format bug (`toLocaleDateString()` vs relative time) — locale audit that most audits missed.

---

### A11 (mapshistory) — coverage: 8/10

**Missed scenarios**:
- **iPhone Pro Max explicitly tested (#26)** — good. 393 tested (#25). SE 375 tested (#24). Full viewport matrix — best after A10.
- **Landscape** — not tested.
- **Very old sessions >1 year** — `toLocaleDateString` fine but relative-time gap (#32) at scale not tested.
- **Sessions from another region** — regionCode filtering not tested.
- **Session with 5000+ trackpoints render perf** — polyline smoothing runs sync on JS thread (#31 mentioned).
- **Delete during upload** — race between user tap Delete and background sync.
- **Multi-select / batch operations** — no scenario.

**Weaknesses**:
- **#36 Flags-tab dead code** rated Critical — but this is a dev-only artifact, not user-facing broken. Consider Medium.
- **#41 "long session name truncation risk"** rated Critical per user policy — correct.
- **#46 Deep-link missing session** rated Critical — this is genuinely user-visible and should route to a 404 state.
- **#6 100 sessions ScrollView perf** rated Critical — correct, ScrollView antipattern vs FlatList.
- Playwright uses `LONGPRESS` directive — not standard MCP Playwright syntax; needs `browser_click` with hold.

**Strengths**:
- Only audit to identify the flags-tab dead code (#36 — state exists, render branch exists, tab-item missing).
- Consistency check against RoutesScreen ActivitiesTab — cross-file baseline check that clearly identifies the two-cards-for-same-entity pattern break.
- Product-soul framing at top ("memory replay metaphor is well realized when Mode A is entered fresh").
- Identified `useEffect(..., [])` empty deps bug (#3, #47) — real reactive bug.

---

### A12 (markerdetail) — coverage: 7/10

**Missed scenarios**:
- **iPhone Pro Max 428x926** — S27 tests. SE 375 tested (S26). 393 not explicit.
- **Landscape** — not tested.
- **RTL** — not tested.
- **Very long note >500 chars scrolling** — S18 identifies but doesn't test fold behavior.
- **Report button** — MarkerDetailScreen doesn't seem to have Report; but public markers can be reported per the friends/UGC flow. Cross-screen gap.
- **Sync badge states** — S29 flexWrap wrap issue not fully tested.
- **Snapshot divergence banner triggering** — S28 mentions but doesn't test with actual divergence data.

**Weaknesses**:
- **I-16 Critical long-title wrap in MarkerDetailScreen** — per user rule, correctly Critical.
- **I-27 "backdrop absoluteFillObject intercepts ALL taps"** — legitimate UX friction rated 8 consistency/6 UX. This should be Medium — the sheet blocks map interaction which is a real product decision.
- **I-28 "handle bar has no PanResponder"** — flagged as "dark pattern" (visual promise not honored). Rated 9/5 which is contradictory (9 consistent with dark pattern usage doesn't match). Should be Medium bug.
- Playwright S19 assertion "wraps 4+ rows, pushes body offscreen" — not measurable with `screenshot` alone; needs `evaluate` on bounding rect.
- MarkerDetailScreen font drift (24, 22, 11, 12, 10 hardcoded) — flagged Medium but no single-token proposal made.

**Strengths**:
- Cross-screen consistency table (Section 2) — clearest doc of token drift across 3 marker surfaces.
- Identified 20+ hardcoded pixel values in MarkerDetailScreen vs global Colors.
- Verdict at top ("marker detail is from another app") — sharp product framing.
- S23 offline detection gap — Save button in edit mode NOT covered by offline gate, unlike Edit/Delete outside.

---

### A12b (routeeditor) — coverage: 8/10

**Missed scenarios**:
- **iPhone Pro Max 428x926 tested (#36)** — good. SE 375 tested (#34). 393 tested (#35). Full viewport matrix.
- **Landscape** — not tested.
- **RTL** — not tested.
- **Very long name save-then-view in RoutesScreen** — scenario 6 does end-to-end but only screenshot, no bounding-rect assertion.
- **Save with typing while backend is in flight** — race not tested.
- **Waypoint UI missing** (#12–#14 explicitly N/A) — good documentation, but no scenario for "user expects waypoints because RoutesScreen shows the count".

**Weaknesses**:
- **#50 iOS BackButton bypasses discard alert** — flagged as Blocker for iOS — correct, this is a data-loss bug.
- **#52 "0 waypoints" advertised in RoutesScreen cards** — flagged as Blocker for information architecture. Correct.
- **#22 Silent discard on Back in view mode** — rated Critical for data loss. Correct.
- Playwright scripts use `[testID=route-editor-save-btn]` — inventory of test-IDs not confirmed.
- Score for #45 "Camera doesn't re-fit on late-hydrating points" rated Blocker — correct but Blocker/Critical distinction blurry.

**Strengths**:
- Deepest single-screen audit at 66 scenarios.
- Identified spec/PRD mismatch (#52) between RoutesScreen advertising waypoints and RouteEditor not supporting them — architectural finding.
- Caught the "loading state disguised as error banner" (#3) — real UX truthfulness bug.
- Copy quality analysis (#56 "raw GPS trace" is dev-speak).

---

## Cross-screen inconsistencies (auditors disagreeing)

### Save button rating drift
- **A5 (plant) S22**: Plant Cairn submit button "no spinner OR spinner would be clearer" — rated 7/10.
- **A4 (running) BUG-R-15**: Plant button disabled state has zero visual feedback — rated Critical.
- **A9 (settings) A4**: Update password button spinner replaces label silently — rated 9/10 with only "low priority" accessibility flag.
- Same class of button — three different severities. Recommend standardizing on "disabled button must have visible-disabled state (opacity ≥ 0.4 + no press feedback) AND all in-flight buttons must show a spinner + label".

### "Cannot recover from permission denied" severity mismatch
- **A5 (plant) S04/S05**: Permission denied dead-end — rated 2-3/10 Blocker.
- **A7 (memory) S5**: Location permission needed screen — rated 8/10, with only a note about deep-link to iOS Settings.
- Same underlying problem (no `Linking.openSettings()`) rated wildly differently. Memory has the correct Open Settings button; Plant does not. Cross-screen fix owner should copy Memory's implementation to Plant.

### GPS chip severity across screens
- **A4 (running) BUG-R-01**: `preStyles.gpsText` hardcoded "Enable GPS" — Critical (3/10).
- **A10 (mapscreen) S6/S7**: Same hardcoded chip pattern + inert tap — Blocker (1/10 UX).
- **A1 (home)**: Same-shaped chip not audited at all — chip is on Home too via OtaBadge floating.
- Cross-fix: standardize the chip component. Currently three renders.

### Truncation / wrap policy inconsistency
- **A1 S15** ActivityCard title no numberOfLines — rated 9/10 "trivial today".
- **A2 S11** Welcome name 56pt no fontShrink — Critical.
- **A6 S18** Route card cardTitle no numberOfLines — Critical.
- **A11 #41** Sync-state card long name — Critical.
- **A12 I-16** MarkerDetail title long — Critical.
- **A4 BUG-R-04** routePickerName — Critical.
- **A8 FS-16** friend card name — Medium.
- **A5 S28** Plant title `maxLength=30` — no rating.
- A1 and A8 are lax; the majority correctly apply the user's `feedback_truncate_is_bug` rule. Home and Friends need re-triage.

### Empty-state CTA policy
- **A6 CC-6** identifies Routes-empty vs Flags-empty vs Activities-empty inconsistency.
- **A5 S3** Plant route picker with 0 routes — rated 8/10 Low with only "no CTA to Route planning" flagged.
- **A11 #1** MapHistory empty vs RoutesScreen ActivitiesTab empty — Medium.
- **A1 S02** Home empty state — no dedicated CTA — rated 6/10 UX.
- No shared standard for empty-state CTA policy. Recommend: **all empty states must have at least one CTA back to the action that would populate them, unless the source is external (Friends' shared content)**.

### Silent-fail policy
- **A6 CC-2** identifies 3 silent fallbacks in Routes (Nearest→Recent when no GPS, no pending-sync banner, no pull-to-refresh) as cumulative Critical.
- **A9 C4** identifies `Linking.openURL(...).catch(()=>{})` swallowing — Low.
- **A3 #29/#30** Silent network error in Save flow — Medium.
- **A10 S45** Circle markers fetch fails silently — Blocker.
- **A5 S25** Server error leaks in Plant — Medium.
- No consistent framing: silent-fail is Critical when data is lost, Medium when it's a UX gap, Low when link fails. Should crystallize into a rule.

### Screen reader / VoiceOver coverage
- **A9 A3**: Password eye toggle no accessibilityLabel — Low.
- **A2 S5**: Same on Auth eye toggle — Low.
- **A6 S31**: Permission filter icon-only no accessibilityLabel — Medium.
- **A7 (memory)**: No dedicated VoiceOver scenarios.
- **A1, A3, A4, A5, A8, A10, A11, A12, A12b**: Zero VoiceOver scenarios.
- **This is the biggest coverage gap in the batch**. Cairn is targeting App Store launch; VoiceOver support is required for approval per Apple accessibility guidelines (Section 508 equivalent).

---

## Duplicated coverage (component X audited by 2+ auditors)

### OtaBadge
- **A1 (home) S11–S14**: OtaBadge floating mode — checking/downloading/ready/error states.
- **A2 (auth) S31–S32**: OtaBadge inline mode — idle/checking/downloading/ready/error.
- **A2 is more thorough on inline mode**; A1 identifies the "silent on error in floating mode" contradiction with A2's inline mode error visibility.
- **Combined verdict**: `idleHidden` prop should be added; floating mode should surface error state; inline vs floating should share animation semantics.

### GPS chip / "Enable GPS"
- **A1**: not directly rated (belongs to OtaBadge sibling).
- **A3 (hiking) #6**: Enable GPS chip non-interactive — Medium.
- **A4 (running) BUG-R-01**: hardcoded regardless of permission state — Critical.
- **A10 (mapscreen) S6/S7**: hardcoded + no onPress — Blocker.
- **A10 is most thorough** — identifies the dead onPress + dead-style declaration. Fix owner should refactor into a shared `<GpsChip>` component.

### Route picker sheet
- **A3 (hiking) S1–S5**: Route picker with 0/N/starred/far routes — detailed scenarios.
- **A4 (running) #3–#6**: Same route picker (or its sibling) — includes long-name overflow.
- **A3 is more thorough on the "too far" logic** (S05 with disabled row + no override). A4 catches the missing backdrop scrim color (BUG-R-05) that A3 missed.
- **Both should be reconciled**: are these actually the same component? A4 mentions `preStyles.routePickerName` while A3 doesn't cite similar. If shared, need one canonical audit.

### StopSummarySheet / TooShortSheet
- **A3 (hiking) #19–#26**: Full flow (open, name input, save, discard, recovery, too-short).
- **A4 (running) #23–#24**: TooShortSheet variant.
- **A3 is more thorough**; A4's #24 catches the "Session saved subtitle after discard" that A3 doesn't check.
- **Combined verdict**: Discard flow needs a confirm dialog (A3 S25 Critical) AND correct subtitle on discard (A4 BUG-R-13 Medium).

### PressBtn / TouchableOpacity animation
- **A9 (settings)** uses PressBtn with scaleTo — noted as baseline.
- **A12b (routeeditor) #54** identifies Delete/Edit/Save as raw TouchableOpacity — Medium consistency drift.
- **A5 (plant)** doesn't call this out for its Confirm button.
- **Combined verdict**: adopt PressBtn everywhere.

### FlagEditSheet / MarkerDetailSheet family
- **A6 S36** dead FlagEditSheet in RoutesScreen (180 lines).
- **A12 (markerdetail)** doesn't reference FlagEditSheet.
- Cross-screen: FlagEditSheet was moved to MarkerDetailScreen but not removed from RoutesScreen. Tech debt.

### Zombie sessions (0 distance / 0 duration)
- **A1 (home) S08** Home stats chip counts zombies but RecentRow filters them — Medium.
- **A6 (routes) S12** ActivitiesTab shows "0m · 0s" zombie sessions — Critical.
- **A11 (mapshistory)** doesn't call this out for its list.
- **A6 is more thorough** on the visible symptom; A1 identifies the disagreement in filter logic.
- **Combined verdict**: single filter (`distanceM > 0 || durationS > 0`) applied everywhere.

---

## Overall verdict

- **Best auditor**: **A10 (mapscreen)** — 50 scenarios, best viewport matrix, sharpest severity (fake affordance, ghost markers), identifies architectural issues (marker rendering paths).
- **Runner-up**: **A6 (routes)** — 36 scenarios, cross-cutting section format, dead-code identification with line refs.
- **Runner-up**: **A9 (settings)** — baseline reference quality with C1–C8 cross-cutting.
- **Weakest auditor**: **A8 (friends)** — file is INCOMPLETE (truncated at FS-21, no Part B/C/D). Ratings that ARE present are calibrated, but overall coverage 40% of task brief.
- **Second weakest**: **A1 (home)** — thorough but under-rated known-Critical bugs (S32 clip Critical vs S21 same class Medium; hardcoded colors as Low).

**Combined coverage estimate**: **7.5/10** across all screens.

### Missing critical scenarios that no auditor caught:

1. **Push notification cold-boot** — nowhere in 13 audits is there a scenario for "app launched via notification". Cairn should have push (friend requests, cairn revealed, hike sync complete) — no notification-entry UX tested.
2. **App-suspend during in-flight save** — user backgrounds during Save (hike / marker / route). Wall-timeouts identified per-screen but no cross-screen framework for "what does the user see when they come back?".
3. **Multi-account switching / logout-during-tracking** — logout mid-hike from Settings is not tested against active tracking session.
4. **Universal Link deep-link into every screen** — Cairn URLs like `cairn://marker/123` or `cairn://route/abc` not tested for any screen.
5. **VoiceOver / Screen reader flow end-to-end** — 12 of 13 auditors ignore accessibility beyond tap-target size. Apple accessibility guidelines are a shipping bar.
6. **Dynamic Type / Larger Accessibility Sizes** — none of 13 audits test scaled fonts.
7. **RTL** — none of 13 audits test right-to-left layout. Even if not in launch, structural issues will surface later.
8. **Airplane mode toggle during in-flight action** — some audits test offline, none test flip-mid-flow.
9. **Very-long-duration session (25h+)** — `formatDuration` behavior at edge not tested by any auditor.
10. **Device rotation mid-flow** — no landscape / portrait transition tested anywhere.
11. **Watch companion / HealthKit** — Running audit doesn't touch this.
12. **In-app purchase / Paywall** — Friends A25 mentions PaywallSheet at >=6 friends but no audit exercises it.
13. **User with 0 available disk space** — save-to-disk edge case for the Cairn drafts and telemetry buffer.
14. **iOS 17+ Sensitive Content warnings** for public UGC — not covered.
15. **Battery / Low-Power Mode** — hiking uses GPS + `useKeepAwake()`. Low-power mode behavior untested.

**Recommendation for next sprint**: create a shared cross-screen "audit cutting-plane" pass covering the 15 items above, run once against ALL screens rather than per-screen. This is the equivalent of Cross-cutting findings A6/A9 did but expanded.

---

XREVIEW_COMPLETE
