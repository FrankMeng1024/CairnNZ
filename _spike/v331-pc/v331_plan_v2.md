# v331 Implementation Plan v2 — Skia Raster Fog (Fog-of-World++ with game effects)

**Status**: Final — integrated all reviewer feedback. Ready for implementation.
**Goal**: Replace polygon-with-holes fog with hybrid architecture. Visual quality ≥ Fog of World + game-feel effects.

**Changes from v1**:
- Architecture A1 hybrid (2-layer): adds global FillLayer (world-rect-minus-circle) under Skia raster — fixes reviewer #2 BLOCKER 1 (no global fog)
- All 4 reviewer #1 blockers fixed (expo-file-system/legacy, rasterOpacityTransition, Skia.Surface.Make, single ImageSource cross-fade)
- Cream halo ON by default (reviewer #2 BLOCKER 3)
- F3v2 PNG proven with blur+halo (reviewer #2 BLOCKER 2)

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────┐
│ Mapbox Outdoors basemap (unchanged)                  │
└─────────────────────────────────────────────────────┘
          ↑ below labels (use slot="middle" or belowLayerID)
┌─────────────────────────────────────────────────────┐
│ L1 — FillLayer over "world-rect minus 1 circle"     │
│      GeoJSON polygon                                │
│  - Outer ring: world bbox 5 verts                   │
│  - Inner ring: 32-segment circle around user        │
│  - Total: 38 vertices (safe for earcut)             │
│  - fill-color: rgba(58,42,24,0.66)                  │
│  - fill-antialias: true                             │
│  - Updates on cellVersion + pan (debounced 500ms)   │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ L2 — ImageSource + RasterLayer (Skia PNG)           │
│  - Padded bbox: 6km square (centered on user)       │
│  - PNG content:                                     │
│    * cleared cells → fully transparent              │
│    * cream halo (cell-boundary rim) → opaque cream  │
│    * Everywhere else inside bbox → transparent      │
│  - L1 polygon's inner-circle radius = 4.2km         │
│    (bbox padding × 1.4) so L1 hole > L2 bbox        │
│  - raster-opacity: 1                                │
│  - raster-opacity-transition: 300ms (NOT fade)      │
│  - Sits ABOVE L1; provides per-cell precision       │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ L3 — MemoryFogBurstOverlay (already in Cairn)       │
│   Skia golden ring pulse on cell reveal             │
└─────────────────────────────────────────────────────┘
```

**Why this works**:
- L1 = whole world covered in fog. 38-vertex polygon is well below earcut bug threshold (bug emerges with 1000+ inner rings)
- L2 = per-cell precision + cream halo + feathered edges. Single image, no polygon math.
- L3 = game-feel pulse (unchanged from v303-v324)

**Validated on PC (F4 spike)**: world-minus-circle polygon renders clean at z=2..18.

---

## 2. Files

### New
- `app/src/features/memory/services/fogMaskRenderer.ts` — Skia render + cache + revision
- `app/src/features/memory/services/fogFloorGeometry.ts` — `worldRectMinusCircle(lat, lng, radiusM, segments)` GeoJSON helper
- `app/src/features/memory/services/fogMaskCache.ts` — cacheDirectory file lifecycle (delete stale revs)

### Modified
- `app/src/features/memory/components/FogLayer.tsx` — full rewrite:
  - Remove old ShapeSource+FillLayer+LineLayer (polygon-with-holes path)
  - Add L1 ShapeSource+FillLayer (world-minus-circle)
  - Add L2 ImageSource+RasterLayer (Skia mask)
- `app/src/components/OtaBadge.tsx` — `OTA_VERSION = 331`

### Kept (unchanged)
- `useH3VisitedStore.ts`, `useMemoryStore.ts`, `unlockEngine.ts`, `h3Pure.ts`, `memoryConfig.ts`, `MemoryFogBurstOverlay.tsx`

### Dead after v331 (delete in v332 cleanup, not v331)
- `services/globalFogBuilder.ts`

---

## 3. fogMaskRenderer.ts — implementation contract

### Imports (Reviewer #1 BLOCKER #1)
```ts
import { Skia, BlendMode, ImageFormat, TileMode } from '@shopify/react-native-skia';
// MUST use /legacy subpath — default import throws at runtime in expo-file-system v19
// (Cairn already uses this pattern in src/services/debugLogger.ts)
import * as FileSystem from 'expo-file-system/legacy';
```

### Surface choice (Reviewer #1 BLOCKER #3)
```ts
// Use CPU-backed Surface.Make — callable from JS thread, no worklet needed.
// MakeOffscreen is GPU-backed but requires runOnUI worklet context per Shopify docs.
const surface = Skia.Surface.Make(MASK_SIZE, MASK_SIZE);
if (!surface) throw new Error('Skia surface alloc failed');
```

### Render algorithm
```ts
interface RenderInput {
  centerLat: number;
  centerLng: number;
  paddingMeters: number;     // half-side of bbox; default 3000
  cells: Map<string, VisitedCell>;
  revision: number;
}

async function renderMask(input: RenderInput): Promise<{ uri: string; corners: Quad }> {
  const MASK_SIZE = 1024;
  const BLUR_SIGMA = 5;
  const surface = Skia.Surface.Make(MASK_SIZE, MASK_SIZE);

  const canvas = surface.getCanvas();
  // Step 1: build alpha mask on a Path or via clearRect-loop
  //   Start with full opaque "haloable area" (will become fog rim)
  //   For each cell: drawRect with BlendMode.Clear to punch
  //   Then derive cream halo from the gradient

  // Simpler approach: render in 2 passes onto 2 surfaces, composite at end.
  // For v331 implementation, the actual Skia paint code is in the source file.
  // See gen_F3v2_mask.py in _spike for PIL-reference algorithm (port to Skia).

  const image = surface.makeImageSnapshot();
  // Reviewer #1 improvement: use encodeToBase64 directly (skips Hermes Buffer)
  const base64 = image.encodeToBase64(ImageFormat.PNG, 100);

  const filename = `fog-rev${input.revision}.png`;
  const path = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    uri: `file://${path.replace('file://', '')}`,
    corners: computeBboxCorners(input.centerLat, input.centerLng, input.paddingMeters),
  };
}
```

### Cleanup
- After successful `setMaskUri(newUri)`, wait 800ms (longer than rasterOpacityTransition of 300ms), then delete `fog-rev{N-1}.png`
- App startup: delete all `fog-rev*.png` from cacheDirectory
- Use AbortController-like cancellation token so in-flight render N gets aborted if render N+1 starts (Reviewer #1 concern)

### Performance budget
- Skia Surface.Make: <5ms
- drawRect loop (1281 cells): ~5-15ms
- Gaussian blur via ImageFilter.MakeBlur on a saveLayer paint: ~5-10ms
- makeImageSnapshot + encodeToBase64: ~30-50ms (synchronous, runs on JS thread)
- writeAsStringAsync: ~20-40ms (async, off JS thread)
- **Total per mask render: ~60-120ms**, debounced 500ms is plenty of headroom

---

## 4. fogFloorGeometry.ts

```ts
export interface Quad { nw: [number,number]; ne: [number,number]; se: [number,number]; sw: [number,number]; }

export function worldRectMinusCircle(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  segments: number = 32,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const M_PER_DEG_LAT = 111320;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);

  // Outer ring CCW: world rect
  const outer: number[][] = [
    [-179.9, -85], [179.9, -85], [179.9, 85], [-179.9, 85], [-179.9, -85],
  ];

  // Inner ring CW: 32 segments around user
  const inner: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    // CW: negate angle
    const dx_m = radiusMeters * Math.cos(-angle);
    const dy_m = radiusMeters * Math.sin(-angle);
    const lat = centerLat + dy_m / M_PER_DEG_LAT;
    const lng = centerLng + dx_m / (M_PER_DEG_LAT * Math.max(cosLat, 1e-6));
    inner.push([lng, lat]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [outer, inner] },
  };
}
```

---

## 5. FogLayer.tsx rewrite

```tsx
import { ShapeSource, FillLayer, ImageSource, RasterLayer } from '@rnmapbox/maps';
import { MemoryColors } from '../config/memoryConfig';
import { useH3VisitedStore } from '../store/useH3VisitedStore';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { worldRectMinusCircle } from '../services/fogFloorGeometry';
import { fogMaskRenderer } from '../services/fogMaskRenderer';

export function FogLayer({ userCenter }: { userCenter: { lat: number, lng: number } | null }) {
  const cellVersion = useH3VisitedStore(s => s.cellVersion);
  const useH3Fog = useMemorySettingsStore(s => s.useH3Fog);

  // L1: world minus circle geometry
  const fogFloor = useMemo(() => {
    if (!userCenter) return null;
    return worldRectMinusCircle(
      userCenter.lat, userCenter.lng,
      4200,   // 4.2km — 1.4× L2 padding
      32,
    );
  }, [userCenter?.lat, userCenter?.lng]);

  // L2: Skia raster mask
  const [mask, setMask] = useState<{ uri: string; corners: Quad } | null>(null);
  useEffect(() => {
    if (!userCenter) return;
    const cells = useH3VisitedStore.getState().cells;
    fogMaskRenderer.renderMask({
      centerLat: userCenter.lat,
      centerLng: userCenter.lng,
      paddingMeters: 3000,
      cells,
      revision: Date.now(),
    }).then(setMask).catch(e => log('fog.mask_render_error', { error: e.message }));
  }, [cellVersion, userCenter?.lat, userCenter?.lng]);

  if (!useH3Fog) return null;
  if (!fogFloor) return null;

  return (
    <>
      <ShapeSource id="fog-floor-src" shape={fogFloor}>
        <FillLayer
          id="fog-floor"
          style={{
            fillColor: 'rgba(58, 42, 24, 0.66)',
            fillOpacity: 1,
            fillAntialias: true,
          }}
          // Below labels — keep map readable
          belowLayerID="settlement-subdivision-label"
        />
      </ShapeSource>

      {mask && (
        <ImageSource
          id="fog-mask-src"
          url={mask.uri}
          coordinates={[
            mask.corners.nw, mask.corners.ne, mask.corners.se, mask.corners.sw,
          ]}
        >
          <RasterLayer
            id="fog-mask"
            style={{
              rasterOpacity: 1,
              // Reviewer #1 BLOCKER #2: use rasterOpacityTransition not rasterFadeDuration
              rasterOpacityTransition: { duration: 300, delay: 0 },
            }}
            belowLayerID="settlement-subdivision-label"
          />
        </ImageSource>
      )}
    </>
  );
}
```

---

## 6. Game-feel effects

| Effect | Source | Implementation |
|---|---|---|
| Cream halo at cell boundary | Skia in PNG (always on) | Step in renderMask: derive halo from blurred mask gradient |
| Soft feathered edge | Skia ImageFilter.MakeBlur sigma=5 | Applied to alpha channel |
| New-cell fade-in | Mapbox `rasterOpacityTransition` 300ms | Automatic when URL/coordinates change |
| Golden ring pulse on reveal | `MemoryFogBurstOverlay.tsx` (existing) | Unchanged |

**Deferred to v332** (per reviewer #2 nice-to-have):
- Far-fog cloud-noise texture at z≤11
- Edge shimmer (oscillating blur)
- Sparkle particles on new cells
- First-time-here hint pulse

---

## 7. Edge cases

| Case | Expected | Verification |
|---|---|---|
| No cells visited | L1 fills world; L2 mask transparent | Unit test in fogMaskRenderer |
| 1 cell | Single soft punch with cream halo | Dev client |
| 1281 cells (initial 500m reveal) | Smooth round clear, no banding | Dev client + screenshot |
| 10000+ cells | Render ≤ 200ms | Synthetic state injection |
| Pan within padding | No re-render, raster scales smoothly | Walk test |
| Pan beyond 50% padding | Re-render at new center, 300ms fade | Walk test |
| Zoom in to z=18 | Soft edges (blur ratio acceptable) | Dev client |
| Zoom out to z=8 | L1 covers everything; L2 effectively invisible | Dev client |
| Zoom out to z=2 (globe) | L1 covers world; reveal disappears | F4 spike confirmed |
| Suspend → resume | Mask file may be purged by iOS; re-render on focus | Dev client + force-quit test |
| Memory tab off → on | Re-render once on focus if cellVersion changed | Dev client |
| Cross-meridian (latitude > 60°) | Polygon may distort | Deferred to v332 |

---

## 8. Verification plan

### PC (already done)
- ✅ F1: current polygon path breaks at z≤12
- ✅ F3: raster path clean z=8..18
- ✅ F3v2: blur+halo produces target visual quality
- ✅ F4: L1 world-minus-circle renders clean at z=2..18

### Dev client real device (mandatory before OTA)
1. `npx expo start --dev-client` on user's iPhone
2. Test scenarios:
   - a) Fresh app launch in unvisited area → initial 500m reveal → screenshot at z=10, 12, 14, 16, 18
   - b) Walk 100m → cellVersion bumps → fog updates smoothly (no flicker)
   - c) Zoom out to z=8 → confirm whole-city fog visible
   - d) Zoom in to z=18 → check cream halo + soft edge quality
   - e) Force-quit app → reopen → fog reloads correctly
   - f) Memory tab off (switch to Cairn tab) → back on → fog still shows
3. Save screenshots to `_diag/v331-test/` and compare to F1 v330 reference (snap-190.png)
4. **MUST show**: no checkerboard, no banding, fog visible at every zoom, edges soft, cream halo visible
5. **MUST NOT exceed**: 200ms render time on iPhone X-class (measure via log)

### Android dev test (reviewer #1 concern)
- If iOS passes, test Android via Expo dev client on emulator at minimum
- Confirm file:// path loads (Android wraps in java.net.URL — known caveat)

### Code review
- 2 independent subagents review v331 implementation
- Each must identify ≥1 issue OR explicitly approve

---

## 9. OTA staging

| Stage | Action |
|---|---|
| 1 | Implement v331 code (current step) |
| 2 | 2-subagent code review → fix issues |
| 3 | Dev client iOS real-device test → screenshots |
| 4 | Dev client Android test |
| 5 | Bump OTA_VERSION=331 → eas update |
| 6 | git commit + push origin master |
| 7 | User cold-starts app twice → verify v331 in OtaBadge |

---

## 10. Rollback plan

Add `useRasterFog: boolean` to `useMemorySettingsStore` (default `true`).
If v331 fails on production, push v331.1 OTA that sets default to `false` → falls back to v330 polygon (broken but known state).

---

## 11. Risk register (consolidated)

| Risk | Mitigation |
|---|---|
| L1 polygon antimeridian artifact (lat>60°) | Defer to v332 |
| L2 raster jitter on rapid pan | rasterOpacityTransition 300ms; debounce pan trigger 500ms |
| Skia Surface.Make returns null | Throw + log + fallback to no fog (no checkerboard regression) |
| expo-file-system v19 import wrong | Use `/legacy` subpath (Cairn pattern) |
| Android `file://` rejected by URL parser | Spike confirmed file:// works; test in dev client |
| 10000+ cells render >200ms | Profile; if needed, drop to 768×768 mask |
| Mask cache file purged by iOS | Re-render on focus if cellVersion changed |
| Cream halo too prominent / too subtle | Tune in dev client; not blocking initial ship |
| Race: stale render N completes after N+1 starts | AbortController-style cancellation token |
| z=18 too blurry due to upscale | Tune blur sigma; accept "soft Zelda" aesthetic |

---

## 12. Out-of-scope for v331 (explicit)

- Per-tile rendering (not viable in rnmapbox 10.3.1)
- Server-side MVT generation
- Custom shader / deck.gl integration
- Antimeridian polygon fix
- Latent dLng per-row encoding bug (Task #18)
- Far-fog cloud-noise (v332)
- Edge shimmer (v332)
- Sparkle particles (v332)
- High-latitude (>60°) test coverage

---

## 13. Success criteria

**v331 ships when ALL true**:
- ✅ Dev client iOS: no checkerboard at z=10..18 on real device
- ✅ Dev client iOS: fog visible at all zooms (including z=8)
- ✅ Dev client iOS: cream halo visible around cleared area
- ✅ Render time ≤ 200ms per mask on iPhone X-class
- ✅ Code review: 2 subagents approve OR identified issues fixed
- ✅ User reviews screenshots → approves OTA

---

**End of plan v2. Ready to begin implementation (Step 27).**
