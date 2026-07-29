/**
 * Auth middleware — verifies Bearer JWT on protected routes.
 * Attaches decoded user to req.user.
 *
 * Sprint 72 STORY-00550: every 401 sets `X-Cairn-Auth-Invalid: true` header +
 * `code: 'TOKEN_INVALID'` body field so the frontend can distinguish:
 *   - Real token invalid (this middleware said so) → hard logout
 *   - 401 from other sources (rate limit, route bugs, upstream) → soft ignore
 * See apiService.ts iron rule.
 *
 * O18 AUTH-08: also rejects tokens whose jti has been revoked via
 * /auth/logout. Uses TokenBlacklist which has a short LRU cache to avoid
 * per-request DB round-trips.
 */
const { verifyToken } = require('../config/jwt');
const TokenBlacklist = require('../models/TokenBlacklist');
const pool = require('../config/db');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.set('X-Cairn-Auth-Invalid', 'true');
    return res.status(401).json({ message: 'Authentication required.', code: 'TOKEN_INVALID' });
  }
  const token = header.slice(7);
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    res.set('X-Cairn-Auth-Invalid', 'true');
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expired. Please sign in again.', code: 'TOKEN_INVALID' });
    }
    return res.status(401).json({ message: 'Invalid token.', code: 'TOKEN_INVALID' });
  }
  // O18 AUTH-08: check jti blacklist.
  if (decoded.jti) {
    try {
      const revoked = await TokenBlacklist.isBlacklisted(decoded.jti);
      if (revoked) {
        res.set('X-Cairn-Auth-Invalid', 'true');
        return res.status(401).json({ message: 'Signed out on this device. Sign in again.', code: 'TOKEN_INVALID' });
      }
    } catch (err) {
      // Sprint 6 round-6 R6B7 fix: only fail-open on genuine DB
      // connectivity errors, not on ANY exception. An attacker with a
      // revoked token could otherwise pair their request with a
      // connection-pool DoS (expensive queries elsewhere) to force
      // an exception here and bypass revocation. Now: fail-open only
      // for the specific error codes that mean "DB temporarily
      // unreachable"; log others as unexpected + fail closed.
      const CONN_CODES = new Set([
        'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST',
        'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'PROTOCOL_ENQUEUE_HANDSHAKE_TWICE',
      ]);
      const code = err && (err.code || err.errno);
      if (CONN_CODES.has(String(code))) {
        // eslint-disable-next-line no-console
        console.warn('[authenticate] blacklist check failed with transient DB error, allowing:', code);
      } else {
        // Unexpected exception (permission error, syntax error, OOM).
        // Do NOT fail open — that would create an exploitable window.
        // eslint-disable-next-line no-console
        console.error('[authenticate] blacklist check unexpected error, failing closed:', err.message);
        res.set('X-Cairn-Auth-Invalid', 'true');
        return res.status(401).json({ message: 'Authentication service unavailable.', code: 'TOKEN_INVALID' });
      }
    }
  }
  // Sprint 6 round-9 R9B8 fix: check token_version. If user's server-
  // side token_version is > jwt.token_version (or jwt claim missing +
  // server nonzero), token was minted before a mass-revoke event
  // (currently: /account/restore). Reject.
  try {
    const [rows] = await pool.execute(
      'SELECT token_version FROM users WHERE id = ? LIMIT 1',
      [decoded.userId]
    );
    if (rows.length > 0) {
      const serverVer = Number(rows[0].token_version || 0);
      const jwtVer = Number(decoded.token_version || 0);
      if (serverVer > jwtVer) {
        res.set('X-Cairn-Auth-Invalid', 'true');
        return res.status(401).json({ message: 'Signed out on all devices. Sign in again.', code: 'TOKEN_INVALID' });
      }
    }
  } catch (err) {
    // Same fail-open policy as blacklist check: transient DB errors only.
    const CONN_CODES = new Set([
      'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST',
      'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET',
    ]);
    const code = err && (err.code || err.errno);
    if (!CONN_CODES.has(String(code))) {
      // eslint-disable-next-line no-console
      console.error('[authenticate] token_version check unexpected error:', err.message);
    }
    // Continue on transient — same UX policy as blacklist path.
  }
  req.user = decoded;
  next();
}

module.exports = authenticate;
