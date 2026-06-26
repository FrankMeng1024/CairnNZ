"""Demo: corridor vs blob unlock styles for activity history.

Scenario: User had a hiking activity from Jingan Temple (静安寺) area to
Pudong (浦东). Now opens Memory map. Two ways to show the unlocked area:

  A) Corridor: 50m strip along the walked path → looks like a winding trail
  B) Blob: each GPS point reveals a 50m-radius circle, all union → looks
     like organic patches around walked area

Generates side-by-side comparison PNG.
"""
from PIL import Image, ImageDraw, ImageFilter
import math, os

OUT_DIR = r'C:/ClaudeCodeProjects/Cairn/_spike/v333'

# Two side-by-side maps, each 800x800 px representing 5km × 5km area
SIZE = 800
VIEW_M = 5000  # 5km
SCALE = VIEW_M / SIZE  # 6.25 m/px

# Center the maps near Shanghai (静安寺)
USER_LAT = 31.232; USER_LNG = 121.457

# Synthetic hiking activity: walk from Jingan (W) to Pudong (E)
# Generate a winding path 4km long, ~100 GPS points
import random
random.seed(42)
points = []
x, y = -2000, -200  # start: 2km west, 200m south of user
points.append((x, y))
for i in range(100):
    # Curve from W to E with some noise
    dx = 40 + random.uniform(-5, 5)
    dy = (math.sin(i / 8) * 60) + random.uniform(-15, 15)
    x += dx
    y += dy
    points.append((x, y))

def m_to_px(mx, my):
    return SIZE/2 + mx/SCALE, SIZE/2 - my/SCALE

FOG_COLOR = (58, 42, 24, int(0.66 * 255))
CREAM = (247, 242, 229)

def render_corridor(width_m=50):
    """Draw a 50m wide corridor along the path."""
    img = Image.new('RGBA', (SIZE, SIZE), FOG_COLOR)
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    px_pts = [m_to_px(p[0], p[1]) for p in points]
    width_px = width_m / SCALE
    d.line(px_pts, fill=255, width=int(width_px), joint='curve')
    # Soft edges
    mask = mask.filter(ImageFilter.GaussianBlur(radius=4))
    # Apply DstOut (multiply alpha by inverse mask)
    import numpy as np
    a = np.array(img.split()[3]).astype(np.float32)
    m = np.array(mask).astype(np.float32) / 255
    a = (a * (1 - m)).astype(np.uint8)
    r,g,b,_ = img.split()
    img = Image.merge('RGBA', (r,g,b, Image.fromarray(a, 'L')))
    return img

def render_blob(radius_m=50):
    """Each GPS point reveals a 50m-radius circle, all unioned."""
    img = Image.new('RGBA', (SIZE, SIZE), FOG_COLOR)
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    radius_px = radius_m / SCALE
    for (mx, my) in points:
        px, py = m_to_px(mx, my)
        d.ellipse([px-radius_px, py-radius_px, px+radius_px, py+radius_px], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=4))
    import numpy as np
    a = np.array(img.split()[3]).astype(np.float32)
    m = np.array(mask).astype(np.float32) / 255
    a = (a * (1 - m)).astype(np.uint8)
    r,g,b,_ = img.split()
    img = Image.merge('RGBA', (r,g,b, Image.fromarray(a, 'L')))
    return img

def render_combo():
    """Blob base + brighter corridor highlight (Strava-style)."""
    img = render_blob(50)
    # Overlay cream-colored corridor of 20m width
    overlay = Image.new('RGBA', (SIZE, SIZE), (0,0,0,0))
    d = ImageDraw.Draw(overlay)
    px_pts = [m_to_px(p[0], p[1]) for p in points]
    width_px = 20 / SCALE
    d.line(px_pts, fill=CREAM + (140,), width=max(1, int(width_px)), joint='curve')
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=2))
    img = Image.alpha_composite(img, overlay)
    return img

# Render all three styles
img_a = render_corridor(50)
img_b = render_blob(50)
img_c = render_combo()

# Synthetic "basemap" - light cream background
def make_basemap():
    bg = Image.new('RGBA', (SIZE, SIZE), (220, 210, 180, 255))
    d = ImageDraw.Draw(bg)
    # Draw some fake roads
    d.line([(0, 400), (SIZE, 380)], fill=(180,170,150), width=2)
    d.line([(200, 0), (220, SIZE)], fill=(180,170,150), width=2)
    d.line([(600, 0), (620, SIZE)], fill=(180,170,150), width=2)
    d.line([(0, 200), (SIZE, 220)], fill=(180,170,150), width=2)
    d.line([(0, 600), (SIZE, 620)], fill=(180,170,150), width=2)
    # Labels
    return bg

# Composite each on basemap
final_a = Image.alpha_composite(make_basemap(), img_a)
final_b = Image.alpha_composite(make_basemap(), img_b)
final_c = Image.alpha_composite(make_basemap(), img_c)

# 3-side-by-side comparison
GAP = 20
combo = Image.new('RGB', (3 * SIZE + 4 * GAP, SIZE + 80), (255, 255, 255))
d = ImageDraw.Draw(combo)
combo.paste(final_a, (GAP, 60))
combo.paste(final_b, (2*GAP + SIZE, 60))
combo.paste(final_c, (3*GAP + 2*SIZE, 60))

# Try to load a font
try:
    from PIL import ImageFont
    font = ImageFont.truetype("arial.ttf", 22)
except Exception:
    font = None

labels = [
    "A) Corridor 50m  (Strava-line style)",
    "B) Blob 50m  (per-GPS circle union, Fog-of-World)",
    "C) Blob 50m + Cream Path 20m  (Cairn proposed)",
]
for i, lbl in enumerate(labels):
    x = GAP + i * (SIZE + GAP) + 10
    d.text((x, 18), lbl, fill=(20,20,20), font=font)

out_path = os.path.join(OUT_DIR, 'unlock_styles_demo.png')
combo.save(out_path)
print(f"wrote {out_path}")
print(f"path: {len(points)} GPS points, ~4km long")
print(f"map: 5km × 5km, scale {SCALE:.2f} m/px")
