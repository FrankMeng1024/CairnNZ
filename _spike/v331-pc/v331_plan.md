# v331 Implementation Plan — Skia Raster Fog (Fog-of-World++ with game effects)

**Status**: Plan draft (pending 2-subagent review before implementation)
**Goal**: Replace polygon-with-holes fog with Skia-rendered PNG raster; visual quality at minimum equal to **Fog of World**, with **game-feel** soft fog + reveal effects.

---

## 1. Reference baseline

### What "match Fog of World" means
- Whole map is **dark fog overlay** (semi-transparent)
- User-visited cells appear as **soft-edged transparent areas** (not sharp 25m squares)
- Edges have a **feathered halo** (cream / lighter color blending into the dark fog)
- Edges look hand-drawn, not pixelated/jagged
- **No artifacts at any zoom level**

### Game-feel additions Cairn should have on top
- Newly-unlocked cells **fade in over 600-800 ms** (alpha animation on the mask)
- Optional: subtle **edge shimmer** on the fog boundary (oscillating blur radius / opacity)
- Optional: when a new cell is revealed, a brief **golden ring pulse** at that cell (Cairn already has `MemoryFogBurstOverlay.tsx` using Skia for this — keep it, integrate)

---

## 2. Architecture decisions (locked by spike evidence)

| Decision | Choice | Why |
|---|---|---|
| Render engine | **Mapbox (rnmapbox 10.3.1)** unchanged | iOS+Android native, already shipped |
| Fog representation | **PNG raster** (NOT polygon) | F1 spike proved polygon breaks at z≤12; F3 spike proved raster clean z=8..18 |
| Image generator | **`@shopify/react-native-skia` 2.2.12** | Already in deps, GPU-accelerated, headless surface API exists |
| Image transport | **`expo-file-system` cacheDirectory** + `file://` URI | rnmapbox 10.3.1 Android rejects `data:` URI (spike confirmed) |
| Source type | **single `<ImageSource>`** covering padded viewport | rnmapbox 10.3.1 has no `CanvasSource`; per-tile not viable |
| Layer | **`<RasterLayer>` rasterOpacity=1 rasterFadeDuration=300** | 300ms fade gives free cross-fade when mask rev bumps |
| Update trigger | `cellVersion` (debounced 500ms) + viewport pan beyond padding | Avoids redrawing every cell add |

---

## 3. Data flow

```
GPS reading
  ↓
useMemoryStore.recordPoint + useH3VisitedStore.addPointToCells   [UNCHANGED]
  ↓
cellVersion ticks
  ↓ (debounced 500ms)
fogMaskRenderer.renderMask({ centerLat, centerLng, paddingMeters, cells })
  ↓
Skia.Surface.MakeOffscreen(1024, 1024)
  drawRect(0,0,1024,1024, fogOverlayPaint)   // dark sepia 58% alpha
  for cell in cellsInViewport:
    drawRect(cellRectPx, clearPaint with BlendMode.Clear)   // punch hole
  apply ImageFilter.MakeBlur(sigma=3) on alpha channel        // soft edge
  optional: draw cream halo stroke at fog/clear boundary       // Fog of World cream rim
  ↓
surface.makeImageSnapshot().encodeToBytes()  → Uint8Array PNG
  ↓
expo-file-system.writeAsStringAsync(`${cacheDir}/fog-rev${N}.png`, base64(bytes), { encoding: Base64 })
  ↓
setMaskUri(`file://${cacheDir}/fog-rev${N}.png`)
  ↓
<ImageSource id="fog-mask" url={maskUri} coordinates={padded corners} />
<RasterLayer source="fog-mask" paint={{ rasterOpacity:1, rasterFadeDuration:300 }} />
```

---

## 4. Files

### New
- `app/src/features/memory/services/fogMaskRenderer.ts` — Skia render + cache + revision
- `app/src/features/memory/services/fogMaskCache.ts` — manages cacheDirectory file lifecycle (delete old revisions)

### Modified
- `app/src/features/memory/components/FogLayer.tsx` — replace ShapeSource+FillLayer+LineLayer with ImageSource+RasterLayer; subscribe to mask uri + viewport
- `app/src/features/memory/components/MemoryMap.tsx` — pass camera center + bounds to FogLayer (already does via map_idle)
- `app/src/components/OtaBadge.tsx` — bump `OTA_VERSION = 331`

### Kept (no change)
- `useH3VisitedStore.ts`, `useMemoryStore.ts`, `unlockEngine.ts`, `h3Pure.ts`, `memoryConfig.ts`

### Dead after v331 (delete in v332 cleanup)
- `services/globalFogBuilder.ts`
- `lib/h3Pure.ts::cellsToMultiPolygon` (still used by nothing post-v329)

---

## 5. Algorithm details — fogMaskRenderer.renderMask

### Inputs
```ts
type RenderInput = {
  centerLat: number;       // user position or viewport center
  centerLng: number;
  paddingMeters: number;   // half-extent in meters (e.g. 1500m → 3km square mask)
  cells: Map<cellID, VisitedCell>;
  newlyAdded: Set<cellID>; // cells added since last render (for golden pulse)
};
```

### Steps
1. Compute world bounds of mask (centerLat ± paddingMeters/M_PER_DEG_LAT, etc.)
2. Determine pixel scale = mask_size / (2 * paddingMeters). E.g. 1024 / 3000m ≈ 0.34 px/m → each 25m cell ≈ 8.5 px. Adequate for visual quality.
3. Skia.Surface.MakeOffscreen(1024, 1024)
4. canvas.drawRect(full, paintFogOverlay):
   - color = `rgba(58, 42, 24, 0.66)` (slightly darker than v330's 0.58 for stronger contrast)
5. for (ix, iy) in cells:
   - convert to mask-local meters → pixel
   - skip if outside mask bounds
   - drawRect(cellPxRect, paintClear) where paintClear has `blendMode: BlendMode.Clear`
6. Apply Gaussian blur to the alpha channel to soften edges:
   - Make second surface, draw the first surface with `ImageFilter.MakeBlur(3, 3, TileMode.Clamp)`
7. Draw cream halo (game effect) at fog boundary:
   - For each cell boundary edge that borders an unvisited cell, draw a thin cream stroke
   - OR (simpler): re-render with `BlendMode.SrcOver` a slightly inset version with cream color and lower opacity → gives a 2-3 px cream rim around the cleared area
8. snapshot → encodeToBytes (PNG) → base64 → writeAsStringAsync

### Performance budget
- 1024×1024 Skia surface render: ~6-15 ms (per spike)
- PNG encode: ~20-50 ms
- File write: ~20 ms
- Total per mask: ~50-100 ms — fine for debounced updates

### Revision management
- Keep counter `revN`
- Each render writes `fog-rev{N}.png`
- After successful `setMaskUri`, delete `fog-rev{N-1}.png` (with 500ms delay for fade-in safety)
- App startup: clear all `fog-rev*.png` from cache

---

## 6. Viewport padding strategy

Single-image approach (no per-tile). Mask covers a padded square around current view.

| State | Action |
|---|---|
| Initial | Mask = user position ± 1500m (3km square) |
| Pan within padding | No re-render (raster scales smoothly) |
| Pan reaches padding edge | Re-render with new center |
| Cell added (visited) | Re-render in place |
| Zoom change | No re-render (raster auto-scales) |

Threshold: re-render when pan exceeds 50% of padding extent (so user always has 50% buffer ahead).

---

## 7. Game-feel implementation

### Effect 1: New-cell fade-in
- When new cell appears in `newlyAdded`, render TWO masks:
  - "old" mask without new cells
  - "new" mask with new cells
- Use `rasterFadeDuration: 800` (or render two RasterLayers and animate opacity)
- Mapbox's built-in fade should suffice for v331 — verify

### Effect 2: Cream halo at fog/clear boundary
- Implemented in step 7 of algorithm above
- Mimics Fog of World's hand-drawn rim look

### Effect 3: Existing MemoryFogBurstOverlay (Cairn already has)
- Keep as-is; it's a Skia overlay above the raster layer
- Triggered when cell is first revealed (golden ring pulse)
- Already production-tested v303-v324

---

## 8. Edge cases to test

| Case | Expected |
|---|---|
| No cells visited | Show pure fog, no holes |
| 1 cell | Single 25m soft-edged hole |
| 1281 cells (500m reveal) | Smooth round clear, no artifacts |
| 10000+ cells (long-time user) | Render time ≤ 200ms still |
| Pan across hemisphere | New mask center, smooth fade |
| Memory tab background → foreground | Re-render once on focus |
| Cell version bump rapidly (10x in 1s) | Debounced to 1 render |

---

## 9. Verification plan

### PC verification (already done)
- ✅ F1 spike: current polygon path breaks (z≤12)
- ✅ F3 spike: raster path clean (z=8..18)

### Real device (mandatory before OTA)
- Expo dev client (`npx expo start --dev-client`) on user's iPhone
- Walk through Memory tab: initial 500m reveal + pan + zoom out to z=10
- Screenshot at z=10, z=12, z=14, z=16, z=18
- Compare side-by-side to F1 v330 real-device screenshot (snap-190.png)
- **Must show: zero checkerboard, fog visible at all zooms, edges feathered**

### Code review
- 2 independent subagents review the implementation
- Each must independently identify ≥1 bug or risk OR explicitly approve

---

## 10. Rollback plan

If v331 fails on real device:
- v331.1: revert FogLayer.tsx to v330; v331 raster code stays in repo (gated by feature flag `useRasterFog: false`)
- Investigate Skia / rnmapbox specific failure
- Do NOT chain more guesses — return to subagent investigation

---

## 11. OTA staging

| Stage | Action |
|---|---|
| 1 | Implement v331 code |
| 2 | 2-subagent code review → fix issues |
| 3 | Dev client real-device test → screenshots |
| 4 | **User reviews screenshots** → approves |
| 5 | Bump OTA_VERSION=331 → eas update push |
| 6 | git commit + push origin master |
| 7 | User cold-starts app twice → verify on production OTA |

---

## 12. Risks (known + mitigations)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Skia surface encodes too slow on iPhone X-class device | Medium | Profile in dev client; if >300ms, downscale to 768×768 |
| `BlendMode.Clear` doesn't work in offscreen surface on Android | Low | Spike report says it works; verify in dev client |
| `file://` URI fails to load in rnmapbox ImageSource | Low | Spike confirmed it works in 10.3.1; verify in dev client |
| Cream halo step too slow | Low | Make it optional, off by default for v331; ship later as v332 |
| RasterLayer fade jitter on rapid cell updates | Medium | Debounce 500ms ensures rev bumps stay calm |
| Cache directory fills up | Low | Cleanup old rev N-1 after fade window |
| Skia.MakeOffscreen API name wrong in v2.2.12 | Low | Verify in spike: it's `Skia.Surface.MakeOffscreen(w, h)` or `Skia.Surface.Make(w, h)` (CPU); confirm at impl time |

---

## 13. Out-of-scope for v331

- Per-tile rendering (would need CanvasSource — rnmapbox 10.3.1 doesn't have it)
- Server-side MVT generation (Mapbox official workaround, but too expensive for real-time)
- Custom shader / deck.gl (no RN binding)
- Latent dLng per-row encoding bug (Task #18, low impact, separate Sprint)

---

**End of plan. Open for 2-subagent review.**
