/**
 * PasswordReset model — AUTH-04 forgot password flow.
 *
 * Flow:
 *   1. POST /auth/password-reset/request { email }
 *      -> issue a fresh 6-digit code, email it, return 200 regardless
 *         of whether the email exists (no user enumeration).
 *   2. POST /auth/password-reset/verify { email, code, newPassword }
 *      -> validate code (not expired, not used, attempt count < 5),
 *         hash + set the new password, mark code used, revoke blacklist
 *         of the user's existing JWT if any (best-effort).
 *
 * Codes expire after 15 minutes. Requesting a new code voids older ones
 * for the same email (they stay in the table until cron sweeps them, but
 * the SELECT ORDER BY id DESC LIMIT 1 pattern below ensures only the
 * latest code is honored).
 */
const crypto = require('crypto');
const pool = require('../config/db');

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function issueCode(email) {
  const normalizedEmail = email.toLowerCase();
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  // Insert a new row rather than upsert so the audit trail exists —
  // security incidents often want to see how many resets were requested.
  await pool.execute(
    'INSERT INTO password_reset_codes (email, code, expires_at) VALUES (?, ?, ?)',
    [normalizedEmail, code, expiresAt]
  );
  return code;
}

// Returns the latest valid row for (email, code) or null. "Valid" means
// not-used, not-expired, and under the attempt cap. Increments attempts
// on any lookup (even wrong code) so a brute-force attempt count is real.
async function consumeCode(email, code) {
  const normalizedEmail = email.toLowerCase();
  const [rows] = await pool.execute(
    `SELECT id, expires_at, used_at, attempts
     FROM password_reset_codes
     WHERE email = ?
     ORDER BY id DESC
     LIMIT 1`,
    [normalizedEmail]
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  // Increment attempts every time we look up so brute-force is rate-limited.
  await pool.execute(
    'UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ?',
    [row.id]
  );
  if (row.used_at) return { ok: false, reason: 'used' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' };
  if (row.attempts + 1 > MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  // constant-time compare — bcrypt-style; codes are numeric so timing
  // isn't a huge risk, but do it right.
  const codeBuf = Buffer.from(code || '', 'utf8');
  // Latest row's code is not in the SELECT above (avoid returning it) so
  // fetch just the code column for comparison. Same row id.
  const [codeRows] = await pool.execute(
    'SELECT code FROM password_reset_codes WHERE id = ? LIMIT 1',
    [row.id]
  );
  const storedCode = codeRows[0]?.code || '';
  const storedBuf = Buffer.from(storedCode, 'utf8');
  if (codeBuf.length !== storedBuf.length) return { ok: false, reason: 'mismatch' };
  if (!crypto.timingSafeEqual(codeBuf, storedBuf)) return { ok: false, reason: 'mismatch' };
  // Mark used so replay fails.
  await pool.execute(
    'UPDATE password_reset_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?',
    [row.id]
  );
  return { ok: true };
}

// Cron helper — clean out expired / used codes older than 24h.
async function purgeStale() {
  const [result] = await pool.execute(
    `DELETE FROM password_reset_codes
     WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)
        OR used_at   < DATE_SUB(NOW(), INTERVAL 1 DAY)`
  );
  return result.affectedRows;
}

module.exports = { issueCode, consumeCode, purgeStale };
