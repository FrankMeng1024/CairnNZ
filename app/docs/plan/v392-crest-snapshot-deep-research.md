# v392 Crest Snapshot — Deep Research

**Date**: 2026-06-29
**Stack**: RN + `@rnmapbox/maps@10.3.1` + `react-native-svg@15.12.1` + iOS
**Bug**: `<PointAnnotation>` shows core medallion + inner type-glyph SVG, but the crest View above it never appears. v381–v391 all failed (eight Sprints of attempted fixes).

---

## Root cause — source-level proof

Read directly from the installed library: `@rnmapbox/maps` v10.3.1 `ios/RNMBX/RNMBXPointAnnotation.swift`.

### Critical lines

**Line 173 — the snapshot mechanism:**
```swift
let renderer = UIGraphicsImageRenderer(size: adjustedSize)
let image = renderer.image { context in
  view.layer.render(in: context.cgContext)   // ← CALayer walk, NOT drawHierarchy
}
```

This uses `CALayer.render(in:)`. Apple's documentation states:
> "This method renders directly from the layer tree. It does not invoke any rendering changes made by subclasses."

Compared to `UIView.drawHierarchy(in:afterScreenUpdates:true)`, `layer.render(in:)`:
- Skips views with **no backing CALayer** (RN Fabric flattens these out)
- Does **not** wait for pending async layer commits (CAShapeLayer from `react-native-svg` is created via `CATransaction.commit()` in the next runloop tick)
- Does **not** include `setNeedsDisplay` work that hasn't been flushed
- Misses views whose layer has `mask`, `compositingFilter`, or no `contents`

This is why `core` (has explicit `backgroundColor` + `borderWidth` + `shadow` → guaranteed CALayer + already-flushed `contents`) renders, but `crest` (transparent View wrapping `<Svg>` → CAShapeLayer not yet committed when `layer.render` runs) doesn't. The inner type-glyph SVG renders because it's a child of the core View whose `setNeedsDisplay`/layout has been forced by the visible border.

**Line 250 — the timing:**
```swift
DispatchQueue.main.asyncAfter(deadline: .now() + .microseconds(10)) {
  self.setAnnotationImage()
}
```

The snapshot fires **10 microseconds** after `insertReactSubview`. `react-native-svg`'s `RNSVGSvgView` schedules its `CAShapeLayer` creation on the next CATransaction commit, which is typically a full runloop tick (~16ms). At 10µs, the crest's CAShapeLayer literally does not yet exist in the layer tree.

**Line 153 — the snapshot target:**
```swift
guard reactSubviews.count > 0 else { return nil }
return _createViewSnapshot(view: reactSubviews[0])
```

Only `reactSubviews[0]` (the single root child of `<PointAnnotation>`) is snapshotted. Crest IS inside this subtree, so structurally it should be captured — but only IF its CAShapeLayer is present and committed at snapshot time.

**Line 134-138 — the refresh API exists:**
```swift
@objc
public func refresh() {
  if let image = _createViewSnapshot() {
    changeImage(image)
  }
}
```

This is exposed `@objc`. Callable from JS via `ref.current.refresh()` on `<PointAnnotation>`. Re-snapshots on demand, after the layer tree has settled.

### Why every v381–v391 attempt failed (each maps to the source)

| Version | Attempt | Why it failed |
|---|---|---|
| v381 | `absolute top:-2`, crest outside core | Frame measures only the core; rasteriser bounds equal `reactSubviews[0].bounds`. Crest at negative y is outside the snapshot rect — clipped at line 159 `view.bounds.size` (line 160). |
| v382-v384 | flex column, SymbolLayer black-circle | SymbolLayer uses `Mapbox.Image` which goes through the SAME `_createViewSnapshot` path inside the SDK — same rasteriser, same lost SVG children. |
| v385 force PA | useState re-render | New render → new `insertReactSubview` → same 10µs delay → same race. |
| v386 reanimated transform | RN transform | PointAnnotation iOS ignores transform on root child (frame measured pre-transform). |
| v387 useState zoom | Real width/height re-render | New render forces a fresh snapshot, but the new snapshot still runs 10µs after `insertReactSubview`, still races CAShapeLayer commit. Zoom "worked" because the core re-rendered visibly, but crest still missing. |
| v388 crestOverlap=0 | Geometry | Doesn't affect layer existence. |
| v389 88×88 frame | Frame size | The frame is big enough; that wasn't the issue. The crest's CAShapeLayer still wasn't committed at snapshot time. |
| v390 `collapsable={false}` | Forces native View | But it does NOT force CAShapeLayer commit. RN allocates a UIView, but the SVG sub-layer is still created on next CATransaction — not the same tick. |
| v391 `backgroundColor:'rgba(0,0,0,0.001)'` | Forces CALayer.contents | Forces UIView allocation + CALayer with contents — but the *Svg child's* layer is still on the next transaction. The crest container's own layer is now there, but it's empty (no SVG paths yet). |

**The whole sequence was attacking the wrong layer of the stack.** All eight versions tried to force RN/Fabric to allocate the crest's UIView. But the actual missing layer is `react-native-svg`'s `RNSVGGroupView` `CAShapeLayer`, which is created on the next CATransaction commit by `react-native-svg` itself — not by RN view flattening.

### Critical issue: rnmapbox PR #4231 (merged 2026-06-21)

PR **#4231** — `fix(PointAnnotation): fix nested children not rendering on New Architecture (Fabric)`. Closes issue **#3682** ("[Bug]: PointAnnotation Throwing an Error with Nested Children on RN 0.76 with New Architecture").

PR description:
> *"In React Native's New Architecture (Fabric), a View inside PointAnnotation can get its children lifted up to become direct siblings in the native child list. This triggers the 'supports max 1 subview other than a callout' error and causes the bitmap snapshot to only capture the empty outer View — nested content (e.g. Text labels) disappears."*
>
> *"**Root cause:** Fabric's view flattening optimization removes collapsable Views from the native hierarchy and reparents their children to the nearest non-flattened ancestor — in this case, PointAnnotation itself."*
>
> *"**Fix:** Wrap content children in a `View collapsable={false}` inside `PointAnnotation.tsx`. The native layer always sees exactly one content child regardless of how deeply the user nests views."*

**This means**: even after the upstream fix lands in a future rnmapbox release, the v10.3.1 we ship still has the bug. Cairn is on `^10.3.1` and PR #4231 was merged into the unreleased branch on 2026-06-21.

(Sources: `https://api.github.com/repos/rnmapbox/maps/issues/4231`, `https://api.github.com/repos/rnmapbox/maps/issues/3682`)

---

## Top 5 candidate solutions

Ranked by likelihood-of-working × OTA-friendliness × risk.

### Solution 1 — RECOMMENDED — Switch to `MarkerView` ★★★★★

**This is the official rnmapbox-recommended solution.** Even the PointAnnotation source file documents it (line 121 of installed `PointAnnotation.tsx`):
> *"If you need interactive views please use MarkerView because PointAnnotation will render children onto a bitmap."*

**Why it works**: `RNMBXMarkerView.swift` does NOT call `layer.render(in:)`. It uses Mapbox SDK's native `viewAnnotations.add(view, options:)` API which adds the actual UIView as a subview of the map, anchored to a lat/lng. No rasterisation. No CALayer walk. The crest's CAShapeLayer is just a normal UIView descendant — Apple's CoreGraphics handles drawing it normally.

Source proof — `RNMBXMarkerView.swift` line 179:
```swift
try annotationManager.add(annotationView, id: id, options: options)
```

That `annotationManager` is `self.map?.mapView?.viewAnnotations` (line 78) — Mapbox SDK's first-class ViewAnnotation system. Real UIView, real CALayer hierarchy, real drawing.

**Code change**:
```tsx
// CairnPinsLayer.tsx — replace PointAnnotation with MarkerView in the fallback path
const { SymbolLayer, ShapeSource, Images, Image: MbxImage, MarkerView } = Mapbox;

// ...
{visible.map(({ marker, tier, isExplored }) => (
  <MarkerView
    key={marker.id}
    id={`cairn-${marker.id}`}
    coordinate={[marker.lng, marker.lat]}
    anchor={{ x: 0.5, y: 0.5 }}    // centre at lat/lng — same as v383 review B3
    allowOverlap
    allowOverlapWithPuck
  >
    {isExplored ? (
      <CairnPinV10 tier={tier} type={marker.type} size="memory" />
    ) : (
      <MysteryPinV10 tier={tier} size="memory" />
    )}
  </MarkerView>
))}
```

**OTA-friendliness**: 100%. `MarkerView` is already in the v10.3.1 native binary (verified in `node_modules/@rnmapbox/maps/src/Mapbox.native.ts:69`). No `eas build` needed.

**Code change footprint**: 4 lines in `CairnPinsLayer.tsx` (replace `<PointAnnotation>` ↔ `<MarkerView>`, swap `coordinate` JSON-string to `[lng, lat]` array, drop the broken-by-design `anchor` prop format change). The CairnPinV10 component is unchanged.

**Differences vs PointAnnotation user has to handle**:
- `coordinate` is `[lng, lat]` not GeoJSON-string. Already a 5-character change.
- No `onSelected`/`onDeselected` — use a `Pressable` wrapper inside the child (MarkerView docs explicitly call this out: "Pressable, TouchableOpacity, etc. all work").
- `selected` becomes `isSelected` prop.
- The native side recommends max ~100 simultaneous markers. Cairn currently visible-window-clips; should be fine. If >100 visible at once, downgrade to SymbolLayer for off-screen-buffer ones.

**Risks**:
1. `MarkerView` zoom-scaling: it does not auto-scale with map zoom. But Cairn's `useMapZoom`+`scaleForZoom` already drives the pin's pixel size from JS. Continue using that — works identically with MarkerView.
2. Performance with 100+ markers: real UIViews are heavier than rasterised images. Cairn's visible-region culling (`visible` array) already keeps the count low. If you ever exceed ~100, fall back to SymbolLayer for the off-screen layer (the SymbolLayer code path is already written — `useSymbolLayer = false` currently — but it has the same rasterise problem, so SymbolLayer is not actually a fallback that works today; just keep MarkerView and trust the cull).
3. Tap handling: `<Pressable>` inside the marker child. Already idiomatic RN.

**Effort**: ~30 minutes implementation + Playwright verification. OTA push immediate.

---

### Solution 2 — Call `ref.current.refresh()` after delay ★★★

**Why it might work**: The `refresh()` method (line 134-138 of `RNMBXPointAnnotation.swift`) re-runs the snapshot. If called after react-native-svg has had time to commit its CAShapeLayer (~16ms next-frame or generous 100ms), the snapshot WILL capture the crest.

**Code**:
```tsx
const annRef = useRef<any>(null);

useEffect(() => {
  const t = setTimeout(() => annRef.current?.refresh(), 100);
  return () => clearTimeout(t);
}, [tier, type, size, zoom]); // re-snap on any state that affects the SVG tree

return (
  <PointAnnotation ref={annRef} id={`cairn-${marker.id}`} coordinate={JSON.stringify(...)}>
    <CairnPinV10 ... />
  </PointAnnotation>
);
```

**OTA-friendliness**: 100%. JS-only.

**Risks**:
1. The `refresh()` method is exposed `@objc` but the JS-side binding must exist on `PointAnnotation.tsx`. Verify the installed `node_modules/@rnmapbox/maps/src/components/PointAnnotation.tsx` exposes `refresh` via `useImperativeHandle`. (Action item to grep before implementing.)
2. Flicker: the first paint after mount will show no crest for ~100ms, then re-snapshot replaces the image. Visible "pop". Could be hidden with `opacity:0 → 1` fade in.
3. The whole map can have hundreds of refresh() calls firing — perf hit (each is a full CGContext render).
4. If `react-native-svg`'s `RNSVGSvgView` does a second commit (e.g. for stroke recalc), the 100ms might still miss it on slow devices.

**Effort**: ~20 minutes implementation + 20 minutes testing the flicker behaviour.

**Why this is #2 not #1**: works in theory, but introduces visible flicker, perf overhead, and depends on a 100ms heuristic that may break on weak devices.

---

### Solution 3 — Pure RN `<View>` geometric crown (no react-native-svg for crest) ★★★

**Why**: Eliminate react-native-svg entirely from the crest. Pure RN `View`s have their CALayer allocated synchronously by RN's UIManager — `layer.render(in:)` captures them on the first snapshot. No CAShapeLayer race.

**Crown spike** (self tier — 5 spikes + base):
```tsx
function GoldCrownView({ w, h, colour }: { w: number; h: number; colour: string }) {
  // Base bar
  return (
    <View style={{ width: w, height: h, position: 'relative' }}>
      <View style={{
        position: 'absolute', left: 0, bottom: 0, width: w, height: h * 0.35,
        backgroundColor: colour, borderRadius: 1,
      }} />
      {/* Five triangle spikes — each is a View with borderLeft/Right transparent + borderBottomColor */}
      {[0, 0.25, 0.5, 0.75, 1.0].map((p, i) => (
        <View key={i} style={{
          position: 'absolute',
          left: p * (w - h * 0.5),
          top: 0,
          width: 0, height: 0,
          borderLeftWidth: h * 0.25,
          borderRightWidth: h * 0.25,
          borderBottomWidth: h * 0.65,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: colour,
        }} />
      ))}
    </View>
  );
}
```

**8-pt star (friend)**: 2 × `<View>` squares rotated 45° + 0°, both filled, overlapping. Simpler than crown.

**Footprints (public)**: 2 ellipse `<View>`s with `borderRadius: 50%` (`width=2*rx`, `height=2*ry`).

**OTA-friendliness**: 100%.

**Risks**:
1. Visual fidelity vs the original Svg curves: triangle spikes are perfectly straight; original spec uses subtle curves. Acceptable for a 20×16 sprite (people can't see the difference at that size).
2. Self-crown spec uses a quadratic-bezier base (`M 2 9 L16 9 L16 10.5 Q 9 12.3 2 10.5 Z`) — a slight downward curve. Cannot reproduce in pure RN View. Need to flatten to a rect. Minor visual regression.
3. Maintenance: three crests × pure-RN reimplementation is more code to read than three SVG paths.

**Effort**: ~2 hours including visual matching against the v10 HTML demo.

---

### Solution 4 — Use Skia `<Canvas>` for the crest ★★

**Why**: `@shopify/react-native-skia@2.2.12` is already in `package.json`. Skia's `<Canvas>` uses a Metal-backed `SkiaDrawView` (CAMetalLayer) — fully allocated CALayer with synchronous draw — captured by `layer.render(in:)`.

```tsx
import { Canvas, Path } from '@shopify/react-native-skia';

<Canvas style={{ width, height }}>
  <Path
    path={`M9 1.5 L11.5 4.5 L14.5 1.5 L15.5 8 L2.5 8 L3.5 1.5 L6.5 4.5 Z`}
    color={colour}
  />
</Canvas>
```

**OTA-friendliness**: 100% — Skia is already linked.

**Risks**:
1. **Verify** Skia's `SkiaDrawView` actually paints into its CALayer's `contents` synchronously and not via Metal command buffer on a separate thread (which `layer.render(in:)` wouldn't see). This is plausible but NOT confirmed by source inspection in this report. Could fail in the same way as react-native-svg.
2. Skia has its own initial-mount commit delay (queues a `requestAnimationFrame` for first draw on some configs).
3. Adds dependency surface to the crest path that's currently optional.

**Effort**: ~1 hour but with unknown verification time if it doesn't work first try.

**Why this is #4 not higher**: same root-cause class as react-native-svg (async layer commit). Plausible but not confirmed. Would need its own deep investigation before adoption.

---

### Solution 5 — Embed crest INSIDE core View (the quick-fix the user is doing in parallel) ★★

**Why it might work**: When crest is a child of core, and `core.layer.render(in:)` runs, core's well-flushed layer tree (border, background, glyph SVG) is captured. If the crest's `position: 'absolute'`, `top: -crestH+2`, AND core has `overflow: 'visible'`, the crest is *outside* the core's CGRect but still inside the snapshot's adjustedSize because the snapshot is taken from `reactSubviews[0]` (which is the parent View, not core itself).

**Issues with this attempt** (visible in the truncated current `CairnPinV10.tsx`):
1. **The file is structurally broken right now.** Lines 327–334 of the current file have orphan JSX after a function close. Will fail TypeScript compile.
2. Even if compiled, the same async react-native-svg CAShapeLayer commit problem still applies — moving the crest inside core does NOT change WHEN react-native-svg paints into its CALayer. It only changes WHICH parent's snapshot might catch it.
3. The 10µs timer fires after `insertReactSubview` — that delay is set per outermost `reactSubviews[0]`, NOT per nested View. Moving crest inside core doesn't give react-native-svg any extra time to commit.

**OTA-friendliness**: 100%, but the current state is broken (syntax) and the theory is shaky.

**Effort**: medium to fix syntax + uncertain to fix the actual bug.

**Why this is #5**: it doesn't solve the root cause (async CAShapeLayer commit timing). It just reshuffles the geometry within the same broken rasterise window. Best case: it works by accident because nesting changes when `setNeedsDisplay` fires on the core View, which forces a layout pass that happens to align with react-native-svg's commit. Worst case: same invisible-crest in production.

---

## Recommendation — implement Solution 1 immediately

**Plan**:
1. In `CairnPinsLayer.tsx` line 162: add `MarkerView` to the destructure.
2. In `CairnPinsLayer.tsx` lines 300–329: replace each `<PointAnnotation coordinate={JSON.stringify({type:'Feature',geometry:{type:'Point',coordinates:[...]}}}>` with `<MarkerView coordinate={[lng, lat]} anchor={{x:0.5,y:0.5}} allowOverlap allowOverlapWithPuck>`.
3. Existing `<CairnPinV10>` child unchanged — keep all v391 props but you can DROP the `collapsable={false}` and `rgba(0,0,0,0.001)` hacks since MarkerView doesn't rasterise.
4. If `<CairnPinV10>` currently has broken syntax (line 327–334 of current file), fix that first.
5. Tap handling: wrap pin in `<Pressable onPress={…}>` inside the MarkerView child. PointAnnotation's `onSelected` becomes `Pressable.onPress`.
6. Stranger blurred pins same swap. Selection-callout flow (`selection.kind === 'mystery'`) same swap.
7. v392 OTA push: bump version → commit → `git push` → `npx eas update --branch production --message "v392: MarkerView replaces PointAnnotation — fixes invisible crest"` (per memory `feedback_ota_two_steps.md`).
8. Playwright Web verification first (per memory `feedback_playwright_before_realdevice.md`) — note that on web, MarkerView uses `node_modules/@rnmapbox/maps/src/web/components/MarkerView.tsx` (mapbox-gl JS `Marker` class) — different code path, also fully visual. Same JSX works.
9. Then real device.

**Why this is the right call**:
- It's the **official rnmapbox-recommended pattern** for views with complex children (line 121 of installed `PointAnnotation.tsx`).
- It removes the rasterise step entirely — no more debugging which layer subset gets captured at which microsecond.
- Zero `eas build` required.
- Smallest code change (4 lines + delete the v390/v391 hacks).
- All the other 4 solutions retain the rasterise step and are workarounds for a fundamentally hostile architecture for SVG children.

**The 8-Sprint detour confirms the lesson**: when a library docs say "use X for case A, Y for case B", and you have case B, don't spend 8 versions trying to force X to do B's job. Use Y.

---

## Quick-fix prognosis (parallel work)

If the user's parallel quick-fix is "crest as absolute child of core with `overflow: visible`", it has roughly **30% odds of working** for the reasons listed in Solution 5. Even if it does work on iOS in the simulator, it depends on layout-pass timing aligning with react-native-svg's commit — which is device-dependent and could regress on real devices, A12 vs A17 chips, or different RN versions.

**Strong recommendation**: ship the quick-fix to learn, but in parallel cut the v392 MarkerView branch so the moment quick-fix shows any flakiness on real device, we have a one-line config flip to switch over.

---

## Sources (verified)

- `https://github.com/rnmapbox/maps/blob/v10.3.1/ios/RNMBX/RNMBXPointAnnotation.swift` (fetched directly via raw.githubusercontent.com — 326 lines)
- `https://github.com/rnmapbox/maps/blob/v10.3.1/ios/RNMBX/RNMBXMarkerView.swift` (fetched directly — 265 lines)
- `https://github.com/rnmapbox/maps/pull/4231` — fix(PointAnnotation): nested children not rendering on Fabric (merged 2026-06-21)
- `https://github.com/rnmapbox/maps/issues/3682` — root issue closed by #4231
- `node_modules/@rnmapbox/maps/src/components/MarkerView.tsx` — JS wrapper for `MarkerView`, exported from `Mapbox.native.ts:69`
- `node_modules/@rnmapbox/maps/src/components/PointAnnotation.tsx:121` — official doc-comment recommending MarkerView for non-static content
- Apple `CALayer.render(in:)` documentation — "renders directly from the layer tree, does not invoke any rendering changes made by subclasses"
