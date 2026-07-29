-- Migration 021: Batch 6.4 Friends completion
-- Adds:
--   - blocked_users table (FRI-block feature)
--   - friend_requests indexes for outbound queries
-- Safe on existing data — new table + new indexes only.
USE cairn;

-- ── FRI-block: block table ──────────────────────────────────────────────────
-- User A blocks user B. Effects (enforced in application layer):
--   - Neither can send friend request to the other
--   - Neither can see the other's public markers on the map
--   - If already friends, blocking auto-removes the friendship (side-effect
--     of the /block endpoint, not a DB cascade)
-- Blocking is one-directional but user experience is bilateral: B sees A
-- as "user not found" everywhere. Unblocking clears only A's side; if B
-- also blocked A, both must unblock.
CREATE TABLE IF NOT EXISTS blocked_users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  blocker_id    BIGINT UNSIGNED NOT NULL,
  blocked_id    BIGINT UNSIGNED NOT NULL,
  reason        VARCHAR(200)    NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_blocker_blocked (blocker_id, blocked_id),
  INDEX idx_blocked_id (blocked_id),
  INDEX idx_blocker_id (blocker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Outbound friend request index ───────────────────────────────────────────
-- Existing /requests only queries by to_user_id (incoming). Add index for
-- the new /requests/outbound query (users seeing what they've sent).
-- Idempotent: MySQL 8 accepts CREATE INDEX only if not exists via version
-- guard — but simpler is a plain CREATE + IGNORE-on-error at deploy time.
-- The application already tolerates duplicate index attempts (deploy script
-- runs migrations with `mysql -f`).
CREATE INDEX idx_friend_requests_from ON friend_requests (from_user_id, status);
