#!/usr/bin/env python3
"""
gen_jingan_demo_data_v2.py — v379 demo data rebuild

v378 issues reported by user:
  1. Routes were straight lines that cut through buildings.
  2. Alice's 12 marks placed at random ±400m offsets fell mostly outside
     her fog-cleared corridor (50m wide along the line) → showed as
     MysteryPin, looked like stranger marks.
  3. Routes too short — 500m direct, but a real hike is ~30 min ≈ 2.5km.

v379 fix:
  - Real Shanghai Jingan road waypoints (Nanjing W Rd, Yuyuan Rd, Changshu
    Rd, Huashan Rd, Wujiang Rd) with hand-picked turning points so the
    densified path follows actual streets, not straight lines.
  - Sessions chain MULTIPLE roads into ~2.5 km loops (30-min hikes).
  - Markers placed within ±25m of the user's own route(s), guaranteeing
    fog-cleared visibility when that user logs in.

9163 (id=4) and Dave (id=22) UNTOUCHED.
"""

import json
import math
from datetime import datetime, timedelta

# ── Real road waypoints around Jingan Temple, Shanghai ──────────────────────
# Hand-picked from satellite knowledge. Lat/Lng pairs are (lat, lng).
# Each road is a polyline; densify() interpolates 30 points per kilometre.

# Nanjing West Rd — main E-W commercial street, ~1.2km Changshu → Huashan
NANJING_W = [
    (31.22650, 121.4408),  # Huashan Rd intersection (W end)
    (31.22650, 121.4435),  # Jingan Temple metro station
    (31.22640, 121.4465),  # Jingan Temple square
    (31.22630, 121.4495),  # CITIC Square
    (31.22620, 121.4520),  # Plaza 66 area
    (31.22610, 121.4548),  # Changde Rd intersection
    (31.22600, 121.4575),  # Changshu Rd intersection (E end)
]

# Yuyuan Rd — winding French Concession-style lane, ~1.5km
YUYUAN = [
    (31.22825, 121.4395),  # Jiangsu Rd intersection (W)
    (31.22790, 121.4420),
    (31.22760, 121.4445),
    (31.22730, 121.4475),  # Yuyuan Rd / Nanjing W junction area
    (31.22700, 121.4510),
    (31.22680, 121.4540),
    (31.22660, 121.4575),  # Changshu Rd (E)
]

# Changshu Rd — N-S, connects Yuyuan ↓ Nanjing W ↓ Changle Rd, ~1.1km
CHANGSHU = [
    (31.22660, 121.4575),  # N — Yuyuan Rd
    (31.22600, 121.4575),  # Nanjing W Rd
    (31.22540, 121.4575),  # Wuding Rd
    (31.22480, 121.4575),
    (31.22420, 121.4575),  # Yan'an W Rd elevated
    (31.22360, 121.4575),  # Changle Rd intersection (S)
]

# Huashan Rd — N-S, west boundary, ~1km
HUASHAN = [
    (31.22920, 121.4408),  # N — connects to Yuyuan Rd vicinity
    (31.22820, 121.4408),
    (31.22720, 121.4408),
    (31.22650, 121.4408),  # Nanjing W Rd intersection
    (31.22580, 121.4408),
    (31.22480, 121.4408),
    (31.22380, 121.4408),  # Yan'an W Rd elevated
]

# Wujiang Rd — small pedestrian street, ~600m E of Jingan
WUJIANG = [
    (31.22685, 121.4495),  # Connects N from Nanjing W
    (31.22720, 121.4495),
    (31.22760, 121.4495),
    (31.22800, 121.4495),  # Stops at Yuyuan area
]

# Sanhe Garden internal lanes (loop inside the 1788 lane complex)
SANHE_LOOP = [
    (31.22580, 121.4485),  # Sanhe Garden entrance from Nanjing W
    (31.22560, 121.4490),
    (31.22555, 121.4500),
    (31.22565, 121.4510),
    (31.22580, 121.4505),
    (31.22580, 121.4485),  # back to start (closed loop)
]

# ── Users ──────────────────────────────────────────────────────────────────
USERS = [
    (19, '1',  'Alice'),
    (20, '2',  'Bob'),
    (21, '3',  'Carol'),
    (23, '5',  'LDY'),
    (24, '6',  'Eve'),
    (25, '7',  'Stranger 1'),
    (26, '8',  'Stranger 2'),
    (27, '9',  'Stranger 3'),
]
USER_IDS = [u[0] for u in USERS]

# ── Helpers ────────────────────────────────────────────────────────────────
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

def densify(waypoints, point_spacing_m=20):
    """Interpolate waypoints to one point every ~point_spacing_m meters."""
    if len(waypoints) < 2:
        return waypoints[:]
    total = path_distance_m(waypoints)
    n_points = max(2, int(total / point_spacing_m))
    # cumulative segment lengths
    seg_lens = [haversine_m(waypoints[i], waypoints[i+1]) for i in range(len(waypoints)-1)]
    cum = [0.0]
    for s in seg_lens:
        cum.append(cum[-1] + s)
    out = []
    for i in range(n_points):
        t = (i / (n_points - 1)) * total
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

def chain(*roads):
    """Concatenate multiple road polylines into one continuous path,
    skipping the duplicate vertex at junctions."""
    out = list(roads[0])
    for r in roads[1:]:
        out.extend(r[1:] if r[0] == out[-1] else r)
    return out

def jitter(points, seed):
    """Add ~1-3m noise to simulate GPS drift along a real hike."""
    out = []
    for j, (la, ln) in enumerate(points):
        jla = la + (((seed + j * 13) % 7 - 3) * 0.00001)  # ~1.1m per unit
        jln = ln + (((seed + j * 17) % 9 - 4) * 0.00001)
        out.append((jla, jln))
    return out

def m_to_deg_lat(m): return m / 111320
def m_to_deg_lng(m, lat): return m / (111320 * math.cos(math.radians(lat)))

# ── Sessions: 30-min hikes chaining multiple roads ─────────────────────────
# Each session = (user_id, type, route_waypoints, days_ago, name)
# Length target: 2.0–3.0 km per session

# Reverse helpers — same road in opposite direction
NANJING_W_REV = list(reversed(NANJING_W))
YUYUAN_REV = list(reversed(YUYUAN))
CHANGSHU_REV = list(reversed(CHANGSHU))
HUASHAN_REV = list(reversed(HUASHAN))

SESSIONS = [
    # Alice — 2 hikes, each ~2.5km
    (19, 'hiking',  chain(NANJING_W, CHANGSHU, [(31.22360, 121.4575), (31.22360, 121.4408)], HUASHAN_REV),
        7, 'Alice — Jingan loop'),
    (19, 'running', chain(YUYUAN, CHANGSHU[:3], NANJING_W_REV[2:]),
        5, 'Alice — Yuyuan run'),

    # Bob — 2 hikes
    (20, 'hiking',  chain(NANJING_W, WUJIANG, YUYUAN_REV),
        6, 'Bob — North loop'),
    (20, 'hiking',  chain(CHANGSHU, [(31.22360, 121.4575), (31.22360, 121.4408)], HUASHAN[3:]),
        4, 'Bob — South perimeter'),

    # Carol — 1 short hike (newer user)
    (21, 'running', chain(NANJING_W[:4], WUJIANG),
        3, 'Carol — Quick after-work run'),

    # LDY (power user) — 4 hikes covering all roads
    (23, 'hiking',  chain(NANJING_W, CHANGSHU, [(31.22360, 121.4575), (31.22360, 121.4408)], HUASHAN_REV),
        14, 'LDY — Big perimeter'),
    (23, 'hiking',  chain(YUYUAN, CHANGSHU, NANJING_W_REV, HUASHAN[:4]),
        12, 'LDY — Cross figure-8'),
    (23, 'hiking',  chain(NANJING_W, SANHE_LOOP, NANJING_W_REV[:3]),
        10, 'LDY — Sanhe garden'),
    (23, 'running', chain(YUYUAN, WUJIANG[::-1], NANJING_W),
        2,  'LDY — Yuyuan-Nanjing'),

    # Eve — 2 hikes
    (24, 'hiking',  chain(YUYUAN, WUJIANG[::-1]),
        8, 'Eve — Yuyuan stroll'),
    (24, 'running', chain(NANJING_W, CHANGSHU[:4]),
        4, 'Eve — Quick lap'),

    # Strangers — shorter, different areas
    (25, 'hiking',  CHANGSHU,      6, 'Stranger1 — Changshu walk'),
    (26, 'hiking',  HUASHAN[2:],   5, 'Stranger2 — Huashan south'),
    (27, 'hiking',  NANJING_W[3:], 4, 'Stranger3 — East Nanjing'),
]

# ── Markers placed ALONG each user's route(s) ─────────────────────────────
# Strategy: pick N waypoints from the user's session paths, place mark
# within 20m perpendicular offset (i.e. on the road side). Guarantees the
# mark is inside the user's fog-cleared 25m corridor.

def perp_offset_m(p_from, p_to, side_m):
    """Return a lat/lng offset perpendicular to the segment p_from→p_to by side_m metres."""
    # Direction
    dy = p_to[0] - p_from[0]
    dx = (p_to[1] - p_from[1]) * math.cos(math.radians(p_from[0]))
    norm = math.hypot(dy, dx) or 1e-9
    # Perpendicular = rotate 90° CCW: (dx, -dy)
    px, py = dx / norm, -dy / norm
    return (p_from[0] + (py * side_m) / 111320,
            p_from[1] + (px * side_m) / (111320 * math.cos(math.radians(p_from[0]))))

def marks_along(path, count, offsets_m, perm, types, texts):
    """Generate N markers spaced evenly along a path, perpendicularly
    offset (alternating side). offsets_m is a list cycled to side_m."""
    n = len(path)
    out = []
    for i in range(count):
        idx = int((i + 0.5) * (n - 1) / count)
        idx_next = min(idx + 1, n - 1)
        side = offsets_m[i % len(offsets_m)]
        lat, lng = perp_offset_m(path[idx], path[idx_next], side)
        out.append((lat, lng, types[i % len(types)], texts[i % len(texts)], perm))
    return out

ALICE_PATH = chain(NANJING_W, CHANGSHU, [(31.22360, 121.4575), (31.22360, 121.4408)], HUASHAN_REV, YUYUAN)
BOB_PATH = chain(NANJING_W, WUJIANG, YUYUAN, CHANGSHU)
CAROL_PATH = chain(NANJING_W[:4], WUJIANG)
LDY_PATH = chain(NANJING_W, CHANGSHU, HUASHAN, YUYUAN, SANHE_LOOP, WUJIANG)
EVE_PATH = chain(YUYUAN, WUJIANG, NANJING_W, CHANGSHU[:4])

ICON_TYPES = ['cairn', 'water', 'junction', 'danger', 'free']
MARK_TEXTS_FRIEND = [
    'Quiet spot to rest', 'Water refill OK', 'Tricky junction',
    'Watch the curb here', 'Best cafe nearby', 'Nice view',
    'Convenience store', 'Public restroom', 'Good photo angle',
    'Path narrows', 'Shade under trees', 'Bench here',
    'ATM 50m', 'Bus stop', 'Wifi cafe',
]

# (user_id, lat, lng, type, text, permission)
MARKERS = []
# Alice — 12 friend-tier, spread along her path
for lat, lng, mtype, text, perm in marks_along(ALICE_PATH, 12, [15, -15, 18, -18], 'group', ICON_TYPES, MARK_TEXTS_FRIEND):
    MARKERS.append((19, lat, lng, mtype, text, perm))
# Bob — 8 friend-tier
for lat, lng, mtype, text, perm in marks_along(BOB_PATH, 8, [12, -12, 16, -16], 'group', ICON_TYPES, MARK_TEXTS_FRIEND):
    MARKERS.append((20, lat, lng, mtype, text, perm))
# Carol — 4 public
for lat, lng, mtype, text, perm in marks_along(CAROL_PATH, 4, [10, -10], 'public', ICON_TYPES, MARK_TEXTS_FRIEND):
    MARKERS.append((21, lat, lng, mtype, text, perm))
# LDY — 15 friend-tier
for lat, lng, mtype, text, perm in marks_along(LDY_PATH, 15, [14, -14, 17, -17, 20, -20], 'group', ICON_TYPES, MARK_TEXTS_FRIEND):
    MARKERS.append((23, lat, lng, mtype, text, perm))
# Eve — 6 friend-tier
for lat, lng, mtype, text, perm in marks_along(EVE_PATH, 6, [12, -12, 15, -15], 'group', ICON_TYPES, MARK_TEXTS_FRIEND):
    MARKERS.append((24, lat, lng, mtype, text, perm))
# Stranger 1 (id 25) — 1 public on Changshu
for lat, lng, mtype, text, perm in marks_along(CHANGSHU, 1, [10], 'public', ['cairn'], ['Public marker S']):
    MARKERS.append((25, lat, lng, mtype, text, perm))
# Stranger 2 (id 26) — 3 public on Huashan south
for lat, lng, mtype, text, perm in marks_along(HUASHAN[2:], 3, [10, -10], 'public', ICON_TYPES, ['Bench', 'Tree shade', 'Crosswalk']):
    MARKERS.append((26, lat, lng, mtype, text, perm))
# Stranger 3 (id 27) — 5 public on East Nanjing
for lat, lng, mtype, text, perm in marks_along(NANJING_W[3:], 5, [10, -10, 13, -13], 'public', ICON_TYPES,
                                                ['Coffee', 'Newsstand', 'Stairs', 'Subway entry', 'Vendor']):
    MARKERS.append((27, lat, lng, mtype, text, perm))

# ── SQL generation ────────────────────────────────────────────────────────
def sql_escape(s):
    return s.replace("'", "''")

def gen_sql():
    lines = []
    lines.append("-- v379 demo data rebuild — generated by gen_jingan_demo_data_v2.py")
    lines.append("-- Real Shanghai Jingan road waypoints; 30-min ~2.5km hikes; marks vetted on-path.")
    lines.append("-- 9163 (id=4) and Dave (id=22) UNTOUCHED.")
    lines.append("USE cairn;")
    ids_csv = ",".join(str(u) for u in USER_IDS)
    lines.append(f"DELETE FROM memory_points WHERE user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM markers       WHERE user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM routes        WHERE user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM sessions      WHERE user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM friends                  WHERE user_id IN ({ids_csv}) OR friend_id IN ({ids_csv});")
    lines.append(f"DELETE FROM friend_requests          WHERE from_user_id IN ({ids_csv}) OR to_user_id IN ({ids_csv});")
    lines.append(f"DELETE FROM memory_subscriptions     WHERE user_id IN ({ids_csv}) OR friend_id IN ({ids_csv});")
    lines.append("")

    now = datetime(2026, 6, 28, 12, 0, 0)
    route_inserts = []

    for i, (uid, sess_type, waypoints, days_ago, name) in enumerate(SESSIONS):
        # Densify: 1 point every ~17m
        points = densify(waypoints, point_spacing_m=17)
        # GPS jitter
        jit_points = jitter(points, uid * 7 + i)
        dist_m = path_distance_m(jit_points)
        # Walking pace: 4.8 km/h → ~0.75s per metre
        duration_s = int(dist_m * 0.75)
        start_dt = now - timedelta(days=days_ago)
        end_dt = start_dt + timedelta(seconds=duration_s)
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
        for k, (la, ln) in enumerate(jit_points):
            ts_ms = start_ms + k * ts_step
            cid = f"demo-{uid}-{i}-{k}"
            lines.append(
                f"INSERT INTO memory_points (user_id, lat, lng, ts, client_id) "
                f"VALUES ({uid}, {la}, {ln}, {ts_ms}, '{cid}');"
            )
        # Alice session 0, LDY sessions 0+2 → become routes
        if uid == 19 and i == 0:
            route_inserts.append((uid, name + ' (saved route)', jit_points, dist_m))
        if uid == 23 and i == 5:
            route_inserts.append((uid, name + ' (saved route)', jit_points, dist_m))
        if uid == 23 and i == 7:
            route_inserts.append((uid, name + ' (saved route)', jit_points, dist_m))

    lines.append("")
    lines.append("-- Routes: Alice×1, LDY×2 (derived from sessions)")
    for uid, rname, pts, dist_m in route_inserts:
        rp_json = [{"lat": la, "lng": ln} for la, ln in pts]
        rp_json_s = sql_escape(json.dumps(rp_json))
        rname_s = sql_escape(rname)
        lines.append(
            f"INSERT INTO routes (user_id, name, points, distance_m, elevation_gain_m, permission) "
            f"VALUES ({uid}, '{rname_s}', '{rp_json_s}', {dist_m:.1f}, 0, 'friend');"
        )

    lines.append("")
    lines.append("-- Markers along user paths (within ±20m of route corridor)")
    for uid, lat, lng, mtype, text, perm in MARKERS:
        text_s = sql_escape(text)
        lines.append(
            f"INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at) "
            f"VALUES ({uid}, '{mtype}', '{text_s}', {lat:.6f}, {lng:.6f}, '{perm}', 'tier_g', 0, 'healthy', NOW(), NOW());"
        )

    lines.append("")
    lines.append("-- Sanity counts")
    lines.append(
        f"SELECT 'sessions' AS t, COUNT(*) c FROM sessions WHERE user_id IN ({ids_csv}) UNION ALL "
        f"SELECT 'memory_points', COUNT(*) FROM memory_points WHERE user_id IN ({ids_csv}) UNION ALL "
        f"SELECT 'markers', COUNT(*) FROM markers WHERE user_id IN ({ids_csv}) UNION ALL "
        f"SELECT 'routes', COUNT(*) FROM routes WHERE user_id IN ({ids_csv});"
    )

    # Per-user session length summary (for QA)
    lines.append("")
    lines.append("-- Per-user session distance summary")
    lines.append(
        f"SELECT u.name, COUNT(s.id) AS sessions, ROUND(AVG(s.distance_m)) AS avg_m, ROUND(SUM(s.distance_m)) AS total_m "
        f"FROM users u LEFT JOIN sessions s ON s.user_id = u.id WHERE u.id IN ({ids_csv}) GROUP BY u.id ORDER BY u.id;"
    )

    return "\n".join(lines)

if __name__ == '__main__':
    print(gen_sql())
