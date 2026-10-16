-- O84 Friends request lifecycle: immutable attempts + one active request per pair.
--
-- LOCAL/STAGING REVIEW ONLY. Rehearse with verify-migration-047.sh before any
-- separately authorized production deployment. Rejected attempts remain
-- visible to their sender until that sender explicitly dismisses them.

ALTER TABLE friend_requests
  MODIFY COLUMN status
    ENUM('pending','accepted','rejected','cancelled','blocked')
    NOT NULL DEFAULT 'pending',
  ADD COLUMN sender_dismissed_at DATETIME(3) NULL AFTER resolved_at,
  ALGORITHM=INPLACE, LOCK=NONE;

-- The legacy directional unique key permits two simultaneous opposite
-- requests but prevents a fresh attempt from receiving a fresh identity.
-- Resolve any pre-existing opposite-direction duplicate deterministically
-- before replacing it with an unordered active-pair invariant.
UPDATE friend_requests loser
JOIN friend_requests winner
  ON loser.status = 'pending'
 AND winner.status = 'pending'
 AND loser.from_user_id = winner.to_user_id
 AND loser.to_user_id = winner.from_user_id
 AND loser.id > winner.id
SET loser.status = 'cancelled',
    loser.resolved_at = COALESCE(loser.resolved_at, UTC_TIMESTAMP(3));

ALTER TABLE friend_requests
  DROP INDEX unique_request,
  ADD COLUMN pair_key VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER to_user_id,
  ADD COLUMN active_pair_slot TINYINT NULL AFTER sender_dismissed_at,
  ALGORITHM=INPLACE, LOCK=NONE;

UPDATE friend_requests
   SET pair_key = CONCAT(LEAST(from_user_id,to_user_id), ':',
                         GREATEST(from_user_id,to_user_id)),
       active_pair_slot = CASE WHEN status = 'pending' THEN 1 ELSE NULL END;

ALTER TABLE friend_requests
  MODIFY COLUMN pair_key VARCHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD UNIQUE KEY uk_friend_requests_active_pair (pair_key, active_pair_slot),
  ADD INDEX idx_friend_requests_sender_history
    (from_user_id, sender_dismissed_at, status, created_at),
  ALGORITHM=INPLACE, LOCK=NONE;

-- Triggers keep the materialized unordered key and nullable active slot
-- truthful even for maintenance writes outside the API. Unlike STORED
-- generated columns, these do not invalidate the existing cascading FKs.
DELIMITER //
CREATE TRIGGER trg_friend_requests_o84_insert
BEFORE INSERT ON friend_requests
FOR EACH ROW
BEGIN
  SET NEW.pair_key = CONCAT(LEAST(NEW.from_user_id,NEW.to_user_id), ':',
                            GREATEST(NEW.from_user_id,NEW.to_user_id));
  SET NEW.active_pair_slot = CASE WHEN NEW.status = 'pending' THEN 1 ELSE NULL END;
END//

CREATE TRIGGER trg_friend_requests_o84_update
BEFORE UPDATE ON friend_requests
FOR EACH ROW
BEGIN
  SET NEW.pair_key = CONCAT(LEAST(NEW.from_user_id,NEW.to_user_id), ':',
                            GREATEST(NEW.from_user_id,NEW.to_user_id));
  SET NEW.active_pair_slot = CASE WHEN NEW.status = 'pending' THEN 1 ELSE NULL END;
END//
DELIMITER ;
