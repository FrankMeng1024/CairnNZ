'use strict';

const crypto = require('crypto');
const { selectQualifyingEncounterEvidence } = require('./encounterPolicy');
const { eligibleSourceProvenanceSql } = require('./activitySourceProvenance');

const PUBLIC_ENCOUNTER_RADIUS_M = 50;

function publicPilotEnabled() {
  return String(process.env.PUBLIC_CAIRN_PILOT_ENABLED || '').trim() === '1';
}

function usefulPublicText(text) {
  return typeof text === 'string' && text.replace(/\u001e/g, '').trim().length > 0;
}

async function loadEligiblePublicationOriginEvidence(conn, marker) {
  if (!marker.origin_activity_client_id) return false;
  const [rows] = await conn.execute(
    `SELECT DISTINCT evidence.id,evidence.lat,evidence.lng,evidence.ts,
            evidence.evidence_source,evidence.source_activity_client_id,
            evidence.source_segment_id,evidence.horizontal_accuracy_m,
            evidence.continuity_state
       FROM (
         SELECT witness.id,witness.first_lat AS lat,witness.first_lng AS lng,
                witness.first_observed_at_ms AS ts,witness.evidence_source,
                witness.source_activity_client_id,witness.source_segment_id,
                witness.horizontal_accuracy_m,witness.continuity_state
           FROM memory_presence_witnesses witness
          WHERE witness.user_id=? AND witness.source_activity_client_id=?
         UNION ALL
         SELECT witness.id,witness.lat,witness.lng,witness.observed_at_ms AS ts,
                witness.evidence_source,witness.source_activity_client_id,
                witness.source_segment_id,witness.horizontal_accuracy_m,
                witness.continuity_state
           FROM memory_presence_witnesses witness
          WHERE witness.user_id=? AND witness.source_activity_client_id=?
            AND witness.observed_at_ms>witness.first_observed_at_ms
       ) evidence
       JOIN sessions session
         ON session.user_id=? AND session.client_activity_id=evidence.source_activity_client_id
        AND session.finalized_at IS NOT NULL AND session.abandoned_at IS NULL
        AND ${eligibleSourceProvenanceSql('session.source_provenance')}
       JOIN JSON_TABLE(session.route_points_canonical, '$[*]' COLUMNS(
         lat DOUBLE PATH '$.lat',lng DOUBLE PATH '$.lng',
         observed_ms BIGINT PATH '$.t',segment_id VARCHAR(80) PATH '$.segment_id'
       )) canonical
         ON ABS(CAST(canonical.observed_ms AS SIGNED)-CAST(evidence.ts AS SIGNED))<=1000
        AND ST_Distance_Sphere(POINT(canonical.lng,canonical.lat),POINT(evidence.lng,evidence.lat))<=5
        AND COALESCE(canonical.segment_id,'legacy-0')=COALESCE(evidence.source_segment_id,'legacy-0')
      WHERE evidence.evidence_source='activity_real'
        AND evidence.continuity_state='accepted' AND evidence.horizontal_accuracy_m<=50
        AND ST_Distance_Sphere(POINT(evidence.lng,evidence.lat),POINT(?,?))<=?
      ORDER BY evidence.ts ASC,evidence.id ASC
      LIMIT 100`,
    [marker.user_id, marker.origin_activity_client_id,
      marker.user_id, marker.origin_activity_client_id, marker.user_id,
      marker.lng, marker.lat, PUBLIC_ENCOUNTER_RADIUS_M],
  );
  return rows;
}

async function markerHasEligibleOrigin(conn, marker) {
  const rows = await loadEligiblePublicationOriginEvidence(conn, marker);
  return Array.isArray(rows) && Boolean(selectQualifyingEncounterEvidence(rows));
}

async function withdrawPublication(conn, markerId, ownerId, reason) {
  await conn.execute(
    `UPDATE public_cairn_publications
        SET state='withdrawn', withdrawn_at=UTC_TIMESTAMP(3),
            decision_reason=COALESCE(decision_reason, ?)
      WHERE marker_id=? AND owner_id=? AND state IN ('pending','published','suspended')`,
    [String(reason || 'withdrawn').slice(0, 240), markerId, ownerId],
  );
}

async function synchronizePublicSubmission(conn, markerId, ownerId) {
  const [rows] = await conn.execute(
    `SELECT id,user_id,type,text,lat,lng,approximate,permission,content_revision,public_intent,
            public_state,publication_epoch,origin_activity_client_id
       FROM markers WHERE id=? AND user_id=? LIMIT 1 FOR UPDATE`,
    [markerId, ownerId],
  );
  const marker = rows[0];
  if (!marker) return { state: 'not_public', code: 'CAIRN_NOT_FOUND' };

  if (marker.permission !== 'public' || !marker.public_intent) {
    await withdrawPublication(conn, marker.id, ownerId, 'author_changed_audience');
    await conn.execute(
      `UPDATE markers SET public_state='withdrawn', public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=?`,
      [marker.id, ownerId],
    );
    return { state: 'withdrawn', code: 'PUBLIC_WITHDRAWN' };
  }

  if (!publicPilotEnabled()) {
    await withdrawPublication(conn, marker.id, ownerId, 'pilot_disabled');
    await conn.execute(
      `UPDATE markers SET public_state='not_public', public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=?`,
      [marker.id, ownerId],
    );
    return { state: 'not_public', code: 'PUBLIC_PILOT_DISABLED' };
  }
  if (!usefulPublicText(marker.text)) {
    await withdrawPublication(conn, marker.id, ownerId, 'text_required');
    await conn.execute(
      `UPDATE markers SET public_state='not_public', public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=?`,
      [marker.id, ownerId],
    );
    return { state: 'not_public', code: 'PUBLIC_TEXT_REQUIRED' };
  }
  if (!await markerHasEligibleOrigin(conn, marker)) {
    await withdrawPublication(conn, marker.id, ownerId, 'eligible_origin_required');
    await conn.execute(
      `UPDATE markers SET public_state='not_public', public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=?`,
      [marker.id, ownerId],
    );
    return { state: 'not_public', code: 'PUBLIC_ELIGIBLE_ACTIVITY_REQUIRED' };
  }

  const [current] = await conn.execute(
    `SELECT id,state,publication_epoch,content_revision
       FROM public_cairn_publications
      WHERE marker_id=? ORDER BY publication_epoch DESC LIMIT 1 FOR UPDATE`,
    [marker.id],
  );
  if (current[0]
    && Number(current[0].content_revision) === Number(marker.content_revision)
    && ['pending', 'published'].includes(current[0].state)) {
    return {
      state: current[0].state,
      publicationId: String(current[0].id),
      publicationEpoch: Number(current[0].publication_epoch),
      contentRevision: Number(current[0].content_revision),
      code: current[0].state === 'pending' ? 'PUBLIC_PENDING' : 'PUBLIC_PUBLISHED',
    };
  }

  await withdrawPublication(conn, marker.id, ownerId, 'superseded_by_new_submission');
  const nextEpoch = Number(marker.publication_epoch) + 1;
  const snapshot = {
    type: String(marker.type || 'cairn'),
    text: String(marker.text || ''),
    lat: Number(marker.lat),
    lng: Number(marker.lng),
    approximate: Boolean(marker.approximate),
  };
  const snapshotSha256 = crypto.createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
  const [inserted] = await conn.execute(
    `INSERT INTO public_cairn_publications
       (marker_id,owner_id,publication_epoch,content_revision,
        snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_approximate,
        snapshot_sha256,state)
     VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`,
    [marker.id, ownerId, nextEpoch, marker.content_revision,
      snapshot.type, snapshot.text, snapshot.lat, snapshot.lng,
      snapshot.approximate ? 1 : 0, snapshotSha256],
  );
  await conn.execute(
    `UPDATE markers
        SET publication_epoch=?, public_state='pending', public_state_changed_at=UTC_TIMESTAMP(3)
      WHERE id=? AND user_id=?`,
    [nextEpoch, marker.id, ownerId],
  );
  return {
    state: 'pending', code: 'PUBLIC_PENDING',
    publicationId: String(inserted.insertId),
    publicationEpoch: nextEpoch,
    contentRevision: Number(marker.content_revision),
  };
}

module.exports = {
  PUBLIC_ENCOUNTER_RADIUS_M,
  publicPilotEnabled,
  usefulPublicText,
  loadEligiblePublicationOriginEvidence,
  markerHasEligibleOrigin,
  withdrawPublication,
  synchronizePublicSubmission,
};
