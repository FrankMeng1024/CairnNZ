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
  const t0 = Date.now();
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const userId = req.user?.userId ?? 'unknown';
  console.log(`[hierarchy/deepest] IN user=${userId} lat=${lat} lng=${lng}`);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    console.log(`[hierarchy/deepest] BAD_PARAMS user=${userId}`);
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
        console.log(`[hierarchy/deepest] CITY_HIT user=${userId} chose=${c.id} candidates=${rows.length} smallest_area=${c.area}`);
      } else {
        console.log(`[hierarchy/deepest] NO_CITY_HIT user=${userId} lat=${lat} lng=${lng}`);
      }
    } catch (e) {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
      console.warn(`[hierarchy/deepest] SCHEMA_ERR_L3 user=${userId} code=${e.code} (falling back)`);
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
      } else {
        console.warn(`[hierarchy/deepest] COUNTRY_MISSING user=${userId} city=${city.id} parent_id=${city.country_id}`);
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
          console.log(`[hierarchy/deepest] COUNTRY_FALLBACK_MISS user=${userId} lat=${lat} lng=${lng}`);
        }
      } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        console.warn(`[hierarchy/deepest] SCHEMA_ERR_L2 user=${userId} code=${e.code}`);
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
  const tStart = Date.now();
  console.log(`[hierarchy/attribute] IN user=${userId}`);

  const [userPoints] = await pool.query(
    `SELECT id, lat, lng FROM memory_points WHERE user_id = ?`,
    [userId]
  );
  const [userMarkers] = await pool.query(
    `SELECT id, lat, lng FROM markers WHERE user_id = ?`,
    [userId]
  );
  console.log(`[hierarchy/attribute] FETCHED user=${userId} points=${userPoints.length} markers=${userMarkers.length}`);

  async function attributeRows(rows, kind) {
    const byPt = new Map();
    const cache = new Map();
    let cacheHits = 0;
    let cacheMisses = 0;
    let notInAnyRegion = 0;
    for (const p of rows) {
      const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
      let best = cache.get(key);
      if (best === undefined) {
        cacheMisses += 1;
        const [candidates] = await pool.query(
          `SELECT id, parent_id AS country_id, ST_Area(geom) AS area
             FROM regions
            WHERE level = 3
              AND ST_Contains(geom, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'), 4326, 'axis-order=long-lat'))
            ORDER BY ST_Area(geom) ASC
            LIMIT 1`,
          [p.lng, p.lat]
        );
        best = candidates[0] ?? null;
        cache.set(key, best);
      } else {
        cacheHits += 1;
      }
      if (best) {
        byPt.set(p.id, { region_id: best.id, country_id: best.country_id });
      } else {
        notInAnyRegion += 1;
      }
    }
    console.log(`[hierarchy/attribute] ${kind.toUpperCase()}_DONE user=${userId} rows=${rows.length} matched=${byPt.size} miss_no_region=${notInAnyRegion} cache_hits=${cacheHits} cache_misses=${cacheMisses}`);
    return byPt;
  }

  const pointBest = await attributeRows(userPoints, 'points');
  const markerBest = await attributeRows(userMarkers, 'markers');

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

  console.log(`[hierarchy/attribute] OUT user=${userId} visited_cities=${visitedCityIds.size} visited_countries=${visitedCountryIds.size} marked_cities=${markedCityIds.size} marked_countries=${markedCountryIds.size} total_ms=${Date.now() - tStart}`);
  return { visitedCityIds, visitedCountryIds, markedCityIds, markedCountryIds };
}

// -------------------------------------------------------------------
// GET /api/hierarchy/panel?title_id=..&here_city_id=..&here_country_id=..
// -------------------------------------------------------------------
router.get('/panel', async (req, res) => {
  const t0 = Date.now();
  const titleId = req.query.title_id;
  const hereCityId = req.query.here_city_id || null;
  const hereCountryId = req.query.here_country_id || null;
  const userId = req.user?.userId ?? 'unknown';
  console.log(`[hierarchy/panel] IN user=${userId} title=${titleId} here_city=${hereCityId} here_country=${hereCountryId}`);
  if (!titleId) {
    console.log(`[hierarchy/panel] BAD_PARAMS user=${userId}`);
    return res.status(400).json({ error: 'title_id required' });
  }

  try {
    const tAttrStart = Date.now();
    const attr = await computeUserAttribution(userId);
    console.log(`[hierarchy/panel] ATTR_DONE user=${userId} visited_cities=${attr.visitedCityIds.size} visited_countries=${attr.visitedCountryIds.size} marked_cities=${attr.markedCityIds.size} marked_countries=${attr.markedCountryIds.size} attr_ms=${Date.now() - tAttrStart}`);

    if (titleId === 'world') {
      // World layer: items = countries in visitedCountryIds
      if (attr.visitedCountryIds.size === 0) {
        // Fresh user
        const [[{ total_countries }]] = await pool.query(
          `SELECT COUNT(*) AS total_countries FROM regions WHERE level = 2`
        );
        console.log(`[hierarchy/panel] OUT_WORLD_FRESH user=${userId} locked=${total_countries} dur_ms=${Date.now() - t0}`);
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

      console.log(`[hierarchy/panel] OUT_WORLD user=${userId} items=${items.length} locked=${locked_count} dur_ms=${Date.now() - t0}`);
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
      console.log(`[hierarchy/panel] COUNTRY_NOT_FOUND user=${userId} title=${titleId} dur_ms=${Date.now() - t0}`);
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
