/**
 * JWT helpers — sign and verify Cairn tokens.
 */
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload) {
  if (!SECRET) throw new Error('JWT_SECRET is not set');
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  if (!SECRET) throw new Error('JWT_SECRET is not set');
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
