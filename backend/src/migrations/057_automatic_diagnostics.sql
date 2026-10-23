-- Additive automatic diagnostics transport for the bounded Owner QA cohort.
-- The migration runner selects the schema. Never add a USE statement here.

CREATE TABLE diagnostic_qa_enrollments (
  owner_user_id BIGINT UNSIGNED NOT NULL,
  policy_tier ENUM('tier_a', 'tier_b') NOT NULL DEFAULT 'tier_a',
  consent_version VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  enrolled_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (owner_user_id),
  INDEX idx_diagnostic_enrollment_expiry (enabled, expires_at),
  CONSTRAINT fk_diagnostic_enrollment_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE diagnostic_streams (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  owner_epoch VARCHAR(64) NOT NULL,
  stream_id VARCHAR(96) NOT NULL,
  source_type ENUM('activity', 'memory', 'route', 'app') NOT NULL,
  client_activity_id CHAR(36) NULL,
  client_route_id CHAR(36) NULL,
  route_edit_session_id VARCHAR(96) NULL,
  memory_scope_id VARCHAR(96) NULL,
  activity_mode ENUM('hiking', 'running') NULL,
  schema_version SMALLINT UNSIGNED NOT NULL,
  policy_tier ENUM('tier_a', 'tier_b') NOT NULL,
  runtime_version VARCHAR(64) NULL,
  update_id VARCHAR(64) NULL,
  first_event_at DATETIME(3) NOT NULL,
  last_event_at DATETIME(3) NOT NULL,
  last_ingested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_batch_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_batches BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_events BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  client_dropped_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_diagnostic_stream_owner (owner_user_id, stream_id),
  INDEX idx_diagnostic_activity (owner_user_id, client_activity_id, last_event_at),
  INDEX idx_diagnostic_route (owner_user_id, route_edit_session_id, last_event_at),
  INDEX idx_diagnostic_memory (owner_user_id, memory_scope_id, last_event_at),
  INDEX idx_diagnostic_expiry (expires_at),
  CONSTRAINT fk_diagnostic_stream_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE diagnostic_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  stream_fk BIGINT UNSIGNED NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  batch_sequence BIGINT UNSIGNED NOT NULL,
  last_sequence BIGINT UNSIGNED NOT NULL,
  schema_version SMALLINT UNSIGNED NOT NULL,
  first_event_at DATETIME(3) NOT NULL,
  last_event_at DATETIME(3) NOT NULL,
  event_count SMALLINT UNSIGNED NOT NULL,
  client_dropped_count INT UNSIGNED NOT NULL DEFAULT 0,
  payload_sha256 CHAR(64) NOT NULL,
  payload_bytes INT UNSIGNED NOT NULL,
  payload_json MEDIUMTEXT NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_diagnostic_batch_owner (owner_user_id, batch_id),
  UNIQUE KEY uk_diagnostic_stream_sequence (stream_fk, batch_sequence),
  INDEX idx_diagnostic_batch_stream_time (stream_fk, first_event_at),
  INDEX idx_diagnostic_batch_expiry (expires_at),
  CONSTRAINT fk_diagnostic_batch_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_diagnostic_batch_stream
    FOREIGN KEY (stream_fk) REFERENCES diagnostic_streams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
