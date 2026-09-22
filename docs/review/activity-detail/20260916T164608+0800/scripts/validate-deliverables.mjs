#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const runDir = path.resolve(scriptDir, '..');
const required = [
  '00_ACTIVITY_DETAIL_CONVERGENCE.md',
  'REQUIREMENTS_DELTA.md',
  'REQUIREMENTS_DELTA.json',
  'OWNER_REVIEW_CARD.md',
  'TEST_RESULTS.json',
  'HANDOFF.json',
  'visual/index.html',
  'visual/capture-results.json',
  'visual/images/board-core-themes.jpg',
  'visual/images/board-actions-and-layout.jpg',
  'visual/images/board-product-family-comparison.jpg',
  'test-output/verify-changed.txt',
  'test-output/scoped-regression.txt',
  'test-output/session-store-regression.txt',
  'scripts/capture-activity-detail.mjs',
  'scripts/build-product-family-board.mjs',
  'scripts/validate-deliverables.mjs',
];

const errors = [];
for (const relative of required) {
  const absolute = path.join(runDir, relative);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) errors.push(`missing-or-empty:${relative}`);
}

const jsonFiles = ['REQUIREMENTS_DELTA.json', 'TEST_RESULTS.json', 'HANDOFF.json', 'visual/capture-results.json'];
for (const relative of jsonFiles) {
  try { JSON.parse(fs.readFileSync(path.join(runDir, relative), 'utf8')); }
  catch (error) { errors.push(`invalid-json:${relative}:${String(error)}`); }
}

const capture = JSON.parse(fs.readFileSync(path.join(runDir, 'visual/capture-results.json'), 'utf8'));
for (const item of capture.captures ?? []) {
  const relative = path.join('visual', item.file);
  const absolute = path.join(runDir, relative);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) errors.push(`missing-capture:${relative}`);
}
for (const board of capture.boards ?? []) {
  const relative = path.join('visual', board);
  const absolute = path.join(runDir, relative);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) errors.push(`missing-board:${relative}`);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const files = walk(runDir)
  .filter(file => path.basename(file) !== 'VALIDATION.json')
  .map(file => ({
    path: path.relative(runDir, file),
    bytes: fs.statSync(file).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

for (const file of files) {
  const lower = file.path.toLowerCase();
  if (lower.includes('node_modules/') || lower.endsWith('/.env') || lower === '.env') errors.push(`disallowed-path:${file.path}`);
  if (/\.(sqlite|sqlite3|db)$/i.test(file.path)) errors.push(`private-database-risk:${file.path}`);
}

const result = {
  schema_version: 1,
  run_id: '20260916T164608+0800',
  status: errors.length === 0 ? 'PASS' : 'FAIL',
  checks: {
    required_files_present: !errors.some(error => error.startsWith('missing-or-empty')),
    json_valid: !errors.some(error => error.startsWith('invalid-json')),
    referenced_captures_packaged: !errors.some(error => error.startsWith('missing-capture')),
    referenced_boards_packaged: !errors.some(error => error.startsWith('missing-board')),
    disallowed_paths_absent: !errors.some(error => error.startsWith('disallowed-path') || error.startsWith('private-database-risk')),
    runtime_errors: capture.runtime_errors?.length ?? 0,
    allowed_product_writes: capture.isolation?.allowed_product_write_count,
  },
  counts: {
    files: files.length,
    captures: capture.captures?.length ?? 0,
    boards: capture.boards?.length ?? 0,
  },
  errors,
  files,
};

fs.writeFileSync(path.join(runDir, 'VALIDATION.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: result.status, checks: result.checks, counts: result.counts, errors }, null, 2)}\n`);
if (errors.length > 0) process.exitCode = 1;
