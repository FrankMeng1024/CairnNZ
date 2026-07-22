/**
 * hierarchy.js — v427 Memory hierarchy API
 *
 * Serves world regions tree from the `regions` static table.
 *
 * Endpoints:
 *   GET  /api/hierarchy/panel?region_id=CN-31
 *     Returns the panel data for a given current region:
 *     {
 *       current: { id, name_en, level, bbox },
 *       parent:  { id, name_en, level } | null,
 *       explored_here: bool,                       // has user memory in current bbox
 *       siblings: [
 *         {
 *           id, name_en, level, bbox,
 *           is_here: bool,                          // sib.id === region_id
 *           state: 'explored' | 'locked',
 *           point_count: number                     // # memory_points in this sibling
 *         }
 *       ],
 *       // Note: siblings include locked ones too but client will collapse them.
 *       locked_count: number,                       // count of siblings with state=locked
 *       explored_count: number
 *     }
 *
 *   GET  /api/hierarchy/deepest?lat=..&lng=..
 *     Returns the deepest region (highest level) whose bbox contains lat/lng.
 *     Used for "you are here" on map open OR on map camera change.
 *
 * All endpoints require auth (JWT via req.userId).
 */

const express = require('express');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');

const router = express.Router();
router.use(authenticate);

// GET /api/hierarchy/deepest?lat=..&lng=..
//
// v428: uses polygon point-in-polygon (ST_Contains) for precision.
// Falls back to bbox lookup if polygon column not present (mid-migration).
router.get('/deepest', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng required' });
  }
  try {
    // v428: try polygon ST_Contains first (spatial index accelerated).
    // MySQL 8 syntax: point must have SRID 4326 matching geom SRID.
    // Only rows with non-empty geometry are candidates; continents (POLYGON EMPTY)
    // are excluded from deepest lookup — they cannot be "where you are".
    try {
      // v428 note: no ORDER BY ST_Area in SQL to avoid MySQL 8
      // sort_buffer_size limits on aliyun. Sort in JS after fetching (typical
      // result set = 3-6 candidates so JS sort is trivial).
      const [candidates] = await pool.query(
        `SELECT id, parent_id, name_en, level,
                bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
                ST_Area(geom) AS area
           FROM regions
          WHERE level >= 2
            AND ST_Contains(geom, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'), 4326, 'axis-order=long-lat'))`,
        [lng, lat]
      );
      if (candidates.length > 0) {
        // Sort deepest level first, then smallest area (handles enclaves like
        // Shanghai inside Jiangsu — Shanghai wins on area).
        candidates.sort((a, b) => (b.level - a.level) || (a.area - b.area));
        const best = candidates[0];
        return res.json({ region: fmtRegion(best) });
      }
      // No polygon match — fall through to bbox lookup below
    } catch (spatialErr) {
      // Column may not exist yet (pre-migration) — fall back silently.
      // v428 fix: match by err.code (precise) not message regex (would
      // swallow real errors like ST_Contains SRID mismatch).
      if (spatialErr.code !== 'ER_BAD_FIELD_ERROR') {
        throw spatialErr;
      }
    }

    // Legacy bbox fallback (pre-v428 schema OR polygon lookup missed)
    const [candidates] = await pool.query(
      `SELECT id, parent_id, name_en, level,
              bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
         FROM regions
        WHERE ? BETWEEN bbox_min_lng AND bbox_max_lng
          AND ? BETWEEN bbox_min_lat AND bbox_max_lat
        ORDER BY level DESC`,
      [lng, lat]
    );
    if (candidates.length === 0) {
      const [wr] = await pool.query('SELECT * FROM regions WHERE id = "world"');
      return res.json({ region: fmtRegion(wr[0]) });
    }
    // Filter to the deepest level
    const maxLevel = candidates[0].level;
    const sameLevel = candidates.filter((c) => c.level === maxLevel);
    // Pick nearest bbox center at that level
    let best = sameLevel[0];
    let bestD = Infinity;
    for (const c of sameLevel) {
      const cx = (c.bbox_min_lng + c.bbox_max_lng) / 2;
      const cy = (c.bbox_min_lat + c.bbox_max_lat) / 2;
      const dx = lng - cx;
      const dy = lat - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = c; }
    }
    res.json({ region: fmtRegion(best) });
  } catch (err) {
    console.error('[hierarchy/deepest]', err);
    res.status(500).json({ error: 'db error' });
  }
});

// GET /api/hierarchy/panel?region_id=..
router.get('/panel', async (req, res) => {
  const regionId = req.query.region_id;
  if (!regionId) return res.status(400).json({ error: 'region_id required' });
  const userId = req.user.userId;

  try {
    // Current region
    const [curRows] = await pool.query(
      `SELECT id, parent_id, name_en, level,
              bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
         FROM regions WHERE id = ?`,
      [regionId]
    );
    if (curRows.length === 0) {
      return res.status(404).json({ error: 'region not found' });
    }
    const current = curRows[0];

    // Parent
    let parent = null;
    if (current.parent_id) {
      const [pRows] = await pool.query(
        `SELECT id, parent_id, name_en, level FROM regions WHERE id = ?`,
        [current.parent_id]
      );
      if (pRows.length > 0) parent = pRows[0];
    }

    // Siblings (same parent). For world, siblings = [world itself] which is meaningless;
    // in that case, siblings = children of world (i.e. continents).
    //
    // v428 drill mode: when client passes ?drill=1, treat current region as
    // the container and return its CHILDREN as siblings. This lets the user
    // "tap the green (current) row to drill into it and see what's inside".
    // Semantically the panel then shows: current = <a child, first explored
    // or first alphabetically>, siblings = all children of the region the
    // user was on.
    const drillMode = req.query.drill === '1' || req.query.drill === 'true';
    let siblingsRaw;
    if (drillMode || current.level === 0) {
      // Drill: children of current region are the new siblings.
      // Level 0 (world): always drill (continents = "siblings" so user can pick one).
      const parentIdForChildren = drillMode ? current.id : 'world';
      const [rows] = await pool.query(
        `SELECT id, parent_id, name_en, level,
                bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
           FROM regions WHERE parent_id = ?
          ORDER BY name_en`,
        [parentIdForChildren]
      );
      siblingsRaw = rows;
    } else {
      const [rows] = await pool.query(
        `SELECT id, parent_id, name_en, level,
                bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
           FROM regions WHERE parent_id = ?
          ORDER BY name_en`,
        [current.parent_id]
      );
      siblingsRaw = rows;
    }

    // For each sibling, count user's memory_points whose DEEPEST region
    // is this sibling (or a descendant of it). Prevents double-counting when
    // sibling bboxes overlap (e.g. Shanghai is inside Jiangsu bbox rectangle
    // because Shanghai is enclave-shaped and Natural Earth uses axis-aligned
    // bounding boxes).
    //
    // Approach: for each memory_point, find max(level) region whose bbox
    // contains it. Then this point belongs to that region and all its
    // ancestors. For our sibling list (same level), a point belongs to
    // sibling S if the point's deepest region == S OR is a descendant of S
    // reached via parent_id chain.
    //
    // Simplification for v427 (single-parent sibling list): a point counts
    // for sibling S if:
    //   - S bbox contains it AND
    //   - among all *sibling-level* regions whose bbox contains it, S has
    //     the "closest" match (bbox center nearest to point).
    // This is a heuristic but resolves the overlap correctly for enclave
    // cases (Shanghai bbox is smaller & centered on 121.5,31.2, closer to
    // typical Shanghai points than Jiangsu's bbox center).
    // v430 speed: pure bbox+nearest-center in JS. Previous ST_Contains
    // spatial JOIN was 3-36s (continent-level polygons are huge). Client
    // only needs marked/walked ids + locked_count, so exact enclave
    // resolution is unnecessary — nearest-bbox-center among siblings that
    // contain the point is enough.
    const sibIds = siblingsRaw.map((s) => s.id);
    const pointCounts = new Map();
    const markerCounts = new Map();
    if (sibIds.length > 0) {
      const allMinLng = Math.min(...siblingsRaw.map(s => s.bbox_min_lng));
      const allMinLat = Math.min(...siblingsRaw.map(s => s.bbox_min_lat));
      const allMaxLng = Math.max(...siblingsRaw.map(s => s.bbox_max_lng));
      const allMaxLat = Math.max(...siblingsRaw.map(s => s.bbox_max_lat));

      const [userPoints] = await pool.query(
        `SELECT lng, lat FROM memory_points
          WHERE user_id = ?
            AND lng BETWEEN ? AND ?
            AND lat BETWEEN ? AND ?
          LIMIT 20000`,
        [userId, allMinLng, allMaxLng, allMinLat, allMaxLat]
      );
      const [userMarkers] = await pool.query(
        `SELECT lng, lat FROM markers
          WHERE user_id = ?
            AND lng BETWEEN ? AND ?
            AND lat BETWEEN ? AND ?
          LIMIT 5000`,
        [userId, allMinLng, allMaxLng, allMinLat, allMaxLat]
      );

      const sibCenters = siblingsRaw.map((s) => ({
        id: s.id,
        cx: (s.bbox_min_lng + s.bbox_max_lng) / 2,
        cy: (s.bbox_min_lat + s.bbox_max_lat) / 2,
        minLng: s.bbox_min_lng, maxLng: s.bbox_max_lng,
        minLat: s.bbox_min_lat, maxLat: s.bbox_max_lat,
      }));

      const assignToNearest = (rows, counts) => {
        for (const p of rows) {
          let bestSib = null;
          let bestD = Infinity;
          for (const sc of sibCenters) {
            if (p.lng < sc.minLng || p.lng > sc.maxLng) continue;
            if (p.lat < sc.minLat || p.lat > sc.maxLat) continue;
            const dx = p.lng - sc.cx;
            const dy = p.lat - sc.cy;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; bestSib = sc.id; }
          }
          if (bestSib) counts.set(bestSib, (counts.get(bestSib) || 0) + 1);
        }
      };
      assignToNearest(userPoints, pointCounts);
      assignToNearest(userMarkers, markerCounts);
    }

    // "Explored here" for current region (v428: also count markers)
    // v430: bbox count only. Previous ST_Contains was 30s on continent-level
    // regions with huge geometry.
    let exploredHereCount = 0;
    let markerHereCount = 0;
    {
      const [ehRows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM memory_points
          WHERE user_id = ?
            AND lng BETWEEN ? AND ?
            AND lat BETWEEN ? AND ?`,
        [userId, current.bbox_min_lng, current.bbox_max_lng, current.bbox_min_lat, current.bbox_max_lat]
      );
      const [ehMarkers] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM markers
          WHERE user_id = ?
            AND lng BETWEEN ? AND ?
            AND lat BETWEEN ? AND ?`,
        [userId, current.bbox_min_lng, current.bbox_max_lng, current.bbox_min_lat, current.bbox_max_lat]
      );
      exploredHereCount = Number(ehRows[0]?.cnt || 0);
      markerHereCount = Number(ehMarkers[0]?.cnt || 0);
    }

    // v428: three-state model
    //   'marked'  → has ≥1 marker (implies user planted a flag/cairn here)
    //   'walked'  → has memory_points but no marker (visited but didn't mark)
    //   'locked'  → no memory_points, no markers (never been)
    // 'here' is a UI concern (current region) and orthogonal to these states.
    const siblings = siblingsRaw.map((s) => {
      const pcount = pointCounts.get(s.id) || 0;
      const mcount = markerCounts.get(s.id) || 0;
      const isHere = s.id === regionId;
      let state;
      if (mcount > 0) state = 'marked';
      else if (pcount > 0) state = 'walked';
      else state = 'locked';
      return {
        id: s.id,
        name_en: s.name_en,
        level: s.level,
        bbox: [s.bbox_min_lng, s.bbox_min_lat, s.bbox_max_lng, s.bbox_max_lat],
        is_here: isHere,
        state,
        point_count: pcount,
        marker_count: mcount,
      };
    });

    const markedCount = siblings.filter((s) => s.state === 'marked' && !s.is_here).length;
    const walkedCount = siblings.filter((s) => s.state === 'walked' && !s.is_here).length;
    const lockedCount = siblings.filter((s) => s.state === 'locked' && !s.is_here).length;

    res.json({
      current: fmtRegion(current),
      parent: parent ? { id: parent.id, name_en: parent.name_en, level: parent.level } : null,
      // v428: dual counts for the current region
      here_point_count: exploredHereCount,
      here_marker_count: markerHereCount,
      here_state: markerHereCount > 0 ? 'marked' : exploredHereCount > 0 ? 'walked' : 'locked',
      // legacy field kept for backwards compatibility
      explored_here: exploredHereCount > 0,
      siblings,
      marked_count: markedCount,
      walked_count: walkedCount,
      locked_count: lockedCount,
      // legacy field: sum of marked + walked
      explored_count: markedCount + walkedCount,
    });
  } catch (err) {
    console.error('[hierarchy/panel]', err);
    res.status(500).json({ error: 'db error' });
  }
});

// GET /api/hierarchy/polygon/:region_id — v428
// Returns the region's polygon as a GeoJSON FeatureCollection for map
// highlighting. Uses ST_AsGeoJSON on the GEOMETRY column added in v428.
//
// Continent-level regions intentionally have POLYGON EMPTY (no highlight);
// caller should render nothing when features is empty.
router.get('/polygon/:region_id', async (req, res) => {
  const regionId = req.params.region_id;
  if (!regionId) return res.status(400).json({ error: 'region_id required' });
  try {
    // v428: geom is NOT NULL (SPATIAL INDEX requirement). world/continent
    // rows have bbox-rectangle placeholder polygons. The polygon endpoint
    // gates highlight by level — return empty FeatureCollection for
    // level < 2 (world / continent), per user "不高亮" decision.
    const [rows] = await pool.query(
      `SELECT id, name_en, level, ST_AsGeoJSON(geom) AS geom_json
         FROM regions WHERE id = ?`,
      [regionId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'region not found' });
    const r = rows[0];
    // Cache aggressively — polygons rarely change (seed-time only)
    res.set('Cache-Control', 'public, max-age=86400');
    // Level gate: world (0) + continent (1) never render highlight
    if (r.level < 2 || !r.geom_json) {
      return res.json({
        region_id: r.id,
        type: 'FeatureCollection',
        features: [],
      });
    }
    let geometry;
    try {
      // MySQL2 driver may auto-parse ST_AsGeoJSON as object OR return string
      // depending on version + column type. Handle both.
      geometry = typeof r.geom_json === 'string'
        ? JSON.parse(r.geom_json)
        : r.geom_json;
    } catch (e) {
      console.error('[hierarchy/polygon] parse failed for', regionId, e.message);
      return res.status(500).json({ error: 'geom parse failed' });
    }
    return res.json({
      region_id: r.id,
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { id: r.id, name_en: r.name_en, level: r.level },
        geometry,
      }],
    });
  } catch (err) {
    // Column may not exist yet on old schema — return empty gracefully so
    // v428 client falls back to no-highlight instead of crashing.
    if (err && (err.code === 'ER_BAD_FIELD_ERROR' || /Unknown column 'geom'/.test(String(err.message || '')))) {
      return res.json({
        region_id: regionId,
        type: 'FeatureCollection',
        features: [],
        _fallback: 'geom-column-missing',
      });
    }
    console.error('[hierarchy/polygon]', err);
    res.status(500).json({ error: 'db error' });
  }
});

function fmtRegion(r) {
  return {
    id: r.id,
    parent_id: r.parent_id,
    name_en: r.name_en,
    level: r.level,
    bbox: [r.bbox_min_lng, r.bbox_min_lat, r.bbox_max_lng, r.bbox_max_lat],
  };
}

module.exports = router;
