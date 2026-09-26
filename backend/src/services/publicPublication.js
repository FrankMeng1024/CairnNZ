'use strict';

const crypto = require('crypto');
const { selectQualifyingEncounterEvidence } = require('./encounterPolicy');
const { eligibleSourceProvenanceSql } = require('./activitySourceProvenance');
const { appendPublicModerationAudit } = require('./publicModerationAudit');
const {
  evaluatePublicLocation,
  locationPolicyVersion,
  publicLocationPolicyConfigured,
} = require('./publicLocationPolicy');

const PUBLIC_ENCOUNTER_RADIUS_M = 50;

function publicPilotEnabled() {
  return String(process.env.PUBLIC_CAIRN_PILOT_ENABLED || '').trim() === '1';
}

function publicPilotAuthorizedOwnerIds() {
  if (!publicPilotEnabled() || !publicLocationPolicyConfigured()) return [];
  // The disposable MySQL harness creates actor ids after the process starts;
  // this exception is valid only in its explicit test realm. Production can
  // never turn a global flag into broad access.
  if (process.env.NODE_ENV === 'test'
    && process.env.CAIRN_REALM === 'isolated_review'
    && process.env.ALLOW_ISOLATED_QA_SOURCE_CONTRACT === '1') return null;
  const rawAllowlist = String(process.env.PUBLIC_CAIRN_PILOT_USER_IDS || '').trim();
  if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(rawAllowlist)) return [];
  const values = rawAllowlist.split(',');
  const allowlist = new Set(values);
  if (allowlist.size !== values.length) return [];
  return values;
}

function publicPilotAuthorized(userId) {
  if (userId == null) return false;
  const authorizedIds = publicPilotAuthorizedOwnerIds();
  return authorizedIds === null || authorizedIds.includes(String(userId));
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

async function withdrawPublication(
  conn,
  markerId,
  ownerId,
  reason,
  { actorUserId = ownerId } = {},
) {
  const [active] = await conn.execute(
    `SELECT id,publication_epoch,content_revision,state
       FROM public_cairn_publications
      WHERE marker_id=? AND owner_id=? AND state IN ('pending','published','suspended')
      FOR UPDATE`,
    [markerId, ownerId],
  );
  await conn.execute(
    `UPDATE public_cairn_publications
        SET state='withdrawn', withdrawn_at=UTC_TIMESTAMP(3),
            decision_reason=COALESCE(decision_reason, ?)
      WHERE marker_id=? AND owner_id=? AND state IN ('pending','published','suspended')`,
    [String(reason || 'withdrawn').slice(0, 240), markerId, ownerId],
  );
  for (const publication of active) {
    await appendPublicModerationAudit(conn, {
      eventType: 'publication_withdrawn',
      actorUserId,
      ownerUserId: ownerId,
      markerId,
      publicationId: publication.id,
      publicationEpoch: publication.publication_epoch,
      contentRevision: publication.content_revision,
      fromState: publication.state,
      toState: 'withdrawn',
      reason,
    });
  }
  return active.length;
}

async function synchronizePublicSubmission(
  conn,
  markerId,
  ownerId,
  { actorUserId = ownerId } = {},
) {
  const [rows] = await conn.execute(
    `SELECT id,user_id,type,text,lat,lng,approximate,permission,content_revision,public_intent,
            public_state,publication_epoch,origin_activity_client_id
       FROM markers WHERE id=? AND user_id=? LIMIT 1 FOR UPDATE`,
    [markerId, ownerId],
  );
  const marker = rows[0];
  if (!marker) return { state: 'not_public', code: 'CAIRN_NOT_FOUND' };

  if (marker.permission !== 'public' || !marker.public_intent) {
    await withdrawPublication(conn, marker.id, ownerId, 'author_changed_audience', { actorUserId });
    await conn.execute(
      `UPDATE markers SET public_state='withdrawn', public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=?`,
      [marker.id, ownerId],
    );
    return { state: 'withdrawn', code: 'PUBLIC_WITHDRAWN' };
  }

  if (!publicPilotAuthorized(ownerId)) {
    // Exposure authorization is an operational gate, not an author edit or a
    // moderation decision. Freeze this exact revision while reads are gated.
    // A later content revision is superseded/re-reviewed after authorization
    // returns; disabling the pilot cannot rewrite operator history.
    return {
      state: marker.public_state,
      code: 'PUBLIC_PILOT_DISABLED',
      frozen: true,
      publicationEpoch: Number(marker.publication_epoch),
      contentRevision: Number(marker.content_revision),
    };
  }
  if (!usefulPublicText(marker.text)) {
    await withdrawPublication(conn, marker.id, ownerId, 'text_required', { actorUserId });
    await conn.execute(
      `UPDATE markers SET public_state='not_public', public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=?`,
      [marker.id, ownerId],
    );
    return { state: 'not_public', code: 'PUBLIC_TEXT_REQUIRED' };
  }
  if (!await markerHasEligibleOrigin(conn, marker)) {
    await withdrawPublication(conn, marker.id, ownerId, 'eligible_origin_required', { actorUserId });
    await conn.execute(
      `UPDATE markers SET public_state='not_public', public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=?`,
      [marker.id, ownerId],
    );
    return { state: 'not_public', code: 'PUBLIC_ELIGIBLE_ACTIVITY_REQUIRED' };
  }

  const publicLocation = evaluatePublicLocation(marker.lat, marker.lng);
  if (!publicLocation.allowed) {
    await withdrawPublication(conn, marker.id, ownerId, 'sensitive_place_excluded', { actorUserId });
    await conn.execute(
      `UPDATE markers SET public_state='not_public', public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE id=? AND user_id=?`,
      [marker.id, ownerId],
    );
    return { state: 'not_public', code: publicLocation.code };
  }

  const snapshot = {
    type: String(marker.type || 'cairn'),
    text: String(marker.text || ''),
    lat: publicLocation.lat,
    lng: publicLocation.lng,
    approximate: true,
    locationPolicyVersion: publicLocation.policyVersion,
  };
  const snapshotSha256 = crypto.createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');

  const [current] = await conn.execute(
    `SELECT id,state,publication_epoch,content_revision,snapshot_location_policy_version,
            snapshot_sha256
       FROM public_cairn_publications
      WHERE marker_id=? ORDER BY publication_epoch DESC LIMIT 1 FOR UPDATE`,
    [marker.id],
  );
  if (current[0]
    && Number(current[0].content_revision) === Number(marker.content_revision)) {
    const currentPolicyVersion = locationPolicyVersion();
    const policyMatches = current[0].snapshot_location_policy_version === currentPolicyVersion;
    const stableStateCodes = {
      pending: 'PUBLIC_PENDING',
      published: 'PUBLIC_PUBLISHED',
      rejected: 'PUBLIC_REJECTED',
      suspended: 'PUBLIC_SUSPENDED',
      withdrawn: 'PUBLIC_WITHDRAWN',
    };
    // Moderation decisions are sticky for an identical author revision. A
    // policy change must never turn rejected/suspended content back into a new
    // pending submission. Withdrawn is likewise an explicit terminal episode.
    if (!policyMatches && current[0].state === 'suspended') {
      // A reported or reviewed snapshot is immutable. Close the old policy
      // episode and create a fresh suspended episode whose new ID must be
      // explicitly restored. Reports/audit rows therefore retain the exact
      // bytes and hash an operator previously saw.
      const nextEpoch = Number(marker.publication_epoch) + 1;
      const [closed] = await conn.execute(
        `UPDATE public_cairn_publications
            SET state='withdrawn',withdrawn_at=UTC_TIMESTAMP(3),
                decision_reason=COALESCE(decision_reason,'location_policy_superseded')
          WHERE id=? AND marker_id=? AND owner_id=? AND state='suspended'
            AND publication_epoch=? AND content_revision=?`,
        [current[0].id, marker.id, ownerId,
          current[0].publication_epoch, current[0].content_revision],
      );
      if (closed.affectedRows !== 1) throw new Error('public_suspended_policy_resnapshot_lost_lock');
      await appendPublicModerationAudit(conn, {
        eventType: 'publication_withdrawn',
        actorUserId,
        ownerUserId: ownerId,
        markerId: marker.id,
        publicationId: current[0].id,
        publicationEpoch: current[0].publication_epoch,
        contentRevision: current[0].content_revision,
        fromState: 'suspended',
        toState: 'withdrawn',
        reason: 'location_policy_superseded',
      });
      const [inserted] = await conn.execute(
        `INSERT INTO public_cairn_publications
           (marker_id,owner_id,publication_epoch,content_revision,
            snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_approximate,
            snapshot_location_policy_version,snapshot_sha256,state,decision_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'suspended','location_policy_refresh_requires_restore')`,
        [marker.id, ownerId, nextEpoch, marker.content_revision,
          snapshot.type, snapshot.text, snapshot.lat, snapshot.lng,
          snapshot.approximate ? 1 : 0, snapshot.locationPolicyVersion, snapshotSha256],
      );
      const [markerUpdated] = await conn.execute(
        `UPDATE markers
            SET publication_epoch=?,public_state='suspended',public_state_changed_at=UTC_TIMESTAMP(3)
          WHERE id=? AND user_id=? AND publication_epoch=? AND content_revision=?`,
        [nextEpoch, marker.id, ownerId, current[0].publication_epoch, marker.content_revision],
      );
      if (markerUpdated.affectedRows !== 1) throw new Error('public_policy_resnapshot_marker_lost_lock');
      await appendPublicModerationAudit(conn, {
        eventType: 'publication_policy_resnapshotted',
        actorUserId,
        ownerUserId: ownerId,
        markerId: marker.id,
        publicationId: inserted.insertId,
        publicationEpoch: nextEpoch,
        contentRevision: current[0].content_revision,
        fromState: 'suspended',
        toState: 'suspended',
        reason: 'location_policy_changed',
        metadata: {
          previousPublicationId: String(current[0].id),
          previousPolicyVersion: current[0].snapshot_location_policy_version,
          locationPolicyVersion: snapshot.locationPolicyVersion,
          previousSnapshotSha256: current[0].snapshot_sha256,
          snapshotSha256,
        },
      });
      return {
        state: 'suspended',
        publicationId: String(inserted.insertId),
        previousPublicationId: String(current[0].id),
        publicationEpoch: nextEpoch,
        contentRevision: Number(current[0].content_revision),
        code: 'PUBLIC_SUSPENDED',
        policyResnapshotted: true,
      };
    }
    if (policyMatches || ['rejected', 'withdrawn'].includes(current[0].state)) {
      return {
        state: current[0].state,
        publicationId: String(current[0].id),
        publicationEpoch: Number(current[0].publication_epoch),
        contentRevision: Number(current[0].content_revision),
        code: stableStateCodes[current[0].state] || 'PUBLIC_STATE_UNCHANGED',
      };
    }
  }

  await withdrawPublication(conn, marker.id, ownerId, 'superseded_by_new_submission', { actorUserId });
  const nextEpoch = Number(marker.publication_epoch) + 1;
  const [inserted] = await conn.execute(
    `INSERT INTO public_cairn_publications
       (marker_id,owner_id,publication_epoch,content_revision,
        snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_approximate,
        snapshot_location_policy_version,snapshot_sha256,state)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')`,
    [marker.id, ownerId, nextEpoch, marker.content_revision,
      snapshot.type, snapshot.text, snapshot.lat, snapshot.lng,
      snapshot.approximate ? 1 : 0, snapshot.locationPolicyVersion, snapshotSha256],
  );
  await conn.execute(
    `UPDATE markers
        SET publication_epoch=?, public_state='pending', public_state_changed_at=UTC_TIMESTAMP(3)
      WHERE id=? AND user_id=?`,
    [nextEpoch, marker.id, ownerId],
  );
  await appendPublicModerationAudit(conn, {
    eventType: 'publication_submitted',
    actorUserId: ownerId,
    ownerUserId: ownerId,
    markerId: marker.id,
    publicationId: inserted.insertId,
    publicationEpoch: nextEpoch,
    contentRevision: marker.content_revision,
    fromState: null,
    toState: 'pending',
    reason: 'owner_public_intent',
  });
  return {
    state: 'pending', code: 'PUBLIC_PENDING',
    publicationId: String(inserted.insertId),
    publicationEpoch: nextEpoch,
    contentRevision: Number(marker.content_revision),
  };
}

async function reconcilePublicSubmissionsForActivityInTransaction(
  conn,
  ownerId,
  clientActivityId,
  { ownerLocked = false } = {},
) {
  if (!publicPilotAuthorized(ownerId) || !clientActivityId) return { reconciled: 0, skipped: true };
  if (!ownerLocked) {
    await conn.execute(
      'SELECT id FROM users WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [ownerId],
    );
  }
  const [markers] = await conn.execute(
    `SELECT id FROM markers
      WHERE user_id=? AND origin_activity_client_id=?
        AND permission='public' AND public_intent=1
      ORDER BY id FOR UPDATE`,
    [ownerId, clientActivityId],
  );
  for (const marker of markers) {
    await synchronizePublicSubmission(conn, marker.id, ownerId, { actorUserId: null });
  }
  return { reconciled: markers.length, skipped: false };
}

async function reconcilePublicSubmissionsForActivity(dbPool, ownerId, clientActivityId) {
  if (!publicPilotAuthorized(ownerId) || !clientActivityId) return { reconciled: 0, skipped: true };
  const conn = await dbPool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await reconcilePublicSubmissionsForActivityInTransaction(
      conn,
      ownerId,
      clientActivityId,
    );
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* preserve original failure */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function withdrawOwnerPublications(conn, ownerId, reason) {
  const [markers] = await conn.execute(
    `SELECT marker.id AS marker_id
       FROM markers marker
      WHERE marker.user_id=?
        AND EXISTS (
          SELECT 1 FROM public_cairn_publications publication
           WHERE publication.marker_id=marker.id AND publication.owner_id=marker.user_id
             AND publication.state IN ('pending','published','suspended')
        )
      ORDER BY marker.id FOR UPDATE`,
    [ownerId],
  );
  let withdrawn = 0;
  for (const row of markers) {
    withdrawn += await withdrawPublication(conn, row.marker_id, ownerId, reason);
  }
  if (markers.length > 0) {
    await conn.execute(
      `UPDATE markers SET public_state='withdrawn',public_state_changed_at=UTC_TIMESTAMP(3)
        WHERE user_id=? AND public_state IN ('pending','published','suspended')`,
      [ownerId],
    );
  }
  return withdrawn;
}

module.exports = {
  PUBLIC_ENCOUNTER_RADIUS_M,
  publicPilotEnabled,
  publicPilotAuthorized,
  publicPilotAuthorizedOwnerIds,
  usefulPublicText,
  loadEligiblePublicationOriginEvidence,
  markerHasEligibleOrigin,
  withdrawPublication,
  synchronizePublicSubmission,
  reconcilePublicSubmissionsForActivityInTransaction,
  reconcilePublicSubmissionsForActivity,
  withdrawOwnerPublications,
};
