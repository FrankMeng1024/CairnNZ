-- v80 #45: voice memo (5s audio attached to a marker).
-- Stores a URL pointing to an uploaded audio file (m4a/AAC, ~50KB
-- per memo). Nullable — most markers have no memo.

ALTER TABLE markers
  ADD COLUMN voice_memo_url VARCHAR(512) NULL DEFAULT NULL AFTER text,
  ADD COLUMN voice_memo_duration_ms SMALLINT UNSIGNED NULL DEFAULT NULL AFTER voice_memo_url;
