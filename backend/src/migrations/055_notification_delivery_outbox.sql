-- O88 quality closure: make delivery attempts recoverable and observable.
-- The notification_log row itself remains the transactional outbox intent.

ALTER TABLE notification_log
  ADD COLUMN attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN next_attempt_at DATETIME(3) NULL AFTER attempt_count,
  ADD COLUMN last_attempt_at DATETIME(3) NULL AFTER next_attempt_at,
  ADD COLUMN provider_ticket_ids JSON NULL AFTER last_attempt_at,
  ADD COLUMN provider_receipt_checked_at DATETIME(3) NULL AFTER provider_ticket_ids,
  ADD COLUMN provider_receipt_error VARCHAR(200) NULL AFTER provider_receipt_checked_at,
  ADD INDEX idx_notification_delivery (status, next_attempt_at, id),
  ADD INDEX idx_notification_receipts (status, provider_receipt_checked_at, id);
