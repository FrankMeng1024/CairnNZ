-- Targeted O88 closure: keep missing provider receipts bounded without
-- letting one unresolved row starve every later receipt audit batch.

ALTER TABLE notification_log
  ADD COLUMN provider_receipt_attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER provider_receipt_checked_at,
  ADD COLUMN provider_receipt_next_attempt_at DATETIME(3) NULL AFTER provider_receipt_attempt_count,
  ADD INDEX idx_notification_receipt_retry
    (provider_receipt_checked_at, provider_receipt_next_attempt_at, id);
