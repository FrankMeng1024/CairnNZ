/**
 * DataExport model — Batch 6.7 GDPR data export.
 *
 * Builds a JSON dump of every table row belonging to a user. Runs async so
 * a slow export (large hike history) doesn't block the request.
 *
 * File layout (~/exports/<uuid>.json):
 *   {
 *     "generatedAt": "2026-07-29T12:00:00Z",
 *     "user": { id, name, email, dateOfBirth, createdAt },
 *     "sessions": [ ... ],
 *     "markers": [ ... ],
 *     "memoryPoints": [ ... ],
 *     "routes": [ ... ],
 *     "friends": [ ... ],
 *     "notifications": [ ... ],
 *     "meta": { rowCounts }
 *   }
 *
 * Download link is emailed rather than attached — avoids the Gmail 25 MB
 * attachment cap for power users with 10k+ hikes / memory points.
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const pool = require('../config/db');

const EXPORT_DIR = process.env.EXPORT_DIR || '/tmp/cairn-exports';
const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;  // 24h download window

async function ensureDir() {
  try {
    await fsp.mkdir(EXPORT_DIR, { recursive: true });
  } catch { /* silent */ }
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Kick off a new export. Returns the row id + download token so the caller
// can email a link immediately. If an in-flight export exists for this user
// (queued or building), returns the existing row.
async function request(userId) {
  const [existing] = await pool.execute(
    `SELECT id, status, download_token, expires_at FROM data_exports
     WHERE user_id = ? AND status IN ('queued', 'building', 'ready') LIMIT 1`,
    [userId],
  );
  if (existing.length > 0) return { existing: true, ...existing[0] };

  const token = generateToken();
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
  const [result] = await pool.execute(
    `INSERT INTO data_exports (user_id, status, download_token, expires_at)
     VALUES (?, 'queued', ?, ?)`,
    [userId, token, expiresAt],
  );
  return { existing: false, id: result.insertId, status: 'queued', download_token: token, expires_at: expiresAt };
}

// Cron / worker loop — build every queued row. In prod this runs every
// few minutes; users may need to wait a bit before their download link
// is live. On error we mark the row failed and record the message.
async function buildPending({ batchSize = 5 } = {}) {
  await ensureDir();
  const safeBatch = Math.max(1, Math.min(Number(batchSize) || 5, 20));
  const [rows] = await pool.execute(
    `SELECT id, user_id, download_token FROM data_exports
     WHERE status = 'queued' ORDER BY id ASC LIMIT ${safeBatch}`,
    [],
  );
  let built = 0, failed = 0;
  for (const row of rows) {
    try {
      await pool.execute(`UPDATE data_exports SET status='building' WHERE id=?`, [row.id]);
      const bundle = await buildBundle(row.user_id);
      const filePath = path.join(EXPORT_DIR, `${row.download_token}.json`);
      const json = JSON.stringify(bundle);
      await fsp.writeFile(filePath, json, 'utf8');
      const size = Buffer.byteLength(json, 'utf8');
      await pool.execute(
        `UPDATE data_exports SET status='ready', file_path=?, size_bytes=?, built_at=CURRENT_TIMESTAMP WHERE id=?`,
        [filePath, size, row.id],
      );
      built += 1;
    } catch (err) {
      await pool.execute(
        `UPDATE data_exports SET status='failed', error_msg=? WHERE id=?`,
        [String(err.message || err).slice(0, 300), row.id],
      );
      failed += 1;
    }
  }
  return { attempted: rows.length, built, failed };
}

async function buildBundle(userId) {
  const bundle = { generatedAt: new Date().toISOString() };
  const [users] = await pool.execute(
    'SELECT id, name, email, date_of_birth, created_at FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  bundle.user = users[0] || null;

  const [sessions] = await pool.execute(
    `SELECT id, type, start_time, end_time, distance_m, duration_s, name,
            route_points, route_points_raw, flags, finalized_at, created_at
     FROM sessions WHERE user_id = ? ORDER BY start_time DESC`,
    [userId],
  );
  bundle.sessions = sessions;

  const [markers] = await pool.execute(
    'SELECT * FROM markers WHERE user_id = ? ORDER BY id DESC',
    [userId],
  );
  bundle.markers = markers;

  const [memory] = await pool.execute(
    'SELECT lat, lng, ts, client_id FROM memory_points WHERE user_id = ? ORDER BY ts DESC',
    [userId],
  );
  bundle.memoryPoints = memory;

  const [routes] = await pool.execute(
    'SELECT id, name, distance_m, permission, created_at FROM routes WHERE user_id = ? ORDER BY id DESC',
    [userId],
  );
  bundle.routes = routes;

  const [friends] = await pool.execute(
    `SELECT f.friend_id AS user_id, u.name, u.email, f.created_at
     FROM friends f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ?`,
    [userId],
  );
  bundle.friends = friends;

  const [notifications] = await pool.execute(
    `SELECT id, kind, related_id, title, body, status, created_at
     FROM notification_log WHERE recipient_user_id = ?
     ORDER BY id DESC LIMIT 500`,
    [userId],
  );
  bundle.notifications = notifications;

  bundle.meta = {
    rowCounts: {
      sessions: sessions.length,
      markers: markers.length,
      memoryPoints: memory.length,
      routes: routes.length,
      friends: friends.length,
      notifications: notifications.length,
    },
  };
  return bundle;
}

async function findByToken(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [rows] = await pool.execute(
    'SELECT * FROM data_exports WHERE download_token = ? LIMIT 1',
    [token],
  );
  return rows[0] || null;
}

async function markSent(id) {
  await pool.execute(
    `UPDATE data_exports SET sent_at = CURRENT_TIMESTAMP WHERE id = ? AND sent_at IS NULL`,
    [id],
  );
}

// Cron sweep — mark expired rows + delete files. Called nightly.
async function purgeExpired() {
  const [expired] = await pool.execute(
    `SELECT id, file_path FROM data_exports
     WHERE (expires_at < NOW() OR (built_at IS NOT NULL AND built_at < DATE_SUB(NOW(), INTERVAL 30 DAY)))
       AND status IN ('ready', 'sent')`,
  );
  let filesDeleted = 0;
  for (const row of expired) {
    if (row.file_path) {
      try {
        await fsp.unlink(row.file_path);
        filesDeleted += 1;
      } catch { /* file already gone */ }
    }
    await pool.execute(`UPDATE data_exports SET status='expired', file_path=NULL WHERE id=?`, [row.id]);
  }
  return { rowsExpired: expired.length, filesDeleted };
}

module.exports = { request, buildPending, findByToken, markSent, purgeExpired, buildBundle };
