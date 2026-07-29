# PlantScreen UX/UI Audit — Auditor #5

**Date**: 2026-07-28
**Scope**: PlantScreen 3-step flow (GpsLockStep → PinAdjustStep → ContentStep)
**Files audited**:
- `app/src/screens/PlantScreen.tsx`
- `app/src/features/plant/components/GpsLockStep.tsx`
- `app/src/features/plant/components/PinAdjustStep.tsx`
- `app/src/features/plant/components/ContentStep.tsx`
- `app/src/features/plant/config/plantConfig.ts`
- `app/src/features/plant/services/gpsSampler.ts`
- `app/src/features/plant/services/noteEncoding.ts`
- `app/src/config/markerTypes.ts` (5-type source of truth)
- Baseline: `app/src/screens/SettingsScreen.tsx` (O12 design system reference)

**Auditor mandate**: enumerate ≥20 scenarios, score each, propose Playwright verification script per scenario.

**Scoring rubric (out of 10)**:
- 10 = flawless, ship-ready, matches Settings O12 baseline polish
- 8-9 = production quality with minor tightening opportunity
- 6-7 = works but shows friction / inconsistency
- 4-5 = mid-priority bug — user can still complete flow
- 1-3 = high-priority bug — user blocked or confused
- 0 = broken / crashes

**Note about test methodology**: reads-only audit. All findings are code-derived; Playwright scripts below are recommendations for a follow-up runtime audit round (per Cairn 4-eye protocol).

---

## Scenario Register (28 scenarios)

### S01 — GpsLockStep native happy path (fast fix via watcher cache)

**Location**: `GpsLockStep.tsx:118-183`
**Path**: Watcher `lastWatcherFix` present and <12s old → fires `onLockedRef.current(lat, lng, 10)` inside `.then()`. Bypasses the 5s progress bar.

**Findings**:
- FAST path fires `onLocked` synchronously off the async chain but the `progress` bar has already rendered at 0 with an ActivityIndicator. On a real device, user sees a flash of "Finding your ground" + spinner for ~50ms → transition. **Feels abrupt** — no visual "we caught your position" moment.
- Accuracy is hardcoded to `10` — passed downstream but the user is never shown "we used a cached fix" cue. Consistency risk: if the watcher cache was actually stale-ish (10s), reported accuracy is a fiction.
- No haptic feedback on lock (contrast: ContentStep submit has `haptic.notification('success')` in commit → 250ms delay). Fast-path plant users get no "click" that they've moved forward.

**Score**: 7 / 10

**Playwright script**:
```js
// Web-run: seed useMemoryStore.lastWatcherFix via __cairnStores hook (v406 test hook)
await page.evaluate(() => {
  window.__cairnStores.memory.setState({
    lastWatcherFix: { lat: 31.232068, lng: 121.434262, ts: Date.now() - 3000 }
  });
});
await page.click('text=Plant a Cairn');
await page.waitForSelector('text=Where\'s your cairn?', { timeout: 500 });
await page.screenshot({ path: 'docs/qa/sprintO2-evidence/PLANT-S01.png' });
// Assert: progress screen appeared for <200ms
```

---

### S02 — GpsLockStep slow path (no cache, full 5s sample)

**Location**: `GpsLockStep.tsx:184-208` + `plantConfig.ts` `windowSeconds:5`
**Path**: No `lastWatcherFix`, no `getLastKnownPositionAsync` — runs full `sampleGpsWindow()`.

**Findings**:
- Progress text uses `${Math.max(0, GpsSamplingConfig.windowSeconds - Math.round(progress * GpsSamplingConfig.windowSeconds))}s remaining` — good literal countdown copy.
- Progress bar is 4px tall, sepia fill on cream bg — visually understated. On sun-lit outdoor iPhone screen this is barely visible. **Contrast bug candidate**.
- Copy "Hold still for a moment while we get an accurate reading." is exactly one sentence, no exclamation, no jargon — passes Cairn voice.
- The `ActivityIndicator` runs concurrently with the deterministic progress bar → **double loading spinner smell**. User sees two motion signals for the same wait, which reads as "designer couldn't pick one".

**Score**: 7 / 10

**Playwright script**:
```js
// Force slow path: clear watcher cache + block getLastKnownPositionAsync
await page.evaluate(() => {
  window.__cairnStores.memory.setState({ lastWatcherFix: null });
});
await page.click('text=Plant a Cairn');
const t0 = Date.now();
await page.waitForSelector('text=Where\'s your cairn?', { timeout: 8000 });
const elapsed = Date.now() - t0;
console.assert(elapsed >= 4500 && elapsed <= 6500, 'slow-path timing');
```

---

### S03 — GpsLockStep dev/web mock fallback (Shanghai coords)

**Location**: `GpsLockStep.tsx:37-39, 63-69`
**Path**: `__DEV__ && Platform.OS === 'web'` → fires `WEB_MOCK_LAT/LNG` at `31.232068, 121.434262` after 100ms.

**Findings**:
- **UX RISK**: no visible indicator that a mock is in play. Playwright web sessions will silently plant markers at Shanghai for any local dev iteration. Multiple markers seeded during test runs could pollute the debug DB with "Shanghai clusters" unless test cleanup is strict.
- Consistency: the mock skips permission check entirely (returns before `Location.getForegroundPermissionsAsync`) — good, prevents web permission crash.
- No UI banner "DEV mock mode — planting at test coords". Feels like a landmine for new contributors.

**Score**: 6 / 10 (works but silent, invites debugging pain)

**Playwright script**:
```js
// Web should hit mock automatically
await page.goto('http://localhost:8081');
await page.click('text=Plant a Cairn');
await page.waitForTimeout(300); // 100ms mock + margin
// Should already be on step 2 (Pin Adjust)
await expect(page.locator('text=Where\'s your cairn?')).toBeVisible();
```

---

### S04 — GPS permission denied (canAskAgain=true)

**Location**: `GpsLockStep.tsx:95-117, 265-273`
**Path**: `existing.status !== 'granted' && existing.canAskAgain` → `requestForegroundPermissionsAsync` returns denied → sets `result: { ok: false, reason: 'permission-denied' }`.

**Findings**:
- Failure copy: **"Location permission needed"** in red pill + sub "Move to a more open spot and try again." — the sub is wrong for permission failures! It's meant for `accuracy-too-poor` / `too-jumpy`. Permission-denied users see "Move to a more open spot" which is nonsensical. **Copy bug**.
- Retry button says "Try again" — will only re-run permission request, but if `canAskAgain=false` the retry silently loops. **Dead retry state**.
- No deep link to iOS Settings app (`Linking.openURL('app-settings:')`). Users stuck with denied permission cannot recover from within the app.

**Score**: 3 / 10 (major blocker — no recovery path)

**Playwright script**:
```js
// Requires native or MSW patch to force permission-denied
await page.evaluate(() => {
  window.__cairnMocks = { permissionStatus: 'denied', canAskAgain: true };
});
await page.click('text=Plant a Cairn');
await expect(page.locator('text=Location permission needed')).toBeVisible();
await page.screenshot({ path: 'docs/qa/sprintO2-evidence/PLANT-S04.png' });
// Bug expected: sub-copy reads "Move to a more open spot" which is wrong
```

---

### S05 — GPS permission denied (canAskAgain=false / permanent)

**Location**: `GpsLockStep.tsx:99-106`
**Path**: `existing.status !== 'granted' && !existing.canAskAgain` → `permissionGranted = false` without user prompt.

**Findings**:
- Same failure UI as S04, no differentiation. User cannot tell "I have to open Settings" vs "The retry will re-prompt me". **Both cases collapse to the same dead-end screen**.
- No `Linking.openSettings()` CTA anywhere. Contrast: SettingsScreen has proper `Linking.openURL(PRIVACY_URL)` patterns.

**Score**: 2 / 10 (functionally broken recovery)

---

### S06 — GPS accuracy-too-poor failure

**Location**: `GpsLockStep.tsx:265-273`
**Path**: `sampleGpsWindow` returns `{ ok: false, reason: 'accuracy-too-poor' }` (raw > 25m).

**Findings**:
- Copy is clean: "GPS signal is weak" + "Move to a more open spot and try again." — this is the correct sub-copy for THIS reason (see S04 for cross-reason bug).
- Retry works — resets `retryToken`, re-runs full 5s cycle. Good.
- No indication of how weak (no "we saw 37m"). Users planting near cliffs / tree canopy get no hint about how far they are from thresholds.

**Score**: 8 / 10

---

### S07 — GPS too-jumpy failure

**Location**: `GpsLockStep.tsx:265-273`, `plantConfig.ts` `rejectStdDevAboveMeters:6`

**Findings**:
- Copy "GPS is jumping around" — plain-English, no jargon. Good.
- Same sub "Move to a more open spot" — arguably could be "Wait 30s for GPS to settle" but "open spot" catches the common case.
- No difference between accuracy-too-poor + too-jumpy UI beyond title.

**Score**: 8 / 10

---

### S08 — PinAdjustStep first mount / initial framing

**Location**: `PinAdjustStep.tsx:74, 419-478`
**Path**: Camera default center = `originRef` (GPS anchor), `INITIAL_ZOOM = 15.5`, 50m dashed ring rendered.

**Findings**:
- Zoom 15.5 gives ~80px ring diameter — readable but tight. On iPhone SE (375px) ring occupies 21% of map area. On Pro Max (430px) same 80px ring is 18.6% — feels smaller.
- No "you are here" chip / hint. Users seeing satellite tiles + a static pin need a "This is your current GPS spot" annotation. **Cognitive gap**.
- The map wrap uses `flex:1, minHeight:280` — good, adapts to screen height. Contrast v419 comment shows this was fixed already.
- Placeholder copy "Drag the map to fine-tune. Tap Confirm when it feels right." — first-time users may not realize the pin is fixed and map moves (inverted mental model from Google Maps drop-pin). **Discoverability gap**.

**Score**: 7 / 10

**Playwright script**:
```js
await page.click('text=Plant a Cairn');
await page.waitForSelector('text=Where\'s your cairn?');
// Wait for camera-ready (first onMapIdle)
await page.waitForTimeout(600);
await page.screenshot({ path: 'docs/qa/sprintO2-evidence/PLANT-S08-375.png' });
await page.setViewportSize({ width: 430, height: 932 });
await page.screenshot({ path: 'docs/qa/sprintO2-evidence/PLANT-S08-430.png' });
```

---

### S09 — PinAdjustStep drag within 50m ring

**Location**: `PinAdjustStep.tsx:256-307, 321-359`
**Path**: `onCameraTick` throttled to 10Hz, updates `latestCoordRef`, checks haversine < 50m → `overLimit=false`.

**Findings**:
- Throttle (100ms) + ref-mirror pattern (v301 Pri-1 fix) is genuinely well-engineered — extensive comments show past pain of "Back tap delayed 5 seconds". Good.
- Confirm button re-checks `latestCoordRef` at tap time (v297 B2) — race-safe.
- Pin visual (`pinDot` 30px outer + 10px inner, `Colors.flag` orange) is NOT the selected marker type color. User can pick `Danger` (red) in step 3 but the pin they placed shows orange — **visual inconsistency**. See S13.

**Score**: 8 / 10

---

### S10 — PinAdjustStep drag past 50m ring

**Location**: `PinAdjustStep.tsx:282-291, 355-358, 493-500`
**Path**: `overLimit=true` → button label swaps to "Pin too far — pan back within 50 m", disabled bg = `#d4ccbd`.

**Findings**:
- Hint banner ("Pin stays within 50 m of your GPS spot.") is dark bg / white text 12px — readable, 2.5s auto-hide. Good.
- Button disabled state uses opacity 0.4 → text opacity 0.85 explicitly re-set (see `primaryBtnTextDisabled`). Legible.
- Copy is bilingual-mind English — "pan back within 50 m" is fine for AU/NZ English target market.

**Score**: 9 / 10 (clean edge case handling)

---

### S11 — PinAdjustStep +/- zoom buttons

**Location**: `PinAdjustStep.tsx:366-381, 515-542`
**Path**: Native pinch fully disabled (v297 root cause fix). `+/-` buttons call `setCamera` with `centerCoordinate` locked to `latestCoordRef`.

**Findings**:
- Physical impossibility of pin drift via zoom — architectural win.
- Button size: 36×36 rounded 18. Apple HIG minimum tap target is 44×44 — **fails HIG**. On iPhone SE with sweaty gloved hands this is risky.
- Disabled state at MIN/MAX_ZOOM (14 / 20) uses reduced bg + `Colors.textSecondary` icon. Good.
- No visual indication of current zoom level. Users repeatedly tap + wondering if they hit max.

**Score**: 7 / 10 (correct behavior, but tap target too small)

---

### S12 — PinAdjustStep style toggle (outdoors ↔ satellite)

**Location**: `PinAdjustStep.tsx:154-158, 502-514`

**Findings**:
- Icon toggle uses `Globe` when in outdoors, `Map` when in satellite — semantically inverted for many. Convention: current mode icon vs next-mode icon. Cairn uses next-mode icon (globe = "tap to go satellite"). Documentation absent — user has to try.
- v298 N2 removed the first-time mobile-data warning modal. Fair for MVP but may bite on-trail users on limited plans. **Mid-priority tradeoff**.
- Toggle is 36×36 — same HIG concern as zoom (see S11).

**Score**: 7 / 10

---

### S13 — Pin color vs selected marker type mismatch

**Location**: `PinAdjustStep.tsx:697-711` (pinDot uses `Colors.flag` hardcoded) vs `ContentStep.tsx:88-108` (type chip shows selected color).

**Findings**:
- Pin is dropped in step 2 BEFORE the user picks the type in step 3. So the pin visual can't reflect the type — but the type default is `DEFAULT_TYPE = 'danger'`. Danger meta.color is `Colors.danger` (red). Pin renders `Colors.flag` (orange).
- **Inconsistency**: pin visual in step 2 = orange, pin in the eventual MarkerDetail (after step 3 red-Danger commit) = red. User sees color shift with no cue.
- Fix would be to defer type selection to step 2 or push type to step 2. Product decision.

**Score**: 5 / 10 (real visual drift bug)

**Playwright script**:
```js
// Verify pin color in step 2
await page.click('text=Plant a Cairn');
await page.waitForSelector('text=Where\'s your cairn?');
const pinColor = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="pin-dot-inner"]');
  return el && getComputedStyle(el).backgroundColor;
});
// Then complete flow with type=Danger, verify MarkerDetail pin color
// Expect: colors differ → bug
```

---

### S14 — PinAdjustStep re-entry from step 3 back

**Location**: `PlantScreen.tsx:281-297`, `PinAdjustStep.tsx:98-105`
**Path**: `gpsLat/gpsLng` frozen at step 1 lock, `lat/lng` = last confirmed pin coord. Re-mount with clamp guard.

**Findings**:
- Invariant enforcement (v298 N5) is strong: "back-from-content can never expand the allowed pin radius". Comment quality is excellent.
- Clamp fallback: `initialDist > 50 ? gpsLat : initialLat` — defensive.
- But: re-mounting resets `cameraReadyRef` to false → user sees another 200-500ms map init dance. **Perceived latency on back-navigation**.

**Score**: 7 / 10

---

### S15 — PinAdjustStep recenter button (Target)

**Location**: `PinAdjustStep.tsx:387-410, 546-559`
**Path**: v299 N4 — Target icon appears only after `hasMoved=true`; taps setCamera to origin, 280ms ease.

**Findings**:
- Visibility conditional on `hasMoved` — clean, avoids no-op button.
- v420 fix (`recenterSuppressRef`) mid-animation logic prevents icon flicker. Good.
- Icon: `Target` in `Colors.primary` — primary blue on white pill. Matches Cairn design system.
- No tooltip / label on this button ("Recenter" or "Back to GPS"). First-time user must guess.

**Score**: 7 / 10

---

### S16 — Mapbox tile load failure / offline map

**Location**: `PinAdjustStep.tsx:412-416` (Mapbox.available fallback), plus no network state check.

**Findings**:
- `!Mapbox.available` triggers `PinAdjustFallback` showing raw lat/lng in Courier font — technically correct, aesthetically minimal.
- **No handling for tile load failure while Mapbox IS available**. If satellite tiles fail (rural NZ, poor cell), user gets grey squares with the 50m dashed ring floating over void.
- No cached tile strategy visible in this file (may exist in `mapboxAdapter` — not audited here).
- No retry / "reload map" button.

**Score**: 5 / 10

**Playwright script**:
```js
await page.route('**/tiles/**', route => route.abort());
await page.click('text=Plant a Cairn');
await page.waitForSelector('text=Where\'s your cairn?');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'docs/qa/sprintO2-evidence/PLANT-S16-tile-fail.png' });
// Check: does the map show a fallback or a broken void?
```

---

### S17 — ContentStep type picker (5 chips)

**Location**: `ContentStep.tsx:87-108`, `markerTypes.ts:43-96`

**Findings**:
- 5 types: Danger / Junction / Water / Hut / Cairn. Ordered by severity → memento (good UX heuristic: emergency-first).
- Chips use `flexWrap: 'wrap'` + `gap:6` — on iPhone SE (375px available minus 20+20 padding = 335px), 5 chips of average ~65px width fit one row tightly. On smaller viewports may wrap awkwardly to 2 rows unbalanced.
- Active state: chip bg swaps to `meta.bg` (soft tint), border swaps to `meta.color`, label weight → 500. Good contrast.
- Icon uses `strokeWidth:2` consistent with lucide default. **cairn type still uses `Mountain` icon** per markerTypes comment — but the map pin uses `<CairnStoneIcon>` SVG. **Icon mismatch between plant flow chip and final rendered pin**.

**Score**: 7 / 10

---

### S18 — Title input (max 30 chars) + counter

**Location**: `ContentStep.tsx:110-119`, `plantConfig.ts` `titleMaxChars: 30`

**Findings**:
- `maxLength={30}` hard-cap at input level → OS keyboard cannot input more. Good.
- Counter `{title.length} / 30` right-aligned, 10px `cairnPublic` gray. Very subtle — could be missed. **Legibility hit**.
- Counter uses `marginTop: -8, marginBottom: 8` to hug the input. Fragile — any padding change on `input` breaks alignment.
- No warning color as user approaches 30 (e.g., red at 28+). Passive counter only.

**Score**: 7 / 10

---

### S19 — Body input (max 200 chars) + counter

**Location**: `ContentStep.tsx:120-130`

**Findings**:
- `textArea` `minHeight:80, textAlignVertical:'top'` — 4-line default. Good.
- Placeholder "Tell whoever finds this…" — voice-matches Cairn product soul (see markerTypes comment "留言 + 备忘 + 拍照打卡").
- Same 10px counter concern as S18.
- `blurOnSubmit={false}` + `returnKeyType="default"` for multiline — good, prevents accidental keyboard dismiss on Enter.

**Score**: 8 / 10

---

### S20 — Voice memo placeholder ("coming soon, max 30s")

**Location**: `ContentStep.tsx:132-134`

**Findings**:
- Copy: "🎤 Voice memo (coming soon, max 30s)" — emoji use is inconsistent with rest of app (Settings screen uses lucide Icons, not emoji).
- Box takes up UI real estate (padding 14 + border) but is entirely non-functional — reads as broken feature.
- No "Notify me when this ships" or similar affordance. Passive dead space.
- Contrast: Cairn's design language elsewhere hides unshipped features (SettingsScreen O12 doc explicitly removed "unimplemented" toggles). This is inconsistent with that principle.

**Score**: 4 / 10 (should be hidden until shipped, per Settings O12 precedent)

---

### S21 — Visibility chips (Just me / Friends / Anyone)

**Location**: `ContentStep.tsx:136-143`, `plantConfig.ts` `VisibilityConfig`

**Findings**:
- V1 hides "Anyone" (public) — controlled by `enablePublicOption=false`. Good — matches backend Sprint 67 enforcement.
- Current default: `defaultLevel:'friends'` → `defaultVisibility()` returns `'group'`. Good v4 product binding.
- Chips use `flex:1` even distribution — but with public hidden, 2 chips split the row 50/50. Wide chips look empty-hearted at Pro Max width.
- Icon set: Lock / Users / Globe — consistent with Icon component vocabulary. Good.
- The "Once shared publicly, what others see is frozen forever." hint is correctly gated by `enablePublicOption`. If enabled=false, hint hidden — clean.

**Score**: 8 / 10

---

### S22 — Plant Cairn button states (idle / submitting / disabled)

**Location**: `ContentStep.tsx:157-173, 62-63`

**Findings**:
- `canSubmit = !submitting && (!requireAtLeastOneContent || hasContent)` — good, blocks empty submit.
- Submitting label: "Planting…" — good gerund, no spinner. But no spinner OR spinner would be clearer feedback. Some users double-tap thinking it didn't register. **250ms `haptic.notification('success')` + delay after commit** partially addresses this in PlantScreen commit path.
- Disabled state uses `opacity: 0.4` — legible but no explanation why disabled. First-time user with empty title AND empty text sees dim button, doesn't know they need content.

**Score**: 7 / 10

---

### S23 — Loading during POST /markers (commit path)

**Location**: `PlantScreen.tsx:160-268`

**Findings**:
- `submitting` state locks button + prevents double-invocation (`if (submitting) return;`). Good.
- Failure path (`catch`) preserves draft to AsyncStorage (`draftKey(userId)`) — safety-net design. Good.
- 250ms artificial delay before nav (`v418 ceremony`) with success haptic — feels intentional, matches "physically feel cairn planted".
- **No timeout wrapper**. If `addMarker` hangs (bad WiFi), button stays "Planting…" forever. Users may force-quit. Consider 15s timeout with Alert.

**Score**: 7 / 10

---

### S24 — Commit success → navigate to MarkerDetail

**Location**: `PlantScreen.tsx:214-227`

**Findings**:
- `nav.replace('MarkerDetail', { markerId: created.id })` — clean, no Plant flow tombstone on stack.
- Fallback `nav.canGoBack() && nav.goBack()` if no `created.id` — defensive.
- Offline path Alert: "Cairn planted (offline)" — appears BEFORE `setTimeout(250)` + `nav.replace`. On Alert dismiss, user sees the flow briefly then MarkerDetail. Race: does Alert dismiss block the 250ms setTimeout? Yes it does (blocking Alert.alert with OK button). Nav happens after user OKs. Reasonable behavior.

**Score**: 9 / 10

---

### S25 — Commit failure (400 / 500 / network)

**Location**: `PlantScreen.tsx:236-252`

**Findings**:
- Draft saved to storage — bulletproof.
- Alert message: `(e?.message ? String(e.message) : 'Please try again in a moment.') + '\n\nYour draft is saved — try again or come back later.'`
- **Leaks server error strings into user-facing Alert**. If `addMarker` throws with technical error ("HTTP 400: permission not allowed for anonymous"), user sees jargon. Should wrap in friendlier copy.
- No retry button in the Alert — user has to dismiss + tap Plant Cairn again.
- Stays on content step — good, no data loss.

**Score**: 6 / 10

**Playwright script**:
```js
await page.route('**/api/markers', route => route.fulfill({ status: 500, body: '{"error":"internal"}' }));
// Complete flow
await page.click('text=Plant a Cairn');
await page.waitForSelector('text=Leave a mark');
await page.fill('input[placeholder^="Title"]', 'Test');
await page.click('text=Plant Cairn');
await page.waitForSelector('text=Could not plant cairn');
await page.screenshot({ path: 'docs/qa/sprintO2-evidence/PLANT-S25-500.png' });
```

---

### S26 — Back navigation semantics

**Location**: `PlantScreen.tsx:284, 304, 315`, `GpsLockStep.tsx:258-260`, `PinAdjustStep.tsx:424-426`, `ContentStep.tsx:75-77`

**Findings**:
- Step 1 Cancel → `nav.goBack()` (exits Plant).
- Step 2 Back → `nav.goBack()` (exits Plant, NOT back to step 1 — deliberate, gps auto-advances). Comment explains rationale well.
- Step 3 Back → `setStep('pin')` (returns to step 2 with pin coord preserved).
- **Inconsistency**: step 1 uses TouchableOpacity text link, step 2/3 use `<BackButton variant="pill">`. Two different UI patterns for "leave this step". Copy also differs ("Cancel" vs "Back").
- Step 2 Back exiting entire flow is surprising if user expects to redo GPS lock. Comment explains why, but no in-UI clarification.

**Score**: 6 / 10

---

### S27 — Empty title + empty body validation

**Location**: `ContentStep.tsx:62-63`

**Findings**:
- `requireAtLeastOneContent: true` → `canSubmit=false` when both empty. Button disabled at 0.4 opacity.
- **No error message**. User sees dim button, doesn't know what triggered.
- No inline "Add a title or a note to plant this cairn" hint.
- Also: type is required (defaults to Danger) but visibility is required (defaults to Friends). Neither can be null — good, no validation loop.

**Score**: 5 / 10

---

### S28 — Long content overflow / very long titles

**Location**: `ContentStep.tsx:110-118` + `PlantScreen.tsx:171 encodeTitleBody`

**Findings**:
- Title `maxLength={30}` hard-blocks input. Good.
- Body `maxLength={200}` hard-blocks. Good.
- `encodeTitleBody` joins with `\u001E` separator — round-trip safe.
- Text area `minHeight:80` expands naturally with content (multiline). But no max height — a 200-char body on iPhone SE could push the Plant Cairn button off-screen. `KeyboardAvoidingView` + `ScrollView` mitigates but the button is OUTSIDE the ScrollView (`bottomBar` is in the outer `<View>`). **Layout risk** on smallest devices with keyboard open.

**Score**: 6 / 10

**Playwright script**:
```js
await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
// Complete steps 1+2
// On step 3:
await page.fill('input[placeholder^="Title"]', 'a'.repeat(30));
const bodyInput = page.locator('textarea, input').nth(1);
await bodyInput.fill('b'.repeat(200));
await page.keyboard.press('Tab'); // simulate focus for keyboard
await page.screenshot({ path: 'docs/qa/sprintO2-evidence/PLANT-S28-SE.png' });
// Check: is 'Plant Cairn' button visible?
```

---

### S29 — Offline plant (network monitor detects offline)

**Location**: `PlantScreen.tsx:218-225`

**Findings**:
- v422 offline-first: after `created?.id` succeeds locally, checks `networkMonitor.getState()?.state === 'online'`. If offline, shows one-time Alert "Cairn planted (offline) / Saved locally. We'll upload it as soon as you're back online."
- Good: single alert, clear copy, no ceremony.
- **Assumes** `addMarker` returns `created.id` even offline — depends on marker store's local optimistic write path. If offline path in `useMarkerStore.addMarker` returns without id or throws, this Alert never shows and user sees the generic error path.
- No lifetime indication ("your cairn will upload next time you have signal") — the "as soon as you're back online" is well-phrased.

**Score**: 8 / 10

---

### S30 — Duplicate marker at same coord

**Location**: `PlantScreen.tsx:160-268` — no dedup check.

**Findings**:
- User can plant 10 cairns at the same GPS spot with no warning. No "You already planted a cairn here recently" prompt.
- Not necessarily wrong — user may intentionally overwrite / add a second note. But for the "I tapped Plant twice" case (double-tap on failed network), `submitting` guard prevents same-session dup but NOT cross-session.
- Backend / server-side dedup out of scope for this file.

**Score**: 6 / 10 (product decision, but no UX guard)

---

### S31 — Placeholder text character-set consistency

**Location**: Multiple

**Findings**:
- "Where's your cairn?" (step 2 title) — uses U+2019 curly apostrophe. Good typography.
- "Tell whoever finds this…" (body placeholder) — U+2026 horizontal ellipsis. Good.
- "Finding your ground" (step 1) — plain ASCII, no ellipsis.
- "Planting…" (submit) — U+2026.
- "coming soon, max 30s" — plain ASCII, no ellipsis. Minor inconsistency.
- "Once shared publicly, what others see is frozen forever." — plain ASCII.
- **Mostly consistent**, minor drift on the voice memo copy.

**Score**: 8 / 10

---

## Cross-cutting findings

### Copy voice consistency
Product soul: sepia / analog / respectful naturalist. Copy generally holds:
- "Finding your ground" (evocative)
- "Where's your cairn?" (personal)
- "Tell whoever finds this…" (relational)
- "A few words, a voice memo, or both." (permissive)
- "Leave a mark" (memento)

Off-key notes:
- "GPS is jumping around" — casual but slightly technical
- "Pin stays within 50 m of your GPS spot." — "GPS" is jargon; could be "50 m of where you're standing"
- Emoji "🎤" in voice memo box — breaks lucide-icon-only design language

### Visual token compliance
- Cream bg (`MemoryColors.cream`) — consistent with Settings baseline
- Sepia deep for headings — consistent
- `Colors.flag` (orange) for pin, `Colors.primary` (blue) for Target button — dual accent
- `cairnPublic` gray for secondary text — consistent

### Accessibility gaps
- Tap targets: zoom / style toggle at 36×36 fail 44×44 HIG minimum
- Char counters at 10px near legibility floor
- No accessibility labels visible in the file (no `accessibilityLabel` on TouchableOpacity anywhere audited)
- Disabled button states rely on opacity — VoiceOver-friendly `accessibilityState={{ disabled: !canConfirm }}` missing

### State management robustness
- v298 N5 anchor invariant + v297 pinch-drift fix + v301 tick throttling — this file has been battle-hardened
- v418 haptic ceremony + v420 recenter suppress — polish work is present
- Draft persistence on failure is a genuine safety net

### Comparison to Settings O12 baseline
- Settings has explicit iconWrap + label + hint row pattern (`ActionRow`, `ToggleRow`) — Plant flow does NOT use these primitives, has ad-hoc styles per component
- Settings shows deliberate polish (5-tap hidden debug, letter avatar, section groupings) — Plant flow feels functional but less "designed"
- Plant flow COULD benefit from adopting `Row` primitives for its visibility + type chips, but this is refactor-scope

---

## Summary table

| # | Scenario | Score |
|---|----------|------:|
| S01 | GPS fast path (watcher cache) | 7 |
| S02 | GPS slow path (5s sample) | 7 |
| S03 | Dev/web mock (Shanghai) | 6 |
| S04 | Permission denied (canAskAgain=true) | 3 |
| S05 | Permission denied (permanent) | 2 |
| S06 | Accuracy-too-poor | 8 |
| S07 | Too-jumpy | 8 |
| S08 | Pin step first mount | 7 |
| S09 | Drag within 50m | 8 |
| S10 | Drag past 50m | 9 |
| S11 | +/- zoom buttons | 7 |
| S12 | Style toggle | 7 |
| S13 | Pin color vs type mismatch | 5 |
| S14 | Step 3 → step 2 back | 7 |
| S15 | Recenter (Target) button | 7 |
| S16 | Mapbox tile load failure | 5 |
| S17 | 5 type chips | 7 |
| S18 | Title input + counter | 7 |
| S19 | Body input + counter | 8 |
| S20 | Voice memo placeholder | 4 |
| S21 | Visibility chips | 8 |
| S22 | Plant button states | 7 |
| S23 | Loading during POST | 7 |
| S24 | Success nav | 9 |
| S25 | Commit failure (400/500) | 6 |
| S26 | Back navigation semantics | 6 |
| S27 | Empty content validation | 5 |
| S28 | Long content overflow (SE) | 6 |
| S29 | Offline plant | 8 |
| S30 | Duplicate marker | 6 |
| S31 | Placeholder charset | 8 |

**Average**: 6.7 / 10
**Median**: 7 / 10
**Failing (≤5)**: 8 scenarios (S04, S05, S13, S16, S20, S27, S25 on edge, S28 on edge)

---

## Priority bug list (recommended for O2 backlog)

**Blocker candidates**:
1. **S04/S05 — Permission denied dead-end** (score 2-3): no Settings deep-link, wrong sub-copy for permission failures, `canAskAgain=false` produces silent retry loop. Users with mistap-denied permission cannot recover in-app.

**Critical candidates**:
2. **S13 — Pin color mismatch** (score 5): step 2 pin is `Colors.flag` orange regardless of user's step 3 type. Danger cairns look orange during placement then red after commit. Visual drift.
3. **S16 — Mapbox tile load failure** (score 5): no offline / degraded map handling beyond the top-level `Mapbox.available` fallback. Rural NZ users planting cairns in cell dead-zones see void tiles.
4. **S20 — Voice memo placeholder** (score 4): consumes UI real estate for an unshipped feature. Per Settings O12 principle, should be hidden until ready.

**Medium candidates**:
5. **S27 — Empty content validation** (score 5): dim button with no explanation. Add inline hint.
6. **S25 — Server error leak** (score 6): technical error strings shown to end users in Alert.
7. **S28 — Layout overflow on iPhone SE** (score 6): Plant Cairn button may push off-screen when keyboard + 200-char body active.
8. **S11 — Tap targets 36px** (score 7): zoom / style / target buttons fail HIG 44px minimum.

**Low / polish**:
- S18/S19 counter legibility (10px)
- S26 back-navigation copy inconsistency (Cancel vs Back)
- S31 emoji vs lucide-icon inconsistency in voice memo copy

---

## Recommended Playwright suite structure

All scripts should target the web build at `http://localhost:8081` using the v406 test hook `window.__cairnStores` where seeding is needed. Screenshots saved to `docs/qa/sprintO2-evidence/PLANT-SNN-*.png`.

Recommended run order:
1. Happy path: S03 (mock) → S08 → S09 → S17 → S18 → S19 → S21 → S22 → S24
2. Edge cases: S04, S05, S06, S07, S10, S13, S16, S25, S27, S28, S29
3. Regression: viewport matrix (375 / 430) for S08, S17, S28

Total: ~28 Playwright cases. Estimated evidence: 40-50 screenshots. Fits within Sprint evidence budget (8 UX + 8 QA per Sprint, allowing multi-Sprint spread).

---

## Note on read-only audit scope

This audit was performed with Read/Grep only, no Bash/Edit/Write to source (only the audit .md file was written). All Playwright scripts above are recommendations for a follow-up subagent to execute against the live web build — this auditor did not run them. The 4-eye protocol requires a second independent auditor to reproduce / challenge these findings before any Story creation.
