-- v439 memory unlock refactor
-- Creates unlocked_regions + regions_seed_history + backfill from memory_points.
-- Idempotent (safe to re-run).

-- ============================================================
-- 1. Regions version tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS regions_seed_history (
  version SMALLINT UNSIGNED NOT NULL PRIMARY KEY AUTO_INCREMENT,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO regions_seed_history (version, note)
  VALUES (1, 'v439 initial: geoBoundaries ADM0 + manual v434 Malaysia + China cities');

-- ============================================================
-- 2. unlocked_regions
-- ============================================================
CREATE TABLE IF NOT EXISTS unlocked_regions (
  user_id           BIGINT UNSIGNED NOT NULL,
  region_id         VARCHAR(32)     NOT NULL,
  region_level      TINYINT         NOT NULL,
  parent_id         VARCHAR(32)     NULL,
  first_unlocked_at BIGINT          NOT NULL,
  last_visit_ts     BIGINT          NOT NULL,
  point_count       INT UNSIGNED    NOT NULL DEFAULT 0,
  regions_version   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, region_id),
  KEY idx_user_level (user_id, region_level),
  KEY idx_user_parent (user_id, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 3. Backfill from existing memory_points
-- Uses ST_Contains + smallest-area tie-break (matches computeUserAttribution).
-- For each memory_point, find the DEEPEST (smallest area) level-3 region
-- containing it → that's the point's home city. Aggregate per user+region.
-- ============================================================
INSERT INTO unlocked_regions
  (user_id, region_id, region_level, parent_id, first_unlocked_at, last_visit_ts, point_count, regions_version)
SELECT
  t.user_id, t.region_id, r.level, r.parent_id,
  MIN(t.ts) AS first_unlocked_at,
  MAX(t.ts) AS last_visit_ts,
  COUNT(*)  AS point_count,
  1         AS regions_version
FROM (
  SELECT mp.user_id, mp.ts,
    (SELECT r2.id
       FROM regions r2
      WHERE r2.level = 3
        AND ST_Contains(r2.geom,
              ST_GeomFromText(CONCAT('POINT(', mp.lng, ' ', mp.lat, ')'),
                              4326, 'axis-order=long-lat'))
      ORDER BY ST_Area(r2.geom) ASC
      LIMIT 1) AS region_id
    FROM memory_points mp
) t
JOIN regions r ON r.id = t.region_id
WHERE t.region_id IS NOT NULL
GROUP BY t.user_id, t.region_id, r.level, r.parent_id
ON DUPLICATE KEY UPDATE
  point_count = VALUES(point_count),
  last_visit_ts = VALUES(last_visit_ts);

-- ============================================================
-- 4. Also backfill level=2 (country) rows so world panel is fast
-- ============================================================
INSERT INTO unlocked_regions
  (user_id, region_id, region_level, parent_id, first_unlocked_at, last_visit_ts, point_count, regions_version)
SELECT
  ur.user_id, ur.parent_id, 2, 'world',
  MIN(ur.first_unlocked_at),
  MAX(ur.last_visit_ts),
  SUM(ur.point_count),
  1
FROM unlocked_regions ur
WHERE ur.region_level = 3 AND ur.parent_id IS NOT NULL
GROUP BY ur.user_id, ur.parent_id
ON DUPLICATE KEY UPDATE
  point_count = VALUES(point_count),
  last_visit_ts = VALUES(last_visit_ts);

-- ============================================================
-- 5. Verify
-- ============================================================
SELECT 'unlocked_regions total' AS metric, COUNT(*) AS value FROM unlocked_regions
UNION ALL
SELECT 'countries', COUNT(*) FROM unlocked_regions WHERE region_level=2
UNION ALL
SELECT 'cities', COUNT(*) FROM unlocked_regions WHERE region_level=3
UNION ALL
SELECT 'distinct_users', COUNT(DISTINCT user_id) FROM unlocked_regions;
