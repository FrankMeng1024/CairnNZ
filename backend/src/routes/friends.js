/**
 * Friends Routes — /api/friends
 *
 * Endpoints:
 * POST   /api/friends/request     — Send friend request by email
 * GET    /api/friends/requests    — Get pending incoming requests
 * POST   /api/friends/accept      — Accept a friend request
 * POST   /api/friends/reject      — Reject a friend request
 * GET    /api/friends             — List all friends
 * DELETE /api/friends/:id         — Remove a friend
 * GET    /api/friends/:id/markers — Get friend's shared markers
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');

// All routes require auth
router.use(authenticate);

// ── Send friend request ─────────────────────────────────────────────────────
router.post('/request', async (req, res) => {
  try {
    const { email } = req.body;
    const fromUserId = req.user.userId;

    if (!email) return res.status(400).json({ error: 'Email is required' });

    // Find target user
    const [users] = await pool.execute('SELECT id, name, email FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const toUser = users[0];
    if (toUser.id === fromUserId) return res.status(400).json({ error: 'Cannot add yourself' });

    // Check if already friends
    const [existing] = await pool.execute(
      'SELECT id FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [fromUserId, toUser.id, toUser.id, fromUserId]
    );
    if (existing.length > 0) return res.status(400).json({ error: 'Already friends' });

    // Check if request already pending
    const [pending] = await pool.execute(
      'SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = "pending"',
      [fromUserId, toUser.id]
    );
    if (pending.length > 0) return res.status(400).json({ error: 'Request already sent' });

    // Create request
    await pool.execute(
      'INSERT INTO friend_requests (from_user_id, to_user_id, status, created_at) VALUES (?, ?, "pending", NOW())',
      [fromUserId, toUser.id]
    );

    res.status(201).json({ message: 'Friend request sent' });
  } catch (err) {
    console.error('[friends/request]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Get pending incoming requests ───────────────────────────────────────────
router.get('/requests', async (req, res) => {
  try {
    const [requests] = await pool.execute(
      `SELECT fr.id, fr.from_user_id, u.name as from_name, u.email as from_email, fr.created_at as sent_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.from_user_id
       WHERE fr.to_user_id = ? AND fr.status = "pending"
       ORDER BY fr.created_at DESC`,
      [req.user.userId]
    );
    res.json(requests);
  } catch (err) {
    console.error('[friends/requests]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Accept friend request ───────────────────────────────────────────────────
router.post('/accept', async (req, res) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: 'requestId required' });

    // Verify request belongs to this user
    const [requests] = await pool.execute(
      'SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = "pending"',
      [requestId, req.user.userId]
    );
    if (requests.length === 0) return res.status(404).json({ error: 'Request not found' });

    const request = requests[0];

    // Create friendship (bidirectional)
    await pool.execute(
      'INSERT INTO friends (user_id, friend_id, created_at) VALUES (?, ?, NOW()), (?, ?, NOW())',
      [req.user.userId, request.from_user_id, request.from_user_id, req.user.userId]
    );

    // Update request status
    await pool.execute('UPDATE friend_requests SET status = "accepted" WHERE id = ?', [requestId]);

    res.json({ message: 'Friend request accepted' });
  } catch (err) {
    console.error('[friends/accept]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Reject friend request ───────────────────────────────────────────────────
router.post('/reject', async (req, res) => {
  try {
    const { requestId } = req.body;
    await pool.execute(
      'UPDATE friend_requests SET status = "rejected" WHERE id = ? AND to_user_id = ?',
      [requestId, req.user.userId]
    );
    res.json({ message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── List friends ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [friends] = await pool.execute(
      `SELECT f.friend_id as id, u.name, u.email, f.created_at as added_at
       FROM friends f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`,
      [req.user.userId]
    );
    res.json(friends);
  } catch (err) {
    console.error('[friends/list]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Remove friend ───────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const friendId = req.params.id;
    await pool.execute(
      'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [req.user.userId, friendId, friendId, req.user.userId]
    );
    res.json({ message: 'Friend removed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Get friend's shared markers ─────────────────────────────────────────────
router.get('/:id/markers', async (req, res) => {
  try {
    const friendId = req.params.id;

    // Verify friendship
    const [friendship] = await pool.execute(
      'SELECT id FROM friends WHERE user_id = ? AND friend_id = ?',
      [req.user.userId, friendId]
    );
    if (friendship.length === 0) return res.status(403).json({ error: 'Not friends' });

    // Get markers shared at group or public level
    const [markers] = await pool.execute(
      `SELECT id, type, text, lat, lng, permission, created_at
       FROM markers
       WHERE user_id = ? AND permission IN ("group", "public")
       ORDER BY created_at DESC
       LIMIT 100`,
      [friendId]
    );
    res.json(markers);
  } catch (err) {
    console.error('[friends/markers]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
