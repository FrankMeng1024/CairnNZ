# v383 Plan Review #2 — Independent Audit of Sections B + C

**Reviewer**: Independent architecture subagent (Opus). No prior context on v383 discussions, no access to review #1.
**Scope**: Sections B (Pin visual restore to v10) and C (SymbolLayer + sprite zoom scaling) only.
**Files audited**:
- `docs/plan/v383-plan.md` §B + §C
- `app/src/features/memory/components/CairnPinsLayer.tsx` (v382 current)
- `app/src/screens/MarkerDetailScreen.tsx` (v382 current)
- `docs/ux/mark-tier-explorations/round2-family4-1-v10.html` (design baseline)
- `app/src/features/memory/services/mapboxAdapter.ts`

User original complaints used as judgement axis:
1. "Flag detail 上的圆圈太大了" — detail pin too big (currently scaled 0.75)
2. "圈上没有皇冠没有十字没有脚印完全分不清楚" — crests invisible on Memory map
3. "Zoom 之后圆圈的大小并没有发生改变 这一点你完全没有改" — no zoom scaling
4. "皇冠颜色非常淡 在这个地图上几乎很难看清楚"
5. "Memory 我看到很多皇冠 但是他们的圆呢 没有了" — crest visible but core gone (the inverse-clip bug)

---

## 1. B1 — Root-cause "iOS PointAnnotation clips children to View frame": is it real?

### Findings

**The clipping hypothesis is asserted, not proven.** Looking at v382 source:

- `CairnPinsLayer.tsx:226` parent View is `height: PIN_SIZE + CREST_H + 4 = 72`, `alignItems: 'center'`. There is no `overflow: 'hidden'` set on the parent View, and PointAnnotation's host iOS view (MGLAnnotationView equivalent in rnmapbox) is not documented to clip in rnmapbox/maps@10.3.x README, CHANGELOG, or the open-issues list I could pattern-match against (no concrete rnmapbox issue cited in the plan for this claim).
- `MarkerDetailScreen.tsx:223` wraps `<CairnPin>` in `<View style={{ transform: [{ scale: 0.75 }] }}>` — `transform: scale` on RN iOS does NOT change layout box. The unscaled 72px child plus transform: scale moves rendered pixels into a 54px visual footprint, but the layout container is still 72px. If the surrounding PointAnnotation were genuinely clipping at child View frame, scale would NOT save it on iOS — yet the user reports the detail page pin LOOKS LIKE BOTH crest + core ("圆圈太大了" — they see the circle). So the detail page is NOT exhibiting the clipping bug.
- Memory map and detail page use the IDENTICAL `CairnPin` component. If iOS clipped PointAnnotation children, BOTH would clip. Memory map shows crest-only-no-core; detail page shows full pin oversized. This is a **direct contradiction** with the "iOS clips PointAnnotation children" theory.

**Counter-evidence the plan ignores**:
- Pre-v381 (v300 hollow pin) had no separate crest — just a single 28×28 circle. The same iOS PointAnnotation was used. Nothing was clipped. Why would clipping suddenly appear for a 72px-tall child but not a 28px child? PointAnnotation's host view sizes to its content on iOS — that's its documented behavior in rnmapbox. If it sized to 28px before and now sizes to 72px, there's no frame to clip against unless someone explicitly set one.
- Search of rnmapbox issues for "PointAnnotation clip child" / "PointAnnotation iOS not visible" — the dominant known iOS issue is the **opposite**: PointAnnotation children flicker / disappear on camera move because rnmapbox detaches the host view from the map view layer. The fix path is `<MarkerView>` (CallOut) or SymbolLayer, NOT making the parent View bigger.

**Most likely actual root cause** (alternative hypothesis the plan never considers):
1. **Z-order in RN flexbox is sibling order, not absolute** — in v382 the crest is rendered FIRST (line 228), core SECOND (line 232). In RN's default rendering, later siblings paint on top. **The core's tier-coloured border ring is painted ON TOP of where the crest sits visually overlapped** in v10's design (`top: -2px` overlap by 6px). But v382 abandoned absolute positioning entirely — flex column with `marginBottom: 2` means crest is ABOVE core, NOT overlapping. So the user's "皇冠看不见" might not be clipping at all — it might be:
   - (a) the SVG crest is rendering, but its 20×16 size at the top of a 72-tall container is at the extreme upper edge while user's eye expects it at the centre,
   - (b) the bigger issue: `Svg width={20} height={16} viewBox="0 0 18 14"` — viewBox is 18×14 but width/height is 20×16. react-native-svg's preserveAspectRatio default is `xMidYMid meet`, which letterboxes the 18×14 viewBox inside the 20×16 box. The actual rendered crown is ~17.5×13.6 within the 20×16 frame, with extra space — at 2px from top of a container at marginal display position, it's visually tiny.
2. **`Memory 我看到很多皇冠 但是他们的圆呢 没有了`** literally says "I see lots of crowns but where are the circles?" — opposite of clipping. This says the CORE is missing/invisible, not the crest. Possibilities:
   - Z-order inverted on certain RN versions (Android-vs-iOS Yoga differences),
   - `backgroundColor: enamel.fill` is the inner enamel; the `borderColor: tierColour` border is the ring. The "circle" the user means is the **tier-coloured ring** — if `borderColor` rendering is too thin (3px on retina = 1px device px on 3x display) the ring disappears against a similarly-toned map base.
   - Or `shadowColor: tierGlow` + `shadowOpacity: 0.8` with `shadowRadius: 7` extends the visual silhouette beyond the 44px core, blurring its edge into the map.

**The plan's fix (rewrite layout to match v10 + move to SymbolLayer) might accidentally work**, but its stated root cause is unverified. If clipping is NOT the bug and the real cause is shadow/border/z-order, the SymbolLayer migration (Section C) WILL fix it (because PNG sprites have no z-order issues), but the legacy PointAnnotation fallback path B3 mentions ("v383 ships both: legacy PointAnnotation gets stroke fallback") will continue to exhibit the bug because none of the v10-style absolute positioning is being applied to the Memory-map render path — only the detail page's `CairnPinV10` extraction.

### Severity: **High**

### Recommendation

1. Before committing to Sections B/C as drafted, **prove or disprove the clipping hypothesis** by spending 30 minutes:
   - Add temporary `overflow: 'visible'` explicitly to the parent View (RN default is already 'visible', but setting it makes intent explicit and rules it out).
   - Add an `onLayout` log to crest Svg and core View, capture both heights in the v381.cairn_pins_render log. Compare against expected (16 and 44).
   - Native iOS screenshot at 3x pixel-level on a debug build with a single marker. If the core is fully present in screen buffer but visually disappears under the crest's shadow, root cause is shadow bleed, not clipping. Pixel-level diff.
2. If clipping is disproven, **rewrite B1**'s root cause to reflect actual finding. The plan's current B1 reads as a confident assertion of an unverified theory — that's exactly the "anchoring bias propagates through reviewer chain" pattern called out in memory note `feedback_review_loop_premise_check.md`.
3. Even if SymbolLayer fixes it on Memory map, the Risk register §F item "Keep PointAnnotation legacy path behind feature flag for OTA-disable" means the bug **still ships** in the fallback. If you can't disable the fallback in production, the bug must be fixed in PointAnnotation too — or the fallback flag should be removed and you accept a hard cutover (which then requires the SymbolLayer path to be very, very confident).

---

## 2. B2 — Removing `scale: 0.75` on detail page

### Findings

User said: "在 flag detail 上的这个 flag 这个圆圈太大了" (the circle is too BIG on detail).
Current v382 detail render: `<View style={{ transform: [{ scale: 0.75 }] }}><CairnPin /></View>`. CairnPin is 52×72 logical → visual 39×54.
Plan B2 step 1: "Delete `transform: [{ scale: 0.75 }]` wrapper." → reverts to 52×72 logical → visual 52×72.

**The plan is going the wrong direction on user-perceived size.** If 39px-wide already feels "too big", 52px-wide will feel substantially bigger.

Let me sanity-check with map dimensions:
- `MarkerDetailScreen.tsx:75-76`: `MAP_H = Math.max(280, H - 480)`. On a 6.1" iPhone (H≈844px), MAP_H = max(280, 364) = 364px. Map is full width (~390px).
- At `zoomLevel: 16.5` with a single pin at map centre, the pin occupies (52 / 390) ≈ 13% of viewport width. At 0.75 scale it's ≈ 10%. User says 10% is already "too big". 13% is worse.
- v10 HTML's pin renders at 52×60 against a much larger blank backdrop — there it looks proportionate because the surrounding card is large. In a 364×390 map hero, the visual mass is much higher.

**The plan acknowledges this risk only implicitly** ("The 0.75 was a hack to compensate for bad layout") — but the user complaint is about visual size, not layout proximity. Removing the scale while only fixing crest-core gap will likely produce a NEW complaint: "now the circle is even bigger."

**Plan B2 also does not specify how `CairnPinV10` differs from the existing `CairnPin`** apart from layout style. If the only change is `position: absolute; top: -2; left: 50%; marginLeft: -10` for the crest and `marginTop: 8` for the core (which already exists at marginBottom: 2 in v382, off by a couple of px), then the visual difference is sub-pixel-class on a phone screen. The crest will still be small (20×16) and the core large (44px diameter). The size complaint isn't about gap — it's about absolute pin size in detail-screen context.

### Severity: **High**

### Recommendation

Two valid options — plan picks NEITHER:

**Option A (keep 0.75, fix layout)**: keep the `transform: scale(0.75)` wrapper AND apply v10 absolute positioning inside CairnPin. Pin renders at 39×54 visual, crest tightly overlapping core. Layout fidelity to v10 preserved at smaller size. This directly addresses user's "too big" complaint.

**Option B (introduce explicit size variant)**: add a `size` prop to CairnPin, e.g. `<CairnPin tier=... type=... size="detail" />` where size selects between 52 (memory map) and ~38 (detail). Build it as constants:
```
const PIN_SIZE_MEMORY = 52;  const PIN_SIZE_DETAIL = 38;
```
This eliminates `transform: scale` (which interferes with PointAnnotation anchoring per plan's own observation) AND gives the right visual size.

Either way, the plan's "delete scale + render at 1.0" is incorrect. Open question to PO: did the v10 HTML designer intend 52px to be the **map-zoom-16** size or the **all-contexts** size? If 52 is map-zoom-16 specific, then detail (which has different content density) needs a different size.

Plan should also explicitly state what the detail-page hero map zoom is. It's `zoomLevel: 16.5` (MarkerDetailScreen.tsx:212), which is exactly the Memory-map sprite size anchor — so removing 0.75 makes detail pin same size as on Memory map. User's complaint that detail-page pin is too big at 0.75 is essentially saying: at the same zoom level, a single pin in a smaller (364px tall) map feels disproportionately huge compared to many pins in a fullscreen map. The visual-mass argument suggests detail pin should be SMALLER than Memory-map pin, not equal.

---

## 3. B3 — Crest stroke fallback for "too light" — cross-platform consistency

### Findings

Plan B3 says: "Make crown 24×20 (was 20×16) AND add stroke: `<Path stroke="#1a1612" strokeWidth=0.5 fill={tierColour} />`. Stroke darkens silhouette enough to read against the map."

Issues:

**(a) `strokeWidth=0.5` in SVG userSpaceOnUse**: in viewBox `0 0 18 14`, a 0.5-unit stroke is rendered into a 24×20 px output → effective pixel stroke = `0.5 × (24/18) ≈ 0.67 px`. On iOS 3x retina this becomes 2 device pixels (rounded up); on Android 2x DPR it's 1.3 device px (typically rounded down to 1). **Result: stroke looks bolder on iOS than Android.** This is the OPPOSITE of "cross-platform consistent."

**(b) react-native-svg stroke rendering on Android vs iOS** is known to differ for sub-pixel strokes. `strokeWidth < 1` is unpredictable on Android (often dropped/rendered as 1px) and AA-rendered on iOS. The plan's claim "stroke darkens silhouette enough to read" is empirically untestable from the plan — there's no calibration measurement.

**(c) Increasing crest from 20×16 to 24×20** changes the visual ratio of crest-to-core (currently 20:44 ≈ 0.45, becomes 24:44 ≈ 0.55). v10 HTML uses 20×16 explicitly with the spec note "v3 proportions" — going to 24×20 deviates from the locked design. This is a **Spec Drift** — Arch should evaluate per the Guardrails section of CLAUDE.md before it's accepted.

**(d) The plan acknowledges "皇冠颜色太淡" was reported on iOS, but the stroke fallback path is described in B3.2/B3.3 as "Android fallback (react-native-svg ignores filters)". The cross-platform reasoning is inverted**: iOS supports SVG `<Filter>` per the plan, so iOS can have the drop-shadow glow that solves the contrast problem at its source. Android lacks filter support, so Android needs stroke. But the plan in B3.3 ("Recommended for v383 cross-platform reliable") says ship stroke on BOTH platforms — which **regresses iOS** from "could have proper glow" to "doubled-up dark outline."

**(e) On dark map style (night map, dark mode):** stroke colour `#1a1612` is near-black. On a dark base map this stroke disappears → crest goes back to "too light" against night sky. Plan never addresses dark mode.

### Severity: **High**

### Recommendation

1. Split the platform paths properly:
   - **iOS**: use SVG `<Filter id="crestGlow"><feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="..."/></Filter>` exactly as v10 HTML does. react-native-svg supports `<Defs>` and `filter` attr on iOS. Match v10 1:1.
   - **Android**: keep stroke as fallback BUT use `strokeWidth={1}` (whole pixel) and stroke colour = `#000` not `#1a1612` for contrast. Accept that Android crest looks slightly different — it's an acceptable platform difference.
2. Don't change crest geometry from 20×16 to 24×20 — this is a separate visual decision that needs Arch sign-off, not a stealth fix inside a "fallback" subsection.
3. Add explicit dark-map-style branch: if mapStyle is night/dark, swap stroke colour to a light contrasting tone (e.g. `rgba(255,255,255,0.6)`). Or, for the SymbolLayer path (C), bake two sprite sets (light-map + dark-map) and select via Mapbox style expression.
4. Decide: is the **canonical** v383 visual the v10 HTML rendering or some new "RN-feasible approximation"? Plan currently says both, picks neither.

---

## 4. B4 — Playwright SSIM ≥ 0.92 baseline

### Findings

The plan proposes:
- Baseline = v10 HTML rendered by Chromium via Playwright
- RN web build screenshot via Playwright
- SSIM ≥ 0.92 gate

**Multiple structural problems**:

**(a) Three rendering engines, three sets of glyphs**:
1. v10 HTML in Chromium = SVG via Skia.
2. RN web build = react-native-web wraps react-native-svg-web wraps SVG → renders via Chromium Skia BUT with react-native-svg's CSS shim, NOT raw SVG. The radial-gradient backgrounds in v10's `.core { background: radial-gradient(...) }` use CSS gradients. RN-svg has Defs/LinearGradient/RadialGradient SVG primitives but the v382 code uses **`backgroundColor: enamel.fill`** — a flat color. **The radial-gradient core depth shading is completely absent from v382 code.** RN web won't render gradient because the JSX doesn't request it. SSIM will fail even if positioning is perfect.
3. iOS native = react-native-svg via SkiaCG.
4. SymbolLayer (C path) = sprite PNG = whatever was baked.

Pipeline: `v10 HTML (Chrom-Skia, has radial gradient core)` ↔ `RN web (Chrom-Skia, no radial gradient core)` ↔ `iOS native (SkiaCG, no radial gradient core)` ↔ `sprite PNG (Chrom-Skia bake)`.

The 0.92 SSIM threshold between v10 HTML and RN web is **probably unattainable** because the cores look fundamentally different (gradient vs flat fill). SSIM 0.92 on a 156×180 PNG is roughly 8% of pixels can differ — a gradient-vs-flat core easily blows past that on the 44×44 = 1936 core pixels alone.

**(b) The plan also doesn't say where the gradient goes.** v10 has shadow + radial gradient core + drop-shadow on crest. v382 has flat background + box shadow on core View. These are visually distinct. If "match v10 exactly" is the goal, the code needs:
- `LinearGradient` / `RadialGradient` from react-native-svg for the core background
- Real SVG drop-shadow filter for crest
- `<Defs>` block to share gradient definitions

The plan never lists this work — it only talks about layout (position absolute / margin / size).

**(c) Comparing iOS native screenshots to "baseline + Expo web screenshot"** at step 4 introduces a third anchor. The plan handwaves "compare." Compare HOW? Pixel diff? Human eyeball? If SSIM, what threshold? Each pipeline hop accumulates rendering error — even if HTML→web is 0.92, web→iOS is another 0.92, total HTML→iOS ≈ 0.85 worst-case. Plan never composes the error budget.

**(d) Choosing the baseline**: v10 HTML is the **design intent** but it's not the **production rendering**. For a "ship it" gate, the relevant comparison is "does iOS render look right to a user?" — not "does iOS render match HTML pixel-by-pixel." The plan conflates intent-baseline with implementation-baseline.

### Severity: **Medium-High**

### Recommendation

1. **Decide the canonical baseline up front**:
   - If matching v10 HTML pixel-for-pixel is the goal: implement radial gradient core + SVG drop-shadow crest in react-native-svg. Then SSIM ≥ 0.92 is achievable.
   - If "v10 HTML is the design spec but we accept simplified RN rendering": drop the SSIM gate. Use a qualitative human-eye review by main + 2 subagents + user (matches existing 4-eye rule in `feedback_4_eye_review.md`).
2. **Sprite-as-baseline approach** (better): bake the sprites from v10 HTML directly (Playwright opens the HTML, captures each pin cell, exports as PNG). Then iOS / Android SymbolLayer renders identically (it's just an image). Drop the legacy PointAnnotation path entirely or accept it as "lower-fidelity fallback." This removes 2 of the 3 SSIM hops.
3. **Don't use SSIM 0.92 as a threshold without baseline calibration**: first run v10 HTML → v10 HTML SSIM (sanity check, should be 1.0). Then run v10 HTML → flat-color-stub-pin SSIM (lower bound). Then pick a threshold somewhere in between based on empirical sample. Picking 0.92 by gut feel will produce either a meaningless pass (too lax) or perpetual fail (too strict).
4. **Add a calibration run** before the gate is enforced. CLAUDE.md `feedback_review_loop_premise_check.md` warns against parameter-anchoring on unvalidated numbers — 0.92 is exactly that risk.

---

## 5. C2 — Sprite count and type coverage

### Findings

Plan C2: "3 tiers × 5 types = 15 main pins + 3 tier-keyed mystery pins = **18 sprites**. Stranger blurred pin = 19th."

**Type set audit against v382 code** (CairnPinsLayer.tsx:48-56):
```
TYPE_ENAMEL: danger, junction, water, hut, cairn, free (legacy)
```
That's **6 types**, not 5. The `free` legacy entry is explicitly preserved with the comment "legacy `free` fallback (v105 deleted but old DB rows may still exist)."

**Plan ignores this `free` legacy type.** Consequences:

- Bake script Playwright will iterate over the design types (danger/junction/water/hut/cairn = 5). No `free` sprite gets generated.
- At runtime, a marker with `type='free'` (legacy DB row from a user who planted before v105) will hit `iconImage: ['get', 'sprite']` → sprite name e.g. `pin-self-free` → **Mapbox style expression returns null → SymbolLayer renders nothing** (or worse, prints a Mapbox warning every frame).
- Plan §C5 also says "iconAllowOverlap: false at zoom 17" — if a free-type marker silently doesn't render, it's invisible at every zoom. User reports a phantom missing pin.

**Mystery pin count**: 3 (one per tier). Plan correct here. But also: mystery state for a stranger marker? `MysteryPin` in v382 has tier-based crest+colour. But `CairnPinsLayer.tsx:163-175` renders strangers with `StrangerBlurredPin` (NOT MysteryPin). So strangers are never in mystery state at all — they're either visible blurred or filtered out. That's correct; plan is fine here, but the boundary should be documented in the sprite atlas spec.

**Public marker logic conflict**:
- `seed/public_marks_v383.sql` (Section A) seeds Public markers.
- `resolveTier` (line 65-73) returns `'public'` only if `permission==='public'` AND marker is NOT in own store.
- v382 backend rejects client-write `permission='public'`. So Public markers exist only via SQL seed.
- Plan C2 includes Public tier in the 15-pin sprite matrix — good.

**Stranger-blurred sprite (#19)**: plan says one sprite. But v382 renders strangers via inline View with `borderRadius`, `backgroundColor` (CairnPinsLayer.tsx:383-393). Migrating strangers to SymbolLayer requires a sprite — fine, but plan doesn't specify whether strangers continue to have unblurred details (no — they're "blurred" by design) or some opacity treatment baked into the sprite. Bake recipe undefined.

### Severity: **High** (the `free` legacy is a silent breakage path)

### Recommendation

1. **Audit production database before deciding sprite set**: query Aliyun `cairn-backend` MySQL: `SELECT type, COUNT(*) FROM markers WHERE type='free';`. If count > 0, you have legacy data and need either (a) a `pin-{tier}-free` sprite (+3 sprites = 21 total), or (b) a Mapbox style expression fallback `iconImage: ['coalesce', ['get', 'sprite'], 'pin-self-cairn']` so unknown types render as cairn-default. Plan picks neither.
2. **Pick (b)** as it's robust to future type drift: any new type added later without an updated sprite atlas would silently fall back to cairn instead of disappearing. Cost: one Mapbox expression line.
3. **Specify the stranger-blur bake recipe** in plan C3: what blur radius, what tier (or tier-neutral), what opacity. Currently underspecified.
4. **Number total sprites correctly in plan**: depending on choice, 18 / 19 / 21 / 22. Pick one number and reflect it everywhere (C2, C3, F risk register "19 PNGs × ~3KB = 60KB" line).

---

## 6. C3 — Sprite generation via Playwright bake

### Findings

Plan C3 says: "drive Playwright … to render each of 19 pins at 156×180 px → PNGs in `app/assets/mark-pins/v10/`". Method described, but operationalization is missing.

**Issues**:

**(a) When does the bake run?**
- Manual (developer runs `scripts/build-pin-sprites.mjs` before each commit affecting pins)?
- CI hook on every PR?
- Pre-commit hook?
- Build-time (Expo prebuild)?
Plan never says. Without a trigger, sprites drift from the design HTML over time.

**(b) Git treatment of binary PNGs**:
- 19 PNGs × 156×180 × probably-20KB each = ~380KB delta per design tweak.
- If sprite source design changes once a Sprint (which is plausible during v384 / v385), git history bloats with binary diffs. Plan note "19 PNGs × ~3KB = 60KB" in Risk register is wrong — 156×180 3x retina PNG is more like 8-20KB each not 3KB. Will check: 156×180 = 28080 pixels × 4 bytes RGBA = 112KB uncompressed; PNG compression on a mostly-circular shape with gradients ≈ 6-12KB per sprite, but with shadow + glow at 3x maybe 15-20KB. Total 19 × 18KB = 342KB initial bundle.
- Plan does NOT specify git LFS, .gitignore, or bake-in-CI strategy.

**(c) Cross-platform consistency of baked PNG**:
- Playwright on Windows Chromium vs macOS Chromium can produce sub-pixel-different rasterizations of the same SVG. PNG hash will differ. If CI bakes on Linux and dev bakes on Windows, you get spurious diff noise.
- Plan doesn't pin a specific Chromium version for the bake. Different `@playwright/test` releases ship different Chromium bundles.

**(d) Sprite atlas vs individual PNGs**:
- Plan says "individual PNGs via `<Images images={{ 'pin-self-cairn': require(...), ... }} />`". This loads 19 separate image files on map mount.
- rnmapbox `<Images>` does support image dictionaries, but the docs note image registration is async. With 19 images, you may see a 1-2 frame flash where SymbolLayer renders before the icons are registered — pins missing → camera nudge → pins appear (matches the F risk register entry "rnmapbox SymbolLayer + Images on iOS 17.x flaky cold-start"). Mitigation "force noop camera nudge on map load" is a band-aid; the proper fix is `await onImageMissing` event subscription.
- A single sprite atlas (1 PNG with all icons + 1 JSON manifest using `iconAnchor: { x, y }` per icon) is more performant and is the canonical Mapbox pattern.

**(e) onImageMissing fallback**: rnmapbox's SymbolLayer fires `onImageMissing` if a referenced iconImage isn't registered. Plan doesn't wire this — combined with the `free` type issue above, you get silent pin disappearance.

### Severity: **Medium-High**

### Recommendation

1. **Decide the bake trigger explicitly**:
   - Option (a) committed PNGs + CI lint that re-bakes and diffs to detect drift,
   - Option (b) bake at app build time (Expo prebuild step),
   - Option (c) bake at runtime first-launch (slow cold start, hurts startup metric).
   - Recommend (a) — pin the Playwright/Chromium version in package.json so all developers + CI produce byte-identical PNGs. Treat sprite PNG re-bake as a deliberate visual change requiring 4-eye approval. Git LFS for `app/assets/mark-pins/` is overkill at 19 files — straight git is fine.
2. **Wire `onImageMissing` to log a Sentry event** so any new type slipping past the bake gets caught in telemetry instead of silently invisible.
3. **Correct the size estimate in Risk register F** ("19 × 3KB = 60KB" → likely 19 × 15KB ≈ 285KB total — still small, but the plan's number is wrong by 4-5x).
4. **Reconsider single sprite atlas** if cold-start race shows up in EAS dev build. The plan picks individual PNGs without comparing alternatives.

---

## 7. C4 — onPress wiring on SymbolLayer

### Findings

Plan C4 shows:
```jsx
<ShapeSource id="cairn-pins" shape={featureCollection} onPress={onSymbolPress}>
  <SymbolLayer id="cairn-pins-layer" style={{ iconImage: ['get', 'sprite'], iconSize: [...] }} />
</ShapeSource>
```

**Issues**:

**(a) Selection state tracking**:
- v382 uses `setSelection({ kind: 'mystery'|'revealed', marker, tier })` in PointAnnotation's `onSelected`. With SymbolLayer's `onPress`, the event yields `e.features[0].properties` — but `properties` from a GeoJSON feature is the **serialized** properties dict, not the original marker reference. To re-resolve the full `Marker` object (which has fields like `note`, `authorId`, `publicSnapshot`, `createdAt`), you need an id lookup back into the marker store. Plan says "Sets selection same as PointAnnotation path" — but does not specify the lookup.

**(b) Explored vs mystery in a single layer**:
- v382 uses two different child components (`CairnPin` vs `MysteryPin`) based on `explored` flag. With SymbolLayer + a single feature collection, you have to distinguish via `iconImage` style expression:
  ```
  iconImage: ['case', ['==', ['get', 'explored'], true],
    ['concat', 'pin-', ['get', 'tier'], '-', ['get', 'type']],
    ['concat', 'mystery-', ['get', 'tier']]]
  ```
  Plan doesn't show this expression. The shown expression `['get', 'sprite']` requires pre-computing the sprite name into the feature properties, which works but couples client logic to the data layer. Pick one approach explicitly.

**(c) Reactivity to explored-state changes**:
- When `useMemoryStore.geometryVersion` increments (e.g. user enters a new cell, fog clears, mystery → explored), the feature collection must re-build. v382 uses `useMemo` dependency on `geometryVersion`. SymbolLayer requires you to recompute the GeoJSON `featureCollection` shape prop and Mapbox internally diffs it. This is documented to be efficient via id-based diffing — provided every feature has a stable `id` property.
- Plan doesn't specify the GeoJSON `id` field. Without it, Mapbox re-uploads the entire collection on every change, causing visible flicker.

**(d) Touch target size**:
- PointAnnotation's child View is the touch target — currently 52×72 logical px. SymbolLayer's tap target is the rendered icon size. At zoom 12 with `iconSize: 0.4`, sprite is rendered at ~62×72 device px → 20×24 logical px tap target — well under iOS 44pt accessibility minimum.
- Mapbox provides `clusterRadius` for clusters but per-feature hit-tolerance for SymbolLayer is implicit and small. Plan doesn't address. At low zoom, users will struggle to tap small icons.

**(e) Multi-feature press**:
- If two markers are close enough to overlap at zoom 14 (`iconAllowOverlap: true`), `e.features` returns multiple. Plan's `e.features[0]` arbitrarily picks the first — the visually-frontmost pin may not be `features[0]` (Mapbox sort order depends on `symbolZOrder`). User taps what they see, but selects something else.

**(f) Stranger SymbolLayer has no onPress** per plan. Currently strangers are also not selectable in v382. Consistent.

### Severity: **High** (touch target, selection lookup, reactivity all underspecified)

### Recommendation

1. Specify the feature property schema explicitly in plan:
   ```ts
   feature.id = marker.id  // stable
   feature.properties = { id, tier, type, explored, isStranger }
   ```
   With `id` set, Mapbox diffs incrementally → no flicker.
2. Wire selection via id-lookup in main agent code, not subclassed properties:
   ```ts
   const m = markers.find(x => x.id === e.features[0].properties.id);
   ```
3. Add `iconAnchor: 'bottom'` (or wherever the design intends) and a minimum tap size guarantee. For low-zoom (< 14) where icons are 20px, either:
   - Don't allow tapping below zoom 14 (gate selection on zoom level),
   - Use a separate invisible larger CircleLayer below with `circleRadius: 22` on the same source for hit-testing.
4. Document the explored vs mystery style expression with a concrete example (per (b) above).
5. Spec how multi-feature press resolves — closest to camera centre, or topmost in sort? Pick one.

---

## 8. C5 — Zoom interpolation, hide threshold, trail-pin desync

### Findings

Plan C5 hide-threshold table:
```
< 12        iconOpacity 0 (hidden)
12 → 14     iconSize 0.4 → 0.65, iconOpacity 0.6 → 1.0
14 → 16     iconSize 0.65 → 0.85
16 → 17     iconSize 0.85 → 1.0
≥ 17        iconSize 1.0
```

**Issues**:

**(a) Trail / Routes layer not addressed**:
- User said "路线都看不清了" (route lines invisible) — this is a separate layer (LineLayer for trails). Plan C5 only addresses pin iconOpacity. If trails remain visible at zoom 8 but pins disappear at zoom 12, you get "trails without pins" — disorienting at world view.
- v382's trail rendering location not audited here, but plan must either (i) state that trail visibility stays unaffected (current behavior), (ii) sync hide threshold across both layers, or (iii) state this is a separate v384 concern.
- The user's complaint actually conflates "pins didn't scale" with "routes invisible." Section C5 only fixes the first half.

**(b) `iconAllowOverlap: false` at zoom ≥ 17**:
- "zoom ≥ 17 → `iconAllowOverlap: false`. zoom < 14 → `iconAllowOverlap: true`."
- Implementation note: rnmapbox SymbolLayer accepts these as plain props OR as Mapbox expressions. The plan shows a step expression for iconOpacity but a flat statement for iconAllowOverlap. Mapbox style spec: `iconAllowOverlap` is NOT data-driven and NOT zoom-interpolatable per Mapbox 3.x docs (it's a layout property, layout properties accept fewer expressions than paint properties). You can switch via `iconAllowOverlap: ['step', ['zoom'], true, 17, false]` only if rnmapbox passes it through — needs verification with `@rnmapbox/maps@10.3.x`.
- Plan asserts this works without citing. If it doesn't, you need two SymbolLayers with different overlap settings and zoom range filters, doubling layer count.

**(c) User-can't-see-own-pin scenario**:
- User plants a marker at zoom 18 (close-up). Re-opens app, lands at zoom 16. Their fresh pin may be one of many in dense urban setting — `iconAllowOverlap: false` at zoom 17 collides. User zooms in further to find it. Plan doesn't address self-marker-priority.
- Mapbox `symbolSortKey: ['case', ['get', 'isSelf'], 0, 1]` (lower = drawn first/on top — actually Mapbox draws higher symbolSortKey on top in non-overlap mode) would prioritise self markers. Plan never mentions this. As-is, self markers can be culled by friend/public markers at zoom 16-17.

**(d) Zoom-fade hysteresis**:
- iconOpacity step from 0 to 0.6 at zoom 12 means the moment you cross zoom 12 (zooming in), pins pop in at 60% opacity. Visually jarring. Better: linear interp from 0 (at zoom 11) → 0.6 (at zoom 12). Plan's `['step', ['zoom'], 0, 12, 0.6, 14, 1.0]` is hard step at 12, linear-like step at 14. Mixed metaphor.

**(e) zoom < 12 hidden — interaction at world view**:
- If user is at zoom 8 (city overview) and taps anywhere, no pin response. Plan acceptable behavior. But what if user wants to see clusters? No clustering plan. v382 doesn't cluster either, so this is status quo — but Plan §C is the right moment to ask: should low-zoom show density clusters? At minimum, document the decision "no clustering in v383, accept blank world view".

### Severity: **Medium**

### Recommendation

1. **Add an explicit "trail visibility" subsection** to Section C5 — either confirm trails stay unchanged at all zooms, or specify a paired threshold.
2. **Verify `iconAllowOverlap` zoom-step is supported** in rnmapbox 10.3.x. If not, refactor to dual SymbolLayer or use a single value (most pragmatic: always `iconAllowOverlap: true` so no pin is ever culled; accept overlap visual at high zoom — users can zoom in further).
3. **Add `symbolSortKey` to favour self-tier pins** so user's own markers are always on top in overlap-collision.
4. **Smooth opacity interpolation** — use `['interpolate', ['linear'], ['zoom'], 11, 0, 12, 0.6, 14, 1.0]` instead of `step`.
5. **Document "no clustering"** decision explicitly with rationale.

---

## 9. Cross-cutting gaps in B + C

### 9.1 Dark mode / night map style — **High**
- Cairn supports `getPrimaryMapStyle()` which may return a dark or light style (MarkerDetailScreen.tsx:202 uses it).
- Plan doesn't address: (a) does pin design contrast against dark map? Silver crest + silver ring on dark backgrounds is fine. Gold crest + amber/red/blue cores also OK. **Public-tier silver pin on a dark map**: the v10 design has NO glow for public. Against #1a1612 dark map background, silver core on silver ring with zero glow → barely-visible pin.
- Sprite atlas approach (C) requires either a single sprite that works on both themes (compromise) or two themed sprite atlases swapped by Mapbox style condition. Plan picks neither.

### 9.2 Accessibility — **Medium**
- PointAnnotation child View → RN a11y label can be set on the inner View. v382 doesn't set one, but the capability exists.
- SymbolLayer renders via Mapbox native — does NOT participate in iOS/Android a11y tree. Tap is detected by the map view, not the OS a11y framework. VoiceOver users cannot enumerate markers.
- This is a v383 a11y regression. Plan should at minimum acknowledge — better, propose a parallel a11y solution (e.g. an off-screen hidden list of markers with semantic labels, or a `<Pressable>` overlay layer near map controls for "list all visible markers").

### 9.3 Marker volume scalability — **Medium**
- Single `ShapeSource` with `featureCollection` containing N markers. v382 with PointAnnotation degrades visibly at ~50 markers (per memory note `feedback_user_reports_are_truth.md` patterns). SymbolLayer handles thousands fine on GL — gain.
- BUT: client-side, the `useMemo` rebuilds the entire featureCollection on every `markers` array change. With 5000 markers and any marker store update (e.g. live sync), this re-builds 5000-element array each tick.
- Plan doesn't address: (a) cap displayed markers within viewport, (b) cluster, (c) viewport-windowed feature collection. v383 may not need this immediately, but plan should mention threshold for future Sprint.

### 9.4 OTA sprite cache invalidation — **High**
- Mapbox SDK caches images registered via `<Images>` keyed by image name. If `pin-self-cairn` is registered at app launch with new sprite v383, but iOS still has cached v382 image bytes for the same key, it may serve the stale image.
- Native Mapbox image cache is per-MapView session and resets on map unmount/remount in rnmapbox. Should be safe in practice, but only if cold-app-start happens between OTA install and map use. Hot OTA reload while map is mounted is risky.
- Plan doesn't address. Add: bump image name keys across OTA boundaries (e.g. `pin-self-cairn-v383`) so cache miss forces reload. Or document that fresh-app-launch is required after OTA.

### 9.5 Pin render path during fog transition — **Low**
- When `geometryVersion` increments and a marker transitions mystery → explored, the v382 PointAnnotation rerenders with a different child component (MysteryPin → CairnPin). With SymbolLayer, the feature property `explored` flips and `iconImage` expression re-evaluates → Mapbox swaps sprite next frame.
- Plan doesn't specify whether this transition is animated. v10 design intent unclear. Recommend: no animation (current behavior), document as such.

### 9.6 Performance budget for cold start — **Medium**
- Loading 19 PNG sprites at app launch adds image-decode time. Each at ~15KB → decode ~5-10ms each → ~100-200ms total on older Androids. Multiplied by all `require` calls being eagerly evaluated.
- Plan should specify: lazy-load sprites only when MemoryScreen mounts, not at root. v382 PointAnnotation has zero asset preload cost.

### 9.7 RTL / locale — **Low**
- Not affected by pin rendering. Skip.

### 9.8 Z-fighting between pin and user-location dot — **Medium**
- `UserLocation` from rnmapbox is its own native layer. If user stands ON a planted marker, the user-location dot and SymbolLayer pin overlap. Plan doesn't specify z-order. PointAnnotation v382 always renders above UserLocation due to View hierarchy. SymbolLayer may go behind UserLocation depending on layer add order.
- Specify: add cairn-pins-layer AFTER user-location in style stack, or use `aboveLayerID` prop.

### 9.9 Tap propagation to map — **Medium**
- v382 PointAnnotation onSelected stops tap propagation. SymbolLayer onPress on ShapeSource: when a press hits an icon, does the underlying map also receive the press (e.g. firing `onPress` of MapView)? Mapbox + rnmapbox documented behavior: feature press consumes the event if `onPress` is set, but only if the feature is hit. If the user taps NEAR a pin (within tap tolerance) and hit-test fails, MapView's onPress fires — which v382 may already handle for other things.
- Plan should specify expected behavior: should tap on pin propagate? Should tap near-but-not-on pin behave any differently?

### 9.10 Test coverage for v382 → v383 regression — **High**
- The current v382 has at least 3 bugs the plan is addressing simultaneously: (a) detail page pin too big, (b) Memory map core missing, (c) crest too pale.
- Plan §D3 lists 6 Playwright gates but they're all forward-looking ("v383 should pass these"). Nothing in plan retros: "rerun v382 against same gates first to establish baseline of what's broken."
- Without a baseline measurement of how badly v382 fails, you can't quantitatively prove v383 is better — only that it passes the bar. May ship v383 that fails in different new ways (regressions in places v382 happened to work).
- Recommend: before any v383 code lands, run D3 gates against current v382 and document the failure pattern. Then v383 must (a) pass all gates AND (b) not regress on anything v382 happens to pass.

---

## Summary Matrix

| # | Issue | Severity | Blocking? |
|---|-------|----------|-----------|
| 1 | B1 root cause "iOS clips PointAnnotation children" is unverified, contradicts evidence | High | Yes |
| 2 | B2 removing scale 0.75 will make detail pin bigger, opposite of user complaint | High | Yes |
| 3 | B3 stroke fallback cross-platform inconsistent + 24×20 stealth size change + dark mode unhandled | High | Yes |
| 4 | B4 SSIM 0.92 baseline unattainable due to gradient/filter gaps in current RN code; threshold uncalibrated | Medium-High | No, but gate is broken |
| 5 | C2 sprite count misses `free` legacy type → silent rendering failure path | High | Yes |
| 6 | C3 bake trigger, git treatment, cross-platform rasterization, onImageMissing unspecified | Medium-High | No |
| 7 | C4 onPress: id schema, explored expression, touch target, multi-feature, reactivity all underspecified | High | Yes |
| 8 | C5 trail-layer desync, iconAllowOverlap expression-or-not, self-pin priority, hard step opacity | Medium | No |
| 9.1 | Dark mode pin contrast not addressed (Public silver on dark) | High | No, but ships visual bug |
| 9.2 | SymbolLayer a11y regression — VoiceOver cannot enumerate markers | Medium | No |
| 9.3 | featureCollection rebuild cost at scale | Medium | No |
| 9.4 | OTA sprite cache invalidation | High | No, but ships subtle bug |
| 9.5-7 | Transition animation, perf budget, RTL | Low-Medium | No |
| 9.8 | Pin vs user-location z-order | Medium | No |
| 9.9 | Tap propagation behaviour | Medium | No |
| 9.10 | No v382 baseline measurement before v383 lands | High | Yes |

---

## Verdict

**NEEDS_CHANGES**

The plan has the right shape (PointAnnotation legacy → SymbolLayer modernization, v10 HTML as visual baseline, Playwright as gate) but three classes of problems prevent approval:

1. **Root cause #1 is asserted not proven** — the "iOS clips PointAnnotation children" theory contradicts the observed evidence (Memory map and detail page show different bugs from same component). Per `feedback_review_loop_premise_check.md`, fixing without confirming root cause risks the next 11 review rounds chasing the same anchor. Verify clipping vs shadow-bleed vs z-order BEFORE locking the design.

2. **Section B and Section C disagree on the goal** — B says "match v10 HTML pixel-for-pixel" but doesn't add radial gradient, drop-shadow filter, or absolute crest overlap to the code. C bakes sprites from HTML rendering but legacy PointAnnotation path still gets only the stroke fallback. Result: two paths shipping, only one approximates v10. Either commit to full v10 fidelity in PointAnnotation (gradient + filter + absolute layout) OR drop the legacy path. Half-measure ships visual inconsistency.

3. **User's primary complaint (detail page too big) is not addressed** — plan removes scale 0.75 with reasoning "0.75 was a hack to compensate for bad layout" but the user's complaint was about visual size, not layout. Going from 39px to 52px will worsen the complaint. Re-read user words against B2 step 1.

**Before APPROVE I want**:
- B1 root cause confirmed (or replaced) with on-device evidence
- B2 sizing decision: introduce per-context size constants (PIN_SIZE_MEMORY vs PIN_SIZE_DETAIL) so detail page is explicitly smaller
- B3 split: iOS gets SVG filter, Android gets stroke (1px not 0.5), dark-map variant addressed
- B4 SSIM threshold calibrated empirically OR replaced with 4-eye qualitative review
- C2 `free` legacy fallback via Mapbox `coalesce` expression; final sprite count locked
- C4 spec: feature.id schema, explored expression, touch target plan, multi-feature press rule
- C5 trail desync clarified; self-pin symbolSortKey added; iconAllowOverlap expression verified against rnmapbox 10.3.x
- 9.10 v382 baseline measurement before v383 implementation begins
- 9.4 OTA sprite cache invalidation strategy chosen

Once these gaps are resolved, plan is solid for OTA.
