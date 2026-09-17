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

async function createGrantIfPolicyEnabled(db, ownerId, viewerId, episode) {
  const [policyRows] = await db.execute(
    `SELECT enabled FROM memory_share_policies WHERE owner_id = ? LIMIT 1 FOR UPDATE`,
    [ownerId],
  );
  if (!policyRows[0]?.enabled) return null;
  const [activeRows] = await db.execute(
    `SELECT id, grant_epoch, effective_at, authorization_version
       FROM memory_share_grants
      WHERE owner_id = ? AND viewer_id = ? AND status = 'active'
      LIMIT 1 FOR UPDATE`,
    [ownerId, viewerId],
  );
  if (activeRows[0]) return activeRows[0];
  const grantEpoch = crypto.randomUUID();
  const [result] = await db.execute(
    `INSERT INTO memory_share_grants
       (owner_id, viewer_id, friendship_episode_id, grant_epoch, effective_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [ownerId, viewerId, episode.id, grantEpoch],
  );
  return { id: result.insertId, grant_epoch: grantEpoch, authorization_version: 1 };
}

async function provisionFriendshipGrants(db, userA, userB, episode) {
  await createGrantIfPolicyEnabled(db, userA, userB, episode);
  await createGrantIfPolicyEnabled(db, userB, userA, episode);
}

async function currentMemoryGrant(db, ownerId, viewerId, { requireSelected = false } = {}) {
  const [rows] = await db.execute(
    `SELECT g.id, g.grant_epoch, g.effective_at, g.authorization_version,
            e.id AS friendship_episode_id, e.started_at AS friendship_started_at,
            p.policy_epoch
       FROM memory_share_grants g
       JOIN memory_share_policies p ON p.owner_id = g.owner_id AND p.enabled = 1
       JOIN friendship_episodes e ON e.id = g.friendship_episode_id AND e.ended_at IS NULL
       JOIN friends f ON f.user_id = g.viewer_id AND f.friend_id = g.owner_id
       JOIN users owner ON owner.id = g.owner_id AND owner.deleted_at IS NULL
       JOIN users viewer ON viewer.id = g.viewer_id AND viewer.deleted_at IS NULL
       ${requireSelected ? 'JOIN memory_subscriptions ms ON ms.user_id = g.viewer_id AND ms.friend_id = g.owner_id' : ''}
      WHERE g.owner_id = ? AND g.viewer_id = ? AND g.status = 'active'
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
    `SELECT m.id, m.user_id, m.type, m.text, m.lat, m.lng, m.alt,
            m.permission, m.approximate, m.created_at, m.updated_at,
            m.audience_epoch, u.name AS author_name,
            encounter.created_at AS encountered_at, encounter.opened_at, encounter.hidden_at
       FROM friend_cairn_encounters encounter
       JOIN markers m
         ON m.id = encounter.marker_id
        AND m.user_id = encounter.author_id
        AND m.permission = 'group'
        AND m.audience_epoch = encounter.audience_epoch
        AND m.status <> 'hidden'
       JOIN friends f ON f.user_id = encounter.viewer_id AND f.friend_id = encounter.author_id
       JOIN friendship_episodes episode
         ON episode.id = encounter.friendship_episode_id AND episode.ended_at IS NULL
       JOIN users u ON u.id = encounter.author_id AND u.deleted_at IS NULL
      WHERE encounter.viewer_id = ? AND encounter.marker_id = ?
        ${includeHidden ? '' : 'AND encounter.hidden_at IS NULL'}
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users b
           WHERE (b.blocker_id = encounter.viewer_id AND b.blocked_id = encounter.author_id)
              OR (b.blocker_id = encounter.author_id AND b.blocked_id = encounter.viewer_id)
        )
      LIMIT 1`,
    [viewerId, markerId],
  );
  return rows[0] || null;
}

async function authorizedFriendRoute(db, viewerId, routeId, { includeHidden = false } = {}) {
  const [rows] = await db.execute(
    `SELECT r.id, r.user_id, r.name, r.description, r.points, r.waypoints,
            r.distance_m, r.elevation_gain_m, r.permission, r.audience_epoch,
            r.created_at, r.updated_at, u.name AS author_name
       FROM routes r
       JOIN friends f ON f.user_id = ? AND f.friend_id = r.user_id
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
  createGrantIfPolicyEnabled,
  provisionFriendshipGrants,
  currentMemoryGrant,
  areCurrentFriends,
  authorizedFriendCairn,
  authorizedFriendRoute,
};
