-- Guarded rollback for migration 047.
--
-- This rollback archives every O84 attempt before collapsing history back to
-- the legacy one-row-per-direction shape. Run only during an authorized
-- rollback window after reverting the O84 server/client. The archive table is
-- deliberately retained for recovery and must be reviewed before deletion.

CREATE TABLE IF NOT EXISTS friend_requests_o84_rollback_archive
  LIKE friend_requests;

INSERT IGNORE INTO friend_requests_o84_rollback_archive
SELECT * FROM friend_requests;

-- Keep the newest attempt for each direction because the legacy unique key
-- cannot represent O84 history. All rows remain in the archive above.
DELETE older
  FROM friend_requests older
  JOIN friend_requests newer
    ON newer.from_user_id = older.from_user_id
   AND newer.to_user_id = older.to_user_id
   AND newer.id > older.id;

UPDATE friend_requests
   SET status = 'rejected', resolved_at = COALESCE(resolved_at, UTC_TIMESTAMP(3))
 WHERE status IN ('cancelled','blocked');

DROP TRIGGER IF EXISTS trg_friend_requests_o84_insert;
DROP TRIGGER IF EXISTS trg_friend_requests_o84_update;

ALTER TABLE friend_requests
  DROP INDEX uk_friend_requests_active_pair,
  DROP INDEX idx_friend_requests_sender_history,
  DROP COLUMN active_pair_slot,
  DROP COLUMN pair_key,
  DROP COLUMN sender_dismissed_at,
  MODIFY COLUMN status ENUM('pending','accepted','rejected')
    NOT NULL DEFAULT 'pending',
  ADD UNIQUE KEY unique_request (from_user_id, to_user_id),
  ALGORITHM=COPY, LOCK=SHARED;
