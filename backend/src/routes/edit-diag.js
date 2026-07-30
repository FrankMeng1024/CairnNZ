/**
 * edit-diag route — v429 添加,接收 client appLog batch 上传
 *
 * URL: POST /api/edit-diag
 * Body: { batch: [{ tag, ts, session_id, ctx, device }, ...] }
 *
 * 写入 debug_events_v2 表 (phase=tag, step=ctx JSON, user_id 从 auth)
 * 6000 req / 5min / IP 限流 (per memory reference_edit_diag_ratelimit.md).
 *
 * 用途: 从 client 收集诊断 log (v428.hierarchy.* 等 tag).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
// O1: authenticate 死 require (manual JWT parse in the handler)

const router = express.Router();

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 6000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Authenticate optional — allow anonymous log upload (e.g. boot before login)
router.post('/', limiter, express.json({ limit: '2mb' }), async (req, res) => {
  const body = req.body || {};
  // v430 fix: client (appLog.ts) sends `events`, curl tests use `batch`.
  // Accept both — root cause of empty debug_events_v2 despite nginx 200 OK.
  const batch = Array.isArray(body.batch) ? body.batch
              : Array.isArray(body.events) ? body.events
              : [];
  if (batch.length === 0) return res.json({ received: 0 });

  // Sprint 6 round-31 R31B2: cap batch length so a single request can't
  // dump thousands of events. Pre-fix, 6000 req/5min/IP × 2MB body =
  // 12GB/5min disk-fill vector per IP even after body-size cap. Legitimate
  // client (appLog.ts) batches ~50-100 events per flush. 500 leaves 5x
  // headroom over normal; anything larger is either misconfigured client
  // or malicious. Extra events past 500 silently truncated with a
  // received_capped signal in the response so ops can spot the pattern.
  const CAP = 500;
  const originalLen = batch.length;
  const cappedBatch = batch.length > CAP ? batch.slice(0, CAP) : batch;

  // Optional JWT
  let userId = null;
  const authz = req.headers.authorization;
  if (authz && authz.startsWith('Bearer ')) {
    try {
      // Sprint 6 R72: use the shared verifyToken helper (pins algorithm
      // to HS256 per R34B7). Pre-fix, this file called `jwt.verify` raw
      // with no algorithm allowlist — a jsonwebtoken lib regression
      // could accept an unexpected algorithm on future upgrade. Route
      // logic unchanged; catch stays silent for invalid tokens because
      // /edit-diag is intentionally auth-optional (client boot logs
      // arrive before login).
      const { verifyToken } = require('../config/jwt');
      const decoded = verifyToken(authz.slice(7));
      userId = decoded.userId || null;
    } catch { /* ignore invalid */ }
  }

  try {
    const values = [];
    const params = [];
    for (const item of cappedBatch) {
      // Sprint 6 R79: tag slice was 96 but debug_events_v2.phase is
      // VARCHAR(64). Under STRICT_TRANS_TABLES, a 64+ char tag would
      // ER_DATA_TOO_LONG the INSERT. Align slice to column width.
      const tag = String(item.tag || '').slice(0, 64);
      const session_id = String(item.session_id || 'unknown').slice(0, 64);
      // Sprint 6 R80: bound ts and seq to non-negative. debug_events_v2
      // has BIGINT UNSIGNED for both; a client-supplied negative value
      // would ER_DATA_OUT_OF_RANGE under STRICT_TRANS_TABLES, poisoning
      // the whole batch INSERT. Coerce negatives to 0.
      const rawTs = Number(item.ts || Date.now());
      const ts = Number.isFinite(rawTs) && rawTs >= 0 ? rawTs : Date.now();
      const rawSeq = Number(item.seq || 0);
      const seq = Number.isFinite(rawSeq) && rawSeq >= 0 ? rawSeq : 0;
      const ctx = item.ctx ? JSON.stringify(item.ctx).slice(0, 1024) : '';
      values.push('(?, ?, ?, ?, ?, ?, ?, ?)');
      params.push(userId, session_id, tag, 'log', seq, ts, 'ok', ctx);
    }
    await pool.query(
      `INSERT INTO debug_events_v2 (user_id, session_instance_id, phase, step, seq, timestamp_unix_ms, outcome, diagnostic) VALUES ${values.join(',')}`,
      params
    );
    const resp = { received: cappedBatch.length };
    if (originalLen > CAP) resp.truncated_from = originalLen;
    res.json(resp);
  } catch (err) {
    console.error('[edit-diag]', err.message);
    res.status(500).json({ error: 'insert failed' });
  }
});

module.exports = router;
