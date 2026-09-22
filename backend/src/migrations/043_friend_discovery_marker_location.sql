-- Restore the marker spatial prefilter required by bounded friend discovery.
-- Migration 003 declared this index, but the retained current-schema lineage
-- omitted it. The migration-043 verifier makes an already-correct index a
-- verified no-op before this DDL is attempted.

ALTER TABLE markers
  ADD INDEX idx_markers_location (lat, lng),
  ALGORITHM=INPLACE, LOCK=NONE;
