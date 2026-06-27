#!/usr/bin/env node
/**
 * gen_bcrypt_hashes.js — Friend System v1 / Sprint 67 / STORY-00527
 *
 * Generates bcrypt hashes (cost 12, matching User.hashPassword) for the 9 mock
 * passwords used by @cairn.demo accounts. Output is printed as a SQL-ready
 * fragment so the seed_mock_users.sql file can be re-generated when needed.
 *
 * Why this script exists:
 *   - bcrypt hashes embed a random salt — they cannot be pre-baked into the
 *     repo SQL because each generation differs. The committed seed SQL is
 *     captured ONCE from this script's output and then versioned.
 *   - Three iron laws (v4 plan): keep hash cost identical to register flow so
 *     the same login code path verifies them (single source of truth = cost 12).
 *   - Mock passwords are single-char (1..6, x1, x2, x3). auth.js login does NOT
 *     enforce password length — confirmed in STORY-00524.
 *
 * Usage:
 *   node backend/scripts/seed/gen_bcrypt_hashes.js
 *
 * Output: JSON object { password: hash, ... } printed to stdout.
 */

const bcrypt = require('bcryptjs');

const PASSWORDS = ['1', '2', '3', '4', '5', '6', 'x1', 'x2', 'x3'];
const COST = 12; // matches User.hashPassword

async function main() {
  const result = {};
  for (const p of PASSWORDS) {
    result[p] = await bcrypt.hash(p, COST);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
