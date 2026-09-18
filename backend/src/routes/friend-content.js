'use strict';

const crypto = require('crypto');
const express = require('express');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const {
  currentFriendshipEpisode,
  authorizedFriendCairn,
  authorizedFriendRoute,
} = require('../services/friendAuthorization');
const {
  ENCOUNTER_RADIUS_M,
  MAX_HORIZONTAL_ACCURACY_M,
  selectQualifyingEncounterEvidence,
} = require('../services/encounterPolicy');

const router = express.Router();
router.use(authenticate);

function opaqueUnavailable(res) {
  return res.status(404).json({ error: 'Content not available' });
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

const SHARED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function sharedContentMetadata(kind, row) {
  const issuedAt = new Date();
  const revisionInput = [kind, row.id, row.updated_at, row.audience_epoch].join(':');
  return {
    resource_revision: crypto.createHash('sha256').update(revisionInput).digest('hex'),
    authorization_revision: `friendship:${row.friendship_episode_id}:audience:${row.audience_epoch}`,
    authorization_issued_at: issuedAt.toISOString(),
    authorization_expires_at: new Date(issuedAt.getTime() + SHARED_CACHE_TTL_MS).toISOString(),
  };
}

function publicCairn(row) {
  return {
    id: Number(row.id),
    author: { id: String(row.user_id), name: row.author_name },
    type: row.type,
    text: row.text,
    lat: Number(row.lat),
    lng: Number(row.lng),
    alt: row.alt == null ? null : Number(row.alt),
    approximate: Boolean(row.approximate),
    created_at: row.created_at,
    updated_at: row.updated_at,
    encountered_at: row.encountered_at,
    ...sharedContentMetadata('cairn', row),
    read_only: true,
    role: 'viewer',
  };
}

function publicRoute(row, includeGeometry = false) {
  return {
    id: Number(row.id),
    author: { id: String(row.user_id), name: row.author_name },
    name: row.name,
    description: row.description,
    distance_m: Number(row.distance_m),
    elevation_gain_m: Number(row.elevation_gain_m),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(includeGeometry ? {
      points: parseJson(row.points, []),
      waypoints: parseJson(row.waypoints, []),
    } : {}),
    ...sharedContentMetadata('route', row),
    read_only: true,
    role: 'viewer',
  };
}

router.post('/encounters/verify', async (req, res) => {
  let markerIds = [...new Set((Array.isArray(req.body?.marker_ids) ? req.body.marker_ids : [])
    .map(Number).filter(id => Number.isInteger(id) && id > 0))];
  if (markerIds.length > 50) {
    return res.status(400).json({ error: 'marker_ids must contain at most 50 ids' });
  }
  const viewerId = req.user.userId;
  const conn = await pool.getConnection();
  const encountered = [];
  try {
    await conn.beginTransaction();
    // Normal clients do not possess a locked Cairn catalogue. An empty list
    // asks the server to consider current friend-visible candidates without
    // disclosing any candidate identity unless encounter evidence qualifies.
    if (markerIds.length === 0) {
      const [candidates] = await conn.execute(
        `SELECT m.id
           FROM markers m
           JOIN friends f ON f.user_id = ? AND f.friend_id = m.user_id
           JOIN marker_audience_epochs audience
             ON audience.marker_id = m.id
            AND audience.audience_epoch = m.audience_epoch
            AND audience.visibility = 'group'
            AND audience.ends_at IS NULL
           JOIN users owner ON owner.id = m.user_id AND owner.deleted_at IS NULL
          WHERE m.permission = 'group' AND m.status <> 'hidden'
            AND NOT EXISTS (
              SELECT 1 FROM blocked_users b
               WHERE (b.blocker_id = ? AND b.blocked_id = m.user_id)
                  OR (b.blocker_id = m.user_id AND b.blocked_id = ?)
            )
          ORDER BY m.updated_at DESC, m.id DESC
          LIMIT 500`,
        [viewerId, viewerId, viewerId],
      );
      markerIds = candidates.map(row => Number(row.id));
    }
    for (const markerId of markerIds) {
      const [markers] = await conn.execute(
        `SELECT m.id, m.user_id, m.lat, m.lng, m.audience_epoch, m.created_at,
                audience.starts_at
           FROM markers m
           JOIN marker_audience_epochs audience
             ON audience.marker_id = m.id
            AND audience.audience_epoch = m.audience_epoch
            AND audience.visibility = 'group'
            AND audience.ends_at IS NULL
           JOIN users owner ON owner.id = m.user_id AND owner.deleted_at IS NULL
          WHERE m.id = ? AND m.permission = 'group' AND m.status <> 'hidden'
          LIMIT 1 FOR UPDATE`,
        [markerId],
      );
      const marker = markers[0];
      if (!marker || String(marker.user_id) === String(viewerId)) continue;
      const episode = await currentFriendshipEpisode(conn, viewerId, marker.user_id, true);
      if (!episode) continue;
      const [blocks] = await conn.execute(
        `SELECT 1 FROM blocked_users
          WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
          LIMIT 1`,
        [viewerId, marker.user_id, marker.user_id, viewerId],
      );
      if (blocks[0]) continue;
      const [evidenceRows] = await conn.execute(
        `SELECT evidence.id, evidence.lat, evidence.lng, evidence.ts,
                evidence.evidence_source, evidence.evidence_kind,
                evidence.source_activity_client_id
           FROM (
             SELECT witness.id, witness.first_lat AS lat, witness.first_lng AS lng,
                    witness.first_observed_at_ms AS ts, witness.evidence_source,
                    witness.source_activity_client_id,
                    'presence_witness' AS evidence_kind
               FROM memory_presence_witnesses witness
              WHERE witness.user_id = ?
                AND witness.continuity_state = 'accepted'
                AND witness.horizontal_accuracy_m <= ?
             UNION ALL
             SELECT witness.id, witness.lat, witness.lng,
                    witness.observed_at_ms AS ts, witness.evidence_source,
                    witness.source_activity_client_id,
                    'presence_witness' AS evidence_kind
               FROM memory_presence_witnesses witness
              WHERE witness.user_id = ?
                AND witness.continuity_state = 'accepted'
                AND witness.horizontal_accuracy_m <= ?
                AND witness.observed_at_ms > witness.first_observed_at_ms
             UNION ALL
             SELECT point.id, point.lat, point.lng, point.ts,
                    point.evidence_source, point.source_activity_client_id,
                    'legacy_coverage' AS evidence_kind
               FROM memory_points point
              WHERE point.user_id = ?
                AND point.evidence_source IN ('activity_real','passive_real')
                AND point.continuity_state = 'accepted'
                AND point.horizontal_accuracy_m IS NOT NULL
                AND point.horizontal_accuracy_m <= ?
           ) evidence
          WHERE ST_Distance_Sphere(POINT(evidence.lng, evidence.lat), POINT(?, ?)) <= ?
            AND FROM_UNIXTIME(evidence.ts / 1000) >= GREATEST(?, ?, ?)
            AND evidence.ts <= (UNIX_TIMESTAMP(UTC_TIMESTAMP(3)) * 1000) + 300000
            AND (evidence.evidence_source = 'passive_real' OR EXISTS (
              SELECT 1 FROM sessions session
               WHERE session.user_id = ?
                 AND session.client_activity_id = evidence.source_activity_client_id
                 AND session.finalized_at IS NOT NULL
                 AND session.abandoned_at IS NULL
            ))
          ORDER BY evidence.ts DESC, evidence.id DESC
          LIMIT 100`,
        [viewerId, MAX_HORIZONTAL_ACCURACY_M,
          viewerId, MAX_HORIZONTAL_ACCURACY_M,
          viewerId, MAX_HORIZONTAL_ACCURACY_M,
          marker.lng, marker.lat, ENCOUNTER_RADIUS_M,
          episode.started_at, marker.created_at, marker.starts_at, viewerId],
      );
      const evidence = selectQualifyingEncounterEvidence(evidenceRows);
      if (!evidence) continue;
      await conn.execute(
        `INSERT INTO friend_cairn_encounters
           (viewer_id, author_id, marker_id, friendship_episode_id, audience_epoch,
            evidence_point_id, evidence_kind, evidence_source, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000))
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [viewerId, marker.user_id, marker.id, episode.id, marker.audience_epoch,
          evidence.id, evidence.evidence_kind, evidence.evidence_source, evidence.ts],
      );
      encountered.push(String(marker.id));
    }
    await conn.commit();
    return res.json({ encountered_marker_ids: encountered });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-content/encounters/verify]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/cairns', async (req, res) => {
  const friendId = req.query.friend_id === undefined ? null : Number(req.query.friend_id);
  if (friendId !== null && (!Number.isInteger(friendId) || friendId <= 0)) {
    return res.status(400).json({ error: 'Invalid friend_id' });
  }
  try {
    const params = [req.user.userId];
    const friendClause = friendId === null ? '' : 'AND encounter.author_id = ?';
    if (friendId !== null) params.push(friendId);
    const [rows] = await pool.execute(
      `SELECT m.id, m.user_id, m.type, m.text, m.lat, m.lng, m.alt, m.approximate,
              m.created_at, m.updated_at, m.audience_epoch, u.name AS author_name,
              encounter.friendship_episode_id,
              encounter.created_at AS encountered_at
         FROM friend_cairn_encounters encounter
         JOIN markers m
           ON m.id = encounter.marker_id AND m.user_id = encounter.author_id
          AND m.permission = 'group' AND m.audience_epoch = encounter.audience_epoch
          AND m.status <> 'hidden'
         JOIN friendship_episodes episode
           ON episode.id = encounter.friendship_episode_id AND episode.ended_at IS NULL
         JOIN friends f ON f.user_id = encounter.viewer_id AND f.friend_id = encounter.author_id
         JOIN users u ON u.id = encounter.author_id AND u.deleted_at IS NULL
        WHERE encounter.viewer_id = ? AND encounter.hidden_at IS NULL
          ${friendClause}
          AND NOT EXISTS (
            SELECT 1 FROM blocked_users b
             WHERE (b.blocker_id = encounter.viewer_id AND b.blocked_id = encounter.author_id)
                OR (b.blocker_id = encounter.author_id AND b.blocked_id = encounter.viewer_id)
          )
        ORDER BY encounter.created_at DESC LIMIT 1000`,
      params,
    );
    return res.json({ cairns: rows.map(publicCairn) });
  } catch (error) {
    console.error('[friend-content/cairns:list]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/cairns/:id', async (req, res) => {
  const markerId = Number(req.params.id);
  if (!Number.isInteger(markerId) || markerId <= 0) return opaqueUnavailable(res);
  try {
    const cairn = await authorizedFriendCairn(pool, req.user.userId, markerId);
    if (!cairn) return opaqueUnavailable(res);
    await pool.execute(
      `UPDATE friend_cairn_encounters SET opened_at = COALESCE(opened_at, UTC_TIMESTAMP(3))
        WHERE viewer_id = ? AND marker_id = ?`,
      [req.user.userId, markerId],
    );
    return res.json({ cairn: publicCairn(cairn) });
  } catch (error) {
    console.error('[friend-content/cairns:get]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/cairns/:id/hide', async (req, res) => {
  const markerId = Number(req.params.id);
  if (!Number.isInteger(markerId) || markerId <= 0) return opaqueUnavailable(res);
  try {
    const cairn = await authorizedFriendCairn(pool, req.user.userId, markerId, { includeHidden: true });
    if (!cairn) return opaqueUnavailable(res);
    await pool.execute(
      `UPDATE friend_cairn_encounters SET hidden_at = UTC_TIMESTAMP(3)
        WHERE viewer_id = ? AND marker_id = ?`,
      [req.user.userId, markerId],
    );
    await pool.execute(
      `INSERT INTO hidden_items (user_id, item_type, item_id) VALUES (?, 'mark', ?)
       ON DUPLICATE KEY UPDATE hidden_at = hidden_at`,
      [req.user.userId, markerId],
    );
    return res.json({ hidden: true });
  } catch (error) {
    console.error('[friend-content/cairns:hide]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/routes', async (req, res) => {
  const friendId = req.query.friend_id === undefined ? null : Number(req.query.friend_id);
  if (friendId !== null && (!Number.isInteger(friendId) || friendId <= 0)) {
    return res.status(400).json({ error: 'Invalid friend_id' });
  }
  try {
    const params = [req.user.userId, req.user.userId, req.user.userId, req.user.userId];
    const friendClause = friendId === null ? '' : 'AND route.user_id = ?';
    if (friendId !== null) params.push(friendId);
    const [rows] = await pool.execute(
      `SELECT route.id, route.user_id, route.name, route.description, route.distance_m,
              route.elevation_gain_m, route.created_at, route.updated_at,
              route.audience_epoch, episode.id AS friendship_episode_id, u.name AS author_name
         FROM routes route
         JOIN friends f ON f.user_id = ? AND f.friend_id = route.user_id
         JOIN friendship_episodes episode
           ON episode.user_low_id = LEAST(f.user_id, f.friend_id)
          AND episode.user_high_id = GREATEST(f.user_id, f.friend_id)
          AND episode.ended_at IS NULL
         JOIN users u ON u.id = route.user_id AND u.deleted_at IS NULL
         LEFT JOIN hidden_items hidden
           ON hidden.user_id = ? AND hidden.item_type = 'route' AND hidden.item_id = route.id
        WHERE route.permission = 'friend' AND hidden.user_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM blocked_users b
             WHERE (b.blocker_id = ? AND b.blocked_id = route.user_id)
                OR (b.blocker_id = route.user_id AND b.blocked_id = ?)
          )
          ${friendClause}
        ORDER BY route.updated_at DESC LIMIT 1000`,
      params,
    );
    return res.json({ routes: rows.map(row => publicRoute(row, false)) });
  } catch (error) {
    console.error('[friend-content/routes:list]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/routes/:id', async (req, res) => {
  const routeId = Number(req.params.id);
  if (!Number.isInteger(routeId) || routeId <= 0) return opaqueUnavailable(res);
  try {
    const route = await authorizedFriendRoute(pool, req.user.userId, routeId);
    if (!route) return opaqueUnavailable(res);
    return res.json({ route: publicRoute(route, true) });
  } catch (error) {
    console.error('[friend-content/routes:get]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/routes/:id/hide', async (req, res) => {
  const routeId = Number(req.params.id);
  if (!Number.isInteger(routeId) || routeId <= 0) return opaqueUnavailable(res);
  try {
    const route = await authorizedFriendRoute(pool, req.user.userId, routeId, { includeHidden: true });
    if (!route) return opaqueUnavailable(res);
    await pool.execute(
      `INSERT INTO hidden_items (user_id, item_type, item_id) VALUES (?, 'route', ?)
       ON DUPLICATE KEY UPDATE hidden_at = hidden_at`,
      [req.user.userId, routeId],
    );
    return res.json({ hidden: true });
  } catch (error) {
    console.error('[friend-content/routes:hide]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/routes/:id/lease', async (req, res) => {
  const routeId = Number(req.params.id);
  if (!Number.isInteger(routeId) || routeId <= 0) return opaqueUnavailable(res);
  try {
    const route = await authorizedFriendRoute(pool, req.user.userId, routeId);
    if (!route) return opaqueUnavailable(res);
    const points = parseJson(route.points, []);
    const snapshot = {
      name: route.name,
      distance_m: Number(route.distance_m),
      elevation_gain_m: Number(route.elevation_gain_m),
      points,
    };
    const contentVersion = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const leaseId = crypto.randomUUID();
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + 12 * 60 * 60 * 1000;
    await pool.execute(
      `INSERT INTO shared_route_leases
         (id, viewer_id, owner_id, route_id, audience_epoch, authorization_version,
          content_version, geometry_snapshot, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON),
               FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
      [leaseId, req.user.userId, route.user_id, route.id, route.audience_epoch,
        route.audience_epoch, contentVersion, JSON.stringify(snapshot), issuedAtMs, expiresAtMs],
    );
    return res.status(201).json({
      lease_id: leaseId,
      content_version: contentVersion,
      authorization_revision: `friendship:${route.friendship_episode_id}:audience:${route.audience_epoch}`,
      issued_at: new Date(issuedAtMs).toISOString(),
      expires_at: new Date(expiresAtMs).toISOString(),
      expires_in_seconds: 12 * 60 * 60,
      route: {
        id: Number(route.id),
        author: { id: String(route.user_id), name: route.author_name },
        name: route.name,
        distance_m: Number(route.distance_m),
        elevation_gain_m: Number(route.elevation_gain_m),
        points,
        read_only: true,
      },
    });
  } catch (error) {
    console.error('[friend-content/routes:lease]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/route-leases/:id/start', async (req, res) => {
  const activityId = typeof req.body?.client_activity_id === 'string' ? req.body.client_activity_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(activityId)) return res.status(400).json({ error: 'client_activity_id required' });
  const requestedStartedAtMs = Number(req.body?.started_at_ms);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [leases] = await conn.execute(
      `SELECT * FROM shared_route_leases
        WHERE id = ? AND viewer_id = ? AND revoked_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [req.params.id, req.user.userId],
    );
    const lease = leases[0];
    if (!lease) {
      await conn.rollback();
      return opaqueUnavailable(res);
    }
    if (lease.use_started_at) {
      if (String(lease.active_activity_client_id) !== activityId) {
        await conn.rollback();
        return opaqueUnavailable(res);
      }
      await conn.commit();
      return res.json({
        started: true,
        ended: Boolean(lease.use_ended_at),
        lease_id: lease.id,
        content_version: lease.content_version,
        idempotent: true,
      });
    }
    const issuedAtMs = new Date(lease.issued_at).getTime();
    const expiresAtMs = new Date(lease.expires_at).getTime();
    const nowMs = Date.now();
    const startedAtMs = Number.isFinite(requestedStartedAtMs) ? requestedStartedAtMs : nowMs;
    if (startedAtMs < issuedAtMs || startedAtMs > expiresAtMs || startedAtMs > nowMs + 5 * 60 * 1000) {
      await conn.rollback();
      return opaqueUnavailable(res);
    }
    const route = await authorizedFriendRoute(conn, req.user.userId, lease.route_id);
    // A connected start always checks current authorization. A delayed
    // acknowledgement for an offline start is bounded by the previously
    // issued lease instead; it never grants any content beyond the immutable
    // minimal geometry snapshot already downloaded to that viewer.
    if (!Number.isFinite(requestedStartedAtMs)
        && (!route || Number(route.audience_epoch) !== Number(lease.audience_epoch))) {
      await conn.execute(
        `UPDATE shared_route_leases SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [lease.id],
      );
      await conn.commit();
      return opaqueUnavailable(res);
    }
    await conn.execute(
      `UPDATE shared_route_leases
          SET active_activity_client_id = ?, use_started_at = FROM_UNIXTIME(? / 1000),
              start_acknowledged_at = UTC_TIMESTAMP(3)
        WHERE id = ?`,
      [activityId, startedAtMs, lease.id],
    );
    await conn.commit();
    return res.json({ started: true, lease_id: lease.id, content_version: lease.content_version });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[friend-content/route-leases:start]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.post('/route-leases/:id/end', async (req, res) => {
  const activityId = typeof req.body?.client_activity_id === 'string' ? req.body.client_activity_id : '';
  const terminal = req.body?.terminal === 'discarded' ? 'discarded' : 'finished';
  const requestedEndedAtMs = Number(req.body?.ended_at_ms);
  try {
    const [rows] = await pool.execute(
      `SELECT id, active_activity_client_id, use_started_at, use_ended_at
         FROM shared_route_leases WHERE id = ? AND viewer_id = ? LIMIT 1`,
      [req.params.id, req.user.userId],
    );
    const lease = rows[0];
    if (!lease || !lease.use_started_at
        || (activityId && String(lease.active_activity_client_id) !== activityId)) return opaqueUnavailable(res);
    if (lease.use_ended_at) return res.json({ ended: true, idempotent: true });
    const nowMs = Date.now();
    const startMs = new Date(lease.use_started_at).getTime();
    const endedAtMs = Number.isFinite(requestedEndedAtMs) ? requestedEndedAtMs : nowMs;
    if (endedAtMs < startMs || endedAtMs > nowMs + 5 * 60 * 1000) return res.status(400).json({ error: 'Invalid ended_at_ms' });
    await pool.execute(
      `UPDATE shared_route_leases
          SET use_ended_at = FROM_UNIXTIME(? / 1000), end_acknowledged_at = UTC_TIMESTAMP(3), terminal_reason = ?
        WHERE id = ? AND viewer_id = ? AND use_ended_at IS NULL`,
      [endedAtMs, terminal, req.params.id, req.user.userId],
    );
    return res.json({ ended: true, idempotent: false });
  } catch (error) {
    console.error('[friend-content/route-leases:end]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/route-leases/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, route_id, owner_id, content_version, geometry_snapshot,
              use_started_at, use_ended_at, expires_at, revoked_at
         FROM shared_route_leases WHERE id = ? AND viewer_id = ? LIMIT 1`,
      [req.params.id, req.user.userId],
    );
    const lease = rows[0];
    if (!lease || !lease.use_started_at || lease.use_ended_at) return opaqueUnavailable(res);
    return res.json({
      lease_id: lease.id,
      route_id: String(lease.route_id),
      content_version: lease.content_version,
      route: parseJson(lease.geometry_snapshot, null),
      safety_snapshot: true,
    });
  } catch (error) {
    console.error('[friend-content/route-leases:get]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
