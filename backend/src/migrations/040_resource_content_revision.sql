-- Stable monotonic content identity for shared Cairns and Routes.
--
-- `updated_at` in the deployed legacy tables has only whole-second precision,
-- so two accepted material writes in the same second can otherwise receive
-- the same shared resource revision. Authorization/audience epochs remain a
-- separate authority and are deliberately not reused as content versions.

ALTER TABLE markers
  ADD COLUMN content_revision BIGINT UNSIGNED NOT NULL DEFAULT 1
    AFTER audience_changed_at,
  ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE routes
  ADD COLUMN content_revision BIGINT UNSIGNED NOT NULL DEFAULT 1
    AFTER audience_changed_at,
  ALGORITHM=INPLACE, LOCK=NONE;
