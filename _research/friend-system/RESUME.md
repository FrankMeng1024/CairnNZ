# 📋 RESUME.md — Cairn Friend System v1 Sprint 67

**Last updated**: 2026-06-27 (Sprint 67 closed; Sprint 68 5/5 COMPLETE)
**Reason for file**: Survival guide after session clear. Read this FIRST.

---

## 🚨 First thing to do after clear

1. Read this file completely
2. Read `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md` (the product spec, ~500 lines)
3. Read `tasks/jira/sprint67/SPRINT_GOAL.md` (sprint plan)
4. Read the **next pending** Story file (see "Next Step" below)
5. Continue work without re-asking product questions — everything is decided

---

## 🎯 Current task

**Cairn Friend System v1**, Sprint 67 (F1 of F1-F5), 5-sprint roadmap. Plan in `FINAL_PRODUCT_PLAN_v4.md`.

User invocation: `/project --auto` mode (autonomous, no per-sprint user verification).

User's 5 binding rules (their words, never violate):
1. **Logic clarity** — when writing code, mirror the v4.2 plan's three iron laws + 6 detail sheet shapes in function names, file structure, and comments.
2. **Clean code** — no dead code in new modules; actively remove `useCommunityStore` / dead `LikeReportSheet` references when touching adjacent areas.
3. **UI quality** — visual consistency with existing Cairn (sepia / Liquid Glass / tokens.ts), zero learning cost UX, beautiful. UX subagent reviews side-by-side with existing app screenshots.
4. **Multi-subagent review** — at every sprint: Arch + UX + QA + Devil's advocate subagents. Resources unlimited, only quality matters.
5. **Autonomous** — only ask user about product-direction changes. Implementation, naming, refactoring → decide self.

---

## ✅ Done in Sprint 67 (7 of 7 — COMPLETE)

### STORY-00524 — auth.js login validates no password length ✅
- Read `backend/src/routes/auth.js` lines 186-221.
- Confirmed: login endpoint does NOT enforce `password.length >= 8`. Only register does.
- **No code changes needed.** Mock seeding with single-char passwords (1, 2, ..., x3) is viable.

### STORY-00525 — Migration 018 applied + permission constants ✅
- Created `backend/src/migrations/018_friend_system_v4.sql` (idempotent, MySQL 8.0 compatible)
- Created `backend/src/constants/permission.js` (PERMISSION / SHARED_VISIBILITY / normalize / denormalizeForWrite / isClientWriteable)
- Applied to aliyun MySQL via SSH + docker exec
- Verified: users.account_type, users.memory_subscription_limit, routes.permission, memory_subscriptions table, hidden_items table, trg_memory_subscription_cap trigger (SELECT FOR UPDATE + friend-must-be-friend check)

### STORY-00526 — 9163 cleanup + Kalman rebuild ✅
- 9163 = user_id **4** (name: frank, email: 916354835@qq.com)
- Backup: `backup/pre-friend-system-20260627_191304.sql` (29MB mysqldump)
- DELETED 5 sessions (31, 38, 39, 41, 73), KEPT session 46 "back"
- DELETED all 7 markers + 4 routes + 413 memory_points for user 4
- Ran `_spike/v358-fix-back-session/resmooth_v358.py` → rebuilt 46 Kalman-smoothed memory_points for user 4
- Backup table `memory_points_pre_v358_kalman` retained for rollback

---

### STORY-00527 — Seed 9 mock @cairn.demo accounts ✅
- Created `backend/scripts/seed/` with 6 files: `gen_bcrypt_hashes.js`, `seed_mock_users.sql`, `seed_mock_sessions_markers_routes.sql`, `backup_mock_data.sh`, `restore_mock_data.sh`, `clear_mock_data.sql`
- Applied to aliyun. 9 mock users login OK (HTTP 200 + JWT). Per-user counts match §8 exactly.
- Stranger 1 mark at 20.02m from 9163 Back Loop center (geometric verify SQL embedded).
- `markers.permission` uses legacy `'group'` for Friend tier (normalized via `permission.js`); `routes.permission` uses `'friend'` directly.
- **9163 friends cleanup done** (with user authorization): 10 legacy rows from 2026-05-19 deleted; backup in `_spike/sprint67-friends-cleanup/`. 9163 now matches v4 §8 initial state.

### STORY-00528 — 8 backend endpoints + POST/PUT Public rejection ✅
- New files: `backend/src/routes/memory-subscriptions.js`, `circle.js`, `hide.js`. Modified: `markers.js`, `routes.js`, `index.js`, `models/Route.js`.
- All 8 endpoints live + integration-tested. 23/23 PASS in `backend/scripts/seed/integration_test_story_528_serverside.sh`.
- v4 H1 enforced: POST/PUT markers + POST/PUT routes reject `permission='public'` → 400.
- Arch review: PASS. 1 Medium (route permission not persisted) + 1 Low (fog test coverage) found, both fixed in same Sprint.
- 9163 friends cleanup commit applied earlier: DELETE FROM friends WHERE user_id=4 OR friend_id=4 (10 legacy rows). Backup in `_spike/sprint67-friends-cleanup/`.

---

## ⏳ Pending in Sprint 67 (2 of 7)

### STORY-00529 — hidden_items cron + TECH_SPEC §cron ✅
- `backend/src/cron/cleanHiddenItemsOrphans.js` (batched DELETE, 1000 rows/batch, 100k/run cap)
- `node-cron@^3.0.3` added to package.json + installed in container
- Registered in container index.js via `patch_container_cron.js` (idempotent). Schedule `0 3 * * 0` UTC.
- `docs/TECH_SPEC.md §cron` added.
- Manual test: 5 orphan rows + 1 valid → cron deleted exactly the 5 orphans, valid row preserved. durationMs=44.
- Implementation gotcha (documented in code): MySQL doesn't allow LIMIT on multi-table DELETE-with-JOIN. Switched to 2-step SELECT→DELETE-by-tuple pattern.

---

### SPIKE-67-1 — Mapbox iOS fog UNION feasibility ✅
- Report: `_research/friend-system/spike/SPIKE-67-1-mapbox-fog-union.md`
- Verdict: **VIABLE_WITH_CONDITIONS**
- Evidence: production `FogLayer.tsx` already uses turf.union + ShapeSource + FillLayer at 60fps for single-user. rnmapbox tiles GeoJSON internally (GPU sees only visible-tile vertices). turf.union O(n log n) → ~100-150ms for 5-friend input on iPhone 12 (extrapolated from v346 measurements).
- Live FPS measurement NOT executed (no iOS device in Windows workflow). Honest disclosure per `feedback_user_reports_are_truth`. Deferred to F4 Sprint 70 prep on user's iPhone.
- 3 fallback designs documented (A: per-friend translucent / B: server UNION / C: H3 cells) — only if F4 live FPS test fails.
- Does NOT block F2/F3/F4 stories 1/2/4/5; only F4 Story 3 (fog UNION render).

---

## ⏳ Pending in Sprint 67 (0 of 7) — SPRINT COMPLETE

All 7 items Done. Sprint 67 (F1 of F1-F5) is closed.

## 🚀 Sprint 68 (F2 — Mark UI + 交互 + Like/Delete) — COMPLETE 5/5

| Story | Status |
|---|---|
| STORY-00530 — Mark create visibility toggle (default Friend) | ✅ Done |
| STORY-00531 — Mark visual treatment by tier (self/friend/stranger) | ✅ Done |
| STORY-00532 — Detail Sheet 4 forms (§4.11) | ✅ Done |
| STORY-00533 — Like/Report fake + Delete dual | ✅ Done |
| STORY-00534 — Hide-from-me + cache wipe | ✅ Done |

### Sprint 68 evidence + verification
- 4 forms verified via Playwright on Expo Web (`docs/qa/sprint68-evidence/STORY-00532-form*.png`)
- 9/9 logic tests PASS for iron-law form selection (`app/src/features/marks/__tests__/markVisibility.dev-test.mjs`)
- Like toggle verified: ♡ Like → ❤ Liked (red fill + colored text)
- Hide flow wired: confirm modal → POST /api/hide + optimistic local wipe via `useMarkerStore.hideMark`
- Dead code: `useCommunityStore.ts` deleted (zero refs). ARScreenLegacy LikeReportSheet left intact (still used by AR kill-switch — not dead).

### Sprint 68 follow-up still pending
- Wire `loadCircleMarkers()` consuming `GET /api/circle/markers` so subscribed-friend marks reach the map render list. Tier visuals (Story-531) + Detail Sheet B/C forms (Story-532) only activate once this is in place.
- Live device verification on iPhone — F5 hardening Sprint.

### Sprint 68 web-test infrastructure
- `app/src/features/plant/components/GpsLockStep.tsx`: Platform.OS==='web' mock (9163 Back Loop coord, 100ms timer) skips GPS sampler — Plant flow reachable in Playwright.
- Dev preview route `MarkDetailDevPreview` mounted in RootNavigator, entry link rendered conditionally on `__DEV__` at HomeScreen bottom. 7 hand-crafted scenarios exercise every form including anonymization edge cases.

### 9163 state update (post-Story-527 cleanup)
- friends_9163 = 0 ✓ (10 legacy rows deleted with user authorization)
- subscriptions_9163 = 0 ✓
- ready for full add-friend journey testing in F2

---

## 📂 Critical files (single source of truth)

| File | Purpose |
|---|---|
| `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md` | **THE plan** (v4.2 final). Read first. |
| `_research/friend-system/V3_REVIEW.md` | 24 review findings (mostly fixed in v4) |
| `_research/friend-system/V4_REVIEW.md` | 5 must-fix + 5 deferred (all addressed) |
| `backend/src/migrations/018_friend_system_v4.sql` | Applied schema |
| `backend/src/constants/permission.js` | Permission ENUM logic |
| `backend/src/routes/auth.js` | Auth (login does not check password length, register does) |
| `_spike/v358-fix-back-session/resmooth_v358.py` | Kalman script (already used in Story 526) |
| `tasks/jira/sprint67/SPRINT_GOAL.md` | Sprint Goal + story list |
| `tasks/jira/sprint67/STORY-005{24..29}.md` + `SPIKE-67-1.md` | Story specs |
| `backup/pre-friend-system-20260627_191304.sql` | Pre-cleanup DB backup (29MB) |

---

## 🔒 Decisions never to re-litigate

These are LOCKED. Do NOT ask user about them again:

1. **Three-tier visibility**: Personal / Friend / Public. Public hidden in v1 UI but schema exists. Backend rejects POST/PATCH with `permission='public'`.
2. **Add Friend modal**: no share checkbox. Adding a friend implies full fog + Friend marks + Friend routes share. Self-add and duplicate-add show inline error.
3. **Mark interaction**: tap (not long-press). 6 detail sheet shapes by (creator × visibility × visited).
4. **Like/Report UI**: built in v1, **not wired to API**. Visual feedback only. v1.1 wires API.
5. **Delete**: my-mark = real DELETE. Other-mark = INSERT hidden_items (personal blacklist, irreversible, strong warning).
6. **Memory 5-pick**: 5 free, 6+ shows 🔒 visible-lock. Tap 🔒 → Paywall sheet → "Coming soon" toast. NOT real IAP.
7. **Paywall**: TestFlight only, keeps $4.99 price. App Store public release requires real IAP (deferred to v1.2).
8. **Public marks: anonymous** (no author name displayed), even when creator is a friend. Friend marks show author.
9. **Sync timing**: "next-pull-on-focus" — no push channel, no polling. B opens Memory tab to see A's content.
10. **Trails**: Activities only Mine (no Friend sub-tab). Flags + Routes have Mine|Friends.
11. **9163 initial state**: 0 friends, 0 subscriptions. User adds friends manually for testing.
12. **No `is_mock` column** — mock identified via `email LIKE '%@cairn.demo'`. Production hard-asserts on startup.
13. **No home masking, no fog clipping, no caption badge, no pause toggle** — user explicitly rejected each.
14. **Carol** = stranger → friend conversion test (initial NOT 9163's friend).
15. **Activity unchanged**. Existing "save as route" feature stays. No new Convert button.

---

## 🛠 Server / DB access

- **SSH**: `ssh root@122.51.174.118` (key-based, configured)
- **DB**: MySQL on aliyun, container = `ainews-db`, db = `cairn`
- **DB password**: env var `MYSQL_ROOT_PASSWORD` inside `ainews-db` container
- **Pattern**: `ssh root@122.51.174.118 "docker exec ainews-db sh -c 'mysql -uroot -p\$MYSQL_ROOT_PASSWORD cairn -e \"...\"'"`
- **Python on host**: `/usr/bin/python3` works, `pymysql` installed

---

## 🧪 What's running on aliyun right now

- Backend container `cairn-backend` (Node + Express, port 3001)
- DB container `ainews-db` (MySQL 8.0.45, port 3306)
- Migration 018 applied
- user_id 4 (frank/9163) has 1 session (back), 0 marks, 0 routes, 46 memory_points
- user_id 8 has 21 memory_points (untouched)
- backup table `memory_points_pre_v358_kalman` retained

---

## 📝 Update protocol for me

After completing EACH story:
1. Update the Story file with execution report (Done status + actual results)
2. Update this RESUME.md "Done" section
3. Update this RESUME.md "Pending" section (remove the completed item)
4. Commit if `acceptance_mode: auto` and changes are stable

This minimizes recovery effort if session clears again.

---

## 🚦 If you the user are reading this

You typed: `读 _research/friend-system/RESUME.md 然后继续 Sprint 67`

I (Claude) will then:
1. Read this file
2. Read v4 plan
3. Read STORY-00527.md (the next pending story)
4. Start building bcrypt hash generator
5. Continue without asking product questions

Anything you want to change about the plan, tell me before I start.
