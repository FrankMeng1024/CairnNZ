-- Rollback for migration 028.
USE cairn;
ALTER TABLE friend_requests DROP COLUMN resolved_at;
