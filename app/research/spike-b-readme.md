# Mini-Spike B — Mapbox Vector Tile Junction Extraction (kept as dev validation tool)

**Status:** **Decision taken (2026-06-10): Mapbox vector tile path adopted as the global production data source.** This screen is **retained as a dev-only validation tool** — accessible via Settings → 5-tap version → Debug Mode → "Mini-Spike B (Mapbox tile)". Production builds are unaffected.

**Original purpose:** before committing Sprint capacity to "Mapbox vector tile + local junction extraction" as the global road-network data source, prove on a real device that the 3 risks below are NOT blockers.

**Time budget:** 1 hour from app open to 3 PASS/FAIL answers.

---

## What this spike is

A single screen (`SpikeMapboxJunctionScreen`) with 3 buttons. Each button runs one self-contained test against the running Mapbox MapView and prints PASS / FAIL / BORDERLINE + raw numbers to an on-screen log. No debugger needed.

---

## How to open it

1. Build the app with `EXPO_PUBLIC_MAPBOX_TOKEN` set (the `@rnmapbox/maps` native module must be compiled in — Expo Go will NOT work).
2. Sign in.
3. Settings → tap version "Cairn v0.1.0" at the bottom **5 times** to enable Debug Mode.
4. Scroll back up to the new **DEBUG** section that appears.
5. Tap **"Mini-Spike B (Mapbox tile)"**.

You should land on a black screen with a small map at the top, three green buttons (Q1 / Q2 / Q3) and an empty log area below.

---

## Q1 — Offline `querySourceFeatures`

**Question:** with airplane mode ON, does the offline pack expose road features through `querySourceFeatures('composite', _, ['road'])`?

**PASS** = offline returns >0 features → vector tile parsing offline is viable.
**FAIL** = 0 features from both `querySourceFeatures` and `queryRenderedFeaturesInRect` → the whole "local junction extraction" plan is blocked. Fall back to Spike C's Overpass-snapshot approach.

### Setup steps

1. **Stay online.** Open the spike screen.
2. Pre-create an offline pack covering the visible area BEFORE the test. The simplest path is to navigate to RoutesScreen → Offline Maps and download "Auckland Region" (or whatever pack covers the area you want to test). The spike screen does NOT create a pack — it just queries one that already exists.
3. Wait for the pack to reach 100%.
4. Return to the spike screen.
5. **Turn airplane mode ON** (system Settings → Airplane mode). Confirm the device shows the offline indicator.
6. Tap **Q1 Offline**.

### What the log will say

```
── Q1: Offline querySourceFeatures ──
offlineManager.getPacks() → 1 pack(s)
  pack="auckland-region" state=2 completed=20580/20580
querySourceFeatures elapsed=87ms
PASS Q1 — got 1247 road features offline
  sample[0] class=secondary, geom=LineString
```

Or:

```
querySourceFeatures elapsed=43ms
querySourceFeatures returned 0; trying queryRenderedFeaturesInRect
FAIL Q1 — 0 features from both query paths.
```

### Expected ranges

- **PASS range:** 50 – 5000 features depending on viewport zoom and density.
- **Borderline:** 1 – 50 features at zoom 14+ usually means the pack covers the area but you're zoomed out too far. Pinch in to street level and re-tap Q1.
- **FAIL:** literal 0 from both query paths.

### Failure → fallback

If FAIL: skip to Spike C's plan B — pre-snapshot Overpass (OSM) data into a static GeoJSON bundle shipped in OTA assets. This is what NZ DOC currently does, just generalized.

---

## Q2 — GPS vs Mapbox tile road offset (China test)

**Question:** does an `expo-location` GPS fix taken in mainland China line up with the Mapbox vector tile road geometry within < 5 metres? If not, we need to convert WGS-84 ↔ GCJ-02 ourselves.

**PASS** = nearest-road distance < 5m → use raw WGS-84, no conversion.
**BORDERLINE** = 5m – 20m → tolerable for hiking-grade snapping but margin is tight.
**FAIL** = > 20m offset → must implement GCJ-02 conversion before shipping in CN.

### Setup steps

1. **Be physically in mainland China**, ideally outdoors with sky visibility, on or directly next to a road. Shanghai's Pudong waterfront, the Bund, or any major street is ideal.
2. **Stand still on a known road** — not in a park, not in a building courtyard. The test measures distance from your GPS to the nearest road centerline; if you're 10m off the road that's not Mapbox's fault.
3. Make sure airplane mode is **OFF** — this test needs fresh tiles, not the offline pack.
4. Tap **Q2 GCJ-02**.

The screen will:
1. Request high-accuracy GPS (up to 15 seconds for the first fix).
2. Recenter the map on the GPS coordinate at zoom 17.
3. Wait 1.5s for tiles to load.
4. Run `queryRenderedFeaturesInRect` for the road layer.
5. Compute perpendicular distance from your GPS to every road segment.
6. Print the minimum.

### What the log will say

```
── Q2: GPS vs Mapbox road offset ──
Acquiring high-accuracy GPS fix (up to 15s)…
GPS lng=121.473760 lat=31.230420 accuracy=4.8m
road features in viewport: 38
analyzed 412 segments / 1842 vertices
nearest road segment distance = 2.34m
PASS Q2 — offset < 5m, no GCJ-02 conversion needed
```

Or, if iOS / Apple Maps did NOT auto-correct:

```
nearest road segment distance = 187.42m
FAIL Q2 — offset 187.4m. GCJ-02 conversion required.
```

### Expected behaviour

- **iOS in CN with Chinese SIM / region:** typically PASS — the iOS location stack auto-applies GCJ-02 ↔ WGS-84 corrections for Chinese providers.
- **iOS in CN with non-Chinese region:** mixed; sometimes FAIL.
- **Android in CN:** depends on ROM. Pure AOSP returns raw WGS-84 → expect 50–500m offset. MIUI / EMUI / OnePlus may auto-correct.

This means a single-device PASS is NOT enough to skip GCJ-02 — repeat on at least one Chinese-ROM Android handset. If that one fails, build the conversion now.

### Failure → next step

GCJ-02 conversion is well-documented (the published "WGS-to-GCJ" + "GCJ-to-WGS" formulas are ~30 lines of JavaScript, no native deps needed). Add it as a pure-JS module and OTA-push.

---

## Q3 — RN bridge cost for ~8000 vertices + UI responsiveness

**Question:** when the road layer in the viewport carries ~8000 vertices, does the RN bridge ship them across in <500ms? Does wrapping the processing in `InteractionManager.runAfterInteractions` plus chunking keep the UI usable?

**PASS** = bridge < 500ms → ship as-is.
**BORDERLINE** = 500–2000ms → ship-able but should split per-tile.
**FAIL** = > 2000ms → must split per-tile and stream incrementally; otherwise UI freeze on every map move.

### Setup steps

1. Navigate the spike map to a **dense urban area** — Shanghai downtown, Auckland CBD, central Beijing — so the viewport contains thousands of road segments.
2. Set zoom to roughly 14 (street grid clearly visible, not too zoomed in).
3. Tap **Q3 Perf**.

The screen runs two phases:
- **Phase A:** raw `queryRenderedFeaturesInRect` with no yielding. Times the bridge cost.
- **Phase B:** same query wrapped in `InteractionManager.runAfterInteractions` + processes vertices in chunks of 500 with `setTimeout(_, 0)` yields between chunks. Times the total.

While Phase B is running, **try tapping the Q1 button**. It should feel responsive — the chunked yield gives RN a chance to dispatch the touch event between chunks. If the screen freezes for >1s while Phase B works, that's the FAIL signal regardless of total elapsed time.

### What the log will say

```
── Q3: 8000-vertex RN bridge + InteractionManager ──
Phase A (no IM): 184 features, 7423 vertices, bridge=312ms
Phase B starting — InteractionManager-wrapped processing…
Phase B (IM + chunked): 184 features, 7423 vertices, total=448ms
PASS Q3 — bridge cost 312ms < 500ms threshold
```

Or:

```
Phase A (no IM): 312 features, 11204 vertices, bridge=2410ms
FAIL Q3 — bridge 2410ms exceeds 2000ms; must split per-tile and stream results.
```

### Expected ranges

| Vertex count | Bridge time (PASS target) |
|---|---|
| < 3000 | < 100ms |
| 3000 – 8000 | 100 – 500ms |
| 8000 – 15000 | 500 – 1500ms |
| > 15000 | likely > 2000ms — must batch |

### Failure → next step

Switch the production design from "query the whole viewport in one call" to "iterate visible tiles, query each separately, merge results". @rnmapbox/maps does not expose per-tile querying directly, but you can split the viewport into 4–9 sub-rects and call `queryRenderedFeaturesInRect` on each, yielding between calls.

---

## Reading the results

Run all three on the same physical device session, in this order: **Q3 → Q1 → Q2** (Q3 needs network; do it before turning on airplane mode for Q1; Q2 needs network back).

Required for "go" decision:

| | Sprint goes ahead | Need fallback |
|---|---|---|
| Q1 | PASS or PASS-via-rendered | FAIL = scrap vector-tile plan |
| Q2 | PASS on iOS + at least one Chinese-ROM Android | FAIL = ship with GCJ-02 conversion |
| Q3 | PASS or BORDERLINE on dense viewport | FAIL = redesign as per-tile streaming |

Record the actual numbers (feature count, distance, ms) for each in `tasks/jira/sprintN/` Sprint planning notes when you make the call.

---

## What this spike does NOT do

- Does not build a junction graph. Just verifies the inputs we'd feed one.
- Does not test routing. Just measures geometry-level access.
- Does not wire into RouteEditor or any other production screen. Pure isolated test surface.
- Does not add native deps. OTA-pushable. The screen and route entry can be removed in one OTA bundle once the decision is taken.

## Cleanup after decision

**Decision taken (2026-06-10): Mapbox vector tile path adopted as the global production data source.** This screen is retained as a dev-only validation tool. To remove access from production builds, the entry point in `SettingsScreen.tsx` is gated by `debugMode` (5-tap version unlock). No removal needed.

If a future Sprint decides to delete the spike entirely:
1. Delete `app/src/screens/SpikeMapboxJunctionScreen.tsx`
2. Remove the `SpikeMapboxJunction` entry from `app/src/navigation/RootNavigator.tsx`
3. Remove the entry block from `app/src/screens/SettingsScreen.tsx` (inside `debugMode` section)
4. Delete this README

All 4 changes are JS-only — OTA-shippable.
