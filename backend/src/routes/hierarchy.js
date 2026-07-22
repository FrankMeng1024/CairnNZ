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
router.get('/deepest', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng required' });
  }
  try {
    // Get ALL containing regions at highest level, then pick nearest-center.
    // This handles enclave cases like Shanghai inside Jiangsu's bbox rect —
    // deepest.level=3 for both, but Shanghai is smaller/closer so wins.
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
    let siblingsRaw;
    if (current.level === 0) {
      // Special-case: world level. Show continents as siblings so user can drill down.
      const [rows] = await pool.query(
        `SELECT id, parent_id, name_en, level,
                bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
           FROM regions WHERE parent_id = 'world'
          ORDER BY name_en`
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
    const sibIds = siblingsRaw.map((s) => s.id);
    const pointCounts = new Map();
    if (sibIds.length > 0) {
      // Fetch all user memory points that fall in ANY sibling bbox in one query.
      // Then assign each point to nearest-center sibling in JS.
      const bboxOr = siblingsRaw
        .map(() => '(lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?)')
        .join(' OR ');
      const params = [userId];
      for (const s of siblingsRaw) {
        params.push(s.bbox_min_lng, s.bbox_max_lng, s.bbox_min_lat, s.bbox_max_lat);
      }
      const [pointRows] = await pool.query(
        `SELECT lat, lng FROM memory_points WHERE user_id = ? AND (${bboxOr})`,
        params
      );
      // For each point, find sibling whose bbox contains it AND whose center
      // is closest. This picks the "smaller, closer" bbox (Shanghai over
      // Jiangsu for a Shanghai-located point).
      const sibCenters = siblingsRaw.map((s) => ({
        id: s.id,
        cx: (s.bbox_min_lng + s.bbox_max_lng) / 2,
        cy: (s.bbox_min_lat + s.bbox_max_lat) / 2,
        minLng: s.bbox_min_lng, maxLng: s.bbox_max_lng,
        minLat: s.bbox_min_lat, maxLat: s.bbox_max_lat,
      }));
      for (const p of pointRows) {
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
        if (bestSib) {
          pointCounts.set(bestSib, (pointCounts.get(bestSib) || 0) + 1);
        }
      }
    }

    // "Explored here" for current region
    const [ehRows] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM memory_points
        WHERE user_id = ?
          AND lng BETWEEN ? AND ?
          AND lat BETWEEN ? AND ?`,
      [userId, current.bbox_min_lng, current.bbox_max_lng, current.bbox_min_lat, current.bbox_max_lat]
    );
    const exploredHereCount = Number(ehRows[0]?.cnt || 0);

    const siblings = siblingsRaw.map((s) => {
      const count = pointCounts.get(s.id) || 0;
      const isHere = s.id === regionId;
      return {
        id: s.id,
        name_en: s.name_en,
        level: s.level,
        bbox: [s.bbox_min_lng, s.bbox_min_lat, s.bbox_max_lng, s.bbox_max_lat],
        is_here: isHere,
        state: count > 0 ? 'explored' : 'locked',
        point_count: count,
      };
    });

    const exploredCount = siblings.filter((s) => s.state === 'explored').length;
    const lockedCount = siblings.filter((s) => s.state === 'locked' && !s.is_here).length;

    res.json({
      current: fmtRegion(current),
      parent: parent ? { id: parent.id, name_en: parent.name_en, level: parent.level } : null,
      explored_here: exploredHereCount > 0,
      here_point_count: exploredHereCount,
      siblings,
      explored_count: exploredCount,
      locked_count: lockedCount,
    });
  } catch (err) {
    console.error('[hierarchy/panel]', err);
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
