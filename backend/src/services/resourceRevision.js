'use strict';

const crypto = require('node:crypto');

const SHARED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function resourceRevision(kind, row) {
  const revision = Number(row.content_revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(`Missing ${kind} content revision`);
  }
  return crypto.createHash('sha256')
    .update(`${kind}:${row.id}:content:${revision}`)
    .digest('hex');
}

function sharedContentMetadata(kind, row, issuedAt = new Date()) {
  const ordinaryExpiry = new Date(issuedAt.getTime() + SHARED_CACHE_TTL_MS);
  const fixtureExpiry = row?.qa_expires_at == null ? null : new Date(row.qa_expires_at);
  const expiresAt = fixtureExpiry && Number.isFinite(fixtureExpiry.getTime())
    ? new Date(Math.min(ordinaryExpiry.getTime(), fixtureExpiry.getTime()))
    : ordinaryExpiry;
  const fixtureAuthority = row?.qa_batch_id
    ? `:qa:${row.qa_batch_id}:${expiresAt.toISOString()}` : '';
  return {
    resource_revision: resourceRevision(kind, row),
    authorization_revision: `friendship:${row.friendship_episode_id}:audience:${row.audience_epoch}${fixtureAuthority}`,
    authorization_issued_at: issuedAt.toISOString(),
    authorization_expires_at: expiresAt.toISOString(),
  };
}

module.exports = {
  SHARED_CACHE_TTL_MS,
  resourceRevision,
  sharedContentMetadata,
};
