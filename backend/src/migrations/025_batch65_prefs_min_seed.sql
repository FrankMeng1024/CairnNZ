-- Migration 025: correct migration 024 seed semantics (round-4 review R14B3 v2)
--
-- Migration 024 seeded user_push_prefs from `MAX(device_tokens.pref_*)`.
-- Reviewer B flagged this as privacy-hostile: if a user had two devices
-- with divergent prefs (one on, one off), the union preserved the ON
-- choice. Privacy-preserving default is MIN (respect any opt-out).
--
-- Live check on aliyun at deploy time confirmed 0 users had divergent
-- prefs, so no user was harmed by the MAX seed. This migration exists
-- so that a FUTURE re-migration (rollback + reapply, or DB restore)
-- won't silently lose opt-outs.
--
-- Sprint 6 round-14 R14B3 fix: after migration 029, this UPDATE also
-- gates on `seeded_from_devices = 1`. Any user who manually PATCH'd
-- prefs since 024 has that flag cleared (see PushNotification.js
-- updatePreferences) — 025 re-run skips them, preserving their choice.
-- Legacy pre-029 replay path unchanged (WHERE MAX=MIN mismatch still
-- guards).
USE cairn;

UPDATE user_push_prefs upp
JOIN (
  SELECT user_id,
         MAX(pref_friend_requests) AS max_fr, MIN(pref_friend_requests) AS min_fr,
         MAX(pref_marker_replies)  AS max_mr, MIN(pref_marker_replies)  AS min_mr,
         MAX(pref_memory_hits)     AS max_mh, MIN(pref_memory_hits)     AS min_mh,
         MAX(pref_announcements)   AS max_an, MIN(pref_announcements)   AS min_an
  FROM device_tokens
  GROUP BY user_id
) dt ON dt.user_id = upp.user_id
SET
  upp.pref_friend_requests = CASE WHEN upp.pref_friend_requests = dt.max_fr THEN dt.min_fr ELSE upp.pref_friend_requests END,
  upp.pref_marker_replies  = CASE WHEN upp.pref_marker_replies  = dt.max_mr THEN dt.min_mr ELSE upp.pref_marker_replies  END,
  upp.pref_memory_hits     = CASE WHEN upp.pref_memory_hits     = dt.max_mh THEN dt.min_mh ELSE upp.pref_memory_hits     END,
  upp.pref_announcements   = CASE WHEN upp.pref_announcements   = dt.max_an THEN dt.min_an ELSE upp.pref_announcements   END
WHERE (upp.seeded_from_devices IS NULL OR upp.seeded_from_devices = 1)
  AND (dt.max_fr != dt.min_fr
    OR dt.max_mr != dt.min_mr
    OR dt.max_mh != dt.min_mh
    OR dt.max_an != dt.min_an);
