'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildOwnedCairnLibraryQuery,
  decodeCursor,
  encodeCursor,
} = require('../ownedCairnLibrary');

test('owner history query is always scoped to the authenticated owner', () => {
  const built = buildOwnedCairnLibraryQuery({
    userId: 71,
    limit: 40,
    query: '',
    cursor: null,
  });
  assert.match(built.sql, /WHERE user_id = \?/);
  assert.deepEqual(built.values, [71, 41]);
  assert.doesNotMatch(built.sql, /permission = 'public'|circle/);
});

test('the route takes owner identity only from authenticated request state', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../routes/markers.js'), 'utf8');
  const start = source.indexOf("router.get('/library'");
  const end = source.indexOf('// ── Get Public markers', start);
  const route = source.slice(start, end);
  assert.match(route, /userId: req\.user\.userId/);
  assert.doesNotMatch(route, /req\.(body|query)\.user/);
});

test('search covers owner history before stable pagination', () => {
  const cursor = { createdAt: new Date('2026-09-01T12:00:00.000Z'), id: 55 };
  const built = buildOwnedCairnLibraryQuery({
    userId: 71,
    limit: 20,
    query: 'ridge_100%',
    cursor,
  });
  assert.match(built.sql, /text LIKE \? ESCAPE/);
  assert.match(built.sql, /created_at < \? OR \(created_at = \? AND id < \?\)/);
  assert.deepEqual(built.values, [
    71,
    '%ridge\\_100\\%%',
    cursor.createdAt,
    cursor.createdAt,
    55,
    21,
  ]);
});

test('cursor round trip is deterministic and malformed cursors fail closed', () => {
  const row = { id: 55, created_at: '2026-09-01T12:00:00.000Z' };
  expectCursor(decodeCursor(encodeCursor(row)), new Date(row.created_at), 55);
  assert.throws(() => decodeCursor('not-a-cursor'), /invalid_cursor/);
});

test('same stable identity can converge newer pending content without moving its place', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../routes/markers.js'), 'utf8');
  const convergence = source.slice(
    source.indexOf('const sameImmutableFacts'),
    source.indexOf('await conn.commit();', source.indexOf('const sameImmutableFacts')),
  );
  assert.match(convergence, /stored\.client_cairn_id === client_cairn_id/);
  assert.match(convergence, /Number\(stored\.lat\) === Number\(lat\)/);
  assert.match(convergence, /Number\(stored\.lng\) === Number\(lng\)/);
  assert.match(convergence, /SET type = \?, text = \?, permission = \?, approximate = \?/);
  assert.doesNotMatch(convergence.slice(0, convergence.indexOf('const contentChanged')), /stored\.text ===/);
});

function expectCursor(actual, createdAt, id) {
  assert.equal(actual.id, id);
  assert.equal(actual.createdAt.toISOString(), createdAt.toISOString());
}
