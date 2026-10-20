'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schemas = require('../schemas');

const base = {
  type: 'hut',
  text: '',
  lat: -43.595,
  lng: 170.142,
  permission: 'personal',
  approximate: false,
};

test('Plant create and enrichment accept the client hut type', () => {
  assert.equal(schemas.marker.create.validate(base).error, undefined);
  assert.equal(schemas.marker.update.validate({ type: 'hut' }).error, undefined);
});

test('Plant location remains immutable through the generic edit endpoint', () => {
  assert.ok(schemas.marker.update.validate({ lat: base.lat, lng: base.lng }).error);
});

test('Plant accepts a complete capture-time provenance tuple', () => {
  const result = schemas.marker.create.validate({
    ...base,
    placement_accuracy_m: 4.25,
    placement_observed_at: '2026-10-20T08:10:11.123Z',
    placement_source: 'gps_window',
    placement_sample_count: 8,
  });
  assert.equal(result.error, undefined);
});

test('Plant rejects partial, simulated, and implausibly inaccurate provenance', () => {
  assert.ok(schemas.marker.create.validate({
    ...base,
    placement_accuracy_m: 4.25,
  }).error);
  assert.ok(schemas.marker.create.validate({
    ...base,
    placement_accuracy_m: 5,
    placement_observed_at: '2026-10-20T08:10:11.123Z',
    placement_source: 'simulator_test',
    placement_sample_count: 1,
  }).error);
  assert.ok(schemas.marker.create.validate({
    ...base,
    placement_accuracy_m: 101,
    placement_observed_at: '2026-10-20T08:10:11.123Z',
    placement_source: 'activity',
    placement_sample_count: 1,
  }).error);
});
