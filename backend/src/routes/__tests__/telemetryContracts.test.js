'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.resolve(__dirname, '../telemetry.js'), 'utf8');

test('telemetry upload rejects anonymous callers and delegates Bearer auth', () => {
  assert.match(route, /function requireUploadAuth[\s\S]*hasValidApiKey\(req\)[\s\S]*authenticate\(req, res, next\)/);
  assert.match(route, /router\.post\('\/sessions', uploadLimiter, requireUploadAuth/);
  assert.doesNotMatch(route, /function requireApiKey\(req, res, next\)\s*\{\s*next\(\);\s*\}/);
});

test('telemetry retrieval is operations-only and fails closed without a server key', () => {
  assert.match(route, /function requireReadApiKey[\s\S]*CAIRN_TELEMETRY_API_KEY[\s\S]*status\(503\)/);
  assert.match(route, /router\.get\('\/sessions', readLimiter, requireReadApiKey/);
  assert.match(route, /router\.get\('\/sessions\/:session_id', readLimiter, requireReadApiKey/);
  assert.match(route, /crypto\.timingSafeEqual/);
});

test('QA rows are sanitized before storage and expire without touching other telemetry', () => {
  assert.ok(route.indexOf('sanitizeQaJsonl(rawJsonl)') < route.indexOf('INSERT INTO telemetry_sessions'));
  assert.match(route, /WHERE activity_mode = 'qa_activity'/);
  assert.match(route, /INTERVAL \$\{QA_RETENTION_DAYS\} DAY/);
});
