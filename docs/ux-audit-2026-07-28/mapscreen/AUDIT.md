# MapScreen UX/UI Audit — 2026-07-28

## Screen summary
MapScreen is the primary map view for the Cairn hiking app — a full-bleed Mapbox map (with a fallback illustration when native Mapbox is unavailable) that renders user-planted flag markers (self / friend / stranger tiers with different visual treatments), a top overlay bar with Back + GPS chips, a bottom overlay containing a floating "plant flag" FAB with a badge count, and a MapBottomPanel listing nearby markers. Users can tap markers to open a MarkDetailSheet (like / report / hide / edit / delete flows), long-press FAB to open the CreateMarkerSheet (4-card flag type grid + note + permission pills), or open OfflineMapSheet. In `viewOnly` mode (deep-link from another screen with `focusMarkerId`) the bottom controls are hidden and the EditMarkerSheet auto-opens. The screen also serves as the launcher for downloading offline tiles.

Compared to the polished SettingsScreen baseline (O12–O16, Mockup 5 Option A), MapScreen carries visible legacy debt: mixed marker rendering paths (Mapbox `PointAnnotation` vs. positional `PressableMarker` in fallback), a hardcoded amber "Enable GPS" chip that never reads real GPS state, absent loading/empty/error states, and a bottom panel that duplicates the marker list without any relationship to the FAB context. Numerous CTAs live in absolute overlays that are not tuned for the 44pt safe-area top notch on iPhone 14 Pro / Pro Max.

---

## Scenarios

| # | 功能 | 小功能 | 场景 | 预期UI | 一致性 | UX | Issues |
|---|------|--------|------|--------|--------|-----|--------|
| 1 | Map load | Cold start (Mapbox native available) | First tab entry, no cached tiles, WiFi | Map area fills screen; tiles paint within ~1.5s; top-left Back + GPS chips render; bottom FAB visible; NO blank/gray gap while tiles load | 5 | 4 | 破碎: no loading state — `mapContainer` shows only `primaryBg` sage green while tiles load. On slow networks this is 3-8s of blank sage screen with no spinner/skeleton. Contrast to SettingsScreen which never has an ambiguous mid-state. |
| 2 | Map load | Fallback (Expo Go, no Mapbox native) | Dev environment, `MapView` null | `mapFallback` shows Map icon + "Real Map Available" + "Build with EAS…" copy; markers appear at approximate grid positions | 6 | 6 | 不一致: `mapFallbackTitle` uses `FontSize.h3` + weight 600, but SettingsScreen equivalents use weight 700. 丑: fallback copy "Build with EAS to enable Mapbox\noutdoor maps with offline support" is developer-speak leaked into a user-facing branch. If a real user ever hits this (Expo Go tester) the message means nothing. |
| 3 | Map load | Empty state — 0 markers | Fresh account, `storeMarkers.length === 0` | Map paints; FAB visible with NO badge; MapBottomPanel shows an empty state row ("No cairns yet — plant your first flag") | 3 | 3 | 破碎: `MapBottomPanel` receives `storeMarkers.map(...)` unconditionally. When empty, panel likely collapses or shows empty rows — no dedicated empty state copy in MapScreen. First-time users see a blank panel with no explanation of what it's for. |
| 4 | Map load | Marker cluster / dense zoom-out | 100+ markers at country zoom | Markers should cluster or de-densify; individual pins not readable at zoom 4-8 | 2 | 3 | 破碎: NO clustering implemented. Every marker renders as `PointAnnotation` individually. At `minZoomLevel={4}` NZ map view, hundreds of overlapping 32x32 pins destroy the map. Also perf: 500 markers = 500 native views. |
| 5 | Top bar | Back chip on iPhone 14 Pro (Dynamic Island) | 393x852, notch = 44pt | Back chip padded below safe area top inset | 6 | 5 | 破碎: `topBar` uses `paddingTop: Spacing.lg` = 20px on top of `SafeAreaView edges={['top']}`, but on iPhone 14 Pro this stacks to 64pt from screen top — Back chip may overlap Dynamic Island area if `SafeAreaView` doesn't compute correctly. Also `backChipText` uses `FontSize.small` = 11pt — smaller than SettingsScreen's `BackButton` label. |
| 6 | Top bar | GPS chip — permission granted, no fix yet | User granted location perms but no coordinate yet | GPS chip amber "Enable GPS" with warning dot | 2 | 1 | 破碎 (critical): `gpsChip` is HARDCODED — line 704-706 `<View style={styles.gpsChip}><View style={[styles.gpsDot, { backgroundColor: Colors.severityWarning }]} />` always shows amber "Enable GPS" regardless of actual permission or fix. The chip text `"Enable GPS"` never reflects "Ready", "Searching", "Denied", "Off". 破碎 also: `gpsDot` style declares `backgroundColor: Colors.success` (line 946), but the inline style overrides to warning — dead style declaration. |
| 7 | Top bar | GPS chip tap | User taps "Enable GPS" chip | Chip should open iOS Settings > Location OR trigger permission request | 1 | 1 | 破碎 (blocker): `gpsChip` has NO `onPress` handler — it's a `<View>`, not a `TouchableOpacity`. Users see an amber "Enable GPS" call-to-action that is completely inert. User taps → nothing happens. This is textbook fake affordance. |
| 8 | Top bar | Back chip → previous screen | User taps Back from map tab entry | `nav.goBack()` returns to prior stack entry | 5 | 3 | 破碎: if MapScreen is the initial route of a tab, `nav.goBack()` may pop off the stack unexpectedly. No guard `if (nav.canGoBack())`. On main tab entry (no prior screen), Back chip is either a no-op or dumps user to Auth. SettingsScreen has same code path but is always deep-linked (safer). |
| 9 | Marker rendering | Self-tier flag pin (own marker) | Own marker `authorId === viewerId`, permission=personal | 32x32 pin, colored border, rgba(255,255,255,0.85) bg, flag icon inside, full opacity, no ring | 7 | 7 | 不一致: `markerPin` uses `borderColor: meta.color, backgroundColor: 'rgba(255,255,255,0.85)'` (line 181) but fallback path uses `bg={meta.bg}` (line 124). Two rendering paths for the same tier produce visibly different marker fills. |
| 10 | Marker rendering | Friend-tier flag pin | Marker `authorId ∈ friendIds` | Same 32x32 pin, PLUS 36x36 offset ring in `ringColor` (per friend user_id) | 7 | 7 | 一致: `markerFriendRing` positioned absolutely (offset -2/-2, borderRadius 18). Looks correct on paper. 丑: friend ring uses `borderWidth: 2` — at some `ringColor` values (light pastels) the ring is nearly invisible on the sage `mapBg`. No contrast fallback. |
| 11 | Marker rendering | Stranger-tier flag pin | Marker not own, not friend, public | Pin at opacity 0.6, no ring | 6 | 6 | 丑: opacity 0.6 desaturation is applied to the entire wrapper `<View style={{ opacity }}>`, which affects the icon color inside — icons at `strokeWidth={2.5}` become washed out and hard to see against `rgba(255,255,255,0.85)` fill on light map tiles. |
| 12 | Marker interaction | Tap marker → open MarkDetailSheet | Tap own flag | Detail sheet slides in from bottom; shows form A (own tier with Edit + Delete) | 7 | 7 | Delegated to `MarkDetailSheet` — not rated here. Confirmed: `onSelected={() => onMarkerPress(m)}` is wired for Mapbox path (line 175). Fallback `PressableMarker` (line 128) uses onPress instead. |
| 13 | Marker interaction | Rapid double-tap | Tap marker twice within 200ms | Detail sheet opens once; second tap ignored (or closes → reopens gracefully) | 4 | 4 | 破碎 (potential): `setDetailMarker(m)` called on each tap. If Mapbox debounces `onSelected` that's fine; if not, two rapid taps could fire two state updates, causing sheet close+reopen animation stutter. No debounce guard. Same risk on `PressableMarker` — no `disabled` state during animation. |
| 14 | Marker interaction | Tap stranger marker | Non-friend public marker | Detail sheet opens showing form B (stranger UI with Like + Report + Hide, no Edit) | 7 | 6 | 一致 (delegated to `MarkDetailSheet`). Not testable here. Concern: opacity 0.6 stranger pins may be TOO subtle to look tappable — users may not know they can interact. |
| 15 | FAB | Plant Flag FAB — initial | No markers, viewOnly=false | 60x60 circle, `Colors.primary` bg, MapPin icon 22px, no badge | 8 | 7 | 一致 with SettingsScreen quality. 丑 (minor): FAB uses `Shadow.fab` with `shadowColor: '#5d7c46'` — nice colored shadow. But `MapPin` icon is 22px inside 60px button = huge padding, feels underweight. Compare to SettingsScreen ActionRow which uses `IconSize.md` = 22px inside a smaller container. |
| 16 | FAB | Badge count 1 flag | User plants one flag | Red badge top-right showing "1" | 7 | 8 | Correct. `fabBadge` uses `Colors.danger` (#c53d2e) with 2px white border — consistent with app-wide red badges. |
| 17 | FAB | Badge count 3 digits | 100+ flags | Badge scales/wraps? Or truncates? | 3 | 3 | 破碎: `fabBadge` `minWidth: 18, paddingHorizontal: 4` — for 3-digit counts (e.g. "247"), badge grows RIGHTward off the FAB, breaks alignment. Also text `FontSize.small` = 11pt could clip if 4 digits. No "99+" convention. |
| 18 | FAB | Tap → CreateMarkerSheet | User taps FAB | Sheet slides up from bottom (280ms cubic ease-out), showing 4-card grid + note + perm pills + Save | 8 | 8 | 一致 with SettingsScreen sheet quality. Animations tuned (`slideAnim` 400→0, `opacityAnim` 0→1). Handle bar, close X, sheet header row all match. |
| 19 | CreateMarkerSheet | Flag type card — unselected | User has not picked a type | 4 cards in a row, each with LinearGradient icon badge, label, Colors.border 1.5px | 7 | 7 | 一致 with SettingsScreen. Cards use `Shadow.card`. 丑: on iPhone SE (375w), 4 cards in a row with `Spacing.sm` gap = 8px → each card ≈ 78px wide. `typeCardLabel` at `FontSize.small` = 11pt with `fontWeight: '700'` — labels like "Milestone" or "Landmark" (>8 chars) may WRAP or truncate. Truncation = Critical per feedback_truncate_is_bug. |
| 20 | CreateMarkerSheet | Flag type card selected state | User taps flag card | `typeCardSelected` — primary border, primaryBg fill, CircleCheck at top-right | 8 | 8 | 正确. Haptic light impact fires on select. CircleCheck at absolute top:6/right:6 doesn't collide with label. |
| 21 | CreateMarkerSheet | Note input focused | User taps textarea | Border switches to `Colors.primary`; placeholder color reads well | 7 | 8 | 正确. `noteInput` `minHeight: 70`. `textAlignVertical: 'top'` set. Character counter appears when focused or has content. |
| 22 | CreateMarkerSheet | Note input at 40 chars | User types 40+ chars | Counter turns amber (`severityCaution`) | 8 | 8 | 正确 (3-tier system: default → amber@40 → red@50). |
| 23 | CreateMarkerSheet | Note input at 50 chars | User types the last character | Counter red, input border red (`noteInputError`), further typing blocked by `.slice(0, 50)` | 8 | 8 | 正确, and text-truncation blocked at the source (slice). |
| 24 | CreateMarkerSheet | Permission pill row | User picks perm | 3 outlined pills (Only me / Friends / Public), active pill primary border+bg | 7 | 8 | 正确. 丑 (minor): `Spacing.xs` = 4px vertical padding — pills feel a bit cramped compared to the 44pt hit target. Icon+text combo is `paddingHorizontal: Spacing.sm` = 8px. |
| 25 | CreateMarkerSheet | Save button disabled | No type selected yet | Save button gray (`Colors.border` bg), text muted | 7 | 7 | 正确, but the disabled state uses `Colors.border` = #ece6de which is nearly the same as the sheet bg (`Colors.surface` #ffffff). Contrast is fine but visual weight suggests "invisible button" rather than "waiting". |
| 26 | CreateMarkerSheet | Save button pressed while at unknown GPS | User taps Save with no `lastCoord` | Marker created at `region.centerLat/centerLng` fallback | 5 | 3 | 破碎: `handleAddMarker` silently plants the marker at the region CENTER when `lastCoord` is null (line 674-675). User sees a flag appear at Wellington centroid regardless of where they are. NO error alert, no "Waiting for GPS…" state. Data-integrity bug — plants ghost markers in wrong locations. |
| 27 | CreateMarkerSheet | Permission pill state | User picks Public, then re-opens sheet later | Permission resets to `personal` — user has to re-select every time | 4 | 3 | 破碎 (UX): `setPermission('personal')` initial state in `useState`. User's last chosen permission is not persisted. Contrast to SettingsScreen where every choice auto-persists. Users planting many public flags will hate this. |
| 28 | EditMarkerSheet | Auto-open in viewOnly deep-link | Route param `focusMarkerId` present | EditMarkerSheet opens directly, bottom controls hidden | 6 | 5 | 一致 (implementation correct — line 649-657). 破碎: when in `viewOnly`, the map is still rendered full-bleed, and the map camera does NOT recenter on the focused marker. User sees the sheet but the map behind it is at the default region — no visual connection between "you're viewing this flag" and "here is its location on the map". |
| 29 | EditMarkerSheet | Delete confirm | User taps Delete in edit sheet | Alert.alert with note-based body ("Delete \"note\"? This cannot be undone.") | 8 | 7 | 一致. Confirmation copy is factual and cite-able. 丑: uses native `Alert.alert` — SettingsScreen has moved to custom Type-to-Confirm modals for destructive actions. Inconsistent tone between destructive-alert styles across screens. |
| 30 | MapBottomPanel | Panel visible on map load | viewOnly=false | Bottom panel above FAB shows marker list with distance, offline button visible | 6 | 6 | 一致 with card system. 破碎 (potential): `MapBottomPanel` is rendered as an ABSOLUTE overlay per its own styling (not shown here) — on iPhone SE (812h) it may OVERLAP the FAB or shrink the visible map to <50% height. No collapsed state provided. |
| 31 | MapBottomPanel | Distance format | Marker 500m away, imperial user | "0.3 mi" or "1640 ft" per unit setting | 8 | 8 | 一致. `dist.formatShort(dm)` uses `useDistance` hook — settings-aware. |
| 32 | MapBottomPanel | Time-ago format | Marker created 3 days ago | Locale date `new Date(m.createdAt).toLocaleDateString()` | 3 | 3 | 破碎: NOT a time-ago — just a locale date. "3 days ago" or "2h" is the mobile expectation. Also `toLocaleDateString()` on iOS may produce inconsistent formats across users (e.g. "7/28/2026" vs "28/07/2026"). Cross-user inconsistency. |
| 33 | OfflineMapSheet | Open from bottom panel | User taps offline button | Sheet slides up, download options visible | 7 | 7 | Delegated to `OfflineMapSheet`. Not deeply auditable from MapScreen. Confirmed wiring correct. |
| 34 | Permissions denied | Location perms denied at OS level | `lastCoord === null` permanently | GPS chip amber; FAB tap → Alert "Location unavailable" | 4 | 3 | 破碎: only the like/report Alerts show "Enable location to like/report marks." — Plant Flag path DOES NOT check perms. User can plant flags at the region center forever. No unified permission-prompt UX. |
| 35 | GPS lost mid-session | User had fix, then loses signal | `lastCoord` stale | UI should indicate stale fix (e.g. gray puck, "Last seen 2m ago") | 2 | 2 | 破碎: NO stale-fix indicator. GPS chip is hardcoded amber regardless. No `lastCoordinateTs` age check. Users planting flags on a hike with intermittent signal will plant at the last-known fix without warning. |
| 36 | Offline network | Airplane mode | Tiles cached OR blank | Cached tiles paint; markers still render from local store | 5 | 5 | 一致 if offline pack exists. 破碎: no visible "You're offline" banner. `loadCircleMarkers` and `loadSubscriptions` will silently fail — the `catch`-less pattern in the useEffect (line 601-611) means fetch errors surface as nothing at all. |
| 37 | Sim-walker overlay | Debug mode on | `debugMode` in useSettingsStore | Sim-walker overlay visible on HikingScreen but NOT MapScreen | N/A | N/A | 不一致 (design gap): sim-walker is HikingMap-only. MapScreen has no debug puck, no sim-walker interaction. Question: is this intentional? If user has debugMode on and expects sim-walker in the main map, they'll be confused. |
| 38 | Route overlay | Selected route from another screen | User picked a route in Trails, deep-links to Map with `routeStart` | Dashed approach line from user to trailhead, "Start" pin at route start | N/A | N/A | 破碎 (feature parity): `HikingMap` supports `routeStart` + `userPos` approach line. `MapScreen`'s `RealMap` does NOT accept `routeStart`. A user who taps "Show on map" from a Trails route lands here without visual guidance to the trailhead. |
| 39 | Viewport iPhone 14 Pro (393x852) | Dynamic Island top | Safe area top ≈ 59pt | Top chips clear of Island | 6 | 5 | 破碎 (borderline): `SafeAreaView edges={['top']}` handles inset but `paddingTop: Spacing.lg` (20) adds on top — Back chip may sit 79pt from top, feels wasteful; on smaller phones same padding is fine. Not viewport-responsive. |
| 40 | Viewport iPhone Pro Max (428x926) | Larger canvas | More map area | Everything scales | 7 | 7 | Layout scales fine — chips and FAB are fixed-size, map fills remaining. Bottom panel may look under-populated with lots of whitespace around it. No responsive typography. |
| 41 | Viewport iPhone SE (375x667) | Short screen | 645pt content height (SafeArea) | Bottom panel + FAB compete for space | 3 | 3 | 破碎: on 667h device, top bar (~80pt) + bottom panel (~200pt) + FAB (60pt) + safe areas eat ~450pt. Map area ≈ 200pt tall. UX is essentially a marker list with a tiny map thumbnail. No responsive collapse. |
| 42 | State transition | Enter map from Home tab | User taps Map tab | Camera fly-in from default region OR skip to user location | 5 | 6 | 破碎: `RealMap` Camera uses `defaultSettings` only — no camera fly-to-user on entry. First-time users see NZ centroid, not their location. Contrast to HikingMap which uses `followUserLocation` and `flyTo` animations. |
| 43 | State transition | Exit map (background) | User backgrounds app then returns | Map should resume at last state | 5 | 6 | 一致. Mapbox retains camera. But `lastCoord` may become stale — no re-fetch on foreground. |
| 44 | Loading state | `loadingCircle === true` | Friend markers loading | Bottom panel should show skeleton OR loading indicator | 2 | 2 | 破碎: `loadingCircle` is read (line 558) but NEVER rendered in UI. Fetch failures + loading state are completely invisible to the user. |
| 45 | Error state | Circle markers fetch fails | Network error on `/api/circle-marks` | Toast or banner error | 1 | 1 | 破碎: `loadCircleMarkers()` errors are swallowed (`void` prefix in effect, no `.catch()`). No UI feedback. User has no clue their friends' flags failed to load. |
| 46 | Bottom panel | Panel with 1 marker | Single marker in store | Panel shows one row cleanly | 6 | 6 | 未验证 — `MapBottomPanel` internal styling is opaque here. Assumption: uses `Colors.surface` cards. |
| 47 | Bottom panel | Panel scroll with 50 markers | Lots of markers | Panel should scroll cleanly | 5 | 5 | Unknown behavior — depends on `MapBottomPanel` impl. Concern: if panel auto-expands to full-screen, FAB disappears. If panel stays fixed height, user can't discover more than 3-4 markers. |
| 48 | Marker cluster expand | Tap cluster (not implemented) | User taps a cluster (N/A) | N/A | N/A | N/A | See scenario #4 — clustering doesn't exist. |
| 49 | User location pin | Mapbox UserLocation puck | `UserLocation visible={true} renderMode="native"` | Blue Apple puck | 7 | 7 | 一致 with iOS conventions. `renderMode="native"` uses hardware Core Location — behaves standard. But when GPS is inaccurate, no accuracy circle drawn (default behavior varies by SDK). |
| 50 | User location pin | User outside NZ (region default) | GPS says user is in Australia | Map centered on NZ default; user puck offscreen | 3 | 2 | 破碎: `getCurrentRegion()` is hardcoded to a single region (per config). Non-NZ users see NZ map with their puck off the visible tile — confusing. No "Center on me" button. |

---

## Playwright script

Note: web bypass is enabled — assumes `http://localhost:8081` runs the Expo web build with `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true` and `window.__cairnStores` exposed. Selectors default to text-based where possible.

### Scenario 1: Map load cold start (Mapbox native)
```
NAVIGATE http://localhost:8081/map
WAIT 500
RESIZE 375 812
SCREENSHOT mapscreen/01-cold-load-t500ms-iphone.png
WAIT 1500
SCREENSHOT mapscreen/01-cold-load-t2s-iphone.png
WAIT 3000
FULLPAGE_SCREENSHOT mapscreen/01-cold-load-final-full.png
```

### Scenario 2: Fallback / Expo Go message
```
NAVIGATE http://localhost:8081/map
WAIT 1500
RESIZE 375 812
SCREENSHOT mapscreen/02-fallback-message-iphone.png
```

### Scenario 3: Empty state (0 markers)
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useMarkerStore.getState().markers = []; window.__cairnStores.useMarkerStore.setState({ markers: [] });
WAIT 1500
RESIZE 375 812
SCREENSHOT mapscreen/03-empty-state-iphone.png
FULLPAGE_SCREENSHOT mapscreen/03-empty-state-full.png
```

### Scenario 4: Dense markers (100+)
```
NAVIGATE http://localhost:8081/map
EVALUATE (() => { const mk = window.__cairnStores.useMarkerStore.getState(); const gen = Array.from({length:120},(_,i)=>({id:'m'+i,type:'free',regionCode:'NZ',lat:-41.28+Math.random()*0.5,lng:174.77+Math.random()*0.5,note:'test',authorId:'x',permission:'public',createdAt:Date.now()})); window.__cairnStores.useMarkerStore.setState({ markers: gen }); })()
WAIT 2000
RESIZE 375 812
SCREENSHOT mapscreen/04-dense-markers-iphone.png
FULLPAGE_SCREENSHOT mapscreen/04-dense-markers-full.png
```

### Scenario 5: iPhone 14 Pro top bar (Dynamic Island)
```
NAVIGATE http://localhost:8081/map
WAIT 1500
RESIZE 393 852
SCREENSHOT mapscreen/05-topbar-iphone14pro.png
```

### Scenario 6: GPS chip hardcoded "Enable GPS"
```
NAVIGATE http://localhost:8081/map
WAIT 1500
RESIZE 375 812
SCREENSHOT mapscreen/06-gps-chip-hardcoded.png
```

### Scenario 7: GPS chip tap (should do nothing — bug)
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK Enable GPS
WAIT 500
SCREENSHOT mapscreen/07-gps-chip-tap-no-response.png
```

### Scenario 8: Back chip tap
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK Back
WAIT 500
SCREENSHOT mapscreen/08-back-chip-tap-result.png
```

### Scenario 9: Self-tier marker
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useMarkerStore.setState({ userId: 'me', markers: [{id:'m1',type:'free',regionCode:'NZ',lat:-41.28,lng:174.77,note:'own',authorId:'me',permission:'personal',createdAt:Date.now()}] });
WAIT 1500
RESIZE 375 812
SCREENSHOT mapscreen/09-self-marker-iphone.png
```

### Scenario 10: Friend-tier marker with ring
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useMarkerStore.setState({ userId: 'me', markers: [{id:'m2',type:'free',regionCode:'NZ',lat:-41.28,lng:174.77,note:'friend',authorId:'friend1',permission:'group',createdAt:Date.now()}] }); window.__cairnStores.useFriendStore.setState({ friends: [{id:'friend1',name:'Alice'}] });
WAIT 1500
SCREENSHOT mapscreen/10-friend-marker-ring-iphone.png
```

### Scenario 11: Stranger-tier marker (opacity 0.6)
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useMarkerStore.setState({ userId: 'me', markers: [{id:'m3',type:'free',regionCode:'NZ',lat:-41.28,lng:174.77,note:'stranger',authorId:'other',permission:'public',createdAt:Date.now()}] });
WAIT 1500
SCREENSHOT mapscreen/11-stranger-marker-desat-iphone.png
```

### Scenario 12: Tap marker → detail sheet
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK [data-marker-id]
WAIT 800
SCREENSHOT mapscreen/12-detail-sheet-open-iphone.png
FULLPAGE_SCREENSHOT mapscreen/12-detail-sheet-open-full.png
```

### Scenario 13: Rapid double-tap
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK [data-marker-id]
CLICK [data-marker-id]
WAIT 500
SCREENSHOT mapscreen/13-double-tap-race-iphone.png
```

### Scenario 15: FAB initial
```
NAVIGATE http://localhost:8081/map
WAIT 1500
RESIZE 375 812
SCREENSHOT mapscreen/15-fab-initial-iphone.png
```

### Scenario 16: FAB with 1-count badge
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useMarkerStore.setState({ markers: [{id:'m1',type:'free',regionCode:'NZ',lat:-41.28,lng:174.77,authorId:'me',permission:'personal',createdAt:Date.now()}] });
WAIT 800
SCREENSHOT mapscreen/16-fab-badge-1.png
```

### Scenario 17: FAB with 247-count badge (overflow)
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useMarkerStore.setState({ markers: Array.from({length:247},(_,i)=>({id:'m'+i,type:'free',regionCode:'NZ',lat:-41.28,lng:174.77,authorId:'me',permission:'personal',createdAt:Date.now()})) });
WAIT 800
SCREENSHOT mapscreen/17-fab-badge-247-overflow.png
```

### Scenario 18: FAB tap → CreateMarkerSheet
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK MapPin
WAIT 500
SCREENSHOT mapscreen/18-create-sheet-open-iphone.png
FULLPAGE_SCREENSHOT mapscreen/18-create-sheet-open-full.png
```

### Scenario 19: Create — unselected type cards on iPhone SE
```
NAVIGATE http://localhost:8081/map
WAIT 1500
RESIZE 375 667
CLICK MapPin
WAIT 500
SCREENSHOT mapscreen/19-typecards-unselected-iphonese.png
```

### Scenario 20: Create — selected type card
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK MapPin
WAIT 500
CLICK Free
WAIT 300
SCREENSHOT mapscreen/20-typecard-selected-iphone.png
```

### Scenario 21: Note input focused
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK MapPin
WAIT 500
CLICK textarea[placeholder*="Describe"]
WAIT 300
SCREENSHOT mapscreen/21-note-input-focused-iphone.png
```

### Scenario 22: Note input at 40 chars (amber)
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK MapPin
WAIT 500
TYPE textarea[placeholder*="Describe"] Forty characters is here well and okay ok
WAIT 300
SCREENSHOT mapscreen/22-note-40char-amber-iphone.png
```

### Scenario 23: Note input at 50 chars (red)
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK MapPin
WAIT 500
TYPE textarea[placeholder*="Describe"] Fifty characters exactly is here to test the maxx
WAIT 300
SCREENSHOT mapscreen/23-note-50char-red-iphone.png
```

### Scenario 24: Permission pill row
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK MapPin
WAIT 500
CLICK Public
WAIT 300
SCREENSHOT mapscreen/24-perm-public-active-iphone.png
```

### Scenario 25: Save button disabled state
```
NAVIGATE http://localhost:8081/map
WAIT 1500
CLICK MapPin
WAIT 500
SCREENSHOT mapscreen/25-save-disabled-iphone.png
```

### Scenario 26: Save with no GPS fix
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useTrackingStore.setState({ lastCoordinate: null });
WAIT 1500
CLICK MapPin
WAIT 500
CLICK Free
WAIT 200
CLICK Plant Flag
WAIT 800
SCREENSHOT mapscreen/26-save-no-gps-silent-plant.png
FULLPAGE_SCREENSHOT mapscreen/26-save-no-gps-full.png
```

### Scenario 28: viewOnly deep link
```
NAVIGATE http://localhost:8081/map?focusMarkerId=m1
WAIT 1500
RESIZE 375 812
SCREENSHOT mapscreen/28-viewonly-mode-iphone.png
FULLPAGE_SCREENSHOT mapscreen/28-viewonly-mode-full.png
```

### Scenario 29: Delete confirm alert
```
NAVIGATE http://localhost:8081/map?focusMarkerId=m1
WAIT 1500
CLICK Delete
WAIT 500
SCREENSHOT mapscreen/29-delete-alert-iphone.png
```

### Scenario 30: Bottom panel default
```
NAVIGATE http://localhost:8081/map
WAIT 1500
RESIZE 375 812
FULLPAGE_SCREENSHOT mapscreen/30-bottom-panel-default.png
```

### Scenario 32: Bottom panel time-ago (locale date bug)
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useMarkerStore.setState({ markers: [{id:'m1',type:'free',regionCode:'NZ',lat:-41.28,lng:174.77,note:'old',authorId:'me',permission:'personal',createdAt:Date.now()-259200000}] });
WAIT 1500
SCREENSHOT mapscreen/32-bottom-panel-time-ago-bug.png
```

### Scenario 34: Permission denied — try to plant
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useTrackingStore.setState({ lastCoordinate: null });
WAIT 1500
CLICK MapPin
WAIT 500
CLICK Free
WAIT 200
CLICK Plant Flag
WAIT 500
SCREENSHOT mapscreen/34-no-perm-plant-silent.png
```

### Scenario 39: iPhone 14 Pro Dynamic Island
```
NAVIGATE http://localhost:8081/map
WAIT 1500
RESIZE 393 852
SCREENSHOT mapscreen/39-iphone14pro-island.png
FULLPAGE_SCREENSHOT mapscreen/39-iphone14pro-full.png
```

### Scenario 40: iPhone Pro Max
```
NAVIGATE http://localhost:8081/map
WAIT 1500
RESIZE 428 926
SCREENSHOT mapscreen/40-iphone-promax.png
FULLPAGE_SCREENSHOT mapscreen/40-iphone-promax-full.png
```

### Scenario 41: iPhone SE cramped
```
NAVIGATE http://localhost:8081/map
WAIT 1500
RESIZE 375 667
SCREENSHOT mapscreen/41-iphone-se-cramped.png
FULLPAGE_SCREENSHOT mapscreen/41-iphone-se-cramped-full.png
```

### Scenario 42: Cold entry — no camera fly-to
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useTrackingStore.setState({ lastCoordinate: { lat: -36.85, lng: 174.76, accuracy: 20 } });
WAIT 2000
SCREENSHOT mapscreen/42-entry-no-flyto-iphone.png
```

### Scenario 44: Loading state — circle markers
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useMarkerStore.setState({ loadingCircle: true, circleMarkers: [] });
WAIT 800
SCREENSHOT mapscreen/44-loading-circle-hidden.png
```

### Scenario 50: User outside NZ region
```
NAVIGATE http://localhost:8081/map
EVALUATE window.__cairnStores.useTrackingStore.setState({ lastCoordinate: { lat: -33.87, lng: 151.21, accuracy: 20 } });
WAIT 2000
RESIZE 375 812
SCREENSHOT mapscreen/50-user-outside-nz.png
```

---

## Code-level issues (found by reading source, not testable via Playwright)

- **MapScreen.tsx:704-708** — GPS chip hardcoded to always show amber "Enable GPS" with warning dot. Never reads real permission or fix state. `styles.gpsDot` declares `backgroundColor: Colors.success` (line 946) but inline style overrides to `Colors.severityWarning` — dead style property.
- **MapScreen.tsx:704** — `gpsChip` is a `<View>`, not `TouchableOpacity`. Fake affordance — visible CTA "Enable GPS" is completely inert. (Scenario 7)
- **MapScreen.tsx:673-685** — `handleAddMarker` silently substitutes `region.centerLat/centerLng` when `lastCoord` is null. Zero user feedback that GPS is missing. Plants ghost markers at Wellington centroid. (Scenario 26)
- **MapScreen.tsx:601-611** — `useEffect` fires `void loadCircleMarkers()` and `void loadSubscriptions()` with NO `.catch()` handler. Fetch errors are silently swallowed. Combined with the unused `loadingCircle`/`loadingSubs` state, users have zero visibility into fetch failures.
- **MapScreen.tsx:558, 561** — `loadingCircle` and `loadingSubs` are subscribed but NEVER rendered in JSX. Dead state subscription.
- **MapScreen.tsx:100-134** — Fallback `RealMap` when Mapbox unavailable uses `PressableMarker` with grid positioning. Non-user-facing dev copy: `"Build with EAS to enable Mapbox\noutdoor maps with offline support"`.
- **MapScreen.tsx:139-155** — `Camera` has NO `centerCoordinate` binding to `lastCoord` — new users see NZ default region even after location is available. Missing camera fly-to-user pattern from `HikingMap.tsx:224-232`.
- **MapScreen.tsx:181** — Marker fill hardcoded to `'rgba(255,255,255,0.85)'` — bypasses `meta.bg` from `MARKER_META`. Fallback path uses `meta.bg` (line 124). Two rendering paths, inconsistent fills.
- **MapScreen.tsx:965-970** — `fabBadge` uses `minWidth: 18, paddingHorizontal: 4` with no max width or "99+" cap. 3+ digit counts break alignment. (Scenario 17)
- **MapScreen.tsx:857** — `new Date(m.createdAt).toLocaleDateString()` — locale-inconsistent, and it's a date not a time-ago. (Scenario 32)
- **MapScreen.tsx:203, 352** — Permission state initialized to `'personal'` on every sheet open; not persisted across CreateMarkerSheet sessions. (Scenario 27)
- **MapScreen.tsx:73-84 & MarkerPin.tsx** — Two marker components (`PressableMarker` in MapScreen and `MarkerPin` in `screens/`) with duplicated logic. Duplication risk: 32x32 in MapScreen fallback vs 24x24 in MarkerPin fallback — inconsistent marker sizing across app.
- **HikingMap.tsx:37-49** — Robust `Platform.OS !== 'web'` conditional import pattern; MapScreen (46-62) mirrors this. Fine.
- **HikingMap.tsx:454-460** — Touch shield during fly-in is a good pattern. **MapScreen has NO equivalent** — a stray tap during initial camera load could cancel any auto-recenter. (This is currently moot because MapScreen doesn't fly-to-user, but flagging as a design gap.)
- **MapScreen.tsx:696** — `topBar` uses hardcoded `Spacing.lg` = 20 paddingTop on top of `SafeAreaView.edges={['top']}` — total inset is oversized on Dynamic Island phones. (Scenario 5, 39)
- **MapScreen.tsx:700-703** — Back chip calls `nav.goBack()` without `nav.canGoBack()` guard. Potential crash / undefined behavior if MapScreen is a tab entry. (Scenario 8)
- **MapScreen.tsx:895** — `mapFallbackText` uses `lineHeight: 22` at `FontSize.body` = 15. Fine.
- **MapScreen.tsx:945** — `chipTextAmber: { color: Colors.severityWarning }` — good use of design token.
- **MapScreen.tsx:914-916** — Dead style comment: `// O1 batch 33: removed SVG-placeholder styles` — many styles cleaned up. `mapMarker` style (line 917) still exists but is only used in the fallback path — 大 confusion vs. `markerPin` (line 898) which is used in the native path. Two visually similar styles doing near-identical things.
- **MapScreen.tsx:864** — `MapBottomPanel` receives `onOfflinePress` callback, but no other actions (delete/edit) — inconsistent with `MarkDetailSheet` which has full CRUD. Users can't delete via bottom panel; must tap marker on map.
- **MapScreen.tsx:283-284** — `noteInput` `numberOfLines={2}` and `minHeight: 70` — on iOS, `numberOfLines` on multiline `TextInput` is only a hint. 长 notes may push sheet content down and clip on shorter screens.
- **MapScreen.tsx:696-716** — Entire `topBar` uses absolute positioning with `pointerEvents="box-none"`. The activity-mode chip was removed but the layout still has `justifyContent: 'space-between'` — trailing side of the top bar is empty, causing Back+GPS to hug left with unused right half. Cosmetic asymmetry.
- **tokens.ts:59** — `overlayDark: 'rgba(250,247,242,0.55)'` — cream tint sheet backdrop. In MapScreen sheets this works, but the very light backdrop may not adequately visually separate the sheet from the map behind — sheets can look "floating in fog" over saturated tile imagery.
- **MapScreen.tsx:826-841** — Hide-mark Alert copy is factual and matches the button label (post UX-Med-4 fix). Good example — should extend to other Alert copy.

---

## Priority summary

**Blocker (release-blocking)**:
- GPS chip is fake affordance — "Enable GPS" text with warning dot but NO tap handler, NO real permission state binding (scenarios 6, 7; MapScreen.tsx:704-708). App Store review risk (misleading UI).
- `handleAddMarker` silently plants markers at region centroid when `lastCoord` is null — data integrity bug, plants ghost markers user cannot explain (scenario 26; MapScreen.tsx:673-685).
- No camera fly-to-user on entry — new users see NZ default region even with GPS granted (scenario 42; MapScreen.tsx:147-154).
- No clustering — 100+ markers render individually, unusable at country zoom and perf risk (scenario 4).

**Critical (visible bug)**:
- Fallback fill color inconsistent between native and fallback marker paths (scenario 9; MapScreen.tsx:181 vs 124).
- FAB badge overflow for 3+ digits — breaks alignment, potential truncation (scenario 17; feedback_truncate_is_bug applies).
- MapBottomPanel time-ago uses `toLocaleDateString()` — locale-inconsistent, not a real time-ago (scenario 32; MapScreen.tsx:857).
- CreateMarkerSheet permission resets to `personal` every open — user habit broken (scenario 27).
- Circle markers / subscriptions fetch failures are silent — no error state, no loading state (scenarios 44, 45; MapScreen.tsx:601-611).
- Type card labels may truncate on iPhone SE with long labels (scenario 19; feedback_truncate_is_bug applies).
- Stranger opacity 0.6 desaturates the icon inside — poor contrast (scenario 11; MapScreen.tsx:177).
- MapBottomPanel likely overlaps or crowds FAB on iPhone SE (scenario 41).
- No empty state when 0 markers — first-time users see undefined panel behavior (scenario 3).
- Delete uses native `Alert.alert` — inconsistent with SettingsScreen custom Type-to-Confirm modals (scenario 29).

**Medium (polish)**:
- Back chip → `nav.goBack()` without `canGoBack` guard (scenario 8).
- `topBar` paddingTop stacks with SafeAreaView inset — wasteful spacing on Dynamic Island phones (scenarios 5, 39).
- Non-NZ users see NZ map on entry with no recenter button (scenario 50).
- No stale-fix indicator — GPS lost mid-session invisible (scenario 35).
- No sim-walker overlay on MapScreen (design gap, scenario 37).
- No `routeStart` support — feature parity gap with HikingMap (scenario 38).
- Two duplicated marker components (`PressableMarker`, `MarkerPin`) with different sizes (32x32 vs 24x24) — refactor candidate.
- Fallback copy "Build with EAS…" leaks dev-speak (scenario 2).
- Dead `Colors.success` in `gpsDot` style (MapScreen.tsx:946).
- Top bar `justifyContent: space-between` with empty right half — visual asymmetry.
- `Alert.alert` mixing across screens — should migrate to a consistent modal system.
- `noteInput` `numberOfLines={2}` is iOS hint only — no hard bound (MapScreen.tsx:286).

AUDIT_COMPLETE mapscreen
