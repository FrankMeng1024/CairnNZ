-- Migration 027: idempotency helpers for Sprint 6 schema (v2)
--
-- Sprint 6 round-10 R10B4: 020/021/026 use ALTER ADD COLUMN/CONSTRAINT
-- without IF NOT EXISTS (MySQL 8 doesn't support). Re-running throws
-- Duplicate errors.
--
-- Sprint 6 round-11 R11B1 fix: rewrote as inline PREPARE/EXECUTE blocks
-- (no DELIMITER, no stored procedures, no CREATE ROUTINE privilege).
-- Works via BOTH mysql CLI and mysql2 driver's multipleStatements path.
-- Each guard is a self-contained conditional prepared statement.
--
-- Safe to run repeatedly — no-op if the target column / FK already exists.
USE cairn;

-- ─── users.date_of_birth ────────────────────────────────────────────────────
SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='date_of_birth') = 0,
    'ALTER TABLE users ADD COLUMN date_of_birth DATE NULL AFTER email',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── users.deleted_at ───────────────────────────────────────────────────────
SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='deleted_at') = 0,
    'ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── pending_registrations.date_of_birth ────────────────────────────────────
SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pending_registrations' AND COLUMN_NAME='date_of_birth') = 0,
    'ALTER TABLE pending_registrations ADD COLUMN date_of_birth DATE NULL AFTER password_hash',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 8 FK cascades from migration 026 ──────────────────────────────────────
SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='token_blacklist' AND CONSTRAINT_NAME='fk_blacklist_user') = 0,
    'ALTER TABLE token_blacklist ADD CONSTRAINT fk_blacklist_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='device_tokens' AND CONSTRAINT_NAME='fk_device_tokens_user') = 0,
    'ALTER TABLE device_tokens ADD CONSTRAINT fk_device_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='notification_log' AND CONSTRAINT_NAME='fk_notif_recipient') = 0,
    'ALTER TABLE notification_log ADD CONSTRAINT fk_notif_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='notification_log' AND CONSTRAINT_NAME='fk_notif_actor') = 0,
    'ALTER TABLE notification_log ADD CONSTRAINT fk_notif_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='user_push_prefs' AND CONSTRAINT_NAME='fk_prefs_user') = 0,
    'ALTER TABLE user_push_prefs ADD CONSTRAINT fk_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='data_exports' AND CONSTRAINT_NAME='fk_data_exports_user') = 0,
    'ALTER TABLE data_exports ADD CONSTRAINT fk_data_exports_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='blocked_users' AND CONSTRAINT_NAME='fk_blocked_blocker') = 0,
    'ALTER TABLE blocked_users ADD CONSTRAINT fk_blocked_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='blocked_users' AND CONSTRAINT_NAME='fk_blocked_blocked') = 0,
    'ALTER TABLE blocked_users ADD CONSTRAINT fk_blocked_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
