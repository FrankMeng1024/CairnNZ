# Spike Y — Unified 100m Unlock Radius

**Question**: If we unify both initial-reveal and walk-reveal to 100m radius, what H3 resolution fits, is C视觉 still meaningful, and what is the migration cost?

**Current state** (from `activity_sources.md` + `memoryConfig.ts`):
- H3 resolution: **11** (cell radius ~120m, edge ~50m)
- Walk-radius: 25m per GPS point | Initial-reveal: 200m
- Visual: C (奶油 polyline + 25m blob union)

---

## 1. H3 res recommendation: **stay at res 11**

| Res | Cell radius | Cells in 100m circle | Verdict |
|---|---|---|---|
| 13 | ~17m | ~30 | overkill — 30× storage cost, no visual benefit at 100m |
| 12 | ~46m | ~6 | wasteful — 100m circle doesn't need 6-cell mosaic |
| **11** | **~120m** | **1–2** | **1:1 — one stand = one cell. Matches "看用户到过哪" exactly** |

**res 11 was the right pick all along** — the mismatch was 25m radius forced sub-cell precision Cairn never used. With 100m radius the cell IS the unit of "been here". No code change to H3 layer.

---

## 2. C视觉 (cream polyline) — **drop it, go to B (pure circles) or fog-only**

At 25m radius polyline added information: it told you the *path between* sparse circles. At 100m radius adjacent GPS points (typical walking 50–80m apart) produce **fully overlapping circles** — the path is implicit in the blob. The cream line draws over its own fill and vanishes.

Spike H "indoor" failure (25m circle ≈ GPS noise 30m → 'all fail') also disappears: 100m circle absorbs 30–65m city GPS error completely, no false-negative reveals.

**Recommendation**: B (blob union) + per-cell color/age tint. The "game feel" comes from each cell as a discrete **tile that flips on** when stepped into — Pokemon GO / Watch Dogs zone idiom — not from a corridor line.

---

## 3. Visual size at typical zoom

From `reveal_radius_research.md` line 102–114: at zoom 14, **100m = 26 logical-px = clear thumbnail**. At zoom 17 (hike view) it's a 200px disc — readable, not overwhelming. At zoom 12 (city) it's 8px — visible dot. C视觉's pencil-line aesthetic dies at every zoom under 100m radius.

---

## 4. Migration: **no user-visible loss**

Stored unlocks are H3 cell IDs at res 11 (already). Changing the unlock-detection *radius* from 25m → 100m only changes **future** writes; past cells stay valid. Visual reveal mask is computed at render time from the cell set, not stored as polygons.

- ✅ User's existing unlocked cells: preserved, render with new 100m visual
- ✅ DB schema: untouched
- ⚠️ Re-render of past hikes will look fatter (each old GPS point now paints 100m instead of 25m) — this is desired, not regression
- ⚠️ Polyline rendering code (C视觉) becomes dead — strip in v333

If we later changed res (we are NOT), every stored cell ID would be invalid — that's the migration cliff. **Staying at res 11 is the cheap path.**

---

## 5. Performance

res 11 unchanged → `h3Pure.latLngToCell` cost unchanged (~1μs/call, Spike U).
Walk-reveal cell set per hike: 100m radius × 5km hike ≈ 50 cells (vs current 25m → 200 cells). **4× smaller** bulkImport, faster raster rebuild. Spike J's worst-case maxBlock numbers improve.

---

## v333 scope adjustment

This new constraint is **simplifying**, not expanding:

1. ✅ Unify both radii to 100m — single `UNLOCK_RADIUS_M = 100` constant
2. ✅ Delete `initialRevealRadiusMeters` (no special case for first-open)
3. ✅ Drop C视觉 work — go B (blob) as canonical
4. ✅ Keep H3 res 11
5. ✅ Strip cream-polyline rendering code as part of v333
6. ✅ No migration script needed — old cells render naturally with new mask

**Net**: v333 becomes a *deletion* sprint, not an addition sprint. Matches user's "和游戏一样" mental model (discrete tile reveal) and Spike V's Lifelog-派 街区粒度 conclusion more completely than the original C-视觉 plan.
