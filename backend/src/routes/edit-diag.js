/**
 * Edit-diag routes — receive small JSON diagnostic payloads from Cairn
 * app's edit-mode pipeline. Used for fast iteration on real-device
 * issues without requiring screenshots.
 *
 *   POST /api/edit-diag
 *     Headers: Content-Type: application/json
 *     Body:    arbitrary JSON object (max 1MB)
 *     Returns: { id, ok }
 *
 *   GET /api/edit-diag
 *     Returns: list of recent records (id, kind, payload preview)
 *
 *   GET /api/edit-diag/:id
 *     Returns: full payload
 *
 * Storage: edit_diagnostics table (id auto-increment, payload JSON,
 *          uploaded_at TIMESTAMP).
 * Auth: none (dev). Rate-limited 60/5min/IP.
 * TTL: opportunistic cleanup of records older than 24 hours.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');

const router = express.Router();

const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many edit-diag uploads.' },
});

const TTL_HOURS = 24;
let _lastCleanupAt = 0;
const CLEANUP_MIN_INTERVAL_MS = 60 * 1000;

async function maybeCleanup() {
  const now = Date.now();
  if (now - _lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
  _lastCleanupAt = now;
  try {
    await pool.execute(
      `DELETE FROM edit_diagnostics WHERE uploaded_at < (NOW() - INTERVAL ? HOUR)`,
      [TTL_HOURS],
    );
  } catch (_e) {
    // best-effort
  }
}

async function ensureTable() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS edit_diagnostics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        kind VARCHAR(64) NULL,
        payload JSON NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_uploaded_at (uploaded_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) {
    // log but don't crash startup
    console.warn('[edit-diag] CREATE TABLE failed:', e.message);
  }
}
ensureTable();

router.post('/', uploadLimiter, express.json({ limit: '1mb' }), async (req, res) => {
  maybeCleanup().catch(() => undefined);
  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object' });
  }
  const kind = (payload.kind || payload.type || 'edit-diag').toString().slice(0, 64);
  try {
    const [r] = await pool.execute(
      `INSERT INTO edit_diagnostics (kind, payload) VALUES (?, ?)`,
      [kind, JSON.stringify(payload)],
    );
    return res.json({ id: r.insertId, ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'insert failed', message: e.message });
  }
});

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const [rows] = await pool.execute(
      `SELECT id, kind, uploaded_at,
              SUBSTRING(payload, 1, 400) AS payload_preview
       FROM edit_diagnostics
       ORDER BY uploaded_at DESC LIMIT ${Number(limit) | 0}`,
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
  try {
    const [rows] = await pool.execute(
      `SELECT id, kind, payload, uploaded_at FROM edit_diagnostics WHERE id = ?`,
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
