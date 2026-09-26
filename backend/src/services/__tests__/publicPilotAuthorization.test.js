'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { publicPilotAuthorized, publicPilotAuthorizedOwnerIds } = require('../publicPublication');

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

test('production Public pilot requires the global gate, a strict allowlist, and reviewed zones', () => {
  withEnvironment({
    NODE_ENV: 'production',
    CAIRN_REALM: null,
    ALLOW_ISOLATED_QA_SOURCE_CONTRACT: null,
    PUBLIC_CAIRN_PILOT_ENABLED: '1',
    PUBLIC_CAIRN_PILOT_USER_IDS: '19,27',
    PUBLIC_CAIRN_SENSITIVE_ZONES_JSON: '[{"lat":-41,"lng":174,"radius_m":100}]',
  }, () => {
    assert.equal(publicPilotAuthorized(19), true);
    assert.equal(publicPilotAuthorized('27'), true);
    assert.equal(publicPilotAuthorized(20), false);
    assert.deepEqual(publicPilotAuthorizedOwnerIds(), ['19', '27']);
  });
});

test('a partially malformed, duplicate, zero, or empty production allowlist fails closed', () => {
  for (const allowlist of ['19,27,garbage', '19,19', '0', '', '19, 27']) {
    withEnvironment({
      NODE_ENV: 'production',
      CAIRN_REALM: null,
      ALLOW_ISOLATED_QA_SOURCE_CONTRACT: null,
      PUBLIC_CAIRN_PILOT_ENABLED: '1',
      PUBLIC_CAIRN_PILOT_USER_IDS: allowlist,
      PUBLIC_CAIRN_SENSITIVE_ZONES_JSON: '[{"lat":-41,"lng":174,"radius_m":100}]',
    }, () => {
      assert.equal(publicPilotAuthorized(19), false, allowlist);
      assert.deepEqual(publicPilotAuthorizedOwnerIds(), [], allowlist);
    });
  }
});

test('allowlist alone and global gate alone both fail closed', () => {
  withEnvironment({
    NODE_ENV: 'production',
    PUBLIC_CAIRN_PILOT_ENABLED: '0',
    PUBLIC_CAIRN_PILOT_USER_IDS: '19',
    PUBLIC_CAIRN_SENSITIVE_ZONES_JSON: '[{"lat":-41,"lng":174,"radius_m":100}]',
  }, () => assert.equal(publicPilotAuthorized(19), false));
  withEnvironment({
    NODE_ENV: 'production',
    PUBLIC_CAIRN_PILOT_ENABLED: '1',
    PUBLIC_CAIRN_PILOT_USER_IDS: '',
    PUBLIC_CAIRN_SENSITIVE_ZONES_JSON: '[{"lat":-41,"lng":174,"radius_m":100}]',
  }, () => assert.equal(publicPilotAuthorized(19), false));
  withEnvironment({
    NODE_ENV: 'production',
    PUBLIC_CAIRN_PILOT_ENABLED: '1',
    PUBLIC_CAIRN_PILOT_USER_IDS: '19',
    PUBLIC_CAIRN_SENSITIVE_ZONES_JSON: null,
  }, () => assert.equal(publicPilotAuthorized(19), false));
});

test('only the explicit isolated test realm may authorize dynamic harness actors', () => {
  withEnvironment({
    NODE_ENV: 'test',
    CAIRN_REALM: 'isolated_review',
    ALLOW_ISOLATED_QA_SOURCE_CONTRACT: '1',
    PUBLIC_CAIRN_PILOT_ENABLED: '1',
    PUBLIC_CAIRN_PILOT_USER_IDS: '',
    PUBLIC_CAIRN_SENSITIVE_ZONES_JSON: '[]',
  }, () => {
    assert.equal(publicPilotAuthorized(9876), true);
    assert.equal(publicPilotAuthorizedOwnerIds(), null);
  });
});

test('the operational kill switch freezes moderation state instead of withdrawing an unchanged revision', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'publicPublication.js'), 'utf8');
  const disabled = source.slice(
    source.indexOf('if (!publicPilotAuthorized(ownerId))'),
    source.indexOf('if (!usefulPublicText(marker.text))'),
  );
  assert.match(disabled, /code: 'PUBLIC_PILOT_DISABLED'/);
  assert.match(disabled, /frozen: true/);
  assert.doesNotMatch(disabled, /withdrawPublication|UPDATE markers/);
});
