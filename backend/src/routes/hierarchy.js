/**
 * hierarchy.js — v436 (root-cause fix for attribution)
 *
 * Bugs fixed vs v434/v435:
 *   1. USA showed as visited for every user — because USA bbox crosses
 *      the antimeridian (Aleutians) → bbox_min_lng=-179 bbox_max_lng=+179,
 *      i.e. "contains almost every longitude". Every point matched.
 *   2. Indonesia showed as visited for a KL user — because IDN bbox
 *      extends to 141°E,-11°S..6°N and KL(101.7,3.14) falls inside that
 *      rectangle even though KL isn't in Indonesia.
 *   3. Guangdong AND Shenzhen both lit — because Shenzhen sits inside
 *      Guangdong's bbox, and the naive attribution counted both.
 *   4. Jiangsu AND Shanghai both lit — same reason (Shanghai enclave
 *      inside Jiangsu bbox rectangle).
 *
 * Root cause: bbox rectangle overlap. Fix: use ST_Contains(geom, POINT)
 * for every attribution — real polygon boundaries, no rectangle noise.
 *
 * Attribution rule (deepest-child-only):
 *   For each memory_point / marker, find the level-3 region whose
 *   real geom contains the point, taking the smallest area if multiple.
 *   That's the point's "home city". Its country_id gives the country.
 *   Each point is attributed to EXACTLY ONE city and EXACTLY ONE country
 *   — no double-counting.
 *
 * World layer items = distinct home-countries of user's points/markers.
 * Country layer items = distinct home-cities under that country.
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
      }
    } catch (e) {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
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
// Helper — per user, compute the deepest-city + home-country for
// every point + marker. Returns two Sets:
//   { visitedCityIds, visitedCountryIds,
//     markedCityIds,  markedCountryIds }
//
// One ST_Contains query per row is slow. We do it in a single query
// with a lateral-join-ish approach: for each point, find the smallest
// level-3 region containing it. That's 1 spatial-index-accelerated
// query total (per point in the JOIN), then we group in JS.
// -------------------------------------------------------------------
async function computeUserAttribution(userId) {
  // Query pattern: for each memory_point + marker of the user, find the
  // level-3 region whose geom contains it, smallest area first.
  //
  // We select all matching (point_id, region_id, area) then keep the
  // smallest-area region per point in JS. This is fast because:
  //   - ST_Contains uses the SPATIAL INDEX on regions.geom
  //   - Most points match 1 region (smallest area path taken instantly)
  //   - JS pass is O(N) where N = matches, tiny in practice.
  //
  // NOTE we join on level=3 only. A point that doesn't fall in any
  // level-3 region will be ignored — those are "in a country but not
  // in any of our seeded cities". For v436 this is acceptable; the
  // country layer just won't count them.

  const [pointMatches] = await pool.query(
    `SELECT mp.id AS pt_id, r.id AS region_id, r.parent_id AS country_id, ST_Area(r.geom) AS area
       FROM memory_points mp
       JOIN regions r
         ON r.level = 3
        AND ST_Contains(r.geom, ST_GeomFromText(CONCAT('POINT(', mp.lng, ' ', mp.lat, ')'), 4326, 'axis-order=long-lat'))
      WHERE mp.user_id = ?`,
    [userId]
  );

  const [markerMatches] = await pool.query(
    `SELECT mk.id AS pt_id, r.id AS region_id, r.parent_id AS country_id, ST_Area(r.geom) AS area
       FROM markers mk
       JOIN regions r
         ON r.level = 3
        AND ST_Contains(r.geom, ST_GeomFromText(CONCAT('POINT(', mk.lng, ' ', mk.lat, ')'), 4326, 'axis-order=long-lat'))
      WHERE mk.user_id = ?`,
    [userId]
  );

  // Per point, keep the smallest-area region (deepest match).
  function pickSmallest(matches) {
    const byPt = new Map();
    for (const m of matches) {
      const cur = byPt.get(m.pt_id);
      if (!cur || m.area < cur.area) byPt.set(m.pt_id, m);
    }
    return byPt;
  }
  const pointBest = pickSmallest(pointMatches);
  const markerBest = pickSmallest(markerMatches);

  const visitedCityIds = new Set();
  const visitedCountryIds = new Set();
  const markedCityIds = new Set();
  const markedCountryIds = new Set();

  for (const m of pointBest.values()) {
    visitedCityIds.add(m.region_id);
    visitedCountryIds.add(m.country_id);
  }
  for (const m of markerBest.values()) {
    visitedCityIds.add(m.region_id);
    visitedCountryIds.add(m.country_id);
    markedCityIds.add(m.region_id);
    markedCountryIds.add(m.country_id);
  }

  return { visitedCityIds, visitedCountryIds, markedCityIds, markedCountryIds };
}

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
    const attr = await computeUserAttribution(userId);

    if (titleId === 'world') {
      // World layer: items = countries in visitedCountryIds
      if (attr.visitedCountryIds.size === 0) {
        // Fresh user
        const [[{ total_countries }]] = await pool.query(
          `SELECT COUNT(*) AS total_countries FROM regions WHERE level = 2`
        );
        return res.json({
          title: { id: 'world', name_en: 'World', level: 0 },
          parent: null,
          items: [],
          locked_count: total_countries,
        });
      }
      const [countryRows] = await pool.query(
        `SELECT id, name_en, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
           FROM regions
          WHERE level = 2 AND id IN (?)`,
        [Array.from(attr.visitedCountryIds)]
      );
      const items = countryRows.map((c) => ({
        id: c.id,
        name_en: c.name_en,
        state: attr.markedCountryIds.has(c.id) ? 'marked' : 'walked',
        bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat],
        is_here: c.id === hereCountryId,
      }));

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

    // Country layer: items = children of titleId that user visited
    const [countryRows] = await pool.query(
      `SELECT id, name_en FROM regions WHERE id = ? AND level = 2`,
      [titleId]
    );
    if (countryRows.length === 0) {
      return res.status(404).json({ error: 'country not found' });
    }
    const country = countryRows[0];

    // All level-3 children of this country
    const [children] = await pool.query(
      `SELECT id, name_en, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
         FROM regions WHERE parent_id = ? AND level = 3`,
      [country.id]
    );

    // Filter to children that the user actually visited (attribution)
    const items = children
      .filter((c) => attr.visitedCityIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name_en: c.name_en,
        state: attr.markedCityIds.has(c.id) ? 'marked' : 'walked',
        bbox: [c.bbox_min_lng, c.bbox_min_lat, c.bbox_max_lng, c.bbox_max_lat],
        is_here: c.id === hereCityId,
      }))
      .sort((a, b) => a.name_en.localeCompare(b.name_en));

    const locked_count = Math.max(0, children.length - items.length);

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
