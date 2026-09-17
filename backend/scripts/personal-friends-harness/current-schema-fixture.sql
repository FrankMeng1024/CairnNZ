-- Disposable current-schema fixture for the Personal/Friends integration
-- harness. It is intentionally selected-schema-only: no CREATE DATABASE,
-- USE, DROP, production rows, or copied AUTO_INCREMENT values.

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  date_of_birth DATE NULL,
  password_hash VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  token_version INT UNSIGNED NOT NULL DEFAULT 0,
  account_type ENUM('free','pro') NOT NULL DEFAULT 'free',
  memory_subscription_limit INT NOT NULL DEFAULT 5,
  onboarding_done_at TIMESTAMP NULL,
  INDEX idx_users_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  client_activity_id CHAR(36) NULL,
  route_id BIGINT UNSIGNED NULL,
  type ENUM('hiking','running') NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  finalized_at DATETIME NULL,
  abandoned_at DATETIME NULL,
  abandon_reason VARCHAR(64) NULL,
  distance_m FLOAT NOT NULL DEFAULT 0,
  duration_s INT NOT NULL DEFAULT 0,
  name VARCHAR(60) NULL,
  route_points JSON NULL,
  route_points_raw JSON NULL,
  flags JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN finalized_at IS NULL AND abandoned_at IS NULL AND end_time=start_time THEN 1 ELSE NULL END
  ) STORED,
  UNIQUE KEY uk_sessions_user_client_activity (user_id, client_activity_id),
  UNIQUE KEY uk_sessions_user_active_slot (user_id, active_slot),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE friend_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_user_id BIGINT UNSIGNED NOT NULL,
  to_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','accepted','rejected') DEFAULT 'pending',
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY unique_request (from_user_id,to_user_id),
  INDEX idx_friend_requests_from (from_user_id,status),
  CONSTRAINT fk_request_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_request_to FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE friends (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  friend_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY unique_friendship (user_id,friend_id),
  CONSTRAINT fk_friend_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friend_target FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE markers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  client_cairn_id CHAR(36) NULL,
  origin_activity_client_id CHAR(36) NULL,
  origin_session_id BIGINT UNSIGNED NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'free',
  text VARCHAR(250) DEFAULT '',
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  alt DOUBLE NULL,
  permission ENUM('personal','group','public') DEFAULT 'personal',
  public_snapshot JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  approximate TINYINT(1) NOT NULL DEFAULT 0,
  helpful_count INT UNSIGNED DEFAULT 0,
  report_count INT UNSIGNED DEFAULT 0,
  status VARCHAR(16) DEFAULT 'healthy',
  hidden_at DATETIME NULL,
  UNIQUE KEY uk_markers_user_client_cairn (user_id,client_cairn_id),
  CONSTRAINT fk_marker_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_marker_session FOREIGN KEY (origin_session_id) REFERENCES sessions(id) ON DELETE SET NULL
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  permission ENUM('personal','friend','public') NOT NULL DEFAULT 'personal',
  CONSTRAINT fk_route_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE memory_points (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  ts BIGINT UNSIGNED NOT NULL,
  client_id VARCHAR(36) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_cid (user_id,client_id),
  INDEX idx_user_ts_cid (user_id,ts,client_id),
  CONSTRAINT fk_memory_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE memory_subscriptions (
  user_id BIGINT UNSIGNED NOT NULL,
  friend_id BIGINT UNSIGNED NOT NULL,
  subscribed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,friend_id),
  CONSTRAINT fk_ms_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_friend FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //
CREATE TRIGGER trg_memory_subscription_cap BEFORE INSERT ON memory_subscriptions FOR EACH ROW
BEGIN
  DECLARE cur_count INT;
  DECLARE max_allowed INT;
  DECLARE friend_exists INT;
  SELECT COUNT(*) INTO friend_exists FROM friends WHERE user_id=NEW.user_id AND friend_id=NEW.friend_id;
  IF friend_exists=0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='memory_subscription requires existing friend pair'; END IF;
  SELECT memory_subscription_limit INTO max_allowed FROM users WHERE id=NEW.user_id FOR UPDATE;
  SELECT COUNT(*) INTO cur_count FROM memory_subscriptions WHERE user_id=NEW.user_id;
  IF cur_count>=max_allowed THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='memory_subscription limit exceeded'; END IF;
END//
DELIMITER ;

CREATE TABLE hidden_items (
  user_id BIGINT UNSIGNED NOT NULL,
  item_type ENUM('mark','route') NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  hidden_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,item_type,item_id),
  CONSTRAINT fk_hidden_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE blocked_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  blocker_id BIGINT UNSIGNED NOT NULL,
  blocked_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(200) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_blocker_blocked (blocker_id,blocked_id),
  CONSTRAINT fk_blocked_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_blocked_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activity_client_tombstones (
  user_id BIGINT UNSIGNED NOT NULL, client_activity_id CHAR(36) NOT NULL,
  discarded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,client_activity_id),
  CONSTRAINT fk_activity_tombstone_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE marker_client_tombstones (
  user_id BIGINT UNSIGNED NOT NULL, client_cairn_id CHAR(36) NOT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,client_cairn_id),
  CONSTRAINT fk_marker_tombstone_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE token_blacklist (
  jti VARCHAR(64) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_blacklist_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE idempotency_keys (
  op_id CHAR(36) PRIMARY KEY, op_kind VARCHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL, status_code SMALLINT NOT NULL,
  response_json JSON NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE telemetry_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(64) UNIQUE NOT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE unlocked_regions (
  user_id BIGINT UNSIGNED NOT NULL,
  region_id VARCHAR(191) NOT NULL,
  unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,region_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Startup compatibility sentinels; test-unneeded workers stay disabled.
CREATE TABLE pending_registrations (email VARCHAR(255) PRIMARY KEY, date_of_birth DATE NULL);
CREATE TABLE password_reset_codes (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);
CREATE TABLE device_tokens (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NULL);
CREATE TABLE notification_log (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, recipient_user_id BIGINT UNSIGNED NULL, actor_user_id BIGINT UNSIGNED NULL);
CREATE TABLE user_push_prefs (user_id BIGINT UNSIGNED PRIMARY KEY);
CREATE TABLE data_exports (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NULL);
