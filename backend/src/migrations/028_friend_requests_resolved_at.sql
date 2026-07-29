-- Migration 028: friend_requests.resolved_at + resolved-at purge accuracy
--
-- Sprint 6 round-14 R14B7: authSweep purge used `created_at` as proxy
-- for "when was this request resolved" — but a request accepted
-- yesterday but sent 91 days ago got deleted immediately, losing
-- recent friendship provenance. Add a resolved_at timestamp set by
-- /accept + /reject handlers; authSweep switches to resolved_at.
USE cairn;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='friend_requests' AND COLUMN_NAME='resolved_at') = 0,
    'ALTER TABLE friend_requests ADD COLUMN resolved_at DATETIME NULL AFTER status',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill existing rows: if status is not 'pending', set resolved_at
-- to created_at as a best-effort proxy (the actual resolve time is
-- lost, but this keeps the 90-day purge from firing on ancient rows).
UPDATE friend_requests
   SET resolved_at = created_at
 WHERE resolved_at IS NULL AND status IN ('accepted','rejected');
