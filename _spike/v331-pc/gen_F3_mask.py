"""F3 — Generate a fog mask PNG using PIL.
This simulates what Skia would produce on RN: dark fog over whole image,
visited cells punched out by transparency. Then mapbox-gl-js loads it as
ImageSource and we screenshot the result.
"""
from PIL import Image, ImageDraw, ImageFilter
import math, json, os

OUT_DIR = r'C:/ClaudeCodeProjects/Cairn/_spike/v331-pc'

# Same scenario as F1: user at (31.232, 121.457), 500m reveal
USER_LAT, USER_LNG = 31.232, 121.457
RADIUS_M = 500
RES_M = 25
HEX_SPACING = 20

# Padded viewport in meters: 1000m square so we cover beyond the reveal
VIEW_M = 1000
HALF_M = VIEW_M / 2

# Mapbox lat/lng → viewport meters helpers
M_PER_DEG_LAT = 111320
cos_lat = math.cos(math.radians(USER_LAT))

def latlng_to_xy_m(lat, lng):
    """Return (x_m_east, y_m_north) relative to user."""
    return ((lng - USER_LNG) * M_PER_DEG_LAT * cos_lat,
            (lat - USER_LAT) * M_PER_DEG_LAT)

def xy_m_to_px(x, y, size, scale_m_per_px):
    """Map meter offset to image pixel."""
    cx = size / 2
    cy = size / 2
    px = cx + x / scale_m_per_px
    py = cy - y / scale_m_per_px  # PIL Y down
    return px, py

# Generate viewport corner coords for ImageSource (Mapbox needs [NW, NE, SE, SW] in lng/lat)
dlat = HALF_M / M_PER_DEG_LAT
dlng = HALF_M / (M_PER_DEG_LAT * cos_lat)
nw = [USER_LNG - dlng, USER_LAT + dlat]
ne = [USER_LNG + dlng, USER_LAT + dlat]
se = [USER_LNG + dlng, USER_LAT - dlat]
sw = [USER_LNG - dlng, USER_LAT - dlat]
corners = [nw, ne, se, sw]
print(f"viewport corners (NW NE SE SW): {corners}")

# Reconstruct visited cells: hex grid 20m spacing, 500m radius
row_step = HEX_SPACING * math.sqrt(3) / 2
rows_half = math.ceil(RADIUS_M / row_step)
cols_half = math.ceil(RADIUS_M / HEX_SPACING)
RSQ = RADIUS_M * RADIUS_M

# Cells indexed by (ix_m_floor, iy_m_floor) of 25m grid
visited_cells = set()
for row in range(-rows_half, rows_half + 1):
    dy = row * row_step
    row_off = 0 if (row & 1) == 0 else HEX_SPACING / 2
    for col in range(-cols_half, cols_half + 1):
        dx = col * HEX_SPACING + row_off
        if dx*dx + dy*dy > RSQ: continue
        ix = math.floor(dx / RES_M)
        iy = math.floor(dy / RES_M)
        visited_cells.add((ix, iy))
print(f"visited_cells: {len(visited_cells)}")

# Render PNG
SIZE = 1024
SCALE = VIEW_M / SIZE  # m / px

img = Image.new('RGBA', (SIZE, SIZE), (58, 42, 24, int(0.58 * 255)))  # fog overlay color
draw = ImageDraw.Draw(img)

# Punch holes: for each visited cell, draw transparent rectangle
for (ix, iy) in visited_cells:
    # cell corners in meters
    west_m = ix * RES_M
    east_m = (ix + 1) * RES_M
    south_m = iy * RES_M
    north_m = (iy + 1) * RES_M
    # to pixels
    x0, y0 = xy_m_to_px(west_m, north_m, SIZE, SCALE)
    x1, y1 = xy_m_to_px(east_m, south_m, SIZE, SCALE)
    # PIL rectangle expects (left, top, right, bottom)
    draw.rectangle([x0, y0, x1, y1], fill=(0, 0, 0, 0))

# Optional Gaussian blur on alpha channel only for soft edges
alpha = img.split()[3]
alpha_blur = alpha.filter(ImageFilter.GaussianBlur(radius=2))
img.putalpha(alpha_blur)

out = os.path.join(OUT_DIR, 'F3_fog_mask.png')
img.save(out)
print(f"wrote {out}")

# Also save the corners as a JSON for the HTML to consume
with open(os.path.join(OUT_DIR, 'F3_viewport.json'), 'w') as f:
    json.dump({'corners': corners, 'user': [USER_LNG, USER_LAT]}, f)
print('wrote F3_viewport.json')
