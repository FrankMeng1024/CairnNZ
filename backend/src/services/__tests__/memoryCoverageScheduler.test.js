'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scheduleCoverageMaterialization,
  _materializationJobs,
} = require('../memoryCoverage');

const turn = () => new Promise(resolve => setImmediate(resolve));

function cachedEmptyTileDb(onDistinct) {
  return {
    execute: async (sql) => {
      if (sql.includes('SELECT DISTINCT tile_x,tile_y')) {
        await onDistinct?.();
        return [[{ tile_x: 1, tile_y: 2 }]];
      }
      if (sql.includes('SELECT COUNT(*) AS evidence_count')) {
        return [[{ evidence_count: 0, evidence_max_id: 0 }]];
      }
      if (sql.includes('SELECT evidence_count,evidence_max_id,geometry_json')) {
        return [[{
          evidence_count: 0,
          evidence_max_id: 0,
          geometry_json: '{"type":"MultiPolygon","coordinates":[]}',
          geometry_sha256: 'empty',
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
    },
  };
}

test('coverage materialization coalesces an ingestion burst for one owner', async () => {
  let scans = 0;
  const db = cachedEmptyTileDb(() => { scans += 1; });
  for (let index = 0; index < 25; index += 1) {
    scheduleCoverageMaterialization(db, 41);
  }
  while (_materializationJobs.has('41')) await turn();
  assert.equal(scans, 1, 'the first pass observes every write committed before it starts');
});

test('a write arriving during a rebuild schedules one follow-up, never concurrent work', async () => {
  let scans = 0;
  let releaseFirst;
  let firstStartedResolve;
  const firstStarted = new Promise(resolve => { firstStartedResolve = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const db = cachedEmptyTileDb(async () => {
    scans += 1;
    if (scans === 1) {
      firstStartedResolve();
      await firstGate;
    }
  });

  scheduleCoverageMaterialization(db, 42);
  await firstStarted;
  scheduleCoverageMaterialization(db, 42);
  scheduleCoverageMaterialization(db, 42);
  releaseFirst();
  while (_materializationJobs.has('42')) await turn();
  assert.equal(scans, 2);
});
