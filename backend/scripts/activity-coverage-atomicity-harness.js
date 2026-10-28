#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('node:path');
const mysql = require('mysql2/promise');

const apiBase = process.env.HARNESS_API_URL;
const runId = process.env.HARNESS_RUN_ID || crypto.randomUUID();
const failStage = process.env.COVERAGE_FAIL_STAGE || 'regions';
const sourceBackendDir = process.env.TARGET_BACKEND_DIR || path.resolve(__dirname, '..');
const { synchronizeCoverageEvidenceForActivity } = require(path.join(
  sourceBackendDir,
  'src/services/memoryCoverage.js',
));

async function request(route, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiBase}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
  return { status: response.status, json };
}

function faultConnection(connection, stage) {
  let injected = false;
  return {
    beginTransaction: (...args) => connection.beginTransaction(...args),
    commit: (...args) => connection.commit(...args),
    rollback: (...args) => connection.rollback(...args),
    async execute(sql, params) {
      const isRegion = typeof sql === 'string' && sql.includes('INSERT IGNORE INTO memory_coverage_regions');
      const isRevision = typeof sql === 'string' && sql.includes('INSERT INTO memory_coverage_source_state');
      if (!injected && ((stage === 'regions' && isRegion) || (stage === 'revision' && isRevision))) {
        injected = true;
        const error = new Error(`isolated_coverage_fail_${stage}`);
        error.code = `QA_FAIL_${stage.toUpperCase()}`;
        throw error;
      }
      return connection.execute(sql, params);
    },
  };
}

async function projectionState(db, userId, clientActivityId) {
  const [[row]] = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM memory_coverage_evidence evidence
          JOIN memory_points point ON point.id=evidence.memory_point_id
         WHERE evidence.owner_id=? AND point.source_activity_client_id=?) AS evidence_rows,
       (SELECT COUNT(*) FROM memory_coverage_regions mapped
          JOIN memory_points point ON point.id=mapped.memory_point_id
         WHERE mapped.owner_id=? AND point.source_activity_client_id=?) AS region_rows,
       (SELECT COALESCE(MAX(evidence_revision),0) FROM memory_coverage_source_state WHERE owner_id=?) AS revision`,
    [userId, clientActivityId, userId, clientActivityId, userId],
  );
  return {
    evidenceRows: Number(row.evidence_rows),
    regionRows: Number(row.region_rows),
    revision: Number(row.revision),
  };
}

async function main() {
  assert.ok(['regions', 'revision'].includes(failStage));
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    timezone: 'Z',
  });
  const receipt = {
    schema: 'cairn.activity-coverage-atomicity.v1',
    evidence: 'REAL_MYSQL_8_PRODUCTION_SERVICE_MODULE',
    runId,
    failStage,
    assertions: [],
  };
  try {
    const email = `coverage-atomic-${runId}@example.com`;
    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Coverage Atomic Harness', email, password: 'Harness-only-2026!', dateOfBirth: '1990-01-01' },
    });
    assert.equal(registered.status, 200, JSON.stringify(registered));
    const verified = await request('/api/auth/verify', {
      method: 'POST', body: { email, code: registered.json.dev_code },
    });
    assert.equal(verified.status, 201, JSON.stringify(verified));
    const token = verified.json.token;
    const userId = Number(verified.json.user.id);
    const clientActivityId = crypto.randomUUID();
    const segmentId = `${clientActivityId}:segment-0`;
    const observedAt = Date.now() - 60_000;
    const point = { lat: -41.2865, lng: 174.7762, t: observedAt, segment_id: segmentId };
    const started = await request('/api/sessions/start', {
      method: 'POST', token,
      body: {
        client_op_id: crypto.randomUUID(), client_activity_id: clientActivityId,
        type: 'hiking', start_time: new Date(observedAt - 1_000).toISOString(),
      },
    });
    assert.equal(started.status, 201, JSON.stringify(started));
    await db.execute(
      `UPDATE sessions SET finalized_at=UTC_TIMESTAMP(3), end_time=UTC_TIMESTAMP(3),
         source_provenance='native_real', route_points_canonical=?
       WHERE id=? AND user_id=?`,
      [JSON.stringify([point, { ...point, lat: point.lat + 0.00001, t: point.t + 1_000 }]), Number(started.json.id), userId],
    );
    await db.execute(
      `INSERT INTO regions
       (id,parent_id,name_en,level,bbox_min_lng,bbox_min_lat,bbox_max_lng,bbox_max_lat,geom,source)
       VALUES (?,NULL,'Atomic QA Region',3,174.7,-41.4,174.9,-41.2,
         ST_GeomFromText('POLYGON((174.7 -41.4,174.9 -41.4,174.9 -41.2,174.7 -41.2,174.7 -41.4))',4326,'axis-order=long-lat'),
         'isolated_o96')`,
      [`atomic-${runId}`],
    );
    await db.execute(
      `INSERT INTO memory_points
       (user_id,lat,lng,ts,client_id,evidence_source,source_activity_client_id,
        source_segment_id,horizontal_accuracy_m,continuity_state)
       VALUES (?,?,?,?,?,'activity_real',?,?,6,'accepted')`,
      [userId, point.lat, point.lng, point.t, crypto.randomUUID(), clientActivityId, segmentId],
    );

    const transactionConnection = await db.getConnection?.() || db;
    let injectedError = null;
    try {
      await synchronizeCoverageEvidenceForActivity(
        faultConnection(transactionConnection, failStage),
        userId,
        clientActivityId,
      );
    } catch (error) {
      injectedError = { code: error.code, message: error.message };
    }
    if (transactionConnection !== db) transactionConnection.release();
    receipt.injectedError = injectedError;
    receipt.afterFailure = await projectionState(db, userId, clientActivityId);
    receipt.assertions.push({
      id: 'COVERAGE.FAILURE.ROLLS_BACK.COMPLETE.TRANSITION',
      result: receipt.afterFailure.evidenceRows === 0
        && receipt.afterFailure.regionRows === 0
        && receipt.afterFailure.revision === 0 ? 'PASS' : 'FAIL',
      actual: receipt.afterFailure,
    });

    const retryPool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      timezone: 'Z',
      connectionLimit: 2,
    });
    await Promise.all([
      synchronizeCoverageEvidenceForActivity(retryPool, userId, clientActivityId),
      synchronizeCoverageEvidenceForActivity(retryPool, userId, clientActivityId),
    ]);
    receipt.afterRetry = await projectionState(db, userId, clientActivityId);
    receipt.assertions.push({
      id: 'COVERAGE.RETRY.REPAIRS.EVIDENCE.REGION.REVISION',
      result: receipt.afterRetry.evidenceRows === 1
        && receipt.afterRetry.regionRows === 1
        // Migration 051 defines the initial revision as 1 + evidence count.
        && receipt.afterRetry.revision === 2 ? 'PASS' : 'FAIL',
      actual: receipt.afterRetry,
    });
    await synchronizeCoverageEvidenceForActivity(retryPool, userId, clientActivityId);
    receipt.afterIdempotentReplay = await projectionState(db, userId, clientActivityId);
    receipt.assertions.push({
      id: 'COVERAGE.COMPETING.RETRY.IDEMPOTENT.REVISION',
      result: JSON.stringify(receipt.afterIdempotentReplay) === JSON.stringify(receipt.afterRetry)
        ? 'PASS' : 'FAIL',
      actual: receipt.afterIdempotentReplay,
    });
    await retryPool.end();
    receipt.passed = Boolean(injectedError) && receipt.assertions.every(item => item.result === 'PASS');
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.passed) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main().catch(error => {
  process.stderr.write(`coverage atomicity harness failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
