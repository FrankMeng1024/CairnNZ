'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_OBSERVATION_SPAN_MS,
  MAX_OBSERVATION_SPAN_MS,
  selectQualifyingEncounterEvidence,
} = require('../encounterPolicy');

function row(ts, overrides = {}) {
  return {
    id: ts,
    ts,
    evidence_source: 'activity_real',
    source_activity_client_id: '11111111-1111-4111-8111-111111111111',
    evidence_kind: 'presence_witness',
    ...overrides,
  };
}

test('one isolated observation and repeated identical timestamps do not qualify', () => {
  assert.equal(selectQualifyingEncounterEvidence([row(1_000)]), null);
  assert.equal(selectQualifyingEncounterEvidence([row(1_000), row(1_000, { id: 2 })]), null);
});

test('two accepted observations in one bounded real Activity context qualify', () => {
  const selected = selectQualifyingEncounterEvidence([
    row(1_000),
    row(1_000 + MIN_OBSERVATION_SPAN_MS),
  ]);
  assert.equal(Number(selected.ts), 1_000 + MIN_OBSERVATION_SPAN_MS);
});

test('a recent qualifying sequence is selected even when older evidence remains in the same Activity context', () => {
  const recentStart = 40 * 60 * 1000;
  const selected = selectQualifyingEncounterEvidence([
    row(1_000),
    row(recentStart),
    row(recentStart + 15_000),
  ]);
  assert.equal(Number(selected.ts), recentStart + 15_000);
});

test('different Activities, simulator claims, and unbounded stale spans cannot combine', () => {
  assert.equal(selectQualifyingEncounterEvidence([
    row(1_000),
    row(20_000, { source_activity_client_id: '22222222-2222-4222-8222-222222222222' }),
  ]), null);
  assert.equal(selectQualifyingEncounterEvidence([
    row(1_000, { evidence_source: 'simulator_test' }),
    row(20_000, { evidence_source: 'simulator_test' }),
  ]), null);
  assert.equal(selectQualifyingEncounterEvidence([
    row(1_000, { evidence_source: 'passive_real', source_activity_client_id: null }),
    row(1_000 + MAX_OBSERVATION_SPAN_MS + 1, { evidence_source: 'passive_real', source_activity_client_id: null }),
  ]), null);
});

test('unrelated source segments and authorization periods cannot be joined', () => {
  assert.equal(selectQualifyingEncounterEvidence([
    row(1_000, { source_segment_id: 'segment-a' }),
    row(20_000, { source_segment_id: 'segment-b' }),
  ]), null);
  assert.equal(selectQualifyingEncounterEvidence([
    row(1_000, { authorization_period_id: 'grant-a' }),
    row(20_000, { authorization_period_id: 'grant-b' }),
  ]), null);
});

test('stale duplicates, poor accuracy, and explicit continuity gaps cannot qualify', () => {
  assert.equal(selectQualifyingEncounterEvidence([
    row(1_000),
    row(20_000, { continuity_state: 'gap' }),
  ]), null);
  assert.equal(selectQualifyingEncounterEvidence([
    row(1_000),
    row(20_000, { horizontal_accuracy_m: 75 }),
  ]), null);
});

test('a coalesced witness first/latest pair remains two observations without fabricating visits', () => {
  const selected = selectQualifyingEncounterEvidence([
    row(10_000, { id: 7, evidence_source: 'passive_real', source_activity_client_id: null }),
    row(25_000, { id: 7, evidence_source: 'passive_real', source_activity_client_id: null }),
  ]);
  assert.equal(selected.id, 7);
  assert.equal(Number(selected.ts), 25_000);
});
