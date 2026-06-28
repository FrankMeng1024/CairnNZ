#!/usr/bin/env python3
"""
gen_dispersed_demo_data_v4.py — v379 mock data with dispersed territories.

Per user request:
  - Each demo user should occupy a different territory (not all clustered in
    one 500m × 500m patch). Some overlap is fine and desired, but not full.
  - Two metro clusters:
    * 静安区 (old Jingan, not original Zhabei) — Sanhe Garden (延平路123弄
      普陀边界), Wuding Rd, Nanjing W Rd, Huashan Rd, Yuyuan Rd
    * 浦东新区 — 长泰广场 (Changtai Plaza, near Lujiazui ~31.21, 121.50) +
      汇智广场 / SAP (~31.205, 121.605, 张江)
  - Real road paths (5-8 hand-picked waypoints per road, not straight lines).
  - 30-min hikes (≈2-3 km), overlap on shared roads, distinct base areas.

Layout:
  Alice — Jingan/Wuning area (home turf around 延平路)
  Bob — Jingan + occasional Jingan Temple
  Carol — Pudong Changtai Plaza area
  LDY — overlaps Jingan AND Pudong SAP (power user, both areas)
  Eve — Jingan Temple + Yuyuan
  Strangers 7/8/9 — scattered: one in each area
"""

import json
import math
from datetime import datetime, timedelta

# ── REAL ROADS — 静安/老静安 zone ────────────────────────────────────────────
SANHE_LANE = [   # 延平路123弄 — Sanhe Garden internal loop
    (31.24550, 121.4395), (31.24545, 121.4400), (31.24535, 121.4405),
    (31.24525, 121.4400), (31.24530, 121.4392), (31.24550, 121.4395),
]
YANPING_RD = [   # 延平路 N-S
    (31.24800, 121.4395), (31.24700, 121.4395), (31.24600, 121.4395),
    (31.24500, 121.4395), (31.24400, 121.4395), (31.24300, 121.4395),
    (31.24250, 121.4395),
]
WUNING_RD = [    # 武宁路 E-W
    (31.24800, 121.4360), (31.24800, 121.4395), (31.24800, 121.4440),
    (31.24800, 121.4480),
]
NANJING_W = [    # 南京西路 (静安寺段)
    (31.22600, 121.4520), (31.22620, 121.4500), (31.22640, 121.4480),
    (31.22650, 121.4460), (31.22660, 121.4440), (31.22670, 121.4420),
    (31.22680, 121.4400),
]
HUASHAN_RD = [   # 华山路
    (31.22680, 121.4400), (31.22800, 121.4400), (31.22920, 121.4400),
    (31.23040, 121.4400), (31.23160, 121.4400),
]
YUYUAN_RD = [    # 愚园路 (静安寺~江苏路)
    (31.22680, 121.4400), (31.22720, 121.4380), (31.22760, 121.4360),
    (31.22800, 121.4340), (31.22840, 121.4320),
]
WUDING_RD = [    # 武定路 (与延平路相交)
    (31.24300, 121.4360), (31.24300, 121.4395), (31.24300, 121.4430),
    (31.24300, 121.4460), (31.24300, 121.4490),
]

# ── REAL ROADS — 浦东 Pudong zone ─────────────────────────────────────────────
# 长泰广场 (Changtai Plaza) — at 浦东大道 / 浦东南路, near Lujiazui
CHANGTAI_AREA = [
    (31.23200, 121.5060), (31.23150, 121.5080), (31.23100, 121.5100),
    (31.23050, 121.5120), (31.23000, 121.5140),
]
PUDONG_NAN_RD = [
    (31.22900, 121.5050), (31.23000, 121.5060), (31.23100, 121.5070),
    (31.23200, 121.5080), (31.23300, 121.5090),
]
# 汇智广场 (SAP) — 张江 zone, ~31.205, 121.605
SAP_AREA = [
    (31.20450, 121.6010), (31.20500, 121.6030), (31.20550, 121.6050),
    (31.20600, 121.6070), (31.20650, 121.6090),
]
ZHANGJIANG_RING = [   # 张江周边环路
    (31.20400, 121.6000), (31.20500, 121.6050), (31.20600, 121.6100),
    (31.20700, 121.6150), (31.20800, 121.6100), (31.20900, 121.6050),
    (31.20800, 121.6000),
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

YANPING_R = list(reversed(YANPING_RD))
NANJING_W_R = list(reversed(NANJING_W))
HUASHAN_R = list(reversed(HUASHAN_RD))
WUDING_R = list(reversed(WUDING_RD))
CHANGTAI_R = list(reversed(CHANGTAI_AREA))
SAP_R = list(reversed(SAP_AREA))

# Sessions: each user has TWO base areas at minimum.
SESSIONS = [
    # Alice — 静安/Sanhe home turf, both north + temple area
    (19, 'hiking',  chain(YANPING_RD, WUDING_RD, YANPING_R[:4], SANHE_LANE),
        7, 'Alice — Sanhe morning loop'),
    (19, 'running', chain(NANJING_W, HUASHAN_RD[:3]),
        5, 'Alice — Jingan Temple run'),

    # Bob — 静安 mainly, occasional Yuyuan
    (20, 'hiking',  chain(YANPING_RD, WUDING_RD),
        6, 'Bob — Yanping-Wuding'),
    (20, 'hiking',  chain(NANJING_W, YUYUAN_RD),
        4, 'Bob — Yuyuan stroll'),

    # Carol — 浦东 Changtai mainly
    (21, 'running', chain(CHANGTAI_AREA, PUDONG_NAN_RD),
        3, 'Carol — Changtai loop'),

    # LDY — POWER USER: 静安 + 浦东 both
    (23, 'hiking',  chain(YANPING_RD, WUNING_RD, NANJING_W),
        14, 'LDY — Jingan big loop'),
    (23, 'hiking',  chain(NANJING_W, HUASHAN_RD, YUYUAN_RD),
        12, 'LDY — Temple-Yuyuan'),
    (23, 'hiking',  chain(ZHANGJIANG_RING, SAP_AREA),
        10, 'LDY — Zhangjiang SAP'),
    (23, 'running', chain(CHANGTAI_AREA, PUDONG_NAN_RD, CHANGTAI_R),
        2,  'LDY — Changtai sprint'),

    # Eve — 静安寺 area mainly
    (24, 'hiking',  chain(NANJING_W, YUYUAN_RD, NANJING_W_R[:3]),
        8, 'Eve — Yuyuan + Nanjing'),
    (24, 'running', chain(HUASHAN_RD, NANJING_W_R),
        4, 'Eve — Huashan-Nanjing'),

    # Strangers — each somewhere different
    (25, 'hiking',  WUNING_RD,        6, 'Stranger1 — Wuning Rd'),
    (26, 'hiking',  ZHANGJIANG_RING,  5, 'Stranger2 — Zhangjiang ring'),
    (27, 'hiking',  CHANGTAI_AREA,    4, 'Stranger3 — Changtai short'),
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

# Each user's main path (for placing marks along)
ALICE_PATH = chain(YANPING_RD, SANHE_LANE, NANJING_W, HUASHAN_RD)
BOB_PATH = chain(YANPING_RD, WUDING_RD, NANJING_W, YUYUAN_RD)
CAROL_PATH = chain(CHANGTAI_AREA, PUDONG_NAN_RD)
LDY_PATH = chain(YANPING_RD, NANJING_W, HUASHAN_RD, YUYUAN_RD, ZHANGJIANG_RING, SAP_AREA, CHANGTAI_AREA)
EVE_PATH = chain(NANJING_W, YUYUAN_RD, HUASHAN_RD)

ICON_TYPES = ['cairn', 'water', 'junction', 'danger', 'hut']
MARK_TEXTS = [
    'Quiet rest spot', 'Water refill OK', 'Tricky junction',
    'Watch the curb', 'Hut/shelter', 'Nice view',
    'Bookstore', 'Restroom', 'Good photo angle',
    'Path narrows', 'Shade trees', 'Bench',
    'ATM 50m', 'Bus stop', 'Wifi cafe',
]

MARKERS = []
for lat, lng, mtype, text, perm in marks_along(ALICE_PATH, 12, [15, -15, 18, -18], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((19, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(BOB_PATH, 8, [12, -12, 16, -16], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((20, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(CAROL_PATH, 5, [10, -10], 'public', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((21, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(LDY_PATH, 18, [14, -14, 17, -17, 20, -20], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((23, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(EVE_PATH, 7, [12, -12, 15, -15], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((24, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(WUNING_RD, 2, [10, -10], 'public', ['cairn', 'water'], ['Public S', 'Public N']):
    MARKERS.append((25, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(ZHANGJIANG_RING, 3, [10, -10], 'public', ICON_TYPES, ['Bench', 'Tree', 'Crosswalk']):
    MARKERS.append((26, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(CHANGTAI_AREA, 4, [10, -10, 13, -13], 'public', ICON_TYPES, ['Coffee', 'Stairs', 'Subway', 'Vendor']):
    MARKERS.append((27, lat, lng, mtype, text, perm))

def sql_escape(s): return s.replace("'", "''")

def gen_sql():
    lines = []
    lines.append("-- v379 dispersed demo data — generated by gen_dispersed_demo_data_v4.py")
    lines.append("-- Two metro clusters: Jingan (静安老城) + Pudong (长泰广场 + 张江汇智 SAP).")
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
        # routes derived: Alice session 0, LDY sessions 0+2 (one Jingan + one Pudong)
        if uid == 19 and i == 0:
            route_inserts.append((uid, name + ' (saved)', jit_points, dist_m))
        if uid == 23 and i == 5:
            route_inserts.append((uid, name + ' (saved)', jit_points, dist_m))
        if uid == 23 and i == 7:
            route_inserts.append((uid, name + ' (saved)', jit_points, dist_m))

    lines.append("")
    lines.append("-- Routes: Alice×1, LDY×2 (one in each metro cluster)")
    for uid, rname, pts, dist_m in route_inserts:
        rp_json = [{"lat": la, "lng": ln} for la, ln in pts]
        rp_json_s = sql_escape(json.dumps(rp_json))
        rname_s = sql_escape(rname)
        lines.append(
            f"INSERT INTO routes (user_id, name, points, distance_m, elevation_gain_m, permission) "
            f"VALUES ({uid}, '{rname_s}', '{rp_json_s}', {dist_m:.1f}, 0, 'friend');"
        )

    lines.append("")
    lines.append("-- Markers along each user's main path (±20m corridor)")
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
