'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const { eligibleSourceProvenanceSql } = require('../services/activitySourceProvenance');
const {
  ENCOUNTER_RADIUS_M,
  MAX_HORIZONTAL_ACCURACY_M,
  selectQualifyingEncounterEvidence,
} = require('../services/encounterPolicy');
const { publicPilotAuthorized } = require('../services/publicPublication');
const {
  MAX_CAIRNS_PER_LOCAL_VISIT,
  SAME_LOCALITY_EXIT_DISTANCE_M,
  SAME_LOCALITY_REVISIT_MINUTES,
  PRESENTATION_MERGE_WINDOW_SECONDS,
  HAPTIC_MIN_INTERVAL_SECONDS,
  distanceMeters,
  ensureLocalVisit,
  remainingVisitCapacity,
  selectDiscoveryCandidates,
} = require('../services/cairnDiscoveryCadence');
const {
  captureCurrentMarkerRevision,
  capturePublicPublicationRevision,
  acquireCairnRevision,
} = require('../services/cairnHistory');

const router = express.Router();
router.use(authenticate);

const FRESH_ONLINE_EVIDENCE_MS = 2 * 60 * 1000;

const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `cairnMemory:${req.user?.userId || ipKeyGenerator(req.ip)}`,
});

function positiveId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadFreshAcceptedEvidence(conn, viewerId) {
  const [rows] = await conn.execute(
    `SELECT evidence.*
       FROM (
         SELECT witness.id,witness.first_lat AS lat,witness.first_lng AS lng,
                witness.first_observed_at_ms AS ts,witness.evidence_source,
                witness.source_activity_client_id,witness.source_segment_id,
                witness.horizontal_accuracy_m,witness.continuity_state,
                witness.received_at AS receipt_at
           FROM memory_presence_witnesses witness
          WHERE witness.user_id=?
         UNION ALL
         SELECT witness.id,witness.lat,witness.lng,witness.observed_at_ms AS ts,
                witness.evidence_source,witness.source_activity_client_id,
                witness.source_segment_id,witness.horizontal_accuracy_m,
                witness.continuity_state,witness.updated_at AS receipt_at
           FROM memory_presence_witnesses witness
          WHERE witness.user_id=?
            AND witness.observed_at_ms>witness.first_observed_at_ms
       ) evidence
       LEFT JOIN sessions source_session
         ON source_session.user_id=?
        AND source_session.client_activity_id=evidence.source_activity_client_id
        AND source_session.abandoned_at IS NULL
        AND ${eligibleSourceProvenanceSql('source_session.source_provenance')}
      WHERE evidence.continuity_state='accepted'
        AND evidence.horizontal_accuracy_m<=?
        AND evidence.receipt_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE)
        AND evidence.ts>=(UNIX_TIMESTAMP(UTC_TIMESTAMP(3))*1000)-?
        AND evidence.ts<=(UNIX_TIMESTAMP(UTC_TIMESTAMP(3))*1000)+300000
        AND (evidence.evidence_source='passive_real' OR source_session.id IS NOT NULL)
      ORDER BY evidence.ts ASC,evidence.id ASC
      LIMIT 400 FOR SHARE`,
    [viewerId, viewerId, viewerId, MAX_HORIZONTAL_ACCURACY_M, FRESH_ONLINE_EVIDENCE_MS],
  );
  return rows;
}

async function loadDiscoveryCandidates(conn, viewerId, visitId, point) {
  const [friendRows] = await conn.execute(
    `SELECT marker.id AS marker_id,marker.user_id AS author_id,marker.type,marker.text,
            marker.lat,marker.lng,marker.approximate,marker.content_revision,
            marker.audience_epoch,user.name AS author_name,'friends' AS source_audience
       FROM markers marker
       JOIN users user ON user.id=marker.user_id AND user.deleted_at IS NULL
       JOIN friends friend ON friend.user_id=? AND friend.friend_id=marker.user_id
       JOIN friends reverse_friend
         ON reverse_friend.user_id=marker.user_id AND reverse_friend.friend_id=?
       JOIN friendship_episodes episode
         ON episode.user_low_id=LEAST(?,marker.user_id)
        AND episode.user_high_id=GREATEST(?,marker.user_id)
        AND episode.ended_at IS NULL
       LEFT JOIN cairn_source_moderation moderation ON moderation.marker_id=marker.id
      WHERE marker.permission='group' AND marker.status<>'hidden'
        AND marker.user_id<>?
        AND COALESCE(moderation.state,'available')='available'
        AND ST_Distance_Sphere(POINT(marker.lng,marker.lat),POINT(?,?))<=?
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users blocked
           WHERE (blocked.blocker_id=? AND blocked.blocked_id=marker.user_id)
              OR (blocked.blocker_id=marker.user_id AND blocked.blocked_id=?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM cairn_acquisitions acquisition
          JOIN cairn_revisions revision ON revision.id=acquisition.cairn_revision_id
           WHERE acquisition.viewer_id=? AND revision.marker_id=marker.id
             AND revision.content_revision=marker.content_revision
        )
        AND NOT EXISTS (
          SELECT 1 FROM cairn_local_visit_acquisitions draw
           WHERE draw.visit_id=? AND draw.marker_id=marker.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM cairn_collections removed_collection
           WHERE removed_collection.viewer_id=? AND removed_collection.marker_id=marker.id
             AND removed_collection.removed_at IS NOT NULL
        )
      ORDER BY marker.id ASC
      FOR SHARE`,
    [viewerId, viewerId, viewerId, viewerId, viewerId,
      point.lng, point.lat, ENCOUNTER_RADIUS_M,
      viewerId, viewerId, viewerId, visitId, viewerId],
  );

  const [publicRows] = await conn.execute(
    `SELECT marker.id AS marker_id,marker.user_id AS author_id,
            publication.snapshot_type AS type,publication.snapshot_text AS text,
            publication.snapshot_lat AS lat,publication.snapshot_lng AS lng,
            publication.snapshot_approximate AS approximate,
            publication.content_revision,publication.publication_epoch AS audience_epoch,
            publication.publication_epoch,publication.id AS publication_id,
            publication.snapshot_sha256,user.name AS author_name,
            'public' AS source_audience,
            EXISTS (
              SELECT 1 FROM friends current_friend
              JOIN friends reverse_friend
                ON reverse_friend.user_id=current_friend.friend_id
               AND reverse_friend.friend_id=current_friend.user_id
             WHERE current_friend.user_id=?
               AND current_friend.friend_id=marker.user_id
            ) AS is_current_friend,
            EXISTS (SELECT 1 FROM cairn_acquisitions prior
                     WHERE prior.viewer_id=? AND prior.marker_id=marker.id) AS had_prior
       FROM markers marker
       JOIN users user ON user.id=marker.user_id AND user.deleted_at IS NULL
       JOIN public_cairn_publications publication
         ON publication.marker_id=marker.id
        AND publication.publication_epoch=marker.publication_epoch
        AND publication.content_revision=marker.content_revision
        AND publication.state='published'
       LEFT JOIN cairn_source_moderation moderation ON moderation.marker_id=marker.id
      WHERE marker.permission='public' AND marker.public_intent=1
        AND marker.public_state='published' AND marker.status<>'hidden'
        AND marker.user_id<>?
        AND COALESCE(moderation.state,'available')='available'
        AND ST_Distance_Sphere(POINT(publication.snapshot_lng,publication.snapshot_lat),POINT(?,?))<=?
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users blocked
           WHERE (blocked.blocker_id=? AND blocked.blocked_id=marker.user_id)
              OR (blocked.blocker_id=marker.user_id AND blocked.blocked_id=?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM cairn_acquisitions acquisition
          JOIN cairn_revisions revision ON revision.id=acquisition.cairn_revision_id
           WHERE acquisition.viewer_id=? AND revision.marker_id=marker.id
             AND revision.content_revision=marker.content_revision
        )
        AND NOT EXISTS (
          SELECT 1 FROM cairn_local_visit_acquisitions draw
           WHERE draw.visit_id=? AND draw.marker_id=marker.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM cairn_collections removed_collection
           WHERE removed_collection.viewer_id=? AND removed_collection.marker_id=marker.id
             AND removed_collection.removed_at IS NOT NULL
        )
      ORDER BY marker.id ASC
      FOR SHARE`,
    [viewerId, viewerId, viewerId, point.lng, point.lat, ENCOUNTER_RADIUS_M,
      viewerId, viewerId, viewerId, visitId, viewerId],
  );
  const friendPublicRows = publicRows.filter(row => (
    Boolean(row.is_current_friend) && publicPilotAuthorized(row.author_id)
  ));
  const ordinaryPublicRows = publicRows.filter(row => !row.is_current_friend);
  return {
    friend: [...friendRows, ...friendPublicRows],
    updated: ordinaryPublicRows.filter(row => Boolean(row.had_prior) && publicPilotAuthorized(row.author_id)),
    public: ordinaryPublicRows.filter(row => !row.had_prior && publicPilotAuthorized(row.author_id)),
  };
}

router.post('/discover', mutationLimiter, async (req, res) => {
  const viewerId = req.user.userId;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [viewerId]);
    const evidenceRows = await loadFreshAcceptedEvidence(conn, viewerId);
    const latestEvidence = selectQualifyingEncounterEvidence(evidenceRows);
    if (!latestEvidence) {
      await conn.commit();
      return res.json({ acquired: [], reason: 'fresh_continuous_presence_required' });
    }
    const observation = { lat: Number(latestEvidence.lat), lng: Number(latestEvidence.lng) };
    const visit = await ensureLocalVisit(conn, viewerId, observation);
    const capacity = await remainingVisitCapacity(conn, visit.id);
    const candidates = await loadDiscoveryCandidates(conn, viewerId, visit.id, observation);
    // Every selected Cairn must have the two accepted observations inside its
    // own 50 m radius. The 120 m visit boundary is never used as proximity.
    for (const category of Object.keys(candidates)) {
      candidates[category] = candidates[category].filter(candidate => {
        const localRows = evidenceRows.filter(row => distanceMeters(
          { lat: Number(row.lat), lng: Number(row.lng) },
          { lat: Number(candidate.lat), lng: Number(candidate.lng) },
        ) <= ENCOUNTER_RADIUS_M);
        candidate.qualifying_evidence = selectQualifyingEncounterEvidence(localRows);
        return Boolean(candidate.qualifying_evidence);
      });
    }
    const selected = selectDiscoveryCandidates(candidates, capacity);
    if (selected.length === 0 && capacity <= 0) {
      await conn.commit();
      return res.json({ acquired: [], reason: 'local_visit_limit', visit_id: String(visit.id) });
    }
    const acquired = [];
    for (const candidate of selected) {
      const revision = candidate.source_audience === 'friends'
        ? await captureCurrentMarkerRevision(conn, candidate.marker_id, candidate.author_id)
        : await capturePublicPublicationRevision(conn, candidate);
      if (!revision || revision.availability !== 'available') continue;
      const evidence = candidate.qualifying_evidence;
      const result = await acquireCairnRevision(conn, {
        viewerId,
        markerId: candidate.marker_id,
        revisionId: revision.id,
        via: candidate.source_audience === 'friends' ? 'friends' : 'public',
        evidenceKind: 'presence_witness',
        evidenceId: evidence.id,
        evidenceObservedAtMs: evidence.ts,
        visitId: visit.id,
      });
      if (result.acquired) {
        acquired.push({
          marker_id: String(candidate.marker_id),
          content_revision: Number(candidate.content_revision),
          category: candidate.discovery_category,
          presentation_group_id: String(result.presentationGroup.id),
        });
      }
    }
    await conn.commit();
    return res.json({
      acquired,
      visit_id: String(visit.id),
      local_visit_limit: MAX_CAIRNS_PER_LOCAL_VISIT,
      locality_exit_distance_m: SAME_LOCALITY_EXIT_DISTANCE_M,
      same_locality_revisit_minutes: SAME_LOCALITY_REVISIT_MINUTES,
      presentation_merge_window_seconds: PRESENTATION_MERGE_WINDOW_SECONDS,
      haptic_min_interval_seconds: HAPTIC_MIN_INTERVAL_SECONDS,
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[cairn-memory/discover]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/library', async (req, res) => {
  const section = req.query.section === 'left' ? 'left' : req.query.section === 'found' ? 'found' : null;
  const collectionState = req.query.state === 'archived' ? 'archived' : 'active';
  if (!section) return res.status(400).json({ error: 'section must be left or found' });
  try {
    if (section === 'left') {
      const [rows] = await pool.execute(
        `SELECT marker.id AS marker_id,marker.type,
                CASE WHEN COALESCE(moderation.state,'available')='available'
                     THEN marker.text ELSE NULL END AS text,
                marker.lat,marker.lng,
                marker.permission,marker.content_revision,marker.created_at,marker.updated_at,
                COALESCE(moderation.state,'available') AS content_state,
                collection.archived_at,collection.removed_at,
                (SELECT COUNT(DISTINCT revision.content_revision) FROM cairn_revisions revision
                  WHERE revision.marker_id=marker.id) AS revision_count
           FROM cairn_collections collection
           JOIN markers marker ON marker.id=collection.marker_id AND marker.user_id=collection.viewer_id
           LEFT JOIN cairn_source_moderation moderation ON moderation.marker_id=marker.id
          WHERE collection.viewer_id=? AND collection.relationship='left'
            AND collection.removed_at IS NULL
          ORDER BY marker.updated_at DESC,marker.id DESC LIMIT 1000`,
        [req.user.userId],
      );
      return res.json({ section, cairns: rows, unread_count: 0 });
    }
    const [rows] = await pool.execute(
      `WITH latest AS (
         SELECT acquisition.*,
                ROW_NUMBER() OVER (PARTITION BY acquisition.marker_id
                  ORDER BY revision.content_revision DESC,acquisition.acquired_at DESC) AS rank_in_cairn
           FROM cairn_acquisitions acquisition
           JOIN cairn_revisions revision ON revision.id=acquisition.cairn_revision_id
          WHERE acquisition.viewer_id=? AND acquisition.removed_at IS NULL
       )
       SELECT collection.marker_id,collection.archived_at,collection.removed_at,
              revision.id AS revision_id,revision.content_revision,revision.content_type AS type,
              CASE WHEN revision.availability='available' THEN revision.content_text ELSE NULL END AS text,
              revision.lat,revision.lng,revision.source_audience,revision.availability,
              CASE
                WHEN revision.identity_policy='friends_acquired'
                  THEN revision.friend_author_name_snapshot
                WHEN revision.identity_policy='public_current' AND EXISTS (
                  SELECT 1 FROM friends current_friend
                  JOIN friends reverse_friend
                    ON reverse_friend.user_id=current_friend.friend_id
                   AND reverse_friend.friend_id=current_friend.user_id
                 WHERE current_friend.user_id=collection.viewer_id
                   AND current_friend.friend_id=revision.owner_id
                ) AND NOT EXISTS (
                  SELECT 1 FROM blocked_users blocked
                   WHERE (blocked.blocker_id=collection.viewer_id AND blocked.blocked_id=revision.owner_id)
                      OR (blocked.blocker_id=revision.owner_id AND blocked.blocked_id=collection.viewer_id)
                ) THEN author.name
                ELSE NULL
              END AS author_name,
              latest.acquired_at,latest.opened_at,
              (SELECT COUNT(*) FROM cairn_acquisitions history
                WHERE history.viewer_id=collection.viewer_id
                  AND history.marker_id=collection.marker_id) AS revision_count
         FROM cairn_collections collection
         JOIN latest ON latest.viewer_id=collection.viewer_id
                    AND latest.marker_id=collection.marker_id AND latest.rank_in_cairn=1
         JOIN cairn_revisions revision ON revision.id=latest.cairn_revision_id
         LEFT JOIN users author ON author.id=revision.owner_id AND author.deleted_at IS NULL
        WHERE collection.viewer_id=? AND collection.relationship='found'
          AND collection.archived_at IS ${collectionState === 'archived' ? 'NOT NULL' : 'NULL'}
          AND collection.removed_at IS NULL
          AND revision.availability IN ('available','under_review','unavailable')
        ORDER BY latest.acquired_at DESC,collection.marker_id DESC LIMIT 1000`,
      [req.user.userId, req.user.userId],
    );
    return res.json({
      section,
      cairns: rows,
      unread_count: collectionState === 'active'
        ? rows.filter(row => row.opened_at == null && row.availability === 'available').length
        : 0,
    });
  } catch (error) {
    console.error('[cairn-memory/library]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/cairns/:marker_id/history', async (req, res) => {
  const markerId = positiveId(req.params.marker_id);
  if (!markerId) return res.status(400).json({ error: 'Invalid Cairn id' });
  try {
    const [rows] = await pool.execute(
      `SELECT acquisition.id AS acquisition_id,revision.id AS revision_id,
              revision.content_revision,revision.content_type AS type,
              CASE WHEN revision.availability='available' THEN revision.content_text ELSE NULL END AS text,
              revision.lat,revision.lng,revision.source_audience,revision.availability,
              acquisition.acquired_at,acquisition.opened_at,acquisition.thanked_at
         FROM cairn_acquisitions acquisition
         JOIN cairn_revisions revision ON revision.id=acquisition.cairn_revision_id
        WHERE acquisition.viewer_id=? AND acquisition.marker_id=?
          AND acquisition.removed_at IS NULL
        ORDER BY revision.content_revision DESC,acquisition.acquired_at DESC`,
      [req.user.userId, markerId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Cairn history unavailable' });
    return res.json({ marker_id: String(markerId), revisions: rows });
  } catch (error) {
    console.error('[cairn-memory/history]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/revisions/:revision_id/read', mutationLimiter, async (req, res) => {
  const revisionId = positiveId(req.params.revision_id);
  if (!revisionId) return res.status(400).json({ error: 'Invalid revision id' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT acquisition.id
         FROM cairn_acquisitions acquisition
         JOIN cairn_revisions revision ON revision.id=acquisition.cairn_revision_id
        WHERE acquisition.viewer_id=? AND acquisition.cairn_revision_id=?
          AND acquisition.removed_at IS NULL AND revision.availability='available'
        LIMIT 1 FOR UPDATE`,
      [req.user.userId, revisionId],
    );
    if (!rows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: 'Revision unavailable' });
    }
    await conn.execute(
      'UPDATE cairn_acquisitions SET opened_at=COALESCE(opened_at,UTC_TIMESTAMP(3)) WHERE id=?',
      [rows[0].id],
    );
    await conn.commit();
    return res.json({ read: true });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[cairn-memory/read]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.post('/revisions/:revision_id/thanks', mutationLimiter, async (req, res) => {
  const revisionId = positiveId(req.params.revision_id);
  if (!revisionId) return res.status(400).json({ error: 'Invalid revision id' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT acquisition.id
         FROM cairn_acquisitions acquisition
         JOIN cairn_revisions revision ON revision.id=acquisition.cairn_revision_id
        WHERE acquisition.viewer_id=? AND acquisition.cairn_revision_id=?
          AND acquisition.removed_at IS NULL AND acquisition.opened_at IS NOT NULL
          AND revision.availability='available'
        LIMIT 1 FOR UPDATE`,
      [req.user.userId, revisionId],
    );
    if (!rows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: 'Revision unavailable' });
    }
    await conn.execute(
      'UPDATE cairn_acquisitions SET thanked_at=COALESCE(thanked_at,UTC_TIMESTAMP(3)) WHERE id=?',
      [rows[0].id],
    );
    await conn.commit();
    return res.json({ thanked: true });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[cairn-memory/thanks]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.put('/cairns/:marker_id/collection', mutationLimiter, async (req, res) => {
  const markerId = positiveId(req.params.marker_id);
  const action = req.body?.action;
  if (!markerId || !['archive', 'restore', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'Valid marker and action required' });
  }
  const clauses = {
    archive: 'archived_at=UTC_TIMESTAMP(3)',
    restore: 'archived_at=NULL,removed_at=NULL',
    remove: 'removed_at=UTC_TIMESTAMP(3)',
  };
  const [result] = await pool.execute(
    `UPDATE cairn_collections SET ${clauses[action]} WHERE viewer_id=? AND marker_id=?`,
    [req.user.userId, markerId],
  );
  return result.affectedRows ? res.json({ action }) : res.status(404).json({ error: 'Cairn unavailable' });
});

router.get('/presentation/pending', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT presentation.id,presentation.group_token,presentation.merge_started_at,
              presentation.merge_until,presentation.haptic_eligible,presentation.sound_eligible,
              COUNT(DISTINCT acquisition.marker_id) AS cairn_count
         FROM cairn_presentation_groups presentation
         JOIN cairn_acquisition_events event ON event.presentation_group_id=presentation.id
         JOIN cairn_acquisitions acquisition ON acquisition.id=event.acquisition_id
         JOIN cairn_revisions revision ON revision.id=acquisition.cairn_revision_id
         JOIN cairn_collections collection
           ON collection.viewer_id=acquisition.viewer_id AND collection.marker_id=acquisition.marker_id
        WHERE presentation.viewer_id=? AND presentation.announced_at IS NULL
          AND presentation.merge_until<=UTC_TIMESTAMP(3)
          AND acquisition.removed_at IS NULL AND collection.archived_at IS NULL
          AND collection.removed_at IS NULL AND revision.availability='available'
        GROUP BY presentation.id,presentation.group_token,presentation.merge_started_at,
                 presentation.merge_until,presentation.haptic_eligible,presentation.sound_eligible
        ORDER BY presentation.merge_started_at ASC`,
      [req.user.userId],
    );
    return res.json({ groups: rows });
  } catch (error) {
    console.error('[cairn-memory/presentation:pending]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/presentation/:group_id/announced', mutationLimiter, async (req, res) => {
  const groupId = positiveId(req.params.group_id);
  if (!groupId) return res.status(400).json({ error: 'Invalid group id' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `UPDATE cairn_presentation_groups
          SET announced_at=COALESCE(announced_at,UTC_TIMESTAMP(3))
        WHERE id=? AND viewer_id=? AND merge_until<=UTC_TIMESTAMP(3)`,
      [groupId, req.user.userId],
    );
    if (!result.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ error: 'Presentation group unavailable' });
    }
    await conn.execute(
      `UPDATE cairn_acquisition_events SET announced_at=COALESCE(announced_at,UTC_TIMESTAMP(3))
        WHERE viewer_id=? AND presentation_group_id=?`,
      [req.user.userId, groupId],
    );
    await conn.commit();
    return res.json({ announced: true });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[cairn-memory/presentation:announced]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/review-cases/mine', async (req, res) => {
  try {
    const [cases] = await pool.execute(
      `SELECT review_case.id,review_case.case_type,review_case.marker_id,
              review_case.cairn_revision_id,review_case.category,review_case.state,
              review_case.created_at,review_case.disposed_at,review_case.disposition_note,
              revision.content_revision,
              COALESCE(moderation.state,revision.availability,'available') AS content_state,
              CASE WHEN revision.owner_id=? THEN 1 ELSE 0 END AS owner_case
         FROM cairn_review_cases review_case
         LEFT JOIN cairn_revisions revision ON revision.id=review_case.cairn_revision_id
         LEFT JOIN cairn_source_moderation moderation ON moderation.marker_id=review_case.marker_id
        WHERE review_case.submitted_by=?
        ORDER BY review_case.created_at DESC,review_case.id DESC LIMIT 200`,
      [req.user.userId, req.user.userId],
    );
    const [affected] = await pool.execute(
      `WITH owned AS (
         SELECT revision.id AS revision_id,revision.marker_id,revision.content_revision,
                moderation.state AS content_state,moderation.changed_at,
                ROW_NUMBER() OVER (PARTITION BY revision.marker_id
                  ORDER BY revision.content_revision DESC,revision.id DESC) AS revision_rank
           FROM cairn_revisions revision
           JOIN cairn_source_moderation moderation
             ON moderation.marker_id=revision.marker_id
            AND moderation.state IN ('under_review','unavailable')
          WHERE revision.owner_id=?
       )
       SELECT owned.revision_id,owned.marker_id,owned.content_revision,
              owned.content_state,owned.changed_at,
              EXISTS(
                SELECT 1 FROM cairn_review_cases pending
                 WHERE pending.submitted_by=? AND pending.cairn_revision_id=owned.revision_id
                   AND pending.case_type='appeal' AND pending.state='pending'
              ) AS appeal_pending
         FROM owned WHERE owned.revision_rank=1
        ORDER BY owned.changed_at DESC,owned.marker_id DESC LIMIT 200`,
      [req.user.userId, req.user.userId],
    );
    return res.json({
      cases: cases.map(item => ({ ...item, owner_case: Boolean(item.owner_case) })),
      affected_revisions: affected.map(item => ({ ...item, appeal_pending: Boolean(item.appeal_pending) })),
    });
  } catch (error) {
    console.error('[cairn-memory/review-cases:mine]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/revisions/:revision_id/cases', mutationLimiter, async (req, res) => {
  const revisionId = positiveId(req.params.revision_id);
  const caseType = req.body?.case_type;
  const category = req.body?.category;
  const clientSubmissionId = String(req.body?.client_submission_id || '');
  if (!revisionId || !['report', 'appeal'].includes(caseType)
    || !['spam', 'unsafe', 'harassment', 'privacy', 'other'].includes(category)
    || !/^[0-9a-f-]{36}$/i.test(clientSubmissionId)) {
    return res.status(400).json({ error: 'Invalid review case' });
  }
  try {
    const [revisions] = await pool.execute(
      `SELECT revision.id,revision.marker_id,revision.owner_id,
              EXISTS(SELECT 1 FROM cairn_acquisitions acquisition
                      WHERE acquisition.viewer_id=? AND acquisition.cairn_revision_id=revision.id) AS acquired
         FROM cairn_revisions revision WHERE revision.id=? LIMIT 1`,
      [req.user.userId, revisionId],
    );
    const revision = revisions[0];
    const allowed = revision && (caseType === 'appeal'
      ? String(revision.owner_id) === String(req.user.userId)
      : Boolean(revision.acquired) && String(revision.owner_id) !== String(req.user.userId));
    if (!allowed) return res.status(404).json({ error: 'Revision unavailable' });
    const [result] = await pool.execute(
      `INSERT INTO cairn_review_cases
         (client_submission_id,case_type,submitted_by,marker_id,cairn_revision_id,category,detail)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [clientSubmissionId, caseType, req.user.userId, revision.marker_id, revisionId,
        category, typeof req.body?.detail === 'string' ? req.body.detail.slice(0, 500) : null],
    );
    return res.status(201).json({ case_id: String(result.insertId), state: 'pending' });
  } catch (error) {
    console.error('[cairn-memory/cases:create]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

async function requireOperator(req, res, next) {
  const [rows] = await pool.execute(
    'SELECT public_cairn_operator FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1',
    [req.user.userId],
  );
  if (!rows[0]?.public_cairn_operator) return res.status(403).json({ error: 'Operator access required' });
  return next();
}

router.post('/operator/cases/:case_id/decision', mutationLimiter, requireOperator, async (req, res) => {
  const caseId = positiveId(req.params.case_id);
  const caseState = req.body?.case_state;
  const contentState = req.body?.content_state;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : '';
  if (!caseId || !['reviewed', 'dismissed', 'actioned'].includes(caseState)
    || !['available', 'under_review', 'unavailable', 'removed'].includes(contentState)
    || !reason) return res.status(400).json({ error: 'Valid decision required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [cases] = await conn.execute(
      'SELECT * FROM cairn_review_cases WHERE id=? LIMIT 1 FOR UPDATE',
      [caseId],
    );
    const reviewCase = cases[0];
    if (!reviewCase) {
      await conn.rollback();
      return res.status(404).json({ error: 'Case unavailable' });
    }
    await conn.execute(
      `UPDATE cairn_review_cases SET state=?,disposed_at=UTC_TIMESTAMP(3),
              disposed_by=?,disposition_note=? WHERE id=?`,
      [caseState, req.user.userId, reason, caseId],
    );
    const [revisions] = await conn.execute(
      'SELECT owner_id,availability FROM cairn_revisions WHERE id=? LIMIT 1 FOR UPDATE',
      [reviewCase.cairn_revision_id],
    );
    const previous = revisions[0]?.availability ?? null;
    if (previous === 'removed' && contentState !== 'removed') {
      await conn.rollback();
      return res.status(409).json({ error: 'Confirmed removal cannot be restored' });
    }
    await conn.execute(
      `INSERT INTO cairn_source_moderation (marker_id,owner_id,state,reason,changed_by)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE state=VALUES(state),reason=VALUES(reason),
         changed_by=VALUES(changed_by),changed_at=UTC_TIMESTAMP(3)`,
      [reviewCase.marker_id, revisions[0]?.owner_id, contentState, reason, req.user.userId],
    );
    if (contentState === 'removed') {
      await conn.execute(
        `UPDATE cairn_revisions
            SET availability='removed',content_text=NULL,lat=0,lng=0,
                friend_author_name_snapshot=NULL,publication_id=NULL,
                content_sha256=REPEAT('0',64)
          WHERE marker_id=?`,
        [reviewCase.marker_id],
      );
      await conn.execute(
        `UPDATE public_cairn_publications
            SET state='withdrawn',withdrawn_at=COALESCE(withdrawn_at,UTC_TIMESTAMP(3)),
                snapshot_text=NULL,snapshot_lat=NULL,snapshot_lng=NULL,
                snapshot_type=NULL,snapshot_approximate=NULL,snapshot_sha256=NULL,
                decision_reason=COALESCE(decision_reason,'confirmed_content_removal')
          WHERE marker_id=?`,
        [reviewCase.marker_id],
      );
      await conn.execute(
        `UPDATE markers
            SET text='',voice_memo_url=NULL,voice_memo_duration_ms=NULL,
                lat=0,lng=0,alt=NULL,public_snapshot=NULL,permission='personal',
                public_intent=0,public_state='withdrawn',
                public_state_changed_at=UTC_TIMESTAMP(3)
          WHERE id=?`,
        [reviewCase.marker_id],
      );
      await conn.execute(
        `UPDATE cairn_acquisitions SET removed_at=COALESCE(removed_at,UTC_TIMESTAMP(3))
          WHERE marker_id=?`,
        [reviewCase.marker_id],
      );
      await conn.execute(
        `UPDATE cairn_collections SET removed_at=COALESCE(removed_at,UTC_TIMESTAMP(3))
          WHERE marker_id=?`,
        [reviewCase.marker_id],
      );
    } else {
      await conn.execute(
        'UPDATE cairn_revisions SET availability=? WHERE marker_id=?',
        [contentState, reviewCase.marker_id],
      );
    }
    await conn.execute(
      `INSERT INTO cairn_review_audit
         (actor_user_id,event_type,marker_id,cairn_revision_id,case_id,from_state,to_state,reason)
       VALUES (?,'case_decision',?,?,?,?,?,?)`,
      [req.user.userId, reviewCase.marker_id, reviewCase.cairn_revision_id,
        caseId, previous, contentState, reason],
    );
    await conn.commit();
    return res.json({ case_id: String(caseId), state: caseState, content_state: contentState });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[cairn-memory/operator:decision]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

module.exports = router;
