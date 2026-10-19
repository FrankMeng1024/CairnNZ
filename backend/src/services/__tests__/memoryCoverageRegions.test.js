'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCoverageRegions } = require('../memoryCoverage');

function regionDb(row, inspectSql) {
  return {
    execute: async (sql, params) => {
      inspectSql(sql, params);
      return [[row]];
    },
  };
}

const row = {
  id: 'shanghai-pudong',
  parent_id: 'shanghai',
  level: 3,
  name_en: 'Pudong',
  bbox_min_lng: 121.4,
  bbox_min_lat: 31.1,
  bbox_max_lng: 121.8,
  bbox_max_lat: 31.4,
  anchor_lng: 121.60231,
  anchor_lat: 31.20451,
};

test('region navigation uses the latest accepted coverage witness as its anchor', async () => {
  const db = regionDb(row, (sql, params) => {
    assert.deepEqual(params, [42]);
    assert.match(sql, /JOIN memory_coverage_evidence evidence/);
    assert.match(sql, /JOIN memory_points point ON point\.id=evidence\.memory_point_id/);
    assert.match(sql, /ROW_NUMBER\(\) OVER/);
    assert.match(sql, /PARTITION BY region\.id/);
    assert.match(sql, /ORDER BY evidence\.observed_at_ms DESC,evidence\.memory_point_id DESC/);
    assert.doesNotMatch(sql, /mapped\.share_ready_at<=UTC_TIMESTAMP/);
  });

  const regions = await loadCoverageRegions(db, 42, 'mine');
  assert.deepEqual(regions[0].anchor, [121.60231, 31.20451]);
  assert.notDeepEqual(regions[0].anchor, [121.6, 31.25], 'must not fall back to the region bbox center');
});

test('shared region anchors remain behind the existing delayed-visibility fence', async () => {
  const db = regionDb(row, (sql) => {
    assert.match(sql, /mapped\.share_ready_at<=UTC_TIMESTAMP\(3\)/);
    assert.match(sql, /evidence\.owner_id=mapped\.owner_id/);
    assert.match(sql, /evidence\.coverage_rule_version=mapped\.coverage_rule_version/);
    assert.match(sql, /WHERE ranked\.recency_rank=1/);
  });

  const regions = await loadCoverageRegions(db, 42, 'shared');
  assert.deepEqual(regions[0].anchor, [121.60231, 31.20451]);
});
