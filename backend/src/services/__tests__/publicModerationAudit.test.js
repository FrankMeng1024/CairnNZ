'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePublicationTransition,
  resolveReportTransition,
  appendPublicModerationAudit,
} = require('../publicModerationAudit');

test('publication transitions are guarded and same-target retries are idempotent', () => {
  assert.deepEqual(resolvePublicationTransition('pending', 'approve'), {
    allowed: true, idempotent: false, nextState: 'published',
  });
  assert.deepEqual(resolvePublicationTransition('published', 'approve', 'approve'), {
    allowed: true, idempotent: true, nextState: 'published',
  });
  assert.deepEqual(resolvePublicationTransition('published', 'restore', 'approve'), {
    allowed: false, idempotent: false, nextState: 'published',
  });
  assert.deepEqual(resolvePublicationTransition('published', 'restore', 'restore'), {
    allowed: true, idempotent: true, nextState: 'published',
  });
  assert.equal(resolvePublicationTransition('rejected', 'approve').allowed, false);
  assert.equal(resolvePublicationTransition('pending', 'restore').allowed, false);
  assert.equal(resolvePublicationTransition('published', 'suspend').allowed, true);
  assert.equal(resolvePublicationTransition('suspended', 'restore').allowed, true);
});

test('audit metadata accepts only the bounded decision action schema', async () => {
  const calls = [];
  const conn = { execute: async (...args) => { calls.push(args); return [{ insertId: 7 }]; } };
  await appendPublicModerationAudit(conn, {
    eventType: 'publication_decision',
    metadata: { action: 'approve' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][11], '{"action":"approve"}');
  await assert.rejects(
    appendPublicModerationAudit(conn, {
      eventType: 'publication_decision',
      metadata: { action: 'approve', text: 'must not persist' },
    }),
    /public_audit_metadata_invalid/,
  );
  await assert.rejects(
    appendPublicModerationAudit(conn, {
      eventType: 'report_submitted',
      metadata: { coordinates: [-41, 174] },
    }),
    /public_audit_metadata_invalid/,
  );
  const versionA = `grid-20m+deny-circles-v1:sha256:${'a'.repeat(64)}`;
  const versionB = `grid-20m+deny-circles-v1:sha256:${'b'.repeat(64)}`;
  await appendPublicModerationAudit(conn, {
    eventType: 'publication_policy_resnapshotted',
    metadata: {
      previousPublicationId: '17',
      previousPolicyVersion: versionA,
      locationPolicyVersion: versionB,
      previousSnapshotSha256: 'c'.repeat(64),
      snapshotSha256: 'd'.repeat(64),
    },
  });
  assert.deepEqual(JSON.parse(calls[1][1][11]), {
    previousPublicationId: '17',
    previousPolicyVersion: versionA,
    locationPolicyVersion: versionB,
    previousSnapshotSha256: 'c'.repeat(64),
    snapshotSha256: 'd'.repeat(64),
  });
  await assert.rejects(
    appendPublicModerationAudit(conn, {
      eventType: 'publication_policy_resnapshotted',
      metadata: {
        previousPublicationId: '17',
        previousPolicyVersion: versionA,
        locationPolicyVersion: versionB,
        previousSnapshotSha256: 'c'.repeat(64),
        snapshotSha256: 'd'.repeat(64),
        coordinates: [-41, 174],
      },
    }),
    /public_audit_metadata_invalid/,
  );
});

test('report dispositions cannot rewrite terminal states', () => {
  assert.equal(resolveReportTransition('pending', 'reviewed').allowed, true);
  assert.equal(resolveReportTransition('reviewed', 'actioned').allowed, true);
  assert.equal(resolveReportTransition('actioned', 'reviewed').allowed, false);
  assert.equal(resolveReportTransition('dismissed', 'actioned').allowed, false);
  assert.deepEqual(resolveReportTransition('actioned', 'actioned'), {
    allowed: true, idempotent: true, nextState: 'actioned',
  });
});
