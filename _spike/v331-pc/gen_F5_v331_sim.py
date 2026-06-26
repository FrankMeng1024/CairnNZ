"""F5 — Simulate v331.1 corrected algorithm (DstOut + blur).
Algorithm:
  1. Fill surface with fog color (rgba 58,42,24,0.66)
  2. For each cell: paint with DstOut blend mode + Gaussian-blurred edges
     → erases destination alpha (creates transparent holes with soft edges)
  3. For each cell: paint cream rect with blur 1.8x bigger, inset 15%
     → cream halo near cell edges (NOT strict boundary halo but close)

Verifies what the on-device Skia output should look like.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os

OUT_DIR = r'C:/ClaudeCodeProjects/Cairn/_spike/v331-pc'
USER_LAT, USER_LNG = 31.232, 121.457
RADIUS_M = 500
RES_M = 25
HEX_SPACING = 20
SIZE = 1024
PADDING_M = 3000
VIEW_M = PADDING_M * 2
SCALE = VIEW_M / SIZE  # m/px
BLUR_SIGMA = 5

FOG_COLOR = (58, 42, 24, int(0.66 * 255))
CREAM = (247, 242, 229)
CREAM_ALPHA = 0.55

cos_lat = math.cos(math.radians(USER_LAT))
M_PER_DEG_LAT = 111320

def xy_m_to_px(x, y):
    return SIZE/2 + x/SCALE, SIZE/2 - y/SCALE

# Generate visited cells (v329 spec: hexSpacing=20m, 500m radius)
row_step = HEX_SPACING * math.sqrt(3) / 2
rows_half = math.ceil(RADIUS_M / row_step)
cols_half = math.ceil(RADIUS_M / HEX_SPACING)
RSQ = RADIUS_M * RADIUS_M

visited = set()
for row in range(-rows_half, rows_half + 1):
    dy = row * row_step
    row_off = 0 if (row & 1) == 0 else HEX_SPACING / 2
    for col in range(-cols_half, cols_half + 1):
        dx = col * HEX_SPACING + row_off
        if dx*dx + dy*dy > RSQ: continue
        ix = math.floor(dx / RES_M)
        iy = math.floor(dy / RES_M)
        visited.add((ix, iy))

# Compute cell pixel rects
cell_rects = []
for (ix, iy) in visited:
    w_m = ix * RES_M; e_m = (ix + 1) * RES_M
    s_m = iy * RES_M; n_m = (iy + 1) * RES_M
    x0, y0 = xy_m_to_px(w_m, n_m)
    x1, y1 = xy_m_to_px(e_m, s_m)
    cell_rects.append((x0, y0, x1, y1))

# ─── Step 1: fill surface with fog color ──────────────────────────────────
surface = Image.new('RGBA', (SIZE, SIZE), FOG_COLOR)

# ─── Step 2: punch transparent holes (DstOut equivalent) ──────────────────
# DstOut: result_alpha = dst_alpha * (1 - src_alpha)
# Simulate: paint each cell with full alpha on a separate "punch mask",
# blur it, then use it as inverse alpha multiplier on surface alpha.

punch_mask = Image.new('L', (SIZE, SIZE), 0)  # 0 = no punch, 255 = full punch
punch_draw = ImageDraw.Draw(punch_mask)
for (x0, y0, x1, y1) in cell_rects:
    punch_draw.rectangle([x0, y0, x1, y1], fill=255)
# Blur to feather edges (Skia MaskFilter blur equivalent)
punch_mask = punch_mask.filter(ImageFilter.GaussianBlur(radius=BLUR_SIGMA))

# Apply DstOut to surface alpha
surf_r, surf_g, surf_b, surf_a = surface.split()
# new_alpha = old_alpha * (1 - punch_alpha / 255)
import numpy as np
old_alpha = np.array(surf_a)
punch_arr = np.array(punch_mask)
new_alpha = (old_alpha.astype(np.float32) * (1 - punch_arr.astype(np.float32) / 255)).astype(np.uint8)
surf_a_new = Image.fromarray(new_alpha, mode='L')
surface = Image.merge('RGBA', (surf_r, surf_g, surf_b, surf_a_new))

# ─── Step 3: cream halo (blurred cream over cell interiors with inset) ────
# Step 3 simulates Skia paint with SrcOver blend, MaskFilter blur 1.8x larger,
# rect inset 15% of cell width.
halo_layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
halo_draw = ImageDraw.Draw(halo_layer)
for (x0, y0, x1, y1) in cell_rects:
    w = x1 - x0
    h = y1 - y0
    inset_x = w * 0.15
    inset_y = h * 0.15
    halo_draw.rectangle(
        [x0 + inset_x, y0 + inset_y, x1 - inset_x, y1 - inset_y],
        fill=CREAM + (int(CREAM_ALPHA * 0.4 * 255),),
    )

# Apply blur to the halo layer (separate RGBA channels)
halo_r, halo_g, halo_b, halo_a = halo_layer.split()
halo_a_blur = halo_a.filter(ImageFilter.GaussianBlur(radius=BLUR_SIGMA * 1.8))
halo_layer = Image.merge('RGBA', (halo_r, halo_g, halo_b, halo_a_blur))

# Composite halo over surface
surface = Image.alpha_composite(surface, halo_layer)

out_path = os.path.join(OUT_DIR, 'F5_v331_sim.png')
surface.save(out_path)
print(f"wrote {out_path}")
print(f"cells: {len(visited)}, mask {SIZE}x{SIZE}, padding {PADDING_M}m")
