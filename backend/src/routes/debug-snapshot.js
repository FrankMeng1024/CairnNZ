/**
 * Debug snapshot routes — receive PNG screenshots from Cairn app's
 * debug button so we can visually verify rendering bugs.
 *
 *   POST /api/debug-snapshot
 *     Headers: Content-Type: image/png
 *     Query:   ?id=<snapshot_id>&meta=<base64-json>
 *     Body:    raw PNG bytes (binary)
 *     Returns: { id, bytes, ok }
 *
 *   GET /api/debug-snapshot/latest
 *     Returns: redirect to /api/debug-snapshot/<id>.png of the newest row
 *
 *   GET /api/debug-snapshot/:id
 *     Returns: PNG binary (Content-Type: image/png)
 *
 * Storage: debug_snapshots table (LONGBLOB image_blob + JSON meta).
 * Auth: none (dev). Rate-limited to 60/5min/IP.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');

const router = express.Router();

// Allow up to 12MB raw PNG bodies (typical iPhone screenshot is 2-6MB).
const rawBody = express.raw({ type: 'image/png', limit: '12mb' });

const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many snapshots. Try again later.' },
});

// ── Background TTL cleanup ────────────────────────────────────────────
// Keep snapshots for 1 hour only — server space is tight and these are
// transient debug artifacts. We don't run a separate cron; instead the
// POST handler triggers cleanup opportunistically on each upload.
// Worst case: a quiet period leaves stale rows until the next POST.
const TTL_HOURS = 1;
let _lastCleanupAt = 0;
const CLEANUP_MIN_INTERVAL_MS = 60 * 1000; // at most once per minute

async function maybeCleanup() {
  const now = Date.now();
  if (now - _lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
  _lastCleanupAt = now;
  try {
    const [r] = await pool.execute(
      `DELETE FROM debug_snapshots
       WHERE uploaded_at < (NOW() - INTERVAL ? HOUR)`,
      [TTL_HOURS],
    );
    if (r.affectedRows > 0) {
      console.log(`[debug-snapshot] TTL cleanup: deleted ${r.affectedRows} rows older than ${TTL_HOURS}h`);
    }
  } catch (err) {
    // Cleanup failure must not block uploads — just log.
    console.warn('[debug-snapshot] TTL cleanup failed:', err.message);
  }
}

// ── POST /api/debug-snapshot ───────────────────────────────────────────
router.post('/', uploadLimiter, rawBody, async (req, res) => {
  // Opportunistic TTL purge before each upload (no separate cron).
  maybeCleanup().catch(() => undefined);
  const id = (req.query.id || `snap-${Date.now()}`).toString().slice(0, 64);
  let meta = null;
  if (req.query.meta) {
    try {
      meta = JSON.parse(Buffer.from(req.query.meta, 'base64').toString('utf8'));
    } catch (e) {
      meta = { raw_meta: String(req.query.meta).slice(0, 200), parse_error: e.message };
    }
  }
  const buf = req.body;
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: 'Empty body — expected raw PNG bytes', got: typeof buf, len: buf?.length ?? 0 });
  }
  // Verify PNG magic
  const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) {
    return res.status(400).json({ error: 'Body is not a PNG (magic mismatch)', firstBytes: buf.slice(0, 8).toString('hex') });
  }

  try {
    await pool.execute(
      `INSERT INTO debug_snapshots
       (snapshot_id, image_blob, image_bytes, image_format, meta, device_os, app_version, ar_mode, uploaded_ip)
       VALUES (?, ?, ?, 'png', ?, ?, ?, ?, ?)`,
      [
        id,
        buf,
        buf.length,
        meta ? JSON.stringify(meta) : null,
        req.headers['x-cairn-device-os'] || null,
        req.headers['x-cairn-app-version'] || null,
        req.headers['x-cairn-ar-mode'] || null,
        req.ip,
      ],
    );
    res.json({ id, bytes: buf.length, ok: true });
  } catch (err) {
    console.error('[debug-snapshot] insert failed:', err.message);
    res.status(500).json({ error: 'insert failed', message: err.message });
  }
});

// ── GET /api/debug-snapshot/latest ─────────────────────────────────────
// Convenience: returns the newest snapshot's id + meta + size as JSON.
router.get('/latest', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, snapshot_id, image_bytes, meta, device_os, app_version, ar_mode, uploaded_at
       FROM debug_snapshots ORDER BY uploaded_at DESC LIMIT 1`,
    );
    if (!rows.length) return res.status(404).json({ error: 'no snapshots yet' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'query failed', message: err.message });
  }
});

// ── GET /api/debug-snapshot/:id (binary png) ───────────────────────────
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  // Allow numeric id as well as snapshot_id string
  let row;
  try {
    if (/^\d+$/.test(id)) {
      const [r] = await pool.execute(
        `SELECT image_blob, image_format FROM debug_snapshots WHERE id = ?`, [Number(id)],
      );
      row = r[0];
    } else {
      const [r] = await pool.execute(
        `SELECT image_blob, image_format FROM debug_snapshots WHERE snapshot_id = ?`, [id],
      );
      row = r[0];
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!row) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', `image/${row.image_format || 'png'}`);
  res.setHeader('Content-Length', row.image_blob.length);
  res.end(row.image_blob);
});

module.exports = router;
