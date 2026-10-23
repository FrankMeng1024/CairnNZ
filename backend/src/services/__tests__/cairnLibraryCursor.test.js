'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeLibraryCursor,
  encodeLibraryCursor,
  mysqlUtcCursorTimestamp,
} = require('../cairnLibraryCursor');

test('library cursors preserve mysql2 UTC DATETIME fields on a non-UTC host', () => {
  const databaseMidnight = new Date('2026-01-01T00:00:00.002Z');

  assert.equal(mysqlUtcCursorTimestamp(databaseMidnight), '2026-01-01 00:00:00.002');
  assert.deepEqual(
    decodeLibraryCursor(encodeLibraryCursor({
      marker_id: 2103,
      acquired_at: databaseMidnight,
    }, 'acquired_at')),
    { markerId: 2103, sortAt: '2026-01-01 00:00:00.002' },
  );
});

test('library cursors reject malformed timestamps and marker identities', () => {
  assert.equal(mysqlUtcCursorTimestamp('2026-01-01'), null);
  assert.throws(
    () => encodeLibraryCursor({ marker_id: 1, acquired_at: 'not-a-date' }, 'acquired_at'),
    /library_cursor_timestamp_invalid/,
  );
  assert.equal(decodeLibraryCursor(Buffer.from(JSON.stringify({
    v: 1,
    sort_at: '2026-01-01T00:00:00.002Z',
    marker_id: '2103',
  })).toString('base64url')), undefined);
  assert.equal(decodeLibraryCursor(Buffer.from(JSON.stringify({
    v: 1,
    sort_at: '2026-01-01 00:00:00.002',
    marker_id: '0',
  })).toString('base64url')), undefined);
});
