-- 016_v025_debug_events_v2.sql
-- v0.2.5 Phase 3.1 — debug_events_v2 telemetry table
--
-- Distinct from existing debug_snapshots / telemetry tables — those carry
-- v0.2.4 envelope. v025 adds (phase, step, seq, sessionInstanceId) Rule H tuple
-- per event so cross-session join + per-phase analysis is cheap.

CREATE TABLE IF NOT EXISTS debug_events_v2 (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED DEFAULT NULL,
    session_instance_id VARCHAR(64) NOT NULL,
    phase VARCHAR(64) NOT NULL,
    step VARCHAR(64) NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    timestamp_unix_ms BIGINT NOT NULL,
    outcome VARCHAR(32) NOT NULL DEFAULT '',
    diagnostic VARCHAR(1024) NOT NULL DEFAULT '',
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_session (session_instance_id),
    KEY idx_session_seq (session_instance_id, seq),
    KEY idx_phase_step (phase, step),
    KEY idx_user_received (user_id, received_at),
    KEY idx_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
