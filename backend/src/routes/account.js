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
  message: 'Too many download attempts. Please wait a minute.',
});

// Authed routes
router.post('/export', authenticate, async (req, res) => {
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
      const publicBase = process.env.PUBLIC_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
      const url = `${publicBase}/api/account/export/${result.download_token}`;
      const [rows] = await require('../config/db').execute(
        'SELECT email, name FROM users WHERE id = ? LIMIT 1',
        [req.user.userId],
      );
      if (rows[0]) {
        sendDataExportReady(rows[0].email, rows[0].name, url).catch(err =>
          console.error('[email] export ready send failed:', err.message)
        );
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
    const [rows] = await pool.execute(
      `SELECT id, status, size_bytes, requested_at, built_at, expires_at, sent_at
       FROM data_exports WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
      [req.user.userId],
    );
    return res.json(rows);
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
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
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
