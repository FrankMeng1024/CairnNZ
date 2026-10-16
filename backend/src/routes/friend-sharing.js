'use strict';

const express = require('express');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const {
  currentFriendshipEpisode,
  createGrantIfPolicyEnabled,
  currentMemoryGrant,
  setExplicitMemoryGrant,
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
            WHERE owner_id = ? AND status = 'active'
              AND coverage_scope = 'legacy_activity_since_grant'`,
          [ownerId],
        );
        await conn.execute(
          `DELETE ms FROM memory_subscriptions ms
            LEFT JOIN memory_share_grants g
              ON g.owner_id = ms.friend_id AND g.viewer_id = ms.user_id
             AND g.status = 'active'
           WHERE ms.friend_id = ? AND g.id IS NULL`,
          [ownerId],
        );
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
  const viewerId = req.user.userId;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [viewerId]);
    const [preferenceInsert] = await conn.execute(
      `INSERT IGNORE INTO memory_projection_preferences (viewer_id) VALUES (?)`,
      [viewerId],
    );
    if (Number(preferenceInsert.affectedRows) === 1) {
      // First use selects every source that is already authorized. Later an
      // explicit empty selection is represented by the preference row plus no
      // subscription rows and therefore survives reload.
      await conn.execute(
        `INSERT IGNORE INTO memory_subscriptions (user_id, friend_id)
         SELECT ?, g.owner_id
           FROM memory_share_grants g
           LEFT JOIN memory_share_policies p ON p.owner_id = g.owner_id
           JOIN friendship_episodes e
             ON e.id = g.friendship_episode_id AND e.ended_at IS NULL
           JOIN friends f ON f.user_id = g.viewer_id AND f.friend_id = g.owner_id
          WHERE g.viewer_id = ? AND g.status = 'active'
            AND (g.coverage_scope = 'full_history_delayed_v1' OR p.enabled = 1)
            AND NOT EXISTS (
              SELECT 1 FROM blocked_users b
               WHERE (b.blocker_id = g.owner_id AND b.blocked_id = g.viewer_id)
                  OR (b.blocker_id = g.viewer_id AND b.blocked_id = g.owner_id)
            )`,
        [viewerId, viewerId],
      );
    }
    const [rows] = await conn.execute(
      `SELECT f.friend_id, u.name AS friend_name,
              COALESCE(g.authorization_version, 0) AS authorization_version,
              g.effective_at, g.coverage_scope,
              CASE WHEN ms.friend_id IS NULL THEN 0 ELSE 1 END AS selected
              ,CASE WHEN g.id IS NULL THEN 'not_shared'
                    WHEN EXISTS (
                      SELECT 1 FROM memory_points mp
                       WHERE mp.user_id = f.friend_id
                         AND mp.evidence_source IN ('activity_real','passive_real')
                         AND mp.continuity_state = 'accepted'
                         AND mp.horizontal_accuracy_m IS NOT NULL
                         AND mp.horizontal_accuracy_m <= 50
                         AND DATE_ADD(GREATEST(FROM_UNIXTIME(mp.ts / 1000), mp.received_at),
                                      INTERVAL 1800 SECOND) <= UTC_TIMESTAMP(3)
                       LIMIT 1
                    ) OR EXISTS (
                      SELECT 1 FROM memory_presence_witnesses witness
                       WHERE witness.user_id = f.friend_id
                         AND witness.continuity_state = 'accepted'
                         AND witness.horizontal_accuracy_m <= 50
                         AND DATE_ADD(GREATEST(
                               FROM_UNIXTIME(witness.first_observed_at_ms / 1000),
                               witness.received_at), INTERVAL 1800 SECOND) <= UTC_TIMESTAMP(3)
                       LIMIT 1
                    ) THEN 'shared'
                    ELSE 'shared_empty' END AS sharing_status
         FROM friends f
         JOIN friends reverse_friend
           ON reverse_friend.user_id = f.friend_id AND reverse_friend.friend_id = f.user_id
         JOIN users u ON u.id = f.friend_id AND u.deleted_at IS NULL
         LEFT JOIN memory_share_grants g
           ON g.owner_id = f.friend_id AND g.viewer_id = f.user_id
          AND g.status = 'active'
         LEFT JOIN memory_share_policies p ON p.owner_id = g.owner_id
         LEFT JOIN friendship_episodes e
           ON e.id = g.friendship_episode_id AND e.ended_at IS NULL
         LEFT JOIN memory_subscriptions ms
           ON ms.user_id = f.user_id AND ms.friend_id = f.friend_id
        WHERE f.user_id = ?
          AND (g.id IS NULL OR e.id IS NOT NULL)
          AND (g.id IS NULL OR g.coverage_scope = 'full_history_delayed_v1' OR p.enabled = 1)
          AND NOT EXISTS (
            SELECT 1 FROM blocked_users b
             WHERE (b.blocker_id = f.friend_id AND b.blocked_id = f.user_id)
                OR (b.blocker_id = f.user_id AND b.blocked_id = f.friend_id)
          )
        ORDER BY u.name ASC, f.friend_id ASC
        LIMIT 1000`,
      [viewerId],
    );
    await conn.commit();
    return res.json({
      sources: rows.map(row => ({
        friend_id: String(row.friend_id),
        friend_name: row.friend_name,
        selected: row.sharing_status !== 'not_shared' && Boolean(row.selected),
        sharing_status: row.sharing_status,
        coverage_scope: row.coverage_scope ?? null,
        authorization_version: Number(row.authorization_version),
        effective_at: row.effective_at,
      })),
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-sharing/sources]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/grants', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT f.friend_id, u.name AS friend_name,
              CASE WHEN g.id IS NULL THEN 0 ELSE 1 END AS enabled,
              g.coverage_scope, g.consent_version, g.effective_at
         FROM friends f
         JOIN friends reverse_friend
           ON reverse_friend.user_id = f.friend_id AND reverse_friend.friend_id = f.user_id
         JOIN users u ON u.id = f.friend_id AND u.deleted_at IS NULL
         LEFT JOIN memory_share_grants g
           ON g.owner_id = f.user_id AND g.viewer_id = f.friend_id
          AND g.status = 'active' AND g.coverage_scope = 'full_history_delayed_v1'
        WHERE f.user_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM blocked_users b
             WHERE (b.blocker_id = f.user_id AND b.blocked_id = f.friend_id)
                OR (b.blocker_id = f.friend_id AND b.blocked_id = f.user_id)
          )
        ORDER BY u.name ASC, f.friend_id ASC`,
      [req.user.userId],
    );
    return res.json({
      delay_seconds: 1800,
      grants: rows.map(row => ({
        friend_id: String(row.friend_id),
        friend_name: row.friend_name,
        enabled: Boolean(row.enabled),
        coverage_scope: row.coverage_scope ?? null,
        consent_version: Number(row.consent_version ?? 0),
        effective_at: row.effective_at ?? null,
      })),
    });
  } catch (error) {
    console.error('[friend-sharing/grants:get]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/grants/:viewer_id', async (req, res) => {
  const ownerId = req.user.userId;
  const viewerId = Number(req.params.viewer_id);
  if (!Number.isInteger(viewerId) || viewerId <= 0 || String(viewerId) === String(ownerId)) {
    return res.status(400).json({ error: 'Valid friend id required' });
  }
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) required' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const lockIds = [Number(ownerId), viewerId].sort((a, b) => a - b);
    await conn.query('SELECT id FROM users WHERE id IN (?) ORDER BY id FOR UPDATE', [lockIds]);
    const result = await setExplicitMemoryGrant(conn, ownerId, viewerId, req.body.enabled);
    if (result.status === 'not_friends') {
      await conn.rollback();
      return res.status(404).json({ error: 'Friend not available' });
    }
    await conn.commit();
    return res.json({
      friend_id: String(viewerId),
      enabled: result.status === 'active',
      changed: result.changed,
      coverage_scope: result.grant?.coverage_scope ?? null,
      delay_seconds: 1800,
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-sharing/grants:put]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// Atomically apply one explicit selection to the CURRENT accepted-friend set.
// This never creates a rule for friends accepted later.
router.put('/grants', async (req, res) => {
  const ownerId = Number(req.user.userId);
  const requested = Array.isArray(req.body?.friend_ids) ? req.body.friend_ids : null;
  if (!requested) return res.status(400).json({ error: 'friend_ids array required' });
  const selected = [...new Set(requested.map(Number))];
  if (selected.length > 1000 || selected.some(id => !Number.isInteger(id) || id <= 0 || id === ownerId)) {
    return res.status(400).json({ error: 'Valid current friend ids required' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [friends] = await conn.execute(
      `SELECT forward.friend_id
         FROM friends forward
         JOIN friends reverse
           ON reverse.user_id=forward.friend_id AND reverse.friend_id=forward.user_id
         JOIN users friend ON friend.id=forward.friend_id AND friend.deleted_at IS NULL
        WHERE forward.user_id=?
          AND NOT EXISTS (
            SELECT 1 FROM blocked_users blocked
             WHERE (blocked.blocker_id=forward.user_id AND blocked.blocked_id=forward.friend_id)
                OR (blocked.blocker_id=forward.friend_id AND blocked.blocked_id=forward.user_id)
          )
        ORDER BY forward.friend_id FOR UPDATE`,
      [ownerId],
    );
    const currentIds = friends.map(friend => Number(friend.friend_id));
    const currentSet = new Set(currentIds);
    if (selected.some(id => !currentSet.has(id))) {
      await conn.rollback();
      return res.status(409).json({ error: 'Friend list changed; reload sharing choices' });
    }
    const selectedSet = new Set(selected);
    const applied = [];
    for (const friendId of currentIds) {
      const result = await setExplicitMemoryGrant(conn, ownerId, friendId, selectedSet.has(friendId));
      if (result.status === 'not_friends') {
        await conn.rollback();
        return res.status(409).json({ error: 'Friend list changed; reload sharing choices' });
      }
      applied.push({ friend_id: String(friendId), enabled: result.status === 'active' });
    }
    await conn.commit();
    return res.json({ applied, delay_seconds: 1800 });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-sharing/grants:bulk]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.post('/projections', async (req, res) => {
  const requested = Array.isArray(req.body?.friend_ids) ? req.body.friend_ids : [];
  const ids = [...new Set(requested.map(Number).filter(id => Number.isInteger(id) && id > 0))];
  if (ids.length > 100) return res.status(400).json({ error: 'At most 100 selected sources are allowed' });
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
  return res.json({ private_places: [], removed: true });
});

router.post('/private-places', async (req, res) => {
  return res.status(410).json({ error: 'Protected Places have been removed from Friends Memory.' });
});

router.delete('/private-places/:id', async (req, res) => {
  return res.status(410).json({ error: 'Protected Places have been removed from Friends Memory.' });
});

module.exports = router;
