'use strict';

const crypto = require('crypto');
const { sanitizeQaEvent } = require('../utils/qaTelemetryPrivacy');

const DIAGNOSTIC_SCHEMA = 'cairn-auto-diagnostics-batch';
const DIAGNOSTIC_VERSION = 1;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_BATCH_BYTES = 64 * 1024;
const MAX_OWNER_BYTES_24H = 5 * 1024 * 1024;
const TIER_A_RETENTION_DAYS = 30;
const TIER_B_RETENTION_DAYS = 14;
// Retention is anchored to server receipt, not client eventAt. eventAt is
// useful forensic context but is client-controlled and may arrive after an
// offline delay; every accepted batch receives its full stated server TTL.
const SAFE_ID = /^[A-Za-z0-9:._-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIER_A_FREE_TEXT_FIELD = /(?:message|msg|stack|body|text|title|name|note|description|content|diagnostic|url|uri)$/i;

function diagnosticError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function boundedId(value, name, max) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !SAFE_ID.test(value)) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', `Invalid ${name}.`);
  }
  return value;
}

function optionalUuid(value, name) {
  if (value == null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', `Invalid ${name}.`);
  }
  return value.toLowerCase();
}

function finiteClock(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 4_102_444_800_000) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', `Invalid ${name}.`);
  }
  return Math.floor(number);
}

function tierASafeDetails(value, depth = 0) {
  if (depth > 6 || value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return /^[A-Za-z0-9_.:+-]{1,160}$/.test(value) ? value : '[redacted-free-text]';
  }
  if (Array.isArray(value)) return value.slice(0, 64).map(item => tierASafeDetails(item, depth + 1));
  if (typeof value !== 'object') return null;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (TIER_A_FREE_TEXT_FIELD.test(key)) continue;
    output[key] = tierASafeDetails(nested, depth + 1);
  }
  return output;
}

function sanitizeAutomaticDetails(value) {
  const safe = sanitizeQaEvent({ coordinateSource: 'real', fields: tierASafeDetails(value ?? {}) }).fields;
  if (!safe || typeof safe !== 'object' || Array.isArray(safe)) return {};
  const encoded = JSON.stringify(safe);
  if (Buffer.byteLength(encoded, 'utf8') > 8 * 1024) {
    throw diagnosticError(413, 'DIAGNOSTIC_EVENT_TOO_LARGE', 'Diagnostic event details exceed 8 KiB.');
  }
  return safe;
}

function normalizeAutomaticDiagnosticBatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Diagnostic batch must be an object.');
  }
  const suppliedBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  if (suppliedBytes > MAX_BATCH_BYTES) {
    throw diagnosticError(413, 'DIAGNOSTIC_BATCH_TOO_LARGE', 'Diagnostic batch exceeds 64 KiB.');
  }
  if (body.schema !== DIAGNOSTIC_SCHEMA || body.version !== DIAGNOSTIC_VERSION) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_UNSUPPORTED', 'Unsupported diagnostic schema.');
  }
  const stream = body.stream;
  if (!stream || typeof stream !== 'object' || Array.isArray(stream)) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Diagnostic stream is required.');
  }
  const sourceType = String(stream.sourceType || '');
  if (!['activity', 'memory', 'route', 'app'].includes(sourceType)) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Invalid sourceType.');
  }
  const streamId = boundedId(stream.streamId, 'streamId', 96);
  const ownerEpoch = boundedId(stream.ownerEpoch, 'ownerEpoch', 64);
  const clientActivityId = optionalUuid(stream.clientActivityId, 'clientActivityId');
  const clientRouteId = optionalUuid(stream.clientRouteId, 'clientRouteId');
  const routeEditSessionId = stream.routeEditSessionId == null
    ? null : boundedId(stream.routeEditSessionId, 'routeEditSessionId', 96);
  const memoryScopeId = stream.memoryScopeId == null
    ? null : boundedId(stream.memoryScopeId, 'memoryScopeId', 96);
  if (sourceType === 'activity' && !clientActivityId) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Activity stream requires clientActivityId.');
  }
  if (sourceType === 'route' && !routeEditSessionId) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Route stream requires routeEditSessionId.');
  }
  if (sourceType === 'memory' && !memoryScopeId) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Memory stream requires memoryScopeId.');
  }
  const activityMode = stream.activityMode == null ? null : String(stream.activityMode);
  if (activityMode && !['hiking', 'running'].includes(activityMode)) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Invalid activityMode.');
  }
  const batchId = boundedId(body.batchId, 'batchId', 64);
  const batchSequence = Number(body.batchSequence);
  if (!Number.isSafeInteger(batchSequence) || batchSequence < 0) {
    throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Invalid batchSequence.');
  }
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > MAX_EVENTS_PER_BATCH) {
    throw diagnosticError(400, 'DIAGNOSTIC_EVENT_LIMIT', `events must contain 1-${MAX_EVENTS_PER_BATCH} items.`);
  }
  const eventIds = new Set();
  const events = body.events.map((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Each diagnostic event must be an object.');
    }
    const eventId = boundedId(event.eventId, 'eventId', 96);
    if (eventIds.has(eventId)) throw diagnosticError(400, 'DIAGNOSTIC_EVENT_DUPLICATE', 'Duplicate eventId in batch.');
    eventIds.add(eventId);
    const eventCode = boundedId(event.eventCode, 'eventCode', 64);
    const eventSequence = Number(event.eventSequence);
    if (!Number.isSafeInteger(eventSequence) || eventSequence < 1) {
      throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Invalid eventSequence.');
    }
    const sourceModule = boundedId(event.sourceModule, 'sourceModule', 64);
    const severity = String(event.severity || 'info');
    if (!['info', 'warn', 'error'].includes(severity)) {
      throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Invalid severity.');
    }
    const eventAt = finiteClock(event.eventAt, 'eventAt');
    const monotonicMs = event.monotonicMs == null ? null : Number(event.monotonicMs);
    if (monotonicMs !== null && (!Number.isFinite(monotonicMs) || monotonicMs < 0)) {
      throw diagnosticError(400, 'DIAGNOSTIC_SCHEMA_INVALID', 'Invalid monotonicMs.');
    }
    return {
      eventId,
      eventSequence,
      eventCode,
      sourceModule,
      severity,
      eventAt,
      monotonicMs,
      details: sanitizeAutomaticDetails(event.details),
    };
  }).sort((left, right) => left.eventAt - right.eventAt || left.eventId.localeCompare(right.eventId));
  const eventSequences = events.map(event => event.eventSequence).sort((left, right) => left - right);
  if (new Set(eventSequences).size !== eventSequences.length
    || eventSequences[0] !== batchSequence
    || eventSequences.some((sequence, index) => index > 0 && sequence !== eventSequences[index - 1] + 1)) {
    throw diagnosticError(400, 'DIAGNOSTIC_SEQUENCE_INVALID', 'Event sequences must be contiguous from batchSequence.');
  }
  const normalized = {
    schema: DIAGNOSTIC_SCHEMA,
    version: DIAGNOSTIC_VERSION,
    batchId,
    batchSequence,
    stream: {
      streamId,
      ownerEpoch,
      sourceType,
      clientActivityId,
      clientRouteId,
      routeEditSessionId,
      memoryScopeId,
      activityMode,
      runtimeVersion: stream.runtimeVersion == null
        ? null : boundedId(String(stream.runtimeVersion), 'runtimeVersion', 64),
      updateId: stream.updateId == null
        ? null : boundedId(String(stream.updateId), 'updateId', 64),
    },
    droppedCount: Math.max(0, Math.floor(Number(body.droppedCount) || 0)),
    events,
  };
  const payloadJson = JSON.stringify(normalized);
  const payloadBytes = Buffer.byteLength(payloadJson, 'utf8');
  if (payloadBytes > MAX_BATCH_BYTES) {
    throw diagnosticError(413, 'DIAGNOSTIC_BATCH_TOO_LARGE', 'Sanitized diagnostic batch exceeds 64 KiB.');
  }
  return {
    ...normalized,
    firstEventAt: events[0].eventAt,
    lastEventAt: events[events.length - 1].eventAt,
    lastSequence: eventSequences[eventSequences.length - 1],
    payloadJson,
    payloadBytes,
    payloadSha256: crypto.createHash('sha256').update(payloadJson).digest('hex'),
  };
}

function sameStreamIdentity(row, stream) {
  return row.owner_epoch === stream.ownerEpoch
    && row.source_type === stream.sourceType
    && (row.client_activity_id || null) === stream.clientActivityId
    && (row.client_route_id || null) === stream.clientRouteId
    && (row.route_edit_session_id || null) === stream.routeEditSessionId
    && (row.memory_scope_id || null) === stream.memoryScopeId;
}

async function ingestAutomaticDiagnosticBatch(pool, ownerUserId, body) {
  const batch = normalizeAutomaticDiagnosticBatch(body);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [policies] = await conn.execute(
      `SELECT policy_tier, consent_version, enabled, expires_at
         FROM diagnostic_qa_enrollments WHERE owner_user_id = ? FOR UPDATE`,
      [ownerUserId],
    );
    const policy = policies[0];
    if (!policy || Number(policy.enabled) !== 1
      || (policy.expires_at && new Date(policy.expires_at).getTime() <= Date.now())) {
      throw diagnosticError(403, 'DIAGNOSTIC_POLICY_DISABLED', 'Automatic diagnostics policy is disabled.');
    }

    if (batch.stream.clientActivityId) {
      const [tombstones] = await conn.execute(
        `SELECT 1 FROM activity_client_tombstones
          WHERE user_id = ? AND client_activity_id = ? LIMIT 1`,
        [ownerUserId, batch.stream.clientActivityId],
      );
      if (tombstones[0]) throw diagnosticError(410, 'DIAGNOSTIC_ACTIVITY_DELETED', 'Activity was deleted.');
    }
    if (batch.stream.clientRouteId) {
      const [tombstones] = await conn.execute(
        `SELECT 1 FROM route_client_tombstones
          WHERE user_id = ? AND client_route_id = ? LIMIT 1`,
        [ownerUserId, batch.stream.clientRouteId],
      );
      if (tombstones[0]) throw diagnosticError(410, 'DIAGNOSTIC_ROUTE_DELETED', 'Route was deleted.');
    }

    const [existingBatches] = await conn.execute(
      `SELECT b.payload_sha256, b.batch_sequence, b.event_count, s.stream_id
         FROM diagnostic_batches b JOIN diagnostic_streams s ON s.id = b.stream_fk
        WHERE b.owner_user_id = ? AND b.batch_id = ? LIMIT 1 FOR UPDATE`,
      [ownerUserId, batch.batchId],
    );
    if (existingBatches[0]) {
      if (existingBatches[0].payload_sha256 !== batch.payloadSha256
        || existingBatches[0].stream_id !== batch.stream.streamId) {
        throw diagnosticError(409, 'DIAGNOSTIC_IDEMPOTENCY_CONFLICT', 'batchId was reused with different content.');
      }
      await conn.commit();
      return {
        duplicate: true,
        batchId: batch.batchId,
        batchSequence: Number(existingBatches[0].batch_sequence),
        eventsReceived: Number(existingBatches[0].event_count),
        policyTier: policy.policy_tier,
      };
    }

    const [dailyRows] = await conn.execute(
      `SELECT COALESCE(SUM(payload_bytes), 0) AS bytes_24h
         FROM diagnostic_batches
        WHERE owner_user_id = ? AND received_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)`,
      [ownerUserId],
    );
    if (Number(dailyRows[0]?.bytes_24h || 0) + batch.payloadBytes > MAX_OWNER_BYTES_24H) {
      throw diagnosticError(429, 'DIAGNOSTIC_DAILY_BUDGET', 'Daily diagnostic byte budget exceeded.');
    }

    const [streams] = await conn.execute(
      `SELECT * FROM diagnostic_streams
        WHERE owner_user_id = ? AND stream_id = ? LIMIT 1 FOR UPDATE`,
      [ownerUserId, batch.stream.streamId],
    );
    let stream = streams[0];
    const retentionDays = policy.policy_tier === 'tier_b' ? TIER_B_RETENTION_DAYS : TIER_A_RETENTION_DAYS;
    const receivedAt = new Date();
    const expiresAt = new Date(receivedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    if (stream && !sameStreamIdentity(stream, batch.stream)) {
      throw diagnosticError(409, 'DIAGNOSTIC_STREAM_IDENTITY_CONFLICT', 'streamId identity changed.');
    }
    if (!stream) {
      const [inserted] = await conn.execute(
        `INSERT INTO diagnostic_streams
          (owner_user_id, owner_epoch, stream_id, source_type, client_activity_id, client_route_id,
           route_edit_session_id, memory_scope_id, activity_mode, schema_version, policy_tier,
           runtime_version, update_id, first_event_at, last_event_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ownerUserId, batch.stream.ownerEpoch, batch.stream.streamId, batch.stream.sourceType,
          batch.stream.clientActivityId, batch.stream.clientRouteId,
          batch.stream.routeEditSessionId, batch.stream.memoryScopeId, batch.stream.activityMode,
          DIAGNOSTIC_VERSION, policy.policy_tier, batch.stream.runtimeVersion, batch.stream.updateId,
          new Date(batch.firstEventAt), new Date(batch.lastEventAt), expiresAt,
        ],
      );
      stream = { id: inserted.insertId, ...batch.stream };
    }

    const [overlapping] = await conn.execute(
      `SELECT 1 FROM diagnostic_batches
        WHERE stream_fk = ?
          AND batch_sequence <= ?
          AND last_sequence >= ?
        LIMIT 1 FOR UPDATE`,
      [stream.id, batch.lastSequence, batch.batchSequence],
    );
    if (overlapping[0]) {
      throw diagnosticError(409, 'DIAGNOSTIC_SEQUENCE_CONFLICT', 'Batch sequence range overlaps existing evidence.');
    }

    try {
      await conn.execute(
        `INSERT INTO diagnostic_batches
          (owner_user_id, stream_fk, batch_id, batch_sequence, last_sequence, schema_version,
           first_event_at, last_event_at, event_count, client_dropped_count,
           payload_sha256, payload_bytes, payload_json, received_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ownerUserId, stream.id, batch.batchId, batch.batchSequence, batch.lastSequence, DIAGNOSTIC_VERSION,
          new Date(batch.firstEventAt), new Date(batch.lastEventAt), batch.events.length,
          batch.droppedCount, batch.payloadSha256, batch.payloadBytes, batch.payloadJson, receivedAt, expiresAt,
        ],
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw diagnosticError(409, 'DIAGNOSTIC_SEQUENCE_CONFLICT', 'Batch sequence already exists.');
      }
      throw error;
    }
    await conn.execute(
      `UPDATE diagnostic_streams
          SET first_event_at = LEAST(first_event_at, ?),
              last_event_at = GREATEST(last_event_at, ?),
              last_ingested_at = UTC_TIMESTAMP(3),
              last_batch_sequence = GREATEST(last_batch_sequence, ?),
              total_batches = total_batches + 1,
              total_events = total_events + ?,
              total_bytes = total_bytes + ?,
              client_dropped_count = client_dropped_count + ?,
              expires_at = GREATEST(expires_at, ?)
        WHERE id = ?`,
      [
        new Date(batch.firstEventAt), new Date(batch.lastEventAt), batch.lastSequence,
        batch.events.length, batch.payloadBytes, batch.droppedCount, expiresAt, stream.id,
      ],
    );
    await conn.commit();
    return {
      duplicate: false,
      batchId: batch.batchId,
      batchSequence: batch.batchSequence,
      eventsReceived: batch.events.length,
      bytes: batch.payloadBytes,
      policyTier: policy.policy_tier,
    };
  } catch (error) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function getAutomaticDiagnosticPolicy(pool, ownerUserId) {
  const [rows] = await pool.execute(
    `SELECT policy_tier, consent_version, enabled, enrolled_at, expires_at, updated_at
       FROM diagnostic_qa_enrollments WHERE owner_user_id = ? LIMIT 1`,
    [ownerUserId],
  );
  const row = rows[0];
  const enabled = !!row && Number(row.enabled) === 1
    && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());
  return {
    enabled,
    tier: enabled ? row.policy_tier : 'disabled',
    consentVersion: enabled ? row.consent_version : null,
    enrolledAt: enabled ? row.enrolled_at : null,
    expiresAt: enabled ? row.expires_at : null,
  };
}

async function setAutomaticDiagnosticEnrollment(pool, input) {
  const ownerUserId = Number(input.ownerUserId);
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) {
    throw diagnosticError(400, 'DIAGNOSTIC_OWNER_REQUIRED', 'Valid ownerUserId is required.');
  }
  const enabled = input.enabled === true;
  const tier = input.tier === 'tier_b' ? 'tier_b' : 'tier_a';
  const consentVersion = boundedId(String(input.consentVersion || ''), 'consentVersion', 32);
  const expiresAt = input.expiresAt == null ? null : new Date(input.expiresAt);
  if (expiresAt && !Number.isFinite(expiresAt.getTime())) {
    throw diagnosticError(400, 'DIAGNOSTIC_POLICY_INVALID', 'Invalid policy expiry.');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [owners] = await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [ownerUserId]);
    if (!owners[0]) throw diagnosticError(404, 'DIAGNOSTIC_OWNER_NOT_FOUND', 'Owner account not found.');
    await conn.execute(
      `INSERT INTO diagnostic_qa_enrollments
        (owner_user_id, policy_tier, consent_version, enabled, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE policy_tier = VALUES(policy_tier),
         consent_version = VALUES(consent_version), enabled = VALUES(enabled),
         expires_at = VALUES(expires_at), updated_at = UTC_TIMESTAMP(3)`,
      [ownerUserId, tier, consentVersion, enabled ? 1 : 0, expiresAt],
    );
    let deletedStreams = 0;
    if (!enabled) {
      const [deleted] = await conn.execute(
        'DELETE FROM diagnostic_streams WHERE owner_user_id = ?',
        [ownerUserId],
      );
      deletedStreams = Number(deleted.affectedRows || 0);
    }
    await conn.commit();
    return { ownerUserId, enabled, tier: enabled ? tier : 'disabled', consentVersion, expiresAt, deletedStreams };
  } catch (error) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function purgeExpiredAutomaticDiagnostics(pool, limit = 500) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2_000));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [expired] = await conn.execute(
      `SELECT id FROM diagnostic_batches
        WHERE expires_at < UTC_TIMESTAMP(3)
        ORDER BY expires_at ASC, id ASC LIMIT ${safeLimit} FOR UPDATE`,
    );
    let batchesPurged = 0;
    if (expired.length > 0) {
      const ids = expired.map(row => Number(row.id));
      const placeholders = ids.map(() => '?').join(',');
      const [deleted] = await conn.execute(
        `DELETE FROM diagnostic_batches WHERE id IN (${placeholders})`,
        ids,
      );
      batchesPurged = Number(deleted.affectedRows || 0);
    }
    const [emptyStreams] = await conn.execute(
      `DELETE FROM diagnostic_streams
        WHERE expires_at < UTC_TIMESTAMP(3)
          AND NOT EXISTS (
            SELECT 1 FROM diagnostic_batches b WHERE b.stream_fk = diagnostic_streams.id
          )
        LIMIT ${safeLimit}`,
    );
    await conn.commit();
    return batchesPurged + Number(emptyStreams.affectedRows || 0);
  } catch (error) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function queryAutomaticDiagnostics(pool, filters) {
  const ownerUserId = Number(filters.ownerUserId);
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) {
    throw diagnosticError(400, 'DIAGNOSTIC_OWNER_REQUIRED', 'Valid ownerUserId is required.');
  }
  const clauses = [
    's.owner_user_id = ?',
    `EXISTS (
      SELECT 1 FROM diagnostic_batches retained
       WHERE retained.stream_fk = s.id AND retained.expires_at >= UTC_TIMESTAMP(3)
    )`,
  ];
  const params = [ownerUserId];
  if (filters.clientActivityId) { clauses.push('s.client_activity_id = ?'); params.push(filters.clientActivityId); }
  if (filters.routeEditSessionId) { clauses.push('s.route_edit_session_id = ?'); params.push(filters.routeEditSessionId); }
  if (filters.memoryScopeId) { clauses.push('s.memory_scope_id = ?'); params.push(filters.memoryScopeId); }
  if (filters.sourceType) { clauses.push('s.source_type = ?'); params.push(filters.sourceType); }
  const limit = Math.max(1, Math.min(Number(filters.limit) || 3, 20));
    const [streams] = await pool.execute(
    `SELECT s.id, s.owner_epoch, s.stream_id, s.source_type, s.client_activity_id, s.client_route_id,
            s.route_edit_session_id, s.memory_scope_id, s.activity_mode, s.schema_version,
            s.policy_tier, s.runtime_version, s.update_id, s.first_event_at, s.last_event_at,
            s.last_ingested_at, s.last_batch_sequence, s.total_batches, s.total_events,
            s.total_bytes, s.client_dropped_count, s.expires_at,
            (SELECT a.id FROM sessions a
              WHERE a.user_id = s.owner_user_id
                AND a.client_activity_id = s.client_activity_id LIMIT 1) AS server_activity_id
       FROM diagnostic_streams s
      WHERE ${clauses.join(' AND ')}
      ORDER BY (
        SELECT MAX(recent.last_event_at) FROM diagnostic_batches recent
         WHERE recent.stream_fk = s.id AND recent.expires_at >= UTC_TIMESTAMP(3)
      ) DESC LIMIT ${limit}`,
    params,
  );
  const output = [];
  for (const stream of streams) {
    const [batches] = await pool.execute(
      `SELECT batch_id, batch_sequence, last_sequence, first_event_at, last_event_at, event_count,
              client_dropped_count, payload_bytes, payload_json, received_at, expires_at
         FROM diagnostic_batches WHERE stream_fk = ? AND expires_at >= UTC_TIMESTAMP(3)
        ORDER BY batch_sequence ASC, id ASC`,
      [stream.id],
    );
    const sequenceGaps = [];
    if (batches.length > 0 && Number(batches[0].batch_sequence) > 1) {
      sequenceGaps.push({ after: 0, before: Number(batches[0].batch_sequence) });
    }
    for (let index = 1; index < batches.length; index += 1) {
      const priorLast = Number(batches[index - 1].last_sequence);
      const nextFirst = Number(batches[index].batch_sequence);
      if (nextFirst > priorLast + 1) {
        sequenceGaps.push({ after: priorLast, before: nextFirst });
      }
    }
    const events = batches.flatMap(row => {
      try { return JSON.parse(row.payload_json).events ?? []; } catch { return []; }
    }).sort((left, right) => left.eventAt - right.eventAt || left.eventId.localeCompare(right.eventId));
    const retainedSummary = batches.reduce((summary, row) => ({
      firstEventAt: !summary.firstEventAt || new Date(row.first_event_at) < new Date(summary.firstEventAt)
        ? row.first_event_at : summary.firstEventAt,
      lastEventAt: !summary.lastEventAt || new Date(row.last_event_at) > new Date(summary.lastEventAt)
        ? row.last_event_at : summary.lastEventAt,
      lastBatchSequence: Math.max(summary.lastBatchSequence, Number(row.last_sequence)),
      totalBatches: summary.totalBatches + 1,
      totalEvents: summary.totalEvents + Number(row.event_count),
      totalBytes: summary.totalBytes + Number(row.payload_bytes),
      clientDroppedCount: summary.clientDroppedCount + Number(row.client_dropped_count),
      expiresAt: !summary.expiresAt || new Date(row.expires_at) > new Date(summary.expiresAt)
        ? row.expires_at : summary.expiresAt,
    }), {
      firstEventAt: null,
      lastEventAt: null,
      lastBatchSequence: 0,
      totalBatches: 0,
      totalEvents: 0,
      totalBytes: 0,
      clientDroppedCount: 0,
      expiresAt: null,
    });
    output.push({
      ...stream,
      first_event_at: retainedSummary.firstEventAt,
      last_event_at: retainedSummary.lastEventAt,
      last_batch_sequence: retainedSummary.lastBatchSequence,
      total_batches: retainedSummary.totalBatches,
      total_events: retainedSummary.totalEvents,
      total_bytes: retainedSummary.totalBytes,
      client_dropped_count: retainedSummary.clientDroppedCount,
      expires_at: retainedSummary.expiresAt,
      uploadStatus: 'SERVER_ACKED',
      sequenceGaps,
      batches: batches.map(({ payload_json, ...row }) => row),
      events,
    });
  }
  return {
    ownerUserId,
    count: output.length,
    diagnosticState: output.length > 0
      ? 'SERVER_ACKED'
      : 'UNKNOWN_NO_SERVER_STREAM_CLIENT_STATE_UNAVAILABLE',
    streams: output,
  };
}

module.exports = {
  DIAGNOSTIC_SCHEMA,
  DIAGNOSTIC_VERSION,
  MAX_EVENTS_PER_BATCH,
  MAX_BATCH_BYTES,
  normalizeAutomaticDiagnosticBatch,
  ingestAutomaticDiagnosticBatch,
  getAutomaticDiagnosticPolicy,
  setAutomaticDiagnosticEnrollment,
  purgeExpiredAutomaticDiagnostics,
  queryAutomaticDiagnostics,
};
