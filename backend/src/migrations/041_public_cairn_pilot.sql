-- Controlled text-only Public Cairn pilot.
-- Public availability remains runtime-disabled unless PUBLIC_CAIRN_PILOT_ENABLED=1.
-- Approval binds an exact content_revision and publication_epoch.

ALTER TABLE users
  ADD COLUMN public_cairn_operator TINYINT(1) NOT NULL DEFAULT 0
    AFTER onboarding_done_at,
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE markers
  ADD COLUMN public_intent TINYINT(1) NOT NULL DEFAULT 0 AFTER content_revision,
  ADD COLUMN public_state
    ENUM('not_public','pending','published','rejected','suspended','withdrawn')
    NOT NULL DEFAULT 'not_public' AFTER public_intent,
  ADD COLUMN publication_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER public_state,
  ADD COLUMN public_state_changed_at DATETIME(3) NULL AFTER publication_epoch,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE TABLE public_cairn_publications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  marker_id BIGINT UNSIGNED NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  publication_epoch BIGINT UNSIGNED NOT NULL,
  content_revision BIGINT UNSIGNED NOT NULL,
  state ENUM('pending','published','rejected','suspended','withdrawn') NOT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at DATETIME(3) NULL,
  decided_by BIGINT UNSIGNED NULL,
  decision_reason VARCHAR(240) NULL,
  published_at DATETIME(3) NULL,
  withdrawn_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_publication_marker_epoch (marker_id, publication_epoch),
  INDEX idx_publication_queue (state, submitted_at, id),
  INDEX idx_publication_owner (owner_id, marker_id, publication_epoch),
  CONSTRAINT fk_publication_marker FOREIGN KEY(marker_id) REFERENCES markers(id) ON DELETE CASCADE,
  CONSTRAINT fk_publication_owner FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_publication_operator FOREIGN KEY(decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE public_cairn_encounters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  viewer_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  marker_id BIGINT UNSIGNED NOT NULL,
  publication_id BIGINT UNSIGNED NOT NULL,
  publication_epoch BIGINT UNSIGNED NOT NULL,
  content_revision BIGINT UNSIGNED NOT NULL,
  evidence_witness_id BIGINT UNSIGNED NULL,
  source_activity_client_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  observed_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  presented_at DATETIME(3) NULL,
  opened_at DATETIME(3) NULL,
  hidden_at DATETIME(3) NULL,
  UNIQUE KEY uk_public_encounter (viewer_id, marker_id, publication_epoch),
  INDEX idx_public_scene (viewer_id, hidden_at, presented_at, created_at),
  INDEX idx_public_author (author_id, marker_id),
  CONSTRAINT fk_public_encounter_viewer FOREIGN KEY(viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_encounter_author FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_encounter_marker FOREIGN KEY(marker_id) REFERENCES markers(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_encounter_publication FOREIGN KEY(publication_id) REFERENCES public_cairn_publications(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_encounter_witness FOREIGN KEY(evidence_witness_id) REFERENCES memory_presence_witnesses(id) ON DELETE SET NULL,
  CONSTRAINT chk_public_encounter_not_self CHECK (viewer_id <> author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE public_cairn_thanks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  viewer_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  marker_id BIGINT UNSIGNED NOT NULL,
  publication_epoch BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_public_thanks (viewer_id, marker_id),
  INDEX idx_public_thanks_author (author_id, created_at),
  CONSTRAINT fk_public_thanks_viewer FOREIGN KEY(viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_thanks_author FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_thanks_marker FOREIGN KEY(marker_id) REFERENCES markers(id) ON DELETE CASCADE,
  CONSTRAINT chk_public_thanks_not_self CHECK (viewer_id <> author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE public_cairn_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_submission_id CHAR(36) NOT NULL,
  viewer_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  marker_id BIGINT UNSIGNED NOT NULL,
  publication_id BIGINT UNSIGNED NOT NULL,
  publication_epoch BIGINT UNSIGNED NOT NULL,
  category ENUM('spam','unsafe','harassment','other') NOT NULL,
  detail VARCHAR(500) NULL,
  state ENUM('pending','reviewed','dismissed','actioned') NOT NULL DEFAULT 'pending',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  disposed_at DATETIME(3) NULL,
  disposed_by BIGINT UNSIGNED NULL,
  disposition_note VARCHAR(240) NULL,
  UNIQUE KEY uk_public_report_client (viewer_id, client_submission_id),
  UNIQUE KEY uk_public_report_resource (viewer_id, marker_id, publication_epoch),
  INDEX idx_public_report_queue (state, created_at, id),
  CONSTRAINT fk_public_report_viewer FOREIGN KEY(viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_report_author FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_report_marker FOREIGN KEY(marker_id) REFERENCES markers(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_report_publication FOREIGN KEY(publication_id) REFERENCES public_cairn_publications(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_report_operator FOREIGN KEY(disposed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_public_report_not_self CHECK (viewer_id <> author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
