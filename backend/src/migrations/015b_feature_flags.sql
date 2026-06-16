-- 015b_feature_flags.sql
-- v0.2.5 Phase 0.15: feature_flags 表 + 默认 useV025=true

CREATE TABLE IF NOT EXISTS feature_flags (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    flag_key VARCHAR(64) NOT NULL,
    flag_value VARCHAR(255) NOT NULL,
    description VARCHAR(512) DEFAULT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_flag_key (flag_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO feature_flags (flag_key, flag_value, description) VALUES
    ('useV025', 'true', 'v0.2.5 AR runtime enabled (RN useArSessionStoreV2 + Unity v025 anchor stack)')
ON DUPLICATE KEY UPDATE flag_value = VALUES(flag_value), description = VALUES(description);
