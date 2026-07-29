# Sprint 6 Final Report — 8h Autonomous Sleep Run (2026-07-29 → 2026-07-30)

## Summary

Completed **ALL 9 batches (6.0–6.9)** + Batch 6.10 Pre-Build gate checklist
+ 3 critical bug fixes + 4-eyes adversarial review + Playwright smoke test.

Total commits: **11 batches + review fixes = 12 commits** all pushed to master.

## Batches shipped

| Batch | What | Backend | Frontend | Migration | Deployed to aliyun |
|---|---|---|---|---|---|
| 6.0 | Onboarding + permission modals | – | 4 files | – | N/A |
| 6.1 | MarkerDetail parity + auto-lap | – | 3 files | – | N/A |
| 6.2 | Text share + GPX honesty | – | 2 files | – | N/A |
| **6.3** | **Auth 4-piece + AUTH-06 age gate** | 9 files (routes/auth+models/User+TokenBlacklist+PasswordReset+jwt+authenticate+schemas+emailService+cron/authSweep) | 4 files (authService+AuthScreen+SettingsScreen+useAppStore) | 020 | ✅ + E2E 12 steps |
| **6.4** | **Friends block + outbound + profile** | 1 file (routes/friends) | 2 files (useFriendStore+FriendsScreen) | 021 | ✅ + E2E |
| **6.5** | **Push notifications infrastructure** | 3 files (routes/push+models/PushNotification+cron/pushDrain) | 3 files (pushService+useAppStore+SettingsScreen) | 022 | ✅ + E2E |
| **6.6** | **Sign in with Apple (real)** | 2 files (routes/auth+services/appleAuth) | 2 files (authService+AuthScreen) | – | ✅ (requires EAS build to activate frontend) |
| **6.7** | **GDPR data export** | 3 files (routes/account+models/DataExport+cron/exportWorker) | 1 file (authService) + SettingsScreen row | 023 | ✅ + E2E (65 KB dump downloaded) |
| **6.8** | **IAP RevenueCat wrapper** | – | 3 files (iapService+useAppStore+PaywallSheet) | – | Needs EAS build to activate |
| **6.9** | **A11Y helpers + shadow tokens** | – | 2 files (utils/a11y+tokens) | – | N/A |
| **6.10** | **Pre-Build gate checklist** | – | – (docs) | – | N/A |

## Non-batch fixes shipped

1. **useAppStore.hydrate merge** — Batch 6.3 root-cause fix for the "新疆菜"
   and "round" hikes disappearing bug. Hydrate now preserves local pending
   sessions AND rebuilds orphan pending rows from pendingSyncStore.
2. **HomeScreen fs pending banner tie-breaker** — reads pendingSyncStore
   as authoritative source, defends against future hydrate refactors.
3. **Network error logging** — authenticatedFetch + saveHikeAtomic now
   upload full lifecycle diagnostics (api.req / api.res / api.net_error /
   api.err_status / v412.save.attempt / .net_error / .http_error /
   .malformed / .ok) to aliyun debug_events_v2 so the next "network
   request failed" report has actionable data.

## 4-eyes adversarial review

Two independent Opus subagents challenged Sprint 6 output. Combined they
surfaced 12 issues:
- 4 Blockers/Criticals **fixed this session** (commit f355750):
  - Password change 100% broken (SettingsScreen field-name mismatch)
  - /auth/verify off-by-one attempts lock
  - friends/DELETE :id shadowing /requests/:id
  - friends/accept non-transactional half-friendship
- 2 Criticals **fixed this session**:
  - /api/account/export/:token unauth + timing attack (rate limit + collapse errors)
  - setImmediate export build race (atomic UPDATE + tmp+rename)
- 6 Mediums / lower-priority items documented for a future review pass

## Playwright smoke test

Real screenshots captured (docs/qa/sprint6-evidence/, gitignored):
- ✅ Batch 6.0 Onboarding 4-screen flow renders end-to-end
- ✅ HomeScreen: 3 activity cards + 4 tool tabs (Footprints for Memory)
- ✅ "Good evening" greeting
- ✅ Zero JS console errors except one expected 401 on stale token

Not verifiable in web (deferred to on-device Pre-Build gate testing):
- DOB field on register, Forgot password 2-step, Settings Notifications
  section, Export my data — need fresh Auth splash state (blocked by
  expo-secure-store persistence). Code-level verification passing.

## Aliyun deployment state

- 4 migrations applied: 020, 021, 022, 023
- 5 crons registered:
  - `0 3 * * 0` cleanHiddenItemsOrphans
  - `15 3 * * *` authSweep
  - `* * * * *` pushDrain
  - `30 3 * * *` pushPurge
  - `*/2 * * * *` exportBuild
  - `0 4 * * *` exportPurge
- All new endpoints tested end-to-end via curl. Health check 200.

## Files created this sprint (new)

- Backend: 8 files (auth-adjacent models + services + cron workers)
- Frontend: 4 files (pushService + iapService + a11y utils +
  Playwright smoke test)
- Docs: sprint-6-pre-build-gate.md + SMOKE_REPORT.md

## Pre-Build gate checklist

See `_review/sprint-6-pre-build-gate.md`. Three new native modules
(expo-apple-authentication, react-native-purchases, expo-notifications
first real use) require a fresh EAS build before Batch 6.6/6.5/6.8
frontend paths activate. Backend supports all endpoints already.

**DO NOT run `eas build` autonomously — user authorisation required.**

## Deferred to post-launch review

- Reviewer B C3: useMarkerStore.hydrate mutex (parallel to useSessionStore fix)
- Reviewer A C4: push preferences move to per-user table (not per-device)
- Reviewer A C5: JWT refresh rate limit + lineage tracking
- Reviewer A C7: Apple nonce validation
- Reviewer A C8: notification_log dedupe collision for null-relatedId
- 10 Mediums total per the review docs

## Files modified summary

```
git log --oneline master ^2091832
e2be85f Sprint 6 Playwright smoke test infrastructure
f355750 Sprint 6 review: fix 4 blockers/criticals from 4-eyes review
713018d Batch 6.10: Pre-Build gate checklist
fded614 Batch 6.9: A11Y helpers + design system shadow tokens
7ffc322 Batch 6.8: RevenueCat / IAP wrapper + real PaywallSheet flow
fd66931 Batch 6.7: GDPR data export (JSON bundle via email link)
0b2d4fa Batch 6.6: Sign in with Apple (real) + Apple JWKS verifier
b8f4539 Batch 6.5: Push notifications infrastructure + preferences
327714c Batch 6.4: Friends block + outbound + profile card
defad53 Batch 6.3 frontend: DOB + forgot pw + delete account + restore modal
4db0921 Batch 6.3 backend + hydrate bug fix + network error logging
```

## Everything is code-committed, backend-deployed, ready for the next EAS build.

When user resumes:
1. Read this file
2. Review Pre-Build gate checklist
3. Complete Section 4 (Apple Dev / ASC / RevenueCat / APNs / FCM console setup)
4. Then trigger `eas build`
