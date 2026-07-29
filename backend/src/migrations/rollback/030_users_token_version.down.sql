-- Rollback for migration 030.
USE cairn;
ALTER TABLE users DROP COLUMN token_version;
