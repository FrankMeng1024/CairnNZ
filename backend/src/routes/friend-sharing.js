'use strict';

const express = require('express');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const {
  currentMemoryGrant,
  setExplicitMemoryGrant,
} = require('../services/friendAuthorization');
const { deriveFriendProjection } = require('../services/friendProjection');
const { loadCoverageRegions, loadPreparedCoverage, parseViewport } = require('../services/memoryCoverage');

const router = express.Router();
router.use(authenticate);

router.get('/policy', async (req, res) => {
  return res.json({ enabled: false, retired: true, policy_epoch: 0, enabled_at: null, updated_at: null });
});

router.put('/policy', async (req, res) => {
  return res.status(410).json({ error: 'Global Memory sharing has been retired. Choose friends individually.' });
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
           JOIN friendship_episodes e
             ON e.id = g.friendship_episode_id AND e.ended_at IS NULL
           JOIN friends f ON f.user_id = g.viewer_id AND f.friend_id = g.owner_id
          WHERE g.viewer_id = ? AND g.status = 'active'
            AND g.coverage_scope = 'full_history_delayed_v1'
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
                      SELECT 1 FROM memory_coverage_evidence evidence
                       WHERE evidence.owner_id=f.friend_id
                         AND evidence.coverage_rule_version=4
                         AND evidence.share_ready_at<=UTC_TIMESTAMP(3)
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
         LEFT JOIN friendship_episodes e
           ON e.id = g.friendship_episode_id AND e.ended_at IS NULL
         LEFT JOIN memory_subscriptions ms
           ON ms.user_id = f.user_id AND ms.friend_id = f.friend_id
        WHERE f.user_id = ?
          AND (g.id IS NULL OR e.id IS NOT NULL)
          AND (g.id IS NULL OR g.coverage_scope = 'full_history_delayed_v1')
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

router.put('/grants', (req, res) => {
  return res.status(410).json({ error: 'Bulk Memory sharing has been retired. Choose one friend at a time.' });
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

// O86 viewport-bounded coverage. The legacy /projections endpoint remains for
// older installed clients; current clients use this exact 30m representation.
router.post('/coverage', async (req, res) => {
  const requested = Array.isArray(req.body?.friend_ids) ? req.body.friend_ids : [];
  const ids = [...new Set(requested.map(Number).filter(id => Number.isInteger(id) && id > 0))];
  const viewport = parseViewport(req.body?.viewport_bbox);
  if (ids.length > 100) return res.status(400).json({ error: 'At most 100 selected sources are allowed' });
  if (!viewport) return res.status(400).json({ error: 'Valid viewport_bbox is required' });
  const startedAt = Date.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // The same sorted user locks are taken by grant revocation/unfriend. Hold
    // them through the prepared read and final authorization check so a
    // queued revoke commits before any later request can return old authority.
    const lockIds = [...new Set([Number(req.user.userId), ...ids])].sort((a, b) => a - b);
    if (lockIds.length > 0) {
      await conn.query('SELECT id FROM users WHERE id IN (?) ORDER BY id FOR UPDATE', [lockIds]);
    }
    const projections = [];
    const revokedFriendIds = [];
    for (const ownerId of ids) {
      const authorizationStartedAt = Date.now();
      const grant = await currentMemoryGrant(conn, ownerId, req.user.userId, { requireSelected: true });
      const authorizationMs = Date.now() - authorizationStartedAt;
      if (!grant) {
        revokedFriendIds.push(String(ownerId));
        continue;
      }
      const geometryStartedAt = Date.now();
      const [coverage, regions] = await Promise.all([
        loadPreparedCoverage(conn, ownerId, 'shared', viewport),
        loadCoverageRegions(conn, ownerId, 'shared'),
      ]);
      const geometryMs = Date.now() - geometryStartedAt;
      const revalidated = await currentMemoryGrant(conn, ownerId, req.user.userId, { requireSelected: true });
      if (!revalidated
        || revalidated.grant_epoch !== grant.grant_epoch
        || Number(revalidated.authorization_version) !== Number(grant.authorization_version)) {
        revokedFriendIds.push(String(ownerId));
        continue;
      }
      projections.push({
        source_friend_id: String(ownerId),
        authorization_version: Number(grant.authorization_version),
        projection_version: coverage.coverage_version,
        coverage_rule_version: coverage.coverage_rule_version,
        radius_m: coverage.radius_m,
        ring_steps: coverage.ring_steps,
        contribution_delay_seconds: 1800,
        coverage_scope: 'full_history_delayed_v1',
        geometry: coverage.geometry,
        regions,
        evidence_count: coverage.evidence_count,
        tile_count: coverage.tile_count,
        rebuilt_tile_count: coverage.rebuilt_tile_count,
        stage_ms: {
          authorization: authorizationMs,
          prepared_geometry: geometryMs,
          ...coverage.stage_ms,
        },
      });
    }
    await conn.commit();
    const authorizedAt = new Date();
    const expiresAt = new Date(authorizedAt.getTime() + 24 * 60 * 60 * 1000);
    return res.json({
      server_authorized_at: authorizedAt.toISOString(),
      authorization_expires_at: expiresAt.toISOString(),
      coverage_rule_version: 4,
      total_ms: Date.now() - startedAt,
      projections: projections.map(projection => ({
        ...projection,
        server_authorized_at: authorizedAt.toISOString(),
        authorization_expires_at: expiresAt.toISOString(),
      })),
      revoked_friend_ids: revokedFriendIds,
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-sharing/coverage]', error.message);
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
