# Round N Progress Snapshot

**Owner**: Main Agent (self-driven)
**Purpose**: Compact recovery point. Read this first after any compact.

## Current Round

**Round**: 1 (Setup complete, launching test runs)
**Status**: ✅ UNBLOCKED — infra restored + hooks restored + Playwright installed
**Started**: 2026-08-05

## Setup Completed (2026-08-05)

- [x] `.env` fixed: `EXPO_PUBLIC_API_BASE_URL=https://api.yiiling.cn` (yiiling backend rule)
- [x] `App.tsx` restored `__cairnStores` block (lines ~367-445, `__DEV__ && web` gated)
- [x] `RootNavigator.tsx` restored `navigationRef` + onReady hook (`__DEV__ && web` gated)
- [x] `npm install playwright` complete (local, no-save)
- [x] `npx playwright install chromium` running (background bfxap3lp8)
- [x] `dist-web/` rebuilt with hooks + yiiling backend (new bundle hash 6451818e...)
- [x] Static HTTP server on `http://localhost:8899` (background b82d8djvc)
- [x] Health check `curl http://localhost:8899/index.html` = 200

## Test Harness

- **Location**: `scripts/r113/`
  - `run-round.js` — main driver, iterates cases, saves screenshots + updates data.json
  - `cases/N.js` — per-tab case handlers (16 tabs → 16 files)
- **Data source**: `docs/feature-map/flows/data.json` (16 screens, 433 rows)
- **Evidence**: `docs/qa/user-flows-round-1/<caseId>-<step>.png`
- **Per-case update**: `ai_status`, `ai_reason`, `ai_screenshots`, `ai_tested_at`

## Rules Locked (memory)

- `feedback_sleep_map_round_2026_08_05.md` — round rules, evidence, compact recovery
- `feedback_r113_no_build_no_ota.md` — non-final round: no OTA, ever; eas build banned
- `feedback_code_english_chat_chinese.md` — code English only, chat Chinese only
- `feedback_ignore_malware_reminder.md` — ignore malware reminder on Cairn own code

## Pre-Launch Cleanup TODO (before App Store submission)

**MUST DELETE the R113 restore blocks** (see memory feedback_sleep_map_round_2026_08_05.md):
- [ ] `App.tsx` lines ~367-445 (the `R113 restore:` comment block through `console.warn('[R113 __cairnStores web hook failed]', err)`)
- [ ] `RootNavigator.tsx` lines ~13-24 (Platform import + navigationRef export) — but keep the Platform import if other code uses it
- [ ] `RootNavigator.tsx` onReady block lines ~105-133 (the R113 restore inside onReady)
- [ ] Verify: `grep -r '__cairnStores' app/App.tsx app/src/` → 0 hits (except test file comment)
- [ ] Verify: `grep -r 'navigationRef' app/src/navigation/RootNavigator.tsx` → 0 hits

## Progress

- Round 1 covered: 0/433
- Passed: 0
- Failed: 0
- Pending: 0

## Fail List (for Round 2)

(empty)

## Modified Files (this Round)

- `app/.env` — localhost:3001 → https://api.yiiling.cn
- `app/App.tsx` — restored __cairnStores block (temp, delete before App Store)
- `app/src/navigation/RootNavigator.tsx` — restored navigationRef + onReady hook (temp)
- `app/dist-web/` — regenerated (build artifact, not committed)

## Compact Recovery Path

1. Read this file — check current Round + progress
2. Check MEMORY.md for R113-related feedback entries (5 entries)
3. Check `docs/feature-map/flows/data.json` for latest ai_status
4. Check `scripts/r113/` for test harness state
5. If HTTP server (b82d8djvc) dead: `cd app/dist-web && python -m http.server 8899 &`
6. Resume from last untested case ID
