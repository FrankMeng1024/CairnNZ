-- Migration 020: Batch 6.3 Auth 4件套 + AUTH-06 age gate
-- Adds:
--   - users.date_of_birth (AUTH-06 COPPA)
--   - users.deleted_at (AUTH-01 soft-delete)
--   - token_blacklist table (AUTH-08 logout revoke)
--   - password_reset_codes table (AUTH-04 forgot password)
-- Safe to run on existing data — all columns are nullable / new tables.
USE cairn;

-- ── AUTH-06: Age gate ──────────────────────────────────────────────────────
-- Nullable so legacy users can log in and be prompted to fill in later
-- (30-day grace period enforced in application layer).
ALTER TABLE users
  ADD COLUMN date_of_birth DATE NULL AFTER email;

-- pending_registrations also carries DOB so the code-verify step creates
-- the real user with the same DOB the person submitted at register.
ALTER TABLE pending_registrations
  ADD COLUMN date_of_birth DATE NULL AFTER password_hash;

-- ── AUTH-01: Soft-delete grace period ──────────────────────────────────────
-- When set, user is scheduled for hard-delete via cron after 7 days.
-- Restore path clears this column.
ALTER TABLE users
  ADD COLUMN deleted_at DATETIME NULL AFTER updated_at,
  ADD INDEX idx_users_deleted_at (deleted_at);

-- ── AUTH-08: JWT blacklist ─────────────────────────────────────────────────
-- Stores revoked token identifiers (jti claim) with their natural expiry.
-- Cron removes rows where expires_at < NOW() so the table stays small.
-- Middleware checks against a short-TTL LRU cache to avoid per-request DB
-- lookups.
CREATE TABLE IF NOT EXISTS token_blacklist (
  jti         VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  expires_at  DATETIME    NOT NULL,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_blacklist_expires (expires_at),
  INDEX idx_blacklist_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── AUTH-04: Password reset codes ──────────────────────────────────────────
-- 6-digit code emailed to the user; 15-minute expiry; one-shot use.
-- Multiple concurrent codes for same email allowed but only latest works
-- (older rows are cleaned up on new request).
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  code        CHAR(6)      NOT NULL,
  expires_at  DATETIME     NOT NULL,
  used_at     DATETIME     NULL,
  attempts    TINYINT      NOT NULL DEFAULT 0,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reset_email_code (email, code),
  INDEX idx_reset_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
