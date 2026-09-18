-- Revision 02: keep time-qualified presence separate from exploration geometry.
-- Additive/corrective only; 037 remains immutable because it is deployed.

CREATE TABLE memory_presence_witnesses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  client_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  first_lat DOUBLE NOT NULL,
  first_lng DOUBLE NOT NULL,
  first_observed_at_ms BIGINT UNSIGNED NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  observed_at_ms BIGINT UNSIGNED NOT NULL,
  evidence_source ENUM('activity_real','passive_real') NOT NULL,
  source_activity_client_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  horizontal_accuracy_m DECIMAL(7,2) NOT NULL,
  continuity_state ENUM('accepted') NOT NULL DEFAULT 'accepted',
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_presence_user_client (user_id, client_id),
  INDEX idx_presence_encounter (user_id, observed_at_ms, evidence_source),
  INDEX idx_presence_activity (user_id, source_activity_client_id, observed_at_ms),
  CONSTRAINT fk_presence_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_presence_first_lat CHECK (first_lat BETWEEN -90 AND 90),
  CONSTRAINT chk_presence_first_lng CHECK (first_lng BETWEEN -180 AND 180),
  CONSTRAINT chk_presence_lat CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT chk_presence_lng CHECK (lng BETWEEN -180 AND 180),
  CONSTRAINT chk_presence_time_order CHECK (observed_at_ms >= first_observed_at_ms),
  CONSTRAINT chk_presence_accuracy CHECK (horizontal_accuracy_m BETWEEN 0 AND 1000),
  CONSTRAINT chk_presence_activity_identity CHECK (
    (evidence_source = 'activity_real' AND source_activity_client_id IS NOT NULL)
    OR (evidence_source = 'passive_real' AND source_activity_client_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE friend_cairn_encounters
  ADD COLUMN evidence_kind ENUM('legacy_coverage','presence_witness')
    NOT NULL DEFAULT 'legacy_coverage' AFTER evidence_point_id,
  ALGORITHM=INPLACE, LOCK=NONE;
