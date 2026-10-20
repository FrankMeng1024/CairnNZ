-- O88: preserve the capture-time quality and source of every newly planted
-- Cairn. Null remains valid for legacy clients and existing rows; new O88
-- clients submit the four fields as one atomic tuple.

ALTER TABLE markers
  ADD COLUMN placement_accuracy_m DECIMAL(7,2) NULL AFTER approximate,
  ADD COLUMN placement_observed_at DATETIME(3) NULL AFTER placement_accuracy_m,
  ADD COLUMN placement_source ENUM(
    'gps_window','watcher_recent','last_known','activity'
  ) NULL AFTER placement_observed_at,
  ADD COLUMN placement_sample_count SMALLINT UNSIGNED NULL AFTER placement_source,
  ADD CONSTRAINT chk_marker_placement_accuracy
    CHECK (placement_accuracy_m IS NULL OR placement_accuracy_m BETWEEN 0 AND 100),
  ADD CONSTRAINT chk_marker_placement_samples
    CHECK (placement_sample_count IS NULL OR placement_sample_count BETWEEN 1 AND 100),
  ADD CONSTRAINT chk_marker_placement_tuple
    CHECK (
      (placement_accuracy_m IS NULL
       AND placement_observed_at IS NULL
       AND placement_source IS NULL
       AND placement_sample_count IS NULL)
      OR
      (placement_accuracy_m IS NOT NULL
       AND placement_observed_at IS NOT NULL
       AND placement_source IS NOT NULL
       AND placement_sample_count IS NOT NULL)
    );
