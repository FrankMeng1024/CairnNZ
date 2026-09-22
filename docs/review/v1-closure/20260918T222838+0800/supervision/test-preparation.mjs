#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PATHS,
  deriveQueueProjection,
  projectFromFiles,
  readJson,
  sha256File,
} from './queue-adapter.mjs';
import { sampleObserver } from './observer.mjs';

const SUPERVISION_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = '/Users/mzm/Desktop/cairn/CairnNZ';
const GATE_PATH = path.join(REPO_ROOT, '.codex/hooks/cairn-v1-stop-gate.mjs');
const HOOKS_PATH = path.join(REPO_ROOT, '.codex/hooks.json');
const SPEC_PATH = '/Users/mzm/Desktop/CairnNZ_Unattended_04/SUPERVISION_ACCEPTANCE.json';
const FIXTURE_PATH = path.join(SUPERVISION_DIR, 'fixtures/supervision-cases.json');
const PRODUCT_FINGERPRINT = '9cee885d048b37ba1257f2651e0add6aa0a37b583e59e5404cb8df2636722632';
const ROOT_SESSION_ID = '01a0b4c1-b498-76e0-95bd-1976d11586f2';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function event(stopHookActive = false) {
  return {
    session_id: ROOT_SESSION_ID,
    cwd: REPO_ROOT,
    hook_event_name: 'Stop',
    model: 'gpt-5.6-sol',
    turn_id: 'fixture-turn',
    stop_hook_active: stopHookActive,
    last_assistant_message: 'fixture only',
  };
}

function baseControl() {
  return {
    schema: 'cairnnz.v1-closure.supervision.control.v1',
    runId: '20260918T222838+0800',
    rootSessionId: ROOT_SESSION_ID,
    repoRoot: REPO_ROOT,
    mode: 'RUN',
    ownerPause: null,
    pause: { checkpointRecorded: true },
    gate: { armed: true, maxCorrectiveContinuations: 1 },
    source: { productFingerprint: 'fixture-current' },
    evidence: { testedFingerprint: 'fixture-current' },
    closure: {
      localSoftware: 'VERIFIED',
      closeoutValidator: 'PASS',
      nativeDevice: 'UNVERIFIED',
      ownerAcceptance: 'UNVERIFIED',
    },
    workers: [],
    jobs: [],
    ownedProcesses: [],
  };
}

function baseQueue() {
  return {
    schema: 'cairnnz.v1-closure.queue.v1',
    activeStage: 'CLOSED_LOCAL',
    ownerPause: null,
    items: [{ id: 'DONE', state: 'completed', task: 'Disposable fixture complete.' }],
  };
}

function baseAcceptance() {
  return {
    schema: 'cairnnz.v1-closure.acceptance.v1',
    assertions: [{ id: 'LOCAL', result: 'PASS' }],
  };
}

function runGate({
  control = baseControl(),
  queue = baseQueue(),
  acceptance = baseAcceptance(),
  hookEvent = event(false),
  corruptControl = false,
} = {}) {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-supervision-'));
  const controlPath = path.join(fixtureDir, 'CONTROL.json');
  const queuePath = path.join(fixtureDir, 'QUEUE.json');
  const acceptancePath = path.join(fixtureDir, 'ACCEPTANCE.json');
  try {
    fs.writeFileSync(controlPath, corruptControl ? '{not-json' : `${JSON.stringify(control)}\n`);
    fs.writeFileSync(queuePath, `${JSON.stringify(queue)}\n`);
    fs.writeFileSync(acceptancePath, `${JSON.stringify(acceptance)}\n`);
    const result = spawnSync(process.execPath, [GATE_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      input: `${JSON.stringify(hookEvent)}\n`,
      env: {
        ...process.env,
        CAIRN_SUPERVISION_TEST: '1',
        CAIRN_SUPERVISION_CONTROL_PATH: controlPath,
        CAIRN_SUPERVISION_QUEUE_PATH: queuePath,
        CAIRN_SUPERVISION_ACCEPTANCE_PATH: acceptancePath,
      },
      timeout: 3000,
    });
    assert.equal(result.status, 0, result.stderr || `gate exit ${result.status}`);
    const stdout = result.stdout.trim();
    return {
      stdout,
      parsed: stdout ? JSON.parse(stdout) : null,
      stderr: result.stderr,
    };
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

function expectBlock(result, fragment) {
  assert.equal(result.parsed?.decision, 'block');
  if (fragment) assert.match(result.parsed.reason, fragment);
}

function expectAllow(result) {
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

function executeCase(fixture) {
  const details = [];
  switch (fixture.kind) {
    case 'returned_unintegrated': {
      const control = baseControl();
      control.workers = [{ id: 'child-1', required: true, state: 'RETURNED', disposition: null }];
      expectBlock(runGate({ control }), /returned but is not dispositioned/);
      control.workers[0].disposition = 'integrated';
      expectAllow(runGate({ control }));

      const actualQueue = readJson(DEFAULT_PATHS.queue);
      const actualAcceptance = readJson(DEFAULT_PATHS.acceptance);
      const actualControl = baseControl();
      const resumedQueue = { ...actualQueue, ownerPause: null, activeStage: 'RESUME_FIXTURE' };
      const actualProjection = deriveQueueProjection({
        queue: resumedQueue,
        acceptance: actualAcceptance,
        control: actualControl,
      });
      assert(actualProjection.openItemIds.includes('A4'));
      assert(actualProjection.openItemIds.includes('B4'));
      expectBlock(runGate({ control: actualControl, queue: resumedQueue, acceptance: actualAcceptance }), /required queue items remain/);
      details.push(`real queue ${sha256File(DEFAULT_PATHS.queue)} retains ${actualProjection.openItemIds.join(',')}`);
      break;
    }
    case 'dispatched_without_ack': {
      const control = baseControl();
      control.workers = [{ id: 'child-dispatched', required: true, state: 'DISPATCHED', disposition: null }];
      const result = runGate({ control });
      expectBlock(result, /remains DISPATCHED/);
      assert.doesNotMatch(result.parsed.reason, /remains RUNNING/);
      details.push('DISPATCHED is retained as distinct from RUNNING');
      break;
    }
    case 'approval_wait_with_independent_ready': {
      const control = baseControl();
      control.workers = [{ id: 'approval-leg', required: true, state: 'WAITING_APPROVAL' }];
      const queue = {
        ...baseQueue(),
        items: [
          { id: 'WAIT', state: 'waiting_approval', task: 'Needs external approval.' },
          { id: 'READY', state: 'pending', task: 'Independent safe work.', dependencies: [] },
        ],
      };
      const projection = deriveQueueProjection({ queue, acceptance: baseAcceptance(), control });
      assert.equal(projection.firstReadyWork?.id, 'READY');
      expectBlock(runGate({ control, queue }), /waiting for approval/);
      assert.equal(control.workers.length, 1);
      details.push('independent READY work is projected without spawning a duplicate or bypassing approval');
      break;
    }
    case 'late_superseded_result': {
      const control = baseControl();
      control.workers = [{ id: 'attempt-1', required: true, state: 'SUPERSEDED_RETURNED', quarantined: false }];
      expectBlock(runGate({ control }), /not quarantined/);
      control.workers[0].quarantined = true;
      expectAllow(runGate({ control }));
      details.push('late output becomes terminal only after explicit quarantine');
      break;
    }
    case 'local_complete_native_unverified': {
      const control = baseControl();
      control.closure.nativeDevice = 'NOT_RUN';
      control.closure.ownerAcceptance = 'UNVERIFIED';
      expectAllow(runGate({ control }));
      assert.equal(control.closure.localSoftware, 'VERIFIED');
      assert.equal(control.closure.nativeDevice, 'NOT_RUN');
      details.push('verified local software is represented separately from native and owner checks');
      break;
    }
    case 'owner_pause_unit_only': {
      const control = baseControl();
      control.mode = 'PAUSED_USER';
      control.ownerPause = { state: 'explicit', autoResume: false };
      const queue = {
        ...baseQueue(),
        activeStage: 'OWNER_PAUSED',
        ownerPause: { state: 'explicit', autoResume: false },
        items: [{ id: 'OPEN', state: 'in_progress_paused', task: 'Preserved task.' }],
      };
      expectAllow(runGate({ control, queue }));
      details.push('unit pause override allowed; same-session live owner drill remains NOT_RUN');
      break;
    }
    case 'classified_provider_pauses': {
      for (const mode of ['PAUSED_QUOTA', 'PAUSED_BUDGET', 'PAUSED_NETWORK']) {
        const control = baseControl();
        control.mode = mode;
        control.pause = { checkpointRecorded: true, autoRetry: false };
        expectAllow(runGate({ control, queue: { ...baseQueue(), items: [{ id: 'OPEN', state: 'pending', task: 'Preserved.' }] } }));
      }
      details.push('fixture-only classified pauses allow checkpoint return without retry or spawn behavior');
      break;
    }
    case 'stale_observer_metadata': {
      const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-observer-'));
      try {
        const nowMs = Date.parse('2026-09-19T12:00:00.000Z');
        const statusPath = path.join(fixtureDir, 'status.json');
        const controlPath = path.join(fixtureDir, 'control.json');
        fs.writeFileSync(statusPath, '{}\n');
        fs.utimesSync(statusPath, new Date(nowMs - 120_000), new Date(nowMs - 120_000));
        fs.writeFileSync(controlPath, `${JSON.stringify({
          repoRoot: fixtureDir,
          runId: 'fixture',
          rootSessionId: ROOT_SESSION_ID,
          mode: 'RUN',
          ownedProcesses: [{ pid: 12345, role: 'fixture job', ownership: 'fixture', expectedState: 'running' }],
          observer: {
            rootProgressObservedAt: new Date(nowMs - 120_000).toISOString(),
            rootStaleAfterSeconds: 60,
            statusFiles: [{ path: statusPath, staleAfterSeconds: 60 }],
          },
        })}\n`);
        const sample = sampleObserver({ controlPath, nowMs, isAlive: () => false });
        assert.equal(sample.state, 'UNCERTAIN');
        assert.equal(sample.rootProgress.stale, true);
        assert.equal(sample.statusFiles[0].stale, true);
        assert.equal(sample.processes[0].alive, false);
        assert(sample.limitations.some((entry) => entry.includes('never starts Codex')));
      } finally {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      }
      details.push('stale file, root silence, and missing process produce uncertainty only');
      break;
    }
    case 'source_fingerprint_changed': {
      const control = baseControl();
      control.source.productFingerprint = 'new-source';
      control.evidence.testedFingerprint = 'old-source';
      expectBlock(runGate({ control }), /evidence fingerprint is stale/);
      details.push('changed source invalidates older evidence');
      break;
    }
    case 'corrupt_state_and_repeated_stop': {
      const first = runGate({ corruptControl: true });
      expectBlock(first, /control state could not be loaded/);
      const repeated = runGate({ corruptControl: true, hookEvent: event(true) });
      assert.equal(repeated.parsed?.continue, false);
      assert.equal(repeated.parsed?.stopReason, 'BLOCKED_SUPERVISION');
      assert.match(repeated.parsed?.systemMessage, /corrective continuation limit was reached/);
      const pausedQueue = { ...baseQueue(), ownerPause: { state: 'explicit', autoResume: false } };
      expectAllow(runGate({ corruptControl: true, queue: pausedQueue }));
      details.push('one correction is requested, then a visible fault returns control; explicit owner pause still wins');
      break;
    }
    default:
      throw new Error(`unimplemented fixture kind: ${fixture.kind}`);
  }
  return details;
}

function outputArgument(argv) {
  const index = argv.indexOf('--output');
  if (index === -1) return path.join(SUPERVISION_DIR, 'PREPARATION_RESULTS.json');
  if (!argv[index + 1]) throw new Error('--output requires a path');
  return path.resolve(argv[index + 1]);
}

function main() {
  const startedAt = new Date().toISOString();
  const specification = readJson(SPEC_PATH);
  const fixtures = readJson(FIXTURE_PATH);
  const fixtureById = new Map(fixtures.cases.map((entry) => [entry.id, entry]));
  const checks = new Map();
  let failed = false;

  const hooks = readJson(HOOKS_PATH);
  assert.deepEqual(Object.keys(hooks.hooks), ['Stop']);
  assert.equal(hooks.hooks.Stop[0].hooks[0].type, 'command');
  assert.match(hooks.hooks.Stop[0].hooks[0].command, /cairn-v1-stop-gate\.mjs/);
  assert.equal(hooks.hooks.Stop[0].hooks[0].timeout, 3);

  const isolationControl = baseControl();
  expectAllow(runGate({ control: isolationControl, hookEvent: { ...event(), session_id: 'other-session' } }));
  expectAllow(runGate({ control: isolationControl, hookEvent: { ...event(), hook_event_name: 'SubagentStop' } }));
  expectAllow(runGate({ control: isolationControl, hookEvent: { ...event(), cwd: '/tmp' } }));

  const deterministicA = runGate({ control: { ...baseControl(), workers: [{ id: 'x', required: true, state: 'DISPATCHED' }] } });
  const deterministicB = runGate({ control: { ...baseControl(), workers: [{ id: 'x', required: true, state: 'DISPATCHED' }] } });
  assert.equal(deterministicA.stdout, deterministicB.stdout);
  const projectionA = projectFromFiles();
  const projectionB = projectFromFiles();
  assert.deepEqual(projectionA, projectionB);

  for (const fixture of fixtures.cases) {
    try {
      checks.set(fixture.id, { passed: true, details: executeCase(fixture) });
    } catch (error) {
      failed = true;
      checks.set(fixture.id, { passed: false, details: [error.stack ?? error.message] });
    }
  }

  const results = specification.tests.map((test) => {
    if (test.id === 'T01' || test.id === 'T04') {
      return {
        id: test.id,
        requiredEvidenceClass: test.required_evidence_class,
        status: 'NOT_RUN',
        preparationStatus: 'NOT_RUN_LIVE_ONLY',
        actualEvidence: [],
        limitation: 'PREPARE_ONLY does not invoke a real Stop hook or create a real disposable child/job failure.',
      };
    }
    const check = checks.get(test.id);
    if (!check) {
      failed = true;
      return {
        id: test.id,
        requiredEvidenceClass: test.required_evidence_class,
        status: 'FAIL',
        preparationStatus: 'MISSING_FIXTURE',
        actualEvidence: [],
      };
    }
    const ownerLivePending = test.id === 'T08';
    return {
      id: test.id,
      requiredEvidenceClass: test.required_evidence_class,
      status: check.passed && !ownerLivePending ? 'PASS' : ownerLivePending ? 'NOT_RUN' : 'FAIL',
      preparationStatus: check.passed ? 'UNIT_OR_FIXTURE_PASS' : 'FAIL',
      actualEvidence: check.details,
      ...(ownerLivePending ? { limitation: 'Pause override passed as a unit fixture; the required owner-live pause/resume drill remains NOT_RUN.' } : {}),
    };
  });

  const outputPath = outputArgument(process.argv.slice(2));
  const receipt = {
    schema: 'cairnnz.v1-closure.supervision.preparation-results.v1',
    mode: 'PREPARE_ONLY',
    startedAt,
    finishedAt: new Date().toISOString(),
    rootSessionId: ROOT_SESSION_ID,
    runId: '20260918T222838+0800',
    command: [process.execPath, fileURLToPath(import.meta.url), '--output', outputPath],
    source: {
      head: '393338b5c159e7341d22b94086b5c29455386bdf',
      productFingerprint: PRODUCT_FINGERPRINT,
      prepareStartTree: 'ac6aa48abe38c5bf76d850d49f0826365173bdf4',
    },
    inputs: {
      specification: SPEC_PATH,
      specificationSha256: sha256File(SPEC_PATH),
      fixtures: FIXTURE_PATH,
      fixturesSha256: sha256File(FIXTURE_PATH),
      queue: DEFAULT_PATHS.queue,
      queueSha256: sha256File(DEFAULT_PATHS.queue),
    },
    controls: {
      hookDefinition: HOOKS_PATH,
      hookDefinitionSha256: sha256File(HOOKS_PATH),
      handler: GATE_PATH,
      handlerSha256: sha256File(GATE_PATH),
      queueAdapter: fileURLToPath(new URL('./queue-adapter.mjs', import.meta.url)),
      queueAdapterSha256: sha256File(fileURLToPath(new URL('./queue-adapter.mjs', import.meta.url))),
      observer: fileURLToPath(new URL('./observer.mjs', import.meta.url)),
      observerSha256: sha256File(fileURLToPath(new URL('./observer.mjs', import.meta.url))),
    },
    deterministicChecks: {
      repeatedHandlerOutputIdentical: true,
      repeatedQueueProjectionIdentical: true,
      nonRootSessionIgnored: true,
      subagentStopIgnored: true,
      otherWorkingDirectoryIgnored: true,
      configurationContainsOnlyStop: true,
    },
    tests: results,
    summary: {
      result: failed || results.some((entry) => entry.status === 'FAIL') ? 'FAIL' : 'PASS_WITH_LIVE_TESTS_NOT_RUN',
      fixturePass: results.filter((entry) => entry.status === 'PASS').length,
      liveNotRun: results.filter((entry) => entry.status === 'NOT_RUN').map((entry) => entry.id),
      hookTrusted: false,
      hookLoaded: 'UNVERIFIED',
      liveStopInvocation: 'NOT_RUN',
    },
    limitation: 'These are deterministic unit/fixture receipts. They do not prove that Codex trusted, loaded, or invoked the project Stop hook.',
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt.summary)}\n`);
  if (receipt.summary.result === 'FAIL') process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`preparation tests failed: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
