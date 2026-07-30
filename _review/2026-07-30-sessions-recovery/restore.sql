CREATE TABLE sessions (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT UNSIGNED NOT NULL,
  route_id         BIGINT UNSIGNED NULL,
  type             ENUM('hiking','running') NOT NULL,
  start_time       DATETIME NOT NULL,
  end_time         DATETIME NOT NULL,
  finalized_at     DATETIME NULL,
  distance_m       FLOAT    NOT NULL DEFAULT 0,
  duration_s       INT      NOT NULL DEFAULT 0,
  name             VARCHAR(60) NULL,
  route_points     JSON     NULL,
  route_points_raw JSON     NULL,
  flags            JSON     NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_session_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_session_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL,
  INDEX idx_session_user       (user_id),
  INDEX idx_session_time       (user_id, start_time DESC),
  INDEX idx_sessions_finalized (user_id, finalized_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sessions
  (id, user_id, route_id, type, start_time, end_time, finalized_at,
   distance_m, duration_s, name, route_points, route_points_raw, flags, created_at)
SELECT
  id, user_id, route_id, type, start_time, end_time, finalized_at,
  distance_m, duration_s, name, route_points, route_points_raw, flags, created_at
FROM _sessions_backup_o1_20260726;

ALTER TABLE sessions AUTO_INCREMENT = 202;
