# Launch Readiness Checklist — 2026-07-28

Target: NZ App Store launch Sept-Oct 2026. Cairn v0.2.5 (React Native + Expo). Findings only — no code changes made.

Legend: Blocker = will reject / must fix before submission. Critical = high rejection risk or user harm. Medium = should fix pre-launch. Low = post-launch cleanup.

---

## 1. App Store Review Guidelines

### 1.1 — Guideline 5.1.1(v): In-app account deletion (Blocker)
- **Status**: Blocker
- **Finding**: `SettingsScreen.tsx:1108` — "Delete account" opens a `mailto:privacy@cairnapp.nz` composer. Backend has no `DELETE /api/account` endpoint (`grep` confirms zero matches in `backend/src/routes/`).
- **Evidence**: `app/src/screens/SettingsScreen.tsx:1067-1141` (self-comments admit "backend does not yet expose a delete endpoint... routed to privacy@cairnapp.nz"). Privacy policy `backend/public/privacy.html:64` also says deletion is mailto.
- **Risk**: Apple has been rejecting mailto-only deletion since April 2022. Approval is inconsistent — many apps get rejected on first submission for this exact pattern.
- **Recommendation**: Implement `DELETE /api/account`. In-app tap → 7-day soft-delete flow → cancel window → hard-delete cron. Modal copy already scaffolded (`TypeToConfirmModal` keyword `"delete account"`).

### 1.2 — Guideline 1.2 UGC: EULA acceptance at signup (Blocker)
- **Status**: Blocker
- **Finding**: `AuthScreen.tsx:1075-1093` registers user with only a Privacy Policy checkbox. No separate EULA / objectionable-content clause. Settings "Terms of Service" row (`SettingsScreen.tsx:892`) links to Apple's stdeula, not a Cairn-specific EULA.
- **Evidence**: `SettingsScreen.tsx:893` hint says "Apple's standard app terms — a Cairn-specific version is coming".
- **Risk**: Guideline 1.2 requires EULA that prohibits objectionable content for any app accepting UGC (markers, photos, notes). Cairn accepts all three.
- **Recommendation**: Draft Cairn-specific EULA. Add second checkbox at register. Host at `/tos` on backend.

### 1.3 — Guideline 1.2 UGC: Block user (Critical)
- **Status**: Critical
- **Finding**: Report mark is wired (`MapScreen.tsx:800-806`, `markerInteractionService.ts:108-127`, backend `markers.js:389`). No "block user" mechanism found in either app or backend.
- **Evidence**: `grep -r "blockUser\|muteUser"` in `app/src` and `backend/src` = 0 matches.
- **Risk**: Guideline 1.2 requires the ability to block abusive users, not just report content.
- **Recommendation**: Add `POST /api/users/:id/block` + client "Block this user" action in MarkerDetailSheet.

### 1.4 — Guideline 1.2 UGC: Mute user (Medium)
- **Status**: Medium
- **Finding**: No mute (soft-hide) mechanism, only report + auto-hide by threshold.
- **Recommendation**: If Block is added, Mute is optional but courteous.

### 1.5 — Guideline 4.8 Sign in with Apple (Critical if Google enabled)
- **Status**: Critical (conditional)
- **Finding**: `AuthScreen.tsx:1132-1145` shows "Continue with Apple" button that displays "Coming soon" alert. "Continue with Google" (`AuthScreen.tsx:451-454`) is also a "coming soon" alert.
- **Evidence**: `authService.ts` has no Apple functions. `AuthScreen.tsx:443-454` notes Google was disabled due to sign-out crash.
- **Risk**: If Google is re-enabled before launch, 4.8 mandates Apple Sign In. If both remain "coming soon", they should NOT be visible in the UI — Apple reviewers frequently reject non-functional buttons.
- **Recommendation** (must pick one before launch):
  - (a) Hide both social login buttons entirely — email login only for v1.0.
  - (b) Implement both Apple + Google before launch.

### 1.6 — Guideline 5.1.1 Data collection: nutrition label (Blocker)
- **Status**: Blocker (missing artifact)
- **Finding**: No draft of App Store privacy nutrition label in `docs/`. `privacy.html` describes collection but is not the same as the JSON payload App Store Connect requires.
- **Recommendation**: Draft `docs/store-listing/privacy-nutrition.md` covering: Location (Precise) — App Functionality; Contact Info (Name, Email) — App Functionality, Account; User Content (Photos, Notes) — App Functionality; Diagnostics (Crash) — App Functionality, opted-in.

### 1.7 — Guideline 5.1.1(i) Purpose strings (Pass with tweak)
- **Status**: Medium
- **Finding**: `app.json:19-28` — all six iOS purpose strings present and clear. Wording is professional.
- **Issue**: `NSLocationAlwaysAndWhenInUseUsageDescription` and the duplicate one in the `expo-location` plugin (`app.json:54`) don't fully overlap. Only one is used at build time — inconsistency is a review-risk (Apple sometimes flags for the plugin one being present while the InfoPlist one is different).
- **Recommendation**: Unify the two strings word-for-word.

### 1.8 — Guideline 2.5.1 Non-public API (Pass)
- **Status**: Pass
- **Finding**: All native modules are stock Expo (SecureStore, Location, ImagePicker, Notifications) + `@rnmapbox/maps`. No custom native code detected.

### 1.9 — Guideline 3.1.1 In-app purchase (Blocker for launch strategy)
- **Status**: Blocker
- **Finding**: `PaywallSheet.tsx:8-10` explicitly notes "TestFlight-only. NO real IAP." Price hardcoded USD $4.99 (`PaywallSheet.tsx:68`).
- **Launch strategy conflict**: `project_cairn_launch_strategy` memo says NZD $5.99/mo. Two mismatches:
  1. Currency (USD → NZD)
  2. No StoreKit / RevenueCat integration
- **Evidence**: `app/src/features/memory/components/PaywallSheet.tsx:6-77`.
- **Recommendation** (must pick one before launch):
  - (a) Ship v1.0 free (no paywall UI at all) — remove PaywallSheet from user-reachable flow.
  - (b) Wire real IAP (RevenueCat recommended) with NZD product.
- **Currently the PaywallSheet is reachable in code paths** — search shows it referenced in memory feature. Must confirm it's fully unreachable in production build if going with option (a).

### 1.10 — Guideline 4.0 Design (Pass with note)
- **Status**: Medium
- **Finding**: Tap-target audit — `hitSlop` used in only 4 files across 731 `onPress` sites. Many icon-only buttons in map controls, marker sheet, hierarchy panel may be < 44pt.
- **Recommendation**: Sweep every icon-only Pressable/TouchableOpacity, add `hitSlop` where visual size < 44pt.

### 1.11 — Guideline 1.5 Business info URLs (Blocker: verify live)
- **Status**: Blocker (unverified)
- **Finding**: Privacy URL `https://api.yiiling.cn/privacy` served from backend. Support URL / Marketing URL not confirmed live.
- **Recommendation**: Confirm three URLs return 200:
  - `https://api.yiiling.cn/privacy` (privacy policy — confirmed exists in code)
  - Support URL (e.g. `https://cairnapp.nz/support` — status unknown)
  - Marketing URL (e.g. `https://cairnapp.nz` — status unknown)

### 1.12 — Guideline 5.5.4 TestFlight (Blocker: setup)
- **Status**: Blocker (unverified)
- **Finding**: `eas.json:36-49` has `preview` channel for internal distribution. No TestFlight external group configuration.
- **Recommendation**: Confirm TestFlight external group is set up in App Store Connect (`ascAppId: 6771227406` in `eas.json:68`) with minimum 10 external testers who have completed a hike.

### 1.13 — Guideline 5.1.1 Third-party SDKs disclosed (Pass)
- **Status**: Pass
- **Finding**: No third-party analytics SDK (no Sentry, Firebase, Amplitude, Mixpanel, PostHog). Only in-house telemetry to `api.yiiling.cn`. Mapbox is the only significant third party.
- **Recommendation**: Disclose Mapbox in nutrition label under "Data Not Linked to You / Location / For Third-Party Services".

---

## 2. Privacy / Compliance

### 2.1 — Privacy policy live (Critical: content vs reality mismatch)
- **Status**: Critical
- **Finding**: `backend/public/privacy.html:64` still promises deletion via mailto with 5-business-day response. If we ship in-app delete (per 1.1), copy must update. If we ship without it, we're admitting the mailto workaround in our own policy — which Apple reviewers can (and do) read.
- **Recommendation**: Sync privacy policy copy with reality on launch day.

### 2.2 — Terms of Service page not live (Blocker)
- **Status**: Blocker
- **Finding**: No `terms.html` in `backend/public/`. Only `privacy.html`.
- **Recommendation**: Create Cairn-specific ToS/EULA. Serve at `/public/terms.html`.

### 2.3 — NZ Privacy Act 2020 alignment (Medium)
- **Status**: Medium
- **Finding**: Privacy policy mentions NZ Privacy Act 2020 (`AuthScreen.tsx:393`) but does not enumerate the 13 Information Privacy Principles. Data resides in Alibaba Cloud Shanghai — cross-border transfer to a non-adequate jurisdiction requires disclosure and user consent under IPP 12.
- **Recommendation**: Add a "Cross-border transfer" section. Consider migrating to an NZ-based provider for launch, or disclose clearly.

### 2.4 — Data export mechanism (Medium)
- **Status**: Medium (GDPR request)
- **Finding**: Privacy policy says "Export: email us to request a copy" (`privacy.html:65`). No self-service.
- **Recommendation**: Add `GET /api/account/export` returning ZIP of user's sessions, markers, memory as JSON. Post-MVP acceptable.

### 2.5 — Age gating (Blocker)
- **Status**: Blocker
- **Finding**: `grep -r "13\|dateOfBirth\|ageGate"` in `app/src` returns nothing user-facing. Privacy policy says "not intended for children under 13" but signup does not enforce.
- **Risk**: With markers being shareable social content, App Store age rating and COPPA both apply.
- **Recommendation**: (a) Ask date of birth at signup, (b) reject accounts < 13, (c) set App Store age rating 12+ or 17+ accordingly.

### 2.6 — Analytics disclosure (Medium)
- **Status**: Medium
- **Finding**: `useSettingsStore.ts:54` defaults `telemetryUploadEnabled: true` — every session's JSONL is auto-uploaded without a first-run consent screen. Privacy policy says "only when you have opted in via Settings" (`privacy.html:37`) — this contradicts the default.
- **Evidence**: `useSettingsStore.ts:54,57-60`, `privacy.html:37`.
- **Risk**: Direct contradiction between stated policy and code behavior. Any regulator or App Store reviewer who diffs the two will flag it.
- **Recommendation** (must pick one):
  - (a) Change default to `false` and add opt-in prompt at first launch.
  - (b) Change privacy policy to say "on by default, toggleable in Settings".

### 2.7 — Location retention policy (Medium)
- **Status**: Medium
- **Finding**: No stated retention period for location data. `privacy.html` does not specify.
- **Recommendation**: State a limit (e.g. "session location retained until you delete the hike or delete your account").

### 2.8 — Cookie policy for backend web (Low)
- **Status**: Low
- **Finding**: Backend serves `privacy.html` but no cookies set (JWT is in header). Not applicable.

---

## 3. Crash / Stability

### 3.1 — React ErrorBoundary not mounted (Blocker)
- **Status**: Blocker
- **Finding**: `app/src/components/ErrorBoundary.tsx` exists (class component with `getDerivedStateFromError` + `componentDidCatch`), but `grep "ErrorBoundary"` returns only its own definition — it is never imported. `App.tsx:674-676` renders `<SafeAreaProvider><AppRoot /></SafeAreaProvider>` with no boundary.
- **Evidence**: `app/App.tsx:674-676`; `app/src/components/ErrorBoundary.tsx:29` (defined, unused).
- **Risk**: Any render error in a screen → white screen or native crash instead of graceful recovery.
- **Recommendation**: Wrap `<AppRoot />` in `<ErrorBoundary>`. Add per-screen boundaries around HikingMap, MemoryScreen (heavy Mapbox).

### 3.2 — No third-party crash reporter (Medium)
- **Status**: Medium
- **Finding**: `crashLogger.ts` is in-house and uploads on next launch via telemetry endpoint. This is functional but has gaps: (a) fatal native crashes leave no JS breadcrumb, (b) upload depends on `/api/telemetry/sessions` being reachable — no fallback to a hosted service.
- **Recommendation**: Consider Sentry or Bugsnag for launch — even a free tier catches native crashes that in-house cannot.

### 3.3 — Crash upload before app dies (Pass)
- **Status**: Pass
- **Finding**: `crashLogger.ts:57-63` persists to AsyncStorage before app dies, uploads on next boot from `App.tsx:315`. Design is sound.

### 3.4 — Unhandled promise rejection coverage (Pass)
- **Status**: Pass
- **Finding**: `crashLogger.ts:15-18` handles both `ErrorUtils.setGlobalHandler` and unhandled promise rejections. Comment at line 96 confirms `setGlobalHandler` present.

### 3.5 — Retry backoff on crash-loop (Medium)
- **Status**: Medium
- **Finding**: No crash-loop guard. If v0.2.5 boots, crashes, user reopens, boots, crashes → infinite loop with no fallback (safe mode).
- **Recommendation**: On 3rd consecutive boot with no `crashLogger.breadcrumb('app_boot_complete')`, drop into a minimal fallback screen ("Something went wrong. Sign out to reset").

### 3.6 — Fatal crash logging path (Pass)
- **Status**: Pass
- **Finding**: `crashLogger.ts:69-92` builds synthetic session JSONL for the crash — good design.

### 3.7 — Console/debug artifacts in prod (Pass)
- **Status**: Pass
- **Finding**: Only 4 `console.log` in `app/src` (2 in tests). 3 TODO/FIXME markers. Codebase is clean.

---

## 4. Performance

### 4.1 — Initial JS bundle size (unmeasured)
- **Status**: Medium
- **Finding**: No bundle size gate in CI. `newArchEnabled: true` (`app.json:9`) is on — good for perf.
- **Recommendation**: Run `npx expo export --platform ios` and confirm main bundle < 4 MB gz.

### 4.2 — Heavy render in HikingMap / MemoryScreen (unknown)
- **Status**: Medium
- **Finding**: 45 files use `useMemo`/`memo`/`useCallback` — reasonable coverage. Not audited for missing memoization.
- **Recommendation**: Enable React DevTools Profiler on TestFlight build, check frame drops on map pan.

### 4.3 — Image asset optimization (unmeasured)
- **Status**: Medium
- **Finding**: `assets/icon.png` and `splash-icon.png` present but sizes unaudited. No @2x/@3x variants in `assets/` root — Expo generates from single icon.
- **Recommendation**: Confirm icon.png is 1024x1024 PNG. Splash < 500 KB.

### 4.4 — Battery drain during tracking (unmeasured)
- **Status**: Medium (must measure)
- **Finding**: `UIBackgroundModes: [location, audio]` (`app.json:25-28`) — both battery-costly. Background location + audio ducking (`App.tsx:422`) run during hikes.
- **Recommendation**: Instrument battery draw on 2h hike → target < 15%/hr on iPhone 15.

### 4.5 — Memory usage on 100+ sessions (unmeasured)
- **Status**: Medium
- **Finding**: Session list lives in Zustand; large history could balloon. `hikeTracksCache` has size cap (`SettingsScreen.tsx:21` comment).
- **Recommendation**: Load-test with 200 hikes; confirm memory footprint < 300 MB active.

---

## 5. Accessibility (Apple HIG)

### 5.1 — accessibilityLabel coverage (Blocker)
- **Status**: Blocker
- **Finding**: Only 3 files use accessibility props (`SettingsScreen.tsx`, `HierarchyPanel.tsx`, `ContentStep.tsx`). Hundreds of interactive elements have no label.
- **Recommendation**: Full sweep — every Pressable, TouchableOpacity, icon-only button needs `accessibilityLabel` + `accessibilityRole`.

### 5.2 — 44pt tap targets (Critical)
- **Status**: Critical
- **Finding**: Only 4 files use `hitSlop`. Many icon-only buttons in map controls likely < 44pt.
- **Recommendation**: See 1.10. Same fix.

### 5.3 — Dynamic Type support (Medium)
- **Status**: Medium
- **Finding**: `App.tsx:631-643` sets a global font style but does NOT preserve `allowFontScaling`. Default RN behavior allows scaling but many pixel-based `fontSize` values will overflow.
- **Recommendation**: Audit long-text screens (SettingsScreen, MarkerDetail) at 200% Dynamic Type.

### 5.4 — VoiceOver reading order (unmeasured)
- **Status**: Medium
- **Finding**: Untested with real VoiceOver.
- **Recommendation**: One-hour VoiceOver walkthrough of primary flow (sign-in → home → start hike → save → view memory).

### 5.5 — Color contrast (unmeasured)
- **Status**: Medium
- **Finding**: Secondary text tone (`Colors.textSecondary`) not audited against WCAG AA. `#888` on `#faf7f0` = ~3.9:1 — fails AA for body text.
- **Recommendation**: Run all text colors through WebAIM contrast checker.

### 5.6 — Screen reader state announcements (Medium)
- **Status**: Medium
- **Finding**: No `AccessibilityInfo.announceForAccessibility` usage detected.
- **Recommendation**: Announce state changes during hiking (auto-pause, GPS lost, session saved).

---

## 6. Internationalization

### 6.1 — No i18n at all (Medium)
- **Status**: Medium
- **Finding**: `expo-localization` is in `app.json:82` plugins but never imported in `src/`. No `i18n`/`useTranslation` usage. All strings are English literals.
- **Recommendation** (for NZ launch, English is acceptable):
  - Ship v1.0 English-only.
  - Set foundation: extract strings to a `strings.ts` file so v1.1 can add locales.

### 6.2 — Te Reo Māori (Medium — NZ market)
- **Status**: Medium
- **Finding**: One "Ngā mihi nui" in privacy footer (`privacy.html:79`). No Māori place names or interface strings.
- **Recommendation**: Post-launch v1.1 — add Māori for greetings, landmarks, and toast messages. NZ users appreciate.

### 6.3 — Metric/Imperial (unknown)
- **Status**: Medium
- **Finding**: Not audited whether distance display respects locale.
- **Recommendation**: Confirm NZ default = metric (km, m).

### 6.4 — Date/time locale (Medium)
- **Status**: Medium
- **Finding**: No `Intl.DateTimeFormat` usage found — likely uses `toLocaleDateString` with device locale which is acceptable, but not verified.

### 6.5 — Currency display (Blocker — see 1.9)
- **Status**: Blocker
- **Finding**: PaywallSheet displays "$4.99" without currency code (`PaywallSheet.tsx:68`). Assumed USD.
- **Recommendation**: If paywall ships, use `NZ$5.99` or "NZD 5.99/mo".

---

## 7. Analytics / Telemetry

### 7.1 — Event taxonomy documented (Medium)
- **Status**: Medium
- **Finding**: `services/routing/editAnalytics.ts` exists but no cross-app event dictionary in `docs/`. `crashLogger.breadcrumb` used extensively (~30 sites in App.tsx alone) but breadcrumb strings are ad-hoc.
- **Recommendation**: Document event catalog in `docs/analytics/events.md`.

### 7.2 — User consent for analytics (Critical — see 2.6)
- **Status**: Critical
- **Finding**: See 2.6 above — telemetry defaults ON while privacy policy says opt-in.

### 7.3 — PII exclusion (Pass)
- **Status**: Pass
- **Finding**: crashLogger persists stack + breadcrumbs, no explicit PII. Backend logs auth events — needs sampling review.

### 7.4 — Funnel events (Medium)
- **Status**: Medium
- **Finding**: No install → auth → first-hike → save funnel event chain visible. `crashLogger.breadcrumb('app_boot')` at boot but no `funnel:*` events.
- **Recommendation**: Instrument 5-step funnel for launch retention analysis.

---

## 8. Backend Readiness

### 8.1 — Health endpoint (Pass)
- **Status**: Pass
- **Finding**: `backend/src/index.js:76` `GET /health`.

### 8.2 — Rate limiting (Pass)
- **Status**: Pass
- **Finding**: `express-rate-limit` on auth, telemetry, edit-diag, markers (like + report separately). Good coverage.

### 8.3 — Helmet + CORS (Pass)
- **Status**: Pass
- **Finding**: `index.js:29` helmet, `index.js:35` cors with allowlist.

### 8.4 — JWT rotation (Medium)
- **Status**: Medium
- **Finding**: 7d JWT lifetime (`backend/src/config/jwt.js:7`). Refresh endpoint at `auth.js:298` but not a refresh-token rotation scheme — just re-signs same payload.
- **Recommendation**: For post-launch, add refresh tokens with rotation on use.

### 8.5 — Idempotency keys (Pass)
- **Status**: Pass
- **Finding**: 8 client files use idempotency keys; backend session/marker upserts respect them.

### 8.6 — DB backup strategy (Blocker)
- **Status**: Blocker
- **Finding**: No `mysqldump`/backup config in `docker/docker-compose.yml`. No cron backup script found.
- **Evidence**: `docker/docker-compose.yml:56` only `restart: unless-stopped`.
- **Recommendation**: Add nightly `mysqldump` cron pushing to Alibaba OSS bucket. Verify restore procedure before launch.

### 8.7 — Monitoring / uptime (Medium)
- **Status**: Medium
- **Finding**: No monitoring config visible in repo. `/health` endpoint exists but no external pinger configured.
- **Recommendation**: Set up UptimeRobot or Alibaba Cloud Monitor on `/health`. Alert on 3 consecutive failures.

### 8.8 — CDN for static assets (Low)
- **Status**: Low
- **Finding**: `privacy.html` served directly from `backend/public/`. Fine for v1.0.

### 8.9 — Cron behavior in tests (Pass)
- **Status**: Pass
- **Finding**: `DISABLE_CRON` env flag (`.env.example:19`) allows disabling schedulers.

### 8.10 — Auth brute-force protection (Pass with gap)
- **Status**: Medium
- **Finding**: `auth.js:197` intentionally wastes bcrypt time on non-existent users (timing attack mitigation — good). Rate limit on login. No account lockout after N failures.
- **Recommendation**: Add lockout after 10 failed logins/24h.

---

## 9. Store Listing Prep

### 9.1 — App icon (Blocker: unverified)
- **Status**: Blocker (unverified)
- **Finding**: `app.json:7` points at `./assets/icon.png`. File exists. Sizes / rendering unverified.
- **Recommendation**: Confirm 1024x1024 PNG, no transparency, no rounded-corner pre-baked.

### 9.2 — Screenshots (Blocker)
- **Status**: Blocker
- **Finding**: No `docs/store-listing/screenshots/` directory. Required: 6.7" (iPhone 15 Pro Max), 6.5" (iPhone 11 Pro Max), 5.5" (SE 2nd gen fallback).
- **Recommendation**: Produce 5 screenshots per size showing: (1) home/hero, (2) hiking map, (3) plant a cairn, (4) memory / fog reveal, (5) settings/privacy.

### 9.3 — App description (Blocker)
- **Status**: Blocker
- **Finding**: No drafted `docs/store-listing/description.md`.
- **Recommendation**: Draft with hook (first 3 lines matter), feature list, NZ-specific angle (Te Reo, DOC tracks).

### 9.4 — Keywords (Medium)
- **Status**: Medium
- **Recommendation**: Research: hiking, tramping (NZ term!), GPS tracker, trail journal, footprints, waypoint, cairn.

### 9.5 — Category (Medium)
- **Status**: Medium
- **Recommendation**: Primary: Health & Fitness. Secondary: Navigation. (Not Travel — Travel is competitive and less about the activity.)

### 9.6 — Age rating (Blocker: see 2.5)
- **Status**: Blocker
- **Finding**: Depends on age-gate resolution. If UGC visible to others → 12+ minimum.

### 9.7 — Support URL live (Blocker: see 1.11)

### 9.8 — Marketing URL (Medium)
- **Status**: Medium
- **Finding**: Optional field, but recommended for the story-driven positioning.

---

## 10. OTA Rollout Strategy

### 10.1 — Update channels per env (Pass)
- **Status**: Pass
- **Finding**: `eas.json` defines `development`, `preview`, `production` channels.

### 10.2 — Staged rollout % (Blocker)
- **Status**: Blocker (missing)
- **Finding**: No `expo-updates` percentage rollout config. Every OTA hits 100% of users.
- **Risk**: One bad OTA breaks every install (v0.2.5 has had multiple mid-cycle OTAs per lessons).
- **Recommendation**: Enable EAS Update rollout percentage — start 10%, expand over 24h if no crash signal.

### 10.3 — Emergency rollback (Medium)
- **Status**: Medium
- **Finding**: `expo-updates` supports rolling back by republishing prior manifest. No runbook in `docs/`.
- **Recommendation**: `docs/runbook/ota-rollback.md` — one command line for emergency.

### 10.4 — Version pinning for critical updates (Medium)
- **Status**: Medium
- **Finding**: `runtimeVersion.policy: "appVersion"` (`app.json:90-92`) ties OTA to native binary version. Good default.

### 10.5 — Users on old binary — force update path (Medium)
- **Status**: Medium
- **Finding**: `OtaBadge.tsx` prompts to reload when new OTA available. No mechanism to force minimum binary version.
- **Recommendation**: Add `min_binary_version` field to `/api/health` — client compares and shows "Please update from App Store" if below.

---

## 11. Data Migration / User Upgrade

### 11.1 — Zustand persist versioning (Blocker)
- **Status**: Blocker
- **Finding**: Only 1 file (`useMemorySettingsStore.ts`) uses `persist(...)`. `useSettingsStore.ts:109-165` has custom hydrate/persist logic with hand-rolled migration flags (`__v408_wifionly_migrated`). No systematic `version` field.
- **Recommendation**: For every persisted store, adopt Zustand's `persist` middleware with `{ version: N, migrate: (persistedState, version) => ... }`.

### 11.2 — Old sim-walker data cleanup (Medium)
- **Status**: Medium
- **Finding**: `HikingScreen.tsx:1224` renders sim-walker overlay unconditionally (v430 removed __DEV__ gate). If sim-walker sessions are persisted, they'll appear alongside real hikes.
- **Recommendation**: Confirm sim-walker sessions are tagged and excluded from public/history views. Or hide the overlay in production build.

### 11.3 — Migration test coverage (Medium)
- **Status**: Medium
- **Finding**: `app/src/store/__tests__/backCompat.test.ts` exists — some coverage.
- **Recommendation**: Add explicit "upgrade from v0.2.0 → v0.2.5" test per store.

---

## 12. Security

### 12.1 — API keys in bundle (Pass with note)
- **Status**: Medium
- **Finding**: `EXPO_PUBLIC_MAPBOX_TOKEN` is baked into the JS bundle (Expo convention for public keys). If Mapbox token is not URL-restricted, it can be extracted and abused.
- **Recommendation**: In Mapbox console, restrict token to Cairn's bundle IDs (`com.yiiling.cairn` iOS, `com.cairn.app` Android).

### 12.2 — Backend secrets template (Pass)
- **Status**: Pass
- **Finding**: `.env.example` uses placeholders. `.gitignore` covers `.env`.

### 12.3 — HTTPS enforced (Pass)
- **Status**: Pass
- **Finding**: `api.yiiling.cn` HTTPS. No `NSAllowsArbitraryLoads` exception.

### 12.4 — Certificate pinning (Low)
- **Status**: Low
- **Finding**: No cert pinning. Reasonable for a v1.0 hiking app; MITM is not a target-user threat.

### 12.5 — SecureStore for tokens (Pass)
- **Status**: Pass
- **Finding**: `tokenStore.ts` and `credentialsStore.ts` both use `expo-secure-store` (Keychain on iOS). Confirmed clean.

### 12.6 — Deep link URL scheme (Pass)
- **Status**: Pass (nothing to collide)
- **Finding**: No custom URL scheme registered in `app.json`. No universal links either — that's a feature gap, not a security gap.

### 12.7 — DebugScreen reachable in prod (Medium)
- **Status**: Medium
- **Finding**: `RootNavigator.tsx:97` registers `DebugScreen` without `__DEV__` gate. Reachable via `Settings > Open Debug screen` after 5-tap gesture on About row (`SettingsScreen.tsx:980`).
- **Recommendation**: Debug screen exposes internal telemetry URL override + API key input — Apple reviewers who find it may flag. Consider hiding entirely in `Constants.appOwnership === 'standalone'`.

### 12.8 — Playwright bypass fully __DEV__ gated (Pass)
- **Status**: Pass
- **Finding**: `utils/devFlags.ts:12` gates on `__DEV__`. Comment confirms Hermes minifier dead-code-eliminates in production.

---

## Blocker Summary (must fix before submission)

| ID | Guideline | Description | File:Line |
|----|-----------|-------------|-----------|
| L-01 | AppStore 5.1.1(v) | mailto-only account deletion; no `DELETE /api/account` | SettingsScreen.tsx:1108; backend/src/routes (missing) |
| L-02 | AppStore 1.2 (UGC) | No Cairn-specific EULA; Terms row points at Apple stdeula | SettingsScreen.tsx:892; AuthScreen.tsx:1075 |
| L-03 | AppStore 4.8 | "Continue with Apple" + "Continue with Google" both non-functional UI buttons | AuthScreen.tsx:1132-1145, 451-454 |
| L-04 | AppStore 5.1.1 | Privacy nutrition label not drafted | docs/store-listing (missing) |
| L-05 | AppStore 3.1.1 | Paywall UI shows USD $4.99 but no real IAP; strategy says NZD $5.99 | PaywallSheet.tsx:6-77 |
| L-06 | AppStore 1.5 | Support/Marketing URLs not confirmed live | (external) |
| L-07 | AppStore 5.5.4 | TestFlight external group not confirmed | ASC dashboard |
| L-08 | Privacy | Cairn-specific Terms of Service not hosted | backend/public/terms.html (missing) |
| L-09 | Privacy / COPPA | No age-gate at signup | AuthScreen.tsx (no dob field) |
| L-10 | Stability | ErrorBoundary defined but never mounted | App.tsx:674-676; components/ErrorBoundary.tsx |
| L-11 | Accessibility | Only 3 files have accessibilityLabel across ~50 screens | app/src (systemic) |
| L-12 | Backend | No automated DB backup config | docker/docker-compose.yml |
| L-13 | Store listing | App icon 1024x1024 not verified | assets/icon.png |
| L-14 | Store listing | Screenshots not produced | docs/store-listing (missing) |
| L-15 | Store listing | App description not drafted | docs/store-listing (missing) |
| L-16 | Store listing | Age rating depends on L-09 | ASC questionnaire |
| L-17 | OTA | No staged rollout % | eas.json |
| L-18 | Data | No systematic Zustand persist versioning | app/src/store (multiple) |

## Critical Summary

| ID | Description | File:Line |
|----|-------------|-----------|
| C-01 | Guideline 1.2 — no "block user" mechanism | app/src, backend/src (missing) |
| C-02 | Guideline 4.0 — hitSlop used in only 4/731 onPress sites | (systemic) |
| C-03 | Privacy contradiction — telemetry default ON, policy says opt-in | useSettingsStore.ts:54 vs privacy.html:37 |
| C-04 | Privacy policy still promises mailto delete with 5-day SLA | privacy.html:64 |
| C-05 | Analytics consent tied to C-03 | (systemic) |

## Medium Summary

| ID | Description | File:Line |
|----|-------------|-----------|
| M-01 | Purpose string mismatch between InfoPlist and expo-location plugin | app.json:20 vs :54 |
| M-02 | No third-party crash reporter | crashLogger.ts (in-house only) |
| M-03 | No crash-loop guard / safe-mode fallback | App.tsx boot flow |
| M-04 | Bundle size / heavy render / battery unmeasured | (needs measurement) |
| M-05 | No i18n foundation; strings inline | app/src (all screens) |
| M-06 | Te Reo Māori not present in UI | (post-launch OK) |
| M-07 | Metric/imperial locale not verified | (needs measurement) |
| M-08 | Date/time locale not verified | (needs measurement) |
| M-09 | Event taxonomy undocumented | docs/analytics (missing) |
| M-10 | No install → activation funnel events | crashLogger breadcrumbs only |
| M-11 | JWT refresh not rotation-based | backend/src/config/jwt.js:7 |
| M-12 | No monitoring / uptime pinger configured | (external) |
| M-13 | No account lockout after failed logins | backend/src/routes/auth.js |
| M-14 | Data export mechanism email-only | privacy.html:65 |
| M-15 | Location retention period unstated | privacy.html |
| M-16 | Dynamic Type not audited | App.tsx font patch |
| M-17 | VoiceOver reading order untested | (needs audit) |
| M-18 | Color contrast unaudited (esp. textSecondary #888 on #faf7f0) | app/src/config (Colors) |
| M-19 | No screen-reader state announcements | app/src (systemic) |
| M-20 | Sim-walker overlay always on (v430 removed __DEV__ gate) | HikingScreen.tsx:1224 |
| M-21 | DebugScreen reachable in prod via 5-tap gesture | RootNavigator.tsx:97 |
| M-22 | Mapbox token restriction to bundle IDs not verified | Mapbox console |
| M-23 | OTA emergency rollback runbook missing | docs/runbook (missing) |
| M-24 | No force-update path from old binary | OtaBadge.tsx |
| M-25 | Zustand persist migration test coverage thin | backCompat.test.ts |
| M-26 | NZ Privacy Act — cross-border transfer not enumerated | privacy.html |

## Low / Non-blocking

- L-a: Deep-link scheme not registered — universal links could be added post-launch for share-a-cairn.
- L-b: CDN for static assets — v1.0 acceptable served from backend `/public`.
- L-c: Cert pinning — reasonable to skip for v1.0.
- L-d: Cookie policy — no cookies used, skip.

## Fields I couldn't determine (need user input)

- App icon final rendering (need to open assets/icon.png at 1024x1024)
- TestFlight external group status (App Store Connect dashboard)
- Screenshot production status
- Store listing copy status
- Marketing URL, Support URL live status
- Whether PaywallSheet is reachable in the production build (need runtime trace)
- Battery draw, bundle size, memory footprint (need physical device measurement)
- Whether telemetry backend `api.yiiling.cn` is monitored externally
- DB backup / restore runbook state
- Mapbox token URL restriction status

---

Total items: 81 (18 Blocker + 5 Critical + 26 Medium + 4 Low + 22 unverified/measurement + 6 unknowns needing user input).
