'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadCoverageSnapshotPage,
  parseSnapshotCursor,
} = require('../memoryCoverage');

const region = {
  id: 'nz-wellington', parent_id: 'nz', level: 3, name_en: 'Wellington',
  bbox_min_lng: 174.6, bbox_min_lat: -41.4,
  bbox_max_lng: 174.9, bbox_max_lat: -41.1,
  anchor_lng: 174.7762, anchor_lat: -41.2865,
};

function snapshotDb({ revision = 9, revisionAfter = revision } = {}) {
  let stateReads = 0;
  const tiles = [
    { tile_x: 1, tile_y: 2, evidence_count: 3, evidence_max_id: 30 },
    { tile_x: 3, tile_y: 4, evidence_count: 2, evidence_max_id: 40 },
  ];
  const geometries = new Map(tiles.map(tile => [
    `${tile.tile_x}:${tile.tile_y}`,
    { type: 'MultiPolygon', coordinates: [[[[tile.tile_x, tile.tile_y], [tile.tile_x + 0.1, tile.tile_y], [tile.tile_x, tile.tile_y + 0.1], [tile.tile_x, tile.tile_y]]]] },
  ]));
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('GROUP BY evidence.tile_x,evidence.tile_y') && !sql.includes('BETWEEN')) return [tiles];
      if (sql.includes('SELECT evidence_revision')) {
        stateReads += 1;
        return [[{ evidence_revision: stateReads > 1 ? revisionAfter : revision }]];
      }
      if (sql.includes('ROW_NUMBER() OVER')) return [[region]];
      if (sql.includes('FROM memory_coverage_tiles')) {
        const x = Number(params.at(-2));
        const y = Number(params.at(-1));
        const tile = tiles.find(item => item.tile_x === x && item.tile_y === y);
        const geometry = geometries.get(`${x}:${y}`);
        return [[{
          evidence_count: tile.evidence_count,
          evidence_max_id: tile.evidence_max_id,
          geometry_json: JSON.stringify(geometry),
          geometry_sha256: `hash-${x}-${y}`,
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('snapshot pages enumerate every tile once and expose an explicit complete terminal page', async () => {
  const db = snapshotDb();
  const first = await loadCoverageSnapshotPage(db, 42, 'mine', {
    pageSize: 1,
    snapshotAuthority: 'mine:42',
  });
  assert.equal(first.manifest.expected_pages, 2);
  assert.equal(first.manifest.expected_tiles, 2);
  assert.equal(first.manifest.expected_evidence_count, 5);
  assert.equal(first.manifest.complete, false);
  assert.deepEqual(first.page.tiles.map(tile => tile.id), ['1:2']);
  assert.equal(first.page.complete, false);
  assert.equal(parseSnapshotCursor(first.page.next_cursor), 1);

  const second = await loadCoverageSnapshotPage(db, 42, 'mine', {
    pageSize: 1,
    snapshotAuthority: 'mine:42',
    snapshotId: first.manifest.snapshot_id,
    visibleAt: first.manifest.as_of,
    cursor: first.page.next_cursor,
  });
  assert.deepEqual(second.page.tiles.map(tile => tile.id), ['3:4']);
  assert.equal(second.page.complete, true);
  assert.equal(second.page.next_cursor, null);
  assert.equal(second.page.terminal_status, 'complete');
});

test('a changing source revision rejects the page instead of mixing snapshots', async () => {
  const db = snapshotDb({ revision: 9, revisionAfter: 10 });
  await assert.rejects(
    loadCoverageSnapshotPage(db, 42, 'mine', { pageSize: 2, snapshotAuthority: 'mine:42' }),
    error => error.code === 'SNAPSHOT_CHANGED' && error.httpStatus === 409,
  );
});

test('shared snapshot fixes one delayed-visibility cutoff and returns only coarse region anchors', async () => {
  const db = snapshotDb();
  const result = await loadCoverageSnapshotPage(db, 42, 'shared', {
    pageSize: 2,
    snapshotAuthority: 'friend:7:42:grant:3',
  });
  const summaryCalls = db.calls.filter(call => call.sql.includes('GROUP BY evidence.tile_x,evidence.tile_y'));
  assert.ok(summaryCalls.length >= 2);
  assert.ok(summaryCalls.every(call => call.sql.includes('evidence.share_ready_at <= ?')));
  assert.ok(summaryCalls.every(call => call.params[1] instanceof Date));
  const regionCalls = db.calls.filter(call => call.sql.includes('ROW_NUMBER() OVER'));
  assert.ok(regionCalls.every(call => call.sql.includes('mapped.share_ready_at <= ?')));
  assert.ok(regionCalls.every(call => call.params[1] instanceof Date));
  assert.deepEqual(result.manifest.regions[0].anchor, [174.75, -41.25]);
  assert.equal(JSON.stringify(result).includes('174.7762'), false);
});
