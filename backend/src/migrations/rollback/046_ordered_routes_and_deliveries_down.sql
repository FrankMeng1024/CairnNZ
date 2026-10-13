-- Destructive rollback for isolated rehearsal only. Export delivery snapshots
-- first if rollback is ever separately authorized after real use.
DROP TABLE IF EXISTS shared_route_deliveries;

ALTER TABLE routes
  DROP COLUMN resolution_state,
  DROP COLUMN ordered_draft,
  ALGORITHM=INPLACE, LOCK=NONE;
