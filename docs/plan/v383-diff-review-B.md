# v383 Diff Review — Reviewer B (cold read)

Scope: pin components + SymbolLayer rewrite + adapter + MarkerDetailScreen detail-size change.
Reviewer B did not consult Reviewer A. All findings derive from cold reading the 4 source files + v10 HTML baseline + plan/B0 report + rnmapbox 10.3.1 in package.json.

---

## Verdict: NEEDS_FIX

3 Blocker, 4 Critical, 3 Medium. Do not OTA push without resolving the Blockers. Critical issues will produce visibly-wrong pins on real device even though they will not crash.

---

## B1 — [BLOCKER] `<Mapbox.Image>` children sprite registration is async; SymbolLayer can render the first frame before any sprite is registered

**Files**: `CairnPinsLayer.tsx:186-202` (`<Images>` block), `:205-233` (`<SymbolLayer>`).

**Issue**: rnmapbox `<Images>` + `<Image>` with children works by:
1. RN renders the child View tree to an offscreen surface.
2. Native side rasterises offscreen surface → CGImage / Bitmap.
3. Image is added to the Mapbox style image manager under `name`.
4. Style image manager broadcasts "ready"; SymbolLayer picks it up next render tick.

Steps 1–3 are NOT synchronous with the React commit. The first paint of `<SymbolLayer>` will reference `iconImage` = `pin-self-cairn` etc. before any sprite has been rasterised on the native side. The Mapbox SDK emits `style-image-missing` for each unknown image, and renders nothing for that feature until the sprite arrives.

For 15 sprites (3 tiers × 5 types) + 3 mystery + 1 stranger = 19 sprites, this is amplified — they don't all rasterise in the same tick.

**Why this is Blocker**: B0 report says pins disappear vs v382. If the user reports "no pins" or "pins flash in over 1-2s", this is the root cause. Even if they eventually appear, the first impression at app-open will be empty map.

**Symptom signature on device**: console will log `style-image-missing pin-self-cairn` (or similar) one or more times right after the layer mounts. Verify on real device with `adb logcat | grep -i mapbox` or Xcode console.

**No code change here**: stating the risk. Mitigation requires either (a) pre-warming with a hidden View that mounts `<Images>` early in the screen lifecycle, or (b) using `onImageMissing` to retry, or (c) accepting the flash with iconOpacity zoom 10→0 / 11.5→0.6 ramp which already partially hides early frames at very-low zoom.

The current code does NOT have any of these mitigations. The zoom ramp at line 222-226 (`10 → 0, 11.5 → 0.6`) only helps if user is zoomed out below 11.5 at app open — Memory map typically opens at zoom 16.5 (see `MarkerDetailScreen.tsx:212`). So sprites will be requested at iconOpacity ≈ 1.0 from frame 1.

---

## B2 — [BLOCKER] react-native-svg 15.12.1 does NOT support `<feDropShadow>` runtime — silent no-op on iOS

**File**: `CairnPinV10.tsx:111-123` (Filter + feDropShadow), `:106-126` (CrestWithGlow iOS/web branch).

**Issue**: The code comments explicitly say "react-native-svg supports feDropShadow on iOS via the native SVG renderer" and uses `@ts-expect-error` to silence type errors. This is **factually wrong** for react-native-svg.

react-native-svg's `<Filter>` element accepts children, but the actual filter primitives implemented are limited. As of react-native-svg 15.x, the supported primitives on iOS/Android are essentially: `<feColorMatrix>`, `<feGaussianBlur>`, `<feOffset>`, `<feMerge>` (partial), `<feFlood>`, `<feComposite>`. **`<feDropShadow>` is NOT supported**.

Worse — react-native-svg's iOS implementation **silently ignores** unsupported filter primitives. So:
- No crash.
- No console warning (the `@ts-expect-error` comment intentionally suppresses the type error at compile time).
- Crest renders **without glow**.

The Android branch (line 129-142) already concedes this and uses a "doubled crest" halo. **But the iOS branch falls through to the same unrendered-filter no-op path** — meaning iOS pins lose their tier glow entirely, exactly the opposite of the developer's intent stated in the file comment "iOS: SVG drop-shadow filter (matches v10 HTML)".

**Evidence**: line 122 `<Path {...({ filter: 'url(#crestGlow)' } as any)} d="" />` — applies filter reference to a Path with empty `d` attribute. That Path renders nothing. The subsequent `<CrestPaths tier={tier} colour={colour} />` (line 123) is NOT inside any group with `filter={...}` attribute. So even if feDropShadow worked, the actual crest paths are not filtered.

**Why this is Blocker**: iOS users see crest without glow, contradicting v10 HTML and contradicting Android. v10 HTML uses CSS `filter: drop-shadow(0 0 4px tierGlow) drop-shadow(0 1px 1px black/50)` on the crest container — that's not portable to SVG `<feDropShadow>` even if it worked.

The plan's `final2` claims iOS-only feDropShadow as the "v10-faithful" solution. The plan is built on incorrect assumptions about react-native-svg capabilities.

---

## B3 — [BLOCKER] `iconAnchor: 'bottom'` puts marker lat/lng at the bottom edge of the pin → coordinate misalignment

**File**: `CairnPinsLayer.tsx:231` (`iconAnchor: 'bottom'`).

**Issue**: Mapbox SymbolLayer `iconAnchor` of `'bottom'` means the bottom-center of the rendered sprite aligns with the geometry coordinate. This is correct for **droplet/teardrop pins** (Google-Maps-style) where the pin's tip is at the bottom.

CairnPinV10 is a **round medallion + small crown on top** — there is no "tip" at the bottom. The center of the core (the actual cairn medallion) is at coords `(width/2, coreTop + core/2)` from the top, NOT at the bottom edge of the sprite.

For `size="memory"`:
- frame.height = (16 − 6) + 44 + 4 = 58
- coreTop = 16 − 6 = 10
- core center y = 10 + 22 = 32
- bottom edge y = 58

So `iconAnchor: 'bottom'` places the medallion's center **26px above** the user's actual location, with the bottom edge of the parent View sitting on the actual coordinate. At zoom 17 size 1.0, that's 26 device-pixels of offset; at zoom 11 size 0.3, ~8px. Visually pins will sit "above" features instead of "on" them — users will report cairns appearing in the wrong place.

This contradicts v382 `PointAnnotation` semantics, where the child View's center is anchored at the coordinate by default. Switching to SymbolLayer is silently changing the marker semantics.

**Fix direction**: `iconAnchor: 'center'` OR `iconAnchor: 'bottom'` with `iconOffset: [0, -coreRadius]` calculated to put core center on the coordinate. Plan should clarify intent.

---

## B4 — [CRITICAL] `iconImage: ['coalesce', ['get', 'sprite'], 'pin-self-cairn']` — `coalesce` is a valid expression but masks missing sprites instead of surfacing them

**File**: `CairnPinsLayer.tsx:209-213`.

**Verification of `coalesce` in layout properties**: Yes, `coalesce` IS supported in Mapbox style expressions for `iconImage` (a data-driven layout property). Mapbox Style Spec confirms `coalesce` returns first non-null. So syntactically OK.

**Why this is Critical anyway**: The fallback `'pin-self-cairn'` is itself a sprite registered via `<Images>`. If the entire `<Images>` block fails to register (B1), then BOTH `['get', 'sprite']` lookups and the literal `'pin-self-cairn'` are missing. The coalesce buys nothing — it doesn't fall back to a built-in or known-present sprite.

Additionally: if a marker has `type` outside of `TYPES` (e.g. a new type added later, or a corrupted store entry), `sprite` resolves to `pin-self-<unknown>` which is unregistered. `coalesce` falls back to `pin-self-cairn` — which **silently mis-renders** the marker as a cairn. Better practice would be a `match` expression on tier + type with explicit fallbacks, OR a runtime guard in the feature builder.

The biggest concern: **debugging is harder** with `coalesce` because mistakes silently become "looks like a cairn". A missing-sprite warning would have surfaced.

---

## B5 — [CRITICAL] `featureCollection` useMemo dependency is `[visible]`, but `visible` recomputes every camera/marker change → ShapeSource gets a new shape object every frame the camera moves

**File**: `CairnPinsLayer.tsx:113-134` (featureCollection), `:94-100` (visible).

**Issue**: 
- `classified` deps: `[markers, centerLat, centerLng, geometryVersion, ownIds]` — centerLat/centerLng change on every camera move (panning).
- `visible` derives from `classified` → re-derives every camera move.
- `featureCollection` deps `[visible]` → new object every camera move.
- `<ShapeSource shape={featureCollection}>` gets a new identity prop every camera move.

rnmapbox `ShapeSource` does a deep-ish diff using feature `id` (which is correctly set at line 117 — good). So on a typical pan with the same marker set visible, no re-rasterisation occurs, BUT the JS bridge marshals the entire FeatureCollection across to native every camera frame.

For ~20 markers this is fine. For 200+ markers (memory layer accumulates over time), the bridge cost adds up on every pan tick.

**Why Critical not Blocker**: It's a perf issue, not correctness. But on lower-end Android with many markers, this causes pan jank — which contradicts the SymbolLayer migration motivation ("GL acceleration").

**Fix direction**: change `classified` to NOT depend on `centerLat/centerLng` for tier/explored calculation (only `distanceM` needs them). Split: keep `tier + isExplored` memo on `[markers, geometryVersion, ownIds]` only; compute `distanceM` separately for the `visible` filter. `featureCollection` then only changes when markers / explored set / ownIds change.

---

## B6 — [CRITICAL] PointAnnotation fallback path is **untested** and uses different layout primitives than SymbolLayer path

**File**: `CairnPinsLayer.tsx:277-322` (fallback path).

**Issue**: 
- The "modern" path uses sprite + bottom anchor.
- The fallback path wraps `<CairnPinV10>` directly inside `<PointAnnotation>`.
- `<PointAnnotation>` on iOS anchors child View by its **center** by default.
- `<CairnPinV10>` uses `position: 'absolute'` internally with `view.height = visibleHeight`.

Result: the two paths anchor pins to DIFFERENT coordinate semantics. If a user lands on the fallback path (stale binary, SymbolLayer absent), pins jump ~half-height up vs. the SymbolLayer path. If both paths exist in two different sessions of the same user, this is confusing.

Beyond that: PointAnnotation on iOS has a long-documented bug with `position: 'absolute'` children — the iOS native view sizing can return `(0,0)` for the wrapping CALayer, clipping the entire pin. v382 may have hit this before the team moved to SymbolLayer; the fallback re-introduces the risk.

**Why Critical**: in nominal SymbolLayer-available case, this path never runs. But "stale binary" is exactly the situation OTA push needs to handle — if a user is on an older native binary without SymbolLayer support, this fallback runs in production with no real-device testing. The plan's "pure OTA" claim assumes this fallback works, but the diff did not exercise it.

---

## B7 — [CRITICAL] Cyclic import: `CairnPinV10.tsx` imports `Tier` from `CairnPinsLayer`, and `CairnPinsLayer` imports `CairnPinV10` from `CairnPinV10`

**Files**: `CairnPinV10.tsx:36` (`import type { Tier } from './CairnPinsLayer'`), `CairnPinsLayer.tsx:39` (`import { CairnPinV10, MysteryPinV10, StrangerBlurredPinV10 } from './CairnPinV10'`).

**Issue**: This is a circular import. `import type` is partially safe in TypeScript because type-only imports are erased at runtime — Babel/Metro will not emit a runtime `require` cycle. **BUT**: if any transform pipeline (e.g. a future tooling change, a stricter `isolatedModules`, a non-Babel TS compiler) emits a value import instead, the cycle becomes a runtime hazard: `CairnPinV10` could see `Tier === undefined` at module-init time.

More importantly: `CairnPinsLayer.tsx:332` does `export { CairnPinV10 as CairnPin } from './CairnPinV10';` — this is a re-export. `MarkerDetailScreen.tsx:45` imports `CairnPin` from `CairnPinsLayer`. So MarkerDetailScreen pulls in the ENTIRE `CairnPinsLayer` module (including the SymbolLayer code, MysteryCairnSheet, RevealedCairnSheet, getMapbox, store hooks…) just to get the pin component. That's a sizeable hidden cost on every detail page navigation.

**Why Critical**: design smell + tree-shaking risk + future-tooling fragility. Easy fix: extract `Tier` type to a small types file (`./types.ts` or inline in `CairnPinV10.tsx`).

---

## B8 — [MEDIUM] `PinSize` type is exported from `CairnPinV10` but not re-exported from `CairnPinsLayer`

**Files**: `CairnPinV10.tsx:61` (`export type PinSize = ...`), `CairnPinsLayer.tsx:332` (re-exports `CairnPinV10` but not `PinSize`), `MarkerDetailScreen.tsx:45` (`import { CairnPin, resolveTier } from '../features/memory/components/CairnPinsLayer'`).

**Issue**: MarkerDetailScreen uses `size="detail"` as a string literal (line 227). TypeScript will accept this because `size` prop type is `PinSize = "memory" | "detail"` and a string literal narrowing works. So no compile error.

BUT — if any consumer wants `PinSize` as a parameter type (`function renderPin(s: PinSize)`), they'd have to import from `./CairnPinV10` directly, bypassing the boundary that `CairnPinsLayer.tsx:332` set up. The re-export is incomplete.

**Why Medium**: cosmetic, fixable later. Could be: `CairnPinsLayer.tsx` adds `export type { PinSize } from './CairnPinV10';`

---

## B9 — [MEDIUM] zoom 11 iconSize 0.3 yields ~16px pin → below iOS 44pt min tap target, but `zoom<13` tap-suppression is missing

**File**: `CairnPinsLayer.tsx:214-220` (iconSize interpolation), `:146-158` (onSymbolPress).

**Issue**: Plan `final2` §C6 reportedly states "zoom<13 禁 tap" but the implementation has `iconAllowOverlap: true, iconIgnorePlacement: true` and an unguarded `onSymbolPress`. At zoom 11 the pin renders at 52×72 × 0.3 = 15.6×21.6 device-pixels. Apple's iOS HIG hard-min is 44pt × 44pt for tap targets; Mapbox forwards the tap regardless. If the user happens to tap-hit a tiny pin while zoomed out, they'll trigger MysteryCairnSheet / RevealedCairnSheet from a state where they didn't see a clear pin — UX confusion.

**Why Medium**: not a correctness bug, but a deliberate spec from the plan is unimplemented. Should either implement the zoom guard inside `onSymbolPress` (`if (currentZoom < 13) return;` — needs camera ref to read zoom), or use a Mapbox style expression `iconAllowOverlap` driven by zoom, OR document in the diff that the plan §C6 is intentionally deferred.

---

## B10 — [MEDIUM] `position: 'absolute'` multi-layer CairnPinV10 — sprite rasterisation may clip negative-coord layers

**File**: `CairnPinV10.tsx:230-307`.

**Issue**: When `<Mapbox.Image>` rasterises the child View tree to a bitmap (B1's mechanism), it does so by measuring the wrapping View's intrinsic size and rendering at that size. The wrapping View at line 230 declares `width: f.width, height: f.height` — and `f.height = visibleHeight = (crestH − crestOverlap) + core + 4`.

For `size="memory"`: visibleHeight = 10 + 44 + 4 = 58. All absolute children sit within `[0, 0]` to `[width, 58]`. Crest top = 0, crest height = 16 — top is at y=0, bottom at y=16. Core top = 10, height = 44 → bottom at y=54. Dark-stage extends to y=55 with the `top: coreTop - 1` offset. Total used range: y = 0 to 55, fits within 58.

Width: crestLeft = (width − 20)/2 = (52−20)/2 = 16; crest at x=16..36. coreLeft = (width − 44)/2 = 4; core at x=4..48. Dark stage at x=3..49 (with `coreLeft − 1` offset). All within width=52. Good.

**Potential clip risk**: the iOS feDropShadow filter (if it worked) requests `x="-50%" y="-50%" width="200%" height="200%"` — i.e. the filter primitive region extends OUTSIDE the SVG viewBox. react-native-svg-on-iOS would clip filter overflow at the SVG element bounds (`width={f.crestW}`, `height={f.crestH}` = 20 × 16). The crest's intended glow extends ~4px outside the SVG bounds per `drop-shadow(0 0 4px)`. **The glow would be clipped even if feDropShadow worked**.

Then when `<Mapbox.Image>` rasterises the entire pin View tree at width=52, height=58 — any glow that extended past x=−4 or y=−4 (outside the parent View frame) is lost. v10 HTML doesn't have this clipping because CSS `filter: drop-shadow` creates a layered render that respects the document compositor; React Native's offscreen rasterisation respects the View bounds.

**Why Medium not Critical**: combined with B2 (feDropShadow doesn't work anyway on iOS), this is moot for the current diff. But if B2 is fixed, B10 becomes the next blocker.

**Fix direction**: pad `f.width` and `f.height` (and shift all `top`/`left` values) by ~6px to leave room for glow bleed. Mapbox.Image will then rasterise at a larger size; `iconAnchor` math (B3) needs to compensate.

---

## Summary of Concrete Fixes Required Before OTA

| # | Severity | Required Action |
|---|----------|-----------------|
| B1 | Blocker | Verify on real device whether sprite registration completes before SymbolLayer first paint. If not — add pre-warm OR onImageMissing retry. |
| B2 | Blocker | Drop `<feDropShadow>` path. Use the Android "doubled crest" approach on iOS too. Document in code that v10 HTML's CSS drop-shadow is not portable to react-native-svg, this is a deliberate approximation. |
| B3 | Blocker | Change `iconAnchor` to `'center'` OR keep `'bottom'` but add `iconOffset` to put core center on coordinate. Either way, document semantics. |
| B4 | Critical | Add runtime guard: if marker.type ∉ TYPES, log warning and don't include in featureCollection (rather than silent coalesce-to-cairn). |
| B5 | Critical | Split `classified` memo into tier/explored (deps: markers + geometryVersion + ownIds) and distance (deps: + centerLat/centerLng). featureCollection should not re-derive on camera pan. |
| B6 | Critical | Either (a) remove the PointAnnotation fallback entirely and let stale binaries show no pins (with clear error log), or (b) test the fallback path on a real stale binary. Current "untested fallback" is a hidden production risk. |
| B7 | Critical | Move `Tier` type to a separate file. Eliminate the circular import. |
| B8 | Medium | Re-export `PinSize` from CairnPinsLayer. |
| B9 | Medium | Implement plan §C6's zoom<13 tap suppression OR document deferral. |
| B10 | Medium | Pad pin frame for glow bleed (after B2 is resolved). |

## What I Did NOT Audit

- Test coverage (no test changes were in the diff scope provided).
- Pin tier resolution correctness against authoritative tier rules (the code at `resolveTier` looks reasonable but its callers were not in scope).
- `mapboxAdapter.web.tsx` (only `.ts` adapter was in scope; web path has its own SymbolLayer shim that was not provided).
- Memory layer's `geometryVersion` reactivity (assumed correct from v382 baseline).

---

**Reviewer B confidence**: HIGH on B1, B2, B3, B7 (all directly evidenced by source). MEDIUM on B5, B6 (require runtime profile to confirm severity). Recommend NEEDS_FIX → resolve at least B1, B2, B3 before OTA push.
