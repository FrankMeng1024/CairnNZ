-- Rollback for migration 027. Procedures already dropped by 027 itself
-- as its final step; no additional cleanup needed. The idempotent
-- adds are safe to leave in place; rolling them back would just re-
-- expose the schema drift risk.
USE cairn;
SELECT 1;
