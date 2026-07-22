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
const authenticate = require('../middleware/authenticate');

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

  // Optional JWT
  let userId = null;
  const authz = req.headers.authorization;
  if (authz && authz.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(authz.slice(7), process.env.JWT_SECRET);
      userId = decoded.userId || null;
    } catch { /* ignore invalid */ }
  }

  try {
    const values = [];
    const params = [];
    for (const item of batch) {
      const tag = String(item.tag || '').slice(0, 96);
      const session_id = String(item.session_id || 'unknown').slice(0, 64);
      const ts = Number(item.ts || Date.now());
      const seq = Number(item.seq || 0);
      const ctx = item.ctx ? JSON.stringify(item.ctx).slice(0, 1024) : '';
      values.push('(?, ?, ?, ?, ?, ?, ?, ?)');
      params.push(userId, session_id, tag, 'log', seq, ts, 'ok', ctx);
    }
    await pool.query(
      `INSERT INTO debug_events_v2 (user_id, session_instance_id, phase, step, seq, timestamp_unix_ms, outcome, diagnostic) VALUES ${values.join(',')}`,
      params
    );
    res.json({ received: batch.length });
  } catch (err) {
    console.error('[edit-diag]', err.message);
    res.status(500).json({ error: 'insert failed' });
  }
});

module.exports = router;
