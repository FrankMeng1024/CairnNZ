/**
 * User model — Sprint 40 rebuild
 *
 * users: verified users only (password_hash nullable for OAuth-only)
 * user_oauth: provider links (google, apple, github, ...)
 * pending_registrations: temp holding — not real users until code verified
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');

// O18 AUTH-06: normalize Joi.isoDate() input (which accepts full ISO datetime
// like '1995-01-01T00:00:00.000Z') down to the 'YYYY-MM-DD' string MySQL's
// DATE column expects. Any invalid or empty input becomes null so callers
// can INSERT NULL for OAuth / legacy paths.
function normalizeDob(input) {
  if (input == null || input === '') return null;
  // Date object (e.g. read from a DATE column via mysql2 driver) — format as UTC YYYY-MM-DD.
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }
  const s = String(input);
  // Fast path — already a bare date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Full ISO — take the date part before 'T'.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ── users ──────────────────────────────────────────────────────────────────

async function findByEmail(email) {
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE email = ? LIMIT 1',
    [email.toLowerCase()]
  );
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function createUser(name, email, passwordHash, dateOfBirth) {
  // O18 AUTH-06: dateOfBirth accepted as ISO 'YYYY-MM-DD' string. Nullable
  // for OAuth-only paths / legacy users; required by the register endpoint
  // via schema validation.
  const [result] = await pool.execute(
    'INSERT INTO users (name, email, password_hash, date_of_birth) VALUES (?, ?, ?, ?)',
    [name, email.toLowerCase(), passwordHash, normalizeDob(dateOfBirth)]
  );
  return result.insertId;
}

async function createOAuthUser(name, email) {
  const [result] = await pool.execute(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, NULL)',
    [name, email.toLowerCase()]
  );
  return result.insertId;
}

async function setPassword(userId, passwordHash) {
  await pool.execute(
    'UPDATE users SET password_hash = ? WHERE id = ?',
    [passwordHash, userId]
  );
}

// O18 AUTH-06: legacy users can fill in their DOB later.
async function setDateOfBirth(userId, dateOfBirth) {
  await pool.execute(
    'UPDATE users SET date_of_birth = ? WHERE id = ?',
    [normalizeDob(dateOfBirth), userId]
  );
}

// R100 SETTINGS: update display name. Called by PATCH /api/auth/me.
// Trim before write — route handler already trims, but belt-and-braces
// so any future caller cannot accidentally store leading/trailing ws.
async function updateName(userId, name) {
  await pool.execute(
    'UPDATE users SET name = ? WHERE id = ?',
    [String(name).trim(), userId]
  );
}

// R114/O22 STORY-73006 (H2): mark onboarding done. Column
// `onboarding_done_at TIMESTAMP NULL` — see migration below the file.
async function setOnboardingDone(userId, at) {
  await pool.execute(
    'UPDATE users SET onboarding_done_at = ? WHERE id = ?',
    [at, userId]
  );
}

// O18 AUTH-01: schedule the account for hard-delete via the cron sweep.
// Idempotent — a second call within grace period keeps the original
// deleted_at (cron uses the earliest timestamp).
async function softDelete(userId) {
  await pool.execute(
    'UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
    [userId]
  );
}

// O18 AUTH-01: undo a soft-delete. Restore is only valid within grace
// period; the cron sweep hard-deletes anything past 7 days.
// Sprint 6 R86 BUG-1: enforce the grace-period check IN the SQL, not
// just as documentation. Pre-fix, if authSweep hasn't run yet (server
// downtime, missed cron), a user could restore an account 8-10 days
// after soft-delete, silently bypassing the 7-day policy. Now: SQL
// itself refuses the UPDATE if deleted_at is older than 7 days.
// Caller (auth.js /account/restore) already handles affectedRows === 0.
// AUTH-2 (2026-08-11) TEST-MODE: gate switched from `INTERVAL 7 DAY`
// to `INTERVAL ? MINUTE` (parameterized) to match the cooling-off period
// controlled by a single call-site constant (auth.js RESTORE_GRACE_MS).
// Caller (auth.js /account/restore) passes graceMinutes derived from
// RESTORE_GRACE_MS. Consolidating the 5-min literal into one place per
// 4-eyes review — LAUNCH_GATE is now a single revert.
// TODO: LAUNCH_GATE — revert to `INTERVAL ? DAY` + graceDays default = 7
// before app store launch (or keep MINUTE and pass 10080 = 7*24*60).
async function restoreDeleted(userId, graceMinutes = 5) {
  const [result] = await pool.execute(
    `UPDATE users SET deleted_at = NULL
      WHERE id = ?
        AND deleted_at IS NOT NULL
        AND deleted_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [userId, graceMinutes]
  );
  return result.affectedRows > 0;
}

// Sprint 6 round-9 R9B8 fix: bump token_version to invalidate ALL
// outstanding JWTs for this user (any device with a pre-bump token).
// Called from /account/restore so a compromised-account restore doesn't
// leave silently-still-valid sessions on 5 other devices.
async function bumpTokenVersion(userId) {
  await pool.execute(
    'UPDATE users SET token_version = token_version + 1 WHERE id = ?',
    [userId]
  );
}

// O18 AUTH-01: cron helper — returns user rows whose grace period has expired.
// Sprint 6 R76: hard-cap query at 1000 rows. cron/authSweep.sweepHardDeletes
// already trims to MAX_HARD_DELETES_PER_RUN=500 via slice, but that's a
// JS-side slice after the full result set arrives. If ever 100k users
// are pending-delete simultaneously (mass event / migration), the DB
// returns 100k rows and Node holds them all briefly before slicing.
// Query-side LIMIT bounds memory usage upstream.
// AUTH-2 (2026-08-11) TEST-MODE: findHardDeleteCandidates + hardDelete
// use MINUTES not DAYS during the 5-minute cooling-off test window.
// TODO: LAUNCH_GATE — revert to `INTERVAL ? DAY` + `INTERVAL 7 DAY` before app store launch.
async function findHardDeleteCandidates(graceMinutes = 5) {
  const [rows] = await pool.execute(
    'SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL ? MINUTE) LIMIT 1000',
    [graceMinutes]
  );
  return rows.map(r => r.id);
}

// O18 AUTH-01: hard delete (cascades to sessions / oauth via FK). Called by
// the cron sweep, not directly by API.
// Sprint 6 R86 BUG-3: race with concurrent /account/restore. Pre-fix,
// authSweep did SELECT ids → then per-id `DELETE FROM users WHERE id=?`
// without re-checking deleted_at. If /restore commits between the two
// steps (rare but possible during boot-catchup + user manual retry),
// the row's deleted_at is now NULL, hardDelete blindly kills the row
// anyway. Now: gate the DELETE on the grace window — if the row was
// restored inside the window, DELETE finds nothing (correct).
// AUTH-2 (2026-08-11) TEST-MODE: gate switched from `INTERVAL 7 DAY`
// to `INTERVAL ? MINUTE` (parameterized) — cron passes graceMinutes.
// TODO: LAUNCH_GATE — revert to `INTERVAL ? DAY` + pass graceDays=7
// before app store launch (or keep MINUTE and pass 10080).
async function hardDelete(userId, graceMinutes = 5) {
  const [result] = await pool.execute(
    'DELETE FROM users WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)',
    [userId, graceMinutes]
  );
  return result.affectedRows > 0;
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function toPublic(user) {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    hasPassword: !!user.password_hash,
    // O18 HOME-05: expose registration timestamp so Profile can show
    // "You have been with Cairn for X days" without a separate endpoint.
    createdAt: user.created_at ? new Date(user.created_at).toISOString() : null,
    // O18 AUTH-06: expose DOB so the client can gate the补录 modal — if
    // this is null the user must fill it in within 30 days of first login
    // after the deploy.
    dateOfBirth: user.date_of_birth ? new Date(user.date_of_birth).toISOString().slice(0, 10) : null,
    // O18 AUTH-01: expose soft-delete state so the client can show the
    // "Restore account?" modal on login when the row is pending deletion.
    deletedAt: user.deleted_at ? new Date(user.deleted_at).toISOString() : null,
    // R114/O22 STORY-73006 (H2): expose onboarding completion timestamp
    // so the client can gate the intro flow on server state, not just on
    // per-device AsyncStorage. null = user has never finished onboarding
    // on any device.
    onboardingDoneAt: user.onboarding_done_at ? new Date(user.onboarding_done_at).toISOString() : null,
  };
}

// ── user_oauth ─────────────────────────────────────────────────────────────

async function findOAuth(provider, providerId) {
  const [rows] = await pool.execute(
    'SELECT * FROM user_oauth WHERE provider = ? AND provider_id = ? LIMIT 1',
    [provider, String(providerId)]
  );
  return rows[0] || null;
}

async function linkOAuth(userId, provider, providerId) {
  await pool.execute(
    `INSERT INTO user_oauth (user_id, provider, provider_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE provider_id = VALUES(provider_id)`,
    [userId, provider, String(providerId)]
  );
}

async function getUserProviders(userId) {
  const [rows] = await pool.execute(
    'SELECT provider FROM user_oauth WHERE user_id = ?',
    [userId]
  );
  return rows.map(r => r.provider);
}

// ── pending_registrations ──────────────────────────────────────────────────

function generateCode() {
  // O1 (2026-07-26) security fix: 用 crypto.randomInt (CSPRNG) 替代
  // Math.random (xorshift128+, 可从 3-5 个观测值反推状态)。email 验证
  // 码只有 6 位空间 (10^6),PRNG 可预测 = 攻击者用自己的注册请求观测
  // 数个码后能预测受害者的下一个码 → 10 分钟 TTL 内 5 次输入尝试足够
  // 命中 → 账号劫持。
  return String(crypto.randomInt(100000, 1000000));
}

async function upsertPending(email, name, passwordHash, dateOfBirth) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await pool.execute(
    `INSERT INTO pending_registrations (email, name, password_hash, date_of_birth, code, expires_at, attempts)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       name           = VALUES(name),
       password_hash  = VALUES(password_hash),
       date_of_birth  = VALUES(date_of_birth),
       code           = VALUES(code),
       expires_at     = VALUES(expires_at),
       attempts       = 0,
       updated_at     = CURRENT_TIMESTAMP`,
    [email.toLowerCase(), name, passwordHash, normalizeDob(dateOfBirth), code, expiresAt]
  );
  return code;
}

async function findPending(email) {
  const [rows] = await pool.execute(
    'SELECT * FROM pending_registrations WHERE email = ? LIMIT 1',
    [email.toLowerCase()]
  );
  return rows[0] || null;
}

async function deletePending(email) {
  await pool.execute(
    'DELETE FROM pending_registrations WHERE email = ?',
    [email.toLowerCase()]
  );
}

async function incrementPendingAttempts(email) {
  await pool.execute(
    'UPDATE pending_registrations SET attempts = attempts + 1 WHERE email = ?',
    [email.toLowerCase()]
  );
}

module.exports = {
  // users
  findByEmail, findById, createUser, createOAuthUser, setPassword,
  hashPassword, comparePassword, toPublic,
  // O18 batch 6.3
  setDateOfBirth, softDelete, restoreDeleted, findHardDeleteCandidates, hardDelete,
  bumpTokenVersion,
  // R114/O22 STORY-73006 (H2)
  setOnboardingDone,
  // R100 SETTINGS
  updateName,
  // user_oauth
  findOAuth, linkOAuth, getUserProviders,
  // pending
  generateCode, upsertPending, findPending, deletePending, incrementPendingAttempts,
};
