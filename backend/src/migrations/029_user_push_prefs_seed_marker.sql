-- Migration 029: user_push_prefs.seeded_from_devices flag
--
-- Sprint 6 round-14 R14B3: migration 025's guard `WHERE upp.pref_* = dt.max_*`
-- couldn't distinguish "still at 024 seed" from "user manually re-opted to
-- the same value as seed". A re-run of 025 (rollback + re-apply, DB restore)
-- would clobber the manual choice.
--
-- Fix: add a boolean marker set by 024 and cleared by any manual UPDATE via
-- the app. 025 gates on this flag. Any re-run of 025 skips rows that have
-- been manually touched.
USE cairn;

SET @s := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_push_prefs' AND COLUMN_NAME='seeded_from_devices') = 0,
    'ALTER TABLE user_push_prefs ADD COLUMN seeded_from_devices TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT 1'
  )
);
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: any existing user_push_prefs row is either from 024 seed OR
-- manually created via PATCH. Since 024 pre-dated the marker column, we
-- can't tell — set seeded_from_devices=1 for ALL current rows to preserve
-- the original R14B3 window (users who haven't touched prefs get MIN
-- treatment on next 025 replay). Users who HAVE touched prefs already
-- diverged from MAX, so 025 skips them regardless.
UPDATE user_push_prefs SET seeded_from_devices = 1 WHERE seeded_from_devices = 0;
