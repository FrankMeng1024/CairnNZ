-- Versioned display-only Activity Final geometry.
-- Canonical GPS, distance and Memory remain immutable after the initial Save.

ALTER TABLE sessions
  ADD COLUMN final_geometry_revision INT UNSIGNED NULL AFTER route_points_canonical,
  ADD COLUMN final_geometry_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER final_geometry_revision,
  ADD COLUMN final_geometry_canonical_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER final_geometry_fingerprint,
  ADD COLUMN final_geometry_algorithm VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER final_geometry_canonical_fingerprint,
  ADD COLUMN final_geometry_updated_at DATETIME(3) NULL AFTER final_geometry_algorithm,
  ALGORITHM=INPLACE, LOCK=NONE;
