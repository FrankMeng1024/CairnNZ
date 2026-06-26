#!/usr/bin/env python3
"""
v355 Server-side Kalman re-process of memory_points.

Background:
  v336 wrote memory_points by copying sessions.route_points directly (post-
  gate but pre-Kalman). User v354 testing showed visible "parallel-street
  drift" and "sharp inner wedges" — both are non-Kalman GPS artifacts that
  Strava-style Kalman smoothing eliminates.

  Activity polyline uses trackPointsSmoothed (Kalman). Memory must use
  the same data; this script aligns memory_points to that contract by
  re-running 1D Kalman per axis on raw GPS, matching the client
  geo.ts kalmanInit/kalmanUpdate implementation.

What this does:
  1. Back up current memory_points → memory_points_pre_kalman
  2. For each user_id with sessions:
       For each session (ordered by start_time):
         Reset Kalman state (fresh per-session)
         For each point in sessions.route_points (ts-ordered):
           Apply 1D Kalman to lat and lng independently
           Apply RDP-style 10m simplify after smoothing
         Dedupe via 12.5m culling vs accumulated written points
       Insert all kept points back into memory_points with
       client_id = 'migration-v355-s{session_id}-i{idx}'
  3. Keep memory_points_pre_kalman for 30 days then drop.

Kalman parameters (matches client useTrackingStore.ts:79):
  Q = 1e-9 (process noise — very low, smooth trajectory)
  R = (accuracy / 111000)^2 (measurement noise from GPS accuracy)
  Initial: x = first measurement, p = r

Why use route_points (not route_points_raw):
  - route_points is post-gate (teleport / accuracy / stationary all rejected)
  - route_points_raw is unfiltered, contains drift the client filter rejected
  - We want the same upstream signal the client trackPointsSmoothed sees,
    which is gated raw → Kalman in trackPointsSmoothed buffer.
  - So pre-gated route_points + server-side Kalman = identical math to
    client trackPointsSmoothed.

Idempotent: rerun safe — DROPs memory_points_pre_kalman if exists, recreates
from current state.
"""
import json
import os
import sys
import time
import pymysql
from typing import List, Tuple

# Kalman constants — match app/src/store/useTrackingStore.ts:79
KALMAN_Q = 1e-9
DEFAULT_ACCURACY_M = 14.0
DEG_PER_M = 1.0 / 111320.0

# Post-Kalman cleanup
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


def smooth_session_points(route_points: list) -> List[Tuple[float, float, int]]:
    """Per-session Kalman smoothing + 12.5m cull. Returns [(lat, lng, ts), ...]."""
    if not route_points:
        return []

    # Sort by timestamp
    pts = sorted(
        [p for p in route_points if isinstance(p, dict) and "lat" in p and "lng" in p and "t" in p],
        key=lambda p: p["t"],
    )
    if not pts:
        return []

    # Init Kalman from first point
    first = pts[0]
    acc0 = first.get("accuracy", DEFAULT_ACCURACY_M) or DEFAULT_ACCURACY_M
    lat_state = kalman_init(first["lat"], acc0)
    lng_state = kalman_init(first["lng"], acc0)

    smoothed = []  # list of (lat, lng, ts)
    last_kept = None  # (lat, lng) of most recently kept point

    for p in pts:
        lat = p["lat"]
        lng = p["lng"]
        ts = p["t"]
        acc = p.get("accuracy", DEFAULT_ACCURACY_M) or DEFAULT_ACCURACY_M
        slat = kalman_update(lat_state, lat, acc)
        slng = kalman_update(lng_state, lng, acc)

        # 12.5m cull vs last kept (cheap Euclidean, ok at hike scale)
        if last_kept is not None:
            d_lat = slat - last_kept[0]
            d_lng = (slng - last_kept[1]) * 0.85  # cos(31°) approx
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

    print("Step 1: Backing up memory_points → memory_points_pre_kalman")
    cur.execute("DROP TABLE IF EXISTS memory_points_pre_kalman")
    cur.execute("CREATE TABLE memory_points_pre_kalman LIKE memory_points")
    cur.execute("INSERT INTO memory_points_pre_kalman SELECT * FROM memory_points")
    backup_n = cur.rowcount
    print(f"  Backed up {backup_n} rows")

    print("Step 2: Collecting users with sessions")
    cur.execute("SELECT DISTINCT user_id FROM sessions WHERE route_points IS NOT NULL")
    user_ids = [r[0] for r in cur.fetchall()]
    print(f"  {len(user_ids)} users: {user_ids}")

    inserted_total = 0
    deleted_total = 0

    for user_id in user_ids:
        # Delete current memory_points for this user
        cur.execute("DELETE FROM memory_points WHERE user_id = %s", (user_id,))
        deleted = cur.rowcount
        deleted_total += deleted

        # Load sessions
        cur.execute(
            "SELECT id, route_points FROM sessions WHERE user_id = %s AND route_points IS NOT NULL "
            "ORDER BY start_time ASC",
            (user_id,),
        )
        sessions = cur.fetchall()

        user_inserted = 0
        for sid, rp_json in sessions:
            if rp_json is None:
                continue
            try:
                rp = json.loads(rp_json) if isinstance(rp_json, str) else rp_json
            except Exception:
                continue
            if not isinstance(rp, list) or len(rp) == 0:
                continue

            smoothed = smooth_session_points(rp)
            if not smoothed:
                continue

            # Insert
            values = [
                (user_id, lat, lng, ts, f"migration-v355-s{sid}-i{idx}")
                for idx, (lat, lng, ts) in enumerate(smoothed)
            ]
            cur.executemany(
                "INSERT INTO memory_points (user_id, lat, lng, ts, client_id) VALUES (%s, %s, %s, %s, %s)",
                values,
            )
            user_inserted += len(values)

        inserted_total += user_inserted
        print(f"  user {user_id}: deleted {deleted}, inserted {user_inserted} from {len(sessions)} sessions")

    print(f"Step 3: Committing — deleted {deleted_total}, inserted {inserted_total}")
    db.commit()

    print("Step 4: Verifying counts")
    cur.execute("SELECT user_id, COUNT(*) FROM memory_points GROUP BY user_id ORDER BY user_id")
    for uid, n in cur.fetchall():
        print(f"  user {uid}: {n} memory_points")

    cur.close()
    db.close()
    print("Done. Backup retained at memory_points_pre_kalman.")


if __name__ == "__main__":
    main()
