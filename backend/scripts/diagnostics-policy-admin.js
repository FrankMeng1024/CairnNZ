#!/usr/bin/env node
'use strict';

/**
 * Server-side Owner QA enrollment tool. This is intentionally not an app API:
 * it runs inside the authorized Cairn backend environment and records the
 * one-time consent/policy decision. Disabling also erases that owner's stored
 * diagnostic streams in the same transaction.
 */
const pool = require('../src/config/db');
const { setAutomaticDiagnosticEnrollment } = require('../src/services/automaticDiagnostics');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const ownerUserId = Number(argument('--owner-id'));
  const consentVersion = argument('--consent-version');
  const disable = process.argv.includes('--disable');
  const tier = process.argv.includes('--tier-b') ? 'tier_b' : 'tier_a';
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0 || !consentVersion) {
    throw new Error('Usage: diagnostics-policy-admin.js --owner-id <id> --consent-version <version> [--tier-a|--tier-b|--disable]');
  }
  const result = await setAutomaticDiagnosticEnrollment(pool, {
    ownerUserId,
    enabled: !disable,
    tier,
    consentVersion,
    expiresAt: argument('--expires-at'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
  .catch(error => {
    process.stderr.write(`diagnostic policy update failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
