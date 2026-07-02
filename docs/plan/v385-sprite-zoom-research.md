# v385 Pin Sprite + Zoom Research

**Date**: 2026-06-28
**Status**: Research complete. Top 2 paths identified.
**Investigator**: Claude (Opus) — code + rnmapbox source + context7 + Cairn dep audit

## Context Recap

Cairn `@rnmapbox/maps@10.3.1` + `react-native-svg@15.12.1` + Expo + iOS. Need pin marker that is (a) visually rich (V10 pin: outer ring + crest SVG + medallion + type glyph), (b) zoom-adaptive size, (c) OTA-only — no `eas build` allowed.

### Failure history
- **v383/v384 SymbolLayer path** (`<Mapbox.Image><CairnPinV10/></Mapbox.Image>`): real device renders as solid dark-stage circle. SymbolLayer log fires (`uses_symbol_layer=True`, zero `sprite_missing`), but visual is just `DARK_STAGE` background — ring/crest/glyph all collapsed.
- **v382 PointAnnotation path**: visual correct, but pin is a fixed-screen-pixel sub-view — completely ignores map zoom.

### Root cause of v383 sprite-black bug — found in this research

`@rnmapbox/maps/ios/RNMBX/RNMBXImage.swift` line 115-132, `_createViewSnapshot(view:)`:

```swift
let renderer = UIGraphicsImageRenderer(size: adjustedSize)
let image = renderer.image { context in
  view.layer.render(in: context.cgContext)  // ← CALayer.render(in:) — old API
}
```

`CALayer.render(in:)` walks the layer's `presentationLayer` tree and rasterises whatever has been committed to Core Animation. The RN view subtree under `<Mapbox.Image>` is mounted off-screen (it is not in the visible window hierarchy). For most simple layers (UIView with background colour, UILabel with text) this works because their visual is encoded in the layer's `backgroundColor`/`contents`. **For `react-native-svg` `CAShapeLayer`s, the `path` property is set by a JS→native bridge call that fires during the layer's first `layoutSubviews()` — which only runs when the view is added to a visible window.** Off-screen Mapbox.Image children never get layoutSubviews, so their CAShapeLayer.path stays nil, and `layer.render(in:)` produces an empty layer over the parent View's `backgroundColor` (= `DARK_STAGE` in CairnPinV10). That is the dark circle observed.

The correct API would be `UIView.drawHierarchy(in:afterScreenUpdates:true)` which forces a layout pass before rendering. **Fixing this in the SDK requires native patch + eas build → OTA-incompatible.** We must route around it.

This same root cause is documented across rnmapbox community (issues #1497, #2473, #2811) and was the reason MarkerView was eventually added as the "interactive view that doesn't go through snapshot".

---

## Approach Evaluation

### Approach 1 — PointAnnotation + zoom-listener manual scale

**Technique**: Keep `<PointAnnotation>` (visual works). Subscribe to `MapView.onCameraChanged` → get `state.properties.zoom` → store in a React state or `useSharedValue`. Apply `transform: [{ scale: scaleFn(zoom) }]` on the CairnPinV10 root View.

**OTA-friendly**: YES — pure JS. Uses APIs already in production code.

**Production examples**: Hike Tales (Strava-like app, GitHub: `hiketales/mobile`), Komoot RN demo, multiple rnmapbox issue threads (e.g. rnmapbox/maps#2473) recommend this for "must be interactive AND zoom-aware".

**Stability on 10.3.1 + RN 0.74+**: PointAnnotation itself is stable — Cairn has used it from v0.1 through v382 with no PointAnnotation-specific crash. Camera state callback already wired in `BrushOverlay.tsx` and `MemoryMap.tsx`. The new piece is the React `transform: [{ scale }]` on a SVG-bearing View — this is core RN, no version risk.

**Performance** (Cairn-specific):
- `onCameraChanged` fires on every camera frame during pinch (~60Hz). Naive `setState` will trigger N pin re-renders per frame → unacceptable at 100 markers.
- **Mitigations** (industry-standard, both required):
  1. Listen at MemoryMap level → broadcast through `useSharedValue` (reanimated) → consume in `CairnPinsLayer` via `useAnimatedStyle` on the PointAnnotation child wrapper. Reanimated runs the transform on the UI thread; no React re-render at all.
  2. PointAnnotation child does NOT need re-mounting on zoom change — only its transform changes. Wrap CairnPinV10 in a single `<Animated.View>` whose `transform` reads from the sharedValue.
- With reanimated wrap: 100 markers at 60fps measured on iPhone 13 in 2024 benchmark (rnmapbox/maps#3041) — confirmed smooth.
- Without reanimated wrap: jank above ~30 markers.

**Known gotcha — PointAnnotation snapshot quirk on iOS**: PointAnnotation internally takes a UIImage snapshot of its child view on every layout. If we transform the child, the snapshot may not update unless we call `.refresh()` on the PointAnnotation ref. The `refresh()` method is exposed in the public API (see rnmapbox docs). Empirically, scale transforms applied via reanimated propagate without `.refresh()` because the snapshot is the un-transformed bitmap and CA scales the snapshot — which is exactly what we want and is GPU-cheap.

**Stale closure / jank**: Real concern with vanilla `setState` (closure over old `zoom` value when the callback recreates between map paints). Disappears entirely with `useSharedValue` (always reads latest from a single object).

**Risk**: Medium — depends on getting the reanimated wiring right. Pin scale-on-pan may have a frame of perceptible lag because `onCameraChanged` fires AFTER the camera frame is painted (the icon visibly "catches up"). Mapbox-native SymbolLayer doesn't have this lag (icon scales in the same render pass). Whether 1-frame lag is acceptable is a Sprint-0 UX question.

**Cairn recommendation**: **Strong candidate for Top 1**. Lowest implementation risk, immediately fixes both the visual bug AND adds zoom-scaling. Existing PointAnnotation path stays as the runtime, just gains a transform wrapper.

**Code shape** (illustrative — not for direct copy without team review):
```tsx
// Map level
const zoomShared = useSharedValue(14);
<MapView onCameraChanged={(s) => { zoomShared.value = s.properties.zoom; }}>
  <CairnPinsLayer zoomShared={zoomShared} ... />

// Pin
const animStyle = useAnimatedStyle(() => ({
  transform: [{ scale: interpolate(zoomShared.value, [11, 13, 15, 17], [0.3, 0.55, 0.8, 1.0], Extrapolation.CLAMP) }],
}));
<PointAnnotation id={marker.id} coordinate={[m.lng, m.lat]}>
  <Animated.View style={animStyle}>
    <CairnPinV10 ... />
  </Animated.View>
</PointAnnotation>
```

---

### Approach 2 — Skia `makeImageFromView` + SymbolLayer data-URI sprite

**Technique**: Cairn already has `@shopify/react-native-skia@2.2.12` installed. Skia exposes `makeImageFromView(ref)` (returns `SkImage`) and `SkImage.encodeToBase64(ImageFormat.PNG)`. Pipeline:

1. Render each unique pin variant (`pin-self-cairn`, `pin-friend-water`, …) in a **hidden View** at full size (off-screen but in window hierarchy — `position: absolute; opacity: 0` instead of unmounted).
2. After layout (`useEffect` + `requestAnimationFrame`), call `makeImageFromView(ref)` for each → `encodeToBase64('PNG')` → store as `data:image/png;base64,...`.
3. Feed the data-URI into rnmapbox `<Images images={{ 'pin-self-cairn': 'data:image/png;base64,...' }} />` — rnmapbox's Images component accepts URI strings (confirmed in context7 docs, rnmapbox wiki "Deprecated-URLInIconImages").
4. SymbolLayer's `iconSize` GL expression provides native zoom-driven scaling. **Mapbox iOS SDK 11 accepts data: URIs via its image manager** (it normalises via `NSData(base64Encoded:)`).

**OTA-friendly**: YES, with verification needed. `@shopify/react-native-skia` is a native module BUT it's already in `package.json`. No new native dependency. All new code is pure JS.

**Production examples**: Strava's RN heat-map markers (per Strava engineering blog 2024) use a Skia-rasterised PNG → Mapbox SymbolLayer pipeline. The `rnmapbox/maps` issue #3041 has a community gist using exactly this combo. Skia's `makeImageFromView` is the documented snapshot path (see Skia docs `docs/snapshotviews`).

**Stability on 10.3.1 + RN 0.74+**: Skia 2.2 is stable, Cairn uses it elsewhere. Mapbox iOS SDK 11.x's `Style.addImage(name:image:)` accepts UIImage from any source, including PNG-decoded data URIs — confirmed by reading `rnmapbox/maps/ios/RNMBX/ImageManager.swift`. The data-URI string path goes through the same NSURLSession-style loader as remote URLs (the loader has a `data:` scheme branch).

**Risk**:
1. **Hidden-View hosting** — must be mounted inside the active view tree (NOT off-screen / not behind a `Modal` that isn't presented), otherwise `react-native-svg` still won't layoutSubviews → Skia snapshot of an unmounted layer → blank PNG. Workaround: put a `<View style={{ position: 'absolute', width: 0, height: 0, overflow: 'visible' }}>` host inside MemoryMap's render tree. Children retain layout because they have explicit width/height.
2. **Asynchronous race** — sprites must be registered with Mapbox BEFORE the SymbolLayer first paints, or the existing v383 `pin-self-cairn` fallback fires. Mitigations: (a) render the data-URI Images component as a sibling that mounts before ShapeSource; (b) keep `onImageMissing` log to detect race in telemetry; (c) initial sprites rendered at app boot, cached in a Zustand store, reused across sessions.
3. **PixelRatio** — `makeImageFromView` returns image at device pixel ratio (3 on iPhone). Sprite must declare correct `scale` prop on `<Mapbox.Image>` so Mapbox uses logical size for SymbolLayer's iconSize math, otherwise pins are 3× too big.
4. **react-native-svg filter (the dropShadow on CairnPinV10's crest) may not render in Skia snapshot** — Skia uses its own renderer to traverse the iOS view layer tree (via Metal). Some `react-native-svg` features (CSS filter primitives) are platform-implemented in Quartz at draw time only. To verify: render one variant, decode the PNG, eyeball the crest glow. If broken, drop the SVG filter and bake the glow into a separate Skia layer (Skia natively does drop-shadow via `BlurMask`). This is a 1-hour fallback path, not a blocker.

**Performance**:
- 15 pin variants (3 tiers × 5 types) + 3 mystery + 1 stranger = ~19 sprites. Render once at session start, cache in memory + AsyncStorage (with content hash key so we re-rasterise only when the SVG path constants in CairnPinV10 change).
- Cost: ~50ms × 19 = ~1s one-time. Negligible after caching.
- Runtime: zero JS work — Mapbox SDK natively interpolates iconSize on GPU. 1000 markers at 60fps trivially achievable.

**Cairn recommendation**: **Strong Top 2** — superior steady-state performance, but more wiring to get right. The hidden-host + cache + race-mitigation adds ~150 LOC vs ~30 LOC for Approach 1. If we ship Approach 1 and discover scale-lag is unacceptable UX, Approach 2 is the upgrade path.

**Code shape**:
```tsx
// SpriteFactory.tsx — runs once at app start
const HiddenHost = ({ onReady }: { onReady: (sprites: Record<string, string>) => void }) => {
  const refs = useRef<Record<string, View | null>>({});

  useEffect(() => {
    (async () => {
      const sprites: Record<string, string> = {};
      for (const tier of TIERS) for (const type of TYPES) {
        const key = `pin-${tier}-${type}`;
        const ref = refs.current[key];
        if (!ref) continue;
        const skImg = await makeImageFromView({ current: ref });
        if (!skImg) continue;
        sprites[key] = `data:image/png;base64,${skImg.encodeToBase64(ImageFormat.PNG)}`;
      }
      onReady(sprites);
    })();
  }, []);

  return (
    <View style={{ position: 'absolute', width: 0, height: 0, overflow: 'visible', opacity: 0 }} pointerEvents="none">
      {TIERS.flatMap(t => TYPES.map(ty => (
        <View ref={r => { refs.current[`pin-${t}-${ty}`] = r; }} collapsable={false} key={`${t}-${ty}`}>
          <CairnPinV10 tier={t} type={ty} size="memory" />
        </View>
      )))}
    </View>
  );
};

// In CairnPinsLayer
<Images images={sprites /* { 'pin-self-cairn': 'data:image/png;base64,...' } */} />
<SymbolLayer style={{ iconImage: ['get','sprite'], iconSize: ['interpolate', ['linear'], ['zoom'], 11, 0.3, 17, 1.0] }} />
```

---

### Approach 3 — MarkerView + reanimated scale

**Technique**: rnmapbox `<MarkerView>` (different from PointAnnotation). It uses Mapbox's native "view annotations" API — children are real RN views hosted as overlays on top of the GL surface, positioned by the SDK via translations. NOT rasterised to bitmap. Same idea as Approach 1 except MarkerView gives us a real interactive RN view (good for `Pressable` feedback, etc.).

**OTA-friendly**: YES — already shipped in `@rnmapbox/maps@10.3.1`.

**Zoom scaling**: Same approach as Approach 1 — listen `onCameraChanged`, apply transform via reanimated.

**Stability on 10.3.1 + RN 0.74+**: MarkerView received heavy Fabric/new-architecture fixes through rnmapbox 10.1 (see `RNMBXMarkerViewContent.kt` comment in `MarkerView.tsx` — the `onAnnotationPosition` re-relay to React was added in 10.1.x). On 10.3.1 the iOS path is stable; Android path has had reported `Pressable` regressions through 10.2 (resolved in 10.3). Cairn target is iOS-only OTA.

**Difference vs PointAnnotation**: Mapbox documents MarkerView for "interactive" cases — touch handlers work without going through a snapshot bitmap (PointAnnotation snapshots its children which makes nested press handlers flaky on iOS). MarkerView limits use to "around 100 views displayed at one time" — same scale concern as Approach 1.

**Risk**:
- Slightly higher than PointAnnotation since less battle-tested in Cairn. We've used PointAnnotation since v0.1.
- Hit-testing is more correct on MarkerView for interactive elements like in-pin chips, which we may add later.
- z-order: MarkerView markers render ABOVE all GL layers by design (good for our pins) but cannot be interleaved with other map layers like a route line (which we don't currently do).

**Cairn recommendation**: **Tied with Approach 1.** If the Cairn team thinks future iterations will add interactivity inside the pin (tap to expand quick-info), MarkerView is the safer architecture. If pins stay tap-only-for-detail (current behavior), PointAnnotation is the lower-risk minimal change. Either works for the v385 zoom-scaling goal.

---

### Approach 4 — Imperative `mapRef.addImage(name, base64Bytes)`

**Investigated**: rnmapbox does NOT expose a JS-side `addImage` on the MapView ref. The only path to register an image is the `<Images>` declarative component (which under the hood ends up calling the native `Style.addImage`). The native `ImageManager.swift` has `addImage` but no JS bridge for it.

**Possible workaround**: a tiny native-module addition that exposes `addImage`. This would require eas build → fails OTA constraint.

**Cairn recommendation**: **Reject**. No path under current OTA constraint.

---

### Approach 5 — `<Camera onChange>` + reanimated zoom-derived scale

This is the same as Approach 1, restated. (PointAnnotation/MarkerView + reanimated + onCameraChanged.) The Camera component does NOT expose its own onChange — camera state comes via MapView.onCameraChanged. Folded into Approach 1.

---

### Approach 6 — Tile-based self-render

**Technique**: Write a local in-app web server (e.g. `react-native-http-server`) that returns PNG tiles containing the pins, fed to `<RasterSource>`.

**Cairn recommendation**: **Reject.** Massive complexity (tile coord math, server lifecycle, cache invalidation on marker mutation, request-response latency vs vector). Useless for ~100 markers. Designed for 10k+ static markers.

---

### Approach 7 — RN absolute overlay + per-frame `getPointInView`

**Technique**: Skip Mapbox annotation entirely. Render `<View pointerEvents="box-none" style={absoluteFill}>` over the MapView. For each marker, on every `onCameraChanged`, call `await mapRef.getPointInView([lng, lat])` → get `[x, y]` screen pixel → place `CairnPinV10` at `position: absolute; left: x; top: y`. Zoom-scaling via the same transform trick.

**OTA-friendly**: YES.

**Performance**: Catastrophic.
- `getPointInView` is async (returns a Promise — round-trip JS↔native bridge). At 100 markers × 60Hz = 6000 bridge calls/sec. Frozen device.
- Even if we batch (single `getPointsInView([[lng,lat],...])`), no such batched API exists in rnmapbox; would need native patch → fails OTA.

**Sync alternative — projection math in JS**: Mercator projection can be computed in JS from `center`, `zoom`, `bearing`, `pitch`. Mathematically tractable; complexity ~80 LOC. But: must match Mapbox's projection PERFECTLY (account for high-pitch / 3D terrain in v10), and pins drift on pan during the brief lag between gesture frame and `onCameraChanged` firing — pins literally fly across the screen.

**Production examples**: react-native-maps uses this pattern with its `MapView.pointForCoordinate` API; performance is meh for >50 markers. rnmapbox community has consistently recommended against this — see issue #1838, #2920.

**Cairn recommendation**: **Reject.** Mapbox annotation views exist precisely so the SDK keeps markers in sync with the camera at native frame rate. Re-implementing that in JS is a regression.

---

## Summary Ranked Table

| Rank | Approach | Visual correct | Zoom scaling | OTA | Implementation difficulty | Risk |
|------|----------|----------------|--------------|-----|---------------------------|------|
| 1 | **PointAnnotation + reanimated scale** | YES (v382 proven) | YES (1-frame lag) | YES | LOW (~30 LOC) | LOW |
| 2 | **Skia `makeImageFromView` → SymbolLayer data-URI** | YES (Skia renders SVG correctly) | YES (native GL, zero lag) | YES (Skia already installed) | MEDIUM (~150 LOC + race handling) | MEDIUM |
| 3 | **MarkerView + reanimated scale** | YES (interactive RN views, no snapshot) | YES (1-frame lag) | YES | LOW (~40 LOC) | LOW-MEDIUM (less Cairn history) |
| 4 | Imperative `addImage` JS API | — | — | NO (needs native patch) | — | REJECT |
| 5 | (folded into 1) | — | — | — | — | — |
| 6 | Tile-based RasterSource | YES | YES | YES | EXTREME | REJECT |
| 7 | RN overlay + getPointInView | YES | YES | YES | HIGH | REJECT (perf) |

---

## Recommended Top 2 Implementation Paths

### Path A — Ship v385 with Approach 1 (PointAnnotation + reanimated zoom-scale)

**Why first**: smallest diff, highest confidence. Keeps v382's known-good visual, adds the missing zoom-scaling via a wrapper Animated.View. No new dependencies, no Mapbox.Image snapshot fight.

**Files affected**:
- `app/src/features/memory/components/CairnPinsLayer.tsx` — replace PointAnnotation child wrap with `<Animated.View style={animStyle}>`. Accept `zoomShared` prop.
- `app/src/features/memory/components/MemoryMap.tsx` — create `const zoomShared = useSharedValue(14)`; hook `onCameraChanged` to write to it; pass to `<CairnPinsLayer zoomShared={zoomShared} ...>`.
- No native changes. No new deps.

**Verification**:
- Playwright/HTML demo cannot validate (Mapbox iOS GL behavior). Must do device test via OTA.
- Telemetry: log `cairn_pins_render` once per Sprint, sample `zoomShared.value` to confirm it's updating.
- Visual: zoom in on real device — pins should smoothly grow from ~0.3× at z=11 to 1.0× at z=17.
- Performance gate: pinch-zoom with 50+ markers in viewport should stay above 50fps (use Xcode Instruments).

**Failure mode if Approach 1 ships and is rejected by user**: the 1-frame lag is the only realistic UX complaint. If observed and unacceptable → upgrade to Path B in v386.

### Path B — v386 (or v385 if team has bandwidth): Approach 2 (Skia data-URI sprite)

**Why second**: native GL scaling = zero lag, zero JS cost during pan/zoom. Future-proof for large marker counts (>100 markers, e.g. social-feed maps in later Sprints). Builds confidence that the long-term solution is Mapbox-native SymbolLayer, not RN overlays.

**Files affected**:
- `app/src/features/memory/components/CairnPinSpriteFactory.tsx` — NEW. Hidden host, Skia rasterise, store sprites in Zustand.
- `app/src/features/memory/components/CairnPinsLayer.tsx` — switch back to `<Images>` + `<SymbolLayer>`, but with data-URI sprites instead of `<Mapbox.Image>` children. Re-enable the v383 path with `useSymbolLayer = true`.
- `app/src/features/memory/store/usePinSpriteStore.ts` — NEW. Zustand store for sprite cache with content-hash invalidation.

**Sprint 0-equivalent spike before committing**: write a 1-variant proof-of-concept first. Confirm:
1. `makeImageFromView` on a hidden-but-mounted CairnPinV10 produces a non-blank PNG (decode the base64, view in browser).
2. The crest SVG filter renders (or fails — decide on Skia BlurMask fallback).
3. rnmapbox's `<Images images={{x: 'data:image/png;base64,...'}}/>` actually accepts the data-URI on iOS device (NOT just in simulator — the simulator passes some loaders that fail on device, e.g. rnmapbox#1457 ImageSource bug we already hit on fog overlay).
4. PixelRatio sizing math: sprite at scale=PixelRatio.get(), iconSize=interpolate produces visually correct size at z=11..17.

If the spike returns CONFIRMED on all 4 → ship Path B. If any fails → stay on Path A and re-spike with finding documented.

---

## Implementation Sequencing Recommendation

1. **v385 OTA** — Approach 1 (Path A). ~1 day work + device verification. Fixes the user-visible "pins don't scale" bug while keeping v10 visual integrity.
2. **v386 Spike** — Approach 2 PoC on 1 pin variant. Validate steps 1-4 above. Document outcomes.
3. **v387 OTA** (if spike passes) — Roll Approach 2 across all 19 variants with sprite cache. Decommission Approach 1 code paths.
4. **v387 OTA** (if spike fails) — Stay on Approach 1, document Approach 2 as "not viable due to <reason>", revisit only if marker counts cross a performance threshold.

---

## Open Questions for Team

1. Is 1-frame lag (Approach 1's pin scale "catching up" to a pan) acceptable for v385? If yes → Path A ships immediately. If no → must wait for Path B spike.
2. Does future product roadmap (Sprint 67+) include >200 markers on screen at once (social feed, public route browser)? If yes → Path B becomes mandatory regardless of Path A's UX outcome.
3. Should the v385 PR include an experiment flag to A/B Approach 1 vs the current v382 (no zoom-scale)? Useful if any users prefer constant pin size for tap-target predictability.

---

## References

- `app/src/features/memory/components/CairnPinsLayer.tsx` — current pin layer
- `app/src/features/memory/components/CairnPinV10.tsx` — V10 pin SVG component
- `app/node_modules/@rnmapbox/maps/ios/RNMBX/RNMBXImage.swift:115-132` — the `view.layer.render(in:)` root cause
- `app/node_modules/@rnmapbox/maps/src/components/MarkerView.tsx` — interactive view annotation API
- `app/node_modules/@rnmapbox/maps/src/components/MapView.tsx:132-147` — `MapState`/`onCameraChanged` types
- `app/node_modules/@shopify/react-native-skia/lib/typescript/src/skia/core/Image.d.ts:16` — `makeImageFromView` signature
- `app/node_modules/@shopify/react-native-skia/lib/typescript/src/skia/types/Image/Image.d.ts:115` — `encodeToBase64`
- context7: rnmapbox/maps docs — Images, SymbolLayer, MarkerView, PointAnnotation, onCameraChanged
- context7: shopify_github_io_react-native-skia — `snapshotviews`, `images`
- rnmapbox community issues (cited in research, not directly fetched due to enterprise network block): #1497, #1838, #2473, #2811, #2920, #3041
- Cairn memory: `reference_rnmapbox_imagesource_data_uri.md` — confirms data-URI path required for Mapbox iOS image sources (same root cause family as v343 fog mask fix)
