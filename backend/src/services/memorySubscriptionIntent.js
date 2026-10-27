'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COVERAGE_SCOPE = 'full_history_delayed_v1';

function parseOrderedSelectionIntent(body) {
  const orderedKeys = [
    'selection_chain_id',
    'selection_request_id',
    'selection_sequence',
    'grant_epoch',
    'friendship_episode_id',
    'authorization_version',
    'coverage_scope',
  ];
  const hasOrderedEnvelope = orderedKeys.some(key => Object.prototype.hasOwnProperty.call(body || {}, key));
  if (!hasOrderedEnvelope) return null;
  const chainId = body?.selection_chain_id;
  const requestId = body?.selection_request_id;
  const sequence = Number(body?.selection_sequence);
  if (!UUID_RE.test(String(chainId ?? ''))
    || !UUID_RE.test(String(requestId ?? ''))
    || !Number.isSafeInteger(sequence)
    || sequence <= 0) return { invalid: true };
  return {
    chainId: String(chainId),
    requestId: String(requestId),
    sequence,
    expectedGrantEpoch: body?.grant_epoch == null ? null : String(body.grant_epoch),
    expectedFriendshipEpisodeId: body?.friendship_episode_id == null
      ? null
      : String(body.friendship_episode_id),
    expectedAuthorizationVersion: body?.authorization_version == null
      ? null
      : Number(body.authorization_version),
    expectedCoverageScope: body?.coverage_scope == null ? null : String(body.coverage_scope),
  };
}

async function lockCurrentGrant(conn, ownerId, viewerId) {
  const [episodes] = await conn.execute(
    `SELECT id
       FROM friendship_episodes
      WHERE user_low_id = LEAST(?, ?) AND user_high_id = GREATEST(?, ?)
        AND ended_at IS NULL
      LIMIT 1 FOR UPDATE`,
    [ownerId, viewerId, ownerId, viewerId],
  );
  if (!episodes[0]) return null;
  const [rows] = await conn.execute(
    `SELECT g.grant_epoch, g.friendship_episode_id, g.authorization_version,
            g.coverage_scope
       FROM memory_share_grants g
       JOIN friendship_episodes e
         ON e.id = g.friendship_episode_id AND e.ended_at IS NULL
       JOIN friends f ON f.user_id = g.viewer_id AND f.friend_id = g.owner_id
       JOIN users owner ON owner.id = g.owner_id AND owner.deleted_at IS NULL
       JOIN users viewer ON viewer.id = g.viewer_id AND viewer.deleted_at IS NULL
      WHERE g.owner_id = ? AND g.viewer_id = ? AND g.status = 'active'
        AND g.coverage_scope = ?
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users b
           WHERE (b.blocker_id = g.owner_id AND b.blocked_id = g.viewer_id)
              OR (b.blocker_id = g.viewer_id AND b.blocked_id = g.owner_id)
        )
      LIMIT 1 FOR UPDATE`,
    [ownerId, viewerId, COVERAGE_SCOPE],
  );
  return rows[0] || null;
}

function grantMatches(intent, grant) {
  return Boolean(grant)
    && intent.expectedGrantEpoch === String(grant.grant_epoch)
    && intent.expectedFriendshipEpisodeId === String(grant.friendship_episode_id)
    && intent.expectedAuthorizationVersion === Number(grant.authorization_version)
    && intent.expectedCoverageScope === grant.coverage_scope;
}

function currentSelectionBody(head, code = 'SELECTION_INTENT_REPLAY') {
  return {
    code,
    selected: Boolean(head.selected),
    selection_chain_id: head.selection_chain_id,
    selection_sequence: Number(head.selection_sequence),
    selection_request_id: head.selection_request_id,
    grant_epoch: head.grant_epoch ?? null,
    friendship_episode_id: head.friendship_episode_id == null
      ? null
      : String(head.friendship_episode_id),
    authorization_version: head.authorization_version == null
      ? null
      : Number(head.authorization_version),
    coverage_scope: head.coverage_scope ?? null,
  };
}

async function applyOrderedMemorySelection(pool, {
  viewerId,
  friendId,
  selected,
  intent,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Shares the user lock with /friend-sharing/sources first-use
    // initialization, preventing initialization from racing an explicit empty
    // selection.
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [viewerId]);
    await conn.execute(
      'INSERT IGNORE INTO memory_projection_preferences (viewer_id) VALUES (?)',
      [viewerId],
    );
    const grant = await lockCurrentGrant(conn, friendId, viewerId);

    await conn.execute(
      `INSERT IGNORE INTO memory_subscription_intent_heads
         (viewer_id, friend_id, selection_chain_id, selection_sequence,
          selection_request_id, selected)
       VALUES (?, ?, ?, 0, ?, 0)`,
      [viewerId, friendId, intent.chainId, intent.requestId],
    );
    const [heads] = await conn.execute(
      `SELECT * FROM memory_subscription_intent_heads
        WHERE viewer_id = ? AND friend_id = ? FOR UPDATE`,
      [viewerId, friendId],
    );
    const head = heads[0];
    if (head.selection_chain_id === intent.chainId
      && Number(head.selection_sequence) >= intent.sequence) {
      await conn.commit();
      if (Number(head.selection_sequence) === intent.sequence
        && head.selection_request_id === intent.requestId) {
        return { status: 200, body: currentSelectionBody(head) };
      }
      return {
        status: 409,
        body: currentSelectionBody(head, 'STALE_SELECTION_INTENT'),
      };
    }

    // Selecting always requires the exact current grant. Deselecting remains
    // allowed after a grant disappears (fail-closed cleanup), but an intent
    // bound to old grant A may not mutate a replacement grant B.
    if ((selected && !grantMatches(intent, grant))
      || (!selected && grant && !grantMatches(intent, grant))) {
      await conn.commit();
      return {
        status: grant ? 409 : 404,
        body: {
          code: grant ? 'AUTHORIZATION_CHANGED' : 'MEMORY_SOURCE_NOT_AVAILABLE',
          selected: false,
          ...(grant ? {
            grant_epoch: grant.grant_epoch,
            friendship_episode_id: String(grant.friendship_episode_id),
            authorization_version: Number(grant.authorization_version),
            coverage_scope: grant.coverage_scope,
          } : {}),
        },
      };
    }

    if (selected) {
      await conn.execute(
        `INSERT INTO memory_subscriptions (user_id, friend_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE subscribed_at = subscribed_at`,
        [viewerId, friendId],
      );
    } else {
      await conn.execute(
        'DELETE FROM memory_subscriptions WHERE user_id = ? AND friend_id = ?',
        [viewerId, friendId],
      );
    }
    await conn.execute(
      `UPDATE memory_subscription_intent_heads
          SET selection_chain_id = ?, selection_sequence = ?,
              selection_request_id = ?, selected = ?,
              grant_epoch = ?, friendship_episode_id = ?,
              authorization_version = ?, coverage_scope = ?
        WHERE viewer_id = ? AND friend_id = ?`,
      [
        intent.chainId, intent.sequence, intent.requestId, selected ? 1 : 0,
        grant?.grant_epoch ?? intent.expectedGrantEpoch,
        grant?.friendship_episode_id ?? intent.expectedFriendshipEpisodeId,
        grant?.authorization_version ?? intent.expectedAuthorizationVersion,
        grant?.coverage_scope ?? intent.expectedCoverageScope,
        viewerId, friendId,
      ],
    );
    await conn.commit();
    return {
      status: selected ? 201 : 200,
      body: {
        selected,
        selection_chain_id: intent.chainId,
        selection_sequence: intent.sequence,
        selection_request_id: intent.requestId,
        grant_epoch: grant?.grant_epoch ?? null,
        friendship_episode_id: grant?.friendship_episode_id == null
          ? null
          : String(grant.friendship_episode_id),
        authorization_version: grant?.authorization_version == null
          ? null
          : Number(grant.authorization_version),
        coverage_scope: grant?.coverage_scope ?? null,
      },
    };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function applyLegacyMemorySelection(pool, { viewerId, friendId, selected }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [viewerId]);
    await conn.execute(
      'INSERT IGNORE INTO memory_projection_preferences (viewer_id) VALUES (?)',
      [viewerId],
    );
    const grant = await lockCurrentGrant(conn, friendId, viewerId);
    if (selected && !grant) {
      await conn.commit();
      return { status: 404, body: { error: 'Memory source not available' } };
    }
    if (selected) {
      try {
        await conn.execute(
          'INSERT INTO memory_subscriptions (user_id, friend_id) VALUES (?, ?)',
          [viewerId, friendId],
        );
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        await conn.commit();
        return { status: 409, body: { error: 'Already subscribed' } };
      }
      await conn.commit();
      return { status: 201, body: { user_id: viewerId, friend_id: friendId } };
    }
    const [result] = await conn.execute(
      'DELETE FROM memory_subscriptions WHERE user_id = ? AND friend_id = ?',
      [viewerId, friendId],
    );
    await conn.commit();
    return Number(result.affectedRows) === 0
      ? { status: 404, body: { error: 'Not subscribed' } }
      : { status: 200, body: { message: 'Unsubscribed' } };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  applyLegacyMemorySelection,
  applyOrderedMemorySelection,
  parseOrderedSelectionIntent,
};
