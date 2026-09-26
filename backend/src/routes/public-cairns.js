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
  reconcilePublicSubmissionsForActivityInTransaction,
  synchronizePublicSubmission,
} = require('../services/publicPublication');
const { eligibleSourceProvenanceSql } = require('../services/activitySourceProvenance');
const {
  appendPublicModerationAudit,
  resolvePublicationTransition,
  resolveReportTransition,
} = require('../services/publicModerationAudit');
const {
  locationPolicyVersion,
  publicLocationPolicyConfigured,
} = require('../services/publicLocationPolicy');

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

function boundedQueryLimit(value, fallback, maximum) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return Math.min(maximum, parsed);
}

function authorizationRevision(row) {
  return `public:${row.marker_id}:${row.publication_epoch}:${row.content_revision}:${row.snapshot_location_policy_version}`;
}

function resourceRevision(row) {
  return crypto.createHash('sha256')
    .update(`cairn:${row.marker_id}:${row.content_revision}:${row.snapshot_location_policy_version}`)
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

async function lockOperatorAuthority(conn, userId) {
  const [rows] = await conn.execute(
    `SELECT id,public_cairn_operator FROM users
      WHERE id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [userId],
  );
  return Boolean(rows[0]?.public_cairn_operator);
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
            publication.snapshot_location_policy_version,
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
        AND publication.snapshot_location_policy_version=?
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
    [viewerId, markerId, locationPolicyVersion()],
  );
  const row = rows[0] ?? null;
  // Canary membership applies to both sides of a Public exchange. Removing
  // an author must fail every consumer read closed without rewriting the
  // immutable moderation record.
  return row && publicPilotAuthorized(row.author_id) ? row : null;
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

// The exposure kill-switch stops author and consumer traffic, while protected
// operator queues/audit remain reachable for incident response and cleanup.
router.use((req, res, next) => (
  req.path.startsWith('/operator/') || publicPilotAuthorized(req.user.userId)
    ? next()
    : pilotDisabled(res)
));

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
    const [viewerRows] = await conn.execute(
      'SELECT id FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [viewerId],
    );
    if (!viewerRows[0]) {
      await conn.rollback();
      return res.status(401).json({ error: 'Authenticated account unavailable.' });
    }
    // This endpoint is the explicit, durably queued retry seam after Activity
    // ACK as well as the live walking discovery seam. It reconciles Public
    // Cairns authored from this exact immutable Activity before looking for
    // other authors' encounters.
    await reconcilePublicSubmissionsForActivityInTransaction(
      conn,
      viewerId,
      sourceActivityClientId,
      { ownerLocked: true },
    );
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
    if (sessions[0].finalized_at) {
      // Live route_points may contain evidence later rejected from the frozen
      // canonical artifact. Revoke only encounters whose exact witness/time/
      // segment no longer exists in final truth; retained canonical evidence
      // keeps its authorization.
      await conn.execute(
        `DELETE encounter FROM public_cairn_encounters encounter
          LEFT JOIN memory_presence_witnesses witness
            ON witness.id=encounter.evidence_witness_id AND witness.user_id=encounter.viewer_id
          JOIN sessions final_session
            ON final_session.user_id=encounter.viewer_id
           AND final_session.client_activity_id=encounter.source_activity_client_id
           AND final_session.finalized_at IS NOT NULL
         WHERE encounter.viewer_id=? AND encounter.source_activity_client_id=?
           AND NOT EXISTS (
             SELECT 1 FROM JSON_TABLE(COALESCE(final_session.route_points_canonical,JSON_ARRAY()),
               '$[*]' COLUMNS(
                 lat DOUBLE PATH '$.lat',lng DOUBLE PATH '$.lng',
                 observed_ms BIGINT PATH '$.t',segment_id VARCHAR(80) PATH '$.segment_id'
               )) canonical
              WHERE ABS(CAST(canonical.observed_ms AS SIGNED)
                    - CAST(COALESCE(encounter.evidence_observed_at_ms,
                        UNIX_TIMESTAMP(encounter.observed_at) * 1000) AS SIGNED))<=1000
                AND ST_Distance_Sphere(
                  POINT(canonical.lng,canonical.lat),
                  POINT(
                    COALESCE(encounter.evidence_lng,
                      CASE WHEN ABS(CAST(witness.first_observed_at_ms AS SIGNED)
                             - CAST(UNIX_TIMESTAMP(encounter.observed_at) * 1000 AS SIGNED))<=1000
                        THEN witness.first_lng ELSE witness.lng END),
                    COALESCE(encounter.evidence_lat,
                      CASE WHEN ABS(CAST(witness.first_observed_at_ms AS SIGNED)
                             - CAST(UNIX_TIMESTAMP(encounter.observed_at) * 1000 AS SIGNED))<=1000
                        THEN witness.first_lat ELSE witness.lat END)
                  )
                )<=5
                AND COALESCE(canonical.segment_id,'legacy-0')=
                    COALESCE(encounter.evidence_segment_id,witness.source_segment_id,'legacy-0')
           )`,
        [viewerId, sourceActivityClientId],
      );
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
          AND publication.snapshot_location_policy_version=?
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
      [locationPolicyVersion(), viewerId, viewerId, viewerId, viewerId,
        viewerId, sourceActivityClientId, MAX_HORIZONTAL_ACCURACY_M,
        viewerId, sourceActivityClientId, MAX_HORIZONTAL_ACCURACY_M,
        viewerId, sourceActivityClientId, PUBLIC_ENCOUNTER_RADIUS_M],
    );
    const encountered = [];
    for (const candidate of candidates.filter(row => publicPilotAuthorized(row.author_id))) {
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
            content_revision,evidence_witness_id,evidence_lat,evidence_lng,
            evidence_observed_at_ms,evidence_segment_id,evidence_source,
            evidence_horizontal_accuracy_m,source_activity_client_id,observed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, ?,FROM_UNIXTIME(? / 1000))
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [viewerId, candidate.author_id, candidate.marker_id, candidate.publication_id,
          candidate.publication_epoch, candidate.content_revision, evidence.id,
          evidence.lat, evidence.lng, evidence.ts, evidence.source_segment_id ?? null,
          evidence.evidence_source, evidence.horizontal_accuracy_m ?? null,
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
                publication.snapshot_location_policy_version,
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
            AND publication.snapshot_location_policy_version=?
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
      [viewerId, locationPolicyVersion()],
    );
    const contentKeys = new Set();
    const selectedRows = [];
    for (const row of rows.filter(candidate => publicPilotAuthorized(candidate.author_id))) {
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
    const [storedReports] = await conn.execute(
      `SELECT id,client_submission_id,viewer_id,author_id,marker_id,publication_id,
              publication_epoch,category,detail
         FROM public_cairn_reports WHERE id=? LIMIT 1 FOR UPDATE`,
      [result.insertId],
    );
    const stored = storedReports[0];
    const sameImmutableRequest = stored
      && stored.client_submission_id === clientSubmissionId
      && String(stored.viewer_id) === String(req.user.userId)
      && String(stored.author_id) === String(row.author_id)
      && String(stored.marker_id) === String(markerId)
      && String(stored.publication_id) === String(row.publication_id)
      && Number(stored.publication_epoch) === Number(row.publication_epoch)
      && stored.category === category
      && String(stored.detail ?? '') === String(detail ?? '');
    if (!sameImmutableRequest) {
      await conn.rollback();
      return res.status(409).json({
        error: 'Report retry identity does not match the original submission.',
        code: 'PUBLIC_REPORT_IDENTITY_MISMATCH',
      });
    }
    const [existingAudit] = await conn.execute(
      `SELECT id FROM public_cairn_moderation_audit
        WHERE event_type='report_submitted' AND report_id=? LIMIT 1 FOR UPDATE`,
      [stored.id],
    );
    if (!existingAudit[0]) {
      await appendPublicModerationAudit(conn, {
        eventType: 'report_submitted',
        actorUserId: req.user.userId,
        ownerUserId: row.author_id,
        markerId,
        publicationId: row.publication_id,
        reportId: stored.id,
        publicationEpoch: row.publication_epoch,
        contentRevision: row.content_revision,
        fromState: null,
        toState: 'pending',
        reason: category,
      });
    }
    await conn.commit();
    return res.json({ reported: true, report_id: String(stored.id), emergency_service: false });
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
  const limit = boundedQueryLimit(req.query.limit, 25, 50);
  if (limit === null) return res.status(400).json({ error: 'limit must be a positive integer.' });
  try {
    const [rows] = await pool.execute(
      `SELECT publication.id,publication.marker_id,publication.owner_id,
              publication.publication_epoch,publication.content_revision,
              publication.state,publication.submitted_at,publication.decided_at,
              publication.snapshot_type AS type,publication.snapshot_text AS text,
              publication.snapshot_lat AS lat,publication.snapshot_lng AS lng,
              publication.snapshot_approximate AS approximate,
              publication.snapshot_location_policy_version,
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
  if (!reason) return res.status(400).json({ error: 'A decision reason is required.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (!await lockOperatorAuthority(conn, req.user.userId)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Operator access required.', code: 'OPERATOR_REQUIRED' });
    }
    // Resolve IDs without locks, then acquire the shared global order:
    // operator user -> marker -> publication.
    const [identityRows] = await conn.execute(
      'SELECT marker_id,owner_id FROM public_cairn_publications WHERE id=? LIMIT 1',
      [publicationId],
    );
    if (!identityRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: 'Submission not found.' });
    }
    // A policy revision may safely re-snapshot a suspended Cairn while
    // leaving it suspended. Only an explicit operator restore can expose the
    // refreshed snapshot; denied places become withdrawn here instead.
    if (action === 'restore') {
      const reconciliation = await synchronizePublicSubmission(
        conn,
        identityRows[0].marker_id,
        identityRows[0].owner_id,
        { actorUserId: req.user.userId },
      );
      if (reconciliation.state === 'not_public' || reconciliation.state === 'withdrawn') {
        await conn.commit();
        return res.status(409).json({
          error: 'This Cairn is no longer eligible for Public exposure.',
          code: reconciliation.code,
          state: reconciliation.state,
        });
      }
      if (reconciliation.policyResnapshotted
        && String(reconciliation.publicationId) !== String(publicationId)) {
        await conn.commit();
        return res.status(409).json({
          error: 'The location policy changed. Review the refreshed suspended snapshot before restoring it.',
          code: 'PUBLIC_LOCATION_POLICY_REFRESHED',
          publication_id: reconciliation.publicationId,
          publication_epoch: reconciliation.publicationEpoch,
          state: reconciliation.state,
        });
      }
    }
    const [markerRows] = await conn.execute(
      `SELECT id,user_id,permission,public_intent,public_state,publication_epoch,content_revision
         FROM markers WHERE id=? LIMIT 1 FOR UPDATE`,
      [identityRows[0].marker_id],
    );
    const [publicationRows] = await conn.execute(
      'SELECT * FROM public_cairn_publications WHERE id=? AND marker_id=? LIMIT 1 FOR UPDATE',
      [publicationId, identityRows[0].marker_id],
    );
    const marker = markerRows[0];
    const current = publicationRows[0];
    if (!marker || !current || String(marker.user_id) !== String(current.owner_id)) {
      await conn.rollback();
      return res.status(404).json({ error: 'Submission not found.' });
    }
    const exactCurrent = marker.permission === 'public' && Boolean(marker.public_intent)
      && Number(current.publication_epoch) === Number(marker.publication_epoch)
      && Number(current.content_revision) === Number(marker.content_revision);
    if (!exactCurrent) {
      await conn.rollback();
      return res.status(409).json({
        error: 'This submission is no longer the current Cairn revision.',
        code: 'STALE_PUBLICATION_REVISION',
      });
    }
    if (['approve', 'restore'].includes(action)) {
      const policyCurrent = publicLocationPolicyConfigured()
        && current.snapshot_location_policy_version === locationPolicyVersion();
      if (!publicPilotAuthorized(current.owner_id) || !policyCurrent) {
        await conn.rollback();
        return res.status(409).json({
          error: 'Public exposure or the location policy is not currently authorized.',
          code: policyCurrent ? 'PUBLIC_OWNER_NOT_AUTHORIZED' : 'PUBLIC_LOCATION_POLICY_STALE',
        });
      }
    }
    if (marker.public_state !== current.state) {
      await conn.rollback();
      return res.status(409).json({
        error: 'Marker and publication moderation state require reconciliation.',
        code: 'PUBLIC_STATE_CONFLICT',
      });
    }
    const [lastDecisionRows] = await conn.execute(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.action')) AS action,reason
         FROM public_cairn_moderation_audit
        WHERE event_type='publication_decision' AND publication_id=?
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [publicationId],
    );
    const transition = resolvePublicationTransition(
      current.state,
      action,
      lastDecisionRows[0]?.action ?? null,
    );
    if (!transition.allowed) {
      await conn.rollback();
      return res.status(409).json({ error: 'Action is not valid for the current publication state.', code: 'PUBLIC_STATE_CONFLICT' });
    }
    const nextState = transition.nextState;
    if (transition.idempotent) {
      if (String(lastDecisionRows[0]?.reason || '') !== reason) {
        await conn.rollback();
        return res.status(409).json({
          error: 'Decision retry does not match the committed reason.',
          code: 'PUBLIC_DECISION_IDENTITY_MISMATCH',
        });
      }
      await conn.commit();
      return res.json({
        publication_id: String(publicationId), marker_id: String(current.marker_id),
        publication_epoch: Number(current.publication_epoch),
        content_revision: Number(current.content_revision), state: nextState,
        idempotent_replay: true,
      });
    }
    const [publicationUpdate] = await conn.execute(
      `UPDATE public_cairn_publications
          SET state=?,decided_at=UTC_TIMESTAMP(3),decided_by=?,decision_reason=?,
              published_at=CASE
                WHEN ?='restore' THEN UTC_TIMESTAMP(3)
                WHEN ?='published' THEN COALESCE(published_at,UTC_TIMESTAMP(3))
                ELSE published_at END
        WHERE id=? AND state=?`,
      [nextState, req.user.userId, reason, action, nextState, publicationId, current.state],
    );
    if (publicationUpdate.affectedRows !== 1) throw new Error('public_transition_lost_lock');
    const [markerUpdate] = await conn.execute(
      `UPDATE markers SET public_state=?,public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=? AND publication_epoch=? AND content_revision=?`,
      [nextState, current.marker_id, current.owner_id,
        current.publication_epoch, current.content_revision],
    );
    if (markerUpdate.affectedRows !== 1) throw new Error('public_marker_transition_lost_lock');
    await appendPublicModerationAudit(conn, {
      eventType: 'publication_decision',
      actorUserId: req.user.userId,
      ownerUserId: current.owner_id,
      markerId: current.marker_id,
      publicationId,
      publicationEpoch: current.publication_epoch,
      contentRevision: current.content_revision,
      fromState: current.state,
      toState: nextState,
      reason,
      metadata: { action },
    });
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
  const limit = boundedQueryLimit(req.query.limit, 25, 50);
  if (limit === null) return res.status(400).json({ error: 'limit must be a positive integer.' });
  try {
    const [rows] = await pool.execute(
      `SELECT report.id,report.viewer_id,report.author_id,report.marker_id,
              report.publication_id,report.publication_epoch,
              publication.content_revision,publication.snapshot_type AS type,
              publication.snapshot_text AS text,publication.snapshot_lat AS lat,
              publication.snapshot_lng AS lng,
              publication.snapshot_approximate AS approximate,
              publication.snapshot_location_policy_version,publication.snapshot_sha256,
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
  if (!note) return res.status(400).json({ error: 'A disposition note is required.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (!await lockOperatorAuthority(conn, req.user.userId)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Operator access required.', code: 'OPERATOR_REQUIRED' });
    }
    const [identityRows] = await conn.execute(
      'SELECT marker_id,publication_id FROM public_cairn_reports WHERE id=? LIMIT 1',
      [reportId],
    );
    if (!identityRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: 'Report not found.' });
    }
    await conn.execute(
      'SELECT id FROM markers WHERE id=? LIMIT 1 FOR UPDATE',
      [identityRows[0].marker_id],
    );
    const [publicationRows] = await conn.execute(
      'SELECT id,content_revision FROM public_cairn_publications WHERE id=? LIMIT 1 FOR UPDATE',
      [identityRows[0].publication_id],
    );
    const [reportRows] = await conn.execute(
      `SELECT id,state,viewer_id,author_id,marker_id,publication_id,publication_epoch,
              disposition_note
         FROM public_cairn_reports WHERE id=? LIMIT 1 FOR UPDATE`,
      [reportId],
    );
    const current = reportRows[0];
    if (!current || !publicationRows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: 'Report not found.' });
    }
    current.content_revision = publicationRows[0].content_revision;
    const transition = resolveReportTransition(current.state, state);
    if (!transition.allowed) {
      await conn.rollback();
      return res.status(409).json({ error: 'Disposition is not valid for the current report state.', code: 'PUBLIC_REPORT_STATE_CONFLICT' });
    }
    if (transition.idempotent) {
      if (String(current.disposition_note || '') !== note) {
        await conn.rollback();
        return res.status(409).json({
          error: 'Disposition retry does not match the committed note.',
          code: 'PUBLIC_REPORT_IDENTITY_MISMATCH',
        });
      }
      await conn.commit();
      return res.json({ report_id: String(reportId), state, idempotent_replay: true });
    }
    const [result] = await conn.execute(
      `UPDATE public_cairn_reports SET state=?,disposed_at=UTC_TIMESTAMP(3),
              disposed_by=?,disposition_note=? WHERE id=? AND state=?`,
      [state, req.user.userId, note, reportId, current.state],
    );
    if (result.affectedRows !== 1) throw new Error('public_report_transition_lost_lock');
    await appendPublicModerationAudit(conn, {
      eventType: 'report_disposition',
      actorUserId: req.user.userId,
      ownerUserId: current.author_id,
      markerId: current.marker_id,
      publicationId: current.publication_id,
      reportId,
      publicationEpoch: current.publication_epoch,
      contentRevision: current.content_revision,
      fromState: current.state,
      toState: state,
      reason: note,
    });
    await conn.commit();
    return res.json({ report_id: String(reportId), state });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    console.error('[public/operator/report-disposition]', error.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

router.get('/operator/audit', requireOperator, async (req, res) => {
  const afterId = positiveId(req.query.after_id) ?? 0;
  const limit = boundedQueryLimit(req.query.limit, 50, 100);
  if (limit === null) return res.status(400).json({ error: 'limit must be a positive integer.' });
  try {
    const [rows] = await pool.execute(
      `SELECT id,event_type,actor_user_id,owner_user_id,marker_id,publication_id,report_id,
              publication_epoch,content_revision,from_state,to_state,reason,metadata_json,created_at
         FROM public_cairn_moderation_audit
        WHERE id>? ORDER BY id ASC LIMIT ${limit + 1}`,
      [afterId],
    );
    const hasMore = rows.length > limit;
    const events = (hasMore ? rows.slice(0, limit) : rows).map(event => ({
      ...event,
      id: String(event.id),
      actor_user_id: event.actor_user_id == null ? null : String(event.actor_user_id),
      owner_user_id: event.owner_user_id == null ? null : String(event.owner_user_id),
      marker_id: event.marker_id == null ? null : String(event.marker_id),
      publication_id: event.publication_id == null ? null : String(event.publication_id),
      report_id: event.report_id == null ? null : String(event.report_id),
      publication_epoch: event.publication_epoch == null ? null : String(event.publication_epoch),
      content_revision: event.content_revision == null ? null : String(event.content_revision),
    }));
    return res.json({
      events,
      has_more: hasMore,
      next_after_id: hasMore ? String(events[events.length - 1].id) : null,
    });
  } catch (error) {
    console.error('[public/operator/audit]', error.message);
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
