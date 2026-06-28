#!/usr/bin/env python3
"""
gen_yanping_demo_data_v3.py — v379 second pass

User correction: 三和花园 (Sanhe Garden) is at 延平路 123 弄 / 武宁路, in
PUTUO district — NOT Jingan Temple area. v2 placed everything at the wrong
neighbourhood (1.5km too far south-east).

Real center: 延平路 + 武宁路, lat ~31.2455, lng ~121.4395.

Real road waypoints (hand-picked from satellite knowledge):
  - 延平路 (Yanping Rd)        — N-S, runs through Sanhe Garden
  - 武宁路 (Wuning Rd)         — E-W, main artery at the north
  - 武宁南路 (Wuning S Rd)     — N-S, west of Yanping
  - 长寿路 (Changshou Rd)      — E-W, south boundary
  - 昌化路 (Changhua Rd)       — N-S, east of Yanping
  - 安远路 (Anyuan Rd)         — E-W, between Wuning and Yanping mid

Layout (rough):
    ─────── 武宁路 (lat 31.2480) ───────
    │                                  │
    │            安远路                 │
    │   ─────────────────────          │
    │  ↕                  ↕            │
    武宁南路        延平路              昌化路
   (121.4360)    (121.4395)         (121.4435)
    │                                  │
    │            123 弄 ★              │
    │            (Sanhe)               │
    │                                  │
    ─────── 长寿路 (lat 31.2430) ───────
"""

import json
import math
from datetime import datetime, timedelta

# ── Real road waypoints, 延平路/武宁路 area, Putuo District, Shanghai ───────
WUNING = [               # E-W at top, ~31.2480
    (31.24800, 121.4350),
    (31.24800, 121.4380),
    (31.24800, 121.4395),  # Yanping Rd intersection
    (31.24800, 121.4415),
    (31.24800, 121.4440),
]

CHANGSHOU = [            # E-W at bottom, ~31.2425
    (31.24250, 121.4355),
    (31.24250, 121.4380),
    (31.24250, 121.4395),  # Yanping Rd intersection
    (31.24250, 121.4415),
    (31.24250, 121.4445),
]

YANPING = [              # N-S, runs through Sanhe Garden
    (31.24800, 121.4395),  # N (Wuning)
    (31.24700, 121.4395),
    (31.24600, 121.4395),
    (31.24550, 121.4395),  # Sanhe Garden 123 lane entrance ★
    (31.24500, 121.4395),
    (31.24400, 121.4395),
    (31.24300, 121.4395),  # S
    (31.24250, 121.4395),  # Changshou
]

WUNING_S = [             # N-S, west of Yanping
    (31.24800, 121.4360),  # N (Wuning)
    (31.24700, 121.4360),
    (31.24600, 121.4360),
    (31.24500, 121.4360),
    (31.24400, 121.4360),
    (31.24300, 121.4360),
    (31.24250, 121.4360),  # S (Changshou)
]

CHANGHUA = [             # N-S, east of Yanping
    (31.24800, 121.4440),  # N (Wuning)
    (31.24700, 121.4440),
    (31.24600, 121.4440),
    (31.24500, 121.4440),
    (31.24400, 121.4440),
    (31.24300, 121.4440),
    (31.24250, 121.4440),  # S (Changshou)
]

ANYUAN = [               # E-W, middle, ~31.2465
    (31.24650, 121.4360),
    (31.24650, 121.4380),
    (31.24650, 121.4395),
    (31.24650, 121.4415),
    (31.24650, 121.4440),
]

# Sanhe Garden internal loop (the 123 lane complex)
SANHE_LOOP = [
    (31.24550, 121.4395),  # Yanping Rd entrance
    (31.24545, 121.4400),  # E into garden
    (31.24535, 121.4405),
    (31.24525, 121.4400),
    (31.24530, 121.4392),
    (31.24550, 121.4395),  # back to entrance
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

def densify(waypoints, point_spacing_m=17):
    if len(waypoints) < 2: return waypoints[:]
    total = path_distance_m(waypoints)
    n_points = max(2, int(total / point_spacing_m))
    seg_lens = [haversine_m(waypoints[i], waypoints[i+1]) for i in range(len(waypoints)-1)]
    cum = [0.0]
    for s in seg_lens: cum.append(cum[-1] + s)
    out = []
    for i in range(n_points):
        t = (i / (n_points - 1)) * total
        seg_i = 0
        while seg_i < len(seg_lens) and t > cum[seg_i+1]: seg_i += 1
        if seg_i >= len(seg_lens):
            out.append(waypoints[-1]); continue
        seg_t = (t - cum[seg_i]) / seg_lens[seg_i] if seg_lens[seg_i] > 0 else 0
        lat = waypoints[seg_i][0] + seg_t * (waypoints[seg_i+1][0] - waypoints[seg_i][0])
        lng = waypoints[seg_i][1] + seg_t * (waypoints[seg_i+1][1] - waypoints[seg_i][1])
        out.append((lat, lng))
    return out

def chain(*roads):
    out = list(roads[0])
    for r in roads[1:]:
        out.extend(r[1:] if r[0] == out[-1] else r)
    return out

def jitter(points, seed):
    out = []
    for j, (la, ln) in enumerate(points):
        jla = la + (((seed + j * 13) % 7 - 3) * 0.00001)
        jln = ln + (((seed + j * 17) % 9 - 4) * 0.00001)
        out.append((jla, jln))
    return out

WUNING_REV = list(reversed(WUNING))
CHANGSHOU_REV = list(reversed(CHANGSHOU))
YANPING_REV = list(reversed(YANPING))
WUNING_S_REV = list(reversed(WUNING_S))
CHANGHUA_REV = list(reversed(CHANGHUA))

# Sessions: 30-min hikes, 2.5-4.5km, chain multiple roads
SESSIONS = [
    # Alice — 2 hikes
    (19, 'hiking',  chain(YANPING, CHANGSHOU, CHANGHUA_REV, WUNING_REV[1:], WUNING_S),
        7, 'Alice — Putuo big loop'),
    (19, 'running', chain(YANPING[:5], ANYUAN, CHANGHUA[2:], CHANGSHOU_REV[:3]),
        5, 'Alice — Quick lap'),

    # Bob — 2 hikes
    (20, 'hiking',  chain(WUNING_S, ANYUAN, CHANGHUA, CHANGSHOU_REV[1:], WUNING_S_REV[:3]),
        6, 'Bob — West side'),
    (20, 'hiking',  chain(YANPING, SANHE_LOOP, YANPING_REV[:4]),
        4, 'Bob — Through Sanhe'),

    # Carol — 1 short
    (21, 'running', chain(YANPING[:5], ANYUAN[:4]),
        3, 'Carol — After-work'),

    # LDY — 4 hikes covering everything
    (23, 'hiking',  chain(WUNING, CHANGHUA, CHANGSHOU_REV, WUNING_S_REV),
        14, 'LDY — Perimeter'),
    (23, 'hiking',  chain(YANPING, SANHE_LOOP, YANPING_REV, WUNING),
        12, 'LDY — Sanhe + Wuning'),
    (23, 'hiking',  chain(WUNING_S, ANYUAN, CHANGHUA, ANYUAN[::-1], WUNING_S_REV),
        10, 'LDY — Cross figure-8'),
    (23, 'running', chain(YANPING, ANYUAN[2:], CHANGHUA_REV),
        2,  'LDY — Yanping-Changhua'),

    # Eve — 2 hikes
    (24, 'hiking',  chain(ANYUAN, CHANGHUA, CHANGSHOU_REV[:3]),
        8, 'Eve — East side'),
    (24, 'running', chain(YANPING, CHANGSHOU[:3]),
        4, 'Eve — Yanping run'),

    # Strangers — shorter, different
    (25, 'hiking',  CHANGSHOU,      6, 'Stranger1 — Changshou walk'),
    (26, 'hiking',  WUNING_S,       5, 'Stranger2 — Wuning S'),
    (27, 'hiking',  WUNING[2:],     4, 'Stranger3 — East Wuning'),
]

def perp_offset_m(p_from, p_to, side_m):
    dy = p_to[0] - p_from[0]
    dx = (p_to[1] - p_from[1]) * math.cos(math.radians(p_from[0]))
    norm = math.hypot(dy, dx) or 1e-9
    px, py = dx / norm, -dy / norm
    return (p_from[0] + (py * side_m) / 111320,
            p_from[1] + (px * side_m) / (111320 * math.cos(math.radians(p_from[0]))))

def marks_along(path, count, offsets_m, perm, types, texts):
    n = len(path)
    out = []
    for i in range(count):
        idx = int((i + 0.5) * (n - 1) / count)
        idx_next = min(idx + 1, n - 1)
        side = offsets_m[i % len(offsets_m)]
        lat, lng = perp_offset_m(path[idx], path[idx_next], side)
        out.append((lat, lng, types[i % len(types)], texts[i % len(texts)], perm))
    return out

ALICE_PATH = chain(YANPING, CHANGSHOU, CHANGHUA_REV, WUNING_REV[1:], WUNING_S, ANYUAN)
BOB_PATH = chain(WUNING_S, ANYUAN, CHANGHUA, CHANGSHOU, YANPING, SANHE_LOOP)
CAROL_PATH = chain(YANPING[:5], ANYUAN[:4])
LDY_PATH = chain(WUNING, CHANGHUA, CHANGSHOU, WUNING_S, YANPING, SANHE_LOOP, ANYUAN)
EVE_PATH = chain(ANYUAN, CHANGHUA, YANPING, CHANGSHOU[:3])

ICON_TYPES = ['cairn', 'water', 'junction', 'danger', 'free']
MARK_TEXTS = [
    'Quiet spot to rest', 'Water refill OK', 'Tricky junction',
    'Watch the curb here', 'Best lunch nearby', 'Nice view',
    'Convenience store', 'Public restroom', 'Good photo angle',
    'Path narrows', 'Shade under trees', 'Bench here',
    'ATM 50m', 'Bus stop', 'Wifi cafe',
]

MARKERS = []
for lat, lng, mtype, text, perm in marks_along(ALICE_PATH, 12, [15, -15, 18, -18], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((19, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(BOB_PATH, 8, [12, -12, 16, -16], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((20, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(CAROL_PATH, 4, [10, -10], 'public', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((21, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(LDY_PATH, 15, [14, -14, 17, -17, 20, -20], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((23, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(EVE_PATH, 6, [12, -12, 15, -15], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((24, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(CHANGSHOU, 1, [10], 'public', ['cairn'], ['Public S']):
    MARKERS.append((25, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(WUNING_S, 3, [10, -10], 'public', ICON_TYPES, ['Bench', 'Tree shade', 'Crosswalk']):
    MARKERS.append((26, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(WUNING[2:], 5, [10, -10, 13, -13], 'public', ICON_TYPES,
                                                ['Coffee', 'Newsstand', 'Stairs', 'Subway entry', 'Vendor']):
    MARKERS.append((27, lat, lng, mtype, text, perm))

def sql_escape(s): return s.replace("'", "''")

def gen_sql():
    lines = []
    lines.append("-- v379 demo data rebuild v3 — generated by gen_yanping_demo_data_v3.py")
    lines.append("-- Real area: 延平路123弄 / 武宁路 (Sanhe Garden, Putuo District).")
    lines.append("-- Center ~31.2455, 121.4395. 9163 (id=4) and Dave (id=22) UNTOUCHED.")
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
        points = densify(waypoints, point_spacing_m=17)
        jit_points = jitter(points, uid * 7 + i)
        dist_m = path_distance_m(jit_points)
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
        if uid == 19 and i == 0:
            route_inserts.append((uid, name + ' (saved)', jit_points, dist_m))
        if uid == 23 and i == 5:
            route_inserts.append((uid, name + ' (saved)', jit_points, dist_m))
        if uid == 23 and i == 7:
            route_inserts.append((uid, name + ' (saved)', jit_points, dist_m))

    lines.append("")
    lines.append("-- Routes: Alice×1, LDY×2")
    for uid, rname, pts, dist_m in route_inserts:
        rp_json = [{"lat": la, "lng": ln} for la, ln in pts]
        rp_json_s = sql_escape(json.dumps(rp_json))
        rname_s = sql_escape(rname)
        lines.append(
            f"INSERT INTO routes (user_id, name, points, distance_m, elevation_gain_m, permission) "
            f"VALUES ({uid}, '{rname_s}', '{rp_json_s}', {dist_m:.1f}, 0, 'friend');"
        )

    lines.append("")
    lines.append("-- Markers along paths (±20m corridor)")
    for uid, lat, lng, mtype, text, perm in MARKERS:
        text_s = sql_escape(text)
        lines.append(
            f"INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at) "
            f"VALUES ({uid}, '{mtype}', '{text_s}', {lat:.6f}, {lng:.6f}, '{perm}', 'tier_g', 0, 'healthy', NOW(), NOW());"
        )

    lines.append("")
    lines.append(
        f"SELECT 'sessions' AS t, COUNT(*) c FROM sessions WHERE user_id IN ({ids_csv}) UNION ALL "
        f"SELECT 'memory_points', COUNT(*) FROM memory_points WHERE user_id IN ({ids_csv}) UNION ALL "
        f"SELECT 'markers', COUNT(*) FROM markers WHERE user_id IN ({ids_csv}) UNION ALL "
        f"SELECT 'routes', COUNT(*) FROM routes WHERE user_id IN ({ids_csv});"
    )
    lines.append(
        f"SELECT u.name, COUNT(s.id) AS sessions, ROUND(AVG(s.distance_m)) AS avg_m, ROUND(SUM(s.distance_m)) AS total_m "
        f"FROM users u LEFT JOIN sessions s ON s.user_id = u.id WHERE u.id IN ({ids_csv}) GROUP BY u.id ORDER BY u.id;"
    )
    return "\n".join(lines)

if __name__ == '__main__':
    print(gen_sql())
