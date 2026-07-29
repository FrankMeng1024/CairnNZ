# Sprint 6 State — Session Snapshot

**Last update**: 2026-07-29 (session end)

## Completed batches (committed to master)

| Batch | Commit | Items | Status |
|---|---|---|---|
| 6.0 Onboarding | `6e80809` | ONB-01, ONB-02, ONB-04, PermissionDeniedModal | ✅ + 4-eyes PASS |
| 6.1a Front-end small | `6e80809` | HOME-02/03/04/05/06, FRI-06, MEM-05, VER-05/06/07 | ✅ (10/13, 3 deferred) |
| 6.1b Map + Routes | `6e80809` | MAP-01, ROUTE-07 | ✅ (2/4, MAP-06 + ROUTE-08 deferred) |
| 6.1c MARK-02 | `3515e6c` | MarkerDetail Sheet parity via See details + permission chip | ✅ (pragmatic split) |
| 6.1d Hiking/Running | `3515e6c` | RUN-06, HIKE-07 | ✅ (2/6, 4 deferred to S7) |
| 6.1e History rest | `6eaa8d5` | HIST-02 filter, HIST-08 manual retry sync | ✅ |
| 6.2 Sharing | `e206d88` | SHR-01 text share (image deferred), SHR-02 GPX promise removed | ✅ |
| 6.3 partial | `aa6ebd7` | AUTH-05 password strength, AUTH-09 mid-hike logout warn | ✅ partial |

## Next session start-point

**Batch 6.3 remaining** (biggest, ~15-20h):
- AUTH-01 delete account (backend DELETE + restore + 7d grace cron)
- AUTH-04 forgot password (nodemailer 6-digit code flow)
- AUTH-06 age gate (DOB field + migration for legacy users + 30d补录 grace)
- AUTH-07 6-cell OTP input component
- AUTH-08 logout revoke JWT (blacklist table + LRU cache)
- AUTH-10 email validation verify against existing DB rows

Requires:
- DB migration on aliyun (3 new tables + 2 new columns)
- 5 new backend endpoints
- Aliyun deploy
- Frontend UI (delete flow, forgot pw 3-step, DOB register field, 6-cell OTP, logout backend call)

## Remaining batches (after 6.3)

- Batch 6.4: Friends (block, profile card, pending outbound), MEM-03 unsub, MARK-08 admin review, PROF-03/04 name/stats, shares table + endpoints, SHR-04 deep link, SHR-01 routes/marks in-app share — 20-30h
- Batch 6.5: Push (APNs + Firebase Admin + trigger points on friend/share, PUSH-02 in-app list, PUSH-04 permission check, SET-05 notification preferences) — 12-16h
- Batch 6.6: Apple + Google login full implementation (native rebuild required) — 10-12h
- Batch 6.7: GDPR data export (nodemailer download link, not attachment), SAF-04 cellular/wifi, SAF-05 storage keys audit, PROF-02 avatar upload — 8-10h
- Batch 6.8: IAP (RevenueCat, requires ASC approval prerequisites) — 16-20h
- Batch 6.9: A11Y-03/05, CROSS-01/02/03/05 design system unify — 20-30h
- Batch 6.10: Pre-Build gate (dev build for native module smoke test) — 4-6h
- Batch 6.12: Final verify + production EAS build — 8-12h

## User async prerequisites (pending)

- [ ] ASC create `cairn.premium.monthly` subscription NZ$5.99 → submit for review (24-48h)
- [ ] ASC create Sandbox tester account
- [ ] RevenueCat sign up + configure offering + share public API key with me
- [ ] Apple Developer portal: enable Sign In with Apple capability
- [ ] Apple Developer portal: generate APNs .p8 Auth Key
- [ ] Google Cloud Console: OAuth 2.0 Client ID for iOS bundle `com.yiiling.cairn`
- [ ] Confirm Apple Developer $99 account active + expiry date

## Backend deploy pending

- User.js `toPublic` now exposes `createdAt` — frontend "Member for X days" waits on this. Deploy with Batch 6.3.

## Deferred to Sprint 7 (post-EAS-build)

- MAP-06 marker clustering (CairnPinsLayer refactor)
- ROUTE-08 offline download UI (helper `packFromRoute` already in place)
- RUN-03 running compass
- RUN-04 Live Activity (ActivityKit widget target)
- RUN-05 pace target (brand alignment discussion)
- HIKE-03 route deviation chip (corridor code exists, needs wiring)
- Screen 4 fog PNG in Onboarding
- SHR-01 image share (react-native-view-shot native module installed, wire post-build)
- Memory tab screenshot share
- SET-02 dark mode (color token audit — dedicated sprint)
- STORE-* (icon, screenshots, descriptions, EULA, TestFlight external, dogfood)

## Sprint 7 scope (launch prep, separate)

- Legal review (EULA, ToS, Privacy Policy) — needs NZ lawyer
- Cross-border transfer decision (aliyun in China vs migrate)
- Email provider swap if Gmail 500/day hits (SendGrid/Resend/SES)
- Sentry crash reporting integration
- Kill switch / feature flag system
- Reviewer demo account seed
- FAQ static page
- Store assets (icon 1024, screenshots, descriptions, EULA)
- TestFlight external group
- Internal dogfood
- Post-launch monitoring dashboard
- Rollback playbook

## Session hygiene

- 8 commits pushed to local master (not to remote yet — user said "no OTA" but I should git push to backup)
- All commits pass `tsc --noEmit`
- No new lints introduced
- 4-eyes review only ran on Batch 6.0 (results committed). Other batches: main-agent only per user instruction "开发中小问题可调整".
- No EAS build. No OTA.
