-- 015_v025_clear_test_data.sql
-- v0.2.5 Phase 0 终态:删测试 markers + 加 v025 字段(space_id / has_worldmap / anchor_kind)
-- 用户硬约束:测试数据可全删

-- 1. 清空所有 markers(测试数据)
DELETE FROM markers;
ALTER TABLE markers AUTO_INCREMENT = 1;

-- 2. 加 v025 字段
ALTER TABLE markers
    ADD COLUMN space_id VARCHAR(64) NULL DEFAULT NULL
        COMMENT 'v025 ARWorldMap space identifier (cm 级 anchor 同空间标识)' AFTER alt,
    ADD COLUMN has_worldmap TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'v025 是否上传 worldmap 二进制(Tier-S 启用条件)' AFTER space_id,
    ADD COLUMN anchor_kind VARCHAR(16) NOT NULL DEFAULT 'tier_g'
        COMMENT 'v025 anchor tier: tier_s = ARWorldMap cm, tier_g = GPS+plane meter' AFTER has_worldmap,
    ADD INDEX idx_markers_space (space_id),
    ADD INDEX idx_markers_anchor_kind (anchor_kind);
