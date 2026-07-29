# RunningScreen — UX/UI Audit

**Auditor**: #4 (RunningScreen)
**Date**: 2026-07-28
**Source**: `app/src/screens/RunningScreen.tsx` (Sprint 18 premium lock screen, v128b MapView key remount)
**Baseline**: `app/src/screens/SettingsScreen.tsx` (O12 MVP redesign, 2026-07-27)
**Tokens**: `app/src/components/tokens.ts`
**Nav route**: `Running` (RootNavigator stack)
**Web launch URL (Playwright)**: `http://localhost:8081/` → tap Home → tap Running (or navigate via `window.__cairnStores`-style hook if wired). Real device: EAS build only for Mapbox map. Web run mode = fallback placeholder "Real Map (EAS Build)".

Legend: **Score = /10** (5 = MVP acceptable, 8 = shippable NZ launch, 9.5 = VU ACCEPTED). Each scenario has a **Playwright script** — steps assume Playwright MCP `browser_navigate` + `browser_click` + `browser_take_screenshot`. Screenshots saved to `docs/ux/sprint-audit-2026-07-28-evidence/running-NN-<slug>.png` (naming enforced by MCP Tool Protocol §Screenshot path enforcement).

---

## Scenario Matrix (35 scenarios)

### A. Pre-run / Idle

#### 1. Idle · Free Run default state (no route selected)
- **Score**: 7/10
- **Why**: On mount `selectedRoute=null`, `selectedRouteName` falls to "Free Run" (line 201). Map animates from globe → user (v127 flyTo). Route pill shows Target icon + "Free Run" + subtitle "Tap to change route". Start button always enabled — no guard for `foregroundGranted=false` (line 526 `handleStart` fires whether GPS permission was granted or not). Slight concern: GPS chip top-right always says "Enable GPS" even when foreground already granted (line 500-502 hard-codes text + severityWarning color).
- **Bugs**:
  - **BUG-R-01 (Critical)**: `preStyles.gpsText` hard-coded to `"Enable GPS"` with warning styling regardless of `foregroundGranted` — misleading affordance. Should reflect `locationAvailable`/`foregroundGranted`.
- **Playwright**:
  ```
  1. browser_navigate http://localhost:8081/
  2. browser_click <Home → Running tile>
  3. browser_wait_for text="Start Running" time=2
  4. browser_take_screenshot filename=docs/ux/…/running-01-idle-freerun.png
  5. browser_snapshot   // capture aria tree — confirm "Free Run" pill visible
  ```

#### 2. Idle · Route selected (persisted from prior session)
- **Score**: 6/10
- **Why**: Once user picks a saved route, `selectedRoute` state holds the id; `selectedRouteName` resolves via `routes.find` (line 201). But **state is component-local and NOT persisted** — leaving Running (navigate back to Home, come back) resets to `null` because state initializer `useState<string | null>(null)`. No hydration from `useRouteStore`.
- **Bugs**:
  - **BUG-R-02 (Medium)**: selectedRoute not persisted across navigation. User must reselect every time.
- **Playwright**:
  ```
  1. Enter Running, open picker, pick a saved route
  2. browser_click BackButton
  3. Re-enter Running
  4. browser_take_screenshot filename=…/running-02-route-not-persisted.png
  ```

#### 3. Pre-run · Route picker sheet (0 routes)
- **Score**: 8/10
- **Why**: If `routes.length === 0`, sheet still renders "Free Run" row with Target badge. No empty-state hint like "You have no saved routes yet — go plan one first". Acceptable but bare.
- **Bugs**:
  - **BUG-R-03 (Low)**: Empty-routes state has no CTA to Route planning screen.
- **Playwright**:
  ```
  1. Ensure useRouteStore has [] (clear via web hook)
  2. Enter Running → tap route pill
  3. browser_take_screenshot filename=…/running-03-picker-empty.png
  ```

#### 4. Pre-run · Route picker sheet (N routes, mixed)
- **Score**: 8/10
- **Why**: `routes.map(r=>...)` renders each with badge, name, meta line `distance · ↑elevation · ×runCount done`. Metadata format is dense but readable. ScrollView `maxHeight: 280` — with 6+ routes this scrolls. Selected row highlighted with `runningCardBg` + left border `Colors.running`. Hit target for row is full-width + padding.md.
- **Bugs**: none critical.
- **Playwright**:
  ```
  1. Seed 5 fake routes via useRouteStore.setState
  2. Enter Running → tap route pill
  3. browser_take_screenshot filename=…/running-04-picker-5routes.png
  4. Scroll picker, screenshot again
  ```

#### 5. Pre-run · Route picker sheet (long route name)
- **Score**: 5/10
- **Why**: `routePickerName` uses `Text` without `numberOfLines`. A 60-char route title will wrap to 2-3 lines and blow up the row height, breaking the fixed maxHeight=280 assumption. Compare route pill (line 515) which correctly sets `numberOfLines={1}`.
- **Bugs**:
  - **BUG-R-04 (Critical)**: `preStyles.routePickerName` missing `numberOfLines={1}` → overflow. Aligns with user's rule "Truncate/clipping = bug" only if we adopt truncation; alternative is to wrap gracefully with row auto-height, but then icon vertical-align breaks.
- **Playwright**:
  ```
  1. Seed 1 route with 80-char name
  2. Enter Running → tap route pill
  3. browser_take_screenshot filename=…/running-05-picker-long-name.png
  ```

#### 6. Pre-run · Route picker sheet backdrop tap dismiss
- **Score**: 9/10
- **Why**: `preStyles.routePickerBackdrop` uses `StyleSheet.absoluteFillObject` + `TouchableOpacity` calling `closeRoutePicker` (line 551). Backdrop opacity animates. But backdrop **has no visible scrim color** — `routePickerBackdrop` style has no `backgroundColor` prop → transparent. On the map background, the sheet floats without a darkening layer. Compare TooShortSheet's `rgba(0,0,0,0.55)` scrim — inconsistent.
- **Bugs**:
  - **BUG-R-05 (Medium)**: routePickerBackdrop has no background color → no visual "modal" feel. Route picker floats on live map.
- **Playwright**:
  ```
  1. Open picker
  2. browser_take_screenshot filename=…/running-06-picker-backdrop.png
  3. browser_click backdrop area (top of screen)
  4. Verify picker slides down
  ```

#### 7. Pre-run · Start button press
- **Score**: 9/10
- **Why**: `onPressIn` → spring scale 0.96, `onPressOut` → back to 1. Gradient primary→primaryDark. Haptic medium (`handleStart` line 297). Solid affordance.
- **Bugs**: none.
- **Playwright**:
  ```
  1. Enter Running
  2. browser_hover Start button
  3. browser_click Start button (long press if possible to capture press-in scale)
  4. browser_take_screenshot filename=…/running-07-start-press.png
  ```

#### 8. Pre-run · "Screen locks automatically" hint copy
- **Score**: 8/10
- **Why**: Row below Start button: Lock icon + "Screen locks automatically" caption. Sets user expectation. But **hint is only shown on pre-start** — after starting there is no "screen has locked" transition confirmation; the lock UI simply appears. Ambiguity: does it lock 1s in? Immediately? (Actual: `setIsLocked(true)` right after startTracking, line 301, so instantly.)
- **Bugs**:
  - **BUG-R-06 (Low)**: Hint copy claims "automatically" but transition to locked state is instant, not delayed. Copy could read "Screen locks when you start" for accuracy.
- **Playwright**:
  ```
  1. Enter Running
  2. browser_take_screenshot filename=…/running-08-locks-auto-hint.png
  ```

#### 9. Pre-run · Real Map placeholder (web / non-EAS)
- **Score**: 7/10
- **Why**: When `MapView === null` (web Playwright), fallback shows Map icon 48px + "Real Map (EAS Build)" h3 + "Build with EAS to enable live tracking map" body. Copy is accurate for dev users but a paying customer opening on web will see the same. Playwright can capture this reliably.
- **Bugs**:
  - **BUG-R-07 (Medium)**: If Cairn is ever shipped as PWA/web, this copy shows to end users. Should read "Available on the app" or similar user-facing string.
- **Playwright**:
  ```
  1. browser_navigate http://localhost:8081/#/running   (or via nav)
  2. browser_take_screenshot filename=…/running-09-map-fallback.png
  ```

#### 10. Pre-run · Small screen 375 (iPhone SE)
- **Score**: 7/10
- **Why**: `bottomPanel` gap Spacing.sm + startBtn height 60 + lockHintRow. On 375×667, the map takes ~500px, bottom panel ~150px, top overlay ~60px. Comfortable. But start button `flex:1` in a `bottomRow` — no min/max width. On very tall/narrow (iPhone 5s legacy 320), untested but likely fine.
- **Bugs**: none.
- **Playwright**:
  ```
  1. browser_resize 375 667
  2. Enter Running
  3. browser_take_screenshot filename=…/running-10-small-375.png
  ```

---

### B. Running — locked

#### 11. Running · Locked initial UI (0 elapsed, 0 distance)
- **Score**: 6/10
- **Why**: After `handleStart`, `runState='running'`, `isLocked=true`. Lock screen renders `durationDisplay="00:00"` (formatDuration), `distDisplay="--"` (until locationAvailable && distanceM>=10), paceDisplay="--". Design intent: hero elapsed at 60pt light. But **`distDisplay` reads "--" for the first ~10m of running while GPS is warming up** — user sees empty ruler. Fine, but the `lockSecondary` row shows `"-- km"` `"-- min/km"` — sparse, could show a "GPS acquiring…" hint instead.
- **Bugs**:
  - **BUG-R-08 (Medium)**: No "GPS acquiring" state feedback. Both dash outputs coexist without differentiating "not yet moving" from "no GPS".
- **Playwright**:
  ```
  1. Enter Running, tap Start
  2. Immediately browser_take_screenshot filename=…/running-11-locked-t0.png
  ```

#### 12. Running · Locked with real tracking data (3 stats populated)
- **Score**: 8/10
- **Why**: Elapsed hero 60pt is beautiful, tabular-nums `fontVariant` ensures digits don't jitter. `lockPrimary` letterSpacing -2 + lineHeight 68 — reads clearly. Divider between distance and pace in `lockSecondary`. GPS pulsing dot 14×14 pulses 0.8→1.2 loop.
- **Bugs**: none.
- **Playwright**:
  ```
  1. Enter Running, Start
  2. Inject useTrackingStore.setState({ durationS: 782, distanceM: 2340, locationAvailable: true, lastCoordinate: {...} })
  3. browser_take_screenshot filename=…/running-12-locked-real.png
  ```

#### 13. Running · lockSecondary bar unit label
- **Score**: 4/10
- **Why**: Line 650: pace label is hard-coded to `min/{dist.unit}`. If `dist.unit === 'km'` → "min/km" ✓. If imperial → `dist.unit === 'mi'` → "min/mi" ✓. **But**: the distance next to it displays `{distDisplay} {dist.unit}` — so on imperial, it says e.g. "1.24 mi" + "8'32\" min/mi" which is consistent. Not a bug per se. However, "min/km" as a suffix inside the pace stat is redundant with `paceDisplay` which is `"5'12\""` — visually the unit is shown as tiny caption. **Real issue**: on very small screens or long values, `lockSecondary` `flexDirection: 'row'` + `gap: Spacing.lg` has no `flexWrap` — a long distance ("12.34") pushes the divider and pace off-screen without scaling. No numberOfLines. Overflow could clip on 320-width devices.
- **Bugs**:
  - **BUG-R-09 (Medium)**: `runStyles.lockSecondary` no flex-wrap or shrink; long values on narrow width could push offscreen.
- **Playwright**:
  ```
  1. Locked state
  2. Inject distanceM=45623, durationS=14400 (huge run)
  3. browser_resize 320 568
  4. browser_take_screenshot filename=…/running-13-locksec-overflow.png
  ```

#### 14. Running · Pace calc edge case: distance < 10m
- **Score**: 9/10
- **Why**: Line 358: `if (!locationAvailable || distanceM < 10) return '--'`. Prevents nonsense pace like "999'59\"" at the very start. Good.
- **Bugs**: none.
- **Playwright**:
  ```
  1. Locked, inject distanceM=5 durationS=10 locationAvailable=true
  2. Screenshot — pace should be "--"
  3. filename=…/running-14-pace-edge-lt10.png
  ```

#### 15. Running · Imperial units (min/mi)
- **Score**: 9/10
- **Why**: Line 360: `secPerUnit = durationS / (distanceM / 1609.344)` when `dist.imperial`. Correct math. Formatting `${paceMin}'${paceSec}"` mirrors metric. `dist.unit` becomes `"mi"` and pace unit label `"min/mi"`. Symmetric.
- **Bugs**: none.
- **Playwright**:
  ```
  1. Set useSettingsStore.setState({ units: 'imperial' })
  2. Locked with data
  3. filename=…/running-15-imperial.png
  ```

#### 16. Running · Long duration (hh:mm:ss transition)
- **Score**: depends on `formatDuration` impl. Assumed to switch to `H:MM:SS` at ≥1h. `lockPrimary` fontSize 60 will handle 6-8 char strings ("1:23:45") on 375+ but on iPhone SE could touch edges. `letterSpacing: -2` tightens it.
- **Score**: 7/10
- **Bugs**:
  - **BUG-R-10 (Low)**: 60pt hero with long H:MM:SS may push adjacent edges. Verify at 3+ hour run.
- **Playwright**:
  ```
  1. Inject durationS=12345 (3:25:45)
  2. browser_resize 375 667
  3. filename=…/running-16-long-duration.png
  ```

#### 17. Running · GPS lost mid-run
- **Score**: 6/10
- **Why**: `locationAvailable=false` → `distDisplay="--"`, `paceDisplay="--"`, PulsingDot backgroundColor becomes `Colors.textMuted` (grey). But **`durationDisplay` keeps ticking** (durationS increments regardless of GPS), which is correct behavior — session doesn't pause on GPS loss. However, no explicit "GPS lost" banner. User staring at frozen distance won't know if it's GPS or truly not moving. Elsewhere: `runStyles.statsBar` PulseDot shows "Offline" label when `!locationAvailable` (line 623) — this is only visible when unlocked (statsBar is always visible but on locked screen the stats bar shows above lock hero, so it's visible; check layout).
- Wait — statsBar is inside SafeAreaView at top and always renders regardless of `isLocked`. So "Offline" text IS visible in locked mode too. Good.
- **Bugs**:
  - **BUG-R-11 (Medium)**: "Offline" wording weak. Should be "No GPS" or "GPS Signal Lost" — "Offline" implies network.
- **Playwright**:
  ```
  1. Locked with data, then inject locationAvailable=false
  2. filename=…/running-17-gps-lost.png
  ```

#### 18. Running · Locked · double-tap unlock
- **Score**: 8/10
- **Why**: `handleScreenTap` counts taps within 500ms window (line 292). `tapDots` shows two dots — first tap fills dot 0 with primary. 2nd tap unlocks + haptic notification success. Clean gesture. **Concern**: `tapDots` render `i < tapCount && tapDotActive`. After 1st tap, tapCount=1, so dot 0 gets active. On 2nd tap tapCount becomes 2 but immediately reset to 0 (line 288), so both dots flash active for one render then all cleared before unlock animation runs. Might feel confusing; user's eye barely catches dot fill.
- **Bugs**:
  - **BUG-R-12 (Low)**: `tapDot` active state disappears too fast on 2nd tap. Consider persisting for 200ms after success before fading.
- **Playwright**:
  ```
  1. Locked
  2. browser_click center of screen
  3. filename=…/running-18a-tap1.png  (1 dot filled)
  4. browser_click again (within 500ms)
  5. filename=…/running-18b-unlocked.png
  ```

#### 19. Running · Locked · single tap timeout
- **Score**: 9/10
- **Why**: `setTimeout(500ms)` resets `tapCount` to 0 if no second tap. `haptic.impact('light')` fires on single tap. So a stray tap during a run gives one light haptic + one filled dot, then decays silently. Correct.
- **Bugs**: none.
- **Playwright**:
  ```
  1. Locked
  2. Single tap
  3. Wait 600ms
  4. filename=…/running-19-tap-timeout.png (both dots empty)
  ```

---

### C. Running — unlocked (controls exposed)

#### 20. Running · Unlocked · controls fade-in
- **Score**: 8/10
- **Why**: `controlsFade` animates opacity 0→1 in 200ms. Buttons appear at bottom: Stop (flex 2, danger red), Plant (flex 1.4, running blue), Lock (flex 1, subtle border). Clear priority via flex ratios and color. `pointerEvents={isLocked ? 'none' : 'box-none'}` prevents taps bleeding through.
- **Bugs**: none.
- **Playwright**:
  ```
  1. Running, unlock via double-tap
  2. filename=…/running-20-unlocked-controls.png
  ```

#### 21. Running · Unlocked · Stop button (normal duration)
- **Score**: 8/10
- **Why**: `handleStop` calls `stopTracking()`, checks `status!=='idle'`, then transitions to `stopped`. TooShortSheet path handled separately (see #23).
- **Bugs**: none in the normal path.
- **Playwright**:
  ```
  1. Unlocked with 5min duration + 500m distance
  2. Click Stop
  3. filename=…/running-21-stop-normal.png (StopSummarySheet or stopped screen)
  ```

#### 22. Running · Unlocked · Relock button
- **Score**: 9/10
- **Why**: `relockBtn` uses subtle transparent border, calls `setIsLocked(true)`. Instant, animates controls out via `controlsFade` toValue 0.
- **Bugs**: none.
- **Playwright**:
  ```
  1. Unlocked
  2. Click Lock button (right side)
  3. filename=…/running-22-relock.png
  ```

#### 23. Running · Stop with < 2 points (too-short)
- **Score**: 8/10
- **Why**: `stopTracking` pre-check at store level sets `lastStopReason='too-short'` and preserves session. `TooShortSheet` (line 705) renders `visible={lastStopReason === 'too-short'}`. Two CTAs: "Got it — keep going" (dismiss, tracking continues), "End anyway" (calls `discardCurrentSession` + `setRunState('stopped')`). Solid recovery flow.
- **Bugs**: none.
- **Playwright**:
  ```
  1. Inject status='tracking', trackPoints=[], distanceM=3
  2. Click Stop
  3. filename=…/running-23-tooshort.png (sheet visible)
  ```

#### 24. Running · Discard from TooShortSheet
- **Score**: 8/10
- **Why**: "End anyway" → `discardCurrentSession()` (full teardown) + `setRunState('stopped')` → user lands on stopped view with `distanceM=0`, `durationS=0` → summaryCard shows `0.00 km`, `00:00`, `--`. Consistent state.
- **Bugs**:
  - **BUG-R-13 (Medium)**: After discard, stopped view still says "Session saved" subtitle (line 386, hard-coded). Should say "Run discarded" when reason was too-short discard.
- **Playwright**:
  ```
  1. Trigger too-short sheet
  2. Click "End anyway"
  3. filename=…/running-24-discarded.png (should show something like "Run discarded" — but currently says "Session saved")
  ```

#### 25. Running · Plant Cairn button (locationAvailable=true)
- **Score**: 7/10
- **Why**: `handlePlantCairn` fires heavy haptic + creates marker via `addMarker` with `type:'cairn'`, `permission:'personal'`, `sessionId`. Sets plantToast "Cairn planted" for 1500ms. Deliberately low-friction — no note, no type selection (per route-rules.md §7.3 comment).
- **Bugs**:
  - **BUG-R-14 (Medium)**: Toast rendered inside `unlockedRow` SafeAreaView but `plantToast` style is `alignSelf: 'center'` — should render above the button row visually. Currently sits below them (line 692 renders after `unlockedRow` closes). May clip below safe area.
- **Playwright**:
  ```
  1. Unlocked with lastCoordinate set
  2. Click Plant button
  3. filename=…/running-25-plant-toast.png (within 1500ms)
  ```

#### 26. Running · Plant Cairn button (locationAvailable=false, disabled)
- **Score**: 7/10
- **Why**: `disabled={!locationAvailable}` (line 679) but there's no visual disabled state — TouchableOpacity's default is minimal opacity change on disabled. The `plantBtn` gradient/color stays same. User taps and nothing happens with no feedback.
- **Bugs**:
  - **BUG-R-15 (Critical)**: Disabled Plant button has zero visual feedback for disabled state. Add `opacity: 0.5` when `disabled` or hide the button entirely.
- **Playwright**:
  ```
  1. Unlocked, inject locationAvailable=false
  2. Click Plant
  3. filename=…/running-26-plant-disabled.png
  ```

#### 27. Running · Plant Cairn addMarker error
- **Score**: 6/10
- **Why**: `try/catch` around `addMarker` (line 331-347). Catch sets `plantToast: 'Failed to plant cairn'` for 2000ms. Recovery is soft — but the error is silent otherwise, no crashLogger, no retry option. Also `lastCoordinate` null → early return line 323 with warning haptic only, no toast — user gets zero feedback that press was received but failed.
- **Bugs**:
  - **BUG-R-16 (Medium)**: When `lastCoordinate=null`, only warning haptic — no toast. User might tap Plant repeatedly not knowing why nothing happens.
- **Playwright**:
  ```
  1. Unlocked, lastCoordinate=null but locationAvailable=true (edge race)
  2. Click Plant
  3. filename=…/running-27-plant-no-coord.png
  ```

---

### D. Stopped / Save flow

#### 28. Stopped · Summary card 3-stat
- **Score**: 8/10
- **Why**: Summary card centered with distance, elapsed, pace + dividers. h2 800-weight numeric. `CircleCheck` icon 56px in primary. Nice hero moment. `subtitle: 'Session saved'` reinforces success.
- **Bugs**:
  - see BUG-R-13 (wrong subtitle after discard).
- **Playwright**:
  ```
  1. Reach stopped state via handleStop
  2. filename=…/running-28-summary.png
  ```

#### 29. Stopped · "New Run" CTA loop
- **Score**: 9/10
- **Why**: New Run gradient button → `setRunState('pre')` returns to pre-run map. State cleanly resets except `selectedRoute` persists in local state (see #2).
- **Bugs**: none new.
- **Playwright**:
  ```
  1. Stopped screen
  2. Click New Run
  3. filename=…/running-29-newrun-loop.png
  ```

#### 30. Stopped · Back button behavior
- **Score**: 7/10
- **Why**: `BackButton variant="inline"` calls `nav.canGoBack() ? nav.goBack() : nav.navigate('Home')`. Reasonable. But **session summary is discarded on back** — no confirmation, no "Save & continue vs Discard" prompt. If user accidentally taps back after a real 10km run and hasn't saved further, no recovery.
- **Bugs**:
  - **BUG-R-17 (Medium)**: No back-tap confirmation on stopped screen with real session. Compare hiking StopSummarySheet which requires explicit dismiss.
- **Playwright**:
  ```
  1. Stopped after real run
  2. Click back
  3. filename=…/running-30-back-noconfirm.png (returns to Home instantly)
  ```

---

### E. Cross-cutting / edge

#### 31. Dark mode
- **Score**: N/A (no dark mode support)
- **Why**: `runStyles.container` uses `Colors.runningBg = '#0a1a0a'` — already a permanent dark screen for the running mode. No system dark-mode toggle exists (tokens.ts comment: "experimental dark mode never landed"). Pre-run and Stopped views use `Colors.bg='#faf7f2'` cream in both light/dark.
- **Bugs**: none — this is by design.
- **Playwright**: skip.

#### 32. Overflow · Long route name in `activeRouteName` label
- **Score**: 5/10
- **Why**: Line 635: `<Text style={runStyles.routeLabel}>{activeRouteName}</Text>` inside compassArea. No numberOfLines, but `routeLabel` has `paddingHorizontal: Spacing.xl` and `textAlign: 'center'` — wraps naturally. Wrapping into 3-4 lines could push compass content downward.
- **Bugs**:
  - **BUG-R-18 (Medium)**: `runStyles.routeLabel` missing `numberOfLines={2}` — long route name could push layout.
- **Playwright**:
  ```
  1. Pick a 100-char route, Start
  2. Locked/unlocked either
  3. filename=…/running-32-longroute-label.png
  ```

#### 33. Zombie session (status='tracking' but sessionId stale)
- **Score**: 6/10
- **Why**: RunningScreen doesn't defensively detect this. If a prior Running/Hiking session is left `status='tracking'` in the store and user opens RunningScreen fresh, `runState` starts as `'pre'` (component-local state), so user sees pre-start view while `useTrackingStore.status === 'tracking'`. Tapping Start again calls `startTracking()` — depending on store's idempotency, this could reset a real session.
- **Bugs**:
  - **BUG-R-19 (Critical)**: Component-local `runState` diverges from store `status`. Entering RunningScreen while a session is in-flight should auto-jump to `runState='running'`, not pre-start. Verify against HikingScreen pattern.
- **Playwright**:
  ```
  1. Inject useTrackingStore.setState({ status:'tracking', durationS:120, distanceM:400 })
  2. browser_navigate to Running
  3. filename=…/running-33-zombie.png (should show running UI, actually shows pre-start)
  ```

#### 34. Map fly-in animation on 2nd entry
- **Score**: 6/10
- **Why**: Extensive v122–v128 commentary in code shows this was a running battle. Current solution: `mapEpoch` bumps every focus (`useFocusEffect`), forcing MapView remount. `gesturesEnabled` false for 700ms after mount. Should replay globe→user fly-in every entry. But telemetry needed to confirm on real EAS build (RunningScreen is stack-cached).
- **Bugs**:
  - **BUG-R-20 (Medium)**: Map full remount on every focus is expensive (Mapbox init >200ms). Consider one-time flyIn + fast reposition afterwards. But current UX-driven decision documented; ship as-is.
- **Playwright**:
  ```
  1. Enter Running, wait 3s, back
  2. Enter Running again
  3. filename=…/running-34-map-2ndentry.png (visualize animation midpoint via 2 sequential shots at t=200ms, t=500ms)
  ```

#### 35. Route pre-run disabled (too far, > 25km)
- **Score**: N/A
- **Why**: RunningScreen has NO distance-from-user route filter. All routes render regardless of proximity. Contrast: hiking may filter. This is a gap.
- **Bugs**:
  - **BUG-R-21 (Low)**: No filter/warning if selected route origin is far from user's GPS. User could pick a Wellington route in Auckland and start "Free Run" not knowing.
- **Playwright**:
  ```
  1. Seed route with startLat far from current position
  2. Enter Running, open picker
  3. filename=…/running-35-farroute.png (no warning shown)
  ```

---

## Summary — bug rollup

| ID | Priority | Area | One-liner |
|---|---|---|---|
| BUG-R-01 | Critical | Pre-run | GPS chip hard-coded "Enable GPS" regardless of permission state |
| BUG-R-02 | Medium | Pre-run | selectedRoute not persisted across navigation |
| BUG-R-03 | Low | Picker | Empty-routes state has no CTA to Route planning |
| BUG-R-04 | Critical | Picker | routePickerName missing numberOfLines → overflow |
| BUG-R-05 | Medium | Picker | routePickerBackdrop has no scrim color |
| BUG-R-06 | Low | Pre-run | "Screen locks automatically" copy inaccurate |
| BUG-R-07 | Medium | Web | Map fallback copy leaks EAS jargon to end users |
| BUG-R-08 | Medium | Locked | No "GPS acquiring" state differentiation |
| BUG-R-09 | Medium | Locked | lockSecondary no flex-wrap → overflow on 320w |
| BUG-R-10 | Low | Locked | 60pt hero may edge-clip on iPhone SE with 3h duration |
| BUG-R-11 | Medium | Locked | "Offline" wording ambiguous for GPS loss |
| BUG-R-12 | Low | Locked | tapDots active state disappears too fast |
| BUG-R-13 | Medium | Stopped | Subtitle "Session saved" wrong after too-short discard |
| BUG-R-14 | Medium | Unlocked | plantToast layout below buttons; may clip in safe area |
| BUG-R-15 | Critical | Unlocked | Plant button disabled state has no visual feedback |
| BUG-R-16 | Medium | Unlocked | Plant with no coord shows only haptic, no toast |
| BUG-R-17 | Medium | Stopped | Back button doesn't confirm on real session |
| BUG-R-18 | Medium | Locked | routeLabel missing numberOfLines |
| BUG-R-19 | Critical | Zombie | runState local diverges from store.status |
| BUG-R-20 | Medium | Map | Full MapView remount on every focus is expensive |
| BUG-R-21 | Low | Picker | No distance-from-user filter/warning |

**Blockers**: 0 (all criticals have workarounds but user-visible).
**Score aggregate**: mean 7.2/10 — shippable-ish, but BUG-R-01 (misleading GPS chip), BUG-R-15 (disabled Plant), BUG-R-19 (zombie divergence) should be resolved before NZ launch.

---

## Playwright test data prerequisites

To fully execute all 35 scripts on the web build (`http://localhost:8081/`):
- Access to `window.__cairnStores` (v406 web test hook — see project memory `project_v406_web_test_hook.md`). Confirm hook exists for `useTrackingStore`, `useRouteStore`, `useSettingsStore` before Phase 2.
- Route seed helper (`useRouteStore.getState().setRoutes([...])`).
- No live Mapbox on web → all "map screenshots" will show the fallback placeholder. Real map screenshots must come from EAS build via device screen mirror.
- Feed rate: 8s max between shots to allow animations.

---

## Handoff notes for Playwright agent (Phase 2)

1. Save all screenshots to `docs/ux/sprint-audit-2026-07-28-evidence/` per MCP Tool Protocol §Screenshot path enforcement.
2. Use `filename` param on every `browser_take_screenshot` call — no exceptions.
3. For state-injection scripts, use `browser_evaluate` with the `window.__cairnStores` hook.
4. For any locked-view screenshot, first confirm `runState === 'running' && isLocked === true` via `browser_snapshot` aria capture (look for "Double-tap to unlock" text).
5. Report to Phase 3 QA agent: any scenario where a screenshot came back with the wrong `runState` (e.g. scenario 33 zombie should have caught the divergence).
