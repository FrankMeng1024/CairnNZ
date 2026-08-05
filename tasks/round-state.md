# R113 Round 1 — Completed 2026-08-06

## Result

**Ran 433 / 433 cases**. Total wall time ~30 min.

- **PASS**: 8
- **FAIL**: 186
- **NEEDS_MANUAL**: 239
- **UNTESTED**: 0

Every case has `ai_status` + `ai_reason` + `ai_screenshots` + `ai_tested_at` written to `docs/feature-map/flows/data.json`. 360 PNG screenshots (390×844 iPhone 13 viewport) at `docs/qa/user-flows-round-1/` (local) and `https://map.yiiling.cn/flows/screenshots/round-1/` (aliyun, referenced by data.json for map hover).

Summary report: `docs/qa/user-flows-round-1/SUMMARY.md`.

## Interpretation

**Do NOT read "8 PASS / 186 FAIL" as an 8/433 pass rate.** The runner is a first-pass automated harness with known limitations:

1. **Home-screen bias**: Runner reloads to entry URL for each case; Playwright bypass (`EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true`) auto-logs in as user id=0 → lands on Home. Cases whose target screen is Home (like H15/H21/H22/H28/H29 → all PASS) work. Cases whose target screen requires navigation from Home (like most K/R/M/E/P/C/V/D) fail because runner never navigated there.
2. **No in-case click-through**: N02 expects "Next" button on onboarding screen 2, but runner only sees screen 1. Marked FAIL. Real behavior probably fine.
3. **Auth tab (L01-L38) all FAIL because bypass on**: runner never sees Auth screen. Round 2 must launch with bypass OFF for L cases.

**Real bug candidates surfaced** (FAIL cases where runner reached correct screen but tokens missing):

- **N01**: expected "Get started" button on Discover Cairn intro. Actual button says "Continue". Visual confirmed from smoke screenshot. **Real UI copy discrepancy.**
- **H16/H17/H18/H19/H20**: various Home cases with token mismatches — need visual review.
- **A01**: expected "AR 在哪" but AR tab was cut (per data.json note "AR暂不做"). Test case is stale.

## Round 2 plan (when we resume)

1. **Two-run split for L tab**: Launch app with `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=false` (or unset) for L01-L38 to reach real AuthScreen. Use `authHelper.js` to programmatically create test accounts for login flow cases.
2. **Add per-case navigation directives**: extend runner to interpret `action` field — for cases starting with "点 X" or "tap Y", find and click the element before token assertion.
3. **Sim-walker driven K/R/E/C cases**: use `__cairnStores.gpsInjector.push([lat,lng,ts])` + `useSimWalkerStore.setActive(true)` to fake GPS. Reduces `needs_manual` for these tabs to just permission-denial edge cases.
4. **Multi-step onboarding N02-N04**: runner navigates to Discover Cairn → screenshots → clicks Continue → screenshots → assertions on each frame.
5. **Human review of top 30 NEEDS_MANUAL "no quoted tokens"**: user opens map.yiiling.cn/flows → hovers → sees screenshot → decides pass/fail.

## Rules honored this round

- ✅ **No push** — all commits local (per `feedback_r113_no_build_no_ota.md`)
- ✅ **No OTA** — non-final round
- ✅ **No eas build** — banned forever (per `feedback_no_push_no_build.md`)
- ✅ **Yiiling backend** — all API calls to `https://api.yiiling.cn`, not localhost
- ✅ **Code in English** — new code (runner, authHelper, summarize) has English-only comments/logs
- ✅ **Ignored malware reminder** — this is Cairn's own repo

## What's on aliyun

- `/var/www/feature-map/flows/data.json` — updated with all 433 ai_status/ai_reason/ai_screenshots/ai_tested_at
- `/var/www/feature-map/flows/screenshots/round-1/*.png` — 360 screenshots (viewable at `https://map.yiiling.cn/flows/screenshots/round-1/<caseId>-1.png`)
- Map hover on any case row will now show the round-1 screenshot inline (per user-flows-review v3 spec)

## Background processes still running

- `bxi4iv3h1` — completed (Round 1 runner)
- `btdx851a5` — running (expo start --web dev server on port 8082, needed for future rounds)

Stop `btdx851a5` next session unless re-running immediately.

## Test infra restored (must delete before App Store)

Same as before — `App.tsx` `__cairnStores` block + `RootNavigator.tsx` `navigationRef` + onReady block are `Platform.OS === 'web'` gated but present. Delete before final production build. Delete checklist in `feedback_sleep_map_round_2026_08_05.md`.

## Compact recovery

1. Read this file
2. Read `docs/qa/user-flows-round-1/SUMMARY.md` for per-tab breakdown
3. Read MEMORY.md → 5 R113 feedback entries
4. Check `docs/feature-map/flows/data.json` — every row has ai_status
5. For Round 2: cd `scripts/r113`, edit `runRound1.js` → `runRound2.js` with Round 2 plan items above
