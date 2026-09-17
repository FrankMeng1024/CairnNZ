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
