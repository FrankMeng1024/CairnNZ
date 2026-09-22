'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

const baseUrl = process.env.HARNESS_API_URL;
const jwtSecret = process.env.JWT_SECRET;
const durationMs = Number(process.env.HARNESS_ENDURANCE_MS ?? 30 * 60_000);
const intervalMs = Number(process.env.HARNESS_ENDURANCE_INTERVAL_MS ?? 5_000);
if (!baseUrl || !jwtSecret || !Number.isFinite(durationMs) || durationMs < 60_000) {
  throw new Error('HARNESS_API_URL, JWT_SECRET, and HARNESS_ENDURANCE_MS >= 60000 are required');
}

const evidence = {
  schema: 'cairnnz.v1-closure.endurance.v1',
  started_at: new Date().toISOString(),
  configured_duration_ms: durationMs,
  interval_ms: intervalMs,
  environment: { api: baseUrl, database: process.env.DB_NAME, public_enabled: true },
  actors: {},
  objects: { marker_ids: [], activity_ids: [] },
  samples: [],
  counters: {
    cycles: 0, requests: 0, activities: 0, publications: 0, withdrawals: 0,
    grant_transitions: 0, disconnect_controls: 0, thanks_retries: 0,
    report_retries: 0, failures: 0,
  },
};

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

function tokenFor(id, label) {
  return jwt.sign({ userId: String(id), token_version: 0, jti: `endurance-${label}-${crypto.randomUUID()}` }, jwtSecret, { expiresIn: '2h' });
}

const latency = { max_ms: 0, total_ms: 0, samples: 0, over_1000_ms: 0 };
async function api(actor, pathname, { method = 'GET', body, expected } = {}) {
  const started = performance.now();
  let response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${actor.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } finally {
    const elapsed = performance.now() - started;
    latency.max_ms = Math.max(latency.max_ms, elapsed);
    latency.total_ms += elapsed;
    latency.samples += 1;
    if (elapsed > 1_000) latency.over_1000_ms += 1;
    evidence.counters.requests += 1;
  }
  const payload = await response.json().catch(() => null);
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${pathname}: ${JSON.stringify(payload)}`);
  return { status: response.status, body: payload };
}

async function completeActivity(actor, lat, lng) {
  const clientActivityId = crypto.randomUUID();
  const sourceSegmentId = `${clientActivityId}:segment-1`;
  const startedAt = Date.now() + 500;
  const points = [0, 15_000, 30_000].map((offset, index) => ({
    lat: lat + index * 0.00001,
    lng: lng + index * 0.00001,
    t: startedAt + offset,
    acc: 8,
    segment_id: sourceSegmentId,
  }));
  const started = await api(actor, '/api/sessions/start', {
    method: 'POST', expected: 201,
    body: { client_activity_id: clientActivityId, type: 'hiking', start_time: new Date(startedAt).toISOString() },
  });
  await api(actor, `/api/sessions/${started.body.id}/save`, {
    method: 'PATCH', expected: 200,
    body: {
      client_activity_id: clientActivityId,
      end_time: new Date(points.at(-1).t).toISOString(),
      distance_m: 35,
      duration_s: 30,
      name: `${actor.label} endurance movement`,
      route_points: points,
      route_points_raw: points,
      route_points_canonical: points,
      memory_points: points.map(point => ({
        lat: point.lat, lng: point.lng, ts: point.t, cid: crypto.randomUUID(),
        evidence_source: 'activity_real', source_activity_client_id: clientActivityId,
        source_segment_id: sourceSegmentId,
        horizontal_accuracy_m: 8, continuity_state: 'accepted',
      })),
    },
  });
  await api(actor, '/api/memory/points', {
    method: 'POST', expected: 200,
    body: { presence_witnesses: points.map(point => ({
      cid: crypto.randomUUID(), first_lat: point.lat, first_lng: point.lng,
      first_observed_at_ms: point.t, lat: point.lat, lng: point.lng,
      observed_at_ms: point.t, evidence_source: 'activity_real',
      source_activity_client_id: clientActivityId, source_segment_id: sourceSegmentId,
      horizontal_accuracy_m: 8,
      continuity_state: 'accepted',
    })) },
  });
  evidence.counters.activities += 1;
  evidence.objects.activity_ids.push(clientActivityId);
  return clientActivityId;
}

async function becomeFriends(requester, recipient) {
  await api(requester, '/api/friends/request', { method: 'POST', body: { email: recipient.email }, expected: 201 });
  const pending = await api(recipient, '/api/friends/requests', { expected: 200 });
  const request = pending.body.find(item => String(item.from_user_id) === requester.id);
  assert.ok(request);
  await api(recipient, '/api/friends/accept', { method: 'POST', body: { requestId: Number(request.id) }, expected: 200 });
}

async function publish(actor, operator, activityId, lat, lng, ordinal) {
  const created = await api(actor, '/api/markers', {
    method: 'POST', expected: 201,
    body: {
      client_cairn_id: crypto.randomUUID(), origin_activity_client_id: activityId,
      type: 'cairn', text: `Endurance Cairn ${ordinal}`, lat, lng, alt: 10,
      permission: 'public', approximate: false,
    },
  });
  assert.equal(created.body.public_submission.state, 'pending');
  const markerId = String(created.body.id);
  const queue = await api(operator, '/api/public-cairns/operator/submissions?state=pending&limit=50', { expected: 200 });
  const publication = queue.body.submissions.find(item => String(item.marker_id) === markerId);
  assert.ok(publication);
  await api(operator, `/api/public-cairns/operator/submissions/${publication.id}/decision`, {
    method: 'POST', expected: 200, body: { action: 'approve', reason: 'bounded endurance review' },
  });
  evidence.counters.publications += 1;
  evidence.objects.marker_ids.push(markerId);
  return markerId;
}

async function main() {
  const { calculateV1SourceFingerprint } = await import('../v1-source-fingerprint.mjs');
  evidence.candidate_fingerprint = calculateV1SourceFingerprint();
  const db = await mysql.createConnection(dbConfig);
  let eventLoopExpected = performance.now() + 100;
  let maxEventLoopDelayMs = 0;
  const eventLoopTimer = setInterval(() => {
    const now = performance.now();
    maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, now - eventLoopExpected);
    eventLoopExpected = now + 100;
  }, 100);
  let maxRssBytes = process.memoryUsage().rss;
  try {
    const actors = {};
    for (const label of ['A', 'B', 'M']) {
      const email = `endurance-${label.toLowerCase()}-${process.env.HARNESS_RUN_ID}@example.org`;
      const [inserted] = await db.execute(
        `INSERT INTO users
          (name,email,password_hash,date_of_birth,public_cairn_operator,activity_source_realm)
         VALUES (?,?,?,?,?,'isolated_qa')`,
        [`Endurance ${label}`, email, 'synthetic-no-login', '1990-01-01', label === 'M' ? 1 : 0],
      );
      actors[label] = { label, id: String(inserted.insertId), email, token: tokenFor(inserted.insertId, label) };
      evidence.actors[label] = { id: actors[label].id, role: label === 'M' ? 'operator' : 'pilot_user' };
    }
    await api(actors.A, '/api/friend-sharing/policy', { method: 'PUT', body: { enabled: true }, expected: 200 });
    await becomeFriends(actors.B, actors.A);
    await api(actors.B, '/api/memory-subscriptions', { method: 'POST', body: { friend_id: Number(actors.A.id) }, expected: 201 });

    const place = { lat: -41.2867, lng: 174.7763 };
    let ownerActivityId = await completeActivity(actors.A, place.lat, place.lng);
    let currentMarkerId = await publish(actors.A, actors.M, ownerActivityId, place.lat, place.lng, 1);
    let lastEncounteredMarkerId = null;
    const started = performance.now();
    let nextTick = started;
    while (performance.now() - started < durationMs) {
      const cycle = evidence.counters.cycles;
      maxRssBytes = Math.max(maxRssBytes, process.memoryUsage().rss);
      await api(actors.B, '/api/public-cairns/capabilities', { expected: 200 });
      await api(actors.B, '/api/friends', { expected: 200 });
      await api(actors.B, '/api/friend-sharing/sources', { expected: 200 });

      if (cycle % 6 === 0) {
        const viewerActivityId = await completeActivity(actors.B, place.lat, place.lng);
        const verified = await api(actors.B, '/api/public-cairns/encounters/verify', {
          method: 'POST', expected: 200, body: { source_activity_client_id: viewerActivityId },
        });
        if (verified.body.encountered_marker_ids.includes(currentMarkerId)) lastEncounteredMarkerId = currentMarkerId;
      }
      const scene = await api(actors.B, '/api/public-cairns/scene', { expected: 200 });
      assert.ok(scene.body.entries.length <= 3);
      if (lastEncounteredMarkerId) {
        const detail = await api(actors.B, `/api/public-cairns/cairns/${lastEncounteredMarkerId}`, { expected: 200 });
        assert.equal(String(detail.body.cairn.id), lastEncounteredMarkerId);
      }

      if (cycle > 0 && cycle % 36 === 0) {
        const previousMarkerId = currentMarkerId;
        ownerActivityId = await completeActivity(actors.A, place.lat + cycle * 0.0000001, place.lng);
        currentMarkerId = await publish(actors.A, actors.M, ownerActivityId, place.lat, place.lng, evidence.counters.publications + 1);
        await api(actors.A, `/api/markers/${previousMarkerId}`, {
          method: 'PUT', expected: 200, body: { permission: 'personal' },
        });
        await api(actors.B, `/api/public-cairns/cairns/${previousMarkerId}`, { expected: 404 });
        evidence.counters.withdrawals += 1;
        lastEncounteredMarkerId = null;
      }

      if (cycle > 0 && cycle % 24 === 0) {
        await api(actors.A, '/api/friend-sharing/policy', { method: 'PUT', body: { enabled: false }, expected: 200 });
        const revoked = await api(actors.B, '/api/friend-sharing/sources', { expected: 200 });
        assert.equal(revoked.body.sources.length, 0);
        await api(actors.A, '/api/friend-sharing/policy', { method: 'PUT', body: { enabled: true }, expected: 200 });
        evidence.counters.grant_transitions += 2;
      }

      if (lastEncounteredMarkerId && cycle % 12 === 0) {
        await api(actors.B, `/api/public-cairns/cairns/${lastEncounteredMarkerId}/thanks`, { method: 'POST', body: {}, expected: 200 });
        await api(actors.B, `/api/public-cairns/cairns/${lastEncounteredMarkerId}/thanks`, { method: 'POST', body: {}, expected: 200 });
        evidence.counters.thanks_retries += 1;
      }
      if (lastEncounteredMarkerId && cycle % 18 === 0) {
        const reportBody = {
          client_submission_id: crypto.randomUUID(),
          category: 'other',
          detail: 'Bounded synthetic endurance report',
        };
        await api(actors.B, `/api/public-cairns/cairns/${lastEncounteredMarkerId}/report`, { method: 'POST', body: reportBody, expected: 200 });
        await api(actors.B, `/api/public-cairns/cairns/${lastEncounteredMarkerId}/report`, { method: 'POST', body: reportBody, expected: 200 });
        evidence.counters.report_retries += 1;
      }
      if (cycle % 15 === 0) {
        await assert.rejects(fetch('http://127.0.0.1:1/api/public-cairns/scene'));
        const reconnected = await api(actors.B, '/api/public-cairns/capabilities', { expected: 200 });
        assert.equal(reconnected.body.enabled, true);
        evidence.counters.disconnect_controls += 1;
      }

      if (cycle % 6 === 0) {
        const [[dbState]] = await db.query(
          `SELECT
             (SELECT COUNT(*) FROM sessions) AS sessions,
             (SELECT COUNT(*) FROM public_cairn_encounters) AS encounters,
             (SELECT COUNT(*) FROM public_cairn_publications) AS publications,
             (SELECT COUNT(*) FROM memory_presence_witnesses) AS witnesses`,
        );
        evidence.samples.push({
          at_ms: Math.round(performance.now() - started),
          rss_bytes: process.memoryUsage().rss,
          heap_used_bytes: process.memoryUsage().heapUsed,
          db: Object.fromEntries(Object.entries(dbState).map(([key, value]) => [key, Number(value)])),
          request_max_ms: Number(latency.max_ms.toFixed(3)),
        });
      }
      evidence.counters.cycles += 1;
      nextTick += intervalMs;
      const remaining = nextTick - performance.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    }

    await api(actors.A, `/api/markers/${currentMarkerId}`, {
      method: 'PUT', expected: 200, body: { permission: 'personal' },
    });
    await api(actors.B, `/api/public-cairns/cairns/${currentMarkerId}`, { expected: 404 });
    evidence.counters.withdrawals += 1;
    const [[finalCounts]] = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM sessions) AS sessions,
         (SELECT COUNT(*) FROM public_cairn_encounters) AS encounters,
         (SELECT COUNT(*) FROM public_cairn_thanks) AS thanks,
         (SELECT COUNT(*) FROM public_cairn_reports) AS reports,
         (SELECT COUNT(*) FROM shared_route_leases
           WHERE start_acknowledged_at IS NOT NULL AND end_acknowledged_at IS NULL) AS pending_route_acks`,
    );
    evidence.finished_at = new Date().toISOString();
    evidence.observed_duration_ms = Math.round(performance.now() - started);
    evidence.metrics = {
      request_latency: {
        ...latency,
        average_ms: Number((latency.total_ms / Math.max(1, latency.samples)).toFixed(3)),
        max_ms: Number(latency.max_ms.toFixed(3)),
      },
      max_event_loop_delay_ms: Number(maxEventLoopDelayMs.toFixed(3)),
      max_rss_bytes: maxRssBytes,
      final_memory: process.memoryUsage(),
      final_database_counts: Object.fromEntries(Object.entries(finalCounts).map(([key, value]) => [key, Number(value)])),
    };
    evidence.result = 'PASS';
  } catch (error) {
    evidence.counters.failures += 1;
    evidence.finished_at = new Date().toISOString();
    evidence.result = 'FAIL';
    evidence.failure = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    clearInterval(eventLoopTimer);
    await db.end().catch(() => {});
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  }
}

main();
