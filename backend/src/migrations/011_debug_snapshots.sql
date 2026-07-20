-- Migration 011: Debug snapshots for UI rendering verification
-- Purpose: receive PNG screenshots from app's debug 🐛 button so we can
--   visually verify what user actually sees on screen.
-- Design: store raw PNG as LONGBLOB (typically 2-6MB per shot). Separate
--   table from telemetry to keep queries simple and avoid bloating the
--   telemetry_sessions LONGTEXT column.

CREATE TABLE IF NOT EXISTS debug_snapshots (
  id INT PRIMARY KEY AUTO_INCREMENT,
  snapshot_id VARCHAR(64) UNIQUE NOT NULL,

  -- Image data
  image_blob LONGBLOB NOT NULL,
  image_bytes INT NOT NULL,
  image_format VARCHAR(8) DEFAULT 'png',

  -- Diagnostic metadata (free-form JSON: marker count, tracking state, etc.)
  meta JSON,

  -- Device info (snapshot)
  device_os VARCHAR(16),
  app_version VARCHAR(16),

  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  uploaded_ip VARCHAR(45)
);

CREATE INDEX idx_debug_snapshots_uploaded_at ON debug_snapshots(uploaded_at);
