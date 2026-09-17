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
  values.push(limit + 1);
  return {
    sql: `SELECT id, user_id, client_cairn_id, origin_activity_client_id, origin_session_id,
                 type, text, lat, lng, alt, permission, approximate, public_snapshot,
                 created_at, updated_at
          FROM markers
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
    values,
  };
}

module.exports = {
  buildOwnedCairnLibraryQuery,
  decodeCursor,
  encodeCursor,
};
