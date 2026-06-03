/**
 * Auth middleware — verifies Bearer JWT on protected routes.
 * Attaches decoded user to req.user.
 */
const { verifyToken } = require('../config/jwt');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expired. Please sign in again.' });
    }
    return res.status(401).json({ message: 'Invalid token.' });
  }
}

module.exports = authenticate;
