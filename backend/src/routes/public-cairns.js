'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const {
  MAX_HORIZONTAL_ACCURACY_M,
  selectQualifyingEncounterEvidence,
} = require('../services/encounterPolicy');
const {
  PUBLIC_ENCOUNTER_RADIUS_M,
  publicPilotAuthorized,
} = require('../services/publicPublication');
const { eligibleSourceProvenanceSql } = require('../services/activitySourceProvenance');

const router = express.Router();

const PUBLIC_SCENE_LIMIT = 3;
const PUBLIC_SCENE_AUTHOR_LIMIT = 1;
const PUBLIC_NEW_CARD_LIMIT = 1;
const PUBLIC_CANDIDATE_SCAN_LIMIT = 60;
const PUBLIC_EVIDENCE_LIMIT_PER_CANDIDATE = 100;
const PUBLIC_OFFLINE_EVIDENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function pilotDisabled(res) {
  return res.status(404).json({
    error: 'Public Cairns are not enabled in this environment.',
    code: 'PUBLIC_PILOT_DISABLED',
  });
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function authorizationRevision(row) {
  return `public:${row.marker_id}:${row.publication_epoch}:${row.content_revision}`;
}

function resourceRevision(row) {
  return crypto.createHash('sha256')
    .update(`cairn:${row.marker_id}:${row.content_revision}`)
    .digest('hex');
}

function normalizedContentKey(text) {
  return crypto.createHash('sha256')
    .update(String(text || '').replace(/\u001e/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-NZ'))
    .digest('hex');
}

function publicEnvelope(row, includeText = false) {
  const encounteredAt = row.encountered_at instanceof Date
    ? row.encountered_at.toISOString() : row.encountered_at;
  const authorizationIssuedAt = row.authorization_issued_at instanceof Date
    ? row.authorization_issued_at.toISOString() : row.authorization_issued_at;
  const envelope = {
    id: String(row.marker_id),
    author: { id: String(row.author_id), name: row.author_name },
    type: row.type,
    lat: Number(row.lat),
    lng: Number(row.lng),
    approximate: Boolean(row.approximate),
    created_at: row.marker_created_at,
    encountered_at: encounteredAt,
    read_only: true,
    source: 'public_encounter',
    resource_revision: resourceRevision(row),
    authorization_revision: authorizationRevision(row),
    authorization_issued_at: authorizationIssuedAt,
    authorization_expires_at: new Date(new Date(authorizationIssuedAt).getTime() + PUBLIC_CACHE_TTL_MS).toISOString(),
  };
  if (includeText) {
    envelope.text = row.text;
    envelope.display_text = String(row.text || '').trim() || 'A moment here';
  }
  return envelope;
}

async function requireOperator(req, res, next) {
  try {
    const [rows] = await pool.execute(
      'SELECT public_cairn_operator FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1',
      [req.user.userId],
    );
    if (!rows[0]?.public_cairn_operator) {
      return res.status(403).json({ error: 'Operator access required.', code: 'OPERATOR_REQUIRED' });
    }
    return next();
  } catch (error) {
    console.error('[public/operator-auth]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function loadAuthorizedPublicCairn(conn, viewerId, markerId, lock = false) {
  const [rows] = await conn.execute(
    `SELECT encounter.id AS encounter_id, encounter.viewer_id, encounter.author_id,
            encounter.observed_at AS encountered_at,
            encounter.created_at AS authorization_issued_at, encounter.presented_at,
            encounter.opened_at, encounter.hidden_at,
            marker.id AS marker_id,
            publication.snapshot_type AS type,publication.snapshot_text AS text,
            publication.snapshot_lat AS lat,publication.snapshot_lng AS lng,
            publication.snapshot_approximate AS approximate,
            marker.created_at AS marker_created_at,
            marker.content_revision, marker.publication_epoch,
            author.name AS author_name,
            publication.id AS publication_id, publication.state AS publication_state
       FROM public_cairn_encounters encounter
       JOIN markers marker ON marker.id=encounter.marker_id
       JOIN users author ON author.id=encounter.author_id AND author.deleted_at IS NULL
       JOIN public_cairn_publications publication ON publication.id=encounter.publication_id
      WHERE encounter.viewer_id=? AND encounter.marker_id=?
        AND encounter.hidden_at IS NULL
        AND marker.user_id=encounter.author_id
        AND marker.permission='public' AND marker.public_intent=1
        AND marker.public_state='published' AND marker.status <> 'hidden'
        AND marker.publication_epoch=encounter.publication_epoch
        AND marker.content_revision=encounter.content_revision
        AND publication.state='published'
        AND publication.publication_epoch=marker.publication_epoch
        AND publication.content_revision=marker.content_revision
        AND NOT EXISTS (
          SELECT 1 FROM hidden_items hidden
           WHERE hidden.user_id=encounter.viewer_id
             AND hidden.item_type='mark' AND hidden.item_id=marker.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users blocked
           WHERE (blocked.blocker_id=encounter.viewer_id AND blocked.blocked_id=encounter.author_id)
              OR (blocked.blocker_id=encounter.author_id AND blocked.blocked_id=encounter.viewer_id)
        )
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [viewerId, markerId],
  );
  return rows[0] ?? null;
}

const actionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.user?.userId ? `public:${req.user.userId}` : ipKeyGenerator(req.ip),
  message: { error: 'Too many Public Cairn actions. Please slow down.' },
});

router.use(authenticate);

router.get('/capabilities', (req, res) => res.json({
  enabled: publicPilotAuthorized(req.user.userId),
  scope: 'cairns_text_only',
  scene_limit: PUBLIC_SCENE_LIMIT,
  scene_author_limit: PUBLIC_SCENE_AUTHOR_LIMIT,
  new_card_limit: PUBLIC_NEW_CARD_LIMIT,
}));

router.use((req, res, next) => (publicPilotAuthorized(req.user.userId) ? next() : pilotDisabled(res)));

// Qualify already-uploaded real Activity witnesses. The client supplies only
// the Activity identity; source, timestamps, publication time and distance
// are all re-established from server-owned rows. Active Activities use the
// incrementally uploaded route_points authority so discovery can surface
// before Finish; completed Activities use their immutable canonical route.
router.post('/encounters/verify', actionLimiter, async (req, res) => {
  const sourceActivityClientId = typeof req.body?.source_activity_client_id === 'string'
    ? req.body.source_activity_client_id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sourceActivityClientId)) {
    return res.status(400).json({ error: 'A valid source_activity_client_id is required.' });
  }
  const viewerId = req.user.userId;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [sessions] = await conn.execute(
      `SELECT id,source_provenance,finalized_at FROM sessions
        WHERE user_id=? AND client_activity_id=?
          AND abandoned_at IS NULL
          AND ${eligibleSourceProvenanceSql('source_provenance')}
        LIMIT 1 FOR SHARE`,
      [viewerId, sourceActivityClientId],
    );
    if (!sessions[0]) {
      await conn.rollback();
      return res.status(409).json({
        error: 'Only a current or completed real Activity can qualify a Public encounter.',
        code: 'PUBLIC_ACTIVITY_NOT_ELIGIBLE',
      });
    }
    const [candidates] = await conn.execute(
      `SELECT publication.id AS publication_id, publication.owner_id AS author_id,
              publication.publication_epoch, publication.content_revision,
              publication.published_at, marker.id AS marker_id,
              publication.snapshot_lat AS lat,publication.snapshot_lng AS lng
         FROM public_cairn_publications publication
         JOIN markers marker ON marker.id=publication.marker_id
         JOIN users author ON author.id=publication.owner_id AND author.deleted_at IS NULL
        WHERE publication.state='published' AND publication.published_at IS NOT NULL
          AND marker.permission='public' AND marker.public_intent=1
          AND marker.public_state='published' AND marker.status <> 'hidden'
          AND marker.publication_epoch=publication.publication_epoch
          AND marker.content_revision=publication.content_revision
          AND publication.owner_id <> ?
          AND NOT EXISTS (
            SELECT 1 FROM hidden_items hidden
             WHERE hidden.user_id=? AND hidden.item_type='mark' AND hidden.item_id=marker.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM blocked_users blocked
             WHERE (blocked.blocker_id=? AND blocked.blocked_id=publication.owner_id)
                OR (blocked.blocker_id=publication.owner_id AND blocked.blocked_id=?)
          )
          AND EXISTS (
            SELECT 1
              FROM (
                SELECT witness.first_lat AS lat,witness.first_lng AS lng,
                       witness.first_observed_at_ms AS ts,witness.source_segment_id
                  FROM memory_presence_witnesses witness
                 WHERE witness.user_id=? AND witness.source_activity_client_id=?
                   AND witness.evidence_source='activity_real'
                   AND witness.continuity_state='accepted' AND witness.horizontal_accuracy_m<=?
                UNION ALL
                SELECT witness.lat,witness.lng,witness.observed_at_ms AS ts,
                       witness.source_segment_id
                  FROM memory_presence_witnesses witness
                 WHERE witness.user_id=? AND witness.source_activity_client_id=?
                   AND witness.evidence_source='activity_real'
                   AND witness.continuity_state='accepted' AND witness.horizontal_accuracy_m<=?
                   AND witness.observed_at_ms>witness.first_observed_at_ms
              ) nearby
              JOIN sessions source_session
                ON source_session.user_id=? AND source_session.client_activity_id=?
               AND source_session.abandoned_at IS NULL
               AND ${eligibleSourceProvenanceSql('source_session.source_provenance')}
              JOIN JSON_TABLE(COALESCE(
                CASE WHEN source_session.finalized_at IS NULL
                  THEN source_session.route_points
                  ELSE source_session.route_points_canonical END,
                JSON_ARRAY()
              ), '$[*]' COLUMNS(
                lat DOUBLE PATH '$.lat',lng DOUBLE PATH '$.lng',
                observed_ms BIGINT PATH '$.t',segment_id VARCHAR(80) PATH '$.segment_id'
              )) canonical
                ON ABS(CAST(canonical.observed_ms AS SIGNED)-CAST(nearby.ts AS SIGNED))<=1000
               AND ST_Distance_Sphere(POINT(canonical.lng,canonical.lat),POINT(nearby.lng,nearby.lat))<=5
               AND COALESCE(canonical.segment_id,'legacy-0')=COALESCE(nearby.source_segment_id,'legacy-0')
             WHERE ST_Distance_Sphere(POINT(nearby.lng,nearby.lat),
                     POINT(publication.snapshot_lng,publication.snapshot_lat))<=?
          )
        ORDER BY publication.published_at DESC, publication.id DESC
        LIMIT ${PUBLIC_CANDIDATE_SCAN_LIMIT} FOR SHARE`,
      [viewerId, viewerId, viewerId, viewerId,
        viewerId, sourceActivityClientId, MAX_HORIZONTAL_ACCURACY_M,
        viewerId, sourceActivityClientId, MAX_HORIZONTAL_ACCURACY_M,
        viewerId, sourceActivityClientId, PUBLIC_ENCOUNTER_RADIUS_M],
    );
    const encountered = [];
    for (const candidate of candidates) {
      const [evidenceRows] = await conn.execute(
        `SELECT DISTINCT evidence.id, evidence.lat, evidence.lng, evidence.ts,
                evidence.evidence_source, evidence.source_activity_client_id,
                evidence.source_segment_id,evidence.horizontal_accuracy_m, evidence.continuity_state
           FROM (
             SELECT witness.id, witness.first_lat AS lat, witness.first_lng AS lng,
                    witness.first_observed_at_ms AS ts, witness.evidence_source,
                    witness.source_activity_client_id,witness.source_segment_id,witness.horizontal_accuracy_m,
                    witness.continuity_state
               FROM memory_presence_witnesses witness
              WHERE witness.user_id=? AND witness.source_activity_client_id=?
                AND witness.evidence_source='activity_real'
             UNION ALL
             SELECT witness.id, witness.lat, witness.lng, witness.observed_at_ms AS ts,
                    witness.evidence_source,witness.source_activity_client_id,witness.source_segment_id,
                    witness.horizontal_accuracy_m, witness.continuity_state
               FROM memory_presence_witnesses witness
              WHERE witness.user_id=? AND witness.source_activity_client_id=?
                AND witness.evidence_source='activity_real'
                AND witness.observed_at_ms > witness.first_observed_at_ms
           ) evidence
           JOIN sessions session
             ON session.user_id=?
            AND session.client_activity_id=evidence.source_activity_client_id
            AND session.abandoned_at IS NULL
            AND ${eligibleSourceProvenanceSql('session.source_provenance')}
           JOIN JSON_TABLE(COALESCE(
             CASE WHEN session.finalized_at IS NULL
               THEN session.route_points
               ELSE session.route_points_canonical END,
             JSON_ARRAY()
           ), '$[*]' COLUMNS(
             lat DOUBLE PATH '$.lat', lng DOUBLE PATH '$.lng',
             observed_ms BIGINT PATH '$.t', segment_id VARCHAR(80) PATH '$.segment_id'
           )) canonical
             ON ABS(CAST(canonical.observed_ms AS SIGNED)-CAST(evidence.ts AS SIGNED)) <= 1000
            AND ST_Distance_Sphere(POINT(canonical.lng,canonical.lat),POINT(evidence.lng,evidence.lat)) <= 5
            AND COALESCE(canonical.segment_id,'legacy-0')=COALESCE(evidence.source_segment_id,'legacy-0')
          WHERE evidence.continuity_state='accepted'
            AND evidence.horizontal_accuracy_m <= ?
            AND ST_Distance_Sphere(POINT(evidence.lng,evidence.lat),POINT(?,?)) <= ?
            AND FROM_UNIXTIME(evidence.ts / 1000) >= ?
            AND evidence.ts >= (UNIX_TIMESTAMP(UTC_TIMESTAMP(3)) * 1000) - ?
            AND evidence.ts <= (UNIX_TIMESTAMP(UTC_TIMESTAMP(3)) * 1000) + 300000
          ORDER BY evidence.ts ASC, evidence.id ASC
          LIMIT ${PUBLIC_EVIDENCE_LIMIT_PER_CANDIDATE}`,
        [viewerId, sourceActivityClientId, viewerId, sourceActivityClientId, viewerId,
          MAX_HORIZONTAL_ACCURACY_M, candidate.lng, candidate.lat, PUBLIC_ENCOUNTER_RADIUS_M,
          candidate.published_at, PUBLIC_OFFLINE_EVIDENCE_MAX_AGE_MS],
      );
      const evidence = selectQualifyingEncounterEvidence(evidenceRows);
      if (!evidence) continue;
      await conn.execute(
        `INSERT INTO public_cairn_encounters
           (viewer_id,author_id,marker_id,publication_id,publication_epoch,
            content_revision,evidence_witness_id,source_activity_client_id,observed_at)
         VALUES (?,?,?,?,?,?,?, ?,FROM_UNIXTIME(? / 1000))
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [viewerId, candidate.author_id, candidate.marker_id, candidate.publication_id,
          candidate.publication_epoch, candidate.content_revision, evidence.id,
          sourceActivityClientId, evidence.ts],
      );
      encountered.push(String(candidate.marker_id));
    }
    await conn.commit();
    return res.json({ encountered_marker_ids: encountered });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[public/encounters/verify]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/scene', async (req, res) => {
  const viewerId = req.user.userId;
  try {
    const [rows] = await pool.execute(
      `WITH eligible AS (
         SELECT encounter.id AS encounter_id, encounter.viewer_id, encounter.author_id,
                encounter.observed_at AS encountered_at,
                encounter.created_at AS authorization_issued_at, encounter.presented_at,
                marker.id AS marker_id,
                publication.snapshot_type AS type,publication.snapshot_text AS text,
                publication.snapshot_lat AS lat,publication.snapshot_lng AS lng,
                publication.snapshot_approximate AS approximate,
                marker.created_at AS marker_created_at,
                marker.content_revision, marker.publication_epoch, author.name AS author_name,
                publication.id AS publication_id,
                ST_Distance_Sphere(POINT(publication.snapshot_lng,publication.snapshot_lat),
                  POINT(witness.lng,witness.lat)) AS local_distance_m,
                ROW_NUMBER() OVER (
                  PARTITION BY encounter.author_id
                  ORDER BY encounter.created_at DESC, encounter.id DESC
                ) AS author_rank
           FROM public_cairn_encounters encounter
           JOIN markers marker ON marker.id=encounter.marker_id
           JOIN users author ON author.id=encounter.author_id AND author.deleted_at IS NULL
           JOIN public_cairn_publications publication ON publication.id=encounter.publication_id
           LEFT JOIN memory_presence_witnesses witness ON witness.id=encounter.evidence_witness_id
          WHERE encounter.viewer_id=? AND encounter.hidden_at IS NULL
            AND marker.permission='public' AND marker.public_intent=1
            AND marker.public_state='published' AND marker.status <> 'hidden'
            AND marker.publication_epoch=encounter.publication_epoch
            AND marker.content_revision=encounter.content_revision
            AND publication.state='published'
            AND publication.publication_epoch=marker.publication_epoch
            AND publication.content_revision=marker.content_revision
            AND NOT EXISTS (
              SELECT 1 FROM hidden_items hidden
               WHERE hidden.user_id=encounter.viewer_id
                 AND hidden.item_type='mark' AND hidden.item_id=marker.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM blocked_users blocked
               WHERE (blocked.blocker_id=encounter.viewer_id AND blocked.blocked_id=encounter.author_id)
                  OR (blocked.blocker_id=encounter.author_id AND blocked.blocked_id=encounter.viewer_id)
            )
       )
       SELECT * FROM eligible WHERE author_rank <= ${PUBLIC_SCENE_AUTHOR_LIMIT}
        ORDER BY COALESCE(local_distance_m, 999999999), encountered_at DESC, marker_id
        LIMIT ${PUBLIC_CANDIDATE_SCAN_LIMIT}`,
      [viewerId],
    );
    const contentKeys = new Set();
    const selectedRows = [];
    for (const row of rows) {
      const contentKey = normalizedContentKey(row.text);
      if (contentKeys.has(contentKey)) continue;
      contentKeys.add(contentKey);
      selectedRows.push(row);
      if (selectedRows.length >= PUBLIC_SCENE_LIMIT) break;
    }
    const entries = selectedRows.map(row => publicEnvelope(row, false));
    const unpresented = selectedRows.find(row => row.presented_at == null);
    return res.json({
      entries,
      newly_surfaced: unpresented ? [publicEnvelope(unpresented, false)] : [],
      limits: { scene: PUBLIC_SCENE_LIMIT, per_author: PUBLIC_SCENE_AUTHOR_LIMIT, new_cards: PUBLIC_NEW_CARD_LIMIT },
    });
  } catch (error) {
    console.error('[public/scene]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/cairns/:id', async (req, res) => {
  const markerId = positiveId(req.params.id);
  if (!markerId) return res.status(400).json({ error: 'Invalid Cairn id.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const row = await loadAuthorizedPublicCairn(conn, req.user.userId, markerId, true);
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ error: 'Cairn unavailable.', code: 'PUBLIC_CAIRN_UNAVAILABLE' });
    }
    await conn.execute(
      'UPDATE public_cairn_encounters SET opened_at=COALESCE(opened_at,UTC_TIMESTAMP(3)) WHERE id=?',
      [row.encounter_id],
    );
    await conn.commit();
    return res.json({ cairn: publicEnvelope(row, true) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[public/detail]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.post('/cairns/:id/present', actionLimiter, async (req, res) => {
  const markerId = positiveId(req.params.id);
  if (!markerId) return res.status(400).json({ error: 'Invalid Cairn id.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const row = await loadAuthorizedPublicCairn(conn, req.user.userId, markerId, true);
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ error: 'Cairn unavailable.', code: 'PUBLIC_CAIRN_UNAVAILABLE' });
    }
    await conn.execute(
      'UPDATE public_cairn_encounters SET presented_at=COALESCE(presented_at,UTC_TIMESTAMP(3)) WHERE id=?',
      [row.encounter_id],
    );
    await conn.commit();
    return res.json({ presented: true, id: String(markerId) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[public/present]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.post('/cairns/:id/thanks', actionLimiter, async (req, res) => {
  const markerId = positiveId(req.params.id);
  if (!markerId) return res.status(400).json({ error: 'Invalid Cairn id.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const row = await loadAuthorizedPublicCairn(conn, req.user.userId, markerId, true);
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ error: 'Cairn unavailable.', code: 'PUBLIC_CAIRN_UNAVAILABLE' });
    }
    await conn.execute(
      `INSERT INTO public_cairn_thanks
         (viewer_id,author_id,marker_id,publication_epoch)
       VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [req.user.userId, row.author_id, markerId, row.publication_epoch],
    );
    await conn.commit();
    return res.json({ thanked: true, id: String(markerId) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[public/thanks]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.post('/cairns/:id/hide', actionLimiter, async (req, res) => {
  const markerId = positiveId(req.params.id);
  if (!markerId) return res.status(400).json({ error: 'Invalid Cairn id.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const row = await loadAuthorizedPublicCairn(conn, req.user.userId, markerId, true);
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ error: 'Cairn unavailable.', code: 'PUBLIC_CAIRN_UNAVAILABLE' });
    }
    await conn.execute(
      `INSERT INTO hidden_items (user_id,item_type,item_id) VALUES (?,'mark',?)
       ON DUPLICATE KEY UPDATE hidden_at=hidden_at`,
      [req.user.userId, markerId],
    );
    await conn.execute(
      'UPDATE public_cairn_encounters SET hidden_at=COALESCE(hidden_at,UTC_TIMESTAMP(3)) WHERE viewer_id=? AND marker_id=?',
      [req.user.userId, markerId],
    );
    await conn.commit();
    return res.json({ hidden: true, id: String(markerId) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[public/hide]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.post('/cairns/:id/report', actionLimiter, async (req, res) => {
  const markerId = positiveId(req.params.id);
  const clientSubmissionId = typeof req.body?.client_submission_id === 'string'
    ? req.body.client_submission_id : '';
  const category = String(req.body?.category || '');
  const detail = typeof req.body?.detail === 'string' ? req.body.detail.trim().slice(0, 500) : null;
  if (!markerId) return res.status(400).json({ error: 'Invalid Cairn id.' });
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(clientSubmissionId)) {
    return res.status(400).json({ error: 'A valid client_submission_id is required.' });
  }
  if (!['spam', 'unsafe', 'harassment', 'other'].includes(category)) {
    return res.status(400).json({ error: 'Invalid report category.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const row = await loadAuthorizedPublicCairn(conn, req.user.userId, markerId, true);
    if (!row) {
      await conn.rollback();
      return res.status(404).json({ error: 'Cairn unavailable.', code: 'PUBLIC_CAIRN_UNAVAILABLE' });
    }
    const [result] = await conn.execute(
      `INSERT INTO public_cairn_reports
         (client_submission_id,viewer_id,author_id,marker_id,publication_id,
          publication_epoch,category,detail)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [clientSubmissionId, req.user.userId, row.author_id, markerId, row.publication_id,
        row.publication_epoch, category, detail],
    );
    await conn.commit();
    return res.json({ reported: true, report_id: String(result.insertId), emergency_service: false });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[public/report]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/operator/submissions', requireOperator, async (req, res) => {
  const state = ['pending', 'published', 'rejected', 'suspended', 'withdrawn'].includes(req.query.state)
    ? req.query.state : 'pending';
  const afterId = positiveId(req.query.after_id) ?? 0;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
  try {
    const [rows] = await pool.execute(
      `SELECT publication.id,publication.marker_id,publication.owner_id,
              publication.publication_epoch,publication.content_revision,
              publication.state,publication.submitted_at,publication.decided_at,
              publication.snapshot_type AS type,publication.snapshot_text AS text,
              publication.snapshot_lat AS lat,publication.snapshot_lng AS lng,
              publication.snapshot_approximate AS approximate,
              publication.snapshot_sha256,marker.created_at,
              owner.name AS owner_name
         FROM public_cairn_publications publication
         JOIN markers marker ON marker.id=publication.marker_id
         JOIN users owner ON owner.id=publication.owner_id
        WHERE publication.state=? AND publication.id>?
        ORDER BY publication.id ASC LIMIT ${limit + 1}`,
      [state, afterId],
    );
    const hasMore = rows.length > limit;
    const submissions = hasMore ? rows.slice(0, limit) : rows;
    return res.json({
      submissions,
      has_more: hasMore,
      next_after_id: hasMore ? String(submissions[submissions.length - 1].id) : null,
    });
  } catch (error) {
    console.error('[public/operator/submissions]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/operator/submissions/:id/decision', actionLimiter, requireOperator, async (req, res) => {
  const publicationId = positiveId(req.params.id);
  const action = String(req.body?.action || '');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : null;
  if (!publicationId) return res.status(400).json({ error: 'Invalid publication id.' });
  if (!['approve', 'reject', 'suspend', 'restore'].includes(action)) {
    return res.status(400).json({ error: 'Invalid operator action.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT publication.*,marker.permission,marker.public_intent,marker.public_state,
              marker.publication_epoch AS marker_publication_epoch,
              marker.content_revision AS marker_content_revision
         FROM public_cairn_publications publication
         JOIN markers marker ON marker.id=publication.marker_id
        WHERE publication.id=? LIMIT 1 FOR UPDATE`,
      [publicationId],
    );
    const current = rows[0];
    if (!current) {
      await conn.rollback();
      return res.status(404).json({ error: 'Submission not found.' });
    }
    const exactCurrent = current.permission === 'public' && Boolean(current.public_intent)
      && Number(current.publication_epoch) === Number(current.marker_publication_epoch)
      && Number(current.content_revision) === Number(current.marker_content_revision);
    if (!exactCurrent) {
      await conn.rollback();
      return res.status(409).json({
        error: 'This submission is no longer the current Cairn revision.',
        code: 'STALE_PUBLICATION_REVISION',
      });
    }
    const allowed = (action === 'approve' || action === 'reject') ? current.state === 'pending'
      : action === 'suspend' ? current.state === 'published'
        : current.state === 'suspended';
    if (!allowed) {
      await conn.rollback();
      return res.status(409).json({ error: 'Action is not valid for the current publication state.', code: 'PUBLIC_STATE_CONFLICT' });
    }
    const nextState = action === 'approve' || action === 'restore' ? 'published'
      : action === 'reject' ? 'rejected' : 'suspended';
    await conn.execute(
      `UPDATE public_cairn_publications
          SET state=?,decided_at=UTC_TIMESTAMP(3),decided_by=?,decision_reason=?,
              published_at=CASE
                WHEN ?='restore' THEN UTC_TIMESTAMP(3)
                WHEN ?='published' THEN COALESCE(published_at,UTC_TIMESTAMP(3))
                ELSE published_at END
        WHERE id=?`,
      [nextState, req.user.userId, reason, action, nextState, publicationId],
    );
    await conn.execute(
      `UPDATE markers SET public_state=?,public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=?`,
      [nextState, current.marker_id, current.owner_id],
    );
    await conn.commit();
    return res.json({
      publication_id: String(publicationId), marker_id: String(current.marker_id),
      publication_epoch: Number(current.publication_epoch),
      content_revision: Number(current.content_revision), state: nextState,
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[public/operator/decision]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/operator/reports', requireOperator, async (req, res) => {
  const state = ['pending', 'reviewed', 'dismissed', 'actioned'].includes(req.query.state)
    ? req.query.state : 'pending';
  const afterId = positiveId(req.query.after_id) ?? 0;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
  try {
    const [rows] = await pool.execute(
      `SELECT report.id,report.viewer_id,report.author_id,report.marker_id,
              report.publication_id,report.publication_epoch,
              publication.content_revision,publication.snapshot_type AS type,
              publication.snapshot_text AS text,publication.snapshot_lat AS lat,
              publication.snapshot_lng AS lng,
              publication.snapshot_approximate AS approximate,
              publication.snapshot_sha256,
              report.category,report.detail,report.state,report.created_at
         FROM public_cairn_reports report
         JOIN public_cairn_publications publication ON publication.id=report.publication_id
        WHERE report.state=? AND report.id>?
        ORDER BY report.id ASC LIMIT ${limit + 1}`,
      [state, afterId],
    );
    const hasMore = rows.length > limit;
    const reports = hasMore ? rows.slice(0, limit) : rows;
    return res.json({ reports, has_more: hasMore, next_after_id: hasMore ? String(reports[reports.length - 1].id) : null });
  } catch (error) {
    console.error('[public/operator/reports]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/operator/reports/:id/disposition', actionLimiter, requireOperator, async (req, res) => {
  const reportId = positiveId(req.params.id);
  const state = String(req.body?.state || '');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 240) : null;
  if (!reportId) return res.status(400).json({ error: 'Invalid report id.' });
  if (!['reviewed', 'dismissed', 'actioned'].includes(state)) {
    return res.status(400).json({ error: 'Invalid report disposition.' });
  }
  try {
    const [result] = await pool.execute(
      `UPDATE public_cairn_reports SET state=?,disposed_at=UTC_TIMESTAMP(3),
              disposed_by=?,disposition_note=? WHERE id=?`,
      [state, req.user.userId, note, reportId],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Report not found.' });
    return res.json({ report_id: String(reportId), state });
  } catch (error) {
    console.error('[public/operator/report-disposition]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.constants = {
  PUBLIC_SCENE_LIMIT,
  PUBLIC_SCENE_AUTHOR_LIMIT,
  PUBLIC_NEW_CARD_LIMIT,
  PUBLIC_CANDIDATE_SCAN_LIMIT,
  PUBLIC_EVIDENCE_LIMIT_PER_CANDIDATE,
  PUBLIC_OFFLINE_EVIDENCE_MAX_AGE_MS,
  PUBLIC_CACHE_TTL_MS,
};
