'use strict';

const crypto = require('crypto');

function orderedPair(a, b) {
  const left = Number(a);
  const right = Number(b);
  return left < right ? [left, right] : [right, left];
}

async function currentFriendshipEpisode(db, userA, userB, lock = false) {
  const [low, high] = orderedPair(userA, userB);
  const [rows] = await db.execute(
    `SELECT id, episode_id, user_low_id, user_high_id, started_at
       FROM friendship_episodes
      WHERE user_low_id = ? AND user_high_id = ? AND ended_at IS NULL
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [low, high],
  );
  return rows[0] || null;
}

async function ensureFriendshipEpisode(db, userA, userB) {
  const existing = await currentFriendshipEpisode(db, userA, userB, true);
  if (existing) return existing;
  const [low, high] = orderedPair(userA, userB);
  const episodeId = crypto.randomUUID();
  const [result] = await db.execute(
    `INSERT INTO friendship_episodes
       (episode_id, user_low_id, user_high_id, started_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
    [episodeId, low, high],
  );
  return { id: result.insertId, episode_id: episodeId, user_low_id: low, user_high_id: high, started_at: new Date() };
}

async function revokePairGrants(db, userA, userB, reason) {
  await db.execute(
    `UPDATE memory_share_grants
        SET status = 'revoked', revoked_at = UTC_TIMESTAMP(3), revoked_reason = ?,
            authorization_version = authorization_version + 1
      WHERE status = 'active'
        AND ((owner_id = ? AND viewer_id = ?) OR (owner_id = ? AND viewer_id = ?))`,
    [reason, userA, userB, userB, userA],
  );
  await db.execute(
    `DELETE FROM memory_subscriptions
      WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
    [userA, userB, userB, userA],
  );
}

async function closeFriendshipEpisode(db, userA, userB, reason) {
  const episode = await currentFriendshipEpisode(db, userA, userB, true);
  if (episode) {
    await db.execute(
      `UPDATE friendship_episodes
          SET ended_at = UTC_TIMESTAMP(3), ended_reason = ?
        WHERE id = ? AND ended_at IS NULL`,
      [reason, episode.id],
    );
  }
  await revokePairGrants(db, userA, userB, reason);
}

async function provisionFriendshipGrants(db, userA, userB, episode) {
  // New friendships never inherit an owner's historical global preference.
  // Sharing accepted Memory history is a directional, explicit decision made
  // from Friends. Keep this function as a compatibility seam for callers.
  void db;
  void userA;
  void userB;
  void episode;
  return [];
}

async function setExplicitMemoryGrant(db, ownerId, viewerId, enabled) {
  const episode = await currentFriendshipEpisode(db, ownerId, viewerId, true);
  if (!episode) return { status: 'not_friends' };
  const [blocked] = await db.execute(
    `SELECT 1 FROM blocked_users
      WHERE (blocker_id = ? AND blocked_id = ?)
         OR (blocker_id = ? AND blocked_id = ?)
      LIMIT 1 FOR SHARE`,
    [ownerId, viewerId, viewerId, ownerId],
  );
  if (blocked[0]) return { status: 'not_friends' };
  const [active] = await db.execute(
    `SELECT id, grant_epoch, coverage_scope, authorization_version
       FROM memory_share_grants
      WHERE owner_id = ? AND viewer_id = ? AND status = 'active'
      LIMIT 1 FOR UPDATE`,
    [ownerId, viewerId],
  );
  if (!enabled) {
    if (!active[0]) return { status: 'revoked', changed: false };
    await db.execute(
      `UPDATE memory_share_grants
          SET status = 'revoked', revoked_at = UTC_TIMESTAMP(3),
              revoked_reason = 'corrective',
              authorization_version = authorization_version + 1
        WHERE id = ?`,
      [active[0].id],
    );
    await db.execute(
      'DELETE FROM memory_subscriptions WHERE user_id = ? AND friend_id = ?',
      [viewerId, ownerId],
    );
    return { status: 'revoked', changed: true };
  }
  if (active[0]?.coverage_scope === 'full_history_delayed_v1') {
    return { status: 'active', changed: false, grant: active[0] };
  }
  if (active[0]) {
    // Revoke the legacy row instead of silently widening its authority.
    await db.execute(
      `UPDATE memory_share_grants
          SET status = 'revoked', revoked_at = UTC_TIMESTAMP(3),
              revoked_reason = 'corrective',
              authorization_version = authorization_version + 1
        WHERE id = ?`,
      [active[0].id],
    );
  }
  const grantEpoch = crypto.randomUUID();
  const [result] = await db.execute(
    `INSERT INTO memory_share_grants
       (owner_id, viewer_id, friendship_episode_id, grant_epoch, effective_at,
        coverage_scope, consent_version)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), 'full_history_delayed_v1', 1)`,
    [ownerId, viewerId, episode.id, grantEpoch],
  );
  return {
    status: 'active',
    changed: true,
    grant: {
      id: result.insertId,
      grant_epoch: grantEpoch,
      coverage_scope: 'full_history_delayed_v1',
      authorization_version: 1,
    },
  };
}

async function currentMemoryGrant(db, ownerId, viewerId, { requireSelected = false } = {}) {
  const [rows] = await db.execute(
    `SELECT g.id, g.grant_epoch, g.effective_at, g.coverage_scope,
            g.consent_version, g.authorization_version,
            e.id AS friendship_episode_id, e.started_at AS friendship_started_at,
            0 AS policy_epoch
       FROM memory_share_grants g
       JOIN friendship_episodes e ON e.id = g.friendship_episode_id AND e.ended_at IS NULL
       JOIN friends f ON f.user_id = g.viewer_id AND f.friend_id = g.owner_id
       JOIN users owner ON owner.id = g.owner_id AND owner.deleted_at IS NULL
       JOIN users viewer ON viewer.id = g.viewer_id AND viewer.deleted_at IS NULL
       ${requireSelected ? 'JOIN memory_subscriptions ms ON ms.user_id = g.viewer_id AND ms.friend_id = g.owner_id' : ''}
      WHERE g.owner_id = ? AND g.viewer_id = ? AND g.status = 'active'
        AND g.coverage_scope = 'full_history_delayed_v1'
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users b
           WHERE (b.blocker_id = g.owner_id AND b.blocked_id = g.viewer_id)
              OR (b.blocker_id = g.viewer_id AND b.blocked_id = g.owner_id)
        )
      LIMIT 1`,
    [ownerId, viewerId],
  );
  return rows[0] || null;
}

async function areCurrentFriends(db, userA, userB) {
  const [rows] = await db.execute(
    `SELECT 1
       FROM friends forward
       JOIN friends reverse
         ON reverse.user_id = forward.friend_id AND reverse.friend_id = forward.user_id
       JOIN users target ON target.id = forward.friend_id AND target.deleted_at IS NULL
      WHERE forward.user_id = ? AND forward.friend_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users b
           WHERE (b.blocker_id = ? AND b.blocked_id = ?)
              OR (b.blocker_id = ? AND b.blocked_id = ?)
        )
      LIMIT 1`,
    [userA, userB, userA, userB, userB, userA],
  );
  return rows.length > 0;
}

async function authorizedFriendCairn(db, viewerId, markerId, { includeHidden = false } = {}) {
  const [rows] = await db.execute(
    `SELECT revision.marker_id AS id,revision.owner_id AS user_id,
            revision.content_type AS type,revision.content_text AS text,
            revision.lat,revision.lng,NULL AS alt,'group' AS permission,
            revision.approximate,revision.created_at,revision.created_at AS updated_at,
            revision.audience_epoch,revision.content_revision,
            revision.friend_author_name_snapshot AS author_name,
            acquisition.acquired_at AS encountered_at,acquisition.opened_at,
            NULL AS hidden_at
       FROM cairn_acquisitions acquisition
       JOIN cairn_revisions revision ON revision.id=acquisition.cairn_revision_id
       JOIN cairn_collections collection
         ON collection.viewer_id=acquisition.viewer_id
        AND collection.marker_id=acquisition.marker_id
       JOIN friends friend
         ON friend.user_id=acquisition.viewer_id AND friend.friend_id=revision.owner_id
       JOIN users owner ON owner.id=revision.owner_id AND owner.deleted_at IS NULL
       LEFT JOIN cairn_source_moderation moderation ON moderation.marker_id=revision.marker_id
       LEFT JOIN hidden_items hidden
         ON hidden.user_id=acquisition.viewer_id
        AND hidden.item_type='mark' AND hidden.item_id=acquisition.marker_id
      WHERE acquisition.viewer_id=? AND acquisition.marker_id=?
        AND acquisition.acquired_via='friends'
        AND acquisition.removed_at IS NULL AND collection.removed_at IS NULL
        ${includeHidden ? '' : 'AND hidden.user_id IS NULL'}
        AND revision.availability='available'
        AND COALESCE(moderation.state,'available')='available'
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users b
           WHERE (b.blocker_id=acquisition.viewer_id AND b.blocked_id=revision.owner_id)
              OR (b.blocker_id=revision.owner_id AND b.blocked_id=acquisition.viewer_id)
        )
      ORDER BY revision.content_revision DESC,acquisition.acquired_at DESC LIMIT 1`,
    [viewerId, markerId],
  );
  return rows[0] || null;
}

async function authorizedFriendRoute(db, viewerId, routeId, { includeHidden = false } = {}) {
  const [rows] = await db.execute(
    `SELECT r.id, r.user_id, r.name, r.description, r.points, r.waypoints,
            r.distance_m, r.elevation_gain_m, r.permission, r.audience_epoch,
            r.content_revision,
            r.created_at, r.updated_at, u.name AS author_name,
            episode.id AS friendship_episode_id
       FROM routes r
       JOIN friends f ON f.user_id = ? AND f.friend_id = r.user_id
       JOIN friendship_episodes episode
         ON episode.user_low_id = LEAST(f.user_id, f.friend_id)
        AND episode.user_high_id = GREATEST(f.user_id, f.friend_id)
        AND episode.ended_at IS NULL
       JOIN users u ON u.id = r.user_id AND u.deleted_at IS NULL
       LEFT JOIN hidden_items hidden
         ON hidden.user_id = ? AND hidden.item_type = 'route' AND hidden.item_id = r.id
      WHERE r.id = ? AND r.permission = 'friend'
        ${includeHidden ? '' : 'AND hidden.user_id IS NULL'}
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users b
           WHERE (b.blocker_id = ? AND b.blocked_id = r.user_id)
              OR (b.blocker_id = r.user_id AND b.blocked_id = ?)
        )
      LIMIT 1`,
    [viewerId, viewerId, routeId, viewerId, viewerId],
  );
  return rows[0] || null;
}

module.exports = {
  orderedPair,
  currentFriendshipEpisode,
  ensureFriendshipEpisode,
  closeFriendshipEpisode,
  revokePairGrants,
  provisionFriendshipGrants,
  setExplicitMemoryGrant,
  currentMemoryGrant,
  areCurrentFriends,
  authorizedFriendCairn,
  authorizedFriendRoute,
};
