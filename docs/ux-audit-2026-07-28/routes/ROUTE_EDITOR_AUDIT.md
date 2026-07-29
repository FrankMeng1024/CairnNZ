# RouteEditorScreen UX/UI Audit — 2026-07-28

Auditor: A12b (RouteEditor-only scope; complementary to A6's routes/AUDIT.md)
Source file: `app/src/screens/RouteEditorScreen.tsx` (983 lines)
Parent screen: `app/src/screens/RoutesScreen.tsx` (RouteSheet → nav to RouteEditor)

## Screen summary

RouteEditorScreen is the single dual-mode screen for viewing, creating (from an activity), and editing a saved route. It supports three entry modes: (1) existing route via `routeId`, (2) new-from-activity via `fromSessionId` (auto-enters edit on load in v274), (3) blank create (legacy — no waypoint UI present). Layout is full-screen Mapbox with a floating `BackButton` (pill) top-left and a bottom rounded-card panel that holds a name TextInput, inline stats (`N points · distance`), a Personal|Friends permission chip row, and three actions (Delete | Edit | Save). Edit mode replaces the bottom panel with `EditOverlayV274` which owns tool strip + trim slider + Preview/Beautify/Save/Cancel. Save enable is gated only on `name.trim().length > 0 && !saving` — geometry may still be loading (lazy `loadRouteDetail`), and `handleViewSave` surfaces an Alert if geometry ends up missing.

Notably: **there is no waypoint UI** on this screen. The `waypoints` array is hardcoded to `[]` on save (line 598) and there is no add/remove/reorder waypoint control. The task prompt's "reorder / drag waypoints" scenarios cannot be exercised as normal user flows in this build — they are captured below as **N/A (feature absent)** and flagged as a spec/PRD mismatch (RouteSheet shows "N waypoints" implying editability, but editor has no affordance).

## Scenarios

| # | 功能 | 小功能 | 场景 | 预期UI | 一致性 | UX | Issues |
|---|------|--------|------|--------|--------|-----|--------|
| 1 | Entry mode | Existing route | Nav from Routes list `nav.navigate('RouteEditor', { routeId })` — points already in store | Map fits bounds; bottom card shows name (pre-filled), `N points · X km`, Delete/Edit/Save | 8 | 7 | Save is **not disabled** even when nothing changed since the last save (PO deliberate per v255 comment) — potentially confuses users who expect "no changes = greyed Save". |
| 2 | Entry mode | Existing route, points lazy | Nav with `routeId` but store row has `points=[]`; `loadRouteDetail` fires | Bottom stats hidden (`renderPoints.length < 2`); camera falls back to userCoord/region | 7 | 4 | **Critical**: no loading indicator. Bottom card shows only the name + empty state — user cannot tell if data is loading, missing, or the route is broken. |
| 3 | Entry mode | Save-as-route (auto-enter Edit) | Nav with `fromSessionId` + trackPoints; `autoEnterTriedRef` fires enterEdit once sessionTrackPoints ≥ 2 | Screen mounts, briefly shows view-mode, then edit overlay slides in | 6 | 5 | **Critical**: user sees a brief flash of view-mode (empty name + Save disabled) before edit overlay takes over. No transition. Feels like a bug in first few frames. |
| 4 | Entry mode | Save-as-route, GPS < 2 points | `fromSessionId` present, `sessionTrackPoints` returns 0-1 pts | `snapWarning=true`, "Showing raw GPS trace" banner top-center; `autoEnterTried` never fires (guard `sessionTrackPoints.length < 2`) | 6 | 3 | **Blocker for that flow**: user is stuck on view-mode with no geometry, Save disabled by empty name, Edit button will show "Loading route data — please try again in a moment." error. No path forward except Back. |
| 5 | Name field | Empty name on save | User taps Save with `name.trim() === ''` | Alert "Name required · Please name this route before saving." | 8 | 7 | Save button is already `opacity: 0.4` disabled — Alert branch is defensive-only. But `viewSaveBtnDisabled` uses only opacity, not `pointerEvents="none"`, so on touch the button visually reacts (`activeOpacity=0.85`) even though `disabled=true`. Small polish miss. |
| 6 | Name field | Very long name (100+ chars) | Type "My extra long route name to try wrapping…" (200 chars) | TextInput is single-line (no `multiline`), text scrolls horizontally | 5 | 4 | **Truncate/overflow bug per feedback_truncate_is_bug**: `viewSummaryName` (h3, weight 700) has no `maxLength` and no wrap. On save it persists 200 chars; on the Routes list card it will truncate with no ellipsize prop set (`cardTitle` in RoutesScreen has no `numberOfLines`), potentially breaking the list card layout. Requires a `maxLength` (e.g. 60) or `numberOfLines={1}` + ellipsize. |
| 7 | Name field | Very short name (1 char) | Type "a" | Save enables. Persists "a". | 7 | 6 | No min-length validation. 1-char names allowed → poor list scannability. Not a blocker but a Medium polish. |
| 8 | Name field | Whitespace-only name | Type "   " (3 spaces) | Save button remains disabled (`name.trim().length === 0`) | 9 | 9 | Correct — `nameValid` uses `.trim()`. Good defensive behavior. |
| 9 | Name field | Emoji / non-ASCII | Type "路线 A 🏔️" | Persists as-is | 8 | 8 | RN TextInput handles this fine. But `viewSummaryName` uses fontWeight 700 which on some Android builds fails to render mixed emoji glyphs — visual only, medium. |
| 10 | Permission chip | Personal → Friends toggle | Tap "Just me" then "Friends" | Chip active border + primaryBg tint | 9 | 8 | Chips are 12px `caption` text with 6px vertical padding — hit target ~28px tall, **below iOS 44pt minimum**. Marginal accessibility issue. |
| 11 | Permission chip | Long-press / hold | Long-press "Friends" | No handler → no-op | 8 | 8 | Fine. |
| 12 | Waypoint | Add waypoint | Attempt to tap map to add a point in view mode | Nothing happens (map is idle) | 5 | 4 | **PRD mismatch**: `RouteSheet` stats row shows "N waypoints" but this screen has **no waypoint add/remove/reorder UI**. Users landing here expecting to add named waypoints (per the widget elsewhere) will be confused. `waypoints: []` is hardcoded on save (line 598). |
| 13 | Waypoint | Remove waypoint | Try to long-press a marker | No markers rendered; no-op | N/A | N/A | Feature not present. |
| 14 | Waypoint | Reorder waypoint | Drag anywhere | Map pan (view mode) or brush stroke (edit mode) | N/A | N/A | Feature not present. |
| 15 | Save flow | Valid draft, existing route | Change name, tap Save | `updateRoute` fires, spinner in Save button (ActivityIndicator on white), then `nav.goBack()` | 7 | 6 | Save spinner replaces button label — hit target maintained but user has no verbose progress signal. No "Saved!" toast on the destination screen. |
| 16 | Save flow | Valid draft, new-from-session | Save-as-route, name filled, tap Save (view mode after canceling edit) | `addRoute` fires, `nav.dispatch(CommonActions.reset)` → lands on RouteEditor with new routeId, back → Home | 7 | 6 | Nav stack reset intent is right, but the transition is visually indistinguishable from a save-failure retry (same screen, same layout) — user isn't clearly told "saved". |
| 17 | Save flow | Backend fail on save | Save with valid data, backend returns error | `Alert.alert('Save failed', e?.message ?? 'Unknown error')` | 7 | 5 | Alert message surfaces raw error string from backend — often unhelpful (e.g. "Network request failed"). No retry action in alert. |
| 18 | Save flow | Network offline | Save with airplane mode | `addRoute` returns undefined (per code) → `Alert.alert('Save failed', 'Could not save route — check your connection.')` | 7 | 7 | Reasonable copy. But note `saving` state remains false only after `finally` — offline detection isn't preemptive, user waits for the failed network request. |
| 19 | Save flow | Save while save in flight | Rapid double-tap Save | Second call guarded by `if (saving) return;` | 9 | 8 | Correct guard. |
| 20 | Save flow | Draft has 0 geometry | Save with `finalPoints.length < 2` | `Alert.alert('No route', 'Route has no geometry to save.')` | 8 | 5 | The **entry state** (Scenario 2 — lazy loading) can trigger this alert misleadingly: user sees "No route" for a route that IS saved but points haven't loaded yet. Bad copy for that case. |
| 21 | Cancel/back | Back button in view mode | Tap `BackButton` (pill top-left) | `nav.goBack()` — unmount fires `detachUI()` + `clearCommittedDraft()` | 8 | 8 | Clean. |
| 22 | Cancel/back | Back with unsaved name change | Change name, tap Back | **Silently discards** the edited name — no confirmation | 5 | 3 | **Critical**: standard iOS/Android pattern is "unsaved changes" prompt. Cairn silently drops the change. If user just spent time typing a long name and hits Back accidentally → data loss. |
| 23 | Cancel/back | Hardware back Android | Press hardware back in view mode | Standard nav goBack (no hook for view-mode); in edit mode, `Alert.alert('Discard edits?', …)` | 7 | 7 | Discard alert only in edit mode. View mode has no confirmation for unsaved name change (same as #22). |
| 24 | Cancel/back | Discard confirmation copy | In edit mode, hardware/onCancel triggers Alert | "Discard edits? Your changes will be lost." · [Keep editing] [Discard] | 9 | 9 | Copy is clear, destructive style on Discard is correct. |
| 25 | Edit mode | Enter edit, flag disabled | Feature flag `editModeEnabled` is off | `setEnterEditError('Edit mode is currently disabled.')` displayed in error banner | 8 | 7 | Error banner is above the summary card with `TriangleAlert` icon. Copy is honest. Users cannot recover except by upgrading — no CTA. |
| 26 | Edit mode | Enter edit, session loading | Tap Edit before `sessionTrackPoints` fills | `setEnterEditError('Loading route data — please try again in a moment.')` | 7 | 6 | Loading state is masqueraded as an error. Should be a spinner + inline "Preparing…" text instead. |
| 27 | Edit mode | Delete route (existing) | Tap Delete → `Alert.alert('Delete route?', ...)` → Delete | Async `deleteRoute(routeId)` then `nav.goBack()` | 9 | 8 | Alert copy correct. No optimistic UI, no undo. Fine. |
| 28 | Edit mode | Delete route (new-from-session, no routeId) | Save-as-route flow, no `routeId` in params | Delete button **not rendered** (`{routeId && ...}` guard, line 936) | 9 | 8 | Correct — nothing to delete pre-save. |
| 29 | Keyboard | Name input focus | Tap name field | `KeyboardAvoidingView` wraps bottom panel (iOS behavior='padding') | 6 | 5 | On iPhone SE (375×812) the bottom panel already extends ~220px above bottom edge. Keyboard height ~291px will push panel above safe area. **Not verified**: whether the Save button remains visible when keyboard is up. `keyboardVerticalOffset=0` may be too tight — panel could ride onto notch / status area. |
| 30 | Keyboard | Save button reachable with keyboard | Focus name → check Save button visible | With padding behavior, panel lifts by keyboard height. Save button expected visible above keyboard. | 5 | 5 | On smaller viewports (375×667 iPhone SE 1st gen — not in target list) the panel could clip. **Recommend Playwright verification at 375×812**. |
| 31 | Loading | Save-as-route mount | Session with 5000 track points | `smoothTrackPoints` runs synchronously on JS thread; UI may jank | 6 | 6 | No spinner during smoothing. For large sessions, user sees blank map for 500ms+. Add a loading indicator over the map area during initial hydration. |
| 32 | Loading | Enter edit spinner | Tap Edit → `enterEditLoading=true` | Icon replaced by `ActivityIndicator` inside the Edit button; label hidden | 8 | 7 | Spinner is subtle, small primary-color. No text says "Preparing edit…" — user might tap again (guard `if (enterEditLoading) return;` protects). |
| 33 | Loading | View mode initial map load | First mount with populated route | Map tiles load lazily; `cameraBounds` fits immediately | 7 | 7 | No first-paint indicator. Map area shows the `Colors.primaryBg` sage tint through `mapArea` during tile load. Ok visual. |
| 34 | Multiple viewports | iPhone SE 375×812 | Full flow | Bottom card ~ 210px; map area ~ 602px; stats row wraps if too many chars | 7 | 6 | Bottom card items: name (h3) + stats row (small×3) + permission row (chips) + action row (3 buttons). Compresses ok. Delete/Edit/Save are `flex:1` — labels are 15pt body, should fit but tight if localized. |
| 35 | Multiple viewports | iPhone 14 Pro 393×852 | Full flow | Same as above with 18px more horizontal, 40px more vertical | 8 | 8 | Comfortable. |
| 36 | Multiple viewports | iPhone Pro Max 428×926 | Full flow | Extra space; map dominates | 8 | 8 | Comfortable. Bottom card could optionally show more stats (e.g. elevation gain) but currently doesn't. |
| 37 | Overflow | Long name in header | 100-char name in existing route | TextInput single-line, horizontal scroll on focus | 4 | 3 | See #6. **Truncate/overflow bug**. TextInput has no `numberOfLines`, `ellipsizeMode`, or `maxLength`. |
| 38 | Overflow | 100+ waypoint (points) count | Route with 5000 points | `renderPoints.length points` displays as "5000 points" | 8 | 7 | Just numbers — no thousand-separator formatting (`5,000`). Minor readability. |
| 39 | Route with 1 point | Existing route.points.length===1 | Bounds computation returns null → fallback camera | Camera falls back to user GPS or region default | 6 | 5 | Bottom stats row hidden (`renderPoints.length >= 2` guard) — user sees a route with a name but zero context. No banner saying "This route has too few points to display." |
| 40 | Route with 5 waypoints (points) | Normal small route | Bounds fit, single-color primary line 5px wide | Rendered cleanly | 9 | 9 | Good. |
| 41 | Route with 20 waypoints (points) | Normal medium route | Same as #40 | Good | 9 | 9 | Good. |
| 42 | Route with 100+ points | Long route (points=100+) | `PolylineSampler.polylineLengthM` computes; `snapToRoad` may be heavy | Line renders as continuous stroke | 7 | 7 | Line style is round-capped, no thinning by zoom. On very long routes at zoomed-out view, line may become blocky. |
| 43 | Route with 1000+ points | Very long route | Camera fit uses full bounds → very zoomed out | Line legible but padding (80/220/40/40) is fixed | 6 | 6 | Padding bottom 220px is designed for the bottom panel height. On very long north-south routes the fit may push start/end into the panel area. |
| 44 | Map fit-to-bounds | Fresh mount | `cameraBounds` computed from points | Camera mounts with bounds, `animationDuration: isEditing ? 300 : 0` | 8 | 8 | Zero-duration on first mount is right. Edit mode 300ms transition is smooth. |
| 45 | Map fit-to-bounds | Points hydrate late | Points arrive 500ms after mount via `loadRouteDetail` | Camera **does NOT re-fit** — memoized `cameraBounds` re-computes but Camera component is keyed on nothing | 5 | 4 | **Blocker**: camera stays at fallback position after points load. User has to pinch-zoom to find their route. Camera should re-fit on `cameraBounds` change. |
| 46 | Distance display | Metric user | `dist.unit` returns "km"; format shows "1.2 km" | Correct label | 9 | 9 | Uses `useDistance` hook, correct. |
| 47 | Distance display | Imperial user | Distance formatted in miles | Correct | 9 | 9 | Good. |
| 48 | Distance display | Very short route (5m) | `dist.format(5, 1)` returns "0.0 km" | Displays as "0.0 km" | 5 | 4 | **Copy bug**: showing "0.0 km" is misleading. For sub-100m routes, should switch to meters ("5 m"). |
| 49 | Duration display | — | Duration is NOT rendered on this screen | Only distance + points count. Duration is on activity detail. | 6 | 6 | Consistent with route semantics (route = path, not a walked instance). But `session?.elevationGainM` is passed to save (line 602) yet gain is not displayed on the screen — inconsistent. |
| 50 | Back button behavior | Unsaved edit mode changes | In edit mode, tap floating BackButton (top-left) | `BackButton.onPress` default → `nav.goBack()`. **No discard alert**. Only hardware back on Android triggers alert. | 3 | 2 | **Critical**: floating BackButton in edit mode bypasses the discard confirmation Alert on iOS entirely. User can lose all brush strokes with one tap. Android hardware back is protected, but iOS soft back is not. Blocker for iOS. |
| 51 | Back button behavior | Unsaved name in view mode | Change name, tap floating BackButton | Silent discard (see #22) | 4 | 3 | Same as #22 — data loss. |
| 52 | Consistency vs RoutesScreen card | Card shows "N waypoints" | RoutesScreen `cardMeta`: `{distance} · {waypoints.length} waypoints` | Editor never surfaces waypoints (always 0) → cards permanently show "0 waypoints" | 4 | 3 | **Blocker for information architecture**: RoutesScreen advertises a feature (waypoints) that RouteEditor cannot manipulate. Two options: (a) hide waypoints count in list when 0; (b) add waypoint editor. Currently misleading. |
| 53 | Consistency vs SettingsScreen | Card + section header rhythm | Settings uses `sectionHeader` uppercase small + `card` with `rgba(255,255,255,0.92)` bg + `shadow.card` | Editor bottom panel uses `Colors.surface` (pure white) + `Shadow.elevated`, no section header | 6 | 7 | Editor's bottom panel is a floating overlay, so a section header wouldn't fit — but the white background differs from Settings's translucent white. Small visual dialect. |
| 54 | Consistency vs SettingsScreen | Button styling | Settings uses PressBtn with scaleTo animation; Editor uses TouchableOpacity | View-mode Delete/Edit/Save use raw TouchableOpacity | 5 | 6 | Loses the visual bounce feedback SettingsScreen has. Interaction feels less polished. |
| 55 | Consistency vs RoutesScreen tokens | Colors.primary hover states | RoutesScreen has no hover per se (RN); RouteEditor uses `activeOpacity={0.85}` on TouchableOpacity | Consistent | 8 | 8 | Ok. |
| 56 | Snap warning banner | Rendered when session has < 2 points | `<View style={[styles.warningBanner, { top: insets.top + 8 }]}>` "Showing raw GPS trace" | Pill-shaped, `Colors.warning` bg, small caption text | 8 | 7 | Copy: "Showing raw GPS trace" is developer-speak. End users don't know what "raw GPS trace" means. Rewrite: "Your track has limited data — showing raw path." |
| 57 | Snap warning banner | Overlap with BackButton | Banner is `alignSelf: 'center'` — mid-top | Doesn't overlap BackButton (top-left) | 8 | 8 | Good. |
| 58 | Error banner | enterEditError displayed | Banner above summary card | Pressable to dismiss; icon + text `numberOfLines={2}` | 8 | 7 | 2-line cap on `errorBannerText`. If backend returns a long JSON message, gets truncated (`ellipsizeMode` default `tail`). Acceptable for this case, but ties into general truncate concern. |
| 59 | Long permission chip labels | If localized to e.g. German ("Nur ich" / "Freunde") | Chips are `flexDirection:'row'` with 12pt padding | Text is 12pt caption; icon is 12px | 6 | 6 | Chips are individual TouchableOpacity, not `flex:1`, so long labels expand the chip width. On 375px viewport with a very long localized label, chips could wrap or push content off-screen. **Truncate risk**. |
| 60 | Save button loading state | Save in flight | ActivityIndicator (white on primary) replaces icon+text | Same button, different content | 8 | 8 | Good. No jump in button width because it's `flex:1` and same padding. |
| 61 | Delete confirmation | Existing route | Alert with Cancel + Delete (destructive) | Standard system Alert | 9 | 9 | Correct. |
| 62 | Discard alert | Text | "Discard edits? Your changes will be lost." | Cancel-style + destructive Delete | 9 | 9 | Correct. |
| 63 | Race condition | Rapid Edit → Cancel → Edit | Multiple `enterEditLoading` sessions | Guarded by `if (enterEditLoading) return;` | 8 | 8 | Correct. |
| 64 | Camera fallback | Cold start, no GPS | `userCoord=null`, `cameraBounds=null` | Falls back to `getCurrentRegion()` center + defaultZoom | 8 | 7 | Good — avoids "Ajaccio bug" mentioned in code. |
| 65 | Edit mode camera | Enter edit | 300ms animation duration | Smooth transition | 8 | 8 | Ok. |
| 66 | Session load failure | `loadTrackPoints` rejects | `.catch()` sets `sessionTrackPoints=[]` + `snapWarning=true` | Empty state + warning banner | 7 | 5 | User sees warning but no clear "Retry loading" affordance. |

## Playwright script

Web bypass on RouteEditor is required — the app's main `mapboxAdapter.web.tsx` should render a stub map. `window.__cairnStores` should expose `useRouteStore` and `useRouteEditStore`. `navigationRef` used to push.

### Scenario 1: Existing route with pre-loaded points
```
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-basic-5pts
WAIT 1500
RESIZE 393 852
SCREENSHOT routeeditor_01_existing_basic.png
FULLPAGE_SCREENSHOT routeeditor_01_existing_basic_full.png
EVALUATE () => JSON.stringify(window.__cairnStores.useRouteStore.getState().routes.find(r => r.id === 'fixture-basic-5pts'))
```

### Scenario 2: Existing route with lazy-loading points
```
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-lazy-no-points
WAIT 100
SCREENSHOT routeeditor_02a_lazy_pre_load.png
WAIT 2000
SCREENSHOT routeeditor_02b_lazy_post_load.png
EVALUATE () => window.__cairnStores.useRouteStore.getState().routes.find(r => r.id === 'fixture-lazy-no-points')?.points?.length
```

### Scenario 3: Save-as-route flow (auto-enter Edit)
```
EVALUATE () => window.__cairnStores.useSessionStore.getState().sessions.length
NAVIGATE http://localhost:8081/?route=RouteEditor&fromSessionId=fixture-session-medium
WAIT 300
SCREENSHOT routeeditor_03a_view_mode_flash.png
WAIT 1500
SCREENSHOT routeeditor_03b_edit_mode_ready.png
```

### Scenario 4: Save-as-route, insufficient GPS points
```
EVALUATE () => window.__cairnStores.useSessionStore.getState().addFixtureSession({ id: 'fx-1pt', trackPoints: [{lat:-41,lng:174}] })
NAVIGATE http://localhost:8081/?route=RouteEditor&fromSessionId=fx-1pt
WAIT 1500
SCREENSHOT routeeditor_04_insufficient_gps.png
CLICK [testID=route-editor-edit-btn]
WAIT 300
SCREENSHOT routeeditor_04b_edit_denied.png
```

### Scenario 5: Empty name save attempt
```
NAVIGATE http://localhost:8081/?route=RouteEditor&fromSessionId=fixture-session-medium
WAIT 1500
CLICK [testID=edit-cancel-btn]
WAIT 500
SCREENSHOT routeeditor_05a_empty_name.png
CLICK [testID=route-editor-save-btn]
WAIT 300
SCREENSHOT routeeditor_05b_save_disabled_visual.png
```

### Scenario 6: Very long name overflow
```
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-basic-5pts
WAIT 1500
CLICK textbox[placeholder="Route name (required)"]
TYPE "A very very very very very very very very very very long route name that keeps going and going and going far beyond reasonable"
WAIT 200
SCREENSHOT routeeditor_06a_long_name_in_field.png
CLICK [testID=route-editor-save-btn]
WAIT 1200
NAVIGATE http://localhost:8081/?route=Routes
WAIT 500
SCREENSHOT routeeditor_06b_long_name_in_list_card.png
```

### Scenario 7: Very short name (1 char)
```
NAVIGATE http://localhost:8081/?route=RouteEditor&fromSessionId=fixture-session-medium
WAIT 1500
CLICK [testID=edit-save-btn]
WAIT 500
CLICK textbox[placeholder="Route name (required)"]
TYPE "a"
CLICK [testID=route-editor-save-btn]
WAIT 1500
SCREENSHOT routeeditor_07_short_name_saved.png
```

### Scenario 8: Whitespace-only name
```
CLICK textbox[placeholder="Route name (required)"]
TYPE "   "
WAIT 200
SCREENSHOT routeeditor_08_whitespace_save_disabled.png
```

### Scenario 9: Emoji / non-ASCII name
```
CLICK textbox[placeholder="Route name (required)"]
TYPE "路线 A 🏔️"
WAIT 200
SCREENSHOT routeeditor_09_unicode_name.png
```

### Scenario 10: Permission chip toggle
```
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-basic-5pts
WAIT 1500
CLICK [testID=route-permission-personal]
WAIT 200
SCREENSHOT routeeditor_10a_personal_active.png
CLICK [testID=route-permission-friend]
WAIT 200
SCREENSHOT routeeditor_10b_friend_active.png
```

### Scenario 15: Save existing route (backend success mocked)
```
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-basic-5pts
WAIT 1500
CLICK textbox[placeholder="Route name (required)"]
TYPE " edited"
CLICK [testID=route-editor-save-btn]
WAIT 100
SCREENSHOT routeeditor_15a_save_spinner.png
WAIT 1500
SCREENSHOT routeeditor_15b_back_to_routes.png
```

### Scenario 17-18: Save failure (backend / offline)
```
EVALUATE () => window.__cairnStores.__mockNetwork({ mode: 'offline' })
NAVIGATE http://localhost:8081/?route=RouteEditor&fromSessionId=fixture-session-medium
WAIT 1500
CLICK [testID=edit-save-btn]
WAIT 500
CLICK textbox[placeholder="Route name (required)"]
TYPE "Offline test"
CLICK [testID=route-editor-save-btn]
WAIT 2000
SCREENSHOT routeeditor_18_offline_alert.png
```

### Scenario 22: Back with unsaved name change (data-loss check)
```
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-basic-5pts
WAIT 1500
CLICK textbox[placeholder="Route name (required)"]
TYPE " important edits"
SCREENSHOT routeeditor_22a_edited_before_back.png
CLICK [aria-label="Back"]
WAIT 500
SCREENSHOT routeeditor_22b_no_discard_prompt.png
EVALUATE () => window.__cairnStores.useRouteStore.getState().routes.find(r => r.id === 'fixture-basic-5pts').name
```

### Scenario 25: Feature flag disabled
```
EVALUATE () => window.__cairnStores.__setFeatureFlag('editModeEnabled', false)
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-basic-5pts
WAIT 1500
CLICK [testID=route-editor-edit-btn]
WAIT 300
SCREENSHOT routeeditor_25_flag_disabled_banner.png
```

### Scenario 27: Delete existing route
```
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-basic-5pts
WAIT 1500
CLICK [testID=route-editor-delete-btn]
WAIT 500
SCREENSHOT routeeditor_27a_delete_alert.png
CLICK button[text="Delete"]
WAIT 1500
SCREENSHOT routeeditor_27b_after_delete_back_to_list.png
```

### Scenario 29-30: Keyboard overlay behavior
```
RESIZE 375 812
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-basic-5pts
WAIT 1500
CLICK textbox[placeholder="Route name (required)"]
WAIT 500
SCREENSHOT routeeditor_29_keyboard_iphonese.png
EVALUATE () => document.querySelector('[testID="route-editor-save-btn"]').getBoundingClientRect()
```

### Scenario 34-36: Viewport matrix
```
RESIZE 375 812
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-basic-5pts
WAIT 1500
FULLPAGE_SCREENSHOT routeeditor_34_iphonese.png
RESIZE 393 852
FULLPAGE_SCREENSHOT routeeditor_35_iphone14pro.png
RESIZE 428 926
FULLPAGE_SCREENSHOT routeeditor_36_iphonepromax.png
```

### Scenario 39: 1-point route
```
EVALUATE () => window.__cairnStores.useRouteStore.getState().__addFixture({ id: 'fx-1pt-route', name: 'One point', points: [{lat:-41,lng:174}], distanceM: 0 })
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fx-1pt-route
WAIT 1500
SCREENSHOT routeeditor_39_1pt_route.png
```

### Scenario 42-43: 100 / 1000-point routes
```
EVALUATE () => window.__cairnStores.__generateFixtureRoute('fx-100pt', 100)
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fx-100pt
WAIT 1500
SCREENSHOT routeeditor_42_100pt.png
EVALUATE () => window.__cairnStores.__generateFixtureRoute('fx-1000pt', 1000)
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fx-1000pt
WAIT 1500
SCREENSHOT routeeditor_43_1000pt.png
```

### Scenario 45: Late-arriving points, camera should re-fit
```
EVALUATE () => window.__cairnStores.__armLazyLoad('fixture-lazy-2s', 2000)
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fixture-lazy-2s
WAIT 500
SCREENSHOT routeeditor_45a_pre_hydration_camera.png
WAIT 3000
SCREENSHOT routeeditor_45b_post_hydration_camera.png
```

### Scenario 48: Very short route (5m) — meter display
```
EVALUATE () => window.__cairnStores.__addFixture({ id: 'fx-5m', name: 'Tiny', points: [{lat:-41,lng:174},{lat:-41.00005,lng:174}], distanceM: 5.5 })
NAVIGATE http://localhost:8081/?route=RouteEditor&routeId=fx-5m
WAIT 1500
SCREENSHOT routeeditor_48_5m_route.png
```

### Scenario 50: Floating BackButton in edit mode (iOS-equivalent no-discard-alert)
```
NAVIGATE http://localhost:8081/?route=RouteEditor&fromSessionId=fixture-session-medium
WAIT 1500
SCREENSHOT routeeditor_50a_in_edit_mode.png
CLICK [aria-label="Back"]
WAIT 500
SCREENSHOT routeeditor_50b_no_discard_alert_data_lost.png
EVALUATE () => window.__cairnStores.useRouteEditStore.getState().committedDraft
```

### Scenario 56: Snap warning banner
```
EVALUATE () => window.__cairnStores.useSessionStore.getState().__addFixtureSession({ id: 'fx-nogps', trackPoints: [] })
NAVIGATE http://localhost:8081/?route=RouteEditor&fromSessionId=fx-nogps
WAIT 1500
SCREENSHOT routeeditor_56_snap_warning_banner.png
```

## Code-level issues

**C-1 (Blocker, line 45–71)**: Mapbox is conditionally required in a try/catch. `MapView`/`CameraComponent`/`ShapeSource`/`LineLayer` become `null` on web. The render code guards with `MapView ? <MapView …> : <fallback>` but nested guards like `{isEditing && (<DualLineLayer …>)}` inside the MapView JSX are only reached if MapView renders — however `<BrushOverlay>` and `<EditOverlayV274>` render OUTSIDE the MapView guard (line 866-871). On web fallback, they may crash referencing `mapViewRef.current`. Needs verification.

**C-2 (Critical, line 693)**: `canSaveView = nameValid && !saving` — deliberately does NOT gate on `hasGeometryToSave` (per v255 PO note). But the fallback error branch `Alert.alert('No route', 'Route has no geometry to save.')` on line 556 fires only during handleViewSave — the user has already tapped Save. Combined with lazy `loadRouteDetail`, this means: user opens list → taps route → sees no map → taps Save → gets "No route" alert. Bad first-time impression. Root cause: Save should show a loading state while `loadRouteDetail` is in flight, not enable prematurely.

**C-3 (Critical, line 469–478)**: `autoEnterTriedRef` guards single-fire but doesn't wait for a stable render. On slow devices the transition from view→edit is visible as a flash. Adding a mount-hold spinner (0-800ms) prevents the flicker.

**C-4 (Critical, line 288–316)**: Discard alert only registered on `Platform.OS === 'android'` hardware back. iOS soft back via the floating `BackButton` (line 859) never triggers discard confirmation. See Scenario 50 — this is a data-loss path on iOS. `BackButton` needs to accept an `onPress` override (already does — see SettingsScreen.tsx line 472 using `onPress={() => nav.goBack()}`), so the fix would be to pass a handler that runs the same Alert.

**C-5 (Critical, line 22)**: `TextInput` for `viewSummaryName` has no `maxLength` prop. Combined with the `RoutesScreen.cardTitle` (line 1245) which has no `numberOfLines`, a 500-char name breaks list card layout. **Truncate/overflow = bug per feedback_truncate_is_bug**.

**C-6 (Medium, line 319–334)**: `cameraBounds` is `useMemo` on `[existingRoute, sessionTrackPoints]` but the `<CameraComponent bounds={...} />` is not keyed to force a re-fit when bounds change. Verify whether Mapbox `<Camera>` re-fits automatically on prop change — if not (Sprint 45+ rnmapbox behavior varies), this is a stale camera bug (Scenario 45).

**C-7 (Medium, line 848–852)**: Snap warning banner uses developer-speak: "Showing raw GPS trace". Copy needs rewrite to user-friendly language.

**C-8 (Medium, line 902–908)**: Distance formatting `dist.format(polylineLengthM(renderPoints), 1)` produces "0.0 km" for sub-100m routes. Should switch to meters below a threshold.

**C-9 (Medium, line 936–976)**: Three action buttons `Delete | Edit | Save` are `flex: 1` each — for `routeId` present. Without `routeId` (save-as-route), only Edit + Save render, each becoming ~50% width. Layout is correct but there's no visual separator/hierarchy — Save (primary) and Edit (outline) should have clearer weight difference (Save is already filled primary, Edit is outline — fine, but 3-button row squeezes labels).

**C-10 (Low, line 897–901)**: `viewSummaryName` TextInput doesn't hint field is editable (no border, no underline in view mode). Users may not realize the name is inline-editable — it looks like a static heading. Add a subtle indicator (edit-pencil icon or focus state style).

**C-11 (Low, line 464–478)**: Debug telemetry session starts on every mount, uploads on unmount. For quick "open route → back" flows, this creates telemetry noise. Add a min-duration threshold before uploading.

**C-12 (Low, line 605)**: `elevationGainM: elevationGainM > 0 ? elevationGainM : (session?.elevationGainM ?? 0)` — recomputed gain preferred over session gain only if > 0. But if the recomputed gain is 0 because all `alt` values are null, the fallback silently returns session gain that may itself be 0. No visible error; just quiet data quality issue.

**C-13 (Low, line 79)**: `route.params?.fromSessionTrackPoints` is passed as a raw array via nav params — this is unusual and violates React Nav guidance (params should be serializable, no large data). Large sessions with thousands of points bloat nav state. Move to a store slice + ref.

**C-14 (Low, line 897)**: `TextInput.value` uses controlled state but `onChangeText={setName}` doesn't debounce. Fine for typical typing, but if the user pastes a 10KB string it stalls the JS thread briefly.

**C-15 (Low, line 909)**: Permission chip row uses hardcoded `'Just me'` and `'Friends'` labels — no i18n. Consistent with the rest of the app (no i18n exists) but flagged for future.

## Priority summary

- **Blocker**:
  - **#45 / C-6** — Camera does not re-fit after lazy-loaded points arrive; user sees fallback view for a route they opened.
  - **#50 / C-4** — iOS floating BackButton in edit mode silently discards all edits (no discard alert). Data-loss path.
  - **#52** — RoutesScreen advertises "N waypoints" but RouteEditor has no waypoint UI; permanent "0 waypoints" is misleading. Information architecture mismatch — needs product decision.
  - **#4** — Save-as-route flow with <2 GPS points strands user with no recovery path except Back.

- **Critical**:
  - **#2 / C-2** — No loading indicator while route detail lazy-loads; Save can misfire with "No route" alert on tap.
  - **#3 / C-3** — Save-as-route flow shows brief flash of view mode before edit overlay takes over.
  - **#6, #37, #52 / C-5** — Long name in TextInput has no maxLength, breaks Routes list card layout (truncate/overflow per feedback_truncate_is_bug).
  - **#22 / C-4** — Unsaved name change silently discarded on Back (both view mode iOS + Android).
  - **#26** — "Loading route data — please try again in a moment." is a fake error for a loading state.
  - **#17** — Backend error surfaced as raw string; unhelpful.

- **Medium**:
  - **#7** — 1-char names allowed; poor list scannability.
  - **#10** — Permission chip hit target ~28pt (below iOS 44pt).
  - **#20** — "No route" alert has wrong copy when triggered during lazy-load race.
  - **#31** — Large session smoothing on JS thread; no spinner during hydration.
  - **#48 / C-8** — Sub-100m routes display "0.0 km" instead of meters.
  - **#54** — View-mode buttons use raw TouchableOpacity, lose PressBtn bounce feedback consistent with rest of app.
  - **#56 / C-7** — "Showing raw GPS trace" banner is developer-speak.
  - **#59** — Long localized permission labels risk pushing content off narrow viewports (truncate risk).
  - **C-1** — Web fallback path not exhaustively guarded; `<BrushOverlay>` + `<EditOverlayV274>` render outside MapView guard.

- **Low**:
  - **#9** — Mixed emoji glyphs on Android render inconsistency.
  - **#38** — No thousand-separator on point count.
  - **#39** — 1-point route: no explanatory banner.
  - **#43** — Very long routes: fixed padding may clip fit-to-bounds.
  - **#49** — Elevation gain saved but not displayed.
  - **#58** — Error banner text `numberOfLines={2}` may truncate long messages.
  - **C-10** — Editable name TextInput lacks affordance (looks like static header).
  - **C-11** — Debug telemetry noisy for quick open-back flows.
  - **C-12** — Silent 0 elevation gain fallback if all alt values null.
  - **C-13** — Large trackPoints array passed via nav params.
  - **C-14** — Uncontrolled paste risk on name field.
  - **C-15** — No i18n (project-wide, flagged for future).

---

Notes:
- No waypoint scenarios exercised (rows #12–14 marked N/A). This is the biggest audit finding: **the RouteEditor screen does not implement waypoint management despite the data model + list card copy implying it**. Escalate to PO as a spec question — either remove "waypoints" from list card copy or build the editor UI.
- Consistency vs SettingsScreen: Settings uses PressBtn + `rgba(255,255,255,0.92)` cards + section headers. RouteEditor uses TouchableOpacity + `Colors.surface` white + no section headers. Different design dialects, though both work individually. Flagged as Medium (#54).
