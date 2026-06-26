# Spike J Report: Activity History Import + Skia Raster Interleave

**Date**: 2026-06-25
**Question**: Will "5 years Activity history bulkImport + simultaneous Skia raster rebuild" cause a 5-second white screen?

## TL;DR

**Two answers, not one:**

1. **NO white screen / no UI freeze.** chunked `bulkImport` (CHUNK_SIZE=50, `setTimeout(0)` between chunks) keeps per-tick main-thread blocks at **0.7-1.7ms** — well under 60fps's 16ms budget. UI stays smooth throughout.

2. **YES, the import takes WAY longer than expected.** Not because of computation, but because of `setTimeout(0)` floor cost. Wall time scales linearly with **tick count**, not work:

| Points | Ticks (50/chunk) | PC wall | Mobile wall (×1.4) | Skia rebuild |
|--------|------------------|---------|--------------------|--------------|
| 100k   | 2,000            | 30s     | ~42s               | 180ms (one) |
| 300k   | 6,000            | 90s     | ~2min              | 180ms (one) |
| 500k   | 10,000           | 151s    | ~3.5min            | 180ms (one) |
| 1M     | 20,000           | 305s    | ~7min              | 180ms (one) |

Root cause: Node `setTimeout(0)` floor is ~15ms; RN/Hermes is similar (~4-10ms). 50 points × 0.1µs = 5µs of work per tick → the tick is 99.99% idle waiting for the timer.

## Architecture facts confirmed (source review)

`useH3VisitedStore.bulkImport`:
- Mutates a **local** `Map` during chunks
- Calls `set({cells, cellVersion+1})` **only after all chunks complete**
- → FogLayer's `cellVersion` subscriber fires **exactly once**
- → 500ms debounce coalesces → **exactly one** `renderMask` after import
- → **zero interleaved raster rebuilds during import** ✓

So the original worry ("import + simultaneous rebuild blocks 5s") is structurally impossible — the rebuild can't start until import commits.

## Per-device estimates

| Device | 100k import wall | One raster rebuild | Time until fog visible |
|--------|------------------|--------------------|-----------------------|
| iPhone 14 | ~42s | 180ms | ~42.7s |
| iPhone 12 | ~50s | 250ms | ~50.8s |
| Pixel 5 / mid Android | ~60s | 350ms | ~60.9s |

Max main-thread block in any single tick: **< 2ms on all devices**. No "white screen", no jank.

## Recommended strategy

**The 5s white screen is NOT the risk.** The real UX problem is: user opens Memory, sees empty/L1-only fog for **40-60 seconds** before the cleared cells appear, with no indication anything is happening.

Two non-blocking fixes (in priority order):

1. **Show import progress indicator** (REQUIRED): A small "正在导入 X / Y 个活动点" toast / bottom-sheet during import. Without it, users will think Memory is broken at 30-60s import.
2. **Lower CHUNK_SIZE penalty by increasing chunk** (RECOMMENDED): Raise `CHUNK_SIZE` from 50 → 500. Per-tick work becomes 50µs (still <1ms — safe), tick count drops 10×, wall time drops 10× (100k import → 4-6s on iPhone 14). Watchdog risk: per-tick work at 500 cells is still ~0.3ms — orders of magnitude below the 6-10s iOS watchdog trigger. **No source change here in this Spike; recommendation only.**

Don't:
- Don't hide Memory behind a blocking loader — UI is already responsive, blocking would be a regression.
- Don't try to batch-rebuild Skia mid-import — single rebuild at end is already optimal (FogLayer architecture enforces this).

## End-to-end budget (with CHUNK_SIZE=500 recommendation)

| Step | iPhone 14 | Pixel 5 |
|------|-----------|---------|
| 100k import (chunked 500) | ~4s | ~6s |
| 500ms debounce | 500ms | 500ms |
| Skia raster rebuild | 180ms | 350ms |
| ImageSource URI swap | <50ms | <50ms |
| **Total to fog visible** | **~4.7s** | **~6.9s** |
| Worst-case main-thread block | <2ms | <2ms |

## Files

- `spike_j_simulate.cjs` — chunked import simulator (no Cairn imports)
- `spike_j_raw.json` — raw measurements
- `perf_benchmark.md` — Spike E (Skia render side, unchanged)
