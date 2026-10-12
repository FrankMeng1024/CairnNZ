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
                      THEN marker.text ELSE '' END AS text,
                 marker.lat, marker.lng, marker.alt, marker.permission, marker.approximate,
                 marker.public_snapshot, marker.public_intent, marker.public_state,
                 marker.publication_epoch, marker.content_revision,
                 COALESCE(moderation.state,'available') AS content_state,
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
};
