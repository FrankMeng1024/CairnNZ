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

async function createUser(name, email, passwordHash) {
  const [result] = await pool.execute(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [name, email.toLowerCase(), passwordHash]
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

async function upsertPending(email, name, passwordHash) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await pool.execute(
    `INSERT INTO pending_registrations (email, name, password_hash, code, expires_at, attempts)
     VALUES (?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       name          = VALUES(name),
       password_hash = VALUES(password_hash),
       code          = VALUES(code),
       expires_at    = VALUES(expires_at),
       attempts      = 0,
       updated_at    = CURRENT_TIMESTAMP`,
    [email.toLowerCase(), name, passwordHash, code, expiresAt]
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
  // user_oauth
  findOAuth, linkOAuth, getUserProviders,
  // pending
  generateCode, upsertPending, findPending, deletePending, incrementPendingAttempts,
};
