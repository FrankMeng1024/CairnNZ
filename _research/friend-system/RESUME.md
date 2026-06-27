# 📋 RESUME.md — Cairn Friend System v1 Sprint 67

**Last updated**: 2026-06-27 (mid-Sprint 67)
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

## ✅ Done in Sprint 67 (3 of 7)

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

## ⏳ Pending in Sprint 67 (4 of 7)

### NEXT STEP: STORY-00527 — Seed 9 mock @cairn.demo accounts

**File**: `tasks/jira/sprint67/STORY-00527.md`

What to build:
- `backend/scripts/seed/gen_bcrypt_hashes.js` — Node script generating bcrypt hashes (cost 12) for passwords `1`, `2`, `3`, `4`, `5`, `6`, `x1`, `x2`, `x3`
- `backend/scripts/seed/seed_mock_users.sql` — 9 INSERT into users
- `backend/scripts/seed/seed_mock_sessions_markers_routes.sql` — per v4 plan §8 data spec
- `backend/scripts/seed/backup_mock_data.sh` / `restore_mock_data.sh` / `clear_mock_data.sql`

Mock matrix (v4 plan §8 — DO NOT change):
| email | pwd | role | data |
|---|---|---|---|
| 1@cairn.demo | 1 | Alice (active friend A) | 3 sessions / 12 marks / 1 route |
| 2@cairn.demo | 2 | Bob (active friend B) | 2 sessions / 8 marks / 1 route |
| 3@cairn.demo | 3 | **Carol (stranger→friend conversion)** | 2 sessions + 4 Public marks (NOT 9163's friend initially) |
| 4@cairn.demo | 4 | Dave (empty) | NO data |
| 5@cairn.demo | 5 | LDY (rich friend) | 4 sessions / 15 marks / 2 routes |
| 6@cairn.demo | 6 | Eve (6th friend, paywall) | 2 sessions / 6 marks |
| x1@cairn.demo | x1 | Stranger 1 (single) | 1 Public mark in 9163 Back Loop 50m |
| x2@cairn.demo | x2 | Stranger 2 (heatmap) | 3 Public marks within 100m |
| x3@cairn.demo | x3 | Stranger 3 (chain) | 5 Public marks scattered |

**Critical constraints**:
- 9163 (user_id=4) bbox is needed for mock GPS coords. Query: `SELECT MIN/MAX(lat,lng) FROM memory_points WHERE user_id=4;` — use this bbox ±5km for mock data.
- All emails MUST end with `@cairn.demo` (backup/clear scripts filter on this).
- **9163 initial state must remain**: 0 friends, 0 subscriptions. Do NOT auto-add friends.
- Stranger 1 mark MUST be within 50m of 9163 Back Loop GPS path (geometric verification SQL required).
- 9163's session 46 "back" is in GPS coords near Shanghai (lat ~31.20, lng ~121.59 based on Story-526 cleanup data).

### Then: STORY-00528 — Backend endpoints (8 new + POST/PATCH Public rejection)

Build endpoints per v4 plan §7:
1. POST /api/memory-subscriptions
2. DELETE /api/memory-subscriptions/:friend_id
3. GET /api/memory-subscriptions
4. GET /api/circle/markers
5. GET /api/circle/routes
6. GET /api/circle/fog
7. GET /api/markers/public?bbox=
8. POST /api/hide
+ HARDEN: POST /api/markers, PATCH /api/markers/:id, POST /api/routes, PATCH /api/routes/:id reject `permission='public'` → 400

Use `backend/src/constants/permission.js` for all ENUM logic.

### Then: STORY-00529 — hidden_items cron + TECH_SPEC §cron

- `npm install node-cron` (if not present)
- `backend/src/cron/cleanHiddenItemsOrphans.js`
- Register in `backend/src/index.js` (or wherever startup lives): `cron.schedule('0 3 * * 0', ...)` Sunday 3am UTC
- Update `docs/TECH_SPEC.md §cron`

### Then: SPIKE-67-1 — Mapbox iOS fog UNION feasibility

- Create 5 test polygons (200+ total vertices)
- Run on iOS device or simulator
- Measure FPS at zoom 12/14/16/18 + memory usage
- Write `_research/friend-system/spike/SPIKE-67-1-mapbox-fog-union.md` with verdict
- If NOT_VIABLE → write fallback design for F4

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
