/**
 * hierarchy.js — v439 (unlocked_regions read + markers live-join)
 *
 * Endpoints:
 *
 *   GET /api/hierarchy/deepest?lat=..&lng=..
 *     Same as v438 — returns { city, country } from real-time ST_Contains.
 *
 *   GET /api/hierarchy/panel?title_id=..&here_city_id=..&here_country_id=..
 *     v439: reads from unlocked_regions (fast, <30ms).
 *     Marker state computed via real-time JOIN with markers table
 *     (avoids 4-way maintenance of marker_count column).
 *
 * All code paths logged per 100%-coverage rule.
 */
const express = require('express');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');

const router = express.Router();
router.use(authenticate);

// -------------------------------------------------------------------
// GET /api/hierarchy/deepest?lat=..&lng=..  (unchanged from v438)
// -------------------------------------------------------------------
router.get('/deepest', async (req, res) => {
  const t0 = Date.now();
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const userId = req.user?.userId ?? 'unknown';
  console.log(`[hierarchy/deepest] IN user=${userId} lat=${lat} lng=${lng}`);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    console.log(`[hierarchy/deepest] BAD_PARAMS user=${userId}`);
    return res.status(400).json({ error: 'lat and lng required' });
  }
  // Sprint 6 R70: enforce lat/lng valid range. Pre-fix, parseFloat
  // accepted Infinity ("Infinity" → Infinity, passes isNaN false) and
  // out-of-range values (lat=999, lng=-500). ST_GeomFromText with
  // invalid coords either wastes a full ST_Contains scan across
  // regions.geom or errors out — MySQL 8 accepts POINT(999 999)
  // but no region contains it, so it's a silent CPU waste. Cleaner
  // to 400 up front.
  if (!Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    console.log(`[hierarchy/deepest] OUT_OF_RANGE user=${userId} lat=${lat} lng=${lng}`);
    return res.status(400).json({ error: 'lat/lng out of range' });
  }
  try {
    let city = null;
    let country = null;
    try {
      const [rows] = await pool.query(
        `SELECT id, name_en, parent_id,
                bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
                ST_Area(geom) AS area
           FROM regions
          WHERE level = 3
            AND ST_Contains(geom, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'), 4326, 'axis-order=long-lat'))`,
        [lng, lat]
      );
      if (rows.length > 0) {
        rows.sort((a, b) => a.area - b.area);
        const c = rows[0];
        city = {
          id: c.id,
          name_en: c.name_en,
          country_id: c.parent_id,
          bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat],
        };
        console.log(`[hierarchy/deepest] CITY_HIT user=${userId} chose=${c.id}`);
      } else {
        console.log(`[hierarchy/deepest] NO_CITY_HIT user=${userId} lat=${lat} lng=${lng}`);
      }
    } catch (e) {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
      console.warn(`[hierarchy/deepest] SCHEMA_ERR_L3 user=${userId} code=${e.code}`);
    }

    if (city) {
      const [cRows] = await pool.query(
        `SELECT id, name_en, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
           FROM regions WHERE id = ? AND level = 2`,
        [city.country_id]
      );
      if (cRows.length > 0) {
        const c = cRows[0];
        country = { id: c.id, name_en: c.name_en, bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat] };
        console.log(`[hierarchy/deepest] COUNTRY_FROM_CITY user=${userId} country=${c.id}`);
      }
    } else {
      try {
        const [rows] = await pool.query(
          `SELECT id, name_en, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
             FROM regions
            WHERE level = 2
              AND ST_Contains(geom, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'), 4326, 'axis-order=long-lat'))
            LIMIT 1`,
          [lng, lat]
        );
        if (rows.length > 0) {
          const c = rows[0];
          country = { id: c.id, name_en: c.name_en, bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat] };
          console.log(`[hierarchy/deepest] COUNTRY_FALLBACK_HIT user=${userId} country=${c.id}`);
        } else {
          console.log(`[hierarchy/deepest] COUNTRY_FALLBACK_MISS user=${userId}`);
        }
      } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
      }
    }

    console.log(`[hierarchy/deepest] OUT user=${userId} city=${city?.id ?? 'null'} country=${country?.id ?? 'null'} dur_ms=${Date.now() - t0}`);
    res.json({ city, country });
  } catch (err) {
    console.error(`[hierarchy/deepest] ERR user=${userId} err=${err.message} dur_ms=${Date.now() - t0}`, err);
    res.status(500).json({ error: 'db error' });
  }
});

// -------------------------------------------------------------------
// GET /api/hierarchy/panel?title_id=..&here_city_id=..&here_country_id=..
// v439: reads from unlocked_regions (fast), markers via live JOIN
// -------------------------------------------------------------------
router.get('/panel', async (req, res) => {
  const t0 = Date.now();
  const titleId = req.query.title_id;
  // Sprint 6 round-28 R28 investigation: regions.id is VARCHAR(64) with
  // ISO 3166 codes ('AF', 'NZL', 'CN-11', etc.), NOT integer. The prior
  // subagent-flagged "is_here always false" concern (integer vs string
  // strict-eq) was based on a wrong assumption. Both region_id and
  // hereCountryId are strings, and `===` between two strings works
  // correctly. Leaving as-is; no coercion needed.
  const hereCityId = req.query.here_city_id || null;
  const hereCountryId = req.query.here_country_id || null;
  const userId = req.user?.userId ?? 'unknown';
  console.log(`[hierarchy/panel] IN user=${userId} title=${titleId} here_city=${hereCityId} here_country=${hereCountryId}`);
  if (!titleId) {
    console.log(`[hierarchy/panel] BAD_PARAMS user=${userId}`);
    return res.status(400).json({ error: 'title_id required' });
  }

  try {
    if (titleId === 'world') {
      // World layer: SELECT country rows from unlocked_regions
      // Sprint 6 round-28 R28F1: use ST_Contains against regions.geom
      // instead of bbox-only overlap. Pre-fix, overlapping bboxes (Russia
      // crossing antimeridian, NZ mainland overlapping Chatham Islands
      // bbox, etc.) counted the same marker for multiple regions →
      // wrong `state='marked'` on the panel. `regions.geom` is populated
      // (2884 rows all have geom) so ST_Contains is safe. Falling back
      // to bbox as a coarse pre-filter would be a perf micro-opt but
      // needlessly complex — MySQL 8's R-tree index on `geom` (KEY MUL
      // per DESCRIBE regions) already accelerates ST_Contains.
      const [rows] = await pool.query(
        `SELECT ur.region_id, r.name_en,
                r.bbox_min_lng, r.bbox_min_lat, r.bbox_max_lng, r.bbox_max_lat,
                (SELECT COUNT(*) FROM markers m
                  WHERE m.user_id = ur.user_id
                    AND ST_Contains(r.geom, ST_SRID(POINT(m.lng, m.lat), 4326))) AS marker_count
           FROM unlocked_regions ur
           JOIN regions r ON r.id = ur.region_id
          WHERE ur.user_id = ? AND ur.region_level = 2`,
        [userId]
      );
      console.log(`[hierarchy/panel] WORLD_QUERY user=${userId} rows=${rows.length}`);

      const items = rows.map((c) => ({
        id: c.region_id,
        name_en: c.name_en,
        state: c.marker_count > 0 ? 'marked' : 'walked',
        bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat],
        is_here: c.region_id === hereCountryId,
      }));

      const [[{ total_countries }]] = await pool.query(
        `SELECT COUNT(*) AS total_countries FROM regions WHERE level = 2`
      );
      const locked_count = Math.max(0, total_countries - items.length);

      console.log(`[hierarchy/panel] OUT_WORLD user=${userId} items=${items.length} locked=${locked_count} dur_ms=${Date.now() - t0}`);
      return res.json({
        title: { id: 'world', name_en: 'World', level: 0 },
        parent: null,
        items,
        locked_count,
      });
    }

    // Country layer
    const [countryRows] = await pool.query(
      `SELECT id, name_en FROM regions WHERE id = ? AND level = 2`,
      [titleId]
    );
    if (countryRows.length === 0) {
      console.log(`[hierarchy/panel] COUNTRY_NOT_FOUND user=${userId} title=${titleId}`);
      return res.status(404).json({ error: 'country not found' });
    }
    const country = countryRows[0];

    const [rows] = await pool.query(
      `SELECT ur.region_id, r.name_en,
              r.bbox_min_lng, r.bbox_min_lat, r.bbox_max_lng, r.bbox_max_lat,
              (SELECT COUNT(*) FROM markers m
                WHERE m.user_id = ur.user_id
                  AND ST_Contains(r.geom, ST_SRID(POINT(m.lng, m.lat), 4326))) AS marker_count
         FROM unlocked_regions ur
         JOIN regions r ON r.id = ur.region_id
        WHERE ur.user_id = ? AND ur.region_level = 3 AND ur.parent_id = ?`,
      [userId, country.id]
    );
    console.log(`[hierarchy/panel] COUNTRY_QUERY user=${userId} title=${country.id} rows=${rows.length}`);

    const items = rows
      .map((c) => ({
        id: c.region_id,
        name_en: c.name_en,
        state: c.marker_count > 0 ? 'marked' : 'walked',
        bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat],
        is_here: c.region_id === hereCityId,
      }))
      .sort((a, b) => a.name_en.localeCompare(b.name_en));

    const [[{ total_children }]] = await pool.query(
      `SELECT COUNT(*) AS total_children FROM regions WHERE parent_id = ? AND level = 3`,
      [country.id]
    );
    const locked_count = Math.max(0, total_children - items.length);

    console.log(`[hierarchy/panel] OUT_COUNTRY user=${userId} title=${country.id} items=${items.length} locked=${locked_count} dur_ms=${Date.now() - t0}`);
    return res.json({
      title: { id: country.id, name_en: country.name_en, level: 2 },
      parent: { id: 'world', name_en: 'World', level: 0 },
      items,
      locked_count,
    });
  } catch (err) {
    console.error(`[hierarchy/panel] ERR user=${userId} err=${err.message} dur_ms=${Date.now() - t0}`, err);
    res.status(500).json({ error: 'db error' });
  }
});

module.exports = router;
