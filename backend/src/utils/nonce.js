/**
 * Short-lived HMAC nonce for the like/report endpoint (V2.C6).
 *
 * The aim-detection sheet calls GET /api/markers/:id/interact-nonce, gets
 * a nonce string, and includes it in the subsequent POST /vote body.
 * Server validates the nonce HMAC matches and the timestamp is within
 * NONCE_TTL_MS. Each nonce is bound to (userId, markerId, ts) so it
 * cannot be replayed against a different marker or user.
 *
 * Secret: process.env.NONCE_SECRET. If unset, falls back to JWT_SECRET so
 * deployment doesn't break before the env is added.
 */
const crypto = require('crypto');

const NONCE_TTL_MS = 60 * 1000; // 60s

function getSecret() {
  return process.env.NONCE_SECRET || process.env.JWT_SECRET || 'cairn-dev-nonce-secret-do-not-ship';
}

function sign(userId, markerId, ts) {
  const h = crypto.createHmac('sha256', getSecret());
  h.update(`${userId}:${markerId}:${ts}`);
  return h.digest('base64url');
}

/**
 * Issue a fresh nonce. Returns { nonce, expires_at }.
 * The nonce string itself is `${ts}.${signature}` so verify can extract
 * ts without needing to look up server-side state (stateless).
 */
function issue(userId, markerId) {
  const ts = Date.now();
  const sig = sign(userId, markerId, ts);
  return {
    nonce: `${ts}.${sig}`,
    expires_at: ts + NONCE_TTL_MS,
  };
}

/**
 * Verify a nonce. Returns { valid: bool, reason?: string }.
 * reason ∈ 'malformed' | 'expired' | 'mismatch'
 */
function verify(nonce, userId, markerId) {
  if (typeof nonce !== 'string' || !nonce.includes('.')) {
    return { valid: false, reason: 'malformed' };
  }
  const dot = nonce.indexOf('.');
  const tsStr = nonce.slice(0, dot);
  const sig = nonce.slice(dot + 1);
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'malformed' };
  if (Date.now() - ts > NONCE_TTL_MS) return { valid: false, reason: 'expired' };
  if (Date.now() - ts < -5_000) return { valid: false, reason: 'expired' }; // 5s clock skew tolerance
  const expected = sign(userId, markerId, ts);
  // Constant-time compare to prevent timing attacks
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { valid: false, reason: 'mismatch' };
  if (!crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'mismatch' };
  return { valid: true };
}

module.exports = { issue, verify, NONCE_TTL_MS };
