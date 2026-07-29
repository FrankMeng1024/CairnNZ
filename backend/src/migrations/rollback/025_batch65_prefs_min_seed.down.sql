-- Rollback for migration 025. No-op — the fix is idempotent forward-only.
-- If you need to undo, restore user_push_prefs from a backup.
USE cairn;
-- No-op: the intent of 025 is a data correction, not a schema change.
SELECT 1;
