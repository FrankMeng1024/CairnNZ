#!/usr/bin/env python3
"""
mock_via_real_api.py — v381 真实 save hike API mock data generator.

Per user request: "mock 数据走真实 save hike 逻辑,和正常 hike 没区别"
Per v380 investigation: app already has Mapbox snap-to-road at
`app/src/services/routing/snapTrack.ts`. We replicate the same Map Matching
API call from Python so generated GPS points sit ON real roads.

Pipeline per demo account:
  1. POST /api/auth/login → JWT
  2. Hand-pick 5-10 lat/lng waypoints for a "natural" walking loop
  3. POST waypoints to Mapbox Map Matching API → snapped polyline (real roads)
  4. Densify snapped polyline to 1 point every ~15m
  5. POST /api/sessions with route_points → creates Activity
  6. POST /api/memory/points (batched ≤1000) with same points → fog clears
  7. POST /api/markers a handful of marks along the path (also unlocks fog
     at each mark per v380 client-side plant-unlock logic; server stores in
     markers table only — memory unlock happens via separate point batch)

Backend: api.yiiling.cn (aliyun).
Accounts: emails 1,2,3,5,6,7,8,9 (no 4 = Dave + 9163 untouched).
"""

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta

# ── CONFIG ──────────────────────────────────────────────────────────────────
BACKEND = os.getenv("CAIRN_BACKEND", "https://api.yiiling.cn")
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN") or os.getenv("EXPO_PUBLIC_MAPBOX_TOKEN")
if not MAPBOX_TOKEN:
    print("ERROR: set MAPBOX_TOKEN env var (or EXPO_PUBLIC_MAPBOX_TOKEN)", file=sys.stderr)
    sys.exit(1)

# Demo accounts (email + password are both the same digit per v378 seed)
ACCOUNTS = [
    ("1", "1", "Alice"),
    ("2", "2", "Bob"),
    ("3", "3", "Carol"),
    ("5", "5", "LDY"),
    ("6", "6", "Eve"),
    ("7", "7", "Stranger 1"),
    ("8", "8", "Stranger 2"),
    ("9", "9", "Stranger 3"),
]

# ── REAL WALKING LOOPS ──────────────────────────────────────────────────────
# Each user gets ONE multi-leg walking loop near the user's home address
# (延平路123弄 area, WGS84 ~31.230, 121.435 — verified via 9163 back session).
# Hand-pick a handful of way-corners; Mapbox snaps them to real road geometry.

WALKING_LOOPS = {
    # All coordinates pulled from Mapbox tilequery on actual walkable roads
    # near user's home (康定路/延平路/武定路/胶州路/万春街/乌鲁木齐北路).
    # These will snap reliably because every waypoint already sits ON a road.
    19: [  # Alice — north loop on 康定路 + 武定路
        (31.23249, 121.43514),  # 康定路
        (31.23279, 121.43359),  # 康定路 west
        (31.23246, 121.43191),  # 康定路 西头
        (31.23144, 121.43152),  # 万春街
        (31.23128, 121.43151),  # 万春街南
        (31.23046, 121.43432),  # 武定路
        (31.23117, 121.43621),  # 武定路东
        (31.23144, 121.43598),  # 延平路
        (31.23249, 121.43514),  # close loop
    ],
    20: [  # Bob — east arc on 延平路 + 胶州路
        (31.23087, 121.43646),  # 延平路东
        (31.22994, 121.43721),  # 延平路东
        (31.22983, 121.43729),  # 胶州路273弄
        (31.23081, 121.43721),  # 胶州路319弄
        (31.23144, 121.43689),  # service
        (31.23087, 121.43646),  # close
    ],
    21: [  # Carol — short east stretch
        (31.23117, 121.43621),
        (31.23144, 121.43598),
        (31.23087, 121.43646),
    ],
    23: [  # LDY (rich) — bigger loop covering most streets
        (31.23249, 121.43514),  # 康定路
        (31.23279, 121.43359),
        (31.23246, 121.43191),
        (31.23144, 121.43152),
        (31.23046, 121.43432),  # 武定路
        (31.22960, 121.43462),  # service
        (31.22994, 121.43721),  # 延平路东
        (31.23081, 121.43721),  # 胶州路319弄
        (31.23144, 121.43689),
        (31.23087, 121.43646),  # 延平路
        (31.23144, 121.43598),
        (31.23249, 121.43514),  # close
    ],
    24: [  # Eve — south crescent on service+乌鲁木齐北路
        (31.22960, 121.43462),  # service
        (31.22892, 121.43201),  # 武定西路
        (31.22813, 121.43481),  # service
        (31.22725, 121.43641),  # 乌鲁木齐北路
        (31.22930, 121.43721),  # service
        (31.22960, 121.43462),  # close
    ],
    25: [  # Stranger 1 — 胶州路 short
        (31.23081, 121.43721),
        (31.22983, 121.43729),
        (31.22994, 121.43721),
    ],
    26: [  # Stranger 2 — south-west
        (31.22892, 121.43201),
        (31.22813, 121.43481),
        (31.22960, 121.43462),
    ],
    27: [  # Stranger 3 — north spike on 康定路
        (31.23279, 121.43359),
        (31.23262, 121.43311),
        (31.23281, 121.43302),
        (31.23249, 121.43514),
    ],
}

# Marks per user — small lat/lng nudges from the loop centroid
MARK_TYPES_FRIEND = [
    ('cairn', 'Quiet rest spot', 'group'),
    ('water', 'Water refill OK', 'group'),
    ('junction', 'Tricky junction', 'group'),
    ('danger', 'Watch the curb', 'group'),
    ('hut', 'Small shelter', 'group'),
]
MARK_TYPES_PUBLIC = [
    ('cairn', 'Public cairn', 'public'),
    ('junction', 'Public crossroads', 'public'),
    ('water', 'Public tap', 'public'),
]
MARKS_PER_USER = {
    19: 6,  20: 5,  21: 3,  23: 8,  24: 4,
    25: 2,  26: 2,  27: 2,
}
USE_PUBLIC_TYPES_FOR = {21, 25, 26, 27}  # Carol + Strangers

# ── HTTP helpers ────────────────────────────────────────────────────────────
def http_post(url, body=None, headers=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="ignore")
        try:
            body_json = json.loads(body_text)
        except Exception:
            body_json = {"error": body_text}
        return e.code, body_json

def http_delete(url, headers=None):
    req = urllib.request.Request(url, method="DELETE")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {}

def http_get(url, headers=None):
    req = urllib.request.Request(url, method="GET")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {}

# ── Mapbox Map Matching ────────────────────────────────────────────────────
def map_match(waypoints):
    """Snap a list of (lat,lng) waypoints to nearest walking road via Mapbox.
    Returns list of (lat,lng) for the snapped polyline. Falls back to input
    if Mapbox can't match."""
    if len(waypoints) < 2:
        return waypoints
    # Mapbox expects lng,lat order
    coord_str = ";".join(f"{lng:.6f},{lat:.6f}" for lat, lng in waypoints)
    # 25m search radius per waypoint = tolerates GPS jitter + lets us
    # snap to nearest walking edge even when coord isn't on the centreline.
    radiuses = ";".join("25" for _ in waypoints)
    url = (
        f"https://api.mapbox.com/matching/v5/mapbox/walking/{coord_str}"
        f"?geometries=geojson&overview=full&radiuses={radiuses}"
        f"&access_token={MAPBOX_TOKEN}"
    )
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data.get("code") != "Ok" or not data.get("matchings"):
            print(f"  [warn] Mapbox match failed: code={data.get('code')}, fallback to raw")
            return waypoints
        coords = data["matchings"][0]["geometry"]["coordinates"]
        # coords is [[lng,lat], ...]; flip back to (lat,lng)
        return [(c[1], c[0]) for c in coords]
    except Exception as e:
        print(f"  [warn] Mapbox match error: {e}, fallback to raw")
        return waypoints

# ── Geo helpers ─────────────────────────────────────────────────────────────
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

def densify(waypoints, spacing_m=15):
    if len(waypoints) < 2:
        return waypoints[:]
    total = path_distance_m(waypoints)
    n_points = max(2, int(total / spacing_m))
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

# ── Per-user flow ──────────────────────────────────────────────────────────
def login(email, password):
    status, body = http_post(f"{BACKEND}/api/auth/login", {"email": email, "password": password})
    if status != 200:
        print(f"  [err] login failed for {email}: status={status} body={body}")
        return None
    return body.get("token")

def wipe_user_data(token, uid):
    """Best-effort wipe of existing sessions + memory_points + markers for this
    account. We use GET endpoints + DELETE one by one. Not all backends expose
    DELETE so this is best-effort — if any step fails we still proceed
    (the server's INSERT ON DUPLICATE will dedupe by (user_id, client_id) on
    memory_points and sessions get fresh IDs)."""
    h = {"Authorization": f"Bearer {token}"}
    # delete sessions
    s, body = http_get(f"{BACKEND}/api/sessions", headers=h)
    if s == 200:
        if isinstance(body, list):
            sessions = body
        else:
            sessions = body.get("sessions", [])
        for sess in sessions:
            sid = sess.get("id")
            if sid:
                http_delete(f"{BACKEND}/api/sessions/{sid}", headers=h)
    # delete markers
    s, body = http_get(f"{BACKEND}/api/markers", headers=h)
    if s == 200:
        if isinstance(body, list):
            markers = body
        else:
            markers = body.get("markers", [])
        for m in markers:
            mid = m.get("id")
            if mid:
                http_delete(f"{BACKEND}/api/markers/{mid}", headers=h)
    # memory_points: we'll let dedup handle the new ones overlapping (cid is
    # unique per request) — old points stay but won't conflict.

def post_session(token, route_points, days_ago, name, sess_type='hiking'):
    h = {"Authorization": f"Bearer {token}"}
    if len(route_points) < 2:
        return None
    now = datetime.utcnow()
    start_dt = now - timedelta(days=days_ago)
    dist_m = sum(haversine_m(route_points[i], route_points[i+1]) for i in range(len(route_points)-1))
    duration_s = max(60, int(dist_m * 0.75))  # ~4.8 km/h walking pace
    end_dt = start_dt + timedelta(seconds=duration_s)
    ts_step = (duration_s * 1000) // max(1, len(route_points) - 1)
    start_ms = int(start_dt.timestamp() * 1000)
    rp = [
        {"lat": la, "lng": ln, "ts": start_ms + k * ts_step}
        for k, (la, ln) in enumerate(route_points)
    ]
    body = {
        "type": sess_type,
        "start_time": start_dt.isoformat() + "Z",
        "end_time": end_dt.isoformat() + "Z",
        "distance_m": round(dist_m, 1),
        "duration_s": duration_s,
        "name": name,
        "route_points": rp,
    }
    s, resp = http_post(f"{BACKEND}/api/sessions", body, headers=h)
    if s not in (200, 201):
        print(f"  [err] POST /sessions failed: status={s} body={resp}")
        return None
    return rp  # echo route_points so caller can reuse for memory sync

def post_memory_points(token, route_points):
    """Batch-post route_points as memory_points so fog clears along the path."""
    h = {"Authorization": f"Bearer {token}"}
    batch_size = 500
    total_accepted = 0
    for i in range(0, len(route_points), batch_size):
        chunk = route_points[i:i+batch_size]
        points = [
            {"lat": p["lat"], "lng": p["lng"], "ts": int(p["ts"]),
             "cid": uuid.uuid4().hex[:36]}
            for p in chunk
        ]
        s, resp = http_post(f"{BACKEND}/api/memory/points", {"points": points}, headers=h)
        if s == 200:
            total_accepted += resp.get("accepted", 0)
        else:
            print(f"  [err] POST /memory/points failed: status={s} body={resp}")
    return total_accepted

def post_marker(token, lat, lng, mtype, text, permission):
    """Plant a marker. Backend stores in markers table. We do NOT post a
    matching memory_point here because v380 client-side plant logic unlocks
    locally — for mock we already covered the route with memory_points so the
    mark sits inside cleared fog regardless."""
    h = {"Authorization": f"Bearer {token}"}
    body = {
        "type": mtype,
        "text": text,
        "lat": lat,
        "lng": lng,
        "permission": permission,
    }
    s, resp = http_post(f"{BACKEND}/api/markers", body, headers=h)
    if s not in (200, 201):
        # Public is rejected for client writes per v4 H1; convert to group as
        # fallback if a public was requested.
        if permission == "public":
            body["permission"] = "group"
            s, resp = http_post(f"{BACKEND}/api/markers", body, headers=h)
        if s not in (200, 201):
            print(f"  [warn] POST /markers failed for {text}: status={s} body={resp}")

def mark_along_path(path, count, perm_kinds):
    """Place `count` marks evenly along path with small perpendicular offset."""
    if len(path) < 2 or count == 0:
        return []
    n = len(path)
    out = []
    for i in range(count):
        idx = int((i + 0.5) * (n - 1) / count)
        idx_next = min(idx + 1, n - 1)
        # perpendicular offset ±15m
        p_from, p_to = path[idx], path[idx_next]
        dy = p_to[0] - p_from[0]
        dx = (p_to[1] - p_from[1]) * math.cos(math.radians(p_from[0]))
        norm = math.hypot(dy, dx) or 1e-9
        side = 15 if i % 2 == 0 else -15
        px, py = dx / norm, -dy / norm
        lat = p_from[0] + (py * side) / 111320
        lng = p_from[1] + (px * side) / (111320 * math.cos(math.radians(p_from[0])))
        kind = perm_kinds[i % len(perm_kinds)]
        out.append((lat, lng, kind[0], kind[1], kind[2]))
    return out

# ── Main ───────────────────────────────────────────────────────────────────
def main():
    print(f"Backend: {BACKEND}")
    print(f"Mapbox token: {MAPBOX_TOKEN[:12]}...")
    print()

    # Get user IDs from emails by login
    uid_map = {19: '1', 20: '2', 21: '3', 23: '5', 24: '6', 25: '7', 26: '8', 27: '9'}
    email_to_uid = {v: k for k, v in uid_map.items()}

    summary = []
    for email, password, name in ACCOUNTS:
        uid = email_to_uid[email]
        print(f"=== {name} (id={uid}, email={email}) ===")
        token = login(email, password)
        if not token:
            print(f"  skip — login failed")
            continue
        print(f"  login OK")

        # Wipe existing data so re-runs don't accumulate
        wipe_user_data(token, uid)
        print(f"  wiped existing sessions/markers")

        # Snap loop to road
        loop = WALKING_LOOPS[uid]
        snapped = map_match(loop)
        print(f"  snapped {len(loop)} waypoints -> {len(snapped)} road-aligned points")

        # Densify
        dense = densify(snapped, spacing_m=15)
        dist_km = path_distance_m(dense) / 1000
        print(f"  densified to {len(dense)} points, total {dist_km:.2f} km")

        # POST session
        rp = post_session(token, dense, days_ago=3, name=f"{name} — daily loop")
        if not rp:
            print(f"  session post failed, skip user")
            continue
        print(f"  session created: {len(rp)} route_points")

        # POST memory_points (mirror of route_points)
        n_mem = post_memory_points(token, rp)
        print(f"  memory_points: {n_mem} accepted")

        # Plant marks
        perm_kinds = MARK_TYPES_PUBLIC if uid in USE_PUBLIC_TYPES_FOR else MARK_TYPES_FRIEND
        marks = mark_along_path(dense, MARKS_PER_USER[uid], perm_kinds)
        for lat, lng, mtype, text, perm in marks:
            post_marker(token, lat, lng, mtype, text, perm)
        print(f"  marks planted: {len(marks)}")

        summary.append((name, uid, len(dense), n_mem, len(marks), round(dist_km, 2)))
        print()
        time.sleep(0.5)  # be polite to rate limiter

    print()
    print("=" * 60)
    print(f"{'Name':<12} {'uid':<4} {'pts':<5} {'mem':<5} {'mk':<3} {'km':<5}")
    print("-" * 60)
    for name, uid, pts, mem, mk, km in summary:
        print(f"{name:<12} {uid:<4} {pts:<5} {mem:<5} {mk:<3} {km:<5}")
    print("=" * 60)

if __name__ == "__main__":
    main()
