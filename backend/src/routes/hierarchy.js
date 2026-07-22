/**
 * hierarchy.js — v434 (2-layer tree: World → Country → City)
 *
 * Endpoints:
 *
 *   GET /api/hierarchy/deepest?lat=..&lng=..
 *     Find deepest region containing the point. Returns:
 *     {
 *       city:    { id, name_en, bbox, country_id } | null,
 *       country: { id, name_en, bbox } | null,
 *     }
 *     - city = level-3 region whose geom contains (lat,lng), or null.
 *     - country = level-2 region containing the city, or null if no city.
 *     - Both null iff point is in open ocean.
 *
 *   GET /api/hierarchy/panel?title_id=..&here_city_id=..&here_country_id=..
 *     Returns the panel data. Contract:
 *     {
 *       title:  { id, name_en, level },        // level 0 (world) or 2 (country)
 *       parent: { id, name_en, level } | null, // null when title=world
 *       items:  [
 *         { id, name_en, state: 'marked'|'walked', bbox, is_here }
 *       ],
 *       locked_count: N
 *     }
 *     - title_id = 'world' → items = countries user visited; parent=null.
 *     - title_id = country id → items = level-3 children (cities/provinces)
 *       user visited under that country; parent = world.
 *     - is_here computed on server from here_city_id (country layer) or
 *       here_country_id (world layer).
 *     - locked_count = children of title NOT visited (attribution via bbox
 *       point-in-polygon on memory_points + markers).
 *
 * v434 changes:
 *   - Drop drill/continent/admin1-highlight logic
 *   - Delete /polygon endpoint (already gone in v433)
 *   - 2-layer only (level 0 and 2 for tree navigation; level 3 as children)
 *   - Never use 'continent' (level 1) rows in panel/deepest output
 */
const express = require('express');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');

const router = express.Router();
router.use(authenticate);

// -------------------------------------------------------------------
// GET /api/hierarchy/deepest?lat=..&lng=..
// -------------------------------------------------------------------
router.get('/deepest', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng required' });
  }
  try {
    // 1. Try to match a level-3 city/province via ST_Contains.
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
        // Prefer smallest-area match (handles enclaves like Shanghai vs Jiangsu,
        // or Suzhou (new v434) vs Jiangsu).
        rows.sort((a, b) => a.area - b.area);
        const c = rows[0];
        city = {
          id: c.id,
          name_en: c.name_en,
          country_id: c.parent_id,
          bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat],
        };
      }
    } catch (e) {
      // Column missing or spatial error — treat as "no city match".
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    }

    // 2. Find the country (level=2). Prefer city.parent_id if we have one,
    //    otherwise ST_Contains on level=2.
    if (city) {
      const [cRows] = await pool.query(
        `SELECT id, name_en, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
           FROM regions WHERE id = ? AND level = 2`,
        [city.country_id]
      );
      if (cRows.length > 0) {
        const c = cRows[0];
        country = { id: c.id, name_en: c.name_en, bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat] };
      }
    } else {
      // No city match — try country-level ST_Contains directly.
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
        }
      } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
      }
    }

    res.json({ city, country });
  } catch (err) {
    console.error('[hierarchy/deepest]', err);
    res.status(500).json({ error: 'db error' });
  }
});

// -------------------------------------------------------------------
// GET /api/hierarchy/panel?title_id=..&here_city_id=..&here_country_id=..
// -------------------------------------------------------------------
router.get('/panel', async (req, res) => {
  const titleId = req.query.title_id;
  const hereCityId = req.query.here_city_id || null;
  const hereCountryId = req.query.here_country_id || null;
  if (!titleId) return res.status(400).json({ error: 'title_id required' });
  const userId = req.user.userId;

  try {
    if (titleId === 'world') {
      // ================================================================
      // World layer: items = countries user has any memory in
      // ================================================================
      // 1. Get user's memory_points + markers, group by country via bbox.
      // 2. For attribution: for each point, find the deepest region (level=3
      //    child of a country) whose bbox contains it → attribute to that
      //    child's parent (country). Then union by country.
      // 3. state = 'marked' if any marker exists in country's bbox, else 'walked'
      // 4. is_here = (country.id === here_country_id)

      // Fetch all memory_points bboxes for this user, then group per country
      const [visitedCountries] = await pool.query(
        `SELECT DISTINCT r.id, r.name_en, r.bbox_min_lng, r.bbox_min_lat, r.bbox_max_lng, r.bbox_max_lat
           FROM regions r
          WHERE r.level = 2
            AND (
              EXISTS (SELECT 1 FROM memory_points mp WHERE mp.user_id = ?
                        AND mp.lng BETWEEN r.bbox_min_lng AND r.bbox_max_lng
                        AND mp.lat BETWEEN r.bbox_min_lat AND r.bbox_max_lat)
              OR EXISTS (SELECT 1 FROM markers mk WHERE mk.user_id = ?
                        AND mk.lng BETWEEN r.bbox_min_lng AND r.bbox_max_lng
                        AND mk.lat BETWEEN r.bbox_min_lat AND r.bbox_max_lat)
            )`,
        [userId, userId]
      );

      // Compute state per country (marked if any marker in bbox)
      const items = [];
      for (const c of visitedCountries) {
        const [markerRows] = await pool.query(
          `SELECT 1 FROM markers WHERE user_id = ?
             AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?
             LIMIT 1`,
          [userId, c.bbox_min_lng, c.bbox_max_lng, c.bbox_min_lat, c.bbox_max_lat]
        );
        const state = markerRows.length > 0 ? 'marked' : 'walked';
        items.push({
          id: c.id,
          name_en: c.name_en,
          state,
          bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat],
          is_here: c.id === hereCountryId,
        });
      }

      // locked_count = total countries - visited count
      const [[{ total_countries }]] = await pool.query(
        `SELECT COUNT(*) AS total_countries FROM regions WHERE level = 2`
      );
      const locked_count = Math.max(0, total_countries - items.length);

      return res.json({
        title: { id: 'world', name_en: 'World', level: 0 },
        parent: null,
        items,
        locked_count,
      });
    }

    // ================================================================
    // Country layer: items = level-3 children user has memory in
    // ================================================================
    const [countryRows] = await pool.query(
      `SELECT id, name_en, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
         FROM regions WHERE id = ? AND level = 2`,
      [titleId]
    );
    if (countryRows.length === 0) {
      return res.status(404).json({ error: 'country not found' });
    }
    const country = countryRows[0];

    // Fetch all level-3 children of this country
    const [children] = await pool.query(
      `SELECT id, name_en, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
         FROM regions WHERE parent_id = ? AND level = 3
        ORDER BY name_en`,
      [country.id]
    );

    // For each child, check if user has memory (point or marker) in its bbox
    const items = [];
    for (const c of children) {
      const [pointRows] = await pool.query(
        `SELECT 1 FROM memory_points WHERE user_id = ?
           AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?
           LIMIT 1`,
        [userId, c.bbox_min_lng, c.bbox_max_lng, c.bbox_min_lat, c.bbox_max_lat]
      );
      const [markerRows] = await pool.query(
        `SELECT 1 FROM markers WHERE user_id = ?
           AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?
           LIMIT 1`,
        [userId, c.bbox_min_lng, c.bbox_max_lng, c.bbox_min_lat, c.bbox_max_lat]
      );
      const hasPoint = pointRows.length > 0;
      const hasMarker = markerRows.length > 0;
      if (!hasPoint && !hasMarker) continue; // skip locked; will count into locked_count
      const state = hasMarker ? 'marked' : 'walked';
      items.push({
        id: c.id,
        name_en: c.name_en,
        state,
        bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat],
        is_here: c.id === hereCityId,
      });
    }
    const locked_count = children.length - items.length;

    return res.json({
      title: { id: country.id, name_en: country.name_en, level: 2 },
      parent: { id: 'world', name_en: 'World', level: 0 },
      items,
      locked_count,
    });
  } catch (err) {
    console.error('[hierarchy/panel]', err);
    res.status(500).json({ error: 'db error' });
  }
});

module.exports = router;
