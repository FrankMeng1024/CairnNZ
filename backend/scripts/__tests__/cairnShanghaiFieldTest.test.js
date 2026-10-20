'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertMutationAuthority,
  contentHash,
  publicSnapshotHash,
  readManifest,
  requirePublicPilotAuthority,
  validateManifest,
  plan,
} = require('../cairn-shanghai-field-test');

function withEnvironment(values, run) {
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    return run();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('O88 Shanghai manifest is exact, labelled, allocated, and remains a read-only plan', () => {
  const loaded = readManifest();
  const validated = validateManifest(loaded.manifest);
  const output = plan({ ...loaded, ...validated });
  assert.deepEqual(output.totals, { fixtures: 60, public: 34, friends: 26 });
  assert.equal(output.writePerformed, false);
  assert.equal(output.activationState, 'NOT_APPLIED');
  assert.equal(output.revisionCases.length, 6);
  assert.equal(output.uniqueCandidatePoints, 17);
});

test('Public snapshot identity includes coarsening policy while ordinary revision hash does not', () => {
  const base = { text: 'Test Cairn — 测试', lat: 31.2, lng: 121.4, approximate: true };
  const revisionHash = contentHash(base);
  const policyA = publicSnapshotHash({ ...base, locationPolicyVersion: 'policy-a' });
  const policyB = publicSnapshotHash({ ...base, locationPolicyVersion: 'policy-b' });
  assert.notEqual(policyA, revisionHash);
  assert.notEqual(policyA, policyB);
  assert.match(policyA, /^[a-f0-9]{64}$/);
});

test('field activation fails closed without effective pilot users and configured location policy', () => {
  withEnvironment({
    PUBLIC_CAIRN_PILOT_ENABLED: '0',
    PUBLIC_CAIRN_PILOT_USER_IDS: '11,12',
    PUBLIC_CAIRN_SENSITIVE_ZONES_JSON: '[]',
    NODE_ENV: 'production',
    CAIRN_REALM: null,
    ALLOW_ISOLATED_QA_SOURCE_CONTRACT: null,
  }, () => assert.throws(
    () => requirePublicPilotAuthority(['11'], ['12']),
    /location policy|allowlist/,
  ));
});

test('production mutation requires explicit environment gate and exact Owner reference', () => {
  const loaded = readManifest();
  withEnvironment({
    DB_HOST: 'qa-db', DB_PORT: '3307', DB_NAME: 'cairn_field',
    CAIRN_ENABLE_PRODUCTION_FIXTURE_APPLY: null,
  }, () => assert.throws(() => assertMutationAuthority('apply', {
    environment: 'production',
    'confirm-batch': loaded.manifest.batch_id,
    'confirm-target': 'production:qa-db:3307:cairn_field',
  }, loaded.sha256, loaded.manifest), /disabled/));
});
