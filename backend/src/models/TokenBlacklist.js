/**
 * TokenBlacklist model — AUTH-08 logout revoke.
 *
 * Every JWT carries a jti (JWT ID) claim. Sign-out inserts a row here
 * with the token's natural expiry. Auth middleware checks the LRU cache
 * first, misses fall through to a DB read, and if the row exists the
 * token is treated as invalid.
 *
 * Cron sweeps expired rows once an hour to keep the table lean.
 */
const pool = require('../config/db');

// 5-minute LRU cache. Blacklist changes are rare (logout events),
// so cache miss on stale entries is acceptable — the actual invalidation
// window is bounded by JWT expiry, not by cache TTL. Cache purpose is
// throughput, not correctness.
const CACHE_MAX = 5000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // jti -> { blacklisted: boolean; ts: number }

function cachePut(jti, blacklisted) {
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest entry — Map preserves insertion order.
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(jti, { blacklisted, ts: Date.now() });
}

function cacheGet(jti) {
  const entry = cache.get(jti);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(jti);
    return null;
  }
  return entry.blacklisted;
}

async function isBlacklisted(jti) {
  if (!jti) return false;
  const cached = cacheGet(jti);
  if (cached !== null) return cached;
  const [rows] = await pool.execute(
    'SELECT 1 FROM token_blacklist WHERE jti = ? LIMIT 1',
    [jti]
  );
  const blacklisted = rows.length > 0;
  cachePut(jti, blacklisted);
  return blacklisted;
}

async function revoke(jti, userId, expiresAt) {
  if (!jti || !expiresAt) return;
  await pool.execute(
    `INSERT INTO token_blacklist (jti, user_id, expires_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
    [jti, userId, new Date(expiresAt)]
  );
  cachePut(jti, true);
}

// Cron helper — remove expired entries so the table stays small.
async function purgeExpired() {
  const [result] = await pool.execute(
    'DELETE FROM token_blacklist WHERE expires_at < NOW()'
  );
  return result.affectedRows;
}

module.exports = { isBlacklisted, revoke, purgeExpired };
