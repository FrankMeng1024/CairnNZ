"""Better demo: sparse GPS points (more realistic) so A/B/C look different.

Real hiking GPS sampling:
  - Default Cairn watcher: every 1s if user moves > 5m  → in a 5km walk
    over 1 hour, ~3600 points at ~1.4m spacing — DENSE.
  - But what hits the activity DB? After de-dup + speed gate, typically
    one point every 5-20s. At 4 km/h hiking speed, that's every 5-20m.
  - However: many real activities have GAPS (signal loss, app backgrounded).
    Let's simulate REALISTIC sparse-and-gappy points to show the visual
    difference between A (line corridor), B (sparse blobs), and C (path
    highlight over blob).
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, os, random

OUT_DIR = r'C:/ClaudeCodeProjects/Cairn/_spike/v333'
SIZE = 800
VIEW_M = 5000
SCALE = VIEW_M / SIZE

# Sparse + gappy GPS: ~30 points over 4 km path → 130m spacing
# Then 3 sub-bursts of dense points (50 pts each at 10m spacing) at
# 0%, 50%, 100% of the path to simulate "phone in front of user during
# active hiking, deeper sampling".
random.seed(7)
points = []
x, y = -2000, 0
# Sparse main path
for i in range(30):
    dx = 4000 / 30 + random.uniform(-20, 20)
    dy = math.sin(i / 5) * 120 + random.uniform(-50, 50)
    x += dx
    y += dy
    points.append((x, y))
# Dense sub-bursts
for burst_pos in [4, 14, 26]:  # indices in sparse path
    bx, by = points[burst_pos]
    for j in range(30):
        points.append((bx + j * 8 + random.uniform(-3,3), by + math.sin(j/3)*5))

def m_to_px(mx, my):
    return SIZE/2 + mx/SCALE, SIZE/2 - my/SCALE

FOG_COLOR = (58, 42, 24, int(0.66 * 255))
CREAM = (247, 242, 229)

def render_corridor(width_m=50):
    """50m corridor along path - only main sparse points used as polyline."""
    img = Image.new('RGBA', (SIZE, SIZE), FOG_COLOR)
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    # Only first 30 (sparse main path) drives the polyline
    pts = [m_to_px(p[0], p[1]) for p in points[:30]]
    width_px = max(2, width_m / SCALE)
    d.line(pts, fill=255, width=int(width_px), joint='curve')
    mask = mask.filter(ImageFilter.GaussianBlur(radius=4))
    import numpy as np
    a = np.array(img.split()[3]).astype(np.float32)
    m = np.array(mask).astype(np.float32) / 255
    a = (a * (1 - m)).astype(np.uint8)
    r,g,b,_ = img.split()
    return Image.merge('RGBA', (r,g,b, Image.fromarray(a, 'L')))

def render_blob(radius_m=25):
    """25m blob per GPS point. ALL points used (sparse + dense bursts).
    Gaps in sparse middle visible because 130m spacing >> 25m radius."""
    img = Image.new('RGBA', (SIZE, SIZE), FOG_COLOR)
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    radius_px = max(2, radius_m / SCALE)
    for (mx, my) in points:
        px, py = m_to_px(mx, my)
        d.ellipse([px-radius_px, py-radius_px, px+radius_px, py+radius_px], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=4))
    import numpy as np
    a = np.array(img.split()[3]).astype(np.float32)
    m = np.array(mask).astype(np.float32) / 255
    a = (a * (1 - m)).astype(np.uint8)
    r,g,b,_ = img.split()
    return Image.merge('RGBA', (r,g,b, Image.fromarray(a, 'L')))

def render_combo():
    """Blob 25m + 3px-wide cream polyline (Strava style)."""
    img = render_blob(25)
    overlay = Image.new('RGBA', (SIZE, SIZE), (0,0,0,0))
    d = ImageDraw.Draw(overlay)
    pts = [m_to_px(p[0], p[1]) for p in points[:30]]  # main sparse path
    d.line(pts, fill=CREAM + (220,), width=3, joint='curve')
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=1.5))
    return Image.alpha_composite(img, overlay)

def make_basemap():
    bg = Image.new('RGBA', (SIZE, SIZE), (220, 210, 180, 255))
    d = ImageDraw.Draw(bg)
    # fake roads
    for offset_y in [200, 400, 600]:
        d.line([(0, offset_y), (SIZE, offset_y+10)], fill=(180,170,150), width=2)
    for offset_x in [150, 400, 650]:
        d.line([(offset_x, 0), (offset_x+8, SIZE)], fill=(180,170,150), width=2)
    return bg

img_a = render_corridor(50)
img_b = render_blob(25)
img_c = render_combo()

final_a = Image.alpha_composite(make_basemap(), img_a)
final_b = Image.alpha_composite(make_basemap(), img_b)
final_c = Image.alpha_composite(make_basemap(), img_c)

GAP = 20
combo = Image.new('RGB', (3 * SIZE + 4 * GAP, SIZE + 80), (255, 255, 255))
d = ImageDraw.Draw(combo)
combo.paste(final_a, (GAP, 60))
combo.paste(final_b, (2*GAP + SIZE, 60))
combo.paste(final_c, (3*GAP + 2*SIZE, 60))

try:
    font = ImageFont.truetype("arial.ttf", 22)
    font_small = ImageFont.truetype("arial.ttf", 16)
except Exception:
    font = None
    font_small = None

labels = [
    "A) Corridor 50m  (Strava-line: only path)",
    "B) Blob 25m  (per-point circle: gaps show!)",
    "C) Blob 25m + Cream Path 3px  (Cairn proposed)",
]
for i, lbl in enumerate(labels):
    x = GAP + i * (SIZE + GAP) + 10
    d.text((x, 18), lbl, fill=(20,20,20), font=font)
    d.text((x, 42), f"{len(points)} GPS pts, {30} sparse + 90 burst", fill=(80,80,80), font=font_small)

out_path = os.path.join(OUT_DIR, 'unlock_styles_demo_v2.png')
combo.save(out_path)
print(f"wrote {out_path}")
print(f"sparse points: 30 (~130m spacing), dense bursts: 3×30 pts at 10m spacing")
