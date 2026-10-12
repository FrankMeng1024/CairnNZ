-- B3 Routes: ordered draft persistence and immutable direct deliveries.
-- LOCAL/STAGING REVIEW ONLY. Rehearse through the migration runner before any
-- separately authorized deployment. Existing Routes remain continuous legacy
-- rows and are not rewritten.

ALTER TABLE routes
  ADD COLUMN ordered_draft JSON NULL AFTER points,
  ADD COLUMN resolution_state ENUM('continuous','unresolved_gaps') NOT NULL DEFAULT 'continuous' AFTER ordered_draft,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE TABLE shared_route_deliveries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  sender_id BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  source_route_id BIGINT UNSIGNED NULL,
  source_route_key VARCHAR(96) NOT NULL,
  source_content_revision BIGINT UNSIGNED NOT NULL,
  content_hash CHAR(64) NOT NULL,
  idempotency_key CHAR(36) NOT NULL,
  route_snapshot JSON NOT NULL,
  delivered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at DATETIME(3) NULL,
  UNIQUE KEY uk_route_delivery_content (sender_id, recipient_id, source_route_key, content_hash),
  UNIQUE KEY uk_route_delivery_attempt (sender_id, recipient_id, idempotency_key),
  INDEX idx_route_delivery_recipient (recipient_id, removed_at, delivered_at),
  INDEX idx_route_delivery_source (sender_id, source_route_key, delivered_at),
  CONSTRAINT fk_route_delivery_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_route_delivery_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_route_delivery_source FOREIGN KEY (source_route_id) REFERENCES routes(id) ON DELETE SET NULL,
  CONSTRAINT chk_route_delivery_distinct CHECK (sender_id <> recipient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
