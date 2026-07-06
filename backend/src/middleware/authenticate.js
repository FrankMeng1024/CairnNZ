/**
 * Auth middleware — verifies Bearer JWT on protected routes.
 * Attaches decoded user to req.user.
 *
 * Sprint 72 STORY-00550: every 401 sets `X-Cairn-Auth-Invalid: true` header +
 * `code: 'TOKEN_INVALID'` body field so the frontend can distinguish:
 *   - Real token invalid (this middleware said so) → hard logout
 *   - 401 from other sources (rate limit, route bugs, upstream) → soft ignore
 * See apiService.ts iron rule.
 */
const { verifyToken } = require('../config/jwt');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.set('X-Cairn-Auth-Invalid', 'true');
    return res.status(401).json({ message: 'Authentication required.', code: 'TOKEN_INVALID' });
  }
  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    res.set('X-Cairn-Auth-Invalid', 'true');
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expired. Please sign in again.', code: 'TOKEN_INVALID' });
    }
    return res.status(401).json({ message: 'Invalid token.', code: 'TOKEN_INVALID' });
  }
}

module.exports = authenticate;
