-- Free Activity durable client identity and Cairn provenance.
-- LOCAL/STAGING REVIEW ONLY in the 2026-09-06 implementation task.
-- Do not run against production without the reviewed migration plan.

ALTER TABLE sessions
  ADD COLUMN client_activity_id CHAR(36) NULL AFTER user_id,
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE sessions
  ADD COLUMN abandoned_at DATETIME NULL AFTER finalized_at,
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE sessions
  ADD COLUMN abandon_reason VARCHAR(64) NULL AFTER abandoned_at,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE UNIQUE INDEX uk_sessions_user_client_activity
  ON sessions(user_id, client_activity_id);

-- Preserve every legacy row while retiring only shells that provably contain
-- no Activity evidence and are older than the transitional old-client window.
UPDATE sessions
SET abandoned_at = UTC_TIMESTAMP(),
    abandon_reason = 'legacy_stale_zero_shell'
WHERE client_activity_id IS NULL
  AND finalized_at IS NULL
  AND abandoned_at IS NULL
  AND start_time < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 HOUR)
  AND distance_m = 0 AND duration_s = 0
  AND (route_points IS NULL OR JSON_LENGTH(route_points) = 0)
  AND (route_points_raw IS NULL OR JSON_LENGTH(route_points_raw) = 0);

-- If an older backend produced several recent empty legacy shells, retain the
-- newest as compatibility owner and archive the rest. Any duplicate with real
-- data remains active, so the unique index below fails closed for explicit
-- reconciliation instead of silently hiding meaningful user data.
UPDATE sessions AS target
JOIN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY user_id
             ORDER BY
               CASE
                 WHEN distance_m > 0 OR duration_s > 0
                   OR COALESCE(JSON_LENGTH(route_points), 0) > 0
                   OR COALESCE(JSON_LENGTH(route_points_raw), 0) > 0 THEN 0
                 ELSE 1
               END,
               start_time DESC,
               id DESC
           ) AS active_rank
    FROM sessions
    WHERE finalized_at IS NULL
      AND abandoned_at IS NULL
      AND end_time = start_time
  ) AS ranked
  WHERE active_rank > 1
) AS duplicates ON duplicates.id = target.id
SET target.abandoned_at = UTC_TIMESTAMP(),
    target.abandon_reason = 'legacy_duplicate_zero_shell'
WHERE target.client_activity_id IS NULL
  AND target.distance_m = 0 AND target.duration_s = 0
  AND (target.route_points IS NULL OR JSON_LENGTH(target.route_points) = 0)
  AND (target.route_points_raw IS NULL OR JSON_LENGTH(target.route_points_raw) = 0);

-- NULL for finalized/archived/legacy-completed rows, constant 1 only for the
-- one legitimate unfinished shell. Older clients completed Activities by
-- changing end_time before finalized_at existed, so finalized_at IS NULL alone
-- is not an unfinished definition. MySQL unique-key NULL semantics allow
-- arbitrary history and enforce one unfinished Activity per user even if a
-- future route misses the user lock.
ALTER TABLE sessions
  ADD COLUMN active_slot TINYINT
    GENERATED ALWAYS AS (
      CASE
        WHEN finalized_at IS NULL
          AND abandoned_at IS NULL
          AND end_time = start_time
        THEN 1
        ELSE NULL
      END
    ) STORED;

CREATE UNIQUE INDEX uk_sessions_user_active_slot
  ON sessions(user_id, active_slot);

CREATE TABLE activity_client_tombstones (
  user_id BIGINT UNSIGNED NOT NULL,
  client_activity_id CHAR(36) NOT NULL,
  discarded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_activity_id),
  CONSTRAINT fk_activity_tombstone_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Repair an earlier partial 034 which may have inherited MySQL 8's database
-- default collation before the verifier prevented ledger advancement.
ALTER TABLE activity_client_tombstones
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE marker_client_tombstones (
  user_id BIGINT UNSIGNED NOT NULL,
  client_cairn_id CHAR(36) NOT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_cairn_id),
  CONSTRAINT fk_marker_tombstone_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE marker_client_tombstones
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE markers
  ADD COLUMN client_cairn_id CHAR(36) NULL AFTER user_id,
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE markers
  ADD COLUMN origin_activity_client_id CHAR(36) NULL AFTER client_cairn_id,
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE markers
  ADD COLUMN origin_session_id BIGINT UNSIGNED NULL AFTER origin_activity_client_id,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE UNIQUE INDEX uk_markers_user_client_cairn
  ON markers(user_id, client_cairn_id);

CREATE INDEX idx_markers_origin_activity
  ON markers(user_id, origin_activity_client_id);

ALTER TABLE markers
  ADD CONSTRAINT fk_markers_origin_session
    FOREIGN KEY (origin_session_id) REFERENCES sessions(id) ON DELETE SET NULL;

-- Existing rows deliberately remain NULL. Proximity is not authoritative
-- enough to invent historical provenance or stable client identities.
