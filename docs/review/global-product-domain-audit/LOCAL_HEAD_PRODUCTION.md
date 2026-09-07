# Local working tree, committed HEAD, and production

This comparison contains only differences that affect domain authority, lifecycle, schema, reliability, or active capability.

## Version boundary

| Reality | Verified version/state | Authority conclusion |
|---|---|---|
| Current working tree | `master`; HEAD `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c` (`friend new ui`) plus pre-existing tracked/untracked changes | Audit inspected this reality. Product source matches committed HEAD except the uncommitted auth/email observability candidate described below. |
| Committed local HEAD | `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c`; `origin/master` matched at audit start | Contains Activity P0 reliability and final Friends/UI work. |
| Production OTA | EAS `production`, group `3ad70812…`, runtime `0.2.6`, iOS/Android, created 2026-09-05 13:38:19Z, git commit `6d4a682dfa479acded07d41daaedcc1607f82f1f`, message `ui friend final` | **PRODUCTION FACT:** one commit behind local HEAD. Activity P0 is not in the deployed JS bundle. |
| Production checkout | `/opt/githubRepos/Cairn`, `master` at `2e6945047e6ef63590f2ace49f4cc0d3998ddcb1` | **PRODUCTION FACT:** host checkout is not a reliable image-version marker. |
| Production backend container | healthy `cairn-backend`, bound to host `127.0.0.1:3001`; health endpoint OK | **PRODUCTION FACT:** container is a mixed deployed artifact: selected source hashes match different repository commits rather than the checkout as a unit. |

## Material behavior differences

| Area | Local working tree | Committed HEAD | Production | Conclusion |
|---|---|---|---|---|
| Activity derived operational state | Present | Present | OTA commit predates it | **FACT | LOCAL HEAD ONLY — NOT PRODUCTION:** exclusive Ready/Starting/Tracking/Paused/Finishing/Recovery/Stopped/Error interpretation |
| Duplicate Start guard | Present | Present | not in production OTA | **FACT | LOCAL HEAD ONLY — NOT PRODUCTION:** synchronous shared `requesting` boundary |
| Duplicate Finish guard | Present | Present | not in production OTA | **FACT | LOCAL HEAD ONLY — NOT PRODUCTION:** one save/finish pipeline |
| Running unfinished recovery | Present | Present | production OTA lacks parity | **FACT | LOCAL HEAD ONLY — NOT PRODUCTION** |
| Running save-loss recovery | Present | Present | production OTA lacks host | **FACT | LOCAL HEAD ONLY — NOT PRODUCTION** |
| Cold recovery owner rebuilding | Present | Present | production OTA predates it | **FACT | LOCAL HEAD ONLY — NOT PRODUCTION** |
| Activity keep-awake policy | unconditional screen wake-lock removed | removed | production OTA predates removal | **FACT | LOCAL HEAD ONLY — NOT PRODUCTION** |
| Running map readiness / unavailable state | Present | Present | production OTA predates it | **FACT | LOCAL HEAD ONLY — NOT PRODUCTION** |
| Mapbox SDK attribution in Hike/Run | enabled in active maps | enabled | production OTA predates P0 change | **FACT | LOCAL HEAD ONLY — NOT PRODUCTION** |
| Friends final closeout | current local screen | committed | production message indicates prior `ui friend final` bundle at `6d4a682`; local HEAD is later | **PRODUCTION FACT:** production has the preceding Friends final bundle, not every later local delta |
| Password-reset email observability | New route/service changes and migration/model/tests exist only uncommitted | absent | production table absent | **LOCAL CANDIDATE:** `password_reset_email_events`; not production authority |

The mandated wording for uncommitted consequential behavior is:

> **LOCAL WORKING-TREE AUTHORITY — NOT YET PRODUCTION:** password-reset email event observability only.

Activity P0 is not an uncommitted candidate. It is a committed local-HEAD fact that is not yet in production.

## Production schema differences that change conclusions

| Schema/capability | Repository intent | Production verification | Product consequence |
|---|---|---|---|
| Memory subscription trigger | Migration `018_friend_system_v4.sql` creates `trg_memory_subscription_cap` to enforce mutual friendship and per-user cap | **PRODUCTION FACT:** no DB triggers exist | POST relies on missing trigger; unauthorized/over-cap subscriptions are not prevented by the deployed DB path; Friend Fog can violate intended authority |
| Session → Route FK | Migration `005_routes.sql` declares `sessions.route_id → routes.id ON DELETE SET NULL` | **PRODUCTION FACT:** column exists but FK does not | Route deletion will not null a populated session link. Active client currently writes no route ID, masking the drift |
| Unlocked regions → User FK | Account hard-delete model expects cascade coverage for account data | **PRODUCTION FACT:** `unlocked_regions` has no user FK | Region attribution rows can survive hard deletion as orphans |
| Password reset events | Local uncommitted migration proposes table | **PRODUCTION FACT:** table absent | Observability behavior is not deployed; password reset itself remains active |
| Core domain tables | sessions, routes, markers, memory_points, friend/request/subscription/vote/etc. migrations | **PRODUCTION FACT:** core tables/columns were present | Core domain conclusions are not based solely on migration files |

## Production runtime configuration differences

| Capability | Repository code | Deployed result | Classification |
|---|---|---|---|
| Account restore grace | `RESTORE_GRACE_MS = 5 minutes`, explicitly marked TEST-MODE with seven-day launch TODO | container source/hash and runtime scheduling verified | **PRODUCTION FACT — HIGH:** real production grace is five minutes |
| Auth sweep cadence | every minute, explicitly marked TEST-MODE | active backend registration/log topology verified | **PRODUCTION FACT — HIGH:** hard-delete eligibility is checked every minute |
| Push drain | every minute; purge daily 03:30 UTC | backend capability deployed | **PRODUCTION FACT:** no active client registration/event enqueue flow, so capability remains dormant product-wise |
| Export build/purge | build every two minutes; purge daily 04:00 UTC | deployed backend topology inspected | **PRODUCTION FACT — ACTIVE SECONDARY** |
| Hidden-item orphan cleanup | weekly Sunday 03:00 UTC | deployed backend scheduler | **PRODUCTION FACT — ACTIVE BACKGROUND MAINTENANCE** |

## Native / OTA boundary

- **FACT:** app runtime version is `0.2.6` and Expo Updates is configured; the production OTA targets that runtime for both platforms.
- **INFERENCE:** current Activity P0 source changes appear JS-only and use already-linked native modules, so they are plausibly OTA-compatible with runtime `0.2.6`.
- **UNKNOWN until device validation:** background CoreLocation continuity, screen-lock recording, process-death recovery, and Mapbox ornament placement cannot be certified by Expo Web.
- **FACT:** any future change to native dependencies, permissions, config plugins, entitlements, or runtime version requires a new EAS binary rather than JS OTA alone.

## Pre-existing working-tree changes protected by this audit

At baseline the following tracked files were already modified: `backend/src/routes/auth.js`, `backend/src/services/emailService.js`, and four visual-authority documents. Additional untracked password-reset event files and a large pre-existing `docs/review/` tree were present. **FACT:** this audit did not reset, stash, discard, commit, or edit those pre-existing files. The only new local writes are the requested files inside `docs/review/global-product-domain-audit/`.
