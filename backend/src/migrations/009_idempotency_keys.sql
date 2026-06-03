-- v78 #7: idempotency keys for offline-queue retries.
-- Each mutating client call carries a `client_op_id` UUID. Server stores
-- the cached response so retries from the offline queue can short-circuit
-- without re-executing the mutation.
--
-- Cleanup: 7-day TTL. If a queue op is older than 7 days, the dedupe is
-- gone — at worst it executes again, which is a near-zero risk because
-- realistic offline windows are minutes, not days.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  op_id CHAR(36) NOT NULL PRIMARY KEY,
  op_kind VARCHAR(32) NOT NULL,
  user_id INT NOT NULL,
  status_code SMALLINT NOT NULL,
  response_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_idempotency_created (created_at)
);
