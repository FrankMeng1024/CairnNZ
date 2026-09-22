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
  assertLiteralLimitContract(built, 41);
  assert.deepEqual(built.values, [71]);
  assert.doesNotMatch(built.sql, /permission = 'public'|circle/);
});

test('restoring the old prepared LIMIT placeholder fails the literal contract', () => {
  const fixed = buildOwnedCairnLibraryQuery({ userId: 71, limit: 40, query: '', cursor: null });
  const oldShape = {
    sql: fixed.sql.replace(/LIMIT 41$/, 'LIMIT ?'),
    values: [...fixed.values, 41],
  };
  assert.throws(() => assertLiteralLimitContract(oldShape, 41));
});

test('owner history limit is an independently validated bounded integer literal', () => {
  for (const limit of [0, 101, 1.5, NaN, Infinity, '40', '1 OR 1=1']) {
    assert.throws(() => buildOwnedCairnLibraryQuery({
      userId: 71,
      limit,
      query: '',
      cursor: null,
    }), /invalid_limit/, `invalid limit ${String(limit)}`);
  }
  const one = buildOwnedCairnLibraryQuery({ userId: 71, limit: 1, query: '', cursor: null });
  const hundred = buildOwnedCairnLibraryQuery({ userId: 71, limit: 100, query: '', cursor: null });
  assert.match(one.sql, /LIMIT 2$/);
  assert.match(hundred.sql, /LIMIT 101$/);
  assert.deepEqual(one.values, [71]);
  assert.deepEqual(hundred.values, [71]);
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
  ]);
  assertLiteralLimitContract(built, 21);
  assert.doesNotMatch(built.sql, /ridge_100%|LIMIT \?/);
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

test('library route paginates owner rows and preserves server plus client identities', async () => {
  const pool = require('../../config/db');
  const originalExecute = pool.execute;
  const calls = [];
  const rows = [
    markerRow(73, '33333333-3333-4333-8333-333333333333', '2026-09-03T00:00:00.000Z'),
    markerRow(72, '22222222-2222-4222-8222-222222222222', '2026-09-02T00:00:00.000Z'),
    markerRow(71, '11111111-1111-4111-8111-111111111111', '2026-09-01T00:00:00.000Z'),
  ];
  pool.execute = async (sql, values) => {
    calls.push({ sql, values });
    assert.match(sql, /WHERE user_id = \?/);
    assert.match(sql, /LIMIT 3$/);
    assert.doesNotMatch(sql, /LIMIT \?/);
    assert.deepEqual(values, [71]);
    return [rows];
  };
  const handler = libraryRouteHandler();
  try {
    const res = responseRecorder();
    await handler({ user: { userId: 71 }, query: { limit: '2', user: '999' } }, res);
    assert.equal(calls.length, 1);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.has_more, true);
    assert.equal(typeof res.body.next_cursor, 'string');
    assert.deepEqual(res.body.markers.map(row => ({ id: row.id, client: row.client_cairn_id })), [
      { id: 73, client: '33333333-3333-4333-8333-333333333333' },
      { id: 72, client: '22222222-2222-4222-8222-222222222222' },
    ]);
  } finally {
    pool.execute = originalExecute;
    delete require.cache[require.resolve('../../routes/markers')];
  }
});

test('library route retains escaped search and cursor binds under the authenticated owner', async () => {
  const pool = require('../../config/db');
  const originalExecute = pool.execute;
  const cursorDate = new Date('2026-09-01T12:00:00.000Z');
  const cursor = encodeCursor({ id: 55, created_at: cursorDate });
  let calls = 0;
  pool.execute = async (sql, values) => {
    calls += 1;
    assert.match(sql, /text LIKE \? ESCAPE/);
    assert.match(sql, /created_at < \? OR \(created_at = \? AND id < \?\)/);
    assert.match(sql, /LIMIT 21$/);
    assert.doesNotMatch(sql, /ridge_100%|LIMIT \?/);
    assert.deepEqual(values, [71, '%ridge\\_100\\%%', cursorDate, cursorDate, 55]);
    return [[markerRow(54, '54545454-5454-4454-8454-545454545454', '2026-08-31T00:00:00.000Z')]];
  };
  const handler = libraryRouteHandler();
  try {
    const res = responseRecorder();
    await handler({
      user: { userId: 71 },
      query: { limit: '20', q: '  ridge_100%  ', cursor, user: '999' },
    }, res);
    assert.equal(calls, 1);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.has_more, false);
    assert.deepEqual(res.body.markers.map(row => [row.id, row.client_cairn_id]), [
      [54, '54545454-5454-4454-8454-545454545454'],
    ]);
  } finally {
    pool.execute = originalExecute;
    delete require.cache[require.resolve('../../routes/markers')];
  }
});

test('invalid library limit or cursor returns 400 without a database query', async () => {
  const pool = require('../../config/db');
  const originalExecute = pool.execute;
  let calls = 0;
  pool.execute = async () => { calls += 1; return [[]]; };
  const handler = libraryRouteHandler();
  try {
    for (const query of [
      { limit: '1.5' },
      { limit: '1 OR 1=1' },
      { limit: '40', cursor: 'not-a-cursor' },
    ]) {
      const res = responseRecorder();
      await handler({ user: { userId: 71 }, query }, res);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(calls, 0);
  } finally {
    pool.execute = originalExecute;
    delete require.cache[require.resolve('../../routes/markers')];
  }
});

function expectCursor(actual, createdAt, id) {
  assert.equal(actual.id, id);
  assert.equal(actual.createdAt.toISOString(), createdAt.toISOString());
}

function libraryRouteHandler() {
  delete require.cache[require.resolve('../../routes/markers')];
  const router = require('../../routes/markers');
  const layer = router.stack.find(item => item.route?.path === '/library' && item.route.methods.get);
  assert.ok(layer, 'library route');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function markerRow(id, clientCairnId, createdAt) {
  return {
    id,
    user_id: 71,
    client_cairn_id: clientCairnId,
    text: `Owned ${id}`,
    created_at: createdAt,
  };
}

function assertLiteralLimitContract(built, fetchLimit) {
  assert.match(built.sql, new RegExp(`LIMIT ${fetchLimit}$`));
  assert.doesNotMatch(built.sql, /LIMIT \?/);
  assert.equal((built.sql.match(/\?/g) || []).length, built.values.length);
}
