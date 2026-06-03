-- Migration 004: Auth system rebuild
-- Drops and recreates users, adds user_oauth + pending_registrations
-- WARNING: destructive — clears all existing user data
USE cairn;

-- Drop dependents first
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS user_oauth;
DROP TABLE IF EXISTS pending_registrations;
DROP TABLE IF EXISTS users;

-- ── users ──────────────────────────────────────────────────────────────────
-- Only verified users live here. password_hash nullable (OAuth-only users).
CREATE TABLE users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── user_oauth ─────────────────────────────────────────────────────────────
-- One row per provider per user. Supports google, apple, github, etc.
CREATE TABLE user_oauth (
  user_id     BIGINT UNSIGNED NOT NULL,
  provider    VARCHAR(32)     NOT NULL,   -- 'google' | 'apple' | 'github' ...
  provider_id VARCHAR(255)    NOT NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_id),
  UNIQUE KEY uniq_user_provider (user_id, provider),
  CONSTRAINT fk_oauth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── pending_registrations ──────────────────────────────────────────────────
-- Temporary holding area. Not a real user until email verified.
-- Gmail login for same email deletes the pending row (link/code becomes void).
CREATE TABLE pending_registrations (
  email         VARCHAR(255) NOT NULL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  code          CHAR(6)      NOT NULL,
  expires_at    DATETIME     NOT NULL,
  attempts      TINYINT      NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sessions ───────────────────────────────────────────────────────────────
CREATE TABLE sessions (
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
