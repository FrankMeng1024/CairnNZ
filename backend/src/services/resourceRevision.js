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
  return {
    resource_revision: resourceRevision(kind, row),
    authorization_revision: `friendship:${row.friendship_episode_id}:audience:${row.audience_epoch}`,
    authorization_issued_at: issuedAt.toISOString(),
    authorization_expires_at: new Date(issuedAt.getTime() + SHARED_CACHE_TTL_MS).toISOString(),
  };
}

module.exports = {
  SHARED_CACHE_TTL_MS,
  resourceRevision,
  sharedContentMetadata,
};
