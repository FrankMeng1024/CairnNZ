-- O85 Friends Memory historical repair authority.
--
-- The old endpoint/private-place masking contract is retired. Historical
-- Activity recovery is performed by the reviewed idempotent backfill script;
-- this table records every recovered or conservatively excluded session.

CREATE TABLE memory_activity_backfill_audit (
  session_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  backfill_version SMALLINT UNSIGNED NOT NULL,
  decision ENUM('recovered','excluded') NOT NULL,
  strategy VARCHAR(40) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  original_source_provenance ENUM('unknown','native_real','isolated_qa') NOT NULL,
  input_route_points INT UNSIGNED NOT NULL DEFAULT 0,
  input_raw_points INT UNSIGNED NOT NULL DEFAULT 0,
  recovered_points INT UNSIGNED NOT NULL DEFAULT 0,
  upgraded_points INT UNSIGNED NOT NULL DEFAULT 0,
  inserted_points INT UNSIGNED NOT NULL DEFAULT 0,
  evidence_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_memory_backfill_user (user_id, decision, applied_at),
  CONSTRAINT fk_memory_backfill_session
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_memory_backfill_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Protected Places and the default endpoint radius no longer belong to the
-- product contract. Retain the legacy rows for audit/reversibility but ensure
-- no projection path can treat them as active policy.
UPDATE memory_private_places
   SET active = 0, version = version + 1
 WHERE active = 1;

-- Advance authorization so account-scoped warm caches cannot mistake a
-- pre-O85 masked result for the current full-history projection.
UPDATE memory_share_grants
   SET authorization_version = authorization_version + 1
 WHERE status = 'active';
