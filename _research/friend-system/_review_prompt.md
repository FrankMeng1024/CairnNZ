# V3 Review Prompt — Pre-Drafted

任务 (一旦 FINAL_PRODUCT_PLAN_v3.md 出来,立刻派一个 subagent 执行):

---

You are an independent product reviewer + senior engineer. Your job is to find problems in `C:\ClaudeCodeProjects\Cairn\_research\friend-system\FINAL_PRODUCT_PLAN_v3.md`. **Be skeptical**. The user explicitly asked "subagent review 一下 看下有问题吗 有问题问".

## What you have access to

- `FINAL_PRODUCT_PLAN_v3.md` — the final v3 plan to review
- All previous research in `_research/friend-system/v2-deep/`
- `04_current_state.md` — current codebase state
- `TEST_DATA_PLAN.md` — test data design

## What you must check

### Category 1: User decision drift
v3 went through 5+ rounds of user decisions. Read the plan and verify each user decision is faithfully reflected. List any drift or contradiction.

Key decisions (re-stated for your reference):
- Friend has no upper limit; Memory subscription has 5-cap (paid extend)
- No `is_mock` flag, no `friend_share_settings` pause table, no `home_clusters` (user explicitly rejected all three)
- No interaction (no ❤, no comment, no caption viewer count)
- Add Friend modal has NO share checkboxes — defaults all on
- Mark/Route creation is a simple toggle "Make personal", default Friend
- Public option NOT shown in mark/route creation UI (Public schema kept for v1.1)
- Trails: Activities only Mine; Flags + Routes have Mine|Friends sub-tabs
- Friend content read-only + "Hide from me" personal blacklist (NEW in v3)
- Hide is permanent and irreversible
- History sync immediate on accept
- Remove friend = bilateral permanent delete
- Stranger Public mark on Memory map = grey icon only, no interaction (v1)
- Like/Report system is production-live backend but UI broken since v025 (LikeReportSheet not in ARScreenV2) — v1 doesn't fix it, v1.1 does
- No AR (user said "现在没有AR了")
- Test data: 9163 keeps only Back Loop; other 4 sessions deleted (NOT migrated); 10 mock accounts with single-char passwords inserted directly via bcrypt bypassing auth.js

### Category 2: Schema design integrity
Verify the DDL in v3 §6:
- ALTER users ADD account_type, memory_subscription_limit, has_seen_friend_disclaimer
- ALTER routes ADD permission ENUM
- NEW memory_subscriptions table + 5-cap trigger
- NEW hidden_items table (NEW in v3)
- markers.permission legacy 'group' value normalized to 'friend' in app layer

Issues to look for:
- Missing FK or indexes
- Edge cases where trigger fires on wrong condition
- Race conditions on hide+unhide (even though no unhide, but) or hide+remove-friend
- Cascade behavior on friend removal — does hidden_items get cleaned? Does memory_subscriptions cascade?

### Category 3: UI flow gaps
Read all ASCII sketches in §4. Find:
- Inconsistent labeling (Friend vs Friends vs friend)
- Missing back-button paths
- Modal/sheet not dismissable
- Add Friend modal: does the email field allow self-add? Should error if user inputs their own email
- 5-friend pick modal: when at 5, what happens to clicking the 6th? UI should show paywall, but spec the exact transition
- Hide from me: where is the "see my hidden items" undo path? Spec says permanent — verify no undo is offered anywhere
- Trails Friends sub-tab when zero friends added: empty state UI? "Add friends first" prompt?

### Category 4: Data flow integrity
For each user journey in §5:
- Trace what happens on each tap
- Find any "magic data appearance" without explanation
- Verify "immediate sync on accept" is feasible — is there a push channel or does client poll?
- Verify hide-from-me works on offline-cached marks (mobile may have cached the marker before hide)
- Memory tab: when I uncheck a friend from Memory subscription, do their marks disappear immediately?

### Category 5: Test data realism
Check §8 (test data plan):
- 10 mock accounts plus 9163 = 11 total
- Can all 10 mock accounts genuinely log in (bcrypt hash of 1, 2, 3, ... x1, x2, x3 must be inserted)?
- bcrypt cost — what cost factor? Default 12 is slow for 10 accounts but acceptable
- The `Carol — Public-only friend` test role: Carol is in the friend list but her marks are all Public, not Friend. In v1, do I see her marks at all? (v1 Public has no UI). If not, why is she in the test matrix?
- Stranger 1/2/3 accounts: they are NOT friends. How do I see their Public marks? v1 has stranger Public mark icon on Memory map.
- The 3 Stranger Public mark patterns (single / heatmap / chain): does ASCII sketch in §4 show how heatmap (3 marks in 100m) renders visually? Cluster algo is v1.1, but 3 overlapping marks at zoom level 14 — what does the user see?

### Category 6: v1 scope discipline
Verify each "v1 不做" item in §11 is truly not done in plan:
- No AR — confirm no plan calls AR
- No Like/Report UI — confirm no plan adds LikeReportSheet
- No Public mark interaction — confirm Stranger Public mark icon is read-only
- No home masking — confirm
- No fog clipping — confirm
- No silent caption badge — confirm
- No pause toggle — confirm
- No is_mock flag — confirm DDL doesn't have it
- No friend search/discovery — confirm

### Category 7: 4-sprint feasibility
Read §14. For each sprint:
- Are stories realistic in scope (1-3 days each)?
- Sprint dependencies make sense (F2 needs F1 schema)?
- F4 (Memory `Mine|Friends` + fog UNION + 5-pick modal + Paywall + Stranger icon) is the heaviest — should it split?
- Estimated total stories — too many or too few?

### Category 8: Risks user might not see
Find risks the user hasn't been warned about:
- Performance: Memory `Friends` mode with 5 friends * N marks each — query cost?
- Mapbox iOS: rendering 5 friends' fog as UNION — performance impact?
- Storage: hidden_items can grow unbounded if user is aggressive — any cap?
- App Store review: even fake paywall — does it trip Apple's "must have IAP if showing prices" rule?
- Mock data: bypassing auth.js register endpoint — does it trip any validation on first login? Email validation? Account state?
- 9163 cleanup: irreversible — explicit backup script before delete?

## Output

Write `C:\ClaudeCodeProjects\Cairn\_research\friend-system\V3_REVIEW.md`:

```markdown
# V3 Plan Review

## Verdict
- [ ] APPROVE — ready for /project Sprint 0
- [ ] APPROVE WITH FIXES — list small fixes, then ready
- [ ] BLOCK — major issues, must redo sections

## Issues by Category

### 1. User decision drift
[list issues or "none found"]

### 2. Schema integrity
...

### 3. UI flow gaps
...

### 4. Data flow integrity
...

### 5. Test data realism
...

### 6. V1 scope discipline
...

### 7. Sprint feasibility
...

### 8. Risks user hasn't seen
...

## Top 5 must-fix before /project (if any)
1. ...

## Open questions to ask user (if any)
1. ...
```

300 word summary back to main agent. Include "Verdict: APPROVE / APPROVE-WITH-FIXES / BLOCK" as first line.

## Discipline
- Be skeptical not destructive. Plan is final v3, user wants to ship.
- "Looks good no issues" is failure for review — find at least 5 things worth discussing.
- Cite specific section / line / code in v3 plan. No vague "I worry about X" — point to exact text.
