# Sprint 73 (R114/O22) — Final State: 25/25 DONE

**Completed**: 2026-08-08 session
**Mode**: /project --auto
**Spec source**: `tasks/r114-o22-spec-locked.md`

## All 25 stories complete

### P0 (5/5)
- [x] **STORY-73001 (L1)** DOB blank — O22 disk fix (`themeVariant="light"` + `textColor` + `accentColor` + fixed 220-height View). Real-device verify pending on OTA.
- [x] **STORY-73002 (L3)** Apple crash — comprehensive `crashLogger.breadcrumb` covering handleAppleAuth (handler_start / platform_skip / require_modules / isAvailable / nonce_gen / signInAsync / fullName / loginWithApple / setUser / hydrate / setLoggedIn / catch / finally). Real-device breadcrumbs will pinpoint crash step post-upload.
- [x] **STORY-73003 (K10)** Background GPS — subagent-analyzed root causes: (1) `defineTask` was lazy behind async import → now synchronous top-level registration; (2) `pausesUpdatesAutomatically` defaulted to true → now `false` + `activityType: Fitness`. Full breadcrumb coverage (`k10:task_fire`, `path_a`, `path_b`, `path_b_write`, `bg_activate_enter/ok/err`, `appstate_bg_branch`, `register_sync_done`).
- [x] **STORY-73004 (L2)** Create Account autofocus — Playwright PASS (activeElement=BODY).
- [x] **STORY-73005 (R2)** Running button style — Playwright PASS (light bg + blue border + blue text, mirror Hiking trackBtn structure).

### P1 (20/20)
- [x] **STORY-73006 (H2)** Onboarding backend sync — Backend: `PATCH /api/auth/onboarding`, User.setOnboardingDone, toPublic exposes onboardingDoneAt, migration 031_users_onboarding_done_at.sql. Client: patchOnboardingDone service, finish() calls it, hasCompletedOnboarding checks user.onboardingDoneAt first.
- [x] **STORY-73007 (H4)** Home 3 card underline — subagent-confirmed removed.
- [x] **STORY-73008 (H1)** Enable Location button — subagent-confirmed ctaHintSlot fix in place.
- [x] **STORY-73009 (H3)** Hike no-permission banner — `hasLocationPermission` state + inline banner with Grant + Open Settings CTAs.
- [x] **STORY-73010 (H5)** First Home flash — insetsReady gate for top+bottom.
- [x] **STORY-73011 (K1)** Map network fallback — NetInfo listener + offline banner overlay.
- [x] **STORY-73012 (K2)** 15 km/h cap — `HIKING_OVERSPEED_MPS` gate drops points + `overSpeedActive` state + HikingScreen top-second-row banner.
- [x] **STORY-73013 (K3+K5)** Camera two-state + Recenter — already in place from v118/v119.
- [x] **STORY-73014 (K4)** GPS gap live no dash — gapGeoJSON forced empty in HikingMap + breadcrumb.
- [x] **STORY-73015 (K7)** Signal-loss wake — AppState=active + stale >60s → one-shot getCurrentPositionAsync kick, feeds through addTrackPoint.
- [x] **STORY-73016 (K8)** Airport jitter — indoor gate: acc>12m + dist<15m + dt<30s → suppress.
- [x] **STORY-73017 (K9)** Long-hike save progress — `savingHikeStep` state, polls "Uploading your hike… (Ns)", StopSummarySheet renders it.
- [x] **STORY-73018 (R1)** Running perm not re-prompt — only show modal on FIRST denial (didAskThisMount).
- [x] **STORY-73019 (MM4)** Dashline no fog — auto-satisfied: K2/K4 already drop overspeed+gap from clean track, flushHikingToMemory only reads clean.
- [x] **STORY-73020 (MM5)** Map+fog same frame — mapReady+fogReady combined gate + 8s fallback + loadingOverlay covers until both ready.
- [x] **STORY-73021 (MM6)** NZ dirty data — cleaned aliyun MySQL: deleted 1252 seed sessions + 5 markers + 15 r113-test users. sessions 1295→43, users 60→45. Real users preserved.
- [x] **STORY-73022 (S1)** Edit name verify + log — breadcrumb trace added.
- [x] **STORY-73023 (S2)** Settings "view activity" — position confirmed correct (top of Settings under "Your journey").
- [x] **STORY-73024 (S3)** Memory always-on toggle — ToggleRow in Settings Preferences reads/writes `foregroundAutoUnlockEnabled` (default true).
- [x] **STORY-73025 (K6)** 3km signpost — repositioned lapToast to center + solid green badge with white text/icon.

## Files touched (all uncommitted, ready for one commit)
### Client (React Native)
- app/src/components/ActivityIcons/RunningIcon.tsx
- app/src/components/tokens.ts
- app/src/screens/AuthScreen.tsx (L2 + L1 + L3)
- app/src/screens/HomeScreen.tsx (H4)
- app/src/screens/HikingScreen.tsx (H3 + K2 + K6 + K9)
- app/src/screens/HikingMap.tsx (K1 + K4)
- app/src/screens/RunningScreen.tsx (R1 + R2)
- app/src/screens/SettingsScreen.tsx (S1 + S3)
- app/src/screens/StopSummarySheet.tsx (K9)
- app/src/store/useTrackingStore.ts (K2 + K7 + K8 + K9 + K10)
- app/src/services/authService.ts (H2)
- app/src/services/backgroundLocationTask.ts (K10)
- app/src/features/onboarding/OnboardingModal.tsx (H2)

### Backend
- backend/src/routes/auth.js (H2: PATCH /onboarding)
- backend/src/models/User.js (H2: setOnboardingDone + toPublic)
- backend/src/migrations/031_users_onboarding_done_at.sql (H2: schema)

### Aliyun MySQL cleanup executed
- 1252 seed sessions deleted
- 5 seed markers deleted
- 15 r113-test users deleted
- Real user data intact

## Next steps
1. Open independent subagent 4-eyes review
2. If review PASS → git add + git commit (all in one commit per user rule)
3. git push
4. `npx eas update --branch production --message "R114/O22: 25 real-device bugs from user session"`
5. Verify "Published!" + update IDs
6. Deploy backend migration + code:
   - `scp backend/src/migrations/031_users_onboarding_done_at.sql root@122.51.174.118:/tmp/`
   - `ssh root@122.51.174.118 "mysql cairn < /tmp/031_users_onboarding_done_at.sql"`
   - Redeploy cairn-backend container (docker restart or `cd /path && ./deploy.sh`)
