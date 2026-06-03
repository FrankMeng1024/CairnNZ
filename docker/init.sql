-- Cairn database schema — Sprint 35 initial
-- Run against MySQL 8+:
--   mysql -u root -p < src/migrations/001_init.sql

CREATE DATABASE IF NOT EXISTS cairn CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cairn;

CREATE TABLE IF NOT EXISTS users (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(50)  NOT NULL,
  email        VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
-- Migration: Add friends, friend_requests, markers tables
-- Run: mysql -u root -p cairn < backend/src/migrations/003_friends_markers.sql

CREATE TABLE IF NOT EXISTS friend_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_user_id INT NOT NULL,
  to_user_id INT NOT NULL,
  status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
  created_at DATETIME NOT NULL,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_request (from_user_id, to_user_id)
);

CREATE TABLE IF NOT EXISTS friends (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  friend_id INT NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_friendship (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS markers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'free',
  text VARCHAR(30) DEFAULT '',
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  alt DOUBLE DEFAULT NULL,
  permission ENUM('personal', 'group', 'public') DEFAULT 'personal',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_markers_user (user_id),
  INDEX idx_markers_permission (permission),
  INDEX idx_markers_location (lat, lng)
);
-- Migration 003: Add google_sub column to users table for Google OAuth
ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) NULL AFTER password_hash;
ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL;
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
-- Migration 006: Telemetry sessions for debug logger uploads
-- Purpose: receive complete session JSON dumps from Cairn app debug mode
-- Design: store raw JSONL as LONGTEXT for now; analyze with Python later.
--         If scale grows, normalize events into separate table.

CREATE TABLE IF NOT EXISTS telemetry_sessions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(64) UNIQUE NOT NULL,

  -- Device metadata
  device_model VARCHAR(64),
  device_os VARCHAR(16),         -- 'ios' or 'android'
  os_version VARCHAR(16),
  app_version VARCHAR(16),
  build_number VARCHAR(16),

  -- Session timing
  started_at BIGINT,             -- ms epoch
  ended_at BIGINT,               -- ms epoch
  duration_ms BIGINT,

  -- Session aggregate
  events_count INT DEFAULT 0,
  raw_size_bytes INT DEFAULT 0,
  activity_mode VARCHAR(16),     -- 'hiking' | 'running' | 'free'

  -- Storage
  raw_jsonl LONGTEXT,            -- complete JSONL content; null if too large

  -- Upload meta
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  upload_source VARCHAR(16) DEFAULT 'auto',  -- 'auto' | 'manual' | 'retry'

  -- Indexes
  INDEX idx_session_id (session_id),
  INDEX idx_uploaded_at (uploaded_at),
  INDEX idx_started_at (started_at),
  INDEX idx_app_version (app_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
