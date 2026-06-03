/**
 * algorithm.js — Cairn v3.2 marker lifetime + exposure engine
 *
 * Core formulas verified in SPIKE-004 (6/6 cases pass).
 *
 * Reference: docs/discussions/public-marker-feedback-v3.2.md
 */

// ======================================================================
// Constants — per-type lifetime parameters (v3.2 §6)
// v3.3 / v124: parameters can be tweaked at module load time via
// CAIRN_*_MULT env vars. Used by param-sweep.mjs robustness test.
// Multipliers default to 1.0 (no change).
// ======================================================================

const TAU_MULT   = (typeof process !== 'undefined' && parseFloat(process.env.CAIRN_TAU_MULT))   || 1.0;
const BOOST_MULT = (typeof process !== 'undefined' && parseFloat(process.env.CAIRN_BOOST_MULT)) || 1.0;
const LIFE_MULT  = (typeof process !== 'undefined' && parseFloat(process.env.CAIRN_LIFE_MULT))  || 1.0;
const REPORT_WEIGHT = (typeof process !== 'undefined' && parseFloat(process.env.CAIRN_REPORT_WEIGHT)) || 1.5;

export const TYPE_PARAMS = {
  danger:   { baseLifetime: 7   * LIFE_MULT, tau: 14  * TAU_MULT, boost: 3 * BOOST_MULT },
  supply:   { baseLifetime: 30  * LIFE_MULT, tau: 30  * TAU_MULT, boost: 5 * BOOST_MULT },
  junction: { baseLifetime: 60  * LIFE_MULT, tau: 60  * TAU_MULT, boost: 5 * BOOST_MULT },
  scenic:   { baseLifetime: 90  * LIFE_MULT, tau: 90  * TAU_MULT, boost: 5 * BOOST_MULT },
  cairn:    { baseLifetime: 180 * LIFE_MULT, tau: 180 * TAU_MULT, boost: 5 * BOOST_MULT },
};

// DOC marker uses max(per-type, 365)
export function docParams(type) {
  const p = TYPE_PARAMS[type];
  return { ...p, baseLifetime: Math.max(p.baseLifetime, 365), isDoc: true };
}

// 2-year hard cap (v3.2 §6)
const HARD_CAP_DAYS = 730;

// ======================================================================
// Time helpers
// ======================================================================

const MS_PER_DAY = 24 * 3600 * 1000;

export function daysBetween(t1, t2) {
  return (t2 - t1) / MS_PER_DAY;
}

// ======================================================================
// Like time decay (v3.2 §6.2)
// Single Like value = exp(-LikeAge / τ)
// ======================================================================

export function likeValue(likeTimestamp, now, tauDays) {
  const ageDays = daysBetween(likeTimestamp, now);
  return Math.exp(-ageDays / tauDays);
}

// ======================================================================
// Current heat — sum of all Like values (v3.2 §6.4)
// ======================================================================

export function currentHeat(likes, now, tauDays) {
  return likes.reduce((sum, like) => sum + likeValue(like.t, now, tauDays), 0);
}

// ======================================================================
// Life boost from likes (used in lifeLeft formula)
// LifeBoost = heat × boostFactor
// ======================================================================

export function lifeBoost(heat, boostFactor) {
  return heat * boostFactor;
}

// ======================================================================
// Core: Life left calculation (v3.2 §6.4)
// LifeLeft = baseLifetime + heat × boost - daysAlive
// Returns days; negative = should hide
// ======================================================================

export function lifeLeft(marker, now) {
  const params = marker.isDoc ? docParams(marker.type) : TYPE_PARAMS[marker.type];
  if (!params) throw new Error(`Unknown marker type: ${marker.type}`);

  const daysAlive = daysBetween(marker.tCreate, now);

  // Hard cap: > 2 years → force archive
  if (daysAlive > HARD_CAP_DAYS) return -Infinity;

  // Effective days alive (frozen during winter season, v3.2 §6.5)
  const effectiveDays = marker.winterFrozenStart
    ? daysBetween(marker.tCreate, marker.winterFrozenStart)
    : daysAlive;

  // Effective like ages (also frozen during winter)
  // For simplicity: when frozen, treat all likes as "stopped aging"
  const effectiveNow = marker.winterFrozenStart || now;

  const heat = currentHeat(marker.likes || [], effectiveNow, params.tau);
  // v3.3: reports also chip away at lifeLeft. Without this, a misleading
  // marker with low likes but high reports could survive its base
  // lifetime indefinitely (low likes = low boost, but no penalty either).
  // Reports aged exponentially with the same tau as likes, weighted by
  // boost so a single dominant report has comparable magnitude to a like.
  const penalty = reportPenalty(marker.reports || [], effectiveNow, params.tau);
  return params.baseLifetime + lifeBoost(heat, params.boost) - lifeBoost(penalty, params.boost) - effectiveDays;
}

// ======================================================================
// Heartbeat exposure rate (v3.2 §11)
// Healthy markers: 100% exposure
// Borderline (heat declining, reports rising): 50% → 20% → 5%
// Sunk: 0% (but Layer 1 hidden, won't render)
// Heartbeat mechanism: even at 5%, occasional exposure to test recovery
// ======================================================================

const REPORT_REASON_WEIGHTS = {
  info_wrong:   1.0,
  danger_wrong: 1.0,
  spam:         1.0,
  hate:         1.5,
  privacy:      1.5,
  cultural:     1.2,
  dislike:      0.3,
  other:        0.5,
};

export function reportPenalty(reports, now, tauDays) {
  return reports.reduce((sum, r) => {
    const ageDays = daysBetween(r.t, now);
    const decay = Math.exp(-ageDays / tauDays);
    const weight = REPORT_REASON_WEIGHTS[r.reason] || 0.5;
    return sum + decay * weight;
  }, 0);
}

export function exposureRate(marker, now) {
  if (marker.isDoc) return 1.0; // DOC markers always exposed (v3.2 §13)

  const params = TYPE_PARAMS[marker.type];
  const heat = currentHeat(marker.likes || [], now, params.tau);
  const penalty = reportPenalty(marker.reports || [], now, params.tau);

  // v3.3 / v124: report penalty weight tunable via CAIRN_REPORT_WEIGHT
  // env var (default 1.5×). Negative signals cost more than positive.
  const healthScore = heat - REPORT_WEIGHT * penalty;

  // Sigmoid-ish mapping
  if (healthScore >= 5) return 1.0;        // very healthy
  if (healthScore >= 1) return 0.8;        // good
  if (healthScore >= 0) return 0.5;        // borderline
  if (healthScore >= -2) return 0.2;       // weak
  return 0.05;                              // heartbeat only
}

// ======================================================================
// Marker status (v3.2 §6 + §11)
// ======================================================================

export const MARKER_STATUS = {
  HEALTHY:   'healthy',    // life > 0, exposure >= 0.8
  BORDERLINE: 'borderline', // life > 0, 0.5 <= exposure < 0.8
  WEAK:      'weak',        // life > 0, 0.2 <= exposure < 0.5
  HEARTBEAT: 'heartbeat',   // life > 0, exposure < 0.2
  SUNK:      'sunk',        // life <= 0
  ARCHIVED:  'archived',    // > 2 years, force-hidden
};

export function markerStatus(marker, now) {
  const life = lifeLeft(marker, now);
  if (life === -Infinity) return MARKER_STATUS.ARCHIVED;
  if (life <= 0) return MARKER_STATUS.SUNK;

  const exp = exposureRate(marker, now);
  if (exp >= 0.8) return MARKER_STATUS.HEALTHY;
  if (exp >= 0.5) return MARKER_STATUS.BORDERLINE;
  if (exp >= 0.2) return MARKER_STATUS.WEAK;
  return MARKER_STATUS.HEARTBEAT;
}

// ======================================================================
// Visibility decision — used by renderer + simulation
// Even SUNK markers might be shown via heartbeat sampling
// ======================================================================

export function shouldRender(marker, now, rng = Math.random) {
  const status = markerStatus(marker, now);
  if (status === MARKER_STATUS.ARCHIVED) return false;
  if (status === MARKER_STATUS.SUNK) return false;
  if (status === MARKER_STATUS.HEARTBEAT) {
    // 20% chance of heartbeat exposure
    return rng() < 0.2;
  }
  return true;
}

// ======================================================================
// Marker factory
// ======================================================================

export function createMarker({ id, type, x, y, authorId, tCreate, isDoc = false }) {
  return {
    id, type, x, y, authorId,
    tCreate: tCreate || Date.now(),
    isDoc,
    likes: [],     // [{ userId, t }]
    reports: [],   // [{ userId, reason, t }]
  };
}

// ======================================================================
// Like / Report actions (v3.2 §1, §4)
// ======================================================================

export function addLike(marker, userId, now = Date.now()) {
  // Idempotent — one like per user
  if (marker.likes.find(l => l.userId === userId)) return false;
  marker.likes.push({ userId, t: now });
  return true;
}

export function removeLike(marker, userId) {
  const idx = marker.likes.findIndex(l => l.userId === userId);
  if (idx < 0) return false;
  marker.likes.splice(idx, 1);
  return true;
}

export function addReport(marker, userId, reason, now = Date.now()) {
  // Idempotent — one report per user
  if (marker.reports.find(r => r.userId === userId)) return false;
  marker.reports.push({ userId, reason, t: now });
  return true;
}

export function removeReport(marker, userId) {
  const idx = marker.reports.findIndex(r => r.userId === userId);
  if (idx < 0) return false;
  marker.reports.splice(idx, 1);
  return true;
}

// ======================================================================
// Statistics — used for marker info card display
// ======================================================================

export function reportReasonBreakdown(marker) {
  const breakdown = {};
  marker.reports.forEach(r => {
    breakdown[r.reason] = (breakdown[r.reason] || 0) + 1;
  });
  return breakdown;
}

export function markerStats(marker, now = Date.now()) {
  return {
    likes: marker.likes.length,
    reports: marker.reports.length,
    reportReasons: reportReasonBreakdown(marker),
    heat: currentHeat(marker.likes, now, TYPE_PARAMS[marker.type].tau),
    lifeLeft: lifeLeft(marker, now),
    exposure: exposureRate(marker, now),
    status: markerStatus(marker, now),
  };
}
