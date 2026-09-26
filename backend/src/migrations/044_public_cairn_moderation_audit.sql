-- Durable, metadata-only Public moderation ledger.
-- Subject rows deliberately have no foreign keys: deleting a Cairn, report,
-- publication or owner must not erase the history of an operator decision.

ALTER TABLE public_cairn_publications
  ADD COLUMN snapshot_location_policy_version VARCHAR(128)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER snapshot_approximate,
  ALGORITHM=INPLACE, LOCK=NONE;

-- Bind an encounter to the exact accepted observation selected at decision
-- time. memory_presence_witnesses deliberately coalesces a cell's mutable
-- latest observation, so a foreign-key reference alone is not immutable
-- evidence and could make later final-route reconciliation inspect a newer
-- point than the one that actually qualified.
ALTER TABLE public_cairn_encounters
  ADD COLUMN evidence_lat DOUBLE NULL AFTER evidence_witness_id,
  ADD COLUMN evidence_lng DOUBLE NULL AFTER evidence_lat,
  ADD COLUMN evidence_observed_at_ms BIGINT UNSIGNED NULL AFTER evidence_lng,
  ADD COLUMN evidence_segment_id VARCHAR(80) NULL AFTER evidence_observed_at_ms,
  ADD COLUMN evidence_source VARCHAR(32) NULL AFTER evidence_segment_id,
  ADD COLUMN evidence_horizontal_accuracy_m DOUBLE NULL AFTER evidence_source,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE TABLE public_cairn_moderation_audit (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(48) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  marker_id BIGINT UNSIGNED NULL,
  publication_id BIGINT UNSIGNED NULL,
  report_id BIGINT UNSIGNED NULL,
  publication_epoch BIGINT UNSIGNED NULL,
  content_revision BIGINT UNSIGNED NULL,
  from_state VARCHAR(32) NULL,
  to_state VARCHAR(32) NULL,
  reason VARCHAR(240) NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_public_audit_created (created_at, id),
  INDEX idx_public_audit_publication (publication_id, id),
  INDEX idx_public_audit_report (report_id, id),
  INDEX idx_public_audit_marker (marker_id, id),
  CONSTRAINT fk_public_audit_actor
    FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
