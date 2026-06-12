# Sprint 67 v245 — Brush + Eraser Route Edit Plan

## Product spec (locked by PO)

User feedback: "Mapbox 经常理解错用户期望"。Replace detour-point system with **brush + eraser** model.

### Edit gesture model
- **Default tool: pan** — map can be panned/zoomed normally on entry
- **Brush tool**: user draws polylines on the map. Each stroke must START
  and END within 50m of the original GPS trace. Middle of stroke can go
  anywhere (color-coded by distance to original).
- **Eraser tool**: drag over any drawn stroke to clip points off it.
- **Undo**: each stroke create + erase + trim drag pushes a snapshot.
- **Reset**: clears all strokes + restores trim 0..1.
- **Save**: validates all strokes, runs Mapbox Map Matching, splices into final route.
- **Cancel**: discards all edits.

### Color rules (rendered live as user draws)
- Distance to original < 400m → sage primary
- 400m ≤ distance < 500m → amber (severityCaution)
- distance ≥ 500m → red (severityDanger)
- Per-point color, not per-stroke (so the user sees exactly which sub-segment is over budget)

### Validation (only on Save)
1. Every stroke has its start AND end within 50m of original — else "Brush N: start/end is not on the route — connect or erase."
2. No stroke point is ≥ 500m from original — else "Brush N: parts beyond 500m — erase the red sections."
3. No two strokes' arc-ranges on original overlap — else "Two brush strokes overlap on the route — erase one."
4. (Implicit) brushStrokes.length ≤ 8.

### Final stitch
For each validated stroke:
- arcStart = arc-length of nearest originalPoints index to stroke[0]
- arcEnd   = arc-length of nearest originalPoints index to stroke[N-1]
- send stroke.points to Mapbox Map Matching → snapped polyline
- splice snapped polyline into originalPoints over [arcStart, arcEnd]
Final matchedPoints = originalPoints with each window replaced by snapped output

### Mapbox cost model

**ZERO Mapbox calls during draw/erase/undo/trim.** Drawing is 100% client-side.

Save: 1 call per stroke (max 8 calls per save).

Session-level cache (already in v244 runMapMatching): repeat saves with same strokes → cache hit, 0 calls.

Failure fallback: if a stroke's Map Matching call fails, use the user's raw drawing as the replacement (better than dropping their work).

## Files

### NEW
- `app/src/components/map/BrushOverlay.tsx` (DONE — 200 LOC)
  - GestureDetector overlay above MapView
  - Calls store.beginStroke / appendStrokePoint / endStroke / eraseAt
  - Uses mapbox.getCoordinateFromView to unproject screen→geo
  - Status hint banner ("Drawing — start on the route" / "Eraser — drag over a stroke")

- `app/src/components/map/BrushStrokeLayer.tsx` (NEW — ~180 LOC)
  - **Rendering = Option A: per-color sub-features**
  - For each stroke, walk its points; classify each segment (between adjacent points) by max(distToOriginal of its two endpoints):
    - max < 400m → severity = 'sage'
    - 400 ≤ max < 500m → 'amber'
    - max ≥ 500m → 'red'
  - Build 3 FeatureCollections (one per severity) where each Feature is a contiguous sub-segment of the stroke with that severity
  - Render 3 LineLayers, one per severity, each filtering on properties.severity
  - lineColor: Colors.primary / Colors.severityCaution / Colors.severityDanger
  - lineWidth: 6, lineOpacity: 0.9
  - **No line-gradient / lineMetrics required** — keeps things simple and survives the eraser-split flow
  - Endpoint markers: small dots at start/end of each stroke (sage if endpoint is within 50m of original, red ring if not — gives live "this stroke is invalid" feedback per Critical-C fix)

- `app/src/components/map/EditTopToolbar.tsx` (NEW — ~120 LOC)
  - Floating top-right toolbar inside the map area
  - 3 tool buttons: Pan / Brush / Eraser
  - Active tool highlighted sage; others gray-bordered

### MODIFIED
- `app/src/store/useRouteEditStore.ts` (DONE — full rewrite, 700 LOC)
  - Replaced viaPoints with brushStrokes
  - New actions: setActiveTool, beginStroke, appendStrokePoint, endStroke,
    eraseAt, removeStroke
  - validateStrokes() helper exported for tests
  - spliceMatched() helper for stitching
  - saveAndExit() runs full validation + Mapbox snap + stitch

- `app/src/components/map/EditOverlayV236.tsx` (~200 LOC)
  - Bottom card simplified: status pill + Undo + Reset + Save + Cancel
  - Status text:
    - default: "{N}/8 brush strokes"
    - if any stroke has start/end > 50m off-route: "Brush K: end off-route" (live, recomputed on every stroke change)
    - if any stroke point ≥ 500m: "Brush K: parts beyond 500m"
    - if any two strokes overlap: "Two brushes overlap"
    - this is the LIVE validation, computed inline (cheap — single pass over all strokes)
  - Trim slider stays
  - Removes "0/5 detour points" + long-press hint

- `app/src/screens/RouteEditorScreen.tsx` (~50 LOC change)
  - Mount BrushOverlay above MapView when activeTool !== 'pan'
  - Mount BrushStrokeLayer always when isEditing
  - Mount EditTopToolbar always when isEditing
  - Disable MapView pan/zoom when activeTool !== 'pan' via these explicit props on @rnmapbox/maps@10.3.1 MapView:
    - scrollEnabled={activeTool === 'pan'}
    - zoomEnabled={activeTool === 'pan'}
    - pitchEnabled={activeTool === 'pan'}
    - rotateEnabled={activeTool === 'pan'}
  - Remove ViaPointLayer mount, remove onMapLongPress for via add

- `app/src/components/OtaBadge.tsx` — bump to 245

### DELETED
- `app/src/components/map/ViaPointLayer.tsx` (DONE)

### TESTS
- `app/src/store/__tests__/validateStrokes.test.ts` (NEW)
  - empty strokes → ok
  - stroke with start off-route → error
  - stroke with end off-route → error
  - stroke with red point → error
  - two strokes overlapping → error
  - two strokes non-overlapping → ok

## Validation pass criteria for subagent

Subagent should fail this plan if:
- Mapbox API is called during draw or erase (not just Save)
- brushStrokes structure can't represent overlapping detection
- No undo support for brush strokes
- Color rendering is per-stroke instead of per-point
- Eraser doesn't actually mutate brushStrokes
- MapView pan stays enabled while brush tool active
- Save flow doesn't validate before calling Mapbox
- Save flow doesn't fall back gracefully when a stroke's MM fails

## Risks

1. **Mapbox getCoordinateFromView async**: every gesture frame triggers an
   async unproject; under fast drag, frames can land out of order →
   strokes look ragged. Mitigation: store.appendStrokePoint already
   downsamples to 5m, but if event order matters, may need to capture
   frame timestamp + reject out-of-order. Track in v246 if observed.

2. **react-native-gesture-handler GestureDetector + Mapbox MapView**:
   v242 trim slider proved this works. Same Gesture.Pan().onUpdate
   pattern.

3. **Eraser radius**: current 25m. May feel small on iPhone SE / large on
   Pro Max. Polish item — tunable later via Settings.

4. **Endpoint snap tolerance**: 50m may be too loose (lets users finish
   strokes far from road) or too tight (gets in the way on shaky drag).
   PO has not specified; 50m is a guess. Polish item.

5. **The arcStart/arcEnd calculation uses nearest originalPoint index**.
   For very long routes (10000+ points) this is O(N) per validation. Fine
   for typical hike (<2000 points).

## Out-of-scope for v245
- Tilequery road-snap pre-check ("can't draw on non-road area")
- Backend persistence of brushStrokes (lost on app kill — only finalized
  geometry persists in workingPoints; matches user's "exit means exit")
- Live preview of Mapbox snap during draw (would defeat cost savings)
