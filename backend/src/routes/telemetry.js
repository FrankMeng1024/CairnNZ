/**
 * Telemetry routes — receive debug logger session uploads from Cairn app.
 *
 *   POST /api/telemetry/sessions
 *     Auth: signed-in Bearer JWT or X-API-Key operations credential
 *     Body:    { session_id, device_info, started_at, ended_at, events: [...] }
 *              OR raw JSONL string (Content-Type: application/x-ndjson)
 *
 *   GET  /api/telemetry/sessions
 *     Headers: X-API-Key
 *     Query:   ?since=2026-05-19&limit=50
 *     Returns: list of session metadata (no raw_jsonl)
 *
 *   GET  /api/telemetry/sessions/:session_id
 *     Headers: X-API-Key
 *     Returns: full session including raw_jsonl
 *
 * Retrieval auth: X-API-Key operations credential. Set
 * CAIRN_TELEMETRY_API_KEY in the server environment and rotate on suspected
 * leak. The key is never returned to or persisted by this route.
 *
 * Rate limit: 60 requests / 5 min per IP — prevents disk fill from leaked key.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const { sanitizeQaJsonl } = require('../utils/qaTelemetryPrivacy');
const { mergeQaTelemetryJsonl } = require('../utils/qaTelemetryMerge');

const router = express.Router();

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB hard cap per upload
const QA_RETENTION_DAYS = 14;

// ── Rate limiting ──────────────────────────────────────────────────────────
const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60,                  // 60 uploads per IP per 5 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many telemetry uploads. Try again later.' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Auth middleware ───────────────────────────────────────────────────────
// Upload accepts either the signed-in app JWT or the server-held operations
// key. Retrieval is operations-only and always requires the key. A missing
// server key fails closed; no credential is ever written to telemetry.
function hasValidApiKey(req) {
  const expected = String(process.env.CAIRN_TELEMETRY_API_KEY || '');
  const supplied = String(req.header('X-API-Key') || '');
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

function requireReadApiKey(req, res, next) {
  if (!process.env.CAIRN_TELEMETRY_API_KEY) {
    return res.status(503).json({ error: 'Telemetry retrieval is not configured.' });
  }
  if (!hasValidApiKey(req)) return res.status(401).json({ error: 'Telemetry authorization required.' });
  return next();
}

function requireUploadAuth(req, res, next) {
  if (hasValidApiKey(req)) return next();
  return authenticate(req, res, next);
}

// ── POST /api/telemetry/sessions ───────────────────────────────────────────
router.post('/sessions', uploadLimiter, requireUploadAuth, async (req, res) => {
  const body = req.body;

  // Accept two formats:
  //   1. JSON object: { session_id, device_info, started_at, ended_at, events: [...] }
  //   2. JSONL string: raw newline-delimited JSON events
  let sessionId, deviceInfo, startedAt, endedAt, eventsCount, rawJsonl, activityMode;

  // Sprint 6 R64/R66: helper to clamp client-supplied strings to
  // DB column widths under STRICT_TRANS_TABLES. Used by both the
  // JSONL header path (below) and the JSON body path (further below).
  const clamp = (v, n) => v ? String(v).slice(0, n) : null;

  if (typeof body === 'string') {
    // JSONL upload — first event must contain session_id.
    // Device info comes from X-Cairn-* headers since the body is raw events only.
    rawJsonl = body;
    const firstNewline = body.indexOf('\n');
    const firstLine = firstNewline > 0 ? body.slice(0, firstNewline) : body;
    try {
      const firstEvent = JSON.parse(firstLine);
      sessionId = firstEvent.session_id;
    } catch (err) {
      return res.status(400).json({ error: 'JSONL first line not parseable.' });
    }
    eventsCount = (rawJsonl.match(/\n/g) || []).length + 1;
    // Sprint 6 R64: truncate header values to match DB column widths.
    // telemetry_sessions has VARCHAR(64) for device_model and VARCHAR(16)
    // for os/os_version/app_version/build_number/activity_mode. Under
    // STRICT_TRANS_TABLES (verified on aliyun), an oversized header
    // yields ER_DATA_TOO_LONG and 500s the whole upload. Newer devices
    // legitimately report OS strings > 16 chars; truncate rather than
    // reject. Same fix as debug-snapshot R64.
    deviceInfo = {
      model: clamp(req.header('X-Cairn-Device-Model'), 64),
      os: clamp(req.header('X-Cairn-Device-Os'), 16),
      os_version: clamp(req.header('X-Cairn-Os-Version'), 16),
      app_version: clamp(req.header('X-Cairn-App-Version'), 16),
      build_number: clamp(req.header('X-Cairn-Build-Number'), 16),
    };
    const sa = req.header('X-Cairn-Started-At');
    const ea = req.header('X-Cairn-Ended-At');
    startedAt = sa ? Number(sa) : null;
    endedAt = ea ? Number(ea) : null;
    activityMode = clamp(req.header('X-Cairn-Activity-Mode'), 16);
  } else if (body && typeof body === 'object') {
    sessionId = body.session_id;
    deviceInfo = body.device_info || {};
    startedAt = body.started_at || null;
    endedAt = body.ended_at || null;
    activityMode = body.activity_mode || null;
    const events = Array.isArray(body.events) ? body.events : [];
    eventsCount = events.length;
    rawJsonl = events.map((e) => JSON.stringify(e)).join('\n');
  } else {
    return res.status(400).json({ error: 'Body must be JSON object or JSONL string.' });
  }

  // Sprint 6 R66: apply the same VARCHAR clamping to the JSON body path
  // that R64 applied to the header path. Both branches feed the same
  // INSERT/UPDATE at line 163-167. Pre-fix, an oversized deviceInfo.os
  // or activityMode from a body upload would ER_DATA_TOO_LONG under
  // STRICT_TRANS_TABLES.
  deviceInfo = {
    model: clamp(deviceInfo.model, 64),
    os: clamp(deviceInfo.os, 16),
    os_version: clamp(deviceInfo.os_version, 16),
    app_version: clamp(deviceInfo.app_version, 16),
    build_number: clamp(deviceInfo.build_number, 16),
  };
  activityMode = clamp(activityMode, 16);

  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
    return res.status(400).json({ error: 'Invalid session_id.' });
  }

  // Defense in depth for Internal QA data. The client performs the same
  // fail-private scrub before upload, but the server never trusts that a
  // caller is current or correctly implemented. Precise coordinates survive
  // only on explicitly synthetic events; real/unknown coordinates and all
  // credential-shaped values are removed before storage.
  if (activityMode === 'qa_activity') {
    try {
      const sanitized = sanitizeQaJsonl(rawJsonl);
      rawJsonl = sanitized.jsonl;
      eventsCount = sanitized.eventsCount;
    } catch (error) {
      const tooLarge = error.code === 'QA_PAYLOAD_TOO_LARGE' || error.code === 'QA_EVENT_LIMIT';
      return res.status(tooLarge ? 413 : 400).json({ error: error.message });
    }
  }

  let rawSizeBytes = Buffer.byteLength(rawJsonl, 'utf8');
  if (rawSizeBytes > MAX_BODY_BYTES) {
    return res.status(413).json({ error: `Payload too large (${rawSizeBytes} > ${MAX_BODY_BYTES} bytes).` });
  }

  const durationMs = startedAt && endedAt ? endedAt - startedAt : null;

  try {
    if (activityMode === 'qa_activity') {
      // A live Activity sends bounded rolling snapshots. Preserve their union
      // so the final upload cannot replace early provider/outlier evidence
      // with only the tail of a long walk. The merge itself remains bounded.
      const [priorRows] = await pool.execute(
        'SELECT raw_jsonl FROM telemetry_sessions WHERE session_id = ? LIMIT 1',
        [sessionId],
      );
      const merged = mergeQaTelemetryJsonl(priorRows[0]?.raw_jsonl || '', rawJsonl);
      rawJsonl = merged.jsonl;
      eventsCount = merged.eventsCount;
      rawSizeBytes = Buffer.byteLength(rawJsonl, 'utf8');
    }
    // UPSERT — same session_id can be re-uploaded (e.g. retry).
    // ALL fields update on conflict, since later upload may have richer metadata.
    await pool.execute(
      `INSERT INTO telemetry_sessions
         (session_id, device_model, device_os, os_version, app_version, build_number,
          started_at, ended_at, duration_ms, events_count, raw_size_bytes,
          activity_mode, raw_jsonl, upload_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         device_model = VALUES(device_model),
         device_os = VALUES(device_os),
         os_version = VALUES(os_version),
         app_version = VALUES(app_version),
         build_number = VALUES(build_number),
         started_at = COALESCE(VALUES(started_at), started_at),
         ended_at = COALESCE(VALUES(ended_at), ended_at),
         duration_ms = COALESCE(VALUES(duration_ms), duration_ms),
         events_count = GREATEST(VALUES(events_count), events_count),
         raw_size_bytes = GREATEST(VALUES(raw_size_bytes), raw_size_bytes),
         activity_mode = COALESCE(VALUES(activity_mode), activity_mode),
         raw_jsonl = VALUES(raw_jsonl),
         uploaded_at = CURRENT_TIMESTAMP,
         upload_source = 'retry'`,
      [
        sessionId,
        deviceInfo.model || null,
        deviceInfo.os || null,
        deviceInfo.os_version || null,
        deviceInfo.app_version || null,
        deviceInfo.build_number || null,
        startedAt,
        endedAt,
        durationMs,
        eventsCount,
        rawSizeBytes,
        activityMode,
        rawJsonl,
        'auto',
      ]
    );

    // Internal QA rows are intentionally disposable. Opportunistic cleanup
    // keeps the reused telemetry table bounded without a migration or a new
    // analytics system. Historical crash/activity telemetry is untouched.
    if (activityMode === 'qa_activity') {
      try {
        await pool.execute(
          `DELETE FROM telemetry_sessions
            WHERE activity_mode = 'qa_activity'
              AND uploaded_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${QA_RETENTION_DAYS} DAY)`,
        );
      } catch (cleanupError) {
        console.warn('[telemetry] QA retention cleanup failed:', cleanupError.message);
      }
    }

    return res.status(200).json({
      ok: true,
      session_id: sessionId,
      events_received: eventsCount,
      bytes: rawSizeBytes,
    });
  } catch (err) {
    // Sprint 6 R54: don't return err.code to client. MySQL error codes
    // like ER_DUP_ENTRY / ER_NO_SUCH_TABLE reveal schema state. Same
    // rationale as R53 debug-snapshot fix. Server-side log retains
    // both code + message for ops diagnostics.
    console.error('[telemetry] insert error:', err.code, err.message);
    return res.status(500).json({ error: 'Database insert failed.' });
  }
});

// ── GET /api/telemetry/sessions ────────────────────────────────────────────
// ⚠️ DEV TOOL ONLY (2026-07-20 phase3 decision "defer 到工具类的 controller")
// 用途: 开发者本地 curl 查询过去 upload 的 telemetry session 列表, 排查
//       客户端 crash / breadcrumb。前端不调用此 endpoint(0 处 fetch)。
// 保护: requireApiKey — 需 X-Api-Key header, 生产 nginx 不暴露给公网 SPA。
// 不进 client bundle; 保留供 SSH+curl 分析线上 crash log。
router.get('/sessions', readLimiter, requireReadApiKey, async (req, res) => {
  const since = req.query.since;
  // Sprint 6 R50: clamp limit [1, 200] — pre-fix, a negative like
  // ?limit=-500 passed the `|| 50` (only 0/NaN are falsy for Number),
  // then Math.min(-500, 200) = -500, then MySQL rejected LIMIT -500
  // with a 500 error to the caller. Not exploitable, just poor
  // input handling. Same clamp pattern as PushNotification.listRecent.
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 200));

  let where = '';
  const params = [];
  if (since) {
    where = 'WHERE uploaded_at >= ?';
    params.push(since);
  }

  try {
    // mysql2 prepared statements don't allow LIMIT placeholders in some versions,
    // so we interpolate the (already-validated number) limit directly.
    const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 50;
    const [rows] = await pool.execute(
      `SELECT id, session_id, device_model, device_os, os_version, app_version,
              started_at, ended_at, duration_ms, events_count, raw_size_bytes,
              activity_mode, uploaded_at, upload_source
         FROM telemetry_sessions
         ${where}
         ORDER BY uploaded_at DESC
         LIMIT ${safeLimit}`,
      params
    );
    return res.json({ count: rows.length, sessions: rows });
  } catch (err) {
    console.error('[telemetry] list error:', err.message);
    return res.status(500).json({ error: 'Database query failed.' });
  }
});

// ── GET /api/telemetry/sessions/:session_id ────────────────────────────────
// ⚠️ DEV TOOL ONLY (2026-07-20 phase3 decision) — 单条 telemetry 详情查询。
// 前端不调; requireApiKey 保护; 保留供开发者 SSH+curl 排查特定 session。
router.get('/sessions/:session_id', readLimiter, requireReadApiKey, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM telemetry_sessions WHERE session_id = ? LIMIT 1`,
      [req.params.session_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    return res.json({ session: rows[0] });
  } catch (err) {
    console.error('[telemetry] get error:', err.message);
    return res.status(500).json({ error: 'Database query failed.' });
  }
});

module.exports = router;
