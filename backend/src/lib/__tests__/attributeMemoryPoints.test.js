'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scheduleMemoryAttribution,
  scheduleMemoryProjectionReset,
} = require('../attributeMemoryPoints');

const turn = () => new Promise((resolve) => setImmediate(resolve));

test('scheduled attribution returns immediately and coalesces a user range', async () => {
  const calls = [];
  const conn = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [[]];
    },
  };

  assert.equal(scheduleMemoryAttribution(conn, 91001, 100, 200), true);
  assert.equal(scheduleMemoryAttribution(conn, 91001, 50, 300), true);
  assert.equal(calls.length, 0);
  await turn();
  await turn();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [91001, 50, 300]);
});

test('reset fences an in-flight attribution before post-reset evidence', async () => {
  const calls = [];
  let releaseFirst;
  const firstResult = new Promise((resolve) => { releaseFirst = resolve; });
  const conn = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length === 1) return firstResult;
      return [[]];
    },
  };

  scheduleMemoryAttribution(conn, 91002, 100, 200);
  await turn();
  scheduleMemoryProjectionReset(conn, 91002);
  scheduleMemoryAttribution(conn, 91002, 400, 500);
  releaseFirst([[]]);
  await turn();
  await turn();
  await turn();

  assert.match(calls[1].sql, /DELETE FROM unlocked_regions/);
  assert.deepEqual(calls[2].params, [91002, 400, 500]);
});
