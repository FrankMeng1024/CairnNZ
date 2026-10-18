#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { materializeOwnerCoverage } = require('../../src/services/memoryCoverage');

const baseUrl = process.env.HARNESS_API_URL;
const jwtSecret = process.env.JWT_SECRET;
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};
if (!baseUrl || !jwtSecret) throw new Error('HARNESS_API_URL and JWT_SECRET are required');

function tokenFor(id, label) {
  return jwt.sign(
    { userId: String(id), token_version: 0, jti: `o86-perf-${label}-${crypto.randomUUID()}` },
    jwtSecret,
    { expiresIn: '2h' },
  );
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

function summary(values) {
  return {
    trials: values.length,
    p50_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    max_ms: Math.max(0, ...values),
    all_ms: values,
  };
}

async function timedApi(token, path, init) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await response.text();
  const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
  assert.equal(response.status, 200, `${path}: ${text.slice(0, 300)}`);
  return { elapsedMs, bytes: Buffer.byteLength(text), body: JSON.parse(text) };
}

function densePoint(originLat, originLng, index, columns, spacingM) {
  const row = Math.floor(index / columns);
  const column = index % columns;
  const serpentineColumn = row % 2 === 0 ? column : columns - 1 - column;
  return {
    lat: originLat + row * spacingM / 111_132,
    lng: originLng + serpentineColumn * spacingM / (111_320 * Math.cos(originLat * Math.PI / 180)),
  };
}

async function insertPoints(db, ownerId, count, originLat, originLng, label) {
  const observedAt = Date.now() - 4 * 60 * 60 * 1000;
  // The harness database stores UTC DATETIME values. Pass an explicit UTC
  // string so the host's Asia/Shanghai timezone cannot move receipt time into
  // the future and accidentally make every delayed row ineligible.
  const receivedAtUtc = new Date(Date.now() - 31 * 60 * 1000)
    .toISOString().slice(0, 23).replace('T', ' ');
  for (let offset = 0; offset < count; offset += 500) {
    const size = Math.min(500, count - offset);
    const rows = [];
    for (let local = 0; local < size; local += 1) {
      const index = offset + local;
      const point = densePoint(originLat, originLng, index, 100, 8);
      rows.push([
        ownerId, point.lat, point.lng, observedAt + index * 1000,
        `${label}-${String(index).padStart(6, '0')}`,
        'passive_real', `o86-perf-${label}`, 8,
      ]);
    }
    await db.query(
      `INSERT INTO memory_points
         (user_id,lat,lng,ts,client_id,evidence_source,source_segment_id,
          horizontal_accuracy_m,continuity_state,received_at)
       VALUES ?`,
      [rows.map(row => [...row, 'accepted', receivedAtUtc])],
    );
  }
}

async function createFriendship(db, ownerId, viewerId) {
  const low = Math.min(ownerId, viewerId);
  const high = Math.max(ownerId, viewerId);
  await db.query(
    `INSERT INTO friends (user_id,friend_id,created_at) VALUES
       (?,?,UTC_TIMESTAMP(3)),(?,?,UTC_TIMESTAMP(3))`,
    [ownerId, viewerId, viewerId, ownerId],
  );
  const [episode] = await db.execute(
    `INSERT INTO friendship_episodes
       (episode_id,user_low_id,user_high_id,started_at)
     VALUES (?,?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY))`,
    [crypto.randomUUID(), low, high],
  );
  await db.execute(
    `INSERT INTO memory_share_grants
       (owner_id,viewer_id,friendship_episode_id,grant_epoch,effective_at,
        coverage_scope,consent_version)
     VALUES (?,?,?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY),'full_history_delayed_v1',1)`,
    [ownerId, viewerId, episode.insertId, crypto.randomUUID()],
  );
  await db.execute(
    'INSERT INTO memory_subscriptions (user_id,friend_id) VALUES (?,?)',
    [viewerId, ownerId],
  );
}

async function main() {
  const db = await mysql.createConnection(dbConfig);
  const evidence = {
    profile: {
      mysql: null,
      node: process.version,
      transport: 'loopback HTTP; ready server materialization; cold client projection state',
      trials: 20,
      datasets: {},
    },
    one_time_materialization_ms: {},
    reads: {},
  };
  const createdUserIds = [];
  try {
    const [[version]] = await db.query('SELECT VERSION() AS version');
    evidence.profile.mysql = version.version;
    for (const [name, count] of [['dense10k', 10_000], ['overlap2k', 2_000], ['distinct1k', 1_000]]) {
      const [result] = await db.execute(
        `INSERT INTO users (name,email,password_hash,date_of_birth,activity_source_realm)
         VALUES (?,?,?,'1990-01-01','isolated_qa')`,
        [`O86 ${name}`, `o86-${name}-${process.env.HARNESS_RUN_ID}@example.org`, 'synthetic-no-login'],
      );
      createdUserIds.push(Number(result.insertId));
      evidence.profile.datasets[name] = { owner_id: String(result.insertId), accepted_observations: count };
    }
    const [viewerResult] = await db.execute(
      `INSERT INTO users (name,email,password_hash,date_of_birth,activity_source_realm)
       VALUES (?,?,?,'1990-01-01','isolated_qa')`,
      ['O86 viewer', `o86-viewer-${process.env.HARNESS_RUN_ID}@example.org`, 'synthetic-no-login'],
    );
    const viewerId = Number(viewerResult.insertId);
    createdUserIds.push(viewerId);
    const [denseId, overlapId, distinctId] = createdUserIds;

    await insertPoints(db, denseId, 10_000, -41.2865, 174.7762, 'dense');
    await insertPoints(db, overlapId, 2_000, -41.28645, 174.77625, 'overlap');
    await insertPoints(db, distinctId, 1_000, -45.031, 168.662, 'distinct');
    await insertPoints(db, viewerId, 2_000, -41.2864, 174.7761, 'viewer-mine');
    await createFriendship(db, denseId, viewerId);
    await createFriendship(db, overlapId, viewerId);
    await createFriendship(db, distinctId, viewerId);

    for (const [name, ownerId] of [['dense10k', denseId], ['overlap2k', overlapId], ['distinct1k', distinctId]]) {
      const startedAt = performance.now();
      const tiles = await materializeOwnerCoverage(db, ownerId);
      evidence.one_time_materialization_ms[name] = {
        duration_ms: Number((performance.now() - startedAt).toFixed(2)),
        source_tiles: tiles,
      };
    }
    const viewerMaterializationStartedAt = performance.now();
    const viewerTiles = await materializeOwnerCoverage(db, viewerId);
    evidence.one_time_materialization_ms.viewer_mine_2k = {
      duration_ms: Number((performance.now() - viewerMaterializationStartedAt).toFixed(2)),
      source_tiles: viewerTiles,
    };
    const [readModelRows] = await db.query(
      `SELECT evidence.owner_id,COUNT(*) AS evidence_count,
              SUM(evidence.share_ready_at<=UTC_TIMESTAMP(3)) AS ready_count,
              (SELECT COUNT(*) FROM memory_coverage_tiles tile
                WHERE tile.owner_id=evidence.owner_id AND tile.visibility='mine') AS mine_tiles,
              (SELECT COUNT(*) FROM memory_coverage_tiles tile
                WHERE tile.owner_id=evidence.owner_id AND tile.visibility='shared') AS shared_tiles
         FROM memory_coverage_evidence evidence
        WHERE evidence.owner_id IN (?)
        GROUP BY evidence.owner_id`,
      [[denseId, overlapId, distinctId, viewerId]],
    );
    evidence.profile.read_model = readModelRows;

    const denseToken = tokenFor(denseId, 'dense');
    const viewerToken = tokenFor(viewerId, 'viewer');
    const denseViewport = [174.774, -41.289, 174.786, -41.283];
    const distinctViewport = [168.658, -45.034, 168.674, -45.027];
    const names = [];
    const mine = [];
    const oneFriend = [];
    const twoFriends = [];
    const payloadBytes = { mine: [], one_friend: [], two_friends: [] };
    let clientFixture = null;
    for (let trial = 0; trial < 20; trial += 1) {
      const sourceRead = await timedApi(viewerToken, '/api/friend-sharing/sources');
      names.push(sourceRead.elapsedMs);
      const mineRead = await timedApi(denseToken, `/api/memory/coverage?bbox=${denseViewport.join(',')}`);
      mine.push(mineRead.elapsedMs);
      payloadBytes.mine.push(mineRead.bytes);
      assert.ok(mineRead.body.geometry.coordinates.length > 0);
      const one = await timedApi(viewerToken, '/api/friend-sharing/coverage', {
        method: 'POST', body: JSON.stringify({ friend_ids: [denseId], viewport_bbox: denseViewport }),
      });
      oneFriend.push(one.elapsedMs);
      payloadBytes.one_friend.push(one.bytes);
      assert.ok(
        one.body.projections[0].geometry.coordinates.length > 0,
        `friend projection unexpectedly empty: ${JSON.stringify(one.body).slice(0, 1000)}`,
      );
      const two = await timedApi(viewerToken, '/api/friend-sharing/coverage', {
        method: 'POST', body: JSON.stringify({ friend_ids: [denseId, overlapId], viewport_bbox: denseViewport }),
      });
      twoFriends.push(two.elapsedMs);
      payloadBytes.two_friends.push(two.bytes);
      assert.equal(two.body.projections.length, 2);
      if (trial === 0) {
        const viewerMine = await timedApi(
          viewerToken,
          `/api/memory/coverage?bbox=${denseViewport.join(',')}`,
        );
        const distinct = await timedApi(viewerToken, '/api/friend-sharing/coverage', {
          method: 'POST', body: JSON.stringify({ friend_ids: [distinctId], viewport_bbox: distinctViewport }),
        });
        assert.ok(viewerMine.body.geometry.coordinates.length > 0);
        assert.ok(distinct.body.projections[0].geometry.coordinates.length > 0);
        clientFixture = {
          generated_at: new Date().toISOString(),
          provenance: 'ISOLATED_QA_REAL_DB_AND_API; synthetic accepted observations; never production travel',
          viewer: { id: String(viewerId), name: 'O86 viewer' },
          sources: sourceRead.body,
          dense_viewport: denseViewport,
          distinct_viewport: distinctViewport,
          viewer_mine_2k: viewerMine.body,
          one_friend_dense_10k: one.body,
          two_friends_dense_overlap_12k: two.body,
          one_friend_distinct_1k: distinct.body,
        };
      }
    }
    evidence.reads.friend_names = summary(names);
    evidence.reads.mine_10k_current_viewport = summary(mine);
    evidence.reads.one_friend_10k_current_viewport = summary(oneFriend);
    evidence.reads.two_friends_12k_current_viewport = summary(twoFriends);
    evidence.payload_bytes = Object.fromEntries(Object.entries(payloadBytes).map(([key, values]) => [key, summary(values)]));
    if (process.env.O86_CLIENT_FIXTURE_PATH && clientFixture) {
      fs.writeFileSync(process.env.O86_CLIENT_FIXTURE_PATH, `${JSON.stringify(clientFixture)}\n`, { mode: 0o600 });
      evidence.client_fixture = {
        path: process.env.O86_CLIENT_FIXTURE_PATH,
        bytes: fs.statSync(process.env.O86_CLIENT_FIXTURE_PATH).size,
      };
    }
    assert.ok(evidence.reads.friend_names.p95_ms < 1000);
    assert.ok(evidence.reads.mine_10k_current_viewport.p95_ms < 5000);
    assert.ok(evidence.reads.one_friend_10k_current_viewport.p95_ms < 5000);
    assert.ok(evidence.reads.two_friends_12k_current_viewport.p95_ms < 5000);
    evidence.result = 'PASS';
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    if (createdUserIds.length > 0) {
      await db.query('DELETE FROM users WHERE id IN (?)', [createdUserIds]);
    }
    await db.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
