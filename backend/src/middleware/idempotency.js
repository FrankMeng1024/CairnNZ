/**
 * Idempotency middleware — v78 #7, v412 扩展。
 *
 * v411 及以前: 只读 req.body.client_op_id
 * v412 起 (backend subagent B2 修): 优先 X-Idempotency-Key header, fallback body.
 * 两者同时存在时严格用 header 忽略 body — header 是明确的请求头, body 可能被
 * 中间件/proxy 改写。
 *
 * Replay 时:
 *   - 老实现: 复制 cached body 原样返回
 *   - v412: cached body 里追加 idempotent_replay: true 让 client 明确知道这是重放
 *
 * **重要约束 (v412 review 视角 A 提)**:
 *   同一 idempotencyKey **必须** 携带完全相同的 payload 才重试。
 *   Client 若用同 key 但改 payload → middleware 返回 old cached body, client 可能
 *   看到与实际 payload 不符的响应。设计上禁止这种行为。
 *   SyncDaemon 严格保证: pendingSyncStore.payload 一旦写入就不改, retry 用相同 key + 相同 payload。
 *
 * Failure modes:
 *   - DB read fails → fall through (handler runs, no caching)
 *   - DB write fails → next retry will execute again (safe because same UUID)
 */
const pool = require('../config/db');
const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * v412: 读取 idempotency key。header 优先, body fallback。
 * 若 header 存在且合法, 完全忽略 body 里的 client_op_id。
 * req.get() 大小写不敏感 (Express 标准)。
 */
function readIdempotencyKey(req) {
  const header = req.get && req.get('X-Idempotency-Key');
  if (header && typeof header === 'string' && UUID_RE.test(header)) {
    return header;
  }
  const bodyKey = req.body && req.body.client_op_id;
  if (bodyKey && typeof bodyKey === 'string' && UUID_RE.test(bodyKey)) {
    return bodyKey;
  }
  return null;
}

async function idempotency(req, res, next) {
  const opId = readIdempotencyKey(req);
  if (!opId) {
    // No op id, or malformed — proceed normally without caching.
    return next();
  }
  const userId = req.user && req.user.userId;
  if (!userId) {
    // Not authenticated — defensive, authenticate runs first normally.
    return next();
  }

  // Sprint 6 R87 BUG-2: idempotency_keys PK is `op_id CHAR(36)` alone
  // (verified via SHOW CREATE TABLE on aliyun). If user A registers
  // op_id=X and user B later uses the same op_id, B's INSERT IGNORE
  // silently drops (PK collision on op_id), and B's read filter
  // `WHERE op_id=? AND user_id=?` never finds a row → B's idempotency
  // protection completely fails. Attacker could sniff/enumerate a
  // victim's op_ids to poison their idempotency layer.
  //
  // App-layer fix without schema migration: derive storage-key by
  // hashing (userId + opId) then formatting as a UUID-shape string
  // that fits CHAR(36). Same (user, op) always maps to the same key,
  // so idempotency semantics preserved for the same user. Different
  // users with same op_id map to different keys → no PK collision.
  // Format is not a real UUID but CHAR(36) is a fixed-width string
  // column so it accepts any 36-char value.
  const hash = crypto.createHash('sha256').update(`${userId}:${opId}`).digest('hex');
  const storageKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;

  // Sprint 6 round-19 R19 known race: two concurrent requests with the
  // same (op_id, user_id) both miss the SELECT below (row not yet
  // inserted), both proceed into the handler, both write via
  // INSERT IGNORE. Only one row wins the cache, but both handlers
  // already executed side effects. In practice the second execution is
  // a no-op at the DB layer because the underlying business tables
  // enforce UNIQUE constraints (memory_points uk_user_cid, sessions
  // finalized_at FOR UPDATE, marker_votes UNIQUE user_id+marker_id) —
  // the second handler simply returns zero-count success instead of
  // replaying the first handler's cached response. Fix would require
  // upfront reservation (INSERT placeholder → SELECT FOR UPDATE loop),
  // deferred pending real-world evidence of retry-storm impact.
  // Look up cached response.
  try {
    const [rows] = await pool.query(
      'SELECT status_code, response_json FROM idempotency_keys WHERE op_id = ? AND user_id = ? LIMIT 1',
      [storageKey, userId],
    );
    if (rows && rows.length > 0) {
      const row = rows[0];
      const cachedBody = row.response_json
        ? (typeof row.response_json === 'string' ? JSON.parse(row.response_json) : row.response_json)
        : {};
      res.set('X-Idempotent-Replay', '1');
      // v412: response body 里也加 idempotent_replay: true, 让 client 明确知道
      // (v411 clients 会忽略这个未知字段, 无害兼容)
      return res.status(row.status_code || 200).json({
        ...cachedBody,
        idempotent_replay: true,
      });
    }
  } catch (err) {
    // Read failure shouldn't block the request.
    // eslint-disable-next-line no-console
    console.warn('[idempotency] read failed', err.message);
  }

  // Hook res.json to persist the response after the handler runs.
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const status = res.statusCode || 200;
    // Only cache successful responses (2xx). 4xx/5xx let client retry fresh.
    if (status >= 200 && status < 300) {
      // O1 (2026-07-26): op_kind 从 req.originalUrl 派生 (完整 path 含
      // sub-router 前缀)。原 req.path.split('/')[2] 在 sub-router 挂载
      // 下拿到 undefined,op_kind 恒为 'unknown',分类维度失效。
      const opKind = (req.originalUrl || req.path || '').split('?')[0].slice(0, 32) || 'unknown';
      pool.query(
        `INSERT IGNORE INTO idempotency_keys (op_id, op_kind, user_id, status_code, response_json)
         VALUES (?, ?, ?, ?, ?)`,
        [storageKey, opKind, userId, status, JSON.stringify(body || {})],
      ).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[idempotency] write failed', err.message);
      });
    }
    return originalJson(body);
  };
  return next();
}

module.exports = idempotency;
