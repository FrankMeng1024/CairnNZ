# UX Audit — HikingScreen + StopSummarySheet + UnfinishedRecoveryModal

**Auditor**: #3 (Hiking flow)
**Date**: 2026-07-28
**Scope**: `src/screens/HikingScreen.tsx`, `src/screens/StopSummarySheet.tsx`, `src/components/UnfinishedRecoveryModal.tsx`, dependent map + sim-walker layer.
**Baseline**: SettingsScreen O12-O16 pattern (token-consistent, layered scrim, single-source `useDistance`, animation via `Animated.spring` with 0.95 scale).

## Scoring rubric (0-10 per scenario)
- 10 = matches SettingsScreen quality bar. No visible bug, no clarity gap, tokens correct, animation smooth, error state has copy.
- 8-9 = minor polish gap (unlabelled state, wording, missing empty copy).
- 6-7 = usable but clarity/consistency issue (magic numbers user-visible, race, weak error copy).
- 4-5 = user can hit confusing state without instructions.
- 0-3 = blocker / broken / data loss risk.

**Composite score for this surface: 7.1 / 10.** Above baseline for the happy path, but a cluster of edge cases (empty route picker, sim-walker + real-GPS mixed state visibility, discard-vs-save race, "too far" without a why) drag it below Settings-tier polish.

---

## 33 scenarios

### IDLE PHASE

#### 1. Idle, no route selected, first entry — 8/10
`selectedRouteName === 'Free Hiking'` shown, "Enable GPS" chip amber. Copy is clean; the pill hint `Tap to change route` reads well. **Gap**: no explanation of what "Free Hiking" means vs a saved route on first view.

```
NAVIGATE http://localhost:8081
WAIT navigation ready
CLICK role=button name=/Hiking/i
WAIT selector=text/Start Hiking/
FULLPAGE_SCREENSHOT sc-01-idle-no-route.png
```

#### 2. Route picker with zero saved routes — 5/10
Only "Free Hiking" shows — but there's **no empty-state copy** ("You have no saved routes yet. Try Free Hiking or import a GPX from Routes"). Users who tap expecting to see a list will assume the feature is broken. HikingScreen.tsx:790 iterates `routes.map` silently when empty.

```
EVALUATE () => window.__cairnStores.useRouteStore.setState({ routes: [] })
CLICK selector=[data-testid=route-pill] || .routePill
WAIT selector=text/Choose a route/
FULLPAGE_SCREENSHOT sc-02-routepicker-empty.png
```

#### 3. Route picker with N routes (mixed near+far) — 7/10
Rows show name, distance, elev, `runCount× done`, `distLabel`. Good density. **Gap 1**: The `· at start` (< 100m) fires for anything at all near the GPS fix; users at their house see literally "· at start" on a trail 90m away — confusing pluralisation with "· 2.3 km away". **Gap 2**: The `TOO_FAR_M = 25_000` is a hardcoded constant in-file; no way for a user to know why a picker row is dimmed until they read the row's `· too far` — the dim + the label are the same info doubled.

```
EVALUATE () => window.__cairnStores.useRouteStore.setState({
  routes: [
    { id: 'r1', name: 'Local loop', distanceM: 3400, elevationGainM: 120, runCount: 2, points: [{ lat: -36.85, lng: 174.76 }] },
    { id: 'r2', name: 'Weekend big one', distanceM: 18000, elevationGainM: 640, runCount: 0, points: [{ lat: -36.60, lng: 174.20 }] },
    { id: 'r3', name: 'Wanaka trip', distanceM: 12000, elevationGainM: 500, runCount: 0, points: [{ lat: -44.7, lng: 169.1 }] },
  ]
})
CLICK .routePill
WAIT text=/Choose a route/
FULLPAGE_SCREENSHOT sc-03-routepicker-mixed.png
```

#### 4. Route picker with only starred routes — 7/10
No visual distinction between "starred / recent" and long-tail routes (no `starred` badge in row). Users can't scan by importance. `TouchableOpacity` order is `routes.map` insertion order.

```
CLICK .routePill
FULLPAGE_SCREENSHOT sc-04-routepicker-starred.png
```

#### 5. Route with very far start (> 25km) — 6/10
Row opacity 0.45, `disabled` prop, appended `· too far` label. **Gap**: the "why can't I tap this?" answer is a small greyed-out label; users with poor eyesight will just see a dim row. Consider a lock icon (Icon `Lock`) or the label above the metric. Also — no way to **override** the block; a legitimate user planning to drive there can't select the route.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ lastCoordinate: { lat: -36.85, lng: 174.76, alt: 40 }, lastCoordinateTime: Date.now() })
CLICK .routePill
FULLPAGE_SCREENSHOT sc-05-toofar-disabled.png
```

#### 6. Enable GPS chip (idle status) — 7/10
Amber chip + amber dot, `severityWarning` color. Copy "Enable GPS" is imperative but there's **no interactive hint** — chip is not tappable to open Settings/permissions. First-time user taps the chip → nothing → confused.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'idle', locationAvailable: false })
FULLPAGE_SCREENSHOT sc-06-enable-gps.png
CLICK selector=text/Enable GPS/
WAIT 500ms
FULLPAGE_SCREENSHOT sc-06b-gps-tap-response.png
```

#### 7. GPS Connected chip (tracking active) — 9/10
PulseDot with `Colors.success`, `pulsing={true}`, text `GPS`. Very clean. Matches Settings quality.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'tracking', locationAvailable: true })
FULLPAGE_SCREENSHOT sc-07-gps-connected.png
```

#### 8. Web/Playwright placeholder map (dev) — 7/10
`HikingMap` falls back to fixed sage-green placeholder without a "Preview mode" ribbon. Auditors + real users on web won't know if it's a real map or a bug.

```
NAVIGATE http://localhost:8081/hiking
FULLPAGE_SCREENSHOT sc-08-web-map-placeholder.png
```

#### 9. Sim-walker enabled + overlay visible — 6/10
`SimWalkerOverlay` mounts inside a `try/require` block (HikingScreen:1230). Overlay is a bottom-right joystick + 3 buttons; **no visible chip anywhere on screen tells the user "you are in sim mode"** — same top overlay as production, same GPS chip pulses green. If a user forgets sim is on and reads distance in the stats bar, they'll trust it.

```
EVALUATE () => { window.__cairnStores.useSettingsStore.setState({ debugMode: true }); window.__cairnStores.useSimWalkerStore.setState({ active: true }); }
FULLPAGE_SCREENSHOT sc-09-simwalker-overlay.png
```

#### 10. Sim-walker with startAnchor + distance hint — 8/10
`StartAnchorHint` shows `已走 Xm/Xkm`. **Gap**: only Chinese text — inconsistent with the rest of the app's English UI. Also blends into map (`anchorHint` style not shown in file, likely no card background).

```
EVALUATE () => window.__cairnStores.useSimWalkerStore.setState({ active: true, startAnchor: { lat: -36.85, lng: 174.76 } })
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ lastCoordinate: { lat: -36.86, lng: 174.77, alt: 40 } })
FULLPAGE_SCREENSHOT sc-10-simwalker-anchor.png
```

---

### TRACKING PHASE

#### 11. Tracking active, real GPS, mid-hike — 9/10
Stats bar: distance / duration / elevation. Numbers 14pt tabular-nums, unit 9pt. Compass + FAB balanced left/right. Frosted glass on both. Matches SettingsScreen O12 quality.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'tracking', distanceM: 2340, durationS: 1820, elevationGainM: 87, trackPoints: Array.from({length: 40}, (_, i) => ({ lat: -36.85 + i*0.0001, lng: 174.76 + i*0.0001, t: Date.now() - (40-i)*45000 })), locationAvailable: true })
FULLPAGE_SCREENSHOT sc-11-tracking-real.png
```

#### 12. Tracking with sim-walker — 6/10
Same as #11 visually, but internally `trackPoints` synthesised. **Gap**: no watermark, no `debugMode` chip. This is a **data provenance issue** — a saved sim hike ends up in Activities looking identical to a real one. Flag as UX bug regardless of tracking-store lineage.

```
EVALUATE () => { window.__cairnStores.useSimWalkerStore.setState({ active: true }); window.__cairnStores.useTrackingStore.setState({ status: 'tracking', distanceM: 2340, durationS: 1820, elevationGainM: 87 }); }
FULLPAGE_SCREENSHOT sc-12-tracking-sim.png
```

#### 13. Tracking bar dist/dur/elev formatting — 8/10
`dist.format(distanceM, 1)` + `dist.unit`. `formatDuration(durationS)` = `formatDuration` in utils/geo. Elev prefixed `+` (nice). **Gap**: no negative-elevation display (down-trending hike shows only cumulative gain, which is defensible but the "elev" label is ambiguous — user thinks it's current altitude, not gain).

```
FULLPAGE_SCREENSHOT sc-13-stats-bar-detail.png
```

#### 14. Pause pin visible (paused status) — 7/10
`isTrackingOrPaused` keeps bar visible when `paused`. **Gap**: no "PAUSED" indicator anywhere on the tracking bar — the user only knows they paused because the summary sheet is up. If the sheet dismisses via scrim tap during Discard flow (see #22), user sees the bar with unchanging numbers and no paused label.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'paused', distanceM: 2340, durationS: 1820, elevationGainM: 87 })
FULLPAGE_SCREENSHOT sc-14-paused-no-indicator.png
```

#### 15. GPS lost (accuracy > 50m equivalent — old lastTrackT) — 8/10
Signal-lost pill appears above stats bar when `Date.now() - lastTrackT > 120_000`. Amber, dot + text. **Gap**: `signalLostMin >= 1` returns `min` label, else just "Signal lost" — 61-119s window shows "Signal lost" ambiguous, no seconds. Minor.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'tracking', trackPoints: [{ lat: -36.85, lng: 174.76, t: Date.now() - 200_000 }], locationAvailable: false })
FULLPAGE_SCREENSHOT sc-15-signal-lost-pill.png
```

#### 16. GPS lost banner + Offline chip combined — 8/10
`gpsChipOffline` red bg + red text + no pulse. Two visual cues (top chip red + amber signal-lost pill below) is slightly redundant but understandable.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'tracking', locationAvailable: false, trackPoints: [{ lat: -36.85, lng: 174.76, t: Date.now() - 300_000 }] })
FULLPAGE_SCREENSHOT sc-16-gps-lost-both.png
```

#### 17. Distance near 0 but duration accumulating (stationary) — 7/10
Displayed `0.0 km · 5:12 elapsed · +0m elev`. Read like a broken tracker. **Gap**: no coaching copy ("Waiting for movement…"). Also possible that a stationary hiker (rest break) looks identical to a real bug.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'tracking', distanceM: 2.4, durationS: 312, elevationGainM: 0, locationAvailable: true, trackPoints: [{lat:-36.85,lng:174.76,t:Date.now()-1000}] })
FULLPAGE_SCREENSHOT sc-17-stationary.png
```

#### 18. Long duration 3+ hours (`formatDuration` output) — 8/10
Assuming `formatDuration` renders `h:mm:ss`, layout of `trackingValue` at 14pt with tabular-nums fits. **Verify visually**: at `3h 44m 21s`, does the bar wrap or crowd the `+elev` and `Stop` buttons?

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'tracking', distanceM: 18450, durationS: 13461, elevationGainM: 720 })
RESIZE 375 812
FULLPAGE_SCREENSHOT sc-18-long-duration-375.png
RESIZE 430 932
FULLPAGE_SCREENSHOT sc-18b-long-duration-430.png
```

---

### STOP / SAVE FLOW

#### 19. Stop button tap → StopSummarySheet opens — 9/10
Haptic medium impact, `pauseTracking()` first, then setStopSummary. Sheet slide-up 280ms cubic. Very smooth. Matches Settings pattern.

```
CLICK selector=[data-testid=stop-btn] || text=/Stop/
WAIT selector=text=/Hike complete/
FULLPAGE_SCREENSHOT sc-19-stop-tap.png
```

#### 20. StopSummarySheet full content — 8/10
Title (`Hike complete` accent color), memory banner, name input placeholder, Discard + Save row. **Gap**: no summary stats **inside** the sheet — user has to remember what was in the bar. v120 removed stats intentionally, but the tradeoff is that the user's "did I really hike 2.4km?" verification requires cancelling the sheet.

```
FULLPAGE_SCREENSHOT sc-20-summary-content.png
```

#### 21. Memory preview banner — 8/10
Three states rendered by `previewMemoryGain`: `Too short to record` / `+X.XX km²` / `Familiar ground`. Well-thought-out. Imperial branch (`× 0.000830`) mi² preserved. **Gap**: no explanation of what "Familiar ground" means; first-time user has no vocab for it.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ trackPoints: [{lat:-36.85,lng:174.76,t:Date.now()-1000}] })
CLICK text=/Stop/
FULLPAGE_SCREENSHOT sc-21-familiar-ground.png
```

#### 22. "Too short to record" state — 7/10
Shown when `summary.trackPoints.length < 2`. Same visual weight as normal Memory banner. **Gap**: the Save button is still enabled + primary-styled — user taps Save on a too-short hike and gets routed through the wall-timeout + TooShortSheet dance. A disabled Save state (with the copy nudging to Discard) would be cleaner.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'paused', trackPoints: [{lat:-36.85,lng:174.76,t:Date.now()-1000}], distanceM: 4, durationS: 12 })
FULLPAGE_SCREENSHOT sc-22-tooshort-savable.png
```

#### 23. Save button loading state (O14 saving spinner) — 9/10
`ActivityIndicator size=small color=#fff` + `Saving…`, buttons disabled at opacity 0.7. Sheet stays mounted for up to 30s. Explicit, honest. Matches Settings loader quality.

```
EVALUATE () => document.querySelector('[data-testid=save-btn]').click()
FULLPAGE_SCREENSHOT sc-23-saving-spinner.png
```

#### 24. Save success → nav to Activity Detail — 8/10
`nav.dispatch(CommonActions.reset({ index: 2, routes: [Home, Routes(activities), MapHistory{sessionId}] }))`. Back button goes to Activities list. **Gap**: no toast/haptic on success — the sheet dismisses, screen swaps, and user has to trust nothing broke. A success haptic + a 1-second banner ("Saved") would close the loop.

```
FULLPAGE_SCREENSHOT sc-24-post-save-detail.png
```

#### 25. Discard confirm — 4/10 (**issue**)
`onDiscard` fires immediately on button tap. **No confirmation dialog.** Compared to the Recovery modal's forced two-button UX, the Save sheet's Discard is one tap = data gone (though still recoverable through disk backup). Given that hikes are user's real activity, a `Alert.alert('Discard this hike?', ...)` is warranted, matching the SettingsScreen sign-out confirm.

```
CLICK selector=text=/Discard/
FULLPAGE_SCREENSHOT sc-25-discard-no-confirm.png
```

#### 26. UnfinishedRecoveryModal on re-enter (5s ago / 5m ago / 5h ago) — 8/10
`formatRelative` handles < 60s (`just now`), < 60m (`X min ago`), < 24h (`X hr ago`), else `X days ago`. Copy is clean, three stats (`dist / duration / last point`) balanced. **Gap**: no map preview of where the unfinished hike is — user has to guess "was this the one on Rangitoto or the Waitakere one?".

```
EVALUATE () => window.__forceUnfinished({ sessionId: 'test', activityMode: 'hiking', startedAt: Date.now()-1200000, distanceM: 1200, durationS: 900, lastPointAt: Date.now()-300000 })
FULLPAGE_SCREENSHOT sc-26a-recovery-5min.png
EVALUATE () => window.__forceUnfinished({ sessionId: 'test', activityMode: 'hiking', startedAt: Date.now()-18000000, distanceM: 6400, durationS: 5400, lastPointAt: Date.now()-17700000 })
FULLPAGE_SCREENSHOT sc-26b-recovery-5hr.png
```

#### 27. Unfinished with 0 disk points (O14 skip) — 10/10
`hasPointsOnDisk` gate + `discardActiveHike` on empty tail. Silent, correct. Modal does not appear. This is the correct behaviour — matches Settings-level defensive code.

```
NAVIGATE hiking
WAIT 2000ms
EVALUATE () => document.querySelector('[data-testid=unfinished-continue]') === null
FULLPAGE_SCREENSHOT sc-27-empty-disk-no-modal.png
```

#### 28. Unfinished from remote-only (dev / cross-device) — 7/10
Remote branch shows a modal for `sessionId: remote-${s.id}`, `distanceM: 0, durationS: 0`. **Gap**: user sees "0 km · 0 min duration · X min ago last point" — reads like the modal is buggy. Copy could differentiate: "This hike was started on another device or session — restore it here?".

```
EVALUATE () => window.__forceRemoteUnfinished({ id: 999, start_time: new Date(Date.now()-600000).toISOString(), type: 'hiking' })
FULLPAGE_SCREENSHOT sc-28-remote-zero.png
```

---

### ERRORS + EDGE

#### 29. Network offline during Save — 7/10
`stopTracking` wall-timeout raises to 30s; `stopFailed=true` still calls `setSavingHike(false)`, dismisses sheet, and navigates. **Gap**: silent — the user has no idea the server sync failed. `console.warn` doesn't reach them. A small "Will sync when online" chip on Activity Detail would be honest.

```
EVALUATE () => window.__mockNetwork.offline()
CLICK text=/Save/
WAIT 30500ms
FULLPAGE_SCREENSHOT sc-29-offline-save.png
```

#### 30. saveHikeAtomic 500 — 6/10
Same handling as offline — sheet dismisses on wall-timeout, memorySync retries silently. **Gap**: no user-visible error even 60s later. Compare Settings, which surfaces `Alert.alert` on save failure. Cairn hikes are more valuable than a settings toggle; deserve at least a toast.

```
EVALUATE () => window.__mockAPI.fail('/api/hikes/save-atomic', 500)
CLICK text=/Save/
WAIT 30500ms
FULLPAGE_SCREENSHOT sc-30-500-error.png
```

#### 31. saveHikeAtomic timeout 20s+ — 6/10
Wall-timeout 30s > server timeout 20s. Race: if server responds at 25s, sheet is still up, user has already committed. Behavior currently: sheet stays up, spinner keeps spinning, then dismisses when server returns. Acceptable but no visual "still going…" hint appears after e.g. 10s.

```
EVALUATE () => window.__mockAPI.delay('/api/hikes/save-atomic', 25000)
CLICK text=/Save/
WAIT 15000ms
FULLPAGE_SCREENSHOT sc-31-timeout-mid.png
```

#### 32. addSession sync=pending — 7/10
LocalSession stored with `syncState: pending`; drainPending kicks in. **Gap**: no UI indicator on Activity Detail. If user checks activities within 10s of save, they see the session but no "syncing…" badge.

```
EVALUATE () => window.__cairnStores.useSessionStore.setState({ sessions: [...state.sessions, { id: 'x', syncState: 'pending', ... }] })
NAVIGATE activities
FULLPAGE_SCREENSHOT sc-32-pending-session.png
```

#### 33. Back button (Home cancel) mid-hike — 6/10
`BackButton onPress={() => nav.goBack()}` — **no confirm**. A user tracking a real hike can accidentally tap Back and lose the tracking screen (though state persists — the effect at line 517 restores `phase='tracking'` on re-entry). Still confusing; the button should either be hidden while tracking or gated with an Alert.

```
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'tracking', distanceM: 2340, durationS: 1820 })
CLICK selector=[data-testid=back-button] || .pill (top left)
FULLPAGE_SCREENSHOT sc-33-back-during-hike.png
```

#### 34. Full-screen safety with Mapbox token missing — 5/10
If `@rnmapbox/maps` require fails or token invalid, HikingMap falls back to placeholder — but placeholder has **no copy** telling user "map unavailable, tracking still works". User sees a green square with a compass in the corner and thinks the app is broken.

```
EVALUATE () => window.__mockMapbox.failToken()
NAVIGATE hiking
FULLPAGE_SCREENSHOT sc-34-mapbox-failed.png
```

#### 35. Small screen 375px — 7/10
375 iPhone SE / mini. `paddingHorizontal: Spacing.base (16)`, `gap: Spacing.sm (8)`. Stats bar has 4 items + optional route-switch pill + Stop button — verify with `sc-18-long-duration-375.png`. Historic issue: at 375 with a 3-digit duration + km distance + `+123m` elev + Route switch chip, the row can crowd.

```
RESIZE 375 667
EVALUATE () => window.__cairnStores.useTrackingStore.setState({ status: 'tracking', distanceM: 12000, durationS: 8760, elevationGainM: 543 })
EVALUATE () => window.__cairnStores.useRouteStore.setState({ ...state, /* selectedRoute set */ })
FULLPAGE_SCREENSHOT sc-35-375-crowded.png
```

#### 36. Long route name overflow in route picker — 8/10
`routePickerName` has no `numberOfLines`. A 40-char route name wraps to 2 lines and pushes the meta row further down. Acceptable but inconsistent with the 1-line pill in the idle state (`numberOfLines={1}` on line 736).

```
EVALUATE () => window.__cairnStores.useRouteStore.setState({ routes: [{ id: 'long', name: 'Aoraki Mount Cook to Hooker Valley to Kea Point return trail full loop', distanceM: 12000, elevationGainM: 500, runCount: 0, points: [{lat:-36.85,lng:174.76}] }] })
CLICK .routePill
FULLPAGE_SCREENSHOT sc-36-longname.png
```

#### 37. Dark mode / night mode — 5/10 (**not implemented**)
No dark mode support in current tokens (Colors object has `running{Bg,Text,Border}` locked-dark for running screen only). At night on a real hike, screen is blindingly white. Since `useKeepAwake()` keeps screen on, this is a **real safety concern** for evening hikers. Below Settings tier (Settings has a night-mode toggle placeholder).

```
FULLPAGE_SCREENSHOT sc-37-nomode-night.png
```

---

## Summary of gaps by severity

**Blocker (0):** none.

**Critical (2)**:
- **#25 Discard-with-no-confirm** — data-loss risk; violates "hike is user's real work" principle. Users expect a confirm even for reversible destructive actions.
- **#37 No dark/night mode** — safety issue for evening hikers, screen brightness at night interferes with dark-adapted vision on trail.

**Medium (7)**:
- **#2 Empty route picker no copy** — first-time confusion.
- **#5 "Too far" no override + weak explanation** — user autonomy blocked.
- **#6 Enable GPS chip non-interactive** — dead-looking UI.
- **#9/#12 Sim-walker not visually marked as sim** — data provenance risk.
- **#22 Save button enabled for too-short hikes** — sends user through a wall-timeout dance.
- **#29/#30 Silent network error** — no user-visible feedback on server failure.
- **#33 Back button no confirm during tracking** — accidental abandonment.

**Minor (7)**:
- **#3 `· at start` / `· X km away` pluralisation inconsistent**.
- **#4 No starred/recent visual distinction in picker**.
- **#10 Chinese-only sim anchor hint**.
- **#14 No "PAUSED" indicator on tracking bar in paused state**.
- **#15 Signal-lost pill copy weak in 60-119s window**.
- **#17 Stationary state looks broken**.
- **#28 Remote-only unfinished shows 0/0**.
- **#34 Mapbox failure has no copy**.
- **#36 Route name wraps 2 lines in picker but not pill**.

**Polish (5)**:
- **#8 Web map placeholder no "preview" ribbon**.
- **#13 "+elev" label ambiguous vs current altitude**.
- **#21 "Familiar ground" jargon**.
- **#24 No success toast/haptic on save nav-away**.
- **#32 No syncing badge in activity list for pending sessions**.

**Excellent (2)**:
- **#7 GPS connected chip** — PulseDot + tokens correct.
- **#23 Saving spinner + sheet retention** — honest, explicit UX.
- **#27 Empty-disk recovery skip** — defensive, silent, correct.

---

## Composite: 7.1 / 10

Above baseline for happy-path clarity, animation quality, and defensive edge-case handling (recovery modal, wall-timeout, disk gating). Falls below SettingsScreen tier because:
1. Multiple **silent-failure states** (network error, mapbox down, back-button, sim-mode) — Settings surfaces every failure.
2. **One critical data-loss risk** (Discard without confirm) — Settings guards every destructive action.
3. **No night mode** — Settings has the toggle affordance, Hiking has nothing.
4. **Copy inconsistencies** (Chinese anchor hint, "Familiar ground" jargon, `· at start` grammar).

Fix the two Criticals + top three Mediums (#22 too-short save gate, #29 offline chip on activity, #9 sim-mode watermark) and this screen jumps to 8.5+.
