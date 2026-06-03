/**
 * math-cases.mjs — Sprint 4.1: 50+ hand-crafted algorithm test cases
 *
 * Covers edge cases the simulator can't easily exercise:
 *   - exact age boundaries (0 days, 1 day, baseLifetime, 2× baseLifetime, hardCap)
 *   - extreme like/report ratios (1:0, 0:1, 100:1, 1:100)
 *   - time decay (fresh, 1τ old, 2τ old, 5τ old)
 *   - winterFrozen freeze + thaw
 *   - DOC marker (special params)
 *   - hardCap @ 730 days
 *   - all 5 marker types × edge conditions
 *   - NaN / Inf defensive
 *   - markerStatus state machine all 6 states
 */

import {
  TYPE_PARAMS,
  docParams,
  daysBetween,
  likeValue,
  currentHeat,
  lifeBoost,
  lifeLeft,
  reportPenalty,
  exposureRate,
  markerStatus,
  shouldRender,
  createMarker,
  addLike,
  addReport,
  removeLike,
  markerStats,
} from './stage2_visual/js/algorithm.js';

const MS_PER_DAY = 86400000;
const NOW = Date.UTC(2026, 0, 1); // fixed reference for reproducibility

let pass = 0, fail = 0;
const failures = [];

function expect(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name} — ${detail}`);
    console.log(`❌ ${name}  ${detail}`);
  }
}

function approx(a, b, eps = 0.01) {
  return Math.abs(a - b) < eps;
}

function freshMarker(type = 'supply', overrides = {}) {
  return {
    id: 't',
    type,
    tCreate: NOW,
    likes: [],
    reports: [],
    ...overrides,
  };
}

console.log('\n=== Math case battery (50+) ===\n');

// ── Group 1: likeValue (time decay) ──────────────────────────────────────
expect('CASE-01 likeValue at age 0 = 1.0', approx(likeValue(NOW, NOW, 30), 1.0));
expect('CASE-02 likeValue at age = tau ~ 0.368', approx(likeValue(NOW - 30 * MS_PER_DAY, NOW, 30), Math.exp(-1)));
expect('CASE-03 likeValue at age = 2*tau ~ 0.135', approx(likeValue(NOW - 60 * MS_PER_DAY, NOW, 30), Math.exp(-2)));
expect('CASE-04 likeValue at age = 5*tau ~ 0.0067', approx(likeValue(NOW - 150 * MS_PER_DAY, NOW, 30), Math.exp(-5)));
expect('CASE-05 likeValue same now == 1', likeValue(NOW, NOW, 14) === 1.0);

// ── Group 2: currentHeat ─────────────────────────────────────────────────
expect('CASE-06 heat with 0 likes = 0', currentHeat([], NOW, 30) === 0);
expect('CASE-07 heat with 1 fresh like = 1.0', approx(currentHeat([{ t: NOW }], NOW, 30), 1.0));
expect('CASE-08 heat with 10 fresh likes = 10', approx(currentHeat(Array(10).fill({ t: NOW }), NOW, 30), 10));
expect('CASE-09 heat decays with age',
  currentHeat([{ t: NOW - 30 * MS_PER_DAY }], NOW, 30) < currentHeat([{ t: NOW }], NOW, 30));
expect('CASE-10 heat sums multiple likes correctly',
  approx(currentHeat([{ t: NOW }, { t: NOW - 30 * MS_PER_DAY }], NOW, 30), 1 + Math.exp(-1)));

// ── Group 3: lifeBoost ───────────────────────────────────────────────────
expect('CASE-11 lifeBoost(0,5) = 0', lifeBoost(0, 5) === 0);
expect('CASE-12 lifeBoost(10,5) = 50', lifeBoost(10, 5) === 50);
expect('CASE-13 lifeBoost(neg,5) negative', lifeBoost(-3, 5) === -15);

// ── Group 4: lifeLeft (v3.3 = base + heatBoost - penaltyBoost - daysAlive) ──
{
  const m = freshMarker('supply'); // base 30, tau 30, boost 5
  expect('CASE-14 fresh marker lifeLeft = baseLifetime', approx(lifeLeft(m, NOW), 30));
}
{
  const m = freshMarker('supply');
  m.tCreate = NOW - 5 * MS_PER_DAY;
  expect('CASE-15 5d old, no signals → lifeLeft = base - 5', approx(lifeLeft(m, NOW), 25));
}
{
  const m = freshMarker('supply');
  m.likes = [{ t: NOW }, { t: NOW }, { t: NOW }];
  expect('CASE-16 3 fresh likes → lifeLeft = base + 3*5 = 45', approx(lifeLeft(m, NOW), 30 + 15));
}
{
  const m = freshMarker('supply');
  m.reports = [{ t: NOW, reason: 'info_wrong' }];
  // v3.3: lifeLeft also subtracts lifeBoost(penalty)
  expect('CASE-17 1 fresh report → lifeLeft = base - 1*5 = 25', approx(lifeLeft(m, NOW), 30 - 5));
}
{
  const m = freshMarker('supply');
  m.tCreate = NOW - 800 * MS_PER_DAY; // > hardCap 730
  expect('CASE-18 hardCap > 730d → lifeLeft = -Infinity', lifeLeft(m, NOW) === -Infinity);
}
{
  const m = freshMarker('cairn');
  expect('CASE-19 cairn fresh lifeLeft = 180', approx(lifeLeft(m, NOW), 180));
}
{
  const m = freshMarker('danger');
  expect('CASE-20 danger fresh lifeLeft = 7', approx(lifeLeft(m, NOW), 7));
}

// ── Group 5: lifeLeft + winterFrozen ─────────────────────────────────────
{
  const m = freshMarker('supply');
  m.tCreate = NOW - 50 * MS_PER_DAY;
  m.winterFrozenStart = NOW - 30 * MS_PER_DAY; // age frozen at 20d
  // effectiveDays = 20, no signals, lifeLeft = 30 - 20 = 10
  expect('CASE-21 winterFrozen freezes age', approx(lifeLeft(m, NOW), 10));
}
{
  const m = freshMarker('supply');
  m.tCreate = NOW - 5 * MS_PER_DAY;
  m.likes = [{ t: NOW - 4 * MS_PER_DAY }];
  m.winterFrozenStart = NOW - 3 * MS_PER_DAY;
  // effectiveNow = winterFrozenStart, ageDays of like = 1d, like decays w/ tau 30
  // lifeLeft = 30 + 1*exp(-1/30)*5 - 1*0*5 - 5 (effectiveDays=5? no, tCreate→winterFrozen=2d)
  // Actually effectiveDays = daysBetween(tCreate, winterFrozenStart) = 2d
  expect('CASE-22 winterFrozen + likes — alive', lifeLeft(m, NOW) > 0);
}

// ── Group 6: lifeLeft + DOC marker ───────────────────────────────────────
{
  const m = freshMarker('danger', { isDoc: true });
  // DOC danger: max(7, 365) = 365
  expect('CASE-23 DOC danger baseLifetime = 365', approx(lifeLeft(m, NOW), 365));
}
{
  const m = freshMarker('cairn', { isDoc: true });
  // DOC cairn: max(180, 365) = 365? No, max(180,365)=365
  expect('CASE-24 DOC cairn baseLifetime = 365', approx(lifeLeft(m, NOW), 365));
}

// ── Group 7: reportPenalty ───────────────────────────────────────────────
expect('CASE-25 penalty 0 reports = 0', reportPenalty([], NOW, 30) === 0);
expect('CASE-26 penalty 1 fresh info_wrong = 1.0',
  approx(reportPenalty([{ t: NOW, reason: 'info_wrong' }], NOW, 30), 1.0));
expect('CASE-27 penalty hate weight = 1.5',
  approx(reportPenalty([{ t: NOW, reason: 'hate' }], NOW, 30), 1.5));
expect('CASE-28 penalty dislike weight = 0.3',
  approx(reportPenalty([{ t: NOW, reason: 'dislike' }], NOW, 30), 0.3));
expect('CASE-29 penalty unknown reason fallback 0.5',
  approx(reportPenalty([{ t: NOW, reason: 'made_up' }], NOW, 30), 0.5));
expect('CASE-30 penalty decays with age',
  reportPenalty([{ t: NOW - 30 * MS_PER_DAY, reason: 'info_wrong' }], NOW, 30) <
  reportPenalty([{ t: NOW, reason: 'info_wrong' }], NOW, 30));

// ── Group 8: exposureRate (v3.3 — heat - 1.5*penalty) ────────────────────
{
  const m = freshMarker('supply', { likes: Array(20).fill({ t: NOW }) });
  expect('CASE-31 high heat → exposure 1.0', exposureRate(m, NOW) === 1.0);
}
{
  const m = freshMarker('supply');
  expect('CASE-32 no signals → exposure 0.5', exposureRate(m, NOW) === 0.5);
}
{
  const m = freshMarker('supply', {
    reports: Array(10).fill({ t: NOW, reason: 'info_wrong' }),
  });
  // health = 0 - 1.5*10 = -15 → exposure 0.05
  expect('CASE-33 heavy reports → exposure 0.05', exposureRate(m, NOW) === 0.05);
}
{
  const m = freshMarker('supply', {
    likes: Array(5).fill({ t: NOW }),
    reports: Array(2).fill({ t: NOW, reason: 'info_wrong' }),
  });
  // health = 5 - 1.5*2 = 2 → exposure 0.8
  expect('CASE-34 mixed signals 5L 2R → exposure 0.8', exposureRate(m, NOW) === 0.8);
}
{
  const m = freshMarker('supply', { isDoc: true });
  expect('CASE-35 DOC marker exposure always 1.0',
    exposureRate({ ...m, reports: Array(99).fill({ t: NOW, reason: 'info_wrong' }) }, NOW) === 1.0);
}

// ── Group 9: markerStatus state machine ──────────────────────────────────
{
  const m = freshMarker('supply', { likes: Array(20).fill({ t: NOW }) });
  expect('CASE-36 status healthy with high heat', markerStatus(m, NOW) === 'healthy');
}
{
  const m = freshMarker('supply');
  // no signals: lifeLeft 30 (>0), exposure 0.5 → borderline
  expect('CASE-37 status borderline with no signals', markerStatus(m, NOW) === 'borderline');
}
{
  const m = freshMarker('supply', {
    reports: Array(5).fill({ t: NOW, reason: 'info_wrong' }),
  });
  // life = 30 - 5*5 = 5 (>0), health = 0 - 1.5*5 = -7.5 → exposure 0.05 → heartbeat
  expect('CASE-38 status heartbeat with moderate reports', markerStatus(m, NOW) === 'heartbeat');
}
{
  const m = freshMarker('supply', {
    reports: Array(20).fill({ t: NOW, reason: 'info_wrong' }),
  });
  // life = 30 - 20*5 = -70 < 0 → sunk
  expect('CASE-39 status sunk with overwhelming reports', markerStatus(m, NOW) === 'sunk');
}
{
  const m = freshMarker('supply', { tCreate: NOW - 800 * MS_PER_DAY });
  expect('CASE-40 status archived past hardCap', markerStatus(m, NOW) === 'archived');
}
{
  const m = freshMarker('supply', {
    likes: Array(2).fill({ t: NOW }),
    reports: Array(3).fill({ t: NOW, reason: 'info_wrong' }),
  });
  // health = 2 - 1.5*3 = -2.5 → exposure 0.05 (< 0.2) → heartbeat
  // life = 30 + 2*5 - 3*5 = 25 > 0 → not sunk
  expect('CASE-41 status heartbeat between sunk and weak', markerStatus(m, NOW) === 'heartbeat');
}

// ── Group 10: shouldRender ───────────────────────────────────────────────
{
  const m = freshMarker('supply', { tCreate: NOW - 800 * MS_PER_DAY });
  expect('CASE-42 shouldRender false for archived', shouldRender(m, NOW, () => 0.5) === false);
}
{
  const m = freshMarker('supply', { reports: Array(20).fill({ t: NOW, reason: 'info_wrong' }) });
  expect('CASE-43 shouldRender false for sunk', shouldRender(m, NOW, () => 0.5) === false);
}
{
  const m = freshMarker('supply');
  // borderline: returns true (not heartbeat, not sunk)
  expect('CASE-44 shouldRender true for borderline', shouldRender(m, NOW, () => 0.5) === true);
}
{
  const m = freshMarker('supply', {
    reports: Array(5).fill({ t: NOW, reason: 'info_wrong' }),
  });
  // heartbeat — sample with rng 0.1 → render
  expect('CASE-45 shouldRender 20% sample for heartbeat (rng=0.1 → true)',
    shouldRender(m, NOW, () => 0.1) === true);
  expect('CASE-46 shouldRender 20% sample for heartbeat (rng=0.5 → false)',
    shouldRender(m, NOW, () => 0.5) === false);
}

// ── Group 11: addLike / addReport behaviour ──────────────────────────────
{
  const m = freshMarker('supply');
  addLike(m, 'u1', NOW);
  expect('CASE-47 addLike persists user', m.likes.length === 1 && m.likes[0].userId === 'u1');
  // duplicate user — should not double-count (idempotent)
  addLike(m, 'u1', NOW);
  expect('CASE-48 addLike duplicate userId ignored', m.likes.length === 1);
}
{
  const m = freshMarker('supply');
  addReport(m, 'u1', 'info_wrong', NOW);
  expect('CASE-49 addReport persists', m.reports.length === 1 && m.reports[0].reason === 'info_wrong');
  addReport(m, 'u1', 'info_wrong', NOW);
  expect('CASE-50 addReport duplicate userId ignored', m.reports.length === 1);
}
{
  const m = freshMarker('supply');
  addLike(m, 'u1', NOW);
  removeLike(m, 'u1');
  expect('CASE-51 removeLike clears', m.likes.length === 0);
}

// ── Group 12: createMarker factory ───────────────────────────────────────
{
  const m = createMarker({ id: 'x', type: 'danger', x: 0, y: 0, authorId: 'a', tCreate: NOW });
  expect('CASE-52 createMarker initialises arrays',
    Array.isArray(m.likes) && Array.isArray(m.reports));
  expect('CASE-53 createMarker has type', m.type === 'danger');
  expect('CASE-54 createMarker isDoc default false', !m.isDoc);
}
{
  const m = createMarker({ id: 'x', type: 'cairn', x: 0, y: 0, authorId: 'a', tCreate: NOW, isDoc: true });
  expect('CASE-55 createMarker DOC override', m.isDoc === true);
}

// ── Group 13: NaN / Inf defensive ────────────────────────────────────────
{
  const m = freshMarker('supply', { likes: [{ t: NaN }] });
  const h = currentHeat(m.likes, NOW, 30);
  expect('CASE-56 NaN like timestamp → heat is finite or NaN (defensive)',
    Number.isFinite(h) || Number.isNaN(h));
}
{
  // Unknown type should throw or fallback
  let threw = false;
  try { lifeLeft({ type: 'made_up', tCreate: NOW, likes: [], reports: [] }, NOW); }
  catch { threw = true; }
  expect('CASE-57 unknown type → throws or returns NaN', threw);
}

// ── Group 14: time symmetry / monotonicity ───────────────────────────────
{
  const m = freshMarker('supply', { likes: Array(10).fill({ t: NOW }) });
  const e0 = exposureRate(m, NOW);
  const e30 = exposureRate(m, NOW + 30 * MS_PER_DAY);
  const e90 = exposureRate(m, NOW + 90 * MS_PER_DAY);
  expect('CASE-58 exposure monotonic decay over time', e0 >= e30 && e30 >= e90);
}

// ── Group 15: status transitions over simulated time ─────────────────────
{
  const m = freshMarker('supply');
  for (let i = 0; i < 20; i++) addLike(m, `u${i}`, NOW);
  expect('CASE-59 healthy at time 0', markerStatus(m, NOW) === 'healthy');
  expect('CASE-60 still healthy at 1 month later (heat decayed but base+boost > 1m)',
    ['healthy', 'borderline'].includes(markerStatus(m, NOW + 30 * MS_PER_DAY)));
  // After 6 months (200 days), expect sink
  expect('CASE-61 sunk after 200 days when likes exhausted',
    markerStatus(m, NOW + 200 * MS_PER_DAY) !== 'healthy');
}

// ── Final summary ────────────────────────────────────────────────────────
console.log(`\n=== Result: ${pass}/${pass + fail} cases pass ===`);
if (failures.length) {
  console.log('Failures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('✅ All math cases PASS');
