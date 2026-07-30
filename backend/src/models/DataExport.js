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
  // Sprint 6 R92 BUG-3: let the DB compute expires_at as UTC seconds
  // from now. Pre-fix, `new Date(Date.now() + EXPORT_TTL_MS)` was sent
  // as a JS Date to mysql2 which reformatted it via the pool's
  // configured timezone (default 'local'). On any host whose local TZ
  // != DB session TZ, the stored DATETIME drifts by that offset — the
  // effective TTL becomes 24h ± offset. The read path (isExpired)
  // already uses UTC_TIMESTAMP(); this makes the write path symmetric.
  const ttlSec = Math.floor(EXPORT_TTL_MS / 1000);
  const [result] = await pool.execute(
    `INSERT INTO data_exports (user_id, status, download_token, expires_at)
     VALUES (?, 'queued', ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
    [userId, token, ttlSec],
  );
  // Return the expected expiresAt as a JS Date for API-response purposes.
  // Small drift vs the DB's actual value (<1s) is fine — clients use this
  // only for display, not for enforcement.
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
  return { existing: false, id: result.insertId, status: 'queued', download_token: token, expires_at: expiresAt };
}

// Cron / worker loop — build every queued row. In prod this runs every
// few minutes; users may need to wait a bit before their download link
// is live. On error we mark the row failed and record the message.
//
// Sprint 6 review C2 fix: two callers (POST /export inline setImmediate +
// cron every 2 min) could race and build the same row twice, wasting DB
// + writing the file twice. The status-transition UPDATE now includes
// `AND status='queued'` and skips the row if a peer already claimed it.
async function buildPending({ batchSize = 5 } = {}) {
  await ensureDir();
  // Sprint 6 round-39 R39B3: reset stale 'building' rows before claiming
  // new queued work. Pre-fix, if a worker crashed mid-buildBundle (SIGKILL,
  // OOM, container restart), its row stayed 'building' forever. request()
  // treats 'building' as in-flight and returns the existing row → user is
  // permanently locked out of new exports because the crash left a
  // zombie row. Reset to 'queued' anything stuck in 'building' for over
  // 15 minutes (a full export takes ~seconds; 15 min is generous headroom).
  await pool.execute(
    `UPDATE data_exports
        SET status='queued'
      WHERE status='building'
        AND requested_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
  );
  const safeBatch = Math.max(1, Math.min(Number(batchSize) || 5, 20));
  const [rows] = await pool.execute(
    `SELECT id, user_id, download_token FROM data_exports
     WHERE status = 'queued' ORDER BY id ASC LIMIT ${safeBatch}`,
    [],
  );
  let built = 0, failed = 0, skipped = 0;
  for (const row of rows) {
    try {
      // Atomic claim: only proceed if we're the first to flip queued→building.
      const [claim] = await pool.execute(
        `UPDATE data_exports SET status='building' WHERE id=? AND status='queued'`,
        [row.id],
      );
      if (claim.affectedRows === 0) {
        // Peer already claimed — skip silently.
        skipped += 1;
        continue;
      }
      const bundle = await buildBundle(row.user_id);
      const filePath = path.join(EXPORT_DIR, `${row.download_token}.json`);
      const json = JSON.stringify(bundle);
      // Atomic write via temp file + rename so a crash mid-write doesn't
      // leave a truncated bundle.
      const tmpPath = filePath + '.tmp';
      await fsp.writeFile(tmpPath, json, 'utf8');
      await fsp.rename(tmpPath, filePath);
      const size = Buffer.byteLength(json, 'utf8');
      try {
        await pool.execute(
          `UPDATE data_exports SET status='ready', file_path=?, size_bytes=?, built_at=CURRENT_TIMESTAMP WHERE id=?`,
          [filePath, size, row.id],
        );
      } catch (updateErr) {
        // Sprint 6 round-39 R39B1: if the status='ready' UPDATE fails
        // after the file has already landed on disk, we'd have an
        // orphan file with no DB reference. Rethrow so the outer catch
        // unlinks the file before marking the row 'failed'.
        throw updateErr;
      }
      built += 1;
    } catch (err) {
      // Sprint 6 round-39 R39B1: clean up any partial file on failure
      // so /export/... download attempts don't find a stale unlinked
      // file, and purgeExpired (which only touches ready/sent rows)
      // never needs to worry about failed-row disk leaks.
      try {
        const filePath = path.join(EXPORT_DIR, `${row.download_token}.json`);
        await fsp.unlink(filePath).catch(() => { /* silent — file may never have landed */ });
        await fsp.unlink(filePath + '.tmp').catch(() => { /* silent — tmp may not exist */ });
      } catch { /* silent */ }
      await pool.execute(
        `UPDATE data_exports SET status='failed', error_msg=? WHERE id=?`,
        [String(err.message || err).slice(0, 300), row.id],
      );
      failed += 1;
    }
  }
  return { attempted: rows.length, built, failed, skipped };
}

async function buildBundle(userId) {
  const bundle = { generatedAt: new Date().toISOString() };
  const [users] = await pool.execute(
    'SELECT id, name, email, date_of_birth, created_at FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  bundle.user = users[0] || null;

  // Sprint 6 round-15 R15B4: hard row caps on every table to prevent OOM
  // + JSON.stringify time-bomb on power users (sim-walker abuse can grow
  // memory_points to 500k+; a heavy user could have 10k+ markers). Caps
  // chosen to be well beyond any legitimate user's data while keeping
  // total bundle < ~50 MB. If a user hits a cap, the bundle notes it in
  // meta.truncated so the operator can offer a manual full dump on request.
  //
  // Sprint 6 round-16 R16F6: fetch `LIMIT CAP+1` so we can distinguish
  // "hit exactly CAP legit rows" from "server truncated". Discard the
  // extra row before serializing.
  const CAP_SESSIONS = 20000;
  const CAP_MARKERS  = 50000;
  const CAP_MEMORY   = 200000;
  const CAP_ROUTES   = 5000;
  const CAP_FRIENDS  = 5000;

  // Sprint 6 round-15 R15B5 + round-16 R16F5: `sessions` table was
  // deprecated in O1 (2026-07-26). Swallow ER_NO_SUCH_TABLE only —
  // the earlier `/doesn't exist/i` fallback also matched "column X
  // doesn't exist" / "database doesn't exist", which would silently
  // return empty data on a real schema regression (GDPR Article 15
  // violation: incomplete export served as complete).
  let sessions = [];
  try {
    const [rows] = await pool.execute(
      `SELECT id, type, start_time, end_time, distance_m, duration_s, name,
              route_points, route_points_raw, flags, finalized_at, created_at
       FROM sessions WHERE user_id = ? ORDER BY start_time DESC LIMIT ${CAP_SESSIONS + 1}`,
      [userId],
    );
    sessions = rows;
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
      sessions = []; // table gone post-O1 — expected, silent OK
    } else {
      throw err; // any other error (column dropped, permission, etc.) must fail loud
    }
  }
  bundle.sessions = sessions;

  // Sprint 6 round-13 R13B1 fix: whitelist marker columns. Pre-fix,
  // SELECT * pulled in report_count, helpful_count, status, hidden_at
  // (moderator-only fields) and any voice_memo internal reference —
  // fields the user never intended to be part of their own data export.
  const [markers] = await pool.execute(
    `SELECT id, type, text, lat, lng, alt, permission, approximate,
            voice_memo_url, voice_memo_duration_ms, created_at, updated_at
     FROM markers WHERE user_id = ? ORDER BY id DESC LIMIT ${CAP_MARKERS + 1}`,
    [userId],
  );
  bundle.markers = markers;

  const [memory] = await pool.execute(
    `SELECT lat, lng, ts, client_id FROM memory_points WHERE user_id = ? ORDER BY ts DESC LIMIT ${CAP_MEMORY + 1}`,
    [userId],
  );
  bundle.memoryPoints = memory;

  const [routes] = await pool.execute(
    `SELECT id, name, distance_m, permission, created_at FROM routes WHERE user_id = ? ORDER BY id DESC LIMIT ${CAP_ROUTES + 1}`,
    [userId],
  );
  bundle.routes = routes;

  // Sprint 6 round-13 R13B1 fix: drop friends' emails. A friend never
  // consented to have their email leave the system inside another
  // user's downloadable bundle. Keep user_id + display name only.
  const [friends] = await pool.execute(
    `SELECT f.friend_id AS user_id, u.name, f.created_at
     FROM friends f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? LIMIT ${CAP_FRIENDS + 1}`,
    [userId],
  );
  bundle.friends = friends;

  // Sprint 6 round-14 R14B5 fix: drop notification body + related_id
  // from the export. Body strings ("Alice wants to be your friend")
  // contain OTHER users' names — GDPR-exportable data must be about
  // the exporting user only, not references derived from others.
  // Keep timestamp + kind + status for audit-trail proof.
  const [notifications] = await pool.execute(
    `SELECT id, kind, status, created_at
     FROM notification_log WHERE recipient_user_id = ?
     ORDER BY id DESC LIMIT 500`,
    [userId],
  );
  bundle.notifications = notifications;

  bundle.meta = {
    rowCounts: {
      sessions: Math.min(sessions.length, CAP_SESSIONS),
      markers: Math.min(markers.length, CAP_MARKERS),
      memoryPoints: Math.min(memory.length, CAP_MEMORY),
      routes: Math.min(routes.length, CAP_ROUTES),
      friends: Math.min(friends.length, CAP_FRIENDS),
      notifications: notifications.length,
    },
    // Sprint 6 R15B4 + R16F6: caller-visible signal that the cap was
    // reached. We fetched LIMIT CAP+1, so `> CAP` = server truncated,
    // `== CAP` = user happens to have exactly CAP rows (rare, but real
    // — a community account with exactly 5000 friends should not see
    // `truncated: true` on a complete export).
    truncated: {
      sessions:     sessions.length     > CAP_SESSIONS,
      markers:      markers.length      > CAP_MARKERS,
      memoryPoints: memory.length       > CAP_MEMORY,
      routes:       routes.length       > CAP_ROUTES,
      friends:      friends.length      > CAP_FRIENDS,
    },
  };
  // Sprint 6 R16F6: drop the CAP+1 sentinel row before serializing so
  // the bundle contents match rowCounts.
  if (bundle.meta.truncated.sessions)     bundle.sessions     = bundle.sessions.slice(0, CAP_SESSIONS);
  if (bundle.meta.truncated.markers)      bundle.markers      = bundle.markers.slice(0, CAP_MARKERS);
  if (bundle.meta.truncated.memoryPoints) bundle.memoryPoints = bundle.memoryPoints.slice(0, CAP_MEMORY);
  if (bundle.meta.truncated.routes)       bundle.routes       = bundle.routes.slice(0, CAP_ROUTES);
  if (bundle.meta.truncated.friends)      bundle.friends      = bundle.friends.slice(0, CAP_FRIENDS);
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

// Sprint 6 R92 BUG-3: TZ-safe expiry check. Delegates the clock to the
// DB (`UTC_TIMESTAMP()` vs stored DATETIME) so Node<->MySQL TZ mismatch
// cannot silently shift the effective expiry. Callers get a boolean
// derived from a single WHERE that either matches (still-valid, no
// row returned by the "expired" query) or does not (expired, row
// exists in the check).
async function isExpired(id) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM data_exports
      WHERE id = ? AND expires_at IS NOT NULL AND expires_at < UTC_TIMESTAMP()
      LIMIT 1`,
    [id],
  );
  return rows.length > 0;
}

// Cron sweep — mark expired rows + delete files. Called nightly.
// Sprint 6 R81: batch. Under normal load a few rows per night; if
// ever 10k+ (mass account expiry), the loop would take seconds per
// unlink. Cap at 500 per run — cron re-fires nightly for the tail.
async function purgeExpired() {
  const [expired] = await pool.execute(
    `SELECT id, file_path FROM data_exports
     WHERE (expires_at < NOW() OR (built_at IS NOT NULL AND built_at < DATE_SUB(NOW(), INTERVAL 30 DAY)))
       AND status IN ('ready', 'sent')
     LIMIT 500`,
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

module.exports = { request, buildPending, findByToken, markSent, purgeExpired, buildBundle, isExpired };
