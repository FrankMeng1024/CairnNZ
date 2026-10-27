#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const baseUrl = process.env.HARNESS_API_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!baseUrl || !jwtSecret) throw new Error('HARNESS_API_URL and JWT_SECRET are required');

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

function tokenFor(userId) {
  return jwt.sign(
    { userId: String(userId), token_version: 0, jti: `selection-${crypto.randomUUID()}` },
    jwtSecret,
    { expiresIn: '1h' },
  );
}

async function api(token, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function createUser(db, label) {
  const [result] = await db.execute(
    `INSERT INTO users (name,email,password_hash,date_of_birth,activity_source_realm)
     VALUES (?,?,?,'1990-01-01','isolated_qa')`,
    [`Selection ${label}`, `selection-${label}-${process.env.HARNESS_RUN_ID}@example.invalid`, 'synthetic-no-login'],
  );
  return Number(result.insertId);
}

async function createFriendship(db, ownerId, viewerId) {
  await db.query(
    'INSERT INTO friends (user_id,friend_id,created_at) VALUES (?,?,UTC_TIMESTAMP(3)),(?,?,UTC_TIMESTAMP(3))',
    [ownerId, viewerId, viewerId, ownerId],
  );
  const episodeUuid = crypto.randomUUID();
  const [episode] = await db.execute(
    `INSERT INTO friendship_episodes (episode_id,user_low_id,user_high_id,started_at)
     VALUES (?,?,?,UTC_TIMESTAMP(3))`,
    [episodeUuid, Math.min(ownerId, viewerId), Math.max(ownerId, viewerId)],
  );
  return Number(episode.insertId);
}

async function createGrant(db, ownerId, viewerId, episodeId) {
  const epoch = crypto.randomUUID();
  await db.execute(
    `INSERT INTO memory_share_grants
       (owner_id,viewer_id,friendship_episode_id,grant_epoch,effective_at,coverage_scope,consent_version)
     VALUES (?,?,?,?,UTC_TIMESTAMP(3),'full_history_delayed_v1',1)`,
    [ownerId, viewerId, episodeId, epoch],
  );
  return { epoch, episodeId, version: 1 };
}

function orderedBody(chainId, sequence, grant) {
  return {
    selection_chain_id: chainId,
    selection_sequence: sequence,
    selection_request_id: crypto.randomUUID(),
    grant_epoch: grant.epoch,
    friendship_episode_id: String(grant.episodeId),
    authorization_version: grant.version,
    coverage_scope: 'full_history_delayed_v1',
  };
}

async function selectedCount(db, viewerId, friendId) {
  const [[row]] = await db.execute(
    'SELECT COUNT(*) AS n FROM memory_subscriptions WHERE user_id=? AND friend_id=?',
    [viewerId, friendId],
  );
  return Number(row.n);
}

async function main() {
  const db = await mysql.createConnection(dbConfig);
  const ids = [];
  const result = {
    schema: 'cairn-memory-selection-causality-real-express-mysql-v1',
    environment: { http: 'loopback Express', database: 'disposable MySQL 8', production_data: false },
    assertions: [],
  };
  const pass = (id, detail) => result.assertions.push({ id, status: 'PASS', detail });
  try {
    const viewerId = await createUser(db, 'viewer');
    const ownerId = await createUser(db, 'owner');
    ids.push(viewerId, ownerId);
    const episodeId = await createFriendship(db, ownerId, viewerId);
    const grantA = await createGrant(db, ownerId, viewerId, episodeId);
    const token = tokenFor(viewerId);
    const chain = crypto.randomUUID();

    const firstViewerId = await createUser(db, 'first-use-viewer');
    const firstOwnerId = await createUser(db, 'first-use-owner');
    ids.push(firstViewerId, firstOwnerId);
    const firstEpisodeId = await createFriendship(db, firstOwnerId, firstViewerId);
    await createGrant(db, firstOwnerId, firstViewerId, firstEpisodeId);
    const firstToken = tokenFor(firstViewerId);
    const firstSources = await api(firstToken, 'GET', '/api/friend-sharing/sources');
    const firstSubscriptions = await api(firstToken, 'GET', '/api/memory-subscriptions');
    assert.equal(firstSources.status, 200);
    assert.equal(firstSources.body.complete, true);
    assert.equal(firstSources.body.sources[0].selected, true);
    assert.deepEqual(firstSubscriptions.body.subscriptions.map(item => Number(item.friend_id)), [firstOwnerId]);
    assert.equal(await selectedCount(db, firstViewerId, firstOwnerId), 1);
    pass('first-use-sources-and-subscriptions-coherent', '/sources commits default selection before the following subscriptions read');

    const malformedOrdered = await api(token, 'POST', '/api/memory-subscriptions', {
      friend_id: ownerId,
      selection_chain_id: 'not-a-valid-chain',
      selection_sequence: 1,
    });
    assert.equal(malformedOrdered.status, 400);
    assert.equal(malformedOrdered.body.code, 'INVALID_SELECTION_INTENT');
    assert.equal(await selectedCount(db, viewerId, ownerId), 0);
    pass('malformed-ordered-envelope-rejected', 'partial/invalid new-client identity cannot fall through to legacy mutation');

    // Simulate an old POST whose handler commits after the later DELETE: the
    // later intent reaches the server first, and sequence ordering prevents
    // the delayed old request from resurrecting selection.
    const delete2 = await api(token, 'DELETE', `/api/memory-subscriptions/${ownerId}`,
      orderedBody(chain, 2, grantA));
    assert.equal(delete2.status, 200);
    const stalePost1 = await api(token, 'POST', '/api/memory-subscriptions', {
      friend_id: ownerId,
      ...orderedBody(chain, 1, grantA),
    });
    assert.equal(stalePost1.status, 409);
    assert.equal(stalePost1.body.code, 'STALE_SELECTION_INTENT');
    assert.equal(await selectedCount(db, viewerId, ownerId), 0);
    pass('late-post-cannot-overwrite-new-delete', 'sequence 1 rejected after sequence 2; DB remains deselected');

    const post4 = await api(token, 'POST', '/api/memory-subscriptions', {
      friend_id: ownerId,
      ...orderedBody(chain, 4, grantA),
    });
    assert.equal(post4.status, 201);
    const staleDelete3 = await api(token, 'DELETE', `/api/memory-subscriptions/${ownerId}`,
      orderedBody(chain, 3, grantA));
    assert.equal(staleDelete3.status, 409);
    assert.equal(staleDelete3.body.code, 'STALE_SELECTION_INTENT');
    assert.equal(await selectedCount(db, viewerId, ownerId), 1);
    pass('late-delete-cannot-overwrite-new-post', 'sequence 3 rejected after sequence 4; DB remains selected');

    const request5 = orderedBody(chain, 5, grantA);
    const delete5 = await api(token, 'DELETE', `/api/memory-subscriptions/${ownerId}`, request5);
    const replay5 = await api(token, 'DELETE', `/api/memory-subscriptions/${ownerId}`, request5);
    assert.equal(delete5.status, 200);
    assert.equal(replay5.status, 200);
    assert.equal(replay5.body.code, 'SELECTION_INTENT_REPLAY');
    assert.equal(await selectedCount(db, viewerId, ownerId), 0);
    pass('same-operation-idempotent-replay', 'identical chain/sequence/request returns current state without a second mutation');

    await db.execute(
      `UPDATE memory_share_grants SET status='revoked',revoked_at=UTC_TIMESTAMP(3),
         revoked_reason='corrective',authorization_version=authorization_version+1
       WHERE owner_id=? AND viewer_id=? AND status='active'`,
      [ownerId, viewerId],
    );
    const grantB = await createGrant(db, ownerId, viewerId, episodeId);
    const oldGrantSelect = await api(token, 'POST', '/api/memory-subscriptions', {
      friend_id: ownerId,
      ...orderedBody(chain, 6, grantA),
    });
    assert.equal(oldGrantSelect.status, 409);
    assert.equal(oldGrantSelect.body.code, 'AUTHORIZATION_CHANGED');
    assert.equal(await selectedCount(db, viewerId, ownerId), 0);
    pass('old-grant-selection-rejected', 'grant A intent cannot select reissued grant B/version1');

    const currentGrantSelect = await api(token, 'POST', '/api/memory-subscriptions', {
      friend_id: ownerId,
      ...orderedBody(chain, 7, grantB),
    });
    assert.equal(currentGrantSelect.status, 201);
    assert.equal(await selectedCount(db, viewerId, ownerId), 1);
    pass('current-grant-selection-accepted', 'exact grant B identity selects normally');

    const oldGrantDelete = await api(token, 'DELETE', `/api/memory-subscriptions/${ownerId}`,
      orderedBody(chain, 8, grantA));
    assert.equal(oldGrantDelete.status, 409);
    assert.equal(oldGrantDelete.body.code, 'AUTHORIZATION_CHANGED');
    assert.equal(await selectedCount(db, viewerId, ownerId), 1);
    pass('old-grant-deselection-rejected', 'grant A intent cannot deselect replacement grant B/version1');

    // Old O94 sends none of the additive ordering fields.
    const legacyDelete = await api(token, 'DELETE', `/api/memory-subscriptions/${ownerId}`);
    const legacyPost = await api(token, 'POST', '/api/memory-subscriptions', { friend_id: ownerId });
    assert.equal(legacyDelete.status, 200);
    assert.equal(legacyPost.status, 201);
    assert.equal(await selectedCount(db, viewerId, ownerId), 1);
    pass('legacy-o94-compatible', 'legacy POST/DELETE shape remains accepted on the additive backend');

    result.result = 'PASS';
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (ids.length > 0) await db.query('DELETE FROM users WHERE id IN (?)', [ids]);
    await db.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
