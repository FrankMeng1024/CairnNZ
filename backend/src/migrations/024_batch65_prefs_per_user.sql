-- Migration 024: Batch 6.5 review C4 fix — move push preferences to user_push_prefs
--
-- Reviewer A found that push preferences were stored per-device-token,
-- meaning a user without a registered device (denied notification
-- permission on iOS) could NOT save preferences — every UPDATE hit 0
-- rows and preferences were silently lost.
--
-- Fix: promote preferences to a per-user table (like most notification
-- systems do). device_tokens keeps the columns for now (backward
-- compat during rollout); a follow-up migration can drop them once
-- all reads/writes point at the new table.
USE cairn;

CREATE TABLE IF NOT EXISTS user_push_prefs (
  user_id                BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  pref_friend_requests   TINYINT(1)      NOT NULL DEFAULT 1,
  pref_marker_replies    TINYINT(1)      NOT NULL DEFAULT 1,
  pref_memory_hits       TINYINT(1)      NOT NULL DEFAULT 1,
  pref_announcements     TINYINT(1)      NOT NULL DEFAULT 1,
  updated_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed rows from any existing device_tokens (union — any device saying
-- "on" wins, matching the pre-fix behavior). Idempotent via INSERT
-- IGNORE. Users without device rows get default all-on on first PATCH.
INSERT IGNORE INTO user_push_prefs (
  user_id, pref_friend_requests, pref_marker_replies, pref_memory_hits, pref_announcements
)
SELECT
  user_id,
  MAX(pref_friend_requests),
  MAX(pref_marker_replies),
  MAX(pref_memory_hits),
  MAX(pref_announcements)
FROM device_tokens
GROUP BY user_id;
