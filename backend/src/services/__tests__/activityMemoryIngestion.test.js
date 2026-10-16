'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCurrentActivityMemoryRows,
  canonicalActivityEvidence,
  recoverHistoricalActivityEvidence,
  upsertActivityMemoryRows,
} = require('../activityMemoryIngestion');

test('an empty client Memory batch is repaired from accepted canonical Activity evidence', () => {
  const result = buildCurrentActivityMemoryRows({
    userId: 7,
    clientActivityId: 'activity-a',
    memoryPoints: [],
    canonicalPoints: [
      { lat: -41.1, lng: 174.1, t: 1_000, acc: 8, segment_id: 'segment-a' },
      { lat: -41.1001, lng: 174.1001, t: 2_000, acc: 12, segment_id: 'segment-a' },
      { lat: -41.2, lng: 174.2, t: 3_000, acc: 75, segment_id: 'segment-a' },
    ],
    rawPoints: [],
    nowMs: 10_000,
  });
  assert.equal(result.rejected, 0);
  assert.equal(result.canonicalRecovered, 2);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every(row => row.derived_from_canonical));
  assert.ok(result.rows.every(row => row.source_activity_client_id === 'activity-a'));
  assert.ok(result.rows.every(row => row.continuity_state === 'accepted'));
});

test('canonical repair supplements but does not duplicate an overlapping client point', () => {
  const result = buildCurrentActivityMemoryRows({
    userId: 7,
    clientActivityId: 'activity-a',
    memoryPoints: [{
      lat: -41.1, lng: 174.1, ts: 1_000, cid: 'client-point',
      source_segment_id: 'segment-a', horizontal_accuracy_m: 8,
      continuity_state: 'accepted',
    }],
    canonicalPoints: [
      { lat: -41.1, lng: 174.1, t: 1_000, acc: 8, segment_id: 'segment-a' },
      { lat: -41.1001, lng: 174.1001, t: 2_000, acc: 8, segment_id: 'segment-a' },
    ],
    rawPoints: [],
    nowMs: 10_000,
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.filter(row => row.derived_from_canonical).length, 1);
  assert.equal(result.rows[0].client_id, 'client-point');
});

test('pre-canonical recovery uses raw GPS selected by accepted route time and segment', () => {
  const recovered = recoverHistoricalActivityEvidence(
    [{ lat: -41.0, lng: 174.0, t: 10_000, segment_id: 'segment-a' }],
    [{ lat: -41.001, lng: 174.002, t: 10_000, acc: 9, segment_id: 'segment-a' }],
    'pre_canonical_segmented',
  );
  assert.deepEqual(recovered, [{
    lat: -41.001,
    lng: 174.002,
    ts: 10_000,
    source_segment_id: 'segment-a',
    horizontal_accuracy_m: 9,
    continuity_state: 'accepted',
  }]);
});

test('legacy recovery requires independent accuracy and a five-metre raw GPS match', () => {
  const recovered = recoverHistoricalActivityEvidence(
    [
      { lat: -41, lng: 174, t: 10_000, accuracy: 8 },
      { lat: -41.1, lng: 174.1, t: 20_000, accuracy: 8 },
      { lat: -41.2, lng: 174.2, t: 30_000 },
    ],
    [
      { lat: -41.00001, lng: 174.00001, t: 10_000, accuracy: 9 },
      { lat: -41.101, lng: 174.101, t: 20_000, accuracy: 9 },
      { lat: -41.2, lng: 174.2, t: 30_000, accuracy: 9 },
    ],
    'legacy_exact',
  );
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].source_segment_id, 'legacy-0');
});

test('canonical evidence may inherit accuracy only from the same raw segment and location', () => {
  const recovered = canonicalActivityEvidence(
    [{ lat: -41, lng: 174, t: 1_000, segment_id: 'segment-a' }],
    [{ lat: -41, lng: 174, t: 1_000, acc: 6, segment_id: 'segment-a' }],
  );
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].horizontal_accuracy_m, 6);
});

test('database upsert keeps provenance repair and quality fields in one statement family', async () => {
  const calls = [];
  const conn = { query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 1 }]; } };
  const count = await upsertActivityMemoryRows(conn, [{
    user_id: 7, lat: -41, lng: 174, ts: 1_000, client_id: 'cid',
    source_activity_client_id: 'activity-a', source_segment_id: 'segment-a',
    horizontal_accuracy_m: 8, continuity_state: 'accepted',
  }]);
  assert.equal(count, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /evidence_source='activity_real'/);
  assert.match(calls[0].sql, /horizontal_accuracy_m=COALESCE/);
});
