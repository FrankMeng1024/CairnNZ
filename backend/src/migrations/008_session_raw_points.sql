-- 008_session_raw_points.sql — store full raw GPS audit track separate from filtered route.
--
-- v77 introduces a dual-track model:
--   route_points       — filtered (passed teleport+accuracy+stationary gates) → renders smoothly
--   route_points_raw   — everything except teleports → debug, audit, future re-processing
--
-- Storage cost: ~50% extra per session (raw includes stationary drift + low-accuracy fixes).
-- Acceptable for current scale; revisit at >10k DAU.

ALTER TABLE sessions ADD COLUMN route_points_raw JSON NULL AFTER route_points;
