#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const valueAfter = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const baselineRoot = path.resolve(valueAfter('--baseline-root', ''));
const candidateRoot = path.resolve(valueAfter('--candidate-root', ''));
const outputRoot = path.resolve(valueAfter('--output', '_review/hike-run-performance-closure'));
const trialCount = Number(valueAfter('--trials', '3'));
if (!fs.existsSync(path.join(baselineRoot, 'app/package.json'))
  || !fs.existsSync(path.join(candidateRoot, 'app/package.json'))) {
  throw new Error('baseline and candidate roots must be Git worktrees containing app/package.json');
}
if (!Number.isInteger(trialCount) || trialCount < 1 || trialCount > 10) {
  throw new Error('--trials must be an integer from 1 through 10');
}

const tests = [
  'src/features/memory/__tests__/revision03MemoryScale.test.ts',
  'src/features/activity/__tests__/activityJournalProjection.test.ts',
  'src/features/memory/__tests__/memoryLivePresentationEvidence.test.ts',
];
const mkdir = directory => fs.mkdirSync(directory, { recursive: true });
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const commandOutput = (command, args = []) => {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); } catch { return null; }
};
const sourceIdentity = root => ({
  head: commandOutput('git', ['-C', root, 'rev-parse', 'HEAD']),
  tree: commandOutput('git', ['-C', root, 'rev-parse', 'HEAD^{tree}']),
  status: commandOutput('git', ['-C', root, 'status', '--short']),
});
const parseTime = stderr => {
  const number = label => {
    const match = stderr.match(new RegExp(
      `(?:^|\\n)\\s*(?:([0-9.]+)\\s+${label}|${label}\\s+([0-9.]+))(?:\\n|$)`,
    ));
    return Number(match?.[1] ?? match?.[2] ?? NaN);
  };
  const integer = label => Number(stderr.match(new RegExp(`(?:^|\\n)\\s*([0-9]+)  ${label}(?:\\n|$)`))?.[1] ?? NaN);
  return {
    realSeconds: number('real'),
    userSeconds: number('user'),
    systemSeconds: number('sys'),
    maximumResidentSetBytes: integer('maximum resident set size'),
  };
};

mkdir(outputRoot);
const machine = {
  capturedAt: new Date().toISOString(),
  platform: os.platform(),
  release: os.release(),
  architecture: os.arch(),
  cpu: os.cpus()[0]?.model ?? null,
  logicalCpuCount: os.cpus().length,
  memoryBytes: os.totalmem(),
  node: process.version,
  npm: commandOutput('npm', ['--version']),
  uptime: commandOutput('uptime'),
  initialLoadAverage: os.loadavg(),
  policy: {
    trialCount,
    serial: true,
    thresholdsChanged: false,
    selectiveRetries: false,
    order: 'odd trials baseline→candidate; even trials candidate→baseline',
    cachePolicy: 'Jest --no-cache for every isolated file run',
  },
};
writeJson(path.join(outputRoot, 'MACHINE_AND_POLICY.json'), machine);

const sources = {
  baseline: { root: baselineRoot, identity: sourceIdentity(baselineRoot) },
  candidate: { root: candidateRoot, identity: sourceIdentity(candidateRoot) },
};
const runs = [];
for (let trial = 1; trial <= trialCount; trial += 1) {
  const sourceOrder = trial % 2 === 1 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  for (const sourceName of sourceOrder) {
    for (const test of tests) {
      const slug = path.basename(test, '.test.ts');
      const runId = `trial-${trial}-${sourceName}-${slug}`;
      const jestOutput = path.join(outputRoot, `${runId}.jest.json`);
      const before = {
        at: new Date().toISOString(),
        loadAverage: os.loadavg(),
        freeMemoryBytes: os.freemem(),
      };
      const result = spawnSync('/usr/bin/time', [
        '-lp', 'npx', 'jest', '--runInBand', '--no-cache', '--runTestsByPath', test,
        '--json', '--outputFile', jestOutput,
      ], {
        cwd: path.join(sources[sourceName].root, 'app'),
        env: { ...process.env, CI: '1' },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 10 * 60_000,
      });
      fs.writeFileSync(path.join(outputRoot, `${runId}.stdout.log`), result.stdout ?? '');
      fs.writeFileSync(path.join(outputRoot, `${runId}.stderr.log`), result.stderr ?? '');
      let jest = null;
      try { jest = JSON.parse(fs.readFileSync(jestOutput, 'utf8')); } catch { /* retained as missing */ }
      runs.push({
        runId,
        trial,
        source: sourceName,
        test,
        sourceIdentity: sources[sourceName].identity,
        before,
        exitCode: result.status,
        signal: result.signal,
        timedOut: result.error?.code === 'ETIMEDOUT',
        timing: parseTime(result.stderr ?? ''),
        jest: jest ? {
          success: jest.success,
          passed: jest.numPassedTests,
          failed: jest.numFailedTests,
          pending: jest.numPendingTests,
          runtimeErrorSuites: jest.numRuntimeErrorTestSuites,
          assertions: jest.testResults.flatMap(suite => suite.assertionResults.map(assertion => ({
            title: assertion.fullName,
            status: assertion.status,
            durationMs: assertion.duration ?? null,
            failureMessages: assertion.failureMessages,
          }))),
        } : null,
      });
      writeJson(path.join(outputRoot, 'PERFORMANCE_TRIALS.json'), {
        schema: 'cairn.hike-run.performance-closure.v1', machine, sources, tests, runs,
      });
    }
  }
}

const summary = {
  schema: 'cairn.hike-run.performance-closure-summary.v1',
  generatedAt: new Date().toISOString(),
  sources,
  policy: machine.policy,
  tests: tests.map(test => ({
    test,
    baseline: runs.filter(run => run.source === 'baseline' && run.test === test)
      .map(run => ({ trial: run.trial, exitCode: run.exitCode, timing: run.timing, jest: run.jest })),
    candidate: runs.filter(run => run.source === 'candidate' && run.test === test)
      .map(run => ({ trial: run.trial, exitCode: run.exitCode, timing: run.timing, jest: run.jest })),
  })),
};
writeJson(path.join(outputRoot, 'PERFORMANCE_SUMMARY.json'), summary);
process.stdout.write(`${JSON.stringify({ outputRoot, runCount: runs.length, failedRuns: runs.filter(run => run.exitCode !== 0).length })}\n`);
