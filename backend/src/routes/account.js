/**
 * Account routes — /api/account
 *
 * Batch 6.7 GDPR data export:
 *   POST   /api/account/export           — request an export (queues + emails link)
 *   GET    /api/account/exports          — my export history
 *   GET    /api/account/export/:token    — download the JSON bundle
 *
 * The download endpoint is UNAUTHENTICATED so a plain HTTPS URL works in
 * email. Security via the 64-hex-char random token (2^256 space) + 24h
 * TTL + one-row-per-user invariant.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const DataExport = require('../models/DataExport');
const { sendDataExportReady } = require('../services/emailService');

// Sprint 6 review C1 fix: rate-limit the unauthenticated download route
// to blunt token-brute and timing side-channel attacks. 30 req / min / IP
// is comfortably above legitimate re-tries (email link tap → download).
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  // Sprint 6 round-11 R11B5: /export/:token is unauthenticated, so IP-
  // keyed. IPv6-safe via ipKeyGenerator helper (avoids v7+ ERR_ERL_KEY_GEN_IPV6).
  keyGenerator: (req, res) => ipKeyGenerator(req, res),
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
  keyGenerator: (req, res) => req.user?.userId ? `export:${req.user.userId}` : ipKeyGenerator(req, res),
  message: { error: 'Too many export requests. Please wait an hour.' },
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
    // Email the (eventual) link. Client also gets the token so they can
    // poll status / show a download button without waiting for the email.
    try {
      // Sprint 6 R49: Host-header injection fix. Pre-fix, the fallback
      // `${req.protocol}://${req.get('host')}` was user-controlled —
      // attacker POSTs /export with header `Host: attacker.com` → email
      // link points to https://attacker.com/api/account/export/<real-token>
      // → victim clicks → attacker's access log captures the download
      // token, then attacker retrieves the victim's data from the real
      // backend at api.yiiling.cn.
      //
      // Fix: use ONLY env-configured PUBLIC_API_BASE_URL. If unset,
      // fall back to the hardcoded production URL (api.yiiling.cn per
      // app/src/config/api.ts) — never trust the Host header. Dev
      // environments should set PUBLIC_API_BASE_URL to override.
      const publicBase = process.env.PUBLIC_API_BASE_URL || 'https://api.yiiling.cn';
      if (!/^https?:\/\//i.test(publicBase)) {
        console.error('[account/export] PUBLIC_API_BASE_URL malformed — must start with http:// or https://');
      } else {
        const url = `${publicBase.replace(/\/$/, '')}/api/account/export/${result.download_token}`;
        const [rows] = await require('../config/db').execute(
          'SELECT email, name FROM users WHERE id = ? LIMIT 1',
          [req.user.userId],
        );
        if (rows[0]) {
          sendDataExportReady(rows[0].email, rows[0].name, url).catch(err =>
            console.error('[email] export ready send failed:', err.message)
          );
        }
      }
    } catch (err) {
      console.error('[export/email]', err.message);
    }
    return res.json({
      message: result.existing
        ? 'You already have an export in progress.'
        : 'Export requested. We\'ll email you when it\'s ready.',
      status: result.status,
      download_token: result.download_token,
      expires_at: result.expires_at,
    });
  } catch (err) {
    console.error('[export/request]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

router.get('/exports', authenticate, async (req, res) => {
  try {
    const pool = require('../config/db');
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
      `SELECT id, status, size_bytes, requested_at, built_at, expires_at, sent_at, error_msg
       FROM data_exports WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
      [req.user.userId],
    );
    const sanitized = rows.map((r) => {
      if (!r.error_msg) return { ...r, error_msg: null };
      const raw = String(r.error_msg).toLowerCase();
      // Only surface a stable, user-actionable category.
      let category = 'internal_error';
      if (raw.includes('no space') || raw.includes('enospc')) category = 'server_disk_full';
      else if (raw.includes('timeout')) category = 'timeout';
      else if (raw.includes('too large') || raw.includes('too many rows')) category = 'too_much_data';
      return { ...r, error_msg: category };
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
