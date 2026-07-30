/**
 * Hide Routes — /api/hide
 *
 * Friend System v1 / Sprint 67 / STORY-00528
 *
 * v4 §5 "Hide from me": per-viewer blacklist of other people's marks/routes.
 * - For my own items, the UI exposes real DELETE (handled in markers.js / routes.js).
 * - For other-user items, the UI calls /api/hide. The row stays in the
 *   source table; only this viewer stops seeing it (filtered in circle/* and
 *   markers/public).
 *
 * Schema (migration 018):
 *   hidden_items PK(user_id, item_type, item_id)
 *   item_type ENUM('mark','route')
 *
 * Endpoint:
 *   POST /api/hide  body { item_type, item_id }   → 201 (created) | 200 (already hidden)
 *
 * No DELETE endpoint: per v4 product decision, hide is irreversible from the
 * client (strong warning shown at hide-time). Hidden Items management is
 * deferred to v1.2 (per v4 §12).
 */
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const { validateBody } = require('../middleware/validate');
const schemas = require('../middleware/schemas');

router.use(authenticate);

// Sprint 6 R61: rate-limit hide-item creation. Pre-fix, no throttle
// on POST /hide. A user could hide 10k items rapidly, spamming
// hidden_items INSERTs. PK dedupes duplicates so no data corruption,
// but wastes DB pool and grows the table. Legitimate use is "user
// taps Hide on a marker" a few times per session; 200/hour is
// enormously generous headroom.
const hideLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => req.user?.userId ? `hide:${req.user.userId}` : ipKeyGenerator(req, res),
  message: { error: 'Too many hide requests. Please slow down.' },
});

const VALID_TYPES = new Set(['mark', 'route']);

router.post('/', hideLimiter, validateBody(schemas.hide.create), async (req, res) => {
  const userId = req.user.userId;
  const { item_type, item_id } = req.body || {};

  if (!VALID_TYPES.has(item_type)) {
    return res.status(400).json({ error: "item_type must be 'mark' or 'route'" });
  }
  const itemId = Number(item_id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'item_id (positive integer) required' });
  }

  try {
    // Validate the target actually exists in the relevant table (and isn't
    // the viewer's own item — hiding your own item is meaningless; use DELETE).
    const targetTable = item_type === 'mark' ? 'markers' : 'routes';
    const [[target]] = await pool.execute(
      `SELECT user_id FROM ${targetTable} WHERE id = ?`,
      [itemId]
    );
    if (!target) return res.status(404).json({ error: `${item_type} not found` });
    // Sprint 6 round-46 R46: fix type-coercion self-hide bypass. Same
    // class as R38B2 / R45. target.user_id is Number (mysql2 for BIGINT
    // UNSIGNED); userId is String (JWT payload). Strict `===` always
    // false → user could hide their own marker/route, inserting a
    // self-hide row that filters their own item out of /circle/markers
    // and /circle/routes for themselves. UX bug (they'd wonder why
    // their content vanished from the shared feed).
    if (String(target.user_id) === String(userId)) {
      return res.status(400).json({
        error: `Cannot hide your own ${item_type}. Use DELETE to remove it.`,
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO hidden_items (user_id, item_type, item_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE hidden_at = hidden_at`,
      [userId, item_type, itemId]
    );

    // affectedRows: 1 = new row inserted, 2 = ON DUPLICATE KEY updated (no-op),
    // 0 in some MySQL versions when the duplicate path runs without change.
    const status = result.affectedRows === 1 ? 201 : 200;
    return res.status(status).json({
      hidden: true,
      item_type,
      item_id: itemId,
      already_hidden: status === 200,
    });
  } catch (err) {
    console.error('[hide/create]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
