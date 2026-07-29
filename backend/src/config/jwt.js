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
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken, generateJti };
