-- Rollback for migration 020_batch63_auth.
-- Data destructive: drops new tables + strips new columns.
-- Only run if the batch needs full revert.
USE cairn;

DROP TABLE IF EXISTS password_reset_codes;
DROP TABLE IF EXISTS token_blacklist;

ALTER TABLE users
  DROP INDEX IF EXISTS idx_users_deleted_at,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS date_of_birth;

ALTER TABLE pending_registrations
  DROP COLUMN IF EXISTS date_of_birth;
