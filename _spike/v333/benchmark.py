"""
fogMaskRenderer PC-equivalent benchmark.

Mirrors the algorithm in app/src/features/memory/services/fogMaskRenderer.ts:
  - 1024x1024 mask
  - 6km bbox (paddingMeters=3000) -> scale_m_per_px = 6000/1024 ~= 5.86
  - 25m H3 cells (FOG_RES_METERS=25), so each cell ~= 4.3 px on side
  - viewport cull: discard cells outside [-10, MASK_SIZE+10] pixel rect
  - draw all cells as DstOut blurred rects (punch transparent holes)
  - draw all cells as cream halo (inset 15%, gaussian blur sigma=9)
  - encode PNG

We use PIL for an approximate-equivalent implementation on PC.
Skia on a real phone with CPU surface is roughly comparable in scaling
behavior (linear in N for draw loop, fixed cost for blur+encode), though
absolute ms differ. We report PC ms; mobile device ms is typically
1.5x-3x slower for blur/encode but the *shape* of the curve is what
matters for the "GPS over 1 hundred million points" question.
"""
import math
import os
import time
import random
import gc

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import psutil

MASK_SIZE = 1024
PADDING_M = 3000
FOG_RES_METERS = 25
M_PER_DEG_LAT = 111_320.0
BLUR_SIGMA = 5.0
CREAM_R, CREAM_G, CREAM_B = 247, 242, 229
CREAM_ALPHA = 0.55

# user center: somewhere in Shanghai
CENTER_LAT = 31.2304
CENTER_LNG = 121.4737


def cell_ix_iy_from_latlng(lat: float, lng: float) -> tuple[int, int]:
    """Inverse of the iy/ix indexing in fogMaskRenderer."""
    d_lat = FOG_RES_METERS / M_PER_DEG_LAT
    iy = int(lat / d_lat)
    anchor_lat = (iy + 0.5) * d_lat
    cos_anchor = max(math.cos(math.radians(anchor_lat)), 1e-6)
    d_lng = FOG_RES_METERS / (M_PER_DEG_LAT * cos_anchor)
    ix = int(lng / d_lng)
    return ix, iy


def gen_cells(n: int, near_frac: float = 0.5, seed: int = 42) -> dict:
    """Generate N cell IDs. near_frac of them in 6km bbox around user,
    rest scattered globally. Returns a dict{cellID:1} like the JS Map."""
    rng = random.Random(seed)
    out: dict[str, int] = {}
    near_n = int(n * near_frac)
    far_n = n - near_n

    # Near: inside 6km square around user
    # 6km in lat ~= 0.054 deg, in lng ~= 0.063 deg at Shanghai
    d_lat_6km = 6000.0 / M_PER_DEG_LAT
    cos_c = math.cos(math.radians(CENTER_LAT))
    d_lng_6km = 6000.0 / (M_PER_DEG_LAT * cos_c)

    attempts = 0
    while len(out) < near_n and attempts < near_n * 5:
        attempts += 1
        lat = CENTER_LAT + (rng.random() - 0.5) * d_lat_6km
        lng = CENTER_LNG + (rng.random() - 0.5) * d_lng_6km
        ix, iy = cell_ix_iy_from_latlng(lat, lng)
        out[f"11:{ix}:{iy}"] = 1

    # Far: anywhere globally (excluding poles for safety)
    while len(out) < n:
        lat = (rng.random() - 0.5) * 160.0  # -80..+80
        lng = (rng.random() - 0.5) * 360.0  # -180..+180
        ix, iy = cell_ix_iy_from_latlng(lat, lng)
        out[f"11:{ix}:{iy}"] = 1

    return out


def decode_cell(cid: str):
    parts = cid.split(":")
    if len(parts) != 3:
        return None
    if parts[0] != "11":
        return None
    try:
        return int(parts[1]), int(parts[2])
    except ValueError:
        return None


def run_one(n: int, near_frac: float = 0.5) -> dict:
    proc = psutil.Process(os.getpid())
    gc.collect()
    rss_start = proc.memory_info().rss / 1024 / 1024

    # ── gen ──
    cells = gen_cells(n, near_frac=near_frac)
    actual_n = len(cells)

    # ── viewport cull + cell rect compute (fused like in fogMaskRenderer) ──
    half_side = PADDING_M
    full_side = half_side * 2
    scale_m_per_px = full_side / MASK_SIZE
    d_lat = FOG_RES_METERS / M_PER_DEG_LAT
    cos_center = max(math.cos(math.radians(CENTER_LAT)), 1e-6)

    cull_t0 = time.perf_counter()
    cell_rects = []
    for cid in cells.keys():
        dec = decode_cell(cid)
        if dec is None:
            continue
        ix, iy = dec
        cell_south_lat = iy * d_lat
        cell_north_lat = (iy + 1) * d_lat
        anchor_lat = (iy + 0.5) * d_lat
        cos_anchor = max(math.cos(math.radians(anchor_lat)), 1e-6)
        d_lng = FOG_RES_METERS / (M_PER_DEG_LAT * cos_anchor)
        cell_west_lng = ix * d_lng
        cell_east_lng = (ix + 1) * d_lng
        w_m = (cell_west_lng - CENTER_LNG) * M_PER_DEG_LAT * cos_center
        e_m = (cell_east_lng - CENTER_LNG) * M_PER_DEG_LAT * cos_center
        s_m = (cell_south_lat - CENTER_LAT) * M_PER_DEG_LAT
        n_m = (cell_north_lat - CENTER_LAT) * M_PER_DEG_LAT
        px_w = MASK_SIZE / 2 + w_m / scale_m_per_px
        px_e = MASK_SIZE / 2 + e_m / scale_m_per_px
        px_n = MASK_SIZE / 2 - n_m / scale_m_per_px
        px_s = MASK_SIZE / 2 - s_m / scale_m_per_px
        if px_e < -10 or px_w > MASK_SIZE + 10 or px_s < -10 or px_n > MASK_SIZE + 10:
            continue
        cell_rects.append((px_w, px_n, max(1.0, px_e - px_w), max(1.0, px_s - px_n)))
    cull_ms = (time.perf_counter() - cull_t0) * 1000.0
    cells_in_bbox = len(cell_rects)

    # In the JS code, decode is fused with cull. We report combined as cull_ms;
    # decode_ms reported as 0 because there's no separate decode pass.
    decode_ms = 0.0

    # ── draw loop: punch DstOut alpha and cream halo ──
    # PIL doesn't have BlendMode.DstOut for arbitrary paints, but we mirror
    # the algorithmic cost: two rectangle-draw passes over cell_rects.
    draw_t0 = time.perf_counter()
    surface = Image.new("RGBA", (MASK_SIZE, MASK_SIZE), (58, 42, 24, int(0.66 * 255)))
    # Pass A: punch holes (drawn on alpha-only mask, then composited)
    punch_mask = Image.new("L", (MASK_SIZE, MASK_SIZE), 0)
    pm_draw = ImageDraw.Draw(punch_mask)
    for (x, y, w, h) in cell_rects:
        pm_draw.rectangle([x, y, x + w, y + h], fill=255)
    # Pass B: cream halo rects (inset 15%)
    halo_layer = Image.new("RGBA", (MASK_SIZE, MASK_SIZE), (0, 0, 0, 0))
    halo_draw = ImageDraw.Draw(halo_layer)
    halo_a = int(CREAM_ALPHA * 0.4 * 255)
    for (x, y, w, h) in cell_rects:
        ix_ = w * 0.15
        iy_ = h * 0.15
        halo_draw.rectangle(
            [x + ix_, y + iy_, x + w - ix_, y + h - iy_],
            fill=(CREAM_R, CREAM_G, CREAM_B, halo_a),
        )
    draw_ms = (time.perf_counter() - draw_t0) * 1000.0

    # ── blur + encode ──
    blur_t0 = time.perf_counter()
    # Blur punch mask (sigma=5) -> alpha to apply to surface
    blurred_punch = punch_mask.filter(ImageFilter.GaussianBlur(radius=BLUR_SIGMA))
    # Subtract blurred punch alpha from surface alpha (mimic DstOut)
    s_arr = np.array(surface)
    bp_arr = np.array(blurred_punch).astype(np.float32) / 255.0
    s_arr[..., 3] = (s_arr[..., 3].astype(np.float32) * (1.0 - bp_arr)).astype(np.uint8)
    surface = Image.fromarray(s_arr)

    # Blur halo layer (sigma=9) and composite on top
    blurred_halo = halo_layer.filter(ImageFilter.GaussianBlur(radius=BLUR_SIGMA * 1.8))
    surface = Image.alpha_composite(surface, blurred_halo)

    # PNG encode to bytes (equivalent to image.encodeToBase64 in JS)
    import io
    buf = io.BytesIO()
    surface.save(buf, format="PNG", optimize=False)
    _png_bytes = buf.getvalue()
    blur_encode_ms = (time.perf_counter() - blur_t0) * 1000.0

    total_ms = cull_ms + decode_ms + draw_ms + blur_encode_ms

    rss_peak = proc.memory_info().rss / 1024 / 1024

    return {
        "cells_stored": actual_n,
        "cells_in_bbox": cells_in_bbox,
        "cull_ms": cull_ms,
        "decode_ms": decode_ms,
        "draw_ms": draw_ms,
        "blur_encode_ms": blur_encode_ms,
        "total_ms": total_ms,
        "rss_mb": rss_peak,
        "rss_delta_mb": rss_peak - rss_start,
    }


def main():
    print("# fogMaskRenderer PC benchmark — PIL-equivalent of Skia render")
    print(f"# MASK_SIZE={MASK_SIZE}, bbox=6km, 25m cells, blur_sigma={BLUR_SIGMA}")
    print(f"# CPU: {psutil.cpu_count(logical=False)} cores, {psutil.cpu_count()} logical")
    print()

    scenarios = [
        (1_000,        "1 week newbie"),
        (10_000,       "1 year active user"),
        (100_000,      "5 year power user"),
        (1_000_000,    "earth-scale, theoretical"),
        # 10M is *very* slow to gen + decode; we keep it but it may take minutes
        (10_000_000,   "100M GPS points dedup ceiling"),
    ]
    results = []
    for n, label in scenarios:
        print(f"running n={n:>12,} ({label})...", flush=True)
        t0 = time.perf_counter()
        try:
            r = run_one(n, near_frac=0.5)
        except MemoryError as e:
            print(f"  MEMORY ERROR: {e}")
            r = {"cells_stored": n, "error": "MemoryError"}
        wall = time.perf_counter() - t0
        r["label"] = label
        r["wall_s"] = wall
        print(f"  wall: {wall:.1f}s, total_ms: {r.get('total_ms', 'n/a')}, "
              f"in_bbox: {r.get('cells_in_bbox', 'n/a')}, rss: {r.get('rss_mb', 'n/a'):.0f} MB")
        results.append(r)
        gc.collect()

    # write table
    print()
    print("| Cells stored | Cells in bbox | Cull ms | Decode ms | Draw ms | Blur/encode ms | Total ms | Peak RSS MB |")
    print("|---|---|---|---|---|---|---|---|")
    for r in results:
        if "error" in r:
            print(f"| {r['cells_stored']:,} | ERROR | - | - | - | - | - | - |")
            continue
        print(f"| {r['cells_stored']:,} | {r['cells_in_bbox']:,} | "
              f"{r['cull_ms']:.1f} | {r['decode_ms']:.1f} | {r['draw_ms']:.1f} | "
              f"{r['blur_encode_ms']:.1f} | {r['total_ms']:.1f} | {r['rss_mb']:.0f} |")

    # also write to file
    import json
    with open(os.path.join(os.path.dirname(__file__), "perf_benchmark_raw.json"), "w") as f:
        json.dump(results, f, indent=2)


if __name__ == "__main__":
    main()
