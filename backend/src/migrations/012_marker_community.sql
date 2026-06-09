-- Migration 012: marker community votes (likes + reports) + abuse signals.
--
-- Per algorithm-思想-v6.md §一-4 (canon):
--   "一人一 mark 只能赞或举报一种 — 互斥, 永久 1 票 (不能改、不能撤)"
--
-- Single canon-correct votes table (NOT separate marker_likes + marker_reports):
--   - UNIQUE(user_id, marker_id) enforces the mutex (one user one mark one vote)
--   - type ENUM('like','report') enforces only those two states
--   - No UPDATE allowed (永久) → application-level rule, no trigger
--   - No DELETE endpoint exposed (cannot 撤 a vote)
--
-- Abuse signals are append-only telemetry for v2 fraud detection.
--
-- Counters denormalized on markers for cheap read; kept in sync via
-- INSERT IGNORE marker_votes + UPDATE markers atomic pattern in routes.
--
-- Run: docker exec ainews-db mysql -uroot -p"$DB_PASSWORD" cairn < 012_marker_community.sql

-- ── Markers table additions ───────────────────────────────────────────
ALTER TABLE markers
  ADD COLUMN helpful_count INT UNSIGNED DEFAULT 0,
  ADD COLUMN report_count  INT UNSIGNED DEFAULT 0,
  ADD COLUMN status        VARCHAR(16)  DEFAULT 'healthy', -- healthy | suspicious | hidden
  ADD COLUMN hidden_at     DATETIME     NULL;

-- ── Single canon-correct votes table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS marker_votes (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  marker_id     INT NOT NULL,
  type          ENUM('like','report') NOT NULL,
  reason        VARCHAR(32) NULL,                   -- only for type='report': fake_ad|info_mismatch|dislike
  reporter_lat  DOUBLE NULL,
  reporter_lng  DOUBLE NULL,
  distance_m    DOUBLE NULL,                         -- haversine at write time, for fraud audit
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (marker_id) REFERENCES markers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  UNIQUE KEY uniq_user_marker (user_id, marker_id),  -- the mutex
  INDEX idx_marker (marker_id),
  INDEX idx_user_created (user_id, created_at)       -- supports impossible-travel check
);

-- ── Abuse signals (append-only telemetry) ─────────────────────────────
-- Captures every server-side rejection for v2 model training.
-- kind: gps_too_far | gps_low_accuracy | impossible_travel | replay_nonce_invalid
--     | mocked_location | rate_limit | clock_skew | unauthorized
CREATE TABLE IF NOT EXISTS abuse_signals (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NULL,                              -- nullable for unauthenticated attempts
  marker_id   INT NULL,
  kind        VARCHAR(32) NOT NULL,
  payload     JSON NULL,
  ip_address  VARCHAR(45) NULL,                      -- IPv4 or IPv6
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_kind_created (kind, created_at),
  INDEX idx_user_created (user_id, created_at)
);
