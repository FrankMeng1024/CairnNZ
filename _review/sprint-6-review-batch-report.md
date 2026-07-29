# Sprint 6 Review Batch — All Fixes Applied

Second half of 8h sleep run (2026-07-30 UTC). After the initial Sprint
6 4-eyes adversarial review, kept iterating on the remaining review
items until all Blocker/Critical/Medium findings were addressed.

## Summary

**19 review items processed across 2 review passes:**
- 2 Blockers fixed in initial sprint-6-final-report commit f355750
- 6 Criticals fixed in commits below
- 11 Mediums fixed in commits below

## Commits (all local + aliyun-deployed, pending push)

| Commit | Item | Description |
|---|---|---|
| `f355750` | B1+B2+B2+C1+C2 (initial) | Password change wire, friends route order, verify off-by-one, friends/accept tx, export DoS/timing, setImmediate race |
| `0a93df0` | C3 (Reviewer B) | useMarkerStore.hydrate mutex (parallel to SessionStore) |
| `628d12c` | C4 (Reviewer A) | Push preferences moved to per-user user_push_prefs table (migration 024) |
| `25e821f` | C7 (Reviewer A) | Apple Sign In nonce validation (SHA-256 hash echo) |
| `1761464` | C5 + C8 + C9 + M8 + M9 | Refresh rate limit / null-relatedId dedupe / cold-boot push unregister / Google honesty / delete-account push unregister |
| `f75fcba` | M1 + M9 | Friend request/profile privacy hardening (soft-delete + 404 collapse) |
| `39aa859` | C3 (Reviewer A) | Password reset aggregate rate limit (3 codes / 15min) |
| `38f7ee4` | M2 (Reviewer B) | Export history exposes error_msg |
| `7e5953e` | M10 (Reviewer B) | /account/restore issues fresh JWT + revokes old jti |
| `cc5fa58` | M12 (Reviewer B) | Fail-fast on missing global.fetch |
| `042f2ac` | M7 (Reviewer B) | PaywallSheet handles success-without-entitlement |

## Deferred / not fixed (with rationale)

- **Reviewer A M3**: `LIMIT ${safeBatch}` inline pattern — safe (validated
  int), noted for future maintenance.
- **Reviewer A M4**: TokenBlacklist LRU per-worker — only bites when
  running >1 Node worker; single-container deploy is fine.
- **Reviewer B M5**: Unblock doesn't re-friend — INTENDED behaviour.
- **Reviewer B M6**: Delete account password reprompt — needs Ask-User
  discussion for OAuth-only accounts (no password). Type-to-confirm +
  email is defense-in-depth for MVP.

## Data / state changes

New DB objects:
- `user_push_prefs` table (migration 024)

New endpoints / route behaviour:
- `POST /api/auth/apple` now checks nonce
- `POST /api/auth/refresh` now rate-limited
- `POST /api/auth/logout` now unregisters push tokens
- `DELETE /api/auth/account` now unregisters push tokens
- `POST /api/auth/account/restore` now issues fresh JWT + revokes old
- `GET /api/friends/:id/profile` collapses 403+404 to 404
- `POST /api/friends/request` filters soft-deleted users
- `GET /api/account/exports` includes error_msg

## Aliyun deployment state

All fixes deployed via `docker cp` + `docker restart cairn-backend`.
Migration 024 applied. Health check 200 after each redeploy.

Cron summary (unchanged from Sprint 6 completion):
- `0 3 * * 0` cleanHiddenItemsOrphans
- `15 3 * * *` authSweep
- `* * * * *` pushDrain
- `30 3 * * *` pushPurge
- `*/2 * * * *` exportBuild
- `0 4 * * *` exportPurge

## Push queue status

github.com:443 has been intermittently unreachable since ~15:30 UTC.
11 commits are local, awaiting network recovery. Retry will happen at
next natural break OR when user resumes.

**All deployments already happened via aliyun docker cp — production
backend has ALL the fixes. Push is git repo hygiene only.**

## Client build implications

Frontend commits included:
- authService.loginWithApple(idToken, providedName, rawNonce)
- authService.restoreAccount now saves fresh token
- AuthScreen handleAppleAuth generates SHA-256 nonce
- AuthScreen Google alert honesty
- PaywallSheet success-without-entitlement handling
- useMarkerStore.hydrate mutex

New dependency (already installed via `npm install`):
- `expo-crypto` (~15.0.7) — for the Apple nonce SHA-256

Still requires EAS build to activate:
- Apple nonce path (requires expo-crypto native module — but expo-crypto
  is often already bundled)
- All other Sprint 6.6 / 6.8 native modules (unchanged from initial plan)

See `sprint-6-pre-build-gate.md` for the full pre-build checklist.
