-- Revision 02: distinguish original borrowed-Route use time from receipt time
-- and make terminal reconciliation observable and idempotent.

ALTER TABLE shared_route_leases
  ADD COLUMN start_acknowledged_at DATETIME(3) NULL AFTER use_started_at,
  ADD COLUMN end_acknowledged_at DATETIME(3) NULL AFTER use_ended_at,
  ADD COLUMN terminal_reason ENUM('finished','discarded') NULL AFTER end_acknowledged_at,
  ALGORITHM=INPLACE, LOCK=NONE;
