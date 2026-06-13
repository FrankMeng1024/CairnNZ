# Cairn — AR Marker Aesthetic Direction & Type-Icon Solution

**Author**: research agent
**Date**: 2026-06-09
**Context**: NZ-targeted AR hiking app. 5 marker types (danger, junction, water, hut, cairn). Current art = magic circle on ground + vertical strands + flat SDF type icon. User reports type icons read inconsistently (angle, asymmetry, cairn doesn't match the 3-stones logo). Target: clean, simple, NZ-cinematic but understated. Stack: Unity URP iOS AR.

> **Search note**: Web searches via the available GLM endpoint returned mostly off-topic Chinese SEO results for the design queries. The two genuine NZ govt design references (DOC, Tourism NZ) and Niantic AR design articles did surface as URLs and are cited. The aesthetic recommendations below draw on those plus established NZ visual identity knowledge (DOC, Tourism NZ "100% Pure", Te Papa, Air NZ koru) and AR industry conventions (Pokemon GO / Niantic Wayspot, Apple Maps Live View, Google Maps Live View). Where I'm relying on general design knowledge rather than a cited URL, that is flagged.

---

## A. NZ Aesthetic Foundations (what NZ users will recognise as "ours, not generic")

NZ visual identity has a few specific tells. Pick from these — don't invent.

### Color palettes that read "NZ" instantly

| Palette | Hex | What it evokes |
|---|---|---|
| **Pounamu (greenstone)** | `#0D3B2E` (deep) → `#1E6B4F` (mid) → `#7FB69E` (lit edge) → `#E8F0EA` (highlight) | Sacred, taonga, ancestral; wet polished stone; cool green. Used by Te Papa and Air NZ accent. |
| **Aoraki / Southern Alps** | `#0F1B2D` (storm sky) → `#3A4A5C` (rock wet) → `#A8B4C0` (snow shadow) → `#F4F6F8` (snow) | High alpine, cold, vast. The DOC photography palette. |
| **Tussock / Mackenzie** | `#5C4A2A` (dry grass) → `#B89968` (gold tussock) → `#D9C796` (sun on grass) → `#1B2F3D` (shadow ridge) | Central Otago / Mackenzie basin. Gold-on-blue. The "LotR Rohan" palette is literally this. |
| **Native bush** | `#0A1F14` (canopy shade) → `#2D5A3D` (mature leaf) → `#5A8C6A` (new growth) → `#B7D4B6` (silver fern underside) | Wet rainforest; ponga and tī kōuka; deep saturated greens. |
| **Kowhai / Pohutukawa** | `#F6C24E` (kowhai gold) ← sparingly ← `#C73127` (pohutukawa red) | Hero accents only. Both are seasonal flowers — strong visual signifier of "NZ" without being kitschy. |
| **Bioluminescent night** (Avatar lean) | `#0A1226` (deep night) → `#1A4D5C` (cold cyan) → `#5DE0D4` (glow rim) → `#C4FFE9` (peak glow) | Glow worms (Waitomo). Less NZ-specific but maps perfectly to "Avatar Pandora at night" without stealing the alien-jungle palette. |

### Motif language (use sparingly, never decorate)

- **Koru (unfurling fern frond)** — spiral that opens outward. Reads as "new growth / journey beginning." Used by Air NZ. **Risk**: overused; can read as airline logo if drawn too cleanly. Use as motion path, not as a stamped logo.
- **Tāniko / tukutuku** — geometric weaving patterns (diamond, chevron, stepped triangles). Strong, abstract, non-figurative. Best used as edge treatments, not central elements.
- **Manaia** — guardian figure (bird-headed). **Avoid as a UI icon.** It's deeply spiritual; commercial use is appropriative unless designed in genuine partnership with iwi.
- **Three stacked stones (the cairn itself)** — the app's logo motif. Both literally a hiking cairn AND visually echoes traditional pou (ancestral markers). This is the single strongest motif the app already has.
- **Silver fern (ponga underside)** — national identity. Works as a background watermark or environmental detail; too literal as an icon.

### NZ government / institutional visual language (verified references)

- **DOC (Department of Conservation)** — site: https://www.doc.govt.nz . Visual language: large landscape photography, sans-serif (typically Source Sans / similar humanist sans), green `#005C32`-ish primary, generous whitespace, no decoration. Sober, trustworthy, environmental. **This is the closest existing benchmark for what "NZ hiker UI" looks like.**
- **Tourism NZ ("100% Pure New Zealand")** — site: https://www.newzealand.com . Visual language: cinematic landscape film, the slogan set in a clean serif/sans pair, restrained type, the photo always does the heavy lifting. Te reo Māori macrons used correctly (Aotearoa, Tāmaki Makaurau, Aoraki).
- **Te Papa** — uses te reo Māori first / English second on signage; bold typography; geometric tukutuku-derived patterns as visual breaks; unafraid of dark backgrounds with single-color accents.

### What NZ hikers DON'T want

- Cartoon "tiki" iconography
- Bright primary RGB ("Pokemon GO" palette) — reads as foreign / theme-park
- Anything Comic Sans / "tropical adventure" font stack
- Overly bioluminescent / "magical" treatment of Māori motifs (cultural sensitivity)
- DOC orange triangle markers re-skinned literally — those are real-world signage, not to be confused with

---

## B. AR Type-Icon Conventions (how the mainstream solves this)

Established AR-app conventions, derived from Niantic / Apple / Google practice (Niantic design articles cited):

### Reference apps and what they do

| App | Type icon treatment | Behavior |
|---|---|---|
| **Pokemon GO (Pokestop / Gym)** | 3D mesh base (cube / tower) + 2D billboarded sprite icon floating above. The base is world-anchored; the icon plate ALWAYS faces camera. | Base gives "place in the world"; sprite gives "instantly readable from any angle." See Niantic's own write-up: https://zhuanlan.zhihu.com/p/81066043 (Niantic 深度总结: 如何用 AR 唤起魔幻现实主义) |
| **Niantic Wayspot** | Floating diamond crystal (3D), with type chip rendered as sprite. Same pattern. | https://zhuanlan.zhihu.com/p/58934111 (Niantic 分享如何构建世界规模 AR 平台) |
| **Apple Maps Live View** | Floating chevron arrows + 2D billboard signs at street/POI. Signs always face camera. Type indicated by glyph + color chip. | Signs pop in at fixed pixel-size up to ~30 m, then billboard scales down. Distance-fade on far markers. |
| **Google Maps AR Live View** | Same: floating billboard signs with glyph + label. Aggressive distance fade so far markers don't visually clutter. Hero arrow is 3D-mesh, world-rotated, not billboarded — because direction-of-arrow is meaningful. | |

### The two near-universal rules

1. **The type-glyph layer billboards.** It always faces the camera. If you don't billboard the glyph, it will read at one angle and disappear at all others. **This is exactly the bug the user is reporting.**
2. **The base / world-anchor layer does NOT billboard.** It stays fixed in world space — that's how the user knows it's a real point in space, not a HUD overlay. Rotation can be slow ambient yaw (cinematic) but never camera-locked.

So: **separate the "world anchor" layer from the "readable identity" layer.** The user's current "ring on ground + vertical strands + flat SDF on the ring" is collapsing both into one ground-anchored quad — that's why the icon angle is inconsistent.

---

## C. Five Visual Directions

Each direction keeps the existing ring-on-ground + strands ARCHITECTURE but redefines the form/color/icon language. Scores: 1-10.

---

### Direction 1 — "Pounamu Light" (RECOMMENDED — see §F)

**Theme**: A polished greenstone shard rises from the trail. Wet, cool, sacred, NZ-coded. Soft inner glow; rim light; nothing flashy.

**Color** (per type, hex):
- danger `#C73127` (pohutukawa red) on `#1B0E0C` base
- junction `#F6C24E` (kowhai gold) on `#1F1A0E` base
- water `#5DA9D9` (alpine lake) on `#0E1B26` base
- hut `#D08A4A` (warm timber) on `#1F1410` base
- cairn `#7FB69E` (pounamu lit edge) on `#0D3B2E` base

**Form**: Geometric but soft-edged. Ring on ground = polished stone arc (subtle bevel + spec highlight). Strands = thin vertical light slivers, slight inward taper, like wet greenstone fibres. Type icon = 3D extruded glyph (low-poly, ≤ 200 tris) with a translucent inner core and rim-light shader, billboarded to camera with a subtle 5-10° tilt toward viewer.

**Motion**: Almost still. Strands have 0.5 Hz vertical "breath." On approach (< 10 m), inner glow brightens 20%. On selection: single ripple pulse outward across the ground ring. No constant rotation.

**Cinematic mood**: *A pou-stone resting on the trail. You don't notice it until you're close, and then you can't unsee it. It feels like it's been there longer than you have.*

- **NZ-fit**: 9/10
- **Avatar-cinema fit**: 7/10 (less "alien-glow" but more "sacred-stone")
- **Implementation cost**: 3/10 (rim-light shader + extruded mesh is standard URP)

---

### Direction 2 — "Koru Spirit"

**Theme**: A koru (unfurling fern) drawn in light, hovering above the ring. Curve-of-life motif.

**Color**: Single signature green `#1E6B4F` → `#7FB69E` glow. Type accents added as small chip color (red/gold/blue/timber).

**Form**: Ring on ground = thin koru-spiral pattern etched in light, not a solid disc. Strands = curling, inward-spiralling rather than straight vertical. Type icon = flat 2D billboard plate (frosted glass), the type glyph drawn inside.

**Motion**: Slow continuous spiral (one rotation per ~12 s) on the ground koru pattern. Ambient strand sway.

**Cinematic mood**: *A native fern in the dark, slowly opening. It's listening to you.*

- **NZ-fit**: 8/10 (koru is iconic)
- **Avatar-cinema fit**: 8/10 (spiral motion = bioluminescence)
- **Implementation cost**: 5/10 (animated procedural koru in shader; tunable but more authoring work)
- **Risk**: Koru reads "Air NZ logo" if drawn too cleanly. Must be hand-feathered, not flat-vector.

---

### Direction 3 — "Te Ara — The Path"

**Theme**: Tāniko-derived geometric pattern. Sober, architectural, museum-coded. Reads as Te Papa / DOC visual identity.

**Color**: Charcoal base `#1A1F26`, single accent per type. Restrained.

**Form**: Ring on ground = stepped chevron pattern (tukutuku-derived, geometric). Strands = sharp straight vertical lines, very thin, evenly spaced (think cathedral organ pipes). Type icon = 3D mesh, sharp edges, no glow, fixed world rotation (you walk around it). Billboard ONLY a small translucent type chip above the mesh.

**Motion**: None. Completely still. Selection = sharp single flash, no ramp.

**Cinematic mood**: *A waharoa (gateway) carved into the dusk. Quiet authority. The marker doesn't announce itself.*

- **NZ-fit**: 9/10 (most authentically NZ-museum)
- **Avatar-cinema fit**: 4/10 (deliberately un-cinematic; this is "documentary-NZ")
- **Implementation cost**: 2/10 (cheapest — flat colors, no glow, low poly)
- **Risk**: May feel too austere for a consumer app; great for a DOC partnership.

---

### Direction 4 — "Bioluminescent Bush" (Avatar lean)

**Theme**: NZ rainforest at night with glow-worm cyan. Maximally cinematic.

**Color**: `#0A1226` base, `#5DE0D4` glow, type accent dialled high.

**Form**: Ring on ground = soft volumetric circle of haze (post-process bloom heavy). Strands = volumetric cyan light columns with particle motes drifting upward (Waitomo glow-worm cave reference). Type icon = 3D mesh inside a translucent crystal shell, billboard with depth tilt (the "holographic" treatment — option 5 from D). Bright rim, faint internal glow.

**Motion**: Continuous gentle particle rise. Strand volume breathes (1 Hz). On selection: bright pulse, particles burst outward.

**Cinematic mood**: *Avatar's Tree of Souls, scaled down to a single flag in the ferns. The most Instagram-able marker.*

- **NZ-fit**: 6/10 (bioluminescence isn't strongly NZ-coded; Waitomo glow-worms are the only direct NZ link)
- **Avatar-cinema fit**: 10/10
- **Implementation cost**: 7/10 (volumetric light + particles + bloom — watch frame budget on iOS)
- **Risk**: Visually gorgeous but "loud." On a 6-hour hike with hundreds of markers, the user will get fatigued. Also: looks the same as every other AR demo from 2017-2022.

---

### Direction 5 — "DOC Triangle, Modernised"

**Theme**: A direct, respectful nod to DOC's real-world orange triangular trail markers. Pragmatic, honest, "this is a hiking utility."

**Color**: DOC orange `#E26F1A` primary, charcoal `#1F1F1F` base, white `#F4F6F8` glyph. One color per type chip, otherwise monochrome.

**Form**: Ring on ground = simple matte disc with concentric thin ring, no decoration. Strands = three vertical lines forming a triangle silhouette when viewed from any angle. Type icon = flat 3D plate (slightly extruded), billboarded, with a high-contrast white glyph on color chip. Reads at distance like a road sign.

**Motion**: None. Single fade-in on first sight, fade-out when out of FOV. Selection = subtle haptic + brief outline pulse.

**Cinematic mood**: *You're following DOC trail markers. The app respects that. No theatre, just signal.*

- **NZ-fit**: 10/10 (literally the visual language NZ hikers grew up with)
- **Avatar-cinema fit**: 2/10 (intentionally not cinematic)
- **Implementation cost**: 1/10 (cheapest, easiest to ship)
- **Risk**: Boring. The user's prompt asks for "cinematic but understated," so pure utility may be too far the other way. Consider as a baseline / accessibility mode.

---

## D. Type-Icon Construction Options Compared

For every option, "readability" = does the user instantly know which of 5 types this is from 5 m and 30 m, at any approach angle.

| Option | Readability 5m | Readability 30m | NZ-fit | Avatar-feel | Mobile cost | Notes |
|---|---|---|---|---|---|---|
| **1. Flat SDF on ground (current)** | 4 | 2 | 6 | 3 | 1 | The user's bug. Foreshortened to ellipse from head height; symmetric icons (junction arrow) appear asymmetric due to perspective. **Reject.** |
| **2. Flat sprite floating above ring, billboarded** | 9 | 7 | 7 | 5 | 1 | Industry default (Apple Maps, Google Live View). Cheapest fix. Solves the angle bug fully. |
| **3. 3D mesh, fixed world rotation** | 6 | 4 | 7 | 7 | 3 | Looks great when you happen to face it, broken from the back. Only good for direction-meaningful icons (junction = an arrow that should point in the actual direction). |
| **4. 3D mesh, billboard with depth tilt** | 9 | 7 | 8 | 8 | 4 | Pokemon GO Pokestop pattern. Best balance. |
| **5. Holographic crystal (transparent rim-lit mesh)** | 7 | 5 | 7 | 9 | 5 | Cinematic but readability suffers when the crystal refracts the glyph. Use the crystal as a SHELL around a solid glyph, not as the glyph itself. |
| **6. Particle-formed icon** | 4 | 2 | 6 | 9 | 8 | Beautiful, expensive, illegible at distance. Particles dissolve the silhouette — exactly the wrong move for a marker that must be quickly classifiable. **Reject for type-icons; consider for selection FX.** |
| **7. Two-layer (3D base + 2D billboard glyph above)** | 10 | 9 | 8 | 8 | 3 | The proven pattern. 3D base anchors in world (you can walk around it), 2D glyph billboards (you always read the type). **Recommended.** |

**Conclusion**: Option **7** (two-layer) is the right architecture. Option 4 (single billboarded 3D mesh) is acceptable as a simpler alternative.

---

## E. The Cairn Icon Specifically (matching the 3-stacked-ellipses logo)

The current flat SDF is unfixable for this — a flat SDF cannot show three rocks stacked in depth from any angle, because the silhouette IS the rendering.

The logo says: three stones stacked, smaller on top. To preserve that read at every camera angle:

**Recommended: three actual 3D pebble meshes.**

1. **Three low-poly oblate spheroids** (≤ 60 tris each, 180 tris total). Procedurally noised in normal map for surface texture, NOT in geometry — keeps the silhouette clean and logo-faithful.
2. **Stack them**: bottom (radius 1.0, height 0.4), middle (0.7, 0.3), top (0.45, 0.22). World-up axis. Slight random tilt (±5°) per pebble for natural feel.
3. **Material**: same Pounamu-Light shader as the rest of the marker — wet greenstone, rim light, subtle SSS-fake (rim-color × N·V). On selection: rim brightens.
4. **NOT billboarded.** This is the rare case where the 3D mesh IS the type identity — a stack of stones reads as a cairn from any angle without needing a flat icon. The silhouette is unambiguous.
5. **Above the stack**, a small floating type-chip (the word "cairn" or the koru micro-glyph) billboards as the disambiguator at distance — same as the other 4 types' chip layer. So at 30 m where pebble silhouettes blur, the chip still says "cairn."

This makes the cairn marker the LITERAL embodiment of the logo. It's the strongest brand moment in the app.

For the other 4 types (danger, junction, water, hut), the "3D base" can be:
- danger → a small chevron-edged pylon
- junction → a low waharoa-style arch (two uprights + lintel)
- water → a shallow circular basin
- hut → a tiny gabled silhouette

…each ≤ 200 tris, sharing one shader.

Above each base: the billboard type-chip.

---

## F. ONE TOP RECOMMENDATION (ship this)

**Pounamu Light + Two-Layer Marker.**

- **Aesthetic**: Direction 1 (Pounamu Light) — wet polished greenstone, restrained, NZ-coded, leaves room to dial up cinema on selection.
- **Architecture**: Option 7 (two-layer) — 3D world-anchored base + 2D billboarded type-chip.
- **Cairn icon**: 3 stacked low-poly pebbles, same shader as base, NOT billboarded — silhouette = logo. Type-chip billboards above for distance disambiguation.
- **Other 4 types**: each a unique low-poly 3D base (chevron pylon / waharoa arch / basin / gabled hut) + billboarded chip.
- **Color**: charcoal-green base for all, type-specific accent on chip + rim-light tint on base.
- **Motion**: ambient breath only (0.5 Hz subtle scale or glow). Selection = single ripple + rim flare. NO constant rotation, NO continuous particles.

**Why this is the right call**:
1. **Solves the user's bug.** Type icons billboard → angle is consistent at every viewpoint. Junction arrow stays symmetric. Cairn icon literally is the logo from any angle.
2. **Lands for NZ.** Greenstone + restrained palette = Te Papa / DOC visual register. A Kiwi user looks at this and sees "ours." A tourist looks at it and sees "tasteful, place-specific."
3. **Cinematic without being theatre.** Restraint is the harder cinematic move — the user said "cinematic but understated." LotR / DOC photography is cinematic precisely because it doesn't shout.
4. **Cheap on iOS URP.** Two-layer = 1 mesh draw + 1 sprite quad per marker. Shared shader. Particle-free baseline; selection FX is one-shot, not persistent.
5. **Extensible.** If you later want Direction 4 (Bioluminescent) for night mode or special-event markers, the same two-layer architecture supports it — just swap shader and palette.

---

## G. Implementation Sketch (Unity URP iOS AR)

For each marker prefab:

```
MarkerRoot (world position from anchor)
├── GroundRing (quad on XZ plane, custom shader: ring + faint koru etch)
├── Strands (3-5 thin quads or a single procedural mesh, vertical, alpha-additive)
├── Base3D (low-poly mesh per type, shared "Pounamu" shader: rim-light + tint)
│       └── (cairn variant: 3 pebble meshes parented as siblings)
└── TypeChip (sprite quad)
        - script: BillboardYAxis (LookAt camera, lock pitch to 0, only yaw rotates)
        - sprite: per-type glyph + color chip
        - distance fade: alpha = saturate((30 - dist)/5), pixel-fixed scale up to 10m then world-scale
```

**Shader notes** (pseudo):
- Pounamu shader: `albedo = baseColor + rimColor * pow(1 - dot(N,V), 3)`
- Wet feel: low roughness (0.2) + subtle clearcoat
- No real-time shadows on marker meshes (cost; not needed visually)
- Strands: additive blend, vertex-color alpha, world-Y noise scroll for "breath"

**Billboard rule**: Only the TypeChip billboards. Yaw-only billboard (don't pitch) — pitching the chip toward the camera at near distance can make it feel like it's "tipping." Yaw-only keeps it stable.

**Distance behavior**:
- 0-10 m: chip fixed pixel size (so it's always readable when up close)
- 10-30 m: chip scales with world (so it doesn't crowd the view)
- > 30 m: alpha fade to 0; only the GroundRing remains, very faint

---

## H. References

Verified URLs from research:

- DOC (Department of Conservation, Aotearoa NZ): https://www.doc.govt.nz — institutional NZ visual language reference
- Tourism NZ ("100% Pure NZ") photography: https://www.newzealand.com/cl/photography/ — landscape palette / cinema reference
- Niantic on AR design philosophy: https://zhuanlan.zhihu.com/p/81066043 (Niantic 深度总结: 如何用 AR 唤起魔幻现实主义为人类感知设计 AR 系统)
- Niantic on world-scale AR: https://zhuanlan.zhihu.com/p/58934111 (Niantic 分享如何构建世界规模 AR 平台)
- Te Papa Tongarewa: https://www.tepapa.govt.nz (referenced; not a search hit)

General-knowledge references (not from the search session):
- Apple Maps Live View — Apple's AR walking-nav docs
- Google Maps Live View — Google AR Foundation case studies
- Pokemon GO Pokestop / Gym design — Niantic public-facing GDC talks (2017-2019)

---

## TL;DR for the dev

> Build a two-layer marker. World-anchored 3D base (≤ 200 tris, "Pounamu Light" rim-lit shader, type-shaped silhouette). Yaw-only billboarded 2D type-chip floating above it (color-coded glyph, fixed pixel size up to 10 m). Cairn marker = three low-poly pebbles stacked, no billboard — the silhouette IS the logo. Restrained motion: ambient breath, single-pulse selection. Charcoal-green base, type-accent on chip. Ships in days, looks like Te Papa, fixes the angle bug, and reads at 5 m and 30 m.
