-- REVIEW/EMERGENCY rollback for 045_memory_friends_cairn_contract.sql.
-- DESTRUCTIVE: drops acquired Cairn history, moderation and visit/event data.
-- Never run in production without an approved export/retention plan.

DROP TABLE IF EXISTS cairn_review_audit;
DROP TABLE IF EXISTS cairn_review_cases;
DROP TABLE IF EXISTS cairn_source_moderation;
DROP TABLE IF EXISTS cairn_acquisition_events;
DROP TABLE IF EXISTS cairn_presentation_groups;
DROP TABLE IF EXISTS cairn_local_visit_acquisitions;
DROP TABLE IF EXISTS cairn_local_visits;
DROP TABLE IF EXISTS cairn_acquisitions;
DROP TABLE IF EXISTS cairn_collections;
DROP TABLE IF EXISTS cairn_revisions;
DROP TABLE IF EXISTS memory_projection_preferences;

DROP TRIGGER IF EXISTS trg_memory_subscription_friend;
DELIMITER //
CREATE TRIGGER trg_memory_subscription_cap
BEFORE INSERT ON memory_subscriptions
FOR EACH ROW
BEGIN
  DECLARE subscription_count INT;
  SELECT COUNT(*) INTO subscription_count
    FROM memory_subscriptions
    WHERE user_id = NEW.user_id;
  IF subscription_count >= 5 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'memory_subscription_limit_reached';
  END IF;
END;
//
DELIMITER ;

ALTER TABLE friend_requests
  DROP COLUMN accepter_memory_share,
  DROP COLUMN requester_memory_share;

ALTER TABLE memory_share_grants
  DROP COLUMN consent_version,
  DROP COLUMN coverage_scope;

ALTER TABLE memory_points
  DROP INDEX idx_memory_friend_delay,
  DROP COLUMN received_at;
