'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { currentMemoryGrant } = require('../src/services/friendAuthorization');
const { deriveFriendProjection, loadFriendProjectionEvidence } = require('../src/services/friendProjection');

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

function runBackfill(manifest, shouldApply) {
  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, 'o85-memory-history-backfill.js'),
    '--manifest-stdin',
    ...(shouldApply ? ['--apply'] : []),
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    input: JSON.stringify(manifest),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

(async () => {
  const db = await mysql.createConnection(dbConfig);
  const ownerEmail = `o85-owner-${crypto.randomUUID()}@example.org`;
  const viewerEmail = `o85-viewer-${crypto.randomUUID()}@example.org`;
  const [ownerInsert] = await db.execute(
    `INSERT INTO users (name,email,date_of_birth,password_hash,activity_source_realm)
     VALUES ('O85 History Owner',?,'1990-01-01','harness','standard')`,
    [ownerEmail],
  );
  const [viewerInsert] = await db.execute(
    `INSERT INTO users (name,email,date_of_birth,password_hash,activity_source_realm)
     VALUES ('O85 History Viewer',?,'1990-01-01','harness','standard')`,
    [viewerEmail],
  );
  const ownerId = Number(ownerInsert.insertId);
  const viewerId = Number(viewerInsert.insertId);
  const [lowId, highId] = [ownerId, viewerId].sort((a, b) => a - b);
  const friendshipStarted = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO friends (user_id,friend_id,created_at) VALUES
       (?,?,?),(?,?,?)`,
    [ownerId, viewerId, friendshipStarted, viewerId, ownerId, friendshipStarted],
  );
  const [episodeInsert] = await db.execute(
    `INSERT INTO friendship_episodes
       (episode_id,user_low_id,user_high_id,started_at)
     VALUES (?,?,?,?)`,
    [crypto.randomUUID(), lowId, highId, friendshipStarted],
  );
  await db.execute(
    `INSERT INTO memory_share_grants
       (owner_id,viewer_id,friendship_episode_id,grant_epoch,effective_at,
        coverage_scope,consent_version,status)
     VALUES (?,?,?,?,?,'full_history_delayed_v1',1,'active')`,
    [ownerId, viewerId, episodeInsert.insertId, crypto.randomUUID(), friendshipStarted],
  );

  const startMs = Date.now() - 4 * 60 * 60 * 1000;
  const activityId = crypto.randomUUID();
  const segmentId = `${activityId}:segment-1`;
  const route = [0, 60_000, 120_000].map((offset, index) => ({
    lat: -41.2865,
    lng: 174.7762 + index * 0.0008,
    t: startMs + offset,
    segment_id: segmentId,
  }));
  const raw = route.map(point => ({ ...point, acc: 8 }));
  const finalizedAt = new Date(startMs + 180_000);
  const [recoverableInsert] = await db.execute(
    `INSERT INTO sessions
       (user_id,client_activity_id,source_provenance,type,start_time,end_time,
        finalized_at,distance_m,duration_s,name,route_points,route_points_raw)
     VALUES (?,?,'unknown','hiking',?,?,?,180,180,'recoverable',?,?)`,
    [ownerId, activityId, new Date(startMs), finalizedAt, finalizedAt,
      JSON.stringify(route), JSON.stringify(raw)],
  );
  const [excludedInsert] = await db.execute(
    `INSERT INTO sessions
       (user_id,client_activity_id,source_provenance,type,start_time,end_time,
        finalized_at,distance_m,duration_s,name,route_points,route_points_raw)
     VALUES (?,?,'unknown','hiking',?,?,?,0,60,'excluded',?,?)`,
    [ownerId, crypto.randomUUID(), new Date(startMs - 600_000), new Date(startMs - 540_000),
      new Date(startMs - 540_000), JSON.stringify(route.slice(0, 2)), JSON.stringify([])],
  );
  await db.execute(
    `INSERT INTO memory_points
       (user_id,lat,lng,ts,client_id,evidence_source,continuity_state,received_at)
     VALUES (?,?,?,?,?,'historical_unknown','unknown',?)`,
    [ownerId, raw[0].lat, raw[0].lng, raw[0].t, crypto.randomUUID(), finalizedAt],
  );

  const manifest = {
    schema_version: 1,
    viewer_id: viewerId,
    owners: [{
      owner_id: ownerId,
      require_complete_inventory: true,
      select_for_viewer: true,
      sessions: [
        {
          session_id: Number(recoverableInsert.insertId),
          decision: 'recovered',
          strategy: 'pre_canonical_segmented',
          reason: 'accepted route times match segmented raw GPS with <=50m accuracy',
        },
        {
          session_id: Number(excludedInsert.insertId),
          decision: 'excluded',
          reason: 'no raw GPS quality evidence exists',
        },
      ],
    }],
  };

  runBackfill(manifest, false);
  const [[dryState]] = await db.execute(
    `SELECT source_provenance,route_points_canonical,
            (SELECT COUNT(*) FROM memory_activity_backfill_audit WHERE user_id=?) AS audit_n
       FROM sessions WHERE id=?`,
    [ownerId, recoverableInsert.insertId],
  );
  assert.equal(dryState.source_provenance, 'unknown');
  assert.equal(dryState.route_points_canonical, null);
  assert.equal(Number(dryState.audit_n), 0);

  runBackfill(manifest, true);
  const [[sessionState]] = await db.execute(
    `SELECT source_provenance,JSON_LENGTH(route_points_canonical) AS canonical_n
       FROM sessions WHERE id=?`,
    [recoverableInsert.insertId],
  );
  assert.equal(sessionState.source_provenance, 'native_real');
  assert.equal(Number(sessionState.canonical_n), 3);
  const [[memoryState]] = await db.execute(
    `SELECT COUNT(*) AS total_n,
            SUM(evidence_source='activity_real' AND continuity_state='accepted'
                AND horizontal_accuracy_m<=50) AS accepted_n,
            MAX(received_at) AS latest_receipt
       FROM memory_points WHERE user_id=?`,
    [ownerId],
  );
  assert.equal(Number(memoryState.total_n), 3);
  assert.equal(Number(memoryState.accepted_n), 3);
  assert.ok(new Date(memoryState.latest_receipt).getTime() <= finalizedAt.getTime() + 1);
  const [audits] = await db.execute(
    `SELECT decision,recovered_points,upgraded_points,inserted_points
       FROM memory_activity_backfill_audit WHERE user_id=? ORDER BY session_id`,
    [ownerId],
  );
  assert.deepEqual(audits.map(row => row.decision), ['recovered', 'excluded']);
  assert.equal(Number(audits[0].recovered_points), 3);
  assert.equal(Number(audits[0].upgraded_points), 1);
  assert.equal(Number(audits[0].inserted_points), 2);
  const [[selection]] = await db.execute(
    'SELECT COUNT(*) AS n FROM memory_subscriptions WHERE user_id=? AND friend_id=?',
    [viewerId, ownerId],
  );
  assert.equal(Number(selection.n), 1);

  const grant = await currentMemoryGrant(db, ownerId, viewerId, { requireSelected: true });
  assert.ok(grant);
  const evidence = await loadFriendProjectionEvidence(db, ownerId, grant);
  const projection = await deriveFriendProjection(db, ownerId, viewerId, grant);
  assert.equal(evidence.filter(row => row.evidence_kind === 'coverage').length, 3);
  assert.ok(projection.cells.length > 0);
  assert.equal(projection.projection_policy_version, 2);

  runBackfill(manifest, true);
  const [[idempotentState]] = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM memory_points WHERE user_id=?) AS memory_n,
       (SELECT COUNT(*) FROM memory_activity_backfill_audit WHERE user_id=?) AS audit_n`,
    [ownerId, ownerId],
  );
  assert.equal(Number(idempotentState.memory_n), 3);
  assert.equal(Number(idempotentState.audit_n), 2);

  process.stdout.write(`${JSON.stringify({
    result: 'PASS',
    assertions: {
      dry_run_rollback: true,
      recovered_sessions: 1,
      excluded_sessions: 1,
      recovered_points: 3,
      upgraded_points: 1,
      inserted_points: 2,
      projection_evidence_rows: evidence.length,
      projection_cells: projection.cells.length,
      selected_directional_source: true,
      idempotent_rerun: true,
    },
  }, null, 2)}\n`);
  await db.end();
})().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
