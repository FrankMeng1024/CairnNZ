-- CARD-ROUTE-01: durable Route identity, origin, edit evidence, and deletion.
-- LOCAL/STAGING REVIEW ONLY. Do not run against production without the
-- reviewed deployment order in the card handoff.
-- The migration intentionally uses the database selected by the runner.
-- Hard-coding `USE cairn` would silently escape an isolated test/staging DB.

ALTER TABLE routes
  ADD COLUMN client_route_id CHAR(36) NULL AFTER user_id,
  ADD COLUMN creation_origin ENUM('activity', 'manual') NULL AFTER client_route_id,
  ADD COLUMN source_activity_client_id CHAR(36) NULL AFTER creation_origin,
  ADD COLUMN source_session_id BIGINT UNSIGNED NULL AFTER source_activity_client_id,
  ADD COLUMN origin_geometry_hash CHAR(64) NULL AFTER source_session_id,
  ADD COLUMN created_geometry_hash CHAR(64) NULL AFTER origin_geometry_hash,
  ADD COLUMN geometry_edited_since_creation TINYINT(1) NOT NULL DEFAULT 0 AFTER created_geometry_hash,
  ADD COLUMN origin_gap_reconnected TINYINT(1) NOT NULL DEFAULT 0 AFTER geometry_edited_since_creation,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE UNIQUE INDEX uk_routes_user_client_route
  ON routes(user_id, client_route_id);

CREATE INDEX idx_routes_source_activity
  ON routes(user_id, source_activity_client_id);

ALTER TABLE routes
  ADD CONSTRAINT fk_routes_source_session
    FOREIGN KEY (source_session_id) REFERENCES sessions(id) ON DELETE SET NULL;

CREATE TABLE route_client_tombstones (
  user_id BIGINT UNSIGNED NOT NULL,
  client_route_id CHAR(36) NOT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_route_id),
  CONSTRAINT fk_route_tombstone_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Legacy rows deliberately retain NULL origin and client identity. Cairn
-- cannot honestly infer provenance from geometry or historical proximity.
