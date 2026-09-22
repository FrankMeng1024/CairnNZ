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
  const where = ['user_id = ?'];
  const values = [userId];
  if (query) {
    where.push("text LIKE ? ESCAPE '\\\\'");
    values.push(`%${escapeLike(query)}%`);
  }
  if (cursor) {
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    values.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  return {
    sql: `SELECT id, user_id, client_cairn_id, origin_activity_client_id, origin_session_id,
                 type, text, lat, lng, alt, permission, approximate, public_snapshot,
                 public_intent, public_state, publication_epoch, content_revision,
                 created_at, updated_at
          FROM markers
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT ${fetchLimit}`,
    values,
  };
}

module.exports = {
  buildOwnedCairnLibraryQuery,
  decodeCursor,
  encodeCursor,
};
