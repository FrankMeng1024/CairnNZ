/**
 * Idempotency middleware — v78 #7.
 *
 * If the request body has `client_op_id` (UUID v4), check the
 * idempotency_keys table. If we've already processed this op for this
 * user, return the cached response. Otherwise, attach a captureSuccess
 * hook to res that stores the response after the route handler runs.
 *
 * Routes that opt in: just include this middleware before their handler.
 * Routes that don't care (GET, profile reads): omit and behave normally.
 *
 * Failure modes:
 *   - DB read fails → fall through (handler runs, no caching)
 *   - DB write of response fails → next retry will execute again (safe
 *     because of the same UUID — at worst we get a server-side dup,
 *     but the client's retry will be returned the same response anyway)
 */
const pool = require('../config/db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function idempotency(req, res, next) {
  const opId = req.body && req.body.client_op_id;
  if (!opId || typeof opId !== 'string' || !UUID_RE.test(opId)) {
    // No op id, or malformed — proceed normally without caching.
    return next();
  }
  const userId = req.user && (req.user.userId || req.user.id);
  if (!userId) {
    // Not authenticated — should be unreachable (authenticate runs first),
    // but be defensive.
    return next();
  }

  // Look up cached response.
  try {
    const [rows] = await pool.query(
      'SELECT status_code, response_json FROM idempotency_keys WHERE op_id = ? AND user_id = ? LIMIT 1',
      [opId, userId],
    );
    if (rows && rows.length > 0) {
      const row = rows[0];
      const cachedBody = row.response_json
        ? (typeof row.response_json === 'string' ? JSON.parse(row.response_json) : row.response_json)
        : {};
      res.set('X-Idempotent-Replay', '1');
      return res.status(row.status_code || 200).json(cachedBody);
    }
  } catch (err) {
    // Read failure shouldn't block the request — fall through and let
    // the handler run as if there was no idempotency layer.
    // eslint-disable-next-line no-console
    console.warn('[idempotency] read failed', err.message);
  }

  // Hook res.json to persist the response after the handler runs.
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    // Persist asynchronously; don't block the response.
    const status = res.statusCode || 200;
    // Only cache successful responses (2xx). 4xx might be transient
    // input issues — let the client retry with corrected data and get
    // a fresh server eval.
    if (status >= 200 && status < 300) {
      pool.query(
        `INSERT IGNORE INTO idempotency_keys (op_id, op_kind, user_id, status_code, response_json)
         VALUES (?, ?, ?, ?, ?)`,
        [opId, req.path.split('/')[2] || 'unknown', userId, status, JSON.stringify(body || {})],
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
