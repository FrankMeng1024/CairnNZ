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
 * Auth: POST no auth (rate-limited to 60/5min/IP for dev). GET requires
 *   JWT auth (O1 2026-07-26 security fix — previously open, IDs auto-
 *   increment + enumerable → device screenshots exfil risk).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');

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

// ── Admin gate for GET endpoints ───────────────────────────────────────
// Sprint 6 R95 BUG-1+2 fix: pre-fix, O1 2026-07-26 加了 authenticate 但
// GET /latest 和 GET /:id 查询里都没有 WHERE user_id → 任何登录用户拉
// 到全库最新一张截图 + 通过 id 拉到任意用户的截图 (PII: map view,
// marker text, session metadata)。auth 只挡了匿名,没挡跨用户。
//
// debug_snapshots 表没有 user_id 列 (verified via SHOW COLUMNS on aliyun),
// 加列要 schema 迁移。更干净的修复:GET 端点本来就是 "DEV TOOL ONLY"
// (comment 明确写了),客户端只调 POST 上传,GET 从来只有开发者拿数据用。
// 所以直接用 env whitelist gate:DEBUG_SNAPSHOT_ADMIN_USER_IDS 逗号分隔
// user_id 列表。fail-closed: 未配置 → 403 all GET。POST 保持无 auth
// (兼容当前 debugUpload.ts 上传路径,rate-limited 60/5min/IP)。
function requireDebugAdmin(req, res, next) {
  const raw = process.env.DEBUG_SNAPSHOT_ADMIN_USER_IDS || '';
  const allowedIds = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (allowedIds.length === 0) {
    return res.status(403).json({ error: 'debug-snapshot GET disabled' });
  }
  const userId = String(req.user?.userId || '');
  if (!allowedIds.includes(userId)) {
    return res.status(403).json({ error: 'not authorized for debug-snapshot GET' });
  }
  next();
}

// ── POST /api/debug-snapshot ───────────────────────────────────────────
router.post('/', uploadLimiter, rawBody, async (req, res) => {
  // Opportunistic TTL purge before each upload (no separate cron).
  maybeCleanup().catch(() => undefined);
  const id = (req.query.id || `snap-${Date.now()}`).toString().slice(0, 64);
  let meta = null;
  if (req.query.meta) {
    // Sprint 6 round-27 R27B3: cap meta base64 length before decode.
    // Pre-fix, an attacker could POST with a multi-MB base64 blob → decoded
    // JSON parse (adversarial nested arrays) triggers V8 stack blowup or
    // GC thrash. Since POST /debug-snapshot has no auth (dev endpoint,
    // rate-limited 60/5min/IP), an attacker only needs one bad request to
    // waste a chunk of server CPU. 4KB decoded is more than enough for
    // any legitimate debug meta (device model + app version + a few flags).
    const metaB64 = String(req.query.meta);
    if (metaB64.length > 6000) {
      meta = { parse_error: 'meta base64 exceeds 6000 chars — rejected' };
    } else {
      try {
        const decoded = Buffer.from(metaB64, 'base64').toString('utf8');
        if (decoded.length > 4096) {
          meta = { parse_error: 'meta decoded exceeds 4KB — rejected' };
        } else {
          meta = JSON.parse(decoded);
        }
      } catch (e) {
        meta = { raw_meta: metaB64.slice(0, 200), parse_error: e.message };
      }
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
    // Sprint 6 R64: truncate device_os / app_version headers to match
    // the VARCHAR(16) column width. STRICT_TRANS_TABLES is enabled on
    // aliyun (verified), so an oversized header would ER_DATA_TOO_LONG
    // and 500 the whole snapshot upload. Newer devices may legitimately
    // send "iPadOS 17.5.1 (Sim)" (>16 chars). Truncate server-side
    // rather than reject — a partial header is better than a lost
    // debug snapshot.
    const deviceOs = String(req.headers['x-cairn-device-os'] || '').slice(0, 16) || null;
    const appVersion = String(req.headers['x-cairn-app-version'] || '').slice(0, 16) || null;
    await pool.execute(
      `INSERT INTO debug_snapshots
       (snapshot_id, image_blob, image_bytes, image_format, meta, device_os, app_version, uploaded_ip)
       VALUES (?, ?, ?, 'png', ?, ?, ?, ?)`,
      [
        id,
        buf,
        buf.length,
        meta ? JSON.stringify(meta) : null,
        deviceOs,
        appVersion,
        req.ip,
      ],
    );
    res.json({ id, bytes: buf.length, ok: true });
  } catch (err) {
    // Sprint 6 R54: don't leak err.message. Same rationale as R53 —
    // MySQL error messages reveal schema.
    console.error('[debug-snapshot] insert failed:', err.message);
    res.status(500).json({ error: 'insert failed' });
  }
});

// ── GET /api/debug-snapshot/latest ─────────────────────────────────────
// ⚠️ DEV TOOL ONLY (2026-07-20 phase3 decision "defer 到工具类的 controller")
// O1 (2026-07-26): 加 authenticate JWT gate。原来无 auth,任意匿名可
// 拉最新 snapshot metadata → 用返回的 id 可以枚举 GET /:id binary。
// 现在需要 JWT。
router.get('/latest', authenticate, requireDebugAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, snapshot_id, image_bytes, meta, device_os, app_version, uploaded_at
       FROM debug_snapshots ORDER BY uploaded_at DESC LIMIT 1`,
    );
    if (!rows.length) return res.status(404).json({ error: 'no snapshots yet' });
    res.json(rows[0]);
  } catch (err) {
    // Sprint 6 R54: don't leak err.message. Log server-side, return generic.
    console.error('[debug-snapshot/latest] query failed:', err.message);
    res.status(500).json({ error: 'query failed' });
  }
});

// ── GET /api/debug-snapshot/:id (binary png) ───────────────────────────
// ⚠️ DEV TOOL ONLY (2026-07-20 phase3 decision) — 返回单张截图 binary。
// O1 (2026-07-26): 加 authenticate。原来无 auth + numeric id 可枚举 →
// 任意用户能拉任意用户的设备截图 PII (map view/marker text/session
// metadata)。现在需要 JWT。
router.get('/:id', authenticate, requireDebugAdmin, async (req, res) => {
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
    // Sprint 6 R53: don't leak err.message to client — MySQL error
    // messages can contain schema details (table/column names) or
    // even data snippets on constraint violations. Log server-side,
    // return generic. Same pattern as other 500 handlers in this
    // codebase (see friends.js, markers.js, memory-subs).
    console.error('[debug-snapshot/get]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
  if (!row) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', `image/${row.image_format || 'png'}`);
  res.setHeader('Content-Length', row.image_blob.length);
  res.end(row.image_blob);
});

module.exports = router;
