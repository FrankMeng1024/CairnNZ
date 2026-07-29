# Batch 6.10 — Pre-Build Gate Checklist

Sprint 6 introduces THREE new native modules that require a fresh EAS
build (not just an OTA update). This checklist must pass before the
build is submitted to TestFlight / Play Console.

**Do not run `eas build` autonomously — user has to explicitly authorise.**

## New native dependencies added this sprint

| Package | Batch | Why native | Env / config needed at build time |
|---|---|---|---|
| `expo-apple-authentication@~8.0.7` | 6.6 | iOS SDK — Sign in with Apple entitlement | Xcode capability + APPLE_BUNDLE_ID on backend |
| `react-native-purchases@^8.9.0` | 6.8 | StoreKit + Play Billing bridging | EXPO_PUBLIC_REVENUECAT_IOS_KEY + EXPO_PUBLIC_REVENUECAT_ANDROID_KEY in eas.json / .env |
| `expo-notifications` (already installed, first real use) | 6.5 | APNs + FCM registration | APNs auth key uploaded to Expo credentials; EAS_PROJECT_ID |

## Pre-Build checklist (all must PASS)

### 1. Version bump
- [ ] `app.json` version incremented from current O18 → O19 (or next label)
- [ ] `app.json` iosBundleId / androidPackage matches APPLE_BUNDLE_ID env value
- [ ] `expo prebuild --clean` runs without warnings

### 2. Native module smoke tests
- [ ] `require('expo-apple-authentication').isAvailableAsync()` returns true on iOS device
- [ ] `require('react-native-purchases').default.configure(...)` doesn't throw
- [ ] `require('expo-notifications').getExpoPushTokenAsync({ projectId })` returns a valid token

### 3. Backend env values on aliyun
- [ ] `APPLE_BUNDLE_ID` set in `cairn-backend` docker env (POST /api/auth/apple currently returns 500 "not configured")
- [ ] `EXPO_PUSH_ACCESS_TOKEN` set — until then push drain runs in "dropped_no_transport" fallback mode
- [ ] `PUBLIC_API_BASE_URL` set to production URL — data-export download links get built with `req.protocol + req.get('host')` if missing, which can be wrong behind a proxy

### 4. Third-party console setup (user must complete before build ships)
- [ ] Apple Developer: Sign in with Apple capability added to the App ID
- [ ] App Store Connect: subscription products (memory_pro monthly + annual) created + submitted for review
- [ ] RevenueCat dashboard: products linked, entitlement `memory_pro` mapped, public keys copied into eas.json
- [ ] Apple Developer: APNs auth key downloaded + uploaded to Expo `credentials`
- [ ] Firebase project created + FCM server key added to Expo `credentials` (Android)

### 5. Smoke test after the EAS build lands on device
- [ ] Cold-boot → hydrate → HomeScreen renders (no regression from Batch 6.3 hydrate rewrite)
- [ ] Register new account → age gate blocks 12-year-old DOB → allows 14+
- [ ] Sign in with Apple → account created → hydrate to Home
- [ ] Trigger a friend request → recipient device receives push (real APNs)
- [ ] Request /api/account/export → email arrives with link → download JSON
- [ ] Paywall Subscribe → sandbox purchase → memory_pro entitlement flips on
- [ ] VoiceOver traversal: Home → Hiking → Save → returns to Home without dead ends

### 6. Rollback plan
If any critical bug found post-build:
- [ ] OTA-only fixes possible via Sprint 6 OTA channel (JS changes)
- [ ] Native module regression requires re-build — allow 30 min per iteration
- [ ] Backend can be rolled back via docker image tag on aliyun

## What ships in this build

All Batch 6.0–6.9 work:
- 6.0 Onboarding + permission modals
- 6.1 MarkerDetail parity + auto-lap toast + MapHistory filter chip
- 6.2 SHR-01 text share + SHR-02 GPX honesty
- 6.3 Auth 4-piece (soft-delete + password reset + jti revocation + age gate)
- 6.4 Friends block + outbound + profile card
- 6.5 Push notifications infrastructure
- 6.6 Sign in with Apple (real)
- 6.7 GDPR data export
- 6.8 IAP RevenueCat wrapper
- 6.9 A11Y helpers + shadow tokens

Plus non-Sprint bug fixes:
- Hydrate merge preserves local pending sessions (root cause of "新疆菜" / "round" disappearing)
- HomeScreen pending banner uses filesystem `pendingSyncStore` as tie-breaker
- authenticatedFetch + saveHikeAtomic full network diagnostics logging

## When to run `eas build`

- USER TRIGGER ONLY. Do not run autonomously.
- Preferred sequence:
  1. User confirms all Section 4 (third-party console) items complete
  2. Run `eas build --profile production --platform ios` and separately for android
  3. Wait for build completion (typically 15-30 min per platform)
  4. Test on TestFlight / internal Play track
  5. Run Section 5 smoke tests
  6. If PASS → submit for review
