ALTER TABLE markers
  DROP CONSTRAINT chk_marker_placement_tuple,
  DROP CONSTRAINT chk_marker_placement_samples,
  DROP CONSTRAINT chk_marker_placement_accuracy,
  DROP COLUMN placement_sample_count,
  DROP COLUMN placement_source,
  DROP COLUMN placement_observed_at,
  DROP COLUMN placement_accuracy_m;
