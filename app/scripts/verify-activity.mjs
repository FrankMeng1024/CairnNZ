#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const repoRoot = resolve(appRoot, '..');
const map = JSON.parse(readFileSync(join(scriptDir, 'activity-verification-map.json'), 'utf8'));
const gateOrder = ['none', 'presentation', 'gps', 'core', 'full'];
const args = process.argv.slice(2);
const requestedGate = args.find(value => value.startsWith('--gate='))?.split('=')[1] ?? null;
const explainOnly = args.includes('--explain');
const simulatedFiles = args.filter(value => value.startsWith('--file=')).map(value => value.slice(7));

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function lines(value) {
  return String(value ?? '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function changedFiles() {
  if (simulatedFiles.length > 0) return simulatedFiles;
  const tracked = run('git', ['diff', '--name-only', 'HEAD'], { cwd: repoRoot });
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repoRoot });
  if (tracked.status !== 0 || untracked.status !== 0) {
    throw new Error('Unable to inspect the Git diff.');
  }
  return [...new Set([...lines(tracked.stdout), ...lines(untracked.stdout)])].sort();
}

function routedGate(files) {
  let selected = 'none';
  const reasons = [];
  for (const file of files) {
    for (const rule of map.impactRules) {
      if (!new RegExp(rule.pattern).test(file)) continue;
      reasons.push({ file, gate: rule.gate, pattern: rule.pattern });
      if (gateOrder.indexOf(rule.gate) > gateOrder.indexOf(selected)) selected = rule.gate;
    }
  }
  return { selected, reasons };
}

function selectedGroups(gate) {
  if (gate === 'full') return map.groups;
  if (gate === 'presentation') return map.groups.filter(group => group.minimumGate === 'presentation');
  if (gate === 'gps') return map.groups.filter(group => group.minimumGate === 'gps');
  if (gate === 'core') {
    return map.groups.filter(group => group.minimumGate === 'gps' || group.minimumGate === 'core');
  }
  return [];
}

function collectBackendTests(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...collectBackendTests(full));
    else if (entry.name.endsWith('.test.js')) output.push(relative(resolve(repoRoot, 'backend'), full));
  }
  return output.sort();
}

function printFailure(title, result) {
  process.stderr.write(`\n${title} — FAIL\n`);
  process.stderr.write(String(result.stdout ?? ''));
  process.stderr.write(String(result.stderr ?? ''));
}

function scopedTypecheck(files, groups, gate) {
  const changedTs = files
    .filter(file => /^app\/.*\.[jt]sx?$/.test(file))
    .map(file => file.slice('app/'.length));
  const directSources = gate && simulatedFiles.length === 0 && files.length === 0
    ? groups.flatMap(group => group.tests ?? [])
    : [];
  const scope = new Set([...changedTs, ...directSources]);
  if (scope.size === 0) return { ok: true, checked: 0, errors: [] };
  const result = run('npx', ['tsc', '--noEmit', '--pretty', 'false'], { cwd: appRoot });
  const errors = lines(`${result.stdout}\n${result.stderr}`).filter(line => {
    const match = line.match(/^(.+?)\(\d+,\d+\): error TS/);
    return match && scope.has(match[1].replaceAll('\\', '/'));
  });
  return { ok: errors.length === 0, checked: scope.size, errors };
}

const files = changedFiles();
const routing = routedGate(files);
const gate = requestedGate ?? routing.selected;
if (!gateOrder.includes(gate)) {
  process.stderr.write(`Unknown verification gate: ${gate}\n`);
  process.exit(2);
}

const groups = selectedGroups(gate);
if (explainOnly) {
  console.log(`Activity verification route: ${gate.toUpperCase()}`);
  for (const reason of routing.reasons) console.log(`${reason.gate.padEnd(12)} ${reason.file}`);
  if (routing.reasons.length === 0) console.log('No Activity-impact rule matched.');
  console.log(`Groups: ${groups.map(group => group.name).join(', ') || 'none'}`);
  process.exit(0);
}

if (gate === 'none') {
  console.log('Activity Changed Verification — PASS');
  console.log('No Activity-impact rule matched; no Activity suite was run.');
  process.exit(0);
}

const temporary = mkdtempSync(join(tmpdir(), 'cairn-activity-verify-'));
let failed = false;
const summaries = [];
try {
  const jestTests = gate === 'full'
    ? []
    : [...new Set(groups.flatMap(group => group.tests ?? []))];
  const jestJson = join(temporary, 'jest.json');
  const jestArgs = ['jest', '--runInBand', '--silent', '--json', '--outputFile', jestJson, ...jestTests];
  const jest = run('npx', jestArgs, { cwd: appRoot });
  if (jest.status !== 0 || !existsSync(jestJson)) {
    failed = true;
    printFailure('Activity client verification', jest);
  } else {
    const report = JSON.parse(readFileSync(jestJson, 'utf8'));
    const byFile = new Map(report.testResults.map(result => [
      relative(appRoot, result.name).replaceAll('\\', '/'),
      result,
    ]));
    if (gate === 'full') {
      summaries.push({ name: 'client-full', pass: report.numPassedTests, total: report.numTotalTests });
    } else {
      for (const group of groups.filter(item => (item.tests ?? []).length > 0)) {
        const results = group.tests.map(test => byFile.get(test)).filter(Boolean);
        summaries.push({
          name: group.name,
          pass: results.reduce((total, result) => total + result.assertionResults.filter(item => item.status === 'passed').length, 0),
          total: results.reduce((total, result) => total + result.assertionResults.length, 0),
        });
      }
    }
  }

  const backendTests = gate === 'full'
    ? collectBackendTests(resolve(repoRoot, 'backend/src'))
    : [...new Set(groups.flatMap(group => group.backendTests ?? []))];
  if (backendTests.length > 0) {
    const backend = run('node', ['--test', ...backendTests], { cwd: resolve(repoRoot, 'backend') });
    if (backend.status !== 0) {
      failed = true;
      printFailure('Activity backend verification', backend);
    } else {
      const match = String(backend.stdout).match(/(?:^|\n)[#ℹ]\s*tests\s+(\d+)/);
      const passed = String(backend.stdout).match(/(?:^|\n)[#ℹ]\s*pass\s+(\d+)/);
      summaries.push({
        name: 'server',
        pass: Number(passed?.[1] ?? backendTests.length),
        total: Number(match?.[1] ?? backendTests.length),
      });
    }
  }

  const typecheck = scopedTypecheck(files, groups, requestedGate);
  if (!typecheck.ok) {
    failed = true;
    process.stderr.write('\nScoped TypeScript validation — FAIL\n');
    process.stderr.write(typecheck.errors.join('\n') + '\n');
  } else {
    summaries.push({ name: 'static', pass: typecheck.checked, total: typecheck.checked });
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

if (failed) process.exit(1);
const totalPassed = summaries.reduce((total, item) => total + item.pass, 0);
const total = summaries.reduce((sum, item) => sum + item.total, 0);
console.log(`Activity ${gate === 'presentation' ? 'Presentation' : gate.toUpperCase()} Verification — PASS`);
for (const item of summaries) console.log(`${item.name.padEnd(18)} ${String(item.pass).padStart(4)}/${item.total}`);
console.log(`${'Total'.padEnd(18)} ${String(totalPassed).padStart(4)}/${total}`);
