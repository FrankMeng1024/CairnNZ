'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  contentHash,
  publicSnapshotHash,
  readManifest,
  requirePublicPilotAuthority,
  validateManifest,
  plan,
} = require('../cairn-shanghai-field-test');
const {
  approvalPlan,
  assertMutationAuthority,
  resolveApprovedTarget,
  targetFingerprint,
} = require('../cairn-shanghai-authority');

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

function authorityFixture(realm = 'isolated') {
  const serverUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const database = 'cairn_field';
  const fingerprint = targetFingerprint(serverUuid, database);
  const target = {
    fingerprint, realm, serverUuid, database,
    allowlistSha256: '1'.repeat(64), serverHost: 'db', serverPort: 3306,
  };
  const binding = {
    batchId: 'o88-shanghai-encounter-20261020', manifestSha256: '2'.repeat(64),
    fixtureKeys: ['O88-JK-P01'], ttlDays: 14, target,
  };
  const review = {
    sha256: '3'.repeat(64), readers: ['11'], publicAuthors: ['21'], friendAuthors: ['31'],
    approvalExpiresAt: '2099-01-01T00:00:00.000Z', batchExpiresAt: '2098-12-31T00:00:00.000Z',
    cleanupScope: ['exact-scope'],
  };
  const plan = approvalPlan(binding, review);
  const args = {
    'confirm-batch': binding.batchId,
    'confirm-target': fingerprint,
    'owner-approval': plan.owner_approval,
  };
  return { args, binding, review, plan, serverUuid, database };
}

test('caller environment label cannot forge the independently allowlisted target realm', () => {
  const fixture = authorityFixture('production');
  const allowlist = {
    sha256: '1'.repeat(64),
    entries: [{
      fingerprint: fixture.binding.target.fingerprint,
      realm: 'production', mutation_allowed: true,
    }],
  };
  assert.throws(() => resolveApprovedTarget({
    serverUuid: fixture.serverUuid, database: fixture.database, serverHost: 'db', serverPort: 3306,
  }, allowlist, 'isolated', true), /does not match approved realm production/);
});

test('target allowlist rejects a different actual server identity', () => {
  const fixture = authorityFixture();
  const allowlist = {
    sha256: '1'.repeat(64),
    entries: [{ fingerprint: fixture.binding.target.fingerprint, realm: 'isolated', mutation_allowed: true }],
  };
  assert.throws(() => resolveApprovedTarget({
    serverUuid: 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    database: fixture.database, serverHost: 'db', serverPort: 3306,
  }, allowlist, 'isolated', true), /not uniquely approved/);
});

test('exact approval plan is stable but reader or creator expansion changes its identity', () => {
  const fixture = authorityFixture();
  assert.equal(approvalPlan(fixture.binding, { ...fixture.review }).plan_sha256, fixture.plan.plan_sha256);
  assert.notEqual(
    approvalPlan(fixture.binding, { ...fixture.review, readers: ['11', '12'] }).plan_sha256,
    fixture.plan.plan_sha256,
  );
  assert.notEqual(
    approvalPlan(fixture.binding, { ...fixture.review, publicAuthors: ['21', '22'] }).plan_sha256,
    fixture.plan.plan_sha256,
  );
});

test('expired approval and wrong approval identity fail closed', () => {
  const fixture = authorityFixture();
  assert.throws(() => assertMutationAuthority('apply', {
    ...fixture.args, 'owner-approval': `${fixture.binding.batchId}:${'0'.repeat(64)}`,
  }, fixture.binding, fixture.review, fixture.plan), /Exact Owner approval/);
  assert.throws(() => assertMutationAuthority('apply', fixture.args, fixture.binding, {
    ...fixture.review, approvalExpiresAt: '2000-01-01T00:00:00.000Z',
  }, fixture.plan), /expired/);
});

test('actual production realm requires the independent environment gate', () => {
  const fixture = authorityFixture('production');
  withEnvironment({ CAIRN_ENABLE_PRODUCTION_FIXTURE_APPLY: null }, () => assert.throws(
    () => assertMutationAuthority('apply', fixture.args, fixture.binding, fixture.review, fixture.plan),
    /disabled/,
  ));
});
