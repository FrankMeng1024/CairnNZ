# Stage 8 Code Review — RouteEditorScreen alt + Terrain
**Verdict**: PASS

## Spec compliance
- §2.2 — alt preserved through 4 strip points: PASS
  - loadSessionTrackPoints: `alt: p.alt ?? null` on both branches (lines 196, 204).
  - smoothed re-attach by index (line 219) — correct because smoothTrackPoints does not propagate alt.
  - tp fallback when smoothed.length < 2 (line 222) — preserves alt.
  - finalPoints derives from draft.workingPoints | existingRoute.points | sessionTrackPoints, all alt-bearing (lines 514-517).
  - lerpLocal (store) preserves alt when both endpoints carry it; null when partial (lines 257-261). Correct semantics.
- §2.3 — DEM backfill: PASS. RasterDemSource + Terrain mounted, guarded by null check + SDK export check (lines 681). queryTerrainElevation polled 200ms × 3, only re-querying still-null indices.
- §2.5 — distance + elevationGain recomputed at save: PASS. Loop at 524-541, skips null/non-finite alt segments, only positive deltas count.
- telemetry `brush_alt_dem_null` wired in store applyMatchedAltitudes (lines 1507-1512).
- back-compat: legacy points without alt → `alt: undefined` flows through; recompute loop skips them. Verified.

## Anti-cheating
- 200ms / 3 retries: not magic — comments at lines 326-329, 346 explain "DEM tiles may not be loaded immediately". Acceptable.
- TODO/FIXME: none found.
- Silent fail: try/catch at lines 351-363 (per-point) and 370-374 (applyMatchedAltitudes call) are narrow + intentional, comment "best-effort; never throw to UI". Acceptable.
- @ts-ignore / any: `let MapView: any` etc. pre-existing module-loader pattern, not new. `(p as any).alt` (lines 203-204) used only because session track point type doesn't declare alt — narrow + reasonable. No new evasion in this stage.

## applyMatchedAltitudes correctness (4 cases)
- Length mismatch → no-op: PASS (line 1487 guards `mp.length !== altitudes.length`).
- Authoritative alt preserved: PASS (line 1500 `if (p.alt != null) return p`).
- null alt + resolved number → upgrade: PASS (line 1501 returns `{...p, alt: resolved}`).
- null alt + still null → keep + count: PASS (lines 1496-1499 increments nullCount only when both null).

## Side-effect safety
- Cleanup `cancelled = true` (line 377) checked at every await boundary (lines 347, 364, 369). In-flight loop bails; final set() guarded.
- Skips when matchedPoints.length < 2 (line 333).
- Skips when SDK lacks Terrain (line 332).
- Skips when no null indices (line 338).
- Effect deps `[editIsOpen, editMatchedPoints]` — re-runs on matched changes; previous loop cancelled cleanly. Acceptable.

## Recommendation
PASS — ship Stage 8. Spec compliance complete, all 4 applyMatchedAltitudes cases correct, anti-cheating clean, side-effect cleanup proper. Minor: effect dep on `editMatchedPoints` reference equality means any unrelated store mutation that re-creates the array will re-trigger DEM lookup; current store code only re-creates matchedPoints on real geometry change, so safe in practice.
