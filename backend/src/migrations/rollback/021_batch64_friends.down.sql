-- Rollback for migration 021_batch64_friends.
USE cairn;
DROP TABLE IF EXISTS blocked_users;
DROP INDEX IF EXISTS idx_friend_requests_from ON friend_requests;
