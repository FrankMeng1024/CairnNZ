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
      // DB unavailable — fail open (better UX than mass sign-out) but log.
      // eslint-disable-next-line no-console
      console.warn('[authenticate] blacklist check failed, allowing:', err.message);
    }
  }
  req.user = decoded;
  next();
}

module.exports = authenticate;
