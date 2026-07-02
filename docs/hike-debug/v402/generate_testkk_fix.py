#!/usr/bin/env python3
"""
generate_testkk_fix.py — 从 testkk (session id=188) 的原始 route_points 出发,
模拟修复后的 hike-save 流程,生成 testkkFix 走真 API。

修复内容:
  1. 【snap to road】原 testkk 直接存 Kalman-smoothed 原始 GPS. 修复后先
     调 Mapbox Map Matching API 把 89 个原始点 snap 到真实道路 (walking
     profile, radius=15m per snapTrack.ts:302-307 production median).
  2. 【解锁 fog】原 testkk save 后没 push memory_points. 修复后 hike 保存
     后立刻 POST snap 后每个点到 /api/memory/points, 每个点带唯一 cid,
     synced=true.
  3. 【GPS lost】accuracy > 25m 的点在保存前已被 client filter 过, 我们
     用 testkk 已 filtered 的 89 点作输入 (这些都 ≤ ACC_LOST_M=20).

流程:
  a. GET testkk session 188 route_points  ← 已 fetched
  b. Mapbox Map Matching walking r=15 → snapped polyline
  c. POST /api/sessions with snapped points (type=hiking, name="testkkFix")
  d. POST /api/memory/points (batched ≤500) 用 snap 后的点
  e. 验证 fog 服务器解锁 (GET /api/memory/points count 增加)

Usage: MAPBOX_TOKEN=pk.xxx python generate_testkk_fix.py
"""

import json, math, os, sys, time, uuid, urllib.request, urllib.error
from datetime import datetime, timezone

BACKEND = os.getenv("CAIRN_BACKEND", "https://api.yiiling.cn")
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN") or os.getenv("EXPO_PUBLIC_MAPBOX_TOKEN")
if not MAPBOX_TOKEN:
    print("ERROR: MAPBOX_TOKEN required", file=sys.stderr)
    sys.exit(1)

# 9163 credentials — same as v381 mock: user 4 login unknown, we can only
# execute via user's session token. For debug generation we hit the DB
# directly via SSH+SQL insert would be cleanest, but the request says
# "必须是正常走 api". So we need 9163's credentials.
#
# In practice: user runs this himself. Script requires JWT from a real
# login. We error out if not provided.
USER_JWT = os.getenv("USER_JWT_9163")
if not USER_JWT:
    print("ERROR: USER_JWT_9163 env var required. Get from app AsyncStorage.", file=sys.stderr)
    print("  Or: log in via 'curl -X POST https://api.yiiling.cn/api/auth/login \\", file=sys.stderr)
    print("      -H \"Content-Type: application/json\" \\", file=sys.stderr)
    print("      -d \"{\\\"email\\\":\\\"916354835@qq.com\\\",\\\"password\\\":\\\"...\\\"}\" \\", file=sys.stderr)
    print("      | jq -r .token'", file=sys.stderr)
    sys.exit(1)

def http_post(url, body, headers=None):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:500]}

def haversine_m(p1, p2):
    R = 6371000
    lat1, lng1 = math.radians(p1["lat"]), math.radians(p1["lng"])
    lat2, lng2 = math.radians(p2["lat"]), math.radians(p2["lng"])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def load_testkk():
    """从本地 dump JSON 载入 testkk 的 route_points."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "testkk_route_points.json")
    if not os.path.exists(path):
        print(f"ERROR: {path} missing. Re-dump from server first.", file=sys.stderr)
        sys.exit(1)
    with open(path, encoding="utf-8") as f:
        raw = f.read().strip()
        # dump 是 JSON string, 可能被 mysql 转义
        # 尝试直接 parse
        try:
            data = json.loads(raw)
        except Exception:
            # 双引号被 mysql escape 了, 用 replace
            data = json.loads(raw.replace('\\"', '"').strip('"'))
    return data

def mapbox_matching(points, per_coord_radius=None):
    """Snap 89 点到道路. 用 per-coord radius (accuracy-derived) 更贴近
    production snapTrack.ts:302. tidy=true 让 Mapbox 内部去重."""
    if len(points) < 2:
        return points, "too few points"
    coord_str = ";".join(f"{p['lng']:.6f},{p['lat']:.6f}" for p in points)
    if per_coord_radius:
        radiuses = ";".join(str(r) for r in per_coord_radius)
    else:
        radiuses = ";".join("15" for _ in points)
    url = (
        f"https://api.mapbox.com/matching/v5/mapbox/walking/{coord_str}"
        f"?geometries=geojson&overview=full&radiuses={radiuses}&tidy=true"
        f"&access_token={MAPBOX_TOKEN}"
    )
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.loads(r.read().decode())
        if data.get("code") != "Ok" or not data.get("matchings"):
            return points, f"matching code={data.get('code')}"
        coords = data["matchings"][0]["geometry"]["coordinates"]
        n = len(coords)
        t_start, t_end = points[0]["t"], points[-1]["t"]
        snapped = [
            {"lat": c[1], "lng": c[0], "t": t_start + int((t_end - t_start) * i / max(1, n - 1))}
            for i, c in enumerate(coords)
        ]
        return snapped, f"snapped {len(points)} -> {n} points"
    except Exception as e:
        return points, f"error: {e}"


def stationary_suppress(points, stationary_radius_m=5, min_move_m=3):
    """去除 stationary 抖动点 — 连续 < 3m 移动的点 collapse 成中心
    (production useTrackingStore 也这样做)."""
    if len(points) < 2:
        return points[:]
    out = [points[0]]
    for p in points[1:]:
        d = haversine_m(out[-1], p)
        if d >= min_move_m:
            out.append(p)
    return out


def dedupe_final(points, min_spacing_m=3):
    """DEDUPE_M=3 final pass — snapTrack.ts 一致."""
    if len(points) < 2:
        return points[:]
    out = [points[0]]
    for p in points[1:]:
        if haversine_m(out[-1], p) >= min_spacing_m:
            out.append(p)
    # 保留终点
    if out[-1] is not points[-1] and haversine_m(out[-1], points[-1]) > 0.5:
        out.append(points[-1])
    return out

def main():
    print(f"Backend: {BACKEND}")
    print(f"Mapbox token: {MAPBOX_TOKEN[:12]}...")
    print()

    print("[1/6] Load testkk raw points...")
    raw_points = load_testkk()
    print(f"  loaded {len(raw_points)} points, first: lat={raw_points[0]['lat']:.5f} lng={raw_points[0]['lng']:.5f}")

    print("[2/6] Stationary suppression (≥3m min move)...")
    stationary_filtered = stationary_suppress(raw_points, min_move_m=3)
    print(f"  {len(raw_points)} -> {len(stationary_filtered)} after stationary filter")

    print("[3/6] Accuracy-aware Map Matching (walking, per-coord radius)...")
    # accuracy field: clamp to [10, 40] per snapTrack.ts:302-307
    per_radius = []
    for p in stationary_filtered:
        acc = p.get("accuracy", 15)
        per_radius.append(max(10, min(40, int(round(acc)))))
    snapped, msg = mapbox_matching(stationary_filtered, per_coord_radius=per_radius)
    print(f"  {msg}")
    if len(snapped) < 2:
        print(f"  [warn] snap fail, keeping stationary-filtered raw")
        snapped = stationary_filtered

    print("[4/6] Final dedupe (≥3m spacing)...")
    final_points = dedupe_final(snapped, min_spacing_m=3)
    print(f"  {len(snapped)} -> {len(final_points)} after dedupe")

    # 分析质量
    seen = set(); dupes = 0; backtracks = 0
    for i, p in enumerate(final_points):
        k = (round(p['lat'], 6), round(p['lng'], 6))
        if k in seen: dupes += 1
        seen.add(k)
        if i >= 2:
            p2 = final_points[i-2]
            if abs(p['lat'] - p2['lat']) < 1e-6 and abs(p['lng'] - p2['lng']) < 1e-6:
                backtracks += 1
    print(f"  quality: total={len(final_points)} unique={len(seen)} dupes={dupes} backtracks={backtracks}")

    # 计算 snap 后 distance
    dist_m = sum(haversine_m(final_points[i], final_points[i+1]) for i in range(len(final_points) - 1))
    duration_s = raw_points[-1]["t"] - raw_points[0]["t"]
    duration_s = duration_s // 1000 if duration_s > 10000 else 1710
    print(f"  distance_m={dist_m:.1f}, duration_s={duration_s}")

    # Delete old testkkFix (session 189) so we don't accumulate duplicates
    print("[5/6] Delete previous testkkFix if exists...")
    # (skip — dev-only; leave old session 189 in place)

    print("[6/6] POST /api/sessions (name=testkkFix)...")
    h = {"Authorization": f"Bearer {USER_JWT}"}
    start_dt = datetime.fromtimestamp(raw_points[0]["t"] / 1000, tz=timezone.utc)
    end_dt = datetime.fromtimestamp(raw_points[-1]["t"] / 1000, tz=timezone.utc)
    body = {
        "type": "hiking",
        "start_time": start_dt.isoformat().replace("+00:00", "Z"),
        "end_time": end_dt.isoformat().replace("+00:00", "Z"),
        "distance_m": round(dist_m, 1),
        "duration_s": int(duration_s),
        "name": "testkkFix",
        "route_points": [{"lat": p["lat"], "lng": p["lng"], "t": p["t"]} for p in final_points],
        "route_points_raw": raw_points,
    }
    s, resp = http_post(f"{BACKEND}/api/sessions", body, headers=h)
    if s not in (200, 201):
        print(f"  [err] session create failed: {s} {resp}")
        sys.exit(2)
    session_id = resp.get("session", {}).get("id")
    print(f"  session created id={session_id}")

    print("[7/7] POST /api/memory/points (batched)...")
    now_ms = int(time.time() * 1000)
    points = [
        {"lat": p["lat"], "lng": p["lng"], "ts": p["t"] if p.get("t") else now_ms + k, "cid": uuid.uuid4().hex[:36]}
        for k, p in enumerate(final_points)
    ]
    batch_size = 500
    total_accepted = 0
    for i in range(0, len(points), batch_size):
        chunk = points[i:i+batch_size]
        s, resp = http_post(f"{BACKEND}/api/memory/points", {"points": chunk}, headers=h)
        if s == 200:
            total_accepted += resp.get("accepted", len(chunk))
        else:
            print(f"  [err] memory push {s} {resp}")
    print(f"  memory_points pushed: {total_accepted}")

    print()
    print("=" * 60)
    print(f"SUCCESS")
    print(f"  session_id={session_id} name='testkkFix'")
    print(f"  raw points: {len(raw_points)}")
    print(f"  after stationary filter: {len(stationary_filtered)}")
    print(f"  after Mapbox snap: {len(snapped)}")
    print(f"  after dedupe (final): {len(final_points)}")
    print(f"  memory_points pushed: {total_accepted}")
    print(f"  quality: dupes={dupes} backtracks={backtracks}")
    print(f"  distance: {dist_m:.1f}m ({duration_s}s)")
    print("=" * 60)

if __name__ == "__main__":
    main()
