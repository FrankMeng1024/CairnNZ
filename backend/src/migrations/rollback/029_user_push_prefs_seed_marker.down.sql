-- Rollback for migration 029.
USE cairn;
ALTER TABLE user_push_prefs DROP COLUMN seeded_from_devices;
