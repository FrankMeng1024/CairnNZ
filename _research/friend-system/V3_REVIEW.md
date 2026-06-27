# V3 Plan Review

**Reviewer**: Independent product+engineering subagent (Opus)
**Date**: 2026-06-27
**Subject**: `_research/friend-system/FINAL_PRODUCT_PLAN_v3.md`

## Verdict
- [ ] APPROVE — ready for /project Sprint 0
- [x] APPROVE WITH FIXES — 11 fixes listed below; mostly schema/spec gaps, not architecture rewrites
- [ ] BLOCK — major issues, must redo sections

Plan is internally coherent and faithful to the user's 2026-06-27 simplification batch. Main agent should **not** start `/project` Sprint 0 until the **Top 5 must-fix** items are resolved (see end). The other items are recommended.

---

## Issues by Category

### 1. User decision drift

**Finding 1.1 — `auth.js:50` length>=8 vs single-char passwords (§8.2 line 749)**
The plan says "DB 直接 bcrypt 插入 hash,跳过 `auth.js:50` length>=8 校验". This bypasses **register** validation but the plan does not state whether the **login** endpoint validates password length. If `auth.js` POST `/api/auth/login` re-applies the length>=8 check before bcrypt compare, the 10 mock accounts cannot log in at all. **Need explicit check** on login path. Same risk for email format validators on login (`@cairn.demo` is fine; but is there a `disposable email` blocklist?).

**Finding 1.2 — Trust Disclaimer flag retained but unused (§4.1 line 180)**
`users.has_seen_friend_disclaimer` is kept in DDL "to ease rollback" (§6 line 583). This is **dead column** — keep means future engineer will write logic against it. Either drop it from migration 018 entirely or add a `-- DEPRECATED v3` comment in DDL itself. Currently the DDL comment is on a separate line below the ALTER statement and easily missed.

**Finding 1.3 — Carol "Public-only friend" role mismatch (§8.2 line 741)**
Test data §8.2 says Carol is "Public-only" with "5 Public marks". But the user-decision summary in §0 + §4.10 + §16 says **v1 UI does not let any user create Public marks**. Carol's Public marks must come from seed only — fine. But the matrix says she's a **friend** of 9163 (column "角色"). Per §3 Gate 1, Public mark visibility doesn't require friend pair; per §4.8/4.9, Friends sub-tab only shows `permission IN ('group','friend')` not `public`. So Carol's Public marks appear nowhere in 9163's friend UI — she's an invisible friend, useless for Sprint 2/3 testing. Either change Carol to have Friend marks (then she's redundant with Alice/Bob) or **remove her from the matrix** and reuse the slot.

**Finding 1.4 — Activity → Convert to Route (§15 Q5)**
§15 Q5 says v3 "retains v2's Activity → Convert to Route entry point" and §11 列表 says "Activity feed" is permanently not done — these are not contradictory, but §4.7 Trails Activities sketch shows NO "Convert to Route" button. So either Q5 is wrong (no Convert button in v1) or §4.7 needs an extra row showing it. UI flow gap.

---

### 2. Schema integrity

**Finding 2.1 — `hidden_items` FK gap is acceptable, but cron is not specced (§6 line 638; §10 E15; §13 Risk 3)**
Plan accepts orphan rows + LEFT JOIN handling + "cron 定期清理". But: (a) the cron job is not in DevOps deliverables; (b) frequency ("每周") is mentioned in §13 Risk 3 only, not in any Sprint Story. Sprint 4 Story 6 says "hidden_items 孤儿清理 cron" but no detail on **where it runs, what schedule, monitoring**. This is the typical "we said cron, no one built cron" pattern. **Need**: explicit cron infrastructure decision (cron from node app? systemd timer? Docker sidecar?) recorded in `TECH_SPEC.md §cron`.

**Finding 2.2 — `memory_subscriptions` trigger race after `friends` DELETE (§6 line 607; §10 E1)**
Sequence: A removes B → cascade deletes `friends` + `memory_subscriptions`. But the trigger `trg_memory_subscription_cap` doesn't fire on DELETE. **Real risk**: while in-flight, two race patterns:
- B removes A on device 1; on device 2 B taps "add 6th friend" → trigger checks COUNT(*) which still includes A → 409 returned → user confused
- A and B simultaneous: A's DELETE FRIEND races B's INSERT SUBSCRIPTION → undefined order
Trigger uses `SELECT COUNT(*)` without explicit row lock. Under InnoDB default isolation (REPEATABLE READ), this is mostly safe inside a transaction, but `BEFORE INSERT` triggers do NOT take a gap lock on a COUNT — two parallel INSERTs can both see count=4 and both pass. **Need**: trigger wrapped in `SELECT ... FOR UPDATE` on the user row, OR rely on UNIQUE constraint + app-level check + retry. Plan is silent.

**Finding 2.3 — `routes.permission` ENUM uses `'friend'` while markers uses `'group'` (§6 line 587-591)**
Spec drift acknowledged but the **server normalization implementation is unspecified**. Where is `SHARED_VISIBILITY = ['group','friend','public']` defined? Backend (`backend/src/constants/permission.js`)? Or just informal? Without a single import site, the 18-month forgotten-developer scenario from `05_devils_advocate.md §1 #5` resurfaces. **Need**: explicit file path for the constant.

**Finding 2.4 — `hidden_items` PK + `item_type='session'` future-proofing (§6 line 632)**
PK is `(user_id, item_type, item_id)`. The ENUM is `('mark','route')`. If v1.x adds `'session'` to ENUM, no migration disruption. Good. But **no path exists** for "hide a Public mark" — `item_type` ENUM doesn't have a value for "public stranger mark". Future v1.1 likely needs this (per §12 v1.1+ Manage hidden). Currently the `hidden_items` row's `item_id` could be ANY marker.id, including a Public stranger mark. §8.5 query #10 explicitly asserts hidden_items only references friend marks (the `LEFT JOIN friends WHERE f.user_id IS NULL` test). But v3 §4.11 says Hide trigger is in Trails Friends sub-tab AND Memory map mark long-press (§16 矛盾 4). Memory map shows stranger Public marks too — and §11 says "no interaction" on stranger marks (v1.1 only). So Hide cannot fire on a stranger Public mark in v1. **Need**: contract test that POST /api/hide rejects when the target mark.user_id is NOT a friend of viewer, returning 403.

**Finding 2.5 — `memory_subscriptions` no `friend-must-be-friend` check (§6, §10 E1)**
v2's §7 raised this; v3 still says "skipped, app-layer". But what happens to existing subscription rows when the friend pair is deleted? §6 `fk_ms_friend ON DELETE CASCADE` — cascades cleanly. OK. But what if subscription is INSERTED for a non-friend (e.g. through a buggy admin tool)? Trigger doesn't catch it; would silently work and confuse. Recommend adding a second trigger condition: `IF NOT EXISTS (SELECT 1 FROM friends WHERE user_id=NEW.user_id AND friend_id=NEW.friend_id)`. Two extra lines, hard-correctness win.

---

### 3. UI flow gaps

**Finding 3.1 — Add Friend modal allows self-add (§4.1)**
The email input field has no client-side check that `email != currentUser.email`. Bug-class: 100% recurring across products. Add Friend modal Save → POST /api/friend-requests → backend rejects 400, toast "you can't add yourself". UI should pre-empt this with disabled Save state + inline error.

**Finding 3.2 — Add Friend modal: already-friend handling (§4.1)**
What if email already in friends list? Spec is silent. Backend `/api/friends/request` (per `04_current_state.md §5`) already exists — does it return a distinct error for "already friends"? UI should show "Already in your friends" inline, not a generic toast.

**Finding 3.3 — 5-friend pick modal at-cap behavior (§4.5)**
Plan shows 🔒 lock + "Pro only". But what about **clicking the 🔒 row**? Spec doesn't say. Two options: (a) tap 🔒 = open Paywall sheet (best); (b) tap 🔒 = no-op (bad UX). Pick one in §4.5 ASCII sketch.

**Finding 3.4 — Empty state for Trails Friends sub-tab (§4.8, §4.9)**
When user has 0 friends or 0 subscribed friends — what does Flags Friends segment show? Empty state copy ("Add friends to see their flags here")? §4.8 sketch shows it populated. Empty state is the more-common state for new users, must be specced.

**Finding 3.5 — Friend Routes Memory rendering when hidden (§4.9)**
Long-press hide on a Route — does the route line disappear from Memory map immediately? §4.11 says "地图下次 fetch 自然过滤" — so there's a gap between hide-confirm and map refresh. For the Routes case, the dashed line lingers until next pull. Spec needs: client-side optimistic removal (already implied for marks, must explicitly extend to route polylines).

**Finding 3.6 — Memory map Friends segment chip when 0 subscribed (§4.4)**
"👥 4 of 5 ›" — what shows when 0? "👥 Add friends ›"? "👥 0 of 5 ›"? §4.4 doesn't sketch this. New-user critical path.

**Finding 3.7 — Remove Friend cascade on Memory map subscription (§4.13)**
Plan §4.13 bullet "Remove LDY from your Memory map" implies the subscription is auto-removed (which §6 DDL `ON DELETE CASCADE` confirms). But the Friend Detail page (§4.3) has a separate "Add to Memory map / Remove from Memory map" button. If LDY is removed as friend, the Friend Detail page no longer exists. Fine. But: if LDY is at 5/5 cap and I uncheck LDY via 5-pick modal, then Remove LDY as friend, the freed slot should be available. Verify the order doesn't matter — UI should test both sequences.

---

### 4. Data flow integrity

**Finding 4.1 — "Immediate sync on accept" channel unspecified (§4.1, §5.1, Scenario 3)**
§5 Journey 1 step 6 says "v3 关键: A accept 瞬间 A 的全部历史 Friend marks/routes 立即对 B 可见 ... B 下次进 Memory tab Friends segment 看到". Then §7 "v1 明确不实现 Realtime push". So "immediate" really means "next pull-on-focus". Scenario 3 (§9) clarifies "9163 等 5s 后 pull". **The word "immediate" in §0 + §4.1 modal copy is misleading**. Recommend rewording: "next time B opens Memory tab" OR add a Sprint 4 story for pull-on-focus debounce. Otherwise Sprint 4 acceptance bug: "user reported immediate doesn't work".

**Finding 4.2 — Offline cached marks after Hide (§10 E8 + §4.11)**
§4.11: "地图下次 fetch 自然过滤". If B is offline and cached LDY's marks, then B hides LDY's mark M, then reconnects — does the client clear M from local cache, or does the server re-fetch return M-not-included, but the local cache still has it? Cairn already has AsyncStorage hydration patterns (per `04_current_state.md §4` mention of `useSessionStore` per `userId` keying). **Spec gap**: `useFriendStore` (or whatever holds friend marks) must wipe `markerId in hidden_ids` on hide-confirm.

**Finding 4.3 — Memory `Friends` mode performance (§9 Scenario 7 / 13; §13 Risk 4 generic)**
5 friends × N marks each. For test data, LDY = 15 marks, others 5-12. Total ≈ 40-50 marks. Memory map renders 40 markers + fog UNION + my own marks. On low-end iPhone in cold-start scenario, render time? Plan does not name a performance target. **Need**: `TECH_SPEC.md §performance-targets` should include "Memory Friends mode render < 3s at p95" or similar. CLAUDE.md Performance Standards says "Initial load < 3s" — re-use that threshold.

**Finding 4.4 — Uncheck friend from Memory subscription — marks disappear when? (§5 Journey 6)**
Journey 6 step 2 says `DELETE /api/memory-subscriptions/<ldy_id>` and step 3 about adding Frank. No mention of "LDY's marks must vanish from the map immediately". This is a Gate 2 (relationship) check failure: if I uncheck, my view should drop LDY's content. Client-side filter or server-side re-fetch? Sprint 3 Story 2 is "5-friend pick modal" but doesn't spec the visual refresh. **Need**: explicit AC "uncheck friend → friend's marks disappear from map within 500ms".

**Finding 4.5 — Hide stranger Public mark accidentally (§16 矛盾 4)**
§16 matrix 4 says context menu on Memory map long-press for friend mark includes "Hide from me" + "Use this mark". But stranger Public marks are also on Memory map. Per §11, no interaction on stranger Public marks (v1). So long-press behavior diverges by mark type. The long-press handler must inspect the marker's owner-relationship to decide menu content. **Spec text needed**: long-press on stranger public = no-op; long-press on own = no-op (or Edit, separate flow); long-press on friend = context menu. Otherwise Sprint 4 dev will ship a menu on stranger marks.

---

### 5. Test data realism

**Finding 5.1 — bcrypt cost not specified (§8.2 line 749)**
Plan says "DB 直接 bcrypt 插入 hash". Cost factor (rounds)? Default is 10-12. With 10 single-character passwords, the seeding script is fast either way. But if `auth.js` uses cost 14, mock hashes generated at cost 10 still verify (bcrypt format-stamps cost in the hash itself), but **verify** time will be slow. Acceptable. **No fix needed**, but `gen_hashes.js` (Sprint 1 Story 2) should pin a cost matching `auth.js` register flow, recorded in script.

**Finding 5.2 — Single-character passwords + production safety guard (§10 E11)**
Plan §10 E11 says "production build 启动 hard-assert: 见到 @cairn.demo 用户抛错". This is great. But the assertion needs a concrete location: backend startup? client startup? Both? If only backend, a Pro user with a production app pointing at a misconfigured backend that has `@cairn.demo` users gets a crash. If only client, the backend doesn't validate its own data. **Need**: precise location + behavior of the hard-assert.

**Finding 5.3 — Stranger Public mark heatmap rendering (§8.2 line 746; review prompt cat 5)**
x2 has "3 Public marks ... 100m 区, heatmap 测试". §4.6 only sketches single mark visual (灰阶 icon). What does the user see when 3 marks are within 30m at zoom 14? Three overlapping grey icons (stacked)? Plan §11 v1.1+ shows cluster algo is v1.1 — but **3 overlapping icons in v1 is the test scenario**. Sprint 3 Story 4 (mark视觉) needs explicit AC: "3 stranger public marks within 50m render as 3 separate icons (no cluster)". Otherwise QA tests this and reports "looks bad".

**Finding 5.4 — Stranger marks distance constraint (§8.5 query 6)**
Self-check SQL #6 verifies Stranger 1's mark is within 50m of 9163 Back Loop. Good. But x2 / x3 (3 marks / 5 marks) have no spatial test. If they're randomly placed outside the test bbox, Scenario 12 "9163 finds stranger Public mark" won't work — the marks are off-map. **Need**: §8.5 add geometric checks for x2 + x3 marks vs 9163 bbox.

**Finding 5.5 — 9163 cleanup irreversibility (§13 Risk 1 + §10 E13)**
Plan correctly references `feedback_dry_run_before_delete.md`. Sprint 1 Story 3 is "9163 cleanup DRY-RUN + 真删 + Kalman re-run + binlog 备份". Strong. But: the order of operations is critical — **backup BEFORE migration 018**, otherwise restoring backup re-introduces pre-018 schema and a re-apply is required. Spec the exact sequence: (1) full mysqldump → (2) apply migration 018 → (3) DRY-RUN cleanup → (4) ack → (5) real cleanup. §5 Journey 9 has this but with slight ambiguity — make step 2 (backup) explicitly precede step 3 (migration).

---

### 6. V1 scope discipline

**Finding 6.1 — Like/Report code paths still exist in repo (§7 "已有,复用" + 06_existing_algorithms_audit.md)**
Plan §7 says `POST /api/markers/:id/vote` and `GET /api/markers/:id/community-state` are "后端 live 但 v1 不接 UI". `useLikeReport.ts` is still in production code. **Risk**: a developer in Sprint 3 mark visual story sees the hook, imports it, ships like UI inadvertently. Need: explicit Sprint 1/2 task to grep-check that ARScreenV2 + new Memory tab UI doesn't import `useLikeReport` or `LikeReportSheet`. Better: add a lint rule. (No code modification asked — just call out in plan.)

**Finding 6.2 — Public option leakage via PATCH (§16 矛盾 2; §7 v1 不实现)**
§16 矛盾 2 acknowledges PATCH could write `permission='public'`. §7 says "❌ PATCH /api/markers/:id/permission 专用端点" not built, but the **generic** `PATCH /api/markers/:id` (existing route, per `04_current_state.md §5`) accepts `permission` field. Without server-side hard-filter, a client tampering with the request body can write `'public'` to their own mark. **Need**: backend Story in Sprint 1: enforce `permission NOT IN ('public')` on PATCH validation for non-admin users. Tests must cover.

**Finding 6.3 — Public marker create endpoint (§7)**
Same risk for `POST /api/markers`. Spec says default is `permission='personal'` (DDL). If client posts `{permission: 'public'}` explicitly, server should reject. Spec text needed.

**Finding 6.4 — Fog clipping confirmation (§11)**
§11 says "Home masking / fog 自动裁切" is permanently not done. But agent 05 §I1-I3 raised this as a stalker-risk hard requirement. Plan §16 矛盾 1 sticks with "no fog hide". Plan accepts the risk. **OK, but**: §13 Risk does not list "domestic violence / stalker leak through fog". Devil's advocate had this as I1 critical. Decision should be **explicitly logged** in `docs/DISCOVERY.md §what-we-will-not-build` with rationale, not just in `_research/`. Otherwise it's not a real decision, it's a research note.

---

### 7. Sprint feasibility

**Finding 7.1 — Sprint 3 is too heavy (§14 Sprint 3 has 6 stories)**
Sprint 3 includes: Memory tab Mine|Friends + 5-friend pick + paywall + chip + 3 mark visuals (self/friend/stranger) + Mapbox iOS native fog UNION + Trails Flags Friends sub-tab. Mapbox iOS fog UNION alone is "never production tested" per §13 Risk 4. This is a Spike. Putting it in Sprint 3 with 5 other features means either Sprint 3 slips or fog UNION ships half-baked. **Recommend**: extract Mapbox fog UNION into Sprint 1 Spike (it's the highest-risk technical unknown), Sprint 3 only consumes the proven API.

**Finding 7.2 — Sprint 1 has 6 stories but mostly migration/seed (§14 Sprint 1)**
Story 5 "新增 API: 6 endpoints + circle UNION + LEFT JOIN hidden" + Story 6 "POST /api/hide + GET /api/markers/public + GET /api/friends/:id/marks /routes" together are 9+ new API endpoints. Each needs validation, error handling, test data, integration test. 1 sprint may be tight. **Recommend**: split Story 5 + 6 into 3 stories (subscriptions, circle UNION, hide + public).

**Finding 7.3 — Sprint 4 acceptance overload (§14 Sprint 4 Story 7)**
"完整 Playwright 14 scenario 跑通 + 用户真机 Memory tab 视觉验证" is one Story but realistically it's 14 verification runs + a user-time slot. Per CLAUDE.md "User Minimal Interruption" + memory's `feedback_playwright_before_realdevice.md`, the user real-device step is a separate Sprint gate, not a checkable AC. **Recommend**: split into "Playwright 14 scenario green" Story + "User real-device sign-off" gate.

**Finding 7.4 — Sprint 2's mark create toggle complexity (§14 Sprint 2 Story 4)**
"Mark 创建 UI 重做" is **only the checkbox change**, but `useMarkerStore.ts` + plant flow + edit flow + permission propagation through MarkerDetailScreen — each is a real touch. Per §11 v1 keeps 3-tier ENUM, the UI hides Public but the write path must still accept Friend/Personal correctly. Estimate likely 2-3 points, not the 1-2 implied by Story granularity. Verify with PM at Planning.

**Finding 7.5 — No Sprint dedicated to integration QA (§14)**
4 Sprints, each ending in functional ACs, but no buffer Sprint for end-to-end Playwright + Real device. v1.1 work is documented but no "v1 polish / hardening" Sprint exists. Per `04_current_state.md §3` + agent 06, the existing codebase has dead code (`useCommunityStore`) and unmounted hooks (`useLikeReport` for ARScreenV2). Cleanup is not in any Sprint. **Recommend**: explicit "Sprint 4.5 / hardening" gate covering dead-code removal + perf testing + real-device acceptance.

---

### 8. Risks user hasn't seen

**Finding 8.1 — Apple App Store paywall rule (Cat 8 of review prompt)**
§4.12 Paywall sheet shows "$4.99/月" + "Get Pro" CTA → "Coming soon" toast. **Apple App Review Guideline 3.1.1**: any IAP-required functionality in-app must use StoreKit. A fake paywall showing a price is **explicitly forbidden** by 3.1.1 ("Apps and their metadata may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than IAP"). Even showing the price without a real IAP can be rejected as a deceptive practice. **Need**: either (a) remove the dollar amount before TestFlight build (just "Get Pro — Coming soon"), or (b) implement real StoreKit with a placeholder product (deferred to v1.2 per §12). Plan §12 v1.2 has real IAP, but v1 Sprint 3 ships the fake price — **this will block TestFlight/Production**. Critical.

**Finding 8.2 — Performance: fog UNION on 5 friends (§13 Risk 4)**
Plan acknowledges this is untested. No concrete fallback path beyond "密度高时降级 dashed outline". What's the trigger threshold? When does fallback kick in? Spec needs numeric: e.g. "if combined polygon count > N, fall back". Otherwise developer eyeballs it.

**Finding 8.3 — `hidden_items` unbounded growth (cat 8)**
A user who aggressively hides every friend mark (10 friends × 20 marks each = 200 rows) is still trivial. But over 5 years × 100 friends × 50 marks = 25k rows / user. With 100k users × 25k = 2.5B rows. **Not a v1 problem, but**: no cap, no warning. Add: "hidden_items per user > 10k → log warning" telemetry. Trivial in code, big retroactive savings.

**Finding 8.4 — Hard-assert on `@cairn.demo` in production (§10 E11)**
If hard-assert is in the **client** and a real user accidentally signs up with a `@cairn.demo` email (e.g. someone owns that domain in 2027), the app crashes. Per §10 E11, the assertion is "production build". Need: domain ownership claim or explicit env-only assertion. The cleaner fix: ban registration of `@cairn.demo` emails server-side in `auth.js`, then the assertion is "if you see it, something is very wrong" not a normal user-input scenario.

**Finding 8.5 — Carol/Eve "frozen" state on Pro→Free downgrade (devils advocate §1 #1 A3; §10 E6)**
§10 E6: "Pro 用户降 Free 已勾 25 人 → v1 不实现降级". Plan defers but doesn't tell us what code DOES on downgrade. If a user gets a refund / IAP cancellation, what happens? **Acceptable** for v1 since there's no real IAP (per §12 v1.2). But: spec says limit is `users.memory_subscription_limit` numeric. If a user manually has 25 in DB and we change limit to 5, the trigger doesn't retroactively kick anyone out. Reads still return all 25. **Spec text needed**: "v1 limit always 5; no downgrade flow ever invoked".

**Finding 8.6 — Database charset / collation (§6 DDL)**
DDL uses `utf8mb4` good. But emoji in mark text — does the existing `markers.text` column (per `003_friends_markers.sql`) also use utf8mb4_unicode_ci or some legacy `utf8`? Reading `04_current_state.md §2`, schema is on `cairn` DB which was created at some point. If existing tables are `utf8mb3`, new tables `utf8mb4` JOIN will work but COLLATION may differ → ORDER BY mismatches + index inefficiency. **Verify**: SHOW TABLE STATUS on existing tables, confirm collation matches. Not in any Sprint.

---

## Independent judgment on the 5 v3-flagged open questions (§16)

The plan asks the user to confirm 5 矛盾. My recommendations:

### (a) Fog 是否能 hide?
**Plan default: NO.**
**My judgment: AGREE.** Fog is a continuous polygon — `hidden_items` is per-discrete-item. "Hide friend's fog tile X" makes no UX sense (fog tiles aren't visible objects, just rendered union). The user wanting to stop seeing a friend's fog should uncheck them in Memory subscription. Plan default is correct.
**Caveat**: ensure the Memory subscription uncheck IS the only path to stop seeing fog — and add UX hint in 5-pick modal: "uncheck to hide their fog/marks from your map".

### (b) PATCH 是否硬过滤 Public 写入?
**Plan default: YES (hard filter).**
**My judgment: AGREE strongly.** This is a security ACL question, not a product question. Server MUST reject `permission='public'` writes from non-admin clients. Otherwise §11 "v1 不做 Public 创建 UI" is a paper rule — anyone with a debugger circumvents it. **Action**: Sprint 1 backend Story has explicit AC. Same for POST /api/markers and POST /api/routes (default 'personal'; reject 'public' on write).
**My recommended exact rule**: server accepts `permission IN ('personal', 'group', 'friend')` for non-admin writes. Public writes require an admin flag (which v1 has no UI for, so de facto blocked).

### (c) Route 历史同步范围?
**Plan default: only `permission='friend'` routes.**
**My judgment: AGREE.** The §3 包含关系 says Personal ⊂ Friend ⊂ Public. A Route created with default `personal` and never modified should NEVER appear in friend feed even after accepting a new friend. Plan's default is internally consistent.
**Caveat**: existing routes (before migration 018) have NO `permission` column. After migration, default is `'personal'`. So all pre-v3 routes are personal — they will not sync as history. This is the right safety default but should be explicitly stated in §5 Journey 1 step 6 ("only routes user has explicitly set to Friend after migration 018 will sync").

### (d) 长按 context menu 包含哪些项?
**Plan default: "Hide from me" + "Use this mark"** (Memory map) and same in Trails list.
**My judgment: ADJUST.**
- For **friend's mark** in Trails Friends sub-tab: context menu = **"Hide from me"** only. "Use this mark" should be a tap-to-detail-sheet flow, not a long-press item (matches platform iOS conventions — long-press = secondary actions like delete/hide).
- For **friend's mark** on Memory map: long-press = small popover with "Hide from me" + tap-to-detail-on-map. "Use this mark" goes into the detail sheet, not the long-press menu.
- For **own mark**: long-press = "Edit" / "Delete" (existing v0 behavior, untouched).
- For **stranger Public mark**: long-press = NO-OP in v1 (matches §11 "no interaction").

This split removes ambiguity about which long-press behavior applies where.

### (e) Hide 永久 vs 重建关系冲突?
**Plan default: hidden_items persists across friend remove/re-add.**
**My judgment: AGREE BUT with UX warning.**
The user has explicitly said "Hide is permanent" — that's the social contract. But there's a soft UX issue: a user who hides a mark, removes the friend in anger, and weeks later reconciles and re-adds them, will be confused why some marks don't show up. The technical answer is right; the UX answer needs a safety valve.
**My recommended addition**: when a user **re-adds a previously-removed friend** (Friend Request accepted), show a one-time toast: "Note: items you previously hid from this friend remain hidden. Manage in Settings → Hidden Items (coming v1.1)." This sets expectations without rebuilding the hidden_items semantics.

Alternatively, **purge hidden_items on friend re-add** — but this changes the "hide forever" promise. Don't pick this without explicit user re-confirmation.

---

## Top 5 must-fix before /project (the actual blockers)

These are the items that, if not resolved before Sprint 0, will cause Sprint 1-4 to thrash or ship a broken product:

1. **Apple App Store rejection risk on fake paywall with $4.99 price** (Finding 8.1). Either strip the price or accept the rejection. Decide now, in plan. This is the single highest-risk item — it can block TestFlight at the end of Sprint 3 and waste a week.

2. **Backend hard-filter `permission='public'` writes on `POST /api/markers`, `POST /api/routes`, `PATCH /api/markers/:id`, `PATCH /api/routes/:id`** (Finding 6.2, 6.3; §16 矛盾 2). Add explicit Sprint 1 backend Story with AC: "non-admin client posting `permission='public'` receives 403". Otherwise §11 "v1 不出 Public UI" is unenforceable.

3. **Trigger race on `memory_subscriptions` cap** (Finding 2.2). Either wrap trigger in `SELECT ... FOR UPDATE` on `users` row, OR rely on `UNIQUE(user_id, friend_id)` + app-layer retry on 45000. Pick one. Spec text needed.

4. **Mock account login path validation** (Finding 1.1). Confirm `auth.js` POST `/api/auth/login` does NOT re-apply the length>=8 check before bcrypt compare. If it does, 10 single-character passwords fail at login and Sprint 1 acceptance breaks. Verify the code BEFORE Sprint 1 starts. (Read `auth.js` login handler. If length-check exists, plan must adjust passwords to >=8 chars or add a `@cairn.demo` bypass.)

5. **Sprint 3 fog UNION on Mapbox iOS is a Spike, not a Story** (Finding 7.1). Move it to Sprint 1 as a `SPIKE-NNN`. Otherwise Sprint 3 timeline is at 60-70% risk of slipping per §13 Risk 4 explicit statement.

---

## Open questions to ask user

In addition to the 5 v3 self-flagged (which I've judged above), the following NEW questions arose from this review and need user input:

1. **Apple paywall copy strategy**: are we OK to ship the $4.99 price in Sprint 3's TestFlight build, knowing it may delay approval, OR strip the price to "Coming soon" only?

2. **Mock account hard-assert location**: backend startup, client startup, or both? What's the failure behavior — exit code, log + continue, modal alert?

3. **Re-friend hidden-items UX toast** (my §16-e recommendation): should we show "items previously hidden remain hidden" on Friend re-add, or stay silent and let users discover?

4. **Carol mock account role**: keep as Public-only (currently appears nowhere in 9163's friend-visible UI) or convert to Friend-content provider? If Public-only, what's her purpose in v1 test data?

5. **Convert Activity → Route entry point**: §15 Q5 says we keep this in v1 — confirm by adding it explicitly to §4.7 Trails Activities ASCII sketch with a tap target.

6. **Stranger Public mark visual when 3 stack** (Finding 5.3): 3 separate icons (current default) or v1 mini-cluster (move some v1.1 logic earlier)?

7. **Cron infrastructure for `hidden_items` orphan cleanup** (Finding 2.1): what's the runner (node cron, systemd, sidecar)? Schedule (weekly)? Monitoring (just rely on row-count metric, or fail-loud)?

---

End of review.
