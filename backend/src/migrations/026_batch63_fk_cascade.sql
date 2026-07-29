-- Migration 026: add ON DELETE CASCADE FKs for Sprint 6 tables
--
-- Sprint 6 round-6 review R6B1: authSweep.User.hardDelete only cascades
-- to sessions + user_oauth (both had FKs from earlier migrations). New
-- Sprint 6 tables (token_blacklist, password_reset_codes, device_tokens,
-- notification_log, user_push_prefs, data_exports) all declared
-- `user_id BIGINT UNSIGNED NOT NULL` but omitted the FK+CASCADE. Result:
-- orphan rows accumulate forever. Add the missing FKs.
--
-- Safe on existing data — all referenced user_ids should already point
-- at existing users (or the row is already orphaned and harmless to
-- delete). If any row's user_id doesn't match a users.id, the ALTER
-- will fail with foreign key constraint error — that's the correct
-- signal that data needs cleanup before applying.
USE cairn;

-- token_blacklist: rows should die with the user (jti is meaningless
-- after account deletion).
ALTER TABLE token_blacklist
  ADD CONSTRAINT fk_blacklist_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- password_reset_codes has no user_id column (keyed by email only),
-- so no FK — codes for deleted-user's email are cleaned by the
-- daily purgeStale cron after 1 day.

-- device_tokens: push targets must not outlive the user.
ALTER TABLE device_tokens
  ADD CONSTRAINT fk_device_tokens_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- notification_log: recipient_user_id + actor_user_id both die with
-- the referenced user. Actor uses SET NULL (a friend's actions on
-- deleted user's timeline shouldn't nuke the friend's history — but
-- the actor field is nullable so SET NULL is fine).
ALTER TABLE notification_log
  ADD CONSTRAINT fk_notif_recipient
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_notif_actor
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- user_push_prefs: per-user table, dies with user.
ALTER TABLE user_push_prefs
  ADD CONSTRAINT fk_prefs_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- data_exports: export files are also deleted from disk by purge cron
-- but let the DB row die with the user immediately.
ALTER TABLE data_exports
  ADD CONSTRAINT fk_data_exports_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- blocked_users: block relationships die with EITHER side.
ALTER TABLE blocked_users
  ADD CONSTRAINT fk_blocked_blocker
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_blocked_blocked
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE;
