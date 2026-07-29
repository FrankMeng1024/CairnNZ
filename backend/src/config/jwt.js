/**
 * JWT helpers — sign and verify Cairn tokens.
 *
 * O18 AUTH-08: every signed token includes a unique jti (JWT ID). Sign-out
 * inserts the jti into the token_blacklist table so subsequent requests
 * are rejected before their natural expiry.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Sprint 6 round-34 R34B6: refuse to boot with a weak JWT_SECRET.
// Pre-fix, `if (!SECRET)` only rejected empty. A 4-char typo in .env
// (`JWT_SECRET=x`) signed production tokens with a trivially brute-
// forceable HS256 secret. Now: require >= 32 bytes of entropy at boot
// time so weak configs fail loudly instead of silently shipping. This
// is a boot-time check, not a per-call check — no runtime cost.
if (SECRET !== undefined) {
  if (typeof SECRET !== 'string' || SECRET.length < 32) {
    throw new Error(
      '[jwt] JWT_SECRET must be at least 32 characters — refuse to boot. ' +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(64).toString('base64'))\""
    );
  }
}

function generateJti() {
  return crypto.randomBytes(16).toString('hex');
}

function signToken(payload) {
  if (!SECRET) throw new Error('JWT_SECRET is not set');
  // Add a fresh jti to every signed token.
  const jti = generateJti();
  return jwt.sign({ ...payload, jti }, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  if (!SECRET) throw new Error('JWT_SECRET is not set');
  // Sprint 6 round-34 R34B7: pin the accepted algorithm to HS256 so a
  // future upgrade of jsonwebtoken can't accidentally accept a downgrade
  // to a weaker or different algorithm. Cairn signs with HS256; anything
  // else in the header is bogus. jsonwebtoken v9+ already blocks
  // `alg: none`, but an explicit allowlist is standard hardening.
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
}

module.exports = { signToken, verifyToken, generateJti };
