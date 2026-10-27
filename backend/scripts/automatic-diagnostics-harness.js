#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mysql = require('mysql2/promise');

const ACTIVITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROUTE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_SESSION = 'route-edit-harness-a';
const MEMORY_SCOPE = 'memory-harness-a';
const requestMetrics = [];

function batch({
  batchId,
  streamId,
  sourceType = 'activity',
  ownerEpoch = 'epoch-a',
  sequence = 1,
  eventCode = 'ACTIVITY_WAL_COMMITTED',
  details = {},
  requiredPolicyTier = 'tier_a',
}) {
  return {
    schema: 'cairn-auto-diagnostics-batch',
    version: 1,
    batchId,
    batchSequence: sequence,
    stream: {
      streamId,
      sourceType,
      ownerEpoch,
      ...(sourceType === 'activity' ? { clientActivityId: ACTIVITY_ID, activityMode: 'hiking' } : {}),
      ...(sourceType === 'route' ? { clientRouteId: ROUTE_ID, routeEditSessionId: ROUTE_SESSION } : {}),
      ...(sourceType === 'memory' ? { memoryScopeId: MEMORY_SCOPE } : {}),
      runtimeVersion: '0.2.6-o88',
      updateId: 'synthetic-harness-update',
    },
    droppedCount: 0,
    requiredPolicyTier,
    events: [{
      eventId: `${batchId}-event`,
      eventSequence: sequence,
      eventCode,
      sourceModule: sourceType === 'activity' ? 'activityStageLedger' : `${sourceType}Harness`,
      severity: 'info',
      eventAt: 1_761_177_600_000 + sequence * 1_000,
      monotonicMs: 100 + sequence,
      details,
    }],
  };
}

async function request(baseUrl, token, method, urlPath, body, extraHeaders = {}) {
  const encodedBody = body ? JSON.stringify(body) : '';
  const started = process.hrtime.bigint();
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    ...(body ? { body: encodedBody } : {}),
  });
  const responseText = await response.text();
  let json = null;
  try { json = responseText ? JSON.parse(responseText) : null; } catch { /* status is still evidence */ }
  requestMetrics.push({
    status: response.status,
    durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
    requestBytes: Buffer.byteLength(encodedBody),
    responseBytes: Buffer.byteLength(responseText),
  });
  return { status: response.status, json };
}

async function main() {
  let admin;
  // Docker Desktop can report mysqladmin-ready inside the disposable
  // container before its randomly published localhost port accepts TCP.
  // Keep this bounded and fail rather than falling back to a mock database.
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      admin = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true,
      });
      await admin.query('SELECT 1');
      break;
    } catch {
      try { await admin?.end(); } catch { /* retry disposable DB readiness */ }
      admin = null;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!admin) throw new Error('disposable_mysql_tcp_not_ready');
  await admin.query('ALTER DATABASE cairn_diag_harness CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await admin.query(`
    CREATE TABLE users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      token_version INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB;
    CREATE TABLE token_blacklist (
      jti VARCHAR(64) NOT NULL,
      user_id BIGINT UNSIGNED NULL,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (jti)
    ) ENGINE=InnoDB;
    CREATE TABLE sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      client_activity_id CHAR(36) NULL,
      type VARCHAR(16) NOT NULL DEFAULT 'hiking',
      start_time DATETIME NOT NULL,
      end_time DATETIME NULL,
      finalized_at DATETIME NULL,
      PRIMARY KEY (id),
      INDEX idx_harness_activity (user_id, client_activity_id)
    ) ENGINE=InnoDB;
    CREATE TABLE activity_client_tombstones (
      user_id BIGINT UNSIGNED NOT NULL,
      client_activity_id CHAR(36) NOT NULL,
      discarded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, client_activity_id)
    ) ENGINE=InnoDB;
    CREATE TABLE route_client_tombstones (
      user_id BIGINT UNSIGNED NOT NULL,
      client_route_id CHAR(36) NOT NULL,
      deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, client_route_id)
    ) ENGINE=InnoDB;
    INSERT INTO users (id, token_version) VALUES (1, 0), (2, 0);
    INSERT INTO sessions
      (user_id, client_activity_id, type, start_time, end_time, finalized_at)
    VALUES
      (1, '${ACTIVITY_ID}', 'hiking', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP()),
      (2, '${ACTIVITY_ID}', 'running', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP());
  `);
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../src/migrations/057_automatic_diagnostics.sql'),
    'utf8',
  );
  await admin.query(migration);

  const pool = require('../src/config/db');
  const {
    ingestAutomaticDiagnosticBatch,
    purgeExpiredAutomaticDiagnostics,
    queryAutomaticDiagnostics,
    setAutomaticDiagnosticEnrollment,
  } = require('../src/services/automaticDiagnostics');
  await setAutomaticDiagnosticEnrollment(pool, {
    ownerUserId: 1, enabled: true, tier: 'tier_a', consentVersion: 'owner-qa-v1',
  });
  await setAutomaticDiagnosticEnrollment(pool, {
    ownerUserId: 2, enabled: true, tier: 'tier_a', consentVersion: 'owner-qa-v1',
  });

  const { signToken } = require('../src/config/jwt');
  const tokenA = signToken({ userId: 1, token_version: 0 });
  const tokenB = signToken({ userId: 2, token_version: 0 });
  const app = express();
  app.set('trust proxy', false);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/telemetry', require('../src/routes/telemetry'));
  app.use((error, req, res, next) => {
    void req; void next;
    res.status(error?.status || 500).json({ code: error?.type || 'HARNESS_BODY_ERROR' });
  });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const ops = { 'X-API-Key': process.env.CAIRN_TELEMETRY_API_KEY };
  const checks = {};
  try {
    checks.invalidToken = (await request(baseUrl, 'invalid', 'POST', '/api/telemetry/diagnostics/batches', {})).status;
    assert.equal(checks.invalidToken, 401);

    const malformed = batch({ batchId: 'malformed-a', streamId: 'activity:a' });
    delete malformed.events[0].eventSequence;
    checks.malformed = (await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', malformed)).status;
    assert.equal(checks.malformed, 400);

    const oversized = batch({
      batchId: 'oversized-a', streamId: 'activity:a', details: { diagnostic: 'x'.repeat(70 * 1024) },
    });
    checks.oversized = (await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', oversized)).status;
    assert.equal(checks.oversized, 413);

    const first = batch({
      batchId: 'batch-shared-owner-safe',
      streamId: 'activity:a',
      details: { latitude: -41.2, longitude: 174.7, accessToken: 'must-not-survive', acceptedCount: 1 },
    });
    first.ownerUserId = 2;
    const firstReceipt = await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', first);
    assert.equal(firstReceipt.status, 200);
    assert.equal(firstReceipt.json.duplicate, false);
    const duplicate = await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', first);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.json.duplicate, true);
    checks.idempotentReplay = duplicate.json.duplicate;

    const conflicting = structuredClone(first);
    conflicting.events[0].details.acceptedCount = 2;
    checks.idempotencyConflict = (await request(
      baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', conflicting,
    )).status;
    assert.equal(checks.idempotencyConflict, 409);

    const ownerB = batch({ batchId: 'batch-shared-owner-safe', streamId: 'activity:a', ownerEpoch: 'epoch-b' });
    checks.sameUuidOtherOwner = (await request(
      baseUrl, tokenB, 'POST', '/api/telemetry/diagnostics/batches', ownerB,
    )).status;
    assert.equal(checks.sameUuidOtherOwner, 200);

    const wrongEpoch = batch({ batchId: 'wrong-epoch-a', streamId: 'activity:a', ownerEpoch: 'epoch-wrong', sequence: 2 });
    checks.wrongEpoch = (await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', wrongEpoch)).status;
    assert.equal(checks.wrongEpoch, 409);

    const range = batch({ batchId: 'range-a', streamId: 'app:range', sourceType: 'app', sequence: 1 });
    range.events.push({ ...range.events[0], eventId: 'range-event-2', eventSequence: 2, eventAt: 1_700_000_000_002 });
    assert.equal((await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', range)).status, 200);
    const overlap = batch({ batchId: 'range-overlap', streamId: 'app:range', sourceType: 'app', sequence: 2 });
    checks.sequenceRangeOverlap = (await request(
      baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', overlap,
    )).status;
    assert.equal(checks.sequenceRangeOverlap, 409);

    const sequence3 = batch({ batchId: 'sequence-3-a', streamId: 'activity:a', sequence: 3 });
    const sequence2 = batch({ batchId: 'sequence-2-a', streamId: 'activity:a', sequence: 2 });
    assert.equal((await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', sequence3)).status, 200);
    assert.equal((await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', sequence2)).status, 200);
    checks.reorderedAccepted = true;

    const route = batch({ batchId: 'route-a', streamId: 'route:a', sourceType: 'route', eventCode: 'ROUTE_DRAW_REJECTED' });
    const memory = batch({ batchId: 'memory-a', streamId: 'memory:a', sourceType: 'memory', eventCode: 'FOG_SHAPE_BUILT' });
    assert.equal((await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', route)).status, 200);
    assert.equal((await request(baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', memory)).status, 200);

    checks.readWithoutOpsKey = (await request(
      baseUrl, null, 'GET', `/api/telemetry/diagnostics/activity/${ACTIVITY_ID}?owner_id=1`, null,
    )).status;
    assert.equal(checks.readWithoutOpsKey, 401);
    const activityQuery = await request(
      baseUrl, null, 'GET', `/api/telemetry/diagnostics/activity/${ACTIVITY_ID}?owner_id=1`, null, ops,
    );
    assert.equal(activityQuery.status, 200);
    assert.equal(activityQuery.json.ownerUserId, 1);
    assert.equal(activityQuery.json.count, 1);
    assert.deepEqual(activityQuery.json.streams[0].sequenceGaps, []);
    const serialized = JSON.stringify(activityQuery.json);
    assert.equal(serialized.includes('-41.2'), false);
    assert.equal(serialized.includes('174.7'), false);
    assert.equal(serialized.includes('must-not-survive'), false);
    checks.activityQuery = {
      status: activityQuery.status,
      streams: activityQuery.json.count,
      events: activityQuery.json.streams[0].events.length,
      uploadStatus: activityQuery.json.streams[0].uploadStatus,
      sequenceGaps: activityQuery.json.streams[0].sequenceGaps,
      preciseCoordinatesPresent: false,
    };

    const tierARejected = batch({
      batchId: 'precise-tier-a-rejected',
      streamId: 'activity:precise-tier-a',
      ownerEpoch: 'epoch-precise-tier-a',
      requiredPolicyTier: 'tier_b',
      details: { replayKind: 'raw-observation', lat: -41.28664, lng: 174.77557 },
    });
    const tierARejectedReceipt = await request(
      baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', tierARejected,
    );
    assert.equal(tierARejectedReceipt.status, 403);
    assert.equal(tierARejectedReceipt.json.code, 'DIAGNOSTIC_TIER_REQUIRED');

    await setAutomaticDiagnosticEnrollment(pool, {
      ownerUserId: 2, enabled: true, tier: 'tier_b', consentVersion: 'owner-qa-tier-b-v1',
    });
    const precise = batch({
      batchId: 'precise-tier-b-accepted',
      streamId: 'activity:precise-tier-b',
      ownerEpoch: 'epoch-precise-tier-b',
      requiredPolicyTier: 'tier_b',
      details: {
        replayKind: 'raw-observation',
        lat: -41.28664,
        lng: 174.77557,
        accessToken: 'must-not-survive',
      },
    });
    const preciseReceipt = await request(
      baseUrl, tokenB, 'POST', '/api/telemetry/diagnostics/batches', precise,
    );
    assert.equal(preciseReceipt.status, 200);
    const preciseQuery = await request(
      baseUrl, null, 'GET', `/api/telemetry/diagnostics/activity/${ACTIVITY_ID}?owner_id=2`, null, ops,
    );
    assert.equal(preciseQuery.status, 200);
    const preciseSerialized = JSON.stringify(preciseQuery.json);
    assert.equal(preciseSerialized.includes('-41.28664'), true);
    assert.equal(preciseSerialized.includes('174.77557'), true);
    assert.equal(preciseSerialized.includes('must-not-survive'), false);
    checks.preciseOwnerDiagnostics = {
      tierARejected: tierARejectedReceipt.status,
      tierBStoredAndReadable: true,
      credentialsRemoved: true,
      retrieval: 'operations-key-plus-owner-id',
    };
    const missingQuery = await request(
      baseUrl, null, 'GET', '/api/telemetry/diagnostics/activity/cccccccc-cccc-4ccc-8ccc-cccccccccccc?owner_id=1', null, ops,
    );
    assert.equal(missingQuery.status, 200);
    assert.equal(missingQuery.json.count, 0);
    assert.equal(missingQuery.json.diagnosticState, 'UNKNOWN_NO_SERVER_STREAM_CLIENT_STATE_UNAVAILABLE');
    checks.missingServerStream = missingQuery.json.diagnosticState;
    for (const [kind, identity] of [['route', ROUTE_SESSION], ['memory', MEMORY_SCOPE]]) {
      const result = await request(
        baseUrl, null, 'GET', `/api/telemetry/diagnostics/${kind}/${identity}?owner_id=1`, null, ops,
      );
      assert.equal(result.status, 200);
      assert.equal(result.json.count, 1);
      checks[`${kind}Query`] = { status: result.status, streams: result.json.count };
    }

    // Retention is anchored to the server's received_at clock. Model Day 31
    // with a Day 0 batch and a Day 29 batch on the same continuing stream.
    // The old batch must expire without removing the new batch or stream.
    await setAutomaticDiagnosticEnrollment(pool, {
      ownerUserId: 2, enabled: true, tier: 'tier_b', consentVersion: 'owner-qa-tier-b-v1',
    });
    for (const input of [
      { ownerUserId: 1, tier: 'tier-a', retentionDays: 30 },
      { ownerUserId: 2, tier: 'tier-b', retentionDays: 14 },
    ]) {
      await ingestAutomaticDiagnosticBatch(pool, input.ownerUserId, batch({
        batchId: `retention-${input.tier}-day-0`,
        streamId: `app:retention-${input.tier}`,
        sourceType: 'app',
        ownerEpoch: `epoch-${input.tier}`,
        sequence: 1,
      }));
      await ingestAutomaticDiagnosticBatch(pool, input.ownerUserId, batch({
        batchId: `retention-${input.tier}-day-29`,
        streamId: `app:retention-${input.tier}`,
        sourceType: 'app',
        ownerEpoch: `epoch-${input.tier}`,
        sequence: 2,
      }));
      await pool.execute(
        `UPDATE diagnostic_batches
            SET received_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY),
                expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
          WHERE owner_user_id = ? AND batch_id = ?`,
        [input.retentionDays + 1, input.ownerUserId, `retention-${input.tier}-day-0`],
      );
      await pool.execute(
        `UPDATE diagnostic_batches
            SET received_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY),
                expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY)
          WHERE owner_user_id = ? AND batch_id = ?`,
        [input.retentionDays - 2, input.ownerUserId, `retention-${input.tier}-day-29`],
      );
      await pool.execute(
        `UPDATE diagnostic_streams
            SET expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY)
          WHERE owner_user_id = ? AND stream_id = ?`,
        [input.retentionDays - 2, input.ownerUserId, `app:retention-${input.tier}`],
      );
    }

    await ingestAutomaticDiagnosticBatch(pool, 1, batch({
      batchId: 'retention-fully-expired',
      streamId: 'app:retention-fully-expired',
      sourceType: 'app',
      ownerEpoch: 'epoch-fully-expired',
      sequence: 1,
    }));
    await pool.execute(
      `UPDATE diagnostic_batches b
         JOIN diagnostic_streams s ON s.id = b.stream_fk
          SET b.received_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 31 DAY),
              b.expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND),
              s.expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
        WHERE b.owner_user_id = 1 AND b.batch_id = 'retention-fully-expired'`,
    );

    checks.retentionRowsPurged = await purgeExpiredAutomaticDiagnostics(pool, 500);
    const [retentionRows] = await pool.execute(
      `SELECT owner_user_id, batch_id FROM diagnostic_batches
        WHERE batch_id LIKE 'retention-%' ORDER BY owner_user_id, batch_id`,
    );
    checks.retentionRemainingBatches = retentionRows;
    assert.deepEqual(retentionRows.map(row => row.batch_id), [
      'retention-tier-a-day-29',
      'retention-tier-b-day-29',
    ]);
    const [expiredStreams] = await pool.execute(
      "SELECT COUNT(*) AS count FROM diagnostic_streams WHERE stream_id = 'app:retention-fully-expired'",
    );
    assert.equal(Number(expiredStreams[0].count), 0);
    const tierAQuery = await queryAutomaticDiagnostics(pool, { ownerUserId: 1, sourceType: 'app', limit: 20 });
    const tierAStream = tierAQuery.streams.find(stream => stream.stream_id === 'app:retention-tier-a');
    assert.ok(tierAStream);
    assert.deepEqual(tierAStream.batches.map(item => item.batch_id), ['retention-tier-a-day-29']);
    assert.deepEqual(tierAStream.sequenceGaps, [{ after: 0, before: 2 }]);
    assert.equal(Number(tierAStream.total_batches), 1);
    assert.equal(Number(tierAStream.total_events), 1);
    const tierBQuery = await queryAutomaticDiagnostics(pool, { ownerUserId: 2, sourceType: 'app', limit: 20 });
    const tierBStream = tierBQuery.streams.find(stream => stream.stream_id === 'app:retention-tier-b');
    assert.ok(tierBStream);
    assert.deepEqual(tierBStream.batches.map(item => item.batch_id), ['retention-tier-b-day-29']);
    checks.retentionCounterexample = {
      anchor: 'server_received_at',
      tierAOldGoneNewIntact: true,
      tierBOldGoneNewIntact: true,
      fullyExpiredStreamGone: true,
      tierASequenceGaps: tierAStream.sequenceGaps,
      crossOwnerStreamsIntact: true,
    };
    checks.retentionIdempotentRepeat = await purgeExpiredAutomaticDiagnostics(pool, 500);
    assert.equal(checks.retentionIdempotentRepeat, 0);

    await ingestAutomaticDiagnosticBatch(pool, 1, batch({
      batchId: 'retention-fk-cascade',
      streamId: 'app:retention-fk-cascade',
      sourceType: 'app',
      ownerEpoch: 'epoch-fk-cascade',
      sequence: 1,
    }));
    await pool.execute(
      "DELETE FROM diagnostic_streams WHERE owner_user_id = 1 AND stream_id = 'app:retention-fk-cascade'",
    );
    const [cascadeRows] = await pool.execute(
      "SELECT COUNT(*) AS count FROM diagnostic_batches WHERE owner_user_id = 1 AND batch_id = 'retention-fk-cascade'",
    );
    checks.retentionForeignKeyCascade = Number(cascadeRows[0].count) === 0;
    assert.equal(checks.retentionForeignKeyCascade, true);

    const [[streamRows], [batchRows]] = await Promise.all([
      pool.execute('SELECT COUNT(*) AS count FROM diagnostic_streams'),
      pool.execute('SELECT COUNT(*) AS count, COALESCE(SUM(payload_bytes), 0) AS bytes FROM diagnostic_batches'),
    ]);
    checks.storageBeforeDeletion = {
      streamRows: Number(streamRows[0].count),
      batchRows: Number(batchRows[0].count),
      logicalPayloadBytes: Number(batchRows[0].bytes),
    };
    await pool.execute('DELETE FROM diagnostic_streams WHERE owner_user_id = ? AND client_activity_id = ?', [1, ACTIVITY_ID]);
    await pool.execute(
      'INSERT INTO activity_client_tombstones (user_id, client_activity_id) VALUES (?, ?)',
      [1, ACTIVITY_ID],
    );
    const late = batch({ batchId: 'late-after-delete-a', streamId: 'activity:a', sequence: 4 });
    checks.lateAfterDelete = (await request(
      baseUrl, tokenA, 'POST', '/api/telemetry/diagnostics/batches', late,
    )).status;
    assert.equal(checks.lateAfterDelete, 410);

    await pool.execute("UPDATE diagnostic_batches SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE owner_user_id = 2");
    await pool.execute("UPDATE diagnostic_streams SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE owner_user_id = 2");
    checks.ttlPurgedRows = await purgeExpiredAutomaticDiagnostics(pool, 500);
    // One additional Tier B stream plus its batch are now part of the
    // owner-scoped expiry proof (the purge reports affected batches+streams).
    assert.equal(checks.ttlPurgedRows, 6);

    const disabled = await setAutomaticDiagnosticEnrollment(pool, {
      ownerUserId: 1, enabled: false, tier: 'tier_a', consentVersion: 'owner-qa-v1-revoked',
    });
    checks.consentRevocation = { enabled: disabled.enabled, deletedStreams: disabled.deletedStreams };
    assert.equal(disabled.enabled, false);
    assert.ok(disabled.deletedStreams >= 2);
    const [remaining] = await pool.execute('SELECT COUNT(*) AS count FROM diagnostic_streams WHERE owner_user_id = 1');
    assert.equal(Number(remaining[0].count), 0);

    const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM diagnostic_batches');
    checks.remainingBatchRows = Number(rows[0].count);
    assert.equal(checks.remainingBatchRows, 0);
    const durations = requestMetrics.map(item => item.durationMs).sort((left, right) => left - right);
    checks.apiWork = {
      requests: requestMetrics.length,
      requestBytes: requestMetrics.reduce((sum, item) => sum + item.requestBytes, 0),
      responseBytes: requestMetrics.reduce((sum, item) => sum + item.responseBytes, 0),
      p50Ms: Number(durations[Math.floor(durations.length * 0.50)].toFixed(3)),
      p95Ms: Number(durations[Math.floor(durations.length * 0.95)].toFixed(3)),
      maxMs: Number(Math.max(...durations).toFixed(3)),
      runtime: 'local-loopback-node-not-production-network',
    };
    process.stdout.write(`${JSON.stringify({
      schema: 'cairn-automatic-diagnostics-harness-receipt',
      version: 1,
      database: 'disposable-mysql-8',
      api: 'real-express-http',
      checks,
    }, null, 2)}\n`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
    await admin.end();
  }
}

main().catch(error => {
  process.stderr.write(`automatic diagnostics harness failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
