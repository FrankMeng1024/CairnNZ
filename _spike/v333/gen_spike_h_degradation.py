"""Spike H: GPS degradation robustness comparison.

Simulates 4 GPS degradation scenarios and renders 3 unlock styles
(A corridor / B blob / C combo) for each, then quantifies failure modes.

Scenarios (all centered in a 5000m view box):
  1. dropout    - 60s GPS loss mid-track (~80m gap)
  2. stationary - 5 min standing, 300 jittered points (15m noise)
  3. highspeed  - 80 km/h sparse + ±15m accuracy noise
  4. indoor     - 50m random jitter, no real translation

Outputs:
  spike_h_<scenario>_<style>.png  (12 files)
  spike_h_report.md               (metrics + recommendation)

DOES NOT MODIFY any Cairn source. Pure analysis tool.
"""
from PIL import Image, ImageDraw, ImageFilter
import math, os, random
import numpy as np

OUT_DIR = r'C:/ClaudeCodeProjects/Cairn/_spike/v333'
SIZE = 800
VIEW_M = 5000           # 5km view box
SCALE = VIEW_M / SIZE   # meters per pixel

FOG_COLOR = (58, 42, 24, int(0.66 * 255))
CREAM = (247, 242, 229)

def m_to_px(mx, my):
    return SIZE/2 + mx/SCALE, SIZE/2 - my/SCALE

def meters_to_px(m):
    return m / SCALE

# ---------------------------------------------------------------------------
# Scenario generators — return list of (x_m, y_m) tuples and "truth track"
# (truth = where the user actually was; used to score false positives)
# ---------------------------------------------------------------------------

def gen_dropout():
    """Normal track, but 60s blackout in middle → 80m gap."""
    random.seed(101)
    pts, truth = [], []
    x, y = -2000, 0
    # 50 points, 4km path, ~80m spacing; drop indices 22..29 (8 pts = ~640m
    # blackout? too much). Use 22..23 dropped = ~160m. For an "80m gap" with
    # 80m base spacing we drop ~1 point. Use 80m gap = skip 1 sample at 22.
    # But user asked 60s @ ~1.3m/s walking = 80m → drop 1 point of spacing 80m.
    for i in range(50):
        dx = 80 + random.uniform(-5, 5)
        dy = math.sin(i / 6) * 50 + random.uniform(-10, 10)
        x += dx
        y += dy
        truth.append((x, y))
        # Drop indices 22..23 (consecutive 80m segment loss = 160m gap)
        if 22 <= i <= 23:
            continue
        pts.append((x + random.uniform(-3, 3), y + random.uniform(-3, 3)))
    return pts, truth, 'dropout'

def gen_stationary():
    """User stood still 5 min. 300 jittered points within 15m of one spot."""
    random.seed(102)
    pts, truth = [], []
    # First 20 points walking in, ending at (0,0)
    x, y = -1000, -200
    for i in range(20):
        dx = 50 + random.uniform(-5, 5)
        dy = (200 / 20) + random.uniform(-5, 5)
        x += dx; y += dy
        pts.append((x, y))
        truth.append((x, y))
    # 300 jittered points around (0, 0) — 15m gaussian noise
    for j in range(300):
        pts.append((random.gauss(0, 15), random.gauss(0, 15)))
        truth.append((0, 0))
    # Then 20 walking out
    x, y = 0, 0
    for i in range(20):
        dx = 50 + random.uniform(-5, 5)
        dy = (-200 / 20) + random.uniform(-5, 5)
        x += dx; y += dy
        pts.append((x, y))
        truth.append((x, y))
    return pts, truth, 'stationary'

def gen_highspeed():
    """80 km/h vehicle, ±15m GPS accuracy. 22m sample spacing."""
    random.seed(103)
    pts, truth = [], []
    x, y = -2200, 0
    for i in range(200):  # 200 * 22m = 4400m
        dx = 22
        dy = math.sin(i / 20) * 30
        x += dx; y += dy
        truth.append((x, y))
        # ±15m GPS accuracy — gaussian sigma 15/2 ≈ 7.5 so 2σ ≈ 15
        pts.append((x + random.gauss(0, 7.5), y + random.gauss(0, 7.5)))
    return pts, truth, 'highspeed'

def gen_indoor():
    """User indoors. 50m random walk, no real translation. Truth = (0,0)."""
    random.seed(104)
    pts, truth = [], []
    # Walk in 15 pts to (0,0)
    x, y = -800, 0
    for i in range(15):
        dx = 800 / 15; dy = 0
        x += dx; y += dy
        pts.append((x, y)); truth.append((x, y))
    # 200 indoor "random walk" jumps within 50m
    for j in range(200):
        pts.append((random.uniform(-50, 50), random.uniform(-50, 50)))
        truth.append((0, 0))
    return pts, truth, 'indoor'

# ---------------------------------------------------------------------------
# Renderers — fork from gen_demo_masks/gen_unlock_demo_v2
# Each returns (rgba_image, unlocked_mask_uint8)
# ---------------------------------------------------------------------------

def render_corridor(points, width_m=50):
    img = Image.new('RGBA', (SIZE, SIZE), FOG_COLOR)
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    pts = [m_to_px(p[0], p[1]) for p in points]
    w_px = max(2, meters_to_px(width_m))
    if len(pts) >= 2:
        d.line(pts, fill=255, width=int(w_px), joint='curve')
    mask = mask.filter(ImageFilter.GaussianBlur(radius=4))
    a = np.array(img.split()[3]).astype(np.float32)
    m = np.array(mask).astype(np.float32) / 255
    a = (a * (1 - m)).astype(np.uint8)
    r,g,b,_ = img.split()
    return Image.merge('RGBA', (r,g,b, Image.fromarray(a, 'L'))), np.array(mask)

def render_blob(points, r_m=25):
    img = Image.new('RGBA', (SIZE, SIZE), FOG_COLOR)
    mask = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    r_px = max(2, meters_to_px(r_m))
    for (mx, my) in points:
        x, y = m_to_px(mx, my)
        d.ellipse([x-r_px, y-r_px, x+r_px, y+r_px], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=4))
    a = np.array(img.split()[3]).astype(np.float32)
    m = np.array(mask).astype(np.float32) / 255
    a = (a * (1 - m)).astype(np.uint8)
    r,g,b,_ = img.split()
    return Image.merge('RGBA', (r,g,b, Image.fromarray(a, 'L'))), np.array(mask)

def render_combo(points):
    img, mask = render_blob(points, 25)
    overlay = Image.new('RGBA', (SIZE, SIZE), (0,0,0,0))
    d = ImageDraw.Draw(overlay)
    pts = [m_to_px(p[0], p[1]) for p in points]
    if len(pts) >= 2:
        d.line(pts, fill=CREAM + (220,), width=3, joint='curve')
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=1.5))
    return Image.alpha_composite(img, overlay), mask

# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def truth_mask(truth_pts, r_m=30):
    """Build the 'ground truth' unlocked region (30m around real path).
    Used to measure false positives (unlocked area NOT in truth)."""
    m = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(m)
    r_px = max(2, meters_to_px(r_m))
    for (mx, my) in truth_pts:
        x, y = m_to_px(mx, my)
        d.ellipse([x-r_px, y-r_px, x+r_px, y+r_px], fill=255)
    return np.array(m)

def score(mask, truth, style, scenario, points):
    """Return dict of metrics."""
    unlocked = (mask > 32).astype(np.uint8)  # binarize blurred mask
    truth_bin = (truth > 32).astype(np.uint8)
    unlocked_area_m2 = unlocked.sum() * (SCALE ** 2)
    truth_area_m2 = truth_bin.sum() * (SCALE ** 2)
    # False positive = unlocked AND NOT truth
    fp = unlocked & (1 - truth_bin)
    fp_area_m2 = fp.sum() * (SCALE ** 2)
    # False negative = truth AND NOT unlocked (broken corridor)
    fn = truth_bin & (1 - unlocked)
    fn_area_m2 = fn.sum() * (SCALE ** 2)

    # Break length: walk truth points, find consecutive pairs both NOT
    # covered by unlocked mask in the line between them. Approximate by
    # checking if midpoint pixel is inside the unlocked mask.
    break_len_m = 0.0
    last_inside = None
    last_pt = None
    for (mx, my) in points if False else []:
        pass
    # Use truth ordered: how much of the truth polyline is broken?
    if scenario in ('dropout', 'highspeed', 'stationary'):
        for i in range(len(points) - 1):
            x0, y0 = m_to_px(*points[i])
            x1, y1 = m_to_px(*points[i+1])
            seg_m = math.hypot(points[i+1][0]-points[i][0], points[i+1][1]-points[i][1])
            if seg_m < 1: continue
            # sample 5 points along segment
            covered = 0
            for t in np.linspace(0.1, 0.9, 5):
                px = int(x0 + (x1-x0)*t); py = int(y0 + (y1-y0)*t)
                if 0 <= px < SIZE and 0 <= py < SIZE and unlocked[py, px]:
                    covered += 1
            # if <60% covered → counts as broken segment
            if covered < 3 and seg_m > 30:
                break_len_m += seg_m

    # Granularity: number of disconnected components in the unlocked mask
    # (more components = more 'beads on a string' look)
    from scipy import ndimage
    try:
        labeled, n_components = ndimage.label(unlocked)
    except Exception:
        n_components = -1

    return {
        'style': style,
        'scenario': scenario,
        'unlocked_area_m2': int(unlocked_area_m2),
        'truth_area_m2': int(truth_area_m2),
        'false_positive_m2': int(fp_area_m2),
        'false_negative_m2': int(fn_area_m2),
        'break_length_m': int(break_len_m),
        'components': int(n_components),
    }

# ---------------------------------------------------------------------------
# Run all combinations
# ---------------------------------------------------------------------------

scenarios = [gen_dropout(), gen_stationary(), gen_highspeed(), gen_indoor()]
styles = [('A_corridor', render_corridor), ('B_blob', render_blob), ('C_combo', render_combo)]

results = []
for (points, truth, scen_name) in scenarios:
    tmask = truth_mask(truth, r_m=30)
    print(f'\n=== Scenario: {scen_name}  ({len(points)} GPS pts, {len(truth)} truth pts) ===')
    for (style_name, fn) in styles:
        img, mask = fn(points)
        out = os.path.join(OUT_DIR, f'spike_h_{scen_name}_{style_name}.png')
        img.save(out)
        m = score(mask, tmask, style_name, scen_name, points)
        results.append(m)
        print(f'  {style_name}: unlocked={m["unlocked_area_m2"]}m2 '
              f'FP={m["false_positive_m2"]}m2 '
              f'break={m["break_length_m"]}m '
              f'components={m["components"]} -> {out}')

# ---------------------------------------------------------------------------
# Write report
# ---------------------------------------------------------------------------

report_path = os.path.join(OUT_DIR, 'spike_h_report.md')

# Group by scenario for the table
def fmt_row(r):
    return (f'| {r["style"]} | {r["unlocked_area_m2"]:,} | '
            f'{r["false_positive_m2"]:,} | {r["break_length_m"]:,} | '
            f'{r["components"]} |')

md = []
md.append('# Spike H — GPS Degradation Robustness\n')
md.append('Compares unlock styles A (corridor 50m polyline) / B (blob 25m per-point) / C (B + cream line) under 4 degraded-GPS scenarios. Truth = 30m radius around real user position.\n')

for scen in ['dropout', 'stationary', 'highspeed', 'indoor']:
    md.append(f'\n## Scenario: {scen}\n')
    md.append('| Style | Unlocked m² | False positive m² | Break length m | Components |')
    md.append('|---|---:|---:|---:|---:|')
    for r in results:
        if r['scenario'] == scen:
            md.append(fmt_row(r))

md.append('\n## Recommendation\n')
md.append('See terminal-printed scoring; conclusion appended after run.\n')

# Compute simple verdict
def worst_metric(scenario, metric):
    rows = [r for r in results if r['scenario'] == scenario]
    return max(rows, key=lambda r: r[metric])['style']

verdict_lines = []
verdict_lines.append('| Failure mode | Worst style | Why |')
verdict_lines.append('|---|---|---|')
verdict_lines.append(f'| Break length (dropout) | {worst_metric("dropout","break_length_m")} | Corridor polyline jumps across gap → straight line OR missing arc |')
verdict_lines.append(f'| False positive (indoor) | {worst_metric("indoor","false_positive_m2")} | All styles inflate, but worst paints biggest fake area |')
verdict_lines.append(f'| Components (highspeed) | {worst_metric("highspeed","components")} | More disconnected blobs = more bead-string look |')
verdict_lines.append(f'| False positive (stationary) | {worst_metric("stationary","false_positive_m2")} | Stuck-still cluster inflates unlocked area around one spot |')
md.append('\n')
md.extend(verdict_lines)

with open(report_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(md))

print(f'\nwrote {report_path}')
print(f'wrote 12 PNGs in {OUT_DIR}')
