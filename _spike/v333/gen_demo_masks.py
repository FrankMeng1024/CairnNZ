"""F-demo: render 3 unlock styles on a REAL Mapbox Shanghai basemap.

Generates 3 PNGs to be served to Mapbox via fetch interception:
  A) Corridor 50m: walked path as 50m-wide soft transparent strip
  B) Blob 25m: per-GPS-point 25m circle, union
  C) Blob 25m + Cream Path: same as B + cream polyline overlay

The Skia render in Cairn would produce visually identical PNGs.
"""
from PIL import Image, ImageDraw, ImageFilter
import math, json, os, random

OUT_DIR = r'C:/ClaudeCodeProjects/Cairn/_spike/v333'

# User's actual scenario: Jingan to Pudong, ~6km hike
USER_LAT, USER_LNG = 31.232, 121.457   # start point near Jingan Temple
END_LAT, END_LNG = 31.244, 121.500     # near Lujiazui (Pudong financial district)

# Build a synthetic walking route from start to end with realistic GPS sampling
# Sparse main path (one point every ~150m) + 3 dense clusters
def build_route():
    random.seed(11)
    pts = []
    # Main sparse path 30 pts
    for i in range(30):
        t = i / 29
        lat = USER_LAT + t * (END_LAT - USER_LAT) + math.sin(t * 6) * 0.0008
        lng = USER_LNG + t * (END_LNG - USER_LNG) + math.cos(t * 4) * 0.0008
        pts.append((lat + random.uniform(-0.0001, 0.0001),
                    lng + random.uniform(-0.0001, 0.0001)))
    # 3 dense bursts (e.g. user paused, took photos)
    for burst_t in [0.2, 0.5, 0.85]:
        bi = int(burst_t * 29)
        bp = pts[bi]
        for j in range(20):
            pts.append((bp[0] + random.uniform(-0.0003, 0.0003),
                        bp[1] + random.uniform(-0.0003, 0.0003)))
    return pts

route = build_route()
print(f'route: {len(route)} GPS points')

# PNG covers area: bbox spanning the full route + 1.5km padding
min_lat = min(p[0] for p in route) - 0.015
max_lat = max(p[0] for p in route) + 0.015
min_lng = min(p[1] for p in route) - 0.015
max_lng = max(p[1] for p in route) + 0.015
mid_lat = (min_lat + max_lat) / 2

SIZE = 1024
M_PER_DEG_LAT = 111320
cos_lat = math.cos(math.radians(mid_lat))

# Square bbox in meters → ensures cells render as squares
# Take the larger dimension
lat_span_m = (max_lat - min_lat) * M_PER_DEG_LAT
lng_span_m = (max_lng - min_lng) * M_PER_DEG_LAT * cos_lat
side_m = max(lat_span_m, lng_span_m)
# Recompute bbox as a square around center
half = side_m / 2
mid_lng = (min_lng + max_lng) / 2
dlat = half / M_PER_DEG_LAT
dlng = half / (M_PER_DEG_LAT * cos_lat)
min_lat = mid_lat - dlat; max_lat = mid_lat + dlat
min_lng = mid_lng - dlng; max_lng = mid_lng + dlng
print(f'bbox: {min_lat:.4f}..{max_lat:.4f} / {min_lng:.4f}..{max_lng:.4f}, side {side_m:.0f}m')

SCALE = side_m / SIZE

def latlng_to_px(lat, lng):
    x = (lng - min_lng) / (max_lng - min_lng) * SIZE
    y = (1 - (lat - min_lat) / (max_lat - min_lat)) * SIZE
    return x, y

def meters_to_px(m):
    return m / SCALE

FOG_COLOR = (58, 42, 24, int(0.66 * 255))
CREAM = (247, 242, 229)

def render_corridor(width_m=50):
    img = Image.new('RGBA', (SIZE, SIZE), FOG_COLOR)
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    pts = [latlng_to_px(p[0], p[1]) for p in route[:30]]
    w_px = max(2, meters_to_px(width_m))
    d.line(pts, fill=255, width=int(w_px), joint='curve')
    mask = mask.filter(ImageFilter.GaussianBlur(radius=4))
    import numpy as np
    a = np.array(img.split()[3]).astype(np.float32)
    m = np.array(mask).astype(np.float32) / 255
    a = (a * (1 - m)).astype(np.uint8)
    r,g,b,_ = img.split()
    return Image.merge('RGBA', (r,g,b, Image.fromarray(a, 'L')))

def render_blob(r_m=25):
    img = Image.new('RGBA', (SIZE, SIZE), FOG_COLOR)
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    r_px = max(2, meters_to_px(r_m))
    for (lat, lng) in route:
        x, y = latlng_to_px(lat, lng)
        d.ellipse([x-r_px, y-r_px, x+r_px, y+r_px], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=4))
    import numpy as np
    a = np.array(img.split()[3]).astype(np.float32)
    m = np.array(mask).astype(np.float32) / 255
    a = (a * (1 - m)).astype(np.uint8)
    r,g,b,_ = img.split()
    return Image.merge('RGBA', (r,g,b, Image.fromarray(a, 'L')))

def render_combo():
    img = render_blob(25)
    overlay = Image.new('RGBA', (SIZE, SIZE), (0,0,0,0))
    d = ImageDraw.Draw(overlay)
    pts = [latlng_to_px(p[0], p[1]) for p in route[:30]]
    d.line(pts, fill=CREAM + (220,), width=3, joint='curve')
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=1.5))
    return Image.alpha_composite(img, overlay)

img_a = render_corridor(50);  img_a.save(os.path.join(OUT_DIR, 'demo_A_corridor.png'))
img_b = render_blob(25);       img_b.save(os.path.join(OUT_DIR, 'demo_B_blob.png'))
img_c = render_combo();        img_c.save(os.path.join(OUT_DIR, 'demo_C_combo.png'))

# Write the bbox + route for the HTML to consume
with open(os.path.join(OUT_DIR, 'demo_bbox.json'), 'w') as f:
    json.dump({
        'corners': [
            [min_lng, max_lat],  # NW
            [max_lng, max_lat],  # NE
            [max_lng, min_lat],  # SE
            [min_lng, min_lat],  # SW
        ],
        'route': route,
        'center': [USER_LNG, USER_LAT],
    }, f)
print('wrote 3 mask PNGs + demo_bbox.json')
