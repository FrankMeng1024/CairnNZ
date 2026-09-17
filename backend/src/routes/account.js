/**
 * Account routes — /api/account
 *
 * Batch 6.7 GDPR data export:
 *   POST   /api/account/export           — request an export
 *   GET    /api/account/exports          — my export history
 *   GET    /api/account/export/:token    — download the JSON bundle
 *   POST   /api/account/feedback         — durable acknowledged feedback
 *
 * The download endpoint is UNAUTHENTICATED so a plain HTTPS URL works in
 * email. Security via the 64-hex-char random token (2^256 space) + 24h
 * TTL + one-row-per-user invariant.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const fs = require('fs');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const DataExport = require('../models/DataExport');
const pool = require('../config/db');

function publicDownloadUrl(token) {
  const publicBase = process.env.PUBLIC_API_BASE_URL || 'https://api.yiiling.cn';
  const secure = /^https:\/\//i.test(publicBase);
  const loopback = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(publicBase);
  if (!secure && !loopback) return null;
  return `${publicBase.replace(/\/$/, '')}/api/account/export/${token}`;
}

// Sprint 6 review C1 fix: rate-limit the unauthenticated download route
// to blunt token-brute and timing side-channel attacks. 30 req / min / IP
// is comfortably above legitimate re-tries (email link tap → download).
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  // Sprint 6 round-11 R11B5: /export/:token is unauthenticated, so IP-
  // keyed. IPv6-safe via ipKeyGenerator helper (avoids v7+ ERR_ERL_KEY_GEN_IPV6).
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: 'Too many download attempts. Please wait a minute.',
});

// Sprint 6 round-32 R32B1: rate-limit POST /export per-user. Pre-fix, a
// user could spam the endpoint — each call triggers setImmediate →
// DataExport.buildPending which processes ANY queued export row in the
// system (not just this user's), wasting CPU and DB pool on other users'
// pending exports. Legitimate use: user taps "Export my data" maybe
// twice in a bad-signal retry — 5 requests / hour / user is plenty and
// isolates blast radius per-user (shared-NAT offices don't collide).
const exportRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId ? `export:${req.user.userId}` : ipKeyGenerator(req.ip),
  message: { error: 'Too many export requests. Please wait an hour.' },
});

const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 12,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId ? `feedback:${req.user.userId}` : ipKeyGenerator(req.ip),
  message: { error: 'Too many feedback attempts. Please try again later.' },
});

router.post('/feedback', authenticate, feedbackLimiter, async (req, res) => {
  const submissionId = String(req.body?.client_submission_id || '').trim().toLowerCase();
  const kind = String(req.body?.kind || '').trim().toLowerCase();
  const message = String(req.body?.message || '').trim();
  const appVersion = req.body?.app_version == null ? null : String(req.body.app_version).trim().slice(0, 32);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(submissionId)) {
    return res.status(400).json({ error: 'Invalid submission identifier.' });
  }
  if (!['feedback', 'bug'].includes(kind)) {
    return res.status(400).json({ error: 'Choose feedback or bug report.' });
  }
  if (message.length < 3 || message.length > 2000) {
    return res.status(400).json({ error: 'Feedback must be between 3 and 2,000 characters.' });
  }

  try {
    const [result] = await pool.execute(
      `INSERT IGNORE INTO feedback_messages
         (user_id, client_submission_id, kind, message, app_version)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.userId, submissionId, kind, message, appVersion || null],
    );
    const duplicate = result.affectedRows === 0;
    return res.status(200).json({
      acknowledged: true,
      submission_id: submissionId,
      duplicate,
    });
  } catch (err) {
    console.error('[account/feedback]', err);
    return res.status(500).json({ error: 'Feedback could not be delivered. Please try again.' });
  }
});

// Authed routes
router.post('/export', authenticate, exportRequestLimiter, async (req, res) => {
  try {
    const result = await DataExport.request(req.user.userId);
    // Kick a build immediately in the background so small exports feel
    // "instant" — worker cron picks up the row otherwise.
    setImmediate(() => {
      DataExport.buildPending({ batchSize: 1 }).catch(err =>
        console.error('[export/inline-build]', err.message)
      );
    });
    return res.json({
      message: result.existing
        ? 'You already have an export in progress.'
        : 'Export requested. You can return here to download it when it is ready.',
      status: result.status,
      download_url: result.status === 'ready' ? publicDownloadUrl(result.download_token) : null,
      expires_at: result.expires_at,
    });
  } catch (err) {
    console.error('[export/request]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

router.get('/exports', authenticate, async (req, res) => {
  try {
    // Sprint 6 review M2: expose error_msg on the history endpoint so
    // users have visibility into WHY an export failed (previously they
    // saw status='failed' with no diagnostic and retried into infinity).
    //
    // Sprint 6 R62: sanitize error_msg before returning to client. Raw
    // err.message from mysql2/fs errors can contain schema details
    // ("Unknown column 'x' in field list", "Table X doesn't exist",
    // "Cannot enlarge memory arrays"), leaking backend internals to
    // any authenticated user via their own export history. Same class
    // as R53/R54 (500-handler err.message leaks). Fix: map internal
    // messages to user-friendly categories.
    const [rows] = await pool.execute(
      `SELECT id, status, size_bytes, requested_at, built_at, expires_at, sent_at,
              error_msg, download_token
       FROM data_exports WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
      [req.user.userId],
    );
    const sanitized = rows.map((r) => {
      const download_url = r.status === 'ready' ? publicDownloadUrl(r.download_token) : null;
      const base = { ...r, download_token: undefined, download_url };
      if (!r.error_msg) return { ...base, error_msg: null };
      const raw = String(r.error_msg).toLowerCase();
      // Only surface a stable, user-actionable category.
      let category = 'internal_error';
      if (raw.includes('no space') || raw.includes('enospc')) category = 'server_disk_full';
      else if (raw.includes('timeout')) category = 'timeout';
      else if (raw.includes('too large') || raw.includes('too many rows')) category = 'too_much_data';
      return { ...base, error_msg: category };
    });
    return res.json(sanitized);
  } catch (err) {
    console.error('[export/history]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// Download — unauthenticated, gated by the 64-hex token + expiry + rate limit.
// Sprint 6 review C1: collapse all failure modes to a single 404 body to
// remove the timing side channel between "not found" / "expired" / "file
// missing" / "wrong status".
router.get('/export/:token', downloadLimiter, async (req, res) => {
  try {
    const row = await DataExport.findByToken(req.params.token);
    if (!row || row.status !== 'ready') return res.status(404).send('Not found or expired.');
    // Sprint 6 R92 BUG-3: TZ-safe expiry check. Pre-fix, this compared
    // `new Date(row.expires_at) < new Date()` in Node. row.expires_at
    // comes from mysql2 as a JS Date reconstructed via the pool's
    // configured timezone (default 'local'). Two failure modes:
    //   (a) MySQL server session TZ != Node TZ → Date reconstructed
    //       with a wall-clock offset up to ±12h, silently extending or
    //       truncating the export token's 24h window.
    //   (b) mysql2 timezone config drift between environments (prod
    //       aliyun UTC vs a future dev laptop in Pacific/Auckland)
    //       produces different expiry behavior for the same DB row.
    // Current aliyun deploy is UTC/UTC symmetric so no user impact
    // today; the fix is defense-in-depth against future drift.
    //
    // Fix: ask DataExport to check expiry via SQL (`WHERE expires_at >
    // UTC_TIMESTAMP()`) so the DB alone owns the clock and its own
    // stored DATETIME. Move the check into findByToken semantically:
    // treat "expired per SQL" the same as "not found".
    const nowExpired = row.expires_at && await DataExport.isExpired(row.id);
    if (nowExpired) {
      return res.status(404).send('Not found or expired.');
    }
    if (!row.file_path || !fs.existsSync(row.file_path)) {
      return res.status(404).send('Not found or expired.');
    }
    await DataExport.markSent(row.id).catch(() => { /* silent */ });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="cairn-export-${row.id}.json"`);
    // Stream — a big export could be dozens of MB, don't buffer.
    const stream = fs.createReadStream(row.file_path);
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('[export/download stream]', err.message);
      if (!res.headersSent) res.status(500).end();
    });
  } catch (err) {
    console.error('[export/download]', err);
    return res.status(500).send('Server error.');
  }
});

module.exports = router;
