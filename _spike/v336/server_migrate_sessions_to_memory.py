"""Server-side migration: extract every GPS point from
sessions.route_points (user_id=4), insert into memory_points.

Runs ONCE on the server. Equivalent to what flushHikingToMemory does on
the client (which calls bulkImportSync → write cells → AsyncStorage
persist → eventually push to memory_points table via memorySync).

By inserting directly into memory_points table, the next pullMemoryFromServer
on the client side will pull these points, hydrate the H3 store, and the
fog will reveal the hike paths. Production sessions still write via the
client-side transaction in stopTracking — this script handles only the
backfill of test data that was created before the v333 transaction shipped.
"""
import json
import pymysql
import sys

# DB config (matches docker exec ainews-db env)
DB = pymysql.connect(
    host='127.0.0.1',
    port=3306,
    user='root',
    password='Mzm920313@950824',
    database='cairn',
    charset='utf8mb4',
)

USER_ID = 4  # FrankMeng

cur = DB.cursor()

# Pull every session with route_points for user 4
cur.execute("""
    SELECT id, route_points
    FROM sessions
    WHERE user_id = %s AND route_points IS NOT NULL
    ORDER BY id
""", (USER_ID,))
rows = cur.fetchall()
print(f'sessions to migrate: {len(rows)}', file=sys.stderr)

inserted = 0
skipped_invalid = 0
skipped_dup_cell = 0

# Track which (lat-bucket, lng-bucket) we already inserted to avoid
# duplicates across sessions overlapping the same cell. Bucket size
# ~25m at 31°N (1e-4 deg ≈ 11m so use 2e-4 ≈ 22m).
seen_buckets = set()

for session_id, route_points_json in rows:
    if not route_points_json:
        continue
    try:
        pts = json.loads(route_points_json) if isinstance(route_points_json, (str, bytes)) else route_points_json
    except Exception as e:
        print(f'session {session_id}: bad JSON: {e}', file=sys.stderr)
        continue
    if not isinstance(pts, list):
        continue
    print(f'session {session_id}: {len(pts)} raw points', file=sys.stderr)
    for idx, p in enumerate(pts):
        if not isinstance(p, dict):
            skipped_invalid += 1
            continue
        lat = p.get('lat')
        lng = p.get('lng')
        t = p.get('t')
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            skipped_invalid += 1
            continue
        # Bucket dedup
        bucket = (round(lat / 2e-4), round(lng / 2e-4))
        if bucket in seen_buckets:
            skipped_dup_cell += 1
            continue
        seen_buckets.add(bucket)
        # ts: prefer p.t (epoch ms), else use index
        ts = int(t) if isinstance(t, (int, float)) else (1781800000000 + session_id * 1000 + idx)
        client_id = f'migration-s{session_id}-i{idx}'[:36]
        try:
            cur.execute("""
                INSERT INTO memory_points (user_id, lat, lng, ts, client_id)
                VALUES (%s, %s, %s, %s, %s)
            """, (USER_ID, lat, lng, ts, client_id))
            inserted += 1
        except pymysql.err.IntegrityError as e:
            # client_id is unique? we don't expect dup, but be safe
            print(f'session {session_id} idx {idx}: integrity {e}', file=sys.stderr)

DB.commit()
print(f'\n=== DONE: inserted {inserted}, skipped_invalid {skipped_invalid}, skipped_dup_cell {skipped_dup_cell}', file=sys.stderr)

# Verify
cur.execute('SELECT COUNT(*) FROM memory_points WHERE user_id=%s', (USER_ID,))
print(f'memory_points total for user {USER_ID}: {cur.fetchone()[0]}', file=sys.stderr)
DB.close()
