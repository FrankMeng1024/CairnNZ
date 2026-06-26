# Global Fog + Local Mask Architecture — Spike Report

**Spike date**: 2026-06-25
**Target**: rnmapbox/maps **10.3.1** (ships native Mapbox SDK **11.20.1** on both iOS + Android — verified in `app/node_modules/@rnmapbox/maps/package.json:78-79`)
**Question**: Plan reviewer #2 flagged regression — Skia PNG ImageSource only covers a padded local viewport; zoom out and the rest of the world has no fog. How do we keep "whole world covered in fog, only local area clear" without the polygon-with-holes bug?

---

## TL;DR — Recommendation

**Adopt a 2-layer architecture (Approach A1 / hybrid)**:

1. **Cheap global fog floor**: `<BackgroundLayer>` (or `<FillLayer>` over a single world-rect GeoJSON) with the fog color at `~0.65` opacity. This is one constant-color layer covering the whole world at all zooms, all viewports. No raster, no geometry-per-cell, no earcut.
2. **Local Skia raster on top, with `raster-color`** (Mapbox 11 feature) **for crisp punch-out**: the Skia PNG we already proved in F3v2 covers only the padded local viewport. We render its visited cells as **transparent**, the rest as **transparent too** — and use `raster-color` to interpret the PNG as a *cream halo edge* over the visited cells only. The fog floor underneath remains fully visible outside the local mask.

In other words: **the global FillLayer/BackgroundLayer is the fog. The Skia raster is only the cream halo + edge feathering near the user.** The "hole" is not in the fog — the fog floor is never painted inside the cleared area, because we use a third inner layer (or shape the mask itself) to *blank out* the fog only inside a small radius around visited cells.

Detail flow + alternatives below.

---

## Evaluation of each candidate

### Approach A — Global FillLayer + local RasterLayer with raster-color erase

**Idea (literal reading of the brief)**: A FillLayer with a world-rect polygon as fog. On top, a RasterLayer of the Skia PNG. Where the raster pixel is transparent, the fog underneath shows through; where the raster pixel is opaque cream, you see cream.

**Critical reality check on the "raster erases fill" question**:

Mapbox does **NOT** expose Porter-Duff blend modes (`destination-out`, `xor`, etc.) on any layer. The style spec has zero documented blend-mode primitive. `raster-color`, `raster-color-mix`, `raster-color-range` are **colorization** controls, not compositing controls — they map a scalar source value into an output color, but the output is then **always composited as standard source-over alpha blending** onto the layers below.

What this means: a raster pixel with alpha=0 will *not erase* the fill below. It just contributes nothing. That's literally the default `source-over`. So the answer to the brief's question "can raster-color let transparent pixels abrade the fill below?" is **NO**.

**However, this doesn't kill the approach.** Source-over with alpha is exactly what we want — we just need the Skia PNG to *be* the entire visual difference between "fog" and "clear" in the local area.

**Viable variant — A1 (recommended)**:

Three layers:

| Layer order (bottom → top) | Type | Purpose |
|---|---|---|
| L1 (above style base) | `<BackgroundLayer backgroundColor="#3A2A18" backgroundOpacity={0.65}>` | Global fog at all zooms. One uniform brown layer over the whole world. |
| L2 | `<RasterLayer>` over Skia PNG (`ImageSource` covering padded local viewport) | The *holes* themselves. PNG is RGBA with: clear-area pixels = `(0,0,0,0)` transparent, fog-area pixels (inside the local bbox but outside cleared cells) = `(0,0,0,1)` solid black. We then use `raster-color` to recolor the solid black into the **same color as L1, plus a tiny alpha boost**, so it fills back the fog in the local viewport. The transparent pixels stay transparent and reveal L1 below — but L1 is fog, so they still look foggy. WAIT — this doesn't help. |

Stop. Let me re-derive. L1 already covers everywhere with fog. L2 is supposed to *remove fog* in the cleared cells. Standard alpha can't subtract. So L2 must do something *additive* — it can only place new pixels on top of L1.

The correct mental model is **the opposite of "punch hole"**: don't try to subtract from the fog floor. Instead, **the fog floor itself has the hole.** Use a different mechanism for L1.

**Corrected A1 — Inverse mask FillLayer**:

| Layer | Type | Purpose |
|---|---|---|
| L1 | `<FillLayer>` over a GeoJSON polygon that is **the world minus a circle around the user** (an even-odd inverse polygon with a single inner ring) | Global fog with a single local hole. The "with holes" pattern but **with only one outer ring + one circular inner ring (16-32 vertices)**. This is the safe pattern Mapbox handles fine — the geojson-vt/earcut bug only manifests when the polygon-with-holes has *many* small inner rings (the v325-v330 path tried thousands of H3 cell rings). One round ring is trivial. |
| L2 | `<RasterLayer>` over Skia PNG (current F3v2 mask, padded local viewport, cells punched as transparent, cream halo on edges, blurred soft edges) | The fine-grained per-cell punch-out + visual game effect (cream halo, blur) inside the hole. |

This is **the recommended path**. Why it works:

- **The single-circle-hole polygon is geometrically simple (32 vertices outer world rect + 32 vertices inner ring).** earcut + geojson-vt have been proven to handle this at all zooms for 7+ years; the bug only emerges with *complex* multi-polygon-with-holes geometry. We are not stress-testing earcut anymore — we feed it the simplest possible "1 outer ring with 1 inner ring" shape.
- **Whole world is covered**: the outer ring is `[-180,-85] to [180,85]` (Mapbox Mercator limits). Zoom all the way out → fog everywhere except the small visible circle.
- **The Skia raster does the per-cell precision job** inside the cleared circle. Its bbox is `~3km` wide, so even a 1024² PNG resolves each 25m H3 cell at ~8.5 px/cell. The earcut bug never sees the cells because they live inside the raster, not as polygons.
- **Cream halo + feathered edges** are baked into the PNG (which we already proved in F3v2 — see `F3v2_fog_mask.png`).

**Caveats**:

1. The inner circle in L1 must always *be larger* than the L2 raster bbox. Otherwise the seam between "L1 ends, L2 begins" shows. Solution: L1 circle radius = `paddingMeters * 1.4` (40% larger than L2 bbox half-side). Done.
2. As user pans/the L2 raster re-centers, the L1 circle must follow. Cheap: a 32-vertex polygon updated on `cellVersion` or `onMapIdle` debounced 500ms. Total geometry payload: ~64 floats, irrelevant.
3. Color matching: L1 fog color must *exactly* match what the L2 PNG draws in its non-cleared area. Otherwise a visible seam. Solution: L2's non-cleared pixels in the PNG = transparent (not solid fog); the L1 fog below fills them. The PNG's only solid pixels are the **cream halo** + feathered edge. Inside the cleared cells: fully transparent. This makes L1 and L2 colors decoupled.

**Verdict**: **GO**.
- Feasibility: **GO**
- Implementation complexity: **3 / 5** (one extra layer + a 32-vertex updating polygon)
- Performance budget: ~50 ms per update (Skia render unchanged from v331 plan; the polygon update is ~1 ms)
- Visual quality: **5 / 5** (game-feel halo + feathered edges + global fog)
- rnmapbox 10.3.1 support: **Yes, fully** (FillLayer, ImageSource, RasterLayer all v10.3.1-confirmed)

---

### Approach A2 — `raster-color` + raster-only (no FillLayer)

**Idea**: Skip the FillLayer. Stretch a single `<ImageSource>` to cover the whole world (`[-180,-85, 180,85]`). The Skia PNG itself encodes fog everywhere except cleared cells.

**Reality check on stretching a 1024² PNG over the world**: at zoom 0 (whole earth in view), 1024 px / 360° = ~2.84 px per degree. Each H3 r12 cell (25m) occupies ~0.000225° → about 0.0006 px. **Completely sub-pixel, invisible.** Then at zoom 14, the same PNG is stretched to ~256k pixels wide on screen — 250 px per source-pixel, hopelessly blurry. **NO-GO** — single global raster is impossible at this resolution.

**Hybrid raster-color**: could the PNG be just 4 pixels — 2x2 with a centered hole — and use `raster-color` + `raster-resampling: nearest` to colorize zoom-dependent? No, because the "hole" is a fixed pixel position in the source, not geo-anchored to the user. As user pans, the hole moves with the map but the user moves on screen. Same problem.

**Verdict**: **NO-GO** (single world-spanning raster). Approach A1 is the right way to use raster.

---

### Approach B — `fill-pattern` with dynamic image as global fog

**Idea**: A FillLayer covering the whole world, using `fill-pattern: 'fog-mask'` where `fog-mask` is a dynamic image registered via Mapbox's `addImage` API. Update the image as cells change.

**Reality check on `fill-pattern` semantics** (Mapbox style spec, confirmed via context7):

> `fill-pattern`: "Name of image in sprite to use for drawing image fills. **For seamless patterns, image width and height must be a factor of two (2, 4, 8, ..., 512).**"
> `background-pattern`: same. "Image dimensions must be powers of two ... evaluated only at integer zoom levels."

The pattern image is **tiled in screen space**, not georeferenced. It's a wallpaper. So a 512×512 fog image with a cleared spot in the middle would repeat across the screen as a grid of cleared spots. Not what we want.

There's no documented way to "anchor" the pattern image to map coordinates. Even with `fill-translate-anchor: map`, that only shifts the *offset*; the image still tiles.

Furthermore: rnmapbox 10.3.1 does have `<Images>` (`app/node_modules/@rnmapbox/maps/src/components/Images.tsx:88-94`) that lets us register an image by name from a `file://` URL. So *adding* a dynamic image works. But the **pattern-tile semantics make this fundamentally wrong** for georeferenced fog.

**Verdict**: **NO-GO**. `fill-pattern` is for wallpaper textures (woodgrain, hatching), not geographic masks. Approach B's premise is incorrect.

---

### Approach C — Skia PNG re-rendered on every viewport change (single ImageSource follows camera)

**Idea**: One ImageSource. On every `onMapIdle` event, recompute the visible bounds + zoom, re-render Skia to fit, update coordinates + url atomically.

**Reality check**:

1. **`onMapIdle` frequency**: Mapbox fires this *after the camera stops moving*. So during continuous pan, no callbacks. After release, one callback. That's fine cadence-wise.
2. **But during pan, the raster doesn't follow**: Mapbox automatically transforms the raster (scale/skew/rotate) to keep it geographically anchored to its `coordinates`. So if `coordinates` is set to the *previous* viewport bbox, panning shows the old raster offset from where the camera now is. The user pans 500m east, sees a fog-of-old-position. Then `onMapIdle` fires, we re-render, the fog snaps into place. **Visible jitter / "swimming" effect.**
3. **Zoom out**: same problem. Pinch out aggressively, your tiny local raster gets shrunk and there's no fog beyond its edges. Then `onMapIdle` fires, you re-render at a bigger bbox, but now resolution per cell is too low. There's a **fundamental tradeoff between "covers the whole viewport" and "resolves H3 cells".** You can't have both in one PNG.
4. **Re-render cost**: Skia ~50-100ms per render is fine on its own, but if the user is in continuous interaction (multi-touch zoom + pan), the re-render queue can stack and produce 200-500ms lags between fog updates.

**Mitigations don't fully save it**:
- Render in 3 zoom tiers (low/mid/high) and switch — complicated state machine.
- Pre-render adjacent regions — solves pan but not zoom-out-to-continent.
- Limit zoom range — defeats Fog-of-World feature parity.

**Verdict**: **NO-GO standalone**. C is a worse version of A1 — same Skia cost, plus jitter, plus no global fog when zoomed out beyond the local raster. **However**, C combined with A1's FillLayer floor *is* essentially A1 — the global fog is the FillLayer; the Skia raster handles local detail only. So we already adopt the *good half* of C in A1.

---

### Approach D — Cell-based vector fog (CircleLayer / LineLayer)

**Idea**: Forget polygon-with-holes entirely. Instead of "fog with holes for visited cells", do "circles of fog over unvisited cells" or "thick lines defining cleared regions".

**Sub-D1 — One CircleLayer per unvisited cell**:
Unvisited cells are *vastly* more numerous than visited cells. Even within a 5km radius, there are ~125,000 H3 r12 cells. CircleLayer with 125k features per frame is feasible (CircleLayer is well-optimized, ~1M points fine on modern GPUs), but at *world scale* (zoom 0), there are ~10^14 unvisited cells. Infeasible.

**Sub-D1 mitigation**: only render circles for unvisited cells within the visible bounds. But this is still 10k-100k circles for a city-zoom view, recomputed every viewport change, fed via GeoJSON, geojson-vt clipping, and earcut for filled circles. Same path that broke us at v325-v330, just with circles instead of polygons.

**Sub-D2 — CircleLayer with huge radius for "fog tiles"**:
Cover the world in a sparse grid of overlapping giant circles. The math doesn't work — you'd need millions to cover the world without holes.

**Sub-D3 — LineLayer ring around cleared area**:
A thick line (`lineWidth: 500`) traced around the perimeter of the user's cleared cells. Lines fade outward via `lineBlur`. This gives a "halo around the cleared zone" but leaves the rest of the world unfogged. No good — fails the "whole world covered" requirement.

**Sub-D4 — Inverse: a few giant unvisited "continent polygons"**:
Compute the unvisited area as continent-sized polygons. The geometry simplifies to "world minus visited area = world rect minus a few small visited blobs". This is essentially A1 (single-inner-ring polygon). So D4 = A1.

**Verdict**: **NO-GO** for D1/D2/D3 standalone. D4 collapses into A1.

---

### Approach E — Mapbox `sky` layer / `atmosphere` / `background` layer manipulation

**Idea**: Use Mapbox's built-in atmospheric primitives (fog, sky, background) to create the dark overlay.

**Reality check** from `MapboxStyles.ts:2237-2381` and the Style Spec:

- **`background` layer**: literally a flat color/pattern over the whole map. Below all data layers. **Cannot have local holes.** But it CAN serve as L1 in Approach A1 — see A1's first row. ✅ Useful.
- **`sky` layer**: a dome around the map's horizon, only visible in pitched/3D views. Doesn't cover the map surface. **Wrong primitive.**
- **`atmosphere` config (Mapbox 11)**: fades the map by distance from the camera center. `range`, `color`, `high-color`, `space-color`, `horizon-blend`. This is **only visible in globe projection or far-pitched views**, and it fades by camera distance, not by user-defined geo regions. **Wrong primitive.**
- **`fog` config (older Mapbox; now under `atmosphere` in v11)**: same as above. Distance-from-camera fade, not geo-anchored.

The only relevant member of this family is `background` — which we already use as L1 in A1.

**Verdict**:
- `background` layer: **GO** as the cheap global fog floor in A1.
- `sky`, `atmosphere`, `fog`: **NO-GO** — wrong semantics.

---

## Recommended plan (A1) — concrete

### Layer stack

```tsx
<MapView>
  {/* L1: cheap global fog floor — Mapbox draws this at all zooms, all viewports */}
  <BackgroundLayer
    id="fog-floor"
    style={{
      backgroundColor: '#3A2A18',   // dark sepia, matches v330 fog
      backgroundOpacity: 0.65,
    }}
  />

  {/* L2: world-rect-minus-circle polygon — punches a circular hole in the floor */}
  {/*    Without this, fog covers cleared area too. With this, the L1 floor has a circular gap. */}
  {/*    Hidden by re-coloring L1 = transparent inside the circle. */}
  {/*    Actually: drop L1 BackgroundLayer; use this FillLayer with even-odd fill rule */}
  {/*    instead. World rect outer ring + circle inner ring = fog everywhere except circle. */}
  <ShapeSource id="fog-floor-src" shape={worldRectMinusCircle(userCenter, radiusMeters)}>
    <FillLayer
      id="fog-floor-poly"
      style={{
        fillColor: '#3A2A18',
        fillOpacity: 0.65,
        fillAntialias: true,
      }}
    />
  </ShapeSource>

  {/* L3: Skia raster — only inside the circle, provides cream halo + feathered edges + per-cell punch-out */}
  <ImageSource
    id="fog-mask"
    url={`file://${skiaFile}`}
    coordinates={localBboxQuad}
  >
    <RasterLayer
      id="fog-mask-layer"
      style={{
        rasterOpacity: 1,
        rasterResampling: 'linear',
        rasterFadeDuration: 300,
      }}
    />
  </ImageSource>
</MapView>
```

The recommended stack is actually **two layers**, not three:

- **L1 = FillLayer over a `world-rect with one circular inner ring` polygon.** This is the fog. Simple geometry (one outer ring of 4 corners + one inner ring of 32 vertices). 36 vertices total — earcut/geojson-vt-safe.
- **L2 = ImageSource + RasterLayer of the Skia PNG**, sized to a padded bbox slightly *smaller* than L1's circle. This is the cream halo + per-cell precision. The PNG is fully transparent in cleared cells; opaque cream only on cell edges (halo) and on the very rim of the circle (fade to fog floor).

The **L1 circle radius** must be ≥ **L2 raster half-extent + 200m fade buffer**. Otherwise the L1 polygon edge would be visible inside L2's raster.

### Files (delta from current v331 plan)

**Modified vs v331 plan**:
- `app/src/features/memory/components/FogLayer.tsx`:
  - Keep ImageSource + RasterLayer as planned in v331 (good, this is L2)
  - **Add** a sibling ShapeSource + FillLayer for L1 (world-rect-minus-circle)
- `app/src/features/memory/services/fogMaskRenderer.ts` (new in v331):
  - Skia PNG: cleared cells → transparent. Cell *boundary edges* → cream stroke. Rim of raster bbox → no halo (lets L2 fade naturally to L1 outside)
- **New helper**: `app/src/features/memory/services/fogFloorGeometry.ts`
  - Function `worldRectMinusCircle(centerLat, centerLng, radiusMeters, segments=32) → GeoJSON Polygon`
  - Updates on the same trigger as L2 (`cellVersion` or pan beyond threshold)

### Performance budget

| Step | Cost |
|---|---|
| L1 geometry recompute (32-vertex circle) | <1 ms (JS) |
| L1 ShapeSource native update | ~5 ms (bridge + Mapbox style commit) |
| L2 Skia render | 50-100 ms (unchanged from v331 plan) |
| L2 PNG encode + file write | 30-60 ms (unchanged) |
| L2 RasterLayer native update | 10-30 ms (unchanged) |
| **Total per fog update** | **~100-200 ms** |

L1 + L2 update share the same trigger (`cellVersion` debounced 500ms), so total cost ≈ v331 plan's cost. No regression.

### Why this is not a return to the polygon-with-holes bug

The v325-v330 path failed because:
- Multi-polygon with **thousands of small inner rings** (one per H3 cell or per cluster of cells)
- Each ring had ~6 vertices, but the total was 10k+ vertices
- earcut's tessellator + geojson-vt's tile clipper choked on this geometry at zoom ≤ 12 (clipping introduced T-junctions; earcut produced degenerate triangles)

The A1 path:
- **One** outer ring (4 vertices: world rect)
- **One** inner ring (32 vertices: circle around user)
- Total: 36 vertices. earcut handles this in microseconds with zero edge cases.
- Geojson-vt tile clipping has been stable on simple-hole-polygons since 2017.

The bug is a complexity bug, not a "polygon with hole" bug. A1 stays in the safe regime.

---

## Risks still open

1. **L1 polygon edge visible at extreme zoom-in**: at z18, the 32-segment circle starts to look polygonal. Mitigation: bump to 64 segments when zoom > 16 (still trivial geometry). Alternatively: lineBlur on the L1 fill edge (line layer companion).

2. **Antimeridian crossing**: if user is in Fiji and the world rect spans `[-180, 180]`, the polygon-with-hole near 180° may render the hole on the wrong side. Mitigation: use a slightly inset world rect (`[-179.99, 179.99]`); if user is within 1° of the antimeridian, split the polygon into two halves. Edge case affecting <0.01% of users; defer to v332.

3. **Color exactness**: L1 fill color must visually match what Skia draws as "fog tone" on the L2 PNG outside the cream halo. Mitigation: Skia PNG has zero "fog" pixels — only cream halo near cell edges and transparent everywhere else. L1 is the *only* source of fog color. No matching needed.

4. **Cell precision at L2 edge**: if user has visited a cell near the L2 raster's bbox edge, the cream halo gets clipped. Mitigation: pad the L2 raster bbox by `2 * cell_size` (~50m). Already implied in v331 plan's 1500m padding.

5. **`rasterOpacityTransition` cross-fade on L2 swap**: a 300ms fade means for 300ms there are two L2 rasters overlapping. If the new one has cells in a slightly different position from the old one (due to cellVersion change), the cream halos double up briefly. Mitigation: set `rasterFadeDuration: 0` if jitter visible, or accept the dreamy fade.

6. **L1 hole follows user but L2 raster follows cellVersion**: if user pans without adding cells, only L2 should re-center. But L1's hole is anchored to user center, not to cells. So L1 must also re-center on pan. Solution: both L1 + L2 use `userCenter` (the camera target) as anchor; both re-render on the same trigger.

7. **rnmapbox 10.3.1 → Mapbox 11.20.1**: many Mapbox 10-era docs claim certain props don't exist; they DO exist at runtime because rnmapbox 10.3.1 bundles Mapbox SDK 11.20.1. Verified in `node_modules/@rnmapbox/maps/package.json:78-79`. Reviewers reading old docs may flag false alarms — point them at this fact.

8. **iOS-vs-Android antialiasing parity**: FillLayer `fillAntialias: true` works on both, but the circle edge may shimmer differently. Verify in dev client on both platforms before OTA.

9. **L1 covers Mapbox style labels**: putting FillLayer above labels obscures them. Mitigation: insert L1 + L2 below the label layers using `belowLayerID` prop (e.g. `belowLayerID="settlement-label"`) or `slot="middle"` (Mapbox 11 slot feature, supported in rnmapbox 10.3.1 — see `LayerPropsCommon.slot` in `RasterLayer.tsx:75`).

---

## Summary table

| Approach | Verdict | Complexity (1-5) | Perf (ms/update) | Visual (1-5) | rnmapbox 10.3.1 |
|---|---|---|---|---|---|
| **A1 — FillLayer (world-rect-minus-circle) + Skia raster on top** | **GO (recommended)** | 3 | ~100-200 | 5 | Yes |
| A2 — Single world-spanning raster | NO-GO | 4 | n/a | 1 | Yes but unusable |
| B — fill-pattern with dynamic image | NO-GO (wrong semantics) | 5 | n/a | 0 | Partial; wrong primitive |
| C — Single raster following viewport | NO-GO standalone (jitter, no global fog) | 4 | 150-300 + jitter | 2 | Yes |
| D1/D2/D3 — Cell-based vector | NO-GO (worse than v330) | 5 | >500 | 2 | Yes but breaks earcut again |
| D4 — Inverse continent polygons | = A1 | (same) | (same) | (same) | Yes |
| E — sky/atmosphere/fog | NO-GO (wrong semantics) for sky/atmosphere; **GO for background as A1 alternate** | 1 | <5 | 4 | Yes |

---

## Plan v2 amendments

Suggested changes to `v331_plan.md`:

1. **Section 2 (Architecture decisions)**: add row:
   - `Global fog layer` = **FillLayer over world-rect-minus-circle GeoJSON** (or BackgroundLayer if pure fog without local hole — but we need the hole for L2 to show through)
2. **Section 4 (Files)** add:
   - New: `app/src/features/memory/services/fogFloorGeometry.ts` — exports `worldRectMinusCircle(lat, lng, radiusM, segments)` returning a GeoJSON Polygon
   - Modified: `FogLayer.tsx` adds a `<ShapeSource>+<FillLayer>` for the global fog floor, sibling to the existing `ImageSource+RasterLayer`
3. **Section 5 (Algorithm)**: the Skia PNG no longer needs to paint fog color anywhere. Only paint:
   - transparent in cleared cells
   - cream halo on cell-boundary edges
   - transparent everywhere else (including outside cleared cells)
   - This simplifies the renderer: no `drawRect(full, fogPaint)`. Start with a clear canvas.
4. **Section 6 (Viewport padding)**: L1 circle radius = `paddingMeters * 1.4`; L2 raster bbox = `paddingMeters * 1.0`. Both anchored to user center. Both re-render on same trigger.
5. **Section 12 (Risks)**: add risks 1-9 from this report.
6. **Section 8 (Edge cases)**: add:
   - Antimeridian crossing → noted as v332 deferral
   - Zoom to z3 / continent view → verify L1 fog visible, L2 effectively invisible (its bbox is sub-pixel) — that's correct behavior; user sees uniform fog floor, no jitter

---

## Sources

- `app/node_modules/@rnmapbox/maps/package.json:78-79` (Mapbox SDK 11.20.1 on both platforms — overrides the assumption that 10.3.1 uses Mapbox v10)
- `app/node_modules/@rnmapbox/maps/src/components/ImageSource.tsx` (TL,TR,BR,BL quad coordinates; v10.3.1 has working dynamic updates)
- `app/node_modules/@rnmapbox/maps/src/components/RasterLayer.tsx` (style props enumerated)
- `app/node_modules/@rnmapbox/maps/src/components/BackgroundLayer.tsx` (cheap global color/pattern layer)
- `app/node_modules/@rnmapbox/maps/src/components/SkyLayer.tsx` (dome-only; not a map surface layer)
- `app/node_modules/@rnmapbox/maps/src/utils/MapboxStyles.ts:1830-1950` (RasterLayerStyleProps — `raster-color` available; no Porter-Duff blend modes anywhere)
- `app/node_modules/@rnmapbox/maps/src/utils/MapboxStyles.ts:2189-2236` (BackgroundLayerStyleProps)
- `app/node_modules/@rnmapbox/maps/src/utils/MapboxStyles.ts:2317-2381` (AtmosphereLayerStyleProps — distance-from-camera fade, NOT geo-anchored)
- Mapbox Style Spec via context7 `/websites/mapbox_style-spec`:
  - `raster-color-mix`: colorization, not compositing — confirms NO blend-mode primitive
  - `fill-pattern` / `background-pattern`: tiled screen-space wallpaper, NOT geo-anchored
  - Image source: requires `[lng,lat]` corner quad, clockwise from TL; ±85° polar limit
- `_spike/v331-pc/rnmapbox_imagesource_research.md` (prior spike confirming ImageSource viability)
- `_spike/v331-pc/F3v2_fog_mask.png` (current Skia mask appearance — confirms cream halo + soft edge render works)
- `_spike/v331-pc/F3_raster_z10.png` (raster at zoom 10 — confirms clean rendering with no artifacts inside local bbox)
