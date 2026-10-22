-- Schema-only rollback. Do not manufacture consent by changing stored values.
ALTER TABLE user_push_prefs
  MODIFY COLUMN pref_memory_hits TINYINT(1) NOT NULL DEFAULT 1;
