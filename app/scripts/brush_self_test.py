"""brush self-test harness — runs the BCEF pipeline against fixture
baselines + synthesized brushes against the real Mapbox /matching API,
then renders side-by-side PNG for visual review.

Usage:
  python C:/ClaudeCodeProjects/Cairn/app/scripts/brush_self_test.py [caseId]

Output:
  C:/ClaudeCodeProjects/Cairn/app/_self_test_out/Cn.png
  C:/ClaudeCodeProjects/Cairn/app/_self_test_out/Cn.txt
  C:/ClaudeCodeProjects/Cairn/app/_self_test_out/summary.json

Requirements:
  - EXPO_PUBLIC_MAPBOX_TOKEN env (or hardcoded below)
  - Python 3 stdlib only (urllib + json + math)

This Python file is a 1:1 port of app/src/store/brush/bcef.ts —
keep them in sync when modifying.
"""
import json, math, sys, os, urllib.request, urllib.parse, urllib.error, random
sys.stdout.reconfigure(encoding='utf-8')

# Mapbox public token — read from env. To run locally:
#   set EXPO_PUBLIC_MAPBOX_TOKEN before invoking python.
# This is the same `pk.…` token shipped in the EAS production bundle —
# public, scoped, not a secret. GitHub push protection still flags
# in-tree tokens, so we read from env instead.
MAPBOX_TOKEN = os.environ.get("EXPO_PUBLIC_MAPBOX_TOKEN", "")
if not MAPBOX_TOKEN:
    print("ERROR: set EXPO_PUBLIC_MAPBOX_TOKEN env var before running this script")
    sys.exit(2)
ENDPOINT = "https://api.mapbox.com/matching/v5/mapbox/walking"

# constants — must match app/src/store/brush/bcef.ts
EARTH_R = 6_371_000
CORRIDOR_M = 250
LOOP_MIN_M = 5
DEFAULT_RADIUS_M = 50
MAPBOX_MATCHING_MAX_COORDS = 100

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', '_self_test_out')
FIXTURES_DIR = os.path.join(os.path.dirname(__file__), '..', '__fixtures__', 'brush')


# ── BCEF port — keep in sync with bcef.ts ──────────────────────────────

def hav(a, b):
    la1, la2 = math.radians(a['lat']), math.radians(b['lat'])
    dla = la2 - la1; dlo = math.radians(b['lng'] - a['lng'])
    h = math.sin(dla/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dlo/2)**2
    return 2 * EARTH_R * math.asin(math.sqrt(h))

def lerp(a, b, t):
    tt = max(0, min(1, t))
    return {
        'lng': a['lng'] + (b['lng'] - a['lng']) * tt,
        'lat': a['lat'] + (b['lat'] - a['lat']) * tt,
    }

def project_point_onto_baseline(p, baseline):
    if len(baseline) < 2: return None
    best_dist = float('inf')
    best = {'pt': baseline[0], 'arc': 0, 'dist': 0, 'segIdx': 0}
    acc = 0
    for i in range(1, len(baseline)):
        a = baseline[i-1]; b = baseline[i]
        seg_len = hav(a, b)
        midLat = ((a['lat'] + b['lat']) / 2) * (math.pi / 180)
        cosLat = math.cos(midLat)
        M_PER_DEG = 111000
        ax, ay = a['lng'] * cosLat * M_PER_DEG, a['lat'] * M_PER_DEG
        bx, by = b['lng'] * cosLat * M_PER_DEG, b['lat'] * M_PER_DEG
        px, py = p['lng'] * cosLat * M_PER_DEG, p['lat'] * M_PER_DEG
        dx, dy = bx - ax, by - ay
        lenSq = dx*dx + dy*dy
        t = 0 if lenSq < 1e-9 else ((px - ax)*dx + (py - ay)*dy) / lenSq
        t = max(0, min(1, t))
        fx, fy = ax + t*dx, ay + t*dy
        d = math.hypot(px - fx, py - fy)
        if d < best_dist:
            best_dist = d
            best = {
                'pt': {'lng': fx / (cosLat * M_PER_DEG), 'lat': fy / M_PER_DEG},
                'arc': acc + t * seg_len,
                'dist': d,
                'segIdx': i - 1,
            }
        acc += seg_len
    return best

def stroke_within_corridor(stroke, baseline):
    max_dist = 0
    for p in stroke:
        proj = project_point_onto_baseline(p, baseline)
        if proj is None:
            return {'ok': False, 'maxDistM': float('inf')}
        if proj['dist'] > max_dist:
            max_dist = proj['dist']
    return {'ok': max_dist <= CORRIDOR_M, 'maxDistM': max_dist}

def baseline_total_arc(baseline):
    return sum(hav(baseline[i-1], baseline[i]) for i in range(1, len(baseline)))

def baseline_slice(baseline, arc_start, arc_end):
    if arc_end <= arc_start or len(baseline) < 2:
        return []
    out = []
    acc = 0
    started = False
    for i in range(1, len(baseline)):
        a = baseline[i-1]; b = baseline[i]
        seg_len = hav(a, b)
        seg_end = acc + seg_len
        if not started:
            if seg_end >= arc_start:
                t = 0 if seg_len <= 0 else (arc_start - acc) / seg_len
                if 0 < t < 1:
                    out.append(lerp(a, b, t))
                elif t <= 0:
                    out.append(a)
                if seg_end >= arc_end:
                    t2 = 1 if seg_len <= 0 else (arc_end - acc) / seg_len
                    out.append(lerp(a, b, t2))
                    return out
                out.append(b)
                started = True
        else:
            if seg_end >= arc_end:
                t = 1 if seg_len <= 0 else (arc_end - acc) / seg_len
                out.append(lerp(a, b, t))
                return out
            out.append(b)
        acc = seg_end
    return out

def splice_bcef(baseline, items):
    """items: [{'arcB', 'arcC', 'curve'}]"""
    if not items:
        return list(baseline)
    sortable = []
    for it in items:
        sortable.append({
            'arcMin': min(it['arcB'], it['arcC']),
            'arcMax': max(it['arcB'], it['arcC']),
            'reversed': it['arcB'] > it['arcC'],
            'curve': it['curve'],
        })
    sortable.sort(key=lambda x: x['arcMin'])
    out = []
    cursor = 0
    for it in sortable:
        if it['arcMin'] < cursor: continue
        prefix = baseline_slice(baseline, cursor, it['arcMin'])
        out.extend(prefix)
        curve = list(reversed(it['curve'])) if it['reversed'] else it['curve']
        out.extend(curve)
        cursor = it['arcMax']
    suffix = baseline_slice(baseline, cursor, baseline_total_arc(baseline))
    out.extend(suffix)
    # dedupe + despik (simplified — match TS behavior)
    if len(out) < 2: return out
    deduped = [out[0]]
    for i in range(1, len(out)):
        if hav(deduped[-1], out[i]) > 0.5:
            deduped.append(out[i])
    if len(deduped) < 3: return deduped
    despik = [deduped[0], deduped[1]]
    for i in range(2, len(deduped)):
        a, b, c = despik[-2], despik[-1], deduped[i]
        ac, ab, bc = hav(a, c), hav(a, b), hav(b, c)
        if ac < 1 and ab > 4 and bc > 4:
            despik[-1] = c
        else:
            despik.append(c)
    return despik


# ── Mapbox /matching client ────────────────────────────────────────────

def mapbox_match(coords, radius=DEFAULT_RADIUS_M):
    if len(coords) < 2 or len(coords) > MAPBOX_MATCHING_MAX_COORDS:
        return {'ok': False, 'reason': 'invalid-input'}
    coords_str = ';'.join(f"{p['lng']:.6f},{p['lat']:.6f}" for p in coords)
    radii = ';'.join(str(radius) for _ in coords)
    qs = urllib.parse.urlencode({
        'geometries': 'geojson',
        'overview': 'full',
        'tidy': 'true',
        'access_token': MAPBOX_TOKEN,
    }) + f"&radiuses={radii}"
    url = f"{ENDPOINT}/{coords_str}?{qs}"
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            body = json.load(r)
            if body.get('code') != 'Ok' or not body.get('matchings'):
                return {'ok': False, 'reason': body.get('code', 'no-match'),
                        'detail': body.get('message')}
            m = body['matchings'][0]
            pts = [{'lng': c[0], 'lat': c[1]} for c in m['geometry']['coordinates']]
            return {'ok': True, 'points': pts, 'confidence': m.get('confidence', 0)}
    except urllib.error.HTTPError as e:
        return {'ok': False, 'reason': f'HTTP_{e.code}'}
    except Exception as e:
        return {'ok': False, 'reason': 'NETWORK', 'detail': str(e)}


# ── case generation helpers ────────────────────────────────────────────

def offset_along_normal(a, b, dist_m, t=0.5):
    cosLat = math.cos(math.radians(a['lat']))
    M_PER_DEG = 111000
    bx = (b['lng'] - a['lng']) * cosLat * M_PER_DEG
    by = (b['lat'] - a['lat']) * M_PER_DEG
    seg_len = math.hypot(bx, by)
    if seg_len < 0.1: return a
    nx, ny = -by / seg_len, bx / seg_len
    base = {
        'lat': a['lat'] + (b['lat'] - a['lat']) * t,
        'lng': a['lng'] + (b['lng'] - a['lng']) * t,
    }
    return {
        'lat': base['lat'] + (ny * dist_m) / M_PER_DEG,
        'lng': base['lng'] + (nx * dist_m) / (cosLat * M_PER_DEG),
    }

def synth_brush(baseline, start_idx, end_idx, max_offset_m, npts=30, seed=42):
    """Synthesize a brush stroke whose ENDPOINTS sit exactly on baseline
    (mimicking real user input post-endStroke-magnetism), and whose
    middle bulges out by max_offset_m via a sin-arc plus small jitter.
    """
    rng = random.Random(seed)
    out = []
    for i in range(npts + 1):
        t = i / npts
        idx = max(0, min(len(baseline)-2, int(start_idx + (end_idx - start_idx) * t)))
        a, b = baseline[idx], baseline[idx + 1]
        offset = math.sin(t * math.pi) * max_offset_m
        # Endpoints (t=0 / t=1) get sin(0)=sin(pi)=0 → no offset → exactly
        # on baseline. Middle bulges out. Jitter only applied in middle
        # (skip first and last) so endpoints remain on baseline.
        if i == 0:
            out.append(dict(baseline[start_idx]))
            continue
        if i == npts:
            out.append(dict(baseline[end_idx] if end_idx < len(baseline) else baseline[-1]))
            continue
        p = offset_along_normal(a, b, offset, t=0.3)
        cosLat = math.cos(math.radians(p['lat']))
        p['lat'] += rng.uniform(-2, 2) / 111000
        p['lng'] += rng.uniform(-2, 2) / (111000 * cosLat)
        out.append(p)
    return out


# ── BCEF flow ────────────────────────────────────────────────────────────

def run_bcef_one(brush, baseline, label='?'):
    """Returns dict of result.

    NOTE: Python self-test must mirror the production flow:
      1. endStroke magnetism (50m) — pulls brush[0]/[last] onto baseline
         IF within 50m. This makes BCEF's projB/projC effectively the
         brush endpoints themselves (gapB/gapC ≈ 0).
      2. corridor gate
      3. project B/C
      4. loop gate
      5. Mapbox match [B, ...brush, C]
      6. spliceBCEF
    """
    # Step 1: endStroke magnetism (mirrors useRouteEditStore.endStroke v261)
    ENDPOINT_SNAP_M = 50
    brush = list(brush)  # copy
    if len(brush) >= 3:
        first_proj = project_point_onto_baseline(brush[0], baseline)
        last_proj = project_point_onto_baseline(brush[-1], baseline)
        if first_proj and first_proj['dist'] <= ENDPOINT_SNAP_M:
            brush[0] = first_proj['pt']
        if last_proj and last_proj['dist'] <= ENDPOINT_SNAP_M:
            brush[-1] = last_proj['pt']
    # Step 2: corridor (uses baseline = state.originalPoints in production)
    corr = stroke_within_corridor(brush, baseline)
    if not corr['ok']:
        return {'ok': False, 'reason': 'corridor', 'corridorMaxDist': corr['maxDistM']}

    # Gate 2: project B/C
    projB = project_point_onto_baseline(brush[0], baseline)
    projC = project_point_onto_baseline(brush[-1], baseline)
    if not projB or not projC:
        return {'ok': False, 'reason': 'baseline-invalid'}
    B, C = projB['pt'], projC['pt']

    # Gate 3: loop
    if hav(B, C) < LOOP_MIN_M:
        return {'ok': False, 'reason': 'loop'}

    # Build [B, simplified_brush, C] — leave 2 slots
    brush_slots = MAPBOX_MATCHING_MAX_COORDS - 2  # 98
    if len(brush) <= brush_slots:
        bcef_brush = list(brush)
    else:
        step = (len(brush) - 1) / (brush_slots - 1)
        bcef_brush = [brush[min(len(brush)-1, round(i*step))] for i in range(brush_slots)]

    bcef_input = [B] + bcef_brush + [C]
    r = mapbox_match(bcef_input)
    if not r['ok']:
        return {'ok': False, 'reason': r['reason'], 'mapbox_detail': r.get('detail')}

    curve = r['points']
    final = splice_bcef(baseline, [{'arcB': projB['arc'], 'arcC': projC['arc'], 'curve': curve}])
    return {
        'ok': True,
        'B': B, 'C': C,
        'arcB': projB['arc'], 'arcC': projC['arc'],
        'gapB_m': hav(B, curve[0]),
        'gapC_m': hav(C, curve[-1]),
        'curve': curve,
        'curve_len': len(curve),
        'conf': r['confidence'],
        'final': final,
        'final_len': len(final),
        'corridorMaxDist': corr['maxDistM'],
    }


# ── PNG render helper (Mapbox Static API) ──────────────────────────────

def encode_polyline(pts):
    result = []
    last_lat = 0; last_lng = 0
    for p in pts:
        lat = round(p['lat'] * 1e5)
        lng = round(p['lng'] * 1e5)
        dlat = lat - last_lat; dlng = lng - last_lng
        for v in (dlat, dlng):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                result.append(chr((0x20 | (v & 0x1f)) + 63))
                v >>= 5
            result.append(chr(v + 63))
        last_lat = lat; last_lng = lng
    return ''.join(result)

def render_case_png(out_png, baseline, brush, curve, final, title=''):
    layers = []
    # baseline 蓝细
    layers.append(('1976d2', 3, 0.55, baseline))
    # brush 橙(用户笔)
    if brush and len(brush) >= 2:
        layers.append(('ff9800', 3, 0.85, brush))
    # Mapbox 还回 curve 红
    if curve and len(curve) >= 2:
        layers.append(('d32f2f', 4, 0.9, curve))
    # final 绿粗
    if final and len(final) >= 2:
        layers.append(('388e3c', 5, 0.85, final))

    overlay_parts = []
    for color, width, opacity, pts in layers:
        pl = urllib.parse.quote(encode_polyline(pts), safe='')
        overlay_parts.append(f"path-{width}+{color}-{opacity}({pl})")
    overlay = ','.join(overlay_parts)

    all_pts = []
    for _, _, _, pts in layers:
        all_pts.extend(pts)
    all_lats = [p['lat'] for p in all_pts]
    all_lngs = [p['lng'] for p in all_pts]
    pad = 0.0008
    bbox = (min(all_lngs)-pad, min(all_lats)-pad, max(all_lngs)+pad, max(all_lats)+pad)
    bbox_str = f"[{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}]"

    url = (f"https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/"
           f"{overlay}/{bbox_str}/1280x1024@2x?access_token={MAPBOX_TOKEN}&padding=40")
    if len(url) > 8100:
        return False, f'url too long {len(url)}'
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            with open(out_png, 'wb') as f:
                f.write(r.read())
        return True, None
    except urllib.error.HTTPError as e:
        try: body = e.read().decode('utf-8')[:200]
        except: body = ''
        return False, f'HTTP {e.code} {body}'
    except Exception as e:
        return False, str(e)


# ── Cases ──────────────────────────────────────────────────────────────

def load_baseline(name):
    with open(os.path.join(FIXTURES_DIR, f'route_{name}.json'), encoding='utf-8') as f:
        return json.load(f)

def define_cases():
    cases = []
    # use route 7 baseline (74 pts, "back test right2" — small road test case)
    bl7 = load_baseline(7)
    cases.append({
        'id': 'C1_small_offset',
        'desc': '单笔在 baseline 中段微偏 (20m) — 应贴 baseline',
        'baseline_id': 7,
        'baseline': bl7,
        'brush': synth_brush(bl7, 20, 35, 20, 30),
        'expect': {'accept': True, 'maxFinalGapM': 30},
    })
    cases.append({
        'id': 'C2_large_offset',
        'desc': '单笔从 baseline 中段偏 80m — 应弹回最近合法路',
        'baseline_id': 7,
        'baseline': bl7,
        'brush': synth_brush(bl7, 20, 35, 80, 30),
        'expect': {'accept': True, 'maxFinalGapM': 50},
    })
    cases.append({
        'id': 'C3_through_building',
        'desc': '单笔 50m 偏离穿过建筑物区域 — 应弹回真实路',
        'baseline_id': 7,
        'baseline': bl7,
        'brush': synth_brush(bl7, 25, 40, 50, 30, seed=99),
        'expect': {'accept': True, 'maxFinalGapM': 50},
    })
    cases.append({
        'id': 'C4_outside_corridor',
        'desc': '单笔超 250m 走廊 — 应被 corridor gate 拒收',
        'baseline_id': 7,
        'baseline': bl7,
        'brush': synth_brush(bl7, 20, 35, 300, 30),
        'expect': {'accept': False, 'rejectReason': 'corridor'},
    })
    cases.append({
        'id': 'C5_two_separate',
        'desc': '双笔不重叠 — 各自处理(只测笔1,笔2 下面会重复)',
        'baseline_id': 7,
        'baseline': bl7,
        'brush': synth_brush(bl7, 10, 20, 30, 20),
        'expect': {'accept': True, 'maxFinalGapM': 30},
    })
    cases.append({
        'id': 'C6_loop',
        'desc': '单笔 U 形回到起点 — 应被 loop gate 拒收',
        'baseline_id': 7,
        'baseline': bl7,
        'brush': (lambda b: [b, *synth_brush(bl7, 25, 35, 40, 20), b])(bl7[25]),  # B=C
        'expect': {'accept': False, 'rejectReason': 'loop'},
    })
    return cases


def run_case(c):
    print(f'\n=== {c["id"]} — {c["desc"]} ===')
    baseline = c['baseline']
    brush = c['brush']
    print(f'  baseline {len(baseline)} pts, brush {len(brush)} pts')

    r = run_bcef_one(brush, baseline, label=c['id'])

    expect = c['expect']
    pass_ = True
    reasons = []
    if expect.get('accept'):
        if not r['ok']:
            pass_ = False
            reasons.append(f"expected accept but rejected: {r['reason']}")
        else:
            mg = expect.get('maxFinalGapM', None)
            if mg is not None:
                final = r['final']
                gaps = [hav(final[i-1], final[i]) for i in range(1, len(final))]
                max_gap = max(gaps) if gaps else 0
                if max_gap > mg:
                    pass_ = False
                    reasons.append(f"final max_gap {max_gap:.1f}m > {mg}m")
                r['final_max_gap'] = max_gap
    else:
        if r['ok']:
            pass_ = False
            reasons.append('expected reject but accepted')
        elif r['reason'] != expect.get('rejectReason'):
            pass_ = False
            reasons.append(f"reject reason {r['reason']} != expected {expect['rejectReason']}")

    # render PNG
    out_png = os.path.join(OUT_DIR, f"{c['id']}.png")
    curve = r.get('curve') if r['ok'] else None
    final = r.get('final') if r['ok'] else baseline  # show baseline if rejected
    ok, err = render_case_png(out_png, baseline, brush, curve, final, title=c['id'])
    if not ok:
        reasons.append(f'png_render_failed: {err}')

    summary = {
        'id': c['id'],
        'pass': pass_,
        'reasons': reasons,
        'result': {k: v for k, v in r.items() if k not in ('curve', 'final', 'B', 'C')},
    }
    out_txt = os.path.join(OUT_DIR, f"{c['id']}.txt")
    with open(out_txt, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    if r['ok']:
        print(f"  conf={r['conf']:.3f} gapB={r['gapB_m']:.1f}m gapC={r['gapC_m']:.1f}m final={r['final_len']}pts")
        if 'final_max_gap' in r:
            print(f"  final max_gap = {r['final_max_gap']:.1f}m")
    else:
        print(f"  rejected: {r['reason']}")
    print(f"  → {'PASS' if pass_ else 'FAIL'}  {' / '.join(reasons) if reasons else ''}")
    print(f"  png: {out_png}")
    return summary


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    cases = define_cases()
    target = sys.argv[1] if len(sys.argv) > 1 else None
    if target:
        cases = [c for c in cases if c['id'] == target]
    summaries = [run_case(c) for c in cases]
    with open(os.path.join(OUT_DIR, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(summaries, f, indent=2, ensure_ascii=False)
    n_pass = sum(1 for s in summaries if s['pass'])
    print(f'\n=== overall: {n_pass}/{len(summaries)} pass ===')
    sys.exit(0 if n_pass == len(summaries) else 1)


if __name__ == '__main__':
    main()
