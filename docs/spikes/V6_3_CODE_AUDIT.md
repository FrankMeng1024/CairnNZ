# v6.3 Code Audit

Fresh-context audit. All numbers are real `wc -l` counts and verified `grep` results. No estimates without evidence.

## Files (real paths + line counts)

| Path | LOC | Notes |
|---|---|---|
| `app/src/store/useRouteEditStore.ts` | **2013** | Zustand store, single biggest file in scope |
| `app/src/services/routing/mapmatch/MapMatchingClient.ts` | **210** | Mapbox /matching wrapper |
| `app/src/services/routing/corridor/PolylineSampler.ts` | **126** | Defines `LngLat = {lng, lat}` (no `alt`) |
| `app/src/components/map/BrushOverlay.tsx` | **200** | Brush gesture overlay |
| `app/src/components/map/EditOverlayV236.tsx` | **515** | Edit toolbar / chrome |
| `app/src/components/map/BrushStrokeLayer.tsx` | **398** | Brush stroke render |
| `app/src/screens/RouteEditorScreen.tsx` | **914** | Top-level editor screen |
| `app/src/services/LocalRouteExtras.ts` | **330** | Persisted extras schema (already `alt?: number\|null`) |
| `app/src/components/OtaBadge.tsx` | **1180** | OTA status pill + version log |
| **TOTAL** | **5886** | |

All paths verified to exist. None NOT FOUND.

## Suspect Code Still Present

### `useRouteEditStore.ts`
- `confidence` (string-tagged segment confidence, not Mapbox 0..1): L347, L1772
- `confidence` (Mapbox numeric): L1657 (`(r.confidence ?? 1) < 0.5`)
- `tracepoint`, `alternatives_count`, `matched_len`: **0 hits** (not present)
- `smoothCatmullRom`: L503 (decl), L1648, L1655, L1667 (call sites)
- `snapDisplacementStats`: L546 (decl), L1651
- `fracBad`: L550, L552, L565, L574, L1652
- `maxDispM`: L550, L552, L565, L1652
- `bearings`: **0 hits** (not used at all)
- `radiuses`: present in store (L1630-L1633) and client (L73, L78, L88)
- `walkedIndex`: 30+ references (lines 129, 363-430, 683-725, 1010, 1083-1493, 1591-1719, 1935-1969, 2006)
- `UndoEntry`: L56 (interface), L127 (field), 5 push sites at L1185, L1361, L1381, L1399, L1479
- `queryTerrainElevation`: **0 hits**
- `.alt` field references: **0 hits**

### `MapMatchingClient.ts`
- `confidence`: L43, L45, L93, L99, L186 (response type + parser + return)
- `radiuses`: L73-88 (URL builder)
- `tracepoint`/`alternatives_count`: **0 hits**
- `bearings`: **0 hits** (not currently sent)

## LngLat Propagation

Files importing `LngLat` from `PolylineSampler` (9 total):

| File | Handles `.alt`? |
|---|---|
| `app/src/components/map/BrushStrokeLayer.tsx` | No |
| `app/src/components/map/DualLineLayer.tsx` | No |
| `app/src/services/routing/corridor/PointCloudIndex.ts` | No |
| `app/src/services/routing/mapmatch/coordSampling.ts` | No |
| `app/src/services/routing/mapmatch/MapMatchingClient.ts` | No |
| `app/src/services/routing/mapmatch/runMapMatching.ts` | No |
| `app/src/services/routing/mapmatch/types.ts` | No |
| `app/src/store/useRouteEditStore.ts` | No |
| `app/src/store/__tests__/validateStrokes.test.ts` | No |

**Zero** files currently reference `.alt` on a runtime LngLat. Persisted schema in `LocalRouteExtras.ts` lines 52 + 59 already declares `alt?: number | null` on the persisted point shape — there is a layer mismatch already.

## useRouteEditStore.ts function breakdown

| Function | Range | LOC |
|---|---|---|
| `validateStrokes` (exported) | L680–L749 | 70 |
| `beginStroke` | L1158–L1201 | 44 |
| `endStroke` | L1223–L1316 | 94 |
| `resetEdits` | L1452–L1502 | 51 |
| `undo` | L1508–L1539 | 32 |
| `runPreview` | L1567–L1727 | **161** |
| `commitEditDraft` | L1847–L1884 | 38 |
| Total of these | — | **490** |

State mutation count (`set(` calls): **54** in this file.
The Zustand store body alone runs from L992 to L~1990 — roughly 1000 LOC of in-place state machine.

## MapMatchingClient.ts current state

- Endpoint: `https://api.mapbox.com/matching/v5/mapbox/walking` (L36)
- Params sent (L82–88): `geometries=geojson`, `overview=full`, `tidy=true`, `access_token=…`, plus `radiuses=…` appended.
- `radiuses`: per-coord, default 50m (clamped 1..50). Caller (`useRouteEditStore.runPreview` L1630–32) sends 6m for endpoints, 12m for middle.
- `bearings`: NOT sent. NOT in URL builder.
- Response parser (L91–100) only extracts `geometry.coordinates` and `confidence`. **Does not** read `tracepoint[]`, `alternatives_count`, or per-leg matched lengths.
- Profile reverted `/driving` → `/walking` at v255 (per L28-35 comment).

## OtaBadge current version

`OTA_VERSION = 255` at line 778. Displayed at L1046 as `v255 · {label}`. v6.3 plan implies bump to **256**.

## Realistic LOC estimate for v6.3 changes

Comparing v6.3 plan claims against what the code actually requires.

### Workstream 1 — 4-gate rewrite (G1+G2+G3+G4)
- Today: gates are scattered throughout `runPreview` (161 LOC), `validateStrokes` (70 LOC), `endStroke` (94 LOC), and helpers `snapDisplacementStats`/`isPointAcceptableEndpoint`/`strokeAnchorsToBaseline`/`smoothCatmullRom` (~150 LOC combined).
- A 4-gate rewrite that subsumes these means ~325 LOC must be deleted/replaced and ~250–350 LOC of new gate logic written.
- **Realistic delta: ~300 LOC of net change in the store file alone**, not 180.

### Workstream 2 — LngLat alt extension
- 9 importer files × 3–5 LOC each = **27–45 LOC**.
- Plus `PolylineSampler.ts` interface + `lerp` + `densify` to carry `alt` = ~10 LOC.
- Plus `MapMatchingClient.ts` parser (matchings strip `alt`) = ~5 LOC.
- **Realistic: ~50 LOC.** Plan figure (if any) of "trivial" understates touch count.

### Workstream 3 — Undo/reset bug fixes (7 items)
- 5 `undoStack.push` sites + 1 `undo` consumer + 1 `resetEdits` clearer.
- Each fix is ~5–15 LOC. **Realistic: ~70 LOC** across 7 items.

### Workstream 4 — UX simplification
- `EditOverlayV236.tsx` is 515 LOC; "simplification" usually trims 30–50%.
- **Realistic: ~150–250 LOC removed, ~50–100 LOC added** = net change ~100 LOC editable.

### Workstream 5 — Telemetry
- Estimate 1 event per gate × 4 gates + lifecycle (begin/end/preview/undo/reset/commit) = ~10 events.
- Each event = ~5 LOC instrumentation + type. **Realistic: ~60 LOC.**

### Workstream 6 — Tests
- Existing: 1 test file (`validateStrokes.test.ts`, 121 LOC).
- 4 gates × 1 test file each + 1 undo/reset suite + 1 telemetry suite = 6 new files.
- **Realistic: ~600–800 LOC of test code.**

### Total realistic v6.3 LOC delta

| Workstream | LOC |
|---|---|
| Store gate rewrite | ~300 |
| LngLat alt extension | ~50 |
| Undo/reset fixes | ~70 |
| UX simplification (net) | ~100 |
| Telemetry | ~60 |
| Tests | ~700 |
| OtaBadge bump | 1 |
| **Total** | **~1280 LOC** |

### Where the v6.3 plan estimate is wrong

The v6.3 plan claims **"180 LOC for store"**. The store today is **2013 LOC** with `runPreview` alone at **161 LOC** and `validateStrokes` at **70 LOC**. A genuine 4-gate rewrite touches at minimum these two functions plus ~150 LOC of helpers — net ~300 LOC of store change is the floor, not 180. The plan also appears to underestimate test scope (one validateStrokes test file exists today; six are needed) and treats LngLat alt extension as zero-cost when it touches 9 importer files. Realistic delivery is **~1280 LOC across ~14 files**, of which ~300 LOC is in `useRouteEditStore.ts` — roughly **1.7× the plan's store estimate** and **7× the plan's total if the plan implied ~180 was the whole job**.
