'use strict';

function positiveId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function mysqlUtcCursorTimestamp(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
  const pad = (part, width = 2) => String(part).padStart(width, '0');
  // The shared mysql2 pool sets timezone: 'Z'. DATETIME values therefore
  // arrive as Date instances whose UTC components are the original MySQL
  // wall-clock fields. Local getters would shift a 00:00 database value to
  // 08:00 on a Shanghai host and make a keyset cursor repeat the first page.
  return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
    + ` ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
    + `.${pad(value.getUTCMilliseconds(), 3)}`;
}

function encodeLibraryCursor(row, timestampField) {
  const sortAt = mysqlUtcCursorTimestamp(row?.[timestampField]);
  if (!sortAt) throw new Error('library_cursor_timestamp_invalid');
  return Buffer.from(JSON.stringify({ v: 1, sort_at: sortAt, marker_id: String(row.marker_id) }))
    .toString('base64url');
}

function decodeLibraryCursor(value) {
  if (value == null || value === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    const markerId = positiveId(parsed?.marker_id);
    const sortAt = parsed?.sort_at;
    if (parsed?.v !== 1 || !markerId
      || typeof sortAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(sortAt)
      || !Number.isFinite(new Date(`${sortAt.replace(' ', 'T')}Z`).getTime())) return undefined;
    return { markerId, sortAt };
  } catch {
    return undefined;
  }
}

module.exports = {
  decodeLibraryCursor,
  encodeLibraryCursor,
  mysqlUtcCursorTimestamp,
};
