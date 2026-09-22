'use strict';

const {
  ENCOUNTER_RADIUS_M,
  MAX_HORIZONTAL_ACCURACY_M,
  MIN_OBSERVATION_SPAN_MS,
  MAX_OBSERVATION_SPAN_MS,
} = require('./encounterPolicy');
const { eligibleSourceProvenanceSql } = require('./activitySourceProvenance');

const FRIEND_DISCOVERY_PAGE_SIZE = 500;
const FRIEND_DISCOVERY_EVIDENCE_LIMIT = 100;
const LATITUDE_DEGREES_PER_ENCOUNTER = ENCOUNTER_RADIUS_M / 110000;

/**
 * Authority, coarse/exact space, and source-session eligibility deliberately
 * precede canonical JSON expansion. DISTINCT makes the relevant-session and
 * canonical derived results non-mergeable in MySQL 8, so JSON_TABLE expands
 * each spatially relevant eligible session once, not viewer-lifetime E times.
 */
function buildFriendDiscoveryCandidatePage(viewerId) {
  const latitudeDelta = LATITUDE_DEGREES_PER_ENCOUNTER.toFixed(12);
  const longitudeDelta = `(${latitudeDelta} / GREATEST(ABS(COS(RADIANS(evidence.lat))), 0.000001))`;
  const sql = `WITH authorized_markers AS (
      SELECT marker.id AS marker_id, marker.updated_at AS marker_updated_at,
             marker.created_at AS marker_created_at,
             marker.lat AS marker_lat, marker.lng AS marker_lng,
             marker.user_id AS author_id, marker.audience_epoch,
             audience.starts_at AS audience_started_at,
             episode.id AS friendship_episode_id,
             episode.started_at AS friendship_started_at
        FROM friends friend
        JOIN markers marker FORCE INDEX (idx_markers_location)
          ON marker.user_id = friend.friend_id
         AND marker.permission = 'group'
         AND marker.status <> 'hidden'
        JOIN friendship_episodes episode
          ON episode.user_low_id = LEAST(friend.user_id, friend.friend_id)
         AND episode.user_high_id = GREATEST(friend.user_id, friend.friend_id)
         AND episode.ended_at IS NULL
        JOIN marker_audience_epochs audience
          ON audience.marker_id = marker.id
         AND audience.audience_epoch = marker.audience_epoch
         AND audience.visibility = 'group'
         AND audience.ends_at IS NULL
        JOIN users owner
          ON owner.id = marker.user_id AND owner.deleted_at IS NULL
       WHERE friend.user_id = ?
         AND marker.user_id <> ?
         AND NOT EXISTS (
           SELECT 1 FROM blocked_users blocked
            WHERE (blocked.blocker_id = ? AND blocked.blocked_id = marker.user_id)
               OR (blocked.blocker_id = marker.user_id AND blocked.blocked_id = ?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM friend_cairn_encounters encountered
            WHERE encountered.viewer_id = ?
              AND encountered.marker_id = marker.id
              AND encountered.friendship_episode_id = episode.id
              AND encountered.audience_epoch = marker.audience_epoch
         )
    ), raw_evidence AS (
      SELECT witness.id AS evidence_id, witness.first_lat AS lat, witness.first_lng AS lng,
             witness.first_observed_at_ms AS ts,
             CAST(witness.evidence_source AS CHAR CHARACTER SET utf8mb4)
               COLLATE utf8mb4_unicode_ci AS evidence_source,
             witness.source_activity_client_id, witness.source_segment_id,
             'presence_witness' AS evidence_kind
        FROM memory_presence_witnesses witness
       WHERE witness.user_id = ?
         AND witness.continuity_state = 'accepted'
         AND witness.horizontal_accuracy_m <= ?
      UNION ALL
      SELECT witness.id AS evidence_id, witness.lat, witness.lng,
             witness.observed_at_ms AS ts,
             CAST(witness.evidence_source AS CHAR CHARACTER SET utf8mb4)
               COLLATE utf8mb4_unicode_ci AS evidence_source,
             witness.source_activity_client_id, witness.source_segment_id,
             'presence_witness' AS evidence_kind
        FROM memory_presence_witnesses witness
       WHERE witness.user_id = ?
         AND witness.continuity_state = 'accepted'
         AND witness.horizontal_accuracy_m <= ?
         AND witness.observed_at_ms > witness.first_observed_at_ms
      UNION ALL
      SELECT point.id AS evidence_id, point.lat, point.lng, point.ts,
             CAST(point.evidence_source AS CHAR CHARACTER SET utf8mb4)
               COLLATE utf8mb4_unicode_ci AS evidence_source,
             point.source_activity_client_id, point.source_segment_id,
             'legacy_coverage' AS evidence_kind
        FROM memory_points point FORCE INDEX (idx_memory_encounter_context)
       WHERE point.user_id = ?
         AND point.evidence_source IN ('activity_real','passive_real')
         AND point.continuity_state = 'accepted'
         AND point.horizontal_accuracy_m IS NOT NULL
         AND point.horizontal_accuracy_m <= ?
    ), spatial_authorized_evidence AS (
      SELECT DISTINCT marker.*, evidence.evidence_id, evidence.lat, evidence.lng,
             evidence.ts AS evidence_ts, evidence.evidence_source,
             evidence.evidence_kind, evidence.source_activity_client_id,
             evidence.source_segment_id
        FROM raw_evidence evidence
        JOIN authorized_markers marker
          ON marker.marker_lat BETWEEN evidence.lat - ${latitudeDelta}
                                   AND evidence.lat + ${latitudeDelta}
         AND LEAST(ABS(marker.marker_lng - evidence.lng),
                   360 - ABS(marker.marker_lng - evidence.lng)) <= ${longitudeDelta}
         AND ST_Distance_Sphere(
               POINT(evidence.lng,evidence.lat),
               POINT(marker.marker_lng,marker.marker_lat)
             ) <= ?
       WHERE evidence.ts <= (UNIX_TIMESTAMP(UTC_TIMESTAMP(3)) * 1000) + 300000
         AND FROM_UNIXTIME(evidence.ts / 1000) >= GREATEST(
           marker.friendship_started_at,
           marker.marker_created_at,
           marker.audience_started_at
         )
    ), source_session_qualified_evidence AS (
      SELECT evidence.*, session.id AS source_session_id
        FROM spatial_authorized_evidence evidence
        LEFT JOIN sessions session
          ON evidence.evidence_source = 'activity_real'
         AND session.user_id = ?
         AND session.client_activity_id = evidence.source_activity_client_id
         AND session.finalized_at IS NOT NULL
         AND session.abandoned_at IS NULL
         AND ${eligibleSourceProvenanceSql('session.source_provenance')}
       WHERE evidence.evidence_source = 'passive_real' OR session.id IS NOT NULL
    ), relevant_activity_sessions AS (
      SELECT DISTINCT source_session_id
        FROM source_session_qualified_evidence
       WHERE evidence_source = 'activity_real'
         AND source_session_id IS NOT NULL
    ), canonical_points AS (
      SELECT DISTINCT session.id AS source_session_id,
             canonical.lat, canonical.lng, canonical.observed_ms,
             canonical.segment_id
        FROM relevant_activity_sessions relevant
        JOIN sessions session ON session.id = relevant.source_session_id
        JOIN JSON_TABLE(
          COALESCE(session.route_points_canonical, JSON_ARRAY()), '$[*]' COLUMNS(
            lat DOUBLE PATH '$.lat', lng DOUBLE PATH '$.lng',
            observed_ms BIGINT PATH '$.t', segment_id VARCHAR(80) PATH '$.segment_id'
          )
        ) canonical ON TRUE
    ), source_eligible_evidence AS (
      SELECT evidence.*
        FROM source_session_qualified_evidence evidence
       WHERE evidence.evidence_source = 'passive_real'
      UNION ALL
      SELECT DISTINCT evidence.*
        FROM source_session_qualified_evidence evidence
        JOIN canonical_points canonical
          ON canonical.source_session_id = evidence.source_session_id
         AND COALESCE(canonical.segment_id,'legacy-0') =
             COALESCE(evidence.source_segment_id,'legacy-0')
         AND ABS(CAST(canonical.observed_ms AS SIGNED)-
                 CAST(evidence.evidence_ts AS SIGNED)) <= 1000
         AND ST_Distance_Sphere(
               POINT(canonical.lng,canonical.lat),POINT(evidence.lng,evidence.lat)
             ) <= 5
       WHERE evidence.evidence_source = 'activity_real'
    ), bounded_spatial_evidence AS (
      SELECT source_eligible_evidence.*,
             ROW_NUMBER() OVER (
               PARTITION BY marker_id
               ORDER BY evidence_ts DESC, evidence_id DESC, evidence_kind DESC
             ) AS evidence_recency_rank
        FROM source_eligible_evidence
    ), recent_spatial_evidence AS (
      SELECT *
        FROM bounded_spatial_evidence
       WHERE evidence_recency_rank <= ${FRIEND_DISCOVERY_EVIDENCE_LIMIT}
    ), windowed_evidence AS (
      SELECT recent_spatial_evidence.*,
             COUNT(*) OVER (
               PARTITION BY marker_id, evidence_source,
                            CASE WHEN evidence_source = 'activity_real'
                              THEN COALESCE(source_activity_client_id,'') ELSE '' END,
                            COALESCE(source_segment_id,'')
               ORDER BY evidence_ts
               RANGE BETWEEN ${MAX_OBSERVATION_SPAN_MS} PRECEDING
                         AND ${MIN_OBSERVATION_SPAN_MS} PRECEDING
             ) AS qualifying_prior_count
        FROM recent_spatial_evidence
    ), qualified_evidence AS (
      SELECT *
        FROM windowed_evidence
       WHERE qualifying_prior_count > 0
    ), ranked_candidates AS (
      SELECT qualified_evidence.*,
             ROW_NUMBER() OVER (
               PARTITION BY marker_id
               ORDER BY evidence_ts DESC, evidence_id DESC, evidence_kind DESC
             ) AS evidence_rank
        FROM qualified_evidence
    )
    SELECT marker_id AS id
      FROM ranked_candidates
     WHERE evidence_rank = 1
     ORDER BY marker_updated_at DESC, marker_id DESC
     LIMIT ${FRIEND_DISCOVERY_PAGE_SIZE}`;
  return {
    sql,
    params: [
      viewerId, viewerId, viewerId, viewerId, viewerId,
      viewerId, MAX_HORIZONTAL_ACCURACY_M,
      viewerId, MAX_HORIZONTAL_ACCURACY_M,
      viewerId, MAX_HORIZONTAL_ACCURACY_M,
      ENCOUNTER_RADIUS_M,
      viewerId,
    ],
  };
}

module.exports = {
  FRIEND_DISCOVERY_EVIDENCE_LIMIT,
  FRIEND_DISCOVERY_PAGE_SIZE,
  buildFriendDiscoveryCandidatePage,
};
