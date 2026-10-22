'use strict';

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({
    createdAt: new Date(row.created_at).toISOString(),
    id: Number(row.id),
  })).toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid_cursor');
  }
  const date = new Date(parsed?.createdAt);
  const id = Number(parsed?.id);
  if (!Number.isFinite(date.getTime()) || !Number.isSafeInteger(id) || id < 1) {
    throw new Error('invalid_cursor');
  }
  return { createdAt: date, id };
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, char => `\\${char}`);
}

const logicalRevisionStateSql = `CASE
  WHEN EXISTS (
    SELECT 1 FROM cairn_revisions revision_state
     WHERE revision_state.marker_id=marker.id
       AND revision_state.content_revision=marker.content_revision
       AND revision_state.availability='removed'
  ) THEN 'removed'
  WHEN EXISTS (
    SELECT 1 FROM cairn_revisions revision_state
     WHERE revision_state.marker_id=marker.id
       AND revision_state.content_revision=marker.content_revision
       AND revision_state.availability='under_review'
  ) THEN 'under_review'
  WHEN EXISTS (
    SELECT 1 FROM cairn_revisions revision_state
     WHERE revision_state.marker_id=marker.id
       AND revision_state.content_revision=marker.content_revision
       AND revision_state.availability='unavailable'
  ) THEN 'unavailable'
  ELSE 'available' END`;

function buildOwnedCairnLibraryQuery({ userId, limit, query, cursor }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('invalid_limit');
  }
  // mysql2's prepared-statement encoder sends every JavaScript Number as a
  // DOUBLE. MySQL 8 rejects a DOUBLE parameter in LIMIT even when the value is
  // integral, so interpolate only this independently validated integer. All
  // user/content/cursor data remains bound below.
  const fetchLimit = limit + 1;
  const where = ['marker.user_id = ?'];
  const values = [userId];
  if (query) {
    where.push("marker.text LIKE ? ESCAPE '\\\\'");
    values.push(`%${escapeLike(query)}%`);
  }
  if (cursor) {
    where.push('(marker.created_at < ? OR (marker.created_at = ? AND marker.id < ?))');
    values.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  return {
    sql: `SELECT marker.id, marker.user_id, marker.client_cairn_id,
                 marker.origin_activity_client_id, marker.origin_session_id,
                 marker.type,
                 CASE WHEN COALESCE(moderation.state,'available')='available'
                           AND (${logicalRevisionStateSql})='available'
                      THEN marker.text ELSE '' END AS text,
                 marker.lat, marker.lng, marker.alt, marker.permission, marker.approximate,
                 marker.public_snapshot, marker.public_intent, marker.public_state,
                 marker.publication_epoch, marker.content_revision,
                 marker.placement_accuracy_m, marker.placement_observed_at,
                 marker.placement_source, marker.placement_sample_count,
                 CASE WHEN COALESCE(moderation.state,'available')<>'available'
                      THEN moderation.state ELSE (${logicalRevisionStateSql}) END AS content_state,
                 (SELECT COUNT(*)
                    FROM cairn_acquisitions thanked
                    JOIN cairn_revisions thanked_revision
                      ON thanked_revision.id=thanked.cairn_revision_id
                   WHERE thanked.marker_id=marker.id
                     AND thanked.viewer_id<>marker.user_id
                     AND thanked.thanked_at IS NOT NULL
                     AND thanked.removed_at IS NULL
                     AND thanked_revision.availability='available') AS thanks_count,
                 marker.created_at, marker.updated_at
          FROM markers marker
          LEFT JOIN cairn_source_moderation moderation ON moderation.marker_id=marker.id
          WHERE ${where.join(' AND ')}
          ORDER BY marker.created_at DESC, marker.id DESC
          LIMIT ${fetchLimit}`,
    values,
  };
}

module.exports = {
  buildOwnedCairnLibraryQuery,
  decodeCursor,
  encodeCursor,
  logicalRevisionStateSql,
};
