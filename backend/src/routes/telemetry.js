/**
 * Telemetry routes — receive debug logger session uploads from Cairn app.
 *
 *   POST /api/telemetry/sessions
 *     Headers: X-API-Key: <shared secret>
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
 * Auth: simple X-API-Key shared secret. Set CAIRN_TELEMETRY_API_KEY in .env.
 *       This is device-level auth, not user auth — multiple devices share one key.
 *       Rotate on suspected leak.
 *
 * Rate limit: 60 requests / 5 min per IP — prevents disk fill from leaked key.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');

const router = express.Router();

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB hard cap per upload

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

// ── Auth middleware (disabled for dev) ────────────────────────────────────
// TODO(O2): 隐私漏洞。requireApiKey 是空 no-op,3 route (POST /sessions,
// GET /sessions, GET /sessions/:session_id) 都以为它在保护。生产上如果
// nginx 未额外拦截 /api/telemetry 就是公开的。修法二选一:
//   (a) 实现 X-API-Key 检查: 读 process.env.CAIRN_TELEMETRY_API_KEY,
//       与 req.header('X-API-Key') 常量时间比对; 无 env var 时 fail-closed
//   (b) 若确定 nginx 已 100% 拦截, 删掉 middleware + 改 comment 明说
//       "auth 由前置代理负责"
// 用户 2026-07-26 O1 sprint 已 ack 此 TODO,暂不处理。
//
// Sprint 6 round-24 R24 investigation (2026-07-29): confirmed the
// client-side telemetryUploader.ts:127-141 does NOT send X-API-Key
// header. Server env var CAIRN_TELEMETRY_API_KEY is set on aliyun but
// unused. Enabling option (a) server-side without a coordinated client
// OTA that adds the header would 401 every crash-report upload from
// every real user, breaking the crash reporter permanently. Fix must
// be shipped as: (1) client OTA adds X-API-Key header from settings,
// (2) verify field of view on real device sends the header, (3) THEN
// enable server-side enforcement. Deferred to a coordinated Sprint.
function requireApiKey(req, res, next) {
  next();
}

// ── POST /api/telemetry/sessions ───────────────────────────────────────────
router.post('/sessions', uploadLimiter, requireApiKey, async (req, res) => {
  const body = req.body;

  // Accept two formats:
  //   1. JSON object: { session_id, device_info, started_at, ended_at, events: [...] }
  //   2. JSONL string: raw newline-delimited JSON events
  let sessionId, deviceInfo, startedAt, endedAt, eventsCount, rawJsonl, activityMode;

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
    deviceInfo = {
      model: req.header('X-Cairn-Device-Model') || null,
      os: req.header('X-Cairn-Device-Os') || null,
      os_version: req.header('X-Cairn-Os-Version') || null,
      app_version: req.header('X-Cairn-App-Version') || null,
      build_number: req.header('X-Cairn-Build-Number') || null,
    };
    const sa = req.header('X-Cairn-Started-At');
    const ea = req.header('X-Cairn-Ended-At');
    startedAt = sa ? Number(sa) : null;
    endedAt = ea ? Number(ea) : null;
    activityMode = req.header('X-Cairn-Activity-Mode') || null;
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

  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
    return res.status(400).json({ error: 'Invalid session_id.' });
  }

  const rawSizeBytes = Buffer.byteLength(rawJsonl, 'utf8');
  if (rawSizeBytes > MAX_BODY_BYTES) {
    return res.status(413).json({ error: `Payload too large (${rawSizeBytes} > ${MAX_BODY_BYTES} bytes).` });
  }

  const durationMs = startedAt && endedAt ? endedAt - startedAt : null;

  try {
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
router.get('/sessions', readLimiter, requireApiKey, async (req, res) => {
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
router.get('/sessions/:session_id', readLimiter, requireApiKey, async (req, res) => {
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
