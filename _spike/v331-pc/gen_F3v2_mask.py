"""F3 v2 — Generate fog mask WITH blur + cream halo + GLOBAL fallback.
Addresses Reviewer #2 BLOCKER 1 (no global far-fog) and BLOCKER 2 (no blur).
"""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, json, os

OUT_DIR = r'C:/ClaudeCodeProjects/Cairn/_spike/v331-pc'
USER_LAT, USER_LNG = 31.232, 121.457
RADIUS_M = 500
RES_M = 25
HEX_SPACING = 20

# v2 changes from v1:
#   1. Increase padding to 3000m (was 1500m) for less frequent boundary triggers
#   2. Apply Gaussian blur sigma=5 on alpha channel for soft edge
#   3. Add cream halo around cleared region (Fog of World signature)
#   4. Note: global far-fog layer is a *separate* Mapbox layer, not in this PNG
VIEW_M = 6000           # 6km square (was 3km)
HALF_M = VIEW_M / 2
SIZE = 1024
SCALE_M_PER_PX = VIEW_M / SIZE  # ~5.86 m/px (was 2.93)
BLUR_SIGMA = 5
CREAM = (247, 242, 229)
FOG_COLOR = (58, 42, 24, int(0.66 * 255))

cos_lat = math.cos(math.radians(USER_LAT))
M_PER_DEG_LAT = 111320

def xy_m_to_px(x, y, size, scale):
    cx = size / 2; cy = size / 2
    return cx + x / scale, cy - y / scale

# Viewport corners (NW NE SE SW lng lat)
dlat = HALF_M / M_PER_DEG_LAT
dlng = HALF_M / (M_PER_DEG_LAT * cos_lat)
corners = [
    [USER_LNG - dlng, USER_LAT + dlat],  # NW
    [USER_LNG + dlng, USER_LAT + dlat],  # NE
    [USER_LNG + dlng, USER_LAT - dlat],  # SE
    [USER_LNG - dlng, USER_LAT - dlat],  # SW
]

# Generate visited cells (same v329 hexSpacing=20m, 500m reveal)
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
print(f"visited cells: {len(visited)}")

# Step 1: build alpha mask (white = fog, black = clear)
mask = Image.new('L', (SIZE, SIZE), 255)  # white = fog
mdraw = ImageDraw.Draw(mask)
for (ix, iy) in visited:
    west_m = ix * RES_M; east_m = (ix + 1) * RES_M
    south_m = iy * RES_M; north_m = (iy + 1) * RES_M
    x0, y0 = xy_m_to_px(west_m, north_m, SIZE, SCALE_M_PER_PX)
    x1, y1 = xy_m_to_px(east_m, south_m, SIZE, SCALE_M_PER_PX)
    mdraw.rectangle([x0, y0, x1, y1], fill=0)

# Step 2: Gaussian blur the alpha mask for soft edges
mask_blurred = mask.filter(ImageFilter.GaussianBlur(radius=BLUR_SIGMA))

# Step 3: build the RGBA output
out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
# Layer A: fog overlay (dark sepia) modulated by blurred mask
fog_rgb = Image.new('RGB', (SIZE, SIZE), FOG_COLOR[:3])
fog_alpha = mask_blurred.point(lambda v: int(v * FOG_COLOR[3] / 255))  # mask defines alpha
fog_layer = fog_rgb.convert('RGBA')
fog_layer.putalpha(fog_alpha)
out = Image.alpha_composite(out, fog_layer)

# Step 4: cream halo at the cleared/fog boundary
# Halo is the "edge gradient" — derivative of the mask
mask_clear = mask_blurred.point(lambda v: 255 - v)        # invert: white = clear, black = fog
mask_clear_inset = mask_clear.filter(ImageFilter.GaussianBlur(radius=2))
# Halo intensity = where mask transitions
halo_alpha = ImageChops.subtract(mask_clear_inset, mask_clear.filter(ImageFilter.GaussianBlur(radius=8)))
# Brighten halo
halo_alpha = halo_alpha.point(lambda v: min(255, v * 6))
cream_rgb = Image.new('RGB', (SIZE, SIZE), CREAM)
cream_layer = cream_rgb.convert('RGBA')
cream_layer.putalpha(halo_alpha)
out = Image.alpha_composite(out, cream_layer)

out_path = os.path.join(OUT_DIR, 'F3v2_fog_mask.png')
out.save(out_path)
print(f"wrote {out_path}")

# Write viewport JSON for HTML
with open(os.path.join(OUT_DIR, 'F3v2_viewport.json'), 'w') as f:
    json.dump({'corners': corners, 'user': [USER_LNG, USER_LAT]}, f)
print('wrote F3v2_viewport.json')
print(f"viewport: 6km square, blur sigma={BLUR_SIGMA}, cream halo on")
