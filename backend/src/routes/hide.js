/**
 * Hide Routes — /api/hide
 *
 * Friend System v1 / Sprint 67 / STORY-00528
 *
 * Legacy compatibility endpoint for already-authorized Friend content.
 * Current Friend Content and Public clients use their resource-specific
 * endpoints, which also update their encounter state. A numeric database id
 * alone is never authority to create a hidden_items row.
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
const {
  authorizedFriendCairn,
  authorizedFriendRoute,
} = require('../services/friendAuthorization');

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
  keyGenerator: (req) => req.user?.userId ? `hide:${req.user.userId}` : ipKeyGenerator(req.ip),
  message: { error: 'Too many hide requests. Please slow down.' },
});

const VALID_TYPES = new Set(['mark', 'route']);
const opaqueUnavailable = res => res.status(404).json({
  error: 'Content unavailable.',
  code: 'CONTENT_UNAVAILABLE',
});

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
    // Preserve this endpoint only for current Circle/Friend projections.
    // Public Cairns must use /api/public-cairns/cairns/:id/hide, where the
    // feature gate and version-current encounter authority are enforced.
    // Personal, revoked, blocked, unencountered, and arbitrary known IDs all
    // receive one opaque denial without a hidden_items write.
    const target = item_type === 'mark'
      ? await authorizedFriendCairn(pool, userId, itemId, { includeHidden: true })
      : await authorizedFriendRoute(pool, userId, itemId, { includeHidden: true });
    if (!target) return opaqueUnavailable(res);

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
