#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RESULT_STATES,
  atomicWriteJson,
  deriveTerminalStatus,
  evaluateSourceBinding,
  normalizeResultState,
  readJson,
  repoRoot,
  sha256File,
} from './assemble-v1-run-registry.mjs';
import { calculateV1SourceFingerprint } from './v1-source-fingerprint.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRunDir = path.resolve(path.dirname(scriptPath), '../../docs/review/v1-closure/20260918T222838+0800');
const statePrecedence = ['FAIL', 'BLOCKED', 'HOLD', 'UNVERIFIED', 'NOT_RUN', 'NO_DEPLOYMENT', 'PASS'];

function resolveEvidencePath(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(repoRoot, value);
}

function valueAt(document, pointer) {
  if (!pointer || pointer === '$') return document;
  const parts = pointer.replace(/^\$\.?/, '').split('.').filter(Boolean);
  return parts.reduce((value, part) => value?.[part], document);
}

function evaluateProof(proof) {
  const evidencePath = resolveEvidencePath(proof.path);
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    return { pass: false, reason: `proof evidence missing: ${evidencePath ?? '<unset>'}` };
  }
  if (proof.sha256) {
    const actual = sha256File(evidencePath);
    if (actual !== proof.sha256) return { pass: false, reason: `proof hash mismatch: ${evidencePath}`, expected: proof.sha256, actual };
  }
  if (proof.kind === 'fileHash') return { pass: true, evidencePath, actual: sha256File(evidencePath) };
  let document;
  try {
    document = readJson(evidencePath);
  } catch (error) {
    return { pass: false, reason: `proof JSON invalid: ${evidencePath} (${error.message})` };
  }
  if (proof.kind === 'status') {
    const actual = deriveTerminalStatus(document);
    return actual === 'PASS'
      ? { pass: true, evidencePath, actual }
      : { pass: false, evidencePath, reason: `derived status is ${actual}`, actual };
  }
  if (proof.kind === 'assertion') {
    const entry = (document.assertions ?? []).find((candidate) => candidate.id === proof.assertionId);
    const actual = entry ? normalizeResultState(entry.result ?? entry.status ?? (entry.pass === true ? 'PASS' : null)) : null;
    return actual === 'PASS'
      ? { pass: true, evidencePath, assertionId: proof.assertionId }
      : { pass: false, evidencePath, reason: `assertion ${proof.assertionId} is ${actual ?? 'missing'}` };
  }
  if (proof.kind === 'allAssertionsPass') {
    const assertions = document.assertions;
    const passed = Array.isArray(assertions) && assertions.length > 0
      && assertions.every((entry) => normalizeResultState(entry.result ?? entry.status ?? (entry.pass === true ? 'PASS' : null)) === 'PASS');
    return passed
      ? { pass: true, evidencePath, assertionCount: assertions.length }
      : { pass: false, evidencePath, reason: 'one or more assertions are absent or not PASS' };
  }
  if (proof.kind === 'jsonValue') {
    const actual = valueAt(document, proof.pointer);
    return Object.is(actual, proof.expected)
      ? { pass: true, evidencePath, pointer: proof.pointer, actual }
      : { pass: false, evidencePath, reason: `${proof.pointer} did not equal expected value`, expected: proof.expected, actual };
  }
  return { pass: false, evidencePath, reason: `unsupported proof kind: ${proof.kind ?? '<unset>'}` };
}

function otaCheck(checks, reasons, id, pass, detail = {}) {
  const check = { id, pass, ...detail };
  checks.push(check);
  if (!pass) reasons.push(detail.reason ?? id);
  return pass;
}

export function evaluateOtaCandidate({ contract, registry, assertionResults, validationIntegrity }) {
  const checks = [];
  const reasons = [];
  const hold = () => ({
    status: 'HOLD_OTA',
    ready: false,
    formalClosureUnaffected: true,
    checks,
    reasons,
  });
  if (!contract || typeof contract !== 'object') {
    otaCheck(checks, reasons, 'contract-present', false, { reason: 'OTA convergence contract is missing' });
    return hold();
  }

  otaCheck(checks, reasons, 'contract-schema',
    contract.schema === 'cairnnz.v1-closure.ota-candidate-contract.v1',
    { actual: contract.schema, reason: 'OTA convergence contract schema is unsupported' });
  otaCheck(checks, reasons, 'validation-integrity', validationIntegrity === 'PASS',
    { actual: validationIntegrity, reason: 'closeout validation integrity is not PASS' });

  const requiredAssertionsPass = contract.requiredAssertions === 'ALL_PASS'
    && Array.isArray(assertionResults)
    && assertionResults.length > 0
    && assertionResults.every((entry) => entry.result === 'PASS');
  otaCheck(checks, reasons, 'required-functional-evidence', requiredAssertionsPass, {
    actual: (assertionResults ?? []).map((entry) => ({ id: entry.id, result: entry.result })),
    reason: 'one or more required functional assertions are missing or not PASS',
  });

  const runById = new Map((registry.runs ?? []).map((run) => [run.runId, run]));
  for (const requirement of contract.requiredRuns ?? []) {
    const run = runById.get(requirement.runId);
    const terminalPass = run?.terminalStatus === (requirement.terminalStatus ?? 'PASS');
    const bindingAccepted = (requirement.allowedSourceBindings ?? ['EXACT', 'DEPENDENCY_EQUIVALENT'])
      .includes(run?.sourceBinding?.status);
    const fileCountMatches = requirement.dependencyFiles === undefined
      || (run?.sourceBinding?.status === 'DEPENDENCY_EQUIVALENT'
        && run?.sourceBinding?.checkedFiles === requirement.dependencyFiles);
    otaCheck(checks, reasons, `required-run:${requirement.runId}`,
      Boolean(run) && terminalPass && bindingAccepted && fileCountMatches, {
        actual: run ? {
          terminalStatus: run.terminalStatus,
          sourceBinding: run.sourceBinding,
        } : null,
        expected: requirement,
        reason: `${requirement.runId} is missing, failed, or stale against its required dependency ledger`,
      });
  }

  for (const evidence of contract.requiredEvidence ?? []) {
    const evaluated = (evidence.proofs ?? []).map(evaluateProof);
    otaCheck(checks, reasons, `required-evidence:${evidence.id}`,
      evaluated.length > 0 && evaluated.every((entry) => entry.pass), {
        results: evaluated,
        reason: `${evidence.id} evidence is missing, changed, or failed`,
      });
  }

  otaCheck(checks, reasons, 'no-known-p0', Array.isArray(contract.knownP0) && contract.knownP0.length === 0, {
    actual: contract.knownP0,
    reason: 'one or more known P0 findings remain',
  });
  otaCheck(checks, reasons, 'no-local-functional-blocker',
    Array.isArray(contract.pendingLocalFunctionalBlockers)
      && contract.pendingLocalFunctionalBlockers.length === 0
      && (registry.pendingRuns?.length ?? 0) === 0, {
        actual: {
          declared: contract.pendingLocalFunctionalBlockers,
          pendingRuns: registry.pendingRuns ?? [],
        },
        reason: 'a local functional blocker or pending run remains',
      });

  const allowedGapCategories = new Set(contract.allowedRemainingGapCategories ?? []);
  const gaps = contract.remainingGaps ?? [];
  const gapsAllowed = Array.isArray(gaps) && gaps.every((gap) => allowedGapCategories.has(gap.category));
  otaCheck(checks, reasons, 'remaining-gap-categories', gapsAllowed, {
    actual: gaps.map((gap) => ({ id: gap.id, category: gap.category, state: gap.state })),
    expected: [...allowedGapCategories],
    reason: 'a remaining gap is outside the explicitly allowed convergence categories',
  });
  for (const gap of gaps) {
    if (!gap.proofs) continue;
    const evaluated = gap.proofs.map(evaluateProof);
    otaCheck(checks, reasons, `gap-evidence:${gap.id}`,
      evaluated.length > 0 && evaluated.every((entry) => entry.pass), {
        results: evaluated,
        reason: `${gap.id} retained-gap evidence is missing or changed`,
      });
  }

  const allowedHoldRuns = new Set(contract.allowedControllingHoldRunIds ?? []);
  const nonPassControllingRuns = (registry.runs ?? []).filter((run) => run.controlsClosure && run.terminalStatus !== 'PASS');
  const holdsAllowed = nonPassControllingRuns.every((run) => run.terminalStatus === 'HOLD'
    && allowedHoldRuns.has(run.runId)
    && ['EXACT', 'DEPENDENCY_EQUIVALENT'].includes(run.sourceBinding?.status));
  otaCheck(checks, reasons, 'controlling-holds-allowed', holdsAllowed, {
    actual: nonPassControllingRuns.map((run) => ({
      runId: run.runId,
      terminalStatus: run.terminalStatus,
      sourceBinding: run.sourceBinding?.status,
    })),
    expected: [...allowedHoldRuns],
    reason: 'a controlling failure or non-allowed/stale HOLD remains',
  });

  const boundary = contract.operationalBoundary ?? {};
  const boundaryPass = registry.deployment?.status === 'NO_DEPLOYMENT'
    && boundary.deployment === 'NO_DEPLOYMENT'
    && boundary.otaPublication === 'NOT_PUBLISHED'
    && boundary.publicProductionEnabled === false;
  otaCheck(checks, reasons, 'operational-boundary', boundaryPass, {
    actual: { registryDeployment: registry.deployment?.status, ...boundary },
    reason: 'deployment, OTA publication, or Public production-off boundary is not preserved',
  });

  if (reasons.length > 0) return hold();
  return {
    status: 'OTA_CANDIDATE_READY',
    ready: true,
    formalClosureUnaffected: true,
    checks,
    reasons,
  };
}

function worstState(states) {
  for (const state of statePrecedence) if (states.includes(state)) return state;
  return 'UNVERIFIED';
}

function evaluateAssertion(assertion, allocatedRunIds, runById) {
  if (!Array.isArray(allocatedRunIds) || allocatedRunIds.length === 0) {
    return { id: assertion.id, result: 'NOT_RUN', runs: [], reasons: ['no current evidence allocation'] };
  }
  const states = [];
  const reasons = [];
  const proofResults = [];
  for (const runId of allocatedRunIds) {
    const run = runById.get(runId);
    if (!run) {
      states.push('UNVERIFIED');
      reasons.push(`allocation references unknown run ${runId}`);
      continue;
    }
    if (run.terminalStatus !== 'PASS') {
      states.push(run.terminalStatus);
      reasons.push(`${runId} derived terminal state is ${run.terminalStatus}`);
      continue;
    }
    if (!['EXACT', 'DEPENDENCY_EQUIVALENT'].includes(run.sourceBinding?.status)) {
      states.push('UNVERIFIED');
      reasons.push(`${runId} source binding is ${run.sourceBinding?.status ?? 'missing'}`);
      continue;
    }
    const proofs = run.proofs?.[assertion.id];
    if (!Array.isArray(proofs) || proofs.length === 0) {
      states.push('UNVERIFIED');
      reasons.push(`${runId} has no executable proof for ${assertion.id}`);
      continue;
    }
    const evaluated = proofs.map(evaluateProof);
    proofResults.push({ runId, results: evaluated });
    const failures = evaluated.filter((result) => !result.pass);
    if (failures.length > 0) {
      states.push('FAIL');
      reasons.push(...failures.map((failure) => `${runId}: ${failure.reason}`));
    } else {
      states.push('PASS');
    }
  }
  return {
    id: assertion.id,
    result: worstState(states),
    runs: allocatedRunIds,
    sourceBindings: allocatedRunIds.map((runId) => ({ runId, ...(runById.get(runId)?.sourceBinding ?? { status: 'MISSING' }) })),
    proofResults,
    reasons,
  };
}

export function validateClosure({ plan, registry, currentFingerprint = calculateV1SourceFingerprint() }) {
  const consistencyErrors = [];
  if (!String(registry.schema ?? '').startsWith('cairnnz.v1-closure.run-registry.')) consistencyErrors.push('registry schema missing or unsupported');
  if (registry.candidateFingerprint?.digest !== currentFingerprint.digest
      || registry.candidateFingerprint?.fileCount !== currentFingerprint.fileCount) {
    consistencyErrors.push('current source/test fingerprint differs from assembled registry');
  }
  const runById = new Map();
  for (const run of registry.runs ?? []) {
    if (!run.runId || runById.has(run.runId)) {
      consistencyErrors.push(`duplicate or missing runId: ${run.runId ?? '<missing>'}`);
      continue;
    }
    runById.set(run.runId, run);
    if (!RESULT_STATES.includes(run.terminalStatus)) consistencyErrors.push(`${run.runId}: invalid terminal status ${run.terminalStatus}`);
    if (run.pending && (run.covers?.length ?? 0) > 0) consistencyErrors.push(`${run.runId}: pending run is allocated`);
    if (!run.pending) {
      if (!run.terminalReceipt || !fs.existsSync(run.terminalReceipt)) consistencyErrors.push(`${run.runId}: terminal receipt missing`);
      else if (run.terminalReceiptSha256 !== sha256File(run.terminalReceipt)) consistencyErrors.push(`${run.runId}: terminal receipt changed after assembly`);
    }
  }
  const planIds = new Set((plan.assertions ?? []).map((entry) => entry.id));
  for (const [assertionId, runIds] of Object.entries(registry.allocations ?? {})) {
    if (!planIds.has(assertionId)) consistencyErrors.push(`allocation references unknown assertion ${assertionId}`);
    for (const runId of runIds) if (!runById.has(runId)) consistencyErrors.push(`allocation references unknown run ${runId}`);
  }
  for (const run of registry.runs ?? []) {
    for (const assertionId of run.covers ?? []) {
      if (!(registry.allocations?.[assertionId] ?? []).includes(run.runId)) {
        consistencyErrors.push(`${run.runId}: cover ${assertionId} is absent from allocations`);
      }
    }
  }

  const results = (plan.assertions ?? []).map((assertion) => evaluateAssertion(
    assertion,
    registry.allocations?.[assertion.id],
    runById,
  ));
  const controllingStates = (registry.runs ?? [])
    .filter((run) => run.controlsClosure)
    .map((run) => ['EXACT', 'DEPENDENCY_EQUIVALENT'].includes(run.sourceBinding?.status)
      ? run.terminalStatus
      : 'UNVERIFIED');
  const assertionStates = results.map((entry) => entry.result);
  const result = consistencyErrors.length > 0 ? 'UNVERIFIED' : worstState([...controllingStates, ...assertionStates]);
  const counts = Object.fromEntries(RESULT_STATES.map((state) => [state, results.filter((entry) => entry.result === state).length]));
  const validationIntegrity = consistencyErrors.length === 0 ? 'PASS' : 'FAIL';
  const otaCandidate = evaluateOtaCandidate({
    contract: plan.otaCandidateContract,
    registry,
    assertionResults: results,
    validationIntegrity,
  });
  return {
    schema: 'cairnnz.v1-closure.validation.v2',
    generatedAt: new Date().toISOString(),
    candidateFingerprint: registry.candidateFingerprint,
    currentFingerprint,
    validationIntegrity,
    summary: {
      assertions: results.length,
      ...counts,
      controllingStates,
      deployment: registry.deployment?.status ?? 'UNVERIFIED',
      result,
      otaCandidateDisposition: otaCandidate.status,
      otaCandidateReady: otaCandidate.ready,
    },
    otaCandidate,
    results,
    pendingRuns: registry.pendingRuns ?? [],
    consistencyErrors,
    limitation: 'This validates immutable receipt status, current dependency equivalence, allocation, executable proof predicates, and the distinct owner-test OTA convergence contract. OTA_CANDIDATE_READY does not change formal closure HOLD, publish an OTA, enable Public in production, or create native evidence.',
  };
}

function runSelfTest() {
  for (const state of RESULT_STATES) assert.equal(normalizeResultState(state), state);
  assert.equal(deriveTerminalStatus({ status: 'PASS', exitCode: 1 }), 'FAIL');
  assert.equal(deriveTerminalStatus({ terminal_status: 'FAIL_HOLD_FORMAL_PLAN_EVIDENCE_LIMITATION' }), 'HOLD');
  assert.equal(deriveTerminalStatus({ status: 'BLOCKED / NOT INTEGRATED' }), 'BLOCKED');
  assert.equal(deriveTerminalStatus(null, { pending: true }), 'NOT_RUN');
  assert.equal(deriveTerminalStatus({ status: 'DEFERRED_ENVIRONMENT' }), 'UNVERIFIED');
  assert.equal(deriveTerminalStatus({ status: 'NO_DEPLOYMENT' }), 'NO_DEPLOYMENT');
  assert.equal(deriveTerminalStatus({ success: true }, { exitCode: 0 }), 'PASS');
  assert.equal(deriveTerminalStatus({ success: false }, { exitCode: 0 }), 'FAIL');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-v1-validator-'));
  try {
    const dependencyPath = path.join(temporary, 'dependency.txt');
    fs.writeFileSync(dependencyPath, 'stable\n');
    const ledgerPath = path.join(temporary, 'SOURCE_HASHES.sha256');
    fs.writeFileSync(ledgerPath, `${sha256File(dependencyPath)}  ${dependencyPath}\n`);
    const binding = evaluateSourceBinding({ sourceHashLedger: ledgerPath }, { digest: 'current', fileCount: 1 });
    assert.equal(binding.status, 'DEPENDENCY_EQUIVALENT');
    fs.writeFileSync(dependencyPath, 'mutated\n');
    assert.equal(evaluateSourceBinding({ sourceHashLedger: ledgerPath }, { digest: 'current', fileCount: 1 }).status, 'UNVERIFIED');

    const evidencePath = path.join(temporary, 'evidence.json');
    fs.writeFileSync(evidencePath, `${JSON.stringify({ status: 'PASS' })}\n`);
    const currentFingerprint = { digest: 'current', fileCount: 1 };
    const registry = {
      schema: 'cairnnz.v1-closure.run-registry.v2',
      candidateFingerprint: currentFingerprint,
      runs: [{
        runId: 'pass-run', terminalStatus: 'PASS', pending: false, covers: ['A'], controlsClosure: false,
        terminalReceipt: evidencePath, terminalReceiptSha256: sha256File(evidencePath),
        sourceBinding: { status: 'EXACT' }, proofs: { A: [{ kind: 'status', path: evidencePath, sha256: sha256File(evidencePath) }] },
      }, {
        runId: 'pending-run', terminalStatus: 'NOT_RUN', pending: true, covers: [], controlsClosure: false,
      }],
      allocations: { A: ['pass-run'] },
      pendingRuns: ['pending-run'],
      deployment: { status: 'NO_DEPLOYMENT' },
    };
    const validation = validateClosure({ plan: { assertions: [{ id: 'A' }, { id: 'B' }] }, registry, currentFingerprint });
    assert.equal(validation.results.find((entry) => entry.id === 'A').result, 'PASS');
    assert.equal(validation.results.find((entry) => entry.id === 'B').result, 'NOT_RUN');
    assert.deepEqual(validation.pendingRuns, ['pending-run']);
    assert.equal(validation.summary.deployment, 'NO_DEPLOYMENT');

    const homepagePath = path.join(temporary, 'homepage.json');
    fs.writeFileSync(homepagePath, `${JSON.stringify({ status: 'PASS', assertions: { complete: true } })}\n`);
    const baseContract = {
      schema: 'cairnnz.v1-closure.ota-candidate-contract.v1',
      requiredAssertions: 'ALL_PASS',
      requiredRuns: [
        { runId: 'pf', terminalStatus: 'PASS', allowedSourceBindings: ['DEPENDENCY_EQUIVALENT'], dependencyFiles: 82 },
        { runId: 'public', terminalStatus: 'PASS', allowedSourceBindings: ['DEPENDENCY_EQUIVALENT'], dependencyFiles: 30 },
        { runId: 'c3', terminalStatus: 'PASS', allowedSourceBindings: ['DEPENDENCY_EQUIVALENT'], dependencyFiles: 49 },
      ],
      requiredEvidence: [{ id: 'homepage', proofs: [{ kind: 'jsonValue', path: homepagePath, sha256: sha256File(homepagePath), pointer: 'assertions.complete', expected: true }] }],
      knownP0: [],
      pendingLocalFunctionalBlockers: [],
      allowedRemainingGapCategories: ['NATIVE', 'OWNER_ACCEPTANCE', 'PERFORMANCE_DEFERRED', 'EVIDENCE_LIMIT', 'P2'],
      remainingGaps: [
        { id: 'A4', category: 'PERFORMANCE_DEFERRED', state: 'HOLD' },
        { id: 'FR', category: 'EVIDENCE_LIMIT', state: 'HOLD' },
      ],
      allowedControllingHoldRunIds: ['fr-hold'],
      operationalBoundary: { deployment: 'NO_DEPLOYMENT', otaPublication: 'NOT_PUBLISHED', publicProductionEnabled: false },
    };
    const dependencyRun = (runId, checkedFiles) => ({
      runId,
      terminalStatus: 'PASS',
      controlsClosure: false,
      sourceBinding: { status: 'DEPENDENCY_EQUIVALENT', checkedFiles },
    });
    const otaRegistry = {
      deployment: { status: 'NO_DEPLOYMENT' },
      pendingRuns: [],
      runs: [
        dependencyRun('pf', 82),
        dependencyRun('public', 30),
        dependencyRun('c3', 49),
        { runId: 'fr-hold', terminalStatus: 'HOLD', controlsClosure: true, sourceBinding: { status: 'DEPENDENCY_EQUIVALENT', checkedFiles: 13 } },
      ],
    };
    const otaInput = {
      contract: baseContract,
      registry: otaRegistry,
      assertionResults: [{ id: 'A', result: 'PASS' }],
      validationIntegrity: 'PASS',
    };
    assert.equal(evaluateOtaCandidate(otaInput).status, 'OTA_CANDIDATE_READY');

    const mutations = [
      { id: 'missing-functional-run', mutate: value => { value.registry.runs = value.registry.runs.filter((run) => run.runId !== 'pf'); } },
      { id: 'failed-functional-evidence', mutate: value => { value.assertionResults[0].result = 'FAIL'; } },
      { id: 'known-p0', mutate: value => { value.contract.knownP0 = [{ id: 'P0-test' }]; } },
      { id: 'stale-dependency', mutate: value => { value.registry.runs.find((run) => run.runId === 'public').sourceBinding.status = 'UNVERIFIED'; } },
      { id: 'wrong-dependency-count', mutate: value => { value.registry.runs.find((run) => run.runId === 'c3').sourceBinding.checkedFiles = 48; } },
      { id: 'pending-local-blocker', mutate: value => { value.contract.pendingLocalFunctionalBlockers = [{ id: 'local-test' }]; } },
      { id: 'non-allowed-gap', mutate: value => { value.contract.remainingGaps.push({ id: 'security', category: 'SECURITY', state: 'HOLD' }); } },
      { id: 'non-allowed-controlling-hold', mutate: value => { value.registry.runs.push({ runId: 'new-hold', terminalStatus: 'HOLD', controlsClosure: true, sourceBinding: { status: 'EXACT' } }); } },
      { id: 'missing-homepage', mutate: value => { value.contract.requiredEvidence[0].proofs[0].path = path.join(temporary, 'missing-homepage.json'); } },
    ];
    for (const mutation of mutations) {
      const value = structuredClone(otaInput);
      mutation.mutate(value);
      assert.equal(evaluateOtaCandidate(value).status, 'HOLD_OTA', mutation.id);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ selfTest: 'PASS', states: RESULT_STATES, otaMutations: 9 }));
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }
  const runDir = path.resolve(process.env.V1_CLOSURE_RUN_DIR ?? defaultRunDir);
  const registryPath = path.resolve(process.env.V1_CLOSURE_RUN_REGISTRY ?? path.join(runDir, 'FINAL_RUN_REGISTRY.json'));
  const outputPath = path.resolve(process.env.V1_CLOSURE_VALIDATION_OUTPUT ?? path.join(runDir, 'CLOSEOUT_VALIDATION.json'));
  const planPath = path.join(runDir, '03_ACCEPTANCE_PLAN.json');
  const validation = validateClosure({ plan: readJson(planPath), registry: readJson(registryPath) });
  validation.planPath = planPath;
  validation.registryPath = registryPath;
  atomicWriteJson(outputPath, validation);
  console.log(JSON.stringify(validation.summary));
  for (const error of validation.consistencyErrors) console.error(`CONSISTENCY: ${error}`);
  if (validation.summary.result !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
