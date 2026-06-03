-- Migration 006: Telemetry sessions for debug logger uploads
-- Purpose: receive complete session JSON dumps from Cairn app debug mode
-- Design: store raw JSONL as LONGTEXT for now; analyze with Python later.
--         If scale grows, normalize events into separate table.

CREATE TABLE IF NOT EXISTS telemetry_sessions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(64) UNIQUE NOT NULL,

  -- Device metadata
  device_model VARCHAR(64),
  device_os VARCHAR(16),         -- 'ios' or 'android'
  os_version VARCHAR(16),
  app_version VARCHAR(16),
  build_number VARCHAR(16),

  -- Session timing
  started_at BIGINT,             -- ms epoch
  ended_at BIGINT,               -- ms epoch
  duration_ms BIGINT,

  -- Session aggregate
  events_count INT DEFAULT 0,
  raw_size_bytes INT DEFAULT 0,
  activity_mode VARCHAR(16),     -- 'hiking' | 'running' | 'free'

  -- Storage
  raw_jsonl LONGTEXT,            -- complete JSONL content; null if too large

  -- Upload meta
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  upload_source VARCHAR(16) DEFAULT 'auto',  -- 'auto' | 'manual' | 'retry'

  -- Indexes
  INDEX idx_session_id (session_id),
  INDEX idx_uploaded_at (uploaded_at),
  INDEX idx_started_at (started_at),
  INDEX idx_app_version (app_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
