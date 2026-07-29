-- Migration 030: users.token_version for global session revocation
--
-- Sprint 6 round-9 R9B8: /account/restore only revoked the caller's
-- current jti — other logged-in devices (up to 5) kept their pre-delete
-- JWTs valid until natural expiry. Threat-model gap for the
-- "delete-my-account-because-someone-else-got-in" scenario.
--
-- Fix: users.token_version INT column, bumped on restore. JWT sign
-- includes `token_version` claim. authenticate.js rejects tokens
-- where jwt.token_version < user's current token_version. Bumping
-- token_version invalidates ALL outstanding tokens for that user in
-- one atomic step (no need to enumerate all jtis).
USE cairn;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='token_version') = 0,
    'ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER deleted_at',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
