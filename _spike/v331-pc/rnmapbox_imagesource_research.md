# rnmapbox ImageSource for Cairn Fog Mask

**Spike date**: 2026-06-25
**Goal**: Determine whether `@rnmapbox/maps` ImageSource + RasterLayer is a viable path for Cairn's fog-of-war mask (replacement for the GeoJSON polygon approach that hits geojson-vt/earcut bugs).

---

## Current Cairn rnmapbox Version

`@rnmapbox/maps`: **`10.3.1`** (verified in `app/package.json` declared `^10.3.1`, lock-file resolved `10.3.1`).

> NOTE: the spike brief asked about 11.x, but Cairn is on 10.3.1. All findings below are confirmed against the **10.3.1 source on disk** (`app/node_modules/@rnmapbox/maps/src/...`). Where 11.x differs, it's flagged.

---

## ImageSource API (v10.3.1, verified from source)

Source files inspected:
- `src/components/ImageSource.tsx`
- `ios/RNMBX/RNMBXImageSource.swift`
- `android/.../sources/RNMBXImageSource.kt`
- `src/utils/index.ts` (`resolveImagePath`)

### Props

| Prop | Type | Required | Notes |
|------|------|----------|-------|
| `id` | `string` | yes | Unique source id |
| `existing` | `boolean` | no | Reference an already-added source |
| `url` | `number \| string` | no (but render returns `null` if missing) | See URL scheme support below |
| `coordinates` | `[Position, Position, Position, Position]` | no (render returns `null` if missing) | **Quad: top-left, top-right, bottom-right, bottom-left** (4 corners, NOT bbox) |
| `children` | `React.ReactElement \| React.ReactElement[]` | no | Typically a `<RasterLayer>` |

### `coordinates` format — confirmed

From `ImageSource.tsx:37`:
```ts
coordinates?: [Position, Position, Position, Position];   // type Position = [number, number]
```
Order is **TL, TR, BR, BL** (Mapbox convention — same as `Style Spec image source`). NOT the question's `NW/NE/SE/SW` order — they're the same corners, just check that the array order is TL→TR→BR→BL.

### `url` — what schemes work, what doesn't

**iOS (`RNMBXImageSource.swift`)**: passes `url` string straight to Mapbox iOS SDK's `ImageSource.url`. Whatever Mapbox iOS accepts goes through. Mapbox iOS SDK accepts `http(s)://`, `file://`, and asset bundle paths. **`data:` URI support is not documented and unreliable** — Mapbox uses its own image loader.

**Android (`RNMBXImageSource.kt:35-53`)** — this is where it falls apart:
```kotlin
fun setURL(url: String?) {
    try {
        val uri = Uri.parse(url)
        if (uri.scheme == null) {
            // try local drawable resource
        } else {
            mURL = URL(url)              // ← java.net.URL constructor
            ...
        }
    } catch (e: Exception) {
        Log.w(LOG_TAG, e.localizedMessage)   // ← SILENT swallow
    }
}
```

`java.net.URL` does **not** understand `data:` — it throws `MalformedURLException`, which is caught and silently logged. **Conclusion: base64 `data:image/png;base64,...` will not work on Android in v10.3.1.** (And it would be a 1MB+ string crossing the JS↔native bridge — bad even if it did work.)

### How to deliver dynamic PNG bytes — `file://` URI is the only portable option

The viable pipeline:
1. Build PNG bytes on JS side (Skia / canvas / pngjs).
2. Write to a temp file via `expo-file-system` (or `react-native-fs`): `${cacheDir}/fog/fog-${revision}.png`.
3. Set `url={`file://${path}`}` on `<ImageSource>`.
4. To trigger a re-load, **change the filename** (append a revision counter). Same filename will be cached by Mapbox's image loader and not re-fetch.

### Dynamic update — props change DOES trigger native update

This is the most important finding. **Issue #1013 (2020) is NOT representative of v10.3.1 behavior.**

**iOS** (`RNMBXImageSource.swift:7-30`): both `url` and `coordinates` have Swift `didSet` observers that call `style.setSourceProperty(...)`. State change → React passes new prop → native setter fires → Mapbox style updates in place.

**Android** (`RNMBXImageSource.kt:55-63`): `setCoordinates` and `setURL` both update `mSource!!.coordinates(...)` / `mSource!!.url(...)` on the live source after creation.

**Verdict**: Both `url` and `coordinates` can be driven from React state in v10.3.1. No imperative `setNativeProps` needed. Same-filename URL caching is the only gotcha (use a revision suffix).

### Performance — bridge cost

- Setting `url` = sends a string across the bridge → small.
- Mapbox then loads the file from disk on the native thread → no JS stall.
- Setting `coordinates` = sends 8 doubles → trivial.
- The PNG itself never crosses the bridge if you use `file://`. **This is the key reason to avoid base64.**

Estimated cost per fog update (single 1024×1024 PNG):
- JS-side PNG encode: 50-200ms (depends on encoder)
- File write: 10-30ms
- Bridge call + native reload: 5-15ms
- Mapbox texture upload: 10-30ms on GPU

Total: ~80-275ms per update. Acceptable for visited-cell-change cadence (a few per minute), bad for every-GPS-tick (every 1-3s).

---

## RasterLayer (v10.3.1, verified from source)

Source: `src/components/RasterLayer.tsx`, `src/utils/MapboxStyles.d.ts` (style schema).

### Wiring to ImageSource

```tsx
<MapView>
  <ImageSource id="fog-mask" url={fileUri} coordinates={quad}>
    <RasterLayer id="fog-mask-layer" style={{ rasterOpacity: 1 }} />
  </ImageSource>
</MapView>
```

When `<RasterLayer>` is a child of `<ImageSource>`, the parent injects `sourceID` automatically (see `utils/index.ts cloneReactChildrenWithProps`). No explicit `sourceID` prop needed.

Alternative — sibling style:
```tsx
<ImageSource id="fog-mask" .../>
<RasterLayer id="fog-mask-layer" sourceID="fog-mask" style={{rasterOpacity: 1}} />
```

### Relevant style props (from `RasterLayer.md` doc + style schema)

| Prop | Default | Use for fog |
|------|---------|-------------|
| `rasterOpacity` | 1 | Set to 1 (fog should be opaque where covered). Expression-able by zoom if you want softer fog at close zoom. |
| `rasterOpacityTransition` | `{duration: 300, delay: 0}` | **Default 300ms cross-fade is what you want** — when `url` changes, the new image fades in over 300ms. Smooth visual transition for cell unveiling. |
| `rasterFadeDuration` | 0 | Time-between-tiles fade. For single ImageSource, leave at 0. |
| `rasterResampling` | `linear` | Use `nearest` if the mask is grid-aligned (no smoothing of pixel boundaries). |
| `rasterColor` | — | Could colorize a grayscale mask, but easier to just author the PNG with the right color. |
| `rasterBrightnessMin/Max`, `rasterContrast`, `rasterSaturation` | — | Not needed if PNG is authored correctly. |

### `style` JSON is required

Per `RasterLayer.tsx:84`: `style: RasterLayerStyleProps` is required (not optional). Always pass `style={...}`, even if empty `style={{}}`.

---

## Architecture Decision: Single Image vs Per-Tile

### Option A — Single ImageSource covering visible region

**How**:
- On `regionDidChangeDebounced`, read current `visibleBounds` from MapView.
- Pad by 50% margin so panning doesn't reveal unmasked edge immediately.
- Rasterize visited cells into a single PNG at fixed resolution (e.g. 1024×1024).
- Write to `${cache}/fog-{rev}.png`, set `<ImageSource url coordinates>` to the padded bbox quad.
- Re-rasterize on (a) cellVersion bump, (b) viewport changes outside the padded area.

**Pros**:
- Works with what rnmapbox v10.3.1 actually ships.
- One source, one layer, simple state.
- Mapbox handles scaling/rotation/skew of the georeferenced image automatically when user zooms/rotates.

**Cons**:
- Resolution is fixed. Zoom way in → blurry edges (linear resampling). `nearest` fixes pixel-grid look but emphasizes blockiness.
- At low zoom (continent view), the padded region is huge → resolution per cell is too coarse to even show 25m cells.
- Re-rasterize on every meaningful pan = expensive.
- Mapbox `rasterOpacityTransition` causes 300ms cross-fade — visible flash if filename changes too often.

### Option B — Per-tile ImageSource (Fog of World style)

**Verdict: NOT POSSIBLE in rnmapbox v10.3.1.**

- Fog of World uses Mapbox GL JS's `CanvasSource` — **does not exist in rnmapbox** (confirmed by listing `app/node_modules/@rnmapbox/maps/src/components/*Source*`: only `ImageSource`, `RasterSource`, `RasterDemSource`, `RasterArraySource`, `ShapeSource`, `VectorSource`).
- Mapbox iOS/Android native SDKs **do not expose CanvasSource at all** — it's a JS-only construct of mapbox-gl-js. Even forking rnmapbox wouldn't help; the native runtime lacks the primitive.
- Could try `RasterSource` with tile URL templates → would require running a **local HTTP tile server** in-process (e.g. expo-server, react-native-tcp-socket). Heavy, fragile, and Mapbox SDK aggressively caches by URL — invalidation is painful.

### Recommended: **Option A (Single Image) with adaptive resolution**

Concrete tuning:
- **Resolution**: 1024×1024 PNG.
- **Coverage padding**: 1.5× current viewport (in both X and Y).
- **Rebuild triggers**:
  - `cellVersion` bump (new cell visited).
  - User panned out of the padded region (debounced `onRegionDidChange`, 500ms).
  - User zoom level changed by ≥ 1 step.
- **Filename**: `fog-${revisionCounter}.png` — bump on every rebuild so Mapbox doesn't cache stale.
- **Cleanup**: delete `fog-{rev-2}.png` after `fog-{rev}.png` is mounted (keep N-1 around in case of flicker).
- **Anti-flash**: pre-write the next file before swapping `url` and `coordinates`. With Mapbox's 300ms `rasterOpacityTransition`, the swap is buttery if the file exists at swap time.

---

## Known Issues

| Issue URL | Title | Severity for Cairn |
|-----------|-------|---------------------|
| https://github.com/rnmapbox/maps/issues/1013 | ImageSource coordinates do not update | **NOT a blocker in v10.3.1** — verified in source (iOS `didSet` + Android `mSource!!.coordinates(...)`). The 2020 issue was on the predecessor `@react-native-mapbox-gl/maps`. Cited because the bug title scares engineers off; we should test, not trust the title. |
| `data:` URI on Android | (no formal issue — inferred from `RNMBXImageSource.kt:45` using `java.net.URL`) | **Hard blocker if you try base64.** Silently `Log.w`-ed and swallowed. Use `file://` only. |
| Same-URL caching (no formal issue, behavior of Mapbox native SDKs) | When `url` string is unchanged, Mapbox does not re-fetch even if the bytes at that path changed | **Workaround**: bump revision suffix in filename. Don't write into the same path twice. |

(Searches: GLM web search returned only Issue #1013 as directly relevant. Other GitHub queries blocked by enterprise network — see Sources.)

---

## Sample Code Pattern (mock — NOT for Cairn integration)

```jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapView, ImageSource, RasterLayer } from '@rnmapbox/maps';
import * as FileSystem from 'expo-file-system';

// Mock PNG builder — in reality, Skia or pngjs renders visited cells onto a canvas.
async function renderFogPng(visitedCells, bbox, width=1024, height=1024) {
  // ... draw alpha=255 black everywhere, alpha=0 where cell visited ...
  return base64PngString; // omit `data:image/png;base64,` prefix
}

function FogMaskLayer({ visitedCells, viewport }) {
  const [fogState, setFogState] = useState({
    uri: null,
    quad: null,        // [TL, TR, BR, BL]
  });
  const revRef = useRef(0);

  useEffect(() => {
    if (!viewport) return;
    let cancelled = false;

    (async () => {
      // 1. Pad viewport by 50% on each side.
      const bbox = padBbox(viewport.bbox, 0.5);

      // 2. Build PNG bytes.
      const base64 = await renderFogPng(visitedCells, bbox);

      // 3. Write to a NEW file (revision suffix — Mapbox caches by URL).
      const rev = ++revRef.current;
      const path = `${FileSystem.cacheDirectory}fog-${rev}.png`;
      await FileSystem.writeAsStringAsync(path, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (cancelled) return;

      // 4. Swap url + coordinates atomically.
      setFogState({
        uri: `file://${path}`,
        quad: [
          [bbox.west, bbox.north],   // TL
          [bbox.east, bbox.north],   // TR
          [bbox.east, bbox.south],   // BR
          [bbox.west, bbox.south],   // BL
        ],
      });

      // 5. Clean up rev-2 (keep rev-1 in case of flicker).
      if (rev > 2) {
        FileSystem.deleteAsync(
          `${FileSystem.cacheDirectory}fog-${rev - 2}.png`,
          { idempotent: true },
        ).catch(() => {});
      }
    })();

    return () => { cancelled = true; };
  }, [visitedCells, viewport]);

  if (!fogState.uri || !fogState.quad) return null;

  return (
    <ImageSource
      id="fog-mask"
      url={fogState.uri}
      coordinates={fogState.quad}
    >
      <RasterLayer
        id="fog-mask-layer"
        style={{
          rasterOpacity: 1,
          rasterResampling: 'nearest',  // crisp pixel grid; switch to 'linear' if you want feathered edges
          rasterOpacityTransition: { duration: 300, delay: 0 },
        }}
      />
    </ImageSource>
  );
}
```

Notes on the snippet:
- `revRef` ensures every write is a new filename — bypasses Mapbox URL caching.
- `viewport.bbox` is whatever you can read from rnmapbox's `MapView` ref (`getVisibleBounds()`); pad it before rasterizing.
- `coordinates` order is TL, TR, BR, BL — Mapbox's quad convention.
- Setting both `url` and `coordinates` in the same `setState` is fine — both `didSet` observers will fire, and Mapbox combines them on the next style commit.
- The 300ms `rasterOpacityTransition` is the visible cross-fade. Lower it to 150ms if it feels laggy; raise to 600ms if you want a "dreamier" unveil.

---

## Verdict

**GO-WITH-CAVEATS.**

The architecture is viable for Cairn's fog mask on v10.3.1. The previously feared "ImageSource coordinates do not update" bug is **resolved in this version** (confirmed by reading the iOS + Android native bridges in `node_modules/`).

Caveats (must accept all of these before committing):

1. **Single image only — no per-tile.** rnmapbox does not expose `CanvasSource`. Period. The architecture must rebuild a single PNG that covers a padded viewport. Per-tile fog (Fog of World's pattern) requires either (a) a fork of rnmapbox with new native code, or (b) a local tile-server hack — both out of scope.
2. **`file://` URIs only, never `data:` base64.** Android crashes silently on `data:`. Pipeline must write each PNG to disk first.
3. **Filename revision counter is non-negotiable.** Mapbox caches by URL. Reusing the same filename → stale texture stays on screen.
4. **Re-rasterize cost is JS-side (50-200ms per PNG encode at 1024²).** This must be off the UI thread (`InteractionManager.runAfterInteractions` at minimum; ideally a `react-native-skia` offscreen render which is hardware-accelerated).
5. **Resolution is fixed.** At extreme zoom-in, edges blur (linear) or pixelate (nearest). Acceptable trade-off; can be mitigated by re-rasterizing at higher resolution when zoom > N.
6. **The Cairn earcut/geojson-vt bug is sidestepped, but a new failure mode appears**: file system errors, async race conditions between rapid pan and slow PNG encode. Build with cancellation tokens (see snippet's `cancelled` flag).

If those caveats are acceptable: this is **strictly better** than the current GeoJSON-with-holes architecture because (a) no earcut tessellation, (b) no geojson-vt clipping, (c) no n-vertex polygon limit.

If a per-tile architecture is required (e.g. for memory or for matching Fog of World feature-for-feature exactly), this version of rnmapbox is **NO-GO** and the path forward is a rnmapbox fork or upgrading to v11 and re-evaluating.

---

## Sources

- `app/package.json` — declared version `^10.3.1`
- `app/package-lock.json` — resolved version `10.3.1`
- `app/node_modules/@rnmapbox/maps/src/components/ImageSource.tsx` — JS surface
- `app/node_modules/@rnmapbox/maps/src/components/RasterLayer.tsx` — JS surface
- `app/node_modules/@rnmapbox/maps/src/components/RasterSource.tsx` — alt path (rejected — needs tile server)
- `app/node_modules/@rnmapbox/maps/ios/RNMBX/RNMBXImageSource.swift` — iOS native bridge (confirms dynamic update works)
- `app/node_modules/@rnmapbox/maps/android/src/main/java/com/rnmapbox/rnmbx/components/styles/sources/RNMBXImageSource.kt` — Android native bridge (confirms `data:` URI broken; `file://` works; dynamic update works)
- `app/node_modules/@rnmapbox/maps/src/utils/index.ts` — `resolveImagePath` (only used for `require()`-style numeric resource refs)
- https://github.com/rnmapbox/maps/blob/main/docs/ImageSource.md — official doc (via context7)
- https://github.com/rnmapbox/maps/blob/main/docs/RasterLayer.md — official doc (via context7)
- https://github.com/rnmapbox/maps/issues/1013 — historical "coordinates do not update" report (2020, predecessor library)
