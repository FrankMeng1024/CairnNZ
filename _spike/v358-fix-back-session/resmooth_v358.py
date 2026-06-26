#!/usr/bin/env python3
"""
v358 Kalman re-process — fixes v355 to handle sessions whose route_points
lack the 't' (timestamp) field. v355 silently skipped session 46 ("back")
because all 87 of its points had {alt, lat, lng} only — no t — and the
filter at line 84 dropped every one of them.

v358 fix: when t is missing on a session, synthesise per-point ts as
session.start_time + idx*step where step = duration_s*1000 / N. This
preserves correct timing semantics for Kalman (Q is per-tick, R is per-
accuracy) and lets the segment-by-gap logic on the client treat the
session correctly.

Other behaviour matches v355: per-session Kalman reset, 12.5m cull,
DELETE+INSERT replace per user, backup retained at memory_points_pre_kalman.
"""
import json
import os
import sys
import pymysql
from typing import List, Tuple, Optional
from datetime import datetime

KALMAN_Q = 1e-9
DEFAULT_ACCURACY_M = 14.0
DEG_PER_M = 1.0 / 111320.0
CULL_MIN_DIST_M = 12.5
CULL_MIN_DIST_DEG2 = (CULL_MIN_DIST_M * DEG_PER_M) ** 2


def kalman_init(initial_value, accuracy):
    r = (max(accuracy, 0.1) / 111000.0) ** 2
    return {"x": initial_value, "p": r, "q": KALMAN_Q, "r": r}


def kalman_update(state, measurement, accuracy=None):
    p_pred = state["p"] + state["q"]
    if accuracy is not None and accuracy > 0:
        state["r"] = (accuracy / 111000.0) ** 2
    k = p_pred / (p_pred + state["r"])
    state["x"] = state["x"] + k * (measurement - state["x"])
    state["p"] = (1 - k) * p_pred
    return state["x"]


def smooth_session_points(
    route_points: list,
    session_start_ms: Optional[int] = None,
    session_duration_s: Optional[int] = None,
) -> List[Tuple[float, float, int]]:
    """Per-session Kalman smoothing + 12.5m cull. Returns [(lat, lng, ts), ...]."""
    if not route_points:
        return []

    # Accept points with lat+lng even when t is missing (v358 fix).
    valid = [p for p in route_points if isinstance(p, dict) and "lat" in p and "lng" in p]
    if not valid:
        return []

    # If any point has t, use those values for sorting.
    has_t = any("t" in p for p in valid)
    if has_t:
        # Sort by t for points that have it, others stay in file order
        # but pushed to end (rare). Simpler: sort with t-or-0 then split.
        valid_with_t = [p for p in valid if "t" in p]
        valid_with_t.sort(key=lambda p: p["t"])
        pts = valid_with_t
    else:
        # No timestamps at all on any point — synthesise from session metadata.
        # Step ms = duration / n, anchored at start_time.
        n = len(valid)
        if session_start_ms is None:
            session_start_ms = 0
        if session_duration_s and n > 1:
            step_ms = max(1, int(session_duration_s * 1000 / max(1, n - 1)))
        else:
            step_ms = 1000
        pts = []
        for idx, p in enumerate(valid):
            q = dict(p)
            q["t"] = session_start_ms + idx * step_ms
            pts.append(q)

    first = pts[0]
    acc0 = first.get("accuracy", DEFAULT_ACCURACY_M) or DEFAULT_ACCURACY_M
    lat_state = kalman_init(first["lat"], acc0)
    lng_state = kalman_init(first["lng"], acc0)

    smoothed = []
    last_kept = None

    for p in pts:
        lat = p["lat"]
        lng = p["lng"]
        ts = p["t"]
        acc = p.get("accuracy", DEFAULT_ACCURACY_M) or DEFAULT_ACCURACY_M
        slat = kalman_update(lat_state, lat, acc)
        slng = kalman_update(lng_state, lng, acc)

        if last_kept is not None:
            d_lat = slat - last_kept[0]
            d_lng = (slng - last_kept[1]) * 0.85
            if (d_lat * d_lat + d_lng * d_lng) < CULL_MIN_DIST_DEG2:
                continue

        smoothed.append((slat, slng, ts))
        last_kept = (slat, slng)

    return smoothed


def main():
    db = pymysql.connect(
        host="localhost",
        user="root",
        password=os.environ["DB_PASSWORD"],
        database="cairn",
        port=3306,
        autocommit=False,
    )
    cur = db.cursor()

    print("Step 1: Backup current memory_points → memory_points_pre_v358_kalman")
    cur.execute("DROP TABLE IF EXISTS memory_points_pre_v358_kalman")
    cur.execute("CREATE TABLE memory_points_pre_v358_kalman LIKE memory_points")
    cur.execute("INSERT INTO memory_points_pre_v358_kalman SELECT * FROM memory_points")
    backup_n = cur.rowcount
    print(f"  Backed up {backup_n} rows")

    print("Step 2: Collecting users with sessions")
    cur.execute("SELECT DISTINCT user_id FROM sessions WHERE route_points IS NOT NULL")
    user_ids = [r[0] for r in cur.fetchall()]
    print(f"  {len(user_ids)} users: {user_ids}")

    inserted_total = 0
    deleted_total = 0

    for user_id in user_ids:
        cur.execute("DELETE FROM memory_points WHERE user_id = %s", (user_id,))
        deleted = cur.rowcount
        deleted_total += deleted

        cur.execute(
            "SELECT id, start_time, duration_s, route_points FROM sessions "
            "WHERE user_id = %s AND route_points IS NOT NULL "
            "ORDER BY start_time ASC",
            (user_id,),
        )
        sessions = cur.fetchall()

        user_inserted = 0
        skipped_t_only = 0
        for sid, start_time, duration_s, rp_json in sessions:
            if rp_json is None:
                continue
            try:
                rp = json.loads(rp_json) if isinstance(rp_json, str) else rp_json
            except Exception as e:
                print(f"  user {user_id} session {sid}: json parse fail {e}")
                continue
            if not isinstance(rp, list) or len(rp) == 0:
                continue

            # Convert start_time (MySQL DATETIME) to epoch ms
            start_ms = None
            if isinstance(start_time, datetime):
                start_ms = int(start_time.timestamp() * 1000)

            smoothed = smooth_session_points(
                rp,
                session_start_ms=start_ms,
                session_duration_s=duration_s,
            )
            if not smoothed:
                continue

            # Detect if t was synthesised (no 't' in any input point)
            had_t = any(isinstance(p, dict) and "t" in p for p in rp)
            tag = "v358" if had_t else "v358synthts"

            values = [
                (user_id, lat, lng, ts, f"migration-{tag}-s{sid}-i{idx}")
                for idx, (lat, lng, ts) in enumerate(smoothed)
            ]
            cur.executemany(
                "INSERT INTO memory_points (user_id, lat, lng, ts, client_id) VALUES (%s, %s, %s, %s, %s)",
                values,
            )
            user_inserted += len(values)
            print(f"  user {user_id} session {sid}: {len(rp)} → {len(smoothed)} ({tag})")

        inserted_total += user_inserted
        print(f"  user {user_id}: deleted {deleted}, inserted {user_inserted}")

    print(f"Step 3: Committing — deleted {deleted_total}, inserted {inserted_total}")
    db.commit()

    print("Step 4: Verify")
    cur.execute("SELECT user_id, COUNT(*) FROM memory_points GROUP BY user_id ORDER BY user_id")
    for uid, n in cur.fetchall():
        print(f"  user {uid}: {n} memory_points")

    # Per-session distribution for user 4
    cur.execute(
        "SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(client_id, '-s', -1), '-', 1) as sid, COUNT(*) "
        "FROM memory_points WHERE user_id=4 GROUP BY sid ORDER BY sid"
    )
    print("  user 4 per-session counts:")
    for sid, n in cur.fetchall():
        print(f"    session {sid}: {n} points")

    cur.close()
    db.close()
    print("Done. Backup retained at memory_points_pre_v358_kalman.")


if __name__ == "__main__":
    main()
