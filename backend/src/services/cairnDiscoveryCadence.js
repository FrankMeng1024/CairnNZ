'use strict';

const crypto = require('crypto');

function boundedInteger(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

const MAX_CAIRNS_PER_LOCAL_VISIT = boundedInteger('MAX_CAIRNS_PER_LOCAL_VISIT', 3, 1, 20);
const SAME_LOCALITY_EXIT_DISTANCE_M = boundedInteger('SAME_LOCALITY_EXIT_DISTANCE_M', 120, 60, 500);
const SAME_LOCALITY_REVISIT_MINUTES = boundedInteger('SAME_LOCALITY_REVISIT_MINUTES', 15, 1, 240);
const PRESENTATION_MERGE_WINDOW_SECONDS = boundedInteger('PRESENTATION_MERGE_WINDOW_SECONDS', 20, 1, 120);
const HAPTIC_MIN_INTERVAL_SECONDS = boundedInteger('HAPTIC_MIN_INTERVAL_SECONDS', 180, 30, 3600);
const DEFAULT_DISCOVERY_SOUND_ENABLED = false;

const CATEGORY_WEIGHTS = Object.freeze({
  updated: 0.5,
  public: 0.5,
});

function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const lat1 = Number(a.lat) * radians;
  const lat2 = Number(b.lat) * radians;
  const deltaLat = (Number(b.lat) - Number(a.lat)) * radians;
  const deltaLng = (Number(b.lng) - Number(a.lng)) * radians;
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function asMillis(value) {
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
}

/**
 * Pure transition model used by both tests and the transactional DB wrapper.
 * A too-early return consumes the old departure: standing still cannot become
 * a new visit merely because the wall clock later crosses 15 minutes.
 */
function decideLocalVisitTransition(visits, observation, serverNowMs) {
  const ordered = [...visits].sort((a, b) => asMillis(b.entered_at) - asMillis(a.entered_at));
  const nearest = ordered
    .map(visit => ({ visit, distance: distanceMeters(observation, { lat: visit.anchor_lat, lng: visit.anchor_lng }) }))
    .filter(entry => entry.distance <= SAME_LOCALITY_EXIT_DISTANCE_M)
    .sort((a, b) => a.distance - b.distance)[0];
  const departedIds = ordered
    .filter(visit => !visit.departed_at
      && distanceMeters(observation, { lat: visit.anchor_lat, lng: visit.anchor_lng }) > SAME_LOCALITY_EXIT_DISTANCE_M)
    .map(visit => Number(visit.id));

  if (!nearest) return { action: 'create', departedIds, previousVisitId: null };
  const visit = nearest.visit;
  if (!visit.departed_at) {
    return { action: 'continue', departedIds, visitId: Number(visit.id), clearDeparture: false };
  }
  const elapsedMs = serverNowMs - asMillis(visit.departed_at);
  const revisitMs = SAME_LOCALITY_REVISIT_MINUTES * 60 * 1000;
  if (elapsedMs < revisitMs) {
    return { action: 'continue', departedIds, visitId: Number(visit.id), clearDeparture: true };
  }
  return { action: 'create', departedIds, previousVisitId: Number(visit.id) };
}

async function ensureLocalVisit(conn, viewerId, observation) {
  const [nowRows] = await conn.execute('SELECT UTC_TIMESTAMP(3) AS server_now');
  const serverNow = nowRows[0]?.server_now ? new Date(nowRows[0].server_now) : new Date();
  const [visits] = await conn.execute(
    `SELECT id,anchor_lat,anchor_lng,entered_at,last_inside_at,departed_at,closed_at
       FROM cairn_local_visits
      WHERE viewer_id = ? AND entered_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
      ORDER BY entered_at DESC, id DESC LIMIT 100 FOR UPDATE`,
    [viewerId],
  );
  const transition = decideLocalVisitTransition(visits, observation, serverNow.getTime());
  if (transition.departedIds.length > 0) {
    await conn.query(
      `UPDATE cairn_local_visits
          SET departed_at = COALESCE(departed_at, UTC_TIMESTAMP(3))
        WHERE viewer_id = ? AND id IN (?)`,
      [viewerId, transition.departedIds],
    );
  }
  if (transition.action === 'continue') {
    await conn.execute(
      `UPDATE cairn_local_visits
          SET last_inside_at = UTC_TIMESTAMP(3),
              departed_at = CASE WHEN ? = 1 THEN NULL ELSE departed_at END
        WHERE id = ? AND viewer_id = ?`,
      [transition.clearDeparture ? 1 : 0, transition.visitId, viewerId],
    );
    return { id: transition.visitId, isNew: false };
  }
  if (transition.previousVisitId) {
    await conn.execute(
      `UPDATE cairn_local_visits SET closed_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND viewer_id = ? AND closed_at IS NULL`,
      [transition.previousVisitId, viewerId],
    );
  }
  const token = crypto.randomUUID();
  const [result] = await conn.execute(
    `INSERT INTO cairn_local_visits
       (viewer_id,visit_token,anchor_lat,anchor_lng,entered_at,last_inside_at)
     VALUES (?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [viewerId, token, Number(observation.lat), Number(observation.lng)],
  );
  return { id: Number(result.insertId), token, isNew: true };
}

async function remainingVisitCapacity(conn, visitId) {
  const [[row]] = await conn.execute(
    `SELECT COUNT(*) AS acquired_count
       FROM cairn_local_visit_acquisitions WHERE visit_id = ?`,
    [visitId],
  );
  return Math.max(0, MAX_CAIRNS_PER_LOCAL_VISIT - Number(row?.acquired_count ?? 0));
}

function weightedCategory(nonEmptyCategories, random) {
  const total = nonEmptyCategories.reduce((sum, category) => sum + CATEGORY_WEIGHTS[category], 0);
  let cursor = random() * total;
  for (const category of nonEmptyCategories) {
    cursor -= CATEGORY_WEIGHTS[category];
    if (cursor <= 0) return category;
  }
  return nonEmptyCategories[nonEmptyCategories.length - 1];
}

function chooseCandidate(candidates, usedAuthors, random) {
  const diverse = candidates.filter(candidate => !usedAuthors.has(String(candidate.author_id)));
  const pool = diverse.length > 0 ? diverse : candidates;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

function selectFairCandidates(categories, slots, random = Math.random) {
  const remaining = {
    updated: [...(categories.updated || [])],
    public: [...(categories.public || [])],
  };
  const selected = [];
  const usedAuthors = new Set();
  const boundedSlots = Math.max(0, Math.min(MAX_CAIRNS_PER_LOCAL_VISIT, Number(slots) || 0));
  while (selected.length < boundedSlots) {
    const available = Object.keys(remaining).filter(category => remaining[category].length > 0);
    if (available.length === 0) break;
    const category = weightedCategory(available, random);
    const candidate = chooseCandidate(remaining[category], usedAuthors, random);
    remaining[category] = remaining[category].filter(item => item !== candidate);
    selected.push({ ...candidate, discovery_category: category });
    usedAuthors.add(String(candidate.author_id));
  }
  return selected;
}

/**
 * Current-friend Cairns are authorization-prioritized, not lottery entries.
 * They may overflow the ordinary visit target. Only the remaining ordinary
 * capacity is sampled between UPDATED and NEW_PUBLIC.
 */
function selectDiscoveryCandidates(categories, ordinaryCapacity, random = Math.random) {
  const guaranteedFriends = [...(categories.friend || [])].map(candidate => ({
    ...candidate,
    discovery_category: 'friend',
  }));
  const remainingSlots = Math.max(0, Number(ordinaryCapacity) - guaranteedFriends.length);
  return [
    ...guaranteedFriends,
    ...selectFairCandidates({ updated: categories.updated, public: categories.public }, remainingSlots, random),
  ];
}

async function assignPresentationGroup(conn, viewerId, acquisitionId) {
  const [openGroups] = await conn.execute(
    `SELECT id,group_token,haptic_eligible,merge_until
       FROM cairn_presentation_groups
      WHERE viewer_id = ? AND announced_at IS NULL
        AND merge_until >= UTC_TIMESTAMP(3)
      ORDER BY merge_started_at DESC,id DESC LIMIT 1 FOR UPDATE`,
    [viewerId],
  );
  let group = openGroups[0];
  if (!group) {
    const [recentHaptic] = await conn.execute(
      `SELECT id FROM cairn_presentation_groups
        WHERE viewer_id = ? AND haptic_eligible = 1
          AND merge_started_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
        ORDER BY merge_started_at DESC LIMIT 1 FOR UPDATE`,
      [viewerId, HAPTIC_MIN_INTERVAL_SECONDS],
    );
    const token = crypto.randomUUID();
    const [result] = await conn.execute(
      `INSERT INTO cairn_presentation_groups
         (viewer_id,group_token,merge_started_at,merge_until,haptic_eligible,sound_eligible)
       VALUES (?,?,UTC_TIMESTAMP(3),
               DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND),?,0)`,
      [viewerId, token, PRESENTATION_MERGE_WINDOW_SECONDS, recentHaptic[0] ? 0 : 1],
    );
    group = { id: result.insertId, group_token: token, haptic_eligible: recentHaptic[0] ? 0 : 1 };
  }
  await conn.execute(
    `INSERT INTO cairn_acquisition_events
       (viewer_id,acquisition_id,presentation_group_id)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE acquisition_id = acquisition_id`,
    [viewerId, acquisitionId, group.id],
  );
  return {
    id: Number(group.id),
    token: group.group_token,
    hapticEligible: Boolean(group.haptic_eligible),
    soundEligible: DEFAULT_DISCOVERY_SOUND_ENABLED,
  };
}

module.exports = {
  MAX_CAIRNS_PER_LOCAL_VISIT,
  SAME_LOCALITY_EXIT_DISTANCE_M,
  SAME_LOCALITY_REVISIT_MINUTES,
  PRESENTATION_MERGE_WINDOW_SECONDS,
  HAPTIC_MIN_INTERVAL_SECONDS,
  DEFAULT_DISCOVERY_SOUND_ENABLED,
  CATEGORY_WEIGHTS,
  distanceMeters,
  decideLocalVisitTransition,
  ensureLocalVisit,
  remainingVisitCapacity,
  selectFairCandidates,
  selectDiscoveryCandidates,
  assignPresentationGroup,
};
