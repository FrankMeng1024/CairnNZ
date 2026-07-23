#!/usr/bin/env node
/**
 * v439 backfill script — populate unlocked_regions from memory_points.
 *
 * Uses one-point-at-a-time ST_Contains queries with LITERAL point coords,
 * which forces MySQL to use idx_geom (SPATIAL INDEX) → ~5ms per point.
 * The correlated-subquery approach in the SQL migration file was 12+ min
 * because MySQL couldn't use the index on dynamic point per row.
 *
 * Total expected time: 2279 memory_points * 5ms = ~11 seconds.
 */

const mysql = require('mysql2/promise');

const DB_HOST = process.env.DB_HOST || 'host.docker.internal';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'Mzm920313@950824';
const DB_NAME = process.env.DB_NAME || 'cairn';

async function main() {
  const pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    connectionLimit: 5,
  });

  console.log('[backfill] START');
  const t0 = Date.now();

  // 1. Ensure schema exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS regions_seed_history (
      version SMALLINT UNSIGNED NOT NULL PRIMARY KEY AUTO_INCREMENT,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      note TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    INSERT IGNORE INTO regions_seed_history (version, note)
      VALUES (1, 'v439 initial')
  `);
  await pool.query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('[backfill] schema ensured');

  // 2. Fetch all users with memory_points
  const [users] = await pool.query(`
    SELECT DISTINCT user_id FROM memory_points ORDER BY user_id
  `);
  console.log(`[backfill] users_with_points=${users.length}`);

  let totalPoints = 0;
  let totalRegions = 0;

  for (const { user_id } of users) {
    const tUser = Date.now();
    const [points] = await pool.query(
      'SELECT id, ts, lat, lng FROM memory_points WHERE user_id = ? ORDER BY ts',
      [user_id]
    );
    totalPoints += points.length;
    console.log(`[backfill] user=${user_id} points=${points.length}`);

    // Per user: build a Map region_id → { level, parent_id, first_ts, last_ts, count }
    const perRegion = new Map();
    // lat/lng cache (4-decimal round) to speed up clustered GPS
    const spatialCache = new Map();
    let cacheHits = 0;
    let cacheMisses = 0;
    let missNoRegion = 0;

    for (const p of points) {
      const key = `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`;
      let best = spatialCache.get(key);
      if (best === undefined) {
        cacheMisses += 1;
        const [rows] = await pool.query(
          `SELECT id, parent_id, level, ST_Area(geom) AS area
             FROM regions
            WHERE level = 3
              AND ST_Contains(geom, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'), 4326, 'axis-order=long-lat'))
            ORDER BY ST_Area(geom) ASC
            LIMIT 1`,
          [p.lng, p.lat]
        );
        best = rows[0] || null;
        spatialCache.set(key, best);
      } else {
        cacheHits += 1;
      }
      if (!best) {
        missNoRegion += 1;
        continue;
      }
      const cur = perRegion.get(best.id) || {
        level: best.level, parent_id: best.parent_id,
        first_ts: p.ts, last_ts: p.ts, count: 0,
      };
      if (p.ts < cur.first_ts) cur.first_ts = p.ts;
      if (p.ts > cur.last_ts) cur.last_ts = p.ts;
      cur.count += 1;
      perRegion.set(best.id, cur);
    }

    console.log(`[backfill] user=${user_id} regions_hit=${perRegion.size} miss_no_region=${missNoRegion} cache_hits=${cacheHits} cache_misses=${cacheMisses} dur_ms=${Date.now() - tUser}`);

    // 3. Upsert city rows (level=3) + build country aggregation
    const countryAgg = new Map();
    for (const [region_id, r] of perRegion) {
      await pool.query(
        `INSERT INTO unlocked_regions
           (user_id, region_id, region_level, parent_id, first_unlocked_at, last_visit_ts, point_count, regions_version)
         VALUES (?, ?, 3, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           first_unlocked_at = LEAST(first_unlocked_at, VALUES(first_unlocked_at)),
           last_visit_ts = GREATEST(last_visit_ts, VALUES(last_visit_ts)),
           point_count = VALUES(point_count)`,
        [user_id, region_id, r.parent_id, r.first_ts, r.last_ts, r.count]
      );
      totalRegions += 1;

      // Country aggregation
      if (r.parent_id) {
        const cAgg = countryAgg.get(r.parent_id) || { first_ts: r.first_ts, last_ts: r.last_ts, count: 0 };
        if (r.first_ts < cAgg.first_ts) cAgg.first_ts = r.first_ts;
        if (r.last_ts > cAgg.last_ts) cAgg.last_ts = r.last_ts;
        cAgg.count += r.count;
        countryAgg.set(r.parent_id, cAgg);
      }
    }

    // 4. Upsert country rows (level=2)
    for (const [country_id, agg] of countryAgg) {
      await pool.query(
        `INSERT INTO unlocked_regions
           (user_id, region_id, region_level, parent_id, first_unlocked_at, last_visit_ts, point_count, regions_version)
         VALUES (?, ?, 2, 'world', ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           first_unlocked_at = LEAST(first_unlocked_at, VALUES(first_unlocked_at)),
           last_visit_ts = GREATEST(last_visit_ts, VALUES(last_visit_ts)),
           point_count = VALUES(point_count)`,
        [user_id, country_id, agg.first_ts, agg.last_ts, agg.count]
      );
      totalRegions += 1;
    }
  }

  console.log(`[backfill] DONE users=${users.length} total_points=${totalPoints} total_region_rows=${totalRegions} total_ms=${Date.now() - t0}`);

  // Final counts
  const [rows] = await pool.query(`
    SELECT region_level, COUNT(*) AS n FROM unlocked_regions GROUP BY region_level
  `);
  console.log('[backfill] final counts:', rows);
  const [[{ total_users }]] = await pool.query(
    'SELECT COUNT(DISTINCT user_id) AS total_users FROM unlocked_regions'
  );
  console.log(`[backfill] distinct users=${total_users}`);

  await pool.end();
}

main().catch((err) => {
  console.error('[backfill] FATAL', err);
  process.exit(1);
});
