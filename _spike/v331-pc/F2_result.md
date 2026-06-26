# F2 — Mapbox Synthetic Repro Result

**Goal**: Reproduce the Cairn fog checkerboard artifact using **pure mapbox-gl-js** (no React Native, no Cairn code), to prove the root cause is in Mapbox upstream (`geojson-vt + earcut` per #7023 / #14316), not in Cairn.

**Date**: 2026-06-25
**File**: `_spike/v331-pc/F2_mapbox_synthetic_repro.html`
**Stack**: mapbox-gl-js v3.8.0 (CDN), single HTML, no npm.

---

## What the HTML does

1. Loads mapbox-gl-js v3.8.0 from CDN with the Cairn project's real public token (read from `app/.env`).
2. Builds a synthetic GeoJSON identical in structure to Cairn's `fogGeoJSON`:
   - **Outer ring**: world bbox `(-179.9, -85)` → `(179.9, 85)`, CCW.
   - **500 random 25 m × 25 m holes**, CW, scattered in a 5 km radius around Shanghai (lat 31.232, lng 121.457). Cell size = Cairn's `CELL_M`.
   - Hole positions seeded with `mulberry32(42)` so screenshots are reproducible run-to-run.
3. Adds a `FillLayer` (`fill-color: rgba(58,42,24,1)`, `fill-opacity: 0.58`, `fill-antialias: true`) — matches Cairn's dark sepia fog paint.
4. Adds a hidden `LineLayer` (cream `#f5e6c8`, width 2). Toggle via checkbox.
5. UI panel: zoom slider (z=8 → z=18), quick-jump buttons (z=8, 10, 14, 18), `fill-antialias` toggle, `LineLayer` toggle, "Auto sequence" button.
6. **Auto-sequence** kicks off 3 s after `map.load`: cycles through z=14 → z=10 → z=8 → z=14 → z=18 with 1.5 s dwell per step. Page title updates (`F2 AT z=8` etc.) so an external automation can detect each step.

---

## Expected visual outcome (per Mapbox bug #7023 / #14316)

| Zoom | Expected |
|------|----------|
| z=14 | Clean: 500 small square "windows" of basemap visible through dark fog. No vertical/horizontal cuts. |
| z=10 | Tile boundaries start to show as faint vertical lines (web mercator tile seams where earcut re-triangulates the world outer ring against tile clip). |
| z=8  | **Checkerboard artifact**: large vertical bands of inconsistent fog opacity, light/dark stripes aligned to z=8 tile grid (each tile = ~155 km wide at this lat). This is the same pattern Cairn users report. |
| z=18 | Clean again: at deep zoom the user's local area is rendered from a single tile, so geojson-vt's per-tile earcut produces consistent output. |

The artifact appears because `geojson-vt` clips the world-spanning outer ring into per-tile pieces before earcut triangulates each piece. With holes that don't intersect a given tile, earcut still has to triangulate the outer ring at that tile, and the resulting triangle fan is sensitive to clip geometry. At low zoom, slightly different clip polygons across adjacent tiles produce slightly different fill coverage at the seam — visible as a checkerboard.

---

## Playwright MCP run attempt

Tried `mcp__playwright__browser_navigate` to `file:///C:/ClaudeCodeProjects/Cairn/_spike/v331-pc/F2_mapbox_synthetic_repro.html`. **Failed** with:

```
browserType.launchPersistentContext: Failed to launch the browser process.
[pid=14928][out] Opening in existing browser session.
[pid=14928] <process did exit: exitCode=0, signal=null>
```

Chrome's user-data-dir (`C:\Users\I585134\AppData\Local\ms-playwright\mcp-chrome-72b2069`) is locked by an already-running Chrome instance, so Playwright's persistent context launch returns immediately to the existing session and the page is never owned by the automation. Retried — same failure. This is an environment issue (concurrent Chrome session), not a problem with the HTML.

**No `F2_z08_artifact.png` / `F2_z14_clean.png` captured by this subagent.** Manual capture required (instructions below).

---

## Manual run (PC user)

1. Close all existing Chrome windows (or use a fresh Chrome profile / Edge / Firefox).
2. Open `C:/ClaudeCodeProjects/Cairn/_spike/v331-pc/F2_mapbox_synthetic_repro.html` directly in the browser (double-click or `file:///…`).
3. Wait ~3 s — auto-sequence begins. Watch the page title (`F2 AT z=X`) and the status panel log.
4. After auto-sequence ends (title → `F2 DONE`), click `z=8` quick-jump button.
5. **Screenshot**. Save as `_spike/v331-pc/F2_z08_artifact.png`.
6. Click `z=14`. Screenshot. Save as `_spike/v331-pc/F2_z14_clean.png`.
7. Compare side by side. If the z=8 capture shows tile-aligned vertical bands of fog opacity inconsistency and z=14 does not, the artifact is reproduced in pure mapbox-gl-js → root cause confirmed upstream.

Optional variants to test (toggle via UI):
- `fill-antialias` off → check whether artifact changes (it should not, because the artifact comes from triangulation, not edge AA).
- `LineLayer` on → tile-seam vertical lines become visible directly as inconsistent line rendering at z=8.

---

## Why this matters for v331

If this HTML reproduces the artifact on PC with **zero Cairn code**:
- The bug is **not** in Cairn's `fogStore`, cell coalescing, or any RN code path.
- The bug **is** `geojson-vt + earcut` per Mapbox #7023 / #14316.
- Workaround direction (Subagent B's domain): switch from one global Polygon with holes to **either** (a) inverse rendering — draw holes-as-features over a full-screen color layer using a different layer composition, or (b) pre-tile the outer ring into a manageable bbox sized to the user's recent activity, avoiding the world-spanning clip path that triggers earcut instability.

The HTML's seeded RNG and reproducible auto-sequence make it suitable for inclusion in a future regression repro repo, separate from Cairn's app code.

---

## Files

- `_spike/v331-pc/F2_mapbox_synthetic_repro.html` — the reproducer (created).
- `_spike/v331-pc/F2_z08_artifact.png` — TODO, manual capture.
- `_spike/v331-pc/F2_z14_clean.png` — TODO, manual capture.
