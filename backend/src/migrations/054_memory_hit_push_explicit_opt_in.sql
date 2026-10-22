-- O88: location-derived encounter alerts require explicit consent.
-- `pref_memory_hits` predated the encounter product and historically defaulted
-- to on. No previous value represents informed consent for this new alert, so
-- reset existing rows once and make future preference rows default off.

UPDATE user_push_prefs SET pref_memory_hits=0;

ALTER TABLE user_push_prefs
  MODIFY COLUMN pref_memory_hits TINYINT(1) NOT NULL DEFAULT 0;
