'use strict';

const crypto = require('crypto');
const { eligibleSourceProvenanceSql } = require('./activitySourceProvenance');

const CELL_SIZE_M = 200;
const FRIEND_PROJECTION_POLICY_VERSION = 3;
const EARTH_RADIUS_M = 6378137;
const FRIEND_VISIBILITY_DELAY_SECONDS = 30 * 60;

function toMercator(lat, lng) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  return {
    x: EARTH_RADIUS_M * Number(lng) * Math.PI / 180,
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + clampedLat * Math.PI / 360)),
  };
}

function fromMercator(x, y) {
  return {
    lng: x / EARTH_RADIUS_M * 180 / Math.PI,
    lat: (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) * 180 / Math.PI,
  };
}

function cellFor(lat, lng) {
  const p = toMercator(lat, lng);
  const x = Math.floor(p.x / CELL_SIZE_M);
  const y = Math.floor(p.y / CELL_SIZE_M);
  return { id: `${x}:${y}`, x, y };
}

function cellPolygon(cell) {
  const minX = cell.x * CELL_SIZE_M;
  const minY = cell.y * CELL_SIZE_M;
  const maxX = minX + CELL_SIZE_M;
  const maxY = minY + CELL_SIZE_M;
  const sw = fromMercator(minX, minY);
  const se = fromMercator(maxX, minY);
  const ne = fromMercator(maxX, maxY);
  const nw = fromMercator(minX, maxY);
  return [[sw.lng, sw.lat], [se.lng, se.lat], [ne.lng, ne.lat], [nw.lng, nw.lat], [sw.lng, sw.lat]];
}

async function loadFriendProjectionEvidence(db, ownerId, grant) {
  const fullHistory = grant.coverage_scope === 'full_history_delayed_v1';
  const [rows] = await db.execute(
    `SELECT DISTINCT evidence.id, evidence.lat, evidence.lng, evidence.ts,
            evidence.evidence_source,
            evidence.source_activity_client_id,evidence.source_segment_id,evidence.evidence_kind,
            s.id AS session_id
       FROM (
         SELECT mp.id, mp.lat, mp.lng, mp.ts, mp.received_at,
                CAST(mp.evidence_source AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_unicode_ci AS evidence_source,
                mp.source_activity_client_id,mp.source_segment_id,
                'coverage' AS evidence_kind
           FROM memory_points mp
          WHERE mp.user_id = ?
            AND mp.evidence_source IN ('activity_real','passive_real')
            AND mp.continuity_state = 'accepted'
            AND mp.horizontal_accuracy_m IS NOT NULL
            AND mp.horizontal_accuracy_m <= 50
         UNION ALL
         SELECT witness.id, witness.first_lat AS lat, witness.first_lng AS lng,
                witness.first_observed_at_ms AS ts,witness.received_at,
                CAST(witness.evidence_source AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_unicode_ci AS evidence_source,
                witness.source_activity_client_id,witness.source_segment_id,
                'presence_first' AS evidence_kind
           FROM memory_presence_witnesses witness
          WHERE witness.user_id = ?
            AND witness.evidence_source IN ('activity_real','passive_real')
            AND witness.continuity_state = 'accepted'
            AND witness.horizontal_accuracy_m <= 50
         UNION ALL
         SELECT witness.id, witness.lat, witness.lng, witness.observed_at_ms AS ts,
                witness.updated_at AS received_at,
                CAST(witness.evidence_source AS CHAR CHARACTER SET utf8mb4)
                  COLLATE utf8mb4_unicode_ci AS evidence_source,
                witness.source_activity_client_id,witness.source_segment_id,'presence_latest' AS evidence_kind
           FROM memory_presence_witnesses witness
          WHERE witness.user_id = ?
            AND witness.evidence_source IN ('activity_real','passive_real')
            AND witness.continuity_state = 'accepted'
            AND witness.horizontal_accuracy_m <= 50
            AND witness.observed_at_ms > witness.first_observed_at_ms
       ) evidence
       LEFT JOIN sessions s
         ON s.user_id = ?
        AND s.client_activity_id = evidence.source_activity_client_id
        AND s.finalized_at IS NOT NULL
        AND s.abandoned_at IS NULL
        AND ${eligibleSourceProvenanceSql('s.source_provenance')}
       JOIN memory_share_grants active_grant
         ON active_grant.id = ? AND active_grant.owner_id = ?
        AND active_grant.status = 'active' AND active_grant.revoked_at IS NULL
       JOIN friendship_episodes active_episode
         ON active_episode.id = active_grant.friendship_episode_id
        AND active_episode.ended_at IS NULL
       LEFT JOIN JSON_TABLE(COALESCE(s.route_points_canonical, JSON_ARRAY()), '$[*]' COLUMNS(
         lat DOUBLE PATH '$.lat', lng DOUBLE PATH '$.lng',
         observed_ms BIGINT PATH '$.t', segment_id VARCHAR(80) PATH '$.segment_id'
       )) canonical
         ON ABS(CAST(canonical.observed_ms AS SIGNED)-CAST(evidence.ts AS SIGNED)) <= 1000
        AND ST_Distance_Sphere(POINT(canonical.lng,canonical.lat),POINT(evidence.lng,evidence.lat)) <= 5
        AND COALESCE(canonical.segment_id,'legacy-0')=COALESCE(evidence.source_segment_id,'legacy-0')
      WHERE (? = 1 OR evidence.evidence_source = 'activity_real')
        AND (? = 1 OR FROM_UNIXTIME(evidence.ts / 1000) >=
             GREATEST(active_grant.effective_at, active_episode.started_at))
        AND (evidence.evidence_source = 'passive_real' OR canonical.observed_ms IS NOT NULL)
        AND evidence.ts <= (UNIX_TIMESTAMP(UTC_TIMESTAMP(3)) * 1000) + 300000
        AND DATE_ADD(
              GREATEST(FROM_UNIXTIME(evidence.ts / 1000), evidence.received_at),
              INTERVAL ${FRIEND_VISIBILITY_DELAY_SECONDS} SECOND
            ) <= UTC_TIMESTAMP(3)
      ORDER BY evidence.source_activity_client_id ASC, evidence.ts ASC,
               evidence.evidence_kind ASC, evidence.id ASC`,
    [ownerId, ownerId, ownerId, ownerId, grant.id, ownerId,
      fullHistory ? 1 : 0, fullHistory ? 1 : 0],
  );
  return rows;
}

async function deriveFriendProjection(db, ownerId, viewerId, grant) {
  const rows = await loadFriendProjectionEvidence(db, ownerId, grant);

  const cells = new Map();
  const cellLatestObservedAt = new Map();
  for (const row of rows) {
    const cell = cellFor(row.lat, row.lng);
    if (!cells.has(cell.id)) cells.set(cell.id, cell);
    cellLatestObservedAt.set(
      cell.id,
      Math.max(Number(row.ts) || 0, cellLatestObservedAt.get(cell.id) || 0),
    );
  }
  const sortedCells = [...cells.values()].sort((a, b) => a.id.localeCompare(b.id));
  let regions = [];
  if (sortedCells.length > 0) {
    const centers = sortedCells.map(cell => ({
      ...fromMercator((cell.x + 0.5) * CELL_SIZE_M, (cell.y + 0.5) * CELL_SIZE_M),
      observed_at_ms: cellLatestObservedAt.get(cell.id) || 0,
    }));
    const [regionRows] = await db.execute(
      `WITH coordinate AS (
         SELECT source.lng,source.lat,source.observed_at_ms
           FROM JSON_TABLE(
                  CAST(? AS CHAR CHARACTER SET utf8mb4),
                  '$[*]' COLUMNS(
                    lng DOUBLE PATH '$.lng',lat DOUBLE PATH '$.lat',
                    observed_at_ms BIGINT PATH '$.observed_at_ms'
                  )
                ) source
       ), matched AS (
         SELECT region.id,region.parent_id,region.level,region.name_en,
                region.bbox_min_lng,region.bbox_min_lat,
                region.bbox_max_lng,region.bbox_max_lat,
                coordinate.lng AS anchor_lng,coordinate.lat AS anchor_lat,
                ROW_NUMBER() OVER (
                  PARTITION BY region.id ORDER BY coordinate.observed_at_ms DESC
                ) AS recency_rank
           FROM coordinate
           JOIN regions region
             ON region.level IN (2,3)
            AND ST_Contains(
                  region.geom,
                  ST_GeomFromText(
                    CONCAT('POINT(',coordinate.lng,' ',coordinate.lat,')'),
                    4326,
                    'axis-order=long-lat'
                  )
                )
       )
       SELECT id,parent_id,level,name_en,bbox_min_lng,bbox_min_lat,
              bbox_max_lng,bbox_max_lat,anchor_lng,anchor_lat
         FROM matched WHERE recency_rank=1 ORDER BY level,id`,
      [JSON.stringify(centers)],
    );
    regions = regionRows.map(region => ({
      id: String(region.id),
      parent_id: region.parent_id == null ? null : String(region.parent_id),
      level: Number(region.level),
      name_en: String(region.name_en),
      bbox: [
        Number(region.bbox_min_lng), Number(region.bbox_min_lat),
        Number(region.bbox_max_lng), Number(region.bbox_max_lat),
      ],
      anchor: [Number(region.anchor_lng), Number(region.anchor_lat)],
    }));
  }
  const versionMaterial = JSON.stringify({
    projection_policy: FRIEND_PROJECTION_POLICY_VERSION,
    grant: grant.grant_epoch,
    authorization: Number(grant.authorization_version),
    policy: Number(grant.policy_epoch),
    cells: sortedCells.map(cell => cell.id),
  });
  const projectionVersion = crypto.createHash('sha256').update(versionMaterial).digest('hex');
  return {
    source_friend_id: String(ownerId),
    authorization_version: Number(grant.authorization_version),
    projection_version: projectionVersion,
    // Kept for older clients. This is the EPSG:3857 grid interval, not a
    // claim that every returned cell edge spans 200 ground metres.
    cell_size_m: CELL_SIZE_M,
    cell_size_basis: 'EPSG:3857_projected_grid',
    grid_cell_size_mercator_m: CELL_SIZE_M,
    projection_policy_version: FRIEND_PROJECTION_POLICY_VERSION,
    contribution_delay_seconds: FRIEND_VISIBILITY_DELAY_SECONDS,
    coverage_scope: 'full_history_delayed_v1',
    // City/country presence is derived only from the same delayed coarse cells
    // returned below. It cannot reveal a more recent or more precise area than
    // the authorized map projection.
    regions,
    cells: sortedCells.map(cell => ({
      id: cell.id,
      polygon: cellPolygon(cell),
    })),
  };
}

module.exports = {
  CELL_SIZE_M,
  FRIEND_PROJECTION_POLICY_VERSION,
  FRIEND_VISIBILITY_DELAY_SECONDS,
  cellFor,
  cellPolygon,
  loadFriendProjectionEvidence,
  deriveFriendProjection,
};
