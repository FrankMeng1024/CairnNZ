# V4 Plan Review

**Reviewer**: Independent product+engineering review (Opus)
**Date**: 2026-06-27
**Subject**: `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md` (delta from v3)

## Verdict
- [ ] APPROVE — ready for /project Sprint 0
- [x] APPROVE WITH MINOR FIXES — 5 spec gaps to fix, then ready
- [ ] BLOCK — major issues

v4 is genuinely a delta document. It accepts user's 6 product decisions cleanly and converts most V3_REVIEW findings into specific Sprint stories. **But** the 6-form Mark detail matrix introduces 2 new internal inconsistencies, the 5-friend pick math in §9 Scenario 6 doesn't add up, and 2 of the "✅ Fixed" claims in §15 are mis-classified. None block Sprint 0; all can be patched in 1 hour.

---

## Phase 1: V3 Review 24 findings 处理验证

### Spot-check of ✅ Fixed claims

| Finding | v4 §15 status | Where v4 actually addresses | Verified? |
|---|---|---|---|
| 1.1 auth.js login length check | ✅ Fixed (F1 Story 1) | §14 F1 Story 1 "auth.js login 验证 (30 秒读代码 + 修正)" | ✅ Real but **shallow** — "verify" is not a fix. If login does check length, what then? §15 should say "F1 Story 1 + if check exists, modify or bypass". Current text only schedules an investigation. |
| 1.2 has_seen_friend_disclaimer dead | ✅ Fixed (DDL 移除) | §6 DDL comment "v4: 删除 v3 的 has_seen_friend_disclaimer" — but the `ALTER TABLE users` block does NOT actually have the column removed; comment says it's removed but the DDL above only adds account_type + memory_subscription_limit, never mentions has_seen_friend_disclaimer. **Acceptable** because v3 added it and v4 just doesn't add it (since v4's migration is fresh). But the comment is misleading: "删除" implies a DROP COLUMN; reality is "never added in v4 migration". | ⚠️ Inaccurate phrasing |
| 1.3 Carol Public-only mismatch | ✅ Fixed (Carol 改 stranger) | §8 test data table: Carol = "stranger→friend conversion test"; §4.15 full journey | ✅ Genuinely fixed |
| 2.1 hidden_items cron 不明 | ✅ Fixed (F1 Story 6 + TECH_SPEC §cron) | §14 F1 Story 6 "hidden_items cron + DevOps 写入 TECH_SPEC §cron" | ✅ Scheduled; actual content (`node-cron in-process` per §1 row Q) is specified |
| 2.2 Trigger race | ✅ Fixed (DDL FOR UPDATE) | §6 DDL line "SELECT memory_subscription_limit INTO max_allowed FROM users WHERE id = NEW.user_id FOR UPDATE" | ⚠️ **Doesn't actually fix the race**. FOR UPDATE locks the `users` row, but the race is on `COUNT(*)` from `memory_subscriptions`. Two parallel INSERTs each lock different `users` rows (same row actually — NEW.user_id is same), so the second INSERT will block until first commits → THEN reads count → sees count incremented → fail. **OK, the lock on the same `users` row DOES serialize**, because both transactions lock the same row. **But the count itself isn't gap-locked** — if INSERTs come from completely separate transactions hitting `users` from a different code path that doesn't FOR UPDATE that row, the protection fails. **Reasonable fix for production**, just isn't bulletproof. Note in TECH_SPEC. |
| 2.3 Permission constant 散落 | ✅ Fixed (F1 Story 2) | §14 F1 Story 2 "Migration 018 applied + permission constant centralized" — but §1 row R says file is `backend/src/constants/permission.js`. **The Story title doesn't reference the constant file**; it says "centralized" generically. Risk: dev does migration but forgets the constant file. Story 2 needs split: "Migration 018" + "Permission constant file at backend/src/constants/permission.js". | ⚠️ Story title too generic |
| 2.5 friend-must-be-friend | ✅ Fixed | §6 DDL trigger has `SELECT COUNT(*) FROM friends WHERE user_id=NEW.user_id AND friend_id=NEW.friend_id` block | ✅ Genuine. Good |
| 3.1 Self-add | ✅ Fixed (A 变化) | §1 row A: "inline error + button disable" | ✅ But: **v4 doesn't say where the client check happens** (e.g., AddFriendSheet.tsx onChange handler). Acceptable for plan-level; Story acceptance needs the location |
| 3.2 Duplicate-add | ✅ Fixed (B 变化) | §1 row B | ✅ Same caveat as 3.1 |
| 3.3 5-pick at-cap | ✅ Fixed (G 变化) | §1 row G "多于 5 个都显示 + 🔒" | ✅ But no spec for what `tap on 🔒` does. v3 review §3.3 specifically asked this. v4 §1 row G says "显示 + 🔒" — silent on tap. **Gap**: confirm in §4.5 ASCII (which v4 doesn't repaint) or add explicit text "tap 🔒 → Paywall sheet". |
| 3.5 Hide route polyline | ✅ Fixed (F2 Story 5) | §14 F2 Story 5 "Hide from me 流程 + 客户端 cache wipe" | ✅ Story scheduled; AC details deferred to Planning |
| 3.7 Remove friend cascade | ✅ Fixed (DDL CASCADE) | §6 DDL `ON DELETE CASCADE` on memory_subscriptions FKs | ✅ |
| 4.1 "Immediate sync" 措辞 | ✅ Fixed (H 变化) | §1 row H "next-pull-on-focus" | ✅ But v4 does not show the new modal copy. v3 §4.1 has full ASCII; v4 doesn't repaint. Risk: developer copies v3 ASCII verbatim, which still says "Send Request" without next-pull wording. **Minor gap** — Sprint 2 Story 1 AC must require the new copy. |
| 4.2 Offline cache hide | ✅ Fixed (P 变化 / F2 Story 5) | §1 row P "client-side useMarkerStore 主动 wipe" | ✅ Genuine |
| 4.4 Uncheck friend 立即消失 | ✅ Fixed (F4 Story 3 AC) | §14 F4 Story 3 "fog UNION 渲染" | ⚠️ **Story 3 is "fog UNION 渲染"**, which is rendering, not unsubscribe-then-redraw. The "uncheck friend → friend marks vanish 500ms" AC v3 §4.4 asked for is **not visibly attached** to this story. Likely will be covered, but spec should explicitly say so. |
| 6.1 Like/Report imported by mistake | ✅ Fixed (F2 Story 4) | §14 F2 Story 4 "Like/Report UI 接入 (假 API)" | ⚠️ **Confusing**: V3_REVIEW finding 6.1 was that production should NOT import the existing useLikeReport hook (it's stale dead-code on ARScreenV2 path). But v4 §4.12 says we DO build new UI for Like/Report — using fake state, not the existing hook. So both can be true (don't import OLD useLikeReport, build NEW fake UI). v15 row 6.1 marking "Fixed" is **partially correct but mixes two different concerns**. The dead-code grep / cleanup is in F5 ("dead LikeReportSheet from ARScreenLegacy"). OK if reader follows §14 carefully. |
| 6.2 PATCH public leak | ✅ Fixed (K 变化) | §7 endpoints 9-10 "PATCH /api/markers/:id v4 H1: reject permission='public'" | ✅ |
| 6.3 POST public leak | ✅ Fixed (K 变化) | §7 — but §7 only lists `PATCH /api/markers/:id` + `PATCH /api/routes/:id` with the H1 note. **POST is missing from the explicit H1 reject list.** v4 §1 row K says "POST/PATCH 拒 permission='public'" but §7 only spells out PATCH. **Gap**: §7 must add `POST /api/markers reject permission='public'` and `POST /api/routes reject permission='public'`. |
| 7.1 Sprint 3 too heavy | ✅ Fixed (N 变化 Spike to F1) | §14 F1 Spike-1 "Mapbox iOS fog UNION 技术验证" | ✅ Good |
| 7.3 Sprint 4 acceptance overload | ✅ Fixed (F5 hardening 抽出) | §14 F5 sprint | ✅ Good |
| 7.5 No hardening sprint | ✅ Fixed (F5 加入) | §14 F5 | ✅ Good |
| 8.1 Apple App Store guideline | ✅ Fixed (J 变化 TestFlight only) | §1 row J | ⚠️ **Acceptance** of risk, not technical fix. Reasonable — TestFlight rules are looser than App Store production review (Apple does NOT review TestFlight builds against guideline 3.1.1 the same way; it's beta-only). But the **transition path to v1.2 IAP** still has the price-display issue when the public App Store build ships. v4 §12 v1.2 says "IAP 真接入" — confirm that's BEFORE App Store submission of any public build. As-written, this is OK. |
| 8.4 @cairn.demo prod assert | ✅ Fixed | §15 "server-side block register 同时 client assert" | ✅ Reasonable approach |

### Spot-check of ⏸ Deferred claims

| Finding | v4 §15 status | Sanity |
|---|---|---|
| 3.4 Trails Friends empty state | ⏸ v1.1 | ⚠️ **Bad defer.** Empty state is the **most common state** for new users (anyone before friend accept). Shipping the Friends sub-tab without specifying empty state will result in "Friend list shows nothing, no copy, user thinks app is broken." This is not a v1.1 polish issue; it's Sprint 2/4 Story acceptance. **Recommend**: move back into F4 Story scope. Cost: one ASCII sketch + 4 lines of empty-state copy. |
| 3.6 Memory chip 0 subscribed | ⏸ v1.1 | ✅ "👥 0 of 5" default is acceptable; UX nit not blocking |
| 4.3 Memory friends perf | ⏸ v1.1 (F5 "< 3s p95") | ⚠️ Title says "Deferred" but action ("F5 acceptance") is in v1. **Mis-classified**. Should be ✅ Fixed (F5 perf acceptance). |
| 7.2 Sprint 1 too heavy | ⏸ 接受 | OK — 6 stories with Spike is tight but Arch will absorb at Planning |
| 7.4 Mark UI complexity | ⏸ Accept | OK |
| 8.2 fog UNION perf threshold | ⏸ v1.1 (Spike-1 出具体数字) | ⚠️ Same mis-classification: action is in v1 (F1 Spike), result feeds v1.1 threshold. Mark as ✅ Partially-fixed, not ⏸. |
| 8.3 hidden_items unbounded | ⏸ v1.1 telemetry | OK |
| 8.5 Pro→Free downgrade | ⏸ v1.2 (v1 always 5) | OK |
| 8.6 Charset utf8mb4 | ⏸ Verify (F1 第一件事 SHOW TABLE STATUS) | ⚠️ Same mis-classification — action is in v1 F1, not deferred. |

### Spot-check of ❌ Rejected claims

| Finding | v4 §15 status | Sanity |
|---|---|---|
| 1.4 Activity→Route convert 矛盾 | ❌ Rejected ("Activity 不动") | ✅ User said this. But v3_REVIEW §3.4-7 asked for the entry point UI sketch. v4 also doesn't add it to §4.7. Net: **if "Activity 不动" means literally no Convert to Route in v1, fine.** Otherwise spec gap. Need confirmation. |
| 6.4 Fog masking 必修 | ❌ Rejected | ✅ Explicit user decision. V3_REVIEW recommended this go into `docs/DISCOVERY.md §what-we-will-not-build`. v4 doesn't reference DISCOVERY.md (because it's pre-/project). **Note for Sprint 0**: SM must transcribe this rejection into DISCOVERY.md, not leave it in `_research/`. |

### Summary

V3 Review claimed 24 findings. v4 reports 19 ✅ / 9 ⏸ / 2 ❌ = 30 — overcounting because v4 split some original findings (5.1-5.5 collapsed to one row; 7.x is multiple). Net status accuracy: **~17 out of 24 genuinely fixed, 4 mis-classified (real fix but tagged Deferred or vice versa), 2 partial / shallow, 1 OK to defer.** Material; not blocking.

---

## Phase 2: 用户本次 session 6 拍板验证

| # | User decision | Where in v4 | Accurate? |
|---|---|---|---|
| 1 | TestFlight 内测保留 $4.99 | §1 row J + §15 (8.1) "TestFlight only" | ✅ |
| 2 | Activity 不动 + Route 两档 | §1 row no-explicit-mention; §6 DDL "Routes 加 visibility ENUM(personal,friend,public)"; §15 (1.4) "❌ Rejected — 用户拍板 Activity 不动" | ⚠️ "Route 两档" = personal/friend (no public via UI), but v4 §6 DDL ALTERS `routes` with **all three** ENUM values. Decision says routes UI offers only 2 archives (personal/friend). DDL holds 3. **Acceptable** if §1 row K (POST/PATCH reject public) extends to routes, but §7 explicitly only lists `PATCH /api/routes/:id` with the H1 reject — not POST. So a client can `POST /api/routes {permission:'public'}` and bypass. **Gap reaffirmed from Phase 1 finding 6.3.** |
| 3 | Carol = stranger→friend conversion | §8 test data table + §4.15 full journey | ✅ Genuine |
| 4 | Add Friend self/duplicate 拦截 | §1 rows A/B "inline error + button disable" | ✅ But Story location (Sprint, file) not specified |
| 5 | Memory pick modal 第 6+ 都显示 + 🔒 | §1 row G + §14 F4 Story 2 "5-friend pick modal (6+ 显示 🔒)" | ✅ Yes. Tap-on-🔒 behavior still not specced (Phase 1 finding 3.3). |
| 6 | Like/Report UI 接但不接 API | §1 row E + §4.12 spec | ✅ Genuine. **Sub-decision**: "5 秒后状态回退" vs "本 session 留红色" — v4 §4.12 lists both as alternatives, not picked. **Gap**: pick one. Default = "本 session 留红色, refresh 回退" (matches loss-aversion pattern). |
| 7 | Mark **tap**, not long-press → detail sheet 6 形态 | §1 row C/D + §3 matrix + §4.11 6 ASCII forms | ✅ Genuine. But matrix and ASCII forms diverge — see Phase 3. |
| 8 | Delete = 黑名单, 未解锁陌生人不能 delete | §1 row F + §3 matrix row "陌生人 / 没走过 → 无任何 action" | ✅ Genuine and consistent. |

Net: **6 explicit decisions + 2 sub-decisions (tap vs long-press; delete semantics). 1 genuine ambiguity** (Like/Report 5s vs session) + 1 unresolved (tap 🔒 behavior).

---

## Phase 3: v4 内部一致性

### Inconsistency 1: §3 Matrix vs §4.11 6 ASCII forms — DELETE on own marks

§3 matrix row 1-2:
> | 我自己 | personal | 当然走过 | 完整 + 私人标记 | **Edit / Delete (真删除)** |
> | 我自己 | friend | 当然走过 | 完整 + Friend 标记 | **Edit / Delete (真删除)** |

§4.11 form A & B both show `[ Edit ]  [ Delete ]` — consistent.

§3 matrix rows 3-7 say "Delete (黑名单)" for non-self marks, with the action labeled `[ Delete from view ]` in §4.11 forms C/D/E/F.

**Conflict on form E (好友 Public + 我走过)**: matrix row 5 says actions = `Delete + 赞 + Report(UI 假)`. §4.11 form E shows:
```
❤ 12   🚩 Report  [ Delete ]
```
The button says `[ Delete ]` not `[ Delete from view ]`. Reader may think this is a real delete. **Fix**: change to `[ Delete from view ]` for consistency with forms C/D.

Same issue on form F (陌生人 + 我走过): "Delete" should be "Delete from view".

### Inconsistency 2: §3 matrix vs §4.11 — Author name on Public marks

§3 matrix row 7: "陌生人 / public / ✅ 走过 → 完整 + 'Public mark' 标签 + Delete + 赞 + Report"

§4.11 form F renders this stranger-public-walked state with:
```
🌍 Public mark
✓ You discovered this
```
**No author name shown** — consistent with "陌生人" (we don't know them).

But §3 matrix says nothing about hiding the author's name. Real privacy decision: when a stranger's Public mark is walked, do we show "Posted by username" or just "Public mark"? §4.11 form F **hides author**. **OK as a privacy default**, but the matrix doesn't make this explicit. **Fix**: matrix row 7 should say "完整 - 作者名" not "完整".

### Inconsistency 3: §9 Playwright Scenario 6 math

> 9163 想加 Eve 进 Memory subscription（已满 5 个）→ 第 6 个 🔒 → 点击弹 paywall

But §8 test data table says 9163 initial friends = [Alice, Bob, Dave, LDY, Eve] = 5 friends.
§4.15 Carol journey requires 9163 to ADD Carol (currently stranger). So after Carol accept, 9163 has 6 friends: [Alice, Bob, Dave, LDY, Eve, Carol].

Scenario 5 (in §9) says "勾 Alice/Bob/Dave/LDY/Carol → fog UNION 显示" = 5 subscriptions, all 5 slots used.
Scenario 6 then says "想加 Eve" — but Eve is already a friend; subscribing Eve is the 6th memory pick.

OK so the math IS internally consistent: 6 friends total, 5 subscription slots, Eve is the 6th-friend-not-subscribed → tap her → paywall.

But §4.15 step 4 says "9163 通过线下知道 Carol 邮箱". For this story to work, **Eve must NOT be initially subscribed when Carol joins**. Otherwise §9 Scenario 5 (subscribe to Carol) requires unchecking someone first. v4 doesn't spec the initial subscription state — only initial friends. **Gap**: §8 test data table needs an "Initial Memory subscriptions" column. Simplest: 9163 starts with 0 subscriptions, picks 5 after Carol joins.

### Inconsistency 4: §14 F1 vs §6 DDL — `account_type` semantics

§14 F1 Story 6 is "hidden_items cron". §1 row Q says cron is "node-cron in-process + 每周一次". 

But §6 DDL `users` adds `account_type ENUM('free','pro')` and `memory_subscription_limit INT DEFAULT 5`. **Where does `memory_subscription_limit` flip from 5 to 25?** v4 §12 says IAP is v1.2. So the column exists but no code path changes it in v1. **Fine, but v4 should explicitly say "v1 always 5; pro flag exists in DB but unused"**. Currently silent — risk of dev wiring it up speculatively.

### Inconsistency 5: §9 numbering

Scenario numbering goes 1-15 in the section title, but the list runs 1-18 (with §9 line items numbered 16, 17, 18 as "API contract test" and "Trigger concurrency test"). **Cosmetic**: either rename section title to "18 个" or remove the 3 API tests.

---

## Phase 4: v4 新引入的问题

### New issue 1 — §3 matrix gap: Friend's Personal mark

Matrix has 7 rows. None covers: **friend's mark with permission=personal**. By Gate 1 (visibility) this is filtered out at the API layer (friend can't read other's personal marks). But §3 matrix should state the row exists and resolves to "不显示". Otherwise a reader wonders if it's a missing case or a deliberate exclusion. **Trivial fix**: add row "好友 / personal / 任意 / **不显示** / —".

### New issue 2 — §9 Scenario 17 (PATCH 公开拒绝) doesn't exist as Scenario; it's in 16/17

OK; scenario IDs 16-18 cover this. Just confirm Playwright tests for **POST** /api/markers public reject (separate from PATCH). Currently §9 line 16 only says POST; line 17 only PATCH. Routes are not covered at all — `POST /api/routes {permission:'public'}` rejection scenario is **missing**.

### New issue 3 — §9 Carol stranger→friend in Playwright

Scenario 4: "9163 Add Friend 输入 Carol 邮箱 → success → **Carol accept**". 

Playwright must simulate 2 user sessions (9163 + Carol's account in another browser context). v3 Plan §9 Scenario 3 did this with "两 browser context". v4 doesn't restate the technique. **For F5 acceptance**, the Carol journey requires:
1. 9163 logged in (context A)
2. Carol logs in separately (context B)
3. 9163 sends request → 9163 fg pauses → Carol fg activates → Carol accepts → context switch

Playwright DOES support this via `browser.newContext()`. v3 plan confirmed it works. **OK to keep**, but Sprint 0 acceptance docs should reference the multi-context pattern.

### New issue 4 — §14 F2 Story 5 "Hide from me 流程" missing matrix row reference

F2 Story 5 says "Hide from me 流程 + 客户端 cache wipe (review §4.2)". But Hide is now subsumed by "Delete from view" per §3 matrix. **Are "Hide from me" and "Delete from view" the same action**? v3 used "Hide" as primary verb; v4 §3/§4.11 use "Delete from view". F2 Story 5 still says "Hide from me". **Naming inconsistency** — pick one verb. Recommended: "Delete from view" (matches the 6 forms' button text). Then F2 Story 5 should be renamed too.

### New issue 5 — §6 DDL trigger doesn't fire on UPDATE

Trigger is `BEFORE INSERT`. What if a row already exists for user X with friend_id=A, and someone does `UPDATE memory_subscriptions SET friend_id=B WHERE user_id=X AND friend_id=A`? Friend-must-be-friend check is bypassed. **Practical risk: low** because no API endpoint emits UPDATE; only POST (INSERT) / DELETE. But a malicious developer adding a bulk re-assign script could violate. **Acceptable** as a known limitation if documented; otherwise add `BEFORE UPDATE` trigger.

### New issue 6 — Activity 不动 vs Convert-to-Route entry point

v3 Review §1.4 + v3 Plan §15 Q5 both agreed: Convert-to-Route IS in v1, but the ASCII for Trails Activities doesn't show the button. v4 §15 marks 1.4 as **❌ Rejected ("用户拍板 Activity 不动")**. Conflict: does "Activity 不动" mean (a) no convert button at all (Activity is sealed in personal forever) or (b) Activity sub-tab is Mine-only with no Friends segment but still has Convert? **v4 ambiguity**. Need user confirmation. Default per v3 Q5 was "Convert IS in v1". v4 rejection might break that. 

### New issue 7 — §15 trigger concurrency test (Scenario 18) feasibility

"2 个并发 POST /api/memory-subscriptions 第 5+6 个 → 1 个 success / 1 个 fail (race protected)". 

Playwright doesn't directly support testing race conditions; you'd need 2 contexts firing simultaneously with `Promise.all()`. Even then, on localhost, network jitter makes "true concurrent" inconsistent. **Recommend**: this becomes a `node` integration test (Jest + supertest directly hitting backend), not Playwright. F5 story should split: "Playwright UI + Node integration tests".

---

## Phase 5: v3 5 个 open question 处理验证

V3 §16 raised 5 矛盾. v4 §16 says "无. 所有问题已在本次 session 拍板". Let's verify each is actually addressed:

| V3 §16 矛盾 | v4 resolution location | Verified? |
|---|---|---|
| (a) fog 能 hide? | §3 matrix: no row about fog hide. §1 row Q hidden_items cron implies still mark/route only. §1 row S "Make personal" toggle = no fog control. Implicit: fog cannot be hidden. | ⚠️ **Implicit only**. Should be explicit in §11 "永久不做". Currently §11 says only "Fog 裁切 / Home masking" — doesn't say "Fog single-friend hide". **Recommend**: add "Fog hide per-friend" to §11. |
| (b) PATCH 拒 Public 写入? | §7 endpoints 9-10 explicit. §1 row K confirms POST + PATCH | ✅ But POST routes is missing — see Phase 1 finding 6.3 |
| (c) Route 历史同步范围? | §6 DDL: routes default `'personal'`. v3 plan §16 (c) said "only `permission='friend'` routes sync". v4 silent on this. | ⚠️ **Unresolved**. v4 §15 row 5.1-5.5 (test data) doesn't mention. Implicit yes (default personal, opt-in friend), but should be in §10 边界 case. |
| (d) 长按 menu 包含哪些? | §1 row C "无长按概念" + §3 matrix uses tap only | ✅ Resolved by eliminating long-press entirely. Sub-action: **Delete = tap the Delete button in detail sheet**, not long-press. v4 §1 row C is the resolution. |
| (e) Hide 永久 vs 重建好友冲突? | §1 row F "未解锁陌生人 mark 不能 delete"; §10 implicit (continues v3 hidden_items permanent semantics) | ⚠️ **Partial**. (e) was specifically about "user hides mark, removes friend, re-adds friend — does the hide persist?". v3 plan §10 E4 said YES, persist. v4 doesn't reprint this. Trivial gap — add E4 reference to v4 §10. |

Net: **3 of 5 fully resolved**; 2 left implicit (a, c) need explicit text in §10 or §11.

---

## Top 5 must-fix before /project

These are the actual gaps that would cause Sprint 1 thrash:

1. **§3 matrix row for "好友 Personal mark"** — add explicit "不显示" row to close the gap. 1-line fix.

2. **§7 missing POST + Routes hard-filter** — §1 row K says "POST/PATCH 拒 Public" but §7 endpoint list only adds the H1 note to `PATCH /api/markers/:id` and `PATCH /api/routes/:id`. Need 2 more entries: `POST /api/markers reject permission='public'` and `POST /api/routes reject permission='public'`. Otherwise §11 "Public 不出 UI" is bypassable.

3. **Naming: "Hide from me" vs "Delete from view"** — §3 matrix, §4.11 forms, and §14 F2 Story 5 use 3 different phrasings for the same action. Pick one (recommended: "Delete from view"), apply globally.

4. **Tap-on-🔒 behavior in 5-pick modal** — §1 row G says "显示 + 🔒" but never specs what happens on tap. Add to §1 or §4.5 (v4 doesn't repaint §4.5): "Tap 🔒 → Paywall sheet".

5. **Like/Report state persistence: 5s回退 vs session-持续** — §4.12 lists both alternatives. Pick one. Recommendation: "本 session 留红色, refresh 回退" (loss-aversion friendly).

---

## Open questions to ask user

1. **Activity → Convert to Route entry point in v1?** v3 Plan §15 Q5 said YES (Convert button in Activity row); v4 §15 marks 1.4 as ❌ Rejected with "Activity 不动". Clarify: (a) no Convert button at all in v1, or (b) Activity sub-tab is Mine-only (no Friend segment) but Convert button still exists?

2. **Fog hide per-friend** — v3 §16 (a) flagged this as unresolved. v4 implicitly says no, but §11 "永久不做" doesn't list it. Confirm "fog cannot be selectively hidden per friend" and add explicit §11 entry?

3. **Initial Memory subscription state for 9163 in test data** — §8 lists initial friends but not initial subscriptions. Confirm: 9163 starts with **0** subscriptions so the 5-pick modal opens empty?

4. **§3 matrix row 7 — show author name on stranger Public mark?** §4.11 form F hides it; matrix is silent. Confirm: hide author for strangers (privacy default), show only "🌍 Public mark"?

5. **Trigger race precision** — §6 trigger FOR UPDATE on `users` row works because both INSERTs lock the same row. But if a future code path bulk-inserts subscriptions across many users without going through trigger (e.g., admin tool), the count check fails. Confirm acceptance: trigger is the ONLY write path in v1?

---

End of V4 review.
