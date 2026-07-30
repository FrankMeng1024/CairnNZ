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
  // Sprint 6 R89 BUG-4: only cache POSITIVE results. Pre-fix, we cached
  // `false` (not-blacklisted) results too. In a multi-node deploy (pm2
  // cluster, docker replicas, or one node + one cron worker), Node A
  // caches "jti X is not blacklisted (false)" at T=0. User then logs out
  // on Node B → Node B writes to DB + caches `true` locally, but Node A
  // still holds `false` in its local cache. Requests to Node A with
  // token X remain authenticated for up to CACHE_TTL_MS (5 min) —
  // the revoke is effectively bypassed on peer nodes for 5 minutes.
  //
  // Positive-only caching: negatives always hit the DB (cheap — indexed
  // PK lookup, empty result), positives are cached (typical: never
  // blacklisted, so the negative-path DB round-trip is the norm anyway).
  // Correctness restored without needing shared cache (Redis/pub-sub).
  //
  // Comment on line 13-16 pre-R89 claimed "actual invalidation window is
  // bounded by JWT expiry, not cache TTL" — that was wrong for peer
  // nodes. Kept the comment shape but corrected the reasoning.
  if (blacklisted) cachePut(jti, true);
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
// Sprint 6 R77: batch the DELETE. Pre-fix, a mass-logout event could
// leave 100k+ expired blacklist rows. A single unbounded DELETE
// would lock the table (or at least many pages) for seconds, blocking
// concurrent isBlacklisted checks during auth. Batch at 10k rows per
// call keeps each transaction short. Cron re-fires next scheduled run
// to catch residuals (blacklist grows slowly in real life — full
// purge in one run is typical).
async function purgeExpired() {
  const [result] = await pool.execute(
    'DELETE FROM token_blacklist WHERE expires_at < NOW() LIMIT 10000'
  );
  return result.affectedRows;
}

module.exports = { isBlacklisted, revoke, purgeExpired };
