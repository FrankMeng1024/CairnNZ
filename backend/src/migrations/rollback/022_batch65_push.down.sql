-- Rollback for migration 022_batch65_push.
USE cairn;
DROP TABLE IF EXISTS notification_log;
DROP TABLE IF EXISTS device_tokens;
