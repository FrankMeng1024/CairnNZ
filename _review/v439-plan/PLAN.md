# v439 Memory Unlock Backend Refactor — Final Plan (locked)

Reviewed 2 rounds. All blockers resolved below. **Ready to implement.**

## Scope

Move memory→region attribution from read-time (ST_Contains on every panel
query, ~1900ms) to write-time (upsert on memory_point insert). Panel API
becomes a simple SELECT on a small table (~ms).

## 1. New table

```sql
CREATE TABLE unlocked_regions (
  user_id      BIGINT UNSIGNED NOT NULL,
  region_id    VARCHAR(32)     NOT NULL,   -- FK-less; references regions.id
  region_level TINYINT         NOT NULL,   -- 2=country, 3=city (denorm)
  parent_id    VARCHAR(32)     NULL,       -- city's country_id (denorm)
  first_unlocked_at BIGINT     NOT NULL,   -- ts of first memory_point in region
  last_visit_ts     BIGINT     NOT NULL,   -- latest point ts, for "recent" sort
  point_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  regions_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,  -- Blocker 4 fix
  PRIMARY KEY (user_id, region_id),
  KEY idx_user_level (user_id, region_level),
  KEY idx_user_parent (user_id, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Regions version tracking (Blocker 4)
CREATE TABLE regions_seed_history (
  version SMALLINT UNSIGNED NOT NULL PRIMARY KEY AUTO_INCREMENT,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT
) ENGINE=InnoDB;
INSERT INTO regions_seed_history (note) VALUES ('v439 initial');
```

**No `marker_count` column** (Blocker 2 fix — panel joins markers table
in real-time; markers are small, cheap).

## 2. attribute helper (Blocker 1 fix)

New file `backend/src/lib/attributeMemoryPoints.js`:

```js
// Upsert unlocked_regions for a batch of memory_points that have already
// been INSERT-ed to memory_points table. Called from BOTH:
//   - sessions.js /save (batch, transaction)
//   - memory.js POST /points (single, transaction)
//
// Idempotent: uses recompute_from_source instead of += so client retries
// don't double-count (Blocker 3 fix).

async function attributeMemoryPoints(conn, userId, tsStart, tsEnd) {
  const currentVersion = await getCurrentRegionsVersion(conn);
  const t0 = Date.now();

  // Find every level=3 region containing any user point in [tsStart, tsEnd]
  const [affectedRegions] = await conn.query(`
    SELECT DISTINCT r.id AS region_id, r.level, r.parent_id
      FROM memory_points mp
      JOIN regions r
        ON r.level = 3
       AND ST_Contains(r.geom, ST_GeomFromText(CONCAT('POINT(', mp.lng, ' ', mp.lat, ')'), 4326, 'axis-order=long-lat'))
     WHERE mp.user_id = ? AND mp.ts BETWEEN ? AND ?
  `, [userId, tsStart, tsEnd]);

  console.log(`[attribute] user=${userId} affected_regions_l3=${affectedRegions.length} ts=${tsStart}..${tsEnd}`);

  const parentCountryIds = new Set(affectedRegions.map(r => r.parent_id).filter(Boolean));

  // For each affected region, RECOMPUTE point_count from source (not +=)
  for (const r of affectedRegions) {
    const [[{ cnt }]] = await conn.query(`
      SELECT COUNT(*) AS cnt FROM memory_points mp
       WHERE mp.user_id = ?
         AND ST_Contains(
           (SELECT geom FROM regions WHERE id = ?),
           ST_GeomFromText(CONCAT('POINT(', mp.lng, ' ', mp.lat, ')'), 4326, 'axis-order=long-lat')
         )
    `, [userId, r.region_id]);

    const [[tsRange]] = await conn.query(`
      SELECT MIN(mp.ts) AS min_ts, MAX(mp.ts) AS max_ts FROM memory_points mp
       WHERE mp.user_id = ?
         AND ST_Contains(
           (SELECT geom FROM regions WHERE id = ?),
           ST_GeomFromText(CONCAT('POINT(', mp.lng, ' ', mp.lat, ')'), 4326, 'axis-order=long-lat')
         )
    `, [userId, r.region_id]);

    await conn.query(`
      INSERT INTO unlocked_regions
        (user_id, region_id, region_level, parent_id, first_unlocked_at, last_visit_ts, point_count, regions_version)
      VALUES (?, ?, 3, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        last_visit_ts   = GREATEST(last_visit_ts, VALUES(last_visit_ts)),
        point_count     = VALUES(point_count)
    `, [userId, r.region_id, r.parent_id, tsRange.min_ts, tsRange.max_ts, cnt, currentVersion]);
  }

  // Same for level=2 (countries)
  for (const countryId of parentCountryIds) {
    // ... same pattern
  }

  console.log(`[attribute] DONE user=${userId} regions=${affectedRegions.length} country=${parentCountryIds.size} dur_ms=${Date.now() - t0}`);
}
```

Log every branch (per feedback_100pct_log_coverage rule).

## 3. Call sites (Blocker 1 fix)

### 3a. `sessions.js` `/save` — hike batch write
After batch INSERT memory_points, same transaction:
```js
const minTs = Math.min(...batch.map(p => p.ts));
const maxTs = Math.max(...batch.map(p => p.ts));
await attributeMemoryPoints(conn, userId, minTs, maxTs);
```

### 3b. `memory.js` `POST /points` — single-point write
Same after INSERT:
```js
await attributeMemoryPoints(conn, userId, point.ts, point.ts);
```

Both go through the SAME helper. sim-walker's addTrackPoint (if it ever
becomes a real user path) automatically covered.

## 4. Panel API rewrite

`hierarchy.js` `/panel`:
```js
// World layer
const [rows] = await pool.query(`
  SELECT ur.region_id AS id, r.name_en, r.bbox_min_lng, ...,
         ur.point_count,
         EXISTS (SELECT 1 FROM markers m WHERE m.user_id=? AND ST_Contains(r.geom, POINT(m.lng, m.lat))) AS has_marker
    FROM unlocked_regions ur
    JOIN regions r ON r.id = ur.region_id
   WHERE ur.user_id = ? AND ur.region_level = 2
`, [userId, userId]);

// state = has_marker ? 'marked' : 'walked'  (Blocker 2: markers live join)
```

Country layer same, filter by `parent_id = titleId`.

Expected latency: **10-30ms** vs current 1900ms.

## 5. Backfill

Deploy order (critical):

1. Deploy new sessions.js + memory.js (double-write ON, panel API still
   uses ST_Contains fallback)
2. Verify: new /save writes to unlocked_regions correctly (log check)
3. Run backfill script:
   ```sql
   INSERT INTO unlocked_regions
     (user_id, region_id, region_level, parent_id, first_unlocked_at,
      last_visit_ts, point_count, regions_version)
   SELECT
     mp.user_id, r.id, r.level, r.parent_id,
     MIN(mp.ts), MAX(mp.ts), COUNT(*), 1
     FROM memory_points mp
     JOIN regions r ON r.level IN (2, 3)
                    AND ST_Contains(r.geom, POINT(mp.lng, mp.lat))
    GROUP BY mp.user_id, r.id
   ON DUPLICATE KEY UPDATE point_count = VALUES(point_count);
   ```
4. Diff verify: for 3 test users compute `computeUserAttribution` and
   compare to `unlocked_regions` — should match 100%. Log mismatches.
5. Switch panel API to read unlocked_regions
6. Keep old ST_Contains code as feature flag `USE_UNLOCKED_REGIONS=true`
   for 1 week rollback path
7. After 1 week stable: delete old code

## 6. Client fixes for 3 immediate bugs

### Bug 1 (mystery Caojiadu circle)
- Backfill will NOT re-attribute since point 11864 already deleted
- Client cache: bump `PANEL_CACHE_VERSION` v4→v5 to force refresh

### Bug 2 (fly to Shenzhen, Shanghai stays green)
- Client tap city → **send `city_id` directly** in `/panel?title_id=CHN&here_city_id=CN-shenzhen`
- Don't wait for cameraCenterRef to update + deepest cache to expire
- MemoryScreen.onSelectItem: when itemType='city', immediately setHierarchyCurrentCityId(itemId) BEFORE refetch panel

### Bug 3 (loading 1900ms → ms)
- Automatic: new panel API is fast

## 7. Log coverage 100%

Per `feedback_100pct_log_coverage` memory:
- Every branch in attributeMemoryPoints logs
- Every path in panel API logs (IN/ATTR/OUT/ERR + duration_ms)
- Every backfill step logs count + duration
- Diff verify script logs any mismatch

Subagent will review before OTA.

## 8. Rollback path

- Table drop: `DROP TABLE unlocked_regions, regions_seed_history`
- Code revert: git revert to v438
- Backend restart: docker cp + restart cairn-backend
- Client: EAS revert OTA to v438

Total rollback ~2 minutes.

## 9. Risks & mitigation

1. **regions_seed_history vs unlocked_regions.regions_version drift**
   → if regions.geom changes, bump version. unlocked_regions rows keep
     their old version. Next attribute call gets currentVersion; rows may
     mix versions but first_unlocked_at is stable (min).
   → Mitigation: for v439 init, everything = version 1. Version bump only
     when regions data source refreshes.

2. **Backfill 2279 pts × 2 (points + markers) × ~5ms = ~25s**. Acceptable.

3. **Sim-walker (dev) writing test data → contaminating unlocked_regions**
   → sim-walker already goes through addTrackPoint which doesn't hit
     memory_points directly (v437.1 fix). Safe.

4. **markers.js JOIN in panel API**: for 100 markers per user, EXPLAIN
   should show idx_user_id + spatial index → &lt;10ms. Acceptable up to
   ~10k markers/user which is far future.

## 10. OTA_VERSION 438 → 439
