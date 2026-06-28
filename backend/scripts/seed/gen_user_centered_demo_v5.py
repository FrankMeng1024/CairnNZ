#!/usr/bin/env python3
"""
gen_user_centered_demo_v5.py — v380 mock data centered on user's REAL location.

Key insight (v380 investigation):
  - User's real address 延平路123弄 (Yanping Rd #123 Lane) renders correctly
    in Mapbox at WGS84 coords ~31.230, 121.435
  - 9163 account's "back" session ended at 31.23038, 121.43509 — this IS
    Yanping Rd #123 Lane in WGS84
  - Apple/Amap maps show this as ~31.235, 121.440 due to GCJ-02 offset, but
    Mapbox uses WGS84 so 31.230, 121.435 is the correct DB value
  - Previous mock data centred at 31.245, 121.440 was 1.5km off because it
    used Amap/GCJ-02 coords as if they were WGS84
  - FIX: use 9163's back trajectory as the road reference (it's real GPS
    data the user actually walked, recorded in WGS84)

Road network derived from 9163 back trajectory (87 real GPS points):
  - East-West stretch ~31.2330, lng 121.4314 → 121.4346 (north portion)
  - North-South return: lng 121.43459 → 121.43533 (eastward then south)
  - User's home: ~31.2303, 121.4351 (end of "back")

Design:
  - Center = 31.2310, 121.4340 (mid-point of 9163 back loop area)
  - Bbox 800m × 600m around centre, all WGS84
  - Roads = densified version of 9163 trajectory + a few perpendicular
    streets (estimated based on Shanghai grid pattern in this area)
"""

import json
import math
from datetime import datetime, timedelta

# ── 9163 BACK TRAJECTORY — used as the primary road reference ────────────
# These are REAL GPS points the user actually walked, captured by their
# phone, stored in WGS84. Anything within ±50m of this polyline is
# guaranteed to render in the correct neighbourhood.
BACK_TRAJ = [
    (31.233166, 121.431383), (31.232870, 121.431530), (31.232706, 121.431762),
    (31.232454, 121.431990), (31.232470, 121.432285), (31.232562, 121.432562),
    (31.232668, 121.432840), (31.232772, 121.433107), (31.232870, 121.433250),
    (31.232938, 121.433429), (31.232870, 121.433593), (31.232800, 121.433780),
    (31.232760, 121.433944), (31.232712, 121.434088), (31.232680, 121.434250),
    (31.232760, 121.434367), (31.232870, 121.434497), (31.232960, 121.434627),
    (31.233080, 121.434590), (31.233080, 121.434470), (31.233000, 121.434280),
    (31.232800, 121.434400), (31.232500, 121.434750), (31.232240, 121.435090),
    (31.232000, 121.435350), (31.231720, 121.435470), (31.231480, 121.435800),
    (31.231220, 121.436040), (31.231070, 121.436045), (31.230878, 121.435825),
    (31.230600, 121.435850), (31.230500, 121.435760), (31.230380, 121.435093),
]

# ── DERIVED ROADS (estimates near the back trajectory) ─────────────────────
# East stretch (along lat ~31.2329, north side of back path)
EAST_STREET = [
    (31.23300, 121.43090), (31.23300, 121.43200), (31.23300, 121.43320),
    (31.23300, 121.43450), (31.23300, 121.43570),
]
# West-side cross street (perpendicular, lng ~121.4320)
WEST_CROSS = [
    (31.23380, 121.43200), (31.23300, 121.43200), (31.23220, 121.43200),
    (31.23140, 121.43200), (31.23060, 121.43200),
]
# East-side cross street (lng ~121.4360)
EAST_CROSS = [
    (31.23380, 121.43600), (31.23300, 121.43600), (31.23220, 121.43600),
    (31.23140, 121.43600), (31.23050, 121.43600),
]
# Home block lane (around user's home end of back)
HOME_LANE = [
    (31.23040, 121.43510), (31.23020, 121.43480), (31.23010, 121.43440),
    (31.23030, 121.43400), (31.23070, 121.43380),
]
# Southern long street (extends south)
SOUTH_STREET = [
    (31.23000, 121.43200), (31.22950, 121.43320), (31.22920, 121.43450),
    (31.22900, 121.43570),
]

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

def densify(waypoints, point_spacing_m=15):
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
        # tiny realistic GPS jitter (~1m)
        jla = la + (((seed + j * 13) % 5 - 2) * 0.000008)
        jln = ln + (((seed + j * 17) % 7 - 3) * 0.000008)
        out.append((jla, jln))
    return out

BACK_R = list(reversed(BACK_TRAJ))
EAST_R = list(reversed(EAST_STREET))
WEST_R = list(reversed(WEST_CROSS))
HOME_R = list(reversed(HOME_LANE))

# Sessions — each user has 1-2 hikes within the user's neighbourhood.
SESSIONS = [
    # Alice — walks BACK trajectory + east street loop (overlaps user route)
    (19, 'hiking',  chain(BACK_TRAJ, EAST_CROSS),
        7, 'Alice — home loop'),
    (19, 'running', chain(EAST_STREET, WEST_CROSS, BACK_R[:15]),
        5, 'Alice — quick east'),

    # Bob — west-side runs, partial back overlap
    (20, 'hiking',  chain(WEST_CROSS, EAST_STREET, BACK_TRAJ[:20]),
        6, 'Bob — west side'),
    (20, 'hiking',  chain(SOUTH_STREET, WEST_CROSS),
        4, 'Bob — south + west'),

    # Carol — short, just east area
    (21, 'running', EAST_CROSS,
        3, 'Carol — east cross'),

    # LDY — covers everything (power user)
    (23, 'hiking',  chain(BACK_TRAJ, EAST_CROSS, EAST_STREET, WEST_R),
        14, 'LDY — full perimeter'),
    (23, 'hiking',  chain(EAST_STREET, BACK_TRAJ, HOME_LANE),
        12, 'LDY — through home block'),
    (23, 'hiking',  chain(SOUTH_STREET, EAST_CROSS),
        10, 'LDY — south sweep'),
    (23, 'running', chain(HOME_LANE, BACK_R[:18]),
        2,  'LDY — home loop run'),

    # Eve — east cross + south
    (24, 'hiking',  chain(EAST_CROSS, SOUTH_STREET),
        8, 'Eve — east-south'),
    (24, 'running', chain(EAST_STREET, EAST_CROSS),
        4, 'Eve — east loop'),

    # Strangers — short visits to different parts
    (25, 'hiking',  EAST_STREET,    6, 'Stranger1 — east street'),
    (26, 'hiking',  WEST_CROSS,     5, 'Stranger2 — west cross'),
    (27, 'hiking',  SOUTH_STREET,   4, 'Stranger3 — south'),
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

ALICE_PATH = chain(BACK_TRAJ, EAST_CROSS)
BOB_PATH = chain(WEST_CROSS, EAST_STREET, BACK_TRAJ[:20], SOUTH_STREET)
CAROL_PATH = EAST_CROSS
LDY_PATH = chain(BACK_TRAJ, EAST_CROSS, EAST_STREET, WEST_CROSS, SOUTH_STREET, HOME_LANE)
EVE_PATH = chain(EAST_CROSS, SOUTH_STREET, EAST_STREET)

ICON_TYPES = ['cairn', 'water', 'junction', 'danger', 'hut']
MARK_TEXTS = [
    'Quiet rest spot', 'Water refill OK', 'Tricky junction',
    'Watch the curb', 'Small shelter', 'Nice view',
    'Bookstore', 'Restroom', 'Photo spot',
    'Path narrows', 'Shade trees', 'Bench here',
    'ATM 50m', 'Bus stop', 'Wifi cafe',
]

MARKERS = []
for lat, lng, mtype, text, perm in marks_along(ALICE_PATH, 12, [12, -12, 15, -15], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((19, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(BOB_PATH, 8, [10, -10, 14, -14], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((20, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(CAROL_PATH, 4, [10, -10], 'public', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((21, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(LDY_PATH, 16, [12, -12, 15, -15, 18, -18], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((23, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(EVE_PATH, 6, [12, -12, 15, -15], 'group', ICON_TYPES, MARK_TEXTS):
    MARKERS.append((24, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(EAST_STREET, 2, [10, -10], 'public', ['cairn', 'water'], ['Public east 1', 'Public east 2']):
    MARKERS.append((25, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(WEST_CROSS, 3, [10, -10], 'public', ICON_TYPES, ['Bench', 'Tree', 'Crosswalk']):
    MARKERS.append((26, lat, lng, mtype, text, perm))
for lat, lng, mtype, text, perm in marks_along(SOUTH_STREET, 4, [10, -10, 13, -13], 'public', ICON_TYPES, ['Coffee', 'Stairs', 'Subway', 'Vendor']):
    MARKERS.append((27, lat, lng, mtype, text, perm))

def sql_escape(s): return s.replace("'", "''")

def gen_sql():
    lines = []
    lines.append("-- v380 user-centred mock data — generated by gen_user_centered_demo_v5.py")
    lines.append("-- Centred on 9163 back trajectory (lat 31.230-31.233, lng 121.431-121.436).")
    lines.append("-- All coords WGS84, matching what 9163 GPS actually recorded.")
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
        # densify at 15m for more realistic path
        points = densify(waypoints, point_spacing_m=15)
        # GPS jitter ~1m
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
        # Insert session
        lines.append(
            f"INSERT INTO sessions (user_id, type, start_time, end_time, distance_m, duration_s, name, route_points) "
            f"VALUES ({uid}, '{sess_type}', '{start_dt:%Y-%m-%d %H:%M:%S}', '{end_dt:%Y-%m-%d %H:%M:%S}', "
            f"{dist_m:.1f}, {duration_s}, '{name_s}', '{rp_json_s}');"
        )
        # memory_points DERIVED FROM SAME jit_points — guarantees activity
        # path and memory points are in lockstep (no synthesis drift).
        for k, (la, ln) in enumerate(jit_points):
            ts_ms = start_ms + k * ts_step
            cid = f"demo-{uid}-{i}-{k}"
            lines.append(
                f"INSERT INTO memory_points (user_id, lat, lng, ts, client_id) "
                f"VALUES ({uid}, {la}, {ln}, {ts_ms}, '{cid}');"
            )
        # Routes derived: Alice session 0, LDY sessions 0, 1
        if uid == 19 and i == 0:
            route_inserts.append((uid, name + ' (saved)', jit_points, dist_m))
        if uid == 23 and i == 5:
            route_inserts.append((uid, name + ' (saved)', jit_points, dist_m))
        if uid == 23 and i == 6:
            route_inserts.append((uid, name + ' (saved)', jit_points, dist_m))

    lines.append("")
    lines.append("-- Routes")
    for uid, rname, pts, dist_m in route_inserts:
        rp_json = [{"lat": la, "lng": ln} for la, ln in pts]
        rp_json_s = sql_escape(json.dumps(rp_json))
        rname_s = sql_escape(rname)
        lines.append(
            f"INSERT INTO routes (user_id, name, points, distance_m, elevation_gain_m, permission) "
            f"VALUES ({uid}, '{rname_s}', '{rp_json_s}', {dist_m:.1f}, 0, 'friend');"
        )

    lines.append("")
    lines.append("-- Markers along user paths + memory_points unlocking each mark's location")
    mark_idx = 0
    for uid, lat, lng, mtype, text, perm in MARKERS:
        text_s = sql_escape(text)
        lines.append(
            f"INSERT INTO markers (user_id, type, text, lat, lng, permission, anchor_kind, has_worldmap, status, created_at, updated_at) "
            f"VALUES ({uid}, '{mtype}', '{text_s}', {lat:.6f}, {lng:.6f}, '{perm}', 'tier_g', 0, 'healthy', NOW(), NOW());"
        )
        # v380: mark also unlocks memory at this point (mirrors client-side
        # plant unlock fix). Adds a single memory_point so the owner's fog
        # shows a hole even if they haven't walked through there.
        cid = f"mark-unlock-{uid}-{mark_idx}-{int(lat*1e5)}-{int(lng*1e5)}"
        mark_idx += 1
        lines.append(
            f"INSERT INTO memory_points (user_id, lat, lng, ts, client_id) "
            f"VALUES ({uid}, {lat:.6f}, {lng:.6f}, UNIX_TIMESTAMP()*1000, '{cid}');"
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
