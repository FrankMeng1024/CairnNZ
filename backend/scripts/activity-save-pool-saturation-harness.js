#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { performance } = require('node:perf_hooks');

const apiBase = process.env.HARNESS_API_URL;
const runId = process.env.HARNESS_RUN_ID || crypto.randomUUID();
const concurrency = Number(process.env.HARNESS_CONCURRENCY || 10);
const requestDeadlineMs = Number(process.env.HARNESS_REQUEST_DEADLINE_MS || 5_000);

async function request(path, { method = 'GET', token, body, idempotencyKey, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('harness_request_deadline')), timeoutMs ?? 15_000);
  const started = performance.now();
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* retained as null */ }
    return { status: response.status, json, durationMs: performance.now() - started };
  } catch (error) {
    return {
      status: null,
      error: error?.name || 'Error',
      message: error?.message || String(error),
      durationMs: performance.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function savePayload(clientActivityId, startedAt, ordinal) {
  const segmentId = `${clientActivityId}:segment-0`;
  const points = Array.from({ length: 4 }, (_, index) => ({
    lat: -41.2865 + ordinal * 0.00001 + index * 0.000001,
    lng: 174.7762 + ordinal * 0.00001 + index * 0.000001,
    t: startedAt + index * 1_000,
    acc: 6,
    speed_mps: 1.2,
    raw_ordinal: index,
    segment_id: segmentId,
    ...(index === 0 ? { segment_start_reason: 'start' } : {}),
  }));
  return {
    client_activity_id: clientActivityId,
    end_time: new Date(points.at(-1).t).toISOString(),
    distance_m: 18,
    duration_s: 3,
    name: `Pool saturation ${ordinal}`,
    route_points: points,
    route_points_raw: points,
    route_points_canonical: points,
    memory_points: points.map(point => ({
      lat: point.lat,
      lng: point.lng,
      ts: point.t,
      cid: crypto.randomUUID(),
      evidence_source: 'activity_real',
      source_activity_client_id: clientActivityId,
      source_segment_id: segmentId,
      horizontal_accuracy_m: point.acc,
      continuity_state: 'accepted',
    })),
  };
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
  const receipt = {
    schema: 'cairn.activity-save-pool-saturation.v1',
    evidence: 'REAL_EXPRESS_HTTP_REAL_MYSQL_8',
    runId,
    concurrency,
    requestDeadlineMs,
  };
  try {
    const activities = [];
    const baseTime = Date.now() - 120_000;
    for (let index = 0; index < concurrency; index += 1) {
      // The production contract allows one unfinished Activity per owner. Use
      // independent synthetic owners so the real API can reach full pool
      // concurrency without weakening that invariant.
      const email = `pool-saturation-${runId}-${index}@example.com`;
      const registered = await request('/api/auth/register', {
        method: 'POST',
        body: { name: `Pool Harness ${index}`, email, password: 'Harness-only-2026!', dateOfBirth: '1990-01-01' },
      });
      assert.equal(registered.status, 200, JSON.stringify(registered));
      const verified = await request('/api/auth/verify', {
        method: 'POST', body: { email, code: registered.json.dev_code },
      });
      assert.equal(verified.status, 201, JSON.stringify(verified));
      const token = verified.json.token;
      const userId = Number(verified.json.user.id);
      const clientActivityId = crypto.randomUUID();
      const startedAt = baseTime + index * 10_000;
      const started = await request('/api/sessions/start', {
        method: 'POST', token,
        body: {
          client_op_id: crypto.randomUUID(), client_activity_id: clientActivityId,
          type: 'hiking', start_time: new Date(startedAt).toISOString(),
        },
      });
      assert.equal(started.status, 201, JSON.stringify(started));
      activities.push({
        token,
        userId,
        sessionId: Number(started.json.id),
        clientActivityId,
        payload: savePayload(clientActivityId, startedAt, index),
      });
    }

    const wallStarted = performance.now();
    const responses = await Promise.all(activities.map(activity => request(
      `/api/sessions/${activity.sessionId}/save`,
      {
        method: 'PATCH', token: activity.token, body: activity.payload,
        idempotencyKey: crypto.randomUUID(), timeoutMs: requestDeadlineMs,
      },
    )));
    receipt.wallMs = performance.now() - wallStarted;
    receipt.responses = responses.map((response, index) => ({
      sessionId: activities[index].sessionId,
      status: response.status,
      code: response.json?.code ?? null,
      error: response.error ?? null,
      durationMs: Number(response.durationMs.toFixed(3)),
      serverTiming: response.json?.server_timing ?? null,
    }));
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS total, SUM(finalized_at IS NOT NULL) AS finalized
       FROM sessions WHERE client_activity_id IN (${activities.map(() => '?').join(',')})`,
      activities.map(activity => activity.clientActivityId),
    );
    receipt.database = { total: Number(row.total), finalized: Number(row.finalized) };
    receipt.passed = responses.every(response => response.status === 200)
      && receipt.database.total === concurrency
      && receipt.database.finalized === concurrency;
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.passed) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main().catch(error => {
  process.stderr.write(`pool saturation harness failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
