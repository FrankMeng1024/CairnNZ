#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const runDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(runDir, '../../../..');
const runRel = path.relative(repoRoot, runDir).replaceAll(path.sep, '/');
const zipPath = process.env.CAIRN_AUDIT_ZIP || '';
const failures = [];
const checks = {};
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(path.join(runDir, file), 'utf8'));
const exists = file => fs.existsSync(path.join(runDir, file));
const assert = (condition, message) => { if (!condition) failures.push(message); };

const requiredFiles = [
  '00_REVIEW_SUMMARY.md', 'REQUIREMENTS_REGISTER.json', 'REQUIREMENTS_REGISTER.csv',
  '01_PAGE_AND_FLOW_BASELINE.md', '02_UI_DNA_AND_SHARED_DEPENDENCIES.md',
  '03_PAGE_LED_SLICE_PLAN.md', '04_FIRST_IPHONE_REVIEW.md', 'HANDOFF.json',
  'visual/index.html', 'visual/manifest.json', 'visual/capture-results.json',
  'scripts/capture-baseline.mjs', 'scripts/build-deliverables.mjs', 'scripts/validate-deliverables.mjs',
];
for (const file of requiredFiles) assert(exists(file), `Missing required file: ${file}`);
checks.required_files = { expected: requiredFiles.length, present: requiredFiles.filter(exists).length };

const register = readJson('REQUIREMENTS_REGISTER.json');
const manifest = readJson('visual/manifest.json');
const handoff = readJson('HANDOFF.json');

const requiredRequirementFields = [
  'requirement_id', 'parent_capability_ids', 'user_need', 'requirement', 'decision_status',
  'decision_source', 'primary_page_or_shared_owner', 'secondary_affected_pages', 'current_behavior',
  'gap_type', 'proposed_disposition', 'evidence_dimensions', 'dependencies', 'candidate_slice',
  'acceptance_criteria', 'evidence_ids', 'open_question',
];
for (const requirement of register.requirements) {
  for (const field of requiredRequirementFields) assert(field in requirement, `${requirement.requirement_id} missing ${field}`);
  for (const field of ['current_source', 'user_reachability', 'automated_proof', 'deployed_match', 'device_loaded', 'real_field_validation']) {
    assert(['YES', 'NO', 'PARTIAL', 'UNKNOWN'].includes(requirement.evidence_dimensions[field]), `${requirement.requirement_id} invalid ${field}`);
  }
  assert(requirement.proposed_disposition !== 'UNALLOCATED', `${requirement.requirement_id} is UNALLOCATED`);
  assert(requirement.acceptance_criteria.length > 0, `${requirement.requirement_id} has no acceptance criteria`);
  assert(Boolean(requirement.decision_source.reference), `${requirement.requirement_id} lacks decision source reference`);
}
checks.requirements = { count: register.requirements.length, complete: failures.length === 0 };

const priorCsv = fs.readFileSync(path.join(repoRoot, 'docs/review/product-system-v1-audit/CAPABILITY_MATRIX.csv'), 'utf8');
const originalIds = [...priorCsv.matchAll(/^(?:"?)([A-Z]+-[0-9]+)(?:"?),/gm)].map(match => match[1]);
const crosswalkIds = register.capability_crosswalk.map(item => item.capability_id);
assert(originalIds.length === 33, `Original capability count is ${originalIds.length}, expected 33`);
assert(crosswalkIds.length === 33, `Crosswalk count is ${crosswalkIds.length}, expected 33`);
for (const id of originalIds) assert(crosswalkIds.includes(id), `Missing crosswalk ID ${id}`);
for (const row of register.capability_crosswalk) {
  assert(row.child_requirement_ids.length > 0, `${row.capability_id} has no child requirements`);
  assert(row.current_disposition !== 'UNALLOCATED', `${row.capability_id} is UNALLOCATED`);
}
checks.capability_crosswalk = { original: originalIds.length, crosswalk: crosswalkIds.length, all_covered: originalIds.every(id => crosswalkIds.includes(id)) };

const evidenceIds = new Set(register.evidence.map(item => item.evidence_id));
for (const requirement of register.requirements) {
  for (const id of requirement.evidence_ids) assert(evidenceIds.has(id), `${requirement.requirement_id} references missing evidence ${id}`);
}
for (const page of register.pages) {
  for (const id of page.image_evidence) assert(evidenceIds.has(id), `${page.page} references missing image evidence ${id}`);
}
for (const finding of register.findings) {
  for (const id of finding.evidence_available) assert(evidenceIds.has(id), `${finding.finding_id} references missing evidence ${id}`);
}
checks.evidence_references = { evidence_count: evidenceIds.size, valid: !failures.some(value => value.includes('evidence')) };

assert(manifest.captures.length === register.visual_capture_summary.count, 'Visual capture count disagrees with register');
for (const item of manifest.captures) {
  const absolute = path.join(runDir, 'visual', item.relative_file);
  assert(fs.existsSync(absolute), `Missing visual file ${item.relative_file}`);
  if (fs.existsSync(absolute)) assert(fs.statSync(absolute).size > 1000, `Visual file too small ${item.relative_file}`);
  assert(!path.isAbsolute(item.relative_file), `Absolute visual path ${item.relative_file}`);
}
for (const board of manifest.boards) {
  const absolute = path.join(runDir, 'visual', board.relative_file);
  assert(fs.existsSync(absolute), `Missing board ${board.relative_file}`);
}
checks.visuals = { captures: manifest.captures.length, boards: manifest.boards.length, files_present: !failures.some(value => value.startsWith('Missing visual') || value.startsWith('Missing board')) };

const html = fs.readFileSync(path.join(runDir, 'visual/index.html'), 'utf8');
const localLinks = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(value => !value.startsWith('#'));
for (const link of localLinks) assert(fs.existsSync(path.join(runDir, 'visual', link)), `Broken offline HTML link ${link}`);
checks.html = { local_links: localLinks.length, all_resolve: !failures.some(value => value.startsWith('Broken offline')) };

const csv = fs.readFileSync(path.join(runDir, 'REQUIREMENTS_REGISTER.csv'), 'utf8');
const csvLines = csv.trimEnd().split('\n');
assert(csvLines.length === register.requirements.length + 1, `CSV physical line count ${csvLines.length} differs; embedded newlines are not expected`);
checks.csv = { physical_lines: csvLines.length, expected: register.requirements.length + 1 };

assert(register.coverage_checks.exactly_one_proposed_task_card === true, 'Register does not assert exactly one proposed card');
assert(handoff.proposed_next_card?.card_id === 'CARD-01', 'Handoff proposed card is not CARD-01');
assert(!fs.readFileSync(path.join(runDir, '03_PAGE_LED_SLICE_PLAN.md'), 'utf8').includes('CARD-02'), 'More than one card marker found');
checks.proposed_card = { count: 1, card_id: 'CARD-01', status: handoff.proposed_next_card?.status };

const allFiles = execFileSync('find', [runDir, '-type', 'f', '-print'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const file of allFiles) {
  const relative = path.relative(runDir, file);
  assert(!/(^|\/)node_modules(\/|$)/.test(relative), `node_modules packaged candidate: ${relative}`);
  assert(!/(^|\/)\.env(?:\.|$)/.test(relative), `.env packaged candidate: ${relative}`);
  assert(!/\.(sqlite|sqlite3|db)$/i.test(relative), `database packaged candidate: ${relative}`);
}
checks.privacy_exclusions = { files_scanned: allFiles.length, forbidden_candidates: failures.filter(value => value.includes('packaged candidate')).length };

const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: repoRoot, encoding: 'utf8' });
const unrelatedLines = status.split('\n').filter(Boolean).filter(line => {
  const value = line.slice(3).replace(/^"|"$/g, '');
  return !value.startsWith(`${runRel}/`);
}).sort();
const unrelatedHash = sha256(unrelatedLines.length ? `${unrelatedLines.join('\n')}\n` : '');
assert(unrelatedHash === register.git_baseline.sorted_status_sha256, `Unrelated Git status changed: ${unrelatedHash}`);
checks.unrelated_worktree = { expected_sha256: register.git_baseline.sorted_status_sha256, actual_sha256: unrelatedHash, preserved: unrelatedHash === register.git_baseline.sorted_status_sha256, unrelated_entries: unrelatedLines.length };

if (zipPath) {
  assert(fs.existsSync(zipPath), `ZIP missing: ${zipPath}`);
  if (fs.existsSync(zipPath)) {
    const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    for (const entry of entries) {
      assert(!/(^|\/)node_modules(\/|$)/.test(entry), `ZIP includes node_modules: ${entry}`);
      assert(!/(^|\/)\.env(?:\.|$)/.test(entry), `ZIP includes .env: ${entry}`);
      assert(!/\.(sqlite|sqlite3|db)$/i.test(entry), `ZIP includes database: ${entry}`);
    }
    for (const item of manifest.captures) {
      assert(entries.some(entry => entry.endsWith(`visual/${item.relative_file}`)), `ZIP missing capture ${item.relative_file}`);
    }
    checks.zip = { path: zipPath, entries: entries.length, includes_all_captures: !failures.some(value => value.startsWith('ZIP missing capture')) };
  }
}

const validation = {
  schema_version: 1,
  audit_id: register.audit_id,
  validated_at: new Date().toISOString(),
  result: failures.length ? 'FAIL' : 'PASS',
  checks,
  failures,
};
fs.writeFileSync(path.join(runDir, 'VALIDATION.json'), `${JSON.stringify(validation, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
