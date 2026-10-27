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
    { userId: String(userId), token_version: 0, jti: `o94-proof-${crypto.randomUUID()}` },
    jwtSecret,
    { expiresIn: '1h' },
  );
}

async function api(token, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

async function user(db, label) {
  const [result] = await db.execute(
    `INSERT INTO users (name,email,password_hash,date_of_birth,activity_source_realm)
     VALUES (?,?,?,'1990-01-01','isolated_qa')`,
    [`O94 proof ${label}`, `o94-proof-${label}-${process.env.HARNESS_RUN_ID}@example.invalid`, 'synthetic-no-login'],
  );
  return Number(result.insertId);
}

async function friendship(db, ownerId, viewerId) {
  const low = Math.min(ownerId, viewerId);
  const high = Math.max(ownerId, viewerId);
  await db.query(
    'INSERT INTO friends (user_id,friend_id,created_at) VALUES (?,?,UTC_TIMESTAMP(3)),(?,?,UTC_TIMESTAMP(3))',
    [ownerId, viewerId, viewerId, ownerId],
  );
  const episodeUuid = crypto.randomUUID();
  const [episode] = await db.execute(
    `INSERT INTO friendship_episodes (episode_id,user_low_id,user_high_id,started_at)
     VALUES (?,?,?,UTC_TIMESTAMP(3))`,
    [episodeUuid, low, high],
  );
  return { id: Number(episode.insertId), uuid: episodeUuid };
}

async function grant(db, ownerId, viewerId, episodeId) {
  const epoch = crypto.randomUUID();
  await db.execute(
    `INSERT INTO memory_share_grants
       (owner_id,viewer_id,friendship_episode_id,grant_epoch,effective_at,coverage_scope,consent_version)
     VALUES (?,?,?,?,UTC_TIMESTAMP(3),'full_history_delayed_v1',1)`,
    [ownerId, viewerId, episodeId, epoch],
  );
  await db.execute(
    'INSERT INTO memory_subscriptions (user_id,friend_id) VALUES (?,?) ON DUPLICATE KEY UPDATE friend_id=VALUES(friend_id)',
    [viewerId, ownerId],
  );
  return epoch;
}

function proof(friendId, epoch, episodeId) {
  return {
    friend_id: String(friendId),
    grant_epoch: epoch,
    friendship_episode_id: String(episodeId),
    authorization_version: 1,
    coverage_scope: 'full_history_delayed_v1',
  };
}

async function createTruncationFixture(db, viewerId, ids) {
  const owners = [];
  const runId = String(process.env.HARNESS_RUN_ID).replace(/[^a-zA-Z0-9]/g, '');
  for (let offset = 0; offset < 1001; offset += 200) {
    const rows = Array.from({ length: Math.min(200, 1001 - offset) }, (_, index) => {
      const ordinal = offset + index;
      return [
        `A source ${String(ordinal).padStart(4, '0')}`,
        `o94-proof-limit-${runId}-${ordinal}@example.invalid`,
        'synthetic-no-login',
      ];
    });
    await db.query(
      `INSERT INTO users (name,email,password_hash,date_of_birth,activity_source_realm)
       VALUES ${rows.map(() => "(?,?,?,'1990-01-01','isolated_qa')").join(',')}`,
      rows.flat(),
    );
  }
  const [ownerRows] = await db.query(
    'SELECT id FROM users WHERE email LIKE ? ORDER BY id',
    [`o94-proof-limit-${runId}-%@example.invalid`],
  );
  owners.push(...ownerRows.map(row => Number(row.id)));
  assert.equal(owners.length, 1001);
  ids.push(...owners);
  for (let offset = 0; offset < owners.length; offset += 200) {
    const chunk = owners.slice(offset, offset + 200);
    const friendRows = chunk.flatMap(ownerId => [
      [ownerId, viewerId], [viewerId, ownerId],
    ]);
    await db.query(
      `INSERT INTO friends (user_id,friend_id,created_at) VALUES ${friendRows.map(() => '(?,?,UTC_TIMESTAMP(3))').join(',')}`,
      friendRows.flat(),
    );
    await db.query(
      `INSERT INTO friendship_episodes (episode_id,user_low_id,user_high_id,started_at)
       VALUES ${chunk.map(() => '(UUID(),?,?,UTC_TIMESTAMP(3))').join(',')}`,
      chunk.flatMap(ownerId => [Math.min(ownerId, viewerId), Math.max(ownerId, viewerId)]),
    );
  }
  const [episodeRows] = await db.query(
    'SELECT id,user_high_id FROM friendship_episodes WHERE user_low_id=? AND user_high_id IN (?)',
    [viewerId, owners],
  );
  const episodeByOwner = new Map(episodeRows.map(row => [Number(row.user_high_id), Number(row.id)]));
  assert.equal(episodeByOwner.size, 1001);
  for (let offset = 0; offset < owners.length; offset += 200) {
    const chunk = owners.slice(offset, offset + 200);
    await db.query(
      `INSERT INTO memory_share_grants
        (owner_id,viewer_id,friendship_episode_id,grant_epoch,effective_at,coverage_scope,consent_version)
       VALUES ${chunk.map(() => "(?,?,?,UUID(),UTC_TIMESTAMP(3),'full_history_delayed_v1',1)").join(',')}`,
      chunk.flatMap(ownerId => [ownerId, viewerId, episodeByOwner.get(ownerId)]),
    );
    await db.query(
      `INSERT INTO memory_subscriptions (user_id,friend_id) VALUES ${chunk.map(() => '(?,?)').join(',')}`,
      chunk.flatMap(ownerId => [viewerId, ownerId]),
    );
  }
}

async function main() {
  const db = await mysql.createConnection(dbConfig);
  const ids = [];
  const result = {
    schema: 'cairn-memory-permission-renewal-real-express-mysql-v1',
    environment: { http: 'loopback Express', database: 'disposable MySQL 8', production_data: false },
    assertions: [],
  };
  const pass = (id, detail) => result.assertions.push({ id, status: 'PASS', detail });
  try {
    const viewerId = await user(db, 'viewer');
    const ownerA = await user(db, 'owner-a');
    const ownerB = await user(db, 'owner-b');
    const ownerC = await user(db, 'owner-c');
    ids.push(viewerId, ownerA, ownerB, ownerC);
    const episodeA = await friendship(db, ownerA, viewerId);
    const episodeB = await friendship(db, ownerB, viewerId);
    const episodeC = await friendship(db, ownerC, viewerId);
    const epochA = await grant(db, ownerA, viewerId, episodeA.id);
    const epochB = await grant(db, ownerB, viewerId, episodeB.id);
    const epochC = await grant(db, ownerC, viewerId, episodeC.id);
    const token = tokenFor(viewerId);

    await createTruncationFixture(db, viewerId, ids);
    const truncatedSources = await api(token, '/api/friend-sharing/sources');
    assert.equal(truncatedSources.status, 200);
    assert.equal(truncatedSources.body.complete, false);
    assert.equal(truncatedSources.body.sources.length, 1000);
    pass('source-list-truncation-explicit', 'LIMIT boundary is explicit and cannot imply wholesale revocation for omitted sources');

    const snapshot = await api(token, '/api/friend-sharing/coverage-snapshot', { friend_id: ownerA, page_size: 24 });
    assert.equal(snapshot.status, 200);
    const initial = snapshot.body.projections[0];
    assert.equal(initial.grant_epoch, epochA);
    assert.equal(String(initial.friendship_episode_id), String(episodeA.id));
    assert.equal(initial.coverage_scope, 'full_history_delayed_v1');
    pass('initial-proof-bound-to-snapshot', 'epoch, episode, version and scope returned from first snapshot page');

    const renewed = await api(token, '/api/friend-sharing/coverage-proof-renewal', {
      request_id: 'same-grant', sources: [proof(ownerA, epochA, episodeA.id)],
    });
    assert.equal(renewed.status, 200);
    assert.equal(renewed.body.complete, true);
    assert.equal(renewed.body.outcomes[0].status, 'authorized');
    assert.ok(Date.parse(renewed.body.authorization_expires_at) > Date.parse(renewed.body.server_authorized_at));
    pass('renew-without-geometry', 'same grant renews with no coverage manifest/page payload');

    const duplicateSource = await api(token, '/api/friend-sharing/coverage-proof-renewal', {
      request_id: 'duplicate-source',
      sources: [proof(ownerA, epochA, episodeA.id), proof(ownerA, epochA, episodeA.id)],
    });
    assert.equal(duplicateSource.status, 400);
    assert.equal(duplicateSource.body.code, 'INVALID_SOURCE_PROOF');
    pass('duplicate-source-rejected', 'a batch cannot use repeated IDs to manufacture completeness');

    await db.execute(
      `UPDATE memory_share_grants SET status='revoked',revoked_at=UTC_TIMESTAMP(3),
         revoked_reason='corrective',authorization_version=authorization_version+1
       WHERE owner_id=? AND viewer_id=? AND status='active'`,
      [ownerA, viewerId],
    );
    await db.execute('DELETE FROM memory_subscriptions WHERE user_id=? AND friend_id=?', [viewerId, ownerA]);
    const deniedAfterRevoke = await api(token, '/api/friend-sharing/coverage-proof-renewal', {
      request_id: 'revoked', sources: [proof(ownerA, epochA, episodeA.id)],
    });
    assert.equal(deniedAfterRevoke.body.outcomes[0].code, 'AUTHORIZATION_CHANGED');
    pass('revoke-denies-old-proof', 'revoked grant cannot renew');

    const epochA2 = await grant(db, ownerA, viewerId, episodeA.id);
    const oldAfterRegrant = await api(token, '/api/friend-sharing/coverage-proof-renewal', {
      request_id: 'regrant-version-one', sources: [proof(ownerA, epochA, episodeA.id)],
    });
    assert.equal(oldAfterRegrant.body.outcomes[0].status, 'denied');
    assert.notEqual(epochA2, epochA);
    pass('regrant-version-one-new-epoch', 'version 1 regrant cannot authorize old epoch geometry');

    const mixed = await api(token, '/api/friend-sharing/coverage-proof-renewal', {
      request_id: 'mixed-batch',
      sources: [proof(ownerA, epochA, episodeA.id), proof(ownerB, epochB, episodeB.id)],
    });
    assert.deepEqual(mixed.body.outcomes.map(item => item.status), ['denied', 'authorized']);
    pass('per-source-batch-outcomes', 'one denied source does not hide the authorized source or imply a partial list');

    await db.execute(
      "UPDATE memory_share_grants SET coverage_scope='legacy_activity_since_grant' WHERE owner_id=? AND viewer_id=? AND status='active'",
      [ownerC, viewerId],
    );
    const scopeReduced = await api(token, '/api/friend-sharing/coverage-proof-renewal', {
      request_id: 'scope-reduced', sources: [proof(ownerC, epochC, episodeC.id)],
    });
    assert.equal(scopeReduced.body.outcomes[0].status, 'denied');
    pass('scope-reduction-denies-proof', 'a grant outside the accepted coverage scope cannot renew frozen geometry');

    await db.execute(
      `UPDATE memory_share_grants SET status='revoked',revoked_at=UTC_TIMESTAMP(3),
         revoked_reason='unfriended',authorization_version=authorization_version+1
       WHERE owner_id=? AND viewer_id=? AND status='active'`,
      [ownerB, viewerId],
    );
    await db.execute('DELETE FROM memory_subscriptions WHERE user_id=? AND friend_id=?', [viewerId, ownerB]);
    await db.execute('UPDATE friendship_episodes SET ended_at=UTC_TIMESTAMP(3),ended_reason=\'unfriended\' WHERE id=?', [episodeB.id]);
    await db.execute(
      'DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)',
      [ownerB, viewerId, viewerId, ownerB],
    );
    const deniedAfterUnfriend = await api(token, '/api/friend-sharing/coverage-proof-renewal', {
      request_id: 'unfriended', sources: [proof(ownerB, epochB, episodeB.id)],
    });
    assert.equal(deniedAfterUnfriend.body.outcomes[0].status, 'denied');
    const episodeB2 = await friendship(db, ownerB, viewerId);
    const epochB2 = await grant(db, ownerB, viewerId, episodeB2.id);
    const oldAfterRefriend = await api(token, '/api/friend-sharing/coverage-proof-renewal', {
      request_id: 'refriend-old-proof', sources: [proof(ownerB, epochB, episodeB.id)],
    });
    assert.equal(oldAfterRefriend.body.outcomes[0].status, 'denied');
    assert.notEqual(epochB2, epochB);
    assert.notEqual(episodeB2.id, episodeB.id);
    pass('unfriend-refriend-new-episode', 'old friendship episode and epoch stay denied after a new friendship is created');

    await db.execute(
      'INSERT INTO blocked_users (blocker_id,blocked_id,created_at) VALUES (?,?,UTC_TIMESTAMP(3))',
      [ownerB, viewerId],
    );
    const blocked = await api(token, '/api/friend-sharing/coverage-proof-renewal', {
      request_id: 'blocked', sources: [proof(ownerB, epochB2, episodeB2.id)],
    });
    assert.equal(blocked.body.outcomes[0].status, 'denied');
    pass('block-denies-proof', 'block is enforced by currentMemoryGrant');

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
