/**
 * User model — Sprint 40 rebuild
 *
 * users: verified users only (password_hash nullable for OAuth-only)
 * user_oauth: provider links (google, apple, github, ...)
 * pending_registrations: temp holding — not real users until code verified
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const pool = require('../config/db');

const ACCOUNT_DELETION_GRACE_MINUTES = 7 * 24 * 60;

const OPTIONAL_OWNED_COLUMNS = [
  ['memory_points', 'user_id'],
  ['debug_events_v2', 'user_id'],
  ['app_logs', 'user_id'],
];

async function deleteOptionalOwnedRows(conn, table, column, userId) {
  const allowed = OPTIONAL_OWNED_COLUMNS.some(([candidateTable, candidateColumn]) => (
    candidateTable === table && candidateColumn === column
  ));
  if (!allowed) throw new Error('unsafe_optional_owned_table');
  const [present] = await conn.execute(
    `SELECT 1 AS present
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [table, column],
  );
  if (present.length > 0) {
    await conn.execute(`DELETE FROM ${table} WHERE ${column} = ?`, [userId]);
  }
}

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

// Schedule deletion and invalidate every issued JWT in the same transaction.
// Repeated requests retain the original deletion timestamp while rotating the
// token version again, so no session can regain authority by racing a retry.
async function scheduleDeletion(userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `UPDATE users
          SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
              token_version = token_version + 1
        WHERE id = ?`,
      [userId]
    );
    if (result.affectedRows !== 1) {
      await conn.rollback();
      return null;
    }
    const [rows] = await conn.execute(
      'SELECT deleted_at FROM users WHERE id = ? FOR UPDATE',
      [userId]
    );
    if (!rows[0]?.deleted_at) {
      throw new Error('Account deletion timestamp was not persisted.');
    }
    await conn.commit();
    return new Date(rows[0].deleted_at);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// O18 AUTH-01: undo a soft-delete. Restore is only valid within grace
// period; the cron sweep hard-deletes anything past 7 days.
// Sprint 6 R86 BUG-1: enforce the grace-period check IN the SQL, not
// just as documentation. Pre-fix, if authSweep hasn't run yet (server
// downtime, missed cron), a user could restore an account 8-10 days
// after soft-delete, silently bypassing the 7-day policy. Now: SQL
// itself refuses the UPDATE if deleted_at is older than 7 days.
// Caller (auth.js /account/restore) already handles affectedRows === 0.
async function restoreDeleted(userId, graceMinutes = ACCOUNT_DELETION_GRACE_MINUTES) {
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
async function findHardDeleteCandidates(graceMinutes = ACCOUNT_DELETION_GRACE_MINUTES) {
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
async function hardDelete(userId, graceMinutes = ACCOUNT_DELETION_GRACE_MINUTES) {
  const conn = await pool.getConnection();
  let exportPaths = [];
  try {
    await conn.beginTransaction();
    // Lock and re-check the grace condition in the same transaction as the
    // purge. A concurrent restore therefore wins cleanly or waits; it can
    // never race between an eligibility SELECT and the final DELETE.
    const [eligible] = await conn.execute(
      `SELECT id, email FROM users
        WHERE id = ?
          AND deleted_at IS NOT NULL
          AND deleted_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
        FOR UPDATE`,
      [userId, graceMinutes],
    );
    if (!eligible[0]) {
      await conn.rollback();
      return false;
    }

    const email = String(eligible[0].email || '').toLowerCase();
    const [exports] = await conn.execute(
      'SELECT file_path FROM data_exports WHERE user_id = ? AND file_path IS NOT NULL',
      [userId],
    );
    exportPaths = exports.map((row) => row.file_path).filter(Boolean);

    // These historical/diagnostic tables either predate FK ownership or are
    // intentionally nullable. Delete explicit account-owned references before
    // the users row; all normal product tables then cascade from users.
    await conn.execute('DELETE FROM unlocked_regions WHERE user_id = ?', [userId]);
    await conn.execute('DELETE FROM idempotency_keys WHERE user_id = ?', [userId]);
    await conn.execute('DELETE FROM abuse_signals WHERE user_id = ?', [userId]);
    for (const [table, column] of OPTIONAL_OWNED_COLUMNS) {
      await deleteOptionalOwnedRows(conn, table, column, userId);
    }
    await conn.execute('DELETE FROM telemetry_sessions WHERE owner_user_id = ?', [userId]);
    // An actor's notification copy can contain their display name in title or
    // body. Delete it instead of relying on actor_user_id SET NULL.
    await conn.execute('DELETE FROM notification_log WHERE actor_user_id = ?', [userId]);
    await conn.execute('DELETE FROM password_reset_email_events WHERE user_id = ?', [userId]);
    if (email) {
      await conn.execute('DELETE FROM password_reset_codes WHERE email = ?', [email]);
      await conn.execute('DELETE FROM pending_registrations WHERE email = ?', [email]);
    }

    // File storage is outside MySQL. A hard deletion is successful only when
    // its export files are already absent; otherwise roll the transaction back
    // and let the sweep retry rather than orphaning personal data on disk.
    await Promise.all(exportPaths.map((filePath) =>
      fs.promises.unlink(filePath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      })
    ));

    const [result] = await conn.execute(
      `DELETE FROM users
        WHERE id = ?
          AND deleted_at IS NOT NULL
          AND deleted_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [userId, graceMinutes],
    );
    if (result.affectedRows !== 1) {
      await conn.rollback();
      return false;
    }
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* preserve original error */ }
    throw error;
  } finally {
    conn.release();
  }

  return true;
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
  setDateOfBirth, scheduleDeletion, restoreDeleted, findHardDeleteCandidates, hardDelete,
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
