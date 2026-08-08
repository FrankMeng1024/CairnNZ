-- R114/O22 STORY-73006 (H2): Onboarding follows the user account.
--
-- Adds `onboarding_done_at` to users so the intro flow gate lives on the
-- server (not per-device AsyncStorage). This makes the guarantee "跟着
-- 账号走 不管卸载与否 只要看过就不看第二次" — same user on any device,
-- after any uninstall/reinstall, skips onboarding.
--
-- Semantic:
--   NULL     → user has never completed the onboarding flow → show it
--   NOT NULL → user has finished onboarding (timestamp recorded once) →
--              skip onboarding on all future logins from any device
--
-- Idempotent: setOnboardingDone won't overwrite an existing timestamp
-- (see backend/src/routes/auth.js PATCH /api/auth/onboarding).

ALTER TABLE users
  ADD COLUMN onboarding_done_at TIMESTAMP NULL DEFAULT NULL
  COMMENT 'R114/O22 H2: set when user completes the 4-screen intro. NULL = has never finished onboarding.';

-- Users who registered before this migration have used the app on at
-- least one device without server-side onboarding tracking. We do NOT
-- backfill onboarding_done_at for them — the per-device AsyncStorage
-- key handles legacy: if the client sees no server flag but the local
-- per-account key is set, it stays skipped. When those users next open
-- the app, the client calls PATCH /api/auth/onboarding as soon as they
-- finish onboarding again (or if the local key is 'true' at that time,
-- some future retro-fill could opportunistically sync — deliberately
-- deferred).
