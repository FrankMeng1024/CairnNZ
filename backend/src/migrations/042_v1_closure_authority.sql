-- V1 closure: preserve source discontinuities and immutable Public review payloads.
-- Additive only. Migrations 037-041 may already be applied and are not rewritten.

ALTER TABLE users
  ADD COLUMN activity_source_realm ENUM('standard','isolated_qa')
    NOT NULL DEFAULT 'standard' AFTER public_cairn_operator,
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE sessions
  ADD COLUMN source_provenance ENUM('unknown','native_real','isolated_qa')
    NOT NULL DEFAULT 'unknown' AFTER client_activity_id,
  ADD COLUMN route_points_canonical JSON NULL AFTER route_points_raw,
  ADD INDEX idx_session_source_provenance
    (user_id, client_activity_id, source_provenance, finalized_at),
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE memory_points
  ADD COLUMN source_segment_id VARCHAR(80) CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci NULL AFTER source_activity_client_id,
  ADD INDEX idx_memory_encounter_context
    (user_id, evidence_source, source_activity_client_id, source_segment_id, ts),
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE memory_presence_witnesses
  ADD COLUMN source_segment_id VARCHAR(80) CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci NULL AFTER source_activity_client_id,
  ADD INDEX idx_presence_encounter_context
    (user_id, evidence_source, source_activity_client_id, source_segment_id, observed_at_ms),
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE public_cairn_publications
  ADD COLUMN snapshot_type VARCHAR(32) NULL AFTER content_revision,
  ADD COLUMN snapshot_text TEXT NULL AFTER snapshot_type,
  ADD COLUMN snapshot_lat DOUBLE NULL AFTER snapshot_text,
  ADD COLUMN snapshot_lng DOUBLE NULL AFTER snapshot_lat,
  ADD COLUMN snapshot_approximate TINYINT(1) NULL AFTER snapshot_lng,
  ADD COLUMN snapshot_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER snapshot_approximate,
  ALGORITHM=INPLACE, LOCK=NONE;
