# v383 OTA — Full Implementation Plan

> **Goals**: (1) raise mock-data realism to user's "real hike" bar; (2) make Memory-map and Flag-detail pins match `round2-family4-1-v10.html` exactly; (3) introduce zoom-responsive Pin rendering via SymbolLayer + baked sprite atlas.
> **Stack**: Expo + React Native + `@rnmapbox/maps@10.3.x`, backend `cairn-backend` Aliyun docker, base URL `https://api.yiiling.cn`.

---

## A. Mock Data Quality

### A1. Root-cause matrix

| Symptom | Most-likely root cause | How to verify before fixing |
|---|---|---|
| **回头路 (out-and-back doubling)** | Mock script feeds `WALKING_LOOPS[uid]` to Mapbox `/matching/v5/mapbox/walking` as an explicit closed waypoint list ending at the start. The matching API treats this as a directed sequence — if a waypoint pair forces two-way travel on the only available walking edge, Mapbox will retrace the same edge. Compounded by `radiuses=25`: any waypoint that sits ON the centreline but only ~5m from the wrong-direction lane snaps backward. | (a) curl the exact matching URL the mock script builds for Alice (uid 19), inspect the GeoJSON polyline. (b) Re-run with `tidy=true` + per-coord radiuses 10m and check whether duplication disappears. (c) Cross-check by feeding Alice's waypoints into the client `snapTrack.ts` pipeline. |
| **穿楼小路 / 直线穿空地** | Two causes mixed: (1) Mock script's `densify(snapped, spacing_m=15)` runs AFTER matching. Mapbox returns a coordinate sequence sampled at road-vertex density (typically 5–15m on Shanghai walking edges). The densifier then linearly interpolates between those vertices, creating a chord at any sharp corner — chords cut buildings. (2) `radius=25` is too lax for dense urban grid: when the input waypoint is between two parallel alleys ~30m apart, Mapbox can snap to either, then the next waypoint pulls back across a courtyard. | (a) Diff `snapped` (Mapbox output) vs `dense` (after densify) on Alice's loop. Any new segment whose midpoint is NOT within 5m of `snapped` polyline = a chord. (b) Re-run with radius=10 vs radius=25, compare. |
| **Memory 不同步** | `wipe_user_data()` in `mock_via_real_api.py` deletes sessions and markers but explicitly skips memory_points. Backend already exposes `DELETE /api/memory/points` (`backend/src/routes/memory.js:180`). Mock never calls it. So second run = clean session/markers + stale memory_points from previous loop + new memory_points appended. Fog cleared along both old AND new path. | (a) Run mock once, query `SELECT COUNT(*) FROM memory_points WHERE user_id = 19`. (b) Run mock again, query again — count should grow, not stay flat. |
| **皇冠 only, 没圆 in Memory map** | (i) iOS PointAnnotation child clipping: v382 attempted fix by stacking crest above core in a flex column inside parent View bounds. Total height = `PIN_SIZE + CREST_H + 4 = 72`. Anchor defaults to View centre, so the bottom 36px hosts the core. If iOS truncates at frame edge or after a layout race, the bottom half (core) is what gets cut — opposite of v381. (ii) Older bundle on device: if testing an old build, v382 fix component not loaded — runs v381 code, bug presents as v381 did. | (a) Force-quit & relaunch, confirm `v381.cairn_pins_render` log fires. (b) Native iOS screenshot, zoom in pixel-level — is the core fully missing or just clipped at bottom edge? |
| **Flag detail 皇冠离圆很远** | `MarkerDetailScreen.tsx:222` wraps `<CairnPin>` in `<View style={{ transform: [{ scale: 0.75 }] }}>` inside a `<PointAnnotation>`. The scale shrinks the 72-tall column but PointAnnotation anchors to unscaled centre, so the crest "moves up" relative to where it visually should sit. Inner column has `marginBottom: 2` between crest and core, becoming ~1.5px after scale. Fundamentally: RN uses flex column (crest stacked above core) while v10 HTML uses `position: absolute; top: -2px` (crest overlapping core by ~6px). | Side-by-side screenshot of v10 HTML pin vs current iOS pin. Measure crest-to-core gap. |
| **皇冠颜色太淡** | RN renders flat `fill={tierColour}` with NO shadow/glow. v10 HTML applies `filter: drop-shadow(0 0 4px var(--tier-glow)) drop-shadow(0 1px 1px rgba(0,0,0,0.5))`. RN code uses neither. react-native-svg supports SVG `<Filter>` on iOS / web but support is incomplete on Android. | Inspect rendered SVG on device — no shadow. |

### A2. Fix proposals (mock data)

**A2.1 — Profile choice**
- **Stay on `walking`** for the 8 mock accounts. All on Shanghai 静安 grid (康定路 / 武定路 / 延平路 / 胶州路 — all walkable). `cycling` would route on motor-vehicle-OK roads but gains nothing here.
- Add explicit rule in script header: "profile=cycling for urban accounts where walking edges return NoSegment; profile=walking otherwise. Default walking. Log the choice."

**A2.2 — Radius default**
- **Default to 10m** (matches `snapTrack.ts:ACC_RADIUS_MIN`, production client floor).
- Add `--snap-radius` CLI arg. Any waypoint that fails to match at 10m gets logged `MOCK.snap_widen uid=… wp=… r=10→25`, then re-tried at 25 individually.
- Build URL with per-coord radius array (mirror snapTrack.ts approach).

**A2.3 — Densify removal**
- Delete `densify()` call from per-user flow. Mapbox returns geometry already at road-vertex spacing.
- After removal, `len(route_points)` shrinks (typically from ~80 to ~25 for Alice's loop), `ts_step` grows from ~6 s/pt to ~20 s/pt. Realistic enough.
- **Better — distance-proportional ts**: compute per-segment Haversine `d_i` on snapped polyline, scale to total `duration_s`, assign `ts_i = start_ms + (sum(d_0..i) / total_d) * duration_s * 1000`. For v383, simple linear is fine.

**A2.4 — Memory wipe**
- Backend has `DELETE /api/memory/points`. Mock adds one line:
  ```python
  http_delete(f"{BACKEND}/api/memory/points", headers=h)
  ```
- Sanity check: `GET /api/memory/points?limit=1` should return empty before re-upload.

**A2.5 — Waypoint reselection via Directions API**

Decision criteria for v383 waypoints:
1. Each pair of consecutive waypoints must be ≥ 80m apart.
2. Each waypoint must sit on a road Mapbox confirms walkable.
3. No closed-loop topology where the only return is the same edge — use 3-6 distinct one-way arcs meeting at intersections.
4. Total path ≥ 800m, ≤ 3km.
5. Pairs separated by < 30m on parallel alleys → eliminated.

**Process — switch from Matching to Directions**:
1. Pick a start anchor (validated on Mapbox geocoding to be ON a walking edge).
2. Call Mapbox Directions API (not Matching) with `profile=walking`, a destination anchor 800-1500m away. Get the full route — already a valid walking polyline.
3. If loop required, call Directions again from destination back to start via a different waypoint.
4. Concatenate. Skip matching entirely — Directions output is already road-snapped at road-vertex density.

Why better than Matching: Matching is for "I have noisy GPS, snap it back". For mock we have intent, not GPS. Directions answers intent directly. No radius tuning, no `tidy=true`, no densify.

**A2.6 — Marker placement**
- After A2.5, marks should sit ON the polyline (offset = 0). Drop the ±15m perpendicular offset hack.
- Keep MARKS_PER_USER counts: LDY 8, Alice 6, Stranger/Carol 2-3.

**A2.7 — Public marker handling**
- Backend rejects `permission='public'` on client writes. Mock script silently demotes to `group` → Stranger 1/2/3 + Carol currently produce Friend-tier marks, not Public.
- For v383: seed Public marks via SQL `backend/scripts/seed/public_marks_v383.sql`. Mock script handles only Friend + Personal via API.

### A3. 8-account Playwright review (4-eye gate)

1. **Mock harness**: script writes each user's snapped polyline to `backend/scripts/seed/output/v383/<uid>.geojson`.
2. **Preview page**: new Node script `scripts/preview-mock-routes.mjs` serves a local `mock-preview.html` with 8 Mapbox Web GL panes (one per uid) showing polyline + planted markers.
3. **MCP Playwright**: navigate, screenshot each pane at zoom 16 + 14 → 16 PNGs into `docs/mock-review/v383/`.
4. **4 eyes** (main + sub#1 + sub#2 + user) independently flag: polyline crosses building, backtracks, markers off polyline > 25m, density unrealistic.
5. **Gate**: any flag → reselect waypoints for that uid, repeat. No OTA until all 4 reviewers approve all 8 uids.

---

## B. Pin Visual Restore to v10

### B1. Why "皇冠 only, 圈丢" on Memory map

Three differences vs v10 HTML:

1. **Layout model wrong**. v10 uses `position: absolute; top: -2px` (crest overlaps core's top by ~6px). RN uses flex column with `marginBottom: 2` (separation). Even when both render, visual gap is wrong.
2. **PointAnnotation child clipping on iOS @rnmapbox/maps@10.3** — known long-standing issue. v382 made parent View tall enough (72px) but anchor defaults to View centre, so geographic lat/lng lands at column centre. When user pans and View needs redraw at screen edge, iOS may clip lower half → "皇冠 only, 圈丢".
3. **Z-order**: RN renders later-children on top. Crest first then core means core covers crest's bottom. v10 has `.crest { z-index: 3 }` so crest is on top. After moving crest to position-absolute with negative top, this matters.

**Root-cause fix**: rewrite layout to match v10 exactly + Memory map uses SymbolLayer (section C) which doesn't have PointAnnotation-clip issues at all.

### B2. Flag detail "crest far from circle" — fix

`MarkerDetailScreen.tsx` is NOT under PointAnnotation-clipping pressure — hero map has only one pin, View can be tall.

1. Delete `transform: [{ scale: 0.75 }]` wrapper.
2. Inline v10 layout directly (or extract shared `CairnPinV10` that doesn't assume PointAnnotation):
   - Parent: `width: 52, height: 60, position: 'relative'`
   - Crest: `position: 'absolute', top: -2, left: '50%', marginLeft: -10, width: 20, height: 16, zIndex: 3`
   - Core: `marginTop: 8, width: 44, height: 44, borderRadius: 22`
3. Render at 1.0× scale, not 0.75. The 0.75 was a hack to compensate for bad layout.

### B3. Crest colour too light — fix

Pragmatic for v383:
1. **iOS + Web**: SVG `<Filter id="crestGlow">` with two `<feDropShadow>`.
2. **Android fallback (react-native-svg ignores filters)**: render crest as doubled-up SVG — slightly larger underneath in glow colour (8% opacity expand) + main on top.
3. **Recommended for v383 (cross-platform reliable)**: skip SVG filters. Make crown 24×20 (was 20×16) AND add stroke: `<Path stroke="#1a1612" strokeWidth=0.5 fill={tierColour} />`. Stroke darkens silhouette enough to read against the map.
4. **SymbolLayer path (C)**: sprite baking includes full v10 glow in PNG → cross-platform divergence vanishes. v383 ships both: legacy PointAnnotation gets stroke fallback; SymbolLayer gets baked PNG.

### B4. v10 HTML as baseline — Playwright workflow

1. **Pre-step**: open v10 HTML in MCP Playwright. Screenshot each of 15 matrix cells at viewport zoom 100% → `docs/ux/mark-tier-explorations/baseline/v10-<tier>-<type>.png`. Also 3 crest zoom badges → 18 baseline PNGs.
2. **Mid-implementation**: RN web build, same viewport. Screenshot 15 pins side-by-side → `docs/ux/mark-tier-explorations/v383-rn/<tier>-<type>.png`.
3. **Diff**: MCP Playwright pixel diff or SSIM via small Node helper. Threshold: SSIM ≥ 0.92 acceptable. < 0.92 = blocker.
4. **iOS native check**: after web passes, install on iOS sim, open MemoryScreen with 5 self markers, screenshot at zoom 16. Compare to baseline + Expo web screenshot.

---

## C. Pin Zoom Scaling (SymbolLayer + Sprite Rewrite)

### C1. Why PointAnnotation can't zoom-scale

`<PointAnnotation>` renders each marker as a separate native subview anchored at a coordinate. Screen-pixel size is fixed — ignores zoom. To zoom-scale would require `onCameraChanged` per frame → render thrash, frame drops, react-native-svg re-rasterization jank.

`<SymbolLayer>` renders icons via Mapbox's native GL engine, scales via `iconSize` with GL-side zoom interpolation (declarative function of zoom). Scaling on GPU, smooth, no JS round-trip.

### C2. How many sprites

3 tiers × 5 types = 15 main pins + 3 tier-keyed mystery pins = **18 sprites**. Stranger blurred pin = 19th. Bake at 3× resolution (52px design → 156px PNG) for retina.

Do NOT bake one per zoom level. SymbolLayer's `iconSize` interpolates over zoom natively.

### C3. Sprite generation strategy

**Chosen**: drive Playwright (same code path as B4 baseline shoot) to render each of 19 pins at 156×180 px → PNGs in `app/assets/mark-pins/v10/`. Zero runtime fragility.

**Feed mechanism**: rnmapbox `<Images images={{ 'pin-self-cairn': require('./pin-self-cairn.png'), ... }} />`. TS index file enumerates the `require` statements.

Rejected: `expo-image-manipulator` (cold-start cost), inline data-URI (iOS `file://` silent failure per memory note).

### C4. Wiring onPress to existing sheets

```jsx
<ShapeSource id="cairn-pins" shape={featureCollection} onPress={onSymbolPress}>
  <SymbolLayer id="cairn-pins-layer" style={{ iconImage: ['get', 'sprite'], iconSize: [...] }} />
</ShapeSource>
```

`onSymbolPress` receives `e.features[0]` with `properties: { id, tier, type, explored }`. Sets selection same as PointAnnotation path. `MysteryCairnSheet` / `RevealedCairnSheet` mount unchanged.

Stranger marks: second `<ShapeSource>` + `<SymbolLayer>` with `iconImage: 'stranger-blur'`, no `onPress`.

### C5. Zoom range & hide threshold

| Zoom | Pin behaviour |
|---|---|
| ≥ 17 | iconSize = 1.0 |
| 16 → 17 | iconSize 0.85 → 1.0 |
| 14 → 16 | iconSize 0.65 → 0.85 |
| 12 → 14 | iconSize 0.4 → 0.65, iconOpacity 0.6 → 1.0 |
| < 12 | iconOpacity 0 (hidden) |

Implementation:
```js
iconSize: ['interpolate', ['linear'], ['zoom'], 12, 0.4, 14, 0.65, 16, 0.85, 17, 1.0]
iconOpacity: ['step', ['zoom'], 0, 12, 0.6, 14, 1.0]
```

Also: zoom ≥ 17 → `iconAllowOverlap: false`. zoom < 14 → `iconAllowOverlap: true`.

---

## D. 4-Eye Review Workflow

### D1. Plan stage (NOW)

- **Subagent #1 (Opus)** — reviews Section A only. Independent.
- **Subagent #2 (Opus)** — reviews Sections B + C. Independent.
- Both parallel via Task tool; outputs at `docs/plan/v383-plan-review-1.md` and `…review-2.md`.
- Main agent reconciles into `docs/plan/v383-plan-final.md`.
- User approves before code is written.

### D2. Implementation stage

Each commit slice gets 2 subagent reviews BEFORE running on device. They read the diff cold (no prior context) and flag.

### D3. Pre-OTA Playwright visual gate

1. Mock review — 16 mock-route screenshots approved by 4 eyes.
2. Pin baseline — 18 v10 PNGs stored.
3. Pin RN web — 15 PNGs, SSIM ≥ 0.92.
4. Pin iOS sim — 5 self pins on Memory map at zoom 16.
5. Detail screen — 1 screenshot.
6. Zoom scaling — 3-sec video, pinch zoom 17 → 11, smooth scale + fade out by 11.

### D4. OTA gate

OTA pushes only when all 6 in D3 pass + user explicitly says "ship v383" + release notes drafted.

---

## E. Implementation order

1. **Plan review** — 2 subagents + user approval. Blocker.
2. **Parallel tracks**:
   - **2a** Mock data rebuild (`mock_via_real_api.py` + `public_marks_v383.sql`)
   - **2b** Pin visual restore — extract `CairnPinV10.tsx`, fix layout, use in `MarkerDetailScreen.tsx`
   - **2c** SymbolLayer pipeline — `scripts/build-pin-sprites.mjs`, extend `mapboxAdapter.ts`, rewrite `CairnPinsLayer.tsx` body
   - **2d** Playwright harness — mock-preview page, v10 baseline, SSIM helper
3. **4-eye review per track**.
4. **Integration smoke** — iOS sim + Android device.
5. **Playwright gate** (D3).
6. **OTA push** (D4).

Sequence: 2b → 2c (both touch `CairnPinsLayer.tsx`). 2a, 2d parallel with both.

---

## F. Risk register

| Risk | L | S | Mitigation |
|---|---|---|---|
| rnmapbox SymbolLayer + Images on iOS 17.x flaky cold-start | M | H | Preload `<Images>` above SymbolLayer; force noop camera nudge on map load. Keep PointAnnotation legacy path behind feature flag for OTA-disable. |
| Wrong mock waypoints ship to user | L | M | 4-eye gate. Rollback path: revert mock script to v382 + re-seed. |
| iOS native crash on SymbolLayer + custom image | L | H | EAS dev build smoke on iOS sim + physical iOS device BEFORE production OTA. |
| `DELETE /api/memory/points` cascades to 9163 | VL | C | Endpoint is per-authenticated-user. 9163 not in mock account list. Add explicit `ALLOWED_UIDS = {19,20,21,23,24,25,26,27}` check in mock script. |
| react-native-svg filter not rendering on Android | H | L | Already mitigated by B3 stroke fallback. |
| Sprite asset bloat | L | L | 19 PNGs × ~3KB = 60KB. Negligible. |
| Playwright MCP unable to render Expo web | M | M | Fallback to manual local dev server + headed Chromium screenshot. |
| Mapbox Directions returns no walking route between waypoints | L | M | Retry with cycling profile, log fallback. If still none, continue with other 7 users. |

---

## Open questions for user before implementation

1. Should the 4-eye visual review include screenshots from a physical iOS device in addition to simulator? (Rec: yes for D3 final gate, simulator-only for iteration.)
2. Crest glow — stroke fallback for v383 (cross-platform reliable), revisit native drop-shadow later? Or invest in react-native-svg `<Filter>` now? (Rec: stroke for v383.)
3. SymbolLayer should be the ONLY path, or keep PointAnnotation as feature-flagged fallback? (Rec: keep fallback for OTA-disable safety.)
4. New mock waypoints derived from Directions — commit both input anchors AND the resulting GeoJSON snapshot for reproducibility? (Rec: yes.)
