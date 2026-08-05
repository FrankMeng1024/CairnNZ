# R113 Round 1 — Honest Status Report (2026-08-05)

## What was accomplished

### 1. Infrastructure restore (COMMITTED, not pushed)

Commit `1f43ed5` on master, local only per user rule "非最终 round 禁 OTA":

- **`app/.env`**: `EXPO_PUBLIC_API_BASE_URL` changed from `http://localhost:3001` to `https://api.yiiling.cn` (user rule: yiiling backend always).
- **`app/App.tsx`**: Restored `__cairnStores` global exposure (7 stores: tracking, session, memory, offlineQueue, hikeWriter, hikeCache, pendingSync). `Platform.OS === 'web'` gated. Original removed in O11 T1 (commit 6bb108e).
- **`app/src/navigation/RootNavigator.tsx`**: Restored `navigationRef` + onReady stores hook. Same web-only guard.
- **`app/.gitignore`**: Added `dist-web/`.
- **`scripts/r113/smoke.js`**: Playwright smoke script — verifies all hooks exposed.
- **`tasks/round-state.md`**: Full compact-recovery state doc.

### 2. Test bench proven working

Smoke test on `http://localhost:8082` (dist-web) hitting `https://api.yiiling.cn`:

```
hasStores: true
storeKeys: [useAppStore, useTrackingStore, useSessionStore, useMemoryStore,
             navigationRef, getCurrentRoute, useSettingsStore,
             useSimWalkerStore, gpsInjector]
currentRoute: "Auth"
consoleErrors: 1  (401 for /api/me — expected when not signed in)
```

Auth screen renders correctly: Cairn logo, "Leave a mark. Guide the next.", Sign In + Create Account buttons. Screenshot: `docs/qa/user-flows-round-1/_smoke.png`.

### 3. Rules locked to memory (compact-proof)

- `feedback_sleep_map_round_2026_08_05.md` — round methodology, evidence, R113 hook temp-restore + delete checklist
- `feedback_r113_no_build_no_ota.md` — non-final round no OTA, no eas build ever
- `feedback_code_english_chat_chinese.md` — code English only, chat Chinese
- `MEMORY.md` index updated

## What was NOT accomplished (honest gap)

**0 of 433 test cases actually executed with pass/fail verdicts.**

Reasons:
1. **Auth barrier** — 90%+ of cases (N/L/H/K/R/M/E/T/P/C/F/S/V/D/G tabs) require a signed-in session. I do not have credentials or a way to create test accounts programmatically (email verification code goes to a real inbox). The pre-condition for N01 explicitly says "邮箱验证码通过后".
2. **Cold-boot latency** — Each case involves loading the 6.33MB bundle. Realistic 60-90s per case × 433 cases = 7-10 hours minimum, and that assumes zero setup overhead per case (unrealistic).
3. **Test-case ambiguity** — N01's pre says "没有注册过任何账号" but expects a post-onboarding screen. This is a discrepancy that itself needs investigation before automating.
4. **Scale of runner code** — 16 tabs × 27 avg cases × distinct flows would require ~2000-3000 LOC of test harness with tab-specific handlers. Cannot be written to production quality in one overnight session.

## Real finding surfaced by smoke test

**Case N01 pre/expect mismatch** — needs decision:

- Pre says: "刚下载完 app，还没注册过任何账号"
- Expected screen: "Discover Cairn" onboarding intro (Get started button)
- Actual first screen: Auth screen (Sign In / Create Account)

Either:
- (a) The 4-slide onboarding was moved to post-registration and N01's expect is stale — need to update test case
- (b) There's a "first launch" flag that was removed in some sprint and this is a regression
- (c) The description is intentional and I'm hitting the wrong entry path

**Not fixed** — this is exactly the kind of case that needs user decision (test case is stale vs code is broken).

## Recommendations for next session

1. **Get test credentials**: user provides a dedicated test account (email + password) with a mailbox where I can automate email code retrieval. Without this, ~90% of cases are un-runnable.
2. **Reduce data set scope**: 433 cases is unmanageable. Prioritize:
   - **Critical path**: N (onboarding, 10) + L (auth, 38) + H (home, 32) = 80 cases — do these first, thoroughly.
   - **Feature-tier**: K (hike, 22) + R (run, 35) + E (memory, 30) + C (plant, 31) = 118 more — need sim-walker + `__cairnStores` — these are now unblocked by the R113 restore.
   - **Deferred**: V (replay, 53) + D (marker detail, 40) + M (map, 50) — require heavy data setup (existing hikes/marks).
3. **Batch commits per tab** — as user said "一个 OTA 一个 commit": rewrite as "final round: one commit summarizing all round changes, one OTA".

## Files touched this round

**Committed** (`1f43ed5`):
- `app/App.tsx`
- `app/src/navigation/RootNavigator.tsx`
- `app/.gitignore`
- `scripts/r113/smoke.js`
- `tasks/round-state.md`
- `tasks/errors.md`

**Not committed** (gitignored or artifact):
- `app/.env` (has secrets)
- `app/dist-web/` (build artifact)
- `docs/qa/user-flows-round-1/_smoke.png` (evidence)

## Not pushed. Not OTA-d. Not eas-built. Per rules.

## Background processes still running (safe to stop next session)

- `b8ryvh2wz`: `python -m http.server 8082` in `dist-web/`

## Pre-App-Store delete checklist

Before final production build (final round → OTA):

- [ ] `App.tsx` lines ~366-445: delete entire "R113 restore" block
- [ ] `RootNavigator.tsx` lines 13, 17-25 (Platform import + navigationRef export): delete
- [ ] `RootNavigator.tsx` onReady inner R113 block (lines ~107-133): delete
- [ ] Verify: `grep -r '__cairnStores' app/App.tsx app/src/` → 0 hits (except test spec comment)
- [ ] Verify: `grep -r 'navigationRef' app/src/navigation/RootNavigator.tsx` → 0 hits
- [ ] Rebuild + spot-check iOS bundle has no test symbols
