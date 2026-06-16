/**
 * Optional auth middleware — verifies Bearer JWT if present, but does NOT
 * reject when missing. Attaches decoded user to req.user when valid;
 * otherwise leaves req.user undefined.
 *
 * Used by v025 telemetry routes: events emit even before user signs in
 * (e.g. crash during boot, pre-auth AR session). Once signed in, JWT is
 * attached and event rows record the user_id.
 */
const { verifyToken } = require('../config/jwt');

function optionalAuthenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        // No auth header — allow anonymous
        return next();
    }
    const token = header.slice(7);
    try {
        req.user = verifyToken(token);
    } catch (err) {
        // Invalid/expired token — log but don't reject; treat as anonymous.
        // Caller can read req.authError if it cares.
        req.authError = err.name || 'invalid_token';
    }
    next();
}

module.exports = optionalAuthenticate;
