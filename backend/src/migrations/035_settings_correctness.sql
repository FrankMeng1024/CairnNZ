-- Settings correctness convergence.
--
-- 1. Feedback gets a durable, acknowledged server record.
-- 2. Internal QA telemetry uploaded with a signed-in account is attributable
--    for export/deletion; operations-key uploads remain intentionally ownerless.
-- 3. unlocked_regions becomes part of the account-owned FK contract.
--
-- Apply before deploying the matching backend/client. The deployment/test
-- runner selects the target schema; never escape an isolated review database
-- through a hard-coded USE statement.

CREATE TABLE IF NOT EXISTS feedback_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  client_submission_id CHAR(36) NOT NULL,
  kind ENUM('feedback', 'bug') NOT NULL,
  message TEXT NOT NULL,
  app_version VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_feedback_user_submission (user_id, client_submission_id),
  INDEX idx_feedback_user_created (user_id, created_at),
  CONSTRAINT fk_feedback_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='telemetry_sessions'
        AND COLUMN_NAME='owner_user_id') = 0,
    'ALTER TABLE telemetry_sessions ADD COLUMN owner_user_id BIGINT UNSIGNED NULL AFTER id',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Recover ownership for historical Activity telemetry when its debug session
-- identifier is the durable client Activity identifier. Other legacy or
-- operations-key rows remain ownerless because Cairn cannot attribute them
-- honestly after the fact.
UPDATE telemetry_sessions t
JOIN sessions s ON s.client_activity_id = t.session_id
SET t.owner_user_id = s.user_id
WHERE t.owner_user_id IS NULL;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='telemetry_sessions'
        AND INDEX_NAME='idx_telemetry_owner') = 0,
    'CREATE INDEX idx_telemetry_owner ON telemetry_sessions(owner_user_id, uploaded_at)',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='telemetry_sessions'
        AND CONSTRAINT_NAME='fk_telemetry_owner') = 0,
    'ALTER TABLE telemetry_sessions ADD CONSTRAINT fk_telemetry_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- unlocked_regions predates the numbered migration ledger and historically
-- lacked ownership enforcement. Remove only already-orphaned derived rows,
-- then make future account deletion automatic and fail-closed.
DELETE ur FROM unlocked_regions ur
LEFT JOIN users u ON u.id = ur.user_id
WHERE u.id IS NULL;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='unlocked_regions'
        AND CONSTRAINT_NAME='fk_unlocked_regions_user') = 0,
    'ALTER TABLE unlocked_regions ADD CONSTRAINT fk_unlocked_regions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
