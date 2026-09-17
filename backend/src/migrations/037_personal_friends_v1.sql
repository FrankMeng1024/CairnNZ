-- Personal Journal + Friends Collaboration v1.
-- Additive/corrective only. The migration uses the runner-selected database
-- so disposable rehearsal schemas cannot escape into `cairn`.

ALTER TABLE memory_points
  ADD COLUMN evidence_source ENUM('historical_unknown','activity_real','passive_real')
    NOT NULL DEFAULT 'historical_unknown' AFTER client_id,
  ADD COLUMN source_activity_client_id CHAR(36) NULL AFTER evidence_source,
  ADD COLUMN horizontal_accuracy_m DECIMAL(7,2) NULL AFTER source_activity_client_id,
  ADD COLUMN continuity_state ENUM('accepted','gap','unknown')
    NOT NULL DEFAULT 'unknown' AFTER horizontal_accuracy_m,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE INDEX idx_memory_share_evidence
  ON memory_points(user_id, evidence_source, source_activity_client_id, ts);

ALTER TABLE markers
  ADD COLUMN audience_epoch BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER permission,
  ADD COLUMN audience_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER audience_epoch,
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE routes
  ADD COLUMN audience_epoch BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER permission,
  ADD COLUMN audience_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER audience_epoch,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE TABLE friendship_episodes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  episode_id CHAR(36) NOT NULL,
  user_low_id BIGINT UNSIGNED NOT NULL,
  user_high_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  ended_reason ENUM('unfriended','blocked','account_deleted') NULL,
  active_pair_key VARCHAR(64)
    GENERATED ALWAYS AS (
      CASE WHEN ended_at IS NULL THEN CONCAT(user_low_id, ':', user_high_id) ELSE NULL END
    ) STORED,
  UNIQUE KEY uk_friendship_episode_id (episode_id),
  UNIQUE KEY uk_friendship_active_pair (active_pair_key),
  INDEX idx_friendship_episode_users (user_low_id, user_high_id, started_at),
  CONSTRAINT fk_friendship_episode_low FOREIGN KEY (user_low_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friendship_episode_high FOREIGN KEY (user_high_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_friendship_episode_order CHECK (user_low_id < user_high_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO friendship_episodes
  (episode_id, user_low_id, user_high_id, started_at)
SELECT UUID(), f.user_id, f.friend_id,
       LEAST(f.created_at, reverse_friend.created_at)
FROM friends f
JOIN friends reverse_friend
  ON reverse_friend.user_id = f.friend_id
 AND reverse_friend.friend_id = f.user_id
WHERE f.user_id < f.friend_id;

CREATE TABLE memory_share_policies (
  owner_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  policy_epoch BIGINT UNSIGNED NOT NULL DEFAULT 1,
  enabled_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_memory_policy_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE memory_share_grants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL,
  viewer_id BIGINT UNSIGNED NOT NULL,
  friendship_episode_id BIGINT UNSIGNED NOT NULL,
  grant_epoch CHAR(36) NOT NULL,
  effective_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  revoked_reason ENUM('policy_disabled','unfriended','blocked','account_deleted','corrective') NULL,
  status ENUM('active','revoked') NOT NULL DEFAULT 'active',
  authorization_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  active_slot TINYINT
    GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN 1 ELSE NULL END) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_memory_grant_epoch (grant_epoch),
  UNIQUE KEY uk_memory_grant_active (owner_id, viewer_id, active_slot),
  INDEX idx_memory_grant_viewer (viewer_id, status, owner_id),
  CONSTRAINT fk_memory_grant_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_memory_grant_viewer FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_memory_grant_episode FOREIGN KEY (friendship_episode_id) REFERENCES friendship_episodes(id) ON DELETE CASCADE,
  CONSTRAINT chk_memory_grant_distinct CHECK (owner_id <> viewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE memory_private_places (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(80) NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  radius_m SMALLINT UNSIGNED NOT NULL DEFAULT 250,
  active TINYINT(1) NOT NULL DEFAULT 1,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_private_places_owner (owner_id, active),
  CONSTRAINT fk_private_places_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_private_place_radius CHECK (radius_m >= 250),
  CONSTRAINT chk_private_place_lat CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT chk_private_place_lng CHECK (lng BETWEEN -180 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE marker_audience_epochs (
  marker_id BIGINT UNSIGNED NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  audience_epoch BIGINT UNSIGNED NOT NULL,
  visibility ENUM('personal','group') NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NULL,
  PRIMARY KEY (marker_id, audience_epoch),
  INDEX idx_marker_audience_owner (owner_id, starts_at, ends_at),
  CONSTRAINT fk_marker_audience_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO marker_audience_epochs
  (marker_id, owner_id, audience_epoch, visibility, starts_at)
SELECT id, user_id, audience_epoch,
       CASE WHEN permission = 'group' THEN 'group' ELSE 'personal' END,
       audience_changed_at
FROM markers;

CREATE TABLE route_audience_epochs (
  route_id BIGINT UNSIGNED NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  audience_epoch BIGINT UNSIGNED NOT NULL,
  visibility ENUM('personal','friend') NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NULL,
  PRIMARY KEY (route_id, audience_epoch),
  INDEX idx_route_audience_owner (owner_id, starts_at, ends_at),
  CONSTRAINT fk_route_audience_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO route_audience_epochs
  (route_id, owner_id, audience_epoch, visibility, starts_at)
SELECT id, user_id, audience_epoch,
       CASE WHEN permission = 'friend' THEN 'friend' ELSE 'personal' END,
       audience_changed_at
FROM routes;

CREATE TABLE friend_cairn_encounters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  viewer_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  marker_id BIGINT UNSIGNED NOT NULL,
  friendship_episode_id BIGINT UNSIGNED NOT NULL,
  audience_epoch BIGINT UNSIGNED NOT NULL,
  evidence_point_id BIGINT UNSIGNED NOT NULL,
  evidence_source ENUM('activity_real','passive_real') NOT NULL,
  observed_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  opened_at DATETIME(3) NULL,
  hidden_at DATETIME(3) NULL,
  UNIQUE KEY uk_friend_cairn_encounter (viewer_id, marker_id, friendship_episode_id, audience_epoch),
  INDEX idx_encounter_viewer (viewer_id, hidden_at, created_at),
  INDEX idx_encounter_author (author_id, marker_id),
  CONSTRAINT fk_encounter_viewer FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_encounter_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_encounter_episode FOREIGN KEY (friendship_episode_id) REFERENCES friendship_episodes(id) ON DELETE CASCADE,
  CONSTRAINT chk_encounter_distinct CHECK (viewer_id <> author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE shared_route_leases (
  id CHAR(36) NOT NULL PRIMARY KEY,
  viewer_id BIGINT UNSIGNED NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  route_id BIGINT UNSIGNED NOT NULL,
  audience_epoch BIGINT UNSIGNED NOT NULL,
  authorization_version BIGINT UNSIGNED NOT NULL,
  content_version CHAR(64) NOT NULL,
  geometry_snapshot JSON NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  active_activity_client_id CHAR(36) NULL,
  use_started_at DATETIME(3) NULL,
  use_ended_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  INDEX idx_route_lease_viewer (viewer_id, route_id, expires_at),
  INDEX idx_route_lease_activity (viewer_id, active_activity_client_id),
  CONSTRAINT fk_route_lease_viewer FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_route_lease_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_route_lease_distinct CHECK (viewer_id <> owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
