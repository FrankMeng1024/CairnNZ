-- Cairn sessions table — Sprint 37
-- Run against MySQL 8+:
--   mysql -u root -p cairn < src/migrations/002_sessions.sql

USE cairn;

CREATE TABLE IF NOT EXISTS sessions (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  type         ENUM('hiking', 'running') NOT NULL,
  start_time   DATETIME NOT NULL,
  end_time     DATETIME NOT NULL,
  distance_m   FLOAT    NOT NULL DEFAULT 0,
  duration_s   INT      NOT NULL DEFAULT 0,
  route_points JSON     NULL,
  flags        JSON     NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_session_user (user_id),
  INDEX idx_session_time (user_id, start_time DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
