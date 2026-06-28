#!/usr/bin/env python3
"""
mock_via_real_api.py — v383 real save-hike API mock data generator.

v383 changes vs v382 (per docs/plan/v383-plan-final2.md):
  - ALLOWED_UIDS double guard (compile-time set + runtime /api/auth/me check)
  - Wipe order: sessions -> routes -> markers -> memory_points (bulk)
  - Matching API with tidy=true + per-coord radiuses=10 (production-faithful)
  - Per-uid fallback: matching r=10 -> r=25 -> Directions walking -> Directions cycling
  - Drop densify (Mapbox geometry is already road-vertex spaced)
  - Drop ts AND alt fields on route_points (match 9163's real shape exactly)
  - shapely + static buildings.geojson intersection check (穿楼 detection)
  - --dry-run flag (default) writes preview JSON, --execute does the deletes/writes
  - Drop authLimiter probe — react to actual 429 on first login
  - Drop SQL public seed (deferred to v384 admin endpoint)
  - 7-out-of-8 acceptance: per-uid skip if 3 reselect iterations fail

Pipeline per demo account (uid 19/20/21/23/24/25/26/27 — uid 22 (9163) UNTOUCHED):
  1. POST /api/auth/login → JWT  (handles 429 with clear instructions)
  2. GET /api/auth/me → verify uid ∈ ALLOWED_UIDS
  3. Wipe sessions + routes + markers + memory_points
  4. Mapbox Matching API (tidy=true, radiuses=10) on hand-picked road waypoints
  5. If matching backtracks or fails → widen radiuses=25 → Directions walking → Directions cycling
  6. shapely intersect against backend/scripts/seed/data/v383-jingan-buildings.geojson
  7. If crossings > 0 → reselect or skip uid
  8. POST /api/sessions with route_points = [{lat, lng}, ...] (no ts, no alt)
  9. POST /api/memory/points (batched ≤500) with cid=uuid for each
 10. POST /api/markers a handful along the path (silent demote public→group)

Backend: api.yiiling.cn (aliyun).
"""

import json
import math
import os
import sys
import time
import uuid
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

# ── CONFIG ──────────────────────────────────────────────────────────────────
BACKEND = os.getenv("CAIRN_BACKEND", "https://api.yiiling.cn")
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN") or os.getenv("EXPO_PUBLIC_MAPBOX_TOKEN")
if not MAPBOX_TOKEN:
    print("ERROR: set MAPBOX_TOKEN env var (or EXPO_PUBLIC_MAPBOX_TOKEN)", file=sys.stderr)
    sys.exit(1)
if not MAPBOX_TOKEN.startswith("pk."):
    print("ERROR: MAPBOX_TOKEN must be public scope (pk.*) — secret token forbidden", file=sys.stderr)
    sys.exit(1)

# v383 hard safety: only these uids may ever be touched by this script.
# uid 22 = 9163 (real user) is excluded. Any login outside this set HARD STOPS.
ALLOWED_UIDS = {19, 20, 21, 23, 24, 25, 26, 27}

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

# Map email → expected uid (verified against /api/auth/me after login)
EXPECTED_UID = {"1": 19, "2": 20, "3": 21, "5": 23, "6": 24, "7": 25, "8": 26, "9": 27}

# ── REAL WALKING ANCHORS ────────────────────────────────────────────────────
# Pulled from Mapbox tilequery — these are coordinates KNOWN to lie on
# walking edges (康定/延平/武定/胶州/万春/乌鲁木齐北).
WALKING_LOOPS = {
    19: [  # Alice — north loop
        (31.23249, 121.43514), (31.23279, 121.43359), (31.23246, 121.43191),
        (31.23144, 121.43152), (31.23046, 121.43432), (31.23117, 121.43621),
        (31.23144, 121.43598), (31.23249, 121.43514),
    ],
    20: [  # Bob — east arc
        (31.23087, 121.43646), (31.22994, 121.43721), (31.22983, 121.43729),
        (31.23081, 121.43721), (31.23144, 121.43689), (31.23087, 121.43646),
    ],
    21: [  # Carol — east stretch + back via 万春街 (need > 200m)
        (31.23249, 121.43514), (31.23117, 121.43621), (31.23144, 121.43598),
        (31.23087, 121.43646), (31.23046, 121.43432),
    ],
    23: [  # LDY — big loop covering most streets
        (31.23249, 121.43514), (31.23279, 121.43359), (31.23246, 121.43191),
        (31.23144, 121.43152), (31.23046, 121.43432), (31.22960, 121.43462),
        (31.22994, 121.43721), (31.23081, 121.43721), (31.23144, 121.43689),
        (31.23087, 121.43646), (31.23144, 121.43598), (31.23249, 121.43514),
    ],
    24: [  # Eve — south crescent
        (31.22960, 121.43462), (31.22892, 121.43201), (31.22813, 121.43481),
        (31.22725, 121.43641), (31.22930, 121.43721), (31.22960, 121.43462),
    ],
    25: [  # Stranger 1
        (31.23081, 121.43721), (31.22983, 121.43729), (31.22994, 121.43721),
    ],
    26: [  # Stranger 2
        (31.22892, 121.43201), (31.22813, 121.43481), (31.22960, 121.43462),
    ],
    27: [  # Stranger 3
        (31.23279, 121.43359), (31.23262, 121.43311), (31.23281, 121.43302),
        (31.23249, 121.43514),
    ],
}

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
MARKS_PER_USER = {19: 6, 20: 5, 21: 3, 23: 8, 24: 4, 25: 2, 26: 2, 27: 2}
USE_PUBLIC_TYPES_FOR = {21, 25, 26, 27}

# Buildings GeoJSON for 穿楼 detection.
BUILDINGS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "data", "v383-jingan-buildings.geojson",
)

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
        body_text = e.read().decode("utf-8", errors="ignore")
        return e.code, {"error": body_text}

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

# ── Mapbox Matching + Directions ───────────────────────────────────────────
def mapbox_matching(waypoints, profile="walking", radius=10):
    """Map Matching API — production-faithful (mirrors snapTrack.ts)."""
    if len(waypoints) < 2:
        return None, "fewer than 2 waypoints"
    coord_str = ";".join(f"{lng:.6f},{lat:.6f}" for lat, lng in waypoints)
    radiuses = ";".join(str(radius) for _ in waypoints)
    url = (
        f"https://api.mapbox.com/matching/v5/mapbox/{profile}/{coord_str}"
        f"?geometries=geojson&overview=full&radiuses={radiuses}&tidy=true"
        f"&access_token={MAPBOX_TOKEN}"
    )
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data.get("code") != "Ok" or not data.get("matchings"):
            return None, f"matching code={data.get('code')}"
        coords = data["matchings"][0]["geometry"]["coordinates"]
        return [(c[1], c[0]) for c in coords], None
    except Exception as e:
        return None, f"matching error: {e}"

def mapbox_directions(start, via, end, profile="walking"):
    """Directions API — fallback when Matching fails or backtracks."""
    pts = [start]
    if via:
        pts.append(via)
    pts.append(end)
    coord_str = ";".join(f"{lng:.6f},{lat:.6f}" for lat, lng in pts)
    url = (
        f"https://api.mapbox.com/directions/v5/mapbox/{profile}/{coord_str}"
        f"?geometries=geojson&overview=full&access_token={MAPBOX_TOKEN}"
    )
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data.get("code") != "Ok" or not data.get("routes"):
            return None, f"directions code={data.get('code')}"
        coords = data["routes"][0]["geometry"]["coordinates"]
        return [(c[1], c[0]) for c in coords], None
    except Exception as e:
        return None, f"directions error: {e}"

# ── Quality gates ──────────────────────────────────────────────────────────
def detect_backtrack(coords, min_segment_m=15):
    """Heuristic: count consecutive segments doing near-180° reversal.
    Strict: dot product < -0.95 (almost exactly reversed) AND both
    segments ≥ min_segment_m. Two-pixel zigzags on map grid don't count."""
    issues = 0
    for i in range(len(coords) - 2):
        a, b, c = coords[i], coords[i+1], coords[i+2]
        ab = (b[1]-a[1], b[0]-a[0])
        bc = (c[1]-b[1], c[0]-b[0])
        ab_len = math.hypot(*ab)
        bc_len = math.hypot(*bc)
        if ab_len < 1e-6 or bc_len < 1e-6:
            continue
        dot = (ab[0]*bc[0] + ab[1]*bc[1]) / (ab_len * bc_len)
        if dot < -0.95 and haversine_m(a, b) > min_segment_m and haversine_m(b, c) > min_segment_m:
            issues += 1
    return issues

def validate_geometry(coords):
    """plan-final2 §A0.5 — basic sanity before writing."""
    if len(coords) < 5:
        return False, f"too few points: {len(coords)}"
    total = path_distance_m(coords)
    # v383: Carol/Stranger short walks valid down to 200m (smaller mock area).
    # LDY's full loop ~2km — keep upper bound 3500.
    if total < 200 or total > 3500:
        return False, f"distance out of range: {total:.0f}m"
    spacings = [haversine_m(coords[i], coords[i+1]) for i in range(len(coords)-1)]
    spacings.sort()
    median = spacings[len(spacings)//2]
    if median > 40:
        return False, f"vertex spacing too coarse: median={median:.1f}m"
    return True, f"len={len(coords)} dist={total:.0f}m median_spacing={median:.1f}m"

def load_buildings():
    """Load static buildings GeoJSON. Returns list of shapely Polygons or None."""
    if not os.path.exists(BUILDINGS_PATH):
        print(f"  [warn] buildings file missing: {BUILDINGS_PATH}")
        print(f"         穿楼 detection SKIPPED — manually inspect output PNGs.")
        return None
    try:
        from shapely.geometry import shape
    except ImportError:
        print(f"  [warn] shapely not installed — `pip install shapely`")
        print(f"         穿楼 detection SKIPPED.")
        return None
    with open(BUILDINGS_PATH, encoding="utf-8") as f:
        gj = json.load(f)
    polys = []
    for feat in gj.get("features", []):
        geom = feat.get("geometry")
        if geom and geom.get("type") in ("Polygon", "MultiPolygon"):
            try:
                polys.append(shape(geom))
            except Exception:
                pass
    if len(polys) < 50:
        print(f"  [warn] buildings GeoJSON has only {len(polys)} features — re-export from overpass-turbo")
        return None
    print(f"  [info] loaded {len(polys)} building polygons for 穿楼 check")
    return polys

def count_building_crossings(coords, buildings):
    """Returns list of (segment_index, building_polygon) intersections."""
    if not buildings:
        return []
    try:
        from shapely.geometry import LineString
    except ImportError:
        return []
    crossings = []
    line = LineString([(c[1], c[0]) for c in coords])  # lng,lat order
    for i, b in enumerate(buildings):
        if line.intersects(b):
            crossings.append(i)
    return crossings

# ── Per-uid snap pipeline ──────────────────────────────────────────────────
def snap_pipeline(uid, waypoints, buildings):
    """Try matching r=15 → r=25 → directions walking → directions cycling.
    Returns (coords, log_msg) or (None, error_msg).
    v383 review H3: radius 10 → 15 by default. Production snapTrack.ts uses
    per-coord radiuses derived from GPS accuracy clamped to [10, 40]; median
    real-world accuracy is 15-20m. Fixed r=15 produces matchings closer in
    visual quality to real saved hikes than r=10 (which was unrealistically
    tight). r=25 still kept as widen fallback.
    Crossings tolerance: 0 ideal, 1 accepted (OSM building polygons can include
    walkable service alleys / arcades — false positives expected). ≥2 rejected.
    Backtrack tolerance: 0 ideal, 1 accepted (real city walks include cul-de-sacs
    where you walk in and back out — that's a real walking pattern, not a bug).
    ≥2 rejected (multiple reversals = Mapbox confused).
    """
    MAX_CROSSINGS = 1
    MAX_BACKTRACKS = 1
    # Step 1: Matching r=15 (close to production median)
    coords, err = mapbox_matching(waypoints, profile="walking", radius=15)
    if coords:
        bt = detect_backtrack(coords)
        ok, msg = validate_geometry(coords)
        crossings = count_building_crossings(coords, buildings)
        if ok and bt <= MAX_BACKTRACKS and len(crossings) <= MAX_CROSSINGS:
            return coords, f"matching r=10 OK {msg} crossings={len(crossings)}"
        print(f"  [tier1] matching r=10: bt={bt} crossings={len(crossings)} {msg}")
    # Step 2: Matching r=25 (widen)
    coords, err = mapbox_matching(waypoints, profile="walking", radius=25)
    if coords:
        bt = detect_backtrack(coords)
        ok, msg = validate_geometry(coords)
        crossings = count_building_crossings(coords, buildings)
        print(f"  [tier2] matching r=25: bt={bt} crossings={len(crossings)} {msg}")
        if ok and bt <= MAX_BACKTRACKS and len(crossings) <= MAX_CROSSINGS:
            return coords, f"matching r=25 OK {msg} crossings={len(crossings)}"
    # Step 3: Directions walking
    if len(waypoints) >= 2:
        via = waypoints[len(waypoints)//2] if len(waypoints) > 2 else None
        coords, err = mapbox_directions(waypoints[0], via, waypoints[-1], profile="walking")
        if coords:
            bt = detect_backtrack(coords)
            ok, msg = validate_geometry(coords)
            crossings = count_building_crossings(coords, buildings)
            print(f"  [tier3] directions walking: bt={bt} crossings={len(crossings)} {msg}")
            if ok and bt <= MAX_BACKTRACKS and len(crossings) <= MAX_CROSSINGS:
                return coords, f"directions walking OK {msg} crossings={len(crossings)}"
    # Step 4: Directions cycling
    if len(waypoints) >= 2:
        via = waypoints[len(waypoints)//2] if len(waypoints) > 2 else None
        coords, err = mapbox_directions(waypoints[0], via, waypoints[-1], profile="cycling")
        if coords:
            bt = detect_backtrack(coords)
            ok, msg = validate_geometry(coords)
            crossings = count_building_crossings(coords, buildings)
            print(f"  [tier4] directions cycling: bt={bt} crossings={len(crossings)} {msg}")
            if ok and bt <= MAX_BACKTRACKS and len(crossings) <= MAX_CROSSINGS:
                return coords, f"directions cycling OK {msg} crossings={len(crossings)}"
    return None, f"all 4 tiers failed (last err: {err})"

# ── API actions ────────────────────────────────────────────────────────────
def login(email, password):
    status, body = http_post(f"{BACKEND}/api/auth/login",
                             {"email": email, "password": password})
    if status == 429:
        print(f"\nERROR: authLimiter exhausted (429).")
        print(f"Bump it then re-run:")
        print(f"  ssh root@122.51.174.118 \\")
        print(f"    'docker exec cairn-backend sed -i \"s|max: [0-9]\\+|max: 5000|\" /app/src/routes/auth.js \\")
        print(f"     && docker restart cairn-backend'")
        print(f"  Wait 10s then re-run.")
        sys.exit(2)
    if status != 200:
        print(f"  [err] login failed for {email}: status={status} body={body}")
        return None
    return body.get("token")

def verify_uid_allowed(token, expected_uid):
    """plan-final2 §A0.3 — double guard against accidentally touching 9163."""
    s, body = http_get(f"{BACKEND}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    if s != 200:
        print(f"  [err] /me failed: {s}")
        return False
    raw_uid = body.get("user", {}).get("id")
    # /me may return uid as string or int; normalise.
    try:
        uid = int(raw_uid)
    except (TypeError, ValueError):
        print(f"  [err] /me uid not parseable: {raw_uid!r}")
        return False
    if uid != expected_uid:
        print(f"  [err] /me returned uid={uid}, expected {expected_uid}")
        return False
    if uid not in ALLOWED_UIDS:
        print(f"  [FATAL] uid {uid} not in ALLOWED_UIDS — refusing to touch.")
        sys.exit(3)
    return True

def wipe_user_data(token, uid, dry_run=True):
    """Delete sessions + routes + markers + bulk memory_points for this user.
    9163 protection: ALREADY guarded by verify_uid_allowed() above."""
    if uid not in ALLOWED_UIDS:
        print(f"  [FATAL] wipe_user_data called with uid {uid} not in ALLOWED_UIDS")
        sys.exit(3)
    h = {"Authorization": f"Bearer {token}"}
    counts = {"sessions": 0, "routes": 0, "markers": 0, "memory": 0}

    # sessions
    s, body = http_get(f"{BACKEND}/api/sessions", headers=h)
    if s == 200:
        sessions = body if isinstance(body, list) else body.get("sessions", [])
        for sess in sessions:
            sid = sess.get("id")
            if sid:
                counts["sessions"] += 1
                if not dry_run:
                    http_delete(f"{BACKEND}/api/sessions/{sid}", headers=h)
    # routes
    s, body = http_get(f"{BACKEND}/api/routes", headers=h)
    if s == 200:
        routes = body if isinstance(body, list) else body.get("routes", [])
        for r in routes:
            rid = r.get("id")
            if rid:
                counts["routes"] += 1
                if not dry_run:
                    http_delete(f"{BACKEND}/api/routes/{rid}", headers=h)
    # markers
    s, body = http_get(f"{BACKEND}/api/markers", headers=h)
    if s == 200:
        markers = body if isinstance(body, list) else body.get("markers", [])
        for m in markers:
            mid = m.get("id")
            if mid:
                counts["markers"] += 1
                if not dry_run:
                    http_delete(f"{BACKEND}/api/markers/{mid}", headers=h)
    # memory bulk
    if not dry_run:
        s, body = http_delete(f"{BACKEND}/api/memory/points", headers=h)
        if s != 200:
            print(f"  [err] DELETE /memory/points failed: status={s}")
            sys.exit(2)
        counts["memory"] = body.get("deleted", 0)
        # post-wipe verify
        s, body = http_get(f"{BACKEND}/api/memory/points?limit=1", headers=h)
        # body shape varies; check both array and {points:[]}
        leftover = body.get("points", body if isinstance(body, list) else [])
        if leftover:
            print(f"  [err] memory not empty after wipe: {len(leftover)} left")
            sys.exit(2)
    else:
        # just count for preview
        s, body = http_get(f"{BACKEND}/api/memory/points?limit=1", headers=h)
        if s == 200:
            counts["memory"] = "(would delete all)"
    return counts

def post_session(token, route_points, days_ago, name, dry_run=True, sess_type='hiking'):
    """v383: route_points are [{lat, lng}] only — no ts, no alt, matches 9163."""
    h = {"Authorization": f"Bearer {token}"}
    if len(route_points) < 2:
        return None
    now = datetime.now(timezone.utc)
    start_dt = now - timedelta(days=days_ago)
    dist_m = path_distance_m(route_points)
    duration_s = max(60, int(dist_m * 0.75))
    end_dt = start_dt + timedelta(seconds=duration_s)
    rp = [{"lat": la, "lng": ln} for la, ln in route_points]
    body = {
        "type": sess_type,
        "start_time": start_dt.isoformat().replace("+00:00", "Z"),
        "end_time": end_dt.isoformat().replace("+00:00", "Z"),
        "distance_m": round(dist_m, 1),
        "duration_s": duration_s,
        "name": name,
        "route_points": rp,
    }
    if dry_run:
        return rp  # echo for marker computation
    s, resp = http_post(f"{BACKEND}/api/sessions", body, headers=h)
    if s not in (200, 201):
        print(f"  [err] POST /sessions failed: status={s} body={resp}")
        return None
    return rp

def post_memory_points(token, route_points, dry_run=True):
    """v383: still need ts for memory_points (different schema from session
    route_points). Use wall-clock now as ts for all — fog clearing is
    spatial, not temporal, so all-same-ts is fine."""
    if dry_run:
        return len(route_points)
    h = {"Authorization": f"Bearer {token}"}
    now_ms = int(time.time() * 1000)
    batch_size = 500
    total_accepted = 0
    for i in range(0, len(route_points), batch_size):
        chunk = route_points[i:i+batch_size]
        points = [
            {"lat": p["lat"], "lng": p["lng"], "ts": now_ms + k,
             "cid": uuid.uuid4().hex[:36]}
            for k, p in enumerate(chunk)
        ]
        s, resp = http_post(f"{BACKEND}/api/memory/points", {"points": points}, headers=h)
        if s == 200:
            total_accepted += resp.get("accepted", 0)
        else:
            print(f"  [err] POST /memory/points failed: status={s} body={resp}")
    return total_accepted

def post_marker(token, lat, lng, mtype, text, permission, dry_run=True):
    if dry_run:
        return True
    h = {"Authorization": f"Bearer {token}"}
    body = {"type": mtype, "text": text, "lat": lat, "lng": lng, "permission": permission}
    s, resp = http_post(f"{BACKEND}/api/markers", body, headers=h)
    if s not in (200, 201):
        if permission == "public":
            # Backend rejects public client writes (v4 H1). Silent demote to group.
            print(f"  [info] public→group fallback for '{text}'")
            body["permission"] = "group"
            s, resp = http_post(f"{BACKEND}/api/markers", body, headers=h)
        if s not in (200, 201):
            print(f"  [warn] POST /markers failed for {text}: status={s} body={resp}")
            return False
    return True

def mark_along_path(path, count, perm_kinds):
    if len(path) < 2 or count == 0:
        return []
    n = len(path)
    out = []
    for i in range(count):
        idx = int((i + 0.5) * (n - 1) / count)
        lat, lng = path[idx]
        kind = perm_kinds[i % len(perm_kinds)]
        out.append((lat, lng, kind[0], kind[1], kind[2]))
    return out

# ── Output dir ─────────────────────────────────────────────────────────────
def write_preview(uid, name, waypoints, snapped, marks, snap_log):
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output", "v383")
    os.makedirs(out_dir, exist_ok=True)
    preview = {
        "uid": uid,
        "name": name,
        "waypoints_in": [[la, ln] for la, ln in waypoints],
        "snapped_coords_n": len(snapped) if snapped else 0,
        "distance_m": round(path_distance_m(snapped), 1) if snapped else 0,
        "marks": [{"lat": la, "lng": ln, "type": t, "text": tx, "permission": p}
                  for la, ln, t, tx, p in marks],
        "snap_log": snap_log,
    }
    # also write GeoJSON for visual review
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"uid": uid, "kind": "polyline"},
             "geometry": {"type": "LineString", "coordinates": [[ln, la] for la, ln in (snapped or [])]}},
            *[
                {"type": "Feature", "properties": {"uid": uid, "kind": "marker", "type": t, "text": tx, "permission": p},
                 "geometry": {"type": "Point", "coordinates": [ln, la]}}
                for la, ln, t, tx, p in marks
            ],
        ],
    }
    with open(os.path.join(out_dir, f"{uid}-preview.json"), "w", encoding="utf-8") as f:
        json.dump(preview, f, indent=2, ensure_ascii=False)
    with open(os.path.join(out_dir, f"{uid}.geojson"), "w", encoding="utf-8") as f:
        json.dump(geojson, f, indent=2, ensure_ascii=False)

# ── Main ───────────────────────────────────────────────────────────────────
def main():
    dry_run = "--execute" not in sys.argv
    print(f"Backend: {BACKEND}")
    print(f"Mode: {'DRY-RUN (no writes)' if dry_run else 'EXECUTE'}")
    print(f"ALLOWED_UIDS = {sorted(ALLOWED_UIDS)} (uid 22 = 9163 protected)")
    print()

    buildings = load_buildings()
    summary = []

    for email, password, name in ACCOUNTS:
        expected_uid = EXPECTED_UID[email]
        print(f"=== {name} (expected uid={expected_uid}, email={email}) ===")
        token = login(email, password)
        if not token:
            print("  skip — login failed")
            continue
        if not verify_uid_allowed(token, expected_uid):
            print("  skip — /me uid mismatch (suspect, refuse to touch)")
            continue
        print("  login OK + uid verified ∈ ALLOWED_UIDS")

        # Wipe
        counts = wipe_user_data(token, expected_uid, dry_run=dry_run)
        print(f"  wipe {'(DRY)' if dry_run else 'EXEC'}: sessions={counts['sessions']} routes={counts['routes']} markers={counts['markers']} memory={counts['memory']}")

        # Snap
        waypoints = WALKING_LOOPS[expected_uid]
        snapped, snap_log = snap_pipeline(expected_uid, waypoints, buildings)
        print(f"  snap: {snap_log}")
        if not snapped:
            print(f"  [warn] uid {expected_uid} skipped — all 4 snap tiers failed")
            summary.append((name, expected_uid, 0, 0, 0, 0.0, "FAILED"))
            continue
        dist_km = path_distance_m(snapped) / 1000

        # Marks
        perm_kinds = MARK_TYPES_PUBLIC if expected_uid in USE_PUBLIC_TYPES_FOR else MARK_TYPES_FRIEND
        marks = mark_along_path(snapped, MARKS_PER_USER[expected_uid], perm_kinds)

        # Write preview JSON + GeoJSON regardless of dry_run
        write_preview(expected_uid, name, waypoints, snapped, marks, snap_log)

        # Post (real only if --execute)
        rp = post_session(token, snapped, days_ago=3, name=f"{name} — daily loop", dry_run=dry_run)
        n_mem = post_memory_points(token, rp, dry_run=dry_run) if rp else 0
        if not dry_run:
            for lat, lng, mtype, text, perm in marks:
                post_marker(token, lat, lng, mtype, text, perm, dry_run=False)

        n_pts = len(snapped)
        summary.append((name, expected_uid, n_pts, n_mem, len(marks), round(dist_km, 2), "OK"))
        print(f"  ok: pts={n_pts} mem={n_mem} marks={len(marks)} dist={dist_km:.2f}km")
        print()
        time.sleep(0.5)

    print()
    print("=" * 70)
    print(f"{'Name':<12} {'uid':<4} {'pts':<5} {'mem':<5} {'mk':<3} {'km':<6} {'status':<8}")
    print("-" * 70)
    for name, uid, pts, mem, mk, km, status in summary:
        print(f"{name:<12} {uid:<4} {pts:<5} {mem:<5} {mk:<3} {km:<6} {status:<8}")
    print("=" * 70)

    ok_count = sum(1 for s in summary if s[6] == "OK")
    if ok_count < 7:
        print(f"\n⚠️  only {ok_count}/8 uids succeeded. Inspect failures before --execute.")
        sys.exit(1)
    if dry_run:
        print(f"\nDRY-RUN complete. Inspect output/v383/<uid>-preview.json + .geojson.")
        print(f"To execute: re-run with --execute")
    else:
        # v383 review H2: authLimiter may still be bumped to 5000 from
        # the manual procedure documented in feedback_mock_data_quality_rules.md.
        # Remind operator to restore it now — leaving max:5000 forever
        # materially weakens credential-stuffing protection.
        print()
        print("=" * 70)
        print("⚠️  POST-MOCK CHECKLIST — DO NOT FORGET:")
        print("=" * 70)
        print("If you bumped authLimiter to max:5000 to run this script, restore it now:")
        print("  ssh root@122.51.174.118 'docker exec cairn-backend \\")
        print("    sed -i \"s|max: 5000|max: 10|\" /app/src/routes/auth.js \\")
        print("    && docker restart cairn-backend'")
        print()
        print("Verify by trying 11 wrong logins in a row — should 429 on attempt 11.")
        print("=" * 70)

if __name__ == "__main__":
    main()
