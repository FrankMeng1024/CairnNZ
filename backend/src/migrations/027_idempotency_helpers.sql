-- Migration 027: idempotency helpers for Sprint 6 schema
--
-- Sprint 6 round-10 review R10B4: migrations 020, 021, 026 use ALTER
-- TABLE ADD COLUMN/INDEX/CONSTRAINT without IF NOT EXISTS (MySQL 8
-- doesn't support that clause). Re-running any of them throws
-- Duplicate errors. This migration replays 020/021/026 idempotently by
-- checking information_schema first — so a partial-failure re-run
-- can complete without manual cleanup.
USE cairn;

DELIMITER $$

DROP PROCEDURE IF EXISTS ensure_col$$
CREATE PROCEDURE ensure_col(
  IN p_table VARCHAR(64),
  IN p_col   VARCHAR(64),
  IN p_ddl   TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = p_table
      AND COLUMN_NAME  = p_col
  ) THEN
    SET @s = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_col, ' ', p_ddl);
    PREPARE stmt FROM @s;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS ensure_fk$$
CREATE PROCEDURE ensure_fk(
  IN p_table   VARCHAR(64),
  IN p_fk_name VARCHAR(64),
  IN p_ddl     TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME        = p_table
      AND CONSTRAINT_NAME   = p_fk_name
      AND CONSTRAINT_TYPE   = 'FOREIGN KEY'
  ) THEN
    SET @s = CONCAT('ALTER TABLE ', p_table, ' ADD CONSTRAINT ', p_fk_name, ' ', p_ddl);
    PREPARE stmt FROM @s;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL ensure_col('users',                 'date_of_birth', 'DATE NULL AFTER email');
CALL ensure_col('users',                 'deleted_at',    'DATETIME NULL AFTER updated_at');
CALL ensure_col('pending_registrations', 'date_of_birth', 'DATE NULL AFTER password_hash');

CALL ensure_fk('token_blacklist',  'fk_blacklist_user',
  'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
CALL ensure_fk('device_tokens',    'fk_device_tokens_user',
  'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
CALL ensure_fk('notification_log', 'fk_notif_recipient',
  'FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE');
CALL ensure_fk('notification_log', 'fk_notif_actor',
  'FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL');
CALL ensure_fk('user_push_prefs',  'fk_prefs_user',
  'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
CALL ensure_fk('data_exports',     'fk_data_exports_user',
  'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
CALL ensure_fk('blocked_users',    'fk_blocked_blocker',
  'FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE');
CALL ensure_fk('blocked_users',    'fk_blocked_blocked',
  'FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE');

DROP PROCEDURE IF EXISTS ensure_col;
DROP PROCEDURE IF EXISTS ensure_fk;
