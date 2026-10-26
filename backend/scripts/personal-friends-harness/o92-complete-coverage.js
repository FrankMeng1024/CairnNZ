#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { materializeOwnerCoverage } = require('../../src/services/memoryCoverage');

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

function tokenFor(userId, label) {
  return jwt.sign(
    { userId: String(userId), token_version: 0, jti: `o92-${label}-${crypto.randomUUID()}` },
    jwtSecret,
    { expiresIn: '2h' },
  );
}

async function request(token, path, init = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    ms: Number((performance.now() - startedAt).toFixed(2)),
    bytes: Buffer.byteLength(text),
    body: text ? JSON.parse(text) : null,
  };
}

async function acquireSnapshot(token, kind, friendId = null) {
  let cursor;
  let snapshotId;
  let asOf;
  let expectedPages;
  let expectedTiles;
  let expectedEvidence;
  const tileIds = new Set();
  const pages = [];
  do {
    const result = kind === 'mine'
      ? await request(token, `/api/memory/coverage-snapshot?${new URLSearchParams({
          page_size: '1',
          ...(snapshotId ? { snapshot_id: snapshotId } : {}),
          ...(asOf ? { as_of: asOf } : {}),
          ...(cursor ? { cursor } : {}),
        })}`)
      : await request(token, '/api/friend-sharing/coverage-snapshot', {
          method: 'POST',
          body: JSON.stringify({
            friend_id: friendId,
            page_size: 1,
            ...(snapshotId ? { snapshot_id: snapshotId } : {}),
            ...(asOf ? { as_of: asOf } : {}),
            ...(cursor ? { cursor } : {}),
          }),
        });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const envelope = kind === 'mine' ? result.body : result.body.projections[0];
    assert.ok(envelope, 'authorized snapshot projection missing');
    const { manifest, page } = envelope;
    snapshotId ??= manifest.snapshot_id;
    asOf ??= manifest.as_of;
    expectedPages ??= Number(manifest.expected_pages);
    expectedTiles ??= Number(manifest.expected_tiles);
    expectedEvidence ??= Number(manifest.expected_evidence_count);
    assert.equal(manifest.snapshot_id, snapshotId);
    assert.equal(manifest.as_of, asOf);
    for (const tile of page.tiles) {
      assert.equal(tileIds.has(tile.id), false, `duplicate tile ${tile.id}`);
      tileIds.add(tile.id);
    }
    pages.push({
      index: page.page_index,
      ms: result.ms,
      bytes: result.bytes,
      tiles: page.tiles.length,
      complete: page.complete,
    });
    cursor = page.next_cursor ?? undefined;
    assert.equal(page.complete, cursor === undefined);
  } while (cursor);
  assert.equal(pages.length, expectedPages || 1);
  assert.equal(tileIds.size, expectedTiles);
  return {
    snapshot_id_sha256_prefix: snapshotId.slice(0, 12),
    expected_pages: expectedPages,
    expected_tiles: expectedTiles,
    expected_evidence_count: expectedEvidence,
    terminal_complete: true,
    pages,
    total_ms: Number(pages.reduce((sum, page) => sum + page.ms, 0).toFixed(2)),
    total_bytes: pages.reduce((sum, page) => sum + page.bytes, 0),
  };
}

function point(originLat, originLng, index, columns = 100) {
  const row = Math.floor(index / columns);
  const column = row % 2 === 0 ? index % columns : columns - 1 - (index % columns);
  return {
    lat: originLat + row * 8 / 111_132,
    lng: originLng + column * 8 / (111_320 * Math.cos(originLat * Math.PI / 180)),
  };
}

async function insertPoints(db, ownerId, count, originLat, originLng, label, startingIndex = 0) {
  const observedAt = Date.now() - 4 * 60 * 60 * 1000;
  const receivedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString().slice(0, 23).replace('T', ' ');
  for (let offset = 0; offset < count; offset += 500) {
    const size = Math.min(500, count - offset);
    const rows = Array.from({ length: size }, (_, local) => {
      const index = startingIndex + offset + local;
      const coordinate = point(originLat, originLng, offset + local);
      return [
        ownerId, coordinate.lat, coordinate.lng, observedAt + (offset + local) * 1000,
        `${label}-${String(index).padStart(6, '0')}`, 'passive_real',
        `o92-${label}`, 8, 'accepted', receivedAt,
      ];
    });
    await db.query(
      `INSERT INTO memory_points
         (user_id,lat,lng,ts,client_id,evidence_source,source_segment_id,
          horizontal_accuracy_m,continuity_state,received_at)
       VALUES ?`,
      [rows],
    );
  }
}

async function createUser(db, label) {
  const [result] = await db.execute(
    `INSERT INTO users (name,email,password_hash,date_of_birth,activity_source_realm)
     VALUES (?,?,?,'1990-01-01','isolated_qa')`,
    [`O92 ${label}`, `o92-${label}-${process.env.HARNESS_RUN_ID}@example.invalid`, 'synthetic-no-login'],
  );
  return Number(result.insertId);
}

async function createGrant(db, ownerId, viewerId) {
  const low = Math.min(ownerId, viewerId);
  const high = Math.max(ownerId, viewerId);
  await db.query(
    'INSERT INTO friends (user_id,friend_id,created_at) VALUES (?,?,UTC_TIMESTAMP(3)),(?,?,UTC_TIMESTAMP(3))',
    [ownerId, viewerId, viewerId, ownerId],
  );
  const [episode] = await db.execute(
    `INSERT INTO friendship_episodes (episode_id,user_low_id,user_high_id,started_at)
     VALUES (?,?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY))`,
    [crypto.randomUUID(), low, high],
  );
  await db.execute(
    `INSERT INTO memory_share_grants
       (owner_id,viewer_id,friendship_episode_id,grant_epoch,effective_at,coverage_scope,consent_version)
     VALUES (?,?,?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY),'full_history_delayed_v1',1)`,
    [ownerId, viewerId, episode.insertId, crypto.randomUUID()],
  );
  await db.execute('INSERT INTO memory_subscriptions (user_id,friend_id) VALUES (?,?)', [viewerId, ownerId]);
}

async function seedRegions(db) {
  const regions = [
    ['o92-nz', null, 'New Zealand', 2, 165, -48, 179, -34, 'POLYGON((165 -48,179 -48,179 -34,165 -34,165 -48))'],
    ['o92-wellington', 'o92-nz', 'Wellington', 3, 174, -42, 176, -40, 'POLYGON((174 -42,176 -42,176 -40,174 -40,174 -42))'],
    ['o92-fiordland', 'o92-nz', 'Fiordland', 3, 166, -47, 168, -45, 'POLYGON((166 -47,168 -47,168 -45,166 -45,166 -47))'],
  ];
  for (const region of regions) {
    await db.execute(
      `INSERT INTO regions
         (id,parent_id,name_en,level,bbox_min_lng,bbox_min_lat,bbox_max_lng,bbox_max_lat,geom,source)
       VALUES (?,?,?,?,?,?,?,?,ST_GeomFromText(?,4326,'axis-order=long-lat'),'isolated_o92')`,
      region,
    );
  }
}

async function main() {
  const db = await mysql.createConnection(dbConfig);
  const createdUsers = [];
  const evidence = {
    schema: 'cairn-o92-complete-authorized-memory-harness-v1',
    environment: { transport: 'loopback Express', database: 'disposable MySQL 8 container', private_data: false },
    datasets: { owner_observations: 12_000, regions: ['Wellington', 'Fiordland'], empty_owner_observations: 0 },
    results: {},
  };
  try {
    await seedRegions(db);
    const ownerId = await createUser(db, 'owner-12k');
    const emptyOwnerId = await createUser(db, 'owner-empty');
    const viewerId = await createUser(db, 'viewer');
    createdUsers.push(ownerId, emptyOwnerId, viewerId);
    await insertPoints(db, ownerId, 11_000, -41.2865, 174.7762, 'wellington');
    await insertPoints(db, ownerId, 1_000, -45.45, 167.05, 'fiordland', 11_000);
    await createGrant(db, ownerId, viewerId);
    await createGrant(db, emptyOwnerId, viewerId);

    const materializeStarted = performance.now();
    const sourceTiles = await materializeOwnerCoverage(db, ownerId);
    evidence.results.materialization = {
      ms: Number((performance.now() - materializeStarted).toFixed(2)), source_tiles: sourceTiles,
    };
    await materializeOwnerCoverage(db, emptyOwnerId);

    const ownerToken = tokenFor(ownerId, 'owner');
    const emptyOwnerToken = tokenFor(emptyOwnerId, 'empty');
    const viewerToken = tokenFor(viewerId, 'viewer');
    evidence.results.mine_complete = await acquireSnapshot(ownerToken, 'mine');
    evidence.results.friend_complete = await acquireSnapshot(viewerToken, 'friend', ownerId);
    evidence.results.empty_complete = await acquireSnapshot(emptyOwnerToken, 'mine');
    assert.equal(evidence.results.mine_complete.expected_evidence_count, 12_000);
    assert.equal(evidence.results.friend_complete.expected_evidence_count, 12_000);
    assert.equal(evidence.results.empty_complete.expected_tiles, 0);

    const oldMine = await request(ownerToken, '/api/memory/coverage?bbox=174.5,-41.5,175,-41');
    const oldFriend = await request(viewerToken, '/api/friend-sharing/coverage', {
      method: 'POST',
      body: JSON.stringify({ friend_ids: [ownerId], viewport_bbox: [174.5, -41.5, 175, -41] }),
    });
    assert.equal(oldMine.status, 200);
    assert.equal(oldFriend.status, 200);
    evidence.results.o92_compatibility = {
      old_mine_status: oldMine.status,
      old_friend_status: oldFriend.status,
      old_friend_projection_count: oldFriend.body.projections.length,
    };

    const first = await request(ownerToken, '/api/memory/coverage-snapshot?page_size=1');
    assert.equal(first.status, 200);
    await insertPoints(db, ownerId, 1, -43.53, 172.63, 'revision-change', 20_000);
    await materializeOwnerCoverage(db, ownerId);
    const changed = await request(ownerToken, `/api/memory/coverage-snapshot?${new URLSearchParams({
      page_size: '1',
      snapshot_id: first.body.manifest.snapshot_id,
      as_of: first.body.manifest.as_of,
      cursor: first.body.page.next_cursor,
    })}`);
    assert.equal(changed.status, 409);
    assert.equal(changed.body.code, 'SNAPSHOT_CHANGED');
    evidence.results.revision_change = { status: changed.status, code: changed.body.code };

    const friendFirst = await request(viewerToken, '/api/friend-sharing/coverage-snapshot', {
      method: 'POST', body: JSON.stringify({ friend_id: ownerId, page_size: 1 }),
    });
    assert.equal(friendFirst.status, 200);
    await db.execute(
      `UPDATE memory_share_grants SET status='revoked',revoked_at=UTC_TIMESTAMP(3),
         revoked_reason='corrective',authorization_version=authorization_version+1
       WHERE owner_id=? AND viewer_id=? AND status='active'`,
      [ownerId, viewerId],
    );
    await db.execute('DELETE FROM memory_subscriptions WHERE user_id=? AND friend_id=?', [viewerId, ownerId]);
    const projection = friendFirst.body.projections[0];
    const revoked = await request(viewerToken, '/api/friend-sharing/coverage-snapshot', {
      method: 'POST',
      body: JSON.stringify({
        friend_id: ownerId,
        page_size: 1,
        snapshot_id: projection.manifest.snapshot_id,
        as_of: projection.manifest.as_of,
        cursor: projection.page.next_cursor,
      }),
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(revoked.body.projections, []);
    assert.equal(revoked.body.revoked_friend_ids.length, 1);
    evidence.results.mid_snapshot_revoke = {
      status: revoked.status, projections: 0, revoked_source_count: revoked.body.revoked_friend_ids.length,
    };

    evidence.result = 'PASS';
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    if (createdUsers.length > 0) await db.query('DELETE FROM users WHERE id IN (?)', [createdUsers]);
    await db.query("DELETE FROM regions WHERE source='isolated_o92'");
    await db.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
