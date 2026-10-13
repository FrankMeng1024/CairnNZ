'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_CAIRNS_PER_LOCAL_VISIT,
  SAME_LOCALITY_EXIT_DISTANCE_M,
  SAME_LOCALITY_REVISIT_MINUTES,
  PRESENTATION_MERGE_WINDOW_SECONDS,
  HAPTIC_MIN_INTERVAL_SECONDS,
  FRESHNESS_MAX_BOOST_PERCENT,
  FRESHNESS_WINDOW_HOURS,
  DEFAULT_DISCOVERY_SOUND_ENABLED,
  decideLocalVisitTransition,
  selectFairCandidates,
  selectDiscoveryCandidates,
} = require('../cairnDiscoveryCadence');

function candidate(id, authorId = id) {
  return { id: String(id), author_id: String(authorId) };
}

function visit(overrides = {}) {
  return {
    id: 1,
    anchor_lat: -36.8509,
    anchor_lng: 174.7645,
    entered_at: '2026-10-12T00:00:00.000Z',
    last_inside_at: '2026-10-12T00:00:00.000Z',
    departed_at: null,
    ...overrides,
  };
}

test('V1 cadence defaults are explicit and discovery sound remains off', () => {
  assert.equal(MAX_CAIRNS_PER_LOCAL_VISIT, 3);
  assert.equal(SAME_LOCALITY_EXIT_DISTANCE_M, 120);
  assert.equal(SAME_LOCALITY_REVISIT_MINUTES, 15);
  assert.equal(PRESENTATION_MERGE_WINDOW_SECONDS, 20);
  assert.equal(HAPTIC_MIN_INTERVAL_SECONDS, 180);
  assert.equal(FRESHNESS_MAX_BOOST_PERCENT, 20);
  assert.equal(FRESHNESS_WINDOW_HOURS, 168);
  assert.equal(DEFAULT_DISCOVERY_SOUND_ENABLED, false);
});

test('dense localities select 0, 1, or at most 3 from 3/20/200 candidates', () => {
  for (const total of [0, 1, 3, 20, 200]) {
    const result = selectFairCandidates(
      { friend: [], updated: [], public: Array.from({ length: total }, (_, i) => candidate(i + 1)) },
      MAX_CAIRNS_PER_LOCAL_VISIT,
      () => 0.4,
    );
    assert.equal(result.length, Math.min(total, 3), `candidate count ${total}`);
    assert.equal(new Set(result.map(row => row.id)).size, result.length);
  }
});

test('same persisted visit survives restart, screen changes, API repeats, and realistic drift', () => {
  const persisted = visit();
  const drift = [
    { lat: -36.85088, lng: 174.76449 },
    { lat: -36.85094, lng: 174.76456 },
    { lat: -36.85085, lng: 174.76441 },
  ];
  for (const observation of drift) {
    const result = decideLocalVisitTransition([persisted], observation, Date.parse('2026-10-12T01:00:00Z'));
    assert.equal(result.action, 'continue');
    assert.equal(result.visitId, 1);
    assert.equal(result.clearDeparture, false);
  }
});

test('moving to another locality allows a new visit immediately without global cooldown', () => {
  const result = decideLocalVisitTransition(
    [visit()],
    { lat: -36.8489, lng: 174.7645 }, // about 222 m north
    Date.parse('2026-10-12T00:00:10Z'),
  );
  assert.equal(result.action, 'create');
  assert.deepEqual(result.departedIds, [1]);
});

test('15 minutes without departure never resets a local visit', () => {
  const result = decideLocalVisitTransition(
    [visit()],
    { lat: -36.8509, lng: 174.7645 },
    Date.parse('2026-10-12T04:00:00Z'),
  );
  assert.equal(result.action, 'continue');
  assert.equal(result.clearDeparture, false);
});

test('departure over 120m followed by an early return does not reset and consumes departure', () => {
  const result = decideLocalVisitTransition(
    [visit({ departed_at: '2026-10-12T00:05:00Z' })],
    { lat: -36.8509, lng: 174.7645 },
    Date.parse('2026-10-12T00:12:00Z'),
  );
  assert.equal(result.action, 'continue');
  assert.equal(result.clearDeparture, true);
});

test('genuine departure plus 15 minutes and fresh re-entry may reset', () => {
  const result = decideLocalVisitTransition(
    [visit({ departed_at: '2026-10-12T00:05:00Z' })],
    { lat: -36.8509, lng: 174.7645 },
    Date.parse('2026-10-12T00:20:01Z'),
  );
  assert.equal(result.action, 'create');
  assert.equal(result.previousVisitId, 1);
});

test('category-first weighting redistributes empty categories and preserves author diversity', () => {
  const mixed = selectFairCandidates({
    updated: [candidate('u1', 'c')],
    public: [candidate('p0', 'd'), candidate('p1', 'e')],
  }, 3, (() => {
    // category/public, candidate/first; category/updated, candidate/first;
    // category/public, candidate/first
    const values = [0.9, 0.1, 0.1, 0.1, 0.9, 0.1];
    let index = 0;
    return () => values[index++ % values.length];
  })());
  assert.equal(mixed.length, 3);
  assert.equal(new Set(mixed.map(row => row.author_id)).size, 3);
  assert.ok(mixed.some(row => row.id === 'p0'), 'zero-Thanks Public candidate stays eligible');

  const onlyPublic = selectFairCandidates({ friend: [], updated: [], public: [candidate(1), candidate(2)] }, 3, () => 0.8);
  assert.equal(onlyPublic.length, 2);
  assert.ok(onlyPublic.every(row => row.discovery_category === 'public'));
});

test('freshness adds only the configured bounded advantage and keeps older items eligible', () => {
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  const old = { ...candidate('old'), published_at: '2026-09-01T00:00:00.000Z' };
  const fresh = { ...candidate('fresh'), published_at: '2026-10-12T12:00:00.000Z' };
  const selected = selectFairCandidates(
    { updated: [], public: [old, fresh] },
    1,
    () => 0.48,
    now,
  );
  assert.equal(selected[0].id, 'fresh');
  const oldStillSelectable = selectFairCandidates(
    { updated: [], public: [old, fresh] },
    1,
    () => 0,
    now,
  );
  assert.equal(oldStillSelectable[0].id, 'old');
});

test('every eligible friend Cairn is guaranteed before the ordinary visit target', () => {
  for (const total of [0, 1, 2, 3, 5, 20, 100]) {
    const selected = selectDiscoveryCandidates({
      friend: Array.from({ length: total }, (_, index) => candidate(`friend-${index}`, 'same-author')),
      updated: [candidate('updated')],
      public: Array.from({ length: 200 }, (_, index) => candidate(`public-${index}`)),
    }, 3, () => 0.99);
    const friends = selected.filter(item => item.discovery_category === 'friend');
    assert.equal(friends.length, total, `${total} friends`);
    assert.equal(selected.length, Math.max(total, 3), `${total} total selection`);
  }
});

test('two friends leave one fair ordinary slot and three friends leave none', () => {
  const two = selectDiscoveryCandidates({
    friend: [candidate('f1'), candidate('f2')],
    updated: [candidate('u1')],
    public: [candidate('p1')],
  }, 3, () => 0.9);
  assert.deepEqual(two.map(item => item.discovery_category), ['friend', 'friend', 'public']);

  const three = selectDiscoveryCandidates({
    friend: [candidate('f1'), candidate('f2'), candidate('f3')],
    updated: [candidate('u1')],
    public: [candidate('p1')],
  }, 3, () => 0.1);
  assert.ok(three.every(item => item.discovery_category === 'friend'));
});

test('30–60 minute dense walk remains bounded per locality without becoming globally empty', () => {
  // Twelve genuinely distinct localities, five minutes apart, with realistic
  // ±8 m accepted-position jitter and 20 candidates at every locality.
  let acquisitions = 0;
  const visited = new Set();
  for (let locality = 0; locality < 12; locality += 1) {
    const jitter = ((locality % 3) - 1) * 0.00005;
    const localityKey = `${(-36.85 + locality * 0.0015 + jitter).toFixed(4)}:174.7645`;
    if (!visited.has(localityKey)) {
      acquisitions += selectFairCandidates({
        updated: Array.from({ length: 5 }, (_, i) => candidate(`u-${locality}-${i}`, `ua-${i}`)),
        public: Array.from({ length: 5 }, (_, i) => candidate(`p-${locality}-${i}`, `pa-${i}`)),
      }, 3, () => 0.42).length;
      visited.add(localityKey);
    }
  }
  assert.equal(acquisitions, 36);
  assert.equal(visited.size, 12);
  // Product interpretation is intentionally not asserted: native GPS QA must
  // decide whether 36 acquisitions/hour feels too empty or too noisy.
});
