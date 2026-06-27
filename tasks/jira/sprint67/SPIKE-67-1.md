# SPIKE-67-1: Mapbox iOS fog UNION rendering feasibility

**Epic**: E-Friend (Friend System v1)
**Sprint**: Sprint 67
**Sprint Goal**: Establish schema, backend, data foundation, and Mapbox fog UNION feasibility
**Points**: 3
**Owner**: Arch
**Status**: Todo
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
