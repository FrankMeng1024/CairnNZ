-- R114/O22 user directive (2026-08-08): auto-backfill legacy users' DOB.
--
-- Original problem: old accounts (pre-DOB migration) had users.date_of_birth
-- = NULL. Client prompted "One quick thing — enter your birthday" on next
-- login. User feedback: "老账户你帮我 migrate 随便什么 birthday. 因为我们
-- 上限必定是有 birthday 的, 简化这里, 不要有多余的, 容易出问题".
--
-- Solution: backfill every NULL date_of_birth to 2000-01-01. This is >13
-- years ago (satisfies COPPA age gate) and matches all backend validation.
-- Users won't see the backfill modal; the field becomes immutable per the
-- existing patch-dob 409 guard.
--
-- Idempotency: only touches rows where date_of_birth IS NULL. Safe to
-- re-run — no-op on second execution.

UPDATE users
SET date_of_birth = '2000-01-01'
WHERE date_of_birth IS NULL;
