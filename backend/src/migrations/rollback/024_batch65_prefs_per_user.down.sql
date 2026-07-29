-- Rollback for migration 024. Drops the per-user prefs table but leaves
-- device_tokens preferences columns intact (the old fallback path).
USE cairn;
DROP TABLE IF EXISTS user_push_prefs;
