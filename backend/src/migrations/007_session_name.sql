-- 007_session_name.sql — add `name` column to sessions table.
--
-- Frontend has been POSTing a `name` field for activities since v17 but
-- the column never existed; the backend was silently dropping it. As a
-- result every Activities list row showed the auto-generated default
-- "Hike — DD/MM/YYYY" instead of the user-typed name.
--
-- Idempotent: only adds the column if it doesn't already exist.

ALTER TABLE sessions
  ADD COLUMN name VARCHAR(60) NULL AFTER duration_s;
