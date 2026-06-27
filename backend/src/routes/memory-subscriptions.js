/**
 * Memory Subscriptions Routes — /api/memory-subscriptions
 *
 * Friend System v1 / Sprint 67 / STORY-00528
 *
 * The "5 of N friends" cap: a user explicitly subscribes to up to N (default 5)
 * friends' memory data (fog + markers + routes) for display in the Memory tab.
 *
 * Schema (migration 018):
 *   - users.memory_subscription_limit INT NOT NULL DEFAULT 5
 *   - memory_subscriptions PK(user_id, friend_id)
 *   - trigger trg_memory_subscription_cap: race-safe BEFORE INSERT
 *       1. friend_id MUST be in friends WHERE user_id=NEW.user_id
 *       2. current count < memory_subscription_limit (with SELECT ... FOR UPDATE)
 *
 * The trigger throws SQLSTATE 45000 with one of two MESSAGE_TEXT values:
 *   - 'memory_subscription requires existing friend pair'
 *   - 'memory_subscription limit exceeded'
 * We parse the error message to map to the right HTTP status (403 / 409).
 *
 * Endpoints:
 *   POST   /api/memory-subscriptions          body { friend_id }   → 201 | 403 | 409
 *   DELETE /api/memory-subscriptions/:friend_id                     → 200 | 404
 *   GET    /api/memory-subscriptions                                → [{...}]
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');

router.use(authenticate);

// ── POST /api/memory-subscriptions ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const userId = req.user.userId;
  const friendId = Number(req.body?.friend_id);

  if (!Number.isInteger(friendId) || friendId <= 0) {
    return res.status(400).json({ error: 'friend_id (integer) required' });
  }
  if (friendId === userId) {
    return res.status(400).json({ error: 'Cannot subscribe to yourself' });
  }

  try {
    await pool.execute(
      'INSERT INTO memory_subscriptions (user_id, friend_id) VALUES (?, ?)',
      [userId, friendId]
    );
    return res.status(201).json({ user_id: userId, friend_id: friendId });
  } catch (err) {
    // SIGNAL SQLSTATE '45000' from trigger surfaces as ER_SIGNAL_EXCEPTION
    // with the trigger's MESSAGE_TEXT in err.sqlMessage.
    const msg = err.sqlMessage || err.message || '';
    if (msg.includes('requires existing friend pair')) {
      return res.status(403).json({ error: 'Not friends with that user' });
    }
    if (msg.includes('limit exceeded')) {
      return res.status(409).json({ error: 'Memory subscription limit reached' });
    }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Already subscribed' });
    }
    console.error('[memory-subscriptions/create]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/memory-subscriptions/:friend_id ──────────────────────────────
router.delete('/:friend_id', async (req, res) => {
  const userId = req.user.userId;
  const friendId = Number(req.params.friend_id);
  if (!Number.isInteger(friendId) || friendId <= 0) {
    return res.status(400).json({ error: 'Invalid friend_id' });
  }
  try {
    const [result] = await pool.execute(
      'DELETE FROM memory_subscriptions WHERE user_id = ? AND friend_id = ?',
      [userId, friendId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Not subscribed' });
    }
    return res.json({ message: 'Unsubscribed' });
  } catch (err) {
    console.error('[memory-subscriptions/delete]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/memory-subscriptions ────────────────────────────────────────────
// Returns the viewer's current subscription list + the cap, so the client can
// render "3 / 5" and the 🔒 lock state without a second roundtrip.
router.get('/', async (req, res) => {
  const userId = req.user.userId;
  try {
    const [rows] = await pool.execute(
      `SELECT ms.friend_id, u.name AS friend_name, u.email AS friend_email, ms.subscribed_at
         FROM memory_subscriptions ms
         JOIN users u ON u.id = ms.friend_id
        WHERE ms.user_id = ?
        ORDER BY ms.subscribed_at ASC`,
      [userId]
    );
    const [[me]] = await pool.execute(
      'SELECT memory_subscription_limit FROM users WHERE id = ?',
      [userId]
    );
    return res.json({
      limit: me?.memory_subscription_limit ?? 5,
      count: rows.length,
      subscriptions: rows,
    });
  } catch (err) {
    console.error('[memory-subscriptions/list]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
