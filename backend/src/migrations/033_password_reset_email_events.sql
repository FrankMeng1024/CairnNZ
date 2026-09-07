-- Durable, secret-free observability for password-reset email attempts.
-- This records lifecycle metadata only. It never stores reset codes, message
-- bodies, credentials, authorization headers, or raw recipient email.
USE cairn;

CREATE TABLE IF NOT EXISTS password_reset_email_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id CHAR(36) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(32) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'resend',
  provider_message_id VARCHAR(255) NULL,
  send_status VARCHAR(32) NOT NULL,
  error_code VARCHAR(64) NULL,
  error_summary VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_reset_email_event_request (request_id, created_at),
  INDEX idx_reset_email_event_user (user_id, created_at),
  CONSTRAINT fk_reset_email_event_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
