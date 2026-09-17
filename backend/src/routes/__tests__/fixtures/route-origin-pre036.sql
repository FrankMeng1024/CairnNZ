-- Minimal legitimate pre-036 schema fixture for the disposable MySQL test.
-- Shapes are derived from migrations 001, 002, 005, 018, 019, and 034.
-- The caller must select a uniquely named disposable database first.

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  client_activity_id CHAR(36) NULL,
  type ENUM('hiking', 'running') NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  finalized_at DATETIME NULL,
  distance_m FLOAT NOT NULL DEFAULT 0,
  duration_s INT NOT NULL DEFAULT 0,
  route_points JSON NULL,
  flags JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sessions_user_client_activity (user_id, client_activity_id),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activity_client_tombstones (
  user_id BIGINT UNSIGNED NOT NULL,
  client_activity_id CHAR(36) NOT NULL,
  discarded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_activity_id),
  CONSTRAINT fk_activity_tombstone_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE routes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  points JSON NOT NULL,
  waypoints JSON NOT NULL DEFAULT (JSON_ARRAY()),
  distance_m FLOAT NOT NULL DEFAULT 0,
  elevation_gain_m FLOAT NOT NULL DEFAULT 0,
  run_count INT NOT NULL DEFAULT 0,
  last_run_at DATETIME NULL,
  permission ENUM('personal', 'friend', 'public') NOT NULL DEFAULT 'personal',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_route_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_route_user (user_id),
  INDEX idx_route_run_count (user_id, run_count DESC),
  INDEX idx_routes_permission (permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
