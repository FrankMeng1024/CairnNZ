-- Migration 018: Friend System v1 (v4.2 final)
-- Plan: _research/friend-system/FINAL_PRODUCT_PLAN_v4.md
--
-- Adds:
--   1. users.account_type, users.memory_subscription_limit (paywall foundation)
--   2. routes.permission ENUM (Personal/Friend/Public visibility for routes)
--   3. memory_subscriptions table (5-friend Memory tab cap + race-safe trigger)
--   4. hidden_items table (per-user blacklist for friend/stranger marks/routes)
--
-- Does NOT add:
--   - is_mock flag (user rejected)
--   - friend_share_settings pause table (user rejected)
--   - home_clusters (user rejected)
--
-- Idempotent for fresh apply (uses IF NOT EXISTS on tables). ALTER COLUMN
-- uses information_schema checks since MySQL 8.0 doesn't support
-- "ADD COLUMN IF NOT EXISTS" syntax.

USE cairn;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. users — paywall foundation (idempotent ALTER via information_schema)
-- ──────────────────────────────────────────────────────────────────────────

-- users.account_type
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = 'cairn' AND TABLE_NAME = 'users'
               AND COLUMN_NAME = 'account_type');
SET @sql := IF(@col = 0,
  'ALTER TABLE users ADD COLUMN account_type ENUM(''free'',''pro'') NOT NULL DEFAULT ''free''',
  'SELECT ''users.account_type already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- users.memory_subscription_limit
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = 'cairn' AND TABLE_NAME = 'users'
               AND COLUMN_NAME = 'memory_subscription_limit');
SET @sql := IF(@col = 0,
  'ALTER TABLE users ADD COLUMN memory_subscription_limit INT NOT NULL DEFAULT 5',
  'SELECT ''users.memory_subscription_limit already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. routes — add visibility tier (Personal/Friend/Public)
-- ──────────────────────────────────────────────────────────────────────────

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = 'cairn' AND TABLE_NAME = 'routes'
               AND COLUMN_NAME = 'permission');
SET @sql := IF(@col = 0,
  'ALTER TABLE routes ADD COLUMN permission ENUM(''personal'',''friend'',''public'') NOT NULL DEFAULT ''personal''',
  'SELECT ''routes.permission already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index on permission (idempotent)
SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = 'cairn' AND TABLE_NAME = 'routes'
               AND INDEX_NAME = 'idx_routes_permission');
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_routes_permission ON routes(permission)',
  'SELECT ''idx_routes_permission already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. memory_subscriptions
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_subscriptions (
  user_id       BIGINT UNSIGNED NOT NULL,
  friend_id     BIGINT UNSIGNED NOT NULL,
  subscribed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id),
  CONSTRAINT fk_ms_user   FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_friend FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ms_user   (user_id),
  INDEX idx_ms_friend (friend_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Trigger — race-safe 5-cap + friend-must-be-friend
-- ──────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_memory_subscription_cap;

DELIMITER //

CREATE TRIGGER trg_memory_subscription_cap
BEFORE INSERT ON memory_subscriptions
FOR EACH ROW
BEGIN
  DECLARE cur_count   INT;
  DECLARE max_allowed INT;
  DECLARE friend_exists INT;

  SELECT COUNT(*) INTO friend_exists
    FROM friends
    WHERE user_id = NEW.user_id AND friend_id = NEW.friend_id;

  IF friend_exists = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'memory_subscription requires existing friend pair';
  END IF;

  SELECT memory_subscription_limit INTO max_allowed
    FROM users
    WHERE id = NEW.user_id
    FOR UPDATE;

  SELECT COUNT(*) INTO cur_count
    FROM memory_subscriptions
    WHERE user_id = NEW.user_id;

  IF cur_count >= max_allowed THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'memory_subscription limit exceeded';
  END IF;
END;
//

DELIMITER ;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. hidden_items — per-user blacklist
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hidden_items (
  user_id   BIGINT UNSIGNED NOT NULL,
  item_type ENUM('mark','route') NOT NULL,
  item_id   BIGINT UNSIGNED NOT NULL,
  hidden_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_type, item_id),
  CONSTRAINT fk_hidden_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_hidden_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
