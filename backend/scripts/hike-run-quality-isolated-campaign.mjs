#!/usr/bin/env node

/**
 * Disposable Hike/Run API campaign for the quality-upgrade review.
 *
 * This runner deliberately targets only a caller-supplied isolated backend.
 * It exercises the deployed HTTP contract and writes no credentials to its
 * result. Client WAL/outbox ownership is verified separately by the app's
 * production-orchestration integration suite.
 */

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    result[key] = value && !value.startsWith('--') ? argv[++index] : true;
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const apiUrl = String(args.api ?? process.env.CAIRN_ISOLATED_API_URL ?? '').replace(/\/$/, '');
if (!apiUrl || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(apiUrl)) {
  throw new Error('Refusing non-loopback backend; pass --api http://127.0.0.1:<port>');
}

function uuid(sequence) {
  return `71000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function points(seed, startedAt) {
  return Array.from({ length: 6 }, (_, index) => ({
    lat: -41.2865 + seed * 0.00001 + index * 0.00008,
    lng: 174.7762 + seed * 0.00001 + index * 0.00011,
    t: startedAt + index * 5_000,
    acc: 5 + (index % 2),
    speed_mps: 1.35,
    segment_id: `segment-${seed}`,
    segment_start_reason: index === 0 ? 'start' : null,
  }));
}

function savePayload(clientActivityId, activityPoints, name) {
  return {
    client_activity_id: clientActivityId,
    end_time: new Date(activityPoints.at(-1).t).toISOString(),
    distance_m: 83.4,
    duration_s: Math.round((activityPoints.at(-1).t - activityPoints[0].t) / 1_000),
    name,
    route_points: activityPoints,
    route_points_raw: activityPoints,
    route_points_canonical: activityPoints,
    memory_points: activityPoints.map(point => ({
      lat: point.lat,
      lng: point.lng,
      ts: point.t,
      evidence_source: 'activity_real',
      source_activity_client_id: clientActivityId,
      source_segment_id: point.segment_id,
      horizontal_accuracy_m: point.acc,
      continuity_state: 'accepted',
    })),
  };
}

function sameMovementEvidence(expected, actual) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((point, index) => {
      const candidate = actual[index];
      return candidate
        && Math.abs(candidate.lat - point.lat) < 1e-10
        && Math.abs(candidate.lng - point.lng) < 1e-10
        && candidate.t === point.t
        && candidate.segment_id === point.segment_id;
    });
}

async function request(pathname, { token, expectedStatus, ...options } = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (expectedStatus != null && response.status !== expectedStatus) {
    throw new Error(`${options.method ?? 'GET'} ${pathname}: expected ${expectedStatus}, got ${response.status} ${JSON.stringify(body)}`);
  }
  return { status: response.status, body };
}

async function startActivity(token, clientActivityId, type, startedAt) {
  const response = await request('/api/sessions/start', {
    token,
    method: 'POST',
    expectedStatus: 201,
    headers: { 'X-Idempotency-Key': clientActivityId },
    body: JSON.stringify({
      client_op_id: clientActivityId,
      client_activity_id: clientActivityId,
      type,
      start_time: new Date(startedAt).toISOString(),
    }),
  });
  if (response.body?.client_activity_id !== clientActivityId) throw new Error('start identity mismatch');
  return Number(response.body.id);
}

async function saveActivity(token, remoteId, clientActivityId, payload, operationId) {
  return request(`/api/sessions/${remoteId}/save`, {
    token,
    method: 'PATCH',
    expectedStatus: 200,
    headers: { 'X-Idempotency-Key': operationId },
    body: JSON.stringify(payload),
  });
}

async function deleteActivity(token, clientActivityId) {
  return request(`/api/sessions/client/${clientActivityId}`, {
    token,
    method: 'DELETE',
    expectedStatus: 200,
  });
}

async function listActivities(token) {
  const response = await request('/api/sessions', { token, expectedStatus: 200 });
  return Array.isArray(response.body?.sessions) ? response.body.sessions : [];
}

async function replayPending() {
  const pendingPath = path.resolve(String(args.pending));
  const pending = JSON.parse(await readFile(pendingPath, 'utf8'));
  const token = process.env.CAIRN_ISOLATED_REPLAY_TOKEN;
  if (!token) throw new Error('Missing replay token');
  const remoteId = await startActivity(
    token,
    pending.clientActivityId,
    pending.type,
    pending.startedAt,
  );
  const saved = await saveActivity(
    token,
    remoteId,
    pending.clientActivityId,
    pending.payload,
    pending.operationId,
  );
  process.stdout.write(JSON.stringify({
    freshProcess: true,
    clientActivityId: pending.clientActivityId,
    remoteId,
    saveStatus: saved.status,
    echoedClientActivityId: saved.body?.client_activity_id ?? null,
  }));
}

async function run() {
  const outputPath = path.resolve(String(args.output ?? 'hike-run-isolated-backend-result.json'));
  const pendingPath = path.resolve(String(args['pending-file'] ?? `${outputPath}.pending.json`));
  const nonce = `${Date.now()}-${process.pid}`;
  // Joi's strict email validator rejects the reserved .invalid suffix. This
  // address stays synthetic and no mail transport is configured in the
  // isolated test process.
  const email = `hike-run-quality-${nonce}@example.com`;
  const password = 'Local-review-only-2026!';
  const evidence = {
    schemaVersion: 1,
    backend: apiUrl,
    startedAt: new Date().toISOString(),
    isolation: {
      loopbackOnly: true,
      syntheticIdentity: true,
      credentialsRetained: false,
    },
    cases: [],
  };

  const health = await request('/health', { expectedStatus: 200 });
  evidence.health = health.body;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    expectedStatus: 200,
    body: JSON.stringify({
      name: 'Hike Run Quality QA',
      email,
      password,
      dateOfBirth: '1990-01-01',
    }),
  });
  const verification = await request('/api/auth/verify', {
    method: 'POST',
    expectedStatus: 201,
    body: JSON.stringify({ email, code: registration.body.dev_code }),
  });
  const token = verification.body?.token;
  if (typeof token !== 'string') throw new Error('verification did not return a token');

  // Case 1: ordinary online Start -> append -> atomic Save.
  {
    const clientActivityId = uuid(1);
    const startedAt = Date.now() - 180_000;
    const activityPoints = points(1, startedAt);
    const remoteId = await startActivity(token, clientActivityId, 'hiking', startedAt);
    const append = await request(`/api/sessions/${remoteId}/append-points`, {
      token,
      method: 'PATCH',
      expectedStatus: 200,
      headers: { 'X-Idempotency-Key': uuid(101) },
      body: JSON.stringify({ client_op_id: uuid(101), points: activityPoints }),
    });
    const saved = await saveActivity(token, remoteId, clientActivityId,
      savePayload(clientActivityId, activityPoints, 'Online ordinary'), uuid(201));
    evidence.cases.push({
      id: 'online-start-append-save',
      passed: append.body?.appended === activityPoints.length
        && saved.body?.client_activity_id === clientActivityId,
      remoteId,
      appendCount: append.body?.appended,
      saveStatus: saved.status,
    });
    await deleteActivity(token, clientActivityId);
  }

  // Case 2: no transport while walking; reconnect starts and saves the exact
  // locally retained evidence without depending on a Mapbox enhancement.
  {
    const clientActivityId = uuid(2);
    const startedAt = Date.now() - 150_000;
    const activityPoints = points(2, startedAt);
    const remoteId = await startActivity(token, clientActivityId, 'running', startedAt);
    const saved = await saveActivity(token, remoteId, clientActivityId,
      savePayload(clientActivityId, activityPoints, 'Offline walk online Save'), uuid(202));
    const detail = await request(`/api/sessions/${remoteId}`, { token, expectedStatus: 200 });
    const movementEvidenceEqual = sameMovementEvidence(activityPoints, detail.body?.session?.route_points);
    evidence.cases.push({
      id: 'offline-recording-online-save',
      passed: saved.body?.client_activity_id === clientActivityId
        && movementEvidenceEqual,
      remoteId,
      retainedPointCount: activityPoints.length,
      displayPointCount: detail.body?.session?.route_points?.length ?? null,
      movementEvidenceEqual,
      echoedClientActivityId: saved.body?.client_activity_id ?? null,
      expectedFirst: activityPoints[0],
      actualFirst: detail.body?.session?.route_points?.[0] ?? null,
    });
    await deleteActivity(token, clientActivityId);
  }

  // Case 3: persist an offline outbox, then replay it in a fresh Node process.
  {
    const clientActivityId = uuid(3);
    const startedAt = Date.now() - 120_000;
    const activityPoints = points(3, startedAt);
    await writeFile(pendingPath, `${JSON.stringify({
      clientActivityId,
      type: 'hiking',
      startedAt,
      operationId: uuid(203),
      payload: savePayload(clientActivityId, activityPoints, 'Cold reopen reconnect'),
    })}\n`, { mode: 0o600 });
    const child = spawnSync(process.execPath, [scriptPath,
      '--api', apiUrl,
      '--replay',
      '--pending', pendingPath,
    ], {
      encoding: 'utf8',
      env: { ...process.env, CAIRN_ISOLATED_REPLAY_TOKEN: token },
    });
    if (child.status !== 0) throw new Error(`fresh-process replay failed: ${child.stderr}`);
    const replay = JSON.parse(child.stdout);
    evidence.cases.push({
      id: 'offline-save-cold-reopen-reconnect',
      passed: replay.freshProcess === true
        && replay.echoedClientActivityId === clientActivityId,
      ...replay,
    });
    await deleteActivity(token, clientActivityId);
  }

  // Case 4: treat the first successful response as lost, then retry with the
  // same operation identity. Server state must remain exactly one Activity.
  {
    const clientActivityId = uuid(4);
    const startedAt = Date.now() - 90_000;
    const activityPoints = points(4, startedAt);
    const remoteId = await startActivity(token, clientActivityId, 'running', startedAt);
    const operationId = uuid(204);
    await saveActivity(token, remoteId, clientActivityId,
      savePayload(clientActivityId, activityPoints, 'Lost ACK retry'), operationId);
    const retry = await saveActivity(token, remoteId, clientActivityId,
      savePayload(clientActivityId, activityPoints, 'Lost ACK retry'), operationId);
    const sessions = await listActivities(token);
    const matches = sessions.filter(session => session.client_activity_id === clientActivityId);
    evidence.cases.push({
      id: 'server-commit-lost-ack-retry',
      passed: retry.status === 200 && matches.length === 1,
      remoteId,
      retryStatus: retry.status,
      matchingServerRows: matches.length,
    });
    await deleteActivity(token, clientActivityId);
  }

  const remaining = await listActivities(token);
  evidence.cleanup = {
    passed: remaining.length === 0,
    remainingActivities: remaining.length,
  };
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = evidence.cases.every(item => item.passed) && evidence.cleanup.passed;
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ outputPath, passed: evidence.passed, cases: evidence.cases.length })}\n`);
}

if (args.replay) await replayPending();
else await run();
