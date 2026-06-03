-- Migration 005: Add routes table and link sessions to routes

CREATE TABLE IF NOT EXISTS routes (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(100)    NOT NULL,
  description      VARCHAR(500)    NULL,
  points           JSON            NOT NULL,
  waypoints        JSON            NOT NULL DEFAULT (JSON_ARRAY()),
  distance_m       FLOAT           NOT NULL DEFAULT 0,
  elevation_gain_m FLOAT           NOT NULL DEFAULT 0,
  run_count        INT             NOT NULL DEFAULT 0,
  last_run_at      DATETIME        NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_route_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_route_user      (user_id),
  INDEX idx_route_run_count (user_id, run_count DESC)
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS route_id BIGINT UNSIGNED NULL AFTER user_id;

-- Only add FK if it doesn't exist (idempotent)
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sessions'
    AND CONSTRAINT_NAME = 'fk_session_route'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE sessions ADD CONSTRAINT fk_session_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
