-- O86: source-owned, rebuildable Memory coverage read model.
-- Source truth remains accepted memory_points. Visible geometry is the same
-- 30m / 20-vertex geodesic footprint for Mine and delayed Friends reads.

CREATE TABLE memory_coverage_evidence (
  memory_point_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL,
  coverage_rule_version SMALLINT UNSIGNED NOT NULL DEFAULT 4,
  tile_x INT NOT NULL,
  tile_y INT NOT NULL,
  observed_at_ms BIGINT UNSIGNED NOT NULL,
  share_ready_at DATETIME(3) NOT NULL,
  evidence_source ENUM('activity_real','passive_real') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_memory_coverage_owner_tile
    (owner_id, coverage_rule_version, tile_x, tile_y, memory_point_id),
  INDEX idx_memory_coverage_owner_ready_tile
    (owner_id, coverage_rule_version, tile_x, tile_y, share_ready_at, memory_point_id),
  CONSTRAINT fk_memory_coverage_point
    FOREIGN KEY (memory_point_id) REFERENCES memory_points(id) ON DELETE CASCADE,
  CONSTRAINT fk_memory_coverage_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE memory_coverage_tiles (
  owner_id BIGINT UNSIGNED NOT NULL,
  coverage_rule_version SMALLINT UNSIGNED NOT NULL,
  visibility ENUM('mine','shared') NOT NULL,
  tile_x INT NOT NULL,
  tile_y INT NOT NULL,
  evidence_count INT UNSIGNED NOT NULL,
  evidence_max_id BIGINT UNSIGNED NOT NULL,
  geometry_json MEDIUMTEXT NOT NULL,
  geometry_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  built_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (owner_id, coverage_rule_version, visibility, tile_x, tile_y),
  INDEX idx_memory_coverage_tile_lookup
    (coverage_rule_version, visibility, tile_x, tile_y, owner_id),
  CONSTRAINT fk_memory_coverage_tile_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE memory_coverage_source_state (
  owner_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  coverage_rule_version SMALLINT UNSIGNED NOT NULL DEFAULT 4,
  evidence_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_memory_coverage_state_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE memory_coverage_regions (
  memory_point_id BIGINT UNSIGNED NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  coverage_rule_version SMALLINT UNSIGNED NOT NULL DEFAULT 4,
  region_id VARCHAR(64) NOT NULL,
  region_level TINYINT UNSIGNED NOT NULL,
  share_ready_at DATETIME(3) NOT NULL,
  PRIMARY KEY (memory_point_id, region_id),
  INDEX idx_memory_coverage_region_owner_ready
    (owner_id, coverage_rule_version, share_ready_at, region_level, region_id),
  CONSTRAINT fk_memory_coverage_region_evidence
    FOREIGN KEY (memory_point_id) REFERENCES memory_coverage_evidence(memory_point_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time provenance normalization. Presence witnesses are deliberately not
-- coverage: they validate continuity but do not create an extra footprint.
INSERT IGNORE INTO memory_coverage_evidence
  (memory_point_id, owner_id, coverage_rule_version, tile_x, tile_y,
   observed_at_ms, share_ready_at, evidence_source)
SELECT mp.id, mp.user_id, 4,
       FLOOR((6378137 * RADIANS(mp.lng)) / 1000),
       FLOOR((6378137 * LOG(TAN(PI()/4 + RADIANS(
         GREATEST(-85.05112878, LEAST(85.05112878, mp.lat))) / 2))) / 1000),
       mp.ts,
       DATE_ADD(GREATEST(
         TIMESTAMPADD(
           MICROSECOND,
           MOD(mp.ts, 1000) * 1000,
           TIMESTAMPADD(SECOND, FLOOR(mp.ts / 1000), CAST('1970-01-01 00:00:00.000' AS DATETIME(3)))
         ),
         mp.received_at
       ), INTERVAL 1800 SECOND),
       mp.evidence_source
  FROM memory_points mp
 WHERE mp.evidence_source IN ('activity_real','passive_real')
   AND mp.continuity_state = 'accepted'
   AND mp.horizontal_accuracy_m IS NOT NULL
   AND mp.horizontal_accuracy_m BETWEEN 0 AND 50
   AND mp.ts <= (UNIX_TIMESTAMP(UTC_TIMESTAMP(3)) * 1000) + 300000
   AND (
     mp.evidence_source = 'passive_real'
     OR EXISTS (
       SELECT 1
         FROM sessions source_session
         JOIN JSON_TABLE(COALESCE(source_session.route_points_canonical, JSON_ARRAY()), '$[*]' COLUMNS(
           lat DOUBLE PATH '$.lat', lng DOUBLE PATH '$.lng',
           observed_ms BIGINT PATH '$.t', segment_id VARCHAR(80) PATH '$.segment_id'
         )) canonical
           ON ABS(CAST(canonical.observed_ms AS SIGNED) - CAST(mp.ts AS SIGNED)) <= 1000
          AND ST_Distance_Sphere(POINT(canonical.lng, canonical.lat), POINT(mp.lng, mp.lat)) <= 5
          AND COALESCE(canonical.segment_id, 'legacy-0') = COALESCE(mp.source_segment_id, 'legacy-0')
        WHERE source_session.user_id = mp.user_id
          AND source_session.client_activity_id = mp.source_activity_client_id
          AND source_session.finalized_at IS NOT NULL
          AND source_session.abandoned_at IS NULL
          AND source_session.source_provenance = 'native_real'
     )
   );

INSERT INTO memory_coverage_source_state
  (owner_id, coverage_rule_version, evidence_revision)
SELECT owner_id, 4, 1 + COUNT(*)
  FROM memory_coverage_evidence
 GROUP BY owner_id
ON DUPLICATE KEY UPDATE
  coverage_rule_version = VALUES(coverage_rule_version),
  evidence_revision = VALUES(evidence_revision);

INSERT IGNORE INTO memory_coverage_regions
  (memory_point_id, owner_id, coverage_rule_version, region_id, region_level, share_ready_at)
SELECT evidence.memory_point_id, evidence.owner_id, evidence.coverage_rule_version,
       region.id, region.level, evidence.share_ready_at
  FROM memory_coverage_evidence evidence
  JOIN memory_points point ON point.id = evidence.memory_point_id
  JOIN regions region
    ON region.level IN (2,3)
   AND point.lng BETWEEN region.bbox_min_lng AND region.bbox_max_lng
   AND point.lat BETWEEN region.bbox_min_lat AND region.bbox_max_lat
   AND ST_Contains(
         region.geom,
         ST_GeomFromText(CONCAT('POINT(',point.lng,' ',point.lat,')'),4326,'axis-order=long-lat')
       )
 WHERE evidence.coverage_rule_version = 4;
