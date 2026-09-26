'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_LOCATION_GRID_DEGREES,
  locationPolicyVersion,
  parseSensitiveZones,
  evaluatePublicLocation,
  publicLocationPolicyConfigured,
} = require('../publicLocationPolicy');

test('Public snapshots use a bounded coarse cell rather than the exact owner pin', () => {
  const exact = { lat: -41.28671, lng: 174.77631 };
  const result = evaluatePublicLocation(exact.lat, exact.lng, []);
  assert.equal(result.allowed, true);
  assert.equal(result.approximate, true);
  assert.ok(Math.abs(result.lat - exact.lat) <= PUBLIC_LOCATION_GRID_DEGREES / 2 + 1e-9);
  assert.ok(Math.abs(result.lng - exact.lng) <= PUBLIC_LOCATION_GRID_DEGREES / 2 + 1e-9);
  assert.equal(Math.abs(result.lat / PUBLIC_LOCATION_GRID_DEGREES - Math.round(result.lat / PUBLIC_LOCATION_GRID_DEGREES)) < 1e-8, true);
  assert.equal(Math.abs(result.lng / PUBLIC_LOCATION_GRID_DEGREES - Math.round(result.lng / PUBLIC_LOCATION_GRID_DEGREES)) < 1e-8, true);
});

test('missing, blank, and malformed deployment policies fail closed', () => {
  const prior = process.env.PUBLIC_CAIRN_SENSITIVE_ZONES_JSON;
  try {
    delete process.env.PUBLIC_CAIRN_SENSITIVE_ZONES_JSON;
    assert.equal(publicLocationPolicyConfigured(), false);
    process.env.PUBLIC_CAIRN_SENSITIVE_ZONES_JSON = '   ';
    assert.equal(publicLocationPolicyConfigured(), false);
    process.env.PUBLIC_CAIRN_SENSITIVE_ZONES_JSON = '{bad';
    assert.equal(publicLocationPolicyConfigured(), false);
    process.env.PUBLIC_CAIRN_SENSITIVE_ZONES_JSON = '[]';
    assert.equal(publicLocationPolicyConfigured(), false);
  } finally {
    if (prior === undefined) delete process.env.PUBLIC_CAIRN_SENSITIVE_ZONES_JSON;
    else process.env.PUBLIC_CAIRN_SENSITIVE_ZONES_JSON = prior;
  }
});

test('policy identity is canonical and changes with reviewed zone content', () => {
  const left = parseSensitiveZones('[{"lat":-41,"lng":174,"radius_m":100},{"lat":-42,"lng":173,"radius_m":50}]');
  const reordered = parseSensitiveZones('[{"lat":-42,"lng":173,"radius_m":50},{"lat":-41,"lng":174,"radius_m":100}]');
  const changed = parseSensitiveZones('[{"lat":-42,"lng":173,"radius_m":51},{"lat":-41,"lng":174,"radius_m":100}]');
  assert.equal(locationPolicyVersion(left), locationPolicyVersion(reordered));
  assert.notEqual(locationPolicyVersion(left), locationPolicyVersion(changed));
});

test('coarsening cannot move an allowed exact pin into a denied cell', () => {
  const zones = parseSensitiveZones('[{"lat":-41.0000,"lng":174.0000,"radius_m":5}]');
  const result = evaluatePublicLocation(-41.00009, 174.00009, zones);
  assert.deepEqual(result, { allowed: false, code: 'PUBLIC_SENSITIVE_PLACE_EXCLUDED' });
});

test('configured sensitive circles deny publication and malformed policy fails closed', () => {
  const zones = parseSensitiveZones('[{"lat":-41.2867,"lng":174.7763,"radius_m":250}]');
  assert.deepEqual(evaluatePublicLocation(-41.2868, 174.7764, zones), {
    allowed: false,
    code: 'PUBLIC_SENSITIVE_PLACE_EXCLUDED',
  });
  assert.throws(() => parseSensitiveZones('{bad json'), /public_sensitive_zone_config_invalid/);
  assert.throws(
    () => parseSensitiveZones('[{"lat":91,"lng":0,"radius_m":100}]'),
    /public_sensitive_zone_config_invalid/,
  );
});
