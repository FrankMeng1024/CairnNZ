-- v300 N3: public_snapshot — immutable copy of (type / lat / lng / note)
-- taken the FIRST time a marker is set to permission='public'. Subsequent
-- edits to the marker's main fields do NOT touch this column. Subsequent
-- public/unpublic toggles leave it unchanged. Used by future read endpoints
-- so external viewers (friends / public) always see the originally-shared
-- content, regardless of what the owner later edits in their private view.
--
-- text VARCHAR(50) is also bumped to VARCHAR(250) here — plant flow
-- combines a 30-char title + U+001E + 200-char body into the single
-- `text` column. The 50-char limit was a leftover from a pre-encoding
-- design; backend POST/PUT validation enforces 250 since v300.

ALTER TABLE markers
  MODIFY COLUMN text VARCHAR(250) NULL DEFAULT '',
  ADD COLUMN public_snapshot JSON NULL DEFAULT NULL AFTER permission;
