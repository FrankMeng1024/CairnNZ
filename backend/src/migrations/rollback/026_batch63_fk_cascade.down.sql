-- Rollback for migration 026: drop the FKs added.
USE cairn;
ALTER TABLE token_blacklist    DROP FOREIGN KEY fk_blacklist_user;
ALTER TABLE device_tokens      DROP FOREIGN KEY fk_device_tokens_user;
ALTER TABLE notification_log   DROP FOREIGN KEY fk_notif_recipient;
ALTER TABLE notification_log   DROP FOREIGN KEY fk_notif_actor;
ALTER TABLE user_push_prefs    DROP FOREIGN KEY fk_prefs_user;
ALTER TABLE data_exports       DROP FOREIGN KEY fk_data_exports_user;
ALTER TABLE blocked_users      DROP FOREIGN KEY fk_blocked_blocker;
ALTER TABLE blocked_users      DROP FOREIGN KEY fk_blocked_blocked;
