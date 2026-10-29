-- Remove the client/OTA using display revisions before this rollback.
ALTER TABLE sessions
  DROP COLUMN final_geometry_updated_at,
  DROP COLUMN final_geometry_algorithm,
  DROP COLUMN final_geometry_canonical_fingerprint,
  DROP COLUMN final_geometry_fingerprint,
  DROP COLUMN final_geometry_revision,
  ALGORITHM=INPLACE, LOCK=NONE;
