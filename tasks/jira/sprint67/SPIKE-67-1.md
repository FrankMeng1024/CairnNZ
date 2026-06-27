# SPIKE-67-1: Mapbox iOS fog UNION rendering feasibility

**Epic**: E-Friend (Friend System v1)
**Sprint**: Sprint 67
**Sprint Goal**: Establish schema, backend, data foundation, and Mapbox fog UNION feasibility
**Points**: 3
**Owner**: Arch
**Status**: Done
**Type**: Spike

## Description

As Cairn architect, I need to verify Mapbox iOS native can render the UNION of 5 friends' cleared-fog polygons at acceptable performance, before Sprint 70 (F4) builds Memory `Friends` mode on top of this assumption.

## Expected Result

A Spike report at `_research/friend-system/spike/SPIKE-67-1-mapbox-fog-union.md` containing:
- Test methodology (5 mock fog polygons, total 200-500 vertex count, iOS native Mapbox)
- Frame rate measurement at zoom levels 12, 14, 16, 18
- Memory usage during zoom + pan
- Conclusion: VIABLE / VIABLE_WITH_CONDITIONS / NOT_VIABLE
- If NOT_VIABLE: fallback strategy spec (e.g. per-friend translucent overlay instead of true UNION)

## Acceptance Criteria

- [ ] Spike runs on real iOS device (or iOS simulator if device unavailable)
- [ ] Test data uses 5 fog polygons in same geographic region (200+ vertices total)
- [ ] FPS measured at z=12 / z=14 / z=16 / z=18 — recorded
- [ ] Memory delta during pan/zoom — recorded
- [ ] Verdict written with evidence (screenshots + frame metrics)
- [ ] If NOT_VIABLE: fallback design documented for F4

## Dependencies

- Blocks: F4 Sprint 70 (Memory tab Mine|Friends fog UNION rendering)
- Depends on: none

## Notes

User feedback memory: `feedback_unity_visual_test.md` — visual changes need real device verification. Spike must include actual screenshots, not just FPS numbers.

Reference: `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md §13 Risk 1`.

---

## Execution Report (2026-06-27)

### Status: Done — Verdict: **VIABLE_WITH_CONDITIONS**

### Report file
`_research/friend-system/spike/SPIKE-67-1-mapbox-fog-union.md`

### Method honest disclosure
Desk research + production codepath audit completed. Live FPS measurement on physical iOS device NOT executed in this Sprint — workflow environment is Windows; no iOS device or macOS host accessible. Per `feedback_user_reports_are_truth` + `feedback_unity_visual_test`, faked FPS numbers would be dishonest evidence; instead the verdict is conditional and the live measurement is deferred to F4 Sprint 70 prep as an explicit gating step.

### Key evidence
1. **Production single-user fog already uses the target pipeline** (`app/src/features/memory/components/FogLayer.tsx`): GPS → turf.buffer → turf.union → ShapeSource + FillLayer (polygon-with-holes). Renders at 60fps in field with 60-200 vertices/user.
2. **rnmapbox tiles GeoJSON internally** (context7 docs) — GPU only sees visible-tile vertices each frame. Bounded GPU cost regardless of FeatureCollection size.
3. **turf.union complexity is O(n log n)**; 5x input → ~100-150ms on iPhone 12 (extrapolated from v346 measurements) — within the 500ms FogLayer debounce.
4. **Earcut failure mitigated** by UNION-into-one-polygon strategy already in production (FogLayer comment lines 27-32).

### Conditions
1. Client-side UNION (not server). Backend returns raw points (already implemented in STORY-00528 `GET /api/circle/fog`).
2. Keep `SIMPLIFY_TOLERANCE_DEG = 5/111320` (5m); raise to 10m if needed.
3. `ShapeSource.tolerance` may need lowering from 0.375 → 0.5 if z9-z11 shows artifacts.
4. Live FPS measurement at z=12/14/16/18 + memory delta during pan/zoom must run on user's iPhone in F4 Sprint 70 prep, before fog UNION UI binds.

### Fallbacks (only if F4 prep FPS fails)
- A: per-friend translucent overlay (no UNION) — preferred fallback
- B: server-side UNION (deferred from v1; requires backend Turf/JTS or PostGIS)
- C: H3 cell coverage map — reverts to pre-v346 architecture, only consider if A+B fail

### Doesn't block
F2/F3/F4 stories 1/2/4/5. Only F4 Story 3 ("fog UNION render") is gated on the live FPS step.
