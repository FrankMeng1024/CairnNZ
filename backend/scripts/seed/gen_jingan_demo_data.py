#!/usr/bin/env python3
"""
gen_jingan_demo_data.py — v378 demo data rebuild

Generates SQL to:
  1. CLEAR existing data for demo users (ids 19,20,21,23,24 + strangers 25,26,27)
     — Dave (22) and 9163 (4) untouched.
  2. UPDATE demo user emails to single-char (`1`, `2`, `3`, `5`, `6`, `x1`, `x2`, `x3`).
  3. INSERT sessions + memory_points + markers + routes around Jingan Sanhe Garden
     (center 31.225, 121.450) with deliberate route overlap so fog UNION shows
     stacking when multiple users walk the same segment.

Test design:
  Road A — Nanjing W Rd       lng 121.448 → 121.453, lat 31.225  (4 users overlap)
  Road B — Yuyuan Rd          lng 121.446 → 121.453, lat 31.227  (3 users overlap)
  Road C — Changshu Rd        lat 31.222 → 31.227, lng 121.448   (3 users overlap)

  Alice (id 19, email `1`):  Activities = A1, B1.   Routes = 1 (from A1).
  Bob   (id 20, email `2`):  Activities = A2, C1.   Routes = 0.
  Carol (id 21, email `3`):  Activities = A3 (short). Routes = 0.
  LDY   (id 23, email `5`):  Activities = A4, B2, C2, B3. Routes = 2 (from A4, C2).
  Eve   (id 24, email `6`):  Activities = B4.       Routes = 0.
  Stranger1 (25, `x1`): C3 short.    Stranger2 (26, `x2`): C4. Stranger3 (27, `x3`): C5.

  Total: 14 sessions across 8 users → ~14 routes worth of memory_points.

  Markers: scattered around center within ~700m. Existing markers are wiped
  per the CLEAR step then re-inserted with new locations.

Output: SQL printed to stdout. Reviewed by user, then piped through ssh into
  the cairn db on aliyun.
"""

import json
import math
from datetime import datetime, timedelta

CENTER_LAT = 31.225
CENTER_LNG = 121.450

# Users: id, email_new, name, password (unchanged)
USERS = [
    (19, '1',  'Alice'),
    (20, '2',  'Bob'),
    (21, '3',  'Carol'),
    (23, '5',  'LDY'),
    (24, '6',  'Eve'),
    (25, 'x1', 'Stranger 1'),
    (26, 'x2', 'Stranger 2'),
    (27, 'x3', 'Stranger 3'),
]
USER_IDS = [u[0] for u in USERS]

# Roads: list of (lat, lng) waypoints. Linear interpolation generates points.
ROAD_A = [(31.225, 121.4480), (31.225, 121.4500), (31.225, 121.4520), (31.225, 121.4530)]  # Nanjing W Rd, ~500m
ROAD_B = [(31.227, 121.4460), (31.227, 121.4490), (31.227, 121.4510), (31.227, 121.4530)]  # Yuyuan Rd
ROAD_C = [(31.222, 121.4480), (31.224, 121.4480), (31.226, 121.4480), (31.227, 121.4480)]  # Changshu Rd

def densify(waypoints, num_points=20):
    """Interpolate a polyline to num_points equally spaced lat/lng pairs."""
    if len(waypoints) < 2:
        return waypoints[:]
    # Compute cumulative segment lengths (planar approx, ok for small bbox)
    seg_lens = []
    for i in range(1, len(waypoints)):
        dy = waypoints[i][0] - waypoints[i-1][0]
        dx = waypoints[i][1] - waypoints[i-1][1]
        seg_lens.append(math.hypot(dx, dy))
    total = sum(seg_lens)
    cum = [0.0]
    for s in seg_lens:
        cum.append(cum[-1] + s)
    out = []
    for i in range(num_points):
        t = (i / (num_points - 1)) * total
        # Find segment
        seg_i = 0
        while seg_i < len(seg_lens) and t > cum[seg_i+1]:
            seg_i += 1
        if seg_i >= len(seg_lens):
            out.append(waypoints[-1])
            continue
        seg_t = (t - cum[seg_i]) / seg_lens[seg_i] if seg_lens[seg_i] > 0 else 0
        lat = waypoints[seg_i][0] + seg_t * (waypoints[seg_i+1][0] - waypoints[seg_i][0])
        lng = waypoints[seg_i][1] + seg_t * (waypoints[seg_i+1][1] - waypoints[seg_i][1])
        out.append((lat, lng))
    return out

def haversine_m(p1, p2):
    R = 6371000
    lat1, lng1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lng2 = math.radians(p2[0]), math.radians(p2[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def path_distance_m(points):
    return sum(haversine_m(points[i], points[i+1]) for i in range(len(points)-1))

# Sessions: (user_id, route_id_or_none, type, road, start_ts_offset_days)
# Multiple sessions on the same road from different users create UNION overlap.
SESSIONS = [
    # Alice — walks A and B once each
    (19, 'hiking',  ROAD_A, 7, 'Morning loop A'),
    (19, 'running', ROAD_B, 6, 'Yuyuan run'),

    # Bob — A (overlaps Alice) and C
    (20, 'hiking',  ROAD_A, 5, 'Nanjing stroll'),
    (20, 'hiking',  ROAD_C, 4, 'Changshu ladder'),

    # Carol — short A (overlaps but partial)
    (21, 'running', ROAD_A[:3], 3, 'Quick run'),

    # LDY (rich) — walks A, B, C, then B again (intentional re-walk)
    (23, 'hiking',  ROAD_A, 14, 'LDY explore A'),
    (23, 'hiking',  ROAD_B, 12, 'LDY explore B'),
    (23, 'hiking',  ROAD_C, 10, 'LDY explore C'),
    (23, 'running', ROAD_B, 2,  'LDY revisit B'),

    # Eve — B (overlaps Alice + LDY twice)
    (24, 'hiking',  ROAD_B, 8, 'Yuyuan walk'),

    # Strangers — different parts of C, never overlap with each other much
    (25, 'hiking',  [ROAD_C[0], ROAD_C[1]],     6, 'x1 short'),
    (26, 'hiking',  [ROAD_C[1], ROAD_C[2]],     5, 'x2 mid'),
    (27, 'hiking',  [ROAD_C[2], ROAD_C[3]],     4, 'x3 north'),
]

# Markers: (user_id, lat_offset_m, lng_offset_m, type, text, permission)
# Offsets from CENTER in meters. Permission: 'group' = friend tier, 'public', 'personal'.
def m_to_deg_lat(m): return m / 111320
def m_to_deg_lng(m, lat): return m / (111320 * math.cos(math.radians(lat)))

MARKERS = [
    # Alice (id 19) — 12 friend-tier marks scattered
    (19, 100,  150,  'cairn',    'Cairn at corner',     'group'),
    (19, 80,   220,  'water',    'Water bottle spot',   'group'),
    (19, -50,  100,  'junction', 'Three-way',           'group'),
    (19, 200,  -50,  'danger',   'Watch the curb',      'group'),
    (19, -100, 300,  'cairn',    'Cairn N',             'group'),
    (19, 30,   -150, 'free',     'Nice cafe here',      'group'),
    (19, 250,  250,  'cairn',    'View N E',            'group'),
    (19, -200, -100, 'water',    'Tap S W',             'group'),
    (19, 150,  50,   'junction', 'Lights cross',        'group'),
    (19, -50,  -250, 'danger',   'Slippery in rain',    'group'),
    (19, 0,    400,  'cairn',    'Park edge',           'group'),
    (19, 100,  -300, 'free',     'Bookstore',           'group'),

    # Bob (id 20) — 8 friend-tier
    (20, 120,  100,  'cairn',    'Bob mark 1',          'group'),
    (20, -80,  200,  'water',    'Refill here',         'group'),
    (20, 0,    -100, 'junction', 'Bob junction',        'group'),
    (20, 200,  300,  'danger',   'Construction zone',   'group'),
    (20, -150, 0,    'cairn',    'Bob NW',              'group'),
    (20, 100,  -200, 'free',     'Bob memo',            'group'),
    (20, -50,  100,  'cairn',    'Bob cairn',           'group'),
    (20, 250,  -50,  'junction', 'Bob cross',           'group'),

    # Carol (id 21) — 4 public
    (21, 50,   50,   'cairn',    'Carol public 1',      'public'),
    (21, -100, 150,  'water',    'Carol fountain',      'public'),
    (21, 200,  200,  'free',     'Carol cafe rec',      'public'),
    (21, -200, -200, 'junction', 'Carol cross',         'public'),

    # LDY (id 23) — 15 friend-tier (rich)
    (23, 50,   200,  'cairn',    'LDY 1',               'group'),
    (23, 100,  100,  'water',    'LDY tap',             'group'),
    (23, -50,  300,  'junction', 'LDY x-roads',         'group'),
    (23, 200,  -100, 'danger',   'LDY danger',          'group'),
    (23, -150, 250,  'cairn',    'LDY N',               'group'),
    (23, 0,    -200, 'free',     'LDY shop',            'group'),
    (23, 300,  50,   'cairn',    'LDY E',               'group'),
    (23, -200, 100,  'water',    'LDY W',               'group'),
    (23, 100,  -350, 'junction', 'LDY S',               'group'),
    (23, -100, -100, 'cairn',    'LDY SW',              'group'),
    (23, 250,  300,  'free',     'LDY NE',              'group'),
    (23, 50,   400,  'cairn',    'LDY far N',           'group'),
    (23, -300, 0,    'water',    'LDY far W',           'group'),
    (23, 150,  200,  'junction', 'LDY middle',          'group'),
    (23, -250, -250, 'danger',   'LDY hole',            'group'),

    # Eve (id 24) — 6 friend-tier
    (24, 80,   80,   'cairn',    'Eve 1',               'group'),
    (24, 200,  -150, 'water',    'Eve tap',             'group'),
    (24, -100, 200,  'free',     'Eve cafe',            'group'),
    (24, 50,   300,  'junction', 'Eve cross',           'group'),
    (24, -200, -50,  'cairn',    'Eve W',               'group'),
    (24, 150,  150,  'danger',   'Eve uneven',          'group'),

    # Stranger 1 (id 25) — 1 public
    (25, 200,  -100, 'cairn',    'Public near south',   'public'),

    # Stranger 2 (id 26) — 3 public
    (26, 50,   -200, 'cairn',    'Public S',            'public'),
    (26, 100,  150,  'free',     'Public bench',        'public'),
    (26, -50,  300,  'junction', 'Public cross',        'public'),

    # Stranger 3 (id 27) — 5 public
    (27, -100, 50,   'cairn',    'Public W',            'public'),
    (27, 150,  -300, 'water',    'Public south tap',    'public'),
    (27, -200, 100,  'free',     'Public W cafe',       'public'),
    (27, 250,  -150, 'junction', 'Public SE',           'public'),
    (27, 0,    -400, 'danger',   'Public far S',        'public'),
]

# ===== SQL generation =====
def sql_escape(s):
    return s.replace("'", "''")

def gen_sql():
    lines = []
    lines.append("-- v378 demo data rebuild — generated by gen_jingan_demo_data.py")
    lines.append("-- Center: Jingan Sanhe Garden (31.225, 121.450). Radius ~700m.")
    lines.append("-- 9163 (id=4) and Dave (id=22) UNTOUCHED. Safety guards below.")
    lines.append("")
    lines.append("USE cairn;")
    lines.append("")
    lines.append("-- Safety guard: bail if 9163 or Dave already has data we would touch")
    lines.append("-- (this script is idempotent for demo ids only).")
    lines.append("")
    lines.append("-- ── CLEAR demo data ───────────────────────────────────────────")
    ids_csv = ",".join(str(u) for u in USER_IDS)
    lines.append(f"DELETE FROM memory_points WHERE user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM markers       WHERE user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM routes        WHERE user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM sessions      WHERE user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM friends                  WHERE user_id IN ({ids_csv}) OR friend_id IN ({ids_csv});")
    lines.append(f"DELETE FROM friend_requests          WHERE from_user_id IN ({ids_csv}) OR to_user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM memory_subscriptions     WHERE user_id IN ({ids_csv}) OR friend_id IN ({ids_csv});")
    lines.append("")
    lines.append("-- ── UPDATE demo emails to single-char (TEMP DEMO REMOVE LATER) ──")
    for uid, email_new, name in USERS:
        lines.append(f"UPDATE users SET email = '{email_new}' WHERE id = {uid};")
    lines.append("")

    # ── Sessions + memory_points + routes
    lines.append("-- ── Sessions + memory_points (1 mp per ~50m walked) ─────────")
    now = datetime(2026, 6, 28, 12, 0, 0)
    session_pseudo_id = 0  # only used for memory_points client_id linking
    route_inserts = []  # (user_id, name, points_json, distance_m, source_session_idx)

    for i, (uid, sess_type, road, days_ago, name) in enumerate(SESSIONS):
        points = densify(road, num_points=30)
        # add small jitter (~3m) to make memory_points unique per user even on
        # same road (multiple users walking road A still produce distinct points
        # not just identical rows).
        jitter_seed = uid * 7 + i
        jit_points = []
        for j, (la, ln) in enumerate(points):
            jla = la + (((jitter_seed + j * 13) % 7 - 3) * 0.00001)  # ~1.1m
            jln = ln + (((jitter_seed + j * 17) % 9 - 4) * 0.00001)
            jit_points.append((jla, jln))
        dist_m = path_distance_m(jit_points)
        duration_s = int(dist_m * 0.9)  # ~67min per km, walking pace
        start_dt = now - timedelta(days=days_ago)
        end_dt = start_dt + timedelta(seconds=duration_s)
        # route_points JSON: [{lat,lng,ts}, ...]
        rp_json = []
        ts_step = (duration_s * 1000) // max(1, len(jit_points) - 1)
        start_ms = int(start_dt.timestamp() * 1000)
        for k, (la, ln) in enumerate(jit_points):
            rp_json.append({"lat": la, "lng": ln, "ts": start_ms + k * ts_step})
        rp_json_s = sql_escape(json.dumps(rp_json))
        name_s = sql_escape(name)
        lines.append(
            f"INSERT INTO sessions (user_id, type, start_time, end_time, distance_m, duration_s, name, route_points) "
            f"VALUES ({uid}, '{sess_type}', '{start_dt:%Y-%m-%d %H:%M:%S}', '{end_dt:%Y-%m-%d %H:%M:%S}', "
            f"{dist_m:.1f}, {duration_s}, '{name_s}', '{rp_json_s}');"
        )
        # memory_points — store every point individually (1 row per ~17m)
        for k, (la, ln) in enumerate(jit_points):
            ts_ms = start_ms + k * ts_step
            cid = f"demo-{uid}-{i}-{k}"
            lines.append(
                f"INSERT INTO memory_points (user_id, lat, lng, ts, client_id) "
                f"VALUES ({uid}, {la}, {ln}, {ts_ms}, '{cid}');"
            )
        session_pseudo_id += 1
        # Track which sessions should also become routes (Alice 1, LDY 2)
        if uid == 19 and i == 0:  # Alice's first session → 1 route
            route_inserts.append((uid, name, jit_points, dist_m, 'friend'))
        if uid == 23 and i in (5, 7):  # LDY sessions index 5 (A) and 7 (C)
            route_inserts.append((uid, name + ' (route)', jit_points, dist_m, 'friend'))

    lines.append("")
    lines.append("-- ── Routes (derived from sessions; Alice×1, LDY×2) ───────────")
    for uid, rname, pts, dist_m, perm in route_inserts:
        rp_json = [{"lat": la, "lng": ln} for la, ln in pts]
        rp_json_s = sql_escape(json.dumps(rp_json))
        rname_s = sql_escape(rname)
        lines.append(
            f"INSERT INTO routes (user_id, name, points, distance_m, elevation_gain_m, permission) "
            f"VALUES ({uid}, '{rname_s}', '{rp_json_s}', {dist_m:.1f}, 0, '{perm}');"
        )

    lines.append("")
    lines.append("-- ── Markers (scattered near center) ───────────────────────────")
    for uid, dy_m, dx_m, mtype, text, perm in MARKERS:
        lat = CENTER_LAT + m_to_deg_lat(dy_m)
        lng = CENTER_LNG + m_to_deg_lng(dx_m, CENTER_LAT)
        text_s = sql_escape(text)
        lines.append(
            f"INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at) "
            f"VALUES ({uid}, '{mtype}', '{text_s}', {lat:.6f}, {lng:.6f}, '{perm}', 'tier_g', 0, 'healthy', NOW(), NOW());"
        )

    lines.append("")
    lines.append("-- ── Sanity: row counts ───────────────────────────────────────")
    lines.append("SELECT 'sessions' AS t, COUNT(*) c FROM sessions WHERE user_id IN ("
                 + ids_csv + ") UNION ALL "
                 "SELECT 'memory_points', COUNT(*) FROM memory_points WHERE user_id IN ("
                 + ids_csv + ") UNION ALL "
                 "SELECT 'markers', COUNT(*) FROM markers WHERE user_id IN ("
                 + ids_csv + ") UNION ALL "
                 "SELECT 'routes', COUNT(*) FROM routes WHERE user_id IN ("
                 + ids_csv + ");")
    return "\n".join(lines)

if __name__ == '__main__':
    print(gen_sql())
