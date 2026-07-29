# UX/UI Audit — MapHistoryScreen

**Auditor**: A11
**Date**: 2026-07-28
**Screen**: `app/src/screens/MapHistoryScreen.tsx` (past-sessions list + memory replay + activity detail)
**Route**: `MapHistory` (also entered with `?sessionId=<id>` param → single-session detail mode)
**Baselines compared**: RoutesScreen (`ActivitiesTab`), SettingsScreen (O12 visual baseline)

---

## 1. Screen Summary

MapHistoryScreen is a dual-mode screen:

**Mode A — List mode** (no `sessionId` param): behaves as a "Route Map" browser. Full-bleed map at top with decorative lines when idle, tab bar (`Routes` only — the `flags` branch exists in the enum but the tab UI drops it), scrollable list of sessions in a bottom panel. Tapping a card expands inline stats+preview+CTA; "View on Map" swaps polyline in the top map area.

**Mode B — Single-session detail** (`sessionId` present): map fills the top, bottom becomes a compact `singleSessionPanel` with three big stat blocks (distance / duration / elevation) and two action buttons (`Save as Route` + `Delete`).

The screen carries a lot of legacy work: `TrackPolyline` (SVG fallback) + `NativeTrackMap` (Mapbox), `smoothedTrackPoints` render pipeline, remote/local trackpoints hydration with 15s timeout, `syncState` grey-card branch, `FlagDetailSheet` for markers.

**Key contrasts vs RoutesScreen `ActivitiesTab`**:

| Aspect | MapHistoryScreen | RoutesScreen ActivitiesTab | Consistency |
|---|---|---|---|
| Card layout | `activityBadge` + info column with pill+primary+meta + chevron; expands inline | left-accent-border + `cardBadge` + title + meta + chevron; opens ActivitySheet | ⚠️ Two different card visual languages for the same underlying entity (a session). |
| Empty state | Small icon + title + subtitle + `Start a Hike` CTA | Illustration halo + `EmptyRoutes` art + hint (no CTA) | ⚠️ Different empty patterns for the same list. |
| Filter/sort | None | FilterSortBar (activity mode + recent/longest/most-time) | ❌ Major gap — MapHistory has no filter at all. |
| Delete flow | Inline "Delete Route" button below the list (2-tap confirm) | Long-press → ActivitySheet, then delete inside sheet (2-tap confirm) | ⚠️ Two ways to delete the same object. |
| Session name | Uses `session.name` fallback to activity type | Same | ✅ |
| Distance format | `useDistance()` hook | Same | ✅ |
| Pending sync state | Grey card (`opacity: 0.55`) + long-press to abandon | Not represented at all (would render as normal card) | ❌ RoutesScreen ignores syncState entirely. |

**Product Soul check**: The bottom-panel-over-map metaphor is the emotional core here — "memory replay". This is well realized when Mode A is entered fresh with sessions. It is broken when: (1) empty state shows only a text panel with no map atmosphere (map goes to decorative lines), (2) `singleSessionPanel` mode collapses the memory metaphor into a stat-strip that could be any screen.

---

## 2. Scenarios Table

`Cons.` = consistency with sibling screens (1-10, higher = better). `UX` = end-user experience (1-10). Bug severity in Issues column: **B**locker, **C**ritical, **M**edium, **L**ow.

| # | Feature | Sub-feature | Scenario | Expected UI | Cons. | UX | Issues |
|---|---|---|---|---|---|---|---|
| 1 | Empty state | No sessions | `sessions.length===0`, list mode | Icon + "No sessions yet" + subtitle + "Start a Hike" CTA | 4 | 6 | **M**: inconsistent with RoutesScreen `ActivitiesTab` empty state (illustration + `IllustrationHalo`, no CTA there). Two different empty patterns for the same underlying data. **L**: map area behind shows decorative colored lines (`routeLine1/2/3`) that look like leftover UI, not intentional pattern. |
| 2 | Loading | Hydrating from storage | User just opened app, sessions store still empty at first frame | Same as scenario 1 — shows "No sessions yet" until store hydrates | 3 | 3 | **C**: no distinction between "hydrating" and "genuinely empty". First-time users may see the empty CTA flash before their real sessions load. There is no `isHydrating` flag surfaced. |
| 3 | Single session | 1 session, list mode | Auto-selected + auto-expanded via `useEffect` at mount (line 757-759) | Card at top, expanded (stats + preview + CTA), map shows track | 7 | 8 | **L**: `useEffect` deps=`[]` — if user navigates away and back with a different session, the auto-select doesn't fire again. |
| 4 | Small list | 5 sessions | List mode | 5 cards, first is expanded and selected, rest collapsed | 7 | 7 | ⚠️ card style diverges from RoutesScreen. |
| 5 | Medium list | 20 sessions | List mode, scroll | ScrollView, 20 cards, one expanded | 6 | 6 | **M**: uses `ScrollView` not `FlatList` — with 20+ cards each carrying an inline `expandedArea` (210px) + polyline renderer inside, initial render is heavy. Compare RoutesScreen which uses FlatList. |
| 6 | Large list | 100 sessions (MAX_SESSIONS) | List mode | 100 cards | 5 | 4 | **C**: ScrollView with 100 cards = ~100 * (base card + hidden expandedArea + Animated values) constructed at mount. Scroll performance will lag on mid-range devices. This is a proven RN antipattern vs FlatList virtualization. |
| 7 | Sync state — pending | `syncState='pending'` card | Never-uploaded local session | Grey card at `opacity 0.55`, subtitle "Saved offline, will upload when online", long-press → discard prompt | 3 | 6 | **M**: RoutesScreen `ActivitiesTab` renders pending sessions as normal cards (no `syncState` branch present) — so the same session looks fine there and grey here. **L**: `abandonPending` is `require()`'d dynamically inline — no visible failure if module missing. **L**: no chevron on grey card, but the whole card is still `TouchableOpacity` with `activeOpacity={1}` — user gets no feedback that it's "not clickable"; feels dead. |
| 8 | Sync state — syncing | `syncState='syncing'` | Actively uploading | Same grey card, subtitle "Syncing…" | 5 | 4 | **M**: no progress indicator (no `ActivityIndicator` shown). "Syncing…" is a static string — user cannot tell if it's stuck or working. **L**: `CloudOff` icon is used even in "syncing" state — semantically wrong (should be cloud-arrow-up or similar). |
| 9 | Sync state — synced | Default state | Normal card | Full-color card, tappable | 7 | 8 | ✅ works as expected. |
| 10 | Long-press pending | Discard flow | User long-presses grey card | Alert "Discard this activity?" → confirm → second alert "Confirm discard?" | 8 | 6 | **L**: `delayLongPress={800}` — too slow, iOS convention is 500ms. **M**: no haptic feedback on long-press trigger. **L**: double-alert is heavier than iOS native destructive `ActionSheetIOS` would be. |
| 11 | Tap synced card | Expand inline | Card expands with stats + preview + `View on Map` CTA | Height: 0 → 210px animated | 6 | 7 | **M**: expanded card contains a full `routePreviewCard` (topo rings + chips) that says "Preview" — but there is **no actual route rendered inside it**. It's purely decorative. First-time user will expect to see their route here. This is a truthfulness bug. |
| 12 | Tap "View on Map" | Push polyline to top map | Selection changes; map area re-renders with track | Track polyline + start/end dots + marker pins over map | 8 | 8 | ✅ works. **L**: expanded state collapses on `View on Map` (line 1233) — user loses the expanded stats they were just looking at. |
| 13 | Activity mode — hiking | `activityMode='hiking'` | Card + track colored `Colors.primary` (sage) | Icon HikingIcon, sage accent | 9 | 9 | ✅ |
| 14 | Activity mode — running | `activityMode='running'` | Card + track colored `Colors.running` (blue) | Icon RunningIcon, blue accent | 9 | 9 | ✅ |
| 15 | Session with markers | 3 markers nearby route | Native map shows pins anchored to real lat/lng | Pin badges from MARKER_META | 7 | 8 | **L**: SVG fallback (line 1059) uses hardcoded grid positions `left: 60 + (i%4)*75, top: 120 + (i%3)*70` — pins overlap when count > 4 and don't reflect geography at all on web/Expo Go. |
| 16 | Session without markers | `markerIds.length===0` | Stats show "0 flags" | 0 in chip | 8 | 8 | ✅ |
| 17 | Very short session | 5s, distance < 20m | `distStr = 'No GPS'` | Card shows "No GPS · 0m 5s" | 6 | 5 | **M**: "No GPS" is misleading — user's GPS worked fine, they just didn't move. Should say "Too short" or "0 m". **L**: expanded state hides distance unit label when 'No GPS' (line 607) — layout jumps. |
| 18 | Very long session | 8h hike, 25km | Duration formatted `8h 12m`, distance 25.0 km | Card renders | 8 | 8 | **L**: `routePrimary` (duration) always sits above `routeMeta` (date + distance) — visual hierarchy makes duration the "main stat", but for hikers distance is usually the identity metric. Compare Strava/AllTrails. |
| 19 | Memory delta +0 km² | Session had no new H3 cells | No banner (banner is on `StopSummarySheet`, not this screen) | (Not shown here) | — | — | Not applicable — `memoryNewCells` only shown at stop-summary, not on history card. This is a **discoverability gap**: user cannot see per-session memory contribution from the history card. |
| 20 | Memory delta +5 km² | (as above) | — | — | — | — | Same as #19. |
| 21 | Memory delta +50 km² | (as above) | — | — | — | — | Same as #19 — a major hike's memory contribution is invisible from the history view. **M** discoverability. |
| 22 | Delete flow, list mode | Tap `Delete Route` below list | 2-tap confirm → `deleteSession` + reset selection | Red button → red-filled `Confirm Delete` → deletes | 4 | 5 | **C**: Delete button appears BELOW the list (line 1239) — user sees it only after scrolling through 100 sessions. **M**: Delete button targets `selectedSession` but no visual indication of what will be deleted — user could scroll away, forget which is selected, hit Delete. **M**: Divergent from `RoutesScreen ActivitySheet` (long-press → sheet with Delete inside), which is the safer pattern. |
| 23 | Delete flow, detail mode | Tap `Delete` in `singleSessionPanel` | Same 2-tap → back to previous screen | Red button → red-filled → `nav.goBack()` | 7 | 7 | **L**: no undo toast after delete. **L**: `Save as Route` and `Delete` are the two equal-width primary buttons — a green primary + red danger button side-by-side reads visually equal-weight, but Delete is destructive. Delete should be less prominent (ghost / small). |
| 24 | Viewport 375 (iPhone SE) | Portrait, list mode | Cards fit width, map top ~380 tall | Works | 7 | 7 | **L**: `MAP_H = H - 380` — on iPhone SE (`H=667`), MAP_H=287px, which is workable. On large phones (H=926) MAP_H=546px — map area dominates. |
| 25 | Viewport 393 (iPhone 15) | Portrait, list mode | Standard rendering | Works | 8 | 8 | ✅ |
| 26 | Viewport 428 (iPhone Pro Max) | Portrait, list mode | Wide layout | Works | 7 | 7 | **L**: `routeCard` doesn't scale — everything stays at Spacing.md padding, so on 428px width the card feels loose. |
| 27 | Scroll 100 cards | List mode with MAX_SESSIONS | Scroll perf | Should be smooth 60fps | 4 | 4 | Same as scenario #6 — **C** perf issue. Also each card has 6 `Animated.Value` allocations (`expandAnim`, `statsOpacity/TransY`, `previewOpacity/TransY`, `ctaOpacity/TransY`) — 600 Animated.Value objects on mount for 100 cards. |
| 28 | Session name — user-named | `session.name === 'Emerald Lakes'` | Card shows "Emerald Lakes" pill | Label reads user name | 8 | 8 | ✅ (line 428). |
| 29 | Session name — auto | `session.name === undefined` | Falls back to `'Run'` or `'Hike'` | Pill reads type | 8 | 7 | **L**: no date context in the pill — two "Hike" pills side by side look identical. |
| 30 | Distance metric vs imperial | User toggled Units in Settings | `useDistance().format()` used | Renders km or mi accordingly | 9 | 9 | ✅ well-integrated via O12 hook. |
| 31 | Route data loading | Selected session, server hydrating | `loadedTrackPoints === null` → `isLoadingTrackPoints=true` → renders `null` in map area | Empty map + summary card below (v261 fix) | 7 | 6 | **M**: rendering `null` in map area shows the decorative `routeLine1/2/3` behind... no wait — those only render when `!sessionRender`. So during load, map shows plain color. That's OK but there's no loading indicator anywhere — user sees blank green rectangle for up to 15s. |
| 32 | Route fetch timeout | 15s server timeout, no local cache | Falls to `setLoadedTrackPoints([])` → `TrackPolyline` shows "Route data unavailable" | Message rendered | 7 | 5 | **M**: 15s of blank map before message appears — no interim spinner. User will think app hung. |
| 33 | Save as Route CTA | Detail mode with valid trackpoints | Button enabled, navigates to `RouteEditor` with `fromSessionId` | Button green outlined | 8 | 8 | ✅. |
| 34 | Save as Route disabled | Trackpoints empty | Opacity 0.4, disabled | Grey button | 7 | 6 | **L**: no tooltip / helper text explaining why it's disabled. |
| 35 | Flag detail sheet | Tap marker pin (Flags tab) | Bottom sheet slides up, scrim fades in | Sheet shows type + note + date + Delete | 8 | 8 | ✅ but Flags tab is orphaned (see next). |
| 36 | Flags tab | `tab='flags'` state | The state exists (line 743) but no `flags` tab-item is rendered — only `Routes` (line 1099-1109) | Dead code path | 2 | 2 | **C** dead code: `useState<'routes'\|'flags'>` and the `flags` render branch (line 1253-1298) exist, but the tab bar only shows a Routes button. User cannot switch to flags. Either restore the flag tab or remove the state entirely — currently it's confusing dead code. |
| 37 | Marker filter — regionCode | `markers.filter(m => m.regionCode === region.code)` | Only current-region markers shown | Correct | 8 | 8 | ✅. |
| 38 | Long list with expanded cards | 20 sessions, one expanded | Animated height 210px active on one card | Works | 6 | 6 | **L**: `useNativeDriver: false` on the height interpolation — height animation is JS-thread. On lower-end devices this jitters. |
| 39 | Marker distance from current position | `lastCoord` present | Flags tab (dead) shows "1.2 km away" as subtitle | Correct | 6 | 6 | Dead code path — see #36. |
| 40 | Plan Route button | `!targetSessionId && Alert.alert('Plan Route', 'Route planning coming soon')` | Placeholder alert | Not implemented | 3 | 2 | **M**: shipping a "coming soon" alert in production violates the "no dead affordances" principle. Should either be hidden behind a feature flag or route to actual planning. |
| 41 | Sync state truncation | Long session.name on grey card | Only subtitle line, no ellipsis on title | Title truncation | 5 | 3 | **C** truncation risk (per feedback_truncate_is_bug): `routeCardTitle` is a single Text with no `numberOfLines={1}` — a long user-set name will wrap into multiple lines, disrupting the grey card layout. Also on regular card, `routePrimary` and `routeMeta` have no numberOfLines protection. |
| 42 | Selected session stat bar | Overlay bar at bottom of map | 4 stats: dist / time / flags / elev | Works | 8 | 8 | ✅. **L**: values on stat bar use `FontSize.caption` (13px) — hard to read on iPhone at reading distance. |
| 43 | Tab count label | "Routes (12)" | Count reflected | Works | 8 | 8 | ✅. **L**: count is not distinguishable from a badge — could visually confuse with a notification counter. |
| 44 | Detail mode header | `topTitle = 'Activity Detail'` | Title centered, right side spacer 60px | Works | 7 | 6 | **L**: spacer (line 1094) is 60px but BackButton width may differ — title not perfectly centered on all devices. |
| 45 | Back navigation after delete | `nav.goBack()` after delete in detail mode | Returns to previous screen | Works | 8 | 7 | **L**: no confirmation toast on parent screen indicating deletion happened. |
| 46 | Deep-link into missing session | `sessionId` not in `sessions` | `sessions = []` → renders empty state? | actually falls through to bottom panel since `targetSessionId && !selectedSession` doesn't match either branch cleanly | 3 | 2 | **C**: If a deep link references a session that has been deleted, `sessions.filter(...) = []`, `selectedSession = null`, the top `targetSessionId && selectedSession` branch fails → falls to list panel which is empty → user sees the "No sessions yet" empty state — but they came from a link to a specific session. Should show "Session not found" with a Back CTA. |
| 47 | Auto-select first session | Mount effect | Selects `sessions[0]` if no target passed | Works on mount but not on session-list updates | 6 | 5 | **M**: `useEffect(..., [])` — deps are empty. If a new session syncs in while user is viewing MapHistory, no re-selection triggers. Also if user manually clears selection, going back to the screen resets to first. |
| 48 | Elevation display | `+120m` or `+400 ft` | `dist.formatElevation` used | Works | 9 | 9 | ✅. |
| 49 | "Route data unavailable" state | `hasRecordedDistance && pts.length<2` | Dashed line + label | Works | 7 | 6 | **M**: dashed line has `borderColor: color` (activity-mode color) — but the text says "unavailable"; using the activity color implies success. Should be muted grey. |
| 50 | Track smoothing quality | `smoothedTrackPoints` memo | Kalman + accuracy filter | Not visually apparent but pipeline works | 8 | 8 | ✅. **L**: `React.useMemo` deps only `sessionForDisplay?.trackPoints` — if session unit changes (metric/imperial) the memo is safe, but if `selectedSessionId` changes, `sessionForDisplay` object identity flips, invalidating the memo correctly. |

---

## 3. Playwright Scripts

Web bypass enabled. Test hooks: `window.__cairnStores.useSessionStore.getState()`, `window.__cairnStores.useMarkerStore.getState()`, `window.__cairnStores.useTrackingStore.getState()`. Base URL: `http://localhost:8081`.

Screenshot directory: `docs/ux-audit-2026-07-28/mapshistory/screenshots/` (main agent creates before run).

### Scenario 1 — Empty state

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
RESIZE 375 812
SCREENSHOT mapshistory/01-empty-iphone.png
RESIZE 393 852
SCREENSHOT mapshistory/01-empty-iphone15.png
RESIZE 428 926
SCREENSHOT mapshistory/01-empty-max.png
```

### Scenario 2 — Loading (hydrating)

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [], currentUserId: 'guest' })
EVALUATE window.__cairnStores.useSessionStore.getState().hydrate('guest')
NAVIGATE http://localhost:8081/mapshistory
WAIT 100
SCREENSHOT mapshistory/02-hydrating-t100.png
WAIT 500
SCREENSHOT mapshistory/02-hydrating-t500.png
WAIT 2000
SCREENSHOT mapshistory/02-hydrated.png
```

### Scenario 3 — 1 session

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 's1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-3600000, endedAt: Date.now(), durationS: 3600, distanceM: 5200, elevationGainM: 180, trackPoints: [], markerIds: [], syncState: 'synced', name: 'Test Hike' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
RESIZE 393 852
SCREENSHOT mapshistory/03-1session-list.png
```

### Scenario 4 — 5 sessions

```
EVALUATE (() => { const s=[]; for(let i=0;i<5;i++) s.push({ id:'s'+i, activityMode: i%2?'running':'hiking', regionCode:'nz', startedAt:Date.now()-i*86400000, endedAt:Date.now()-i*86400000+3600000, durationS:3600+i*300, distanceM:5000+i*1500, elevationGainM:100+i*50, trackPoints:[], markerIds:[], syncState:'synced', name:'Session '+i }); window.__cairnStores.useSessionStore.setState({ sessions:s }); })()
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/04-5sessions.png
```

### Scenario 5 — 20 sessions

```
EVALUATE (() => { const s=[]; for(let i=0;i<20;i++) s.push({ id:'s'+i, activityMode: i%2?'running':'hiking', regionCode:'nz', startedAt:Date.now()-i*86400000, endedAt:Date.now()-i*86400000+3600000, durationS:1800+i*180, distanceM:3000+i*500, elevationGainM:i*30, trackPoints:[], markerIds:[], syncState:'synced', name:'Hike '+i }); window.__cairnStores.useSessionStore.setState({ sessions:s }); })()
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/05-20sessions-top.png
EVALUATE window.scrollTo(0, 500)
SCREENSHOT mapshistory/05-20sessions-scrolled.png
```

### Scenario 6 — 100 sessions (MAX_SESSIONS)

```
EVALUATE (() => { const s=[]; for(let i=0;i<100;i++) s.push({ id:'s'+i, activityMode: i%2?'running':'hiking', regionCode:'nz', startedAt:Date.now()-i*86400000, endedAt:Date.now()-i*86400000+3600000, durationS:1800, distanceM:2000+i*100, elevationGainM:20, trackPoints:[], markerIds:[], syncState:'synced' }); window.__cairnStores.useSessionStore.setState({ sessions:s }); })()
NAVIGATE http://localhost:8081/mapshistory
WAIT 3000
SCREENSHOT mapshistory/06-100sessions-render.png
```

### Scenario 7 — Pending sync grey card

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'p1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-1800000, endedAt: Date.now(), durationS: 1800, distanceM: 3500, elevationGainM: 100, trackPoints: [], markerIds: [], syncState: 'pending' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/07-pending-grey.png
```

### Scenario 8 — Syncing card

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'sy1', activityMode: 'running', regionCode: 'nz', startedAt: Date.now()-900000, endedAt: Date.now(), durationS: 900, distanceM: 2100, elevationGainM: 40, trackPoints: [], markerIds: [], syncState: 'syncing' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/08-syncing.png
```

### Scenario 10 — Long-press pending → discard prompt

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'p2', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-3600000, endedAt: Date.now(), durationS: 3600, distanceM: 6000, elevationGainM: 150, trackPoints: [], markerIds: [], syncState: 'pending' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
LONGPRESS [data-testid="session-card-p2"]  // may need to use role/text
SCREENSHOT mapshistory/10-discard-alert.png
```

### Scenario 11 — Tap synced card, expand

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'e1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-3600000, endedAt: Date.now(), durationS: 3600, distanceM: 5000, elevationGainM: 200, trackPoints: [{lat:-36.85,lng:174.76,t:Date.now()-3600000},{lat:-36.86,lng:174.77,t:Date.now()}], markerIds: [], syncState: 'synced', name: 'Emerald Lakes' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/11-expanded.png
```

### Scenario 12 — View on Map

```
CLICK "View on Map"
WAIT 500
SCREENSHOT mapshistory/12-viewonmap.png
```

### Scenario 13 — Hiking mode color

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'h1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-3600000, endedAt: Date.now(), durationS: 3600, distanceM: 5000, elevationGainM: 200, trackPoints: [], markerIds: [], syncState: 'synced' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/13-hiking.png
```

### Scenario 14 — Running mode color

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'r1', activityMode: 'running', regionCode: 'nz', startedAt: Date.now()-1800000, endedAt: Date.now(), durationS: 1800, distanceM: 5000, elevationGainM: 30, trackPoints: [], markerIds: [], syncState: 'synced' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/14-running.png
```

### Scenario 15 — Session with markers

```
EVALUATE window.__cairnStores.useMarkerStore.setState({ markers: [{id:'m1',lat:-36.855,lng:174.765,type:'water',regionCode:'nz',createdAt:Date.now()-3000000,note:'Stream',permission:'personal'},{id:'m2',lat:-36.858,lng:174.768,type:'cairn',regionCode:'nz',createdAt:Date.now()-2000000,note:'Summit',permission:'personal'}] })
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'wm1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-3600000, endedAt: Date.now(), durationS: 3600, distanceM: 5000, elevationGainM: 200, trackPoints: [{lat:-36.85,lng:174.76,t:Date.now()-3600000},{lat:-36.86,lng:174.77,t:Date.now()}], markerIds:['m1','m2'], syncState: 'synced' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/15-with-markers.png
```

### Scenario 17 — Very short session

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'sh1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-5000, endedAt: Date.now(), durationS: 5, distanceM: 12, elevationGainM: 0, trackPoints: [], markerIds: [], syncState: 'synced' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/17-nogps.png
```

### Scenario 18 — Very long session

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'lh1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-28800000, endedAt: Date.now(), durationS: 28800, distanceM: 25400, elevationGainM: 1200, trackPoints: [], markerIds: [], syncState: 'synced', name: 'Tongariro Alpine Crossing — Full Traverse Including Summit Detour' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/18-long-name-truncation.png
```

### Scenario 22 — Delete flow list mode

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'd1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-3600000, endedAt: Date.now(), durationS: 3600, distanceM: 5000, elevationGainM: 200, trackPoints: [], markerIds: [], syncState: 'synced', name: 'To Delete' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
CLICK "Delete Route"
WAIT 200
SCREENSHOT mapshistory/22a-delete-confirm.png
CLICK "Confirm Delete"
WAIT 500
SCREENSHOT mapshistory/22b-after-delete.png
```

### Scenario 23 — Delete flow detail mode

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'dd1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-3600000, endedAt: Date.now(), durationS: 3600, distanceM: 5000, elevationGainM: 200, trackPoints: [{lat:-36.85,lng:174.76,t:Date.now()-3600000},{lat:-36.86,lng:174.77,t:Date.now()}], markerIds: [], syncState: 'synced', name: 'DetailDelete' }] })
NAVIGATE http://localhost:8081/mapshistory?sessionId=dd1
WAIT 1500
SCREENSHOT mapshistory/23a-detail-mode.png
CLICK "Delete"
WAIT 200
SCREENSHOT mapshistory/23b-detail-confirm.png
```

### Scenario 24-26 — Viewports

```
NAVIGATE http://localhost:8081/mapshistory
RESIZE 375 667   // iPhone SE
WAIT 1000
SCREENSHOT mapshistory/24-se.png
RESIZE 393 852   // iPhone 15
WAIT 500
SCREENSHOT mapshistory/25-15.png
RESIZE 428 926   // Pro Max
WAIT 500
SCREENSHOT mapshistory/26-max.png
```

### Scenario 30 — Imperial units

```
EVALUATE window.__cairnStores.useSettingsStore.setState({ units: 'imperial' })
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id:'i1', activityMode:'hiking', regionCode:'nz', startedAt:Date.now()-3600000, endedAt:Date.now(), durationS:3600, distanceM:8000, elevationGainM:500, trackPoints:[], markerIds:[], syncState:'synced' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/30-imperial.png
```

### Scenario 31 — Loading state (hydrating trackpoints)

```
EVALUATE window.fetch = (url) => new Promise(() => {}) // hang all fetches
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id:'l1', remoteId:99999, activityMode:'hiking', regionCode:'nz', startedAt:Date.now()-3600000, endedAt:Date.now(), durationS:3600, distanceM:5000, elevationGainM:200, trackPoints:[], markerIds:[], syncState:'synced' }] })
NAVIGATE http://localhost:8081/mapshistory?sessionId=l1
WAIT 3000
SCREENSHOT mapshistory/31-loading-3s.png
WAIT 15000
SCREENSHOT mapshistory/32-timeout-16s.png
```

### Scenario 33 — Save as Route

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id:'sr1', activityMode:'hiking', regionCode:'nz', startedAt:Date.now()-3600000, endedAt:Date.now(), durationS:3600, distanceM:5000, elevationGainM:200, trackPoints:[{lat:-36.85,lng:174.76,t:Date.now()-3600000},{lat:-36.86,lng:174.77,t:Date.now()}], markerIds:[], syncState:'synced', name:'SaveTest' }] })
NAVIGATE http://localhost:8081/mapshistory?sessionId=sr1
WAIT 1500
SCREENSHOT mapshistory/33-save-enabled.png
```

### Scenario 34 — Save as Route disabled

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id:'sd1', activityMode:'hiking', regionCode:'nz', startedAt:Date.now()-3600000, endedAt:Date.now(), durationS:3600, distanceM:5000, elevationGainM:200, trackPoints:[], markerIds:[], syncState:'synced' }] })
NAVIGATE http://localhost:8081/mapshistory?sessionId=sd1
WAIT 1500
SCREENSHOT mapshistory/34-save-disabled.png
```

### Scenario 40 — Plan Route "coming soon"

```
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
CLICK "Plan"
WAIT 500
SCREENSHOT mapshistory/40-plan-coming-soon.png
```

### Scenario 41 — Long name truncation on grey card

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [{ id: 'lt1', activityMode: 'hiking', regionCode: 'nz', startedAt: Date.now()-3600000, endedAt: Date.now(), durationS: 3600, distanceM: 5000, elevationGainM: 200, trackPoints: [], markerIds: [], syncState: 'pending', name: 'Full Traverse of the Tongariro Alpine Crossing With Detour to Summit and Return Via Emerald Lakes' }] })
NAVIGATE http://localhost:8081/mapshistory
WAIT 1500
SCREENSHOT mapshistory/41-pending-truncation.png
```

### Scenario 46 — Deep-link to missing session

```
EVALUATE window.__cairnStores.useSessionStore.setState({ sessions: [] })
NAVIGATE http://localhost:8081/mapshistory?sessionId=does-not-exist
WAIT 1500
SCREENSHOT mapshistory/46-missing-session.png
```

---

## 4. Code-Level Issues (concrete file:line references)

### Critical / High

1. **`ScrollView` for up to 100 session cards** — `MapHistoryScreen.tsx:1208`. Should be `FlatList` matching `RoutesScreen` `ActivitiesTab` (line 744). Each `SessionCard` allocates 6 `Animated.Value` refs unconditionally at mount (line 443-450). 100 cards = 600 Animated.Value objects created on first render.

2. **Dead `flags` tab code** — `MapHistoryScreen.tsx:743, 1253-1298`. The `tab` state exists with `'routes' | 'flags'` type but the tab bar (lines 1099-1109) only renders the Routes button. The Flags branch is unreachable via UI. Either add the tab button or delete the state + branch. Per user memory `feedback_every_line_must_have_purpose`.

3. **No text truncation on card title / subtitle** — `MapHistoryScreen.tsx:1487, 1509, 1511`. `routeCardTitle`, `routePrimary`, `routeMeta` have no `numberOfLines={1}`. Long user-set names (up to whatever the stop-summary allows) will wrap and break layout. Per user memory `feedback_truncate_is_bug`, any clipping = bug. In this case the risk is the opposite — no clipping, so text overflows / wraps unexpectedly. Add `numberOfLines={1}` + `ellipsizeMode="tail"` and design for it.

4. **Delete button below list is disconnected from selected card** — `MapHistoryScreen.tsx:1239`. Deletes `selectedSession` but the selection is set by `View on Map`, not by expand. A user can expand card A, then scroll and hit Delete, which deletes the previously-selected session B without any indication.

5. **Deep-link into deleted session falls through to empty state** — `MapHistoryScreen.tsx:748-750`. `sessions.filter(s => s.id === targetSessionId)` returns `[]`; `selectedSession = null`; `targetSessionId && selectedSession` fails at line 1114; falls to list panel which renders empty state — inappropriate for a "session detail" deep link. Should render explicit "Session not found" with Back CTA.

6. **`Plan Route` button ships as `Alert.alert('Plan Route', 'Route planning coming soon')`** — `MapHistoryScreen.tsx:1088`. Dead affordance in production.

7. **`routePreviewCard` in expanded card is decorative-only** — `MapHistoryScreen.tsx:1559 + rendered at 626`. Contains topo rings and stat chips but no actual route line. The word "Preview" suggests the user should see their route; they see none. Either render an actual mini-preview (like `RoutesScreen`'s `RouteMapPreview`, line 233) or remove the "Preview" label.

### Medium

8. **`useEffect` deps `[]` for auto-select on mount** — `MapHistoryScreen.tsx:753-764`. Won't re-select on sessions array change. Consider `[sessions.length, targetSessionId]`.

9. **`isLoadingTrackPoints` renders `null` in map area** — `MapHistoryScreen.tsx:1003`. Blank green rectangle for up to 15s during server fetch. Add a subtle centered spinner + "Loading route…" label.

10. **`No GPS` label for short sessions is misleading** — `MapHistoryScreen.tsx:440`. `distanceM < 20` triggers "No GPS" but the actual cause is often "didn't move enough". Rename to "Too short" or "0 m".

11. **Grey pending card visual weight — no clickable feedback** — `MapHistoryScreen.tsx:534-565`. `activeOpacity={1}` + noop `onPress` = tap does nothing, feels broken. Consider showing a small hint on tap ("Long-press to discard") or removing the noop TouchableOpacity entirely.

12. **`CloudOff` icon used for both `pending` and `syncing`** — `MapHistoryScreen.tsx:558`. Semantically wrong for syncing state. Use `UploadCloud` or an `ActivityIndicator` when syncing.

13. **`delayLongPress={800}` too slow** — `MapHistoryScreen.tsx:538`. iOS convention is 500ms.

14. **No haptic on card tap / long-press** — throughout. `RoutesScreen` uses `haptic.impact('light')` (e.g. line 893) on state changes. MapHistoryScreen doesn't call haptic at all.

15. **Hardcoded SVG-fallback marker grid** — `MapHistoryScreen.tsx:1067-1068`. `left: 60 + (i%4)*75, top: 120 + (i%3)*70`. For >12 markers, they overlap. Purely decorative in that path but visually broken.

16. **`useNativeDriver: false` on height interpolation** — `MapHistoryScreen.tsx:459`. Comment acknowledges this is JS-driven; on low-end Android it will jank when 5+ cards expand/collapse in sequence.

17. **`markers.slice(0, 8)` when no session selected** — `MapHistoryScreen.tsx:988`. Silent 8-cap with no user indication; user may have 50 markers and only see 8.

18. **Missing loading UI during 15s timeout** — `MapHistoryScreen.tsx:804`. If server hangs, user sees blank green area, then eventually "Route data unavailable". No intermediate spinner.

19. **`session.trackPoints` from `sessions` store is always `[]`** — the store's `hydrate()` (useSessionStore.ts:189-192) rebuilds sessions with `trackPoints: []`. So `TrackPolyline` is triggered only via `loadedTrackPoints`. But `selectedSession` (line 774) is derived from `sessions`, so any downstream code that reads `selectedSession.trackPoints` directly (e.g., `session.markerIds.length` is fine, but `trackPoints.length` is 0 always). This is the "Save as Route always grey" pattern noted in the code comment (line 1137). Any new consumer must remember this quirk.

### Low / Nice-to-have

20. **No filter / sort UI at all** — feature gap vs RoutesScreen. Adding FilterSortBar would unify the two screens.

21. **Two different card designs for the same entity** — MapHistoryScreen `SessionCard` vs RoutesScreen `ActivitiesTab` card. Choose one; user's mental model expects consistency.

22. **Empty state divergence** — MapHistoryScreen has a CTA "Start a Hike"; RoutesScreen has just illustration + copy. Pick one pattern.

23. **`routeLine1/2/3` decorative fallback lines** — `MapHistoryScreen.tsx:1323-1334`. When no session selected, three colored lines float on the map. Looks like unfinished UI. Consider removing or replacing with a subtle topo pattern.

24. **`Route Map` title in Mode A** — user coming from Home > History would expect a title like "History" or "Activities". Currently reads "Route Map".

25. **`FontSize.caption` (13px) on `trackStatValue`** — `MapHistoryScreen.tsx:1361`. Too small for a primary stat display; the four numbers on the map overlay bar are hard to read.

26. **Save-as-Route + Delete equal-weight buttons in detail mode** — `MapHistoryScreen.tsx:1130-1201`. Destructive Delete should be less visually prominent than the primary action (Save as Route).

27. **`Route Preview` label removed but layout still says `Preview`** — comment at line 643 says renamed from "Route Preview" to "Preview". Just "Preview" alone is meaningless. Either drop the label or make it descriptive.

28. **`nav.replace('Hiking')` on empty CTA** — `MapHistoryScreen.tsx:1216`. `replace` (not `navigate`) removes MapHistory from the back stack. User then can't press back to return to where they were. Should be `nav.navigate`.

29. **`memoryNewCells` never displayed on history card** — `useSessionStore.ts:43`. This is a delta the user cares about but it's only shown at stop-summary time. Consider surfacing on the expanded card ("+3.2 km² new").

30. **Delete button uses `cardStyles.deleteBtn` in both list mode and detail mode** — but wrapping style differs. Detail mode adds `flex: 1`, list mode is full-width. Minor visual inconsistency.

---

## 5. Priority Summary

| Priority | Count | IDs |
|---|---|---|
| **Blocker** | 0 | — |
| **Critical** | 6 | #6 (100 sessions perf), #22 (delete decoupled from selection), #36 (dead flags tab), #41 (title truncation), #46 (deep-link to missing session), #2 (no hydrating state distinction from empty) |
| **Medium** | 15 | #7, #8, #11, #17, #21, #27, #31, #32, #40, #47, #49, plus code-level 8-12, 14, 17-18 |
| **Low** | 20+ | Various — see code-level 19-30 and scenario-column L flags |

**Top 3 to fix first**:
1. **Migrate `ScrollView` → `FlatList`** and cap on-mount Animated.Value allocation to lazy-per-expand. This is Blocker-adjacent for 100-session users.
2. **Remove dead `flags` tab code OR restore the tab button**. This is code hygiene per `feedback_every_line_must_have_purpose`.
3. **Reconcile card style with `RoutesScreen ActivitiesTab`**. Same entity, two visual languages is a Product Soul violation.

**Longer-term** — the entire MapHistoryScreen overlaps significantly with RoutesScreen `ActivitiesTab` + a session-detail sheet. Consider whether MapHistoryScreen should be reduced to Mode B only (single-session detail), with all list/browse behavior consolidated to RoutesScreen. This would remove ~600 lines of divergent code and eliminate consistency debt.
