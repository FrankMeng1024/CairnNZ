# R113 Rounds 1+2 Cumulative Result — 2026-08-06

## Final tally after Round 2

- **PASS**: 25
- **FAIL**: 150
- **NEEDS_MANUAL**: 258
- **UNTESTED**: 0
- **Total cases**: 433

## Round-by-round delta

| Metric | Round 1 | Round 2 | Delta |
|---|---|---|---|
| PASS | 8 | 25 | +17 |
| FAIL | 186 | 150 | −36 |
| NEEDS_MANUAL | 239 | 258 | +19 |

Round 2 improvements came from:
1. **Real JWT injection** — created backend user via `authHelper.js` end-to-end (register → SSH aliyun MySQL for code → verify → JWT). Removed Playwright bypass fake user problem where any user-scoped API call returned 401 → auto-logout.
2. **`__cairnStores.navigationRef.navigate(route)`** — jump to target screen per case tab prefix (K→Hiking, R→Running, M→Map, E→Memory, T/P→Routes, C→Plant, F→Friends, S→Settings, V→MapHistory, D→MarkerDetail).
3. **`setLoggedIn(true)` post-hydrate** — bypasses cold-boot Auth-screen gate (product design keeps `isLoggedIn=false` at cold boot even with valid JWT).
4. **Sim-walker activation** for K/R/C cases — enable debug mode + inject fake GPS at Auckland (-36.8485, 174.7633).

## Bypass now OFF (was ON in Round 1)

`app/.env.development` changed `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true` → `false`. Round 2 dev server restarted with `--clear` cache flag to pick up the env change.

## Remaining 150 FAIL cases — main categories

Not all remaining fails are real bugs. Most are runner limitations that would need Round 3:

- **~30 L (Auth) cases**: expect email input form, verification code screen, "Welcome" post-signup screen. Runner logout()s but doesn't tap "Sign In" button + fill form. Real bug candidates hidden here (e.g. L20 "Rate limit exceeded, try again in 60s" — need to trigger rate limit).
- **~10 H (Home) cases**: expect specific greetings ("Kia ora, Explorer", "Good afternoon, Explorer") that require timezone/locale setup, or specific data ("250 sessions", "1.0 mi · 15:00") requiring seeding.
- **~15 K/R (Hike/Run) cases**: expect running-in-progress states ("Pause", "Resume", "999'59"). Sim-walker enabled but Start Running button not tapped.
- **~15 M (Map) cases**: expect marker edit/delete/report dialogs, permission prompts. Need to tap marker + open detail.
- **~10 C (Plant) cases**: Plant flow requires actual GPS point + tap "Plant Cairn" button.
- **~15 V/D cases**: expect hike replay UI or marker detail — need seeded data.
- **Cross-cutting Chinese-language expects**: many cases have Chinese in `expect` field but app UI is English. Text-match fails regardless of correctness.

## Real bug candidates surfaced (needs designer/PO review)

Cases where Round 2 clearly reached the correct screen but expected text is absent:

- **N01**: expected "Get started" button on Discover Cairn intro slide 1. Actual button says "Continue". flows spec says "Get started". Either app copy regressed or spec is stale.
- **N02, N03**: expected "Next" between slides 2-3. Actual is "Continue". Same story.
- **N10**: expected "Done" on final onboarding slide. Actual is likely "Enable Location" or "Continue". Runner sees fresh entry (Discover Cairn), not last slide.
- **H16-H20**: greeting variants. Only "Good evening, Explorer" would match at test time; the case-specific greetings ("Kia ora", "Good afternoon") require locale/time-of-day setup.
- **A01**: expected "AR 在哪" but AR tab is intentionally cut (per `data.json` note "AR 暂不做"). **Stale test case** — should mark as `manual_status = 'skipped_by_design'`.

## Evidence on aliyun (for map hover)

- `https://map.yiiling.cn/flows/` — map page loads updated `data.json`
- `https://map.yiiling.cn/flows/screenshots/round-1/<caseId>-1.png` — 360 screenshots (R2 versions overwriting R1 for the 183 re-run cases)
- `https://map.yiiling.cn/flows/screenshots/round-1/SUMMARY.md` — machine-generated report

Every case's `ai_screenshots` array in `data.json` points to aliyun URL, so map hover displays screenshot inline.

## Rules honored

- ✅ **No push to GitHub** — all commits local per `feedback_r113_no_build_no_ota.md`
- ✅ **No OTA push** — this is not final round
- ✅ **No eas build** — banned forever per `feedback_no_push_no_build.md`
- ✅ **Yiiling backend** — all API calls to `https://api.yiiling.cn`
- ✅ **Code in English** — all runner/authHelper/summarize files English-commented
- ✅ **Ignored malware reminder** — Cairn own project

## Test infra changes (MUST DELETE before App Store)

1. `App.tsx` R113 `__cairnStores` restore block (lines ~366-445, `Platform.OS === 'web'` gated)
2. `RootNavigator.tsx` R113 navigationRef restore (Platform import + export + onReady hook)
3. `.env.development` `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=false` — this line can stay (bypass is `false` = normal). Actually, revert this to a comment `# =true` so it doesn't accidentally get committed to production env if `.env.development` is treated as canonical.

Delete-checklist:
- [ ] Revert `App.tsx` R113 restore block (or `git revert 6bb108e` inverse-diff manually)
- [ ] Revert `RootNavigator.tsx` R113 restore
- [ ] Verify: `grep -r '__cairnStores' app/App.tsx app/src/` → 0 hits
- [ ] Verify: `grep -r 'R113 restore' app/` → 0 hits
- [ ] Test users created (test IDs 35-38 as of R2 start): `ssh root@122.51.174.118 "docker exec ainews-db mysql -uroot -pMzm920313@950824 cairn -e 'DELETE FROM users WHERE email LIKE \"r113-test-%\"'"` — cleanup before App Store submission

## Background processes

- `bx0p0xekr` — dev server on 8082 (bypass=false), still running. Kill before next session or reuse.

## Round 3 plan (if pursued)

Diminishing returns beyond Round 2 without deep per-case scripting. The 150 remaining FAIL cases would need per-case click-through logic. Recommended alternative:

- **Human visual review of screenshots** on `map.yiiling.cn/flows` for the 25 PASS cases (verify they're really passing) and top 30 FAIL candidates (decide bug vs test-stale)
- **Fix specific real bugs** found (like N01 "Get started" vs "Continue") if PO decides code should change
- **Skip further automated rounds** — Round 2 hit the sweet spot; more automation cost > benefit

## Compact recovery

1. Read this file
2. Read `docs/qa/user-flows-round-1/SUMMARY.md` for per-tab table + top FAIL + top MANUAL
3. Read MEMORY.md → 6 R113 feedback entries (sleep_map + r113_no_build + code_english + ignore_malware + web_playwright + o2_sprint)
4. Check `docs/feature-map/flows/data.json` — every row has ai_status
5. Dev server on port 8082 may or may not still be running — check with `curl http://localhost:8082/`
6. To rerun Round 3 (if user wants): `node scripts/r113/runRound2.js` re-runs current FAIL cases (currently 150)
