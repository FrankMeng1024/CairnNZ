# Lessons Learned

## Sprint 36 — 2026-05-16
- [archived: CLAUDE.md §Integration] Sprint 36: clean Sprint — QA PASS (all 3 stories HIGH confidence), 0 bugs, no integration restart loops, no Spec Drift.
- [resolved: Sprint 36] Backend rate limiter (express-rate-limit, in-memory) cleared on restart — managed by restarting backend when limit exceeded during testing. Knowledge: rate limit is NOT Redis-backed; test sessions must account for 10 req/15min window.
- [resolved: Sprint 36] Old Windows Node.js process on port 3001 (stale code) could not be killed from WSL. Workaround: new backend instance on port 3002 for live testing. Production api.ts remains at localhost:3001.
- [resolved: Sprint 36] Privacy checkbox on Sign In removed (UX friction STORY-00123). Create Account retains it.
- [resolved: Sprint 36] Error message wording "Cannot reach server" → "Unable to connect. Please try again." (STORY-00123).
- [resolved: Sprint 36] Backend error key standardised to `{error:"..."}` from `{message:"..."}`. Frontend reads both keys for backwards compatibility.
- [pending] STORY-00122 Google OAuth deferred to Sprint 37 — requires Google Cloud Console Client ID from user.
- [pending] Apple Sign In (iOS-only) — deferred until native build.

## Sprint 35 — 2026-05-16
- [archived: CLAUDE.md §Integration] Sprint 35: clean Sprint — QA PASS (STORY-00117 HIGH, STORY-00118/00119 MEDIUM confidence), UX PASS (no Blocker/Critical), no Blocker bugs, no integration restart loops.
- [pending] Backend requires MySQL installed to fully test auth endpoints. Sprint 35 verified all code artifacts and graceful degradation. Live happy-path test (register/login/JWT skip-auth) deferred until MySQL available — candidate for Sprint 36 environment setup Story.
- [pending] UX Medium: Privacy checkbox on Sign In screen adds friction for returning users — should only be required at registration. Backlog Story candidate.
- [pending] UX Low: "Explorer mode" subtitle on Create Account uninformative for first-time users — backlog polish.
- [pending] UX Low: Error message "Cannot reach server. Check your connection." implies user fault — neutral phrasing "Unable to connect. Please try again." preferred.
- [resolved: Sprint 35] Spec Drift: API_SPEC.md referenced Firebase Auth — updated to JWT auth + rate limiting docs. DONE.
- [resolved: Sprint 35] Metro bundler error: dynamic require() for expo-secure-store rejected — fixed to static import with Platform.OS guard.
- [pending] backend/node_modules was accidentally committed in Sprint 35 first commit — cleaned in follow-up commit. Add .gitignore before first npm install in future backend scaffolds.
- [pending] Sprint 34 Arch issue: `statUnit` dead code in RoutesScreen — still open, candidate cleanup.
- [pending] Sprint 34 Arch issue: GPS pill store divergence (useTrackingStore vs useAppStore) — still open.


- [archived: CLAUDE.md §Integration] Sprint 34: clean Sprint, no retrospective actions. Zero QA bugs (6/6 stories PASS, all HIGH/MEDIUM confidence), no integration restart loops, no Spec Drift, no VU NOT ACCEPTED.
- [resolved: Sprint 34] Low UX: "-- km" in HomeScreen stats bar — resolved as STORY-00113 null-state guard now shows "0 km" safely. Closed.
- [pending] Sprint 34 Arch issue: `statUnit` style in RoutesScreen StyleSheet is dead code (no JSX reference). Medium severity. Candidate for cleanup Story in Sprint 35.
- [pending] Sprint 34 Arch issue: GPS pill logic split between `useTrackingStore.status` (HikingScreen) and `useAppStore.trackingState` (MapScreen) — two stores for same UX concept, divergence risk. Medium severity. Candidate for refactor Story.
- [pending] STORY-00062: distance > 10m km-display branch still untested.
- [pending] STORY-00062: "Hike" badge variant still untested.
- [pending] Low UX: FriendsScreen sharing state resets to 4/4 on remount (in-memory store). May warrant a persistence Story in future Sprint.


- [archived: CLAUDE.md §Integration] Sprint 33: clean Sprint, no retrospective actions. Zero QA bugs (6/6 stories PASS), no integration restart loops, no Spec Drift, no VU NOT ACCEPTED.
- [resolved: Sprint 33] Low UX: "Route Preview" label overpromises — changed to "Preview" (STORY-00108 DONE).
- [resolved: Sprint 33] Low: Char counter amber window — lowered threshold from 25/30 to 22/30 for earlier warning (STORY-00107 DONE).
- [resolved: Sprint 33] Medium: RunningScreen handleStop() missing haptic — caught by Arch Code Review, fixed before Integration. haptic now fires on Stop in both HikingScreen and RunningScreen (STORY-00106 DONE).
- [pending] STORY-00062: distance > 10m km-display branch still untested. Future QA: seed session with distance > 100m.
- [pending] STORY-00062: "Hike" badge variant still untested.
- [pending] Low UX: "-- km" in HomeScreen stats bar ambiguous for first-time user — could mean zero, untracked, or error. Consider "0 km" or null-state label.
- [pending] Low UX: FriendsScreen sharing state resets to 4/4 on remount (in-memory store). May warrant a persistence Story in future Sprint.
- [pending] Low: "Max 30 characters" uses 'characters' — consistent with global English. Closed as acceptable.

## Sprint 28 — 2026-05-15
- [archived: CLAUDE.md §Integration] Sprint 28: clean Sprint, no retrospective actions. Zero QA bugs (5/5 stories PASS, 4 HIGH + 1 MEDIUM), no integration restart loops, no Spec Drift, no VU NOT ACCEPTED.
- [resolved: Sprint 28] RotateCcw icon on New Run button — already resolved in Sprint 27 as PlayCircle. Closed.
- [resolved: Sprint 28] "No GPS | km" bare unit label — km unit successfully hidden when GPS unavailable. Closed.
- [resolved: Sprint 28] Settings section headers 9px too small — increased to 11px (FontSize.small). Closed.
- [pending] STORY-00062: distance > 10m km-display branch still untested. Future QA: seed session with distance > 100m.
- [pending] STORY-00062: "Hike" badge variant still untested. Future QA: add hike session to store.
- [resolved: Sprint 29] Low: Auth form does not auto-focus email on screen entry — fixed in STORY-00087. Email now auto-focuses on Sign In mount via autoFocus prop.

## Sprint 32 — 2026-05-16
- [archived: CLAUDE.md §Integration] Sprint 32: clean Sprint, no retrospective actions. Zero QA bugs (5/5 stories PASS), no integration restart loops, no Spec Drift (STORY-00102 confirmed pre-clean), no VU NOT ACCEPTED.
- [resolved: Sprint 32] Low: Create Account Name field error on blur-without-input — STORY-00104 removes onBlur validation. Submit-only validation now. Closed.
- [resolved: Sprint 32] Medium UX: CreateMarkerSheet/FlagPlantSheet char counter had no inline explanation — STORY-00100 adds 'Max 30 chars' label. Closed.
- [resolved: Sprint 32] Medium: STORY-00082/STORY-00102 hardcoded rgba(61,122,181) in RoutesScreen — confirmed already absent. Closed.
- [pending] STORY-00062: distance > 10m km-display branch still untested. Future QA: seed session with distance > 100m.
- [pending] STORY-00062: "Hike" badge variant still untested.
- [pending] Low: Char counter amber window is 5 characters (25-29). Tight for fast typists but functional.
- [pending] Low UX: "Route Preview" label in MapHistoryScreen slightly overpromises — preview is illustrative topo rings, not GPS trace. Consider "Preview" label instead.
- [pending] Low UX: "Max 30 chars" uses 'chars' shorthand — consider 'characters' for non-native English global audience.

## Sprint 31 — 2026-05-16
- [archived: CLAUDE.md §Integration] Sprint 31: clean Sprint, no retrospective actions. Zero QA bugs (5/5 stories PASS, 4 HIGH + 1 MEDIUM), no integration restart loops, no Spec Drift (one confirmed fix — map bg hardcoded color → Colors.primaryBg token), no VU NOT ACCEPTED.
- [resolved: Sprint 31] MapScreen not wired in RootNavigator — MapScreen existed but was unreachable. Fixed by adding Map route to RootNavigator and updating HomeScreen Map button. Knowledge: new screens must be in RootNavigator AND have a Home entry point.
- [pending] STORY-00062: distance > 10m km-display branch still untested. Future QA: seed session with distance > 100m.
- [pending] STORY-00062: "Hike" badge variant still untested. Future QA: add hike session to store.
- [pending] Medium: STORY-00082 named route gradient and routeCardSelected background still contain hardcoded rgba(61,122,181,...) blue values — should be tokenized. Non-blocking.
- [pending] Low: Create Account Name field error on blur-without-input is slightly punitive. Pre-existing onBlur validation behavior.
- [pending] Low: Char counter amber window is 5 characters (25-29). Tight for fast typists but functional.
- [pending] Medium UX: CreateMarkerSheet char counter truncates input at 30 without inline explanation. First-time user may not understand why text was cut. Consider adding brief "max 30 chars" label.


- [archived: CLAUDE.md §Integration] Sprint 30: clean Sprint, no retrospective actions. Zero QA bugs (5/5 stories PASS, 4 HIGH + 1 MEDIUM), no integration restart loops, no Spec Drift, no VU NOT ACCEPTED.
- [resolved: Sprint 30] FlagPlantSheet char counter no warning state — fixed with amber at 25/30 threshold. Closed.
- [resolved: Sprint 30] Create Account Name field auto-focus — implemented via autoFocus={isRegister}. Closed.
- [pending] STORY-00062: distance > 10m km-display branch still untested. Future QA: seed session with distance > 100m.
- [pending] STORY-00062: "Hike" badge variant still untested. Future QA: add hike session to store.
- [pending] Medium: STORY-00082 named route gradient and routeCardSelected background still contain hardcoded rgba(61,122,181,...) blue values — should be tokenized. Non-blocking.
- [pending] Low: Create Account Name field error on blur-without-input is slightly punitive. Pre-existing onBlur validation behavior.
- [pending] Low: Char counter amber window is 5 characters (25-29). Tight for fast typists but functional.

## Sprint 29 — 2026-05-15
- [archived: CLAUDE.md §Integration] Sprint 29: clean Sprint, no retrospective actions. Zero QA bugs (5/5 stories PASS HIGH), no integration restart loops, no Spec Drift, no VU NOT ACCEPTED.
- [pending] FlagPlantSheet char counter: only turns red at 30/30 (hard limit). No warning as user approaches limit. Candidate: yellow/orange warning state at 25/30.
- [pending] STORY-00062: distance > 10m km-display branch still untested. Future QA: seed session with distance > 100m.
- [pending] STORY-00062: "Hike" badge variant still untested. Future QA: add hike session to store.
- [pending] Medium: STORY-00082 named route gradient and routeCardSelected background still contain hardcoded rgba(61,122,181,...) blue values — should be tokenized. Non-blocking.
- [pending] Privacy checkbox click coordinates: x=35, y=400 (absolute). Container at x=24, text starts at x=54. Note: knowledge.md updated.


- [archived: CLAUDE.md §Integration] Sprint 27: clean Sprint, no retrospective actions. Zero QA bugs (5/5 stories PASS HIGH), no integration restart loops, no Spec Drift, no VU NOT ACCEPTED.
- [resolved: Sprint 27] RotateCcw → PlayCircle on New Run button. PlayCircle confirmed.
- [resolved: Sprint 27] "No GPS | km" noisy label — km unit hidden when GPS unavailable.
- [resolved: Sprint 27] RoutesScreen orphaned (not in RootNavigator) — fixed as part of STORY-00077. New process rule: grep screen name in RootNavigator before QA.
- [resolved: Sprint 27] MapHistoryScreen placeholder persists when sessions visible — auto-select first session on mount.
- [resolved: Sprint 27] HikingScreen back button top-right (convention violation) — moved to top-left.

## Sprint 26 — 2026-05-15
- [archived: CLAUDE.md §Integration] Sprint 26: clean Sprint, no retrospective actions. Zero QA bugs (4/4 stories PASS HIGH), no integration restart loops, no Spec Drift, no VU NOT ACCEPTED.
- [resolved: Sprint 26] UX: Explorer mode subtitle shows before user has established preference — Create Account now shows "You'll start in Explorer mode. Switch anytime in Settings." at form level. Resolved.
- [resolved: Sprint 26] Session cards "No GPS" — MapHistoryScreen expanded capsule now shows "No GPS" in km stat chip. Resolved.
- [resolved: Sprint 26] Run Complete screen stats as placeholders for no-GPS — confirmed expected behavior (--/00:00 shown). Closed as by-design.
- [pending] UX: MapHistoryScreen placeholder persists when sessions visible — consider auto-selecting first route on load (Low, backlog). Pre-existing, deferred.
- [pending] STORY-00062: distance > 10m km-display branch still untested. Future QA sprint: seed a session with distance > 100m.
- [pending] STORY-00062: "Hike" badge variant still untested. Future QA: add hike session to store before test.
- [pending] UX: Lock hint in RunningScreen — verify icon rendering cross-platform (backlog Low).
- [pending] Medium: RotateCcw icon on New Run button (run complete) — semantically means "refresh/retry". Consider PlusCircle or PlayCircle in future Sprint.
- [pending] Low: "No GPS | km" in MapHistory expanded capsule — bare "km" unit label without number is noisy. Consider hiding distance chip entirely when GPS unavailable.


- [archived: CLAUDE.md §Integration] Sprint 25: clean Sprint, no retrospective actions. Zero QA bugs (4/4 stories PASS, 3 HIGH + 1 MEDIUM), no integration restart loops, no Spec Drift, no prior VU NOT ACCEPTED.
- [resolved: Sprint 25] STORY-00065 amber status dot coverage gap — MOCK_FRIENDS now includes Alex (lastSeen: '45m ago', online: false). Amber dot confirmed rendering as Colors.warning.
- [resolved: Sprint 25] Session cards "-- km" — MapHistoryScreen now shows "No GPS" label. HomeScreen strip uses duration-only format (never shows "-- km"). Both resolved.
- [pending] UX: MapHistoryScreen placeholder persists when sessions visible — consider auto-selecting first route on load (Low, backlog). Pre-existing, deferred.
- [pending] Run Complete screen stats as zeros for mock/no-GPS sessions — UX concern for first-time users with genuine tracking failures. Low priority; data-dependent behavior is correct. Consider empty-state messaging.
- [pending] STORY-00062: distance > 10m km-display branch still untested (no session with distance > 100m in test data). Future QA sprint: seed a session with distance > 100m.
- [pending] STORY-00062: "Hike" badge variant still untested. Future QA: add hike session to store before test.
- [pending] UX: Explorer mode subtitle shows before user has established preference (backlog Low).
- [pending] UX: Lock hint in RunningScreen — verify icon rendering cross-platform (backlog Low).

## Sprint 24 — 2026-05-15
- [archived: CLAUDE.md §Integration] Sprint 24: clean Sprint, no retrospective actions. Zero QA bugs (4/4 stories PASS HIGH), no integration restart loops, no Spec Drift (orphaned routeName style = acceptable dead code, Arch confirmed), no prior VU NOT ACCEPTED.
- [resolved: Sprint 25] STORY-00065 amber status dot (Colors.warning, Recent <1h) — no test data friend with activity in 0-60min window. Future QA: add a friend with lastSeen='45m ago' to MOCK_FRIENDS test data.
- [resolved: Sprint 25] UX: Session cards "-- km" when no GPS distance — ambiguous for new users. Consider "No GPS" label or omitting field (Low, backlog).
- [pending] UX: MapHistoryScreen placeholder persists when sessions visible — consider auto-selecting first route on load (Low, backlog).


- [archived: CLAUDE.md §Integration] Sprint 23: clean Sprint, no retrospective actions. Zero QA bugs, no integration restart loops, Arch flagged one non-blocking Medium spec drift (topo opacity string manipulation — deferred to future cleanup). No prior VU NOT ACCEPTED.
- [pending] STORY-00062 AC2: distance > 10m km-display branch not tested in Sprint 23 (only duration fallback). Future QA should add a session with distance > 100m to test data.
- [pending] STORY-00062 AC1: "Hike" badge variant not tested (no Hike sessions in test data). Future QA should add hike session to store data.
- [resolved: Sprint 23] Spec drift: MODE_META Navigator used hardcoded '#b47c28' and 'rgba(180,130,60,0.12)' — now uses Colors.flag and Colors.flagLight (STORY-00061 DONE).

## Sprint 22 — 2026-05-15
- [archived: CLAUDE.md §Integration] Sprint 22: clean Sprint, no retrospective actions. Zero QA bugs, no integration restart loops, no Spec Drift confirmed fixed, no prior VU NOT ACCEPTED.
- [resolved: Sprint 22] "0.0 km" stat on HomeScreen — formatDistance now returns '--' for <10m (STORY-00056 DONE)
- [resolved: Sprint 22] "+0m elev · 0 flags" zero-value noise — secondary stats row hidden when both zero (STORY-00056 DONE)
- [resolved: Sprint 22] ✓ unicode in RunningScreen checkBadge — replaced with lucide Check icon (STORY-00057 DONE)
- [resolved: Sprint 22] FriendsScreen Switch thumbColor was conditional — now always '#fff' (STORY-00057 DONE)
- [pending] UX: Explorer mode subtitle shows before user has established preference (backlog Low priority)
- [pending] UX: Lock hint in RunningScreen — verify icon rendering cross-platform (backlog Low priority)


- [archived: CLAUDE.md §Integration] Sprint 21: clean Sprint, no retrospective actions. Zero QA bugs, no integration restart loops, no Spec Drift, no prior VU NOT ACCEPTED.
- [pending] UX: "0.0 km" stat showing on HomeScreen when user has 1 session — zero-value display needs investigation (test data artifact or real bug). Filed in Sprint 22 backlog.
- [pending] UX: Explorer mode subtitle ("Explorer · 1 session") shows before user has established a preference — consider showing mode only after N sessions. Backlog Low.
- [pending] UX: Lock hint in RunningScreen shows emoji lock (🔒) in some environments instead of lucide Lock icon — verify icon rendering cross-platform.
- [resolved: Sprint 21] Auth privacy checkbox UX — checkbox and Privacy Policy link now separate TouchableOpacity targets (STORY-00051 DONE)
- [resolved: Sprint 21] FAB badge showing "1" when 0 markers — badge hidden at count=0 (STORY-00054 DONE)

## Sprint 20 — 2026-05-15
- [archived: CLAUDE.md §Integration] Sprint 20: clean Sprint, no retrospective actions. Zero QA bugs, no integration restart loops, no Spec Drift, no VU NOT ACCEPTED.
- [resolved: Sprint 21] UX: FAB badge count on Hiking screen lacks label context — fixed with badge hidden at 0 count.
- [resolved: Sprint 21] Auth flow: Privacy Policy checkbox requires coordinate-clicking the left side of the row — fixed with separate TouchableOpacity.
- [pending] UX: "+0m elev · 0 flags" shows zero-value noise on run sessions — consider hiding zero-value secondary stats when both are zero.

## Sprint 22 — 2026-06-06 (Unity AR diagnostic round)

After 4 rounds of red-team + audit cycles for Unity AR build readiness, the following issues were identified and **deferred** (not blocking the build):

### OTA-able (defer to next OTA)
- [pending] LOG-GAP-2: No breadcrumb when OS revokes camera permission mid-session. Add AppState polling in UnityAROverlay to detect permission change; emit `ar:camera-perm:revoked`.
- [pending] LOG-GAP-4: No RN-side detection of double-mount AR (e.g., ARScreen pushed twice in nav stack). Unity-side singleton guard exists at CairnBridge.cs:84-89. Add module-level mount counter in UnityAROverlay.
- [pending] F-R4-9: When ArReady received, reset `firstFrameRef.current = true` for symmetry with R3-2 remount fix.
- [pending] F-R4-11: Parser repair regex misses `+Inf`/`+Infinity` (only handles `-?Inf`). Defensive update if Unity ever produces `+Inf` literal.

### Build-required (defer to next Unity build)
- [pending] LOG-GAP-1: No breadcrumb for "AR works but rendered pixels are black" (URP misconfig, color-space drift). Sample 1px luminance from RenderTexture in CairnBridge.Update post-AR-ready.
- [pending] LOG-GAP-3: SpawnPillar doesn't log resulting world transform vs camera distance. Add `PillarPlaced` event with `{name, distFromCamera, angleFromForward}`.
- [pending] LOG-GAP-5: UnityLogger rate-limit drops `error` level when bursting. Always forward error level; only rate-limit info/warn.
- [pending] LOG-GAP-6: `OnApplicationPause(true)` not logged. Emit IForward for both pause states.
- [pending] LOG-GAP-7: Plane-fallback skipped silently if `spawner==null` or `arCamera==null` at 30s. Log gate state.

### Resolved this Sprint
- [archived: CLAUDE.md] R1: Camera gate `!USE_VIRO && !USE_UNITY_AR` (was just `!USE_VIRO`).
- [archived: CLAUDE.md] R1: Parser regex repair for IL2CPP `F\d+`/`NaN`/`Inf` literals.
- [archived: CLAUDE.md] R1: 5 IL2CPP `{N:fmt}}}` bugs in CairnBridge.cs replaced with manual concat.
- [archived: CLAUDE.md] R1: SendArFrame gated on ARSession.state>=SessionInitializing.
- [archived: CLAUDE.md] R1: Podfile anchor exact-match (line 126).
- [archived: CLAUDE.md] R1: CI Unity 6000.0.36f1 → 6000.0.76f1.
- [archived: CLAUDE.md] R1: EscapeJson helper for catch blocks (handles \, ", \n, \r, \t).
- [archived: CLAUDE.md] R1: OnApplicationPause(false) re-baselines _startTime.
- [archived: CLAUDE.md] R1: resetParseRecoveredThrottle on UnityAROverlay mount.
- [archived: CLAUDE.md] R2-3: XRDiag/ARBgDiag emission deferred from Start() to Update frame 6 (registerAPIforNativeCalls race).
- [archived: CLAUDE.md] R2: ARStateStall watchdog at 10s with activeLoaders info.
- [archived: CLAUDE.md] R3-2: OnEnable resets all one-shot flags + _startTime for AR screen remount.
- [archived: CLAUDE.md] R4-7: _firstFrameLogged also reset in OnEnable for symmetry.
