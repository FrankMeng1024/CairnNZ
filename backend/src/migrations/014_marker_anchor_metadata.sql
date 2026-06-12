-- 014_marker_anchor_metadata.sql
-- v0.2.4 Branch A/B: AR anchor 防漂 + 三条件实化 + Snap-on-reopen
--
-- New columns on markers table:
--   plant_anchor_y         FLOAT   — ARKit world Y when planted (used for snap fallback)
--   plant_surface_tier     TEXT    — Floor / LargePlane / SmallPlane / Mesh / Estimated
--   plant_lidar_available  BOOLEAN — informational; tells re-find which device class planted
--   plant_classification   TEXT    — PlaneClassifications flags string (informational)
--   plant_session_ground_y FLOAT NULL — best-known floor Y at plant moment (sanity check)
--   is_estimated_ground    BOOLEAN — true if force-fallback spawned (悬空/估身高)
--                                    next session should re-anchor when possible
--   plant_arworldmap_blob_url TEXT NULL — future v0.2.5: OSS blob URL for ARWorldMap data
--                                          (column added now to avoid future migration)
--
-- Reviewer notes:
--   - Reviewer A R-A8: defer ARWorldMap to v0.2.5 but reserve schema column now.
--   - Reviewer A R-A4: is_estimated_ground flag triggers Snap-on-reopen rebake.
--   - Reviewer C: backend telemetry events route reuses existing debug_snapshots table.

ALTER TABLE markers ADD COLUMN IF NOT EXISTS plant_anchor_y FLOAT NULL;
ALTER TABLE markers ADD COLUMN IF NOT EXISTS plant_surface_tier TEXT NULL;
ALTER TABLE markers ADD COLUMN IF NOT EXISTS plant_lidar_available BOOLEAN DEFAULT FALSE;
ALTER TABLE markers ADD COLUMN IF NOT EXISTS plant_classification TEXT NULL;
ALTER TABLE markers ADD COLUMN IF NOT EXISTS plant_session_ground_y FLOAT NULL;
ALTER TABLE markers ADD COLUMN IF NOT EXISTS is_estimated_ground BOOLEAN DEFAULT FALSE;
ALTER TABLE markers ADD COLUMN IF NOT EXISTS plant_arworldmap_blob_url TEXT NULL;

-- Index for finding markers that need re-anchoring on next session
CREATE INDEX IF NOT EXISTS idx_markers_estimated_ground
  ON markers (is_estimated_ground) WHERE is_estimated_ground = TRUE;

-- v0.2.4 telemetry event types (just documentation; events stored in debug_snapshots)
-- Event names follow v22-* prefix convention:
--   v22-ACQUIRE-START          state FAR/APPROACH → ACQUIRE
--   v22-ACQUIRE-GUIDE          guidance level changed (T0/T3/T5/T10/T15)
--   v22-ACQUIRE-CEREMONY       three conditions met, ceremony starts
--   v22-ACQUIRE-FORCE-FALLBACK 15s force fallback triggered
--   v22-CAIRN-IMMORTAL         IMMORTAL state confirmed (post-ceremony)
--   v22-FALLBACK-SNAP-OK       silent re-anchor after force-fallback succeeded
--   v22-RESUME-RELOCALIZE      app resume from background, ARSession reset
--   v22-RETRY-OK               PendingAnchorRetry succeeded within 1s
--   v22-RETRY-DEADLINE         PendingAnchorRetry deadline reached → estimated_ground
--   v22-anchor-truth-respected GroundYResolver short-circuited for anchor-parented cairn

COMMENT ON COLUMN markers.plant_anchor_y IS 'ARKit world Y when planted; used for cross-session sanity / snap fallback';
COMMENT ON COLUMN markers.plant_surface_tier IS 'Floor/LargePlane/SmallPlane/Mesh/Estimated; controls reopen snap aggressiveness';
COMMENT ON COLUMN markers.is_estimated_ground IS 'TRUE if force-fallback spawned; next session must re-anchor';
COMMENT ON COLUMN markers.plant_arworldmap_blob_url IS 'v0.2.5+: OSS blob URL for ARWorldMap (same-device cold start); NULL until native bridge ships';
