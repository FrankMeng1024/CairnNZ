-- Migration 058: causal ordering for Memory Friend selection mutations.
--
-- A mobile request may reach MySQL after the client has timed out and sent a
-- newer opposite intent. This compact head row lets the server reject an old
-- mutation from the same durable client chain instead of resurrecting a
-- selection. Existing O94 clients remain compatible and continue to use the
-- legacy route shape.

CREATE TABLE IF NOT EXISTS memory_subscription_intent_heads (
  viewer_id BIGINT UNSIGNED NOT NULL,
  friend_id BIGINT UNSIGNED NOT NULL,
  selection_chain_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selection_sequence BIGINT UNSIGNED NOT NULL,
  selection_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selected TINYINT(1) NOT NULL,
  grant_epoch CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  friendship_episode_id BIGINT UNSIGNED NULL,
  authorization_version BIGINT UNSIGNED NULL,
  coverage_scope VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (viewer_id, friend_id),
  CONSTRAINT fk_memory_subscription_intent_viewer
    FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_memory_subscription_intent_friend
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_memory_subscription_intent_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
