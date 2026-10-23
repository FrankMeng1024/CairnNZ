ALTER TABLE notification_log
  DROP INDEX idx_notification_receipt_retry,
  DROP COLUMN provider_receipt_next_attempt_at,
  DROP COLUMN provider_receipt_attempt_count;
