import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTIFACT_MANIFEST_SCHEMA,
  DEPENDENCY_MANIFEST_SCHEMA,
  FIXTURE_RECEIPT_SCHEMA,
  O61_FINGERPRINT_DIGEST,
  O61_FINGERPRINT_FILE_COUNT,
  O61_FINGERPRINT_SCOPE,
  PROOF_POLICY_SCHEMA,
  correlateNetworkEvidence,
  deriveTerminalStatus,
  evaluateCleanupTranscript,
  rawByteDigest,
  requireSemanticChange,
  resolveSelectorContract,
  sealArtifactManifest,
  sealDependencyManifest,
  semanticDigest,
  semanticEqual,
  validateArtifactManifest,
  validateAssertionProofStructure,
  validateCleanupReceipt,
  validateDependencyManifestStructure,
  validateFixtureReceipt,
  validateObservedAssertionProofs,
  validateObservedDependencyManifest,
  validatePrePostFingerprint,
  validateReadinessIdentity,
} from '../src/index.mjs';

function rejectsCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected ValidationError code ${code}`);
}

test('exact status aliases accept exact tokens only', () => {
  assert.equal(deriveTerminalStatus({ result: 'success' }).status, 'PASS');
  assert.equal(deriveTerminalStatus({ result: 'BYPASS' }).status, 'UNVERIFIED');
  assert.equal(deriveTerminalStatus({ result: 'NOT PASS' }).status, 'UNVERIFIED');
});

test('conflicting PASS and FAIL terminal fields fail closed', () => {
  const result = deriveTerminalStatus({ result: 'PASS', verdict: 'FAIL', success: true });
  assert.equal(result.status, 'UNVERIFIED');
  assert.ok(result.reasons.includes('CONTRADICTORY_STATUS'));
});

test('PASS with a nonzero process exit fails closed', () => {
  const result = deriveTerminalStatus({ terminalStatus: 'PASS' }, { exitCode: 9 });
  assert.equal(result.status, 'UNVERIFIED');
  assert.ok(result.reasons.includes('PASS_WITH_NONZERO_EXIT'));
});

test('semantic JSON ignores object key order while raw byte hashes retain it', () => {
  const leftText = '{"a":1,"nested":{"x":2,"y":3}}\n';
  const rightText = '{"nested":{"y":3,"x":2},"a":1}';
  const left = JSON.parse(leftText);
  const right = JSON.parse(rightText);
  assert.equal(semanticEqual(left, right), true);
  assert.equal(semanticDigest(left), semanticDigest(right));
  assert.notEqual(rawByteDigest(leftText), rawByteDigest(rightText));
});

test('geometry key permutation is not accepted as proof of an edit', () => {
  const before = { geometry: { type: 'Point', coordinates: [174.7, -36.8] }, title: 'A' };
  const after = { title: 'A', geometry: { coordinates: [174.7, -36.8], type: 'Point' } };
  rejectsCode(() => requireSemanticChange(before, after, { requiredChangedPointers: ['/geometry/coordinates'] }), 'NO_SEMANTIC_CHANGE');
});

test('required semantic field change produces before/after digests', () => {
  const result = requireSemanticChange(
    { geometry: { coordinates: [1, 2] } },
    { geometry: { coordinates: [3, 4] } },
    { requiredChangedPointers: ['/geometry/coordinates'] },
  );
  assert.notEqual(result.beforeSemanticSha256, result.afterSemanticSha256);
});

test('canonical JSON rejects sparse arrays and non-JSON values', () => {
  const sparse = [];
  sparse.length = 1;
  rejectsCode(() => semanticDigest(sparse), 'SPARSE_JSON_ARRAY');
  rejectsCode(() => semanticDigest({ value: undefined }), 'UNDEFINED_JSON_VALUE');
});

test('raw byte digest accepts only strings and byte arrays', () => {
  assert.equal(rawByteDigest(Buffer.from('abc')), rawByteDigest('abc'));
  rejectsCode(() => rawByteDigest({ value: 'abc' }), 'INVALID_BYTES');
  rejectsCode(() => rawByteDigest(123), 'INVALID_BYTES');
});

const fingerprint = Object.freeze({
  algorithm: 'sha256',
  digest: O61_FINGERPRINT_DIGEST,
  fileCount: O61_FINGERPRINT_FILE_COUNT,
  scope: [...O61_FINGERPRINT_SCOPE],
});

const dependencyFiles = Object.freeze([
  { path: 'backend/scripts/run-public-cairn-harness.sh', content: '#!/bin/sh\nexec node run.mjs\n' },
  { path: 'backend/scripts/public-cairn-harness/run.mjs', content: 'export const run = true;\n' },
  { path: 'backend/src/app.js', content: 'export const app = true;\n' },
]);

function dependencyDraft() {
  return {
    schema: DEPENDENCY_MANIFEST_SCHEMA,
    entrypoints: [{
      path: 'backend/scripts/run-public-cairn-harness.sh',
      closure: [
        'backend/scripts/run-public-cairn-harness.sh',
        'backend/scripts/public-cairn-harness/run.mjs',
        'backend/src/app.js',
      ],
    }],
    files: dependencyFiles.map(({ path, content }) => ({ path, sha256: rawByteDigest(content) })),
    requiredDependencies: ['backend/src/app.js'],
    fingerprintBefore: { ...fingerprint },
    fingerprintAfter: { ...fingerprint },
  };
}

test('strict dependency manifest structure validates a sealed explicit closure', () => {
  const manifest = sealDependencyManifest(dependencyDraft());
  const result = validateDependencyManifestStructure(manifest, { requiredDependencies: ['backend/src/app.js'] });
  assert.deepEqual(result, { manifestDigest: manifest.manifestDigest, fileCount: 3, entrypointCount: 1 });
});

test('authoritative dependency validation binds the sealed ledger to observed bytes', () => {
  const manifest = sealDependencyManifest(dependencyDraft());
  const result = validateObservedDependencyManifest(manifest, {
    requiredDependencies: ['backend/src/app.js'],
    observedFiles: dependencyFiles,
  });
  assert.equal(result.observedFileCount, 3);
  assert.match(result.observationDigest, /^[a-f0-9]{64}$/);

  const mutated = dependencyFiles.map((file) => ({ ...file }));
  mutated[2].content = 'export const app = false;\n';
  rejectsCode(
    () => validateObservedDependencyManifest(manifest, { observedFiles: mutated }),
    'OBSERVED_DEPENDENCY_DIGEST_MISMATCH',
  );
});

test('omitted caller-required dependency fails even when manifest is self-consistent', () => {
  const manifest = sealDependencyManifest(dependencyDraft());
  rejectsCode(
    () => validateDependencyManifestStructure(manifest, { requiredDependencies: ['backend/src/routes/public.js'] }),
    'OMITTED_DEPENDENCY',
  );
});

test('dependency ledger mutation after sealing is detected', () => {
  const manifest = sealDependencyManifest(dependencyDraft());
  manifest.files[2].sha256 = '4'.repeat(64);
  rejectsCode(() => validateDependencyManifestStructure(manifest), 'MANIFEST_DIGEST_MISMATCH');
});

test('noncanonical and duplicate dependency paths fail closed', () => {
  const traversal = dependencyDraft();
  traversal.files[2].path = '../backend/src/app.js';
  traversal.entrypoints[0].closure[2] = '../backend/src/app.js';
  traversal.requiredDependencies[0] = '../backend/src/app.js';
  rejectsCode(() => validateDependencyManifestStructure(sealDependencyManifest(traversal)), 'INVALID_PATH');

  const duplicate = dependencyDraft();
  duplicate.files[2] = { ...duplicate.files[1] };
  rejectsCode(() => validateDependencyManifestStructure(sealDependencyManifest(duplicate)), 'DUPLICATE_VALUE');
});

test('entrypoint closure cannot omit a ledger file', () => {
  const draft = dependencyDraft();
  draft.entrypoints[0].closure.pop();
  const manifest = sealDependencyManifest(draft);
  rejectsCode(() => validateDependencyManifestStructure(manifest), 'ORPHANED_DEPENDENCY');
});

test('pre/post fingerprint drift fails closed', () => {
  const after = { ...fingerprint, digest: 'b'.repeat(64) };
  rejectsCode(() => validatePrePostFingerprint({ ...fingerprint }, after), 'FINGERPRINT_DRIFT');
});

test('real O61 fingerprint shape requires the canonical ordered scope array', () => {
  assert.equal(validatePrePostFingerprint({ ...fingerprint }, { ...fingerprint }).fileCount, 664);
  const reordered = { ...fingerprint, scope: [...fingerprint.scope] };
  [reordered.scope[0], reordered.scope[1]] = [reordered.scope[1], reordered.scope[0]];
  rejectsCode(() => validatePrePostFingerprint({ ...fingerprint }, reordered), 'INVALID_FINGERPRINT_SCOPE');
  const foreign = { ...fingerprint, digest: 'b'.repeat(64) };
  rejectsCode(() => validatePrePostFingerprint(foreign, { ...foreign }), 'FINGERPRINT_NOT_FROZEN_O61');
});

test('dependency contract rejects a missing required key', () => {
  const draft = dependencyDraft();
  delete draft.requiredDependencies;
  rejectsCode(() => validateDependencyManifestStructure(sealDependencyManifest(draft)), 'MISSING_KEY');
});

const proofPolicy = {
  schema: PROOF_POLICY_SCHEMA,
  assertions: [
    {
      planAssertionId: 'PUB-09',
      authorizedProofs: [{ evidenceSchema: 'cairnnz.public-edit.v1', assertionId: 'edit.persisted' }],
      requiredNegativeControls: ['unchanged-id-rejected'],
    },
    {
      planAssertionId: 'PUB-12',
      authorizedProofs: [{ evidenceSchema: 'cairnnz.public-offline.v1', assertionId: 'offline.causal' }],
      requiredNegativeControls: ['unmatched-error-rejected'],
    },
  ],
};

function observedProofEvidence() {
  return [
    {
      allocationId: 'alloc-edit',
      content: JSON.stringify({
        schema: 'cairnnz.public-edit.v1',
        status: 'PASS',
        assertions: [{ id: 'edit.persisted', result: 'PASS' }],
        negativeControls: [{ name: 'unchanged-id-rejected', result: 'PASS' }],
      }),
    },
    {
      allocationId: 'alloc-offline',
      content: JSON.stringify({
        schema: 'cairnnz.public-offline.v1',
        status: 'PASS',
        assertions: [{ id: 'offline.causal', result: 'PASS' }],
        negativeControls: [{ name: 'unmatched-error-rejected', result: 'PASS' }],
      }),
    },
  ];
}

function validAllocations(observed = observedProofEvidence()) {
  const evidence = new Map(observed.map((item) => [item.allocationId, rawByteDigest(item.content)]));
  return [
    {
      allocationId: 'alloc-edit',
      planAssertionId: 'PUB-09',
      evidenceSchema: 'cairnnz.public-edit.v1',
      assertionId: 'edit.persisted',
      evidenceRawSha256: evidence.get('alloc-edit'),
      negativeControls: [{ name: 'unchanged-id-rejected', result: 'PASS' }],
    },
    {
      allocationId: 'alloc-offline',
      planAssertionId: 'PUB-12',
      evidenceSchema: 'cairnnz.public-offline.v1',
      assertionId: 'offline.causal',
      evidenceRawSha256: evidence.get('alloc-offline'),
      negativeControls: [{ name: 'unmatched-error-rejected', result: 'PASS' }],
    },
  ];
}

function mutateObservedProof(allocationId, mutate) {
  const observed = observedProofEvidence();
  const target = observed.find((item) => item.allocationId === allocationId);
  const receipt = JSON.parse(target.content);
  mutate(receipt);
  target.content = JSON.stringify(receipt);
  return observed;
}

test('authorized proof structure with named negative controls validates', () => {
  assert.deepEqual(validateAssertionProofStructure({ policy: proofPolicy, allocations: validAllocations() }), {
    allocationCount: 2,
    planAssertionCount: 2,
  });
});

test('authoritative proof validation binds allocations to observed receipt bytes and content', () => {
  const result = validateObservedAssertionProofs({
    policy: proofPolicy,
    allocations: validAllocations(),
    observedEvidence: observedProofEvidence(),
  });
  assert.equal(result.observedEvidenceCount, 2);

  const mutated = observedProofEvidence();
  mutated[0].content = mutated[0].content.replace('edit.persisted', 'edit.not-persisted');
  rejectsCode(
    () => validateObservedAssertionProofs({ policy: proofPolicy, allocations: validAllocations(), observedEvidence: mutated }),
    'OBSERVED_EVIDENCE_DIGEST_MISMATCH',
  );
});

test('observed proof rejects receipt-level FAIL, HOLD, UNVERIFIED, and contradictions', () => {
  for (const status of ['FAIL', 'HOLD', 'UNVERIFIED']) {
    const observed = mutateObservedProof('alloc-edit', (receipt) => { receipt.status = status; });
    rejectsCode(
      () => validateObservedAssertionProofs({ policy: proofPolicy, allocations: validAllocations(observed), observedEvidence: observed }),
      'OBSERVED_RECEIPT_NOT_PASS',
    );
  }
  const contradictory = mutateObservedProof('alloc-edit', (receipt) => { receipt.verdict = 'FAIL'; });
  rejectsCode(
    () => validateObservedAssertionProofs({
      policy: proofPolicy,
      allocations: validAllocations(contradictory),
      observedEvidence: contradictory,
    }),
    'OBSERVED_RECEIPT_NOT_PASS',
  );
});

test('observed proof requires exactly one positive target assertion result', () => {
  const failed = mutateObservedProof('alloc-edit', (receipt) => { receipt.assertions[0].result = 'FAIL'; });
  rejectsCode(
    () => validateObservedAssertionProofs({ policy: proofPolicy, allocations: validAllocations(failed), observedEvidence: failed }),
    'OBSERVED_ASSERTION_NOT_PASS',
  );

  const missing = mutateObservedProof('alloc-edit', (receipt) => { receipt.assertions[0].id = 'some.other.assertion'; });
  rejectsCode(
    () => validateObservedAssertionProofs({ policy: proofPolicy, allocations: validAllocations(missing), observedEvidence: missing }),
    'OBSERVED_ASSERTION_MISSING',
  );

  const contradictory = mutateObservedProof('alloc-edit', (receipt) => {
    receipt.assertions.push({ id: 'edit.persisted', result: 'FAIL' });
  });
  rejectsCode(
    () => validateObservedAssertionProofs({
      policy: proofPolicy,
      allocations: validAllocations(contradictory),
      observedEvidence: contradictory,
    }),
    'CONTRADICTORY_ASSERTION_RESULTS',
  );
});

test('proof misallocation across plan assertions fails closed', () => {
  const allocations = validAllocations();
  allocations[0].evidenceSchema = 'cairnnz.public-offline.v1';
  allocations[0].assertionId = 'offline.causal';
  rejectsCode(() => validateAssertionProofStructure({ policy: proofPolicy, allocations }), 'PROOF_MISALLOCATION');
});

test('missing named negative control fails closed', () => {
  const allocations = validAllocations();
  allocations[0].negativeControls = [];
  rejectsCode(() => validateAssertionProofStructure({ policy: proofPolicy, allocations }), 'MISSING_NEGATIVE_CONTROL');
});

test('proof contract rejects a missing required key', () => {
  const allocations = validAllocations();
  delete allocations[0].evidenceRawSha256;
  rejectsCode(() => validateAssertionProofStructure({ policy: proofPolicy, allocations }), 'MISSING_KEY');
});

const exactHost = 'http://127.0.0.1:33012';
const expectedOffline = {
  requestId: 'offline-1',
  method: 'GET',
  url: `${exactHost}/api/v1/map/tiles`,
  phase: 'offline',
  errorCode: 'ERR_INTERNET_DISCONNECTED',
  consoleMessage: 'Failed to fetch offline-1',
};

function offlineEvents() {
  return [
    { kind: 'request', atMs: 100, requestId: 'offline-1', method: 'GET', url: expectedOffline.url, phase: 'offline' },
    { kind: 'network-error', atMs: 110, requestId: 'offline-1', method: 'GET', url: expectedOffline.url, phase: 'offline', errorCode: 'ERR_INTERNET_DISCONNECTED' },
    { kind: 'console-error', atMs: 111, requestId: 'offline-1', method: 'GET', url: expectedOffline.url, phase: 'offline', message: 'Failed to fetch offline-1' },
  ];
}

test('network errors require exact identity and causal ordering', () => {
  const result = correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events: offlineEvents() });
  assert.equal(result.expectedErrorCount, 1);
});

test('duplicate expected offline error fails cardinality', () => {
  const events = offlineEvents();
  events.push({ ...events[1], atMs: 112 });
  rejectsCode(() => correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events }), 'OUTCOME_CARDINALITY');
});

test('a response and network error for one request are contradictory terminal outcomes', () => {
  const events = offlineEvents();
  events.push({
    kind: 'response', atMs: 112, requestId: 'offline-1', method: 'GET',
    url: expectedOffline.url, phase: 'offline', status: 200,
  });
  rejectsCode(() => correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events }), 'OUTCOME_CARDINALITY');
});

test('a request without a response or network error has no terminal outcome', () => {
  const events = offlineEvents();
  events.push({
    kind: 'request', atMs: 120, requestId: 'unfinished', method: 'GET',
    url: `${exactHost}/api/unfinished`, phase: 'online',
  });
  rejectsCode(() => correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events }), 'OUTCOME_CARDINALITY');
});

test('console error before its request fails causal correlation', () => {
  const events = offlineEvents();
  events[2].atMs = 99;
  rejectsCode(() => correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events }), 'CAUSAL_ORDER_VIOLATION');
});

test('lookalike evilapi.mapbox.com host is rejected', () => {
  const events = offlineEvents();
  events[0].url = 'http://evilapi.mapbox.com/api/v1/map/tiles';
  rejectsCode(() => correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events }), 'HOST_MISMATCH');
});

test('unexpected dialog fails instead of being autoaccepted', () => {
  const events = offlineEvents();
  events.push({ kind: 'dialog', atMs: 120, phase: 'offline', type: 'alert', message: 'surprise' });
  rejectsCode(() => correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events }), 'UNEXPECTED_DIALOG');
});

test('any observed 5xx response fails', () => {
  const events = offlineEvents();
  events.push(
    { kind: 'request', atMs: 120, requestId: 'online-1', method: 'POST', url: `${exactHost}/api/edit-diag`, phase: 'online' },
    { kind: 'response', atMs: 121, requestId: 'online-1', method: 'POST', url: `${exactHost}/api/edit-diag`, phase: 'online', status: 500 },
  );
  rejectsCode(() => correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events }), 'UNEXPECTED_5XX');
});

test('unmatched console errors fail', () => {
  const events = offlineEvents();
  events.push({
    kind: 'console-error', atMs: 130, requestId: 'other', method: 'GET',
    url: `${exactHost}/other`, phase: 'online', message: 'Failed to load resource',
  });
  rejectsCode(() => correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events }), 'UNMATCHED_RUNTIME_ERROR');
});

test('network contract rejects a missing required event key', () => {
  const events = offlineEvents();
  delete events[0].phase;
  rejectsCode(() => correlateNetworkEvidence({ exactHost, expectedErrors: [expectedOffline], events }), 'MISSING_KEY');
});

function artifactInputs(terminalContent = '{"result":"PASS"}\n') {
  return [
    { path: 'external-run/terminal.json', mediaType: 'application/json', content: terminalContent },
    { path: 'external-run/browser.log', mediaType: 'text/plain', content: 'clean\n' },
  ];
}

test('explicit terminal selection and complete sealed artifact inventory validate', () => {
  const artifacts = artifactInputs();
  const receipt = sealArtifactManifest({ terminalArtifact: 'external-run/terminal.json', observedTerminalExitCode: 0, artifacts });
  assert.equal(receipt.schema, ARTIFACT_MANIFEST_SCHEMA);
  const result = validateArtifactManifest(receipt, { artifacts, requirePassingTerminal: true });
  assert.equal(result.artifactCount, 2);
  assert.equal(result.terminal.status, 'PASS');
});

test('terminal artifact selection cannot be absent or inferred', () => {
  rejectsCode(() => sealArtifactManifest({ terminalArtifact: '', observedTerminalExitCode: 0, artifacts: artifactInputs() }), 'INVALID_PATH');
  rejectsCode(
    () => sealArtifactManifest({ terminalArtifact: 'external-run/latest.json', observedTerminalExitCode: 0, artifacts: artifactInputs() }),
    'TERMINAL_ARTIFACT_UNDECLARED',
  );
});

test('PASS artifact requires sealed zero exit provenance', () => {
  rejectsCode(
    () => sealArtifactManifest({ terminalArtifact: 'external-run/terminal.json', artifacts: artifactInputs() }),
    'INVALID_TERMINAL_EXIT_CODE',
  );
  const receipt = sealArtifactManifest({
    terminalArtifact: 'external-run/terminal.json', observedTerminalExitCode: 7, artifacts: artifactInputs(),
  });
  rejectsCode(() => validateArtifactManifest(receipt, { artifacts: artifactInputs() }), 'PASS_WITH_NONZERO_EXIT');
});

test('terminal JSON exit fields must be integers agreeing with sealed observed exit', () => {
  const agreeingArtifacts = artifactInputs('{"result":"PASS","exitCode":0,"exit_code":0}\n');
  const agreeingReceipt = sealArtifactManifest({
    terminalArtifact: 'external-run/terminal.json', observedTerminalExitCode: 0, artifacts: agreeingArtifacts,
  });
  assert.equal(
    validateArtifactManifest(agreeingReceipt, { artifacts: agreeingArtifacts, requirePassingTerminal: true }).terminal.status,
    'PASS',
  );

  const invalidArtifacts = artifactInputs('{"result":"PASS","exitCode":"0"}\n');
  const invalidReceipt = sealArtifactManifest({
    terminalArtifact: 'external-run/terminal.json', observedTerminalExitCode: 0, artifacts: invalidArtifacts,
  });
  rejectsCode(() => validateArtifactManifest(invalidReceipt, { artifacts: invalidArtifacts }), 'INVALID_EMBEDDED_EXIT_CODE');

  const mismatchedArtifacts = artifactInputs('{"result":"PASS","exit_code":1}\n');
  const mismatchedReceipt = sealArtifactManifest({
    terminalArtifact: 'external-run/terminal.json', observedTerminalExitCode: 0, artifacts: mismatchedArtifacts,
  });
  rejectsCode(() => validateArtifactManifest(mismatchedReceipt, { artifacts: mismatchedArtifacts }), 'TERMINAL_EXIT_CODE_MISMATCH');

  const contradictoryArtifacts = artifactInputs('{"result":"PASS","exitCode":0,"exit_code":1}\n');
  const contradictoryReceipt = sealArtifactManifest({
    terminalArtifact: 'external-run/terminal.json', observedTerminalExitCode: 0, artifacts: contradictoryArtifacts,
  });
  rejectsCode(
    () => validateArtifactManifest(contradictoryReceipt, { artifacts: contradictoryArtifacts }),
    'CONTRADICTORY_EMBEDDED_EXIT_CODES',
  );
});

test('undeclared artifact makes the manifest incomplete', () => {
  const declared = artifactInputs();
  const receipt = sealArtifactManifest({ terminalArtifact: 'external-run/terminal.json', observedTerminalExitCode: 0, artifacts: declared });
  const actual = [...declared, { path: 'external-run/hidden.log', mediaType: 'text/plain', content: 'not sealed' }];
  rejectsCode(() => validateArtifactManifest(receipt, { artifacts: actual }), 'INCOMPLETE_ARTIFACT_MANIFEST');
});

test('artifact contract rejects a missing required key', () => {
  const artifacts = artifactInputs();
  const receipt = sealArtifactManifest({ terminalArtifact: 'external-run/terminal.json', observedTerminalExitCode: 0, artifacts });
  delete receipt.observedTerminalExitCode;
  rejectsCode(() => validateArtifactManifest(receipt, { artifacts }), 'MISSING_KEY');
});

const expectedOwnership = {
  runId: 'r15one01-external-test',
  ownerToken: 'owner-86f32a',
  processes: [{ pid: 4123, startToken: 'proc-start-991', processGroupId: 4123, runId: 'r15one01-external-test', ownerToken: 'owner-86f32a' }],
  container: { id: 'sha256:abc', name: 'cairn-test-r15one01', labels: { runId: 'r15one01-external-test', ownerToken: 'owner-86f32a' } },
};

function cleanupEvents() {
  const process = { ...expectedOwnership.processes[0] };
  const container = { ...expectedOwnership.container, labels: { ...expectedOwnership.container.labels } };
  return [
    { kind: 'PROCESS_IDENTITY_VERIFIED', identity: process },
    { kind: 'PROCESS_TERM_SENT', identity: process },
    { kind: 'PROCESS_EXIT_OBSERVED', identity: process },
    { kind: 'PROCESS_WAIT_REAPED', identity: process },
    { kind: 'CONTAINER_IDENTITY_VERIFIED', identity: container },
    { kind: 'CONTAINER_IDENTITY_REVERIFIED', identity: container },
    { kind: 'CONTAINER_REMOVE_REQUESTED', identity: container },
    { kind: 'CONTAINER_ABSENT_VERIFIED', identity: container },
  ];
}

test('owned cleanup transcript reaches a sealed CLEAN receipt', () => {
  const receipt = evaluateCleanupTranscript({ expected: expectedOwnership, events: cleanupEvents() });
  assert.equal(receipt.terminalState, 'CLEAN');
  assert.match(receipt.receiptDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(validateCleanupReceipt(receipt, { expected: expectedOwnership, events: cleanupEvents() }), {
    receiptDigest: receipt.receiptDigest,
    eventCount: 8,
  });
});

test('cleanup receipt or provenance mutation fails closed', () => {
  const events = cleanupEvents();
  const receipt = evaluateCleanupTranscript({ expected: expectedOwnership, events });
  receipt.container.labels.ownerToken = 'foreign-owner';
  rejectsCode(() => validateCleanupReceipt(receipt, { expected: expectedOwnership, events }), 'CLEANUP_RECEIPT_MISMATCH');
});

test('cleanup receipt rejects a missing required key', () => {
  const events = cleanupEvents();
  const receipt = evaluateCleanupTranscript({ expected: expectedOwnership, events });
  delete receipt.eventCount;
  rejectsCode(() => validateCleanupReceipt(receipt, { expected: expectedOwnership, events }), 'MISSING_KEY');
});

test('already-exited process still requires an explicit reap observation', () => {
  const process = { ...expectedOwnership.processes[0] };
  const expected = { ...expectedOwnership, container: null };
  rejectsCode(
    () => evaluateCleanupTranscript({ expected, events: [{ kind: 'PROCESS_ALREADY_EXITED', identity: process }] }),
    'INCOMPLETE_PROCESS_CLEANUP',
  );
  const receipt = evaluateCleanupTranscript({
    expected,
    events: [
      { kind: 'PROCESS_ALREADY_EXITED', identity: process },
      { kind: 'PROCESS_WAIT_REAPED', identity: process },
    ],
  });
  assert.equal(receipt.terminalState, 'CLEAN');
});

test('container TOCTOU identity change before remove fails closed', () => {
  const events = cleanupEvents();
  events[5] = {
    kind: 'CONTAINER_IDENTITY_REVERIFIED',
    identity: { ...expectedOwnership.container, id: 'sha256:replacement', labels: { ...expectedOwnership.container.labels } },
  };
  rejectsCode(() => evaluateCleanupTranscript({ expected: expectedOwnership, events }), 'CONTAINER_IDENTITY_MISMATCH');
});

test('owned process identity mismatch fails closed', () => {
  const events = cleanupEvents();
  events[1] = { ...events[1], identity: { ...events[1].identity, startToken: 'reused-pid' } };
  rejectsCode(() => evaluateCleanupTranscript({ expected: expectedOwnership, events }), 'PROCESS_IDENTITY_MISMATCH');
});

const expectedReadiness = {
  runId: 'r15one01-external-test', ownerToken: 'owner-86f32a', apiOrigin: exactHost,
  apiPid: 4123, apiStartToken: 'proc-start-991', database: 'cairn_test', realm: 'public-r15', fixtureNamespace: 'ext_r15one01',
};

test('alien readiness identity is rejected', () => {
  const alien = { ...expectedReadiness, apiStartToken: 'some-other-process' };
  rejectsCode(() => validateReadinessIdentity(alien, expectedReadiness), 'ALIEN_READINESS_IDENTITY');
});

test('readiness contract rejects a missing required key', () => {
  const incomplete = { ...expectedReadiness };
  delete incomplete.apiPid;
  rejectsCode(() => validateReadinessIdentity(incomplete, expectedReadiness), 'MISSING_KEY');
});

test('readiness identity rejects null, empty, malformed, and unsafe values', () => {
  const mutations = [
    ['runId', null, 'INVALID_READINESS_RUN_ID'],
    ['ownerToken', '', 'INVALID_READINESS_OWNER_TOKEN'],
    ['apiOrigin', 'ftp://127.0.0.1:33012', 'INVALID_READINESS_ORIGIN'],
    ['apiOrigin', 'http://127.0.0.1:33012/health', 'INVALID_READINESS_ORIGIN'],
    ['apiPid', 0, 'INVALID_READINESS_PID'],
    ['apiPid', Number.MAX_SAFE_INTEGER + 1, 'INVALID_READINESS_PID'],
    ['apiStartToken', '', 'INVALID_READINESS_START_TOKEN'],
    ['database', 'cairn-test', 'INVALID_READINESS_DATABASE'],
    ['realm', 'public realm', 'INVALID_READINESS_REALM'],
    ['fixtureNamespace', '../foreign', 'INVALID_READINESS_FIXTURE_NAMESPACE'],
  ];
  for (const [key, value, code] of mutations) {
    rejectsCode(() => validateReadinessIdentity({ ...expectedReadiness, [key]: value }, expectedReadiness), code);
  }
  const secure = { ...expectedReadiness, apiOrigin: 'https://api.example.test:8443' };
  assert.equal(validateReadinessIdentity(secure, secure).apiOrigin, secure.apiOrigin);
});

const selectorElements = [
  { role: 'button', name: 'Save trip', testId: 'save-trip', visible: true, enabled: true },
  { role: 'button', name: 'Cancel', testId: 'cancel-trip', visible: true, enabled: true },
];

test('selector contract requires unique accessible role/name and test-id agreement', () => {
  assert.equal(resolveSelectorContract(selectorElements, { role: 'button', name: 'Save trip', testId: 'save-trip' }).index, 0);
});

test('duplicate accessible selectors fail closed', () => {
  const elements = [...selectorElements, { ...selectorElements[0], testId: 'save-trip-copy' }];
  rejectsCode(() => resolveSelectorContract(elements, { role: 'button', name: 'Save trip' }), 'ROLE_NAME_CARDINALITY');
});

test('role/name and test-id disagreement fails closed', () => {
  rejectsCode(
    () => resolveSelectorContract(selectorElements, { role: 'button', name: 'Save trip', testId: 'cancel-trip' }),
    'SELECTOR_DISAGREEMENT',
  );
});

const expectedFixture = {
  runId: 'external-r15',
  namespace: 'ext_r15one01',
  database: 'cairn_test',
  realm: 'public-r15',
  requiredTables: ['users', 'debug_events_v2'],
};

function fixtureReceipt() {
  return {
    schema: FIXTURE_RECEIPT_SCHEMA,
    runId: 'external-r15',
    namespace: 'ext_r15one01',
    database: 'cairn_test',
    realm: 'public-r15',
    tables: [
      { name: 'users', preexistingRows: 0, createdRows: 1 },
      { name: 'debug_events_v2', preexistingRows: 0, createdRows: 1 },
    ],
    rowKeys: ['ext_r15one01:user:1', 'ext_r15one01:debug:1'],
  };
}

test('fixture receipt binds namespace and proves zero preexisting rows', () => {
  assert.deepEqual(validateFixtureReceipt(fixtureReceipt(), expectedFixture), {
    namespace: 'ext_r15one01', tableCount: 2, createdRows: 2,
  });
});

test('duplicate fixture row keys fail closed', () => {
  const receipt = fixtureReceipt();
  receipt.rowKeys[1] = receipt.rowKeys[0];
  rejectsCode(() => validateFixtureReceipt(receipt, expectedFixture), 'DUPLICATE_VALUE');
});

test('preexisting fixture rows prove contamination and fail', () => {
  const receipt = fixtureReceipt();
  receipt.tables[0].preexistingRows = 1;
  rejectsCode(() => validateFixtureReceipt(receipt, expectedFixture), 'FIXTURE_CONTAMINATION');
});

test('fixture contract rejects a missing required key', () => {
  const receipt = fixtureReceipt();
  delete receipt.rowKeys;
  rejectsCode(() => validateFixtureReceipt(receipt, expectedFixture), 'MISSING_KEY');
});

test('fixture identity rejects null, empty, and malformed identifiers', () => {
  const identityMutations = [
    ['runId', null, 'INVALID_FIXTURE_RUN_ID'],
    ['namespace', '', 'INVALID_FIXTURE_NAMESPACE'],
    ['database', 'cairn-test', 'INVALID_FIXTURE_DATABASE'],
    ['realm', 'public realm', 'INVALID_FIXTURE_REALM'],
  ];
  for (const [key, value, code] of identityMutations) {
    const receipt = fixtureReceipt();
    receipt[key] = value;
    rejectsCode(() => validateFixtureReceipt(receipt, expectedFixture), code);
  }

  const invalidTable = fixtureReceipt();
  invalidTable.tables[0].name = 'users;drop';
  rejectsCode(() => validateFixtureReceipt(invalidTable, expectedFixture), 'INVALID_FIXTURE_TABLE');

  const invalidRow = fixtureReceipt();
  invalidRow.rowKeys[0] = ' ext_r15one01:user:1';
  rejectsCode(() => validateFixtureReceipt(invalidRow, expectedFixture), 'INVALID_ROW_KEY');
});
