-- Derived-only O86 read model rollback. Source memory_points and Activities
-- remain untouched and can rebuild these tables on a later forward apply.
DROP TABLE IF EXISTS memory_coverage_regions;
DROP TABLE IF EXISTS memory_coverage_tiles;
DROP TABLE IF EXISTS memory_coverage_source_state;
DROP TABLE IF EXISTS memory_coverage_evidence;
