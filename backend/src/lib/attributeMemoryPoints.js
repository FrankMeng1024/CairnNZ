/**
 * attributeMemoryPoints — v439
 *
 * Upsert unlocked_regions for a batch of memory_points that have already
 * been INSERT-ed to memory_points table. Called from BOTH:
 *   - sessions.js /save (batch, transaction)
 *   - memory.js POST /points (single, transaction)
 *
 * Idempotent: recomputes point_count from source. Client retries won't
 * double-count.
 *
 * All code paths logged per 100%-coverage rule.
 */

const CURRENT_REGIONS_VERSION = 1;

/**
 * Attribute memory_points inserted for `userId` between `tsStart` and `tsEnd`
 * (inclusive) to their level=3 city + level=2 country regions.
 *
 * @param {import('mysql2/promise').Connection|import('mysql2/promise').Pool} conn
 * @param {number} userId
 * @param {number} tsStart
 * @param {number} tsEnd
 */
async function attributeMemoryPoints(conn, userId, tsStart, tsEnd) {
  const t0 = Date.now();
  console.log(`[attribute] IN user=${userId} ts_range=${tsStart}..${tsEnd}`);

  // 1. Find every level=3 region containing any point of this user in the window.
  const [affectedCities] = await conn.query(
    `SELECT DISTINCT r.id AS region_id, r.parent_id
       FROM memory_points mp
       JOIN regions r
         ON r.level = 3
        AND ST_Contains(r.geom, ST_GeomFromText(CONCAT('POINT(', mp.lng, ' ', mp.lat, ')'), 4326, 'axis-order=long-lat'))
      WHERE mp.user_id = ? AND mp.ts BETWEEN ? AND ?`,
    [userId, tsStart, tsEnd]
  );

  console.log(`[attribute] user=${userId} affected_l3=${affectedCities.length}`);

  if (affectedCities.length === 0) {
    console.log(`[attribute] NO_L3_HIT user=${userId} dur_ms=${Date.now() - t0}`);
    return { cities: 0, countries: 0 };
  }

  const parentCountryIds = new Set(
    affectedCities.map((r) => r.parent_id).filter(Boolean)
  );

  // 2. For each affected city, RECOMPUTE point_count from all user's points
  //    (not just this batch) → idempotent across client retries.
  let cityUpsertCount = 0;
  for (const r of affectedCities) {
    const [[stats]] = await conn.query(
      `SELECT COUNT(*) AS cnt, MIN(mp.ts) AS min_ts, MAX(mp.ts) AS max_ts
         FROM memory_points mp
         JOIN regions r ON r.id = ?
        WHERE mp.user_id = ?
          AND ST_Contains(r.geom, ST_GeomFromText(CONCAT('POINT(', mp.lng, ' ', mp.lat, ')'), 4326, 'axis-order=long-lat'))`,
      [r.region_id, userId]
    );
    if (stats.cnt === 0) {
      // No points found (unlikely since region hit above); skip.
      console.warn(`[attribute] ZERO_COUNT_AFTER_HIT user=${userId} region=${r.region_id}`);
      continue;
    }
    await conn.query(
      `INSERT INTO unlocked_regions
        (user_id, region_id, region_level, parent_id, first_unlocked_at, last_visit_ts, point_count, regions_version)
       VALUES (?, ?, 3, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         first_unlocked_at = LEAST(first_unlocked_at, VALUES(first_unlocked_at)),
         last_visit_ts     = GREATEST(last_visit_ts, VALUES(last_visit_ts)),
         point_count       = VALUES(point_count)`,
      [userId, r.region_id, r.parent_id, stats.min_ts, stats.max_ts, stats.cnt, CURRENT_REGIONS_VERSION]
    );
    cityUpsertCount += 1;
    console.log(`[attribute] CITY_UPSERT user=${userId} region=${r.region_id} count=${stats.cnt} first=${stats.min_ts} last=${stats.max_ts}`);
  }

  // 3. For each affected country, recompute from all its cities (idempotent).
  let countryUpsertCount = 0;
  for (const countryId of parentCountryIds) {
    const [[cAgg]] = await conn.query(
      `SELECT SUM(point_count) AS cnt,
              MIN(first_unlocked_at) AS min_ts,
              MAX(last_visit_ts) AS max_ts
         FROM unlocked_regions
        WHERE user_id = ? AND region_level = 3 AND parent_id = ?`,
      [userId, countryId]
    );
    if (!cAgg.cnt || cAgg.cnt <= 0) {
      console.warn(`[attribute] COUNTRY_ZERO_AGG user=${userId} country=${countryId}`);
      continue;
    }
    await conn.query(
      `INSERT INTO unlocked_regions
        (user_id, region_id, region_level, parent_id, first_unlocked_at, last_visit_ts, point_count, regions_version)
       VALUES (?, ?, 2, 'world', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         first_unlocked_at = LEAST(first_unlocked_at, VALUES(first_unlocked_at)),
         last_visit_ts     = GREATEST(last_visit_ts, VALUES(last_visit_ts)),
         point_count       = VALUES(point_count)`,
      [userId, countryId, cAgg.min_ts, cAgg.max_ts, cAgg.cnt, CURRENT_REGIONS_VERSION]
    );
    countryUpsertCount += 1;
    console.log(`[attribute] COUNTRY_UPSERT user=${userId} country=${countryId} count=${cAgg.cnt}`);
  }

  console.log(`[attribute] OUT user=${userId} cities=${cityUpsertCount} countries=${countryUpsertCount} dur_ms=${Date.now() - t0}`);
  return { cities: cityUpsertCount, countries: countryUpsertCount };
}

module.exports = { attributeMemoryPoints, CURRENT_REGIONS_VERSION };
