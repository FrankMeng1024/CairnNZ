#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { lockName } = require('../src/services/activitySaveGuard');

const apiBase = process.env.HARNESS_API_URL;
const runId = process.env.HARNESS_RUN_ID || `${Date.now()}-${process.pid}`;
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(apiBase || '')) {
  throw new Error('HARNESS_API_URL must be loopback');
}

const receipt = {
  schema: 'cairn.activity-save-concurrency-harness.v1',
  database: 'disposable-mysql-8',
  api: 'real-express-http',
  runId,
  assertions: [],
  timings: {},
};

function pass(id, detail) {
  receipt.assertions.push({ id, result: 'PASS', detail });
}

async function request(path, { method = 'GET', token, body, idempotencyKey } = {}) {
  const started = performance.now();
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const json = (() => { try { return text ? JSON.parse(text) : null; } catch { return null; } })();
  return { status: response.status, json, durationMs: performance.now() - started };
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    timezone: 'Z',
  });
  const email = `activity-save-${runId}@example.com`;
  try {
    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Activity Save Harness', email, password: 'Harness-only-2026!', dateOfBirth: '1990-01-01' },
    });
    assert.equal(registered.status, 200, JSON.stringify(registered.json));
    const verified = await request('/api/auth/verify', {
      method: 'POST', body: { email, code: registered.json.dev_code },
    });
    assert.equal(verified.status, 201, JSON.stringify(verified.json));
    const token = verified.json.token;
    const userId = Number(verified.json.user.id);
    assert.ok(token && Number.isSafeInteger(userId));

    const clientActivityId = crypto.randomUUID();
    const startAt = Date.now() - 120_000;
    const segmentId = `${clientActivityId}:segment-0`;
    const points = Array.from({ length: 250 }, (_, index) => ({
      lat: -41.2865 + index * 0.000001,
      lng: 174.7762 + index * 0.000001,
      t: startAt + index * 400,
      acc: 6,
      speed_mps: 1.2,
      raw_ordinal: index,
      segment_id: segmentId,
      ...(index === 0 ? { segment_start_reason: 'start' } : {}),
    }));
    const started = await request('/api/sessions/start', {
      method: 'POST', token,
      body: { client_op_id: crypto.randomUUID(), client_activity_id: clientActivityId, type: 'hiking', start_time: new Date(startAt).toISOString() },
    });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const sessionId = Number(started.json.id);

    const externalLock = lockName(userId, sessionId);
    const [[held]] = await db.execute('SELECT GET_LOCK(?, 0) AS acquired', [externalLock]);
    assert.equal(Number(held.acquired), 1);
    const busySave = await request(`/api/sessions/${sessionId}/save`, {
      method: 'PATCH', token, idempotencyKey: crypto.randomUUID(),
      body: {
        client_activity_id: clientActivityId,
        end_time: new Date(points.at(-1).t).toISOString(),
        distance_m: 100,
        duration_s: 100,
        name: 'Busy guard proof',
        route_points: points,
        route_points_raw: points,
        route_points_canonical: points,
        memory_points: [],
      },
    });
    assert.equal(busySave.status, 425, JSON.stringify(busySave.json));
    assert.equal(busySave.json.code, 'ACTIVITY_SAVE_IN_PROGRESS');
    assert.ok(busySave.durationMs < 2_000, `busy response took ${busySave.durationMs}ms`);
    await db.execute('SELECT RELEASE_LOCK(?) AS released', [externalLock]);
    pass('SAVE.GUARD.BOUNDED', 'An externally held same-owner/session MySQL lock produces a bounded 425 terminal instead of a queued Save.');

    const invalidAppend = await request(`/api/sessions/${sessionId}/append-points`, {
      method: 'PATCH', token, idempotencyKey: crypto.randomUUID(),
      body: { client_op_id: crypto.randomUUID(), points: [{ latitude: -41.2, longitude: 174.7, timestamp: startAt }] },
    });
    assert.equal(invalidAppend.status, 400);
    const validAppend = await request(`/api/sessions/${sessionId}/append-points`, {
      method: 'PATCH', token, idempotencyKey: crypto.randomUUID(),
      body: { client_op_id: crypto.randomUUID(), points: points.slice(0, 20) },
    });
    assert.equal(validAppend.status, 200, JSON.stringify(validAppend.json));
    assert.equal(validAppend.json.appended, 20);
    pass('APPEND.STRICT.CONTRACT', 'The actual API rejects legacy camel aliases and accepts the normalized strict point shape.');

    const saveKey = crypto.randomUUID();
    const savePayload = {
      client_activity_id: clientActivityId,
      end_time: new Date(points.at(-1).t).toISOString(),
      distance_m: 100,
      duration_s: 100,
      name: 'Save concurrency proof',
      route_points: points,
      route_points_raw: points,
      route_points_canonical: points,
      memory_points: points.map((point, index) => ({
        lat: point.lat, lng: point.lng, ts: point.t,
        cid: crypto.randomUUID(), evidence_source: 'activity_real',
        source_activity_client_id: clientActivityId,
        source_segment_id: segmentId,
        horizontal_accuracy_m: point.acc,
        continuity_state: 'accepted',
      })),
    };
    const independentMemory = points.slice(0, 40).map(point => ({
      lat: point.lat, lng: point.lng, ts: point.t,
      cid: crypto.randomUUID(), evidence_source: 'activity_real',
      source_activity_client_id: clientActivityId,
      source_segment_id: segmentId,
      horizontal_accuracy_m: point.acc,
      continuity_state: 'accepted',
    }));
    const [saved, memory] = await Promise.all([
      request(`/api/sessions/${sessionId}/save`, {
        method: 'PATCH', token, body: savePayload, idempotencyKey: saveKey,
      }),
      request('/api/memory/points', {
        method: 'POST', token, body: { points: independentMemory },
      }),
    ]);
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(memory.status, 200, JSON.stringify(memory.json));
    assert.equal(saved.json.client_activity_id, clientActivityId);
    for (const key of ['guard_wait_ms', 'pool_wait_ms', 'session_lock_wait_ms', 'memory_write_ms', 'coverage_sync_ms', 'commit_ms', 'total_ms']) {
      assert.equal(Number.isFinite(saved.json.server_timing?.[key]), true, `missing timing ${key}`);
    }
    receipt.timings.save = saved.json.server_timing;
    receipt.timings.http = { saveMs: saved.durationMs, memoryMs: memory.durationMs, busySaveMs: busySave.durationMs };
    pass('SAVE.MEMORY.CONCURRENCY', 'Concurrent real Memory POST and Activity Save both terminate; Save reports transaction stage timings.');

    const replay = await request(`/api/sessions/${sessionId}/save`, {
      method: 'PATCH', token, body: savePayload, idempotencyKey: saveKey,
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.json));
    assert.equal(replay.json.client_activity_id, clientActivityId);
    const [[rows]] = await db.execute(
      `SELECT COUNT(*) AS sessions,
              SUM(finalized_at IS NOT NULL) AS finalized,
              MAX(JSON_LENGTH(route_points_canonical)) AS canonical_points
         FROM sessions WHERE user_id=? AND client_activity_id=?`,
      [userId, clientActivityId],
    );
    assert.deepEqual([Number(rows.sessions), Number(rows.finalized), Number(rows.canonical_points)], [1, 1, 250]);
    const [[memoryRows]] = await db.execute(
      'SELECT COUNT(*) AS total, COUNT(DISTINCT client_id) AS distinct_ids FROM memory_points WHERE user_id=? AND source_activity_client_id=?',
      [userId, clientActivityId],
    );
    assert.equal(Number(memoryRows.total), Number(memoryRows.distinct_ids));
    assert.ok(Number(memoryRows.total) >= 250);
    pass('SAVE.RETRY.IDEMPOTENT', 'The same idempotency key replays one finalized Activity and no duplicate Memory identities.');

    // Prove the two-phase ACK boundary with a real post-commit projection
    // failure.  The core Activity/Memory evidence must be durable, but the
    // server must not return a false 200 until the derived coverage projection
    // can be rebuilt by the same idempotent retry.
    const recoveryActivityId = crypto.randomUUID();
    const recoverySegmentId = `${recoveryActivityId}:segment-0`;
    const recoveryPoints = points.slice(0, 4).map((point, index) => ({
      ...point,
      t: startAt + 110_000 + index * 1_000,
      raw_ordinal: index,
      segment_id: recoverySegmentId,
      ...(index === 0 ? { segment_start_reason: 'start' } : { segment_start_reason: undefined }),
    }));
    const recoveryStart = await request('/api/sessions/start', {
      method: 'POST', token,
      body: {
        client_op_id: crypto.randomUUID(), client_activity_id: recoveryActivityId,
        type: 'hiking', start_time: new Date(recoveryPoints[0].t).toISOString(),
      },
    });
    assert.equal(recoveryStart.status, 201, JSON.stringify(recoveryStart.json));
    const recoverySessionId = Number(recoveryStart.json.id);
    const recoveryKey = crypto.randomUUID();
    const recoveryPayload = {
      client_activity_id: recoveryActivityId,
      end_time: new Date(recoveryPoints.at(-1).t).toISOString(),
      distance_m: 18,
      duration_s: 3,
      name: 'Post-commit projection recovery proof',
      route_points: recoveryPoints,
      route_points_raw: recoveryPoints,
      route_points_canonical: recoveryPoints,
      memory_points: recoveryPoints.map(point => ({
        lat: point.lat, lng: point.lng, ts: point.t,
        cid: crypto.randomUUID(), evidence_source: 'activity_real',
        source_activity_client_id: recoveryActivityId,
        source_segment_id: recoverySegmentId,
        horizontal_accuracy_m: point.acc,
        continuity_state: 'accepted',
      })),
    };
    let renamed = false;
    let projectionFailure;
    try {
      await db.execute('RENAME TABLE memory_coverage_evidence TO memory_coverage_evidence_harness_hold');
      renamed = true;
      projectionFailure = await request(`/api/sessions/${recoverySessionId}/save`, {
        method: 'PATCH', token, body: recoveryPayload, idempotencyKey: recoveryKey,
      });
    } finally {
      if (renamed) {
        await db.execute('RENAME TABLE memory_coverage_evidence_harness_hold TO memory_coverage_evidence');
      }
    }
    assert.equal(projectionFailure.status, 503, JSON.stringify(projectionFailure.json));
    assert.equal(projectionFailure.json.code, 'ACTIVITY_POST_COMMIT_SYNC_PENDING');
    const [[durableBeforeRetry]] = await db.execute(
      `SELECT COUNT(*) AS sessions, SUM(finalized_at IS NOT NULL) AS finalized
         FROM sessions WHERE user_id=? AND client_activity_id=?`,
      [userId, recoveryActivityId],
    );
    assert.deepEqual(
      [Number(durableBeforeRetry.sessions), Number(durableBeforeRetry.finalized)],
      [1, 1],
    );
    const recovered = await request(`/api/sessions/${recoverySessionId}/save`, {
      method: 'PATCH', token, body: recoveryPayload, idempotencyKey: recoveryKey,
    });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.json));
    assert.equal(recovered.json.idempotent_replay, true);
    pass(
      'SAVE.POST_COMMIT.RECOVERY',
      'A real derived-coverage failure returns retryable 503 after durable core commit; same-key retry rebuilds coverage and then ACKs.',
    );

    receipt.final = {
      sessionRows: Number(rows.sessions),
      finalizedRows: Number(rows.finalized),
      canonicalPoints: Number(rows.canonical_points),
      memoryRows: Number(memoryRows.total),
      distinctMemoryIds: Number(memoryRows.distinct_ids),
    };
    receipt.passed = receipt.assertions.every(item => item.result === 'PASS');
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    await db.end();
  }
}

main().catch(error => {
  process.stderr.write(`activity save concurrency harness failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
