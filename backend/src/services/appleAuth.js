/**
 * appleAuth.js — verify Sign in with Apple identity tokens.
 *
 * Apple returns an `identity_token` (JWT signed by their private key) after
 * the user completes Sign in with Apple. To trust it, we must:
 *   1. Fetch Apple's public JWKS from https://appleid.apple.com/auth/keys
 *   2. Find the key matching the token's `kid` header
 *   3. Verify signature (RS256) + issuer + audience (our bundle ID) + expiry
 *
 * The keys rotate rarely — cache in-memory for 24h to avoid a network trip
 * on every login. On cache miss (unknown kid) refetch immediately.
 *
 * This is a small hand-rolled implementation to avoid adding jwks-rsa +
 * verify-apple-id-token as dependencies for a single-purpose module.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cachedKeys = null;   // Map<kid, pemPublicKey>
let cachedAt = 0;

async function fetchAppleKeys(force = false) {
  if (!force && cachedKeys && Date.now() - cachedAt < CACHE_TTL_MS) return cachedKeys;
  // Sprint 6 review M12: rely on global.fetch (Node 18+). Same convention
  // as PushNotification.
  const fetch = global.fetch;
  if (typeof fetch !== 'function') {
    throw new Error('[appleAuth] global.fetch unavailable — Node 18+ required');
  }
  const res = await fetch(APPLE_KEYS_URL);
  if (!res.ok) throw new Error(`Apple JWKS fetch failed: HTTP ${res.status}`);
  const jwks = await res.json();
  const map = new Map();
  for (const key of jwks.keys) {
    if (key.kty !== 'RSA' || key.alg !== 'RS256') continue;
    const pem = jwkToPem(key);
    map.set(key.kid, pem);
  }
  cachedKeys = map;
  cachedAt = Date.now();
  return cachedKeys;
}

// Convert a JWK (n, e in base64url) to a PEM public key using node's KeyObject.
function jwkToPem(jwk) {
  const key = crypto.createPublicKey({
    key: jwk,
    format: 'jwk',
  });
  return key.export({ type: 'spki', format: 'pem' });
}

/**
 * verifyAppleIdentityToken(idToken, expectedAudience)
 *   idToken: JWT string from client after Sign in with Apple
 *   expectedAudience: the app's bundle id (e.g. "nz.cairnapp.mobile")
 *
 * Returns the decoded payload on success. Throws on any validation failure.
 */
async function verifyAppleIdentityToken(idToken, expectedAudience) {
  if (!idToken || typeof idToken !== 'string') throw new Error('missing idToken');
  const decodedHeader = jwt.decode(idToken, { complete: true });
  if (!decodedHeader || !decodedHeader.header) throw new Error('invalid token header');
  const { kid, alg } = decodedHeader.header;
  if (alg !== 'RS256') throw new Error(`unexpected alg=${alg}`);

  let keys = await fetchAppleKeys(false);
  let pem = keys.get(kid);
  if (!pem) {
    // Key not in cache — refetch once in case Apple rotated.
    keys = await fetchAppleKeys(true);
    pem = keys.get(kid);
    if (!pem) throw new Error(`unknown Apple kid=${kid}`);
  }

  return new Promise((resolve, reject) => {
    jwt.verify(idToken, pem, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: expectedAudience,
    }, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
}

module.exports = { verifyAppleIdentityToken, fetchAppleKeys };
