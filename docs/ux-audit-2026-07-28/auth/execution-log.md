# auth — Playwright Execution Log

## Environment note
- `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true` is active on dev server (env confirmed via `process.env`)
- Result: AuthScreen (splash/login/register/verify/welcome) is NEVER shown on web — app boots directly into Home
- `window.__cairnStores` also NOT exposed in this build (verified via `browser_evaluate`)
- Consequence: S01-S38 auth scenarios that require AuthScreen views (splash animation, sign in view, register form, verify code, welcome screen, Apple/Google buttons) are **not testable via web Playwright with current server config**

## Scenarios attempted

## Scenario S01 (splash cold boot): fail
- Step: NAVIGATE http://localhost:8086/ with cleared localStorage
- Reason: Bypass mode routes directly to Home. No AuthScreen rendered.
- Evidence: screenshots/S01-splash-bypassed.png shows Home page instead of splash

## Recommendation
To audit AuthScreen via web:
1. Kill dev server
2. Restart WITHOUT `EXPO_PUBLIC_PLAYWRIGHT_BYPASS` env var
3. Re-run auth AUDIT scripts
4. All 38 scenarios then runnable

## Scenarios S02-S38: skip
- Reason: same as S01 — AuthScreen unreachable while bypass is active
- Auditor's static-source-read findings in AUDIT.md remain valid; live verification blocked on bypass config
