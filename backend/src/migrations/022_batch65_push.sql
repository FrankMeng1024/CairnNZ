-- Migration 022: Batch 6.5 Push notifications
-- Adds:
--   - device_tokens table (per-device push token + platform + preferences)
--   - notification_log table (server-side dedupe + audit trail)
-- Safe on existing data — new tables only.
--
-- APNs / FCM credentials are stored in .env, NOT in the DB.
USE cairn;

-- ── Push tokens per device ──────────────────────────────────────────────────
-- One user can have multiple devices (phone + iPad + web). Each row is a
-- unique (user_id, token) pair. Token is opaque to us — Expo push tokens
-- look like "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", APNs raw is 64
-- hex chars, FCM is a longer base64 string.
--
-- last_seen_at bumped on every /register call so we can prune dormant
-- rows (device deleted app, token invalidated by Apple, etc). Cron sweeps
-- rows older than 60 days.
CREATE TABLE IF NOT EXISTS device_tokens (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  token         VARCHAR(255)    NOT NULL,
  platform      ENUM('ios', 'android', 'web') NOT NULL,
  -- Client-toggled preference flags. Backend still respects these before
  -- enqueueing a push — server-side check because a legacy client might
  -- not send the current flag set.
  pref_friend_requests   TINYINT(1) NOT NULL DEFAULT 1,
  pref_marker_replies    TINYINT(1) NOT NULL DEFAULT 1,
  pref_memory_hits       TINYINT(1) NOT NULL DEFAULT 1,
  pref_announcements     TINYINT(1) NOT NULL DEFAULT 1,
  registered_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_token (user_id, token),
  INDEX idx_user (user_id),
  INDEX idx_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Notification log (audit + dedupe) ───────────────────────────────────────
-- Records every push we tried to send. Fields:
--   kind: 'friend_request' | 'marker_reply' | 'memory_hit' | 'announcement'
--   status: 'queued' | 'sent' | 'failed' | 'dropped_by_pref'
--   dedupe_key: (kind + related_id + recipient_user_id) so a burst of
--     duplicate triggers only fires once per e.g. friend request.
-- Cron purges rows older than 30 days.
CREATE TABLE IF NOT EXISTS notification_log (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  kind          VARCHAR(40)     NOT NULL,
  related_id    BIGINT UNSIGNED NULL,
  title         VARCHAR(120)    NOT NULL,
  body          VARCHAR(400)    NULL,
  status        VARCHAR(24)     NOT NULL DEFAULT 'queued',
  error_msg     VARCHAR(200)    NULL,
  dedupe_key    VARCHAR(120)    NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at       TIMESTAMP       NULL,
  UNIQUE KEY uniq_dedupe (recipient_user_id, dedupe_key),
  INDEX idx_recipient (recipient_user_id, created_at),
  INDEX idx_kind (kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
