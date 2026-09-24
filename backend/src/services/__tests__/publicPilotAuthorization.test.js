'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { publicPilotAuthorized } = require('../publicPublication');

function withEnvironment(values, fn) {
  const keys = Object.keys(values);
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try { fn(); } finally {
    for (const key of keys) {
      if (before[key] == null) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test('production Public pilot requires both the global gate and an exact numeric actor', () => {
  withEnvironment({
    NODE_ENV: 'production',
    CAIRN_REALM: null,
    ALLOW_ISOLATED_QA_SOURCE_CONTRACT: null,
    PUBLIC_CAIRN_PILOT_ENABLED: '1',
    PUBLIC_CAIRN_PILOT_USER_IDS: '19, 27,not-an-id',
  }, () => {
    assert.equal(publicPilotAuthorized(19), true);
    assert.equal(publicPilotAuthorized('27'), true);
    assert.equal(publicPilotAuthorized(20), false);
  });
});

test('allowlist alone and global gate alone both fail closed', () => {
  withEnvironment({
    NODE_ENV: 'production',
    PUBLIC_CAIRN_PILOT_ENABLED: '0',
    PUBLIC_CAIRN_PILOT_USER_IDS: '19',
  }, () => assert.equal(publicPilotAuthorized(19), false));
  withEnvironment({
    NODE_ENV: 'production',
    PUBLIC_CAIRN_PILOT_ENABLED: '1',
    PUBLIC_CAIRN_PILOT_USER_IDS: '',
  }, () => assert.equal(publicPilotAuthorized(19), false));
});

test('only the explicit isolated test realm may authorize dynamic harness actors', () => {
  withEnvironment({
    NODE_ENV: 'test',
    CAIRN_REALM: 'isolated_review',
    ALLOW_ISOLATED_QA_SOURCE_CONTRACT: '1',
    PUBLIC_CAIRN_PILOT_ENABLED: '1',
    PUBLIC_CAIRN_PILOT_USER_IDS: '',
  }, () => assert.equal(publicPilotAuthorized(9876), true));
});
