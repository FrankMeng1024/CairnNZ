'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_QA_EVENTS,
  MAX_QA_PAYLOAD_BYTES,
  sanitizeQaEvent,
  sanitizeQaJsonl,
} = require('../qaTelemetryPrivacy');

test('synthetic coordinates survive while credential-shaped data is removed', () => {
  const safe = sanitizeQaEvent({
    session_id: 'qa-synthetic',
    coordinateSource: 'simulator',
    fields: {
      lat: -45.0312,
      lng: 168.6626,
      coordinates: [168.6626, -45.0312],
      password: 'never-store-this',
      nested: { authorization: 'Bearer secret', accuracyM: 5 },
      message: 'user qa@example.invalid Bearer abc.def.ghi',
    },
  });
  assert.equal(safe.fields.lat, -45.0312);
  assert.equal(safe.fields.lng, 168.6626);
  assert.deepEqual(safe.fields.coordinates, [168.6626, -45.0312]);
  assert.equal(safe.fields.password, undefined);
  assert.equal(safe.fields.nested.authorization, undefined);
  assert.equal(safe.fields.nested.accuracyM, 5);
  assert.doesNotMatch(JSON.stringify(safe), /qa@example|abc\.def\.ghi|never-store-this/);
});

test('real and unknown coordinate-shaped data is removed recursively', () => {
  for (const coordinateSource of ['real', 'none', undefined]) {
    const safe = sanitizeQaEvent({
      session_id: 'qa-real',
      coordinateSource,
      fields: {
        lat: -36.8485,
        longitude: 174.7633,
        cameraTarget: { lat: -36.8485, lng: 174.7633 },
        path: [[174.7633, -36.8485]],
        accuracyM: 8,
        message: 'lat=-36.848500 lng=174.763300 or -36.848500, 174.763300',
      },
    });
    const stored = JSON.stringify(safe);
    assert.equal(safe.fields.accuracyM, 8);
    assert.doesNotMatch(stored, /-36\.8485|174\.7633/);
  }
});

test('QA JSONL is validated, sanitized, and bounded', () => {
  const result = sanitizeQaJsonl([
    JSON.stringify({ session_id: 'qa-one', coordinateSource: 'real', fields: { lat: 1.23456, lng: 2.34567 } }),
    JSON.stringify({ session_id: 'qa-one', coordinateSource: 'simulator', fields: { lat: 3.45678, lng: 4.56789 } }),
  ].join('\n'));
  assert.equal(result.eventsCount, 2);
  assert.doesNotMatch(result.jsonl, /1\.23456|2\.34567/);
  assert.match(result.jsonl, /3\.45678/);
  assert.throws(() => sanitizeQaJsonl('{bad'), { code: 'QA_JSONL_INVALID' });
  assert.throws(
    () => sanitizeQaJsonl(`${'x'.repeat(MAX_QA_PAYLOAD_BYTES + 1)}`),
    { code: 'QA_PAYLOAD_TOO_LARGE' },
  );
  const tooMany = Array.from({ length: MAX_QA_EVENTS + 1 }, () => '{}').join('\n');
  assert.throws(() => sanitizeQaJsonl(tooMany), { code: 'QA_EVENT_LIMIT' });
});
