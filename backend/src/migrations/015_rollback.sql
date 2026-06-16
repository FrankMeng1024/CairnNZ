-- 015_rollback.sql
-- 还原 markers 表到 014 状态(去掉 v025 字段)

ALTER TABLE markers
    DROP INDEX idx_markers_space,
    DROP INDEX idx_markers_anchor_kind,
    DROP COLUMN anchor_kind,
    DROP COLUMN has_worldmap,
    DROP COLUMN space_id;
