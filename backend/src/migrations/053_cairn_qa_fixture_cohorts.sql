-- O88: strictly isolated, expiring field-test fixture authority.
-- Fixtures are ordinary marker/revision/publication rows so reader location,
-- discovery, acquisition, versioning and notification rules stay real. These
-- tables only scope those rows to an explicit cohort and cleanup batch.

CREATE TABLE cairn_qa_fixture_batches (
  batch_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  target_environment VARCHAR(24) NOT NULL,
  manifest_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state ENUM('active','expired','cleaned') NOT NULL DEFAULT 'active',
  expires_at DATETIME(3) NOT NULL,
  approval_reference VARCHAR(160) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_cairn_qa_batch_expiry (state, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cairn_qa_fixture_readers (
  batch_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  viewer_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (batch_id, viewer_id),
  CONSTRAINT fk_cairn_qa_reader_batch
    FOREIGN KEY (batch_id) REFERENCES cairn_qa_fixture_batches(batch_id) ON DELETE CASCADE,
  CONSTRAINT fk_cairn_qa_reader_user
    FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cairn_qa_fixtures (
  fixture_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  batch_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  marker_id BIGINT UNSIGNED NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  audience ENUM('friends','public') NOT NULL,
  area_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scenario VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coordinate_system ENUM('WGS84') NOT NULL DEFAULT 'WGS84',
  safety_state ENUM('map_candidate_unverified','field_verified') NOT NULL,
  current_fixture_revision SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cleaned_at DATETIME(3) NULL,
  UNIQUE KEY uk_cairn_qa_fixture_marker (marker_id),
  INDEX idx_cairn_qa_fixture_batch (batch_id, audience, area_code),
  CONSTRAINT fk_cairn_qa_fixture_batch
    FOREIGN KEY (batch_id) REFERENCES cairn_qa_fixture_batches(batch_id) ON DELETE CASCADE,
  CONSTRAINT fk_cairn_qa_fixture_marker
    FOREIGN KEY (marker_id) REFERENCES markers(id) ON DELETE SET NULL,
  CONSTRAINT fk_cairn_qa_fixture_author
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
