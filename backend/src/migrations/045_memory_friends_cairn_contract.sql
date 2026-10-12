-- Memory/Friends/Cairn product-contract closure.
--
-- This migration is additive/corrective and is prepared for review only. It
-- must be rehearsed in an isolated schema before any production migration.

-- A server receipt frontier is required for the per-contribution visibility
-- delay. Existing rows intentionally become eligible no sooner than 30 minutes
-- after this migration is applied; that conservative backfill cannot expose
-- history early.
ALTER TABLE memory_points
  ADD COLUMN received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    AFTER continuity_state,
  ADD INDEX idx_memory_friend_delay
    (user_id, evidence_source, continuity_state, received_at, ts),
  ALGORITHM=INPLACE, LOCK=NONE;

-- Existing rows retain their exact legacy scope. Only an explicit per-friend
-- grant may opt into full accepted Memory history with delayed publication.
ALTER TABLE memory_share_grants
  ADD COLUMN coverage_scope
    ENUM('legacy_activity_since_grant','full_history_delayed_v1')
    NOT NULL DEFAULT 'legacy_activity_since_grant' AFTER effective_at,
  ADD COLUMN consent_version SMALLINT UNSIGNED NOT NULL DEFAULT 0
    AFTER coverage_scope,
  ALGORITHM=INPLACE, LOCK=NONE;

-- A pending request may carry each side's explicit intent, but neither value
-- is authority until the friendship acceptance transaction commits. Existing
-- requests remain opt-out and no future friend is implicitly included.
ALTER TABLE friend_requests
  ADD COLUMN requester_memory_share TINYINT(1) NOT NULL DEFAULT 0
    AFTER status,
  ADD COLUMN accepter_memory_share TINYINT(1) NOT NULL DEFAULT 0
    AFTER requester_memory_share,
  ALGORITHM=INPLACE, LOCK=NONE;

-- A separate initialization marker distinguishes "not initialized yet" from
-- a deliberate empty selection. The old subscription rows remain the actual
-- selection set for backwards-compatible clients.
CREATE TABLE memory_projection_preferences (
  viewer_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  initialized_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_memory_projection_preference_viewer
    FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The accepted contract is not a paid five-person selector. Preserve the
-- friend-pair invariant while removing only the obsolete capacity branch.
DROP TRIGGER IF EXISTS trg_memory_subscription_cap;

DELIMITER //
CREATE TRIGGER trg_memory_subscription_friend
BEFORE INSERT ON memory_subscriptions
FOR EACH ROW
BEGIN
  DECLARE friend_exists INT;
  SELECT COUNT(*) INTO friend_exists
    FROM friends
    WHERE user_id = NEW.user_id AND friend_id = NEW.friend_id;
  IF friend_exists = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'memory_subscription requires existing friend pair';
  END IF;
END;
//
DELIMITER ;

-- Immutable content snapshots are independent from mutable marker rows and
-- audience epochs. Coordinates are retained because the entitlement was
-- earned at that place; they are never updated in-place.
CREATE TABLE cairn_revisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  marker_id BIGINT UNSIGNED NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  content_revision BIGINT UNSIGNED NOT NULL,
  content_type VARCHAR(32) NOT NULL,
  content_text TEXT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  approximate TINYINT(1) NOT NULL DEFAULT 0,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_audience ENUM('personal','friends','public') NOT NULL,
  audience_epoch BIGINT UNSIGNED NOT NULL,
  publication_id BIGINT UNSIGNED NULL,
  publication_epoch BIGINT UNSIGNED NULL,
  identity_policy ENUM('friends_acquired','public_current') NOT NULL,
  friend_author_name_snapshot VARCHAR(120) NULL,
  availability ENUM('available','under_review','unavailable','removed')
    NOT NULL DEFAULT 'available',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_cairn_revision_source
    (marker_id, content_revision, source_audience, audience_epoch),
  INDEX idx_cairn_revision_owner (owner_id, marker_id, content_revision),
  INDEX idx_cairn_revision_publication (publication_id, publication_epoch),
  CONSTRAINT fk_cairn_revision_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_cairn_revision_lat CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT chk_cairn_revision_lng CHECK (lng BETWEEN -180 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cairn_collections (
  viewer_id BIGINT UNSIGNED NOT NULL,
  marker_id BIGINT UNSIGNED NOT NULL,
  relationship ENUM('left','found') NOT NULL,
  archived_at DATETIME(3) NULL,
  removed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (viewer_id, marker_id),
  INDEX idx_cairn_collection_view (viewer_id, relationship, archived_at, created_at),
  CONSTRAINT fk_cairn_collection_viewer
    FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cairn_acquisitions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  viewer_id BIGINT UNSIGNED NOT NULL,
  marker_id BIGINT UNSIGNED NOT NULL,
  cairn_revision_id BIGINT UNSIGNED NOT NULL,
  content_revision BIGINT UNSIGNED NOT NULL,
  acquired_via ENUM('friends','public') NOT NULL,
  evidence_kind ENUM('presence_witness','legacy_coverage') NOT NULL,
  evidence_id BIGINT UNSIGNED NOT NULL,
  evidence_observed_at DATETIME(3) NOT NULL,
  acquired_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  opened_at DATETIME(3) NULL,
  thanked_at DATETIME(3) NULL,
  removed_at DATETIME(3) NULL,
  UNIQUE KEY uk_cairn_acquisition_revision (viewer_id, cairn_revision_id),
  UNIQUE KEY uk_cairn_acquisition_logical_revision
    (viewer_id, marker_id, content_revision),
  INDEX idx_cairn_acquisition_collection (viewer_id, marker_id, acquired_at),
  CONSTRAINT fk_cairn_acquisition_viewer
    FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cairn_acquisition_revision
    FOREIGN KEY (cairn_revision_id) REFERENCES cairn_revisions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A visit survives process restarts and repeated API calls. Its anchor is the
-- first accepted observation for that locality, not a client-selected map
-- coordinate. Departure/re-entry decisions are made by the server.
CREATE TABLE cairn_local_visits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  viewer_id BIGINT UNSIGNED NOT NULL,
  visit_token CHAR(36) NOT NULL,
  anchor_lat DOUBLE NOT NULL,
  anchor_lng DOUBLE NOT NULL,
  entered_at DATETIME(3) NOT NULL,
  last_inside_at DATETIME(3) NOT NULL,
  departed_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_cairn_local_visit_token (visit_token),
  INDEX idx_cairn_local_visit_viewer (viewer_id, entered_at, id),
  CONSTRAINT fk_cairn_local_visit_viewer
    FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_cairn_local_visit_lat CHECK (anchor_lat BETWEEN -90 AND 90),
  CONSTRAINT chk_cairn_local_visit_lng CHECK (anchor_lng BETWEEN -180 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cairn_local_visit_acquisitions (
  visit_id BIGINT UNSIGNED NOT NULL,
  acquisition_id BIGINT UNSIGNED NOT NULL,
  marker_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (visit_id, acquisition_id),
  UNIQUE KEY uk_cairn_visit_acquisition (acquisition_id),
  UNIQUE KEY uk_cairn_visit_marker (visit_id, marker_id),
  CONSTRAINT fk_cairn_visit_acquisition_visit
    FOREIGN KEY (visit_id) REFERENCES cairn_local_visits(id) ON DELETE CASCADE,
  CONSTRAINT fk_cairn_visit_acquisition_acquisition
    FOREIGN KEY (acquisition_id) REFERENCES cairn_acquisitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Presentation grouping is intentionally independent of discovery and read
-- state. No animation, sound, push, or native haptic is performed here.
CREATE TABLE cairn_presentation_groups (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  viewer_id BIGINT UNSIGNED NOT NULL,
  group_token CHAR(36) NOT NULL,
  merge_started_at DATETIME(3) NOT NULL,
  merge_until DATETIME(3) NOT NULL,
  haptic_eligible TINYINT(1) NOT NULL DEFAULT 0,
  sound_eligible TINYINT(1) NOT NULL DEFAULT 0,
  announced_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_cairn_presentation_group_token (group_token),
  INDEX idx_cairn_presentation_pending (viewer_id, announced_at, merge_until),
  CONSTRAINT fk_cairn_presentation_viewer
    FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- This table is the durable, deduplicated signal consumed by a future Home
-- surface. No Home UI is introduced in this task.
CREATE TABLE cairn_acquisition_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  viewer_id BIGINT UNSIGNED NOT NULL,
  acquisition_id BIGINT UNSIGNED NOT NULL,
  presentation_group_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('revision_acquired') NOT NULL DEFAULT 'revision_acquired',
  announced_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_cairn_acquisition_event (viewer_id, acquisition_id, event_type),
  INDEX idx_cairn_acquisition_unannounced (viewer_id, announced_at, created_at),
  CONSTRAINT fk_cairn_event_viewer
    FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cairn_event_acquisition
    FOREIGN KEY (acquisition_id) REFERENCES cairn_acquisitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_cairn_event_presentation_group
    FOREIGN KEY (presentation_group_id) REFERENCES cairn_presentation_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Freezing a source prevents a new revision from bypassing review. The row is
-- intentionally distinct from publication moderation, which remains the
-- public-pilot authority.
CREATE TABLE cairn_source_moderation (
  marker_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL,
  state ENUM('available','under_review','unavailable','removed')
    NOT NULL DEFAULT 'available',
  reason VARCHAR(240) NULL,
  changed_by BIGINT UNSIGNED NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_cairn_source_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cairn_source_operator
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cairn_review_cases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_submission_id CHAR(36) NOT NULL,
  case_type ENUM('report','appeal') NOT NULL,
  submitted_by BIGINT UNSIGNED NOT NULL,
  marker_id BIGINT UNSIGNED NOT NULL,
  cairn_revision_id BIGINT UNSIGNED NULL,
  category ENUM('spam','unsafe','harassment','privacy','other') NOT NULL,
  detail VARCHAR(500) NULL,
  state ENUM('pending','reviewed','dismissed','actioned')
    NOT NULL DEFAULT 'pending',
  disposed_at DATETIME(3) NULL,
  disposed_by BIGINT UNSIGNED NULL,
  disposition_note VARCHAR(240) NULL,
  decision_scope ENUM('revision','source') NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_cairn_case_client (submitted_by, client_submission_id),
  UNIQUE KEY uk_cairn_case_revision_type
    (submitted_by, cairn_revision_id, case_type),
  INDEX idx_cairn_case_queue (state, case_type, created_at, id),
  CONSTRAINT fk_cairn_case_submitter
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cairn_case_revision
    FOREIGN KEY (cairn_revision_id) REFERENCES cairn_revisions(id) ON DELETE SET NULL,
  CONSTRAINT fk_cairn_case_operator
    FOREIGN KEY (disposed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Metadata-only audit survives deletion of a Cairn/revision/case subject.
CREATE TABLE cairn_review_audit (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(48) NOT NULL,
  marker_id BIGINT UNSIGNED NULL,
  cairn_revision_id BIGINT UNSIGNED NULL,
  case_id BIGINT UNSIGNED NULL,
  from_state VARCHAR(32) NULL,
  to_state VARCHAR(32) NULL,
  decision_scope ENUM('revision','source') NULL,
  reason VARCHAR(240) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_cairn_review_audit_created (created_at, id),
  INDEX idx_cairn_review_audit_marker (marker_id, id),
  CONSTRAINT fk_cairn_review_audit_actor
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
