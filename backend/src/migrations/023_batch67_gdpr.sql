-- Migration 023: Batch 6.7 GDPR data exports
-- Adds:
--   - data_exports table (audit trail + download tokens)
-- Safe on existing data — new table only.
USE cairn;

-- ── AUTH-GDPR: data export requests ─────────────────────────────────────────
-- Each row = one export bundle. Fields:
--   status: 'queued' | 'building' | 'ready' | 'sent' | 'expired' | 'failed'
--   download_token: opaque, signed via HMAC + shared secret so an attacker
--     with DB read cannot forge a download URL. Client presents:
--       GET /api/account/export/:token
--     Handler HMAC-verifies + expiry-checks before streaming the file.
--   file_path: absolute path on disk (e.g. /var/cairn/exports/<uuid>.json).
--     Cron sweeps files whose row is 'expired' or past 30 days.
--
-- Users can only have one in-flight export at a time to prevent storage
-- exhaustion (application-layer enforced).
CREATE TABLE IF NOT EXISTS data_exports (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        BIGINT UNSIGNED NOT NULL,
  status         VARCHAR(20)     NOT NULL DEFAULT 'queued',
  file_path      VARCHAR(500)    NULL,
  download_token VARCHAR(64)     NULL,
  size_bytes     BIGINT          NULL,
  requested_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  built_at       TIMESTAMP       NULL,
  sent_at        TIMESTAMP       NULL,
  expires_at     TIMESTAMP       NULL,
  error_msg      VARCHAR(300)    NULL,
  UNIQUE KEY uniq_token (download_token),
  INDEX idx_user_status (user_id, status),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
