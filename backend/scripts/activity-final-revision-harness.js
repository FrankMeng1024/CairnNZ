#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { activityGeometryFingerprint } = require('../src/lib/activityGeometryFingerprint');

const apiBase = process.env.HARNESS_API_URL;
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(apiBase || '')) {
  throw new Error('HARNESS_API_URL must be loopback');
}

async function request(path, { method = 'GET', token, body, key } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'X-Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* surfaced by assertions */ }
  return { status: response.status, json };
}

async function account(label) {
  const email = `final-${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const registered = await request('/api/auth/register', {
    method: 'POST', body: { name: `Final ${label}`, email, password: 'Harness-only-2026!', dateOfBirth: '1990-01-01' },
  });
  assert.equal(registered.status, 200, JSON.stringify(registered.json));
  const verified = await request('/api/auth/verify', {
    method: 'POST', body: { email, code: registered.json.dev_code },
  });
  assert.equal(verified.status, 201, JSON.stringify(verified.json));
  return { token: verified.json.token, userId: Number(verified.json.user.id) };
}

async function start(token, clientActivityId, startedAt) {
  const response = await request('/api/sessions/start', {
    method: 'POST', token, key: crypto.randomUUID(),
    body: {
      client_op_id: crypto.randomUUID(), client_activity_id: clientActivityId,
      type: 'hiking', start_time: new Date(startedAt).toISOString(),
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return Number(response.json.id);
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, timezone: 'Z',
  });
  const owner = await account('owner');
  const other = await account('other');
  const startedAt = Date.now() - 60_000;
  const clientActivityId = crypto.randomUUID();
  const segmentId = `${clientActivityId}:segment-0`;
  const canonical = [
    { lat: -41.000000, lng: 174.000000, t: startedAt, segment_id: segmentId, segment_start_reason: 'start' },
    { lat: -41.000500, lng: 174.000500, t: startedAt + 10_000, segment_id: segmentId },
    { lat: -41.001000, lng: 174.001000, t: startedAt + 20_000, segment_id: segmentId },
  ];
  const base = canonical.map(point => ({ ...point }));
  const refined = canonical.map((point, index) => index === 1 ? { ...point, lng: point.lng + 0.00002 } : { ...point });
  const baseFingerprint = activityGeometryFingerprint(base);
  const canonicalFingerprint = activityGeometryFingerprint(canonical);
  const refinedFingerprint = activityGeometryFingerprint(refined);
  const sessionId = await start(owner.token, clientActivityId, startedAt);
  const memoryId = crypto.randomUUID();
  const save = await request(`/api/sessions/${sessionId}/save`, {
    method: 'PATCH', token: owner.token, key: crypto.randomUUID(),
    body: {
      client_activity_id: clientActivityId,
      end_time: new Date(startedAt + 20_000).toISOString(),
      distance_m: 123, duration_s: 20, name: 'Final revision proof',
      route_points: base, route_points_raw: canonical, route_points_canonical: canonical,
      memory_points: [{
        lat: canonical[0].lat, lng: canonical[0].lng, ts: canonical[0].t,
        cid: memoryId, evidence_source: 'activity_real',
        source_activity_client_id: clientActivityId, source_segment_id: segmentId,
        horizontal_accuracy_m: 5, continuity_state: 'accepted',
      }],
      final_geometry_revision: 1,
      final_geometry_fingerprint: baseFingerprint,
      final_geometry_canonical_fingerprint: canonicalFingerprint,
      final_geometry_algorithm: 'pedestrian-final-v2-base',
    },
  });
  assert.equal(save.status, 200, JSON.stringify(save.json));
  assert.equal(save.json.final_geometry_fingerprint, baseFingerprint);

  const tamperedInitialId = crypto.randomUUID();
  const tamperedInitialSession = await start(owner.token, tamperedInitialId, startedAt + 30_000);
  const tamperedInitial = await request(`/api/sessions/${tamperedInitialSession}/save`, {
    method: 'PATCH', token: owner.token, key: crypto.randomUUID(),
    body: {
      client_activity_id: tamperedInitialId,
      end_time: new Date(startedAt + 50_000).toISOString(), distance_m: 1, duration_s: 20, name: 'tamper',
      route_points: base, route_points_raw: base, route_points_canonical: canonical, memory_points: [],
      final_geometry_revision: 1, final_geometry_fingerprint: '00000000',
      final_geometry_canonical_fingerprint: canonicalFingerprint,
      final_geometry_algorithm: 'pedestrian-final-v2-base',
    },
  });
  assert.equal(tamperedInitial.status, 400, JSON.stringify(tamperedInitial.json));
  const removedTamperedShell = await request(`/api/sessions/${tamperedInitialSession}`, {
    method: 'DELETE', token: owner.token,
  });
  assert.equal(removedTamperedShell.status, 200, JSON.stringify(removedTamperedShell.json));

  const operationId = crypto.randomUUID();
  const revisionBody = {
    expected_revision: 1, expected_fingerprint: baseFingerprint,
    revision: 2, display_fingerprint: refinedFingerprint,
    canonical_fingerprint: canonicalFingerprint,
    algorithm_version: 'pedestrian-final-v4-road-fillet', route_points: refined,
  };
  const revised = await request(`/api/sessions/client/${clientActivityId}/final-geometry`, {
    method: 'PATCH', token: owner.token, key: operationId, body: revisionBody,
  });
  assert.equal(revised.status, 200, JSON.stringify(revised.json));
  assert.equal(revised.json.revision, 2);
  const lostAckReplay = await request(`/api/sessions/client/${clientActivityId}/final-geometry`, {
    method: 'PATCH', token: owner.token, key: operationId, body: revisionBody,
  });
  assert.equal(lostAckReplay.status, 200, JSON.stringify(lostAckReplay.json));
  assert.equal(lostAckReplay.json.idempotent_replay, true);

  const stale = await request(`/api/sessions/client/${clientActivityId}/final-geometry`, {
    method: 'PATCH', token: owner.token, key: crypto.randomUUID(), body: revisionBody,
  });
  assert.equal(stale.status, 200, JSON.stringify(stale.json));
  assert.equal(stale.json.idempotent_replay, true);
  const divergentStale = await request(`/api/sessions/client/${clientActivityId}/final-geometry`, {
    method: 'PATCH', token: owner.token, key: crypto.randomUUID(),
    body: { ...revisionBody, display_fingerprint: baseFingerprint, route_points: base },
  });
  assert.equal(divergentStale.status, 409, JSON.stringify(divergentStale.json));
  const tamperedRevision = await request(`/api/sessions/client/${clientActivityId}/final-geometry`, {
    method: 'PATCH', token: owner.token, key: crypto.randomUUID(),
    body: { ...revisionBody, display_fingerprint: '00000000' },
  });
  assert.equal(tamperedRevision.status, 400, JSON.stringify(tamperedRevision.json));

  const cold = await request(`/api/sessions/client/${clientActivityId}/final-geometry`, { token: owner.token });
  assert.equal(cold.status, 200, JSON.stringify(cold.json));
  assert.equal(cold.json.final_geometry.final_geometry_revision, 2);
  assert.equal(cold.json.final_geometry.final_geometry_fingerprint, refinedFingerprint);
  const foreign = await request(`/api/sessions/client/${clientActivityId}/final-geometry`, { token: other.token });
  assert.equal(foreign.status, 404);

  const [[invariants]] = await db.execute(
    `SELECT distance_m, JSON_LENGTH(route_points_raw) AS raw_count,
            JSON_LENGTH(route_points_canonical) AS canonical_count,
            final_geometry_revision, final_geometry_fingerprint
       FROM sessions WHERE id = ? AND user_id = ?`,
    [sessionId, owner.userId],
  );
  assert.equal(Number(invariants.distance_m), 123);
  assert.equal(Number(invariants.raw_count), canonical.length);
  assert.equal(Number(invariants.canonical_count), canonical.length);
  assert.equal(Number(invariants.final_geometry_revision), 2);
  assert.equal(invariants.final_geometry_fingerprint, refinedFingerprint);
  const [[memory]] = await db.execute(
    'SELECT COUNT(*) AS count FROM memory_points WHERE user_id = ? AND source_activity_client_id = ?',
    [owner.userId, clientActivityId],
  );
  assert.equal(Number(memory.count), 1);

  const legacyId = crypto.randomUUID();
  const legacySessionId = await start(owner.token, legacyId, startedAt + 60_000);
  const legacySave = await request(`/api/sessions/${legacySessionId}/save`, {
    method: 'PATCH', token: owner.token, key: crypto.randomUUID(),
    body: {
      client_activity_id: legacyId,
      end_time: new Date(startedAt + 80_000).toISOString(), distance_m: 2, duration_s: 20, name: 'legacy',
      route_points: base, route_points_raw: base, route_points_canonical: canonical, memory_points: [],
    },
  });
  assert.equal(legacySave.status, 200, JSON.stringify(legacySave.json));
  assert.equal(legacySave.json.final_geometry_revision, 1);
  assert.equal(legacySave.json.final_geometry_fingerprint, baseFingerprint);
  // Reproduce a row created before migration 059. The model must derive the
  // immutable revision-1 contract from its existing stored geometry, then
  // persist explicit metadata on the first safe display-only revision.
  await db.execute(
    `UPDATE sessions
        SET final_geometry_revision = NULL,
            final_geometry_fingerprint = NULL,
            final_geometry_canonical_fingerprint = NULL,
            final_geometry_algorithm = NULL,
            final_geometry_updated_at = NULL
      WHERE id = ? AND user_id = ?`,
    [legacySessionId, owner.userId],
  );
  const legacyCold = await request(`/api/sessions/client/${legacyId}/final-geometry`, { token: owner.token });
  assert.equal(legacyCold.status, 200, JSON.stringify(legacyCold.json));
  assert.equal(legacyCold.json.final_geometry.final_geometry_revision, 1);
  assert.equal(legacyCold.json.final_geometry.final_geometry_fingerprint, baseFingerprint);
  assert.equal(legacyCold.json.final_geometry.final_geometry_canonical_fingerprint, canonicalFingerprint);
  const legacyRevision = await request(`/api/sessions/client/${legacyId}/final-geometry`, {
    method: 'PATCH', token: owner.token, key: crypto.randomUUID(), body: revisionBody,
  });
  assert.equal(legacyRevision.status, 200, JSON.stringify(legacyRevision.json));
  assert.equal(legacyRevision.json.revision, 2);
  const [[legacyInvariants]] = await db.execute(
    `SELECT distance_m, JSON_LENGTH(route_points_raw) AS raw_count,
            JSON_LENGTH(route_points_canonical) AS canonical_count,
            final_geometry_revision
       FROM sessions WHERE id = ? AND user_id = ?`,
    [legacySessionId, owner.userId],
  );
  assert.equal(Number(legacyInvariants.distance_m), 2);
  assert.equal(Number(legacyInvariants.raw_count), base.length);
  assert.equal(Number(legacyInvariants.canonical_count), canonical.length);
  assert.equal(Number(legacyInvariants.final_geometry_revision), 2);

  const deleted = await request(`/api/sessions/${sessionId}`, { method: 'DELETE', token: owner.token });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  const deletedRead = await request(`/api/sessions/client/${clientActivityId}/final-geometry`, { token: owner.token });
  assert.equal(deletedRead.status, 404);
  const deletedRevise = await request(`/api/sessions/client/${clientActivityId}/final-geometry`, {
    method: 'PATCH', token: owner.token, key: crypto.randomUUID(), body: revisionBody,
  });
  assert.equal(deletedRevise.status, 404);

  await db.end();
  process.stdout.write(`${JSON.stringify({
    passed: true,
    evidence: 'REAL_EXPRESS_HTTP_REAL_MYSQL_8',
    assertions: [
      'owner-scope', 'base-save', 'cas-revision', 'lost-ack-replay', 'stale-conflict',
      'tampered-fingerprint', 'cold-readback', 'immutable-recorded-facts',
      'legacy-save', 'pre-migration-cold-readback-and-revision', 'deleted-404',
    ],
  })}\n`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
