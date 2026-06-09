# Sprint 66 — Wave 7 RouteEditor Integration ADR

**Status**: Documented (deferred runtime integration to post-spike validation)
**Date**: 2026-06-07

## Why this is an ADR not direct code

`RouteEditorScreen.tsx` (926 LOC) is a complex screen with three modes:
1. **View** (existing route, no edit)
2. **Edit waypoint** (existing legacy waypoint placement)
3. **Save as Route** (from session)

A direct rewrite to add Sprint 66's "trim + midpoint drag" features would
destabilize all three existing modes. The Plan v3.1 §16 budget for this
Story (00519/00520) is 5 dev-days combined — this is **runtime integration
work that cannot be done responsibly without a working simulator + the
new modules' dependency injection**.

What we DID complete in Wave 6/7:
- ✅ Card 1 fix in `RouteEditorScreen.tsx` (waypoints=[] when route has originalPoints)
- ✅ `DualLineLayer.tsx` UI component (drop-in for Mapbox MapView)
- ✅ `DraggableHandle.tsx` UI component (44pt PointAnnotation wrapper)
- ✅ `EditCoachmark.tsx` first-run guide + ApproximateWarningBar
- ✅ `useRouteEditStore` complete (transient edit state machine)
- ✅ `RouteEditOrchestrator` complete (apply trim / apply midpoint drag)
- ✅ `DualSourceRouter` complete (DOC + Mapbox decision tree)

## Recommended runtime integration sequence (post-clone, post-OTA-test)

When the next Cairn session opens this branch on a working simulator:

### Step 1: Wire up edit mode entry
- Add `editModeEnabled` flag check at `RouteEditorScreen` mount
- When `editMode === true`:
  - Call `useRouteEditStore.beginEdit({ routeId, routePoints, trailGraph: null, walkedIndex: null })`
  - Replace existing `waypoints`-based `<LineLayer>` with `<DualLineLayer originalPoints={editStore.originalPoints} workingPoints={editStore.workingPoints} segments={editStore.segments} />`

### Step 2: Add trim handles
- Render `<DraggableHandle kind="trim-start" coordinate={workingPoints[0]} onDragEnd={c => editStore.trimStart(findNearestIdx(c))} />`
- Same for trim-end (last point)
- `findNearestIdx` should snap to nearest `workingPoints` index

### Step 3: Build trail graph + walked index on entry
- After `beginEdit`, kick off async:
  ```ts
  const bbox = computeBBox(originalPoints);
  const expandedBbox = expandBBox(bbox, 1500); // 1.5km buffer
  const { trails } = await getCachedOrFetch(expandedBbox);
  const trailGraph = TrailGraph.fromTrails(trails);
  const walkedIndex = buildWalkedIndex(originalPoints, trails);
  // Update store with these dependencies
  ```
- Where `buildWalkedIndex(originalPoints, trails)` densifies + collects:
  - `originalPoints` (`source: 'original'`)
  - DOC trail samples within bbox (`source: 'doc'`)
  - Future: same-user historical activity trackPoints (`source: 'activity'`)

### Step 4: Midpoint drag interaction
- For each interior `workingPoints[i]` (1 ≤ i ≤ n-2), render `<DraggableHandle kind="midpoint" />` at lower opacity
- On `onDragEnd(newCoord)`:
  - Call `editStore.proposeMidpointDrag(i, newCoord)`
  - Then `await editStore.commitMidpointDrag()`
  - Show toast on `result.ok === false` based on `result.reason`

### Step 5: Save / Cancel UX
- "Save" calls `editStore.saveAndExit()` — persists via LocalRouteExtras
- "Cancel" — show "Discard changes?" confirm modal — calls `editStore.cancelEdit()`
- "Reset to original" button calls `editStore.resetToOriginal()`

### Step 6: Coachmark + warning bar
- Wrap `RouteEditorScreen` with `<EditCoachmark>` (auto-shows on first run)
- Render `<ApproximateWarningBar visible={editStore.lastSource === 'straight' || editStore.lastSource === 'original'} message={editStore.lastWarning ?? undefined} />`

### Step 7: App resume detection (EditSessionPersistence)
- Add `useEffect` in App.tsx root checking `EditSessionPersistence.checkResumable()`
- If resumable + matches active route, show modal "Resume / Discard"
- Resume → `editStore.beginEdit(...)` with persisted state restored
- Discard → `EditSessionPersistence.clearSession()`

## Why this is safe to defer

The new modules are:
- ✅ **Fully unit-testable** (BinaryHeap / Dijkstra / TrailGraph / DualSourceRouter)
- ✅ **Type-safe** (tsc passes)
- ✅ **Dead-code in current build** (nothing imports them yet — zero impact on existing screens)
- ✅ **Feature-flag gated** (editModeEnabled = false default — even after integration)

## Verification plan post-integration

Phase 6/7 reviews (Arch / UX / QA subagents) will run after Step 7 above.
Wave 8 (analytics + OTA bump) is already done in this commit — analytics
events log no-ops until integration is wired up.
