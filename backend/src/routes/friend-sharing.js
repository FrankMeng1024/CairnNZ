'use strict';

const express = require('express');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const {
  currentFriendshipEpisode,
  createGrantIfPolicyEnabled,
  currentMemoryGrant,
} = require('../services/friendAuthorization');
const { deriveFriendProjection } = require('../services/friendProjection');

const router = express.Router();
router.use(authenticate);

router.get('/policy', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT enabled, policy_epoch, enabled_at, updated_at
         FROM memory_share_policies WHERE owner_id = ? LIMIT 1`,
      [req.user.userId],
    );
    const policy = rows[0];
    return res.json({
      enabled: Boolean(policy?.enabled),
      policy_epoch: Number(policy?.policy_epoch ?? 1),
      enabled_at: policy?.enabled_at ?? null,
      updated_at: policy?.updated_at ?? null,
    });
  } catch (error) {
    console.error('[friend-sharing/policy:get]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/policy', async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) required' });
  }
  const ownerId = req.user.userId;
  const enabled = req.body.enabled;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [ownerId]);
    await conn.execute(
      `INSERT INTO memory_share_policies (owner_id, enabled, enabled_at)
       VALUES (?, 0, NULL)
       ON DUPLICATE KEY UPDATE owner_id = owner_id`,
      [ownerId],
    );
    const [[current]] = await conn.execute(
      `SELECT enabled, policy_epoch FROM memory_share_policies WHERE owner_id = ? FOR UPDATE`,
      [ownerId],
    );
    if (Boolean(current.enabled) !== enabled) {
      await conn.execute(
        `UPDATE memory_share_policies
            SET enabled = ?, policy_epoch = policy_epoch + 1,
                enabled_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP(3) ELSE NULL END
          WHERE owner_id = ?`,
        [enabled ? 1 : 0, enabled ? 1 : 0, ownerId],
      );
      if (!enabled) {
        await conn.execute(
          `UPDATE memory_share_grants
              SET status = 'revoked', revoked_at = UTC_TIMESTAMP(3),
                  revoked_reason = 'policy_disabled', authorization_version = authorization_version + 1
            WHERE owner_id = ? AND status = 'active'`,
          [ownerId],
        );
        await conn.execute('DELETE FROM memory_subscriptions WHERE friend_id = ?', [ownerId]);
      } else {
        const [friends] = await conn.execute(
          `SELECT f.friend_id
             FROM friends f
             JOIN friends reverse_friend
               ON reverse_friend.user_id = f.friend_id AND reverse_friend.friend_id = f.user_id
             JOIN users u ON u.id = f.friend_id AND u.deleted_at IS NULL
            WHERE f.user_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM blocked_users b
                 WHERE (b.blocker_id = f.user_id AND b.blocked_id = f.friend_id)
                    OR (b.blocker_id = f.friend_id AND b.blocked_id = f.user_id)
              )
            ORDER BY f.friend_id ASC`,
          [ownerId],
        );
        for (const friend of friends) {
          const episode = await currentFriendshipEpisode(conn, ownerId, friend.friend_id, true);
          if (episode) await createGrantIfPolicyEnabled(conn, ownerId, friend.friend_id, episode);
        }
      }
    }
    const [[updated]] = await conn.execute(
      `SELECT enabled, policy_epoch, enabled_at, updated_at
         FROM memory_share_policies WHERE owner_id = ?`,
      [ownerId],
    );
    await conn.commit();
    return res.json({
      enabled: Boolean(updated.enabled),
      policy_epoch: Number(updated.policy_epoch),
      enabled_at: updated.enabled_at,
      updated_at: updated.updated_at,
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-sharing/policy:put]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/sources', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT g.owner_id AS friend_id, u.name AS friend_name,
              g.authorization_version, g.effective_at,
              CASE WHEN ms.friend_id IS NULL THEN 0 ELSE 1 END AS selected
         FROM memory_share_grants g
         JOIN memory_share_policies p ON p.owner_id = g.owner_id AND p.enabled = 1
         JOIN friendship_episodes e ON e.id = g.friendship_episode_id AND e.ended_at IS NULL
         JOIN friends f ON f.user_id = g.viewer_id AND f.friend_id = g.owner_id
         JOIN users u ON u.id = g.owner_id AND u.deleted_at IS NULL
         LEFT JOIN memory_subscriptions ms ON ms.user_id = g.viewer_id AND ms.friend_id = g.owner_id
        WHERE g.viewer_id = ? AND g.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM blocked_users b
             WHERE (b.blocker_id = g.owner_id AND b.blocked_id = g.viewer_id)
                OR (b.blocker_id = g.viewer_id AND b.blocked_id = g.owner_id)
          )
        ORDER BY u.name ASC, g.owner_id ASC
        LIMIT 1000`,
      [req.user.userId],
    );
    return res.json({
      sources: rows.map(row => ({
        friend_id: String(row.friend_id),
        friend_name: row.friend_name,
        selected: Boolean(row.selected),
        authorization_version: Number(row.authorization_version),
        effective_at: row.effective_at,
      })),
    });
  } catch (error) {
    console.error('[friend-sharing/sources]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/projections', async (req, res) => {
  const requested = Array.isArray(req.body?.friend_ids) ? req.body.friend_ids : [];
  const ids = [...new Set(requested.map(Number).filter(id => Number.isInteger(id) && id > 0))];
  if (ids.length > 5) return res.status(400).json({ error: 'At most five selected sources are allowed' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const lockIds = [...new Set([Number(req.user.userId), ...ids])].sort((a, b) => a - b);
    if (lockIds.length > 0) {
      await conn.query('SELECT id FROM users WHERE id IN (?) ORDER BY id FOR UPDATE', [lockIds]);
    }
    const projections = [];
    const revoked_friend_ids = [];
    for (const ownerId of ids) {
      const grant = await currentMemoryGrant(conn, ownerId, req.user.userId, { requireSelected: true });
      if (!grant) {
        revoked_friend_ids.push(String(ownerId));
        continue;
      }
      const projection = await deriveFriendProjection(conn, ownerId, req.user.userId, grant);
      const revalidated = await currentMemoryGrant(conn, ownerId, req.user.userId, { requireSelected: true });
      if (!revalidated
        || revalidated.grant_epoch !== grant.grant_epoch
        || Number(revalidated.authorization_version) !== Number(grant.authorization_version)
        || Number(revalidated.policy_epoch) !== Number(grant.policy_epoch)) {
        revoked_friend_ids.push(String(ownerId));
        continue;
      }
      projections.push(projection);
    }
    await conn.commit();
    const authorizedAt = new Date();
    const expiresAt = new Date(authorizedAt.getTime() + 24 * 60 * 60 * 1000);
    return res.json({
      server_authorized_at: authorizedAt.toISOString(),
      authorization_expires_at: expiresAt.toISOString(),
      projections: projections.map(projection => ({
        ...projection,
        server_authorized_at: authorizedAt.toISOString(),
        authorization_expires_at: expiresAt.toISOString(),
      })),
      revoked_friend_ids,
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-sharing/projections]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/private-places', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, label, lat, lng, GREATEST(radius_m, 250) AS radius_m, created_at, updated_at
         FROM memory_private_places
        WHERE owner_id = ? AND active = 1 ORDER BY created_at DESC`,
      [req.user.userId],
    );
    return res.json({ private_places: rows.map(row => ({ ...row, lat: Number(row.lat), lng: Number(row.lng), radius_m: Number(row.radius_m) })) });
  } catch (error) {
    console.error('[friend-sharing/private-places:get]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/private-places', async (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const radiusM = Math.max(250, Math.min(5000, Number(req.body?.radius_m ?? 250)));
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 80) || null : null;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Valid lat/lng required' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Serialize this owner's bounded collection without relying on an
    // aggregate SELECT lock (not portable across MySQL execution plans).
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.userId]);
    const [[count]] = await conn.execute(
      'SELECT COUNT(*) AS n FROM memory_private_places WHERE owner_id = ? AND active = 1',
      [req.user.userId],
    );
    if (Number(count.n) >= 20) {
      await conn.rollback();
      return res.status(409).json({ error: 'Private place limit reached' });
    }
    const [result] = await conn.execute(
      `INSERT INTO memory_private_places (owner_id, label, lat, lng, radius_m)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.userId, label, lat, lng, Math.round(radiusM)],
    );
    await conn.execute(
      `UPDATE memory_share_grants SET authorization_version = authorization_version + 1
        WHERE owner_id = ? AND status = 'active'`,
      [req.user.userId],
    );
    await conn.commit();
    return res.status(201).json({ id: result.insertId, label, lat, lng, radius_m: Math.round(radiusM) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-sharing/private-places:post]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.delete('/private-places/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid private place id' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `UPDATE memory_private_places SET active = 0, version = version + 1
        WHERE id = ? AND owner_id = ? AND active = 1`,
      [id, req.user.userId],
    );
    if (!result.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ error: 'Private place not found' });
    }
    await conn.execute(
      `UPDATE memory_share_grants SET authorization_version = authorization_version + 1
        WHERE owner_id = ? AND status = 'active'`,
      [req.user.userId],
    );
    await conn.commit();
    return res.json({ removed: true });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-sharing/private-places:delete]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

module.exports = router;
