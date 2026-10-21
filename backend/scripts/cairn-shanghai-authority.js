'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REALMS = new Set(['isolated', 'staging', 'production']);
const CLEANUP_SCOPE = Object.freeze([
  'cairn_qa_fixture_batches:batch_id',
  'cairn_qa_fixture_readers:batch_id',
  'cairn_qa_fixtures:batch_id',
  'markers:approved_fixture_marker_ids',
  'cairn_review_cases:approved_fixture_marker_ids',
  'cairn_collections:approved_fixture_marker_ids',
  'marker_audience_epochs:approved_fixture_marker_ids',
  'cairn_acquisition_events:approved_fixture_marker_ids',
  'cairn_acquisitions:approved_fixture_marker_ids',
  'cairn_revisions:approved_fixture_marker_ids',
  'notification_log:orphaned_fixture_only_presentation_groups',
  'cairn_presentation_groups:orphaned_fixture_only_groups',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedIds(value, label) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const parsed = source.map(item => String(item).trim()).filter(Boolean);
  if (!parsed.length || parsed.some(item => !/^[1-9]\d*$/.test(item))
    || new Set(parsed).size !== parsed.length) {
    throw new Error(`${label} must be non-empty unique positive integer ids`);
  }
  return parsed.sort((left, right) => Number(left) - Number(right));
}

function exactArray(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} does not match the exact approved plan`);
  }
}

function targetFingerprint(serverUuid, database) {
  const uuid = String(serverUuid || '').trim().toLowerCase();
  const db = String(database || '').trim();
  if (!/^[a-f0-9-]{16,64}$/.test(uuid) || !/^[A-Za-z0-9_$-]{1,64}$/.test(db)) {
    throw new Error('Database did not provide a usable server UUID and database identity');
  }
  return `mysql:${uuid}:${db}`;
}

function readTargetAllowlist(file) {
  if (!file) throw new Error('--target-allowlist is required');
  const resolved = path.resolve(file);
  const raw = fs.readFileSync(resolved);
  const value = JSON.parse(raw.toString('utf8'));
  if (value.schema_version !== 2 || !Array.isArray(value.approved_targets) || !value.approved_targets.length) {
    throw new Error('Target allowlist must be schema version 2 with approved targets');
  }
  const entries = value.approved_targets.map((entry, index) => {
    if (!REALMS.has(entry.realm) || typeof entry.apply_allowed !== 'boolean'
      || typeof entry.cleanup_allowed !== 'boolean') {
      throw new Error(`Invalid target allowlist entry ${index}`);
    }
    const fingerprint = targetFingerprint(entry.server_uuid, entry.database);
    return { ...entry, fingerprint };
  });
  if (new Set(entries.map(entry => entry.fingerprint)).size !== entries.length) {
    throw new Error('Target allowlist contains an ambiguous duplicate identity');
  }
  return { entries, resolved, sha256: sha256(raw) };
}

function resolveApprovedTarget(observed, allowlist, claimedRealm, operation = 'read') {
  const fingerprint = targetFingerprint(observed.serverUuid, observed.database);
  const matches = allowlist.entries.filter(entry => entry.fingerprint === fingerprint);
  if (matches.length !== 1) throw new Error('Connected database identity is not uniquely approved by the target allowlist');
  const approved = matches[0];
  if (claimedRealm !== approved.realm) {
    throw new Error(`Claimed environment ${claimedRealm || '(missing)'} does not match approved realm ${approved.realm}`);
  }
  if (!['read', 'apply', 'cleanup'].includes(operation)) throw new Error(`Unknown target operation: ${operation}`);
  if (operation === 'apply' && !approved.apply_allowed) {
    throw new Error('Fixture creation/update is disabled for this approved target');
  }
  if (operation === 'cleanup' && !approved.cleanup_allowed) {
    throw new Error('Fixture cleanup is disabled for this approved target');
  }
  return {
    fingerprint,
    realm: approved.realm,
    serverUuid: String(observed.serverUuid).toLowerCase(),
    database: observed.database,
    serverHost: observed.serverHost,
    serverPort: Number(observed.serverPort),
    allowlistSha256: allowlist.sha256,
  };
}

function validIso(value, label, nowMs) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be a valid ISO timestamp`);
  if (milliseconds <= nowMs) throw new Error(`${label} has expired`);
  return new Date(milliseconds).toISOString();
}

function readFieldReview(file, binding, now = new Date()) {
  if (!file) throw new Error('--field-review is required before mutation');
  const resolved = path.resolve(file);
  const raw = fs.readFileSync(resolved);
  const review = JSON.parse(raw.toString('utf8'));
  if (review.schema_version !== 2) throw new Error('Field review must use schema version 2');
  if (review.batch_id !== binding.batchId || review.manifest_sha256 !== binding.manifestSha256
    || review.coordinate_system !== 'WGS84') {
    throw new Error('Field review does not bind this exact batch, manifest, and coordinate system');
  }
  if (!review.reviewer || !Number.isFinite(Date.parse(review.reviewed_at))) {
    throw new Error('Field review requires reviewer and valid reviewed_at');
  }
  const verified = [...new Set(review.field_verified_fixture_keys || [])].sort();
  const expectedKeys = [...binding.fixtureKeys].sort();
  exactArray(verified, expectedKeys, 'Field-reviewed fixture keys');
  if (review.target_fingerprint !== binding.target.fingerprint
    || review.target_realm !== binding.target.realm
    || review.target_allowlist_sha256 !== binding.target.allowlistSha256) {
    throw new Error('Field review does not bind the connected approved target and allowlist');
  }
  const readers = normalizedIds(review.reader_ids, 'approved reader ids');
  const publicAuthors = normalizedIds(review.public_author_ids, 'approved Public author ids');
  const friendAuthors = normalizedIds(review.friend_author_ids, 'approved Friends author ids');
  if (review.ttl_days !== binding.ttlDays) throw new Error('Field review TTL does not match the manifest');
  const nowMs = now.getTime();
  const approvalExpiresAt = validIso(review.approval_expires_at, 'Approval', nowMs);
  const batchExpiresAt = validIso(review.batch_expires_at, 'Fixture batch', nowMs);
  if (Date.parse(batchExpiresAt) > nowMs + (binding.ttlDays * 86400000)) {
    throw new Error('Fixture batch expiry exceeds the approved manifest TTL');
  }
  const cleanupScope = [...new Set(review.cleanup_scope || [])].sort();
  exactArray(cleanupScope, [...CLEANUP_SCOPE].sort(), 'Cleanup scope');
  return {
    value: review,
    resolved,
    sha256: sha256(raw),
    readers,
    publicAuthors,
    friendAuthors,
    approvalExpiresAt,
    batchExpiresAt,
    cleanupScope,
  };
}

function approvalPlan(binding, review) {
  const value = {
    schema: 'cairnnz.o88-shanghai-approval.v2',
    batch_id: binding.batchId,
    manifest_sha256: binding.manifestSha256,
    field_review_sha256: review.sha256,
    target_fingerprint: binding.target.fingerprint,
    target_realm: binding.target.realm,
    target_allowlist_sha256: binding.target.allowlistSha256,
    reader_ids: review.readers,
    public_author_ids: review.publicAuthors,
    friend_author_ids: review.friendAuthors,
    ttl_days: binding.ttlDays,
    approval_expires_at: review.approvalExpiresAt,
    batch_expires_at: review.batchExpiresAt,
    cleanup_scope: review.cleanupScope,
  };
  const planSha256 = sha256(canonicalJson(value));
  return { ...value, plan_sha256: planSha256, owner_approval: `${binding.batchId}:${planSha256}` };
}

function readCleanupAuthorization(file, binding, now = new Date()) {
  if (!file) throw new Error('--cleanup-authorization is required before cleanup');
  const resolved = path.resolve(file);
  const raw = fs.readFileSync(resolved);
  const authorization = JSON.parse(raw.toString('utf8'));
  if (authorization.schema_version !== 1 || authorization.purpose !== 'cleanup-only') {
    throw new Error('Cleanup authorization must be schema version 1 and cleanup-only');
  }
  if (authorization.batch_id !== binding.batchId
    || authorization.manifest_sha256 !== binding.manifestSha256) {
    throw new Error('Cleanup authorization does not bind this exact batch and manifest');
  }
  if (authorization.target_fingerprint !== binding.target.fingerprint
    || authorization.target_realm !== binding.target.realm
    || authorization.target_allowlist_sha256 !== binding.target.allowlistSha256) {
    throw new Error('Cleanup authorization does not bind the connected approved target and allowlist');
  }
  const cleanupScope = [...new Set(authorization.cleanup_scope || [])].sort();
  exactArray(cleanupScope, [...CLEANUP_SCOPE].sort(), 'Cleanup scope');
  const expectedPrefix = `${binding.batchId}:`;
  if (typeof authorization.expected_activation_approval !== 'string'
    || !authorization.expected_activation_approval.startsWith(expectedPrefix)
    || !/^[a-f0-9]{64}$/.test(authorization.expected_activation_approval.slice(expectedPrefix.length))) {
    throw new Error('Cleanup authorization requires the exact original activation approval');
  }
  if (!authorization.authorized_by || !authorization.reason
    || !Number.isFinite(Date.parse(authorization.authorized_at))) {
    throw new Error('Cleanup authorization requires author, reason, and valid authorized_at');
  }
  const cleanupApprovalExpiresAt = validIso(
    authorization.cleanup_approval_expires_at,
    'Cleanup approval',
    now.getTime(),
  );
  return {
    value: authorization,
    resolved,
    sha256: sha256(raw),
    cleanupScope,
    expectedActivationApproval: authorization.expected_activation_approval,
    cleanupApprovalExpiresAt,
  };
}

function cleanupPlan(binding, authorization) {
  const value = {
    schema: 'cairnnz.o88-shanghai-cleanup.v1',
    batch_id: binding.batchId,
    manifest_sha256: binding.manifestSha256,
    cleanup_authorization_sha256: authorization.sha256,
    expected_activation_approval: authorization.expectedActivationApproval,
    target_fingerprint: binding.target.fingerprint,
    target_realm: binding.target.realm,
    target_allowlist_sha256: binding.target.allowlistSha256,
    cleanup_scope: authorization.cleanupScope,
    cleanup_approval_expires_at: authorization.cleanupApprovalExpiresAt,
  };
  const planSha256 = sha256(canonicalJson(value));
  return {
    ...value,
    plan_sha256: planSha256,
    cleanup_owner_approval: `${binding.batchId}:cleanup:${planSha256}`,
  };
}

function assertMutationAuthority(command, args, binding, review, plan) {
  if (args['confirm-batch'] !== binding.batchId) throw new Error('Exact --confirm-batch is required');
  if (args['confirm-target'] !== binding.target.fingerprint) {
    throw new Error(`Exact --confirm-target is required: ${binding.target.fingerprint}`);
  }
  if (args['owner-approval'] !== plan.owner_approval) {
    throw new Error(`Exact Owner approval is required: ${plan.owner_approval}`);
  }
  if (Date.parse(review.approvalExpiresAt) <= Date.now()) throw new Error('Owner approval has expired');
  if (binding.target.realm === 'production'
    && process.env.CAIRN_ENABLE_PRODUCTION_FIXTURE_APPLY !== '1') {
    throw new Error('Production fixture mutation is disabled by environment');
  }
  return binding.target;
}

function assertCleanupAuthority(args, binding, authorization, plan) {
  if (args['confirm-batch'] !== binding.batchId || args['confirm-cleanup'] !== binding.batchId) {
    throw new Error('Cleanup requires the exact batch id twice');
  }
  if (args['confirm-target'] !== binding.target.fingerprint) {
    throw new Error(`Exact --confirm-target is required: ${binding.target.fingerprint}`);
  }
  if (args['cleanup-owner-approval'] !== plan.cleanup_owner_approval) {
    throw new Error(`Exact cleanup Owner approval is required: ${plan.cleanup_owner_approval}`);
  }
  if (Date.parse(authorization.cleanupApprovalExpiresAt) <= Date.now()) {
    throw new Error('Cleanup Owner approval has expired');
  }
  if (binding.target.realm === 'production'
    && process.env.CAIRN_ENABLE_PRODUCTION_FIXTURE_CLEANUP !== '1') {
    throw new Error('Production fixture cleanup is disabled by environment');
  }
  return binding.target;
}

module.exports = {
  CLEANUP_SCOPE,
  approvalPlan,
  assertCleanupAuthority,
  assertMutationAuthority,
  canonicalJson,
  cleanupPlan,
  normalizedIds,
  readCleanupAuthorization,
  readFieldReview,
  readTargetAllowlist,
  resolveApprovedTarget,
  targetFingerprint,
};
