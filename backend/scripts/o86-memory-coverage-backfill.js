#!/usr/bin/env node
'use strict';

const pool = require('../src/config/db');
const {
  COVERAGE_RULE_VERSION,
  materializeOwnerCoverage,
} = require('../src/services/memoryCoverage');

async function main() {
  const apply = process.argv.includes('--apply');
  const [owners] = await pool.execute(
    `SELECT DISTINCT user_id AS owner_id FROM memory_points
      WHERE evidence_source IN ('activity_real','passive_real')
        AND continuity_state='accepted' AND horizontal_accuracy_m BETWEEN 0 AND 50
      ORDER BY user_id`,
  );
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', coverage_rule_version: COVERAGE_RULE_VERSION, owners: owners.length }));
    return;
  }
  const startedAt = Date.now();
  let synchronized = 0;
  let tiles = 0;
  for (const owner of owners) {
    const before = await pool.execute(
      'SELECT COUNT(*) AS n FROM memory_coverage_evidence WHERE owner_id=? AND coverage_rule_version=?',
      [owner.owner_id, COVERAGE_RULE_VERSION],
    );
    tiles += await materializeOwnerCoverage(pool, owner.owner_id);
    const after = await pool.execute(
      'SELECT COUNT(*) AS n FROM memory_coverage_evidence WHERE owner_id=? AND coverage_rule_version=?',
      [owner.owner_id, COVERAGE_RULE_VERSION],
    );
    synchronized += Number(after[0][0].n) - Number(before[0][0].n);
  }
  const [[evidence]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM memory_coverage_evidence WHERE coverage_rule_version=?`,
    [COVERAGE_RULE_VERSION],
  );
  const [[prepared]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM memory_coverage_tiles WHERE coverage_rule_version=?`,
    [COVERAGE_RULE_VERSION],
  );
  console.log(JSON.stringify({
    mode: 'apply',
    coverage_rule_version: COVERAGE_RULE_VERSION,
    owners: owners.length,
    synchronized,
    source_tiles: tiles,
    evidence_rows: Number(evidence.n),
    prepared_rows: Number(prepared.n),
    duration_ms: Date.now() - startedAt,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
