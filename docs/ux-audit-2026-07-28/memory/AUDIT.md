# UX/UI Audit — MemoryScreen + FogLayer + HierarchyPanel

**Auditor**: #7 (Memory zone)
**Date**: 2026-07-28
**Scope**: `app/src/features/memory/screens/MemoryScreen.tsx`, `components/FogLayer.tsx`, `components/HierarchyPanel.tsx`, `components/MysteryCairnSheet.tsx`, `components/RevealedCairnSheet.tsx`, `components/MemoryScopeToggle.tsx`, `components/MemoryMap.tsx`
**Scoring key**: 1 = broken, 5 = ok, 10 = shippable. Any 1-4 = must-fix Blocker/Critical.

---

## Scene S1 — Cold entry: first-time user hitting Memory tab (onboarding modal)
**File**: `MemoryScreen.tsx:907-922` (Modal), `MemoryScreen.tsx:386-389` + `:631-635` (showHint state)
**Score**: 6/10

**Findings**:
- Modal renders on top of a still-loading map. If user taps "Got it" during the loading overlay, they get double-stacked overlays (hint gone, loading still there, no way to interact until 8s timeout). No perceived affordance that anything is loading.
- Title "Walk to unlock your memory" is good, but body says "Cairns left by you and others appear as you discover them" — but on cold entry a first-time user has ZERO cairns and no mechanism to know that pinning ("cairns") happens on the Plant tab. Discoverability gap: no CTA back to Home/Plant.
- `firstVisitDone` is settled to true in `dismissHint`. If the app is uninstalled + reinstalled with fresh storage, hint reappears — but user's memory server data still persists. So new install of returning user shows the onboarding again unnecessarily.
- Backdrop opacity `rgba(20,20,20,0.55)` — modal is dismissable by hardware Back on Android (`onRequestClose`), but NO tap-outside-to-dismiss (no `Pressable` on backdrop). Inconsistent with `MysteryCairnSheet`/`RevealedCairnSheet` which both use tap-outside.

**Playwright script**:
```js
await page.goto('http://localhost:8081');
await page.evaluate(() => AsyncStorage.clear());
await page.reload();
await page.click('[testID="tab-memory"]');
await page.waitForSelector('text=Walk to unlock your memory');
await page.screenshot({ path: 'memory-S1-cold.png' });
// Verify user can NOT dismiss by tapping backdrop
await page.tap({ position: { x: 20, y: 200 } });  // backdrop area
await page.waitForTimeout(300);
const stillOpen = await page.$('text=Walk to unlock');
console.assert(stillOpen, 'BUG: backdrop tap should dismiss');
```

---

## Scene S2 — Tap "Got it" to close onboarding
**File**: `MemoryScreen.tsx:631-635` (`dismissHint`)
**Score**: 8/10

**Findings**:
- Persists `firstVisitDone=true` and unmounts modal. Clean.
- No confirmation transition/animation, but Modal has `animationType="fade"` which handles it.
- Minor: no analytics event to record "hint dismissed", only `log('memory.first_visit_hint_dismissed')` which is an appLog. Fine for MVP.

**Playwright**:
```js
await page.click('text=Got it');
await page.waitForSelector('text=Walk to unlock', { state: 'detached' });
await page.screenshot({ path: 'memory-S2-hint-dismissed.png' });
```

---

## Scene S3 — Mine / Friends sub-tabs — pill toggle
**File**: `MemoryScopeToggle.tsx:37-99`
**Score**: 7/10

**Findings**:
- Two segments render side by side with a third animated "Pick" slot (Users icon) that expands out when scope=friends. When scope=mine, the Pick slot is width 0 / opacity 0. Good.
- v376 comment: "collapsed to 0 width when scope=mine" — but layout is NOT unmounted, only width 0. Accessibility for VoiceOver: `importantForAccessibility` correctly toggles. Ok.
- Contrast issue: `Colors.primaryBg` on active segment vs `Colors.textSecondary` label on inactive. On sepia backdrop this can look muddy — inactive labels risk failing WCAG AA at 4.5:1.
- Tap target: `paddingHorizontal: Spacing.md` (probably ~12) + `paddingVertical: 6` — Segment height around 26-28px. Below 44pt HIG minimum. Blocker for accessibility.
- **Critical**: switching scope=friends when user has 0 subscribed friends → `FogLayer` unions `selfPoints` with an empty array (line 279 checks `enabledPts.length === 0` and returns `selfPoints`), so visually nothing changes. But the "Friends" label being green and Mine being off suggests to user "I'm now looking at friend memories" — misleading empty state. There's no "no friends yet — pick some" banner in Friends scope when subscriptions are 0.

**Playwright**:
```js
await page.click('[testID="memory-scope-friends"]');
await page.waitForTimeout(300);
await page.screenshot({ path: 'memory-S3-friends-empty.png' });
// Should show empty-state banner or the Pick icon should be prominent
```

---

## Scene S4 — "Looking for your position…" loading state
**File**: `MemoryScreen.tsx:738-746`
**Score**: 7/10

**Findings**:
- Cream background, ActivityIndicator, "Looking for your position…" title, body: "We need a GPS fix to draw your memory map." Clean copy.
- v352/v353 history in comments shows this UI has flickered on zoom (bug fixed via `persistentCoord` last-rendered ref). Well-documented.
- No timeout messaging: user can sit here for 12s with only a spinner (see `ONE_SHOT_TIMEOUT_MS = 12_000`). No "still trying…" transition between 4s and 12s. On weak signal this feels frozen.
- No manual "Try again" button while spinner is showing — only appears in `failReason === 'timeout'|'error'` state (line 734). If GPS is stuck acquiring but hasn't timed out yet, user has no escape.
- Copy uses "Looking for your position…" — inconsistent with `loadingSub` (`waitingSub`) tone ("We need a GPS fix…"). One is user-perspective ("Looking"), other is dev-perspective ("we need a fix"). Should be unified.

**Playwright**:
```js
// Simulate slow GPS by denying then granting quickly
await page.context().setGeolocation(null);
await page.click('[testID="tab-memory"]');
await page.waitForSelector('text=Looking for your position');
await page.screenshot({ path: 'memory-S4-searching.png' });
```

---

## Scene S5 — GPS permission denied
**File**: `MemoryScreen.tsx:711-723`
**Score**: 8/10

**Findings**:
- "Location permission needed" title + "Memory needs your location to draw the map." — clear.
- Two buttons: "Open Settings" (primary) + "Try again" (secondary). Correct hierarchy.
- `Linking.openSettings()` — deep-links to iOS Settings. Note: no way to know if user actually toggled permission until they return, at which point Try Again is manual. Could auto-retry on focus after settings-return, but this is a minor polish item.
- Copy could clarify WHAT setting to toggle. "Enable Location for Cairn under Settings > Privacy > Location Services." Bare "Open Settings" dumps user on the top-level Settings app on iOS 17+, requiring navigation.

**Playwright**:
```js
await page.context().grantPermissions([]);  // revoke geo
await page.click('[testID="tab-memory"]');
await page.waitForSelector('text=Location permission needed');
await page.screenshot({ path: 'memory-S5-perm-denied.png' });
```

---

## Scene S6 — Fog map rendered with revealed cells
**File**: `FogLayer.tsx:335-437` (fog shape), `:473-527` (rendered layers)
**Score**: 9/10

**Findings**:
- v346 architecture: single ShapeSource with world rect and buffered corridor holes. Warm dark-brown `rgba(58, 42, 24, 0.78)` — good fog-of-war aesthetic.
- Two-pass LineLayer halo (outer soft glow `rgba(247, 232, 200, 0.35)` blur 8, inner gold rim `rgba(255, 220, 165, 0.85)`) — lanterny effect, well-designed.
- `fillAntialias: false` intentional to avoid 1px seams (bug#7023 workaround) — will look slightly stairstepped on very shallow zoom, but halo hides it.
- Corridor width 25m at high zoom = ~150px, at low zoom = sub-pixel. Spike results validated at z9-z16.
- Content-hash short-circuit (`lastSigRef`) avoids re-render flicker when replacePoints with same points. Good.
- ONE concern: `fillOpacity: 1` combined with `rgba(...,0.78)` alpha in color — the opacity is baked into the color. Not a bug, but overrideability is weird. If a designer wants to tune alpha at runtime, they'd have to edit the color.

**Playwright**:
```js
// Setup: seed store with a hike path
await page.evaluate(() => {
  window.__cairnStores.useMemoryStore.getState().replacePoints([
    { lat: 22.3, lng: 114.17, ts: Date.now() - 100000, cid: 'a', synced: true },
    { lat: 22.31, lng: 114.18, ts: Date.now() - 90000, cid: 'b', synced: true },
  ]);
});
await page.reload();
await page.click('[testID="tab-memory"]');
await page.waitForTimeout(3000);
await page.screenshot({ path: 'memory-S6-fog-with-holes.png' });
```

---

## Scene S7 — 0 revealed cells (fresh user, world fog)
**File**: `FogLayer.tsx:152-155` (points.length===0 branch), `:352-364`
**Score**: 6/10

**Findings**:
- Solid world-rect fog, no holes. Correct behavior per v333 decision ("no hike imported = NO area unlocked").
- BUT there's no user-visible affordance saying "walk somewhere to unlock." Fog obscures everything, including the user location dot (blue dot fights against dark fog). First-time user sees "map is broken."
- The Modal onboarding at S1 explains this ONCE. After dismiss, if they return to Memory tab expecting to see something, they see solid fog and blue dot. Empty state has no in-context reinforcement.
- `HierarchyPanel` has an `emptyBanner` (line 179-185 in HierarchyPanel) that says "Head out and start walking to unlock places." — but this only appears in the panel, not on the main fog view.

**Recommendation** (not implementing per malware rule): consider a small pill at bottom saying "Walk to reveal the map" for zero-point users.

**Playwright**:
```js
await page.evaluate(() => {
  window.__cairnStores.useMemoryStore.getState().replacePoints([]);
});
await page.reload();
await page.click('[testID="tab-memory"]');
await page.waitForTimeout(3000);
await page.screenshot({ path: 'memory-S7-zero-points.png' });
```

---

## Scene S8 — Many revealed cells (100+ hike points)
**File**: `FogLayer.tsx:87-134` (segmentByGap), `:140-254` (buildFogShape)
**Score**: 8/10

**Findings**:
- `MAX_POINTS_PER_HIKE = 2000` cap prevents runaway. Progressive `unionTurf` merges corridors correctly (v352 fix for even-odd rule diamond spikes).
- `HIKE_GAP_MS = 60min` correctly bundles rest breaks into a single hike (was 5min pre-v354).
- SPATIAL_MERGE_RADIUS_M = 100 catches trailhead re-entry pattern.
- `SIMPLIFY_TOLERANCE_DEG = 5/111320` = 5m Douglas-Peucker — good for cleaning GPS jitter without visible distortion.
- Concern: SIMPLIFY on very long hikes (2000+ points) still O(N²) union across N segments. Comment says "<100ms for typical case" but 20+ hike sessions could push into 500ms+. Not a bug, but "fog.shape_built" log emits `build_ms` — worth monitoring.
- Corridors of length 1 (single-point unlock) buffered as `turfPoint + buffer`. Nice v400 fix.

**Playwright**:
```js
await page.evaluate(() => {
  const points = [];
  for (let i = 0; i < 200; i++) {
    points.push({ lat: 22.3 + i*0.001, lng: 114.17 + i*0.001, ts: Date.now() - (200-i)*30000, cid: 'p'+i, synced: true });
  }
  window.__cairnStores.useMemoryStore.getState().replacePoints(points);
});
await page.reload();
await page.click('[testID="tab-memory"]');
await page.waitForTimeout(5000);
await page.screenshot({ path: 'memory-S8-many-points.png' });
```

---

## Scene S9 — Hierarchy popover: World layer
**File**: `HierarchyPanel.tsx:129-138`, `MemoryScreen.tsx:769-832` (open handler)
**Score**: 6/10

**Findings**:
- Fetches `panel` data via `fetchPanelData(titleId='world', currentCityId, currentCountryId)`. Loading spinner shown while pending — good.
- Panel bottom-anchored at `bottom: 168`, width 236, centered horizontally. On iPhone SE (568h) this eats a huge chunk of screen. Not scrollable itself — only inner list is scrollable to `LIST_MAX_HEIGHT = 260`.
- Empty state: `showEmptyBanner` shows "Head out and start walking to unlock places." Good copy. But comment on line 132-136 admits contradiction: fresh user has locked_count ≈ 214 but items.length === 0, so banner shows AND the locked_count row is hidden (`!showEmptyBanner` condition). Weirdness: user with 0 unlocks sees the banner but doesn't learn "there are 214 countries out there" — a nice motivation number is hidden from the person who most needs it.
- "▼ more" scroll hint at bottom of scrollable list — cute but positioned at `bottom: 4` inside listContainer, floats above list content. May be occluded by items or overlap the sticky rows.
- **No max-panel-height**: title fontSize 20 lineHeight, list 260, legend + locked-row = potentially ~380px total. On 375x667 iPhone SE with `bottom: 168`, panel top edge is at 168+380 = 548 from bottom = 20 from top. Nearly clips the status bar.

**Playwright**:
```js
await page.click('[testID="hierarchy-btn"]');
await page.waitForSelector('[testID="hierarchy-panel"]');
await page.screenshot({ path: 'memory-S9-world-layer.png' });
```

---

## Scene S10 — Hierarchy popover: Country layer (tap a country)
**File**: `MemoryScreen.tsx:945-1010`, `HierarchyPanel.tsx:195-224`
**Score**: 7/10

**Findings**:
- Tap country row → parent sets `hierarchyTitleId=itemId`. Fetch fires with new title. NO fly-to (per spec — country tap only relabels).
- `↑` button appears in header when `data?.parent` exists → tap goes back to World. Discoverable.
- `is_here` country in world layer gets green dot + `rowNameHere` styling (Colors.primary, bold). Good visual "you are here."
- Sort order: is_here first, then marked (alpha), then walked (alpha). Consistent.
- Panel doesn't re-anchor when title changes — same position, just new content. Fine.
- Concern: tapping a country the user has never visited (walked/marked = false) is impossible because such countries are in "locked" summary. So user CAN'T explore the country layer for locked regions. Discoverability limitation but consistent with spec.

**Playwright**:
```js
await page.click('[testID="hierarchy-btn"]');
await page.click('[testID="hierarchy-row-CN"]');
await page.waitForSelector('text=China'); // title update
await page.screenshot({ path: 'memory-S10-country-layer.png' });
```

---

## Scene S11 — Hierarchy popover: Country → City tap → fly
**File**: `MemoryScreen.tsx:955-1010`
**Score**: 6/10

**Findings**:
- City tap computes bbox center, then searches `useMemoryStore.points` for a point IN the bbox, else falls back to `useMarkerStore.markers`, else bbox center.
- Zoom hardcoded ladder: span > 40 → z3, > 8 → z5, > 2 → z8, > 0.3 → z11, else z13. If foundExplored, force z14.
- setFlyToTarget bumps token, MemoryMap re-runs camera fly. `mapMoved` set to true so Recenter button appears.
- **Blocker-level concern**: `bboxCenterLat/Lng = (min+max)/2` is a simple average, NOT actual geographic centroid. For long/skinny cities (e.g. Chile city bbox that wraps) or antimeridian-crossing bboxes (Fiji, NZ), this can produce a fly-to in the ocean. Not verified in practice but a real risk.
- Panel does NOT close after fly. User sees map slide + panel still overlaid. Intentional? Per comment "flew to a target the user chose, so they can pick another." Might be right but adds cognitive load — panel now shows city as "here" and covers 40% of the screen the user wanted to see.
- `cameraCenterRef.current = { lat: flyLat, lng: flyLng }` eagerly updated (v441.1) — good race guard.

**Playwright**:
```js
await page.click('[testID="hierarchy-btn"]');
await page.click('[testID="hierarchy-row-CN"]');
await page.click('[testID="hierarchy-row-shanghai"]');
await page.waitForTimeout(1200);  // fly animation
await page.screenshot({ path: 'memory-S11-flew-to-city.png' });
```

---

## Scene S12 — Hierarchy popover close (backdrop tap)
**File**: `HierarchyPanel.tsx:142` (Pressable backdrop)
**Score**: 8/10

**Findings**:
- Full-screen `Pressable` behind panel, calls `onClose`. Correct pattern.
- No animation on close — panel just unmounts (`{hierarchyOpen && <HierarchyPanel />}` in MemoryScreen). Feels abrupt vs the fetched-then-appear open pattern.
- Also: backdrop is `zIndex: 15`, panel `zIndex: 20`, but Recenter/Hierarchy buttons underneath have zIndex 25 → the Hierarchy button STAYS TAPPABLE while panel is open. User tap on Hierarchy button (bottom-left) with panel open → panel state toggles closed and reopens (state race in the onPress handler: `if (hierarchyOpen) { setHierarchyOpen(false); return; }`) — so it works, but the button showing as `hierarchyBtnActive` while panel is open combined with active-color icon is subtle.

**Playwright**:
```js
await page.click('[testID="hierarchy-btn"]');
await page.click('[testID="hierarchy-backdrop"]');
await page.waitForSelector('[testID="hierarchy-panel"]', { state: 'detached' });
await page.screenshot({ path: 'memory-S12-panel-closed.png' });
```

---

## Scene S13 — Cairn markers overlay (mystery, unrevealed)
**File**: `MysteryCairnSheet.tsx:73-119`
**Score**: 7/10

**Findings**:
- Dark sheet `#2d2a26` with dashed orange border on `?` icon — clearly signals mystery.
- Metadata row: age + distance. Optional per `MysteryPreviewConfig`.
- Bearing arrow uses 8-direction unicode arrows in a solid orange circle → clear directional guidance. "Walk this way to reveal" caption.
- Distance uses `useDistance().formatShort` — respects user unit preference (m/ft vs km/mi). Good.
- Concern: `bearingDeg` calculated from user → cairn but does NOT account for device heading. So arrow points to the cairn from user's absolute position (compass north up), not from user's facing direction. When map is rotated, arrow may be misleading. Documented as `bearing from north` in comments — OK, but user may think arrow points relative to their body.
- Backdrop tap dismisses. `Modal onRequestClose` handles hardware back. Correct.
- Close button is a plain text link at bottom — no explicit `X` icon in the top-right, unlike system-standard modals. Minor discoverability.

**Playwright**:
```js
await page.click('[data-marker-id="mystery-1"]');
await page.waitForSelector('text=Someone left a cairn here');
await page.screenshot({ path: 'memory-S13-mystery-sheet.png' });
```

---

## Scene S14 — Cairn markers overlay (revealed, tap to open)
**File**: `RevealedCairnSheet.tsx:58-108`
**Score**: 5/10

**Findings** (multiple):
- **Blocker**: `onLike`, `onReport`, `onShare` handlers are NEVER wired up by parent (CairnPinsLayer). Per v416 comment on line 110-113: "CairnPinsLayer 从未传 onLike/onReport/onShare handler". So buttons render at opacity 0.4 (disabled) — user sees three greyed buttons with no explanation, feels broken. `ActionBtn` shows label but no tooltip explaining "coming soon."
- Voice memo mentioned in file header docs but NOT rendered in the JSX. Feature spec drift.
- Region label uses `regionLabel` prop but not passed by parent → always undefined → age line becomes just "3 d ago" without region context.
- "Now in your Memory" hint at bottom is a good UX touch. Keep.
- Title & body use `splitTitleBody(marker.note)` — good encoding pattern.
- Avatar initial fallback `'·'` for empty name — subtle, not ideal but works.

**Playwright**:
```js
await page.evaluate(() => {
  window.__cairnStores.useMarkerStore.getState().replaceMarkers([
    { id: 'm1', lat: 22.3, lng: 114.17, note: 'My peak\u001eBeautiful view', createdAt: Date.now()-86400000, authorId: 'u2', isMine: false }
  ]);
});
await page.reload();
await page.click('[data-marker-id="m1"]');
await page.waitForSelector('text=Like');
await page.screenshot({ path: 'memory-S14-revealed-sheet.png' });
// Verify buttons are visually disabled
const likeBtnOpacity = await page.$eval('text=Like', el => getComputedStyle(el.parentElement).opacity);
console.assert(parseFloat(likeBtnOpacity) < 0.5, 'BUG: Like should be visibly disabled');
```

---

## Scene S15 — Zoom in gesture (pinch)
**File**: `MemoryMap.tsx` + `MemoryScreen.tsx:748-761` (Recenter button state)
**Score**: 8/10

**Findings**:
- Pinch triggers `onMapMoved` → `setMapMoved(true)` → Recenter button appears at right-bottom.
- v352 fix: `persistentCoord` ref keeps MemoryMap mounted, no full-screen flash. Good.
- Fog buffered corridors scale with map zoom natively via Mapbox rendering — user's own walk is always the same 25m real-world width.
- At very high zoom (z18+) the halo blur may look excessive — 8px lineBlur at z18 covers real-world ~2m, wraps ends heavily.
- At zoom-out below z9, sub-pixel corridors disappear per Spike A-z14 validation. Acceptable.

**Playwright**:
```js
await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }))); // web mock zoom
await page.waitForTimeout(500);
await page.screenshot({ path: 'memory-S15-zoomed-in.png' });
```

---

## Scene S16 — Zoom out to world
**Score**: 7/10

**Findings**:
- Same fog geometry; corridors become sub-pixel. Halo LineLayer still visible → user sees a thin gold line at scale, indicating "path is here even though I can't see the corridor width."
- Nice emergent behavior. Not documented as intentional but works.
- HierarchyPanel button remains visible → user can tap to see world-level list.

---

## Scene S17 — Recenter button tap
**File**: `MemoryScreen.tsx:637-656` (onRecenter)
**Score**: 8/10

**Findings**:
- Bumps `recenterToken` → MemoryMap Camera flyTo current coord.
- Updates `cameraCenterRef` eagerly to real GPS (v445 fix).
- Only refetches GPS if watcher fix is stale (>10min). Otherwise camera-only. Good perf.
- After recenter, `setMapMoved(false)` from parent onPress → button hides again. Correct.
- Icon: Target crosshair — matches HikingScreen. Consistent.
- Concern: no feedback if watcher IS stale AND GPS is unavailable. User taps Target, sees no camera movement. Could show inline spinner.

**Playwright**:
```js
await page.click('[testID="tab-memory"]');
await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 300 })));
await page.waitForSelector('[data-testID="recenter-btn"]');
await page.click('[data-testID="recenter-btn"]');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'memory-S17-recentered.png' });
```

---

## Scene S18 — Reset memory (from Settings) → verify fog resets
**File**: (not shown, external reset action) → `useMemoryStore.replacePoints([])`
**Score**: 7/10

**Findings**:
- After reset, `points` becomes `[]` → FogLayer returns world-rect fog. Correct.
- `initialRevealDone` state controlled elsewhere → should also reset for onboarding-hint re-trigger, but code doesn't couple these.
- No confirmation from Memory tab that reset succeeded — user must navigate back to see fog is solid again.
- Reset from Settings should ideally close/re-mount MemoryScreen to force full reset — currently just relies on Zustand subscribers, which work but user may perceive stale state.

---

## Scene S19 — Friends fog overlay (friend memory union)
**File**: `MemoryScreen.tsx:154-169`, `FogLayer.tsx:275-291`
**Score**: 6/10

**Findings**:
- On mount, `loadSubs() + loadFriendFog()` fires. On subscription count change, refetch fires.
- When scope=friends, `FogLayer` computes union of `selfPoints ∪ enabledFriendPoints`. Fog corridors expand to include friend paths.
- Correctly gated: `if (scope !== 'friends') return selfPoints` (line 279). So Mine tab is untouched.
- Enabled friend list must be in `friendMemoryStore.getEnabledFriendPoints()` — the "which friends are checked" state. UI to check/uncheck friends is `MemoryFriendPickModal` behind the Pick icon (Users icon in scope toggle).
- Concern: no visual differentiation of "your unlock" vs "friend unlock" in fog. Both same corridor. If user is in Friends scope, they can't tell which parts they explored themselves vs borrowed. Comment says "reversing subscription returns the borrow" — good semantic — but visually it's not clear.

---

## Scene S20 — Loading overlay: stages 0/1/2 (loading map / trails / slow)
**File**: `MemoryScreen.tsx:840-864`, `:214-263` (state machine)
**Score**: 8/10

**Findings**:
- 0-2s: "Loading map…" 2-5s: "Loading your trails…" 5s+: "Network is slow, please wait…"
- Good staged messaging — reduces perceived latency (per skeleton-screen research cited in comments).
- 8s hard timeout fades overlay + shows slow banner (see S21).
- Cairn logo circle with Mountain icon, letter-spaced title, spinner. Well-composed.
- pointerEvents="none" on overlay → user can tap Back button through it. Correct.
- Concern: no min-show for stage 0 → 1 transition. If map+fog ready at 1.5s, user sees "Loading map…" for 1.5s then poof-fade. Fine, but stage 1's "Loading your trails…" gets skipped in that case → user never sees it. Not a bug, but the two-stage narrative is undermined.

**Playwright**:
```js
// Throttle network to reveal stages
await page.route('**/mapbox/**', route => setTimeout(() => route.continue(), 3000));
await page.click('[testID="tab-memory"]');
await page.screenshot({ path: 'memory-S20a-stage0.png' });
await page.waitForTimeout(2200);
await page.screenshot({ path: 'memory-S20b-stage1.png' });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'memory-S20c-stage2.png' });
```

---

## Scene S21 — Slow network banner (8s timeout, banner shows)
**File**: `MemoryScreen.tsx:880-905`, `:238-263`
**Score**: 8/10

**Findings**:
- Frosted-pill white banner at top-right. "Weak signal — still loading map…" + spinner + X close.
- Min-show 2s (v368) so banner doesn't flash. Good.
- Auto-closes when map+fog eventually ready (v367). Good.
- User X-close dismisses for the rest of Memory tab session (v363). Reset on mountKey bump.
- Left offset 100 to avoid overlapping Back button. Right stretches to 12px from edge. Good layout.
- Concern: `numberOfLines={1}` on text truncates on very narrow devices (iPhone SE 320w minus 100 left minus 40 right = 180px for spinner + text + X). "Weak signal — still loading map…" is ~30 chars; at 11pt bold, ~150px. Might truncate. Should test at 320w.
- BackButton pill height is 31 (fontSize/lineHeight). Banner height styled to 31. Match confirmed.

**Playwright**:
```js
await page.route('**/mapbox/**', route => setTimeout(() => route.continue(), 10000));
await page.click('[testID="tab-memory"]');
await page.waitForTimeout(9000);
await page.screenshot({ path: 'memory-S21-slow-banner.png' });
```

---

## Scene S22 — Small screen 375 (iPhone SE) layout
**Score**: 5/10

**Findings**:
- topBar: BackButton left + MemoryScopeToggle right, `justifyContent: 'space-between'`. On 375w with insets ~44px + 12+12 gutters + scope toggle ~150w → BackButton ~50w → gap ~110px. Fits.
- Hierarchy button (left bottom 16) + Recenter button (right bottom 16), 48x48. Bottom stacking with Tab Bar (approx 84 iPhone SE with home button) puts them at bottom:110 → clear of tab bar. OK.
- Hierarchy panel `width: 236` centered — leaves ~70px on each side. Fine.
- MysteryCairnSheet + RevealedCairnSheet use `paddingHorizontal: 24` + `maxWidth: 240` on descriptions → OK.
- Loading overlay logo + title + sub + spinner vertically centered — verified visually consistent.
- **Concern**: slow banner (S21) may truncate on 320w devices (iPhone SE 1st gen). Not commonly targeted for 2026 launches but worth noting.

---

## Scene S23 — Playwright web bypass (`__cairnStores` hook)
**File**: (Test hooks from user memory `project_v406_web_test_hook.md`)
**Score**: 6/10

**Findings**:
- Global `window.__cairnStores` exposed for test injection. Documented as production-delete requirement.
- Currently allows any web test to `replacePoints`, `replaceMarkers`, seed friend memory, etc. Great for testing.
- Concern: any production release with this hook still shipped = security/data-integrity risk. Per USER_CONFIG memory: "production release 前必删." Verify in build hooks.

---

## Scene S24 — Real GPS mode (watcher fresh)
**File**: `MemoryScreen.tsx:485-547` (coord resolution priority)
**Score**: 8/10

**Findings**:
- Priority: fresh watcher fix > oneShot > stale watcher. Correct (v0.2.6.4 S1 fix).
- Cross-city detection: if watcher fix vs fresh GPS > 2km with <100m accuracy → force `mapMoved=true` so Recenter button appears immediately (UX #11 CRIT-2).
- Watcher fresh window: 10 minutes.
- Handles cold start via `readLastFix()` from AsyncStorage → immediately populates store so map draws at last-known.
- Focus refetch debounced 5s to avoid GPS thrashing on rapid tab-switch.
- Map remount debounced 5min (Mapbox reload is expensive).
- Well-tuned overall.

---

## Scene S25 — MemoryFriendPickModal (from Users icon)
**File**: `MemoryFriendPickModal.tsx` (imported only — quick check)
**Score**: (deferred to auditor covering plant/friend zone)

**Findings**:
- Opens via `pickModalOpen` state, closes normally.
- `onCapHit` callback triggers PaywallSheet (>=6 friends per Sprint 70 STORY-00542). Correct paywall gating.
- Full modal audit out of scope for #7.

---

## Scene S26 — Marker like button state (revealed sheet)
**File**: `RevealedCairnSheet.tsx:88-91`
**Score**: 3/10 (Critical)

**Findings**:
- Prop `isLiked` toggles label between "Like" and "Liked ✓". Correct.
- BUT parent doesn't wire `onLike` handler currently (per S14). So `isLiked` state can never advance from parent, and tapping does nothing. `disabled` guard on `ActionBtn` matches.
- **Bug**: no local optimistic state, no server round-trip, no error toast. Feature is a stub visually shipping as if functional.
- Recommend: hide the entire actions row when handlers are not provided, so it doesn't imply "coming soon" to end users who wonder why they can't like.

---

## Scene S27 — Marker report action
**File**: `RevealedCairnSheet.tsx:90`
**Score**: 3/10 (Critical)

**Findings**:
- Same as S26: `onReport` never wired. `isReported` state comes from parent → never advances.
- Report is a moderation-critical feature. Ship-blocker: users on App Store need a working report flow to comply with UGC guidelines. Apple review guideline 1.2 requires "a mechanism for users to flag objectionable content."
- Blocker for launch.

---

## Scene S28 — Long distance from home (fly across continents via hierarchy)
**File**: `MemoryScreen.tsx:955-1010` (city-tap fly)
**Score**: 7/10

**Findings**:
- User in HK, taps China → Beijing city → fly z14 to Beijing. Fine.
- Simultaneously the fog is still HK-only (no beijing corridors). User sees solid brown fog over Beijing except at basemap. Consistent behavior but confusing to naïve user: "I flew here but everything is dark."
- No accompanying hint like "Walk here to unlock" popped up on fly-to a locked city. Missed teaching moment.

---

## Scene S29 — Hierarchy panel opens with stale camera center (v447 bug)
**File**: `MemoryScreen.tsx:788-806`
**Score**: 8/10

**Findings**:
- Documented bug (v445 → v447 fix): `cameraCenterRef` was stale because Mapbox native `onCameraChanged` rarely fires with `e.properties.center` populated during pan. v447 fix: prefer live `mapRef.current.getCurrentCenter()` async call before `fetchDeepest`.
- Fallback chain: live → ref → persistentCoord → { 0,0 }.
- Race guard `panelOpenRequestIdRef` ensures obsolete open-request doesn't apply state. Good.
- Any error in `getCurrentCenter` logged as `v447.hierarchy_open_getcenter_err`.

---

## Scene S30 — MemoryScope switch during hierarchy panel open
**Score**: 6/10

**Findings**:
- Scope toggle in top bar is tappable while panel is open (no shared modal state).
- Scope change → FogLayer union recomputes → fog re-renders in place. Panel content stays valid because fetchPanelData is scope-agnostic.
- However, panel `is_here` computation is server-side using currentCityId/CountryId based on map center — unaffected by scope. So switching Friends → Mine won't change what's green in the panel. Ambiguous: user might expect Friends scope to show green in cities they've only visited via friends? Not currently a case since panel is about YOUR walked/marked places only.
- Recommend clearer semantics: title panel with "Your Memory" when Mine, "Shared Memory" when Friends.

---

# Summary of severity

| Sev | Count | Scenes |
|-----|-------|--------|
| **Blocker** | 2 | S14 (revealed-sheet handlers unwired), S27 (report action broken — Apple review) |
| **Critical** | 4 | S3 (tap target <44pt), S3 (Friends empty state), S26 (like button broken), S23 (production hook not stripped) |
| **Medium** | 8 | S1 (backdrop tap missing), S4 (no manual retry mid-loading), S7 (no zero-point CTA), S9 (panel height on SE), S11 (bbox center on antimeridian), S12 (hierarchy button under panel), S28 (no teach on remote fly), S30 (scope semantics unclear) |
| **Low** | 6 | Others |

# Top recommendations (analysis only — no code changes made)
1. Wire `RevealedCairnSheet` action handlers OR hide the actions row until Sprint that ships them. Currently ships as visually-broken stubs.
2. Add zero-state UI on empty fog view — "Walk to reveal the map" pill.
3. Increase MemoryScopeToggle segment tap target to ≥44pt.
4. Add "no friends yet — tap Users to pick" empty state when Friends scope + subscriptions.length === 0.
5. Guarantee production build strips `window.__cairnStores` before App Store submission.
6. Consider auto-close of HierarchyPanel after a city fly-to (or shrink to a mini pill).

# Files touched (read-only)
- `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\screens\MemoryScreen.tsx`
- `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\components\FogLayer.tsx`
- `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\components\HierarchyPanel.tsx`
- `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\components\MysteryCairnSheet.tsx`
- `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\components\RevealedCairnSheet.tsx`
- `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\components\MemoryScopeToggle.tsx`
- `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\components\MemoryMap.tsx` (partial)

End of audit.
